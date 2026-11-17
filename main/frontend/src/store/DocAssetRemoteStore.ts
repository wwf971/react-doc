import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import {
  assetStorageCacheCreate, assetStorageCacheScopeBuild, base64ToBytes, bytesToBase64,
} from '../lib/doc-asset-storage-cache.js';
import { clientInstanceActorIsSelf, clientInstanceIdGet } from '../lib/doc-client-instance.js';
import {
  objectFrontendAssetAcceptCheck, objectFrontendAssetKeyFree, objectFrontendAssetNamingRead, objectFrontendAssetPathNormalize,
  objectFrontendIdOfRefGet, objectFrontendPartitionGroupPathBuild, objectFrontendRefBuild, OBJECT_FRONTEND_KEY_REGEX,
} from '../lib/doc-object-frontend.js';

// The storage points the page drives (design: doc_page_impl_asset_storage.md#points-of-the-page).
// A partition of a frontend object bound to a point of a remote type is not read by the
// development server: the page reaches its backend itself, over the network, so the same works
// on a statically hosted page. This store is the page's half of the asset storage layer:
//
//   page driver   the code of one remote type, brought by a package (asset-storage-type.yaml): how
//                 the item and partition api sets are asked of one backend. one per storage point
//   partition     the state of every partition bound to a point of the page: its index (the
//                 records of the object, the metadata of its items) as last read, from the cache
//                 or from the point, and whether the point can be asked now
//   cache         what was read, kept in the browser (doc-asset-storage-cache.js): shown at once,
//                 checked against the point by the revision of the partition
//   transfer      a whole partition moved between a local point and one of the page, or between
//                 two of the page, item by item with its history
//   notify        a point whose config turns notifications on (isNotifyEnabled) and whose backend
//                 offers them keeps a channel to the page: a change made elsewhere (another tab,
//                 device, program) is read at once. what this instance changed itself is known by
//                 the client instance of the actor and not read again (doc_page_impl_client_instance.md)
//
// The items of these partitions join the index of the asset store (DocAssetStore) with the rest,
// and their records join the item lists of their object (DocObjectFrontendStore), so nothing above
// the storage layer reads a partition differently for where it is held. The asset store reaches
// them through its routing backend (lib/doc-asset-backend.js assetBackendRouteCreate).
//
// what a page driver is (the function a storage type names creates one per point):
//
//   driverCreate({ point, credentialGet, clientInstanceIdGet })
//                                            point: the storage point as declared; credentialGet():
//                                            Promise<{ code, data: { token, tokenType }, message }> of the
//                                            session of the auth provider the point names;
//                                            clientInstanceIdGet(): the id this page names itself with
//                                            (a driver sends it to a backend that takes it)
//   every method answers Promise<{ code, data, message }> with the codes of the asset layer, and
//   -7 not signed in, -8 not allowed, -9 not reachable, -10 over a limit:
//
//   statusGet()                                the point and its backend: reachable, what it offers, its limits
//   accountGet()                               who the session is to the backend
//   partitionList()                            { partitionList: [{ partitionId, ownerRef, ownerTypeId, partition, revision, isDeleted, itemCount, size }] }
//   partitionGet({ partitionId, revisionKnown })   { partition, isSame } | { partition, isSame: false, recordList, itemList }
//   partitionCreate({ ownerRef, ownerTypeId, partition })   { partition, isCreated }
//   partitionRename({ partitionId, partition }) / partitionDelete({ partitionId, isPurged }) / partitionRestore({ partitionId })
//   itemGetList({ partitionId, requestList })  { answerList: [{ code, data: { item, version }, message }] }; a version is
//                                              { versionId, size, hash, isText, metadata, text | bytes }
//   itemCreate / itemUpdate / itemImport       take text | bytes; the driver decides how the bytes travel
//   itemMetaSet, itemMove, itemDelete, itemRestore, itemLockSet, itemRemove, versionCheckout, versionDelete,
//   versionLockSet, versionMetadataSet, dependencyListSet, dependencyAdd, dependencyRemove, groupMove,
//   recordSet, recordRemove                    each { partitionId, ... } -> what the write answers, with revision
//   notifyOpen({ onNotification, onStateChange })   optional (the api set notify): a channel kept open, opened
//                                              again by the driver when it closes -> { close() }
//                                              onNotification({ event, partitionId?, ownerRef?, partition?, revision?,
//                                                isDeleted?, itemIdList?, actor: { userId, clientInstanceId }, time })
//                                                event: partitionChanged | partitionCreated | partitionRemoved |
//                                                pointChanged (something the page cannot name: read every partition)
//                                              onStateChange({ status: connecting | open | waiting | unsupported |
//                                                refused | closed, message, timeOpened })
//
// an item of a point carries groupPath as its place INSIDE its partition; the page shows it at
// {partition}/{groupPath}, as the folders of a local partition read.

export type RemoteResult = { code: number; data?: any; message: string };

export const REMOTE_CODE_AUTH_REQUIRED = -7;
export const REMOTE_CODE_FORBIDDEN = -8;
export const REMOTE_CODE_UNREACHABLE = -9;

export type RemotePartitionStatus = 'idle' | 'loading' | 'ready' | 'absent' | 'authRequired' | 'forbidden' | 'unreachable' | 'error';

export type RemotePartition = {
  // {ownerRef}#{partition}
  key: string;
  ownerRef: string;
  ownerTypeId: string;
  partition: string;
  pointId: string;
  typeId: string;
  docPageAlias: string;
  status: RemotePartitionStatus;
  message: string;
  // what is shown was read from the cache and the point has not confirmed it since the page started
  isFromCache: boolean;
  isRefreshing: boolean;
  // when the point last answered for it (ms; 0 never in this page)
  timeChecked: number;
  // when what is shown was fetched from the point (ms)
  timeFetched: number;
  partitionId: string;
  revision: number;
  // as the point answered: the records of the object, the metadata of the items
  recordList: any[];
  itemList: any[];
  // the last change another instance made, as its point told it (notify): when, by whom, which items
  changeElsewhere?: { timeReceived: number; time: string; actor: { userId: string; clientInstanceId: string }; itemIdList: string[]; revision: number };
};

export type RemotePoint = {
  pointId: string;
  status: 'idle' | 'checking' | 'ready' | 'unreachable' | 'error';
  message: string;
  // what the backend says of itself (statusGet), and who the session is to it (accountGet)
  service: any;
  account: any;
  timeChecked: number;
};

// what a point told the page, one line each: what changed, who changed it, and what the page did
//   handling   self: this instance changed it (its answer brought it) · known: the page held that revision
//              · read: read again · notHeld: a partition no object of the page reads
export type RemoteNotifyLogEntry = {
  timeReceived: number;
  time: string;
  event: string;
  partitionKey: string;
  partition: string;
  partitionId: string;
  revision: number;
  itemIdList: string[];
  actor: { userId: string; clientInstanceId: string };
  isSelf: boolean;
  handling: 'self' | 'known' | 'read' | 'notHeld';
};

// the channel of a point that tells the page of changes (the api set notify)
export type RemoteNotify = {
  pointId: string;
  // off: not asked for, or not wanted now (nobody signed in, no partition held)
  status: 'off' | 'connecting' | 'open' | 'waiting' | 'unsupported' | 'refused' | 'closed' | 'error';
  message: string;
  timeOpened: number;
  countOpened: number;
  countReceived: number;
  logList: RemoteNotifyLogEntry[];
};

export type RemoteTransfer = {
  status: 'idle' | 'running' | 'done' | 'error';
  title: string;
  text: string;
  countDone: number;
  countTotal: number;
  message: string;
};

type Stores = { assetStore: any; authStore: any; objectFrontendStore?: any };

const STORE_ID_LOCAL = 'local';
const REQUEST_CHUNK_SIZE = 40;
// the bytes of a binary version larger than this are read when asked and handed over, never kept
// in the memory of the page or the cache of the browser: a download of a large file is not held
const VERSION_KEEP_SIZE_MAX = 8 * 1024 * 1024;
// how often a purge is asked again before the page gives up: one request removes what its time allows
const PURGE_ROUND_MAX = 40;
// notifications: the lines a point keeps of what it told; a burst of changes of one partition read
// once; the time after which the page checks that its own change came back (an answer lost)
const NOTIFY_LOG_MAX = 40;
const NOTIFY_READ_DELAY_MS = 150;
const NOTIFY_SELF_CHECK_MS = 4000;

const partitionKeyBuild = (ownerRef: string, partition: string) => `${ownerRef}#${partition}`;
const versionKeyBuild = (itemId: string, versionId: string) => `${itemId}|${versionId}`;
const fail = (code: number, message: string): RemoteResult => ({ code, message });

export class DocAssetRemoteStore {
  stores: Stores;
  driverCreateByTypeId = new Map<string, (input: any) => any>();
  driverByPointId = new Map<string, { configText: string; driver: any }>();
  pointById = observable.map<string, RemotePoint>({}, { deep: false });
  partitionByKey = observable.map<string, RemotePartition>({}, { deep: false });
  // the urls of the bytes of binary versions read so far, by item and version
  dataUrlByKey = observable.map<string, string>({}, { deep: false });
  transfer: RemoteTransfer = { status: 'idle', title: '', text: '', countDone: 0, countTotal: 0, message: '' };
  // what the browser keeps of each point for the person signed in, as last counted
  cacheInfoByPointId = observable.map<string, any>({}, { deep: false });
  cache = assetStorageCacheCreate();
  // the data of versions read in this page, by item and version
  versionMemoryByKey = new Map<string, any>();
  loadPromiseByKey = new Map<string, Promise<void>>();
  // a partition asked again while its read was in flight: read once more after it
  loadAgainByKey = new Map<string, { isForced: boolean }>();
  disposeList: (() => void)[] = [];
  timerByPointId = new Map<string, ReturnType<typeof setInterval>>();
  // the channel of each point that tells the page of changes, as it stands (observed), and the
  // channel itself with the person it was opened for
  notifyByPointId = observable.map<string, RemoteNotify>({}, { deep: false });
  notifyChannelByPointId = new Map<string, { channel: any; scope: string; driver: any }>();
  notifyTimerByKey = new Map<string, ReturnType<typeof setTimeout>>();
  notifyTiming = { readDelayMs: NOTIFY_READ_DELAY_MS, selfCheckMs: NOTIFY_SELF_CHECK_MS };

  //   cache          the cache to keep what is read in (a test hands in its own; default: the browser's)
  //   notifyTiming   { readDelayMs, selfCheckMs } of notifications (a test makes them short)
  constructor(stores: Stores, options: { driverList?: { typeId: string; driverCreate: (input: any) => any }[]; cache?: ReturnType<typeof assetStorageCacheCreate>; notifyTiming?: { readDelayMs?: number; selfCheckMs?: number } } = {}) {
    this.stores = stores;
    if (options.cache) this.cache = options.cache;
    this.notifyTiming = { readDelayMs: NOTIFY_READ_DELAY_MS, selfCheckMs: NOTIFY_SELF_CHECK_MS, ...(options.notifyTiming ?? {}) };
    for (const one of options.driverList ?? []) {
      if (one?.typeId && typeof one.driverCreate === 'function') this.driverCreateByTypeId.set(one.typeId, one.driverCreate);
    }
    makeAutoObservable(this, {
      stores: false,
      driverCreateByTypeId: false,
      driverByPointId: false,
      cache: false,
      versionMemoryByKey: false,
      loadPromiseByKey: false,
      loadAgainByKey: false,
      disposeList: false,
      timerByPointId: false,
      notifyChannelByPointId: false,
      notifyTimerByKey: false,
      notifyTiming: false,
    });
  }

  // ---------- start ----------

  init() {
    // the binds of the declarations, the providers and their sessions decide what is read: a
    // partition newly bound, a person signing in or out
    this.disposeList.push(reaction(
      () => JSON.stringify(this.bindList.map((bind) => [bind.key, bind.pointId, this.pointAuthStateGet(bind.pointId, bind.docPageAlias)])),
      () => void this.sync(),
      { fireImmediately: true },
    ));
    this.disposeList.push(this.stores.authStore?.sessionEndListen?.((providerRef: string) => void this.sessionEnded(providerRef)) ?? (() => {}));
    const focusHandle = () => {
      for (const partition of this.partitionByKey.values()) {
        const point = this.pointGet(partition.pointId, partition.docPageAlias);
        if (point?.config?.isRefreshedOnFocus === true) void this.partitionLoad(partition.key, { isForced: true });
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', focusHandle);
      this.disposeList.push(() => window.removeEventListener('focus', focusHandle));
    }
  }

  dispose() {
    for (const dispose of this.disposeList) dispose();
    this.disposeList = [];
    for (const timer of this.timerByPointId.values()) clearInterval(timer);
    this.timerByPointId.clear();
    for (const held of this.notifyChannelByPointId.values()) held.channel?.close?.();
    this.notifyChannelByPointId.clear();
    for (const timer of this.notifyTimerByKey.values()) clearTimeout(timer);
    this.notifyTimerByKey.clear();
    for (const url of this.dataUrlByKey.values()) URL.revokeObjectURL(url);
  }

  // ---------- the points ----------

  pointGet(pointId: string, docPageAlias = ''): any | undefined {
    return this.stores.assetStore.storagePointGet?.(pointId, docPageAlias);
  }

  // the storage points of the page whose driver runs here
  get pointList(): any[] {
    return (this.stores.assetStore.storage?.pointList ?? []).filter((point: any) => point.driverPlace === 'page');
  }

  pointStateGet(pointId: string): RemotePoint {
    return this.pointById.get(pointId) ?? { pointId, status: 'idle', message: '', service: undefined, account: undefined, timeChecked: 0 };
  }

  // the auth provider a point names, and the session of it
  providerRefOfPointGet(point: any): string {
    return String(point?.auth?.provider ?? '');
  }

  // what of the auth of a point decides whether it can be asked: the provider, and who is signed in
  private pointAuthStateGet(pointId: string, docPageAlias: string): string {
    const point = this.pointGet(pointId, docPageAlias);
    const ref = this.providerRefOfPointGet(point);
    const { authStore } = this.stores;
    if (!ref || !authStore) return 'none';
    const provider = authStore.providerGet(ref);
    if (provider.status !== 'ready') return provider.status;
    const session = authStore.sessionGet(ref);
    // the roles are part of it: an account given a role is another caller to a point. so is the time
    // of the sign-in (not of a refresh): the same person signing in again may be served where the
    // session before was refused (an account that must use MFA, signing in with its code)
    return `${session.status}:${session.identity?.subject ?? ''}:${(session.identity?.roleList ?? []).join(',')}:${session.timeSignedIn ?? 0}`;
  }

  // why the point cannot be asked now ('' when it can): its declaration, its driver, its auth
  // provider, the session
  pointUnavailableReasonGet(point: any): { code: number; message: string } {
    if (!point) return { code: -6, message: 'the storage point is not declared' };
    if (point.status !== 'ready') return { code: -6, message: `the storage point ${point.id} cannot be used: ${point.statusMessage}` };
    if (!this.driverCreateByTypeId.has(point.typeId)) return { code: -6, message: `the page has no driver of the storage type ${point.typeId}: the package bringing it is not part of this page` };
    const { authStore } = this.stores;
    const ref = this.providerRefOfPointGet(point);
    if (!ref) return { code: -6, message: `the storage point ${point.id} names no auth provider (auth: { provider: frontend:{id} })` };
    if (!authStore) return { code: -6, message: 'the page has no auth layer' };
    const provider = authStore.providerGet(ref);
    if (provider.status === 'loading') return { code: REMOTE_CODE_AUTH_REQUIRED, message: `the auth provider ${ref} is being read` };
    if (provider.status !== 'ready') return { code: -6, message: `the auth provider ${ref} of the storage point ${point.id}: ${provider.message || provider.status}` };
    const session = authStore.sessionGet(ref);
    if (session.status !== 'signedIn') return { code: REMOTE_CODE_AUTH_REQUIRED, message: `sign in to ${provider.name || ref} to reach the storage point ${point.label || point.id}` };
    return { code: 0, message: '' };
  }

  private consumerOfPointGet(point: any) {
    return { kind: 'storagePoint', id: point.id, label: point.label || point.id };
  }

  private driverGet(point: any): any | undefined {
    const driverCreate = this.driverCreateByTypeId.get(point?.typeId);
    if (!driverCreate) return undefined;
    const configText = JSON.stringify([point.config ?? {}, point.auth ?? {}]);
    const held = this.driverByPointId.get(point.id);
    if (held && held.configText === configText) return held.driver;
    const { authStore } = this.stores;
    const providerRef = this.providerRefOfPointGet(point);
    const driver = driverCreate({
      point,
      credentialGet: () => (authStore
        ? authStore.credentialGet(providerRef, { consumer: this.consumerOfPointGet(point) })
        : Promise.resolve(fail(REMOTE_CODE_AUTH_REQUIRED, 'the page has no auth layer'))),
      clientInstanceIdGet,
    });
    this.driverByPointId.set(point.id, { configText, driver });
    return driver;
  }

  // one call of the driver of a point; a driver that throws is a point that cannot be reached
  private async driverCall(point: any, method: string, args: Record<string, any> = {}): Promise<RemoteResult> {
    const reason = this.pointUnavailableReasonGet(point);
    // statusGet asks nothing of the session: it is how a point is checked before anyone signs in
    if (reason.code !== 0 && !(method === 'statusGet' && reason.code === REMOTE_CODE_AUTH_REQUIRED)) return reason;
    const driver = this.driverGet(point);
    if (!driver || typeof driver[method] !== 'function') return fail(-6, `the driver of the storage type ${point.typeId} has no ${method}`);
    try {
      let result = await driver[method](args);
      // refused: the credential says what the account was when it was made (its roles), so one
      // made now may be taken. asked again once when the session says something else afterwards
      if (result?.code === REMOTE_CODE_FORBIDDEN && await this.credentialIsRenewed(point)) result = await driver[method](args);
      if (!result || typeof result.code !== 'number') return fail(-1, `the driver of ${point.id} answered ${method} without a result`);
      return result;
    } catch (error: any) {
      return fail(REMOTE_CODE_UNREACHABLE, `the storage point ${point.label || point.id} cannot be reached: ${String(error?.message ?? error)}`);
    }
  }

  // a credential of now for a point that refused the one in hand: true when the session says
  // something else of the account afterwards (a role given since it signed in)
  private async credentialIsRenewed(point: any): Promise<boolean> {
    const { authStore } = this.stores;
    const ref = this.providerRefOfPointGet(point);
    if (!authStore || !ref) return false;
    const roleTextGet = () => (authStore.sessionGet(ref).identity?.roleList ?? []).join(',');
    const roleTextBefore = roleTextGet();
    const fresh = await authStore.credentialGet(ref, { consumer: this.consumerOfPointGet(point), isFresh: true });
    return fresh.code === 0 && roleTextGet() !== roleTextBefore;
  }

  // the partition of an identity at a point, made when the point has none. one the point holds
  // marked deleted is answered too (isCreated false) and refuses every write, so it is brought
  // back first
  private async partitionEnsureAtPoint(point: any, identity: { ownerRef: string; ownerTypeId: string; partition: string }): Promise<RemoteResult> {
    const created = await this.driverCall(point, 'partitionCreate', { ...identity, timeZone: this.timeZoneGet() });
    if (created.code !== 0 || !created.data?.partition?.isDeleted) return created;
    const restored = await this.driverCall(point, 'partitionRestore', { partitionId: created.data.partition.partitionId, timeZone: this.timeZoneGet() });
    if (restored.code !== 0) return fail(restored.code, `the storage point ${point.id} holds the partition ${identity.partition} marked deleted, and it was not brought back: ${restored.message}`);
    return { code: 0, message: '', data: { ...created.data, partition: restored.data?.partition ?? { ...created.data.partition, isDeleted: false } } };
  }

  // a partition removed for good at a point. much data is more than one request removes: the
  // answer then still carries the partition, and the same request is sent again
  private async partitionPurgeAtPoint(point: any, partitionId: string): Promise<RemoteResult> {
    for (let round = 0; round < PURGE_ROUND_MAX; round++) {
      const result = await this.driverCall(point, 'partitionDelete', { partitionId, isPurged: true, timeZone: this.timeZoneGet() });
      if (result.code !== 0 || !result.data?.partition) return result;
    }
    return fail(-1, `the partition is not removed yet after ${PURGE_ROUND_MAX} requests: ask again`);
  }

  // one call of the driver of a point, for what is its type's own: the panel a storage type brings
  // asks its backend things this layer does not know (its spaces, its account)
  pointCall(pointId: string, method: string, args: Record<string, any> = {}, docPageAlias = ''): Promise<RemoteResult> {
    return this.driverCall(this.pointGet(pointId, docPageAlias), method, args);
  }

  // the point asked what it is and who the session is to it: what the Asset service tab shows
  async pointCheck(pointId: string, docPageAlias = ''): Promise<void> {
    const point = this.pointGet(pointId, docPageAlias);
    if (!point) return;
    runInAction(() => this.pointById.set(pointId, { ...this.pointStateGet(pointId), status: 'checking', message: '' }));
    const status = await this.driverCall(point, 'statusGet');
    let account: any;
    let message = status.code === 0 ? '' : status.message;
    if (status.code === 0 && this.pointUnavailableReasonGet(point).code === 0) {
      const accountResult = await this.driverCall(point, 'accountGet');
      if (accountResult.code === 0) account = accountResult.data;
      else message = accountResult.message;
    }
    runInAction(() => this.pointById.set(pointId, {
      pointId,
      status: status.code === 0 ? 'ready' : status.code === REMOTE_CODE_UNREACHABLE ? 'unreachable' : 'error',
      message,
      service: status.code === 0 ? status.data : undefined,
      account,
      timeChecked: Date.now(),
    }));
    const userId = account?.userId;
    if (userId) this.stores.authStore?.identitySet?.(this.providerRefOfPointGet(point), { userId, ...(account.name ? { name: account.name } : {}) });
  }

  // ---------- the partitions bound to a point of the page ----------

  // what the declarations bind to a point of the page: [{ key, ownerRef, ownerTypeId, partition, pointId, typeId, docPageAlias }]
  get bindList(): any[] {
    const list: any[] = [];
    for (const docPage of this.stores.objectFrontendStore?.docPageList ?? []) {
      for (const decl of docPage.objectList ?? []) {
        for (const bind of decl.partitionStorageList ?? []) {
          if (bind.driverPlace !== 'page' || bind.unavailableReason) continue;
          const ownerRef = objectFrontendRefBuild(decl.id);
          list.push({
            key: partitionKeyBuild(ownerRef, bind.partition), ownerRef, ownerTypeId: bind.owner?.typeId ?? '', partition: bind.partition,
            pointId: bind.pointId, typeId: bind.typeId, docPageAlias: decl.docPageAlias,
          });
        }
      }
    }
    return list;
  }

  partitionGet(ownerRef: string, partition: string): RemotePartition | undefined {
    return this.partitionByKey.get(partitionKeyBuild(ownerRef, partition));
  }

  // the partition holding an item of a point of the page; undefined for an item held elsewhere
  partitionOfItemGet(itemId: string): RemotePartition | undefined {
    for (const partition of this.partitionByKey.values()) {
      if (partition.itemList.some((item) => item.itemId === itemId)) return partition;
    }
    return undefined;
  }

  itemIs(itemId: string): boolean {
    return this.partitionOfItemGet(itemId) !== undefined;
  }

  // an item that says a point of the page holds it, and no partition of the page does any more:
  // what a late answer brings after its partition left the page
  itemIsGone(item: any): boolean {
    const pointId = item?.storage?.pointId;
    if (!pointId || !this.pointList.some((point: any) => point.id === pointId)) return false;
    return !this.itemIs(item.itemId);
  }

  // why a partition cannot be written now ('' when it can)
  partitionWriteUnavailableReasonGet(ownerRef: string, partition: string): string {
    const state = this.partitionGet(ownerRef, partition);
    if (!state) return `the partition ${partition} is not bound to a storage point of the page`;
    const reason = this.pointUnavailableReasonGet(this.pointGet(state.pointId, state.docPageAlias));
    if (reason.code !== 0) return reason.message;
    if (state.status === 'ready' && state.isFromCache && state.message) return state.message;
    if (state.status === 'ready' || state.status === 'absent') return '';
    return state.message || `the partition ${partition} is being read`;
  }

  // the item lists the object of a reference has at points of the page: one per partition read
  listListOfGet(ownerRef: string): { groupPath: string; assetList: any[]; problemList: string[] }[] {
    const list: { groupPath: string; assetList: any[]; problemList: string[] }[] = [];
    for (const partition of this.partitionByKey.values()) {
      if (partition.ownerRef !== ownerRef || partition.status !== 'ready') continue;
      list.push({ groupPath: partition.partition, assetList: partition.recordList, problemList: [] });
    }
    return list;
  }

  // every item of every partition read, as the asset store names items
  get itemList(): any[] {
    const list: any[] = [];
    for (const partition of this.partitionByKey.values()) {
      if (partition.status !== 'ready') continue;
      for (const item of partition.itemList) list.push(this.itemDecorate(partition, item));
    }
    return list;
  }

  // an item of a point as the page names it: at {partition}/{groupPath} of the folder of its
  // object, held by the point
  private itemDecorate(partition: RemotePartition, item: any): any {
    const groupPath = [partition.partition, String(item.groupPath ?? '')].filter(Boolean).join('/');
    const folder = (this.stores.assetStore.folderList ?? []).find((one: any) => one.owner?.ref === partition.ownerRef);
    return {
      ...item,
      name: '',
      groupPath,
      dirName: `${groupPath}/${item.itemId}`,
      folder: folder?.path ?? '',
      folderOwner: { ref: partition.ownerRef },
      storage: { pointId: partition.pointId, typeId: partition.typeId },
    };
  }

  // the binds as they are now: a partition newly bound is read, one no longer bound leaves
  private async sync(): Promise<void> {
    const bindList = this.bindList;
    const keySet = new Set(bindList.map((bind) => bind.key));
    runInAction(() => {
      for (const key of [...this.partitionByKey.keys()]) {
        if (keySet.has(key)) continue;
        this.itemListForget(this.partitionByKey.get(key)!);
        this.partitionByKey.delete(key);
      }
      for (const bind of bindList) {
        const held = this.partitionByKey.get(bind.key);
        if (held && held.pointId === bind.pointId) continue;
        if (held) this.itemListForget(held);
        this.partitionByKey.set(bind.key, {
          ...bind, status: 'idle', message: '', isFromCache: false, isRefreshing: false, timeChecked: 0, timeFetched: 0,
          partitionId: '', revision: 0, recordList: [], itemList: [],
        });
      }
    });
    this.timerSync();
    this.notifySync();
    await Promise.all(bindList.map((bind) => this.partitionLoad(bind.key)));
  }

  // a point asked again by itself every refreshIntervalSec, while it holds a partition
  private timerSync() {
    const pointIdSet = new Set([...this.partitionByKey.values()].map((partition) => partition.pointId));
    for (const [pointId, timer] of [...this.timerByPointId.entries()]) {
      if (pointIdSet.has(pointId)) continue;
      clearInterval(timer);
      this.timerByPointId.delete(pointId);
    }
    for (const pointId of pointIdSet) {
      if (this.timerByPointId.has(pointId)) continue;
      const intervalSec = Number(this.pointGet(pointId)?.config?.refreshIntervalSec ?? 0);
      if (!(intervalSec > 0)) continue;
      this.timerByPointId.set(pointId, setInterval(() => void this.pointRefresh(pointId), Math.max(intervalSec, 10) * 1000));
    }
  }

  // ---------- the api set notify: a point telling the page of changes ----------
  // (doc_page_impl_asset_storage.md#being-told-of-changes)

  notifyStateGet(pointId: string): RemoteNotify {
    return this.notifyByPointId.get(pointId) ?? { pointId, status: 'off', message: '', timeOpened: 0, countOpened: 0, countReceived: 0, logList: [] };
  }

  // the id this page names itself with to the points, and that a notification of its own change carries
  get clientInstanceId(): string {
    return clientInstanceIdGet();
  }

  // what a point told of one partition: the state of its channel, and the lines about that partition
  partitionNotifyGet(ownerRef: string, partition: string): (RemoteNotify & { clientInstanceId: string }) | undefined {
    const state = this.partitionGet(ownerRef, partition);
    const point = state ? this.pointGet(state.pointId, state.docPageAlias) : undefined;
    if (!state || point?.config?.isNotifyEnabled !== true) return undefined;
    const notify = this.notifyStateGet(state.pointId);
    return { ...notify, clientInstanceId: clientInstanceIdGet(), logList: notify.logList.filter((one) => one.partitionKey === state.key) };
  }

  private notifyPatch(pointId: string, patch: Partial<RemoteNotify>) {
    runInAction(() => this.notifyByPointId.set(pointId, { ...this.notifyStateGet(pointId), ...patch }));
  }

  // the channels as the points, the binds and the sessions are now: a point whose config asks for
  // notifications keeps one while it holds a partition of the page and somebody is signed in to it;
  // another person signed in is another channel (a ticket is of one account)
  private notifySync() {
    const pointIdHeldSet = new Set([...this.partitionByKey.values()].map((partition) => partition.pointId));
    const pointList = this.pointList;
    for (const point of pointList) {
      const isAsked = point?.config?.isNotifyEnabled === true;
      const reason = isAsked ? this.pointUnavailableReasonGet(point) : { code: -6, message: '' };
      const isWanted = isAsked && reason.code === 0 && pointIdHeldSet.has(point.id);
      const driver = isWanted ? this.driverGet(point) : undefined;
      const scope = isWanted ? this.cacheScopeGet(point) : '';
      const held = this.notifyChannelByPointId.get(point.id);
      if (held && (!isWanted || held.scope !== scope || held.driver !== driver)) {
        this.notifyChannelByPointId.delete(point.id);
        held.channel?.close?.();
      }
      if (!isAsked) {
        if (this.notifyByPointId.has(point.id)) runInAction(() => this.notifyByPointId.delete(point.id));
        continue;
      }
      if (!isWanted) {
        this.notifyPatch(point.id, {
          status: 'off',
          message: reason.code !== 0 ? reason.message : 'no partition of the page is held by this point',
        });
        continue;
      }
      if (this.notifyChannelByPointId.has(point.id)) continue;
      if (typeof driver?.notifyOpen !== 'function') {
        this.notifyPatch(point.id, { status: 'unsupported', message: `the storage type ${point.typeId} tells nothing: its driver has no channel` });
        continue;
      }
      const entry: { channel: any; scope: string; driver: any } = { channel: undefined, scope, driver };
      this.notifyChannelByPointId.set(point.id, entry);
      const isCurrent = () => this.notifyChannelByPointId.get(point.id) === entry;
      try {
        entry.channel = driver.notifyOpen({
          onNotification: (notification: any) => { if (isCurrent()) this.notifyAccept(point.id, notification); },
          onStateChange: (state: any) => { if (isCurrent()) this.notifyStateAccept(point.id, state); },
        });
      } catch (error: any) {
        this.notifyChannelByPointId.delete(point.id);
        this.notifyPatch(point.id, { status: 'error', message: String(error?.message ?? error) });
      }
    }
    for (const [pointId, held] of [...this.notifyChannelByPointId.entries()]) {
      if (pointList.some((point: any) => point.id === pointId)) continue;
      this.notifyChannelByPointId.delete(pointId);
      held.channel?.close?.();
      runInAction(() => this.notifyByPointId.delete(pointId));
    }
  }

  // the channel opened, closed, waiting to open again. each time it opens, what was read before
  // is asked again: what changed while it was closed was told to nobody (one small request while
  // a partition did not change)
  private notifyStateAccept(pointId: string, state: any) {
    const before = this.notifyStateGet(pointId);
    const status = String(state?.status ?? 'error') as RemoteNotify['status'];
    const isOpenedNow = status === 'open' && before.status !== 'open';
    const timeOpened = isOpenedNow ? Number(state?.timeOpened) || Date.now() : before.timeOpened;
    this.notifyPatch(pointId, { status, message: String(state?.message ?? ''), timeOpened, countOpened: before.countOpened + (isOpenedNow ? 1 : 0) });
    if (!isOpenedNow) return;
    for (const partition of this.partitionByKey.values()) {
      if (partition.pointId !== pointId || partition.timeChecked >= timeOpened) continue;
      if (this.cacheModeGet(this.pointGet(partition.pointId, partition.docPageAlias)) === 'pinned') continue;
      void this.partitionLoad(partition.key, { isForced: true });
    }
  }

  // one notification of a point: the partition it names read again, unless this instance made
  // the change (its answer brought it) or the page holds that revision already
  private notifyAccept(pointId: string, notification: any) {
    const event = String(notification?.event ?? '');
    const actor = { userId: String(notification?.actor?.userId ?? ''), clientInstanceId: String(notification?.actor?.clientInstanceId ?? '') };
    const isSelf = clientInstanceActorIsSelf(actor);
    const revision = Number(notification?.revision);
    const partitionList = [...this.partitionByKey.values()].filter((one) => one.pointId === pointId);
    let target = notification?.partitionId ? partitionList.find((one) => one.partitionId === notification.partitionId) : undefined;
    // a partition the page holds as absent has no id yet: found by its identity
    if (!target && notification?.ownerRef && notification?.partition) {
      target = partitionList.find((one) => one.ownerRef === notification.ownerRef && one.partition === notification.partition && !one.partitionId);
    }
    let handling: RemoteNotifyLogEntry['handling'];
    if (event === 'pointChanged') {
      handling = 'read';
      for (const one of partitionList) this.notifyReadSchedule(one.key);
    } else if (!target) {
      handling = 'notHeld';
    } else if (event === 'partitionRemoved') {
      handling = 'read';
      this.notifyReadSchedule(target.key);
    } else if (target.status === 'ready' && Number.isFinite(revision) && revision <= target.revision) {
      handling = 'known';
    } else if (isSelf) {
      handling = 'self';
      this.notifySelfCheckSchedule(target.key, revision);
    } else {
      handling = 'read';
      this.notifyReadSchedule(target.key);
    }
    const itemIdList = Array.isArray(notification?.itemIdList) ? notification.itemIdList.map(String) : [];
    const time = String(notification?.time ?? '');
    const timeReceived = Date.now();
    if (target && handling === 'read' && !isSelf) {
      this.partitionPatch(target.key, { changeElsewhere: { timeReceived, time, actor, itemIdList, revision: Number.isFinite(revision) ? revision : 0 } });
    }
    const before = this.notifyStateGet(pointId);
    const entry: RemoteNotifyLogEntry = {
      timeReceived, time, event, actor, isSelf, handling, itemIdList,
      partitionKey: target?.key ?? '', partition: target?.partition ?? String(notification?.partition ?? ''),
      partitionId: String(notification?.partitionId ?? ''), revision: Number.isFinite(revision) ? revision : 0,
    };
    this.notifyPatch(pointId, { countReceived: before.countReceived + 1, logList: [entry, ...before.logList].slice(0, NOTIFY_LOG_MAX) });
  }

  // a partition read again a moment after a notification: a burst of changes is one read
  private notifyReadSchedule(key: string) {
    if (this.notifyTimerByKey.has(key)) return;
    this.notifyTimerByKey.set(key, setTimeout(() => {
      this.notifyTimerByKey.delete(key);
      void this.partitionLoad(key, { isForced: true });
    }, this.notifyTiming.readDelayMs));
  }

  // a change this instance made: its answer brings it. should the answer have been lost on the
  // way, the page does not hold the revision told a moment later, and reads it
  private notifySelfCheckSchedule(key: string, revision: number) {
    const timerKey = `self:${key}`;
    const timerBefore = this.notifyTimerByKey.get(timerKey);
    if (timerBefore) clearTimeout(timerBefore);
    this.notifyTimerByKey.set(timerKey, setTimeout(() => {
      this.notifyTimerByKey.delete(timerKey);
      const state = this.partitionByKey.get(key);
      if (!state || this.loadPromiseByKey.has(key)) return;
      if (state.status !== 'ready' || (Number.isFinite(revision) && state.revision < revision)) void this.partitionLoad(key, { isForced: true });
    }, this.notifyTiming.selfCheckMs));
  }

  private cacheScopeGet(point: any): string {
    const session = this.stores.authStore?.sessionGet?.(this.providerRefOfPointGet(point));
    return assetStorageCacheScopeBuild({
      pointId: point.id, url: point.config?.url, space: point.config?.space || point.id, subject: session?.identity?.subject ?? '',
    });
  }

  private cacheModeGet(point: any): 'readThrough' | 'pinned' | 'none' {
    const mode = point?.config?.cacheMode;
    return mode === 'pinned' || mode === 'none' ? mode : 'readThrough';
  }

  // the index of one partition read: from the cache at once, then from the point by its revision
  //   isForced   the point is asked whatever the cache mode says (a refresh)
  partitionLoad(key: string, options: { isForced?: boolean } = {}): Promise<void> {
    const pending = this.loadPromiseByKey.get(key);
    if (pending) {
      // asked again while a read is in flight (somebody signed in or out meanwhile, a refresh):
      // what that read brings may be of the state before, so the partition is read once more after it
      this.loadAgainByKey.set(key, { isForced: Boolean(this.loadAgainByKey.get(key)?.isForced || options.isForced) });
      return pending;
    }
    const promise = (async () => {
      let optionsOfRun = options;
      for (;;) {
        await this.partitionLoadRun(key, optionsOfRun);
        const again = this.loadAgainByKey.get(key);
        if (!again) break;
        this.loadAgainByKey.delete(key);
        optionsOfRun = again;
      }
    })().finally(() => this.loadPromiseByKey.delete(key));
    this.loadPromiseByKey.set(key, promise);
    return promise;
  }

  // the point can still be asked as the person a read started for: what a read brings after
  // somebody signed out, or another person signed in, is not theirs to see
  private scopeIs(point: any, scope: string): boolean {
    return this.pointUnavailableReasonGet(point).code === 0 && this.cacheScopeGet(point) === scope;
  }

  private async partitionLoadRun(key: string, options: { isForced?: boolean }): Promise<void> {
    const state = this.partitionByKey.get(key);
    if (!state) return;
    const point = this.pointGet(state.pointId, state.docPageAlias);
    const reason = this.pointUnavailableReasonGet(point);
    if (reason.code !== 0) {
      // nothing of a partition is shown to nobody: what was read for a person leaves with them
      this.partitionPatch(key, {
        status: reason.code === REMOTE_CODE_AUTH_REQUIRED ? 'authRequired' : 'error', message: reason.message,
        recordList: [], itemList: [], partitionId: '', revision: 0, isFromCache: false, isRefreshing: false,
      }, { isItemListChanged: true });
      return;
    }
    const scope = this.cacheScopeGet(point);
    const cacheMode = this.cacheModeGet(point);
    const hasIndex = state.status === 'ready';
    // an index in hand is asked again only by a refresh: by a person, the focus, the timer of its point
    if (hasIndex && !options.isForced) return;
    this.partitionPatch(key, hasIndex ? { isRefreshing: true } : { status: 'loading', message: '' });
    let cached: any;
    if (!hasIndex && cacheMode !== 'none') {
      cached = await this.cache.indexGet(scope, state.ownerRef, state.partition);
      if (!this.scopeIs(point, scope)) return;
      if (cached?.partition) {
        this.partitionPatch(key, {
          status: 'ready', isFromCache: true, isRefreshing: true, message: '', partitionId: cached.partition.partitionId, revision: cached.partition.revision,
          recordList: cached.recordList ?? [], itemList: cached.itemList ?? [], timeFetched: cached.timeFetched ?? 0,
        }, { isItemListChanged: true });
        // pinned: the cache is trusted until somebody refreshes
        if (cacheMode === 'pinned' && !options.isForced) {
          this.partitionPatch(key, { isRefreshing: false });
          return;
        }
      }
    }
    const current = this.partitionByKey.get(key)!;
    let partitionId = current.partitionId;
    let result: RemoteResult | undefined;
    if (partitionId) {
      result = await this.driverCall(point, 'partitionGet', { partitionId, revisionKnown: current.status === 'ready' ? current.revision : undefined });
      // the partition the cache knew is gone from the point (deleted, made again): found again by its identity
      if (result.code === -3) partitionId = '';
    }
    if (!partitionId) {
      const listResult = await this.driverCall(point, 'partitionList');
      if (!this.scopeIs(point, scope)) return;
      if (listResult.code !== 0) {
        this.partitionFailure(key, listResult);
        return;
      }
      const found = (listResult.data?.partitionList ?? []).find((one: any) => one.ownerRef === current.ownerRef && one.partition === current.partition && !one.isDeleted);
      if (!found) {
        this.partitionPatch(key, {
          status: 'absent', message: `the storage point ${point.label || point.id} holds no partition ${current.partition} of ${current.ownerRef} yet: the first write makes it`,
          recordList: [], itemList: [], partitionId: '', revision: 0, isFromCache: false, isRefreshing: false, timeChecked: Date.now(),
        }, { isItemListChanged: true });
        void this.cache.indexRemove(scope, current.ownerRef, current.partition);
        return;
      }
      partitionId = found.partitionId;
      result = await this.driverCall(point, 'partitionGet', { partitionId });
    }
    if (!this.scopeIs(point, scope)) return;
    if (!result || result.code !== 0) {
      this.partitionFailure(key, result ?? fail(-1, 'the partition was not read'));
      return;
    }
    const timeNow = Date.now();
    if (result.data?.isSame === true) {
      this.partitionPatch(key, { status: 'ready', message: '', isFromCache: false, isRefreshing: false, timeChecked: timeNow });
      return;
    }
    const index = { partition: result.data.partition, recordList: result.data.recordList ?? [], itemList: result.data.itemList ?? [], timeFetched: timeNow };
    this.partitionPatch(key, {
      status: 'ready', message: '', isFromCache: false, isRefreshing: false, timeChecked: timeNow, timeFetched: timeNow,
      partitionId: index.partition.partitionId, revision: index.partition.revision, recordList: index.recordList, itemList: index.itemList,
    }, { isItemListChanged: true });
    if (cacheMode !== 'none') void this.cache.indexSet(scope, current.ownerRef, current.partition, index);
  }

  // the point did not answer the index: what the cache gave stays shown when the point is only
  // out of reach, marked; anything else takes the partition off the page
  private partitionFailure(key: string, result: RemoteResult) {
    const state = this.partitionByKey.get(key);
    if (!state) return;
    if (result.code === REMOTE_CODE_UNREACHABLE && state.status === 'ready') {
      this.partitionPatch(key, { isRefreshing: false, isFromCache: true, message: `shown from the cache: ${result.message}` });
      return;
    }
    const status: RemotePartitionStatus = result.code === REMOTE_CODE_AUTH_REQUIRED ? 'authRequired'
      : result.code === REMOTE_CODE_FORBIDDEN ? 'forbidden'
        : result.code === REMOTE_CODE_UNREACHABLE ? 'unreachable' : 'error';
    this.partitionPatch(key, {
      status, message: result.message, recordList: [], itemList: [], partitionId: '', revision: 0, isFromCache: false, isRefreshing: false,
    }, { isItemListChanged: true });
  }

  // a change of the state of a partition; with isItemListChanged, the asset store and the object
  // registry are told what the partition holds now
  private partitionPatch(key: string, patch: Partial<RemotePartition>, options: { isItemListChanged?: boolean } = {}) {
    const state = this.partitionByKey.get(key);
    if (!state) return;
    const itemIdBeforeList = state.itemList.map((item) => item.itemId);
    const next = { ...state, ...patch };
    runInAction(() => {
      this.partitionByKey.set(key, next);
      if (!options.isItemListChanged) return;
      const { assetStore } = this.stores;
      const itemIdSet = new Set(next.itemList.map((item) => item.itemId));
      assetStore.itemListAccept?.(STORE_ID_LOCAL, next.status === 'ready' ? next.itemList.map((item) => this.itemDecorate(next, item)) : []);
      assetStore.itemListForget?.(STORE_ID_LOCAL, itemIdBeforeList.filter((itemId) => !itemIdSet.has(itemId) || next.status !== 'ready'));
    });
    if (options.isItemListChanged) this.stores.objectFrontendStore?.stores?.objectStore?.changed?.('frontend');
  }

  private itemListForget(partition: RemotePartition) {
    this.stores.assetStore.itemListForget?.(STORE_ID_LOCAL, partition.itemList.map((item) => item.itemId));
  }

  // ---------- the cache api set ----------

  // every partition of a point asked again
  async pointRefresh(pointId: string): Promise<void> {
    await Promise.all([...this.partitionByKey.values()].filter((one) => one.pointId === pointId).map((one) => this.partitionLoad(one.key, { isForced: true })));
  }

  partitionRefresh(ownerRef: string, partition: string): Promise<void> {
    return this.partitionLoad(partitionKeyBuild(ownerRef, partition), { isForced: true });
  }

  // what the browser keeps of a point for the person signed in: { partitionCount, itemCount, versionCount, size, timeFetchedLast, place }
  async cacheInfoGet(pointId: string, docPageAlias = ''): Promise<any> {
    const point = this.pointGet(pointId, docPageAlias);
    if (!point) return undefined;
    return { ...(await this.cache.infoGet(this.cacheScopeGet(point))), place: this.cache.place, mode: this.cacheModeGet(point) };
  }

  // the same, kept as state for whoever shows it
  async cacheInfoLoad(pointId: string, docPageAlias = ''): Promise<void> {
    const info = await this.cacheInfoGet(pointId, docPageAlias);
    runInAction(() => this.cacheInfoByPointId.set(pointId, info));
  }

  // the copy of a point dropped, of everyone who was signed in on this browser, and read again
  async cacheClear(pointId: string): Promise<void> {
    await this.cache.clear(pointId);
    for (const partition of this.partitionByKey.values()) {
      if (partition.pointId !== pointId) continue;
      for (const item of partition.itemList) for (const version of item.versionList ?? []) this.versionMemoryByKey.delete(versionKeyBuild(item.itemId, version.versionId));
    }
    await this.pointRefresh(pointId);
    await this.cacheInfoLoad(pointId);
  }

  // a session ended: the copies of the points signed by that provider go with the person
  private async sessionEnded(providerRef: string): Promise<void> {
    for (const point of this.pointList) {
      if (this.providerRefOfPointGet(point) !== providerRef) continue;
      await this.cache.clear(point.id);
      runInAction(() => this.pointById.delete(point.id));
    }
    this.versionMemoryByKey.clear();
    runInAction(() => {
      for (const url of this.dataUrlByKey.values()) URL.revokeObjectURL(url);
      this.dataUrlByKey.clear();
    });
  }

  // ---------- reading versions ----------

  // many versions read together, each answered like the asset api answers one:
  // { code, data: { item, version: { versionId, size, hash, isText, text?, metadata } }, message }.
  // a version the cache holds for the revision of its item is not asked again
  async versionListGet(requestList: { itemId: string; versionId: string }[]): Promise<RemoteResult[]> {
    const answerList: RemoteResult[] = new Array(requestList.length);
    const askByKey = new Map<string, { partition: RemotePartition; indexList: number[]; requestList: { itemId: string; versionId: string }[] }>();
    for (let index = 0; index < requestList.length; index++) {
      const request = requestList[index];
      const partition = this.partitionOfItemGet(request.itemId);
      const item = partition?.itemList.find((one) => one.itemId === request.itemId);
      if (!partition || !item) {
        answerList[index] = fail(-3, `asset item not found: ${request.itemId}`);
        continue;
      }
      const versionId = !request.versionId || request.versionId === 'head' ? item.versionIdHead : request.versionId;
      const versionMeta = (item.versionList ?? []).find((one: any) => one.versionId === versionId);
      if (!versionMeta) {
        answerList[index] = fail(-3, `version ${versionId} not found in item ${request.itemId}`);
        continue;
      }
      const cached = await this.versionCachedGet(partition, item, versionMeta);
      if (cached) {
        answerList[index] = { code: 0, data: { item: this.itemDecorate(partition, item), version: this.versionForPage(versionId, cached) }, message: '' };
        continue;
      }
      const ask = askByKey.get(partition.key) ?? { partition, indexList: [], requestList: [] };
      ask.indexList.push(index);
      ask.requestList.push({ itemId: request.itemId, versionId });
      askByKey.set(partition.key, ask);
    }
    for (const ask of askByKey.values()) {
      const point = this.pointGet(ask.partition.pointId, ask.partition.docPageAlias);
      for (let offset = 0; offset < ask.requestList.length; offset += REQUEST_CHUNK_SIZE) {
        const chunk = ask.requestList.slice(offset, offset + REQUEST_CHUNK_SIZE);
        const result = await this.driverCall(point, 'itemGetList', { partitionId: ask.partition.partitionId, requestList: chunk });
        chunk.forEach((request, position) => {
          const index = ask.indexList[offset + position];
          const answer = result.code === 0 ? result.data?.answerList?.[position] : undefined;
          if (!answer || answer.code !== 0) {
            answerList[index] = answer ?? result;
            return;
          }
          const partitionNow = this.partitionByKey.get(ask.partition.key) ?? ask.partition;
          this.versionCacheSet(partitionNow, answer.data.item, answer.data.version);
          answerList[index] = { code: 0, data: { item: this.itemDecorate(partitionNow, answer.data.item), version: this.versionForPage(request.versionId, answer.data.version) }, message: '' };
        });
      }
    }
    // a read that was in flight when its partition left the page (somebody signed out) answers
    // nothing: the item is not put back by a late answer
    requestList.forEach((request, index) => {
      if (answerList[index]?.code === 0 && !this.itemIs(request.itemId)) answerList[index] = fail(-3, `asset item not found: ${request.itemId}`);
    });
    return answerList;
  }

  // what the asset store keeps of a version: its text when it is text; the bytes stay here
  private versionForPage(versionId: string, version: any): any {
    const result: any = { versionId, size: version.size, hash: version.hash, isText: version.isText === true, metadata: version.metadata ?? {} };
    if (result.isText) result.text = version.text ?? '';
    return result;
  }

  // the data of a version the page read before, for the item as it is now
  private async versionCachedGet(partition: RemotePartition, item: any, versionMeta: any): Promise<any | undefined> {
    const key = versionKeyBuild(item.itemId, versionMeta.versionId);
    const isValid = (one: any) => one && one.hash === versionMeta.hash && one.itemRevision === item.revision;
    const memory = this.versionMemoryByKey.get(key);
    if (isValid(memory)) return memory;
    const point = this.pointGet(partition.pointId, partition.docPageAlias);
    if (this.cacheModeGet(point) === 'none') return undefined;
    const kept = await this.cache.versionGet(this.cacheScopeGet(point), item.itemId, versionMeta.versionId);
    if (!isValid(kept)) return undefined;
    this.versionMemoryByKey.set(key, kept);
    return kept;
  }

  // what a point answered of a version, kept for the revision of its item. an answer without the
  // data (a write that did not touch it, such as the metadata of a version) keeps the data the
  // page has for that hash; with none in hand, nothing is kept and the version is read when asked
  private versionCacheSet(partition: RemotePartition, item: any, version: any) {
    if (!item || !version?.versionId) return;
    const key = versionKeyBuild(item.itemId, version.versionId);
    const entry: any = {
      hash: version.hash, itemRevision: item.revision, isText: version.isText === true, metadata: version.metadata ?? {}, size: version.size ?? 0, timeFetched: Date.now(),
    };
    const held = this.versionMemoryByKey.get(key);
    if (!entry.isText && Number(version.size ?? version.bytes?.length ?? 0) > VERSION_KEEP_SIZE_MAX) {
      this.versionMemoryByKey.delete(key);
      return;
    }
    if (entry.isText && typeof version.text === 'string') entry.text = version.text;
    else if (!entry.isText && version.bytes) entry.bytes = version.bytes;
    else if (held && held.hash === version.hash && (held.isText ? typeof held.text === 'string' : held.bytes)) {
      entry.text = held.text;
      entry.bytes = held.bytes;
    } else {
      this.versionMemoryByKey.delete(key);
      return;
    }
    this.versionMemoryByKey.set(key, entry);
    // a url made for the bytes before is of other bytes now
    const urlBefore = this.dataUrlByKey.get(key);
    if (urlBefore) {
      URL.revokeObjectURL(urlBefore);
      runInAction(() => this.dataUrlByKey.delete(key));
    }
    const point = this.pointGet(partition.pointId, partition.docPageAlias);
    if (this.cacheModeGet(point) !== 'none') void this.cache.versionSet(this.cacheScopeGet(point), item.itemId, version.versionId, entry);
  }

  // a version of a write's answer as the asset store takes it: with its data, from the answer or
  // from what the page holds for that hash; undefined when the page has no data for it (the asset
  // store then reads the version when it is asked for, instead of taking an empty one)
  private versionOfAnswerGet(itemId: string, version: any): any | undefined {
    if (!version?.versionId) return undefined;
    const held = this.versionMemoryByKey.get(versionKeyBuild(itemId, version.versionId));
    if (!held || held.hash !== version.hash) return undefined;
    return this.versionForPage(version.versionId, { ...version, isText: held.isText, text: held.text });
  }

  // the bytes of a version, for a download: { code, data: { bytes, contentType, fileExt, size } }.
  // a small one is read as versionListGet reads it (the cache first) and kept; a large binary one
  // is asked of the point and handed over without being kept (VERSION_KEEP_SIZE_MAX)
  async versionBytesGet(itemId: string, versionIdRequested = 'head'): Promise<RemoteResult> {
    const partition = this.partitionOfItemGet(itemId);
    const item = partition?.itemList.find((one) => one.itemId === itemId);
    if (!partition || !item) return fail(-3, `asset item not found: ${itemId}`);
    const versionId = !versionIdRequested || versionIdRequested === 'head' ? item.versionIdHead : versionIdRequested;
    const versionMeta = (item.versionList ?? []).find((one: any) => one.versionId === versionId);
    if (!versionMeta) return fail(-3, `version ${versionId} not found in item ${itemId}`);
    const answerOf = (bytes: Uint8Array): RemoteResult => ({ code: 0, message: '', data: { bytes, contentType: item.contentType ?? '', fileExt: item.fileExt ?? '', size: bytes.length } });
    if (Number(versionMeta.size ?? 0) > VERSION_KEEP_SIZE_MAX) {
      const point = this.pointGet(partition.pointId, partition.docPageAlias);
      const result = await this.driverCall(point, 'itemGetList', { partitionId: partition.partitionId, requestList: [{ itemId, versionId }] });
      const answer = result.code === 0 ? result.data?.answerList?.[0] : result;
      if (!answer || answer.code !== 0) return answer ?? fail(-1, `the version ${versionId} of ${itemId} was not read`);
      const version = answer.data?.version ?? {};
      return answerOf(version.bytes ?? new TextEncoder().encode(String(version.text ?? '')));
    }
    const [answer] = await this.versionListGet([{ itemId, versionId }]);
    if (answer.code !== 0) return answer;
    const entry = this.versionMemoryByKey.get(versionKeyBuild(itemId, versionId));
    if (!entry) return fail(-1, `the bytes of version ${versionId} of ${itemId} were not kept`);
    return answerOf(entry.bytes ?? new TextEncoder().encode(entry.text ?? ''));
  }

  // the url of the bytes of a binary version: '' until they are read, which this asks for
  dataUrlGet(itemId: string, versionIdRequested: string): string {
    const partition = this.partitionOfItemGet(itemId);
    const item = partition?.itemList.find((one) => one.itemId === itemId);
    if (!partition || !item) return '';
    const versionId = !versionIdRequested || versionIdRequested === 'head' ? item.versionIdHead : versionIdRequested;
    const key = versionKeyBuild(itemId, versionId);
    const url = this.dataUrlByKey.get(key);
    if (url) return url;
    const entry = this.versionMemoryByKey.get(key);
    if (entry?.bytes || entry?.isText) {
      queueMicrotask(() => this.dataUrlBuild(key, item, entry));
      return '';
    }
    void this.versionListGet([{ itemId, versionId }]).then(() => {
      const loaded = this.versionMemoryByKey.get(key);
      if (loaded) this.dataUrlBuild(key, item, loaded);
    });
    return '';
  }

  private dataUrlBuild(key: string, item: any, entry: any) {
    if (this.dataUrlByKey.has(key)) return;
    const bytes = entry.bytes ?? new TextEncoder().encode(entry.text ?? '');
    const url = URL.createObjectURL(new Blob([bytes], { type: item.contentType || 'application/octet-stream' }));
    runInAction(() => this.dataUrlByKey.set(key, url));
  }

  // ---------- writing items ----------

  private timeZoneGet(): string {
    const offsetHour = Math.round(-new Date().getTimezoneOffset() / 60);
    return `${offsetHour >= 0 ? '+' : '-'}${String(Math.abs(offsetHour)).padStart(2, '0')}`;
  }

  // one call about a partition of a point: the partition named by its id there
  private async partitionCall(partition: RemotePartition, method: string, args: Record<string, any> = {}): Promise<RemoteResult> {
    const point = this.pointGet(partition.pointId, partition.docPageAlias);
    if (!partition.partitionId) return fail(-3, `the storage point holds no partition ${partition.partition} of ${partition.ownerRef}`);
    return this.driverCall(point, method, { partitionId: partition.partitionId, timeZone: this.timeZoneGet(), ...args });
  }

  // what a write answered taken into the index of its partition, the cache, and the asset store
  //   data    { item?, itemList?, version?, record?, partition?, revision }
  //   change  what the write removed: { itemIdRemoved?, recordKeyRemoved? }
  private writeAccept(key: string, data: any, change: { itemIdRemoved?: string; recordKeyRemoved?: string } = {}) {
    const state = this.partitionByKey.get(key);
    // the partition left the page while the write was on its way (somebody signed out): the
    // write happened at the point, and nothing of it is shown
    if (!state || (state.status !== 'ready' && state.status !== 'absent')) return;
    const isInOrder = typeof data?.revision !== 'number' || data.revision === state.revision + 1 || state.status === 'absent';
    let itemList = state.itemList;
    const itemUpsert = (item: any) => {
      itemList = itemList.some((one) => one.itemId === item.itemId) ? itemList.map((one) => (one.itemId === item.itemId ? item : one)) : [...itemList, item];
    };
    if (data?.item) itemUpsert(data.item);
    for (const item of data?.itemList ?? []) itemUpsert(item);
    if (change.itemIdRemoved) itemList = itemList.filter((one) => one.itemId !== change.itemIdRemoved);
    let recordList = state.recordList;
    if (data?.record) {
      recordList = recordList.some((one) => one.key === data.record.key) ? recordList.map((one) => (one.key === data.record.key ? data.record : one)) : [...recordList, data.record];
    }
    if (change.recordKeyRemoved) recordList = recordList.filter((one) => one.key !== change.recordKeyRemoved);
    if (change.itemIdRemoved) recordList = recordList.filter((one) => one.itemId !== change.itemIdRemoved);
    const revision = typeof data?.revision === 'number' ? data.revision : state.revision;
    const partitionMeta = data?.partition ?? {};
    const timeNow = Date.now();
    this.partitionPatch(key, {
      status: 'ready', message: '', itemList, recordList, revision, timeChecked: timeNow, timeFetched: timeNow,
      partitionId: partitionMeta.partitionId ?? state.partitionId, isFromCache: false,
    }, { isItemListChanged: true });
    const next = this.partitionByKey.get(key)!;
    if (data?.item && data?.version) this.versionCacheSet(next, data.item, data.version);
    const point = this.pointGet(next.pointId, next.docPageAlias);
    if (point && this.cacheModeGet(point) !== 'none') {
      void this.cache.indexSet(this.cacheScopeGet(point), next.ownerRef, next.partition, {
        partition: { partitionId: next.partitionId, ownerRef: next.ownerRef, ownerTypeId: next.ownerTypeId, partition: next.partition, revision },
        recordList, itemList, timeFetched: timeNow,
      });
    }
    // somebody else wrote between what the page knew and this write: the whole index is read again
    if (!isInOrder) void this.partitionLoad(key, { isForced: true });
  }

  // a write of one item of a point, answered as the asset api answers it: { item, version? }
  async itemCall(itemId: string, method: string, args: Record<string, any> = {}): Promise<RemoteResult> {
    const partition = this.partitionOfItemGet(itemId);
    if (!partition) return fail(-3, `asset item not found: ${itemId}`);
    const reason = this.partitionWriteUnavailableReasonGet(partition.ownerRef, partition.partition);
    if (reason) return fail(-1, reason);
    const result = await this.partitionCall(partition, method, { itemId, ...args });
    if (result.code !== 0) return result;
    this.writeAccept(partition.key, result.data);
    const partitionNow = this.partitionByKey.get(partition.key) ?? partition;
    const data: any = { ...result.data };
    if (data.item) data.item = this.itemDecorate(partitionNow, data.item);
    if (data.version) {
      const version = this.versionOfAnswerGet(itemId, data.version);
      if (version) data.version = version;
      else delete data.version;
    }
    return { code: 0, data, message: '' };
  }

  // ---------- the structural writes of a frontend object ----------
  // (doc_page_impl_obj_frontend.md#the-layer-the-page-and-the-development-server) the writes that
  // concern a partition a point of the page holds are done here, against the point; undefined
  // means the write is the development server's

  // the point of the page a partition of an object is held by, or would be made at:
  //   { point, state?, isBound }   isBound false: not made yet, and its type declares a point of the page for it
  private partitionTargetGet(id: string, partition: string): { point: any; state?: RemotePartition; isBound: boolean; docPageAlias: string } | undefined {
    const { objectFrontendStore } = this.stores;
    const decl = objectFrontendStore?.declGet(id);
    if (!decl || !partition) return undefined;
    const ownerRef = objectFrontendRefBuild(id);
    const bind = (decl.partitionStorageList ?? []).find((one: any) => one.partition === partition);
    if (bind) {
      if (bind.driverPlace !== 'page') return undefined;
      return { point: this.pointGet(bind.pointId, decl.docPageAlias), state: this.partitionGet(ownerRef, partition), isBound: true, docPageAlias: decl.docPageAlias };
    }
    const objectState = objectFrontendStore.objectGet(id);
    const partitionOfObject = (objectState.partitionList ?? []).find((one: any) => one.id === partition);
    if (!partitionOfObject || partitionOfObject.isPresent || !partitionOfObject.storagePoint) return undefined;
    const point = this.pointGet(partitionOfObject.storagePoint, decl.docPageAlias);
    return point?.driverPlace === 'page' ? { point, isBound: false, docPageAlias: decl.docPageAlias } : undefined;
  }

  // the partition of an object bound to its point on the development server (its partition.yaml)
  // and made at the point; answers its state, ready for a write
  //   answers { code, message, data: { state } }
  private async partitionEnsure(id: string, partition: string, target: { point: any; state?: RemotePartition; isBound: boolean }): Promise<RemoteResult> {
    const { assetStore, objectFrontendStore } = this.stores;
    const ownerRef = objectFrontendRefBuild(id);
    const reason = this.pointUnavailableReasonGet(target.point);
    if (reason.code !== 0) return reason;
    if (!target.isBound) {
      const base = await assetStore.backendBase.objectFrontendWrite('partition/create', { id, partition, storagePoint: target.point.id });
      if (base.code !== 0) return base;
      if (base.data?.config) objectFrontendStore.configAcceptFromWrite?.(base.data.config);
      await this.sync();
    }
    const key = partitionKeyBuild(ownerRef, partition);
    await this.loadPromiseByKey.get(key);
    let state = this.partitionByKey.get(key);
    if (!state) return fail(-1, `the partition ${partition} of ${ownerRef} is not bound to the storage point ${target.point.id}`);
    if (state.status === 'absent') {
      const objectState = objectFrontendStore.objectGet(id);
      const created = await this.partitionEnsureAtPoint(target.point, { ownerRef, ownerTypeId: objectState.typeId, partition });
      if (created.code !== 0) return created;
      this.partitionPatch(key, {
        status: 'ready', message: '', partitionId: created.data.partition.partitionId, revision: created.data.partition.revision ?? 0,
        recordList: [], itemList: [], isFromCache: false, timeChecked: Date.now(),
      });
      // a partition the point had already (isCreated false) has an index to read
      if (created.data.isCreated === false) await this.partitionLoad(key, { isForced: true });
      state = this.partitionByKey.get(key)!;
    }
    if (state.status !== 'ready') return fail(state.status === 'authRequired' ? REMOTE_CODE_AUTH_REQUIRED : -1, state.message || `the partition ${partition} is not read yet`);
    return { code: 0, message: '', data: { state } };
  }

  // a structural write of a frontend object: Promise of its answer ({ id, itemList, ... } as the
  // development server answers), or undefined when the write is not about a point of the page
  objectFrontendWrite(route: string, body: Record<string, any>): Promise<RemoteResult> | undefined {
    const { objectFrontendStore } = this.stores;
    if (!objectFrontendStore) return undefined;
    const id = String(body?.id ?? '');
    const objectState = id ? objectFrontendStore.objectGet(id) : undefined;
    if (!objectState || objectState.status !== 'found') return undefined;
    const assetOf = (key: string, itemId?: string) => objectState.assetList.find((one: any) => (key ? one.key === key : one.itemId === itemId));
    const partitionOfAsset = (asset: any) => (asset?.item ? this.partitionOfItemGet(asset.itemId) : undefined);
    switch (route) {
      case 'asset/create': return this.assetCreate(id, objectState, body);
      case 'asset/remove': {
        const asset = assetOf(String(body.key ?? ''), body.itemId);
        const partition = asset ? partitionOfAsset(asset) : this.partitionOfItemGet(String(body.itemId ?? ''));
        return partition ? this.assetRemove(id, partition, asset, body) : undefined;
      }
      case 'asset/meta/set': {
        const asset = assetOf(String(body.key ?? ''));
        const partition = partitionOfAsset(asset);
        return partition ? this.assetMetaSet(id, objectState, partition, asset, body) : undefined;
      }
      case 'asset/move': {
        const asset = assetOf(String(body.key ?? ''));
        const partition = partitionOfAsset(asset);
        const partitionTo = String(body.groupPath ?? '').split('/')[0];
        const targetTo = this.partitionTargetGet(id, partitionTo);
        if (!partition && !targetTo) return undefined;
        if (!partition || partition.partition !== partitionTo) {
          return Promise.resolve(fail(-1, `an asset moves between a partition held by a storage point of the page and another only with its whole partition (Storage… of the partition): ${asset?.key ?? body.key}`));
        }
        return this.itemCall(asset.itemId, 'itemMove', { groupPath: String(body.groupPath ?? '').split('/').slice(1).join('/') })
          .then((result) => (result.code === 0 ? this.writeResultBuild(id, [result.data.item]) : result));
      }
      case 'asset/group/move': {
        const from = String(body.groupFrom ?? '');
        const to = String(body.groupTo ?? '');
        const target = this.partitionTargetGet(id, from.split('/')[0]);
        const targetTo = this.partitionTargetGet(id, to.split('/')[0]);
        if (!target && !targetTo) return undefined;
        if (!target?.state || from.split('/')[0] !== to.split('/')[0] || !from.includes('/') || !to.includes('/')) {
          return Promise.resolve(fail(-1, 'a folder moves inside one partition of a storage point of the page; a whole partition is renamed, or its storage changed'));
        }
        return this.partitionCall(target.state, 'groupMove', { groupPathFrom: from.split('/').slice(1).join('/'), groupPathTo: to.split('/').slice(1).join('/') }).then((result) => {
          if (result.code !== 0) return result;
          this.writeAccept(target.state!.key, result.data);
          const stateNow = this.partitionByKey.get(target.state!.key)!;
          return this.writeResultBuild(id, (result.data.itemList ?? []).map((item: any) => this.itemDecorate(stateNow, item)));
        });
      }
      case 'asset/attach': {
        const partition = this.partitionOfItemGet(String(body.itemId ?? ''));
        const target = body.partition ? this.partitionTargetGet(id, String(body.partition)) : undefined;
        if (!partition && !target) return undefined;
        if (!partition || partition.ownerRef !== objectState.ref) {
          return Promise.resolve(fail(-1, 'an item comes into a partition held by a storage point of the page with its whole partition, or is made there: it is not attached from elsewhere'));
        }
        return this.assetAttach(id, objectState, partition, body);
      }
      case 'partition/create': {
        const partition = String(body.partition ?? '');
        const { assetStore } = this.stores;
        const decl = objectFrontendStore.declGet(id);
        const pointNamed = body.storagePoint ? assetStore.storagePointGet?.(String(body.storagePoint), decl?.docPageAlias ?? '') : undefined;
        const target = pointNamed?.driverPlace === 'page' ? { point: pointNamed, isBound: false, docPageAlias: decl.docPageAlias } : (!body.storagePoint ? this.partitionTargetGet(id, partition) : undefined);
        if (!target || target.isBound) return undefined;
        return this.partitionEnsure(id, partition, target).then((result) => (result.code === 0 ? this.writeResultBuild(id, this.itemListOfPartitionGet(result.data.state)) : result));
      }
      case 'partition/rename': {
        const target = this.partitionTargetGet(id, String(body.partitionFrom ?? ''));
        if (!target?.isBound) return undefined;
        return this.partitionRename(id, target, String(body.partitionFrom), String(body.partitionTo ?? ''));
      }
      case 'partition/delete': {
        const target = this.partitionTargetGet(id, String(body.partition ?? ''));
        if (!target?.isBound) return undefined;
        return this.partitionDelete(id, target, String(body.partition));
      }
      case 'partition/storage/set': {
        const partition = String(body.partition ?? '');
        const { assetStore } = this.stores;
        const decl = objectFrontendStore.declGet(id);
        const pointTo = assetStore.storagePointGet?.(String(body.storagePoint ?? ''), decl?.docPageAlias ?? '');
        const targetFrom = this.partitionTargetGet(id, partition);
        if (!targetFrom?.isBound && pointTo?.driverPlace !== 'page') return undefined;
        return this.partitionStorageSet(id, objectState, partition, pointTo, { isSourceKept: body.isSourceKept === true });
      }
      default: return undefined;
    }
  }

  private writeResultBuild(id: string, itemList: any[], extra: Record<string, any> = {}): RemoteResult {
    return { code: 0, data: { id, itemList, ...extra }, message: '' };
  }

  private itemListOfPartitionGet(partition: RemotePartition): any[] {
    const stateNow = this.partitionByKey.get(partition.key) ?? partition;
    return stateNow.itemList.map((item) => this.itemDecorate(stateNow, item));
  }

  // a new asset of an object in a partition a point of the page holds (or would hold): checked
  // as the development server checks one, then the item and its record made together at the point
  private assetCreate(id: string, objectState: any, body: Record<string, any>): Promise<RemoteResult> | undefined {
    const { objectFrontendStore } = this.stores;
    const lang = String(body.lang ?? 'yaml');
    const pathListNormalized = Array.isArray(body.pathList) ? body.pathList.map((one: any) => objectFrontendAssetPathNormalize(one).path) : [];
    // what is written fits the kind: the text of data against its schema, bytes against their form
    const isBytes = body.bytes instanceof Uint8Array;
    const accept = objectFrontendAssetAcceptCheck(objectFrontendStore.kindListGet(objectState.ref), {
      kind: body.kind, lang, pathList: pathListNormalized,
      ...(isBytes ? { contentType: body.contentType, fileExt: body.fileExt, size: body.bytes.length } : { text: String(body.text ?? '') }),
    });
    const place = objectFrontendPartitionGroupPathBuild(objectFrontendStore.partitionListOfTypeGet(objectState.typeId), body.partition, body.groupPath ?? accept.kindDeclared?.groupPath);
    if (place.message) return undefined;
    const partition = place.groupPath.split('/')[0];
    const target = this.partitionTargetGet(id, partition);
    if (!target) return undefined;
    if (accept.message) return Promise.resolve(fail(-1, accept.message));
    if (body.key !== undefined && body.key !== '' && !OBJECT_FRONTEND_KEY_REGEX.test(String(body.key))) return Promise.resolve(fail(-1, 'a key is letters, digits, "_", "-" and "."'));
    const key = objectFrontendAssetKeyFree({ assetList: objectState.assetList }, body.key ?? '', accept.kind);
    if (!key) return Promise.resolve(fail(-1, `the object has an asset of the key ${body.key} already`));
    const { naming, message } = objectFrontendAssetNamingRead(objectState.assetList, '', body);
    if (message) return Promise.resolve(fail(-1, message));
    return (async () => {
      const ensured = await this.partitionEnsure(id, partition, target);
      if (ensured.code !== 0) return ensured;
      const state: RemotePartition = ensured.data.state;
      // the data: a text, or bytes (a file) with their media type and extension; the driver decides
      // how they travel, the point where they are kept (storagePreference)
      const bytes = body.bytes instanceof Uint8Array ? body.bytes : typeof body.dataBase64 === 'string' ? base64ToBytes(body.dataBase64) : undefined;
      const result = await this.partitionCall(state, 'itemCreate', {
        lang, ...(bytes ? { bytes } : { text: String(body.text ?? '') }),
        contentType: body.contentType || undefined, fileExt: body.fileExt || undefined,
        versionMetadata: body.versionMetadata, storagePreference: body.storagePreference || undefined,
        note: body.note ?? `${accept.kind || 'an asset'} of the frontend object ${objectState.name || id}`,
        saveMode: body.saveMode, groupPath: place.groupPath.split('/').slice(1).join('/'), owner: { ref: objectState.ref },
        record: { key, kind: accept.kind, ...naming },
      });
      if (result.code !== 0) return result;
      this.writeAccept(state.key, result.data);
      const stateNow = this.partitionByKey.get(state.key)!;
      return this.writeResultBuild(id, [this.itemDecorate(stateNow, result.data.item)], { key, itemId: result.data.item.itemId });
    })();
  }

  // an asset taken out of an object: off the records of its partition and deleted softly
  private async assetRemove(id: string, partition: RemotePartition, asset: any, body: Record<string, any>): Promise<RemoteResult> {
    if (body.isAssetKept === true) return fail(-1, 'an asset of a partition held by a storage point of the page is deleted, not released: it has no place in a folder of the store');
    const itemId = asset?.itemId ?? String(body.itemId ?? '');
    const reason = this.partitionWriteUnavailableReasonGet(partition.ownerRef, partition.partition);
    if (reason) return fail(-1, reason);
    const result = await this.partitionCall(partition, 'itemDelete', { itemId, isRecordRemoved: true });
    if (result.code !== 0) return result;
    this.writeAccept(partition.key, result.data, { recordKeyRemoved: asset?.key });
    const stateNow = this.partitionByKey.get(partition.key)!;
    return this.writeResultBuild(id, result.data.item ? [this.itemDecorate(stateNow, result.data.item)] : []);
  }

  // how an asset is named and indexed, written into its record at the point
  private async assetMetaSet(id: string, objectState: any, partition: RemotePartition, asset: any, body: Record<string, any>): Promise<RemoteResult> {
    const { objectFrontendStore } = this.stores;
    const reason = this.partitionWriteUnavailableReasonGet(partition.ownerRef, partition.partition);
    if (reason) return fail(-1, reason);
    const change: Record<string, any> = { key: asset.key };
    if (body.kind !== undefined) {
      const accept = objectFrontendAssetAcceptCheck(objectFrontendStore.kindListGet(objectState.ref), { kind: body.kind, lang: asset.item?.lang, pathList: body.pathList ?? asset.pathList ?? [] });
      if (accept.message) return fail(-1, accept.message);
      change.kind = accept.kind;
    }
    const { naming, message } = objectFrontendAssetNamingRead(objectState.assetList, asset.key, { name: body.name === undefined ? asset.name : body.name ?? '', pathList: body.pathList === undefined ? asset.pathList : body.pathList });
    if (message) return fail(-1, message);
    if (body.name !== undefined) change.name = naming.name ?? null;
    if (body.pathList !== undefined) change.pathList = naming.pathList ?? [];
    const result = await this.partitionCall(partition, 'recordSet', change);
    if (result.code !== 0) return result;
    this.writeAccept(partition.key, result.data);
    return this.writeResultBuild(id, []);
  }

  // an item of the partition the records lost (a stray), recorded again
  private async assetAttach(id: string, objectState: any, partition: RemotePartition, body: Record<string, any>): Promise<RemoteResult> {
    const { objectFrontendStore } = this.stores;
    const item = partition.itemList.find((one) => one.itemId === body.itemId);
    if (objectState.assetList.some((one: any) => one.itemId === body.itemId)) return fail(-1, 'the item is an asset of the object already');
    const accept = objectFrontendAssetAcceptCheck(objectFrontendStore.kindListGet(objectState.ref), { kind: body.kind, lang: item?.lang, pathList: body.pathList ?? [], isIncoming: true });
    if (accept.message) return fail(-1, accept.message);
    const key = objectFrontendAssetKeyFree({ assetList: objectState.assetList }, body.key ?? '', accept.kind);
    if (!key) return fail(-1, `the object has an asset of the key ${body.key} already`);
    const { naming, message } = objectFrontendAssetNamingRead(objectState.assetList, '', body);
    if (message) return fail(-1, message);
    const result = await this.partitionCall(partition, 'recordSet', { key, kind: accept.kind, itemId: body.itemId, ...naming });
    if (result.code !== 0) return result;
    this.writeAccept(partition.key, result.data);
    return this.writeResultBuild(id, this.itemListOfPartitionGet(partition).filter((one) => one.itemId === body.itemId));
  }

  private async partitionRename(id: string, target: { point: any; state?: RemotePartition }, partitionFrom: string, partitionTo: string): Promise<RemoteResult> {
    const { assetStore, objectFrontendStore } = this.stores;
    const state = target.state;
    if (state?.partitionId) {
      const result = await this.partitionCall(state, 'partitionRename', { partition: partitionTo });
      if (result.code !== 0) return result;
    }
    const base = await assetStore.backendBase.objectFrontendWrite('partition/rename', { id, partitionFrom, partitionTo });
    if (base.code === 0 && base.data?.config) objectFrontendStore.configAcceptFromWrite?.(base.data.config);
    await this.sync();
    return base.code === 0 ? this.writeResultBuild(id, []) : base;
  }

  // a partition deleted: marked deleted at the point (it comes back with a restore there), then
  // its bind removed from the folder of the object
  private async partitionDelete(id: string, target: { point: any; state?: RemotePartition }, partition: string): Promise<RemoteResult> {
    const { assetStore, objectFrontendStore } = this.stores;
    const state = target.state;
    if (state?.partitionId) {
      if (state.itemList.some((item) => item.isLocked && !item.isDeleted)) return fail(-1, `the partition ${partition} holds a locked asset: unlock it first`);
      const result = await this.partitionCall(state, 'partitionDelete', {});
      if (result.code !== 0) return result;
    }
    const base = await assetStore.backendBase.objectFrontendWrite('partition/delete', { id, partition });
    if (base.code === 0 && base.data?.config) objectFrontendStore.configAcceptFromWrite?.(base.data.config);
    await this.sync();
    return base.code === 0 ? this.writeResultBuild(id, []) : base;
  }

  // ---------- moving a partition through the page ----------
  // doc_page_impl_asset_storage.md#moving-through-the-page: a point of the page is on one side at
  // least, so the page reads every item with its history from where it is and writes it where it
  // goes, checks what arrived, and only then has the development server switch the bind

  private transferSet(patch: Partial<RemoteTransfer>) {
    runInAction(() => {
      this.transfer = { ...this.transfer, ...patch };
    });
  }

  transferClear() {
    this.transferSet({ status: 'idle', title: '', text: '', countDone: 0, countTotal: 0, message: '' });
  }

  private async partitionStorageSet(id: string, objectState: any, partition: string, pointTo: any, options: { isSourceKept: boolean }): Promise<RemoteResult> {
    const { assetStore, objectFrontendStore } = this.stores;
    if (this.transfer.status === 'running') return fail(-1, 'another partition is being moved');
    if (!pointTo) return fail(-3, 'no such storage point');
    if (pointTo.status !== 'ready') return fail(-6, `the storage point ${pointTo.id} cannot be used: ${pointTo.statusMessage}`);
    if (assetStore.backendKind !== 'api') return fail(-1, 'the storage of a partition is changed where the page can write the folder of the object: on the development server');
    const ownerRef = objectState.ref;
    const targetFrom = this.partitionTargetGet(id, partition);
    const stateFrom = targetFrom?.isBound ? targetFrom.state : undefined;
    const isPageTo = pointTo.driverPlace === 'page';
    if (stateFrom && stateFrom.pointId === pointTo.id) return fail(-1, `the partition ${partition} is held by ${pointTo.id} already`);
    const title = `${objectState.name || id}: ${partition} to ${pointTo.label || pointTo.id}`;
    this.transferSet({ status: 'running', title, text: 'reading what the partition holds', countDone: 0, countTotal: 0, message: '' });
    const finish = (result: RemoteResult): RemoteResult => {
      this.transferSet(result.code === 0 ? { status: 'done', text: 'moved', message: '' } : { status: 'error', message: result.message });
      return result;
    };
    try {
      // ----- the source: its items, their records, and how one version is read
      let itemSourceList: any[];
      let recordList: any[];
      let versionRead: (item: any, versionMeta: any) => Promise<RemoteResult>;
      if (stateFrom) {
        await this.partitionLoad(stateFrom.key, { isForced: true });
        const state = this.partitionByKey.get(stateFrom.key)!;
        if (state.status === 'absent') {
          itemSourceList = [];
          recordList = [];
        } else if (state.status !== 'ready' || state.isFromCache) {
          return finish(fail(-1, state.message || `the partition ${partition} could not be read from its storage point`));
        } else {
          itemSourceList = state.itemList;
          recordList = state.recordList;
        }
        versionRead = async (item, versionMeta) => {
          const [answer] = await this.versionListGet([{ itemId: item.itemId, versionId: versionMeta.versionId }]);
          if (answer.code !== 0) return answer;
          const entry = this.versionMemoryByKey.get(versionKeyBuild(item.itemId, versionMeta.versionId));
          return { code: 0, message: '', data: { isText: entry.isText, text: entry.text, bytes: entry.bytes, metadata: entry.metadata ?? {} } };
        };
      } else {
        const isIn = (groupPath: string) => groupPath === partition || String(groupPath ?? '').startsWith(`${partition}/`);
        itemSourceList = assetStore.itemList.filter((item: any) => item.folderOwner?.ref === ownerRef && isIn(item.groupPath))
          .map((item: any) => ({ ...item, groupPath: String(item.groupPath).split('/').slice(1).join('/') }));
        const itemIdSet = new Set(itemSourceList.map((item) => item.itemId));
        recordList = objectState.assetList.filter((asset: any) => itemIdSet.has(asset.itemId))
          .map((asset: any) => ({ key: asset.key, kind: asset.kind, itemId: asset.itemId, ...(asset.name ? { name: asset.name } : {}), ...(asset.pathList?.length ? { pathList: asset.pathList } : {}) }));
        versionRead = async (item, versionMeta) => {
          const answer = await assetStore.backendBase.itemGet(STORE_ID_LOCAL, item.itemId, versionMeta.versionId);
          if (answer.code !== 0) return answer;
          const version = answer.data.version;
          if (version.isText) return { code: 0, message: '', data: { isText: true, text: version.text ?? '', metadata: version.metadata ?? {} } };
          const response = await fetch(assetStore.backendBase.dataUrlGet(STORE_ID_LOCAL, item.itemId, versionMeta.versionId), { cache: 'no-store' });
          if (!response.ok) return fail(-1, `the bytes of version ${versionMeta.versionId} of ${item.itemId} were not read (${response.status})`);
          return { code: 0, message: '', data: { isText: false, bytes: new Uint8Array(await response.arrayBuffer()), metadata: version.metadata ?? {} } };
        };
      }
      const versionCountTotal = itemSourceList.reduce((count, item) => count + (item.versionList?.length ?? 0), 0);
      this.transferSet({ countTotal: versionCountTotal, text: `copying ${itemSourceList.length} item(s)` });

      // ----- the target: where one item with its history is written
      let partitionIdTo = '';
      if (isPageTo) {
        const reason = this.pointUnavailableReasonGet(pointTo);
        if (reason.code !== 0) return finish(reason);
        const created = await this.partitionEnsureAtPoint(pointTo, { ownerRef, ownerTypeId: objectState.typeId, partition });
        if (created.code !== 0) return finish(created);
        partitionIdTo = created.data.partition.partitionId;
        if (created.data.isCreated === false && (created.data.partition.itemCount ?? 0) > 0) {
          this.transferSet({ text: 'the storage point holds this partition already: its items are replaced by the ones copied' });
        }
      }
      const recordByItemId = new Map(recordList.map((record) => [record.itemId, record]));
      let countDone = 0;
      for (const item of itemSourceList) {
        const versionList: any[] = [];
        for (const versionMeta of item.versionList ?? []) {
          const read = await versionRead(item, versionMeta);
          if (read.code !== 0) return finish(fail(read.code, `version ${versionMeta.versionId} of ${item.itemId}: ${read.message}`));
          versionList.push({ versionId: versionMeta.versionId, ...read.data });
          countDone += 1;
          this.transferSet({ countDone });
        }
        const itemPlain = itemPlainBuild(item);
        const written = isPageTo
          ? await this.driverCall(pointTo, 'itemImport', { partitionId: partitionIdTo, timeZone: this.timeZoneGet(), item: itemPlain, versionList, record: recordByItemId.get(item.itemId) })
          : await assetStore.backendBase.objectFrontendWrite('partition/item/import', {
            id, partition, storagePoint: pointTo.id, item: itemPlain,
            versionList: versionList.map((one) => ({ versionId: one.versionId, metadata: one.metadata, ...(one.isText ? { text: one.text } : { dataBase64: bytesToBase64(one.bytes) }) })),
          });
        if (written.code !== 0) return finish(fail(written.code, `the item ${item.itemId} was not written at ${pointTo.id}: ${written.message}`));
      }

      // ----- what arrived is compared before anything is switched
      if (isPageTo) {
        this.transferSet({ text: 'checking what arrived' });
        const check = await this.driverCall(pointTo, 'partitionGet', { partitionId: partitionIdTo });
        if (check.code !== 0) return finish(check);
        const itemByIdTo = new Map((check.data.itemList ?? []).map((item: any) => [item.itemId, item]));
        for (const item of itemSourceList) {
          const itemTo: any = itemByIdTo.get(item.itemId);
          const isSame = itemTo && (item.versionList ?? []).every((version: any) => (itemTo.versionList ?? []).some((one: any) => one.versionId === version.versionId && one.hash === version.hash));
          if (!isSame) return finish(fail(-1, `the item ${item.itemId} did not arrive at ${pointTo.id} as it was sent: the partition is left as it was`));
        }
      }

      // ----- the switch: from here the new point is read
      this.transferSet({ text: 'switching the storage of the partition' });
      const switched = await assetStore.backendBase.objectFrontendWrite('partition/storage/set', {
        id, partition, storagePoint: pointTo.id, isDataTransferred: true, recordList,
      });
      if (switched.code !== 0) return finish(switched);
      if (switched.data?.config) objectFrontendStore.configAcceptFromWrite?.(switched.data.config);
      await assetStore.statusLoad?.();
      await assetStore.indexLoad?.();
      await this.sync();
      if (isPageTo) await this.partitionLoad(partitionKeyBuild(ownerRef, partition), { isForced: true });

      // ----- what the point before held: removed, or kept there as a copy no object reads
      if (stateFrom?.partitionId && !options.isSourceKept) {
        const pointFrom = this.pointGet(stateFrom.pointId, stateFrom.docPageAlias);
        const removed = await this.partitionPurgeAtPoint(pointFrom, stateFrom.partitionId);
        if (removed.code !== 0) return finish(fail(removed.code, `the partition is held by ${pointTo.id} now; its copy at ${stateFrom.pointId} was not removed: ${removed.message}`));
        void this.cache.indexRemove(this.cacheScopeGet(pointFrom), ownerRef, partition);
      }
      return finish(this.writeResultBuild(id, switched.data?.itemList ?? []));
    } catch (error: any) {
      return finish(fail(-1, `the partition was not moved: ${String(error?.message ?? error)}`));
    }
  }

  // the partitions a point holds that no object of the page is bound to: what an object may claim
  // (its own identity), and the copies left behind. [{ ...partition, isOfPage, objectName }]
  async pointPartitionList(pointId: string, docPageAlias = ''): Promise<RemoteResult> {
    const point = this.pointGet(pointId, docPageAlias);
    const result = await this.driverCall(point, 'partitionList');
    if (result.code !== 0) return result;
    const { objectFrontendStore } = this.stores;
    const partitionList = (result.data?.partitionList ?? []).map((one: any) => {
      const bound = this.partitionGet(one.ownerRef, one.partition);
      const objectId = objectFrontendIdOfRefGet(one.ownerRef);
      const decl = objectFrontendStore?.declGet(objectId);
      return {
        ...one,
        isBound: bound?.pointId === pointId && bound.partitionId === one.partitionId,
        isObjectOfPage: Boolean(decl),
        objectName: decl ? objectFrontendStore.objectGet(objectId).name : '',
      };
    });
    return { code: 0, data: { partitionList }, message: '' };
  }

  // a partition of a point removed for good, or brought back from its deletion mark
  async pointPartitionPurge(pointId: string, partitionId: string, docPageAlias = ''): Promise<RemoteResult> {
    return this.partitionPurgeAtPoint(this.pointGet(pointId, docPageAlias), partitionId);
  }

  async pointPartitionRestore(pointId: string, partitionId: string, docPageAlias = ''): Promise<RemoteResult> {
    return this.driverCall(this.pointGet(pointId, docPageAlias), 'partitionRestore', { partitionId });
  }
}

// what item.yaml holds of an item, without where the page found it
function itemPlainBuild(item: any): Record<string, any> {
  const { folder: _folder, dirName: _dirName, folderOwner: _folderOwner, storage: _storage, ...plain } = item;
  return plain;
}

export { base64ToBytes };
