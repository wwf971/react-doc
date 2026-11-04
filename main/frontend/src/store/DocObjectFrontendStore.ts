import { makeAutoObservable, observable, runInAction } from 'mobx';
import {
  OBJECT_FRONTEND_ROLE_ENTRY, OBJECT_FRONTEND_TYPE_ROOT,
  objectFrontendEntryParse, objectFrontendIdOfRefGet, objectFrontendModeChoose,
  objectFrontendModeListResolve, objectFrontendParamMerge, objectFrontendRefBuild,
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
//                           ({ key, kind, objectId }), metadata
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
  objectId: string;
  // the asset object as the index knows it; undefined when the store has none
  object: any;
  status: 'found' | 'missing' | 'deleted';
  // the asset declares this object (owner.ref)
  isOwnerMatch: boolean;
};

export type ObjectFrontendState = {
  id: string;
  ref: string;
  docPageAlias: string;
  entryObjectId: string;
  status: 'loading' | 'found' | 'missing' | 'error';
  message: string;
  name: string;
  typeId: string;
  description: string;
  metadata: Record<string, any>;
  assetList: ObjectFrontendAsset[];
  // assets declaring the object that its entry does not list
  strayList: any[];
  problemList: string[];
  // the entry asset object (folder, groupPath, versions)
  entryObject: any;
};

export class DocObjectFrontendStore {
  stores: Stores;
  config = { status: 'idle' as 'idle' | 'loading' | 'done' | 'error', message: '', docPageList: [] as any[] };
  write = { status: 'idle' as 'idle' | 'submitting' | 'error', route: '', id: '', message: '' };
  settings = {
    idSelected: '',
    createDocPageAlias: '',
    createTypeId: '',
    createName: '',
    // a question asked in its row: delete the object (deleteObject) or one of its assets (assetRemove:{key})
    confirm: '' as string,
  };
  overrideByKey = observable.map<string, { mode?: string; param?: Record<string, any> }>({}, { deep: false });
  unsubscribe: (() => void) | undefined;
  configPromise: Promise<void> | undefined;

  constructor(stores: Stores) {
    this.stores = stores;
    makeAutoObservable(this, {
      stores: false,
      overrideByKey: false,
      unsubscribe: false,
      configPromise: false,
      config: observable.ref,
    });
  }

  // the declarations are read once the asset store knows its backend; a
  // change of a file on disk (the page's own write, an editor) reads them again
  init() {
    const { assetStore } = this.stores;
    if (!assetStore.backend) return;
    void (assetStore.startPromise ?? Promise.resolve()).then(() => this.configLoad());
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

  get docPageList(): any[] {
    return this.config.docPageList;
  }

  // every type the doc pages declare, in loading order
  get typeDeclaredList(): any[] {
    return this.config.docPageList.flatMap((docPage: any) => docPage.typeList ?? []);
  }

  // the types the layer offers for new objects: the root, then the declared ones
  get typeOfferList(): { id: string; label: string; docPageAlias: string }[] {
    return [
      { id: OBJECT_FRONTEND_TYPE_ROOT, label: this.typeLabelGet(OBJECT_FRONTEND_TYPE_ROOT), docPageAlias: '' },
      ...this.typeDeclaredList.map((type) => ({ id: type.id, label: type.label, docPageAlias: type.definedBy?.alias ?? '' })),
    ];
  }

  get problemList(): { alias: string; file: string; message: string }[] {
    return this.config.docPageList.flatMap((docPage: any) => (docPage.problemList ?? []).map((message: string) => ({ alias: docPage.alias, file: docPage.file, message })));
  }

  get itemList(): { id: string; entry: string; docPageAlias: string }[] {
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

  itemGet(id: string) {
    return this.itemList.find((item) => item.id === id);
  }

  // the object as the files say now. read in an observer, it asks the asset
  // store for the entry's data when it is not loaded yet (later, not while
  // rendering), the way the object registry resolves a reference
  objectGet(idOrRef: string): ObjectFrontendState {
    const id = objectFrontendIdOfRefGet(idOrRef);
    const ref = objectFrontendRefBuild(id);
    const base: ObjectFrontendState = {
      id, ref, docPageAlias: '', entryObjectId: '', status: 'loading', message: '', name: '', typeId: OBJECT_FRONTEND_TYPE_ROOT,
      description: '', metadata: {}, assetList: [], strayList: [], problemList: [], entryObject: undefined,
    };
    if (!id) return { ...base, status: 'error', message: `${idOrRef || '(empty)'} names no frontend object: frontend:{id}` };
    if (this.config.status === 'idle' || (this.config.status === 'loading' && this.itemList.length === 0)) return base;
    const item = this.itemGet(id);
    if (!item) return { ...base, status: 'missing', message: `no doc page lists the frontend object ${id} (object-frontend.yaml)` };
    const { assetStore } = this.stores;
    const refEntry = { store: ASSET_STORE_ID_LOCAL, objectId: item.entry, versionId: 'head' };
    const query = assetStore.refQuery(refEntry);
    const stateBase = { ...base, docPageAlias: item.docPageAlias, entryObjectId: item.entry };
    if (query.status === 'loading') {
      this.loadSchedule(refEntry);
      return stateBase;
    }
    if (query.status === 'error') return { ...stateBase, status: 'error', message: `its entry asset ${item.entry}: ${query.message}` };
    const entryObject = query.object;
    if (entryObject.isDeleted) return { ...stateBase, entryObject, status: 'missing', message: `its entry asset ${item.entry} is deleted` };
    if (!query.version?.isText) return { ...stateBase, entryObject, status: 'error', message: `its entry asset ${item.entry} is not text` };
    const { entry, problemList } = objectFrontendEntryParse(query.version.text);
    if (entryObject.owner?.ref !== ref || entryObject.owner?.role !== OBJECT_FRONTEND_ROLE_ENTRY) {
      problemList.push(`the entry asset does not declare the object (owner: { ref: ${ref}, role: entry })`);
    }
    if (!this.typeIsFrontend(entry.type)) problemList.push(`the type ${entry.type} is not a frontend object type: it is drawn as ${OBJECT_FRONTEND_TYPE_ROOT}`);
    const assetList: ObjectFrontendAsset[] = entry.assetList.map((asset: any) => {
      const object = assetStore.objectGet(ASSET_STORE_ID_LOCAL, asset.objectId);
      return {
        ...asset,
        object,
        status: !object ? 'missing' : object.isDeleted ? 'deleted' : 'found',
        isOwnerMatch: object?.owner?.ref === ref,
      };
    });
    const objectIdListed = new Set([item.entry, ...entry.assetList.map((asset: any) => asset.objectId)]);
    const strayList = assetStore.objectList.filter((object: any) => object.owner?.ref === ref && !object.isDeleted && !objectIdListed.has(object.objectId));
    return {
      ...stateBase,
      status: 'found',
      entryObject,
      name: entry.name,
      typeId: this.typeIsFrontend(entry.type) ? entry.type : OBJECT_FRONTEND_TYPE_ROOT,
      description: entry.description,
      metadata: entry.metadata,
      assetList,
      strayList,
      problemList,
    };
  }

  // the entry assets no doc page lists any more: declared with role entry, not deleted
  get orphanEntryList(): { id: string; object: any }[] {
    const idSet = new Set(this.itemList.map((item) => item.id));
    const list: { id: string; object: any }[] = [];
    for (const object of this.stores.assetStore.objectList) {
      if (object.isDeleted || object.owner?.role !== OBJECT_FRONTEND_ROLE_ENTRY) continue;
      const id = objectFrontendIdOfRefGet(object.owner.ref);
      if (id && object.owner.ref.startsWith('frontend:') && !idSet.has(id)) list.push({ id, object });
    }
    return list;
  }

  // the data of one asset of an object, by its key: { status, text, object, versionId, hash };
  // asks the asset store for it when it is not loaded yet
  assetTextGet(idOrRef: string, key: string): { status: 'loading' | 'done' | 'error'; message: string; text: string; object?: any; versionId?: string } {
    const state = this.objectGet(idOrRef);
    if (state.status !== 'found') return { status: state.status === 'loading' ? 'loading' : 'error', message: state.message, text: '' };
    const asset = state.assetList.find((item) => item.key === key);
    if (!asset) return { status: 'error', message: `the object has no asset ${key}`, text: '' };
    const refAsset = { store: ASSET_STORE_ID_LOCAL, objectId: asset.objectId, versionId: 'head' };
    const query = this.stores.assetStore.refQuery(refAsset);
    if (query.status === 'loading') {
      this.loadSchedule(refAsset);
      return { status: 'loading', message: '', text: '' };
    }
    if (query.status === 'error') return { status: 'error', message: query.message, text: '' };
    if (!query.version?.isText) return { status: 'error', message: `the asset ${key} is not text`, text: '', object: query.object };
    return { status: 'done', message: '', text: query.version.text, object: query.object, versionId: query.versionId };
  }

  private loadSchedule(ref: any) {
    queueMicrotask(() => void this.stores.assetStore.refLoad(ref));
  }

  // ---------- writes ----------

  // a structural write on the development server; the asset objects it
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
      assetStore.objectListAccept(ASSET_STORE_ID_LOCAL, result.data?.objectList ?? []);
    });
    if (result.code === 0 && result.data?.config) this.configAccept({ status: 'done', message: '', docPageList: result.data.config.docPageList ?? [] });
    if (result.code === 0) this.stores.objectStore?.changed('frontend');
    return { code: result.code, data: result.data, message: result.message ?? '' };
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

  assetCreate(id: string, input: { key?: string; kind?: string; lang?: string; text: string; note?: string; saveMode?: string }) {
    return this.writeRun('asset/create', { id, ...input });
  }

  assetRemove(id: string, key: string, isAssetKept = false) {
    return this.writeRun('asset/remove', { id, key, isAssetKept });
  }

  assetAttach(id: string, objectId: string, input: { key?: string; kind?: string } = {}) {
    return this.writeRun('asset/attach', { id, objectId, ...input });
  }

  // the data of one asset replaced, by the asset's save mode: an ordinary
  // write of the asset store, which the object does not need to know of
  async assetWrite(idOrRef: string, key: string, text: string, note = ''): Promise<{ code: number; message: string }> {
    const state = this.objectGet(idOrRef);
    const asset = state.assetList.find((item) => item.key === key);
    if (!asset) return { code: -1, message: `the object has no asset ${key}` };
    const { assetStore } = this.stores;
    await assetStore.refLoad({ store: ASSET_STORE_ID_LOCAL, objectId: asset.objectId, versionId: 'head' });
    const result = await assetStore.objectUpdate(ASSET_STORE_ID_LOCAL, asset.objectId, { text }, undefined, note || `${key} of ${state.name || state.id}`);
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

  settingsConfirmSet(confirm: string) {
    this.settings.confirm = confirm;
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
    const docPage = this.docPageList.find((item: any) => item.alias === alias && !item.isDisabled && item.assetFolder)
      ?? this.docPageList.find((item: any) => !item.isDisabled && item.assetFolder);
    if (!docPage) return { code: -1, message: 'no doc page here can hold a frontend object (it needs an asset folder)' };
    const result = await this.create({ docPageAlias: docPage.alias, typeId, name: `New ${this.typeLabelGet(typeId).toLowerCase()}` });
    return result.code === 0 ? { code: 0, ref: objectFrontendRefBuild(result.data.id), message: '' } : { code: result.code, message: result.message };
  }
}
