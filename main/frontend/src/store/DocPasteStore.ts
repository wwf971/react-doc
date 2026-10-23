import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import type { DocEditStore, EditResult } from './DocEditStore.js';
import type { DocBlockSelectStore } from './DocBlockSelectStore.js';
import { pasteBlockListBuild } from '../lib/doc-paste.js';
import {
  blockNodeIdGet,
  blockPlaceBuild,
  blockPlaceFromBorder,
  blockPlaceNodeChange,
  blockPlaceResolve,
} from '../lib/doc-block-place.js';

// Pasting Markdown / MDX into a document as blocks, or into the component
// being edited (design: doc_page_impl_block_ops.md#pasting). The author
// pastes a text in edit mode; it is not written at once but reviewed in a
// dialog first (comp-doc/paste/DocPastePopup.jsx):
//
//   review   the one open review:
//     target          blocks: the text becomes blocks at the place |
//                     inPlace: the text is handed to the editor of the open
//                     component session (pasteRequest), which takes it into
//                     its draft or refuses with a reason; offered only while
//                     such an editor takes pastes (inPlaceIsAvailable)
//     text            the pasted text as the author has it now; the dialog
//                     can show it for editing (isSourceOpen)
//     textVersion     increases when code sets the text, so the editing
//                     surface rewrites itself
//     place           where the blocks go: { docPath, nodeId, position }
//                     (lib/doc-block-place.js), in the current document or another one
//     isRenderedById  the blocks shown rendered instead of as source
//     status          reviewing | submitting | error (message)
//   result   computed: the text through the pipeline (lib/doc-paste.js), for
//            the format of the target document, with the transforms the host
//            application supplies (config.edit.pasteTransformList)
//
// the insert is one write of the edit layer (DocEditStore.blockListInsert),
// recorded in its history like any other change of a document. a paste in
// place writes nothing itself: the editor changes its draft, which the
// session saves when it is left.

export type PasteTransform = {
  id: string;
  label?: string;
  stage: 'text' | 'block';
  transform: (input: string, context: Record<string, any>) => string;
};

export type BlockPlacePosition = 'before' | 'after' | 'insideFirst' | 'insideLast';

export type BlockPlace = { docPath: string; nodeId: string; position: BlockPlacePosition };

export type PasteTarget = 'blocks' | 'inPlace';

// the event the editor of a component session receives for a paste in place
export const PASTE_EVENT_TYPE = 'pasteRequest';

export type PasteReview = {
  target: PasteTarget;
  text: string;
  textVersion: number;
  isSourceOpen: boolean;
  place: BlockPlace;
  placeMessage: string;
  isRenderedById: Record<string, boolean>;
  status: 'reviewing' | 'submitting' | 'error';
  message: string;
};

export class DocPasteStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;
  editStore: DocEditStore;
  blockSelectStore: DocBlockSelectStore | undefined;
  transformList: PasteTransform[];
  review: PasteReview | undefined = undefined;

  constructor({ sourceStore, docStore, editStore, blockSelectStore, transformList = [] }: {
    sourceStore: DocSourceStore;
    docStore: DocStore;
    editStore: DocEditStore;
    blockSelectStore?: DocBlockSelectStore;
    transformList?: PasteTransform[];
  }) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.editStore = editStore;
    this.blockSelectStore = blockSelectStore;
    this.transformList = Array.isArray(transformList) ? transformList : [];
    makeAutoObservable(this, {
      sourceStore: false,
      docStore: false,
      editStore: false,
      blockSelectStore: false,
      transformList: false,
    });
  }

  // a paste is offered in edit mode, on a document that can be edited
  get isAvailable(): boolean {
    return this.editStore.isEditMode && this.editStore.docIsEditable(this.docStore.docCurrentPath);
  }

  get isOpen(): boolean {
    return this.review !== undefined && this.editStore.isEditMode;
  }

  // a component block is being edited in one of its own edit modes, and its
  // editor takes pastes (DocEditStore.sessionReceives)
  get inPlaceIsAvailable(): boolean {
    const session = this.editStore.session;
    if (session?.type !== 'block' || session.editModeId === 'source') return false;
    if (!this.editStore.docEditGet(session.path)?.model?.blockList[session.blockIndex]?.component) return false;
    return this.editStore.sessionReceives(PASTE_EVENT_TYPE);
  }

  // what the component being edited is called, for the dialog ("StockTable")
  get inPlaceLabel(): string {
    const session = this.editStore.session;
    if (!session) return '';
    return this.editStore.docEditGet(session.path)?.model?.blockList[session.blockIndex]?.component?.compName ?? '';
  }

  targetSet(target: PasteTarget) {
    const review = this.review;
    if (!review || review.status === 'submitting') return;
    if (target === 'inPlace' && !this.inPlaceIsAvailable) return;
    review.target = target;
    if (review.status === 'error') {
      review.status = 'reviewing';
      review.message = '';
    }
  }

  // opens the review for a text pasted on the page, or for no text yet (the
  // author pastes into the dialog). while a component that takes pastes is
  // being edited, the text goes into it at first (target inPlace) and its
  // session stays open; otherwise the open session is left first, saving
  // it, and the text becomes blocks. the blocks go into the current document:
  // before the block at borderIndex when one is given (the border of the
  // insert menu it was opened from), else after the blocks the author is at
  // (DocBlockSelectStore.blockIndexListCurrentGet: the blocks a text
  // selection touches), else at its end.
  async open({ text = '', borderIndex }: { text?: string; borderIndex?: number } = {}): Promise<boolean> {
    if (!this.isAvailable || this.review?.status === 'submitting') return false;
    const docPath = this.docStore.docCurrentPath;
    const blockIndexListCurrent = this.blockSelectStore?.blockIndexListCurrentGet(docPath) ?? [];
    const target: PasteTarget = borderIndex === undefined && this.inPlaceIsAvailable ? 'inPlace' : 'blocks';
    if (target === 'blocks') {
      const isLeft = await this.editStore.sessionLeave();
      if (!isLeft) return false;
    }
    const blockCount = this.editStore.blockCountGet(docPath);
    const blockIndexLast = blockIndexListCurrent[blockIndexListCurrent.length - 1];
    let place = blockPlaceBuild({ docPath }) as BlockPlace;
    if (borderIndex !== undefined) place = blockPlaceFromBorder(docPath, borderIndex, blockCount) as BlockPlace;
    else if (blockIndexLast !== undefined && blockIndexLast < blockCount) {
      place = blockPlaceBuild({ docPath, nodeId: blockNodeIdGet(blockIndexLast), position: 'after' }) as BlockPlace;
    }
    runInAction(() => {
      this.editStore.insertMenuClose();
      this.review = {
        target,
        text,
        textVersion: 1,
        isSourceOpen: text.trim() === '',
        place,
        placeMessage: '',
        isRenderedById: {},
        status: 'reviewing',
        message: '',
      };
    });
    return true;
  }

  close() {
    if (this.review?.status === 'submitting') return;
    this.review = undefined;
  }

  textSet(text: string) {
    const review = this.review;
    if (!review || review.status === 'submitting') return;
    review.text = text;
    if (review.status === 'error') {
      review.status = 'reviewing';
      review.message = '';
    }
  }

  sourceToggle() {
    if (this.review) this.review.isSourceOpen = !this.review.isSourceOpen;
  }

  blockRenderedToggle(blockId: string) {
    const review = this.review;
    if (!review) return;
    review.isRenderedById[blockId] = !review.isRenderedById[blockId];
  }

  // another document: the blocks go to its end until a place in it is chosen
  async placeDocSet(docPath: string): Promise<EditResult> {
    const review = this.review;
    if (!review || review.status === 'submitting') return { code: -1, message: 'no paste is being reviewed' };
    if (!this.editStore.docIsEditable(docPath)) {
      runInAction(() => {
        review.placeMessage = `${docPath || 'The path'} is not an md / mdx document of the source.`;
      });
      return { code: -1, message: review.placeMessage };
    }
    runInAction(() => {
      review.place = blockPlaceBuild({ docPath }) as BlockPlace;
      review.placeMessage = '';
    });
    if (!this.editStore.docEditGet(docPath)) await this.editStore.docEditEnsure(docPath);
    return { code: 0, message: '' };
  }

  // a node of the tree was chosen (blockPlaceNodeChange: the position stays
  // when the node takes it)
  placeNodeSet(nodeId: string) {
    const review = this.review;
    if (!review || review.status === 'submitting') return;
    review.place = blockPlaceNodeChange(review.place, nodeId) as BlockPlace;
  }

  placePositionSet(position: BlockPlacePosition) {
    const review = this.review;
    if (!review || review.status === 'submitting') return;
    review.place = { ...review.place, position };
  }

  get placeFormat(): 'md' | 'mdx' {
    const entry = this.sourceStore.entryByInternalPath.get(this.review?.place.docPath ?? '');
    return entry?.ext === 'mdx' ? 'mdx' : 'md';
  }

  // the blocks of the target document; undefined while it is read
  get placeBlockList(): any[] | undefined {
    const docPath = this.review?.place.docPath ?? '';
    return this.editStore.docEditGet(docPath)?.model?.blockList;
  }

  get placeResolved(): EditResult {
    const review = this.review;
    if (!review) return { code: -1, message: 'no paste is being reviewed' };
    const blockList = this.placeBlockList;
    if (!blockList) return { code: -1, message: 'the document is being read' };
    return blockPlaceResolve(review.place, blockList.length);
  }

  // why a position is refused for the chosen node, '' when it is allowed
  placePositionReasonGet(position: BlockPlacePosition): string {
    const review = this.review;
    const blockList = this.placeBlockList;
    if (!review || !blockList) return 'the document is being read';
    const resolved = blockPlaceResolve({ ...review.place, position }, blockList.length);
    return resolved.code === 0 ? '' : resolved.message;
  }

  get result() {
    const review = this.review;
    return pasteBlockListBuild({
      text: review?.text ?? '',
      format: this.placeFormat,
      docPath: review?.place.docPath ?? '',
      transformList: this.transformList,
    });
  }

  // why Insert (Paste into …) is not possible now, '' when it is
  get insertDisabledReason(): string {
    const review = this.review;
    if (!review) return 'no paste is being reviewed';
    if (review.status === 'submitting') return 'the blocks are being inserted';
    if (review.target === 'inPlace') {
      if (!this.inPlaceIsAvailable) return 'the component is not being edited any more: paste as blocks';
      return review.text.trim() === '' ? 'there is nothing to paste' : '';
    }
    const result = this.result;
    if (result.isError) return 'the text does not parse';
    if (result.blockList.length === 0) return 'there is nothing to insert';
    const resolved = this.placeResolved;
    return resolved.code === 0 ? '' : resolved.message;
  }

  async insertApply(): Promise<boolean> {
    const review = this.review;
    if (!review || this.insertDisabledReason !== '') return false;
    if (review.target === 'inPlace') return this.inPlaceApply(review);
    const { text } = this.result;
    const borderIndex = this.placeResolved.data.borderIndex;
    runInAction(() => {
      review.status = 'submitting';
      review.message = '';
    });
    const result = await this.editStore.blockListInsert(review.place.docPath, borderIndex, text);
    runInAction(() => {
      if (this.review !== review) return;
      if (result.code === 0) {
        this.review = undefined;
        return;
      }
      review.status = 'error';
      review.message = result.message;
    });
    return result.code === 0;
  }

  // the text handed to the editor of the component being edited; it takes
  // it into its draft (the dialog closes) or refuses (the dialog stays, with
  // the reason in its status line)
  private async inPlaceApply(review: PasteReview): Promise<boolean> {
    runInAction(() => {
      review.status = 'submitting';
      review.message = '';
    });
    const session = this.editStore.session!;
    const entry = this.sourceStore.entryByInternalPath.get(session.path);
    const result = await this.editStore.sessionEventSend(PASTE_EVENT_TYPE, {
      text: review.text,
      format: entry?.ext === 'mdx' ? 'mdx' : 'md',
      sourcePath: session.path,
    });
    runInAction(() => {
      if (this.review !== review) return;
      if (result.code === 0) {
        this.review = undefined;
        return;
      }
      review.status = 'error';
      review.message = result.message;
    });
    return result.code === 0;
  }
}
