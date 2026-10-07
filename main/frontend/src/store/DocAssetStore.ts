import { makeAutoObservable, observable, runInAction } from 'mobx';
import { assetBackendApiCreate, assetBackendSnapshotCreate } from '../lib/doc-asset-backend.js';

// Asset store of the page (design: doc_page_impl_asset.md). It holds what
// the page knows of the asset objects: their metadata and the text of the
// versions in use, the one open asset panel, and every write to the store.
// Components never see it: the runtime boundary (CompAssetHost) asks it for
// the text of a reference and renders the component with that text.
//
//   backend        where the objects live: the asset api of the development
//                  server, or the snapshot bundled into a build (read-only)
//   isAvailable    the backend answered
//   isWritable     the backend accepts writes
//   objectById     metadata of every object read so far
//   textByKey      text of every version read so far, key `${objectId}#${versionId}`
//   panel          the one open asset panel: object, selected version, the
//                  text being edited, the pending confirmation
//
// a reference { objectId, versionId: 'head' | id } resolves through the
// object's versionIdHead, so moving the head changes what every document
// reading "head" shows. a change on disk reported by the development
// server (subscribe) reloads the object and the versions in use.

export type AssetVersionMeta = { versionId: string; versionIdPrevList: string[]; time: string; note: string };

export type AssetObject = {
  objectId: string;
  name: string;
  lang: string;
  fileExt: string;
  versionIdHead: string;
  isDeleted: boolean;
  timeCreated: string;
  timeUpdated: string;
  versionList: AssetVersionMeta[];
};

export type AssetRef = { objectId: string; versionId: string };

type AssetObjectState = { status: 'loading' | 'done' | 'error'; object?: AssetObject; message?: string };
type AssetTextState = { status: 'loading' | 'done' | 'error'; text?: string; hash?: string; message?: string };

// what a reference resolves to right now
export type AssetRefResult = {
  status: 'loading' | 'done' | 'error';
  message: string;
  object?: AssetObject;
  versionId: string;
  text?: string;
  hash?: string;
};

export type AssetResult = { code: number; data?: any; message: string };

export type AssetUpdateMode = 'inPlace' | 'newVersion';

export type AssetPanel = {
  objectId: string;
  // the version the frame that opened the panel reads: 'head', an id, or ''
  versionIdRef: string;
  // the version whose text is shown
  versionIdSelected: string;
  edit: { textDraft: string; status: 'editing' | 'submitting' | 'error'; message: string } | undefined;
  confirm: { kind: 'versionDelete' | 'objectDelete'; versionId: string; status: 'confirming' | 'submitting' | 'error'; message: string } | undefined;
  // state of the last head / name / restore action
  status: 'idle' | 'submitting';
  message: string;
};

export type DocAssetStoreOptions = {
  endpoint?: string;
  snapshot?: any;
  subscribe?: (listener: (change: { objectId: string }) => void) => () => void;
};

const messageConflict = 'The asset changed since it was loaded. It was reloaded; apply the change again.';

export class DocAssetStore {
  backend: ReturnType<typeof assetBackendApiCreate> | ReturnType<typeof assetBackendSnapshotCreate> | undefined;
  isAvailable = false;
  isWritable = false;
  objectById: Record<string, AssetObjectState> = {};
  textByKey: Record<string, AssetTextState> = {};
  panel: AssetPanel | undefined = undefined;
  subscribe: DocAssetStoreOptions['subscribe'];
  unsubscribe: (() => void) | undefined;
  reloadTimerByObjectId = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: DocAssetStoreOptions = {}) {
    if (options.endpoint) this.backend = assetBackendApiCreate(options.endpoint);
    else if (options.snapshot) this.backend = assetBackendSnapshotCreate(options.snapshot);
    this.subscribe = options.subscribe;
    makeAutoObservable(this, {
      backend: false,
      subscribe: false,
      unsubscribe: false,
      reloadTimerByObjectId: false,
      objectById: observable.shallow,
      textByKey: observable.shallow,
    });
  }

  init() {
    if (!this.backend) return;
    void this.availabilityCheck();
    this.unsubscribe = this.subscribe?.((change) => {
      if (change?.objectId) this.objectReloadSchedule(change.objectId);
    });
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const timer of this.reloadTimerByObjectId.values()) clearTimeout(timer);
    this.reloadTimerByObjectId.clear();
  }

  // one write to the folder is several file events (the data file, the
  // object file, its backup): the reload of an object runs once, shortly
  // after the last of them
  private objectReloadSchedule(objectId: string) {
    const timerPrevious = this.reloadTimerByObjectId.get(objectId);
    if (timerPrevious) clearTimeout(timerPrevious);
    this.reloadTimerByObjectId.set(objectId, setTimeout(() => {
      this.reloadTimerByObjectId.delete(objectId);
      if (this.objectById[objectId]) void this.objectReload(objectId);
    }, 150));
  }

  async availabilityCheck(): Promise<void> {
    if (!this.backend) return;
    const result = await this.backend.statusGet();
    runInAction(() => {
      this.isAvailable = result.code === 0;
      this.isWritable = result.code === 0 && result.data?.isWritable === true;
    });
  }

  // ---------- reading ----------

  objectGet(objectId: string): AssetObject | undefined {
    return this.objectById[objectId]?.object;
  }

  // the version a reference names right now, '' while the object is unknown
  refVersionIdGet(ref: AssetRef): string {
    if (ref.versionId !== 'head') return ref.versionId;
    return this.objectGet(ref.objectId)?.versionIdHead ?? '';
  }

  // the state of a reference, from what is loaded; refLoad() fills it
  refQuery(ref: AssetRef): AssetRefResult {
    if (!this.backend) return { status: 'error', message: 'The page has no asset store.', versionId: '' };
    const stateObject = this.objectById[ref.objectId];
    if (!stateObject || stateObject.status === 'loading') return { status: 'loading', message: '', versionId: '' };
    if (stateObject.status === 'error' || !stateObject.object) {
      return { status: 'error', message: stateObject.message ?? 'The asset object could not be read.', versionId: '' };
    }
    const object = stateObject.object;
    const versionId = this.refVersionIdGet(ref);
    const stateText = this.textByKey[textKeyGet(ref.objectId, versionId)];
    if (!stateText || stateText.status === 'loading') return { status: 'loading', message: '', object, versionId };
    if (stateText.status === 'error') {
      return { status: 'error', message: stateText.message ?? 'The asset version could not be read.', object, versionId };
    }
    return { status: 'done', message: '', object, versionId, text: stateText.text, hash: stateText.hash };
  }

  // loads what refQuery needs; nothing happens when it is already loaded
  async refLoad(ref: AssetRef): Promise<void> {
    if (!this.backend || !ref.objectId) return;
    const stateObject = this.objectById[ref.objectId];
    if (stateObject?.status !== 'done') {
      // unknown: read it; loading: the read in progress brings the head text
      // too; error: nothing to retry until the object is reloaded
      if (!stateObject) await this.versionLoad(ref.objectId, ref.versionId);
      return;
    }
    const versionId = this.refVersionIdGet(ref);
    if (!versionId || this.textByKey[textKeyGet(ref.objectId, versionId)]) return;
    await this.versionLoad(ref.objectId, versionId);
  }

  // one request reads the object and the text of one version
  private async versionLoad(objectId: string, versionIdRequested: string): Promise<void> {
    if (!this.backend) return;
    const isObjectKnown = Boolean(this.objectById[objectId]?.object);
    const versionIdKnown = versionIdRequested === 'head' ? this.objectGet(objectId)?.versionIdHead ?? '' : versionIdRequested;
    runInAction(() => {
      if (!isObjectKnown) this.objectById[objectId] = { status: 'loading' };
      if (versionIdKnown) this.textByKey[textKeyGet(objectId, versionIdKnown)] = { status: 'loading' };
    });
    const result = await this.backend.objectGet(objectId, versionIdRequested);
    runInAction(() => {
      if (result.code !== 0) {
        if (!isObjectKnown) this.objectById[objectId] = { status: 'error', message: result.message };
        if (versionIdKnown) this.textByKey[textKeyGet(objectId, versionIdKnown)] = { status: 'error', message: result.message };
        return;
      }
      this.objectAccept(result.data.object);
      this.versionTextAccept(objectId, result.data.version);
    });
  }

  // the object changed on disk: its metadata and every version text in use
  // are read again
  async objectReload(objectId: string): Promise<void> {
    if (!this.backend) return;
    const versionIdList = Object.keys(this.textByKey)
      .filter((key) => key.startsWith(`${objectId}#`))
      .map((key) => key.slice(objectId.length + 1));
    const result = await this.backend.objectGet(objectId, 'head');
    runInAction(() => {
      if (result.code !== 0) {
        this.objectById[objectId] = { status: 'error', message: result.message };
        return;
      }
      this.objectAccept(result.data.object);
      this.versionTextAccept(objectId, result.data.version);
    });
    for (const versionId of versionIdList) {
      if (versionId === result.data?.version?.versionId) continue;
      const resultVersion = await this.backend.objectGet(objectId, versionId);
      runInAction(() => {
        if (resultVersion.code === 0) this.versionTextAccept(objectId, resultVersion.data.version);
        else delete this.textByKey[textKeyGet(objectId, versionId)];
      });
    }
  }

  private objectAccept(object: AssetObject) {
    this.objectById[object.objectId] = { status: 'done', object };
    // versions that no longer exist (deleted) leave the text cache
    const versionIdSet = new Set(object.versionList.map((version) => version.versionId));
    for (const key of Object.keys(this.textByKey)) {
      if (key.startsWith(`${object.objectId}#`) && !versionIdSet.has(key.slice(object.objectId.length + 1))) {
        delete this.textByKey[key];
      }
    }
  }

  private versionTextAccept(objectId: string, version: { versionId: string; text: string; hash: string }) {
    this.textByKey[textKeyGet(objectId, version.versionId)] = { status: 'done', text: version.text, hash: version.hash };
  }

  versionTextGet(objectId: string, versionId: string): AssetTextState | undefined {
    return this.textByKey[textKeyGet(objectId, versionId)];
  }

  // ---------- writing ----------

  // every write: the backend answers, the fresh object (and version) replace
  // the loaded ones, the caller gets { code, data, message }
  private async writeApply(request: () => Promise<any>, messageFailure: string): Promise<AssetResult> {
    if (!this.backend) return { code: -1, message: 'The page has no asset store.' };
    if (!this.isWritable) return { code: -1, message: 'The asset store is read-only.' };
    const result = await request();
    if (result.code !== 0) {
      return { code: result.code, message: result.code === -2 ? messageConflict : result.message || messageFailure };
    }
    runInAction(() => {
      if (result.data?.object) this.objectAccept(result.data.object);
      if (result.data?.object && result.data?.version) this.versionTextAccept(result.data.object.objectId, result.data.version);
    });
    return { code: 0, data: result.data, message: '' };
  }

  // a new object with its first version; data: { object, version }
  objectCreate(input: { name?: string; lang?: string; text: string; note?: string }): Promise<AssetResult> {
    return this.writeApply(() => this.backend!.objectCreate(input), 'The asset object was not created.');
  }

  // the head text replaced in place, or a new version from the head
  async objectUpdate(objectId: string, text: string, mode: AssetUpdateMode, note = ''): Promise<AssetResult> {
    const object = this.objectGet(objectId);
    const head = object ? this.versionTextGet(objectId, object.versionIdHead) : undefined;
    if (!object || head?.status !== 'done' || head.hash === undefined) {
      return { code: -1, message: 'The head version of the asset is not loaded.' };
    }
    const result = await this.writeApply(
      () => this.backend!.objectUpdate({ objectId, hashBase: head.hash, text, mode, note }),
      'The asset was not updated.',
    );
    if (result.code === -2) void this.objectReload(objectId);
    return result;
  }

  objectDelete(objectId: string): Promise<AssetResult> {
    return this.writeApply(() => this.backend!.objectDelete(objectId), 'The asset object was not deleted.');
  }

  objectRestore(objectId: string): Promise<AssetResult> {
    return this.writeApply(() => this.backend!.objectRestore(objectId), 'The asset object was not restored.');
  }

  objectMetaSet(objectId: string, change: { name?: string; lang?: string }): Promise<AssetResult> {
    return this.writeApply(() => this.backend!.objectMetaSet(objectId, change), 'The asset object was not changed.');
  }

  versionCheckout(objectId: string, versionId: string): Promise<AssetResult> {
    return this.writeApply(() => this.backend!.versionCheckout(objectId, versionId), 'The head was not moved.');
  }

  versionDelete(objectId: string, versionId: string): Promise<AssetResult> {
    return this.writeApply(() => this.backend!.versionDelete(objectId, versionId), 'The version was not deleted.');
  }

  // ---------- the asset panel ----------

  get isPanelOpen(): boolean {
    return this.panel !== undefined;
  }

  // opened from the frame of a component; versionIdRef is what that frame reads
  panelOpen(objectId: string, versionIdRef = '') {
    const versionIdSelected = this.refVersionIdGet({ objectId, versionId: versionIdRef || 'head' });
    this.panel = {
      objectId,
      versionIdRef,
      versionIdSelected,
      edit: undefined,
      confirm: undefined,
      status: 'idle',
      message: '',
    };
    void this.refLoad({ objectId, versionId: 'head' });
    if (versionIdSelected) void this.refLoad({ objectId, versionId: versionIdSelected });
  }

  panelClose() {
    if (this.panel?.edit?.status === 'submitting' || this.panel?.confirm?.status === 'submitting') return;
    this.panel = undefined;
  }

  // the versions of the panel's object, newest first (the store appends
  // versions in creation order)
  get panelVersionList(): AssetVersionMeta[] {
    const object = this.panel ? this.objectGet(this.panel.objectId) : undefined;
    if (!object) return [];
    return [...object.versionList].reverse();
  }

  panelVersionSelect(versionId: string) {
    const panel = this.panel;
    if (!panel || panel.edit) return;
    panel.versionIdSelected = versionId;
    panel.message = '';
    void this.refLoad({ objectId: panel.objectId, versionId });
  }

  // the text of the selected version becomes editable (the head only: an
  // in-place save rewrites the head, a new version branches from it)
  panelEditStart() {
    const panel = this.panel;
    if (!panel) return;
    const object = this.objectGet(panel.objectId);
    if (!object) return;
    const head = this.versionTextGet(panel.objectId, object.versionIdHead);
    if (head?.status !== 'done') return;
    panel.versionIdSelected = object.versionIdHead;
    panel.confirm = undefined;
    panel.edit = { textDraft: head.text ?? '', status: 'editing', message: '' };
  }

  panelEditCancel() {
    if (!this.panel || this.panel.edit?.status === 'submitting') return;
    this.panel.edit = undefined;
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

  async panelSave(mode: AssetUpdateMode): Promise<boolean> {
    const panel = this.panel;
    const edit = panel?.edit;
    if (!panel || !edit || edit.status === 'submitting') return false;
    runInAction(() => {
      edit.status = 'submitting';
      edit.message = '';
    });
    const result = await this.objectUpdate(panel.objectId, edit.textDraft, mode);
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
      ? await this.versionDelete(panel.objectId, confirm.versionId)
      : await this.objectDelete(panel.objectId);
    runInAction(() => {
      if (result.code !== 0) {
        confirm.status = 'error';
        confirm.message = result.message;
        return;
      }
      if (this.panel !== panel) return;
      panel.confirm = undefined;
      const object = this.objectGet(panel.objectId);
      if (object && !object.versionList.some((version) => version.versionId === panel.versionIdSelected)) {
        panel.versionIdSelected = object.versionIdHead;
      }
    });
    return result.code === 0;
  }

  // the head / name / restore actions of the panel share one status line
  private async panelAction(request: () => Promise<AssetResult>): Promise<boolean> {
    const panel = this.panel;
    if (!panel || panel.status === 'submitting') return false;
    runInAction(() => {
      panel.status = 'submitting';
      panel.message = '';
    });
    const result = await request();
    runInAction(() => {
      panel.status = 'idle';
      panel.message = result.code === 0 ? '' : result.message;
    });
    return result.code === 0;
  }

  panelHeadSet(versionId: string): Promise<boolean> {
    const panel = this.panel;
    if (!panel) return Promise.resolve(false);
    return this.panelAction(() => this.versionCheckout(panel.objectId, versionId));
  }

  panelNameSet(name: string): Promise<boolean> {
    const panel = this.panel;
    if (!panel) return Promise.resolve(false);
    return this.panelAction(() => this.objectMetaSet(panel.objectId, { name }));
  }

  panelObjectRestore(): Promise<boolean> {
    const panel = this.panel;
    if (!panel) return Promise.resolve(false);
    return this.panelAction(() => this.objectRestore(panel.objectId));
  }
}

function textKeyGet(objectId: string, versionId: string): string {
  return `${objectId}#${versionId}`;
}
