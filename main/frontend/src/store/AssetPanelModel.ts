import { makeAutoObservable, runInAction } from 'mobx';
import type {
  AssetItem, AssetPanelBlock, AssetPoint, AssetResult, AssetSaveMode, AssetUsage, AssetUsageCount, AssetVersionMeta,
  AssetVersionState, DocAssetStore,
} from './DocAssetStore.js';
import { assetSaveModeGet } from './DocAssetStore.js';

// One asset panel: the view of one item (design: doc_page_impl_asset.md#the-frame-and-the-panel)
// with everything it is doing, and the actions that change the item from
// it. The page has two places that show an item this way, and each holds
// a panel of its own: the popup opened from the toolbar of a block
// (DocAssetStore.panel) and the detail of an item chosen in the settings
// panel's asset tab (DocAssetStore.settingsPanel). AssetPanel renders a
// panel, whichever place holds it; the state of one never changes the other.
//
//   store, itemId     the item shown
//   versionIdRef        the version the block that opened the panel reads:
//                       'head', an id, or '' when no block opened it
//   block               that block: what renders the data (the preview pane)
//                       and which use of the item it is (the usage list)
//   isPreviewOpen       the preview pane beside the panel is open
//   isEventListOpen     the event list of the item is unfolded
//   versionIdSelected   the version whose data is shown; '' when none
//   edit                the head text being edited
//   confirm             the deletion waiting for its confirmation
//   upload              a file being written as the head data
//   status, message     the last head / name / component / save mode / lock / restore action
//   usageRefresh        the documents of the usage list being read again, and what was found
//   usageNavigateMessage  why going to a use of the list failed

type AssetPanelEdit = { textDraft: string; status: 'editing' | 'submitting' | 'error'; message: string; pointStart?: AssetPoint };
type AssetPanelConfirm = { kind: 'versionDelete' | 'itemDelete'; versionId: string; status: 'confirming' | 'submitting' | 'error'; message: string };
type AssetPanelUpload = { fileName: string; status: 'submitting' | 'error'; message: string };
// moving the item to another place of the store (doc_page_impl_asset.md#moving-an-item)
type AssetPanelMove = { folder: string; groupPath: string; kind: string };
type AssetPanelUsageRefresh = { docPath: string; status: 'submitting' | 'done' | 'error'; message: string };

export class AssetPanelModel {
  assetStore: DocAssetStore;
  store: string;
  itemId: string;
  versionIdRef: string;
  block: AssetPanelBlock | undefined;
  isPreviewOpen: boolean;
  isEventListOpen = false;
  versionIdSelected: string;
  edit: AssetPanelEdit | undefined = undefined;
  confirm: AssetPanelConfirm | undefined = undefined;
  upload: AssetPanelUpload | undefined = undefined;
  status: 'idle' | 'submitting' = 'idle';
  message = '';
  usageRefresh: AssetPanelUsageRefresh | undefined = undefined;
  usageNavigateMessage = '';
  move: AssetPanelMove | undefined = undefined;

  constructor(
    assetStore: DocAssetStore,
    input: { store: string; itemId: string; versionIdRef?: string; block?: AssetPanelBlock; isPreviewOpen?: boolean },
  ) {
    this.assetStore = assetStore;
    this.store = input.store;
    this.itemId = input.itemId;
    this.versionIdRef = input.versionIdRef ?? '';
    this.block = input.block;
    this.isPreviewOpen = input.isPreviewOpen === true;
    this.versionIdSelected = assetStore.refVersionIdGet({ store: input.store, itemId: input.itemId, versionId: this.versionIdRef || 'head' });
    makeAutoObservable(this, { assetStore: false });
    void assetStore.refLoad({ store: this.store, itemId: this.itemId, versionId: 'head' });
    if (this.versionIdSelected) void assetStore.refLoad({ store: this.store, itemId: this.itemId, versionId: this.versionIdSelected });
  }

  get item(): AssetItem | undefined {
    return this.assetStore.itemGet(this.store, this.itemId);
  }

  // the versions of the item, newest first (the store appends versions in creation order)
  get versionList(): AssetVersionMeta[] {
    return this.item ? [...this.item.versionList].reverse() : [];
  }

  // the effective save mode: the written one, else in place
  get saveMode(): AssetSaveMode {
    return assetSaveModeGet(this.item);
  }

  // a write of the panel is pending
  get isBusy(): boolean {
    return this.status === 'submitting'
      || this.edit?.status === 'submitting'
      || this.confirm?.status === 'submitting'
      || this.upload?.status === 'submitting';
  }

  // the head version is locked: a save in place is refused, a new version is not
  get isHeadLocked(): boolean {
    const item = this.item;
    return Boolean(item?.versionList.find((version) => version.versionId === item.versionIdHead)?.isLocked);
  }

  // the save a leave without a choice makes (a pointer down outside the
  // text and its buttons): the item's save mode, a new version when that
  // mode would rewrite a locked head
  get saveModeOnLeave(): AssetSaveMode {
    return this.saveMode === 'inPlace' && this.isHeadLocked ? 'newVersion' : this.saveMode;
  }

  // the data the preview renders: the draft while the head text is edited,
  // else the data of the selected version. isDraft says which.
  get previewData(): { versionId: string; isDraft: boolean; version: AssetVersionState | undefined; text: string } {
    if (this.edit) {
      const versionIdHead = this.item?.versionIdHead ?? '';
      const head = versionIdHead ? this.assetStore.versionGet(this.store, this.itemId, versionIdHead) : undefined;
      return { versionId: versionIdHead, isDraft: true, version: head, text: this.edit.textDraft };
    }
    const version = this.versionIdSelected ? this.assetStore.versionGet(this.store, this.itemId, this.versionIdSelected) : undefined;
    return { versionId: this.versionIdSelected, isDraft: false, version, text: version?.text ?? '' };
  }

  // ---------- usage ----------

  // the blocks of the documents that reference the item, as the page last
  // read them (doc_page_impl_asset.md#usage)
  get usageList(): AssetUsage[] {
    return this.assetStore.usageListGet(this.store, this.itemId);
  }

  get usageCount(): AssetUsageCount {
    return this.assetStore.usageCountGet(this.store, this.itemId);
  }

  // the block that opened the panel is this use
  usageIsOfBlock(usage: AssetUsage): boolean {
    return Boolean(this.block)
      && usage.place.docPath === this.block!.sourcePath
      && usage.place.sourceLine === this.block!.sourceLine;
  }

  // reads the documents of the usage list again (one document, or every
  // document the list names when docPath is ''), to confirm what it says;
  // a use that is gone leaves the list, and the message says so
  async usageRefreshRun(docPath = ''): Promise<boolean> {
    if (this.usageRefresh?.status === 'submitting') return false;
    const docPathList = docPath ? [docPath] : [...new Set(this.usageList.map((usage) => usage.place.docPath))];
    const countBefore = this.usageList.filter((usage) => !docPath || usage.place.docPath === docPath).length;
    runInAction(() => {
      this.usageRefresh = { docPath, status: 'submitting', message: '' };
    });
    const result = await this.assetStore.usageDocListRead(docPathList);
    runInAction(() => {
      if (result.code !== 0) {
        this.usageRefresh = { docPath, status: 'error', message: result.message };
        return;
      }
      const countAfter = this.usageList.filter((usage) => !docPath || usage.place.docPath === docPath).length;
      const subject = docPath || 'the documents';
      let message = `read ${subject} again: confirmed`;
      if (countAfter < countBefore) message = `read ${subject} again: ${countBefore - countAfter} no longer there`;
      else if (countAfter > countBefore) message = `read ${subject} again: ${countAfter - countBefore} found in addition`;
      this.usageRefresh = { docPath, status: 'done', message };
    });
    return result.code === 0;
  }

  usageRefreshMessageClear() {
    if (this.usageRefresh?.status !== 'submitting') this.usageRefresh = undefined;
  }

  // why going to a use failed ('' after a success)
  usageNavigateMessageSet(message: string) {
    this.usageNavigateMessage = message;
  }

  // ---------- view ----------

  eventListToggle() {
    this.isEventListOpen = !this.isEventListOpen;
  }

  // selecting the selected version again unselects it
  versionSelect(versionId: string) {
    if (this.edit) return;
    this.versionIdSelected = this.versionIdSelected === versionId ? '' : versionId;
    this.confirm = undefined;
    this.message = '';
    if (this.versionIdSelected) void this.assetStore.refLoad({ store: this.store, itemId: this.itemId, versionId });
  }

  // ---------- the head text ----------

  // the text of the head becomes editable (the head only: an in-place save
  // rewrites the head, a new version branches from it). pointStart: where
  // the text was clicked; the caret is placed there.
  editStart(pointStart?: AssetPoint) {
    const item = this.item;
    if (!item || item.isDeleted || item.isLocked || !this.assetStore.isWritable) return;
    const head = this.assetStore.versionGet(this.store, this.itemId, item.versionIdHead);
    if (head?.status !== 'done' || !head.isText) return;
    this.versionIdSelected = item.versionIdHead;
    this.confirm = undefined;
    this.edit = { textDraft: head.text ?? '', status: 'editing', message: '', pointStart };
  }

  editCancel() {
    if (this.edit?.status === 'submitting') return;
    this.edit = undefined;
  }

  // leaving the text without a choice: an unchanged draft just closes, a
  // changed one is saved (saveModeOnLeave), as a block of the document is
  // saved when it is left; a failed save keeps the text open with its message
  async editLeave(): Promise<boolean> {
    const edit = this.edit;
    const item = this.item;
    if (!edit || !item || edit.status === 'submitting') return false;
    const head = this.assetStore.versionGet(this.store, this.itemId, item.versionIdHead);
    if (edit.textDraft === (head?.text ?? '')) {
      this.editCancel();
      return true;
    }
    return this.save(this.saveModeOnLeave);
  }

  draftSet(text: string) {
    const edit = this.edit;
    if (!edit || edit.status === 'submitting') return;
    edit.textDraft = text;
    if (edit.status === 'error') {
      edit.status = 'editing';
      edit.message = '';
    }
  }

  // saves the edited text: in place or as a new version when the mode is
  // given (the panel offers both), else with the item's save mode
  async save(mode?: AssetSaveMode): Promise<boolean> {
    const edit = this.edit;
    if (!edit || edit.status === 'submitting') return false;
    runInAction(() => {
      edit.status = 'submitting';
      edit.message = '';
    });
    const result = await this.assetStore.itemUpdate(this.store, this.itemId, { text: edit.textDraft }, mode);
    runInAction(() => {
      if (result.code !== 0) {
        edit.status = 'error';
        edit.message = result.message;
        return;
      }
      this.edit = undefined;
      this.versionIdSelected = result.data?.version?.versionId ?? this.versionIdSelected;
    });
    return result.code === 0;
  }

  // the bytes of a file become the head data (any file: text or not), with
  // the item's save mode or the mode given
  async uploadRun(file: File, mode?: AssetSaveMode): Promise<boolean> {
    if (this.isBusy) return false;
    runInAction(() => {
      this.edit = undefined;
      this.confirm = undefined;
      this.upload = { fileName: file.name, status: 'submitting', message: '' };
    });
    const dataBase64 = await fileBase64Read(file);
    const result = await this.assetStore.itemUpdate(this.store, this.itemId, { dataBase64 }, mode, file.name);
    runInAction(() => {
      if (result.code !== 0) {
        this.upload = { fileName: file.name, status: 'error', message: result.message };
        return;
      }
      this.upload = undefined;
      this.versionIdSelected = result.data?.version?.versionId ?? this.versionIdSelected;
    });
    return result.code === 0;
  }

  uploadMessageClear() {
    if (this.upload?.status === 'error') this.upload = undefined;
  }

  // ---------- deletions, confirmed in the panel ----------

  confirmSet(kind: 'versionDelete' | 'itemDelete', versionId = '') {
    if (this.confirm?.status === 'submitting') return;
    this.edit = undefined;
    this.confirm = { kind, versionId, status: 'confirming', message: '' };
  }

  confirmClear() {
    if (this.confirm?.status === 'submitting') return;
    this.confirm = undefined;
  }

  async confirmApply(): Promise<boolean> {
    const confirm = this.confirm;
    if (!confirm || confirm.status === 'submitting') return false;
    runInAction(() => {
      confirm.status = 'submitting';
      confirm.message = '';
    });
    const result = confirm.kind === 'versionDelete'
      ? await this.assetStore.versionDelete(this.store, this.itemId, confirm.versionId)
      : await this.assetStore.itemDelete(this.store, this.itemId);
    runInAction(() => {
      if (result.code !== 0) {
        confirm.status = 'error';
        confirm.message = result.message;
        return;
      }
      this.confirm = undefined;
      const item = this.item;
      if (item && !item.versionList.some((version) => version.versionId === this.versionIdSelected)) {
        this.versionIdSelected = '';
      }
    });
    return result.code === 0;
  }

  // ---------- the actions that share one status line ----------

  private async actionRun(request: () => Promise<AssetResult>): Promise<boolean> {
    if (this.status === 'submitting') return false;
    runInAction(() => {
      this.status = 'submitting';
      this.message = '';
    });
    const result = await request();
    runInAction(() => {
      this.status = 'idle';
      this.message = result.code === 0 ? '' : result.message;
    });
    return result.code === 0;
  }

  moveToggle() {
    const item = this.item;
    this.move = this.move || !item ? undefined : { folder: item.folder, groupPath: item.groupPath ?? '', kind: '' };
    this.message = '';
  }

  moveSet(change: Partial<AssetPanelMove>) {
    if (this.move) this.move = { ...this.move, ...change };
  }

  // where the item can go: every folder of the store that can be written, with what it is
  get moveFolderList(): { path: string; label: string; ownerRef: string }[] {
    return this.assetStore.folderList.filter((folder) => !folder.isReadOnly).map((folder) => {
      const ownerRef = folder.owner?.ref ?? '';
      const handler = ownerRef ? this.assetStore.folderOwnerHandlerGet(ownerRef) : undefined;
      return { path: folder.path, label: ownerRef ? `${handler?.labelGet(ownerRef) ?? ownerRef} (a frontend object)` : folder.path, ownerRef };
    });
  }

  // the object the chosen folder belongs to, when that is another one than now: it decides
  // what it takes, and may ask for a kind
  get moveOwnerRefIncoming(): string {
    const ownerRef = this.assetStore.folderList.find((folder) => folder.path === this.move?.folder)?.owner?.ref ?? '';
    return ownerRef && ownerRef !== this.item?.folderOwner?.ref ? ownerRef : '';
  }

  get moveKindList(): { id: string; label: string }[] | undefined {
    const ownerRef = this.moveOwnerRefIncoming;
    return ownerRef ? this.assetStore.folderOwnerHandlerGet(ownerRef)?.kindListGet(ownerRef) : undefined;
  }

  async moveRun(): Promise<boolean> {
    const move = this.move;
    if (!move) return false;
    const isDone = await this.actionRun(() => this.assetStore.itemMove(this.store, this.itemId, { folder: move.folder, groupPath: move.groupPath, kind: move.kind }));
    if (isDone) runInAction(() => { this.move = undefined; });
    return isDone;
  }

  headSet(versionId: string): Promise<boolean> {
    return this.actionRun(() => this.assetStore.versionCheckout(this.store, this.itemId, versionId));
  }

  nameSet(name: string): Promise<boolean> {
    return this.actionRun(() => this.assetStore.itemMetaSet(this.store, this.itemId, { name }));
  }

  // the component the data is for (doc_page_impl_asset.md#items-for-components);
  // an empty name removes it
  componentSet(name: string): Promise<boolean> {
    const nameTrimmed = String(name ?? '').trim();
    return this.actionRun(() => this.assetStore.itemMetaSet(this.store, this.itemId, {
      component: nameTrimmed ? { name: nameTrimmed } : null,
    }));
  }

  // the save mode written into the item's metadata; null removes the key
  // (the item then saves in place, the default)
  saveModeSet(saveMode: AssetSaveMode | null): Promise<boolean> {
    return this.actionRun(() => this.assetStore.itemMetaSet(this.store, this.itemId, { saveMode }));
  }

  itemRestore(): Promise<boolean> {
    return this.actionRun(() => this.assetStore.itemRestore(this.store, this.itemId));
  }

  itemLockSet(isLocked: boolean): Promise<boolean> {
    return this.actionRun(() => this.assetStore.itemLockSet(this.store, this.itemId, isLocked));
  }

  versionLockSet(versionId: string, isLocked: boolean): Promise<boolean> {
    return this.actionRun(() => this.assetStore.versionLockSet(this.store, this.itemId, versionId, isLocked));
  }
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
