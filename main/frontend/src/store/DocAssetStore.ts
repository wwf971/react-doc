import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { assetBackendApiCreate, assetBackendSnapshotCreate } from '../lib/doc-asset-backend.js';
import { ASSET_STORE_ID_LOCAL } from '../lib/doc-asset-ref.js';
import { sourcePathBuild, sourcePathFullGet, sourcePathParse } from '../lib/doc-source-path.js';
import { AssetPanelModel } from './AssetPanelModel.js';

// The asset service layer of the page (design: doc_page_impl_asset.md). It holds what
// the page knows of the asset items: the index of every item of the
// store (read once when the page starts), the data of the versions in use,
// which blocks of the documents reference which item (the usage index),
// the folders of the local store, the open asset panels, and every write
// to the store. Components never call it: the runtime boundary
// (CompAssetHost) asks it for the data of a reference and renders the
// component with that data, and what a component asks of the store arrives
// as an event (eventHandle).
//
//   backend        where the items live: the asset api of the development
//                  server, or the snapshot bundled into a build (read-only)
//   backendKind    'api', 'snapshot', or 'none' (no asset service layer)
//   isAvailable    the backend answered
//   isWritable     the backend accepts writes
//   statusMessage  why the status request failed, as the backend said it
//   storeIdList    the stores the backend serves (the ids a reference may name)
//   folderList     the folders of the local store, each named by one doc page; one is the default
//   docPageList    the doc pages the page loads, with their asset store config
//   index          the item index: the metadata of every item, loaded at start
//   itemById     metadata of every item known, key `${store}/${itemId}`
//   versionByKey   data of every version read so far, key `${store}/${itemId}#${versionId}`
//   nameLookupByKey  the names looked up that the index did not have, key `${store}/${name}`:
//                  the lookup in progress, or the failure
//   usageIndex     the state of the usage index, read at start after the item index
//   isUsageReading every document is being read again; the index stays shown meanwhile
//   usageByDocPath the asset references of every document, as last read
//                  (doc_page_impl_asset.md#usage): the content hash read, the
//                  time, and every block whose data is a reference
//   panel          the asset panel of the popup (AssetPanelModel): the item
//                  opened from a block's toolbar, its selected version, the
//                  text being edited, the pending confirmation, the preview
//   settingsPanel  the asset panel of the item chosen in the settings
//                  panel's asset tab, another AssetPanelModel
//
// a reference { store, itemId | name, versionId: 'head' | id } names its
// item by id or by its name (unique in the store); a name resolves to the
// id through the index, and the version through the item's
// versionIdHead, so moving the head changes what every document reading
// "head" shows. a change on disk reported by the development server
// (subscribe) reloads the item and the versions in use, or the whole
// index when the folders of the store changed.
//
// the usage index is the page's picture of the documents, not a record the
// store keeps: documents change while the page is not running, and not
// every change reaches it. it is read from the documents at start, read
// again for every document whose content hash in the manifest changed, and
// told of the changes the page makes itself (usageNotify); a panel reads a
// document again on request to confirm what it says.

export type AssetSaveMode = 'inPlace' | 'newVersion';

// the component the data of an item is for, when it is a component's data
// (doc_page_impl_asset.md#items-for-components)
export type AssetComponent = { name: string };

// a place in a document (doc_page_impl_nav.md#places-in-a-document)
export type DocPlace = { docPath: string; sourceLine: number; fragment: string };

// one block of a document whose data is an asset reference, as read from
// the document's text (assetUsageListScan of doc-asset-ref.js)
export type AssetUsage = {
  place: DocPlace;
  compName: string;
  componentId: string;
  reference: { store: string; itemId: string; name: string; versionId: string; message: string };
};

// how many blocks read an item: following its head, and pinned to each version
export type AssetUsageCount = { head: number; byVersionId: Record<string, number> };

type AssetUsageDocState = { contentHash: string; timeRead: number; usageList: AssetUsage[] };

// a change of the documents the page made itself, told to the usage index
// before it reads the documents again. lines are lines of the content
// without frontmatter (the sourceLine of a place); a change names the lines
// of a block, so it covers the reference of that block whatever line of the
// block its marker is on.
//   remove     the block was deleted, its item kept
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
  | { type: 'asset'; itemId: string; versionId?: string };
export type AssetDependent = { itemId: string; versionId: string; dependency: AssetDependency };

export type AssetEventType =
  | 'create' | 'updateInPlace' | 'versionCreate' | 'checkout' | 'versionDelete' | 'metaSet' | 'delete' | 'restore'
  | 'lock' | 'unlock' | 'dependencySet' | 'versionMetadataSet';

// what the writer of a version's data says about it ({versionId}.metadata.yaml,
// doc_page_impl_asset.md#version-metadata); the store never interprets it
export type AssetVersionMetadata = Record<string, unknown>;

// what happened to an item: every event is a mapping, so a key may be
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

export type AssetItem = {
  itemId: string;
  name: string;
  lang: string;
  contentType: string;
  fileExt: string;
  component?: AssetComponent;
  // the item its data is a part of: { ref, role? } (doc_page_impl_obj_frontend.md#how-an-asset-comes-to-belong)
  owner?: { ref: string; role?: string };
  saveMode?: AssetSaveMode;
  versionIdHead: string;
  isDeleted: boolean;
  // nothing of the item changes until it is unlocked
  isLocked: boolean;
  timeCreated: string;
  versionList: AssetVersionMeta[];
  eventList: AssetEvent[];
  // where the item was found: the store folder, its own folder in it
  // ({itemId}--{name}, behind its group folders), and those groups ('' at the top)
  folder: string;
  dirName: string;
  groupPath?: string;
  // the object whose folder holds the item (doc_page_impl_asset.md#folders-owned-by-an-object):
  // where it was found; what it says of itself is owner
  folderOwner?: { ref: string };
};

// the layer of the objects that own folders answers for a move touching one: the asset
// layer does not know what an object accepts (DocObjectFrontendStore registers it)
export type AssetFolderOwnerHandler = {
  // the kinds an item may have when it goes into that object's folder; undefined: any
  kindListGet: (ownerRef: string) => { id: string; label: string }[] | undefined;
  labelGet: (ownerRef: string) => string;
  itemMove: (input: { store: string; item: any; folder: string; groupPath: string; kind?: string; ownerFrom?: string; ownerTo?: string }) => Promise<AssetResult>;
};

// a folder of the store: its full source path (~page:root/path), the doc page that names it
export type AssetFolderInfo = {
  path: string;
  pathAbs: string;
  isDefault: boolean;
  docEntryFile: string;
  isExists: boolean;
  itemCount: number;
  isReadOnly?: boolean;
  // the object that owns the folder; absent for a folder an asset.yaml names
  owner?: { ref: string };
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

// the item by id, or by name when itemId is ''
export type AssetRef = { store: string; itemId: string; name?: string; versionId: string };

type AssetItemState = { status: 'loading' | 'done' | 'error'; item?: AssetItem; message?: string };

// how many references one step of refListLoad reads
const ASSET_LOAD_CHUNK_SIZE = 8;

// after the next frame is painted, when there are frames to wait for (a page
// out of sight has none; it just goes on)
function frameNextWait(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function' || document.hidden) setTimeout(resolve, 0);
    else requestAnimationFrame(() => resolve());
  });
}

// what a read marked as being read (versionLoadBegin), to settle when its answer comes
type AssetVersionLoad = { isItemKnown: boolean; versionIdKnown: string };

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
  item?: AssetItem;
  versionId: string;
  version?: AssetVersionState;
};

export type AssetResult = { code: number; data?: any; message: string };

// a point of the screen, viewport coordinates (doc_page_impl_event.md)
export type AssetPoint = { clientX: number; clientY: number };

// the block the panel was opened from: what renders the item's data, so
// the panel can show what a save would render as, and which of the
// item's uses it is (its document and the line of its marker)
export type AssetPanelBlock = { compName: string; propsAuthored: Record<string, any>; sourcePath: string; sourceLine: number };

// manifestGet: the source manifest (DocSourceStore.fileManifest); the usage
// index reads a document again when its content hash there changes
export type DocAssetStoreOptions = {
  endpoint?: string;
  snapshot?: any;
  subscribe?: (listener: (change: { itemId?: string; isStoreChanged?: boolean; isObjectFrontendChanged?: boolean }) => void) => () => void;
  manifestGet?: () => ManifestEntry[];
};

const messageConflict = 'The asset changed since it was loaded. It was reloaded; apply the change again.';

// the storage points of the page and the types they are of (doc_page_impl_asset_storage.md), as
// the backend answers them
export type AssetStorageInfo = {
  typeList: any[];
  apiSetList: any[];
  pointList: any[];
  fileList: any[];
};

const ASSET_STORAGE_EMPTY: AssetStorageInfo = { typeList: [], apiSetList: [], pointList: [], fileList: [] };

export class DocAssetStore {
  backend: ReturnType<typeof assetBackendApiCreate> | ReturnType<typeof assetBackendSnapshotCreate> | undefined;
  isAvailable = false;
  isWritable = false;
  statusMessage = '';
  storeIdList: string[] = [];
  folderList: AssetFolderInfo[] = [];
  docPageList: AssetDocPageInfo[] = [];
  // the storage points and types (the asset storage service layer)
  storage: AssetStorageInfo = ASSET_STORAGE_EMPTY;
  // the layers answering for the folders their objects own, by the namespace of a reference
  folderOwnerHandlerByNamespace = new Map<string, AssetFolderOwnerHandler>();
  // the folder whose items the settings panel lists ('' none chosen)
  settingsFolderPath = '';
  // the folder actions of the settings panel
  folder: { status: 'idle' | 'submitting' | 'error'; message: string } = { status: 'idle', message: '' };
  index: { status: 'idle' | 'loading' | 'done' | 'error'; message: string } = { status: 'idle', message: '' };
  itemById: Record<string, AssetItemState> = {};
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
  reloadTimerByItemId = new Map<string, ReturnType<typeof setTimeout>>();

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
      reloadTimerByItemId: false,
      itemById: observable.shallow,
      versionByKey: observable.shallow,
      usageByDocPath: observable.shallow,
      folderOwnerHandlerByNamespace: false,
    });
  }

  // the load process at start: the status of the backend (writable, stores,
  // folders), then the index of every item, so that a reference resolves
  // its item without a request and only the version data is read, then
  // the usage index (which blocks reference which item)
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
      if (change?.itemId) this.itemReloadSchedule(ASSET_STORE_ID_LOCAL, change.itemId);
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
    for (const timer of this.reloadTimerByItemId.values()) clearTimeout(timer);
    this.reloadTimerByItemId.clear();
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
      this.storage = result.code === 0 && result.data?.storage ? result.data.storage : ASSET_STORAGE_EMPTY;
    });
  }

  // ---------- the storage points (doc_page_impl_asset_storage.md) ----------

  storageTypeGet(typeId: string): any | undefined {
    return this.storage.typeList.find((one) => one.id === typeId);
  }

  // every api set a type promises, its ancestors' first
  storageTypeApiSetListGet(typeId: string): string[] {
    const chain: any[] = [];
    for (let type = this.storageTypeGet(typeId); type && !chain.includes(type); type = this.storageTypeGet(type.extends)) chain.unshift(type);
    return [...new Set(chain.flatMap((type) => type.apiSetList as string[]))];
  }

  // the points an object of a doc page may name: the built-in ones, the workspace's, its doc page's
  storagePointListOfDocPageGet(docPageAlias: string): any[] {
    return this.storage.pointList.filter((one) => one.scope !== 'docPage' || one.docPageAlias === docPageAlias);
  }

  storagePointGet(pointId: string, docPageAlias = ''): any | undefined {
    return this.storagePointListOfDocPageGet(docPageAlias).find((one) => one.id === pointId) ?? this.storage.pointList.find((one) => one.id === pointId);
  }

  // what a partition of an object's folder is held by, for whoever shows or asks it: the point, its
  // type with what the type promises, and whether it can be used
  //   bind   { pointId, typeId, unavailableReason, pointIdClaimed? } as the declarations carry it;
  //          undefined: file-tree, the storage of a partition that says nothing
  storageOfBindGet(bind: any | undefined, docPageAlias = ''): any {
    const pointId = bind?.pointId ?? 'file-tree';
    const typeId = bind?.typeId || 'file-tree';
    const point = this.storagePointGet(pointId, docPageAlias);
    const type = this.storageTypeGet(typeId);
    return {
      pointId,
      typeId,
      label: point?.label ?? pointId,
      typeLabel: type?.label ?? typeId,
      place: type?.place ?? 'local',
      isContentSearchable: type?.isContentSearchable === true,
      apiSetList: this.storageTypeApiSetListGet(typeId),
      isAvailable: !bind?.unavailableReason,
      unavailableReason: bind?.unavailableReason ?? '',
      pointIdClaimed: bind?.pointIdClaimed ?? '',
      config: point?.config ?? {},
    };
  }

  // what the storage of a partition holds, as the last status said: { itemCount, size, sizeDead,
  // fileList, typeIdFoundList }; undefined for a partition without a file of its own
  partitionInfoGet(ownerRef: string, partition: string): any | undefined {
    const folder: any = this.folderList.find((one: any) => one.owner?.ref === ownerRef);
    return folder?.partitionList?.find((one: any) => one.partition === partition);
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

  // the metadata of every item of the local store. items already read
  // (and the version data in use) are replaced by what the index says now.
  indexLoad(): Promise<void> {
    if (!this.backend || !this.isAvailable) return Promise.resolve();
    if (this.indexPromise) return this.indexPromise;
    runInAction(() => {
      this.index = { status: 'loading', message: '' };
    });
    this.indexPromise = this.backend.itemList(ASSET_STORE_ID_LOCAL).then((result) => {
      runInAction(() => {
        if (result.code !== 0) {
          this.index = { status: 'error', message: result.message };
          return;
        }
        const itemIdSet = new Set<string>();
        for (const item of result.data.itemList as AssetItem[]) {
          itemIdSet.add(item.itemId);
          this.itemAccept(ASSET_STORE_ID_LOCAL, item);
        }
        // items that left the store (a folder removed from it)
        for (const key of Object.keys(this.itemById)) {
          const { store, itemId } = itemKeyParse(key);
          if (store === ASSET_STORE_ID_LOCAL && !itemIdSet.has(itemId)) this.itemForget(store, itemId);
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
  // item file, its backup): the reload of an item runs once, shortly
  // after the last of them
  private itemReloadSchedule(store: string, itemId: string) {
    const key = itemKeyGet(store, itemId);
    const timerPrevious = this.reloadTimerByItemId.get(key);
    if (timerPrevious) clearTimeout(timerPrevious);
    this.reloadTimerByItemId.set(key, setTimeout(() => {
      this.reloadTimerByItemId.delete(key);
      void this.itemReload(store, itemId);
    }, 150));
  }

  // ---------- reading ----------

  itemGet(store: string, itemId: string): AssetItem | undefined {
    return this.itemById[itemKeyGet(store, itemId)]?.item;
  }

  // the load state of an item: undefined when nothing was asked for it yet
  itemStateGet(store: string, itemId: string): AssetItemState | undefined {
    return this.itemById[itemKeyGet(store, itemId)];
  }

  // the items of the index, in creation order
  get itemList(): AssetItem[] {
    const list: AssetItem[] = [];
    for (const state of Object.values(this.itemById)) if (state.item) list.push(state.item);
    return list.sort((a, b) => a.timeCreated.localeCompare(b.timeCreated));
  }

  storeIdIs(store: string): boolean {
    return this.storeIdList.includes(store);
  }

  // the id of the item with that name, from the items loaded (the
  // index); '' when none has it
  itemIdGetByName(store: string, name: string): string {
    if (!name) return '';
    for (const [key, state] of Object.entries(this.itemById)) {
      if (state.item?.name === name && itemKeyParse(key).store === store) return state.item.itemId;
    }
    return '';
  }

  // the id a reference means: its itemId, or the id its name resolves to
  // ('' while the name is not known)
  refItemIdGet(ref: AssetRef): string {
    return ref.itemId || this.itemIdGetByName(ref.store, ref.name ?? '');
  }

  // the version a reference names right now, '' while the item is unknown
  refVersionIdGet(ref: AssetRef): string {
    if (ref.versionId !== 'head') return ref.versionId;
    return this.itemGet(ref.store, this.refItemIdGet(ref))?.versionIdHead ?? '';
  }

  // the state of a reference, from what is loaded; refLoad() fills it
  refQuery(ref: AssetRef): AssetRefResult {
    if (!this.backend) return { status: 'error', message: this.unavailableReason, versionId: '' };
    if (this.storeIdList.length > 0 && !this.storeIdIs(ref.store)) {
      return { status: 'error', message: `unknown asset store: ${ref.store} (known: ${this.storeIdList.join(', ')})`, versionId: '' };
    }
    const itemId = this.refItemIdGet(ref);
    if (!itemId) {
      // a name no loaded item has: the lookup says whether it is missing
      const lookup = this.nameLookupByKey[nameKeyGet(ref.store, ref.name ?? '')];
      if (lookup?.status === 'error') return { status: 'error', message: lookup.message, versionId: '' };
      return { status: 'loading', message: '', versionId: '' };
    }
    const stateItem = this.itemById[itemKeyGet(ref.store, itemId)];
    if (!stateItem || stateItem.status === 'loading') return { status: 'loading', message: '', versionId: '' };
    if (stateItem.status === 'error' || !stateItem.item) {
      return { status: 'error', message: stateItem.message ?? 'The asset item could not be read.', versionId: '' };
    }
    const item = stateItem.item;
    const versionId = this.refVersionIdGet(ref);
    const version = this.versionByKey[versionKeyGet(ref.store, itemId, versionId)];
    if (!version || version.status === 'loading') return { status: 'loading', message: '', item, versionId };
    if (version.status === 'error') {
      return { status: 'error', message: version.message ?? 'The asset version could not be read.', item, versionId };
    }
    return { status: 'done', message: '', item, versionId, version };
  }

  // loads what refQuery needs; nothing happens when it is already loaded.
  // the index is waited for first: an item the index does not have is
  // confirmed missing with one request (it may have appeared meanwhile); a
  // name the index does not have is looked up with one request the same way.
  async refLoad(ref: AssetRef): Promise<void> {
    if (!this.backend || (!ref.itemId && !ref.name)) return;
    if (this.startPromise) await this.startPromise;
    if (this.indexPromise) await this.indexPromise;
    if (this.storeIdList.length > 0 && !this.storeIdIs(ref.store)) return;
    const itemId = this.refItemIdGet(ref);
    if (!itemId) {
      await this.nameLookup(ref.store, ref.name ?? '', ref.versionId);
      return;
    }
    const stateItem = this.itemById[itemKeyGet(ref.store, itemId)];
    if (stateItem?.status !== 'done') {
      // unknown: read it; loading: the read in progress brings the head data
      // too; error: nothing to retry until the item is reloaded
      if (!stateItem) await this.versionLoad(ref.store, itemId, ref.versionId);
      return;
    }
    const versionId = this.refVersionIdGet(ref);
    if (!versionId || this.versionByKey[versionKeyGet(ref.store, itemId, versionId)]) return;
    await this.versionLoad(ref.store, itemId, versionId);
  }

  // one request reads the item of a name (and the data of one version);
  // the item joins the index, so the name resolves from then on
  private async nameLookup(store: string, name: string, versionIdRequested: string): Promise<void> {
    if (!this.backend) return;
    const key = nameKeyGet(store, name);
    if (this.nameLookupByKey[key]) return;
    runInAction(() => {
      this.nameLookupByKey[key] = { status: 'loading', message: '' };
    });
    const result = await this.backend.itemGetByName(store, name, versionIdRequested);
    runInAction(() => {
      if (result.code !== 0) {
        this.nameLookupByKey[key] = { status: 'error', message: result.message };
        return;
      }
      delete this.nameLookupByKey[key];
      this.itemAccept(store, result.data.item);
      this.versionAccept(store, result.data.item.itemId, result.data.version);
    });
  }

  // one request reads the item and the data of one version
  private async versionLoad(store: string, itemId: string, versionIdRequested: string): Promise<void> {
    if (!this.backend) return;
    const load = this.versionLoadBegin(store, itemId, versionIdRequested);
    const result = await this.backend.itemGet(store, itemId, versionIdRequested);
    runInAction(() => this.versionLoadEnd(store, itemId, load, result));
  }

  // what refLoad does for many references at once, a few at a time (ASSET_LOAD_CHUNK_SIZE):
  // one request and one change of the store per step, however many are asked, so what
  // waits is drawn a few times and not once per reference, with a frame before each
  // step so that a count of what is read is seen moving, even when the reads
  // are answered at once (a built page). A reference by a name goes through refLoad.
  async refListLoad(refList: AssetRef[]): Promise<void> {
    if (!this.backend) return;
    if (this.startPromise) await this.startPromise;
    if (this.indexPromise) await this.indexPromise;
    const refRestList: AssetRef[] = [];
    const requestByStore = new Map<string, { itemId: string; versionId: string; load: AssetVersionLoad }[]>();
    runInAction(() => {
      for (const ref of refList) {
        if (this.storeIdList.length > 0 && !this.storeIdIs(ref.store)) continue;
        const itemId = this.refItemIdGet(ref);
        if (!itemId) {
          refRestList.push(ref);
          continue;
        }
        const stateItem = this.itemById[itemKeyGet(ref.store, itemId)];
        // being read, or known not to be readable
        if (stateItem && stateItem.status !== 'done') continue;
        const versionId = stateItem ? this.refVersionIdGet(ref) : ref.versionId;
        if (stateItem && (!versionId || this.versionByKey[versionKeyGet(ref.store, itemId, versionId)])) continue;
        const requestList = requestByStore.get(ref.store) ?? [];
        requestList.push({ itemId, versionId, load: this.versionLoadBegin(ref.store, itemId, versionId) });
        requestByStore.set(ref.store, requestList);
      }
    });
    await Promise.all([
      ...refRestList.map((ref) => this.refLoad(ref)),
      ...[...requestByStore.entries()].map(async ([store, requestList]) => {
        for (let start = 0; start < requestList.length; start += ASSET_LOAD_CHUNK_SIZE) {
          await frameNextWait();
          const chunk = requestList.slice(start, start + ASSET_LOAD_CHUNK_SIZE);
          const result = await this.backend.itemGetList(store, chunk.map(({ itemId, versionId }) => ({ itemId, versionId })));
          runInAction(() => {
            chunk.forEach((one, index) => {
              const answer = result.code === 0 ? result.data.answerList[index] : result;
              this.versionLoadEnd(store, one.itemId, one.load, answer);
            });
          });
        }
      }),
    ]);
  }

  // what is marked as being read until the answer comes
  private versionLoadBegin(store: string, itemId: string, versionIdRequested: string): AssetVersionLoad {
    const keyItem = itemKeyGet(store, itemId);
    const load = {
      isItemKnown: Boolean(this.itemById[keyItem]?.item),
      versionIdKnown: versionIdRequested === 'head' ? this.itemGet(store, itemId)?.versionIdHead ?? '' : versionIdRequested,
    };
    runInAction(() => {
      if (!load.isItemKnown) this.itemById[keyItem] = { status: 'loading' };
      if (load.versionIdKnown) this.versionByKey[versionKeyGet(store, itemId, load.versionIdKnown)] = { status: 'loading' };
    });
    return load;
  }

  private versionLoadEnd(store: string, itemId: string, load: AssetVersionLoad, result: any) {
    if (result.code !== 0) {
      if (!load.isItemKnown) this.itemById[itemKeyGet(store, itemId)] = { status: 'error', message: result.message };
      if (load.versionIdKnown) this.versionByKey[versionKeyGet(store, itemId, load.versionIdKnown)] = { status: 'error', message: result.message };
      return;
    }
    this.itemAccept(store, result.data.item);
    this.versionAccept(store, itemId, result.data.version);
  }

  // the item changed on disk: its metadata and every version in use are
  // read again; an item that is gone leaves the index
  async itemReload(store: string, itemId: string): Promise<void> {
    if (!this.backend) return;
    const prefix = `${versionKeyGet(store, itemId, '')}`;
    const versionIdList = Object.keys(this.versionByKey)
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
    const result = await this.backend.itemGet(store, itemId, 'head');
    runInAction(() => {
      if (result.code === -3) {
        this.itemForget(store, itemId);
        return;
      }
      if (result.code !== 0) {
        this.itemById[itemKeyGet(store, itemId)] = { status: 'error', message: result.message };
        return;
      }
      this.itemAccept(store, result.data.item);
      this.versionAccept(store, itemId, result.data.version);
    });
    if (result.code !== 0) return;
    for (const versionId of versionIdList) {
      if (versionId === result.data?.version?.versionId) continue;
      const resultVersion = await this.backend.itemGet(store, itemId, versionId);
      runInAction(() => {
        if (resultVersion.code === 0) this.versionAccept(store, itemId, resultVersion.data.version);
        else delete this.versionByKey[versionKeyGet(store, itemId, versionId)];
      });
    }
  }

  private itemAccept(store: string, item: AssetItem) {
    const key = itemKeyGet(store, item.itemId);
    const stateBefore = this.itemById[key];
    // an item read again as it was stays the same item: reading the data of
    // an asset changes nothing for whoever depends on the index
    if (stateBefore?.status !== 'done' || JSON.stringify(stateBefore.item) !== JSON.stringify(item)) {
      this.itemById[key] = { status: 'done', item };
    }
    // a reference by this name resolves now
    if (item.name) delete this.nameLookupByKey[nameKeyGet(store, item.name)];
    // versions that no longer exist (deleted) leave the cache
    const versionIdSet = new Set(item.versionList.map((version) => version.versionId));
    const prefix = versionKeyGet(store, item.itemId, '');
    for (const key of Object.keys(this.versionByKey)) {
      if (key.startsWith(prefix) && !versionIdSet.has(key.slice(prefix.length))) delete this.versionByKey[key];
    }
  }

  private itemForget(store: string, itemId: string) {
    delete this.itemById[itemKeyGet(store, itemId)];
    const prefix = versionKeyGet(store, itemId, '');
    for (const key of Object.keys(this.versionByKey)) {
      if (key.startsWith(prefix)) delete this.versionByKey[key];
    }
    if (this.panel?.store === store && this.panel.itemId === itemId) this.panel = undefined;
    if (this.settingsPanel?.store === store && this.settingsPanel.itemId === itemId) this.settingsPanel = undefined;
  }

  private versionAccept(
    store: string,
    itemId: string,
    version: { versionId: string; size: number; hash: string; isText: boolean; text?: string; metadata?: AssetVersionMetadata },
  ) {
    this.versionByKey[versionKeyGet(store, itemId, version.versionId)] = {
      status: 'done',
      isText: version.isText === true,
      text: version.isText === true ? version.text ?? '' : undefined,
      hash: version.hash,
      size: version.size,
      metadata: version.metadata ?? {},
    };
  }

  versionGet(store: string, itemId: string, versionId: string): AssetVersionState | undefined {
    return this.versionByKey[versionKeyGet(store, itemId, versionId)];
  }

  // the url the bytes of a version are read from (a download link); '' when none
  dataUrlGet(store: string, itemId: string, versionId: string): string {
    return this.backend?.dataUrlGet(store, itemId, versionId) ?? '';
  }

  // ---------- writing ----------

  // every write: the backend answers, the fresh item (and version) replace
  // the loaded ones, the caller gets { code, data, message }
  private async writeApply(store: string, request: () => Promise<any>, messageFailure: string): Promise<AssetResult> {
    if (!this.isWritable) return { code: -1, message: this.writeUnavailableReason };
    const result = await request();
    if (result.code !== 0) {
      return { code: result.code, message: result.code === -2 ? messageConflict : result.message || messageFailure };
    }
    runInAction(() => {
      if (result.data?.item) this.itemAccept(store, result.data.item);
      if (result.data?.item && result.data?.version) this.versionAccept(store, result.data.item.itemId, result.data.version);
    });
    return { code: 0, data: result.data, message: '' };
  }

  // a new item with its first version, in the folder named, else in the
  // default folder of the doc page of docPath (the document it is made
  // from), else in the default folder of the store; data: { item, version, isCreated }. a name
  // an item of the store has answers that item and creates nothing
  // (isCreated false).
  // dependencyList: what the data depends on (doc_page_impl_asset.md#dependencies)
  // saveMode: written into the item (absent: the store's default applies)
  // versionMetadata: the metadata of the first version
  // component: the component the data is for, when it is a component's data
  itemCreate(input: {
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
    return this.writeApply(input.store, () => this.backend!.itemCreate(input), 'The asset item was not created.');
  }

  // the head data replaced in place, or a new version from the head; mode
  // absent means the item's save mode. dependencyList absent keeps the
  // dependencies of the head version for the new data, versionMetadata absent
  // keeps its metadata.
  async itemUpdate(
    store: string,
    itemId: string,
    data: { text?: string; dataBase64?: string },
    mode?: AssetSaveMode,
    note = '',
    dependencyList?: AssetDependency[],
    versionMetadata?: AssetVersionMetadata,
  ): Promise<AssetResult> {
    const item = this.itemGet(store, itemId);
    const head = item ? this.versionGet(store, itemId, item.versionIdHead) : undefined;
    if (!item || head?.status !== 'done' || head.hash === undefined) {
      return { code: -1, message: 'The head version of the asset is not loaded.' };
    }
    const result = await this.writeApply(
      store,
      () => this.backend!.itemUpdate({ store, itemId, hashBase: head.hash, ...data, mode, note, dependencyList, versionMetadata }),
      'The asset was not updated.',
    );
    if (result.code === -2) void this.itemReload(store, itemId);
    return result;
  }

  // ---------- dependencies ----------

  // the dependencies of a loaded version, from the item metadata
  dependencyListGet(store: string, itemId: string, versionId: string): AssetDependency[] {
    const item = this.itemGet(store, itemId);
    const versionIdResolved = versionId === '' || versionId === 'head' ? item?.versionIdHead ?? '' : versionId;
    return item?.versionList.find((version) => version.versionId === versionIdResolved)?.dependencyList ?? [];
  }

  // the versions of the store depending on the item (versionId '' ) or on
  // one version of it; asked from the backend, since it needs every item
  async dependentListGet(store: string, itemId: string, versionId = ''): Promise<AssetResult> {
    if (!this.backend) return { code: -1, message: 'The page has no asset service layer.' };
    const result = await this.backend.dependentListGet(store, itemId, versionId);
    return result.code === 0 ? { code: 0, data: result.data, message: '' } : { code: result.code, message: result.message };
  }

  dependencyListSet(store: string, itemId: string, versionId: string, dependencyList: AssetDependency[]): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.dependencyListSet(store, itemId, versionId, dependencyList), 'The dependencies were not changed.');
  }

  dependencyAdd(store: string, itemId: string, versionId: string, dependency: AssetDependency): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.dependencyAdd(store, itemId, versionId, dependency), 'The dependency was not added.');
  }

  dependencyRemove(store: string, itemId: string, versionId: string, dependency: AssetDependency): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.dependencyRemove(store, itemId, versionId, dependency), 'The dependency was not removed.');
  }

  itemDelete(store: string, itemId: string): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.itemDelete(store, itemId), 'The asset item was not deleted.');
  }

  itemRestore(store: string, itemId: string): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.itemRestore(store, itemId), 'The asset item was not restored.');
  }

  // saveMode null and component null remove the key
  itemMetaSet(
    store: string,
    itemId: string,
    change: { name?: string; lang?: string; contentType?: string; saveMode?: AssetSaveMode | null; component?: AssetComponent | null },
  ): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.itemMetaSet(store, itemId, change), 'The asset item was not changed.');
  }

  versionCheckout(store: string, itemId: string, versionId: string): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.versionCheckout(store, itemId, versionId), 'The head was not moved.');
  }

  versionDelete(store: string, itemId: string, versionId: string): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.versionDelete(store, itemId, versionId), 'The version was not deleted.');
  }

  // the metadata of one version replaced; {} removes it
  versionMetadataSet(store: string, itemId: string, versionId: string, versionMetadata: AssetVersionMetadata): Promise<AssetResult> {
    return this.writeApply(
      store,
      () => this.backend!.versionMetadataSet(store, itemId, versionId, versionMetadata),
      'The metadata of the version was not changed.',
    );
  }

  itemLockSet(store: string, itemId: string, isLocked: boolean): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.itemLockSet(store, itemId, isLocked), 'The lock of the item was not changed.');
  }

  versionLockSet(store: string, itemId: string, versionId: string, isLocked: boolean): Promise<AssetResult> {
    return this.writeApply(store, () => this.backend!.versionLockSet(store, itemId, versionId, isLocked), 'The lock of the version was not changed.');
  }

  // the item's folder moved: into other group folders ('' the top), of its store folder or of
  // another one (doc_page_impl_asset.md#moving-an-item). a folder an object owns is that
  // object's: the move goes to the layer that answers for it, which may refuse it
  itemMove(store: string, itemId: string, place: { folder?: string; groupPath: string; kind?: string }): Promise<AssetResult> {
    const item = this.itemGet(store, itemId);
    if (!item) return Promise.resolve({ code: -3, message: `the asset item ${itemId} is not loaded` } as AssetResult);
    const folder = place.folder ?? item.folder;
    const ownerFrom = item.folderOwner?.ref;
    const ownerTo = this.folderList.find((one) => one.path === folder)?.owner?.ref;
    if (ownerFrom || ownerTo) {
      const handler = this.folderOwnerHandlerGet((ownerTo ?? ownerFrom)!);
      if (!handler) return Promise.resolve({ code: -5, message: `no layer answers for the folder of ${ownerTo ?? ownerFrom}` } as AssetResult);
      return handler.itemMove({ store, item, folder, groupPath: place.groupPath, kind: place.kind, ownerFrom, ownerTo });
    }
    return this.writeApply(store, () => this.backend!.itemMove(store, itemId, { folder, groupPath: place.groupPath }), 'The asset item was not moved.');
  }

  folderOwnerHandlerSet(namespace: string, handler: AssetFolderOwnerHandler) {
    this.folderOwnerHandlerByNamespace.set(namespace, handler);
  }

  folderOwnerHandlerGet(ownerRef: string): AssetFolderOwnerHandler | undefined {
    return this.folderOwnerHandlerByNamespace.get(String(ownerRef).split(':')[0]);
  }

  // what a folder holds now, read from the index, so it follows every move
  folderItemListGet(folderPath: string): AssetItem[] {
    return this.itemList.filter((item) => item.folder === folderPath);
  }

  settingsFolderSet(folderPath: string) {
    this.settingsFolderPath = folderPath;
    this.settingsPanelClose();
  }

  // items another layer wrote through the same backend (the frontend
  // object service layer: an item and its entry in one request), taken as
  // the index would bring them; a deleted item stays, marked
  itemListAccept(store: string, itemList: AssetItem[]) {
    runInAction(() => {
      for (const item of itemList) {
        const itemBefore = this.itemGet(store, item.itemId);
        this.itemAccept(store, item);
        // the head moved or was rewritten: its data is read again when used
        if (itemBefore && itemBefore.versionIdHead === item.versionIdHead) {
          const versionHeadBefore = itemBefore.versionList.find((version) => version.versionId === item.versionIdHead);
          const versionHead = item.versionList.find((version) => version.versionId === item.versionIdHead);
          if (versionHeadBefore?.hash !== versionHead?.hash) delete this.versionByKey[versionKeyGet(store, item.itemId, item.versionIdHead)];
        }
      }
    });
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
    const rootPathList = this.docPageList.flatMap((one) => one.rootPathList);
    if (!rootPathList.includes(rootPath)) return `no root ${rootPath} (roots: ${rootPathList.join(', ') || 'none'})`;
    if (parsed.relPath === '') return 'a whole root cannot be an asset folder';
    const folder = this.folderList.find((one) => one.path === text);
    if (folder && !folder.isExists) return `${text} does not exist yet; it is created when the first item is written to it`;
    return '';
  }

  // the folders and default folder of one doc page written into its asset
  // store config (the server rewrites the file in place), then the store
  // read again: the set of items changed with the folders
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

  // ---------- usage: which blocks reference which item (doc_page_impl_asset.md#usage) ----------

  // every document's references, read at start (after the item index, so
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

  // the item a use reads ('' when its reference is not valid, or names a
  // name no item has)
  usageItemIdGet(usage: AssetUsage): string {
    if (usage.reference.message) return '';
    return usage.reference.itemId || this.itemIdGetByName(usage.reference.store, usage.reference.name);
  }

  // every use, keyed by the item it reads (`${store}/${itemId}`)
  get usageListByItemKey(): Map<string, AssetUsage[]> {
    const usageListByKey = new Map<string, AssetUsage[]>();
    for (const doc of Object.values(this.usageByDocPath)) {
      for (const usage of doc.usageList) {
        const itemId = this.usageItemIdGet(usage);
        if (!itemId) continue;
        const key = itemKeyGet(usage.reference.store, itemId);
        const usageList = usageListByKey.get(key) ?? [];
        usageList.push(usage);
        usageListByKey.set(key, usageList);
      }
    }
    return usageListByKey;
  }

  usageListGet(store: string, itemId: string): AssetUsage[] {
    return this.usageListByItemKey.get(itemKeyGet(store, itemId)) ?? [];
  }

  usageCountGet(store: string, itemId: string): AssetUsageCount {
    const count: AssetUsageCount = { head: 0, byVersionId: {} };
    for (const usage of this.usageListGet(store, itemId)) {
      if (usage.reference.versionId === 'head') count.head += 1;
      else count.byVersionId[usage.reference.versionId] = (count.byVersionId[usage.reference.versionId] ?? 0) + 1;
    }
    return count;
  }

  // why a use does not resolve to data ('' when it does, or while the
  // index is not read): the reference is not valid, names an unknown store
  // or item, or a version the item does not have
  usageProblemGet(usage: AssetUsage): string {
    if (usage.reference.message) return usage.reference.message;
    if (this.index.status !== 'done') return '';
    if (this.storeIdList.length > 0 && !this.storeIdIs(usage.reference.store)) return `unknown asset store: ${usage.reference.store}`;
    const itemId = this.usageItemIdGet(usage);
    if (!itemId) return `no item is named "${usage.reference.name}"`;
    const item = this.itemGet(usage.reference.store, itemId);
    if (!item) return `item ${itemId} is not in the store`;
    if (usage.reference.versionId !== 'head' && !item.versionList.some((version) => version.versionId === usage.reference.versionId)) {
      return `version ${usage.reference.versionId} is not in the item`;
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

  // items that are a component's data (they declare it) and that no block
  // references: what was left behind when a block was removed without its
  // data, or what lost its block outside the page. undetermined (empty)
  // until the usage index is read.
  get orphanItemList(): AssetItem[] {
    if (this.usageIndex.status !== 'done') return [];
    return this.itemList.filter((item) => !item.isDeleted && item.component
      && this.usageListGet(ASSET_STORE_ID_LOCAL, item.itemId).length === 0);
  }

  // items no block references that declare no component and no owner: data of
  // another purpose, or data from before the declaration existed (an item with
  // an owner is used by that object, whatever the blocks do, and an item found
  // in the folder of an object is reported by that object)
  get unreferencedItemList(): AssetItem[] {
    if (this.usageIndex.status !== 'done') return [];
    return this.itemList.filter((item) => !item.isDeleted && !item.component && !item.owner && !item.folderOwner
      && this.usageListGet(ASSET_STORE_ID_LOCAL, item.itemId).length === 0);
  }

  // ---------- the events of the asset domain ----------

  async eventHandle(event: DocEvent): Promise<AssetResult | undefined> {
    if (event.type === 'assetRefreshRequest') return this.refreshHandle(event);
    if (event.type === 'assetTestCaseResultRequest') return this.testCaseResultHandle(event);
    return undefined;
  }

  // assetRefreshRequest: the item the component's data comes from
  // (event.source.asset) is read again from the store, so a change written
  // by another block or outside the page is seen now; the component
  // re-renders with it like every block reading the item. the answer says
  // whether the data the component reads changed: { versionIdHead, versionId,
  // hash, isChanged }
  private async refreshHandle(event: DocEvent): Promise<AssetResult> {
    const asset = event.source?.asset;
    if (!asset?.isFromAsset) {
      return { code: -1, message: 'assetRefreshRequest comes from a component whose data is not an asset (config.assetInfo.isFromAsset)' };
    }
    if (!this.backend) return { code: -1, message: this.unavailableReason };
    await this.itemReload(asset.store, asset.itemId);
    const item = this.itemGet(asset.store, asset.itemId);
    if (!item) return { code: -1, message: `asset item ${asset.itemId} is no longer in the store` };
    const versionId = asset.versionIdRef === 'head' ? item.versionIdHead : asset.versionId;
    const version = this.versionGet(asset.store, asset.itemId, versionId);
    return {
      code: 0,
      data: { versionIdHead: item.versionIdHead, versionId, hash: version?.hash ?? '', isChanged: versionId !== asset.versionId || version?.hash !== asset.hash },
      message: '',
    };
  }

  // assetTestCaseResultRequest { caseId, testerId, result, operator, evidence?,
  // timeTimezone, hashBase }: one result appended to the history of the
  // TestCaseTable item the component reads (event.source.asset), by the
  // dedicated route of the api (comp-mdx/test-case-table/). the write is a
  // head update: hashBase is the hash the component read when the cell was
  // opened, kept on purpose, so a result recorded meanwhile by somebody else
  // is a conflict (-2) the author sees before recording over it; the item
  // is then read again. the document is not written: the data belongs to
  // the item. a pinned reference cannot record (a write goes to the head).
  // the answer is the api's { item, version }, the version's hash being
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
        itemId: asset.itemId,
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
    if (result.code === -2) void this.itemReload(asset.store, asset.itemId);
    return result;
  }

  // ---------- the asset panels ----------

  get isPanelOpen(): boolean {
    return this.panel !== undefined;
  }

  // the popup, opened from the toolbar of a block; versionIdRef is what that
  // block reads, block what renders the data (for the preview) and where it
  // is. the preview pane stays open or closed from one panel to the next.
  panelOpen(store: string, itemId: string, versionIdRef = '', block?: AssetPanelBlock) {
    this.panel = new AssetPanelModel(this, { store, itemId, versionIdRef, block, isPreviewOpen: this.isPanelPreviewOpenLast });
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

  // the item shown in the settings panel's asset tab; choosing the item
  // shown closes it
  settingsPanelToggle(store: string, itemId: string) {
    if (this.settingsPanel?.isBusy) return;
    if (this.settingsPanel?.store === store && this.settingsPanel.itemId === itemId) {
      this.settingsPanel = undefined;
      return;
    }
    this.settingsPanel = new AssetPanelModel(this, { store, itemId });
  }

  settingsPanelClose() {
    if (this.settingsPanel?.isBusy) return;
    this.settingsPanel = undefined;
  }
}

// the effective save mode of an item: the written one, else in place
export function assetSaveModeGet(item: { saveMode?: AssetSaveMode } | undefined): AssetSaveMode {
  return item?.saveMode === 'newVersion' ? 'newVersion' : 'inPlace';
}

function itemKeyGet(store: string, itemId: string): string {
  return `${store}/${itemId}`;
}

function itemKeyParse(key: string): { store: string; itemId: string } {
  const indexSlash = key.indexOf('/');
  return { store: key.slice(0, indexSlash), itemId: key.slice(indexSlash + 1) };
}

function versionKeyGet(store: string, itemId: string, versionId: string): string {
  return `${store}/${itemId}#${versionId}`;
}

function nameKeyGet(store: string, name: string): string {
  return `${store}/${name}`;
}

// the lines of a place fall in the lines a change names
function usageIsInLines(usage: AssetUsage, docPath: string, lineStart: number, lineEnd: number): boolean {
  return usage.place.docPath === docPath && usage.place.sourceLine >= lineStart && usage.place.sourceLine <= lineEnd;
}
