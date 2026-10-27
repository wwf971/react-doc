import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { assetBackendApiCreate, assetBackendSnapshotCreate } from '../lib/doc-asset-backend.js';
import { ASSET_STORE_ID_LOCAL } from '../lib/doc-asset-ref.js';
import { sourcePathBuild, sourcePathFullGet, sourcePathParse } from '../lib/doc-source-path.js';
import { AssetPanelModel } from './AssetPanelModel.js';

// The asset service layer of the page (design: doc_page_impl_asset.md). It holds what
// the page knows of the asset objects: the index of every object of the
// store (read once when the page starts), the data of the versions in use,
// which blocks of the documents reference which object (the usage index),
// the folders of the local store, the open asset panels, and every write
// to the store. Components never call it: the runtime boundary
// (CompAssetHost) asks it for the data of a reference and renders the
// component with that data, and what a component asks of the store arrives
// as an event (eventHandle).
//
//   backend        where the objects live: the asset api of the development
//                  server, or the snapshot bundled into a build (read-only)
//   backendKind    'api', 'snapshot', or 'none' (no asset service layer)
//   isAvailable    the backend answered
//   isWritable     the backend accepts writes
//   statusMessage  why the status request failed, as the backend said it
//   storeIdList    the stores the backend serves (the ids a reference may name)
//   folderList     the folders of the local store, each named by one doc page; one is the default
//   docPageList    the doc pages the page loads, with their asset store config
//   index          the object index: the metadata of every object, loaded at start
//   objectById     metadata of every object known, key `${store}/${objectId}`
//   versionByKey   data of every version read so far, key `${store}/${objectId}#${versionId}`
//   nameLookupByKey  the names looked up that the index did not have, key `${store}/${name}`:
//                  the lookup in progress, or the failure
//   usageIndex     the state of the usage index, read at start after the object index
//   isUsageReading every document is being read again; the index stays shown meanwhile
//   usageByDocPath the asset references of every document, as last read
//                  (doc_page_impl_asset.md#usage): the content hash read, the
//                  time, and every block whose data is a reference
//   panel          the asset panel of the popup (AssetPanelModel): the object
//                  opened from a block's toolbar, its selected version, the
//                  text being edited, the pending confirmation, the preview
//   settingsPanel  the asset panel of the object chosen in the settings
//                  panel's asset tab, another AssetPanelModel
//
// a reference { store, objectId | name, versionId: 'head' | id } names its
// object by id or by its name (unique in the store); a name resolves to the
// id through the index, and the version through the object's
// versionIdHead, so moving the head changes what every document reading
// "head" shows. a change on disk reported by the development server
// (subscribe) reloads the object and the versions in use, or the whole
// index when the folders of the store changed.
//
// the usage index is the page's picture of the documents, not a record the
// store keeps: documents change while the page is not running, and not
// every change reaches it. it is read from the documents at start, read
// again for every document whose content hash in the manifest changed, and
// told of the changes the page makes itself (usageNotify); a panel reads a
// document again on request to confirm what it says.

export type AssetSaveMode = 'inPlace' | 'newVersion';

// the component the data of an object is for, when it is a component's data
// (doc_page_impl_asset.md#objects-for-components)
export type AssetComponent = { name: string };

// a place in a document (doc_page_impl_nav.md#places-in-a-document)
export type DocPlace = { docPath: string; sourceLine: number; fragment: string };

// one block of a document whose data is an asset reference, as read from
// the document's text (assetUsageListScan of doc-asset-ref.js)
export type AssetUsage = {
  place: DocPlace;
  compName: string;
  componentId: string;
  reference: { store: string; objectId: string; name: string; versionId: string; message: string };
};

// how many blocks read an object: following its head, and pinned to each version
export type AssetUsageCount = { head: number; byVersionId: Record<string, number> };

type AssetUsageDocState = { contentHash: string; timeRead: number; usageList: AssetUsage[] };

// a change of the documents the page made itself, told to the usage index
// before it reads the documents again. lines are lines of the content
// without frontmatter (the sourceLine of a place); a change names the lines
// of a block, so it covers the reference of that block whatever line of the
// block its marker is on.
//   remove     the block was deleted, its object kept
//   move       the block moved, in its document or to another one
//   docChange  the document changed in a way the caller does not describe
export type AssetUsageChange =
  | { type: 'remove'; docPath: string; lineStart: number; lineEnd: number }
  | { type: 'move'; docPath: string; lineStart: number; lineEnd: number; docPathTo: string; lineStartTo: number }
  | { type: 'docChange'; docPath: string };

// the events of the asset domain (doc_page_impl_event.md): what a component
// whose data is an asset asks of the store
export const assetEventTypeList = ['assetRefreshRequest', 'assetTestCaseResultRequest'];

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any> };

// an entry of the source manifest, as far as the usage index reads it
type ManifestEntry = { internalPath: string; ext: string; contentHash?: string };

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
  component?: AssetComponent;
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

// a folder of the store: its full source path (~page:root/path), the doc page that names it
export type AssetFolderInfo = {
  path: string;
  pathAbs: string;
  isDefault: boolean;
  docEntryFile: string;
  isExists: boolean;
  objectCount: number;
};

// the asset store config of one doc page the page loads (its own first)
export type AssetDocPageInfo = {
  entryFile: string;
  configFileRelative: string;
  isConfigFileExists: boolean;
  folderList: string[];
  folderDefault: string;
  // the alias of the doc page and the full paths of its roots (~alias:root)
  alias: string;
  rootPathList: string[];
  problemList: string[];
};

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
// the panel can show what a save would render as, and which of the
// object's uses it is (its document and the line of its marker)
export type AssetPanelBlock = { compName: string; propsAuthored: Record<string, any>; sourcePath: string; sourceLine: number };

// manifestGet: the source manifest (DocSourceStore.fileManifest); the usage
// index reads a document again when its content hash there changes
export type DocAssetStoreOptions = {
  endpoint?: string;
  snapshot?: any;
  subscribe?: (listener: (change: { objectId?: string; isStoreChanged?: boolean }) => void) => () => void;
  manifestGet?: () => ManifestEntry[];
};

const messageConflict = 'The asset changed since it was loaded. It was reloaded; apply the change again.';

export class DocAssetStore {
  backend: ReturnType<typeof assetBackendApiCreate> | ReturnType<typeof assetBackendSnapshotCreate> | undefined;
  isAvailable = false;
  isWritable = false;
  statusMessage = '';
  storeIdList: string[] = [];
  folderList: AssetFolderInfo[] = [];
  docPageList: AssetDocPageInfo[] = [];
  // the folder actions of the settings panel
  folder: { status: 'idle' | 'submitting' | 'error'; message: string } = { status: 'idle', message: '' };
  index: { status: 'idle' | 'loading' | 'done' | 'error'; message: string } = { status: 'idle', message: '' };
  objectById: Record<string, AssetObjectState> = {};
  versionByKey: Record<string, AssetVersionState> = {};
  nameLookupByKey: Record<string, AssetNameLookupState> = {};
  usageIndex: { status: 'idle' | 'loading' | 'done' | 'error'; message: string } = { status: 'idle', message: '' };
  usageByDocPath: Record<string, AssetUsageDocState> = {};
  isUsageReading = false;
  panel: AssetPanelModel | undefined = undefined;
  settingsPanel: AssetPanelModel | undefined = undefined;
  // whether the preview pane was open when a panel was last shown
  isPanelPreviewOpenLast = false;
  subscribe: DocAssetStoreOptions['subscribe'];
  unsubscribe: (() => void) | undefined;
  manifestGet: DocAssetStoreOptions['manifestGet'];
  manifestReactionDispose: (() => void) | undefined;
  // the content hash of every md/mdx document of the manifest last seen,
  // so a document that left the manifest is read again (it may be gone)
  manifestHashByDocPathLast = new Map<string, string>();
  // the load process at start (status, then index) while it runs
  startPromise: Promise<void> | undefined;
  indexPromise: Promise<void> | undefined;
  reloadTimerByObjectId = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: DocAssetStoreOptions = {}) {
    if (options.endpoint) this.backend = assetBackendApiCreate(options.endpoint);
    else if (options.snapshot) this.backend = assetBackendSnapshotCreate(options.snapshot, ASSET_STORE_ID_LOCAL);
    this.subscribe = options.subscribe;
    this.manifestGet = options.manifestGet;
    makeAutoObservable(this, {
      backend: false,
      subscribe: false,
      unsubscribe: false,
      manifestGet: false,
      manifestReactionDispose: false,
      manifestHashByDocPathLast: false,
      startPromise: false,
      indexPromise: false,
      reloadTimerByObjectId: false,
      objectById: observable.shallow,
      versionByKey: observable.shallow,
      usageByDocPath: observable.shallow,
    });
  }

  // the load process at start: the status of the backend (writable, stores,
  // folders), then the index of every object, so that a reference resolves
  // its object without a request and only the version data is read, then
  // the usage index (which blocks reference which object)
  init() {
    if (!this.backend) return;
    this.startPromise = this.statusLoad().then(() => this.indexLoad()).finally(() => {
      this.startPromise = undefined;
    });
    void this.startPromise.then(() => this.usageLoad());
    this.unsubscribe = this.subscribe?.((change) => {
      if (change?.isStoreChanged) {
        void this.statusLoad().then(() => this.indexLoad());
        return;
      }
      if (change?.objectId) this.objectReloadSchedule(ASSET_STORE_ID_LOCAL, change.objectId);
    });
    if (this.manifestGet) {
      this.manifestReactionDispose = reaction(
        () => this.manifestGet!(),
        (manifest) => this.usageManifestSync(manifest),
      );
    }
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.manifestReactionDispose?.();
    this.manifestReactionDispose = undefined;
    for (const timer of this.reloadTimerByObjectId.values()) clearTimeout(timer);
    this.reloadTimerByObjectId.clear();
  }

  async statusLoad(): Promise<void> {
    if (!this.backend) return;
    const result = await this.backend.statusGet();
    runInAction(() => {
      this.isAvailable = result.code === 0;
      this.isWritable = result.code === 0 && result.data?.isWritable === true;
      this.statusMessage = result.code === 0 ? '' : String(result.message || 'no answer');
      this.storeIdList = result.code === 0 && Array.isArray(result.data?.storeIdList) ? result.data.storeIdList : [];
      this.folderList = result.code === 0 && Array.isArray(result.data?.folderList) ? result.data.folderList : [];
      this.docPageList = result.code === 0 && Array.isArray(result.data?.docPageList) ? result.data.docPageList : [];
    });
  }

  get backendKind(): 'api' | 'snapshot' | 'none' {
    if (!this.backend) return 'none';
    return this.backend.kind === 'api' ? 'api' : 'snapshot';
  }

  // why the page cannot read the store ('' when it can). the four cases are
  // told apart, so a failure is not reported as a missing permission:
  //   no store         the page got no asset endpoint and no snapshot: the
  //                    config names no asset.file, or the development
  //                    server was started before it did
  //   status failed    the asset api did not answer; its message is kept
  //   snapshot         a built page: readable, never writable
  get unavailableReason(): string {
    if (this.backendKind === 'none') {
      return 'The page has no asset service layer: config.yaml names no asset.file, or the development server was started before it did (restart it).';
    }
    if (this.statusMessage) return `The asset api did not answer: ${this.statusMessage}`;
    return '';
  }

  // why the page cannot write to the store ('' when it can)
  get writeUnavailableReason(): string {
    if (this.isWritable) return '';
    const reason = this.unavailableReason;
    if (reason) return reason;
    if (this.backendKind === 'snapshot') return 'The asset service layer of a built page is a read-only snapshot.';
    if (!this.isAvailable) return 'The asset service layer is still loading.';
    return 'The asset api answered that the store is read-only.';
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
    if (!this.backend) return { status: 'error', message: this.unavailableReason, versionId: '' };
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
    if (this.settingsPanel?.store === store && this.settingsPanel.objectId === objectId) this.settingsPanel = undefined;
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
    if (!this.isWritable) return { code: -1, message: this.writeUnavailableReason };
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

  // a new object with its first version, in the folder named, else in the
  // default folder of the doc page of docPath (the document it is made
  // from), else in the default folder of the store; data: { object, version, isCreated }. a name
  // an object of the store has answers that object and creates nothing
  // (isCreated false).
  // dependencyList: what the data depends on (doc_page_impl_asset.md#dependencies)
  // saveMode: written into the object (absent: the store's default applies)
  // versionMetadata: the metadata of the first version
  // component: the component the data is for, when it is a component's data
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
    docPath?: string;
    dependencyList?: AssetDependency[];
    saveMode?: AssetSaveMode;
    versionMetadata?: AssetVersionMetadata;
    component?: AssetComponent;
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
    if (!this.backend) return { code: -1, message: 'The page has no asset service layer.' };
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

  // saveMode null and component null remove the key
  objectMetaSet(
    store: string,
    objectId: string,
    change: { name?: string; lang?: string; contentType?: string; saveMode?: AssetSaveMode | null; component?: AssetComponent | null },
  ): Promise<AssetResult> {
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
  // every doc page the page loads names its own folders (its asset store
  // config); the settings panel edits the folders of one doc page at a time

  get folderDefault(): AssetFolderInfo | undefined {
    return this.folderList.find((folder) => folder.isDefault);
  }

  // the folders of one doc page, with their state
  folderListOfDocPageGet(entryFile: string): AssetFolderInfo[] {
    return this.folderList.filter((folder) => folder.docEntryFile === entryFile);
  }

  // why a folder path cannot be an asset folder of this page ('' when it
  // can, or when nothing is known): checked while it is typed, from what the
  // page knows (the roots of the source), so it is cheap and synchronous
  // docPageAlias: the doc page whose folders are edited, so that its roots
  // can be written in the local form (~root/path)
  folderPathWarningGet(pathText: string, docPageAlias: string): string {
    const text = sourcePathFullGet(String(pathText ?? '').trim(), docPageAlias);
    const parsed = sourcePathParse(text);
    if (!parsed) return 'name an asset folder by its source path: ~root/path';
    const rootPath = sourcePathBuild(parsed.rootAlias, '', parsed.docPageAlias);
    const rootPathList = this.docPageList.flatMap((item) => item.rootPathList);
    if (!rootPathList.includes(rootPath)) return `no root ${rootPath} (roots: ${rootPathList.join(', ') || 'none'})`;
    if (parsed.relPath === '') return 'a whole root cannot be an asset folder';
    const folder = this.folderList.find((item) => item.path === text);
    if (folder && !folder.isExists) return `${text} does not exist yet; it is created when the first object is written to it`;
    return '';
  }

  // the folders and default folder of one doc page written into its asset
  // store config (the server rewrites the file in place), then the store
  // read again: the set of objects changed with the folders
  async docPageFolderSet(configFile: string, folderList: string[], folderDefault: string): Promise<boolean> {
    if (!this.backend || !this.isWritable || this.folder.status === 'submitting') return false;
    if (folderList.length === 0) {
      runInAction(() => {
        this.folder = { status: 'error', message: 'A doc page with an asset store needs at least one folder.' };
      });
      return false;
    }
    runInAction(() => {
      this.folder = { status: 'submitting', message: '' };
    });
    const result = await this.backend.folderSet(configFile, folderList, folderDefault);
    runInAction(() => {
      this.folder = result.code === 0
        ? { status: 'idle', message: '' }
        : { status: 'error', message: result.message || 'The folders were not changed.' };
    });
    if (result.code === 0) {
      await this.statusLoad();
      await this.indexLoad();
    }
    return result.code === 0;
  }

  folderMessageClear() {
    if (this.folder.status === 'error') this.folder = { status: 'idle', message: '' };
  }

  // ---------- usage: which blocks reference which object (doc_page_impl_asset.md#usage) ----------

  // every document's references, read at start (after the object index, so
  // a reference by name resolves), and again on request (the settings
  // panel); replaces what was known. a read again keeps the index shown
  // until the answer replaces it (isUsageReading meanwhile).
  async usageLoad(): Promise<void> {
    if (!this.backend || !this.isAvailable || this.isUsageReading) return;
    runInAction(() => {
      this.isUsageReading = true;
      if (this.usageIndex.status !== 'done') this.usageIndex = { status: 'loading', message: '' };
    });
    const result = await this.backend.usageList([]);
    runInAction(() => {
      this.isUsageReading = false;
      if (result.code !== 0) {
        this.usageIndex = { status: 'error', message: result.message || 'The documents were not read for their asset references.' };
        return;
      }
      const usageByDocPath: Record<string, AssetUsageDocState> = {};
      const timeRead = Date.now();
      for (const doc of result.data?.docList ?? []) {
        usageByDocPath[doc.docPath] = { contentHash: doc.contentHash, timeRead, usageList: doc.usageList ?? [] };
      }
      this.usageByDocPath = usageByDocPath;
      this.usageIndex = { status: 'done', message: '' };
    });
    if (this.manifestGet) this.usageManifestSync(this.manifestGet());
  }

  // reads the references of some documents again; a document the answer
  // does not have is gone (or no longer collected) and leaves the index
  async usageDocListRead(docPathList: string[]): Promise<AssetResult> {
    if (!this.backend || !this.isAvailable) return { code: -1, message: this.unavailableReason || 'The asset service layer is not available.' };
    if (docPathList.length === 0) return { code: 0, message: '' };
    const result = await this.backend.usageList(docPathList);
    if (result.code !== 0) return { code: result.code, message: result.message || 'The documents were not read again.' };
    runInAction(() => {
      const docByPath = new Map<string, any>((result.data?.docList ?? []).map((doc: any) => [doc.docPath, doc]));
      const timeRead = Date.now();
      for (const docPath of docPathList) {
        const doc = docByPath.get(docPath);
        if (doc) this.usageByDocPath[docPath] = { contentHash: doc.contentHash, timeRead, usageList: doc.usageList ?? [] };
        else delete this.usageByDocPath[docPath];
      }
    });
    return { code: 0, message: '' };
  }

  // the manifest changed: the documents whose content hash differs from the
  // one their references were read with (new documents included), and the
  // documents that left the manifest since it was last seen, are read again
  private usageManifestSync(manifest: ManifestEntry[] | undefined) {
    if (this.usageIndex.status !== 'done' || !Array.isArray(manifest)) return;
    const hashByDocPath = new Map<string, string>();
    for (const entry of manifest) {
      if (entry.ext === 'md' || entry.ext === 'mdx') hashByDocPath.set(entry.internalPath, entry.contentHash ?? '');
    }
    const docPathList: string[] = [];
    for (const [docPath, contentHash] of hashByDocPath) {
      if (this.usageByDocPath[docPath]?.contentHash !== contentHash) docPathList.push(docPath);
    }
    for (const docPath of this.manifestHashByDocPathLast.keys()) {
      if (!hashByDocPath.has(docPath) && this.usageByDocPath[docPath]) docPathList.push(docPath);
    }
    this.manifestHashByDocPathLast = hashByDocPath;
    void this.usageDocListRead(docPathList);
  }

  // what the page changed itself, applied at once; the documents concerned
  // are then read again, which confirms it. the changes are applied against
  // the index as it was before any of them, so a swap of two blocks is two
  // moves that do not see each other.
  usageNotify(changeList: AssetUsageChange[]): Promise<AssetResult> {
    const docPathSet = new Set<string>();
    const usageByDocPathNext: Record<string, AssetUsage[]> = {};
    const usageListGetForDoc = (docPath: string) => {
      if (!usageByDocPathNext[docPath]) usageByDocPathNext[docPath] = [...(this.usageByDocPath[docPath]?.usageList ?? [])];
      return usageByDocPathNext[docPath];
    };
    const usageMovedList: { usage: AssetUsage; docPathTo: string; sourceLineTo: number }[] = [];
    for (const change of changeList) {
      docPathSet.add(change.docPath);
      if (change.type === 'docChange') continue;
      const usageListOld = this.usageByDocPath[change.docPath]?.usageList ?? [];
      const usageListChanged = usageListOld.filter((usage) => usageIsInLines(usage, change.docPath, change.lineStart, change.lineEnd));
      const usageListDoc = usageListGetForDoc(change.docPath);
      for (const usage of usageListChanged) usageListDoc.splice(usageListDoc.indexOf(usage), 1);
      if (change.type === 'move') {
        docPathSet.add(change.docPathTo);
        for (const usage of usageListChanged) {
          usageMovedList.push({ usage, docPathTo: change.docPathTo, sourceLineTo: usage.place.sourceLine - change.lineStart + change.lineStartTo });
        }
      }
    }
    for (const { usage, docPathTo, sourceLineTo } of usageMovedList) {
      usageListGetForDoc(docPathTo).push({ ...usage, place: { ...usage.place, docPath: docPathTo, sourceLine: sourceLineTo } });
    }
    for (const [docPath, usageList] of Object.entries(usageByDocPathNext)) {
      usageList.sort((a, b) => a.place.sourceLine - b.place.sourceLine);
      const state = this.usageByDocPath[docPath];
      this.usageByDocPath[docPath] = { contentHash: state?.contentHash ?? '', timeRead: state?.timeRead ?? Date.now(), usageList };
    }
    return this.usageDocListRead([...docPathSet]);
  }

  // the object a use reads ('' when its reference is not valid, or names a
  // name no object has)
  usageObjectIdGet(usage: AssetUsage): string {
    if (usage.reference.message) return '';
    return usage.reference.objectId || this.objectIdGetByName(usage.reference.store, usage.reference.name);
  }

  // every use, keyed by the object it reads (`${store}/${objectId}`)
  get usageListByObjectKey(): Map<string, AssetUsage[]> {
    const usageListByKey = new Map<string, AssetUsage[]>();
    for (const doc of Object.values(this.usageByDocPath)) {
      for (const usage of doc.usageList) {
        const objectId = this.usageObjectIdGet(usage);
        if (!objectId) continue;
        const key = objectKeyGet(usage.reference.store, objectId);
        const usageList = usageListByKey.get(key) ?? [];
        usageList.push(usage);
        usageListByKey.set(key, usageList);
      }
    }
    return usageListByKey;
  }

  usageListGet(store: string, objectId: string): AssetUsage[] {
    return this.usageListByObjectKey.get(objectKeyGet(store, objectId)) ?? [];
  }

  usageCountGet(store: string, objectId: string): AssetUsageCount {
    const count: AssetUsageCount = { head: 0, byVersionId: {} };
    for (const usage of this.usageListGet(store, objectId)) {
      if (usage.reference.versionId === 'head') count.head += 1;
      else count.byVersionId[usage.reference.versionId] = (count.byVersionId[usage.reference.versionId] ?? 0) + 1;
    }
    return count;
  }

  // why a use does not resolve to data ('' when it does, or while the
  // index is not read): the reference is not valid, names an unknown store
  // or object, or a version the object does not have
  usageProblemGet(usage: AssetUsage): string {
    if (usage.reference.message) return usage.reference.message;
    if (this.index.status !== 'done') return '';
    if (this.storeIdList.length > 0 && !this.storeIdIs(usage.reference.store)) return `unknown asset store: ${usage.reference.store}`;
    const objectId = this.usageObjectIdGet(usage);
    if (!objectId) return `no object is named "${usage.reference.name}"`;
    const object = this.objectGet(usage.reference.store, objectId);
    if (!object) return `object ${objectId} is not in the store`;
    if (usage.reference.versionId !== 'head' && !object.versionList.some((version) => version.versionId === usage.reference.versionId)) {
      return `version ${usage.reference.versionId} is not in the object`;
    }
    return '';
  }

  // the uses whose data cannot be read: the block shows an error
  get usageBrokenList(): AssetUsage[] {
    const usageList: AssetUsage[] = [];
    for (const doc of Object.values(this.usageByDocPath)) {
      for (const usage of doc.usageList) if (this.usageProblemGet(usage)) usageList.push(usage);
    }
    return usageList;
  }

  // objects that are a component's data (they declare it) and that no block
  // references: what was left behind when a block was removed without its
  // data, or what lost its block outside the page. undetermined (empty)
  // until the usage index is read.
  get orphanObjectList(): AssetObject[] {
    if (this.usageIndex.status !== 'done') return [];
    return this.objectList.filter((object) => !object.isDeleted && object.component
      && this.usageListGet(ASSET_STORE_ID_LOCAL, object.objectId).length === 0);
  }

  // objects no block references that declare no component: data of
  // another purpose, or data from before the declaration existed
  get unreferencedObjectList(): AssetObject[] {
    if (this.usageIndex.status !== 'done') return [];
    return this.objectList.filter((object) => !object.isDeleted && !object.component
      && this.usageListGet(ASSET_STORE_ID_LOCAL, object.objectId).length === 0);
  }

  // ---------- the events of the asset domain ----------

  async eventHandle(event: DocEvent): Promise<AssetResult | undefined> {
    if (event.type === 'assetRefreshRequest') return this.refreshHandle(event);
    if (event.type === 'assetTestCaseResultRequest') return this.testCaseResultHandle(event);
    return undefined;
  }

  // assetRefreshRequest: the object the component's data comes from
  // (event.source.asset) is read again from the store, so a change written
  // by another block or outside the page is seen now; the component
  // re-renders with it like every block reading the object. the answer says
  // whether the data the component reads changed: { versionIdHead, versionId,
  // hash, isChanged }
  private async refreshHandle(event: DocEvent): Promise<AssetResult> {
    const asset = event.source?.asset;
    if (!asset?.isFromAsset) {
      return { code: -1, message: 'assetRefreshRequest comes from a component whose data is not an asset (config.assetInfo.isFromAsset)' };
    }
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    await this.objectReload(asset.store, asset.objectId);
    const object = this.objectGet(asset.store, asset.objectId);
    if (!object) return { code: -1, message: `asset object ${asset.objectId} is no longer in the store` };
    const versionId = asset.versionIdRef === 'head' ? object.versionIdHead : asset.versionId;
    const version = this.versionGet(asset.store, asset.objectId, versionId);
    return {
      code: 0,
      data: { versionIdHead: object.versionIdHead, versionId, hash: version?.hash ?? '', isChanged: versionId !== asset.versionId || version?.hash !== asset.hash },
      message: '',
    };
  }

  // assetTestCaseResultRequest { caseId, testerId, result, operator, evidence?,
  // timeTimezone, hashBase }: one result appended to the history of the
  // TestCaseTable object the component reads (event.source.asset), by the
  // dedicated route of the api (comp-mdx/test-case-table/). the write is a
  // head update: hashBase is the hash the component read when the cell was
  // opened, kept on purpose, so a result recorded meanwhile by somebody else
  // is a conflict (-2) the author sees before recording over it; the object
  // is then read again. the document is not written: the data belongs to
  // the object. a pinned reference cannot record (a write goes to the head).
  // the answer is the api's { object, version }, the version's hash being
  // what the next record of the same cell is based on
  private async testCaseResultHandle(event: DocEvent): Promise<AssetResult> {
    const asset = event.source?.asset;
    if (!asset?.isFromAsset) {
      return { code: -1, message: 'assetTestCaseResultRequest comes from a component whose data is not an asset (config.assetInfo.isFromAsset)' };
    }
    if (asset.versionIdRef !== 'head') {
      return { code: -1, message: `the block reads version ${asset.versionIdRef} of its asset, not the head; a result is recorded at the head` };
    }
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    const data = event.data ?? {};
    const result = await this.writeApply(
      asset.store,
      () => this.backend!.testCaseResultSet({
        store: asset.store,
        objectId: asset.objectId,
        hashBase: String(data.hashBase ?? asset.hash ?? ''),
        docPath: String(event.source.sourcePath ?? ''),
        caseId: data.caseId,
        testerId: data.testerId,
        operator: data.operator,
        result: data.result,
        timeTimezone: data.timeTimezone,
        evidence: data.evidence,
        versionId: asset.versionIdRef,
      }),
      'The test result was not recorded.',
    );
    if (result.code === -2) void this.objectReload(asset.store, asset.objectId);
    return result;
  }

  // ---------- the asset panels ----------

  get isPanelOpen(): boolean {
    return this.panel !== undefined;
  }

  // the popup, opened from the toolbar of a block; versionIdRef is what that
  // block reads, block what renders the data (for the preview) and where it
  // is. the preview pane stays open or closed from one panel to the next.
  panelOpen(store: string, objectId: string, versionIdRef = '', block?: AssetPanelBlock) {
    this.panel = new AssetPanelModel(this, { store, objectId, versionIdRef, block, isPreviewOpen: this.isPanelPreviewOpenLast });
  }

  panelClose() {
    if (this.panel?.isBusy) return;
    this.panel = undefined;
  }

  panelPreviewToggle() {
    if (!this.panel) return;
    this.panel.isPreviewOpen = !this.panel.isPreviewOpen;
    this.isPanelPreviewOpenLast = this.panel.isPreviewOpen;
  }

  // the object shown in the settings panel's asset tab; choosing the object
  // shown closes it
  settingsPanelToggle(store: string, objectId: string) {
    if (this.settingsPanel?.isBusy) return;
    if (this.settingsPanel?.store === store && this.settingsPanel.objectId === objectId) {
      this.settingsPanel = undefined;
      return;
    }
    this.settingsPanel = new AssetPanelModel(this, { store, objectId });
  }

  settingsPanelClose() {
    if (this.settingsPanel?.isBusy) return;
    this.settingsPanel = undefined;
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

// the lines of a place fall in the lines a change names
function usageIsInLines(usage: AssetUsage, docPath: string, lineStart: number, lineEnd: number): boolean {
  return usage.place.docPath === docPath && usage.place.sourceLine >= lineStart && usage.place.sourceLine <= lineEnd;
}
