import { makeAutoObservable, reaction, runInAction } from 'mobx';
import type { DocEditStore, EditResult, EditSelectionInitial } from './DocEditStore.js';
import {
  LIST_SCOPE_ITEM,
  LIST_SCOPE_SUBTREE,
  itemBlockInfoIsText,
  itemBlockTextBuild,
  itemTextSplit,
  itemTextWrite,
  itemChildListGet,
  itemDescendantCountGet,
  listItemAttach,
  listEditThen,
  listItemDelete,
  listItemDetach,
  listItemEditReasonGet,
  listItemGet,
  listItemIndent,
  listItemInsert,
  listItemListTypeGet,
  listItemListTypeSet,
  listItemMergeUp,
  listItemMove,
  listItemMoveSibling,
  listItemOutdent,
  listItemSplit,
  listItemTextGet,
  listItemTextSet,
  pathDepthGet,
  pathIsWithin,
} from '../lib/doc-edit-list.js';
import { itemAtomCharIs, itemAtomTextBuild, itemBlockSplitOut, itemCodeBlockListGet, itemPartGet, itemPartOffsetGet, itemPartTextWrite } from '../lib/doc-edit-item-atom.js';
import { codeBlockAssetTextBuild, codeBlockTextParse, codeTextJoin, codeTextViewGet, codeTextViewSet, textJoinSpaceIs } from '../lib/doc-edit-code.js';
import { assetRefParse } from '../lib/doc-asset-ref.js';

// Structural edit of a document (design: doc_page_impl_edit_structure.md).
// A content edit changes what one block or one list item says; a structural
// edit changes which blocks and items exist, their order and their nesting.
// The content edits are DocEditStore's (its sessions); this store holds what
// the structural edits need in edit mode:
//
//   selection   the one thing selected for a structural edit: a root-level
//               block, an item of a list block alone, or an item with what
//               is under it. { path, hash, blockIndex, itemPath, scope,
//               itemPathAnchor }. Shift + click selects; again on the same
//               place, the selection grows (item -> item with its sub-items
//               -> the item above with its sub-items -> ... -> the whole
//               list block) and then starts over at the item clicked
//               (itemPathAnchor). like a block selection it belongs to the
//               text it was made in (hash)
//   itemHover   the item under the pointer; its toolbar shows while nothing
//               is selected
//   itemMenu    the item whose menu of list operations is open
//   itemConfirm the item whose deletion waits for confirmation, is written,
//               or failed
//   itemWrite   the structural edit of an item being written, or its failure
//   drag        the selected thing being dragged to another place: the
//               subject, where the pointer is, and the place it would go to
//               (target), found from the rendered rows by the layer
//               (comp-doc/edit-structure/) and checked here
//
// every edit of items is computed by lib/doc-edit-list.js on the item model
// of the list block (block.list) and written as the new text of that block,
// in one write of the edit layer (DocEditStore.blockChangeListApply): hash
// checked, recorded in the edit history. the edits are requested through the
// event layer (structEventTypeList), so the host application sees them first.

export type StructScope = 'block' | 'item' | 'subtree';

export type StructItemRef = { path: string; blockIndex: number; itemPath: string };

export type StructSelection = StructItemRef & {
  hash: string;
  scope: StructScope;
  // the item the selection started from: where it starts over after it grew
  // to the whole block ('' for a block without items)
  itemPathAnchor: string;
};

export type StructItemConfirm = StructItemRef & {
  // the scope asked for; undefined: the confirmation offers both
  scope: StructScope | undefined;
  status: 'confirming' | 'submitting' | 'error';
  message: string;
};

export type StructItemWrite = StructItemRef & { status: 'submitting' | 'error'; message: string };

// where a dragged thing would go
//   kind 'block'   border borderIndex of the document (before block n; the
//                  number of blocks: after the last one)
//   kind 'item'    relative to an item of a list block: before / after it
//                  (after: after it and what is under it), or as its first child
export type StructDropTarget =
  | { kind: 'block'; borderIndex: number }
  | { kind: 'item'; blockIndex: number; itemPath: string; position: 'before' | 'after' | 'childFirst'; depth: number };

// the line that shows a place, relative to the edit body
export type StructDropIndicator = { top: number; left: number; right: number };

export type StructDrag = {
  path: string;
  hash: string;
  // depth: the level of a dragged item in its list (0 for a block)
  subject: { kind: 'block' | 'item'; blockIndex: number; itemPath: string; scope: StructScope; depth: number; label: string; countExtra: number };
  pointer: { clientX: number; clientY: number };
  target: StructDropTarget | undefined;
  indicator: StructDropIndicator | undefined;
  status: 'dragging' | 'submitting';
};

// how long the keys typed after an edit asked from the editor of an item are
// kept for the editor that opens next (typing on through an edit), at most
const TYPE_AHEAD_LIMIT_MS = 1500;

// the events the structure route of the event layer brings here
export const structEventTypeList = [
  'editItemInsertRequest',
  'editItemDeleteRequest',
  'editItemLevelRequest',
  'editItemMoveRequest',
  'editItemListTypeRequest',
  'editItemCodeViewRequest',
  'editItemCodeAssetRequest',
  'editItemSplitRequest',
  'editItemMergeRequest',
  'editItemFormatRequest',
  'editItemPartEnterRequest',
  'editItemPartLeaveRequest',
  'editItemTextJoinRequest',
  'editItemBlockSplitRequest',
  'editItemBlockInsertRequest',
  'editItemCodeTextRequest',
  'editStructDropRequest',
];

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any> };

export class DocEditStructStore {
  editStore: DocEditStore;
  selection: StructSelection | undefined = undefined;
  itemHover: StructItemRef | undefined = undefined;
  itemMenu: StructItemRef | undefined = undefined;
  itemConfirm: StructItemConfirm | undefined = undefined;
  // the item that is a code block whose lines are asked to move into the
  // asset service layer, confirmed in its toolbar like a deletion
  itemCodeAssetConfirm: StructItemRef | undefined = undefined;
  itemWrite: StructItemWrite | undefined = undefined;
  drag: StructDrag | undefined = undefined;
  // the keys typed while an edit asked from the editor of an item is written
  // (typing on through an edit, below): one entry per key, a character or
  // the name of a key ('Enter', 'Shift+Tab'). undefined: no such moment now
  typeAheadKeyList: string[] | undefined = undefined;
  typeAheadTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  reactionDispose: (() => void) | undefined;

  constructor({ editStore }: { editStore: DocEditStore }) {
    this.editStore = editStore;
    makeAutoObservable(this, { editStore: false, reactionDispose: false, typeAheadKeyList: false, typeAheadTimer: false });
  }

  // ---------- typing on through an edit ----------
  // Enter in an item writes the list and opens the new item, which takes a
  // moment (the document is read again, and the editor is closed until then).
  // an author who types on at once must lose nothing, not the first letters
  // of the new item and not a second Enter:
  //
  //   typeAheadOpen    the edit starts: from now on the keys are kept
  //   typeAheadKey     a key pressed in that moment (the pointer layer hears
  //                    it, use-struct-pointer.js)
  //   typeAheadTake    the editor that opened has the focus: it takes the
  //                    text typed so far and puts it in at its caret, and
  //                    the key after it (Enter, Tab), which it presses as
  //                    its own. such a key writes the list again; what was
  //                    typed after it stays kept for the editor after that
  //   typeAheadClose   nothing is kept any more
  //
  // the moment ends by itself TYPE_AHEAD_LIMIT_MS after the last edit,
  // whatever happened to the editor: the keys of the page are never held
  // for longer.

  get isTypeAheadOpen(): boolean {
    return this.typeAheadKeyList !== undefined;
  }

  // what is kept already (typed after a key that was just pressed) stays
  typeAheadOpen() {
    this.typeAheadKeyList ??= [];
    if (this.typeAheadTimer !== undefined) clearTimeout(this.typeAheadTimer);
    this.typeAheadTimer = setTimeout(() => this.typeAheadClose(), TYPE_AHEAD_LIMIT_MS);
  }

  // a character is kept, and so are Enter and Tab (with Shift when held);
  // Backspace takes the last kept character back. any other key is held and
  // dropped. true when the key was taken from the page
  typeAheadKey(key: string, isShift = false): boolean {
    const keyList = this.typeAheadKeyList;
    if (!keyList) return false;
    if (key === 'Backspace') {
      if (keyList.length > 0 && keyList[keyList.length - 1].length === 1) keyList.pop();
    } else if (key.length === 1) keyList.push(key);
    else if (key === 'Enter' || key === 'Tab') keyList.push(isShift ? `Shift+${key}` : key);
    return true;
  }

  // the text typed up to the first kept key, and that key. with a key, the
  // moment goes on (the key is about to change the list again); without
  // one, everything is taken and the moment is over
  typeAheadTake(): { text: string; key: string | undefined } {
    const keyList = this.typeAheadKeyList;
    if (!keyList) return { text: '', key: undefined };
    const indexKey = keyList.findIndex((key) => key.length !== 1);
    if (indexKey < 0) {
      this.typeAheadClose();
      return { text: keyList.join(''), key: undefined };
    }
    const keyListTaken = keyList.splice(0, indexKey + 1);
    const key = keyListTaken.pop();
    return { text: keyListTaken.join(''), key };
  }

  typeAheadClose() {
    this.typeAheadKeyList = undefined;
    if (this.typeAheadTimer !== undefined) clearTimeout(this.typeAheadTimer);
    this.typeAheadTimer = undefined;
  }

  // a selection belongs to edit mode and to the document it was made in: it
  // ends when edit mode is left and when the page goes to another document
  init() {
    this.reactionDispose = reaction(
      () => [this.editStore.isEditMode, this.editStore.docStore?.docCurrentPath],
      () => {
        runInAction(() => {
          this.selection = undefined;
          this.itemHover = undefined;
          this.itemMenu = undefined;
          this.itemCodeAssetConfirm = undefined;
          if (this.itemConfirm?.status !== 'submitting') this.itemConfirm = undefined;
          if (this.itemWrite?.status !== 'submitting') this.itemWrite = undefined;
          if (this.drag?.status !== 'submitting') this.drag = undefined;
        });
        this.typeAheadClose();
      },
    );
  }

  dispose() {
    this.reactionDispose?.();
    this.reactionDispose = undefined;
    this.typeAheadClose();
  }

  // ---------- reading the document ----------

  // structural edits are offered in edit mode, on a document the page can write
  isActive(path: string): boolean {
    return this.editStore.isEditMode && this.editStore.docIsEditable(path);
  }

  private blockGet(path: string, blockIndex: number): any {
    return this.editStore.docEditGet(path)?.model?.blockList[blockIndex];
  }

  // the item model of a list block; undefined for any other block
  listGet(path: string, blockIndex: number): any {
    return this.blockGet(path, blockIndex)?.list;
  }

  itemGet(ref: StructItemRef): any {
    return listItemGet(this.listGet(ref.path, ref.blockIndex), ref.itemPath);
  }

  get isSubmitting(): boolean {
    return this.itemWrite?.status === 'submitting'
      || this.itemConfirm?.status === 'submitting'
      || this.drag?.status === 'submitting';
  }

  // ---------- the selection ----------

  // the selection of a document, while it still names something of the
  // text the document has
  selectionGet(path: string): StructSelection | undefined {
    const selection = this.selection;
    if (!selection || selection.path !== path || !this.isActive(path)) return undefined;
    if (this.editStore.docEditGet(path)?.hash !== selection.hash) return undefined;
    return selection;
  }

  get isSelected(): boolean {
    return this.selection !== undefined && this.selectionGet(this.selection.path) !== undefined;
  }

  selectionIsBlock(path: string, blockIndex: number): boolean {
    const selection = this.selectionGet(path);
    return selection?.scope === 'block' && selection.blockIndex === blockIndex;
  }

  // the item whose toolbar the selection pins: the selected item
  selectionIsItem(ref: StructItemRef): boolean {
    const selection = this.selectionGet(ref.path);
    return Boolean(selection) && selection!.scope !== 'block'
      && selection!.blockIndex === ref.blockIndex && selection!.itemPath === ref.itemPath;
  }

  // Shift + click on a block (itemPath '') or on an item of a list block.
  // on something outside the selection: the smallest thing there, the item
  // alone or the block. inside the selection: one step larger, and from the
  // whole block back to the item clicked. the open session is left first.
  async selectClick(path: string, blockIndex: number, itemPath = ''): Promise<boolean> {
    if (!this.isActive(path) || this.isSubmitting) return false;
    const isLeft = await this.editStore.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    const state = this.editStore.docEditGet(path);
    const block = state?.model?.blockList[blockIndex];
    if (!state || !block) return false;
    const itemPathClicked = listItemGet(block.list, itemPath) ? itemPath : '';
    const current = this.selectionGet(path);
    const isInside = current !== undefined && current.blockIndex === blockIndex && selectionHolds(current, itemPathClicked);
    const next = isInside
      ? selectionGrow(current!, block.list, itemPathClicked)
      : { itemPath: itemPathClicked, scope: (itemPathClicked ? 'item' : 'block') as StructScope };
    runInAction(() => {
      this.overlayClose();
      this.selection = { path, hash: state.hash, blockIndex, ...next, itemPathAnchor: itemPathClicked };
    });
    return true;
  }

  // selects a block, or an item of a list block, in a scope
  async selectionSet(path: string, blockIndex: number, itemPath = '', scope: StructScope = itemPath ? 'item' : 'block'): Promise<boolean> {
    if (!this.isActive(path) || this.isSubmitting) return false;
    const isLeft = await this.editStore.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    const state = this.editStore.docEditGet(path);
    const block = state?.model?.blockList[blockIndex];
    if (!state || !block) return false;
    if (itemPath && !listItemGet(block.list, itemPath)) return false;
    runInAction(() => {
      this.overlayClose();
      this.selection = {
        path,
        hash: state.hash,
        blockIndex,
        itemPath: scope === 'block' ? '' : itemPath,
        scope: itemPath ? scope : 'block',
        itemPathAnchor: itemPath,
      };
    });
    return true;
  }

  // one step larger, as another Shift + click on the selection
  selectionGrowStep(): boolean {
    const selection = this.selection && this.selectionGet(this.selection.path);
    if (!selection) return false;
    const list = this.listGet(selection.path, selection.blockIndex);
    const next = selectionGrow(selection, list, selection.itemPathAnchor);
    this.overlayClose();
    this.selection = { ...selection, ...next };
    return true;
  }

  selectionClear() {
    this.selection = undefined;
    this.overlayClose();
  }

  // Escape: what is open on the selection closes first (a menu, a
  // confirmation, a failure), then the selection ends
  selectionEscape() {
    if (this.itemMenu || this.itemConfirm || this.itemCodeAssetConfirm || this.itemWrite) {
      this.overlayClose();
      return;
    }
    this.selectionClear();
  }

  // the selected thing moved among its siblings: a block swapped with its
  // neighbor, an item with the item before or after it in its list
  selectionMove(direction: 'up' | 'down'): Promise<EditResult> {
    const selection = this.selection && this.selectionGet(this.selection.path);
    if (!selection) return Promise.resolve({ code: -1, message: 'nothing is selected' });
    if (selection.scope === 'block') return this.selectionBlockMove(direction);
    return this.itemMoveSibling(selection, direction);
  }

  // the content of the selected thing opened for editing: the selection ends
  async selectionEnter(): Promise<EditResult> {
    const selection = this.selection && this.selectionGet(this.selection.path);
    if (!selection) return { code: -1, message: 'nothing is selected' };
    const { path, blockIndex, itemPath, scope } = selection;
    this.selectionClear();
    const isStarted = scope === 'block'
      ? await this.editStore.sessionBlockStart(path, blockIndex)
      : await this.editStore.sessionItemStart(path, blockIndex, itemPath);
    return isStarted ? { code: 0, message: '' } : { code: -1, message: 'it was not opened for editing' };
  }

  // the deletion of the selected thing asked in its toolbar
  async selectionDeleteAsk(): Promise<EditResult> {
    const selection = this.selection && this.selectionGet(this.selection.path);
    if (!selection) return { code: -1, message: 'nothing is selected' };
    if (selection.scope === 'block') {
      const isAsked = await this.editStore.deleteConfirmSet(selection.path, selection.blockIndex);
      return isAsked ? { code: 0, message: '' } : { code: -1, message: 'the deletion was not asked' };
    }
    this.itemConfirmSet(selection, selection.scope);
    return { code: 0, message: '' };
  }

  // what belongs to one toolbar: closed when the selection changes
  private overlayClose() {
    this.itemMenu = undefined;
    this.itemCodeAssetConfirm = undefined;
    if (this.itemConfirm?.status !== 'submitting') this.itemConfirm = undefined;
    if (this.itemWrite?.status !== 'submitting') this.itemWrite = undefined;
  }

  // what the selection is called in its toolbar, and what a drag of it says
  selectionLabelGet(selection: StructSelection): { text: string; countExtra: number } {
    if (selection.scope === 'block') return { text: 'Block', countExtra: 0 };
    const item = this.itemGet(selection);
    const countChild = item ? itemDescendantCountGet(item) : 0;
    if (countChild === 0) return { text: 'Item', countExtra: 0 };
    if (selection.scope === 'item') return { text: 'Item only', countExtra: 0 };
    return { text: `Item with ${countChild} sub-item${countChild === 1 ? '' : 's'}`, countExtra: countChild };
  }

  // ---------- hover, menu ----------

  itemHoverSet(ref: StructItemRef | undefined) {
    const current = this.itemHover;
    if (!ref) {
      if (current) this.itemHover = undefined;
      return;
    }
    if (current && current.path === ref.path && current.blockIndex === ref.blockIndex && current.itemPath === ref.itemPath) return;
    this.itemHover = ref;
  }

  itemMenuIs(ref: StructItemRef): boolean {
    return refIsSame(this.itemMenu, ref);
  }

  itemMenuToggle(ref: StructItemRef) {
    this.itemMenu = this.itemMenuIs(ref) ? undefined : { ...ref };
  }

  itemMenuClose() {
    this.itemMenu = undefined;
  }

  // the item whose toolbar shows: the selected one (pinned), else the one
  // with something open, else the one under the pointer. nothing while a
  // drag runs, and nothing of a block being edited as a whole
  itemToolbarRefGet(path: string): (StructItemRef & { isPinned: boolean }) | undefined {
    if (!this.isActive(path) || this.drag) return undefined;
    const selection = this.selectionGet(path);
    if (selection) {
      return selection.scope === 'block'
        ? undefined
        : { path, blockIndex: selection.blockIndex, itemPath: selection.itemPath, isPinned: true };
    }
    const ref = [this.itemConfirm, this.itemCodeAssetConfirm, this.itemMenu, this.itemWrite, this.itemHover]
      .find((candidate) => candidate && candidate.path === path && this.itemGet(candidate));
    if (!ref) return undefined;
    if (this.editStore.sessionIs(path, 'block', ref.blockIndex)) return undefined;
    if (this.editStore.sessionItemIs(path, ref.blockIndex, ref.itemPath)) return undefined;
    return { path, blockIndex: ref.blockIndex, itemPath: ref.itemPath, isPinned: false };
  }

  // ---------- what an item can do ----------

  // why an edit of an item is not possible now, '' when it is
  itemEditReasonGet(ref: StructItemRef, action: string, scope: StructScope = 'subtree'): string {
    const list = this.listGet(ref.path, ref.blockIndex);
    if (!list) return 'the items of this list cannot be edited one by one';
    return listItemEditReasonGet(list, ref.itemPath, action, scope === 'item' ? LIST_SCOPE_ITEM : LIST_SCOPE_SUBTREE);
  }

  itemChildCountGet(ref: StructItemRef): number {
    const item = this.itemGet(ref);
    return item ? itemChildListGet(item).length : 0;
  }

  itemDescendantCountGet(ref: StructItemRef): number {
    const item = this.itemGet(ref);
    return item ? itemDescendantCountGet(item) : 0;
  }

  itemListTypeGet(ref: StructItemRef): string {
    const list = this.listGet(ref.path, ref.blockIndex);
    return list ? listItemListTypeGet(list, ref.itemPath) : '';
  }

  itemTextGet(ref: StructItemRef): string {
    const list = this.listGet(ref.path, ref.blockIndex);
    return list ? listItemTextGet(list, ref.itemPath) : '';
  }

  // ---------- an item that is a code block ----------
  // (doc_page_impl_mdx_code.md#changing-the-view-from-the-page) an item whose
  // own text is one fenced code block, or a block of the component Code: its
  // view is written into it, and the lines of a fenced one can move into the
  // asset service layer, as for a root-level code block

  // { view, form } of an item that is a code block; undefined for any other item
  itemCodeViewGet(ref: StructItemRef): { view: string; form: string } | undefined {
    return codeTextViewGet(this.itemTextGet(ref));
  }

  // the item of the asset service layer the lines of an item read (a block of
  // Code reading an item): { store, itemId, versionIdRef }, undefined for any other item
  itemCodeAssetRefGet(ref: StructItemRef): { store: string; itemId: string; versionIdRef: string } | undefined {
    const text = this.itemTextGet(ref);
    if (codeTextViewGet(text)?.form !== 'component') return undefined;
    const parsed = codeBlockTextParse(text);
    if (!parsed || parsed.lang !== 'asset') return undefined;
    const reference = assetRefParse(parsed.value);
    if (reference.message) return undefined;
    const itemId = this.editStore.assetStore?.refItemIdGet(reference) ?? '';
    return itemId ? { store: reference.store, itemId, versionIdRef: reference.versionId ?? '' } : undefined;
  }

  // why the lines of the item cannot move into the asset service layer, '' when they can
  itemCodeAssetMoveReasonGet(ref: StructItemRef): string {
    const codeView = this.itemCodeViewGet(ref);
    if (!codeView) return 'the item is not a code block';
    if (codeView.form !== 'fence') return 'the lines are in the asset service layer already';
    if (!this.editStore.assetStore?.isWritable) return 'the asset service layer cannot be written here';
    return '';
  }

  // the view of the item written into it ('' removes it: the config decides)
  itemCodeViewSet(ref: StructItemRef, view: string): Promise<EditResult> {
    return this.itemEdit(ref, (list) => {
      const built = codeTextViewSet(listItemTextGet(list, ref.itemPath), view);
      if (built.code !== 0) return built;
      return listItemTextSet(list, ref.itemPath, built.data);
    });
  }

  // the lines of the item become an item of the local store, and the item a
  // block of the component Code reading it: the store item first, the
  // document last, as for a root-level block
  async itemCodeAssetMove(ref: StructItemRef): Promise<EditResult> {
    const reason = this.itemCodeAssetMoveReasonGet(ref);
    if (reason) return this.itemWriteFail(ref, reason);
    runInAction(() => {
      this.itemCodeAssetConfirm = undefined;
      this.itemMenu = undefined;
      this.itemWrite = { ...ref, status: 'submitting', message: '' };
    });
    const created = await this.editStore.codeAssetItemCreate(ref.path, this.itemTextGet(ref));
    runInAction(() => { this.itemWrite = undefined; });
    if (created.code !== 0) return this.itemWriteFail(ref, created.message);
    const result = await this.itemEdit(ref, (list) => {
      const built = codeBlockAssetTextBuild(listItemTextGet(list, ref.itemPath), created.data.referenceText);
      if (built.code !== 0) return built;
      return listItemTextSet(list, ref.itemPath, built.data);
    });
    if (result.code !== 0) return this.itemWriteFail(ref, `${result.message} The lines are in the asset service layer as object ${created.data.itemId}.`);
    void this.editStore.assetStore?.usageNotify([{ type: 'docChange', docPath: ref.path }]);
    return result;
  }

  itemWriteIs(ref: StructItemRef): boolean {
    return refIsSame(this.itemWrite, ref);
  }

  itemWriteClear() {
    if (this.itemWrite?.status !== 'submitting') this.itemWrite = undefined;
  }

  // ---------- the events of structural edits ----------

  // an event names its item through event.source (sourcePath, blockIndex,
  // itemPath). from the editor of an item (no itemPath in the source), the
  // item is the one of the open session, which is saved first and, where the
  // item still exists afterwards, opened again on it.
  async eventHandle(event: DocEvent): Promise<EditResult | undefined> {
    if (event.type === 'editStructDropRequest') return this.dragDropApply(event.data.target);
    const session = this.editStore.session;
    const isFromSession = event.source.itemPath === undefined && session?.type === 'item'
      && (!event.source.sourcePath || event.source.sourcePath === session.path);
    const ref: StructItemRef = isFromSession
      ? { path: session!.path, blockIndex: session!.blockIndex, itemPath: String(session!.itemPath) }
      : { path: String(event.source.sourcePath ?? ''), blockIndex: Number(event.source.blockIndex), itemPath: String(event.source.itemPath ?? '') };
    if (!ref.path || !Number.isInteger(ref.blockIndex) || !ref.itemPath) {
      return { code: -1, message: `${event.type} needs the document path, the block index and the path of the item` };
    }
    const scope: StructScope = event.data.scope === 'item' ? 'item' : 'subtree';
    // what the editor of an item asks while its text is typed: the text goes
    // into the edit, and the editor goes on in the item the edit leaves it in
    if (isFromSession) {
      const offsetGet = (name: string, fallback: number) => (Number.isInteger(event.data[name]) ? Number(event.data[name]) : fallback);
      const textLength = session!.textDraft.length;
      if (event.type === 'editItemSplitRequest') return this.sessionItemSplit(offsetGet('offsetStart', textLength), offsetGet('offsetEnd', textLength));
      if (event.type === 'editItemInsertRequest' && event.data.position === 'before') return this.sessionItemInsertBefore();
      if (event.type === 'editItemInsertRequest') return this.sessionItemSplit(textLength, textLength);
      if (event.type === 'editItemPartEnterRequest') return this.sessionItemPartEnter(Number(event.data.partIndex), event.data.selectionInitial);
      if (event.type === 'editItemPartLeaveRequest') {
        return this.sessionItemPartLeave(event.data.direction === 'before' ? 'before' : 'after', event.data.isRemoved === true, {
          isVertical: event.data.isVertical === true,
          point: event.data.point,
          pointCaret: event.data.pointCaret,
        });
      }
      if (event.type === 'editItemTextJoinRequest') return this.sessionItemTextJoin();
      if (event.type === 'editItemBlockSplitRequest') return this.sessionItemBlockSplitOut(offsetGet('offsetStart', textLength), offsetGet('offsetEnd', textLength));
      if (event.type === 'editItemBlockInsertRequest') {
        // the text of the surface, the slash text gone from it
        if (typeof event.data.text === 'string') this.editStore.sessionDraftSet(event.data.text);
        return this.sessionItemBlockInsert(String(event.data.source ?? ''), offsetGet('offset', textLength));
      }
      if (event.type === 'editItemMergeRequest') return this.sessionItemMerge(event.data.direction === 'next' ? 'next' : 'previous');
      if (event.type === 'editItemFormatRequest') return this.sessionItemBlockFormat(offsetGet('offsetStart', textLength), offsetGet('offsetEnd', textLength));
      if (event.type === 'editItemLevelRequest') {
        return this.sessionItemLevelChange(event.data.direction === 'out' ? 'out' : 'in', offsetGet('offset', textLength));
      }
    }
    if (event.type === 'editItemInsertRequest') {
      const position = event.data.position === 'before' ? 'before' : event.data.position === 'child' ? 'child' : 'after';
      return this.itemInsert(ref, position, typeof event.data.text === 'string' ? event.data.text : undefined);
    }
    if (event.type === 'editItemDeleteRequest') return this.itemDelete(ref, scope);
    if (event.type === 'editItemLevelRequest') return this.itemLevelChange(ref, event.data.direction === 'out' ? 'out' : 'in', scope);
    if (event.type === 'editItemMoveRequest') return this.itemMoveSibling(ref, event.data.direction === 'up' ? 'up' : 'down');
    if (event.type === 'editItemListTypeRequest') return this.itemListTypeSet(ref, event.data.type === 'ordered' ? 'ordered' : 'unordered');
    if (event.type === 'editItemCodeViewRequest') return this.itemCodeViewSet(ref, typeof event.data.view === 'string' ? event.data.view : '');
    if (event.type === 'editItemCodeAssetRequest') return this.itemCodeAssetMove(ref);
    if (event.type === 'editItemCodeTextRequest') return this.itemCodeTextSet(ref);
    return undefined;
  }

  // ---------- the edits of items ----------

  // a new item beside an item ('before' | 'after') or as its last child
  // ('child'). without a text it is created empty and opened at once, for
  // the author to type it; Escape removes it again, and so does leaving it
  // without a text.
  async itemInsert(ref: StructItemRef, position: 'before' | 'after' | 'child', text?: string): Promise<EditResult> {
    const result = await this.itemEdit(ref, (list) => listItemInsert(list, ref.itemPath, position, text ?? ''), { isSelectionKept: false });
    if (result.code !== 0 || text !== undefined) return result;
    runInAction(() => {
      this.selection = undefined;
    });
    const isStarted = await this.editStore.sessionItemStart(ref.path, ref.blockIndex, result.data.itemPath, { isCreated: true });
    return isStarted ? result : { code: -1, message: 'the new item was not opened for editing' };
  }

  // scope 'subtree': the item with what is under it; 'item': the item alone,
  // its children take its place
  async itemDelete(ref: StructItemRef, scope: StructScope = 'subtree'): Promise<EditResult> {
    const confirm = refIsSame(this.itemConfirm, ref) ? this.itemConfirm : undefined;
    if (confirm) {
      confirm.status = 'submitting';
      confirm.message = '';
    }
    const result = await this.itemEdit(ref, (list) => listItemDelete(list, ref.itemPath, scopeOfList(scope)), { isSelectionKept: false });
    runInAction(() => {
      if (!confirm || this.itemConfirm !== confirm) return;
      if (result.code === 0) {
        this.itemConfirm = undefined;
        this.itemWrite = undefined;
        return;
      }
      confirm.status = 'error';
      confirm.message = result.message;
      this.itemWrite = undefined;
    });
    if (result.code === 0) runInAction(() => { this.selection = undefined; });
    return result;
  }

  // one level deeper ('in') or up ('out'). scope 'item' takes the item
  // alone one level deeper, its children keeping their level; an item going
  // up always takes what is under it along.
  itemLevelChange(ref: StructItemRef, direction: 'in' | 'out', scope: StructScope = 'subtree'): Promise<EditResult> {
    return this.itemEdit(ref, (list) => (direction === 'in'
      ? listItemIndent(list, ref.itemPath, scopeOfList(scope))
      : listItemOutdent(list, ref.itemPath)));
  }

  // ---------- the edits asked from the editor of an item ----------
  // (doc_page_impl_edit_structure.md#the-keys-of-an-item) an edit of the
  // structure asked while an item is typed takes the text being typed along:
  // it is computed with the draft and written once, instead of a save and
  // then an edit. the session ends when the edit is computed, and the item
  // the edit leaves the author in is opened where the caret belongs.

  // Enter: the item split at the caret (a selected part of the text goes).
  // the item keeps the text before it; a new item below takes the text after
  // it and what was under the item, and the author goes on at its start.
  // in an item without text there is nothing to split: the item goes one
  // level up, and at the first level it is taken out, which ends the list
  // there.
  //
  // a text block is split the same way, at any place of its lines: each
  // part is written as its lines ask (itemTextWrite), a text block when it
  // still holds a line break, a plain line when it is one line. so Enter at
  // the end of a line of a block takes the lines after it into a new item,
  // and the fences are never lost. a block of code is not split (its editor
  // does not ask); the new-item button leaves it whole and adds an item.
  sessionItemSplit(offsetStart: number, offsetEnd: number): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textDraft, textItem, session }) => {
      // how a part is written: the session of a text block types lines, the
      // session of an item with icons types each block as one character
      const info: string | undefined = session.itemFormat === 'block' ? String(session.itemBlockInfo ?? '') : undefined;
      // a part (a code block among the text of the item) asks no split: the
      // new-item button of its bar adds an item after the item as it is written
      const isPart = Boolean(session.itemPart);
      const textWrite = (text: string) => {
        if (isPart) return text;
        return session.itemAtom ? itemAtomTextBuild(text, session.itemAtom) : itemTextWrite(text, info);
      };
      if (!isPart && textDraft.trim() === '') {
        const item = listItemGet(list, ref.itemPath);
        const isAtFirstLevel = !item?.pathParent;
        if (!isAtFirstLevel) {
          return {
            // the item is without text as typed, whatever text it had saved
            result: listEditThen(list, listItemTextSet(list, ref.itemPath, ''), (listNext: any, itemPath: string) => listItemOutdent(listNext, itemPath)),
            next: { isCreated: session.isCreated, selectionInitial: 'end' as EditSelectionInitial },
          };
        }
        // the way out of the list. an item that holds items is no way out:
        // taken out, they would be left without the item they are under
        if (itemChildListGet(item).length > 0) {
          return { result: { code: -1, message: 'This item holds the items under it. Type its text, or press Backspace to give them back to the item above.' } };
        }
        return { result: listItemDelete(list, ref.itemPath, LIST_SCOPE_ITEM) };
      }
      // what stands at the place of the split is text of neither item
      let { textBefore, textAfter } = info !== undefined && !itemBlockInfoIsText(info)
        ? { textBefore: textDraft, textAfter: '' }
        : itemTextSplit(textDraft, offsetStart, offsetEnd);
      if (isPart) ({ textBefore, textAfter } = { textBefore: textItem, textAfter: '' });
      // at the end of an item that has items under it, the new item is the
      // first of them: right below the caret, like any new item, and beside
      // the items the author sees there. (a split gives the second part what
      // is under the item, which a part without text has no claim to)
      if (textAfter === '' && itemChildListGet(listItemGet(list, ref.itemPath)).length > 0) {
        return {
          result: listEditThen(list, listItemTextSet(list, ref.itemPath, textWrite(textBefore)), (listNext: any, itemPath: string) => listItemInsert(listNext, `${itemPath}.0`, 'before', '')),
          next: { isCreated: true, selectionInitial: 'start' as EditSelectionInitial },
        };
      }
      return {
        result: listItemSplit(list, ref.itemPath, textWrite(textBefore), textAfter === '' ? '' : textWrite(textAfter)),
        // a new item without a text of its own is not kept when it is left so
        next: { isCreated: textAfter === '', selectionInitial: 'start' as EditSelectionInitial },
      };
    });
  }

  // Backspace at the start of an item: its text joins the row above, where
  // the author goes on at the place the texts meet. Delete at the end of an
  // item: the row below joins it the same way. the lines of a text block
  // join like lines of text (listItemMergeUp reads the texts as they are
  // written); a block of code joins nothing.
  sessionItemMerge(direction: 'previous' | 'next'): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textItem }) => {
      if (direction === 'previous') {
        const result = listItemMergeUp(list, ref.itemPath, { textItem });
        return { result, next: { selectionInitial: offsetSelectionGet(result) } };
      }
      const rowList: any[] = list.rowList;
      const itemNext = rowList[rowList.findIndex((item) => item.path === ref.itemPath) + 1];
      if (!itemNext) return { result: { code: -1, message: 'no item below it in the list' } };
      const result = listItemMergeUp(list, itemNext.path, { textReceiver: textItem });
      return { result, next: { selectionInitial: offsetSelectionGet(result) } };
    });
  }

  // Shift + Enter: the item becomes a text block, a fenced block of the
  // language "text" in which line breaks are kept, with a line break at the
  // caret; the author goes on in the block, after the break
  sessionItemBlockFormat(offsetStart: number, offsetEnd: number): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textDraft, session }) => {
      if (session.itemFormat === 'block') return { result: { code: -1, message: 'the item is a text block already' } };
      // an item with code blocks: the segment of text at the caret becomes a
      // text block of its own, and the author goes on in its lines
      if (session.itemAtom) return this.itemSegmentBlockCompute(list, ref, textDraft, session.itemAtom, offsetStart, offsetEnd);
      const textBefore = textDraft.slice(0, offsetStart);
      const textInner = `${textBefore}\n${textDraft.slice(Math.max(offsetStart, offsetEnd))}`;
      return {
        result: listItemTextSet(list, ref.itemPath, itemBlockTextBuild(textInner, 'text')),
        next: { selectionInitial: { type: 'offset', offset: textBefore.length + 1 } as EditSelectionInitial },
      };
    });
  }

  // Tab / Shift + Tab: the level of the item being typed, with what is under
  // it; the caret stays where it was in the text
  sessionItemLevelChange(direction: 'in' | 'out', offset: number): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textItem, session }) => ({
      result: listEditThen(list, listItemTextSet(list, ref.itemPath, textItem), (listNext: any, itemPath: string) => (direction === 'in'
        ? listItemIndent(listNext, itemPath, LIST_SCOPE_SUBTREE)
        : listItemOutdent(listNext, itemPath))),
      next: { isCreated: session.isCreated, selectionInitial: { type: 'offset', offset } as EditSelectionInitial, partIndex: session.itemPart?.index },
    }));
  }

  // Shift + Enter in the text of an item with code blocks: the segment of
  // text the caret is in (the run between two chips, or a line break) becomes
  // a fenced block of language text, its lines broken at the caret, written
  // between what stands before and after it; the author goes on in the lines
  // of that block, a part of the item, after the break. its view is the one
  // the config gives a block in the text of an item (CodeBlockViewInListItem)
  private itemSegmentBlockCompute(list: any, ref: StructItemRef, display: string, model: any, offsetStart: number, offsetEnd: number) {
    const isBoundary = (char: string) => char === '\n' || itemAtomCharIs(char);
    let start = Math.max(0, Math.min(offsetStart, display.length));
    let end = Math.max(start, Math.min(offsetEnd, display.length));
    while (start > 0 && !isBoundary(display[start - 1])) start -= 1;
    while (end < display.length && !isBoundary(display[end])) end += 1;
    // the spaces at the break are text of neither line, as at a split
    const lineBefore = display.slice(start, Math.min(offsetStart, offsetEnd)).trim();
    const lineAfter = display.slice(Math.max(offsetStart, offsetEnd), end).trim();
    const sourceBefore = itemAtomTextBuild(display.slice(0, start), model).replace(/\s+$/, '');
    const sourceAfter = itemAtomTextBuild(display.slice(end), model).replace(/^\s+/, '');
    const textNew = [sourceBefore, itemBlockTextBuild(`${lineBefore}\n${lineAfter}`, 'text'), sourceAfter].filter((text) => text !== '').join('\n');
    return {
      result: listItemTextSet(list, ref.itemPath, textNew),
      next: {
        partIndex: itemCodeBlockListGet(sourceBefore).length,
        selectionInitial: { type: 'offset', offset: lineBefore.length + 1 } as EditSelectionInitial,
      },
    };
  }

  // a part left by its edges (← at its start, → at its end, ↑ / ↓ from its
  // first / last line), or taken out (Backspace in its empty lines): its lines
  // written into the item, and the author goes on in the text of the item,
  // the caret before or after its chip (where it was, when it was taken out).
  // left by ↑ / ↓ (isVertical), the caret goes on the line above or below the
  // block at the same x (point), and when nothing of the item stands there,
  // on to the row above or below, as from any item (pointCaret: its x)
  async sessionItemPartLeave(
    direction: 'before' | 'after',
    isRemoved: boolean,
    { isVertical = false, point, pointCaret }: { isVertical?: boolean; point?: any; pointCaret?: any } = {},
  ): Promise<EditResult> {
    const session = this.editStore.session;
    if (isVertical && session?.type === 'item' && session.itemPart) {
      const list = this.editStore.docEditGet(session.path)?.model?.blockList[session.blockIndex]?.list;
      const textOwn = list ? listItemTextGet(list, String(session.itemPath)) : '';
      const block = itemCodeBlockListGet(textOwn)[session.itemPart.index];
      const isBeyondEmpty = block && (direction === 'before' ? textOwn.slice(0, block.start) : textOwn.slice(block.end)).trim() === '';
      if (isBeyondEmpty) {
        const isShifted = await this.editStore.sessionFocusShift(direction === 'before' ? 'previous' : 'next', pointCaret);
        return isShifted ? { code: 0, message: '' } : { code: -1, message: `nothing ${direction === 'before' ? 'above' : 'below'} the block the caret can enter` };
      }
    }
    return this.sessionItemEdit((list, { ref, textDraft, session: sessionOpen }) => {
      const session = sessionOpen;
      const index = session.itemPart?.index;
      if (index === undefined) return { result: { code: -1, message: 'no part of the item is being edited' } };
      const written = itemPartTextWrite(listItemTextGet(list, ref.itemPath), index, textDraft, { isRemoved });
      if (!written) return { result: { code: -1, message: 'the block is not in the item anymore' } };
      const offset = isRemoved || direction === 'before'
        ? itemPartOffsetGet(written.text, written.start, 'before')
        : itemPartOffsetGet(written.text, written.end, 'after');
      const selectionInitial: EditSelectionInitial = isVertical && !isRemoved && Number.isFinite(point?.clientX) && Number.isFinite(point?.clientY)
        ? { type: 'point', clientX: point.clientX, clientY: point.clientY }
        : { type: 'offset', offset, isSource: true };
      return { result: listItemTextSet(list, ref.itemPath, written.text), next: { selectionInitial } };
    });
  }

  // the chip of a block double-clicked in the text of the item: the text is
  // written, and the lines of that block are edited where they are drawn
  sessionItemPartEnter(partIndex: number, selectionInitial?: EditSelectionInitial): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textItem }) => ({
      result: listItemTextSet(list, ref.itemPath, textItem),
      next: { partIndex, selectionInitial: selectionInitial ?? ('end' as EditSelectionInitial) },
    }));
  }

  // Enter in the lines of a code block of an item (a part, or a block of code
  // that is the whole item): the lines after the caret leave the block and
  // become text of the item right after it, joined to the text that follows
  // it there (itemBlockSplitOut); the author goes on at the start of that text
  sessionItemBlockSplitOut(offsetStart: number, offsetEnd: number): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textDraft, session }) => {
      if (session.itemFormat !== 'block') return { result: { code: -1, message: 'the item is not edited as the lines of a block' } };
      const split = itemBlockSplitOut(listItemTextGet(list, ref.itemPath), session.itemPart?.index ?? 0, textDraft, offsetStart, offsetEnd, {
        textJoin: codeTextJoin,
        spaceIs: textJoinSpaceIs,
      });
      if (!split) return { result: { code: -1, message: 'the block is not in the item anymore' } };
      return {
        result: listItemTextSet(list, ref.itemPath, split.text),
        next: { selectionInitial: { type: 'offset', offset: split.offset, isSource: true } as EditSelectionInitial },
      };
    });
  }

  // a block put at the caret of the text of an item (an MDX block chosen with
  // the slash mode): written there, on lines of its own between the text
  // before and after the caret, and the author goes on after its chip
  sessionItemBlockInsert(source: string, offset: number): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textDraft, session }) => {
      if (session.itemPart) return { result: { code: -1, message: 'a block goes into the text of the item, not into the lines of a block' } };
      if (session.itemFormat === 'block') return { result: { code: -1, message: 'the item is a block: add the block in an item of text' } };
      const offsetCut = Math.max(0, Math.min(offset, textDraft.length));
      const textWrite = (text: string) => (session.itemAtom ? itemAtomTextBuild(text, session.itemAtom) : text);
      const sourceBefore = textWrite(textDraft.slice(0, offsetCut)).replace(/\s+$/, '');
      const sourceAfter = textWrite(textDraft.slice(offsetCut)).replace(/^\s+/, '');
      const textNew = [sourceBefore, source, sourceAfter].filter((text) => text !== '').join('\n');
      const offsetAfter = (sourceBefore === '' ? 0 : sourceBefore.length + 1) + source.length;
      // a block whose lines are edited where they are drawn (a code block in a
      // view other than icon): the author goes on in its lines at once. an
      // icon, an MDX block: the caret after its chip
      const partIndex = itemCodeBlockListGet(sourceBefore).length;
      const isPart = Boolean(itemPartGet(textNew, partIndex))
        && this.editStore.itemAtomModelGet(ref.path, textNew)?.atomList[partIndex]?.kind === 'block';
      return {
        result: listItemTextSet(list, ref.itemPath, textNew),
        // the block alone, the whole item: its lines (a code block) or after its chip
        next: isPart
          ? { partIndex, selectionInitial: 'start' as EditSelectionInitial }
          : sourceBefore === '' && sourceAfter === ''
            ? { selectionInitial: 'end' as EditSelectionInitial }
            : { selectionInitial: { type: 'offset', offset: offsetAfter, isSource: true } as EditSelectionInitial },
      };
    });
  }

  // the new-item button above of the bar: the item written as it is typed,
  // a new item without text right before it, opened
  sessionItemInsertBefore(): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textItem }) => ({
      result: listEditThen(list, listItemTextSet(list, ref.itemPath, textItem), (listNext: any, itemPath: string) => listItemInsert(listNext, itemPath, 'before', '')),
      next: { isCreated: true, selectionInitial: 'start' as EditSelectionInitial },
    }));
  }

  // To text, in the bar of an item edited as the lines of a code block (the
  // whole item, or a part): the lines joined into one line of text, the line
  // breaks removed (codeTextJoin), in the place of the block
  sessionItemTextJoin(): Promise<EditResult> {
    return this.sessionItemEdit((list, { ref, textDraft, session }) => {
      if (session.itemFormat !== 'block') return { result: { code: -1, message: 'the item is not a code block' } };
      const joined = codeTextJoin(textDraft);
      if (joined === '') return { result: { code: -1, message: 'the block has no text to keep' } };
      const index = session.itemPart?.index;
      if (index === undefined) return { result: listItemTextSet(list, ref.itemPath, joined), next: { selectionInitial: 'end' as EditSelectionInitial } };
      const textOwn = listItemTextGet(list, ref.itemPath);
      const block = itemCodeBlockListGet(textOwn)[index];
      if (!block) return { result: { code: -1, message: 'the block is not in the item anymore' } };
      // the line breaks around it go too, where a line of text stands beside it:
      // the text runs on, a space apart (none between CJK characters)
      let head = textOwn.slice(0, block.start);
      let tail = textOwn.slice(block.end);
      const isTextLine = (line: string | undefined) => line !== undefined && line.trim() !== '' && !/^\s*(`{3,}|~{3,}|<!--)/.test(line);
      const lineBefore = head.endsWith('\n') ? head.slice(0, -1).split('\n').pop() : undefined;
      const lineAfter = tail.startsWith('\n') ? tail.slice(1).split('\n')[0] : undefined;
      if (isTextLine(lineBefore)) head = head.slice(0, -1) + (textJoinSpaceIs(lineBefore, joined) ? ' ' : '');
      if (isTextLine(lineAfter)) tail = (textJoinSpaceIs(joined, lineAfter) ? ' ' : '') + tail.slice(1);
      return {
        result: listItemTextSet(list, ref.itemPath, `${head}${joined}${tail}`),
        next: { selectionInitial: { type: 'offset', offset: head.length + joined.length, isSource: true } as EditSelectionInitial },
      };
    });
  }

  // To text, from the list menu of an item that is a code block: its lines
  // joined into one line of text, the item a plain item ('' when it can be)
  itemCodeTextReasonGet(ref: StructItemRef): string {
    const text = this.itemTextGet(ref);
    const parsed = codeBlockTextParse(text);
    if (!parsed || !codeTextViewGet(text)) return 'the item is not a code block';
    if (parsed.lang === 'asset') return 'the lines are an item of the asset store: open its panel to read them';
    if (codeTextJoin(parsed.value) === '') return 'the block has no text';
    return '';
  }

  itemCodeTextSet(ref: StructItemRef): Promise<EditResult> {
    const reason = this.itemCodeTextReasonGet(ref);
    if (reason) return Promise.resolve(this.itemWriteFail(ref, reason));
    return this.itemEdit(ref, (list) => {
      const parsed = codeBlockTextParse(listItemTextGet(list, ref.itemPath));
      if (!parsed) return { code: -1, message: 'the item is not a code block' };
      // an Anchor before the block stays, the marker of Code goes with the block
      const prefixList = parsed.linePrefixList.filter((line: string) => !/^\s*<!--\s*renderComp=Code\b/.test(line));
      return listItemTextSet(list, ref.itemPath, [...prefixList, codeTextJoin(parsed.value)].join('\n'));
    });
  }

  // one edit asked from the editor of an item.
  //   compute(list, { ref, textDraft, textItem, session }) -> { result, next }
  //     textDraft   the text as typed; textItem: as the item is written (a
  //                 text block inside its fences)
  //     result      the edit, computed with the text
  //     next        how the editor goes on in the item the result names
  //                 (data.itemPath): { selectionInitial, isCreated };
  //                 undefined: the editing ends
  // a result that is refused keeps the session open, with the reason in its
  // bar; a write that fails opens the item again with the text typed.
  private async sessionItemEdit(compute: (list: any, context: {
    ref: StructItemRef; textDraft: string; textItem: string; session: any;
  }) => { result: EditResult; next?: { selectionInitial?: EditSelectionInitial; isCreated?: boolean; partIndex?: number } }): Promise<EditResult> {
    const session = this.editStore.session;
    if (!session || session.type !== 'item' || session.status === 'submitting') return { code: -1, message: 'no item is being edited' };
    if (this.itemWrite?.status === 'submitting') return { code: -1, message: 'another change of the list is being written' };
    const ref: StructItemRef = { path: session.path, blockIndex: session.blockIndex, itemPath: String(session.itemPath) };
    const state = this.editStore.docEditGet(ref.path);
    const list = state?.model?.blockList[ref.blockIndex]?.list;
    if (!state || !list || this.editStore.docEditIsStale(ref.path)) return { code: -1, message: 'the document is being read again' };
    const textDraft = session.textDraft.replace(/\r\n/g, '\n');
    const textItem = this.editStore.sessionItemTextGet();
    let computed: { result: EditResult; next?: { selectionInitial?: EditSelectionInitial; isCreated?: boolean; partIndex?: number } };
    try {
      computed = compute(list, { ref, textDraft, textItem, session });
    } catch (error: any) {
      computed = { result: { code: -1, message: String(error?.message ?? error) } };
    }
    const { result, next } = computed;
    if (result.code !== 0) {
      this.editStore.sessionMessageSet(result.message);
      return result;
    }
    // the text of the session is in the edit now
    if (!this.editStore.sessionDiscard()) return { code: -1, message: 'the edit of the item is being saved' };
    // what is typed until the editor is open again is kept for it
    const isEditorNext = Boolean(next && result.data.itemPath && !result.data.isListEmpty);
    if (isEditorNext) this.typeAheadOpen();
    else this.typeAheadClose();
    if (!result.data.isNoop) {
      const change = result.data.isListEmpty
        ? { blockIndex: ref.blockIndex, isRemoved: true }
        : { blockIndex: ref.blockIndex, text: result.data.text };
      const resultWrite = await this.itemWriteRun(ref, () => this.editStore.blockChangeListApply(ref.path, state.hash, [change], { messageFailure: 'The list was not changed.' }));
      if (resultWrite.code !== 0) {
        // nothing typed is lost: the item is opened again with its draft
        runInAction(() => { this.itemWrite = undefined; });
        const isReopened = await this.editStore.sessionItemStart(ref.path, ref.blockIndex, ref.itemPath, { textDraft, isCreated: session.isCreated, partIndex: session.itemPart?.index });
        if (!isReopened) this.typeAheadClose();
        this.editStore.sessionMessageSet(resultWrite.message);
        return resultWrite;
      }
    }
    const data = { blockIndex: ref.blockIndex, itemPath: result.data.itemPath, isNoop: result.data.isNoop === true };
    if (next && isEditorNext) {
      const isStarted = await this.editStore.sessionItemStart(ref.path, ref.blockIndex, result.data.itemPath, {
        selectionInitial: next.selectionInitial,
        isCreated: next.isCreated === true,
        partIndex: next.partIndex,
      });
      // no editor to take what was typed
      if (!isStarted) this.typeAheadClose();
    }
    return { code: 0, message: '', data };
  }

  // the own text of an item replaced (what its editor saves, without a session)
  itemTextSet(ref: StructItemRef, text: string): Promise<EditResult> {
    return this.itemEdit(ref, (list) => listItemTextSet(list, ref.itemPath, text));
  }

  // swapped with the item before or after it in its list, with what is under it
  itemMoveSibling(ref: StructItemRef, direction: 'up' | 'down'): Promise<EditResult> {
    return this.itemEdit(ref, (list) => listItemMoveSibling(list, ref.itemPath, direction));
  }

  // the list the item is in as bullets or numbers
  itemListTypeSet(ref: StructItemRef, type: 'ordered' | 'unordered'): Promise<EditResult> {
    return this.itemEdit(ref, (list) => listItemListTypeSet(list, ref.itemPath, type));
  }

  // an item moved to a place of a list block: the same block, or another
  // list block of the document (then both blocks are written in one write,
  // and a list whose last item left is removed).
  //   target   { blockIndex, itemPath, position: 'before' | 'after' | 'childFirst' | 'childLast' }
  async itemMoveTo(
    ref: StructItemRef,
    scope: StructScope,
    target: { blockIndex: number; itemPath: string; position: string },
  ): Promise<EditResult> {
    if (target.blockIndex === ref.blockIndex) {
      return this.itemEdit(ref, (list) => listItemMove(list, ref.itemPath, scopeOfList(scope), { itemPath: target.itemPath, position: target.position }));
    }
    if (this.itemWrite?.status === 'submitting') return { code: -1, message: 'another change of the list is being written' };
    const prepared = await this.itemEditPrepare(ref);
    if (prepared.code !== 0) return this.itemWriteFail(ref, prepared.message);
    const { hash, list } = prepared.data;
    const listTarget = this.listGet(ref.path, target.blockIndex);
    if (!listTarget) return this.itemWriteFail(ref, 'the place is not in a list anymore');
    const detached = listItemDetach(list, ref.itemPath, scopeOfList(scope));
    if (detached.code !== 0) return this.itemWriteFail(ref, detached.message);
    const attached = listItemAttach(listTarget, detached.data.item, { itemPath: target.itemPath, position: target.position });
    if (attached.code !== 0) return this.itemWriteFail(ref, attached.message);
    const isRemoved = detached.data.isListEmpty === true;
    const result = await this.itemWriteRun(ref, () => this.editStore.blockChangeListApply(ref.path, hash, [
      isRemoved ? { blockIndex: ref.blockIndex, isRemoved: true } : { blockIndex: ref.blockIndex, text: detached.data.text },
      { blockIndex: target.blockIndex, text: attached.data.text },
    ], { messageFailure: 'The item was not moved.' }));
    if (result.code !== 0) return result;
    // a list block removed above the one the item went into renumbers it
    const blockIndexNext = isRemoved && ref.blockIndex < target.blockIndex ? target.blockIndex - 1 : target.blockIndex;
    this.selectionFollow(ref, { path: ref.path, blockIndex: blockIndexNext, itemPath: attached.data.itemPath }, true);
    return { code: 0, message: '', data: { blockIndex: blockIndexNext, itemPath: attached.data.itemPath } };
  }

  // one edit of the items of a list block: the open session is left, the
  // edit is computed on the item model of the text the document then has,
  // and the new text of the block is written (or the block removed, when its
  // last item left). a selection on the item follows it to its new place.
  private async itemEdit(
    ref: StructItemRef,
    compute: (list: any) => EditResult,
    { isSelectionKept = true }: { isSelectionKept?: boolean } = {},
  ): Promise<EditResult> {
    if (this.itemWrite?.status === 'submitting') return { code: -1, message: 'another change of the list is being written' };
    const prepared = await this.itemEditPrepare(ref);
    if (prepared.code !== 0) return this.itemWriteFail(ref, prepared.message);
    const { hash, list } = prepared.data;
    let computed: EditResult;
    try {
      computed = compute(list);
    } catch (error: any) {
      computed = { code: -1, message: String(error?.message ?? error) };
    }
    if (computed.code !== 0) return this.itemWriteFail(ref, computed.message);
    // what an edit answers: where the item is now
    const data = {
      blockIndex: ref.blockIndex,
      itemPath: computed.data.itemPath,
      isNoop: computed.data.isNoop === true,
      isListEmpty: computed.data.isListEmpty === true,
    };
    if (data.isNoop) {
      runInAction(() => { this.itemMenu = undefined; });
      return { code: 0, message: '', data };
    }
    const change = computed.data.isListEmpty
      ? { blockIndex: ref.blockIndex, isRemoved: true }
      : { blockIndex: ref.blockIndex, text: computed.data.text };
    const result = await this.itemWriteRun(ref, () => this.editStore.blockChangeListApply(ref.path, hash, [change], { messageFailure: 'The list was not changed.' }));
    if (result.code !== 0) return result;
    this.selectionFollow(ref, { path: ref.path, blockIndex: ref.blockIndex, itemPath: computed.data.itemPath }, isSelectionKept);
    return { code: 0, message: '', data };
  }

  // the item model an edit is computed on, with the hash of its text
  private async itemEditPrepare(ref: StructItemRef): Promise<EditResult> {
    if (!this.editStore.docIsEditable(ref.path)) return { code: -1, message: 'This document cannot be edited.' };
    const isLeft = await this.editStore.sessionLeaveForIndexAction(ref.path);
    if (!isLeft) return { code: -1, message: this.editStore.session?.message || 'The open edit could not be saved.' };
    const state = this.editStore.docEditGet(ref.path);
    const block = state?.model?.blockList[ref.blockIndex];
    if (!state || !block) return { code: -1, message: 'The list is not in the document anymore.' };
    if (!block.list) return { code: -1, message: block.listMessage ? `The items of this list cannot be edited one by one: ${block.listMessage}.` : 'The block is not a list.' };
    if (!listItemGet(block.list, ref.itemPath)) return { code: -1, message: 'The item is not in the list anymore.' };
    return { code: 0, message: '', data: { hash: state.hash, list: block.list } };
  }

  private async itemWriteRun(ref: StructItemRef, write: () => Promise<EditResult>): Promise<EditResult> {
    const itemWrite = runInAction(() => {
      this.itemMenu = undefined;
      this.itemWrite = { ...ref, status: 'submitting', message: '' };
      return this.itemWrite!;
    });
    const result = await write();
    runInAction(() => {
      if (this.itemWrite !== itemWrite) return;
      if (result.code === 0) this.itemWrite = undefined;
      else {
        itemWrite.status = 'error';
        itemWrite.message = result.message;
      }
    });
    return result;
  }

  private itemWriteFail(ref: StructItemRef, message: string): EditResult {
    runInAction(() => {
      this.itemMenu = undefined;
      this.itemWrite = { ...ref, status: 'error', message };
    });
    return { code: -1, message };
  }

  // after a write: the selection that was on the item is on it again, in the
  // new text of the document, at its new place
  private selectionFollow(ref: StructItemRef, refNext: StructItemRef, isSelectionKept: boolean) {
    const selection = this.selection;
    const isOnItem = selection !== undefined && selection.path === ref.path && selection.blockIndex === ref.blockIndex
      && selection.scope !== 'block' && selection.itemPath === ref.itemPath;
    runInAction(() => {
      if (!isOnItem || !isSelectionKept || !refNext.itemPath) {
        if (isOnItem) this.selection = undefined;
        return;
      }
      const hash = this.editStore.docEditGet(ref.path)?.hash ?? '';
      const list = this.listGet(refNext.path, refNext.blockIndex);
      if (!listItemGet(list, refNext.itemPath)) {
        this.selection = undefined;
        return;
      }
      this.selection = { ...selection!, hash, blockIndex: refNext.blockIndex, itemPath: refNext.itemPath, itemPathAnchor: refNext.itemPath };
    });
  }

  // ---------- the deletion of an item, confirmed in its toolbar ----------

  itemConfirmIs(ref: StructItemRef): boolean {
    return refIsSame(this.itemConfirm, ref);
  }

  // scope: what the confirmation deletes; undefined: it offers the item with
  // what is under it and the item alone
  itemConfirmSet(ref: StructItemRef, scope?: StructScope) {
    if (this.itemConfirm?.status === 'submitting') return;
    this.itemMenu = undefined;
    this.itemWrite = undefined;
    this.itemConfirm = { ...ref, scope, status: 'confirming', message: '' };
  }

  itemConfirmClear() {
    if (this.itemConfirm?.status === 'submitting') return;
    this.itemConfirm = undefined;
  }

  // ---------- the lines of an item moved into the store, confirmed in its toolbar ----------

  itemCodeAssetConfirmIs(ref: StructItemRef): boolean {
    return refIsSame(this.itemCodeAssetConfirm, ref);
  }

  itemCodeAssetConfirmSet(ref: StructItemRef) {
    if (this.itemCodeAssetMoveReasonGet(ref)) return;
    this.itemMenu = undefined;
    this.itemWrite = undefined;
    this.itemConfirm = undefined;
    this.itemCodeAssetConfirm = { ...ref };
  }

  itemCodeAssetConfirmClear() {
    this.itemCodeAssetConfirm = undefined;
  }

  // ---------- blocks ----------

  // the selected block swapped with its neighbor; the selection stays on it
  async selectionBlockMove(direction: 'up' | 'down'): Promise<EditResult> {
    const selection = this.selection && this.selectionGet(this.selection.path);
    if (!selection || selection.scope !== 'block') return { code: -1, message: 'no block is selected' };
    const { path, blockIndex } = selection;
    const isMoved = await this.editStore.blockMoveApply(path, blockIndex, direction);
    if (!isMoved) return { code: -1, message: this.editStore.blockMove?.message || 'the block was not moved' };
    this.selectionBlockFollow(path, blockIndex + (direction === 'up' ? -1 : 1));
    return { code: 0, message: '' };
  }

  // a block moved to a border of its document (before block n; the number
  // of blocks: after the last one); a selection on it follows it
  async blockMoveTo(path: string, blockIndex: number, borderIndex: number): Promise<EditResult> {
    const isLeft = await this.editStore.sessionLeaveForIndexAction(path);
    if (!isLeft) return { code: -1, message: this.editStore.session?.message || 'The open edit could not be saved.' };
    const state = this.editStore.docEditGet(path);
    if (!state?.model) return { code: -1, message: 'The document is not loaded.' };
    const result = await this.editStore.blockListMove(path, state.hash, [blockIndex], path, borderIndex);
    if (result.code !== 0 || result.data?.isNoop) return result;
    this.selectionBlockFollow(path, borderIndex > blockIndex ? borderIndex - 1 : borderIndex);
    return result;
  }

  private selectionBlockFollow(path: string, blockIndexNext: number) {
    runInAction(() => {
      const state = this.editStore.docEditGet(path);
      if (!this.selection || this.selection.path !== path || !state?.model?.blockList[blockIndexNext]) return;
      this.selection = { path, hash: state.hash, blockIndex: blockIndexNext, itemPath: '', scope: 'block', itemPathAnchor: '' };
    });
  }

  // ---------- dragging the selection ----------

  get isDragging(): boolean {
    return this.drag !== undefined;
  }

  // starts a drag of the selection of the document
  dragStart(path: string, pointer: { clientX: number; clientY: number }): boolean {
    const selection = this.selectionGet(path);
    if (!selection || this.isSubmitting) return false;
    const label = this.selectionLabelGet(selection);
    const block = this.blockGet(path, selection.blockIndex);
    const textFirst = selection.scope === 'block'
      ? String(block?.text ?? '').split('\n')[0]
      : this.itemTextGet(selection).split('\n')[0];
    this.overlayClose();
    this.drag = {
      path,
      hash: selection.hash,
      subject: {
        kind: selection.scope === 'block' ? 'block' : 'item',
        blockIndex: selection.blockIndex,
        itemPath: selection.itemPath,
        scope: selection.scope,
        depth: selection.scope === 'block' ? 0 : pathDepthGet(selection.itemPath),
        label: textFirst.trim().slice(0, 60),
        countExtra: label.countExtra,
      },
      pointer: { ...pointer },
      target: undefined,
      indicator: undefined,
      status: 'dragging',
    };
    return true;
  }

  // the pointer moved: where it is, and the place the layer found under it
  // (undefined: none). a place that would change nothing, or that lies in
  // what is dragged, is no place.
  dragMove(pointer: { clientX: number; clientY: number }, target: StructDropTarget | undefined, indicator?: StructDropIndicator) {
    const drag = this.drag;
    if (!drag || drag.status !== 'dragging') return;
    drag.pointer = { ...pointer };
    const targetNext = target && this.dragTargetReasonGet(target) === '' ? target : undefined;
    if (!targetIsSame(drag.target, targetNext)) drag.target = targetNext;
    const indicatorNext = targetNext ? indicator : undefined;
    if (JSON.stringify(drag.indicator) !== JSON.stringify(indicatorNext)) drag.indicator = indicatorNext;
  }

  // why the dragged thing cannot go to a place, '' when it can
  dragTargetReasonGet(target: StructDropTarget): string {
    const drag = this.drag;
    if (!drag) return 'nothing is dragged';
    const { subject } = drag;
    if (subject.kind !== target.kind) return subject.kind === 'block' ? 'a block goes between blocks' : 'an item goes into a list';
    if (target.kind === 'block') {
      if (target.borderIndex === subject.blockIndex || target.borderIndex === subject.blockIndex + 1) return 'it already is there';
      return '';
    }
    if (target.blockIndex === subject.blockIndex && pathIsWithin(target.itemPath, subject.itemPath)) return 'an item cannot move into itself';
    return '';
  }

  dragCancel() {
    if (this.drag?.status === 'submitting') return;
    this.drag = undefined;
  }

  // the pointer was released: the dragged thing goes to the place under it
  async dragDrop(): Promise<EditResult> {
    const drag = this.drag;
    if (!drag || drag.status !== 'dragging') return { code: -1, message: 'nothing is dragged' };
    if (!drag.target) {
      this.drag = undefined;
      return { code: 0, message: '', data: { isNoop: true } };
    }
    drag.status = 'submitting';
    const result = await this.dragDropApply(drag.target);
    runInAction(() => {
      if (this.drag === drag) this.drag = undefined;
    });
    return result;
  }

  // the selection moved to a place (the drop of a drag; also what the api
  // of a structural move calls)
  async dragDropApply(target: StructDropTarget | undefined): Promise<EditResult> {
    const selection = this.selection && this.selectionGet(this.selection.path);
    if (!selection) return { code: -1, message: 'nothing is selected' };
    if (!target) return { code: -1, message: 'the move names no place' };
    if (target.kind === 'block') {
      if (selection.scope !== 'block') return { code: -1, message: 'an item goes into a list, not between blocks' };
      return this.blockMoveTo(selection.path, selection.blockIndex, Number(target.borderIndex));
    }
    if (selection.scope === 'block') return { code: -1, message: 'a block goes between blocks, not into a list' };
    return this.itemMoveTo(selection, selection.scope, {
      blockIndex: Number(target.blockIndex),
      itemPath: String(target.itemPath),
      position: String(target.position),
    });
  }
}

// ---------- helpers ----------

// the caret where two joined texts meet
function offsetSelectionGet(result: EditResult): EditSelectionInitial {
  if (result.code !== 0 || !Number.isInteger(result.data?.offset)) return 'end';
  return result.data.isOffsetSource === true
    ? { type: 'offset', offset: result.data.offset, isSource: true }
    : { type: 'offset', offset: result.data.offset };
}

function refIsSame(refA: StructItemRef | undefined, refB: StructItemRef | undefined): boolean {
  return Boolean(refA && refB) && refA!.path === refB!.path && refA!.blockIndex === refB!.blockIndex && refA!.itemPath === refB!.itemPath;
}

function scopeOfList(scope: StructScope): string {
  return scope === 'item' ? LIST_SCOPE_ITEM : LIST_SCOPE_SUBTREE;
}

function targetIsSame(targetA: StructDropTarget | undefined, targetB: StructDropTarget | undefined): boolean {
  if (!targetA || !targetB) return targetA === targetB;
  return JSON.stringify(targetA) === JSON.stringify(targetB);
}

// an item of the block lies in the selection (itemPath '': the block itself)
export function selectionHolds(selection: StructSelection, itemPath: string): boolean {
  if (selection.scope === 'block') return true;
  if (!itemPath) return false;
  if (selection.scope === 'item') return selection.itemPath === itemPath;
  return pathIsWithin(itemPath, selection.itemPath);
}

// the selection one step larger: the item with what is under it, then the
// item above with what is under it, ..., then the whole block, then the
// item it started from again
function selectionGrow(selection: StructSelection, list: any, itemPathAnchor: string): { itemPath: string; scope: StructScope } {
  if (selection.scope === 'block') {
    return itemPathAnchor && listItemGet(list, itemPathAnchor) ? { itemPath: itemPathAnchor, scope: 'item' } : { itemPath: '', scope: 'block' };
  }
  const item = listItemGet(list, selection.itemPath);
  if (!item) return { itemPath: '', scope: 'block' };
  if (selection.scope === 'item' && itemChildListGet(item).length > 0) return { itemPath: item.path, scope: 'subtree' };
  return item.pathParent ? { itemPath: item.pathParent, scope: 'subtree' } : { itemPath: '', scope: 'block' };
}
