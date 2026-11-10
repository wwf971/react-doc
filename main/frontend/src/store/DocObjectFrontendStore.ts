import { computed, makeAutoObservable, observable, runInAction, type IComputedValue } from 'mobx';
import { parse as yamlParse } from 'yaml';
import {
  OBJECT_FRONTEND_LIST_NAME, OBJECT_FRONTEND_ROLE_ENTRY, OBJECT_FRONTEND_TYPE_ROOT,
  objectFrontendAssetListMerge, objectFrontendEntryParse, objectFrontendListCovers, objectFrontendIdOfRefGet, objectFrontendModeChoose,
  objectFrontendModeListResolve, objectFrontendParamMerge, objectFrontendRefBuild,
  objectFrontendAssetIndexBuild, objectFrontendAssetPathComplete, objectFrontendAssetRefResolve, objectFrontendAssetSearch,
  objectFrontendAssetKindListResolve, objectFrontendPartitionListBuild, objectFrontendPartitionListResolve, objectFrontendPartitionOf,
} from '../lib/doc-object-frontend.js';
import { ASSET_STORE_ID_LOCAL } from '../lib/doc-asset-ref.js';

// The frontend object service layer of the page (design: doc_page_impl_obj_frontend.md).
//
// A frontend object is an object of the object registry whose data the page
// keeps itself: a "service" run in the page, its objects as free as the
// types the doc pages declare for them. What it is made of, and who is the
// truth of what:
//
//   the doc page's yaml     object-frontend.yaml: that the object exists (objectList
//                           [{ id, entry }]), and the types (typeList, with their modes)
//   the entry asset         what the object is: name, type, description, its assets
//                           ({ key, kind, itemId }), metadata
//   its other assets        its data, each declaring the object (owner.ref)
//
// The store holds what the development server read of the yaml files
// (config) and joins it with the asset store's index and the entry data it
// loads: objectGet(id) is the object as the files say now, with what does
// not agree (an asset listed and gone, an asset declaring the object and
// not listed: a stray, an entry no doc page lists: an orphan). It never
// keeps the objects' data itself: the asset store does.
//
//   config            the declarations of the doc pages (GET object-frontend/config)
//   write             the one structural write in progress (create, delete, an asset added ...)
//   settings          the state of the Frontend objects tab: the object chosen, the
//                     creation form, a question open
//   overrideByKey     the mode and parameters a block switched to without writing
//                     its document (a built page, or a switch asked not to be kept)
//
// The other layers: the asset store (DocAssetStore) for every byte, the
// object registry (DocObjectStore) for the types (a doc page's types are
// defined through this layer's provider, doc-object-provider-frontend.js)
// and for telling it that the objects changed.

type Stores = { assetStore: any; objectStore?: any; configStore?: any };

export type ObjectFrontendMode = {
  id: string; label: string; description: string; category: string; comp: string; param: Record<string, any>;
  isDefault: boolean; typeId: string;
};

export type ObjectFrontendAsset = {
  key: string;
  kind: string;
  itemId: string;
  // how people and the object's modes find it (doc_page_impl_obj_frontend.md#naming-and-finding-the-assets)
  name?: string;
  pathList?: string[];
  // the item list holding its record: its folder in the item folder ('' the top), null for the
  // entry (doc_page_impl_obj_frontend.md#the-item-lists)
  listGroupPath: string | null;
  // the partition it lies in ('' none): the first folder of its place, when the object has such a
  // partition (doc_page_impl_obj_frontend.md#partitions)
  partition: string;
  // the asset item as the index knows it; undefined when the store has none
  item: any;
  status: 'found' | 'missing' | 'deleted';
  // the asset declares this object (owner.ref)
  isOwnerMatch: boolean;
  // it lies in the object's folder; false for one lying elsewhere in the store (or an object
  // without a folder of its own, which has no such place)
  isInFolder: boolean;
};

export type ObjectFrontendState = {
  id: string;
  ref: string;
  docPageAlias: string;
  entryItemId: string;
  status: 'loading' | 'found' | 'missing' | 'error';
  message: string;
  name: string;
  typeId: string;
  description: string;
  metadata: Record<string, any>;
  assetList: ObjectFrontendAsset[];
  // the assets by key, path, name, id, and the folders their paths imply
  // (objectFrontendAssetIndexBuild); what an asset reference resolves against
  assetIndex: any;
  // assets declaring the object that its entry does not list
  strayList: any[];
  // items found in its folder that its entry does not list and that do not declare it: put
  // there without the layer knowing (doc_page_impl_obj_frontend.md#what-disagrees)
  unknownList: any[];
  // assets it lists that lie outside its folder
  outsideList: ObjectFrontendAsset[];
  // the folders inside its item folder, with how many items they hold
  groupList: { groupPath: string; count: number }[];
  // the folders its items are split into: declared by its type, then those found with an item list
  // ({ id, label, description, isGitIgnored, isDeclared, isPresent })
  partitionList: any[];
  problemList: string[];
  // the entry asset item (folder, groupPath, versions)
  entryItem: any;
};

export class DocObjectFrontendStore {
  stores: Stores;
  config = { status: 'idle' as 'idle' | 'loading' | 'done' | 'error', message: '', docPageList: [] as any[] };
  write = { status: 'idle' as 'idle' | 'submitting' | 'error', route: '', id: '', message: '' };
  settings = {
    // the kind chosen for an item coming in, by its id
    kindByItem: {} as Record<string, string>,
    idSelected: '',
    createDocPageAlias: '',
    createTypeId: '',
    createName: '',
    // a question asked in its row: delete the object (deleteObject) or one of its assets (assetRemove:{key})
    confirm: '' as string,
    // the asset a search of the chosen object's assets marked
    assetKeySelected: '',
    // the storage point chosen in the row of a partition asked to change its storage ('' the one it has)
    storagePointChosen: '',
  };
  overrideByKey = observable.map<string, { mode?: string; param?: Record<string, any> }>({}, { deep: false });
  // the sessions of the asset search uis (ObjectFrontendAssetSearchPanel), by the ui's key
  assetSearchSessionByKey = new Map<string, ObjectFrontendAssetSearchSession>();
  unsubscribe: (() => void) | undefined;
  configPromise: Promise<void> | undefined;
  // the object as the files say now, by id: worked out only when what it is made of
  // changed (the declarations, its entry, the index of the assets), not when the data
  // of an asset arrives. every read of a mode goes through it, many times per render
  objectStateById = new Map<string, IComputedValue<ObjectFrontendState>>();
  // the data of an asset as last parsed, by object id
  assetDataById = new Map<string, { text: string; data?: any; message?: string }>();
  // the assets asked for in this tick, read together
  loadRefByKey = new Map<string, any>();
  // the heavy parts of the modes that have their turn, and those waiting for it: a document
  // of many blocks mounts one per frame, so it is painted and answers meanwhile. a block is
  // known by its key (the block, not the mount): the mounts holding it are counted, and it
  // keeps its turn for a frame after the last one left, so the same block mounted again (the
  // document entering or leaving edit mode renders another body) draws at once
  blockDrawIdSet = observable.set<string>();
  blockDrawQueue: string[] = [];
  blockDrawFrameId: number | undefined;
  blockDrawHolderCountById = new Map<string, number>();

  constructor(stores: Stores) {
    this.stores = stores;
    makeAutoObservable(this, {
      stores: false,
      overrideByKey: false,
      assetSearchSessionByKey: false,
      unsubscribe: false,
      configPromise: false,
      objectStateById: false,
      assetDataById: false,
      loadRefByKey: false,
      blockDrawIdSet: false,
      blockDrawQueue: false,
      blockDrawFrameId: false,
      blockDrawHolderCountById: false,
      config: observable.ref,
    });
  }

  // the declarations are read once the asset store knows its backend; a
  // change of a file on disk (the page's own write, an editor) reads them again
  init() {
    const { assetStore } = this.stores;
    if (!assetStore.backend) return;
    void (assetStore.startPromise ?? Promise.resolve()).then(() => this.configLoad());
    assetStore.folderOwnerHandlerSet?.('frontend', {
      kindListGet: (ownerRef: string) => this.assetKindListGet(ownerRef),
      labelGet: (ownerRef: string) => {
        const state = this.objectGet(ownerRef);
        return state.name || ownerRef;
      },
      itemMove: (input: any) => this.folderOwnerItemMove(input),
    });
    this.unsubscribe = assetStore.subscribe?.((change: any) => {
      if (change?.isObjectFrontendChanged || change?.isStoreChanged) void this.configLoad();
    });
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  configLoad(): Promise<void> {
    const backend = this.stores.assetStore.backend;
    if (!backend?.objectFrontendConfigGet) return Promise.resolve();
    if (this.configPromise) return this.configPromise;
    runInAction(() => {
      this.config = { ...this.config, status: this.config.status === 'done' ? 'done' : 'loading' };
    });
    this.configPromise = backend.objectFrontendConfigGet().then((result: any) => {
      this.configAccept(result.code === 0
        ? { status: 'done', message: '', docPageList: result.data?.docPageList ?? [] }
        : { status: 'error', message: result.message, docPageList: this.config.docPageList });
    }).finally(() => {
      this.configPromise = undefined;
    });
    return this.configPromise;
  }

  // the declarations as read: kept as they are when nothing changed, so
  // what depends on them (the provider's version, the object registry's
  // answers) is asked again only when the files said something new
  private configAccept(config: DocObjectFrontendStore['config']) {
    const isSame = config.status === this.config.status && config.message === this.config.message
      && JSON.stringify(config.docPageList) === JSON.stringify(this.config.docPageList);
    if (isSame) return;
    runInAction(() => {
      this.config = config;
    });
    this.stores.objectStore?.changed('frontend');
  }

  // ---------- the declarations ----------

  get isAvailable(): boolean {
    return this.stores.assetStore.backendKind !== 'none' && this.config.status !== 'error';
  }

  get unavailableReason(): string {
    if (this.stores.assetStore.backendKind === 'none') return this.stores.assetStore.unavailableReason;
    if (this.config.status === 'error') return `The declarations of the frontend objects were not read: ${this.config.message}`;
    return '';
  }

  get writeUnavailableReason(): string {
    return this.stores.assetStore.writeUnavailableReason;
  }

  // why this object cannot be written: as the page, or as the read-only doc page holding it (a package)
  writeUnavailableReasonOf(idOrRef: string): string {
    const docPage = this.docPageList.find((one: any) => one.alias === this.declGet(objectFrontendIdOfRefGet(idOrRef))?.docPageAlias);
    return docPage?.isReadOnly ? `the objects of the package ${docPage.alias} are read-only` : this.writeUnavailableReason;
  }

  get docPageList(): any[] {
    return this.config.docPageList;
  }

  // the declared types that are types of a frontend object, in the order they are read
  // (doc_page_impl_type.md#declaring-a-type: the registry holds them, this layer reads their modes)
  get typeDeclaredList(): any[] {
    return (this.stores.objectStore?.typeDeclaredList ?? []).filter((type: any) => this.typeIsFrontend(type.id));
  }

  // the components the modes of a type name that no registered component answers to
  typeCompMissingListGet(typeId: string): string[] {
    const objectStore = this.stores.objectStore;
    if (!objectStore?.compIsKnown) return [];
    return [...new Set(this.modeListGet(typeId).map((mode: any) => mode.comp))].filter((comp: any) => !objectStore.compIsKnown(comp)) as string[];
  }

  // the types the layer offers for new objects: the root, then the declared ones
  get typeOfferList(): { id: string; label: string; docPageAlias: string }[] {
    return [
      { id: OBJECT_FRONTEND_TYPE_ROOT, label: this.typeLabelGet(OBJECT_FRONTEND_TYPE_ROOT), docPageAlias: '' },
      ...this.typeDeclaredList.map((type) => ({ id: type.id, label: type.label, docPageAlias: type.definedBy?.alias ?? type.definedBy?.name ?? '' })),
    ];
  }

  get problemList(): { alias: string; file: string; message: string }[] {
    return (this.stores.objectStore?.typeDeclaredProblemList ?? []).concat(this.config.docPageList.flatMap((docPage: any) => (docPage.problemList ?? []).map((message: string) => ({ alias: docPage.alias, file: docPage.file, message }))));
  }

  get declList(): { id: string; entry: string; docPageAlias: string; dir?: string }[] {
    return this.config.docPageList.flatMap((docPage: any) => docPage.objectList ?? []);
  }

  typeLabelGet(typeId: string): string {
    return this.stores.objectStore?.typeLabelGet(typeId) ?? this.typeDeclaredList.find((type) => type.id === typeId)?.label ?? typeId;
  }

  // the modes of a type: its own, then its ancestors' (the type registry's order)
  modeListGet(typeId: string): ObjectFrontendMode[] {
    const modeListByType: Record<string, any[]> = {};
    for (const type of this.typeDeclaredList) modeListByType[type.id] = type.modeList ?? [];
    const registry = this.stores.objectStore?.typeRegistry;
    const ancestorList = registry?.typeGet(typeId) ? registry.ancestorListGet(typeId) : [OBJECT_FRONTEND_TYPE_ROOT];
    return objectFrontendModeListResolve(typeId, ancestorList, modeListByType) as ObjectFrontendMode[];
  }

  // whether the type is a frontend object type (frontend.object or below it)
  typeIsFrontend(typeId: string): boolean {
    if (typeId === OBJECT_FRONTEND_TYPE_ROOT) return true;
    const registry = this.stores.objectStore?.typeRegistry;
    return registry ? registry.isAssignable(typeId, OBJECT_FRONTEND_TYPE_ROOT) : this.typeDeclaredList.some((type) => type.id === typeId);
  }

  // ---------- the objects ----------

  declGet(id: string) {
    return this.declList.find((decl) => decl.id === id);
  }

  // the object as the files say now. read in an observer, it asks the asset
  // store for the entry's data when it is not loaded yet (later, not while
  // rendering), the way the object registry resolves a reference
  objectGet(idOrRef: string): ObjectFrontendState {
    const id = objectFrontendIdOfRefGet(idOrRef);
    if (!id) return { ...this.objectStateBaseBuild(id), status: 'error', message: `${idOrRef || '(empty)'} names no frontend object: frontend:{id}` };
    let state = this.objectStateById.get(id);
    if (!state) {
      state = computed(() => this.objectStateBuild(id), { keepAlive: true });
      this.objectStateById.set(id, state);
    }
    return state.get();
  }

  private objectStateBaseBuild(id: string): ObjectFrontendState {
    const ref = objectFrontendRefBuild(id);
    return {
      id, ref, docPageAlias: '', entryItemId: '', status: 'loading', message: '', name: '', typeId: OBJECT_FRONTEND_TYPE_ROOT,
      description: '', metadata: {}, assetList: [], assetIndex: objectFrontendAssetIndexBuild([]), strayList: [], unknownList: [], outsideList: [], groupList: [], partitionList: [], problemList: [], entryItem: undefined,
    };
  }

  private objectStateBuild(id: string): ObjectFrontendState {
    const ref = objectFrontendRefBuild(id);
    const base = this.objectStateBaseBuild(id);
    if (this.config.status === 'idle' || (this.config.status === 'loading' && this.declList.length === 0)) return base;
    const decl = this.declGet(id);
    if (!decl) return { ...base, status: 'missing', message: `no doc page holds the frontend object ${id} (a folder in .doc-page/object-frontend/, or a line of object-frontend.yaml)` };
    const { assetStore } = this.stores;
    const refEntry = { store: ASSET_STORE_ID_LOCAL, itemId: decl.entry, versionId: 'head' };
    const query = assetStore.refQuery(refEntry);
    const stateBase = { ...base, docPageAlias: decl.docPageAlias, entryItemId: decl.entry };
    if (query.status === 'loading') {
      this.loadSchedule(refEntry);
      return stateBase;
    }
    if (query.status === 'error') return { ...stateBase, status: 'error', message: `its entry asset ${decl.entry}: ${query.message}` };
    const entryItem = query.item;
    if (entryItem.isDeleted) return { ...stateBase, entryItem, status: 'missing', message: `its entry asset ${decl.entry} is deleted` };
    if (!query.version?.isText) return { ...stateBase, entryItem, status: 'error', message: `its entry asset ${decl.entry} is not text` };
    const { entry, problemList } = objectFrontendEntryParse(query.version.text);
    if (entryItem.owner?.ref !== ref || entryItem.owner?.role !== OBJECT_FRONTEND_ROLE_ENTRY) {
      problemList.push(`the entry asset does not declare the object (owner: { ref: ${ref}, role: entry })`);
    }
    if (!this.typeIsFrontend(entry.type)) problemList.push(`the type ${entry.type} is not a frontend object type: it is drawn as ${OBJECT_FRONTEND_TYPE_ROOT}`);
    // the records: of the entry (an object without a folder of its own, or one written before item
    // lists), then of the item lists the server read in its folder
    const merged = objectFrontendAssetListMerge(entry.assetList, decl.listList ?? []);
    const partitionDeclaredList = this.partitionListOfTypeGet(entry.type);
    const groupPathInFolderList = assetStore.itemList.filter((item: any) => item.folderOwner?.ref === ref && !item.isDeleted && item.itemId !== decl.entry).map((item: any) => item.groupPath ?? '');
    // each partition with the storage point holding it (doc_page_impl_asset_storage.md): what its
    // partition.yaml says, read with the declarations; the point its type declares for one not made
    // yet; file-tree otherwise
    const bindList: any[] = decl.partitionStorageList ?? [];
    const partitionList = (decl.dir
      ? objectFrontendPartitionListBuild(partitionDeclaredList, (decl.listList ?? []).map((list: any) => list.groupPath), groupPathInFolderList, bindList.map((one) => one.partition))
      : []
    ).map((partition: any) => {
      const bind = bindList.find((one) => one.partition === partition.id)
        ?? (!partition.isPresent && partition.storagePoint ? { pointId: partition.storagePoint, typeId: assetStore.storagePointGet?.(partition.storagePoint, decl.docPageAlias)?.typeId ?? '' } : undefined);
      return { ...partition, storage: assetStore.storageOfBindGet?.(bind, decl.docPageAlias) ?? { pointId: 'file-tree', typeId: 'file-tree', isAvailable: true, unavailableReason: '', pointIdClaimed: '', apiSetList: [] } };
    });
    for (const partition of partitionList) {
      if (partition.storage.unavailableReason) problemList.push(`the partition ${partition.id}: ${partition.storage.unavailableReason}`);
      else if (partition.storage.pointIdClaimed) problemList.push(`the partition ${partition.id} names the storage point ${partition.storage.pointId}, which is gone: it is read through ${partition.storage.pointIdClaimed}; set its storage to keep it so`);
    }
    // a type declaring partitions keeps every asset in one of them (doc_page_impl_obj_frontend.md#partitions)
    if (decl.dir && partitionDeclaredList?.length) {
      const outsideCount = groupPathInFolderList.filter((groupPath: string) => !partitionDeclaredList.some((one: any) => groupPath === one.id || groupPath.startsWith(`${one.id}/`))).length;
      if (outsideCount > 0) problemList.push(`${outsideCount} asset(s) lie outside the partitions of its type (${partitionDeclaredList.map((one: any) => one.id).join(', ')}): move them into one`);
    }
    problemList.push(...merged.problemList);
    if (decl.dir && entry.assetList.length > 0) {
      problemList.push(`its entry lists ${entry.assetList.length} asset(s), the place of the list before item lists: "react-doc migrate" moves them to item-list.yaml`);
    }
    const assetList: ObjectFrontendAsset[] = merged.assetList.map((asset: any) => {
      const item = assetStore.itemGet(ASSET_STORE_ID_LOCAL, asset.itemId);
      return {
        ...asset,
        item,
        status: !item ? 'missing' : item.isDeleted ? 'deleted' : 'found',
        isOwnerMatch: item?.owner?.ref === ref,
        isInFolder: item?.folderOwner?.ref === ref,
        partition: item?.folderOwner?.ref === ref ? objectFrontendPartitionOf(partitionList, item.groupPath) : '',
      };
    });
    // a record kept in a list away from its item: a folder kept out of git would then keep a
    // record of nothing, or leave a record behind in a list git keeps
    for (const asset of assetList) {
      if (asset.listGroupPath === null || !asset.isInFolder || objectFrontendListCovers(asset.listGroupPath, asset.item?.groupPath ?? '')) continue;
      problemList.push(`${asset.name || asset.key} lies in ${asset.item.groupPath || 'the top'}, and is recorded in ${asset.listGroupPath}/${OBJECT_FRONTEND_LIST_NAME}, a list of another folder: Move it to bring the record along`);
    }
    const assetIndex = objectFrontendAssetIndexBuild(assetList);
    problemList.push(...assetIndex.problemList);
    const itemIdListed = new Set([decl.entry, ...merged.assetList.map((asset: any) => asset.itemId)]);
    const strayList = assetStore.itemList.filter((item: any) => item.owner?.ref === ref && !item.isDeleted && !itemIdListed.has(item.itemId));
    const itemInFolderList = assetStore.itemList.filter((item: any) => item.folderOwner?.ref === ref);
    const unknownList = itemInFolderList.filter((item: any) => item.owner?.ref !== ref && !item.isDeleted && !itemIdListed.has(item.itemId));
    const outsideList = decl.dir ? assetList.filter((asset: any) => asset.status === 'found' && !asset.isInFolder) : [];
    const countByGroup = new Map<string, number>();
    for (const item of itemInFolderList) countByGroup.set(item.groupPath ?? '', (countByGroup.get(item.groupPath ?? '') ?? 0) + 1);
    const groupList = [...countByGroup.entries()].map(([groupPath, count]) => ({ groupPath, count })).sort((a, b) => a.groupPath.localeCompare(b.groupPath));
    return {
      ...stateBase,
      status: 'found',
      entryItem,
      name: entry.name,
      typeId: this.typeIsFrontend(entry.type) ? entry.type : OBJECT_FRONTEND_TYPE_ROOT,
      description: entry.description,
      metadata: entry.metadata,
      assetList,
      assetIndex,
      strayList,
      unknownList,
      outsideList,
      groupList,
      partitionList,
      problemList,
    };
  }

  // the entry assets no doc page lists any more: declared with role entry, not deleted
  get orphanEntryList(): { id: string; item: any }[] {
    const idSet = new Set(this.declList.map((decl) => decl.id));
    const list: { id: string; item: any }[] = [];
    for (const item of this.stores.assetStore.itemList) {
      if (item.isDeleted || item.owner?.role !== OBJECT_FRONTEND_ROLE_ENTRY) continue;
      const id = objectFrontendIdOfRefGet(item.owner.ref);
      if (id && item.owner.ref.startsWith('frontend:') && !idSet.has(id)) list.push({ id, item });
    }
    return list;
  }

  // ---------- finding the assets of an object ----------
  // (doc_page_impl_obj_frontend.md#naming-and-finding-the-assets) an asset
  // reference is a path (/book/sci-fi/dune), a key (book-1, key:book-1), a
  // name (name:Dune) or an id (id:w5j…); every read below takes one

  // what an asset reference names in an object: { status: found | missing |
  // deleted | unknown | loading, asset?, by, message }. missing and deleted
  // say which asset the object lists, so a mode can tell its reader what is gone
  assetResolve(idOrRef: string, assetRef: string): { status: string; asset?: ObjectFrontendAsset; by: string; message: string } {
    const state = this.objectGet(idOrRef);
    if (state.status !== 'found') return { status: state.status === 'loading' ? 'loading' : 'unknown', by: '', message: state.message };
    return objectFrontendAssetRefResolve(state.assetIndex, assetRef);
  }

  // the assets of an object found by words, the object search's way (kind:, name:, path:, key:, id:)
  assetSearch(idOrRef: string, text: string, options: { kindList?: string[]; limit?: number } = {}) {
    const state = this.objectGet(idOrRef);
    if (state.status !== 'found') return { tokenList: [], hitList: [], isTruncated: false, status: state.status, message: state.message };
    return { ...objectFrontendAssetSearch(state.assetList, text, options), status: 'found', message: '' };
  }

  // the candidates completing a typed path in an object: the folders and
  // assets of the folder typed so far
  assetComplete(idOrRef: string, text: string, options: { kindList?: string[]; base?: string } = {}) {
    const state = this.objectGet(idOrRef);
    if (state.status !== 'found') return [];
    return objectFrontendAssetPathComplete(state.assetIndex, text, options);
  }

  // the session of a search ui of the assets of one object, by the ui's key
  assetSearchSessionGet(key: string, options: { object: string; kindList?: string[] }): ObjectFrontendAssetSearchSession {
    let session = this.assetSearchSessionByKey.get(key);
    if (!session) {
      session = new ObjectFrontendAssetSearchSession(this, options.object, options.kindList ?? []);
      this.assetSearchSessionByKey.set(key, session);
    } else if (session.object !== options.object) {
      session.objectSet(options.object);
    }
    return session;
  }

  // the data of one asset of an object, by an asset reference: { status, text, object, versionId, assetStatus };
  // asks the asset store for it when it is not loaded yet. an asset the object
  // lists and the store lacks is an error saying so (assetStatus missing | deleted)
  assetTextGet(idOrRef: string, assetRef: string): { status: 'loading' | 'done' | 'error'; message: string; text: string; item?: any; versionId?: string; asset?: ObjectFrontendAsset; assetStatus?: string } {
    const resolved = this.assetResolve(idOrRef, assetRef);
    if (resolved.status === 'loading') return { status: 'loading', message: '', text: '' };
    if (resolved.status !== 'found') return { status: 'error', message: resolved.message, text: '', asset: resolved.asset, assetStatus: resolved.status };
    const asset = resolved.asset!;
    const key = asset.key;
    const refAsset = { store: ASSET_STORE_ID_LOCAL, itemId: asset.itemId, versionId: 'head' };
    const query = this.stores.assetStore.refQuery(refAsset);
    if (query.status === 'loading') {
      this.loadSchedule(refAsset);
      return { status: 'loading', message: '', text: '' };
    }
    if (query.status === 'error') return { status: 'error', message: query.message, text: '' };
    if (!query.version?.isText) return { status: 'error', message: `the asset ${key} is not text`, text: '', item: query.item, asset };
    return { status: 'done', message: resolved.message, text: query.version.text, item: query.item, versionId: query.versionId, asset, assetStatus: 'found' };
  }

  // the data of one asset read as yaml (or json), by an asset reference: what
  // assetTextGet answers and { data }. parsed once per text of the asset: the same
  // data comes back until the asset changes, so it is to be read and not changed
  assetDataGet(idOrRef: string, assetRef: string) {
    const result = this.assetTextGet(idOrRef, assetRef);
    if (result.status !== 'done') return { ...result, data: undefined };
    const itemId = result.item.itemId;
    let parsed = this.assetDataById.get(itemId);
    if (parsed?.text !== result.text) {
      try {
        parsed = { text: result.text, data: yamlParse(result.text) };
      } catch (error) {
        parsed = { text: result.text, message: String((error as any)?.message ?? error) };
      }
      this.assetDataById.set(itemId, parsed);
    }
    if (parsed.message !== undefined) return { ...result, status: 'error' as const, message: `the asset ${assetRef} is not yaml: ${parsed.message}`, data: undefined };
    return { ...result, data: parsed.data };
  }

  // what a render asks for together is read together, by the asset store's steps,
  // so the blocks waiting for it are drawn per step and not per asset
  private loadSchedule(ref: any) {
    const isFirst = this.loadRefByKey.size === 0;
    this.loadRefByKey.set(`${ref.store}\u0000${ref.itemId}\u0000${ref.versionId}`, ref);
    if (!isFirst) return;
    queueMicrotask(() => {
      const refList = [...this.loadRefByKey.values()];
      this.loadRefByKey.clear();
      void this.stores.assetStore.refListLoad(refList);
    });
  }

  // ---------- the turns of the blocks to draw ----------

  // a mode asks for its turn when what it draws is ready to mount, and answers when it
  // leaves; the frame between two blocks is what the browser paints and takes input in
  blockDrawIs(blockId: string): boolean {
    return this.blockDrawIdSet.has(blockId);
  }

  blockDrawAsk(blockId: string): () => void {
    this.blockDrawHolderCountById.set(blockId, (this.blockDrawHolderCountById.get(blockId) ?? 0) + 1);
    if (!this.blockDrawIdSet.has(blockId) && !this.blockDrawQueue.includes(blockId)) {
      this.blockDrawQueue.push(blockId);
      this.blockDrawNextSchedule();
    }
    return () => {
      const count = (this.blockDrawHolderCountById.get(blockId) ?? 1) - 1;
      this.blockDrawHolderCountById.set(blockId, count);
      if (count > 0) return;
      requestAnimationFrame(() => {
        if ((this.blockDrawHolderCountById.get(blockId) ?? 0) > 0) return;
        this.blockDrawHolderCountById.delete(blockId);
        this.blockDrawQueue = this.blockDrawQueue.filter((id) => id !== blockId);
        runInAction(() => this.blockDrawIdSet.delete(blockId));
      });
    };
  }

  private blockDrawNextSchedule() {
    if (this.blockDrawFrameId !== undefined) return;
    this.blockDrawFrameId = requestAnimationFrame(() => {
      this.blockDrawFrameId = undefined;
      const blockId = this.blockDrawQueue.shift();
      if (blockId !== undefined) runInAction(() => this.blockDrawIdSet.add(blockId));
      if (this.blockDrawQueue.length > 0) this.blockDrawNextSchedule();
    });
  }

  // ---------- writes ----------

  // a structural write on the development server; the asset items it
  // wrote and the declarations as they are now come back with the answer
  async writeRun(route: string, body: Record<string, any>): Promise<{ code: number; data?: any; message: string }> {
    const { assetStore } = this.stores;
    const reason = assetStore.writeUnavailableReason;
    if (reason) return { code: -1, message: reason };
    if (this.write.status === 'submitting') return { code: -1, message: 'another change of a frontend object is being written' };
    runInAction(() => {
      this.write = { status: 'submitting', route, id: String(body.id ?? ''), message: '' };
    });
    const result = await assetStore.backend.objectFrontendWrite(route, body);
    runInAction(() => {
      if (result.code !== 0) {
        this.write = { status: 'error', route, id: String(body.id ?? ''), message: result.message || 'the change was not written' };
        return;
      }
      this.write = { status: 'idle', route: '', id: '', message: '' };
      assetStore.itemListAccept(ASSET_STORE_ID_LOCAL, result.data?.itemList ?? []);
    });
    if (result.code === 0 && result.data?.config) this.configAccept({ status: 'done', message: '', docPageList: result.data.config.docPageList ?? [] });
    if (result.code === 0) this.stores.objectStore?.changed('frontend');
    return { code: result.code, data: result.data, message: result.message ?? '' };
  }

  // a failure said before anything is written (a path that does not read), where the writes say theirs
  writeMessageSet(id: string, message: string) {
    this.write = { status: 'error', route: '', id, message };
  }

  settingsAssetSelect(key: string) {
    this.settings.assetKeySelected = this.settings.assetKeySelected === key ? '' : key;
  }

  writeMessageClear() {
    if (this.write.status === 'error') this.write = { status: 'idle', route: '', id: '', message: '' };
  }

  create(input: { docPageAlias: string; typeId: string; name: string; description?: string }) {
    return this.writeRun('create', input);
  }

  delete(id: string, isAssetKept = false) {
    return this.writeRun('delete', { id, isAssetKept });
  }

  register(docPageAlias: string, entry: string) {
    return this.writeRun('register', { docPageAlias, entry });
  }

  metaSet(id: string, change: { name?: string; description?: string; typeId?: string; metadata?: Record<string, any> }) {
    return this.writeRun('meta/set', { id, ...change });
  }

  assetCreate(id: string, input: { key?: string; kind?: string; name?: string; pathList?: string[]; lang?: string; text: string; note?: string; saveMode?: string; groupPath?: string; partition?: string }) {
    return this.writeRun('asset/create', { id, ...input });
  }

  // how an asset is named and indexed: its name (null removes it), its
  // paths (replaced whole), its kind; a path of another asset is refused
  assetMetaSet(id: string, key: string, change: { name?: string | null; pathList?: string[]; kind?: string }) {
    return this.writeRun('asset/meta/set', { id, key, ...change });
  }

  assetRemove(id: string, key: string, isAssetKept = false) {
    return this.writeRun('asset/remove', { id, key, isAssetKept });
  }

  // the one door for an item coming in: from elsewhere, a stray, or of unknown source. the type
  // of the object decides (#what-a-type-accepts)
  assetAttach(id: string, itemId: string, input: { key?: string; kind?: string; name?: string; pathList?: string[]; groupPath?: string; isOwnerReplaced?: boolean } = {}) {
    return this.writeRun('asset/attach', { id, itemId, ...input });
  }

  // an item of its folder that it does not list sent away, kept in the store or deleted softly
  itemSendAway(id: string, itemId: string, input: { isAssetKept: boolean; folder?: string; groupPath?: string }) {
    return this.writeRun('asset/remove', { id, itemId, ...input });
  }

  // where a listed asset lies on disk, inside the folder of the object: its key, name and paths stay
  assetMove(id: string, key: string, groupPath: string) {
    return this.writeRun('asset/move', { id, key, groupPath });
  }

  // a folder inside the item folder renamed or moved, with what it holds
  assetGroupMove(id: string, groupFrom: string, groupTo: string) {
    return this.writeRun('asset/group/move', { id, groupFrom, groupTo });
  }

  // the assets the type of an object holds; undefined: any
  assetKindListGet(idOrRef: string): any[] | undefined {
    const state = this.objectGet(idOrRef);
    return state.status === 'found' ? this.assetKindListOfTypeGet(state.typeId) : undefined;
  }

  assetKindListOfTypeGet(typeId: string): any[] | undefined {
    return objectFrontendAssetKindListResolve(typeId, this.typeDeclaredList);
  }

  // the partitions a type declares; undefined: none
  partitionListOfTypeGet(typeId: string): any[] | undefined {
    return objectFrontendPartitionListResolve(typeId, this.typeDeclaredList);
  }

  // the apis of partitions, every object has them (doc_page_impl_obj_frontend.md#the-apis-of-partitions)
  //   storagePoint   the point it is bound to; absent: the one its type declares, else file-tree
  partitionCreate(id: string, partition: string, storagePoint?: string) {
    return this.writeRun('partition/create', storagePoint ? { id, partition, storagePoint } : { id, partition });
  }

  // the storage of a whole partition changed to another point: its items written by the type of
  // that point, nothing of the object's records changed (doc_page_impl_asset_storage.md
  // #changing-the-storage-of-a-partition)
  async partitionStorageSet(id: string, partition: string, storagePoint: string) {
    const result = await this.writeRun('partition/storage/set', { id, partition, storagePoint });
    void this.stores.assetStore.statusLoad?.();
    return result;
  }

  // what the pack files of a partition keep dead is dropped
  async partitionCompact(id: string, partition: string) {
    const result = await this.writeRun('partition/compact', { id, partition });
    void this.stores.assetStore.statusLoad?.();
    return result;
  }

  // the storage points an object may bind a partition to: those its doc page sees
  storagePointListGet(id: string): any[] {
    const decl = this.declList.find((one: any) => one.id === id);
    return this.stores.assetStore.storagePointListOfDocPageGet?.(decl?.docPageAlias ?? '') ?? [];
  }

  partitionRename(id: string, partitionFrom: string, partitionTo: string) {
    return this.writeRun('partition/rename', { id, partitionFrom, partitionTo });
  }

  partitionDelete(id: string, partition: string) {
    return this.writeRun('partition/delete', { id, partition });
  }

  // the answer of this layer to a move of the asset store touching the folder of an object
  // (doc_page_impl_asset.md#moving-an-item): into an object through its door, out through its
  // removal, inside it as a place on disk; an item of another object is taken from it
  folderOwnerItemMove(input: { item: any; folder: string; groupPath: string; kind?: string; ownerFrom?: string; ownerTo?: string }) {
    const { item, folder, groupPath, kind, ownerFrom, ownerTo } = input;
    if (item.owner?.role === OBJECT_FRONTEND_ROLE_ENTRY) return Promise.resolve({ code: -1, message: 'the entry of an object stays at the top of its folder' });
    const place = groupPath.trim() === '' ? undefined : groupPath;
    if (ownerTo && ownerTo === ownerFrom) {
      const id = objectFrontendIdOfRefGet(ownerTo);
      const asset = this.objectGet(id).assetList?.find((one: any) => one.itemId === item.itemId);
      if (!asset) return Promise.resolve({ code: -1, message: 'the object does not list this item: adopt it first (the Frontend objects tab)' });
      return this.assetMove(id, asset.key, groupPath);
    }
    if (ownerTo) {
      const isOwnerReplaced = Boolean(item.owner) && item.owner.ref !== ownerTo;
      return this.assetAttach(objectFrontendIdOfRefGet(ownerTo), item.itemId, { kind: kind || undefined, groupPath: place, isOwnerReplaced });
    }
    return this.itemSendAway(objectFrontendIdOfRefGet(ownerFrom!), item.itemId, { isAssetKept: true, folder, groupPath });
  }

  // the data of one asset replaced, by the asset's save mode: an ordinary
  // write of the asset store, which the object does not need to know of
  async assetWrite(idOrRef: string, assetRef: string, text: string, note = ''): Promise<{ code: number; message: string }> {
    const state = this.objectGet(idOrRef);
    const resolved = this.assetResolve(idOrRef, assetRef);
    if (resolved.status !== 'found') return { code: -1, message: resolved.message || `the object has no asset ${assetRef}` };
    const asset = resolved.asset!;
    const key = asset.key;
    const { assetStore } = this.stores;
    await assetStore.refLoad({ store: ASSET_STORE_ID_LOCAL, itemId: asset.itemId, versionId: 'head' });
    const result = await assetStore.itemUpdate(ASSET_STORE_ID_LOCAL, asset.itemId, { text }, undefined, note || `${key} of ${state.name || state.id}`);
    return { code: result.code, message: result.message };
  }

  // the metadata of the object written into its entry, a key at a time
  metadataSet(idOrRef: string, patch: Record<string, any>) {
    const state = this.objectGet(idOrRef);
    if (state.status !== 'found') return Promise.resolve({ code: -1, message: state.message || 'the object is not loaded' });
    const metadata = { ...state.metadata };
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (value === null || value === undefined) delete metadata[key];
      else metadata[key] = value;
    }
    return this.metaSet(state.id, { metadata });
  }

  // ---------- what a block switched to without writing its document ----------

  overrideGet(key: string) {
    return this.overrideByKey.get(key);
  }

  overrideSet(key: string, change: { mode?: string; param?: Record<string, any> } | undefined) {
    runInAction(() => {
      if (!change) this.overrideByKey.delete(key);
      else this.overrideByKey.set(key, { ...this.overrideByKey.get(key), ...change });
    });
  }

  // the mode a block draws and the parameters its component receives: the
  // block's own choice (or what it switched to), else the type's default
  modeResolve(state: ObjectFrontendState, modeIdAsked: string, paramBlock: Record<string, any>) {
    const modeList = this.modeListGet(state.typeId);
    const mode = objectFrontendModeChoose(modeList, modeIdAsked);
    return { modeList, mode, param: objectFrontendParamMerge(mode?.param, paramBlock) };
  }

  // ---------- the Frontend objects tab ----------

  settingsSelect(id: string) {
    this.settings.idSelected = this.settings.idSelected === id ? '' : id;
    this.settings.confirm = '';
    this.settings.assetKeySelected = '';
    this.writeMessageClear();
  }

  settingsOpen(id = '') {
    const { configStore } = this.stores;
    if (!configStore) return false;
    runInAction(() => {
      configStore.settingsOpenSet(true);
      configStore.settingsTabIdSet('objectFrontend');
      if (id) this.settings.idSelected = id;
    });
    return true;
  }

  settingsCreateSet(change: Partial<{ createDocPageAlias: string; createTypeId: string; createName: string }>) {
    Object.assign(this.settings, change);
  }

  settingsKindSet(itemId: string, kind: string) {
    this.settings.kindByItem = { ...this.settings.kindByItem, [itemId]: kind };
  }

  settingsConfirmSet(confirm: string) {
    this.settings.confirm = confirm;
    this.settings.storagePointChosen = '';
  }

  settingsStoragePointSet(pointId: string) {
    this.settings.storagePointChosen = pointId;
  }

  // the doc page a new object goes to: the one chosen, else the first that can hold one
  get settingsCreateDocPageAlias(): string {
    const docPageList = this.docPageList.filter((docPage: any) => !docPage.isDisabled && docPage.assetFolder);
    return docPageList.some((docPage: any) => docPage.alias === this.settings.createDocPageAlias)
      ? this.settings.createDocPageAlias
      : docPageList[0]?.alias ?? '';
  }

  async settingsCreateSubmit() {
    const typeId = this.settings.createTypeId || OBJECT_FRONTEND_TYPE_ROOT;
    const result = await this.create({ docPageAlias: this.settingsCreateDocPageAlias, typeId, name: this.settings.createName.trim() });
    if (result.code === 0) {
      runInAction(() => {
        this.settings.createName = '';
        this.settings.idSelected = result.data?.id ?? '';
      });
    }
    return result;
  }

  // an object created from a block's creation (the insert menu): of a type, named after it
  async createForInsert(typeId: string, docPath: string): Promise<{ code: number; ref?: string; message: string }> {
    const alias = docPath.startsWith('~') && docPath.includes(':') ? docPath.slice(1, docPath.indexOf(':')) : '';
    const docPage = this.docPageList.find((docPage: any) => docPage.alias === alias && !docPage.isDisabled && docPage.assetFolder)
      ?? this.docPageList.find((docPage: any) => !docPage.isDisabled && docPage.assetFolder);
    if (!docPage) return { code: -1, message: 'no doc page here can hold a frontend object (it needs an asset folder)' };
    const result = await this.create({ docPageAlias: docPage.alias, typeId, name: `New ${this.typeLabelGet(typeId).toLowerCase()}` });
    return result.code === 0 ? { code: 0, ref: objectFrontendRefBuild(result.data.id), message: '' } : { code: result.code, message: result.message };
  }
}

// the search of the assets of one object as a ui shows it: the text, the
// kinds it is narrowed to, the highlighted row. the result is read from the
// layer on every render (the assets are in memory), so it follows the object
export class ObjectFrontendAssetSearchSession {
  store: DocObjectFrontendStore;
  object: string;
  kindList: string[];
  text = '';
  indexActive = -1;

  constructor(store: DocObjectFrontendStore, object: string, kindList: string[]) {
    this.store = store;
    this.object = object;
    this.kindList = kindList;
    makeAutoObservable(this, { store: false });
  }

  get result() {
    return this.store.assetSearch(this.object, this.text, { kindList: this.kindList, limit: 50 });
  }

  get hitActive() {
    const hitList = this.result.hitList;
    return hitList[this.indexActive] ?? hitList[0];
  }

  objectSet(object: string) {
    this.object = object;
    this.indexActive = -1;
  }

  textSet(text: string) {
    this.text = text;
    this.indexActive = -1;
  }

  kindListSet(kindList: string[]) {
    this.kindList = kindList;
    this.indexActive = -1;
  }

  indexActiveMove(step: number) {
    const count = this.result.hitList.length;
    if (count === 0) return;
    this.indexActive = (this.indexActive + step + count) % count;
  }

  clear() {
    this.text = '';
    this.indexActive = -1;
  }
}
