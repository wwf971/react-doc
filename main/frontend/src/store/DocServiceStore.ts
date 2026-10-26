import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import {
  SERVICE_CODE_BACKEND_DOWN,
  SERVICE_CODE_INFRA_UNAVAILABLE,
  SERVICE_CODE_NOT_FOUND,
  SERVICE_CODE_NOT_READY,
  serviceBackendApiCreate,
} from '../lib/doc-service-api.js';
import { remoteModuleLoad } from '../lib/doc-service-federation.js';
import { dashboardDataTextBuild } from '../../../comp-doc/service/service-dashboard-data.js';

// The service templates and instances of the page (design:
// doc_page_impl_service.md). The services run in the service
// backend; this store knows what the backend's registry last said about
// them, creates instances from templates, loads the dashboard modules of
// the instances, tells a dashboard what keeps it from showing, works the
// instances from the Services tab (dependencies, enable, delete, the route
// of an infra name, the logs) and answers the events of the dashboards
// (eventHandle):
//
//   backendStatus     'none'     the page has no backend (no config service, or a build)
//                     'loading'  the first answer is awaited
//                     'up'       the backend answered the last request
//                     'down'     the development server answered that the backend cannot be reached
//   backendMessage    why it is down, as the server said
//   backendInfo       the backend's status (its folders, the problems of its scan, the kernel)
//   kernel            backendInfo.kernel: the doc pages mounted, the reconcile tick, its problems,
//                     the state of its log (buffer, the logging instance)
//   templateList      the templates: { templateId, name, kind: app | infra, provision, infraName, origin,
//                     description, versionId, versionList, config, status, message, folder, groupPath, dirName,
//                     expose, dashboardBuild }. listed, never run
//   instanceList      the instances: { serviceId, name, kind, origin, provision, description, isEnabled,
//                     template, config, dependencyList, dependencyStatusList, isDependencyDynamicAllowed,
//                     infraName, status, message, health, healthMessage, executionMode, isResidentRunning,
//                     hookRecordList, timeCreateHook, folder, dirName, expose, dashboardBuild, queueLength,
//                     apiRunning }; template is { templateId, name, versionId }, what the instance was
//                     created from; provision is null, or { mode: 'auto', infra, requiredBy, time } for an
//                     infra instance the kernel provisioned
//   infraList         the routing table of the kernel, one entry per infra name required, provided or
//                     templated: { name, serviceId (the current instance, '' none), status: available |
//                     unavailable | notProvided, message, isRouteExplicit, providerList, consumerList,
//                     templateList, storage }
//   moduleByServiceId the dashboard module of each instance (every instance serves its own copy):
//                     { status, module, message, entryUrl }
//   settings          the Services tab of the settings panel: the view shown (its path: the
//                     overview, or one template, instance, the server status, the infra routes,
//                     the logs, a new instance), the template and the instance chosen, the
//                     pending state of every write of the tab, the last log query, and the
//                     state of the config dashboards shown there (in memory: a tab is no document)
//
// a dashboard names what it shows by { templateName, dashboardId, serviceId }
// (a DashboardRef): the template and the dashboard by its component id, the
// instance by its data. the template name is matched against the name every
// instance recorded when it was created, so a dashboard keeps working when its
// template is renamed or removed. dashboardProblemGet says why it cannot
// show, in the order a reader can fix it.
//
// the backend's registry reads the service folders of the doc pages it is
// configured with and of those the page loaded (temporary mounts): whenever
// the backend turns up, and whenever the workspace changes, the store asks
// the development server to sync the loaded doc pages into the kernel
// (POST registry/docpage/sync; the server fills the body). a failed sync is
// tried again at the next turn-up.

export const serviceEventTypeList = [
  'serviceApiCallRequest',
  'serviceJobGetRequest',
  'serviceResolveRequest',
  'serviceBindRequest',
  'dashboardStateSetRequest',
  'serviceRefreshRequest',
];

// how soon the backend is asked again: soon while it is down, so the
// dashboards come back by themselves when it is started; now and then while
// it is up, so a backend stopped, or an instance stopping, is seen without a
// call failing first
const BACKEND_RETRY_MS = 5000;
const BACKEND_POLL_MS = 15000;

// the lifecycle statuses of an instance, as the backend reports them
export const serviceInstanceStatusList = ['ready', 'starting', 'waiting', 'disabled', 'error'] as const;

// the levels of a log record, lowest first
export const serviceLogLevelList = ['debug', 'info', 'warn', 'error'] as const;

export type ServiceResult = { code: number; data?: any; message: string };

export type DashboardRef = { templateName: string; dashboardId: string; serviceId: string };

// what a call names: an instance, any instance created from a template (at
// a version), or the current instance providing an infra name; the backend
// resolves it, never to the asking dashboard's own
export type ServiceTarget = { serviceId: string } | { templateId: string; versionId?: string } | { infra: string };

export type ServiceDependency = { name: string; isRequired?: boolean; onUnavailable?: 'report' | 'reject' };

export type DashboardProblemKind =
  | 'backendNone'
  | 'loading'
  | 'backendDown'
  | 'templateNotFound'
  | 'serviceNotBound'
  | 'serviceNotFound'
  | 'templateMismatch'
  | 'serviceNotReady'
  | 'dashboardNotFound'
  | 'moduleNotBuilt'
  | 'moduleError';

type PendingState = { status: 'idle' | 'submitting' | 'error'; message: string };

const pendingIdle = (): PendingState => ({ status: 'idle', message: '' });

export type ServiceLogQuery = {
  principalKind?: string;
  principalId?: string;
  feature?: string;
  level?: string;
  text?: string;
  timeFrom?: string;
  timeTo?: string;
  limit?: number;
  offset?: number;
};

// the views of the Services tab, each a path under the overview
// (overview / service-instance-{id}, overview / server-status, …)
export type ServiceSettingsView = 'overview' | 'server' | 'infra' | 'log' | 'instanceNew' | 'template' | 'instance';

// the last log query of the Services tab: its records (newest first), where
// they came from (the logging infra instance, or the kernel's own buffer
// while no logging instance answers), and the facets of the records
export type ServiceLogState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  source: '' | 'logging' | 'kernel';
  recordList: any[];
  total: number;
  facet: { principalList: any[]; featureList: any[]; levelList: any[] } | null;
  query: ServiceLogQuery;
  message: string;
};

export type DashboardProblem = { kind: DashboardProblemKind; message: string };

type ModuleState = { status: 'loading' | 'done' | 'error'; module?: any; message: string; entryUrl: string };

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any> };

// what an asset-backed block is, as CompAssetHost tells it (config.assetInfo)
type AssetInfo = {
  isFromAsset: boolean;
  store?: string;
  objectId?: string;
  versionIdRef?: string;
  isLocked?: boolean;
};

// the part of DocAssetStore the dashboards' state needs
type AssetStoreWriter = {
  writeUnavailableReason: string;
  objectUpdate: (store: string, objectId: string, data: { text: string }, mode: 'inPlace', note: string) => Promise<ServiceResult>;
};

// the part of DocSourceStore the store needs: the main doc page (where an
// instance of a built-in template is created) and the doc pages of the
// workspace (observable: a change makes the kernel sync them again)
type SourceStoreReader = {
  docPageAliasMain: string;
  docPageList: { alias: string }[];
};

export type DocServiceStoreOptions = {
  endpoint?: string;
  assetStore?: AssetStoreWriter;
  sourceStore?: SourceStoreReader;
};

export class DocServiceStore {
  backend: ReturnType<typeof serviceBackendApiCreate> | undefined;
  assetStore: AssetStoreWriter | undefined;
  sourceStore: SourceStoreReader | undefined;
  backendStatus: 'none' | 'loading' | 'up' | 'down' = 'none';
  backendMessage = '';
  backendInfo: any = null;
  templateList: any[] = [];
  instanceList: any[] = [];
  infraList: any[] = [];
  isRefreshing = false;
  moduleByServiceId: Record<string, ModuleState> = {};
  settings = {
    view: 'overview' as ServiceSettingsView,
    templateIdSelected: '',
    serviceIdSelected: '',
    stateByServiceId: {} as Record<string, any>,
    create: pendingIdle(),
    versionNew: pendingIdle(),
    dependencySet: pendingIdle(),
    enableSet: pendingIdle(),
    delete: pendingIdle(),
    routeSet: pendingIdle(),
    log: {
      status: 'idle',
      source: '',
      recordList: [],
      total: 0,
      facet: null,
      query: { limit: 50 },
      message: '',
    } as ServiceLogState,
  };
  refreshPromise: Promise<void> | undefined;
  // the writes of each dashboard object, one after another: a write needs
  // the hash of the head the previous one made
  writeChainByObjectKey = new Map<string, Promise<ServiceResult>>();
  // the next refresh (BACKEND_RETRY_MS, BACKEND_POLL_MS)
  refreshTimer: ReturnType<typeof setTimeout> | undefined;
  // whether the loaded doc pages are to be synced into the kernel at the
  // next chance: at start, after the backend was down, after the workspace
  // changed, after a sync failed
  isDocPageSyncPending = true;
  docPageSyncPromise: Promise<void> | undefined;
  // the number of the last log query sent: only its answer is kept
  logQuerySeq = 0;
  disposeWorkspaceReaction: (() => void) | undefined;
  isDisposed = false;

  constructor(options: DocServiceStoreOptions = {}) {
    if (options.endpoint) {
      this.backend = serviceBackendApiCreate(options.endpoint);
      this.backendStatus = 'loading';
    }
    this.assetStore = options.assetStore;
    this.sourceStore = options.sourceStore;
    makeAutoObservable(this, {
      backend: false,
      assetStore: false,
      sourceStore: false,
      refreshPromise: false,
      writeChainByObjectKey: false,
      refreshTimer: false,
      isDocPageSyncPending: false,
      docPageSyncPromise: false,
      logQuerySeq: false,
      disposeWorkspaceReaction: false,
      isDisposed: false,
      moduleByServiceId: observable.shallow,
      templateList: observable.ref,
      instanceList: observable.ref,
      infraList: observable.ref,
      backendInfo: observable.ref,
    });
  }

  init() {
    if (!this.backend) return;
    // the workspace changed (a doc page mounted or removed): the kernel is
    // told which doc pages the page loads now
    if (this.sourceStore) {
      this.disposeWorkspaceReaction = reaction(
        () => this.sourceStore!.docPageList.map((docPage) => docPage.alias).join('\n'),
        () => {
          this.isDocPageSyncPending = true;
          if (this.backendStatus === 'up') void this.docPageSync();
        },
      );
    }
    void this.refresh();
  }

  dispose() {
    this.isDisposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.disposeWorkspaceReaction?.();
    this.disposeWorkspaceReaction = undefined;
  }

  // ---------- the backend ----------

  // the registry asked again: the status, the templates, the instances and
  // the infra names, in one call. the backend scans its folders on every
  // listing, so a folder added by hand is seen here
  refresh(): Promise<void> {
    if (!this.backend) return Promise.resolve();
    if (this.refreshPromise) return this.refreshPromise;
    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      const wasUp = this.backendStatus === 'up';
      const result = await this.backend!.registryGet();
      runInAction(() => {
        if (result.code !== 0) {
          this.backendFailureAccept(result);
          return;
        }
        this.backendStatus = 'up';
        this.backendMessage = '';
        this.backendInfo = result.data.status;
        this.templateList = result.data.templateList ?? [];
        this.instanceList = result.data.instanceList ?? [];
        this.infraList = result.data.infraList ?? [];
      });
      // the backend turned up (the first answer, or up again): the doc
      // pages the page loaded are synced into its kernel
      if (this.backendStatus === 'up' && (!wasUp || this.isDocPageSyncPending)) void this.docPageSync();
    })().finally(() => {
      runInAction(() => {
        this.isRefreshing = false;
      });
      this.refreshPromise = undefined;
      this.refreshSchedule();
    });
    return this.refreshPromise;
  }

  private refreshSchedule() {
    if (this.isDisposed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const delay = this.backendStatus === 'down' ? BACKEND_RETRY_MS : BACKEND_POLL_MS;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, delay);
  }

  private backendFailureAccept(result: ServiceResult) {
    this.backendStatus = result.code === SERVICE_CODE_BACKEND_DOWN ? 'down' : 'up';
    this.backendMessage = result.message;
    // a call that found the backend down: ask again soon, not at the next
    // poll; and the doc pages are synced again when it is up
    if (this.backendStatus === 'down') {
      this.isDocPageSyncPending = true;
      this.refreshSchedule();
    }
  }

  // the doc pages the page loaded, told to the kernel (the development
  // server fills the body with them). a failure of any kind is kept quiet:
  // the sync is tried again at the next turn-up. a mount the kernel did not
  // know makes the registry be asked again, for the templates it holds
  docPageSync(): Promise<void> {
    if (!this.backend) return Promise.resolve();
    if (this.docPageSyncPromise) return this.docPageSyncPromise;
    this.docPageSyncPromise = (async () => {
      const result = await this.backend!.docPageSync();
      if (result.code !== 0) {
        this.isDocPageSyncPending = true;
        if (result.code === SERVICE_CODE_BACKEND_DOWN) runInAction(() => this.backendFailureAccept(result));
        return;
      }
      this.isDocPageSyncPending = false;
      const aliasListKnown = (this.kernel?.docPageList ?? []).map((docPage: any) => docPage.alias).sort().join('\n');
      const aliasListSynced = (Array.isArray(result.data) ? result.data : []).map((docPage: any) => docPage.alias).sort().join('\n');
      if (aliasListKnown !== aliasListSynced) void this.refresh();
    })().finally(() => {
      this.docPageSyncPromise = undefined;
    });
    return this.docPageSyncPromise;
  }

  get unavailableReason(): string {
    if (this.backendStatus === 'none') {
      return 'The page has no service backend: config.yaml has no service section, or the page is a build (a build has no backend).';
    }
    if (this.backendStatus === 'down') return this.backendMessage || 'The service backend cannot be reached.';
    return '';
  }

  // the kernel's state, as the backend's status reports it (null until the
  // backend answered)
  get kernel(): any {
    return this.backendInfo?.kernel ?? null;
  }

  // the main doc page of the page: where an instance of a built-in template
  // is created ('' when the page has no source store: the backend decides)
  get docPageAliasMain(): string {
    return this.sourceStore?.docPageAliasMain ?? '';
  }

  // ---------- templates and instances ----------

  templateGet(templateId: string): any {
    return this.templateList.find((template) => template.templateId === templateId);
  }

  templateGetByName(name: string): any {
    return this.templateList.find((template) => template.name === name);
  }

  instanceGet(serviceId: string): any {
    return this.instanceList.find((instance) => instance.serviceId === serviceId);
  }

  // the routing entry of an infra name
  infraGet(name: string): any {
    return this.infraList.find((infra) => infra.name === name);
  }

  // the templates of a kind (app, infra), as the registry lists them
  // the templates of a kind (app, infra), those at the top of their folder
  // first, then group by group (groupPath), each by name
  templateListOfKind(kind: 'app' | 'infra'): any[] {
    return this.templateList
      .filter((template) => (template.kind ?? 'app') === kind)
      .sort((a, b) => (a.groupPath ?? '').localeCompare(b.groupPath ?? '') || a.name.localeCompare(b.name));
  }

  // the instances of a kind (app, infra), as the registry lists them
  instanceListOfKind(kind: 'app' | 'infra'): any[] {
    return this.instanceList.filter((instance) => (instance.kind ?? 'app') === kind);
  }

  // the instances created from a template, by the id they recorded
  instanceListOfTemplate(templateId: string): any[] {
    return this.instanceList.filter((instance) => instance.template?.templateId === templateId);
  }

  // the instances a dashboard service/{templateName}/… may show: those that
  // recorded the template name when they were created, whether or not the
  // template is still there
  instanceListOfTemplateName(templateName: string): any[] {
    return this.instanceList.filter((instance) => instance.template?.name === templateName);
  }

  // a dashboard an instance declares, from its own script
  dashboardDefineGet(serviceId: string, dashboardId: string): any {
    return this.instanceGet(serviceId)?.expose?.dashboardList?.find((dashboard: any) => dashboard.id === dashboardId);
  }

  // the dashboard of a purpose (default, config) of a script's exposure: a
  // script has at most one of each (an infra script may have none)
  dashboardIdOfPurposeGet(expose: any, purpose: 'default' | 'config'): string {
    return expose?.dashboardList?.find((dashboard: any) => dashboard.purpose === purpose)?.id ?? '';
  }

  // every dashboard of the templates that can be used, for the insert menu
  // (edit-template.js), then the dashboards of the instances whose template
  // name no template has any more (the first such instance of each name):
  // [{ templateName, label, dashboardId, dashboardLabel, description }]
  get dashboardInsertList(): any[] {
    const list: any[] = [];
    const templateNameDoneSet = new Set<string>();
    const exposeListAdd = (templateName: string, expose: any) => {
      templateNameDoneSet.add(templateName);
      for (const dashboard of expose.dashboardList ?? []) {
        list.push({
          templateName,
          label: expose.meta.label,
          dashboardId: dashboard.id,
          dashboardLabel: dashboard.label,
          description: dashboard.description || expose.meta.description,
        });
      }
    };
    for (const template of this.templateList) {
      if (template.status === 'ready') exposeListAdd(template.name, template.expose);
    }
    for (const instance of this.instanceList) {
      const templateName = instance.template?.name;
      if (!templateName || templateNameDoneSet.has(templateName) || !instance.expose) continue;
      exposeListAdd(templateName, instance.expose);
    }
    return list;
  }

  templateIconUrlGet(templateId: string): string {
    if (!this.backend || !this.templateGet(templateId)?.expose?.meta?.icon) return '';
    return this.backend.templateIconUrlGet(templateId);
  }

  instanceIconUrlGet(serviceId: string): string {
    if (!this.backend || !this.instanceGet(serviceId)?.expose?.meta?.icon) return '';
    return this.backend.instanceIconUrlGet(serviceId);
  }

  // the icon of a dashboard: its instance's own, else its template's
  dashboardIconUrlGet(templateName: string, serviceId: string): string {
    if (this.instanceGet(serviceId)) return this.instanceIconUrlGet(serviceId);
    const template = this.templateGetByName(templateName);
    return template ? this.templateIconUrlGet(template.templateId) : '';
  }

  // ---------- the writes of the Services tab ----------

  // one write of the tab: its pending state in settings, the backend marked
  // down when the call says so, the registry asked again after success
  private async settingsWrite(key: 'create' | 'versionNew' | 'dependencySet' | 'enableSet' | 'delete' | 'routeSet', call: () => Promise<ServiceResult>): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    runInAction(() => {
      this.settings[key] = { status: 'submitting', message: '' };
    });
    const result = await call();
    runInAction(() => {
      if (result.code === SERVICE_CODE_BACKEND_DOWN) this.backendFailureAccept(result);
      this.settings[key] = result.code === 0 ? pendingIdle() : { status: 'error', message: result.message };
    });
    if (result.code === 0) await this.refresh();
    return result;
  }

  // a new instance from a template: the backend copies the template folder
  // into a folder of the instance's own, and records the template in it.
  // the instance folder is that of the doc page named (docPageAlias), else
  // of the template's own doc page, else the backend's default; an instance
  // of a built-in template (shipped by the package, of no doc page) goes to
  // the page's main doc page unless told otherwise
  async instanceCreate(input: { templateId: string; name: string; description?: string; config?: Record<string, any>; docPageAlias?: string }): Promise<ServiceResult> {
    const template = this.templateGet(input.templateId);
    const docPageAlias = input.docPageAlias ?? (template?.origin?.kind === 'builtIn' ? this.docPageAliasMain : '');
    const result = await this.settingsWrite('create', () => this.backend!.instanceCreate({
      templateId: input.templateId,
      name: input.name,
      description: input.description ?? '',
      config: input.config ?? {},
      docPageAlias,
    }));
    if (result.code === 0) {
      runInAction(() => {
        this.settingsServiceSelect(result.data.serviceId);
      });
    }
    return result;
  }

  // a new version id of a template; the instances created before keep the one they recorded
  templateVersionNew(templateId: string, note: string): Promise<ServiceResult> {
    return this.settingsWrite('versionNew', () => this.backend!.templateVersionNew(templateId, note));
  }

  // the effective dependencies of an instance replaced (the names of infra
  // services it uses, each required or not, reported or rejected when
  // unavailable), and whether its script may add some at runtime; the
  // backend restarts the instance
  instanceDependencySet(serviceId: string, dependencyList: (string | ServiceDependency)[], isDependencyDynamicAllowed?: boolean): Promise<ServiceResult> {
    return this.settingsWrite('dependencySet', () => this.backend!.instanceDependencySet(serviceId, dependencyList, isDependencyDynamicAllowed));
  }

  // an instance disabled (stopped, its calls refused) or enabled again
  instanceEnableSet(serviceId: string, isEnabled: boolean): Promise<ServiceResult> {
    return this.settingsWrite('enableSet', () => this.backend!.instanceEnableSet(serviceId, isEnabled));
  }

  // an instance deleted: stopped, its onDestroy hook run, its folder renamed
  // .deleted-{dirName}-{time} (its data is kept on disk)
  async instanceDelete(serviceId: string): Promise<ServiceResult> {
    const result = await this.settingsWrite('delete', () => this.backend!.instanceDelete(serviceId));
    if (result.code === 0) {
      runInAction(() => {
        if (this.settings.serviceIdSelected === serviceId) this.settingsServiceSelect('');
      });
    }
    return result;
  }

  // the route of an infra name set to an instance providing it, or back to
  // the default route (serviceId '': the oldest ready provider)
  infraRouteSet(name: string, serviceId: string): Promise<ServiceResult> {
    return this.settingsWrite('routeSet', () => this.backend!.infraRouteSet(name, serviceId));
  }

  // the view of the Services tab without an object of its own: the
  // overview, the server status, the infra routes, the logs, a new instance
  settingsViewSet(view: ServiceSettingsView) {
    this.settings.view = view;
  }

  // a template shown in the tab ('': back to the overview)
  settingsTemplateSelect(templateId: string) {
    this.settings.templateIdSelected = templateId;
    this.settings.view = templateId ? 'template' : 'overview';
    this.settings.versionNew = pendingIdle();
  }

  // an instance shown in the tab ('': back to the overview)
  settingsServiceSelect(serviceId: string) {
    this.settings.serviceIdSelected = serviceId;
    this.settings.view = serviceId ? 'instance' : 'overview';
    this.settings.dependencySet = pendingIdle();
    this.settings.enableSet = pendingIdle();
    this.settings.delete = pendingIdle();
    this.settings.routeSet = pendingIdle();
  }

  settingsStateSet(serviceId: string, state: any) {
    this.settings.stateByServiceId = { ...this.settings.stateByServiceId, [serviceId]: state };
  }

  // ---------- logs ----------

  // the records of the kernel log, from the logging infra instance
  // (api logQuery of target { infra: 'logging' }); while no logging instance
  // answers (-7: none provides the name, or it is not ready) the kernel's own
  // buffer (GET log/recent) is shown instead, filtered here. the result is
  // kept in settings.log, newest first
  async logQuery(query: ServiceLogQuery = {}): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    const queryClean = logQueryClean(query);
    const seq = ++this.logQuerySeq;
    runInAction(() => {
      this.settings.log.status = 'loading';
      this.settings.log.query = queryClean;
    });
    let result = await this.backend.apiCall({ infra: 'logging' }, 'logQuery', queryClean, '');
    let source: ServiceLogState['source'] = 'logging';
    if (result.code === SERVICE_CODE_INFRA_UNAVAILABLE) {
      source = 'kernel';
      result = await this.backend.logRecent(Math.max(200, (queryClean.limit ?? 100) + (queryClean.offset ?? 0)));
      if (result.code === 0) {
        const recordList = logRecordListFilter(Array.isArray(result.data) ? result.data : [], queryClean);
        result = { code: 0, message: '', data: { recordList, total: recordList.length } };
      }
    }
    this.callResultAccept(result);
    runInAction(() => {
      // a later query was sent meanwhile: its answer is the one shown
      if (seq !== this.logQuerySeq) return;
      if (result.code !== 0) {
        this.settings.log.status = 'error';
        this.settings.log.message = result.message;
        return;
      }
      this.settings.log.status = 'done';
      this.settings.log.source = source;
      this.settings.log.message = '';
      this.settings.log.recordList = result.data?.recordList ?? [];
      this.settings.log.total = Number(result.data?.total ?? this.settings.log.recordList.length);
    });
    return result;
  }

  // the facets of the log records (who wrote them, which feature, which
  // level, with counts), for the filters of the log area; from the kernel's
  // buffer while no logging instance answers
  async logFacetGet(): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    let result = await this.backend.apiCall({ infra: 'logging' }, 'logFacetGet', {}, '');
    if (result.code === SERVICE_CODE_INFRA_UNAVAILABLE) {
      result = await this.backend.logRecent(500);
      if (result.code === 0) result = { code: 0, message: '', data: logFacetBuild(Array.isArray(result.data) ? result.data : []) };
    }
    this.callResultAccept(result);
    runInAction(() => {
      if (result.code === 0) {
        this.settings.log.facet = {
          principalList: result.data?.principalList ?? [],
          featureList: result.data?.featureList ?? [],
          levelList: result.data?.levelList ?? [],
        };
      }
    });
    return result;
  }

  // ---------- dashboard modules ----------

  moduleStateGet(serviceId: string): ModuleState | undefined {
    return this.moduleByServiceId[serviceId];
  }

  // loads the dashboard module of an instance once per build of it (the
  // entry url carries the build time); nothing happens while it is not
  // built. every instance has its own module, served from its own folder
  async moduleLoad(serviceId: string): Promise<void> {
    const instance = this.instanceGet(serviceId);
    if (!this.backend || !instance?.expose?.dashboardRemote || !instance.dashboardBuild?.isBuilt) return;
    const remote = instance.expose.dashboardRemote;
    const entryUrl = `${this.backend.dashboardEntryUrlGet(serviceId, remote.entry)}?t=${instance.dashboardBuild.timeBuilt}`;
    const stateCurrent = this.moduleByServiceId[serviceId];
    if (stateCurrent?.entryUrl === entryUrl) return;
    this.moduleByServiceId[serviceId] = { status: 'loading', message: '', entryUrl };
    const result = await remoteModuleLoad(entryUrl, remote.module);
    runInAction(() => {
      if (this.moduleByServiceId[serviceId]?.entryUrl !== entryUrl) return;
      this.moduleByServiceId[serviceId] = result.code === 0
        ? { status: 'done', module: result.data, message: '', entryUrl }
        : { status: 'error', message: result.message, entryUrl };
    });
  }

  // the component of a dashboard of an instance, once its module is loaded
  dashboardComponentGet(serviceId: string, dashboardId: string): any {
    const exportName = this.dashboardDefineGet(serviceId, dashboardId)?.export;
    const moduleState = this.moduleByServiceId[serviceId];
    if (!exportName || moduleState?.status !== 'done') return undefined;
    return moduleState.module?.[exportName];
  }

  // why a dashboard cannot show its instance (null when it can), in the
  // order a reader can fix it: the backend, the instance chosen, the
  // instance itself (its template, its state, its script), the dashboard
  // its script declares, its dashboard module
  dashboardProblemGet(ref: DashboardRef): DashboardProblem | null {
    const { templateName, dashboardId, serviceId } = ref;
    if (this.backendStatus === 'none') return { kind: 'backendNone', message: this.unavailableReason };
    if (this.backendStatus === 'loading') return { kind: 'loading', message: 'asking the service backend…' };
    if (this.backendStatus === 'down') return { kind: 'backendDown', message: this.unavailableReason };
    if (!serviceId) {
      if (!this.templateGetByName(templateName) && this.instanceListOfTemplateName(templateName).length === 0) {
        return {
          kind: 'templateNotFound',
          message: `No service template is named ${templateName}, and no instance was created from one: there is no instance this dashboard can show.`,
        };
      }
      return { kind: 'serviceNotBound', message: 'Choose the instance this dashboard shows.' };
    }
    const instance = this.instanceGet(serviceId);
    if (!instance) return { kind: 'serviceNotFound', message: `The service instance ${serviceId} is not found: its folder is gone, or it is in a folder the backend does not scan.` };
    if (instance.template?.name !== templateName) {
      return {
        kind: 'templateMismatch',
        message: `The instance ${instance.name} was created from the template ${instance.template?.name}, not ${templateName}.`,
      };
    }
    // starting, waiting (a required infra service is not available yet),
    // disabled, or in error
    if (instance.status !== 'ready') {
      return { kind: 'serviceNotReady', message: `The instance ${instance.name} is ${instance.status}${instance.message ? `: ${instance.message}` : ''}` };
    }
    if (!this.dashboardDefineGet(serviceId, dashboardId)) {
      const idList = (instance.expose?.dashboardList ?? []).map((dashboard: any) => dashboard.id).join(', ') || 'none';
      return { kind: 'dashboardNotFound', message: `The instance ${instance.name} has no dashboard ${dashboardId} (it has: ${idList}).` };
    }
    if (!instance.dashboardBuild?.isBuilt) {
      return {
        kind: 'moduleNotBuilt',
        message: `The dashboards of ${instance.name} are not built: build ${instance.folder}/${instance.dirName}/${instance.expose.dashboardRemote?.dir} (vite build in the dashboard folder of the instance).`,
      };
    }
    const moduleState = this.moduleByServiceId[serviceId];
    if (!moduleState || moduleState.status === 'loading') return { kind: 'loading', message: 'loading the dashboard…' };
    if (moduleState.status === 'error') return { kind: 'moduleError', message: moduleState.message };
    if (!this.dashboardComponentGet(serviceId, dashboardId)) {
      const exportName = this.dashboardDefineGet(serviceId, dashboardId).export;
      return { kind: 'moduleError', message: `The dashboard module of ${instance.name} has no export ${exportName}.` };
    }
    return null;
  }

  // ---------- calls ----------

  // a call of an api of the instance target names; dashboardServiceId is the
  // instance whose dashboard asks, the caller as the backend records it
  async apiCall(target: ServiceTarget, api: string, params: Record<string, any> | undefined, dashboardServiceId = ''): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    const result = await this.backend.apiCall(target, api, params, dashboardServiceId);
    this.callResultAccept(result);
    return result;
  }

  async instanceResolve(target: ServiceTarget, dashboardServiceId = ''): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    const result = await this.backend.instanceResolve(target, dashboardServiceId);
    this.callResultAccept(result);
    return result;
  }

  async jobGet(serviceId: string, jobId: string): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    const result = await this.backend.jobGet(serviceId, jobId);
    this.callResultAccept(result);
    return result;
  }

  // what a call says about the backend: down, or up again after being down;
  // an instance that is gone, not ready, or whose infra service is
  // unavailable makes the registry be asked again
  private callResultAccept(result: ServiceResult) {
    if (result.code === SERVICE_CODE_BACKEND_DOWN) {
      runInAction(() => this.backendFailureAccept(result));
      return;
    }
    if (
      this.backendStatus === 'down'
      || result.code === SERVICE_CODE_NOT_FOUND
      || result.code === SERVICE_CODE_NOT_READY
      || result.code === SERVICE_CODE_INFRA_UNAVAILABLE
    ) void this.refresh();
  }

  // ---------- the state of a dashboard ----------

  // why the state of a dashboard block cannot be written ('' when it can)
  stateUnavailableReasonGet(assetInfo: AssetInfo | undefined): string {
    if (!assetInfo?.isFromAsset) return 'The dashboard keeps its state in an asset object, and this block has none.';
    if (assetInfo.versionIdRef !== 'head') {
      return `The block reads the version ${assetInfo.versionIdRef} of its asset, which is never changed; a reference to the head keeps the state.`;
    }
    if (assetInfo.isLocked) return 'The asset object of the dashboard is locked.';
    if (!this.assetStore) return 'The page has no asset service layer.';
    return this.assetStore.writeUnavailableReason;
  }

  // the whole data of a dashboard block written into its asset object, in
  // place: the state is the dashboard's present, not a history of versions
  dashboardDataWrite(assetInfo: AssetInfo | undefined, data: { serviceId: string; state: any }): Promise<ServiceResult> {
    const reason = this.stateUnavailableReasonGet(assetInfo);
    if (reason) return Promise.resolve({ code: -1, message: reason });
    const { store, objectId } = assetInfo as Required<AssetInfo>;
    const key = `${store}/${objectId}`;
    const previous = this.writeChainByObjectKey.get(key) ?? Promise.resolve({ code: 0, message: '' });
    const write = previous.then(() => this.assetStore!.objectUpdate(
      store,
      objectId,
      { text: dashboardDataTextBuild(data) },
      'inPlace',
      'dashboard state',
    ));
    this.writeChainByObjectKey.set(key, write);
    void write.finally(() => {
      if (this.writeChainByObjectKey.get(key) === write) this.writeChainByObjectKey.delete(key);
    });
    return write;
  }

  // ---------- events ----------

  // the events of a dashboard (doc_page_impl_service.md#dashboard-events).
  // the frame of the dashboard (ServiceDashboardHost) adds data.dashboard,
  // { templateName, dashboardId, serviceId, state }: what the block shows now. a
  // call goes to that instance, or to the one data.target names
  // (doc_page_impl_service.md#calls-between-services: an instance, a
  // template, or an infra name), the dashboard's instance sent as the
  // caller. the bind and the state are written into the block's asset object
  // (source.asset); a place that keeps them elsewhere (the Services tab)
  // answers them first, as the local handler.
  async eventHandle(event: DocEvent): Promise<ServiceResult | undefined> {
    if (!serviceEventTypeList.includes(event.type)) return undefined;
    if (event.type === 'serviceRefreshRequest') {
      await this.refresh();
      return { code: 0, message: '' };
    }
    const dashboard = event.data?.dashboard;
    if (!dashboard || typeof dashboard.templateName !== 'string') {
      return { code: -1, message: `${event.type} comes from a component that is not a service dashboard` };
    }
    if (event.type === 'serviceApiCallRequest' || event.type === 'serviceResolveRequest') {
      const target = event.data.target ?? { serviceId: dashboard.serviceId };
      if (!target || typeof target !== 'object') {
        return { code: -1, message: `the target of ${event.type} is { serviceId }, { templateId, versionId? } or { infra }` };
      }
      if (!event.data.target && !dashboard.serviceId) return { code: -1, message: 'The dashboard is not bound to an instance.' };
      if (event.type === 'serviceResolveRequest') return this.instanceResolve(target, dashboard.serviceId);
      if (typeof event.data.api !== 'string' || event.data.api === '') return { code: -1, message: 'serviceApiCallRequest needs api' };
      return this.apiCall(target, event.data.api, event.data.params, dashboard.serviceId);
    }
    if (event.type === 'serviceJobGetRequest') {
      // a job of another instance names it (the serviceId of the job)
      return this.jobGet(String(event.data.serviceId || dashboard.serviceId), String(event.data.jobId ?? ''));
    }
    if (event.type === 'serviceBindRequest') {
      return this.dashboardDataWrite(event.source?.asset, { serviceId: String(event.data.serviceId ?? ''), state: dashboard.state ?? {} });
    }
    if (event.type === 'dashboardStateSetRequest') {
      const state = event.data.state;
      if (!state || typeof state !== 'object' || Array.isArray(state)) return { code: -1, message: 'the state of a dashboard is a mapping' };
      return this.dashboardDataWrite(event.source?.asset, { serviceId: dashboard.serviceId, state });
    }
    return undefined;
  }
}

// ---------- the log helpers ----------

// a log query with only the filters that are set
function logQueryClean(query: ServiceLogQuery): ServiceLogQuery {
  const clean: ServiceLogQuery = {};
  for (const key of ['principalKind', 'principalId', 'feature', 'level', 'text', 'timeFrom', 'timeTo'] as const) {
    const value = query[key];
    if (typeof value === 'string' && value !== '') clean[key] = value;
  }
  clean.limit = Math.max(1, Math.min(1000, Number(query.limit) || 100));
  if (query.offset) clean.offset = Math.max(0, Number(query.offset) || 0);
  return clean;
}

// the kernel's buffer filtered like the logging service would, newest first
function logRecordListFilter(recordList: any[], query: ServiceLogQuery): any[] {
  const levelMin = query.level ? serviceLogLevelList.indexOf(query.level as any) : -1;
  const text = (query.text ?? '').toLowerCase();
  const list = recordList.filter((record) => {
    if (query.principalKind && record.principal?.kind !== query.principalKind) return false;
    if (query.principalId && record.principal?.id !== query.principalId) return false;
    if (query.feature && record.feature !== query.feature) return false;
    if (levelMin > 0 && serviceLogLevelList.indexOf(record.level) < levelMin) return false;
    if (text && !String(record.message ?? '').toLowerCase().includes(text) && !JSON.stringify(record.data ?? '').toLowerCase().includes(text)) return false;
    if (query.timeFrom && String(record.time) < query.timeFrom) return false;
    if (query.timeTo && String(record.time) > query.timeTo) return false;
    return true;
  });
  list.reverse();
  const offset = query.offset ?? 0;
  return list.slice(offset, offset + (query.limit ?? 100));
}

// the facets of a list of records, counted here
function logFacetBuild(recordList: any[]): { principalList: any[]; featureList: any[]; levelList: any[] } {
  const principalCount = new Map<string, { kind: string; id: string; count: number }>();
  const featureCount = new Map<string, number>();
  const levelCount = new Map<string, number>();
  for (const record of recordList) {
    const kind = String(record.principal?.kind ?? '');
    const id = String(record.principal?.id ?? '');
    const key = `${kind}\n${id}`;
    const principal = principalCount.get(key) ?? { kind, id, count: 0 };
    principal.count += 1;
    principalCount.set(key, principal);
    featureCount.set(record.feature, (featureCount.get(record.feature) ?? 0) + 1);
    levelCount.set(record.level, (levelCount.get(record.level) ?? 0) + 1);
  }
  return {
    principalList: [...principalCount.values()],
    featureList: [...featureCount].map(([feature, count]) => ({ feature, count })).sort((a, b) => a.feature.localeCompare(b.feature)),
    levelList: [...levelCount].map(([level, count]) => ({ level, count })),
  };
}
