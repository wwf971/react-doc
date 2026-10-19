import { makeAutoObservable, observable, runInAction } from 'mobx';
import { SERVICE_CODE_BACKEND_DOWN, serviceBackendApiCreate } from '../lib/doc-service-api.js';
import { remoteModuleLoad } from '../lib/doc-service-federation.js';
import { dashboardDataTextBuild } from '../../../comp-doc/service/service-dashboard-data.js';

// The service instances of the page (design: doc_page_impl_service_instance.md).
// The services run in the service backend; this store knows what the
// backend last said about them, loads the dashboard modules of the types,
// tells a dashboard what keeps it from showing, and answers the events of
// the dashboards (eventHandle):
//
//   backendStatus     'none'     the page has no backend (no service.backend, or a build)
//                     'loading'  the first answer is awaited
//                     'up'       the backend answered the last request
//                     'down'     the development server answered that the backend cannot be reached
//   backendMessage    why it is down, as the server said
//   backendInfo       the backend's status (its folders, the problems of its scan)
//   typeList          the service types: { typeId, status, message, folder, expose, dashboardBuild }
//   instanceList      the instances: { serviceId, name, typeId, description, isEnabled, config,
//                     status, message, folder, dirName, queueLength, apiRunning }
//   moduleByTypeId    the dashboard module of each type: { status, module, message, entryUrl }
//   settings          the Services tab of the settings panel: the instance chosen,
//                     the creation of an instance, and the state of the config
//                     dashboards shown there (in memory: a tab is no document)
//
// a dashboard names what it shows by { typeId, dashboardId, serviceId }
// (a DashboardRef): the type and the dashboard by its component id, the
// instance by its data. dashboardProblemGet says why it cannot show, in
// the order a reader can fix it.

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

export type DashboardRef = { typeId: string; dashboardId: string; serviceId: string };

export type DashboardProblemKind =
  | 'backendNone'
  | 'loading'
  | 'backendDown'
  | 'typeNotFound'
  | 'typeError'
  | 'dashboardNotFound'
  | 'serviceNotBound'
  | 'serviceNotFound'
  | 'typeMismatch'
  | 'serviceNotReady'
  | 'moduleNotBuilt'
  | 'moduleError';

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
  typeList: any[] = [];
  instanceList: any[] = [];
  isRefreshing = false;
  moduleByTypeId: Record<string, ModuleState> = {};
  settings = {
    serviceIdSelected: '',
    stateByServiceId: {} as Record<string, any>,
    create: { status: 'idle' as 'idle' | 'submitting' | 'error', message: '' },
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
      moduleByTypeId: observable.shallow,
      typeList: observable.ref,
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

  // the status, the types and the instances, asked again. the backend scans
  // its folders on every listing, so an instance added by hand is seen here
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
      const [resultType, resultInstance] = await Promise.all([this.backend!.typeList(), this.backend!.instanceList()]);
      runInAction(() => {
        this.backendInfo = resultStatus.data;
        if (resultType.code !== 0 || resultInstance.code !== 0) {
          this.backendFailureAccept(resultType.code !== 0 ? resultType : resultInstance);
          return;
        }
        this.backendStatus = 'up';
        this.backendMessage = '';
        this.typeList = resultType.data;
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

  // ---------- types and instances ----------

  typeGet(typeId: string): any {
    return this.typeList.find((type) => type.typeId === typeId);
  }

  instanceGet(serviceId: string): any {
    return this.instanceList.find((instance) => instance.serviceId === serviceId);
  }

  instanceListOfType(typeId: string): any[] {
    return this.instanceList.filter((instance) => instance.typeId === typeId);
  }

  dashboardDefineGet(typeId: string, dashboardId: string): any {
    return this.typeGet(typeId)?.expose?.dashboardList?.find((dashboard: any) => dashboard.id === dashboardId);
  }

  // the dashboard of a purpose (default, config): every type has exactly one of each
  dashboardIdOfPurposeGet(typeId: string, purpose: 'default' | 'config'): string {
    return this.typeGet(typeId)?.expose?.dashboardList?.find((dashboard: any) => dashboard.purpose === purpose)?.id ?? '';
  }

  // every dashboard of the types that loaded, for the insert menu
  // (edit-template.js): [{ typeId, typeLabel, dashboardId, dashboardLabel, description }]
  get dashboardInsertList(): any[] {
    const list: any[] = [];
    for (const type of this.typeList) {
      if (type.status !== 'ready') continue;
      for (const dashboard of type.expose.dashboardList) {
        list.push({
          typeId: type.typeId,
          typeLabel: type.expose.meta.label,
          dashboardId: dashboard.id,
          dashboardLabel: dashboard.label,
          description: dashboard.description || type.expose.meta.description,
        });
      }
    }
    return list;
  }

  typeIconUrlGet(typeId: string): string {
    if (!this.backend || !this.typeGet(typeId)?.expose?.meta?.icon) return '';
    return this.backend.typeIconUrlGet(typeId);
  }

  async instanceCreate(input: { typeId: string; name: string; description?: string; config?: Record<string, any> }): Promise<ServiceResult> {
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    runInAction(() => {
      this.settings.create = { status: 'submitting', message: '' };
    });
    const result = await this.backend.instanceCreate({
      typeId: input.typeId,
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

  settingsServiceSelect(serviceId: string) {
    this.settings.serviceIdSelected = serviceId;
  }

  settingsStateSet(serviceId: string, state: any) {
    this.settings.stateByServiceId = { ...this.settings.stateByServiceId, [serviceId]: state };
  }

  // ---------- dashboard modules ----------

  moduleStateGet(typeId: string): ModuleState | undefined {
    return this.moduleByTypeId[typeId];
  }

  // loads the dashboard module of a type once per build of it (the entry
  // url carries the build time); nothing happens while it is not built
  async moduleLoad(typeId: string): Promise<void> {
    const type = this.typeGet(typeId);
    if (!this.backend || !type || type.status !== 'ready' || !type.dashboardBuild?.isBuilt) return;
    const remote = type.expose.dashboardRemote;
    const entryUrl = `${this.backend.dashboardEntryUrlGet(typeId, remote.entry)}?t=${type.dashboardBuild.timeBuilt}`;
    const stateCurrent = this.moduleByTypeId[typeId];
    if (stateCurrent?.entryUrl === entryUrl) return;
    this.moduleByTypeId[typeId] = { status: 'loading', message: '', entryUrl };
    const result = await remoteModuleLoad(entryUrl, remote.module);
    runInAction(() => {
      if (this.moduleByTypeId[typeId]?.entryUrl !== entryUrl) return;
      this.moduleByTypeId[typeId] = result.code === 0
        ? { status: 'done', module: result.data, message: '', entryUrl }
        : { status: 'error', message: result.message, entryUrl };
    });
  }

  // the component of a dashboard, once its module is loaded
  dashboardComponentGet(typeId: string, dashboardId: string): any {
    const exportName = this.dashboardDefineGet(typeId, dashboardId)?.export;
    const moduleState = this.moduleByTypeId[typeId];
    if (!exportName || moduleState?.status !== 'done') return undefined;
    return moduleState.module?.[exportName];
  }

  // why a dashboard cannot show its instance (null when it can), in the
  // order a reader can fix it: the backend, the type, the dashboard, the
  // instance chosen, the instance itself, the dashboard module
  dashboardProblemGet(ref: DashboardRef): DashboardProblem | null {
    const { typeId, dashboardId, serviceId } = ref;
    if (this.backendStatus === 'none') return { kind: 'backendNone', message: this.unavailableReason };
    if (this.backendStatus === 'loading') return { kind: 'loading', message: 'asking the service backend…' };
    if (this.backendStatus === 'down') return { kind: 'backendDown', message: this.unavailableReason };
    const type = this.typeGet(typeId);
    if (!type) return { kind: 'typeNotFound', message: `The service type ${typeId} is not found: the backend has no folder ${typeId} in its type folders.` };
    if (type.status !== 'ready') return { kind: 'typeError', message: `The service type ${typeId} failed to load: ${type.message}` };
    if (!this.dashboardDefineGet(typeId, dashboardId)) {
      const idList = (type.expose.dashboardList ?? []).map((dashboard: any) => dashboard.id).join(', ');
      return { kind: 'dashboardNotFound', message: `The service type ${typeId} has no dashboard ${dashboardId} (it has: ${idList}).` };
    }
    if (!serviceId) return { kind: 'serviceNotBound', message: 'Choose the instance this dashboard shows.' };
    const instance = this.instanceGet(serviceId);
    if (!instance) return { kind: 'serviceNotFound', message: `The service instance ${serviceId} is not found: its folder is gone, or it is in a folder the backend does not scan.` };
    if (instance.typeId !== typeId) {
      return { kind: 'typeMismatch', message: `The instance ${instance.name} is of the type ${instance.typeId}, not ${typeId}.` };
    }
    if (instance.status !== 'ready') {
      return { kind: 'serviceNotReady', message: `The instance ${instance.name} is ${instance.status}${instance.message ? `: ${instance.message}` : ''}` };
    }
    if (!type.dashboardBuild?.isBuilt) {
      return {
        kind: 'moduleNotBuilt',
        message: `The dashboards of ${typeId} are not built: build ${type.expose.dashboardRemote.dir} (vite build in the dashboard folder of the type).`,
      };
    }
    const moduleState = this.moduleByTypeId[typeId];
    if (!moduleState || moduleState.status === 'loading') return { kind: 'loading', message: 'loading the dashboard…' };
    if (moduleState.status === 'error') return { kind: 'moduleError', message: moduleState.message };
    if (!this.dashboardComponentGet(typeId, dashboardId)) {
      const exportName = this.dashboardDefineGet(typeId, dashboardId).export;
      return { kind: 'moduleError', message: `The dashboard module of ${typeId} has no export ${exportName}.` };
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
  // { typeId, dashboardId, serviceId, state }: what the block shows now. a
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
    if (!dashboard || typeof dashboard.typeId !== 'string') {
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
