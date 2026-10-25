import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import type { DocEditStore, EditPoint, EditResult } from './DocEditStore.js';
import { sidePanelItemIsMovable, sidePanelMoveResolve } from '../lib/side-panel-move.js';

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
//   contextMenu      the right-click menu of an item in edit mode: Rename
//                    and Move…, the same requests as the edit and move
//                    buttons of the label
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

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any>; point?: EditPoint };

// the event types the sidePanel route of the event layer brings here
export const sidePanelEventTypeList = [
  'sidePanelItemMoveRequest',
  'sidePanelItemMovePickerOpenRequest',
];

const messageConflict = 'A side panel file changed on disk since the page loaded it. The new side panel is on its way; move the item again then.';

export class DocSidePanelStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;
  editStore: DocEditStore;
  folderOpenById: Record<string, boolean> = {};
  drag: SidePanelDrag | undefined = undefined;
  picker: SidePanelMovePicker | undefined = undefined;
  move: SidePanelMove | undefined = undefined;
  contextMenu: SidePanelContextMenu | undefined = undefined;

  constructor({ sourceStore, docStore, editStore }: { sourceStore: DocSourceStore; docStore: DocStore; editStore: DocEditStore }) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.editStore = editStore;
    makeAutoObservable(this, {
      sourceStore: false,
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

  // ---------- events ----------

  // the item is the source of the event (source.itemId); a move names the
  // place in its data: { position, targetItemId }
  async eventHandle(event: DocEvent): Promise<EditResult | undefined> {
    const itemId = String(event.source.itemId ?? '');
    if (!itemId) return { code: -1, message: `${event.type} needs the item id` };
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
