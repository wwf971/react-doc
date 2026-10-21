import { makeAutoObservable, observable, runInAction } from 'mobx';
import { SERVICE_CODE_BACKEND_DOWN, serviceBackendApiCreate } from '../lib/doc-service-api.js';
import { remoteModuleLoad } from '../lib/doc-service-federation.js';
import { dashboardDataTextBuild } from '../../../comp-doc/service/service-dashboard-data.js';

// The service templates and instances of the page (design:
// doc_page_impl_service_instance.md). The services run in the service
// backend; this store knows what the backend last said about them, creates
// instances from templates, loads the dashboard modules of the instances,
// tells a dashboard what keeps it from showing, and answers the events of
// the dashboards (eventHandle):
//
//   backendStatus     'none'     the page has no backend (no service.backend, or a build)
//                     'loading'  the first answer is awaited
//                     'up'       the backend answered the last request
//                     'down'     the development server answered that the backend cannot be reached
//   backendMessage    why it is down, as the server said
//   backendInfo       the backend's status (its folders, the problems of its scan)
//   templateList      the templates: { templateId, name, description, versionId, versionList, config,
//                     status, message, folder, dirName, expose, dashboardBuild }. listed, never run
//   instanceList      the instances: { serviceId, name, description, isEnabled, template, config,
//                     status, message, folder, dirName, expose, dashboardBuild, queueLength, apiRunning };
//                     template is { templateId, name, versionId }, what the instance was created from
//   moduleByServiceId the dashboard module of each instance (every instance serves its own copy):
//                     { status, module, message, entryUrl }
//   settings          the Services tab of the settings panel: the template and the instance
//                     chosen, the creation of an instance and of a template version, and the
//                     state of the config dashboards shown there (in memory: a tab is no document)
//
// a dashboard names what it shows by { templateName, dashboardId, serviceId }
// (a DashboardRef): the template and the dashboard by its component id, the
// instance by its data. the template name is matched against the name every
// instance recorded when it was created, so a dashboard keeps working when its
// template is renamed or removed. dashboardProblemGet says why it cannot
// show, in the order a reader can fix it.

export const serviceEventTypeList = [
  'serviceApiCallRequest',
  'serviceJobGetRequest',
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

export type ServiceResult = { code: number; data?: any; message: string };

export type DashboardRef = { templateName: string; dashboardId: string; serviceId: string };

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

export type DocServiceStoreOptions = {
  endpoint?: string;
  assetStore?: AssetStoreWriter;
};

export class DocServiceStore {
  backend: ReturnType<typeof serviceBackendApiCreate> | undefined;
  assetStore: AssetStoreWriter | undefined;
  backendStatus: 'none' | 'loading' | 'up' | 'down' = 'none';
  backendMessage = '';
  backendInfo: any = null;
  templateList: any[] = [];
  instanceList: any[] = [];
  isRefreshing = false;
  moduleByServiceId: Record<string, ModuleState> = {};
  settings = {
    templateIdSelected: '',
    serviceIdSelected: '',
    stateByServiceId: {} as Record<string, any>,
    create: { status: 'idle', message: '' } as PendingState,
    versionNew: { status: 'idle', message: '' } as PendingState,
  };
  refreshPromise: Promise<void> | undefined;
  // the writes of each dashboard object, one after another: a write needs
  // the hash of the head the previous one made
  writeChainByObjectKey = new Map<string, Promise<ServiceResult>>();
  // the next refresh (BACKEND_RETRY_MS, BACKEND_POLL_MS)
  refreshTimer: ReturnType<typeof setTimeout> | undefined;
  isDisposed = false;

  constructor(options: DocServiceStoreOptions = {}) {
    if (options.endpoint) {
      this.backend = serviceBackendApiCreate(options.endpoint);
      this.backendStatus = 'loading';
    }
    this.assetStore = options.assetStore;
    makeAutoObservable(this, {
      backend: false,
      assetStore: false,
      refreshPromise: false,
      writeChainByObjectKey: false,
      refreshTimer: false,
      isDisposed: false,
      moduleByServiceId: observable.shallow,
      templateList: observable.ref,
      instanceList: observable.ref,
      backendInfo: observable.ref,
    });
  }

  init() {
    if (this.backend) void this.refresh();
  }

  dispose() {
    this.isDisposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  // ---------- the backend ----------

  // the status, the templates and the instances, asked again. the backend
  // scans its folders on every listing, so a folder added by hand is seen here
  refresh(): Promise<void> {
    if (!this.backend) return Promise.resolve();
    if (this.refreshPromise) return this.refreshPromise;
    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      const resultStatus = await this.backend!.statusGet();
      if (resultStatus.code !== 0) {
        runInAction(() => this.backendFailureAccept(resultStatus));
        return;
      }
      const [resultTemplate, resultInstance] = await Promise.all([this.backend!.templateList(), this.backend!.instanceList()]);
      runInAction(() => {
        this.backendInfo = resultStatus.data;
        if (resultTemplate.code !== 0 || resultInstance.code !== 0) {
          this.backendFailureAccept(resultTemplate.code !== 0 ? resultTemplate : resultInstance);
          return;
        }
        this.backendStatus = 'up';
        this.backendMessage = '';
        this.templateList = resultTemplate.data;
        this.instanceList = resultInstance.data;
      });
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
    // a call that found the backend down: ask again soon, not at the next poll
    if (this.backendStatus === 'down') this.refreshSchedule();
  }

  get unavailableReason(): string {
    if (this.backendStatus === 'none') {
      return 'The page has no service backend: config.yaml names no service.backend, or the page is a build (a build has no backend).';
    }
    if (this.backendStatus === 'down') return this.backendMessage || 'The service backend cannot be reached.';
    return '';
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

  // the dashboard of a purpose (default, config) of a script's exposure: every
  // script has exactly one of each
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
      for (const dashboard of expose.dashboardList) {
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

  // a new instance from a template: the backend copies the template folder
  // into a folder of the instance's own, and records the template in it
  async instanceCreate(input: { templateId: string; name: string; description?: string; config?: Record<string, any> }): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    runInAction(() => {
      this.settings.create = { status: 'submitting', message: '' };
    });
    const result = await this.backend.instanceCreate({
      templateId: input.templateId,
      name: input.name,
      description: input.description ?? '',
      config: input.config ?? {},
    });
    runInAction(() => {
      if (result.code === SERVICE_CODE_BACKEND_DOWN) this.backendFailureAccept(result);
      this.settings.create = result.code === 0 ? { status: 'idle', message: '' } : { status: 'error', message: result.message };
    });
    if (result.code !== 0) return result;
    await this.refresh();
    runInAction(() => {
      this.settings.serviceIdSelected = result.data.serviceId;
    });
    return result;
  }

  // a new version id of a template; the instances created before keep the one they recorded
  async templateVersionNew(templateId: string, note: string): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    runInAction(() => {
      this.settings.versionNew = { status: 'submitting', message: '' };
    });
    const result = await this.backend.templateVersionNew(templateId, note);
    runInAction(() => {
      if (result.code === SERVICE_CODE_BACKEND_DOWN) this.backendFailureAccept(result);
      this.settings.versionNew = result.code === 0 ? { status: 'idle', message: '' } : { status: 'error', message: result.message };
    });
    if (result.code === 0) await this.refresh();
    return result;
  }

  settingsTemplateSelect(templateId: string) {
    this.settings.templateIdSelected = templateId;
    this.settings.versionNew = { status: 'idle', message: '' };
  }

  settingsServiceSelect(serviceId: string) {
    this.settings.serviceIdSelected = serviceId;
  }

  settingsStateSet(serviceId: string, state: any) {
    this.settings.stateByServiceId = { ...this.settings.stateByServiceId, [serviceId]: state };
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
    if (!this.backend || !instance?.expose || !instance.dashboardBuild?.isBuilt) return;
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
    if (instance.status !== 'ready') {
      return { kind: 'serviceNotReady', message: `The instance ${instance.name} is ${instance.status}${instance.message ? `: ${instance.message}` : ''}` };
    }
    if (!this.dashboardDefineGet(serviceId, dashboardId)) {
      const idList = (instance.expose?.dashboardList ?? []).map((dashboard: any) => dashboard.id).join(', ');
      return { kind: 'dashboardNotFound', message: `The instance ${instance.name} has no dashboard ${dashboardId} (it has: ${idList}).` };
    }
    if (!instance.dashboardBuild?.isBuilt) {
      return {
        kind: 'moduleNotBuilt',
        message: `The dashboards of ${instance.name} are not built: build ${instance.folder}/${instance.dirName}/${instance.expose.dashboardRemote.dir} (vite build in the dashboard folder of the instance).`,
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

  async apiCall(serviceId: string, api: string, params: Record<string, any> | undefined): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    if (!serviceId) return { code: -1, message: 'The dashboard is not bound to an instance.' };
    const result = await this.backend.apiCall(serviceId, api, params);
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
  // an instance that is gone or not ready makes the lists be asked again
  private callResultAccept(result: ServiceResult) {
    if (result.code === SERVICE_CODE_BACKEND_DOWN) {
      runInAction(() => this.backendFailureAccept(result));
      return;
    }
    if (this.backendStatus === 'down' || result.code === -3 || result.code === -4) void this.refresh();
  }

  // ---------- the state of a dashboard ----------

  // why the state of a dashboard block cannot be written ('' when it can)
  stateUnavailableReasonGet(assetInfo: AssetInfo | undefined): string {
    if (!assetInfo?.isFromAsset) return 'The dashboard keeps its state in an asset object, and this block has none.';
    if (assetInfo.versionIdRef !== 'head') {
      return `The block reads the version ${assetInfo.versionIdRef} of its asset, which is never changed; a reference to the head keeps the state.`;
    }
    if (assetInfo.isLocked) return 'The asset object of the dashboard is locked.';
    if (!this.assetStore) return 'The page has no asset store.';
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

  // the events of a dashboard (doc_page_impl_service_instance.md#dashboard-events).
  // the frame of the dashboard (ServiceDashboardHost) adds data.dashboard,
  // { templateName, dashboardId, serviceId, state }: what the block shows now. a
  // call goes to that instance only; a dashboard cannot name another one.
  // the bind and the state are written into the block's asset object
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
    if (event.type === 'serviceApiCallRequest') {
      if (typeof event.data.api !== 'string' || event.data.api === '') return { code: -1, message: 'serviceApiCallRequest needs api' };
      return this.apiCall(dashboard.serviceId, event.data.api, event.data.params);
    }
    if (event.type === 'serviceJobGetRequest') {
      return this.jobGet(dashboard.serviceId, String(event.data.jobId ?? ''));
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
