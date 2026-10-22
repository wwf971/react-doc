import { makeAutoObservable, runInAction } from 'mobx';
import type { DocEditStore } from './DocEditStore.js';
import type { BlockPlace, BlockPlacePosition } from './DocPasteStore.js';
import { blockPlaceBuild, blockPlaceNodeChange, blockPlaceResolve } from '../lib/doc-block-place.js';
import { blockListMoveOperationListBuild } from '../lib/doc-edit-block.js';

// Selecting the blocks of a document, and copying or moving them to a place
// of a document (design: doc_page_impl_copy_paste.md#selecting-blocks).
// The mode itself is DocEditStore.isBlockSelectMode, never on together with
// edit mode; it shows the body of edit mode, whose blocks are selected here
// instead of edited.
//
// It is also where the page knows which blocks the author is at, in any
// mode with blocks (blockIndexListCurrentGet, doc_page_impl_copy_paste.md
// #the-blocks-the-author-is-at): the selection of the mode, the block of an
// open session, or the blocks a text selection touches in edit mode. a
// feature that acts "here" asks for them (a paste goes after them; the mode
// switched on starts with them selected).
//
//   selection    the blocks selected: { path, hash, blockIndexList,
//                blockIndexAnchor }. it belongs to the text it was made in
//                (hash): a new text of the document may number its blocks
//                otherwise, so the selection then counts as empty
//   textSelection  the blocks the text selection of the page touches in
//                the body of edit mode: { path, hash, blockIndexList }, set
//                by the body (DocEditBody) as the selection changes; like
//                the selection, it belongs to the text it was made in
//   contextMenu  the right-click menu of the selection:
//     blockIndex, offset     the block right-clicked and the point in it;
//                            the menu stays at that point of the block
//                            when the page scrolls
//     openId                 changes with every opening, so a menu opened
//                            again at another point is a new menu
//     step                   actions | deleteConfirm (the menu asks first)
//     status, message        idle | submitting | error: a write started
//                            from the menu (duplicate, delete)
//   transfer     the one open dialog that copies or moves blocks
//                (comp-doc/block-select/DocBlockTransferPopup.jsx):
//     actionInitial          the entry of the menu it was opened with; both
//                            Copy and Move stay possible in the dialog
//     sourcePath, sourceHash the document the blocks come from, at the text
//                            they were chosen in
//     blockIndexOfferedList  the selection the dialog was opened with
//     blockIndexCheckedList  what Copy / Move takes, checked in the dialog
//     isSourceAllShown       the dialog lists every block of the document
//                            (the offered ones checked at first)
//     listDisplay            compact (one line per block) | full (sources)
//     isRenderedById         blocks of the full list shown rendered
//     targetStep             doc: choosing the document | place: the place in it
//     targetDocPath, targetDocMessage   the document chosen, why it cannot be used
//     place                  { docPath, nodeId, position } (lib/doc-block-place.js)
//     status, message        choosing | submitting | error

export type BlockTransferAction = 'copy' | 'move';

export type BlockSelection = { path: string; hash: string; blockIndexList: number[]; blockIndexAnchor: number };

export type BlockTextSelection = { path: string; hash: string; blockIndexList: number[] };

export type BlockSelectContextMenu = {
  path: string;
  blockIndex: number;
  offset: { x: number; y: number };
  openId: number;
  step: 'actions' | 'deleteConfirm';
  status: 'idle' | 'submitting' | 'error';
  message: string;
};

export type BlockTransfer = {
  actionInitial: BlockTransferAction;
  sourcePath: string;
  sourceHash: string;
  blockIndexOfferedList: number[];
  blockIndexCheckedList: number[];
  isSourceAllShown: boolean;
  listDisplay: 'compact' | 'full';
  isRenderedById: Record<string, boolean>;
  targetStep: 'doc' | 'place';
  targetDocPath: string;
  targetDocMessage: string;
  place: BlockPlace;
  status: 'choosing' | 'submitting' | 'error';
  message: string;
};

export class DocBlockSelectStore {
  editStore: DocEditStore;
  selection: BlockSelection | undefined = undefined;
  textSelection: BlockTextSelection | undefined = undefined;
  contextMenu: BlockSelectContextMenu | undefined = undefined;
  contextMenuOpenCount = 0;
  transfer: BlockTransfer | undefined = undefined;

  constructor({ editStore }: { editStore: DocEditStore }) {
    this.editStore = editStore;
    makeAutoObservable(this, { editStore: false });
  }

  // ---------- the mode ----------

  get isMode(): boolean {
    return this.editStore.isBlockSelectMode;
  }

  // switching the mode on starts with the blocks the text selection touched
  // selected (nothing when there was none); switching it off drops the
  // selection
  async modeSet(isOn: boolean): Promise<boolean> {
    const textSelection = this.textSelection;
    const isSet = await this.editStore.blockSelectModeSet(isOn);
    if (!isSet) return false;
    runInAction(() => {
      const isTextSelectionKept = isOn && textSelection !== undefined
        && this.editStore.docEditGet(textSelection.path)?.hash === textSelection.hash;
      this.selection = isTextSelectionKept
        ? { ...textSelection, blockIndexList: [...textSelection.blockIndexList], blockIndexAnchor: textSelection.blockIndexList[0] }
        : undefined;
      this.contextMenu = undefined;
      if (this.transfer?.status !== 'submitting') this.transfer = undefined;
    });
    return true;
  }

  modeToggle(): Promise<boolean> {
    return this.modeSet(!this.isMode);
  }

  // ---------- the selection ----------

  // the selected blocks of a document, sorted; empty when the selection is
  // of another document or of an older text of it
  selectionIndexListGet(path: string): number[] {
    const selection = this.selection;
    if (!this.isMode || !selection || selection.path !== path) return [];
    if (this.editStore.docEditGet(path)?.hash !== selection.hash) return [];
    return selection.blockIndexList;
  }

  blockIsSelected(path: string, blockIndex: number): boolean {
    return this.selectionIndexListGet(path).includes(blockIndex);
  }

  // a click on a block, as in a file list:
  //   plain       this block only; it becomes the anchor
  //   isToggle    (Ctrl / ⌘) this block in or out; it becomes the anchor
  //   isRange     (Shift) the blocks from the anchor to this one; with
  //               isToggle they are added to the selection. the anchor stays
  blockClick(path: string, blockIndex: number, { isToggle = false, isRange = false } = {}) {
    if (!this.isMode) return;
    const hash = this.editStore.docEditGet(path)?.hash ?? '';
    const listCurrent = this.selectionIndexListGet(path);
    const anchorCurrent = listCurrent.length > 0 ? this.selection!.blockIndexAnchor : -1;
    if (isRange && anchorCurrent >= 0) {
      const range = indexRangeBuild(anchorCurrent, blockIndex);
      const list = isToggle ? indexListSort([...listCurrent, ...range]) : range;
      this.selection = { path, hash, blockIndexList: list, blockIndexAnchor: anchorCurrent };
      return;
    }
    if (isToggle) {
      const list = listCurrent.includes(blockIndex)
        ? listCurrent.filter((index) => index !== blockIndex)
        : indexListSort([...listCurrent, blockIndex]);
      this.selection = { path, hash, blockIndexList: list, blockIndexAnchor: blockIndex };
      return;
    }
    this.selection = { path, hash, blockIndexList: [blockIndex], blockIndexAnchor: blockIndex };
  }

  selectionClear() {
    this.selection = undefined;
  }

  // ---------- the blocks the author is at ----------

  // the blocks a text selection of the edit body touches, sorted (an empty
  // list: the selection is not in the body)
  textSelectionSet(path: string, blockIndexList: number[]) {
    if (blockIndexList.length === 0) {
      this.textSelectionClear(path);
      return;
    }
    const hash = this.editStore.docEditGet(path)?.hash ?? '';
    const listSorted = indexListSort(blockIndexList);
    const current = this.textSelection;
    if (current && current.path === path && current.hash === hash
      && current.blockIndexList.join(',') === listSorted.join(',')) return;
    this.textSelection = { path, hash, blockIndexList: listSorted };
  }

  // path: only a text selection in this document is dropped
  textSelectionClear(path?: string) {
    if (path === undefined || this.textSelection?.path === path) this.textSelection = undefined;
  }

  // the blocks of a document the author is at now, sorted; empty when there
  // are none, or they are of another document or of an older text of it:
  //   block selection mode   the selected blocks
  //   an open block session  its block
  //   otherwise              the blocks the text selection touches
  blockIndexListCurrentGet(path: string): number[] {
    if (this.isMode) return this.selectionIndexListGet(path);
    const session = this.editStore.session;
    if (session?.type === 'block' && session.path === path && session.blockIndex >= 0) return [session.blockIndex];
    const textSelection = this.textSelection;
    if (!textSelection || textSelection.path !== path) return [];
    if (this.editStore.docEditGet(path)?.hash !== textSelection.hash) return [];
    return textSelection.blockIndexList;
  }

  // ---------- the context menu ----------

  get isContextMenuOpen(): boolean {
    return this.isMode && this.contextMenu !== undefined;
  }

  // a right click on a block: on a selected block the menu is for the whole
  // selection; on another block that block alone becomes the selection. a
  // menu already open is closed first and the new one opened on the next
  // frame, so a right click while it is open moves it, never leaving a
  // stale menu at the old point. offset is the point of the click from the
  // top left of the block: the menu is anchored there, not to the window.
  contextMenuOpen(path: string, blockIndex: number, offset: { x: number; y: number }) {
    if (!this.isMode) return;
    if (this.contextMenu?.status === 'submitting') return;
    if (!this.blockIsSelected(path, blockIndex)) {
      const hash = this.editStore.docEditGet(path)?.hash ?? '';
      this.selection = { path, hash, blockIndexList: [blockIndex], blockIndexAnchor: blockIndex };
    }
    this.contextMenu = undefined;
    window.requestAnimationFrame(() => {
      runInAction(() => {
        if (!this.isMode) return;
        this.contextMenuOpenCount += 1;
        this.contextMenu = {
          path,
          blockIndex,
          offset,
          openId: this.contextMenuOpenCount,
          step: 'actions',
          status: 'idle',
          message: '',
        };
      });
    });
  }

  contextMenuClose() {
    if (this.contextMenu?.status === 'submitting') return;
    this.contextMenu = undefined;
  }

  contextMenuStepSet(step: BlockSelectContextMenu['step']) {
    const menu = this.contextMenu;
    if (!menu || menu.status === 'submitting') return;
    menu.step = step;
    menu.status = 'idle';
    menu.message = '';
  }

  // why the selected block cannot be duplicated, '' when it can: one block
  // at a time for now
  get duplicateDisabledReason(): string {
    const count = this.selectionIndexListGet(this.selection?.path ?? '').length;
    if (count === 0) return 'select a block first';
    if (count > 1) return 'only one block can be duplicated at a time';
    return '';
  }

  // a copy of the one selected block, right above or below it
  async selectionDuplicate(side: 'above' | 'below'): Promise<boolean> {
    if (this.duplicateDisabledReason !== '') return false;
    const { path, hash } = this.selection!;
    const blockIndex = this.selectionIndexListGet(path)[0];
    return this.contextMenuWrite(() => this.editStore.blockListCopy(
      path, hash, [blockIndex], path, side === 'above' ? blockIndex : blockIndex + 1,
    ));
  }

  // the selected blocks deleted (after the menu's confirmation step)
  async selectionDelete(): Promise<boolean> {
    const path = this.selection?.path ?? '';
    const indexList = this.selectionIndexListGet(path);
    if (indexList.length === 0) return false;
    return this.contextMenuWrite(() => this.editStore.blockListDelete(path, this.selection!.hash, [...indexList]));
  }

  // a write started from the menu: the menu stays, its entries locked, while
  // it runs; written, the menu closes and the selection is dropped (the
  // document has a new text, its blocks are numbered anew); failed, the
  // menu shows why
  private async contextMenuWrite(write: () => Promise<{ code: number; message: string }>): Promise<boolean> {
    const menu = this.contextMenu;
    if (!menu || menu.status === 'submitting') return false;
    menu.status = 'submitting';
    menu.message = '';
    const result = await write();
    runInAction(() => {
      if (this.contextMenu !== menu) return;
      if (result.code === 0) {
        this.contextMenu = undefined;
        this.selection = undefined;
        return;
      }
      menu.status = 'error';
      menu.message = result.message;
    });
    return result.code === 0;
  }

  // ---------- the dialog: copying or moving the blocks ----------

  get isTransferOpen(): boolean {
    return this.isMode && this.transfer !== undefined;
  }

  // opens the dialog for the selection. the document the blocks go to is
  // chosen first; the document they come from is the one chosen at first.
  transferOpen(action: BlockTransferAction): boolean {
    this.contextMenu = undefined;
    const path = this.selection?.path ?? '';
    const indexList = this.selectionIndexListGet(path);
    if (indexList.length === 0 || this.transfer?.status === 'submitting') return false;
    this.transfer = {
      actionInitial: action,
      sourcePath: path,
      sourceHash: this.selection!.hash,
      blockIndexOfferedList: [...indexList],
      blockIndexCheckedList: [...indexList],
      isSourceAllShown: false,
      listDisplay: 'compact',
      isRenderedById: {},
      targetStep: 'doc',
      targetDocPath: path,
      targetDocMessage: '',
      place: blockPlaceBuild({ docPath: '' }) as BlockPlace,
      status: 'choosing',
      message: '',
    };
    return true;
  }

  transferClose() {
    if (this.transfer?.status === 'submitting') return;
    this.transfer = undefined;
  }

  // the blocks of the document the blocks come from, as they were chosen;
  // undefined when the document has another text now
  get transferSourceBlockList(): any[] | undefined {
    const transfer = this.transfer;
    if (!transfer) return undefined;
    const state = this.editStore.docEditGet(transfer.sourcePath);
    if (state?.hash !== transfer.sourceHash) return undefined;
    return state.model?.blockList;
  }

  // what the dialog lists: the blocks it was opened with, or every block
  get transferBlockListShown(): any[] {
    const transfer = this.transfer;
    const blockList = this.transferSourceBlockList ?? [];
    if (!transfer || transfer.isSourceAllShown) return blockList;
    return blockList.filter((block) => transfer.blockIndexOfferedList.includes(block.index));
  }

  transferBlockCheckToggle(blockIndex: number) {
    const transfer = this.transferChoosingGet();
    if (!transfer) return;
    const list = transfer.blockIndexCheckedList;
    transfer.blockIndexCheckedList = list.includes(blockIndex)
      ? list.filter((index) => index !== blockIndex)
      : indexListSort([...list, blockIndex]);
  }

  // listing every block keeps what is checked; going back to the offered
  // blocks leaves out what was checked among the others
  transferSourceAllShownToggle() {
    const transfer = this.transferChoosingGet();
    if (!transfer) return;
    transfer.isSourceAllShown = !transfer.isSourceAllShown;
    if (!transfer.isSourceAllShown) {
      transfer.blockIndexCheckedList = transfer.blockIndexCheckedList
        .filter((index) => transfer.blockIndexOfferedList.includes(index));
    }
  }

  transferListDisplaySet(listDisplay: 'compact' | 'full') {
    if (this.transfer) this.transfer.listDisplay = listDisplay;
  }

  transferRenderedToggle(blockId: string) {
    const transfer = this.transfer;
    if (transfer) transfer.isRenderedById[blockId] = !transfer.isRenderedById[blockId];
  }

  // the document step: a path typed or chosen in the tree
  transferTargetDocSelect(path: string) {
    const transfer = this.transferChoosingGet();
    if (!transfer) return;
    transfer.targetDocPath = String(path ?? '').trim();
    transfer.targetDocMessage = this.editStore.docIsEditable(transfer.targetDocPath)
      ? ''
      : `${transfer.targetDocPath || 'The path'} is not an md / mdx document of the source.`;
  }

  // on to the place step, in the chosen document (path: chosen and
  // confirmed at once, a double click in the tree); the blocks go to its
  // end until a place is chosen
  async transferTargetDocConfirm(path?: string): Promise<boolean> {
    if (path !== undefined) this.transferTargetDocSelect(path);
    const transfer = this.transferChoosingGet();
    if (!transfer || transfer.targetDocMessage !== '' || !transfer.targetDocPath) return false;
    const docPath = transfer.targetDocPath;
    runInAction(() => {
      transfer.targetStep = 'place';
      transfer.place = blockPlaceBuild({ docPath }) as BlockPlace;
    });
    if (!this.editStore.docEditGet(docPath)) await this.editStore.docEditEnsure(docPath);
    return true;
  }

  transferTargetDocBack() {
    const transfer = this.transferChoosingGet();
    if (transfer) transfer.targetStep = 'doc';
  }

  transferPlaceNodeSet(nodeId: string) {
    const transfer = this.transferChoosingGet();
    if (transfer) transfer.place = blockPlaceNodeChange(transfer.place, nodeId) as BlockPlace;
  }

  transferPlacePositionSet(position: BlockPlacePosition) {
    const transfer = this.transferChoosingGet();
    if (transfer) transfer.place = { ...transfer.place, position };
  }

  // the blocks of the document the blocks go to; undefined while it is read
  get transferTargetBlockList(): any[] | undefined {
    const transfer = this.transfer;
    if (!transfer || transfer.targetStep !== 'place') return undefined;
    return this.editStore.docEditGet(transfer.place.docPath)?.model?.blockList;
  }

  get transferPlaceResolved() {
    const transfer = this.transfer;
    const blockList = this.transferTargetBlockList;
    if (!transfer) return { code: -1, message: 'no blocks are being copied or moved' };
    if (!blockList) return { code: -1, message: 'the document is being read' };
    return blockPlaceResolve(transfer.place, blockList.length);
  }

  transferPlacePositionReasonGet(position: BlockPlacePosition): string {
    const transfer = this.transfer;
    const blockList = this.transferTargetBlockList;
    if (!transfer || !blockList) return 'the document is being read';
    const resolved = blockPlaceResolve({ ...transfer.place, position }, blockList.length);
    return resolved.code === 0 ? '' : resolved.message;
  }

  // why Copy / Move is not possible now, '' when it is
  transferApplyDisabledReasonGet(action: BlockTransferAction): string {
    const transfer = this.transfer;
    if (!transfer) return 'no blocks are being copied or moved';
    if (transfer.status === 'submitting') return 'the blocks are being written';
    const blockListSource = this.transferSourceBlockList;
    if (!blockListSource) return 'the document changed since the blocks were chosen: close this and choose them again';
    if (transfer.blockIndexCheckedList.length === 0) return 'check at least one block';
    if (transfer.targetStep !== 'place') return 'choose the document the blocks go to';
    const resolved = this.transferPlaceResolved;
    if (resolved.code !== 0) return resolved.message;
    if (action === 'move' && transfer.place.docPath === transfer.sourcePath) {
      const model = this.editStore.docEditGet(transfer.sourcePath)!.model;
      const { isNoop } = blockListMoveOperationListBuild(model, transfer.blockIndexCheckedList, (resolved as any).data.borderIndex);
      if (isNoop) return 'the blocks already are there';
    }
    return '';
  }

  // writes the copy or the move (DocEditStore.blockListCopy / blockListMove);
  // the dialog closes and the selection is dropped when it is written, and
  // stays with the message when it is not
  async transferApply(action: BlockTransferAction): Promise<boolean> {
    const transfer = this.transfer;
    if (!transfer || this.transferApplyDisabledReasonGet(action) !== '') return false;
    const borderIndex = (this.transferPlaceResolved as any).data.borderIndex;
    const indexList = [...transfer.blockIndexCheckedList];
    runInAction(() => {
      transfer.status = 'submitting';
      transfer.message = '';
    });
    const args = [transfer.sourcePath, transfer.sourceHash, indexList, transfer.place.docPath, borderIndex] as const;
    const result = action === 'move'
      ? await this.editStore.blockListMove(...args)
      : await this.editStore.blockListCopy(...args);
    runInAction(() => {
      if (this.transfer !== transfer) return;
      if (result.code === 0) {
        this.transfer = undefined;
        this.selection = undefined;
        return;
      }
      transfer.status = 'error';
      transfer.message = result.message;
    });
    return result.code === 0;
  }

  // the open dialog when it can be changed (not while it is written); a
  // change after a failure takes the failure away
  private transferChoosingGet(): BlockTransfer | undefined {
    const transfer = this.transfer;
    if (!transfer || transfer.status === 'submitting') return undefined;
    if (transfer.status === 'error') {
      transfer.status = 'choosing';
      transfer.message = '';
    }
    return transfer;
  }
}

function indexListSort(indexList: number[]): number[] {
  return [...new Set(indexList)].sort((a, b) => a - b);
}

function indexRangeBuild(indexA: number, indexB: number): number[] {
  const indexStart = Math.min(indexA, indexB);
  const indexEnd = Math.max(indexA, indexB);
  return Array.from({ length: indexEnd - indexStart + 1 }, (_, offset) => indexStart + offset);
}
