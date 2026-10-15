import { makeAutoObservable, observable, runInAction } from 'mobx';
import { assetBackendApiCreate, assetBackendSnapshotCreate } from '../lib/doc-asset-backend.js';
import { ASSET_STORE_ID_LOCAL } from '../lib/doc-asset-ref.js';

// Asset store of the page (design: doc_page_impl_asset.md). It holds what
// the page knows of the asset objects: the index of every object of the
// store (read once when the page starts), the data of the versions in use,
// the folders of the local store, the one open asset panel, and every write
// to the store. Components never see it: the runtime boundary
// (CompAssetHost) asks it for the data of a reference and renders the
// component with that data.
//
//   backend        where the objects live: the asset api of the development
//                  server, or the snapshot bundled into a build (read-only)
//   isAvailable    the backend answered
//   isWritable     the backend accepts writes
//   storeIdList    the stores the backend serves (the ids a reference may name)
//   folderList     the folders of the local store; one is the default for new objects
//   index          the object index: the metadata of every object, loaded at start
//   objectById     metadata of every object known, key `${store}/${objectId}`
//   versionByKey   data of every version read so far, key `${store}/${objectId}#${versionId}`
//   nameLookupByKey  the names looked up that the index did not have, key `${store}/${name}`:
//                  the lookup in progress, or the failure
//   panel          the one open asset panel: object, selected version, the
//                  text being edited, the pending confirmation, the preview
//
// a reference { store, objectId | name, versionId: 'head' | id } names its
// object by id or by its name (unique in the store); a name resolves to the
// id through the index, and the version through the object's
// versionIdHead, so moving the head changes what every document reading
// "head" shows. a change on disk reported by the development server
// (subscribe) reloads the object and the versions in use, or the whole
// index when the folders of the store changed.

export type AssetSaveMode = 'inPlace' | 'newVersion';

// what the data of a version depends on (doc_page_impl_asset.md#dependencies)
export type AssetDependency =
  | { type: 'source'; path: string }
  | { type: 'asset'; objectId: string; versionId?: string };
export type AssetDependent = { objectId: string; versionId: string; dependency: AssetDependency };

export type AssetEventType =
  | 'create' | 'updateInPlace' | 'versionCreate' | 'checkout' | 'versionDelete' | 'metaSet' | 'delete' | 'restore'
  | 'lock' | 'unlock' | 'dependencySet' | 'versionMetadataSet';

// what the writer of a version's data says about it ({versionId}.metadata.yaml,
// doc_page_impl_asset.md#version-metadata); the store never interprets it
export type AssetVersionMetadata = Record<string, unknown>;

// what happened to an object: every event is a mapping, so a key may be
// missing (userId is reserved for a store that knows who writes)
export type AssetEvent = { eventType: AssetEventType; time: string; versionId?: string; userId?: string };

export type AssetVersionMeta = {
  versionId: string;
  versionIdPrevList: string[];
  time: string;
  note: string;
  size: number;
  hash: string;
  // not rewritten in place, not deleted
  isLocked: boolean;
  dependencyList: AssetDependency[];
};

export type AssetObject = {
  objectId: string;
  name: string;
  lang: string;
  contentType: string;
  fileExt: string;
  saveMode?: AssetSaveMode;
  versionIdHead: string;
  isDeleted: boolean;
  // nothing of the object changes until it is unlocked
  isLocked: boolean;
  timeCreated: string;
  versionList: AssetVersionMeta[];
  eventList: AssetEvent[];
  // where the object was found: the store folder, and its own folder in it ({objectId}--{name})
  folder: string;
  dirName: string;
};

export type AssetFolderInfo = { path: string; pathAbs: string; isDefault: boolean; isExists: boolean; objectCount: number };

// the object by id, or by name when objectId is ''
export type AssetRef = { store: string; objectId: string; name?: string; versionId: string };

type AssetObjectState = { status: 'loading' | 'done' | 'error'; object?: AssetObject; message?: string };

type AssetNameLookupState = { status: 'loading' | 'error'; message: string };

// the data of one version as the page holds it: the text when the bytes are
// utf-8 text, otherwise only size and hash (the bytes are reached by url),
// and the version's metadata ({} when it has none)
export type AssetVersionState = {
  status: 'loading' | 'done' | 'error';
  isText?: boolean;
  text?: string;
  hash?: string;
  size?: number;
  metadata?: AssetVersionMetadata;
  message?: string;
};

// what a reference resolves to right now
export type AssetRefResult = {
  status: 'loading' | 'done' | 'error';
  message: string;
  object?: AssetObject;
  versionId: string;
  version?: AssetVersionState;
};

export type AssetResult = { code: number; data?: any; message: string };

// a point of the screen, viewport coordinates (doc_page_impl_event.md)
export type AssetPoint = { clientX: number; clientY: number };

// the block the panel was opened from: what renders the object's data, so
// the panel can show what a save would render as
export type AssetPanelBlock = { compName: string; propsAuthored: Record<string, any>; sourcePath: string };

export type AssetPanel = {
  store: string;
  objectId: string;
  // the version the block that opened the panel reads: 'head', an id, or ''
  versionIdRef: string;
  block: AssetPanelBlock | undefined;
  // the preview pane beside the panel is open
  isPreviewOpen: boolean;
  // the event list of the object is unfolded
  isEventListOpen: boolean;
  // the version whose data is shown; '' when none is selected
  versionIdSelected: string;
  // the head text being edited; pointStart is where the text was clicked to
  // start editing (the caret goes there)
  edit: { textDraft: string; status: 'editing' | 'submitting' | 'error'; message: string; pointStart?: AssetPoint } | undefined;
  confirm: { kind: 'versionDelete' | 'objectDelete'; versionId: string; status: 'confirming' | 'submitting' | 'error'; message: string } | undefined;
  // a file being written as the head data
  upload: { fileName: string; status: 'submitting' | 'error'; message: string } | undefined;
  // state of the last head / name / save mode / restore action
  status: 'idle' | 'submitting';
  message: string;
};

export type DocAssetStoreOptions = {
  endpoint?: string;
  snapshot?: any;
  subscribe?: (listener: (change: { objectId?: string; isStoreChanged?: boolean }) => void) => () => void;
};

const messageConflict = 'The asset changed since it was loaded. It was reloaded; apply the change again.';

export class DocAssetStore {
  backend: ReturnType<typeof assetBackendApiCreate> | ReturnType<typeof assetBackendSnapshotCreate> | undefined;
  isAvailable = false;
  isWritable = false;
  storeIdList: string[] = [];
  folderList: AssetFolderInfo[] = [];
  // the folder actions of the settings panel
  folder: { status: 'idle' | 'submitting' | 'error'; message: string } = { status: 'idle', message: '' };
  index: { status: 'idle' | 'loading' | 'done' | 'error'; message: string } = { status: 'idle', message: '' };
  objectById: Record<string, AssetObjectState> = {};
  versionByKey: Record<string, AssetVersionState> = {};
  nameLookupByKey: Record<string, AssetNameLookupState> = {};
  panel: AssetPanel | undefined = undefined;
  // whether the preview pane was open when a panel was last shown
  isPanelPreviewOpenLast = false;
  subscribe: DocAssetStoreOptions['subscribe'];
  unsubscribe: (() => void) | undefined;
  // the load process at start (status, then index) while it runs
  startPromise: Promise<void> | undefined;
  indexPromise: Promise<void> | undefined;
  reloadTimerByObjectId = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: DocAssetStoreOptions = {}) {
    if (options.endpoint) this.backend = assetBackendApiCreate(options.endpoint);
    else if (options.snapshot) this.backend = assetBackendSnapshotCreate(options.snapshot, ASSET_STORE_ID_LOCAL);
    this.subscribe = options.subscribe;
    makeAutoObservable(this, {
      backend: false,
      subscribe: false,
      unsubscribe: false,
      startPromise: false,
      indexPromise: false,
      reloadTimerByObjectId: false,
      objectById: observable.shallow,
      versionByKey: observable.shallow,
    });
  }

  // the load process at start: the status of the backend (writable, stores,
  // folders), then the index of every object, so that a reference resolves
  // its object without a request and only the version data is read
  init() {
    if (!this.backend) return;
    this.startPromise = this.statusLoad().then(() => this.indexLoad()).finally(() => {
      this.startPromise = undefined;
    });
    this.unsubscribe = this.subscribe?.((change) => {
      if (change?.isStoreChanged) {
        void this.statusLoad().then(() => this.indexLoad());
        return;
      }
      if (change?.objectId) this.objectReloadSchedule(ASSET_STORE_ID_LOCAL, change.objectId);
    });
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const timer of this.reloadTimerByObjectId.values()) clearTimeout(timer);
    this.reloadTimerByObjectId.clear();
  }

  async statusLoad(): Promise<void> {
    if (!this.backend) return;
    const result = await this.backend.statusGet();
    runInAction(() => {
      this.isAvailable = result.code === 0;
      this.isWritable = result.code === 0 && result.data?.isWritable === true;
      this.storeIdList = result.code === 0 && Array.isArray(result.data?.storeIdList) ? result.data.storeIdList : [];
      this.folderList = result.code === 0 && Array.isArray(result.data?.folderList) ? result.data.folderList : [];
    });
  }

  // the metadata of every object of the local store. objects already read
  // (and the version data in use) are replaced by what the index says now.
  indexLoad(): Promise<void> {
    if (!this.backend || !this.isAvailable) return Promise.resolve();
    if (this.indexPromise) return this.indexPromise;
    runInAction(() => {
      this.index = { status: 'loading', message: '' };
    });
    this.indexPromise = this.backend.objectList(ASSET_STORE_ID_LOCAL).then((result) => {
      runInAction(() => {
        if (result.code !== 0) {
          this.index = { status: 'error', message: result.message };
          return;
        }
        const objectIdSet = new Set<string>();
        for (const object of result.data.objectList as AssetObject[]) {
          objectIdSet.add(object.objectId);
          this.objectAccept(ASSET_STORE_ID_LOCAL, object);
        }
        // objects that left the store (a folder removed from it)
        for (const key of Object.keys(this.objectById)) {
          const { store, objectId } = objectKeyParse(key);
          if (store === ASSET_STORE_ID_LOCAL && !objectIdSet.has(objectId)) this.objectForget(store, objectId);
        }
        // a name the index did not have may be in it now: every name
        // lookup is forgotten, and a reference still showing asks again
        this.nameLookupByKey = {};
        this.index = { status: 'done', message: '' };
      });
    }).finally(() => {
      this.indexPromise = undefined;
    });
    return this.indexPromise;
  }

  // one write to the folder is several file events (the data file, the
  // object file, its backup): the reload of an object runs once, shortly
  // after the last of them
  private objectReloadSchedule(store: string, objectId: string) {
    const key = objectKeyGet(store, objectId);
    const timerPrevious = this.reloadTimerByObjectId.get(key);
    if (timerPrevious) clearTimeout(timerPrevious);
    this.reloadTimerByObjectId.set(key, setTimeout(() => {
      this.reloadTimerByObjectId.delete(key);
      void this.objectReload(store, objectId);
    }, 150));
  }

  // ---------- reading ----------

  objectGet(store: string, objectId: string): AssetObject | undefined {
    return this.objectById[objectKeyGet(store, objectId)]?.object;
  }

  // the load state of an object: undefined when nothing was asked for it yet
  objectStateGet(store: string, objectId: string): AssetObjectState | undefined {
    return this.objectById[objectKeyGet(store, objectId)];
  }

  // the objects of the index, in creation order
  get objectList(): AssetObject[] {
    const list: AssetObject[] = [];
    for (const state of Object.values(this.objectById)) if (state.object) list.push(state.object);
    return list.sort((a, b) => a.timeCreated.localeCompare(b.timeCreated));
  }

  storeIdIs(store: string): boolean {
    return this.storeIdList.includes(store);
  }

  // the id of the object with that name, from the objects loaded (the
  // index); '' when none has it
  objectIdGetByName(store: string, name: string): string {
    if (!name) return '';
    for (const [key, state] of Object.entries(this.objectById)) {
      if (state.object?.name === name && objectKeyParse(key).store === store) return state.object.objectId;
    }
    return '';
  }

  // the id a reference means: its objectId, or the id its name resolves to
  // ('' while the name is not known)
  refObjectIdGet(ref: AssetRef): string {
    return ref.objectId || this.objectIdGetByName(ref.store, ref.name ?? '');
  }

  // the version a reference names right now, '' while the object is unknown
  refVersionIdGet(ref: AssetRef): string {
    if (ref.versionId !== 'head') return ref.versionId;
    return this.objectGet(ref.store, this.refObjectIdGet(ref))?.versionIdHead ?? '';
  }

  // the state of a reference, from what is loaded; refLoad() fills it
  refQuery(ref: AssetRef): AssetRefResult {
    if (!this.backend) return { status: 'error', message: 'The page has no asset store.', versionId: '' };
    if (this.storeIdList.length > 0 && !this.storeIdIs(ref.store)) {
      return { status: 'error', message: `unknown asset store: ${ref.store} (known: ${this.storeIdList.join(', ')})`, versionId: '' };
    }
    const objectId = this.refObjectIdGet(ref);
    if (!objectId) {
      // a name no loaded object has: the lookup says whether it is missing
      const lookup = this.nameLookupByKey[nameKeyGet(ref.store, ref.name ?? '')];
      if (lookup?.status === 'error') return { status: 'error', message: lookup.message, versionId: '' };
      return { status: 'loading', message: '', versionId: '' };
    }
    const stateObject = this.objectById[objectKeyGet(ref.store, objectId)];
    if (!stateObject || stateObject.status === 'loading') return { status: 'loading', message: '', versionId: '' };
    if (stateObject.status === 'error' || !stateObject.object) {
      return { status: 'error', message: stateObject.message ?? 'The asset object could not be read.', versionId: '' };
    }
    const object = stateObject.object;
    const versionId = this.refVersionIdGet(ref);
    const version = this.versionByKey[versionKeyGet(ref.store, objectId, versionId)];
    if (!version || version.status === 'loading') return { status: 'loading', message: '', object, versionId };
    if (version.status === 'error') {
      return { status: 'error', message: version.message ?? 'The asset version could not be read.', object, versionId };
    }
    return { status: 'done', message: '', object, versionId, version };
  }

  // loads what refQuery needs; nothing happens when it is already loaded.
  // the index is waited for first: an object the index does not have is
  // confirmed missing with one request (it may have appeared meanwhile); a
  // name the index does not have is looked up with one request the same way.
  async refLoad(ref: AssetRef): Promise<void> {
    if (!this.backend || (!ref.objectId && !ref.name)) return;
    if (this.startPromise) await this.startPromise;
    if (this.indexPromise) await this.indexPromise;
    if (this.storeIdList.length > 0 && !this.storeIdIs(ref.store)) return;
    const objectId = this.refObjectIdGet(ref);
    if (!objectId) {
      await this.nameLookup(ref.store, ref.name ?? '', ref.versionId);
      return;
    }
    const stateObject = this.objectById[objectKeyGet(ref.store, objectId)];
    if (stateObject?.status !== 'done') {
      // unknown: read it; loading: the read in progress brings the head data
      // too; error: nothing to retry until the object is reloaded
      if (!stateObject) await this.versionLoad(ref.store, objectId, ref.versionId);
      return;
    }
    const versionId = this.refVersionIdGet(ref);
    if (!versionId || this.versionByKey[versionKeyGet(ref.store, objectId, versionId)]) return;
    await this.versionLoad(ref.store, objectId, versionId);
  }

  // one request reads the object of a name (and the data of one version);
  // the object joins the index, so the name resolves from then on
  private async nameLookup(store: string, name: string, versionIdRequested: string): Promise<void> {
    if (!this.backend) return;
    const key = nameKeyGet(store, name);
    if (this.nameLookupByKey[key]) return;
    runInAction(() => {
      this.nameLookupByKey[key] = { status: 'loading', message: '' };
    });
    const result = await this.backend.objectGetByName(store, name, versionIdRequested);
    runInAction(() => {
      if (result.code !== 0) {
        this.nameLookupByKey[key] = { status: 'error', message: result.message };
        return;
      }
      delete this.nameLookupByKey[key];
      this.objectAccept(store, result.data.object);
      this.versionAccept(store, result.data.object.objectId, result.data.version);
    });
  }

  // one request reads the object and the data of one version
  private async versionLoad(store: string, objectId: string, versionIdRequested: string): Promise<void> {
    if (!this.backend) return;
    const keyObject = objectKeyGet(store, objectId);
    const isObjectKnown = Boolean(this.objectById[keyObject]?.object);
    const versionIdKnown = versionIdRequested === 'head' ? this.objectGet(store, objectId)?.versionIdHead ?? '' : versionIdRequested;
    runInAction(() => {
      if (!isObjectKnown) this.objectById[keyObject] = { status: 'loading' };
      if (versionIdKnown) this.versionByKey[versionKeyGet(store, objectId, versionIdKnown)] = { status: 'loading' };
    });
    const result = await this.backend.objectGet(store, objectId, versionIdRequested);
    runInAction(() => {
      if (result.code !== 0) {
        if (!isObjectKnown) this.objectById[keyObject] = { status: 'error', message: result.message };
        if (versionIdKnown) this.versionByKey[versionKeyGet(store, objectId, versionIdKnown)] = { status: 'error', message: result.message };
        return;
      }
      this.objectAccept(store, result.data.object);
      this.versionAccept(store, objectId, result.data.version);
    });
  }

  // the object changed on disk: its metadata and every version in use are
  // read again; an object that is gone leaves the index
  async objectReload(store: string, objectId: string): Promise<void> {
    if (!this.backend) return;
    const prefix = `${versionKeyGet(store, objectId, '')}`;
    const versionIdList = Object.keys(this.versionByKey)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
    const result = await this.backend.objectGet(store, objectId, 'head');
    runInAction(() => {
      if (result.code === -3) {
        this.objectForget(store, objectId);
        return;
      }
      if (result.code !== 0) {
        this.objectById[objectKeyGet(store, objectId)] = { status: 'error', message: result.message };
        return;
      }
      this.objectAccept(store, result.data.object);
      this.versionAccept(store, objectId, result.data.version);
    });
    if (result.code !== 0) return;
    for (const versionId of versionIdList) {
      if (versionId === result.data?.version?.versionId) continue;
      const resultVersion = await this.backend.objectGet(store, objectId, versionId);
      runInAction(() => {
        if (resultVersion.code === 0) this.versionAccept(store, objectId, resultVersion.data.version);
        else delete this.versionByKey[versionKeyGet(store, objectId, versionId)];
      });
    }
  }

  private objectAccept(store: string, object: AssetObject) {
    this.objectById[objectKeyGet(store, object.objectId)] = { status: 'done', object };
    // a reference by this name resolves now
    if (object.name) delete this.nameLookupByKey[nameKeyGet(store, object.name)];
    // versions that no longer exist (deleted) leave the cache
    const versionIdSet = new Set(object.versionList.map((version) => version.versionId));
    const prefix = versionKeyGet(store, object.objectId, '');
    for (const key of Object.keys(this.versionByKey)) {
      if (key.startsWith(prefix) && !versionIdSet.has(key.slice(prefix.length))) delete this.versionByKey[key];
    }
  }

  private objectForget(store: string, objectId: string) {
    delete this.objectById[objectKeyGet(store, objectId)];
    const prefix = versionKeyGet(store, objectId, '');
    for (const key of Object.keys(this.versionByKey)) {
      if (key.startsWith(prefix)) delete this.versionByKey[key];
    }
    if (this.panel?.store === store && this.panel.objectId === objectId) this.panel = undefined;
  }

  private versionAccept(
    store: string,
    objectId: string,
    version: { versionId: string; size: number; hash: string; isText: boolean; text?: string; metadata?: AssetVersionMetadata },
  ) {
    this.versionByKey[versionKeyGet(store, objectId, version.versionId)] = {
      status: 'done',
      isText: version.isText === true,
      text: version.isText === true ? version.text ?? '' : undefined,
      hash: version.hash,
      size: version.size,
      metadata: version.metadata ?? {},
    };
  }

  versionGet(store: string, objectId: string, versionId: string): AssetVersionState | undefined {
    return this.versionByKey[versionKeyGet(store, objectId, versionId)];
  }

  // the url the bytes of a version are read from (a download link); '' when none
  dataUrlGet(store: string, objectId: string, versionId: string): string {
    return this.backend?.dataUrlGet(store, objectId, versionId) ?? '';
  }

  // ---------- writing ----------

  // every write: the backend answers, the fresh object (and version) replace
  // the loaded ones, the caller gets { code, data, message }
  private async writeApply(store: string, request: () => Promise<any>, messageFailure: string): Promise<AssetResult> {
    if (!this.backend) return { code: -1, message: 'The page has no asset store.' };
    if (!this.isWritable) return { code: -1, message: 'The asset store is read-only.' };
    const result = await request();
    if (result.code !== 0) {
      return { code: result.code, message: result.code === -2 ? messageConflict : result.message || messageFailure };
    }
    runInAction(() => {
      if (result.data?.object) this.objectAccept(store, result.data.object);
      if (result.data?.object && result.data?.version) this.versionAccept(store, result.data.object.objectId, result.data.version);
    });
    return { code: 0, data: result.data, message: '' };
  }

  // a new object with its first version, in the default folder of the store
  // unless a folder is named; data: { object, version, isCreated }. a name
  // an object of the store has answers that object and creates nothing
  // (isCreated false).
  // dependencyList: what the data depends on (doc_page_impl_asset.md#dependencies)
  // saveMode: written into the object (absent: the store's default applies)
  // versionMetadata: the metadata of the first version
  objectCreate(input: {
    store: string;
    name?: string;
    lang?: string;
    contentType?: string;
    fileExt?: string;
    text?: string;
    dataBase64?: string;
    note?: string;
    folder?: string;
    dependencyList?: AssetDependency[];
    saveMode?: AssetSaveMode;
    versionMetadata?: AssetVersionMetadata;
  }): Promise<AssetResult> {
    return this.writeApply(input.store, () => this.backend!.objectCreate(input), 'The asset object was not created.');
  }

  // the head data replaced in place, or a new version from the head; mode
  // absent means the object's save mode. dependencyList absent keeps the
  // dependencies of the head version for the new data, versionMetadata absent
  // keeps its metadata.
  async objectUpdate(
    store: string,
    objectId: string,
    data: { text?: string; dataBase64?: string },
    mode?: AssetSaveMode,
    note = '',
    dependencyList?: AssetDependency[],
    versionMetadata?: AssetVersionMetadata,
  ): Promise<AssetResult> {
    const object = this.objectGet(store, objectId);
    const head = object ? this.versionGet(store, objectId, object.versionIdHead) : undefined;
    if (!object || head?.status !== 'done' || head.hash === undefined) {
      return { code: -1, message: 'The head version of the asset is not loaded.' };
    }
    const result = await this.writeApply(
      store,
      () => this.backend!.objectUpdate({ store, objectId, hashBase: head.hash, ...data, mode, note, dependencyList, versionMetadata }),
      'The asset was not updated.',
    );
    if (result.code === -2) void this.objectReload(store, objectId);
    return result;
  }

  // ---------- dependencies ----------

  // the dependencies of a loaded version, from the object metadata
  dependencyListGet(store: string, objectId: string, versionId: string): AssetDependency[] {
    const object = this.objectGet(store, objectId);
    const versionIdResolved = versionId === '' || versionId === 'head' ? object?.versionIdHead ?? '' : versionId;
    return object?.versionList.find((version) => version.versionId === versionIdResolved)?.dependencyList ?? [];
  }

  // the versions of the store depending on the object (versionId '' ) or on
  // one version of it; asked from the backend, since it needs every object
  async dependentListGet(store: string, objectId: string, versionId = ''): Promise<AssetResult> {
    if (!this.backend) return { code: -1, message: 'The page has no asset store.' };
    const result = await this.backend.dependentListGet(store, objectId, versionId);
    return result.code === 0 ? { code: 0, data: result.data, message: '' } : { code: result.code, message: result.message };
  }

  dependencyListSet(store: string, objectId: string, versionId: string, dependencyList: AssetDependency[]): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.dependencyListSet(store, objectId, versionId, dependencyList), 'The dependencies were not changed.');
  }

  dependencyAdd(store: string, objectId: string, versionId: string, dependency: AssetDependency): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.dependencyAdd(store, objectId, versionId, dependency), 'The dependency was not added.');
  }

  dependencyRemove(store: string, objectId: string, versionId: string, dependency: AssetDependency): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.dependencyRemove(store, objectId, versionId, dependency), 'The dependency was not removed.');
  }

  objectDelete(store: string, objectId: string): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.objectDelete(store, objectId), 'The asset object was not deleted.');
  }

  objectRestore(store: string, objectId: string): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.objectRestore(store, objectId), 'The asset object was not restored.');
  }

  objectMetaSet(store: string, objectId: string, change: { name?: string; lang?: string; contentType?: string; saveMode?: AssetSaveMode | null }): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.objectMetaSet(store, objectId, change), 'The asset object was not changed.');
  }

  versionCheckout(store: string, objectId: string, versionId: string): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.versionCheckout(store, objectId, versionId), 'The head was not moved.');
  }

  versionDelete(store: string, objectId: string, versionId: string): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.versionDelete(store, objectId, versionId), 'The version was not deleted.');
  }

  // the metadata of one version replaced; {} removes it
  versionMetadataSet(store: string, objectId: string, versionId: string, versionMetadata: AssetVersionMetadata): Promise<AssetResult> {
    return this.writeApply(
      store,
      () => this.backend!.versionMetadataSet(store, objectId, versionId, versionMetadata),
      'The metadata of the version was not changed.',
    );
  }

  objectLockSet(store: string, objectId: string, isLocked: boolean): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.objectLockSet(store, objectId, isLocked), 'The lock of the object was not changed.');
  }

  versionLockSet(store: string, objectId: string, versionId: string, isLocked: boolean): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.versionLockSet(store, objectId, versionId, isLocked), 'The lock of the version was not changed.');
  }

  // ---------- the folders of the local store (settings panel) ----------

  get folderDefault(): AssetFolderInfo | undefined {
    return this.folderList.find((folder) => folder.isDefault);
  }

  // the whole list is written: asset.yaml is rewritten by the server, and
  // the index is read again because the set of objects changed with it
  private async folderListApply(folderListNext: { path: string; isDefault: boolean }[]): Promise<boolean> {
    if (!this.backend || !this.isWritable || this.folder.status === 'submitting') return false;
    runInAction(() => {
      this.folder = { status: 'submitting', message: '' };
    });
    const result = await this.backend.folderSet(folderListNext);
    runInAction(() => {
      if (result.code !== 0) {
        this.folder = { status: 'error', message: result.message || 'The folders were not changed.' };
        return;
      }
      this.folder = { status: 'idle', message: '' };
      if (Array.isArray(result.data?.folderList)) this.folderList = result.data.folderList;
    });
    if (result.code === 0) await this.indexLoad();
    return result.code === 0;
  }

  folderAdd(pathText: string): Promise<boolean> {
    const pathTrimmed = String(pathText ?? '').trim();
    if (!pathTrimmed) return Promise.resolve(false);
    if (this.folderList.some((folder) => folder.path === pathTrimmed)) {
      runInAction(() => {
        this.folder = { status: 'error', message: `${pathTrimmed} is already a folder of the store.` };
      });
      return Promise.resolve(false);
    }
    return this.folderListApply([
      ...this.folderList.map((folder) => ({ path: folder.path, isDefault: folder.isDefault })),
      { path: pathTrimmed, isDefault: this.folderList.length === 0 },
    ]);
  }

  // the objects in a removed folder stay on disk; they only leave the store
  folderRemove(pathText: string): Promise<boolean> {
    const folderListRest = this.folderList.filter((folder) => folder.path !== pathText);
    if (folderListRest.length === this.folderList.length) return Promise.resolve(false);
    if (folderListRest.length === 0) {
      runInAction(() => {
        this.folder = { status: 'error', message: 'The store needs at least one folder.' };
      });
      return Promise.resolve(false);
    }
    const isDefaultKept = folderListRest.some((folder) => folder.isDefault);
    return this.folderListApply(folderListRest.map((folder, index) => ({
      path: folder.path,
      isDefault: isDefaultKept ? folder.isDefault : index === 0,
    })));
  }

  folderDefaultSet(pathText: string): Promise<boolean> {
    if (!this.folderList.some((folder) => folder.path === pathText)) return Promise.resolve(false);
    return this.folderListApply(this.folderList.map((folder) => ({ path: folder.path, isDefault: folder.path === pathText })));
  }

  folderMessageClear() {
    if (this.folder.status === 'error') this.folder = { status: 'idle', message: '' };
  }

  // ---------- the asset panel ----------

  get isPanelOpen(): boolean {
    return this.panel !== undefined;
  }

  // opened from the toolbar of a block; versionIdRef is what that block
  // reads, block what renders the data (for the preview). the preview pane
  // stays open or closed from one panel to the next.
  panelOpen(store: string, objectId: string, versionIdRef = '', block?: AssetPanelBlock) {
    const versionIdSelected = this.refVersionIdGet({ store, objectId, versionId: versionIdRef || 'head' });
    this.panel = {
      store,
      objectId,
      versionIdRef,
      block,
      isPreviewOpen: this.isPanelPreviewOpenLast,
      isEventListOpen: false,
      versionIdSelected,
      edit: undefined,
      confirm: undefined,
      upload: undefined,
      status: 'idle',
      message: '',
    };
    void this.refLoad({ store, objectId, versionId: 'head' });
    if (versionIdSelected) void this.refLoad({ store, objectId, versionId: versionIdSelected });
  }

  panelClose() {
    if (this.panelIsBusy) return;
    this.panel = undefined;
  }

  get panelObject(): AssetObject | undefined {
    return this.panel ? this.objectGet(this.panel.store, this.panel.objectId) : undefined;
  }

  // the preview pane: what the block would render with the data as it is
  // in the panel now (the draft while editing, else the selected version)
  panelPreviewToggle() {
    if (!this.panel) return;
    this.panel.isPreviewOpen = !this.panel.isPreviewOpen;
    this.isPanelPreviewOpenLast = this.panel.isPreviewOpen;
  }

  panelEventListToggle() {
    if (!this.panel) return;
    this.panel.isEventListOpen = !this.panel.isEventListOpen;
  }

  // the data the preview renders: the draft while the head text is edited,
  // else the data of the selected version. isDraft says which.
  get panelPreviewData(): { versionId: string; isDraft: boolean; version: AssetVersionState | undefined; text: string } {
    const panel = this.panel;
    if (!panel) return { versionId: '', isDraft: false, version: undefined, text: '' };
    if (panel.edit) {
      const head = this.panelObject ? this.versionGet(panel.store, panel.objectId, this.panelObject.versionIdHead) : undefined;
      return { versionId: this.panelObject?.versionIdHead ?? '', isDraft: true, version: head, text: panel.edit.textDraft };
    }
    const version = panel.versionIdSelected ? this.versionGet(panel.store, panel.objectId, panel.versionIdSelected) : undefined;
    return { versionId: panel.versionIdSelected, isDraft: false, version, text: version?.text ?? '' };
  }

  // a write of the panel is pending
  get panelIsBusy(): boolean {
    const panel = this.panel;
    if (!panel) return false;
    return panel.status === 'submitting'
      || panel.edit?.status === 'submitting'
      || panel.confirm?.status === 'submitting'
      || panel.upload?.status === 'submitting';
  }

  // the versions of the panel's object, newest first (the store appends
  // versions in creation order)
  get panelVersionList(): AssetVersionMeta[] {
    const object = this.panelObject;
    if (!object) return [];
    return [...object.versionList].reverse();
  }

  // the effective save mode of the panel's object: the written one, else in place
  get panelSaveMode(): AssetSaveMode {
    return assetSaveModeGet(this.panelObject);
  }

  // selecting the selected version again unselects it
  panelVersionSelect(versionId: string) {
    const panel = this.panel;
    if (!panel || panel.edit) return;
    panel.versionIdSelected = panel.versionIdSelected === versionId ? '' : versionId;
    panel.confirm = undefined;
    panel.message = '';
    if (panel.versionIdSelected) void this.refLoad({ store: panel.store, objectId: panel.objectId, versionId });
  }

  // the text of the head becomes editable (the head only: an in-place save
  // rewrites the head, a new version branches from it). pointStart: where
  // the text was clicked; the caret is placed there.
  panelEditStart(pointStart?: AssetPoint) {
    const panel = this.panel;
    const object = this.panelObject;
    if (!panel || !object || object.isDeleted || object.isLocked || !this.isWritable) return;
    const head = this.versionGet(panel.store, panel.objectId, object.versionIdHead);
    if (head?.status !== 'done' || !head.isText) return;
    panel.versionIdSelected = object.versionIdHead;
    panel.confirm = undefined;
    panel.edit = { textDraft: head.text ?? '', status: 'editing', message: '', pointStart };
  }

  panelEditCancel() {
    if (!this.panel || this.panel.edit?.status === 'submitting') return;
    this.panel.edit = undefined;
  }

  // the head version is locked: a save in place is refused, a new version is not
  get panelIsHeadLocked(): boolean {
    const object = this.panelObject;
    return Boolean(object?.versionList.find((version) => version.versionId === object.versionIdHead)?.isLocked);
  }

  // the save a leave without a choice makes (a pointer down outside the
  // text and its buttons): the object's save mode, a new version when that
  // mode would rewrite a locked head
  get panelSaveModeOnLeave(): AssetSaveMode {
    return this.panelSaveMode === 'inPlace' && this.panelIsHeadLocked ? 'newVersion' : this.panelSaveMode;
  }

  // leaving the text without a choice: an unchanged draft just closes, a
  // changed one is saved (panelSaveModeOnLeave), as a block of the document
  // is saved when it is left; a failed save keeps the text open with its message
  async panelEditLeave(): Promise<boolean> {
    const panel = this.panel;
    const edit = panel?.edit;
    const object = this.panelObject;
    if (!panel || !edit || !object || edit.status === 'submitting') return false;
    const head = this.versionGet(panel.store, panel.objectId, object.versionIdHead);
    if (edit.textDraft === (head?.text ?? '')) {
      this.panelEditCancel();
      return true;
    }
    return this.panelSave(this.panelSaveModeOnLeave);
  }

  panelDraftSet(text: string) {
    const edit = this.panel?.edit;
    if (!edit || edit.status === 'submitting') return;
    edit.textDraft = text;
    if (edit.status === 'error') {
      edit.status = 'editing';
      edit.message = '';
    }
  }

  // saves the edited text: in place or as a new version when the mode is
  // given (the panel offers both), else with the object's save mode
  async panelSave(mode?: AssetSaveMode): Promise<boolean> {
    const panel = this.panel;
    const edit = panel?.edit;
    if (!panel || !edit || edit.status === 'submitting') return false;
    runInAction(() => {
      edit.status = 'submitting';
      edit.message = '';
    });
    const result = await this.objectUpdate(panel.store, panel.objectId, { text: edit.textDraft }, mode);
    runInAction(() => {
      if (result.code !== 0) {
        edit.status = 'error';
        edit.message = result.message;
        return;
      }
      if (this.panel === panel) {
        panel.edit = undefined;
        panel.versionIdSelected = result.data?.version?.versionId ?? panel.versionIdSelected;
      }
    });
    return result.code === 0;
  }

  // the bytes of a file become the head data (any file: text or not), with
  // the object's save mode or the mode given
  async panelUpload(file: File, mode?: AssetSaveMode): Promise<boolean> {
    const panel = this.panel;
    if (!panel || this.panelIsBusy) return false;
    runInAction(() => {
      panel.edit = undefined;
      panel.confirm = undefined;
      panel.upload = { fileName: file.name, status: 'submitting', message: '' };
    });
    const dataBase64 = await fileBase64Read(file);
    const result = await this.objectUpdate(panel.store, panel.objectId, { dataBase64 }, mode, file.name);
    runInAction(() => {
      if (this.panel !== panel) return;
      if (result.code !== 0) {
        panel.upload = { fileName: file.name, status: 'error', message: result.message };
        return;
      }
      panel.upload = undefined;
      panel.versionIdSelected = result.data?.version?.versionId ?? panel.versionIdSelected;
    });
    return result.code === 0;
  }

  panelUploadMessageClear() {
    if (this.panel?.upload?.status === 'error') this.panel.upload = undefined;
  }

  panelConfirmSet(kind: 'versionDelete' | 'objectDelete', versionId = '') {
    const panel = this.panel;
    if (!panel || panel.confirm?.status === 'submitting') return;
    panel.edit = undefined;
    panel.confirm = { kind, versionId, status: 'confirming', message: '' };
  }

  panelConfirmClear() {
    if (!this.panel || this.panel.confirm?.status === 'submitting') return;
    this.panel.confirm = undefined;
  }

  async panelConfirmApply(): Promise<boolean> {
    const panel = this.panel;
    const confirm = panel?.confirm;
    if (!panel || !confirm || confirm.status === 'submitting') return false;
    runInAction(() => {
      confirm.status = 'submitting';
      confirm.message = '';
    });
    const result = confirm.kind === 'versionDelete'
      ? await this.versionDelete(panel.store, panel.objectId, confirm.versionId)
      : await this.objectDelete(panel.store, panel.objectId);
    runInAction(() => {
      if (result.code !== 0) {
        confirm.status = 'error';
        confirm.message = result.message;
        return;
      }
      if (this.panel !== panel) return;
      panel.confirm = undefined;
      const object = this.panelObject;
      if (object && !object.versionList.some((version) => version.versionId === panel.versionIdSelected)) {
        panel.versionIdSelected = '';
      }
    });
    return result.code === 0;
  }

  // the head / name / save mode / restore actions of the panel share one status line
  private async panelAction(request: (panel: AssetPanel) => Promise<AssetResult>): Promise<boolean> {
    const panel = this.panel;
    if (!panel || panel.status === 'submitting') return false;
    runInAction(() => {
      panel.status = 'submitting';
      panel.message = '';
    });
    const result = await request(panel);
    runInAction(() => {
      panel.status = 'idle';
      panel.message = result.code === 0 ? '' : result.message;
    });
    return result.code === 0;
  }

  panelHeadSet(versionId: string): Promise<boolean> {
    return this.panelAction((panel) => this.versionCheckout(panel.store, panel.objectId, versionId));
  }

  panelNameSet(name: string): Promise<boolean> {
    return this.panelAction((panel) => this.objectMetaSet(panel.store, panel.objectId, { name }));
  }

  // the save mode written into the object's metadata; null removes the key
  // (the object then saves in place, the default)
  panelSaveModeSet(saveMode: AssetSaveMode | null): Promise<boolean> {
    return this.panelAction((panel) => this.objectMetaSet(panel.store, panel.objectId, { saveMode }));
  }

  panelObjectRestore(): Promise<boolean> {
    return this.panelAction((panel) => this.objectRestore(panel.store, panel.objectId));
  }

  panelObjectLockSet(isLocked: boolean): Promise<boolean> {
    return this.panelAction((panel) => this.objectLockSet(panel.store, panel.objectId, isLocked));
  }

  panelVersionLockSet(versionId: string, isLocked: boolean): Promise<boolean> {
    return this.panelAction((panel) => this.versionLockSet(panel.store, panel.objectId, versionId, isLocked));
  }
}

// the effective save mode of an object: the written one, else in place
export function assetSaveModeGet(object: { saveMode?: AssetSaveMode } | undefined): AssetSaveMode {
  return object?.saveMode === 'newVersion' ? 'newVersion' : 'inPlace';
}

function objectKeyGet(store: string, objectId: string): string {
  return `${store}/${objectId}`;
}

function objectKeyParse(key: string): { store: string; objectId: string } {
  const indexSlash = key.indexOf('/');
  return { store: key.slice(0, indexSlash), objectId: key.slice(indexSlash + 1) };
}

function versionKeyGet(store: string, objectId: string, versionId: string): string {
  return `${store}/${objectId}#${versionId}`;
}

function nameKeyGet(store: string, name: string): string {
  return `${store}/${name}`;
}

function fileBase64Read(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
