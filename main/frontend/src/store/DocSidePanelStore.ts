import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocSourceFileStore } from './DocSourceFileStore.js';
import type { DocStore } from './DocStore.js';
import type { DocEditStore, EditPoint, EditResult } from './DocEditStore.js';
import { sidePanelItemIsMovable, sidePanelMoveResolve } from '../lib/side-panel-move.js';
import {
  sidePanelBindActionListGet,
  sidePanelBindResolve,
  sidePanelInsertResolve,
  sidePanelPathWrittenGet,
  sidePanelRemoveResolve,
} from '../lib/side-panel-node.js';
import { sourcePathBuild, sourcePathDirGet, sourcePathDocPageAliasGet, sourcePathIsInside } from '../lib/doc-source-path.js';

// The state of the side panel the page owns beyond what fumadocs keeps
// (design: doc_page_impl_side_panel.md#moving-an-item):
//
//   folderOpenById   item id -> whether the folder is open, as the reader
//                    left it. fumadocs keeps the open state inside each
//                    folder row, by position; a side panel rendered again
//                    (an item moved, the tree has another shape) would lose
//                    it, so DocSidebarFolder records it here and starts
//                    from it
//   drag             the item being dragged in edit mode, and where it
//                    would land (side-panel-drag.js measures the rows)
//   picker           the move picker: the item to move and the place chosen
//                    in the tree of the picker
//   move             the move being written, or the failure of the last
//                    one; the picker shows it for its item, otherwise the
//                    drag overlay does, at the point of the drop
//   contextMenu      the right-click menu of an item in edit mode: Rename,
//                    Move…, Refresh, the structure changes below; also
//                    opened by the "more" button of the label
//   dialog           the floating dialog of a structure change
//                    (doc_page_impl_side_panel.md#changing-the-structure):
//                    the label of a new folder, the document or source
//                    folder an item is bound to (or the confirmation of a
//                    detach), the confirmation of a removal with the choice
//                    to delete the item's document. a new document is
//                    placed through the location prompt of the source layer
//                    (DocSourceFileStore.locationChoose) instead
//   refresh          the item whose files are being read again, or the
//                    failure of the last refresh
//
// what a structure change is allowed to do and what it writes is decided in
// lib/side-panel-node.js; the change is one request of the edit api
// (POST side-panel/node), a document created or deleted with it included,
// recorded in the history like a move.
//
// whether a move is allowed and what it writes is decided once, in
// lib/side-panel-move.js (moveResolve); the drag, the picker and the event
// all ask there. the move itself arrives as the event
// sidePanelItemMoveRequest of the sidePanel route (doc_page_impl_event.md),
// from the drag or the picker, and is written through the edit api; the
// change is recorded in the history of the edit layer
// (DocEditStore.historyRecord). the new configuration comes back as data and
// rebuilds the side panel.

export type SidePanelMovePosition = 'before' | 'after' | 'insideFirst' | 'insideLast';

// where the drop indicator is drawn, in viewport coordinates: a line between
// rows (before / after / insideFirst) or a box around the row (insideLast)
export type SidePanelDropIndicator = {
  kind: 'line' | 'box';
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SidePanelDrop = {
  position: SidePanelMovePosition;
  targetItemId: string;
  isAllowed: boolean;
  isNoop: boolean;
  message: string;
  indicator: SidePanelDropIndicator;
};

export type SidePanelDrag = {
  itemId: string;
  label: string;
  point: EditPoint;
  drop: SidePanelDrop | undefined;
};

export type SidePanelMovePicker = {
  itemId: string;
  point: EditPoint | undefined;
  targetItemId: string;
};

// the context menu of one rendering of an item (a right click on its row)
export type SidePanelContextMenu = {
  itemId: string;
  instanceId: string;
  point: EditPoint;
};

export type SidePanelMove = {
  itemId: string;
  status: 'submitting' | 'error';
  message: string;
  point: EditPoint | undefined;
};

export type SidePanelInsertPosition = 'before' | 'after' | 'insideLast';

export type SidePanelNodeDialog = {
  // a new number for every dialog opened: an answer for an earlier one is dropped
  seq: number;
  kind: 'folderNew' | 'bind' | 'remove';
  itemId: string;
  point: EditPoint | undefined;
  // folderNew: where the folder goes and its label
  position: SidePanelInsertPosition;
  text: string;
  // bind: what the item is bound to ('none': the confirmation of a detach),
  // the path chosen in the picker (a full source path)
  bindKind: 'doc' | 'folder' | 'none';
  bindPath: string;
  // remove: the item's document is deleted with it (the documents that link
  // to it are read from the link index, DocLinkStore.referrerListGet)
  isFileDeleted: boolean;
  status: 'open' | 'submitting' | 'error';
  message: string;
};

export type SidePanelRefresh = {
  itemId: string;
  status: 'submitting' | 'error';
  message: string;
};

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any>; point?: EditPoint };

// the event types the sidePanel route of the event layer brings here
//   sidePanelItemInsertRequest { kind: 'folder' | 'doc', position }
//   sidePanelItemBindRequest   { kind: 'doc' | 'folder' | 'none' }
//   sidePanelItemRemoveRequest, sidePanelItemRefreshRequest
export const sidePanelEventTypeList = [
  'sidePanelItemMoveRequest',
  'sidePanelItemMovePickerOpenRequest',
  'sidePanelItemInsertRequest',
  'sidePanelItemBindRequest',
  'sidePanelItemRemoveRequest',
  'sidePanelItemRefreshRequest',
];

export const sidePanelDocExtList = ['md', 'mdx'];

const messageConflict = 'A side panel file changed on disk since the page loaded it. The new side panel is on its way; move the item again then.';
const messageConflictNode = 'The side panel file changed on disk since the page loaded it. The new side panel is on its way; try again then.';

export class DocSidePanelStore {
  sourceStore: DocSourceStore;
  sourceFileStore: DocSourceFileStore | undefined;
  docStore: DocStore;
  editStore: DocEditStore;
  folderOpenById: Record<string, boolean> = {};
  drag: SidePanelDrag | undefined = undefined;
  picker: SidePanelMovePicker | undefined = undefined;
  move: SidePanelMove | undefined = undefined;
  contextMenu: SidePanelContextMenu | undefined = undefined;
  dialog: SidePanelNodeDialog | undefined = undefined;
  refresh: SidePanelRefresh | undefined = undefined;
  dialogSeq = 0;

  constructor({ sourceStore, sourceFileStore, docStore, editStore }: {
    sourceStore: DocSourceStore;
    sourceFileStore?: DocSourceFileStore;
    docStore: DocStore;
    editStore: DocEditStore;
  }) {
    this.sourceStore = sourceStore;
    this.sourceFileStore = sourceFileStore;
    this.docStore = docStore;
    this.editStore = editStore;
    makeAutoObservable(this, {
      sourceStore: false,
      sourceFileStore: false,
      docStore: false,
      editStore: false,
    });
  }

  // ---------- folders ----------

  folderOpenGet(itemId: string, isOpenDefault: boolean): boolean {
    return this.folderOpenById[itemId] ?? isOpenDefault;
  }

  folderOpenSet(itemId: string, isOpen: boolean) {
    if (this.folderOpenById[itemId] === isOpen) return;
    this.folderOpenById[itemId] = isOpen;
  }

  // ---------- doc page sections ----------
  // a workspace of several root doc pages shows one section per doc page
  // (plugin/doc-entry.ts docPageSection); a section folds like a folder,
  // its open state kept in folderOpenById under its item id

  get sectionItemIdList(): string[] {
    const childList: any[] = (this.docStore.treePage as any)?.children ?? [];
    return childList.filter((node) => node?.docPageSection).map((node) => String(node.$id));
  }

  get sectionIsAnyClosed(): boolean {
    return this.sectionItemIdList.some((itemId) => !this.folderOpenGet(itemId, true));
  }

  get sectionIsAnyOpen(): boolean {
    return this.sectionItemIdList.some((itemId) => this.folderOpenGet(itemId, true));
  }

  sectionOpenAllSet(isOpen: boolean) {
    for (const itemId of this.sectionItemIdList) this.folderOpenSet(itemId, isOpen);
  }

  // ---------- what can move where ----------

  // items move in edit mode, with a development server writing the files
  get isMoveAvailable(): boolean {
    return this.editStore.isAvailable && this.editStore.isEditMode;
  }

  get isMoveSubmitting(): boolean {
    return this.move?.status === 'submitting';
  }

  get placeById(): Map<string, any> {
    return this.docStore.treeModel.itemPlaceById;
  }

  itemIsMovable(itemId: string): boolean {
    return this.isMoveAvailable && sidePanelItemIsMovable(this.placeById, itemId);
  }

  // the label of an item as the reader sees it, for messages and the picker
  itemTextGet(itemId: string): string {
    const outline = this.docStore.treeModel.itemOutlineById.get(itemId);
    if (!outline) return itemId;
    return this.docStore.textDisplayGet(outline.textLocalized).text || itemId;
  }

  // { code: 0, data: { request, isNoop, parentItemId } } or { code: -1, message }
  moveResolve(itemId: string, position: SidePanelMovePosition, targetItemId: string): EditResult {
    return sidePanelMoveResolve(this.placeById, itemId, position, targetItemId, (id: string) => this.itemTextGet(id));
  }

  // ---------- drag ----------

  dragStart(itemId: string, point: EditPoint): boolean {
    if (!this.itemIsMovable(itemId) || this.isMoveSubmitting) return false;
    this.picker = undefined;
    this.move = undefined;
    this.drag = { itemId, label: this.itemTextGet(itemId), point, drop: undefined };
    return true;
  }

  dragUpdate(point: EditPoint, drop: SidePanelDrop | undefined) {
    if (!this.drag) return;
    this.drag.point = point;
    this.drag.drop = drop;
  }

  dragEnd() {
    this.drag = undefined;
  }

  // ---------- picker ----------

  pickerOpen(itemId: string, point: EditPoint | undefined): boolean {
    if (!this.itemIsMovable(itemId) || this.isMoveSubmitting) return false;
    this.move = undefined;
    this.picker = { itemId, point, targetItemId: '' };
    return true;
  }

  pickerTargetSet(targetItemId: string) {
    if (!this.picker || this.isMoveSubmitting) return;
    this.picker.targetItemId = targetItemId;
  }

  pickerClose() {
    if (this.isMoveSubmitting && this.move?.itemId === this.picker?.itemId) return;
    this.picker = undefined;
    if (this.move?.status === 'error') this.move = undefined;
  }

  // ---------- context menu ----------

  // a right click while a menu is open opens a new one at the new point: the
  // open menu is closed first and the new one opened on the next frame, so
  // the menu never keeps a stale position
  contextMenuOpen(itemId: string, instanceId: string, point: EditPoint) {
    this.contextMenu = undefined;
    window.requestAnimationFrame(() => {
      runInAction(() => {
        this.contextMenu = { itemId, instanceId, point };
      });
    });
  }

  contextMenuClose() {
    this.contextMenu = undefined;
  }

  // ---------- the move ----------

  moveClear() {
    if (this.move?.status === 'error') this.move = undefined;
  }

  // the open block session is left (saved) first, like before any other
  // edit action. the files are refused when one changed since the page
  // built its side panel from them (fileHashByFile of the configuration).
  async moveApply(
    itemId: string,
    position: SidePanelMovePosition,
    targetItemId: string,
    point?: EditPoint,
  ): Promise<EditResult> {
    if (!this.isMoveAvailable || !this.editStore.api) return { code: -1, message: 'items are moved in edit mode' };
    if (this.isMoveSubmitting) return { code: -1, message: 'another move is being saved' };
    const resolved = this.moveResolve(itemId, position, targetItemId);
    if (resolved.code !== 0) return resolved;
    if (resolved.data.isNoop) return { code: 0, data: { fileChangeList: [] }, message: '' };

    this.move = { itemId, status: 'submitting', message: '', point };
    // the store keeps an observable copy of what is assigned: this one is
    // compared with this.move and changed later
    const move = this.move;
    const isLeft = await this.editStore.sessionLeave();
    if (!isLeft) return this.moveFail(move, 'The open edit could not be saved, so the item was not moved.');

    const { request } = resolved.data;
    const hashByFile = this.sourceStore.configDoc.docEntry?.fileHashByFile ?? {};
    const hashBaseByFile: Record<string, string> = {};
    for (const file of new Set([request.item.file, request.target.file])) hashBaseByFile[file] = hashByFile[file] ?? '';
    const result = await this.editStore.api.sidePanelItemMoveApply({ ...request, hashBaseByFile });
    if (result.code !== 0) {
      return this.moveFail(move, result.code === -2 ? messageConflict : result.message || 'The item was not moved.', result.code);
    }

    const fileChangeList = result.data?.fileChangeList ?? [];
    this.editStore.historyRecord({
      kind: 'sidePanelItemMove',
      time: Date.now(),
      fileChangeList: fileChangeList.map((change: any) => ({ scope: 'sidePanel', ...change })),
    });
    runInAction(() => {
      // the new parent is open, so the moved item is seen where it went
      if (resolved.data.parentItemId) this.folderOpenSet(resolved.data.parentItemId, true);
      if (this.move === move) this.move = undefined;
      if (this.picker?.itemId === itemId) this.picker = undefined;
    });
    return { code: 0, data: { fileChangeList }, message: '' };
  }

  private moveFail(move: SidePanelMove, message: string, code = -1): EditResult {
    runInAction(() => {
      if (this.move !== move) return;
      move.status = 'error';
      move.message = message;
    });
    return { code, message };
  }

  // ---------- structure changes: what an item allows ----------

  get isNodeChangeSubmitting(): boolean {
    return this.dialog?.status === 'submitting' || this.sourceFileStore?.prompt?.status === 'submitting';
  }

  insertResolve(itemId: string, position: SidePanelInsertPosition): EditResult {
    return sidePanelInsertResolve(this.placeById, itemId, position, (id: string) => this.itemTextGet(id));
  }

  removeResolve(itemId: string): EditResult {
    return sidePanelRemoveResolve(this.placeById, itemId, (id: string) => this.itemTextGet(id));
  }

  // [{ action: docChange | docBind | folderChange | folderBind | detach, reason }]
  bindActionListGet(itemId: string): { action: string; reason: string }[] {
    return sidePanelBindActionListGet(this.placeById, itemId, (id: string) => this.itemTextGet(id));
  }

  // the item is bound to a file or a folder whose content can be read again:
  // a document item (generated ones included) or a folder of the source
  itemIsRefreshable(itemId: string): boolean {
    if (!this.isMoveAvailable || !this.sourceStore.isWritable) return false;
    const place = this.placeById.get(itemId);
    return Boolean(place?.bindPath) && !place.isMissing;
  }

  get isRefreshSubmitting(): boolean {
    return this.refresh?.status === 'submitting';
  }

  // the roots of a doc page as full source paths: the places a path written
  // into a side-panel file of that doc page may name
  docPageRootPathListGet(docPageAlias: string): string[] {
    const docPage: any = this.sourceStore.docPageGet(docPageAlias);
    const rootList: any[] = docPage?.rootList ?? [];
    return rootList.map((root) => sourcePathBuild(root.alias, '', docPageAlias));
  }

  // what a binding picker offers: documents, or folders, of the item's doc page
  bindSpecGet(itemId: string, bindKind: 'doc' | 'folder'): any {
    const docPageAlias = this.placeById.get(itemId)?.docPageAlias ?? '';
    const rootList = this.docPageRootPathListGet(docPageAlias);
    const spec: any = bindKind === 'doc' ? { kind: 'file', extList: sidePanelDocExtList } : { kind: 'dir' };
    if (rootList.length > 0) spec.rootList = rootList;
    return spec;
  }

  // ---------- structure changes: dialogs ----------

  private dialogOpen(dialog: Partial<SidePanelNodeDialog> & { kind: SidePanelNodeDialog['kind']; itemId: string }) {
    this.picker = undefined;
    this.contextMenu = undefined;
    this.dialogSeq += 1;
    this.dialog = {
      seq: this.dialogSeq,
      point: undefined,
      position: 'after',
      text: '',
      bindKind: 'doc',
      bindPath: '',
      isFileDeleted: false,
      status: 'open',
      message: '',
      ...dialog,
    };
  }

  dialogClose() {
    if (this.dialog?.status === 'submitting') return;
    this.dialog = undefined;
  }

  dialogTextSet(text: string) {
    if (!this.dialog || this.dialog.status === 'submitting') return;
    this.dialog.text = text;
    this.dialogMessageClear();
  }

  dialogBindPathSet(path: string) {
    if (!this.dialog || this.dialog.status === 'submitting') return;
    this.dialog.bindPath = path;
    this.dialogMessageClear();
  }

  dialogFileDeletedSet(isFileDeleted: boolean) {
    if (!this.dialog || this.dialog.status === 'submitting') return;
    this.dialog.isFileDeleted = isFileDeleted;
  }

  private dialogMessageClear() {
    if (this.dialog?.status !== 'error') return;
    this.dialog.status = 'open';
    this.dialog.message = '';
  }

  // a new folder: its label is asked first
  insertFolderOpen(itemId: string, position: SidePanelInsertPosition, point?: EditPoint): EditResult {
    const resolved = this.insertResolve(itemId, position);
    if (resolved.code !== 0) return resolved;
    this.dialogOpen({ kind: 'folderNew', itemId, position, point, text: '' });
    return { code: 0, message: '' };
  }

  // a new document: placed and named in the location prompt of the source
  // layer, among the roots of the doc page whose file gets the item; the
  // file is created empty, with the item, in one request
  async insertDocOpen(itemId: string, position: SidePanelInsertPosition, point?: EditPoint): Promise<EditResult> {
    const resolved = this.insertResolve(itemId, position);
    if (resolved.code !== 0) return resolved;
    if (!this.sourceFileStore) return { code: -1, message: 'the page offers no location prompt' };
    this.picker = undefined;
    this.contextMenu = undefined;
    this.dialog = undefined;
    const { docPageAlias } = resolved.data;
    const rootList = this.docPageRootPathListGet(docPageAlias);
    const bindPath = this.placeById.get(itemId)?.bindPath ?? '';
    const dirPathNear = bindPath && sourcePathDocPageAliasGet(bindPath) === docPageAlias ? sourcePathDirGet(bindPath) : '';
    return this.sourceFileStore.locationChoose(
      {
        dirPath: dirPathNear,
        name: 'new-document.mdx',
        point,
        spec: rootList.length > 0 ? { kind: 'dir', rootList } : { kind: 'dir' },
        title: `New document ${insertPositionLabelGet(position)} "${this.itemTextGet(itemId)}"`,
        actionText: 'Create',
        pendingText: 'Creating the document…',
        nameCheck: (name) => docNameMessageGet(name),
      },
      (location) => this.docInsertApply(itemId, position, location),
    );
  }

  private async docInsertApply(itemId: string, position: SidePanelInsertPosition, location: { dirPath: string; name: string }): Promise<EditResult> {
    const resolved = this.insertResolve(itemId, position);
    if (resolved.code !== 0) return resolved;
    const name = docNameNormalize(location.name);
    const pathNew = `${location.dirPath}/${name}`;
    const { file, listPath, index, docPageAlias } = resolved.data;
    const result = await this.nodeChangeApply(file, {
      action: 'insert',
      listPath,
      index,
      node: { kind: 'doc', doc: sidePanelPathWrittenGet(pathNew, docPageAlias) },
    }, { fileCreate: { dirPath: location.dirPath, name, text: '' } });
    if (result.code !== 0) return result;
    if (resolved.data.parentItemId) this.folderOpenSet(resolved.data.parentItemId, true);
    // the new document opens, ready for its first block, once the new
    // configuration has reached the page (a data event, usually before the
    // answer of the write; tried for about a second)
    const pathCreated = result.data?.fileCreated || pathNew;
    const routeOpen = (tryCount: number) => {
      const route = this.docStore.routeForDoc(pathCreated);
      if (route) this.docStore.navigate(route);
      else if (tryCount < 10) window.setTimeout(() => routeOpen(tryCount + 1), 100);
    };
    window.setTimeout(() => routeOpen(0), 0);
    return result;
  }

  bindOpen(itemId: string, bindKind: 'doc' | 'folder' | 'none', point?: EditPoint): EditResult {
    const place = this.placeById.get(itemId);
    const actionList = this.bindActionListGet(itemId);
    const isAllowed = actionList.some((entry) => {
      if (entry.reason) return false;
      if (bindKind === 'none') return entry.action === 'detach';
      return bindKind === 'doc' ? entry.action.startsWith('doc') : entry.action.startsWith('folder');
    });
    if (!isAllowed) return { code: -1, message: `"${this.itemTextGet(itemId)}" cannot be bound that way` };
    const isSameKind = (bindKind === 'doc' && place.nodeForm === 'doc') || (bindKind === 'folder' && place.nodeForm === 'sourceFolder');
    this.dialogOpen({ kind: 'bind', itemId, point, bindKind, bindPath: isSameKind ? place.bindPath : '' });
    return { code: 0, message: '' };
  }

  // a removal is confirmed first. a document item offers its document,
  // unchosen; the dialog says who would be left with a broken link, from
  // the link index of the page (DocLinkStore)
  removeOpen(itemId: string, point?: EditPoint): EditResult {
    const resolved = this.removeResolve(itemId);
    if (resolved.code !== 0) return resolved;
    this.dialogOpen({ kind: 'remove', itemId, point });
    return { code: 0, message: '' };
  }

  // the other items bound to the same document: they would show it missing
  itemSameDocIdListGet(itemId: string): string[] {
    const bindPath = this.placeById.get(itemId)?.bindPath ?? '';
    if (!bindPath) return [];
    const idList: string[] = [];
    for (const [id, place] of this.placeById) {
      if (id !== itemId && place.nodeForm !== 'sourceFolder' && place.kind !== 'folder' && place.bindPath === bindPath) idList.push(id);
    }
    return idList;
  }

  // the dialog's action: create the folder, bind, detach, or remove
  async dialogConfirm(): Promise<EditResult> {
    const dialog = this.dialog;
    if (!dialog || dialog.status === 'submitting') return { code: -1, message: 'nothing to confirm' };
    let file = '';
    let request: any;
    let extra: { filePathDeleteList?: string[] } = {};
    let parentItemIdOpen = '';
    if (dialog.kind === 'folderNew') {
      const text = dialog.text.trim();
      if (!text) return this.dialogFail(dialog, 'The folder needs a label.');
      const resolved = this.insertResolve(dialog.itemId, dialog.position);
      if (resolved.code !== 0) return this.dialogFail(dialog, resolved.message);
      file = resolved.data.file;
      request = { action: 'insert', listPath: resolved.data.listPath, index: resolved.data.index, node: { kind: 'folder', text } };
      parentItemIdOpen = resolved.data.parentItemId;
    } else if (dialog.kind === 'bind') {
      if (dialog.bindKind !== 'none' && !dialog.bindPath) {
        return this.dialogFail(dialog, dialog.bindKind === 'doc' ? 'Choose a document.' : 'Choose a folder.');
      }
      const reasonPath = dialog.bindKind === 'none' ? '' : this.bindPathMessageGet(dialog.itemId, dialog.bindKind, dialog.bindPath);
      if (reasonPath) return this.dialogFail(dialog, reasonPath);
      const binding = dialog.bindKind === 'none' ? { kind: 'none' } : { kind: dialog.bindKind, path: dialog.bindPath };
      const resolved = sidePanelBindResolve(this.placeById, dialog.itemId, binding, this.itemTextGet(dialog.itemId), (id: string) => this.itemTextGet(id));
      if (resolved.code !== 0) return this.dialogFail(dialog, resolved.message);
      if (resolved.data.isNoop) {
        this.dialog = undefined;
        return { code: 0, message: '' };
      }
      file = resolved.data.file;
      request = resolved.data.request;
    } else {
      const resolved = this.removeResolve(dialog.itemId);
      if (resolved.code !== 0) return this.dialogFail(dialog, resolved.message);
      file = resolved.data.file;
      request = { action: 'remove', path: resolved.data.path };
      if (dialog.isFileDeleted && resolved.data.filePath) extra = { filePathDeleteList: [resolved.data.filePath] };
    }

    dialog.status = 'submitting';
    dialog.message = '';
    const result = await this.nodeChangeApply(file, request, extra);
    if (result.code !== 0) return this.dialogFail(dialog, result.message);
    runInAction(() => {
      if (parentItemIdOpen) this.folderOpenSet(parentItemIdOpen, true);
      if (this.dialog === dialog) this.dialog = undefined;
    });
    return result;
  }

  // '' when the path can be bound, else why not: it must be a document (or
  // a folder) of the source, of the item's doc page
  bindPathMessageGet(itemId: string, bindKind: 'doc' | 'folder', path: string): string {
    const spec = this.bindSpecGet(itemId, bindKind);
    const isKnown = this.sourceStore.pathComplete('', spec).some((candidate: any) => candidate.path === path);
    if (isKnown) return '';
    return bindKind === 'doc'
      ? `${path} is not a document (.md, .mdx) of this doc page.`
      : `${path} is not a folder of this doc page.`;
  }

  private dialogFail(dialog: SidePanelNodeDialog, message: string, code = -1): EditResult {
    runInAction(() => {
      if (this.dialog !== dialog) return;
      dialog.status = 'error';
      dialog.message = message;
    });
    return { code, message };
  }

  // one request of the edit api for a node of a side-panel file; the open
  // block session is left (saved) first, like before any other edit action
  private async nodeChangeApply(
    file: string,
    request: any,
    extra: { fileCreate?: { dirPath: string; name: string; text: string }; filePathDeleteList?: string[] } = {},
  ): Promise<EditResult> {
    if (!this.isMoveAvailable || !this.editStore.api) return { code: -1, message: 'the side panel is changed in edit mode' };
    const isLeft = await this.editStore.sessionLeave();
    if (!isLeft) return { code: -1, message: 'The open edit could not be saved, so nothing was changed.' };
    const hashBase = this.sourceStore.configDoc.docEntry?.fileHashByFile?.[file] ?? '';
    const result = await this.editStore.api.sidePanelNodeApply({
      file, request, hashBase, fileCreate: extra.fileCreate, filePathDeleteList: extra.filePathDeleteList,
    });
    if (result.code !== 0) {
      return { code: result.code, message: result.code === -2 ? messageConflictNode : result.message || 'Nothing was changed.' };
    }
    const fileChangeList = result.data?.fileChangeList ?? [];
    this.editStore.historyRecord({
      kind: `sidePanelNode${request.action[0].toUpperCase()}${request.action.slice(1)}`,
      time: Date.now(),
      fileChangeList: fileChangeList.map((change: any) => ({ scope: 'sidePanel', ...change })),
    });
    return { code: 0, data: result.data, message: '' };
  }

  // ---------- refresh ----------

  // the files the item is bound to are read again from disk: the server
  // reads the configuration and the source again and reports them as data
  // (a document whose content changed is compiled again, a file added to a
  // source folder appears), then every document of the item that is shown
  // is compiled again anyway
  async itemRefresh(itemId: string): Promise<EditResult> {
    if (!this.itemIsRefreshable(itemId)) return { code: -1, message: 'this item is bound to no file or folder to read again' };
    if (this.isRefreshSubmitting) return { code: -1, message: 'another refresh is running' };
    const bindPath = this.placeById.get(itemId)!.bindPath;
    this.refresh = { itemId, status: 'submitting', message: '' };
    const refresh = this.refresh;
    const result = await this.sourceStore.sourceRefresh();
    if (result.code !== 0) {
      runInAction(() => {
        if (this.refresh !== refresh) return;
        refresh.status = 'error';
        refresh.message = result.message || 'The files were not read again.';
      });
      return result;
    }
    const pathList = this.sourceStore.fileManifest
      .map((entry: any) => entry.internalPath)
      .filter((path: string) => path === bindPath || sourcePathIsInside(path, bindPath));
    await Promise.all(pathList
      .filter((path: string) => this.sourceStore.compiledByPath[path])
      .map((path: string) => this.sourceStore.loadDoc(path, { isRefresh: true })));
    runInAction(() => {
      if (this.refresh === refresh) this.refresh = undefined;
    });
    return { code: 0, message: '' };
  }

  // ---------- events ----------

  // the item is the source of the event (source.itemId); a move names the
  // place in its data: { position, targetItemId }
  async eventHandle(event: DocEvent): Promise<EditResult | undefined> {
    const itemId = String(event.source.itemId ?? '');
    if (!itemId) return { code: -1, message: `${event.type} needs the item id` };
    if (event.type === 'sidePanelItemInsertRequest') {
      const position = String(event.data.position ?? '') as SidePanelInsertPosition;
      if (event.data.kind === 'doc') return this.insertDocOpen(itemId, position, event.point);
      if (event.data.kind === 'folder') return this.insertFolderOpen(itemId, position, event.point);
      return { code: -1, message: 'an inserted item is a folder or a document' };
    }
    if (event.type === 'sidePanelItemBindRequest') {
      const kind = String(event.data.kind ?? '');
      if (kind !== 'doc' && kind !== 'folder' && kind !== 'none') return { code: -1, message: 'a binding is doc, folder or none' };
      return this.bindOpen(itemId, kind, event.point);
    }
    if (event.type === 'sidePanelItemRemoveRequest') return this.removeOpen(itemId, event.point);
    if (event.type === 'sidePanelItemRefreshRequest') return this.itemRefresh(itemId);
    if (event.type === 'sidePanelItemMovePickerOpenRequest') {
      const isOpened = this.pickerOpen(itemId, event.point);
      return isOpened ? { code: 0, message: '' } : { code: -1, message: 'this item cannot be moved' };
    }
    if (event.type === 'sidePanelItemMoveRequest') {
      const position = String(event.data.position ?? '') as SidePanelMovePosition;
      const targetItemId = String(event.data.targetItemId ?? '');
      return this.moveApply(itemId, position, targetItemId, event.point);
    }
    return undefined;
  }
}

function insertPositionLabelGet(position: SidePanelInsertPosition): string {
  if (position === 'before') return 'above';
  if (position === 'after') return 'below';
  return 'inside';
}

// a document is a .md or .mdx file; a name without an extension gets .mdx
function docNameMessageGet(name: string): string {
  const nameTrimmed = name.trim();
  if (/[\\/]/.test(nameTrimmed)) return 'The name is a file name, without a folder.';
  const indexDot = nameTrimmed.lastIndexOf('.');
  if (indexDot <= 0) return '';
  const ext = nameTrimmed.slice(indexDot + 1).toLowerCase();
  return sidePanelDocExtList.includes(ext) ? '' : 'A document is a .md or .mdx file.';
}

function docNameNormalize(name: string): string {
  const nameTrimmed = name.trim();
  return nameTrimmed.lastIndexOf('.') > 0 ? nameTrimmed : `${nameTrimmed}.mdx`;
}
