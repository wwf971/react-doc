import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import type { DocConfigStore } from './DocConfigStore.js';
import { compileDoc } from '../lib/mdx-compile.js';
import { docEditApiCreate } from '../lib/doc-edit-api.js';
import {
  blockDeleteOperationBuild,
  blockInsertOperationBuild,
  blockReplaceOperationBuild,
  blockSwapOperationBuild,
  componentBlockTextBuild,
  editDocModelBuild,
  frontmatterReplaceOperationBuild,
  remarkEditBlock,
} from '../lib/doc-edit-block.js';

// Edit layer store (design: doc_page_impl_edit.md). It sits beside the
// reading stores and never changes them: the document on disk is the source
// of truth, the development server rewrites it, and the ordinary HMR path
// brings the new text back into DocSourceStore.
//
//   isAvailable       a development server answers the edit api
//   isEditMode        the global toggle
//   blockEnterMode    how a block enters its edit mode (config EditBlockEnterMode)
//   sourceByPath      text + hash of a document as read from disk
//   docEditByPath     the document compiled with block wrappers + its block model
//   session           the one block being edited, or the frontmatter / whole document
//   insertMenu        the one insert menu that is open, anchored to a block toolbar
//   deleteConfirm     the one block whose deletion waits for confirmation
//   blockMove         the one block being moved up or down (swapped with its
//                     neighbor), or the failure of the last move
//
// a session ends in one of two ways:
//   leave    the draft is saved when it changed (click outside, another edit
//            action, Save, Ctrl/⌘+Enter, edit mode switched off, a focus
//            shift to a neighbor block)
//   cancel   the draft is dropped (Esc, Cancel); a block that was just
//            created from the insert menu is removed again
// every edit action first leaves the open session, so a draft is never lost
// by starting something else.
//
// every change of the file goes through operationApply, the one place a
// future history (undo/redo) records operations at.
//
// the events of the edit domain (doc_page_impl_event.md) arrive at
// eventHandle, routed there by the event layer.

export type EditSessionType = 'block' | 'frontmatter' | 'document';

// where the caret is when the editing surface opens: at the end (an edit
// started from the toolbar), at the start (entered from the block above by
// a focus shift), or the whole text selected (a block created from a
// template: typing replaces it)
export type EditSelectionInitial = 'all' | 'start' | 'end';

export type EditSession = {
  type: EditSessionType;
  path: string;
  // block: index of the block; -1 for the frontmatter and the whole document
  blockIndex: number;
  // the block was created from the insert menu by this session; cancel removes it
  isCreated: boolean;
  selectionInitial: EditSelectionInitial;
  textInitial: string;
  textDraft: string;
  // increases only when the text is set by code (a level control, a
  // template), so the uncontrolled editing surface knows when to rewrite its DOM
  draftVersion: number;
  status: 'editing' | 'submitting' | 'error';
  message: string;
};

export type EditInsertMenu = {
  path: string;
  // index of the border = index the new block gets
  borderIndex: number;
  // the block whose toolbar opened the menu and shows it; -1 in an empty document
  blockIndexAnchor: number;
  status: 'open' | 'submitting' | 'error';
  message: string;
};

export type EditDeleteConfirm = {
  path: string;
  blockIndex: number;
  status: 'confirming' | 'submitting' | 'error';
  message: string;
};

export type EditFocusShiftDirection = 'previous' | 'next';

export type EditBlockMoveDirection = 'up' | 'down';

export type EditBlockMove = {
  path: string;
  blockIndex: number;
  direction: EditBlockMoveDirection;
  status: 'submitting' | 'error';
  message: string;
};

// the one side-panel item whose label is being edited in place
export type EditSidePanelText = {
  itemId: string;
  status: 'editing' | 'submitting' | 'error';
  message: string;
};

type EditSource = {
  status: 'loading' | 'done' | 'error';
  text?: string;
  hash?: string;
  message?: string;
};

export type EditDocState = {
  status: 'done' | 'error';
  hash: string;
  model?: any;
  Body?: any;
  toc?: any[];
  titleFrontmatter?: string;
  description?: string;
  isContentEmpty?: boolean;
  isSourceFile?: boolean;
  message?: string;
};

export type EditResult = { code: number; data?: any; message: string };

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any> };

// the event types the edit route of the event layer brings here: the
// session events of the editor of the open session, and the block events a
// toolbar reports for the block it belongs to
export const editEventTypeList = [
  'editDraftChange',
  'editTextSetRequest',
  'editSubmitRequest',
  'editCancelRequest',
  'editFocusShiftRequest',
  'editBlockMoveRequest',
  'sidePanelTextEditStartRequest',
  'sidePanelTextSubmitRequest',
  'sidePanelTextCancelRequest',
];

const messageConflict = 'The document changed on disk since it was loaded. Re-read the file, then edit again.';

export class DocEditStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;
  configStore: DocConfigStore;
  api: ReturnType<typeof docEditApiCreate> | undefined;
  isAvailable = false;
  isEditMode = false;
  sourceByPath: Record<string, EditSource> = {};
  docEditByPath: Record<string, EditDocState> = {};
  compilePendingByPath: Record<string, { hash: string; promise: Promise<void> }> = {};
  session: EditSession | undefined = undefined;
  insertMenu: EditInsertMenu | undefined = undefined;
  deleteConfirm: EditDeleteConfirm | undefined = undefined;
  blockMove: EditBlockMove | undefined = undefined;
  // the text a block was just saved as, shown in its place until the document
  // is compiled again, so the saved block never flashes back to its old text
  blockTextPending: { path: string; blockIndex: number; text: string } | undefined = undefined;
  sidePanelText: EditSidePanelText | undefined = undefined;
  // the label an item was just saved as, shown until the side panel is built
  // from the new configuration, for the same reason as blockTextPending
  sidePanelTextPending: { itemId: string; text: string } | undefined = undefined;
  // the leave in progress, so that a second leave request waits for it
  leavePromise: Promise<boolean> | undefined;
  reactionDispose: (() => void) | undefined;
  reactionConfigDispose: (() => void) | undefined;

  constructor(sourceStore: DocSourceStore, docStore: DocStore, configStore: DocConfigStore, options?: { endpoint?: string }) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.configStore = configStore;
    this.api = options?.endpoint ? docEditApiCreate(options.endpoint) : undefined;
    makeAutoObservable(this, {
      api: false,
      configStore: false,
      docStore: false,
      sourceStore: false,
      docEditByPath: observable.shallow,
      sourceByPath: observable.shallow,
      compilePendingByPath: false,
      leavePromise: false,
      reactionDispose: false,
      reactionConfigDispose: false,
    });
  }

  init() {
    if (!this.api) return;
    void this.availabilityCheck();
    this.reactionDispose = reaction(
      () => ({
        isEditMode: this.isEditMode,
        path: this.docStore.docCurrentPath,
        fileManifest: this.sourceStore.fileManifest,
      }),
      ({ isEditMode, path }) => {
        // leaving the page is leaving the session: the draft is saved
        if (this.session && this.session.path !== path) void this.sessionLeave();
        runInAction(() => {
          if (this.insertMenu && this.insertMenu.path !== path) this.insertMenu = undefined;
          if (this.deleteConfirm && this.deleteConfirm.path !== path) this.deleteConfirm = undefined;
          if (this.blockMove && this.blockMove.path !== path) this.blockMove = undefined;
        });
        if (isEditMode && this.docIsEditable(path)) void this.docEditEnsure(path);
      },
      { fireImmediately: true },
    );
    // the new configuration arrived: the side panel shows the saved label itself
    this.reactionConfigDispose = reaction(
      () => this.sourceStore.configDoc,
      () => {
        runInAction(() => {
          this.sidePanelTextPending = undefined;
        });
      },
    );
  }

  dispose() {
    this.reactionDispose?.();
    this.reactionDispose = undefined;
    this.reactionConfigDispose?.();
    this.reactionConfigDispose = undefined;
  }

  // ---------- availability and mode ----------

  async availabilityCheck(): Promise<void> {
    if (!this.api) return;
    const result = await this.api.statusGet();
    runInAction(() => {
      this.isAvailable = result.code === 0 && result.data?.isWritable === true;
    });
  }

  // switching edit mode off leaves the open session (saving it); when the
  // save fails, edit mode stays on so the error can be seen
  async editModeSet(isEditMode: boolean): Promise<boolean> {
    if (!this.isAvailable && isEditMode) return false;
    if (!isEditMode) {
      const isLeft = await this.sessionLeave();
      if (!isLeft) return false;
    }
    runInAction(() => {
      this.isEditMode = isEditMode;
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockMove = undefined;
      // a label still being typed is dropped: it was never saved
      if (this.sidePanelText?.status !== 'submitting') this.sidePanelText = undefined;
    });
    return true;
  }

  editModeToggle(): Promise<boolean> {
    return this.editModeSet(!this.isEditMode);
  }

  // 'button': the Edit button of the block toolbar only
  // 'click':  a click anywhere on the block as well
  get blockEnterMode(): 'button' | 'click' {
    return this.configStore.valueGlobalGet('EditBlockEnterMode') === 'click' ? 'click' : 'button';
  }

  // an md/mdx file of the collected source. inline items, component panels
  // and synthesized source-file pages have no file of their own.
  docIsEditable(path: string): boolean {
    if (!this.isAvailable || !path) return false;
    const entry = this.sourceStore.entryByInternalPath.get(path);
    return Boolean(entry) && (entry.ext === 'md' || entry.ext === 'mdx');
  }

  // ---------- source and compiled edit body ----------

  docEditGet(path: string): EditDocState | undefined {
    return this.docEditByPath[path];
  }

  // the state DocPageView renders instead of the reading body: the compiled
  // edit body, or the compile error so the document can still be repaired
  docEditActiveGet(path: string): EditDocState | undefined {
    if (!this.isEditMode || !this.docIsEditable(path)) return undefined;
    return this.docEditByPath[path];
  }

  // true while a newer source is being compiled
  docEditIsStale(path: string): boolean {
    const state = this.docEditByPath[path];
    const source = this.sourceByPath[path];
    return Boolean(state && source?.hash && state.hash !== source.hash);
  }

  blockCountGet(path: string): number {
    return this.docEditByPath[path]?.model?.blockList.length ?? 0;
  }

  // reads the file from disk and compiles it when its text changed
  async docEditEnsure(path: string): Promise<void> {
    if (!this.api) return;
    const sourceKnown = this.sourceByPath[path];
    if (!sourceKnown) {
      runInAction(() => {
        this.sourceByPath[path] = { status: 'loading' };
      });
    }
    const result = await this.api.sourceRead(path);
    if (result.code !== 0) {
      runInAction(() => {
        this.sourceByPath[path] = { status: 'error', message: result.message };
      });
      return;
    }
    await this.sourceAccept(path, result.data.text, result.data.hash);
  }

  // new text of a document, from a read or from an applied edit. resolves
  // when the edit body of this text is compiled.
  private sourceAccept(path: string, textRaw: string, hash: string): Promise<void> {
    const text = String(textRaw).replace(/\r\n/g, '\n');
    const sourceKnown = this.sourceByPath[path];
    const isChanged = sourceKnown?.hash !== hash;
    runInAction(() => {
      this.sourceByPath[path] = { status: 'done', text, hash };
      if (isChanged && this.session?.path === path && this.session.status !== 'submitting') {
        // the lines the session was about to replace moved
        this.session = undefined;
      }
      if (isChanged && this.deleteConfirm?.path === path && this.deleteConfirm.status !== 'submitting') {
        this.deleteConfirm = undefined;
      }
      if (isChanged && this.insertMenu?.path === path && this.insertMenu.status !== 'submitting') {
        this.insertMenu = undefined;
      }
      if (isChanged && this.blockMove?.path === path && this.blockMove.status !== 'submitting') {
        this.blockMove = undefined;
      }
    });
    const stateCompiled = this.docEditByPath[path];
    if (stateCompiled?.hash === hash) {
      runInAction(() => {
        if (this.blockTextPending?.path === path) this.blockTextPending = undefined;
      });
      return Promise.resolve();
    }
    const compilePending = this.compilePendingByPath[path];
    if (compilePending?.hash === hash) return compilePending.promise;
    const promise = this.docEditCompile(path, text, hash);
    this.compilePendingByPath[path] = { hash, promise };
    return promise;
  }

  private async docEditCompile(path: string, text: string, hash: string): Promise<void> {
    const entry = this.sourceStore.entryByInternalPath.get(path);
    const format = entry?.ext === 'mdx' ? 'mdx' : 'md';
    const compileConfig = this.sourceStore.compileConfig ?? {};
    let blockListCompiled: any[] = [];
    let stateNext: EditDocState;
    try {
      const compiled = await compileDoc({
        source: text,
        internalPath: path,
        format,
        config: {
          ...compileConfig,
          remarkPluginsFirst: [
            ...(compileConfig.remarkPluginsFirst ?? []),
            [remarkEditBlock, { onBlockList: (blockList: any[]) => { blockListCompiled = blockList; } }],
          ],
        },
      });
      const model = editDocModelBuild({ source: text, blockListCompiled });
      stateNext = {
        status: 'done',
        hash,
        model,
        Body: compiled.Body,
        toc: Array.isArray(compiled.toc) ? compiled.toc : [],
        titleFrontmatter: compiled.titleFrontmatter,
        description: compiled.description,
        isContentEmpty: model.blockList.length === 0,
        isSourceFile: false,
      };
    } catch (error: any) {
      stateNext = { status: 'error', hash, message: String(error?.message ?? error) };
    }
    runInAction(() => {
      // a newer text is already compiling; its result replaces this one
      if (this.compilePendingByPath[path]?.hash !== hash) return;
      delete this.compilePendingByPath[path];
      this.docEditByPath[path] = stateNext;
      if (this.blockTextPending?.path === path) this.blockTextPending = undefined;
    });
  }

  // text to show for a block while the document is compiled again after a save
  blockTextPendingGet(path: string, blockIndex: number): string | undefined {
    const pending = this.blockTextPending;
    if (!pending || pending.path !== path || pending.blockIndex !== blockIndex) return undefined;
    return pending.text;
  }

  // after a conflict: drop the open edit and read the file again
  async sourceReload(path: string): Promise<void> {
    runInAction(() => {
      if (this.session?.path === path && this.session.status !== 'submitting') this.session = undefined;
      if (this.deleteConfirm?.path === path) this.deleteConfirm = undefined;
      if (this.insertMenu?.path === path) this.insertMenu = undefined;
    });
    await this.docEditEnsure(path);
  }

  // ---------- operations on the file ----------

  // the one path every change of a document takes: the operation is sent
  // with the hash of the text it was built on, the new text is accepted and
  // compiled. a history of the edit layer records operations here.
  //   messageFailure   what a failure other than a conflict is reported as
  //   onApplied        state to settle once the file is written, before the
  //                    new text is accepted (compiling it takes a moment)
  private async operationApply(
    path: string,
    operation: any,
    { messageFailure, onApplied }: { messageFailure: string; onApplied?: () => void },
  ): Promise<EditResult> {
    if (!this.api) return { code: -1, message: 'The edit api is not available.' };
    const source = this.sourceByPath[path];
    if (source?.status !== 'done' || !source.hash) {
      return { code: -1, message: 'The document source is not loaded.' };
    }
    const result = await this.api.sourceApply(path, source.hash, operation);
    if (result.code !== 0) {
      return { code: result.code, message: result.code === -2 ? messageConflict : result.message || messageFailure };
    }
    if (onApplied) runInAction(onApplied);
    await this.sourceAccept(path, result.data.text, result.data.hash);
    return { code: 0, data: result.data, message: '' };
  }

  // ---------- sessions ----------

  sessionIs(path: string, type: EditSessionType, blockIndex?: number): boolean {
    const session = this.session;
    if (!session || session.path !== path || session.type !== type) return false;
    return blockIndex === undefined || session.blockIndex === blockIndex;
  }

  get isSessionOpen(): boolean {
    return this.session !== undefined;
  }

  get isSubmitting(): boolean {
    return this.session?.status === 'submitting'
      || this.insertMenu?.status === 'submitting'
      || this.deleteConfirm?.status === 'submitting'
      || this.blockMove?.status === 'submitting'
      || this.sidePanelText?.status === 'submitting';
  }

  async sessionBlockStart(
    path: string,
    blockIndex: number,
    options: { isCreated?: boolean; selectionInitial?: EditSelectionInitial } = {},
  ): Promise<boolean> {
    if (this.sessionIs(path, 'block', blockIndex)) return true;
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    const block = this.docEditByPath[path]?.model?.blockList[blockIndex];
    if (!block) return false;
    this.sessionStart({
      type: 'block',
      path,
      blockIndex,
      textInitial: block.text,
      isCreated: options.isCreated === true,
      selectionInitial: options.selectionInitial ?? 'end',
    });
    return true;
  }

  // the leave before an action that names a block or border index of
  // `path`. when the saved draft changed the number of blocks (a paragraph
  // split in two, a block removed), the indices the action was started with
  // no longer mean the same blocks; the action is dropped and nothing opens.
  private async sessionLeaveForIndexAction(path: string): Promise<boolean> {
    const isSessionOpen = this.session !== undefined;
    const blockCountBefore = this.blockCountGet(path);
    const isLeft = await this.sessionLeave();
    if (!isLeft) return false;
    if (!isSessionOpen) return true;
    return this.blockCountGet(path) === blockCountBefore;
  }

  async sessionFrontmatterStart(path: string): Promise<boolean> {
    if (this.sessionIs(path, 'frontmatter')) return true;
    const isLeft = await this.sessionLeave();
    if (!isLeft) return false;
    const frontmatter = this.docEditByPath[path]?.model?.frontmatter;
    if (!frontmatter) return false;
    this.sessionStart({
      type: 'frontmatter', path, blockIndex: -1, textInitial: frontmatter.text, isCreated: false, selectionInitial: 'all',
    });
    return true;
  }

  // the whole file, used when the document does not compile
  async sessionDocumentStart(path: string): Promise<boolean> {
    if (this.sessionIs(path, 'document')) return true;
    const isLeft = await this.sessionLeave();
    if (!isLeft) return false;
    const source = this.sourceByPath[path];
    if (source?.status !== 'done') return false;
    this.sessionStart({
      type: 'document', path, blockIndex: -1, textInitial: source.text ?? '', isCreated: false, selectionInitial: 'all',
    });
    return true;
  }

  private sessionStart(
    sessionPartial: Pick<EditSession, 'type' | 'path' | 'blockIndex' | 'textInitial' | 'isCreated' | 'selectionInitial'>,
  ) {
    runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockMoveClear();
      this.session = {
        ...sessionPartial,
        textDraft: sessionPartial.textInitial,
        draftVersion: 0,
        status: 'editing',
        message: '',
      };
    });
  }

  // the current draft; the editing surface already shows it
  sessionDraftSet(text: string) {
    if (!this.session || this.session.status === 'submitting') return;
    this.session.textDraft = text;
    if (this.session.status === 'error') {
      this.session.status = 'editing';
      this.session.message = '';
    }
  }

  // text set by code; the editing surface rewrites its content
  sessionTextSet(text: string) {
    if (!this.session || this.session.status === 'submitting') return;
    this.session.textDraft = text;
    this.session.draftVersion += 1;
    this.session.status = 'editing';
    this.session.message = '';
  }

  // the draft is dropped. a block created by this session is removed again,
  // so that canceling the creation leaves the document as it was.
  async sessionCancel(): Promise<boolean> {
    const session = this.session;
    if (!session) return true;
    if (session.status === 'submitting') return false;
    if (session.type === 'block' && session.isCreated) {
      runInAction(() => {
        session.status = 'submitting';
        session.message = '';
      });
      const result = await this.blockDeleteApply(session.path, session.blockIndex, () => {
        if (this.session === session) this.session = undefined;
      });
      if (result.code !== 0) {
        runInAction(() => {
          session.status = 'error';
          session.message = result.message;
        });
        return false;
      }
      return true;
    }
    this.session = undefined;
    return true;
  }

  // leaving edit mode in a non-canceling way: the draft is saved when it
  // changed, then the session closes. resolves false when the save failed;
  // the session then stays open with its message. a leave already in
  // progress is awaited instead of started twice.
  sessionLeave(): Promise<boolean> {
    if (this.leavePromise) return this.leavePromise;
    if (!this.session) return Promise.resolve(true);
    this.leavePromise = this.sessionSubmit().finally(() => {
      this.leavePromise = undefined;
    });
    return this.leavePromise;
  }

  private async sessionSubmit(): Promise<boolean> {
    const session = this.session;
    if (!session) return false;
    if (session.status === 'submitting') return false;
    const text = session.textDraft.replace(/\r\n/g, '\n');
    if (text === session.textInitial) {
      runInAction(() => {
        this.session = undefined;
      });
      return true;
    }
    const model = this.docEditByPath[session.path]?.model;

    let operation;
    if (session.type === 'document') {
      operation = { action: 'replaceAll', text };
    } else {
      if (!model) {
        this.sessionFail('The document is not compiled.');
        return false;
      }
      if (session.type === 'frontmatter') {
        operation = frontmatterReplaceOperationBuild(model, text);
      } else {
        const block = model.blockList[session.blockIndex];
        if (!block) {
          this.sessionFail('The block no longer exists.');
          return false;
        }
        operation = blockReplaceOperationBuild(block, text);
      }
    }

    runInAction(() => {
      session.status = 'submitting';
      session.message = '';
    });
    const result = await this.operationApply(session.path, operation, {
      messageFailure: 'The edit was not applied.',
      // the session closes as soon as the file is written; the saved block
      // shows its pending text until the document is compiled again
      onApplied: () => {
        this.session = undefined;
        if (session.type === 'block') {
          this.blockTextPending = { path: session.path, blockIndex: session.blockIndex, text };
        }
      },
    });
    if (result.code !== 0) {
      runInAction(() => {
        session.status = 'error';
        session.message = result.message;
      });
      return false;
    }
    return true;
  }

  private sessionFail(message: string) {
    if (!this.session) return;
    this.session.status = 'error';
    this.session.message = message;
  }

  // the session moves to the neighbor block in `direction`: the open session
  // is left (saved), the neighbor opens with the caret at its near end.
  // nothing happens at the first / last block.
  async sessionFocusShift(direction: EditFocusShiftDirection): Promise<boolean> {
    const session = this.session;
    if (!session || session.type !== 'block') return false;
    const blockIndexNext = direction === 'next' ? session.blockIndex + 1 : session.blockIndex - 1;
    if (blockIndexNext < 0 || blockIndexNext >= this.blockCountGet(session.path)) return false;
    return this.sessionBlockStart(session.path, blockIndexNext, {
      selectionInitial: direction === 'next' ? 'start' : 'end',
    });
  }

  // ---------- events of the edit domain ----------

  // the handler the edit route of the event layer calls. a block event names
  // its block through event.source (sourcePath, blockIndex); the session
  // events are accepted only from the editor of the open session.
  async eventHandle(event: DocEvent): Promise<EditResult | undefined> {
    if (event.type === 'editBlockMoveRequest') {
      const path = String(event.source.sourcePath ?? '');
      const blockIndex = Number(event.source.blockIndex);
      if (!path || !Number.isInteger(blockIndex)) {
        return { code: -1, message: 'editBlockMoveRequest needs the document path and the block index' };
      }
      const direction: EditBlockMoveDirection = event.data.direction === 'up' ? 'up' : 'down';
      const isMoved = await this.blockMoveApply(path, blockIndex, direction);
      return isMoved ? { code: 0, message: '' } : { code: -1, message: this.blockMove?.message || 'the block was not moved' };
    }

    if (event.type.startsWith('sidePanelText')) {
      const itemId = String(event.source.itemId ?? '');
      if (!itemId) return { code: -1, message: `${event.type} needs the item id` };
      if (event.type === 'sidePanelTextEditStartRequest') {
        const isStarted = await this.sidePanelTextEditStart(itemId);
        return isStarted ? { code: 0, message: '' } : { code: -1, message: 'the label of this item cannot be edited' };
      }
      if (event.type === 'sidePanelTextSubmitRequest') {
        return this.sidePanelTextSubmit(itemId, String(event.data.text ?? ''));
      }
      if (event.type === 'sidePanelTextCancelRequest') {
        this.sidePanelTextCancel(itemId);
        return { code: 0, message: '' };
      }
      return undefined;
    }

    const session = this.session;
    if (!session) return { code: -1, message: 'no edit session is open' };
    if (event.source.sourcePath && event.source.sourcePath !== session.path) {
      return { code: -1, message: 'the event is not from the open edit session' };
    }
    const block = session.type === 'block' ? this.docEditByPath[session.path]?.model?.blockList[session.blockIndex] : undefined;

    if (event.type === 'editDraftChange') {
      const text = eventBlockTextGet(event.data, block);
      if (text !== undefined) this.sessionDraftSet(text);
      return { code: 0, message: '' };
    }
    if (event.type === 'editTextSetRequest') {
      this.sessionTextSet(String(event.data.text ?? ''));
      return { code: 0, message: '' };
    }
    if (event.type === 'editCancelRequest') {
      const isCanceled = await this.sessionCancel();
      return isCanceled ? { code: 0, message: '' } : { code: -1, message: this.session?.message ?? 'the edit was not canceled' };
    }
    if (event.type === 'editSubmitRequest') {
      // Save: the explicit leave. an editor may hand over its final draft here.
      const text = eventBlockTextGet(event.data, block);
      if (text !== undefined) this.sessionDraftSet(text);
      const isSubmitted = await this.sessionLeave();
      return isSubmitted ? { code: 0, message: '' } : { code: -1, message: this.session?.message ?? 'the edit was not saved' };
    }
    if (event.type === 'editFocusShiftRequest') {
      const direction: EditFocusShiftDirection = event.data.direction === 'previous' ? 'previous' : 'next';
      const isShifted = await this.sessionFocusShift(direction);
      return isShifted ? { code: 0, message: '' } : { code: -1, message: `no block ${direction === 'next' ? 'after' : 'before'} this one` };
    }
    return undefined;
  }

  // ---------- insert menu and block creation ----------

  insertMenuIs(path: string, blockIndexAnchor: number): boolean {
    return this.insertMenu?.path === path && this.insertMenu.blockIndexAnchor === blockIndexAnchor;
  }

  // opens the insert menu at the toolbar of block blockIndexAnchor, for a new
  // block at border borderIndex (before or after that block). an empty
  // document opens it with blockIndexAnchor -1 and borderIndex 0.
  async insertMenuOpen(path: string, blockIndexAnchor: number, borderIndex: number): Promise<boolean> {
    if (this.insertMenuIs(path, blockIndexAnchor) && this.insertMenu?.borderIndex === borderIndex) return true;
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    runInAction(() => {
      this.deleteConfirm = undefined;
      this.blockMoveClear();
      this.insertMenu = { path, borderIndex, blockIndexAnchor, status: 'open', message: '' };
    });
    return true;
  }

  insertMenuClose() {
    if (this.insertMenu?.status === 'submitting') return;
    this.insertMenu = undefined;
  }

  // writes a new block (a template text) at the border of the open insert
  // menu and opens it in edit mode once the document is compiled with it
  async blockCreate(path: string, text: string): Promise<boolean> {
    const menu = this.insertMenu;
    if (!menu || menu.path !== path || menu.status === 'submitting') return false;
    const model = this.docEditByPath[path]?.model;
    if (!model) {
      runInAction(() => {
        menu.status = 'error';
        menu.message = 'The document is not loaded.';
      });
      return false;
    }
    runInAction(() => {
      menu.status = 'submitting';
      menu.message = '';
    });
    const operation = blockInsertOperationBuild(model, menu.borderIndex, text.replace(/\r\n/g, '\n'));
    const result = await this.operationApply(path, operation, {
      messageFailure: 'The block was not created.',
      onApplied: () => {
        if (this.insertMenu === menu) this.insertMenu = undefined;
      },
    });
    if (result.code !== 0) {
      runInAction(() => {
        menu.status = 'error';
        menu.message = result.message;
      });
      return false;
    }
    return this.sessionBlockStart(path, menu.borderIndex, { isCreated: true, selectionInitial: 'all' });
  }

  // ---------- moving a block ----------

  // a block can move up when a block is above it, down when one is below
  blockMoveIsAvailable(path: string, blockIndex: number, direction: EditBlockMoveDirection): boolean {
    const blockIndexOther = direction === 'up' ? blockIndex - 1 : blockIndex + 1;
    return blockIndexOther >= 0 && blockIndexOther < this.blockCountGet(path);
  }

  blockMoveIs(path: string, blockIndex: number): boolean {
    return this.blockMove?.path === path && this.blockMove.blockIndex === blockIndex;
  }

  blockMoveClear() {
    if (this.blockMove?.status === 'submitting') return;
    this.blockMove = undefined;
  }

  // swaps the block with its neighbor in `direction`: one replaceLines
  // operation over the lines of the two blocks and the lines between them,
  // so the file keeps its line count and the blank lines that separate the
  // blocks. requested through the event layer (editBlockMoveRequest).
  private async blockMoveApply(path: string, blockIndex: number, direction: EditBlockMoveDirection): Promise<boolean> {
    if (this.blockMove?.status === 'submitting') return false;
    if (!this.blockMoveIsAvailable(path, blockIndex, direction)) {
      runInAction(() => {
        this.blockMove = {
          path, blockIndex, direction, status: 'error', message: `no block ${direction === 'up' ? 'above' : 'below'} this one`,
        };
      });
      return false;
    }
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    const model = this.docEditByPath[path]?.model;
    const indexUpper = direction === 'up' ? blockIndex - 1 : blockIndex;
    if (!model?.blockList[indexUpper] || !model.blockList[indexUpper + 1]) return false;
    const move: EditBlockMove = { path, blockIndex, direction, status: 'submitting', message: '' };
    runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockMove = move;
    });
    const result = await this.operationApply(path, blockSwapOperationBuild(model, indexUpper), {
      messageFailure: 'The block was not moved.',
      onApplied: () => {
        if (this.blockMove === move) this.blockMove = undefined;
      },
    });
    if (result.code !== 0) {
      runInAction(() => {
        move.status = 'error';
        move.message = result.message;
      });
      return false;
    }
    return true;
  }

  // ---------- side-panel item labels ----------
  // the label of a side-panel item is edited where it is displayed and
  // written back into its yaml file by the development server, in place
  // (doc_page_impl_side_panel.md). the server then reports the new
  // configuration as data, which rebuilds the side panel.

  // an item authored in a side-panel file (the plugin annotated where); an
  // item generated from the source tree has no label to write
  sidePanelTextIsEditable(itemId: string): boolean {
    if (!this.isAvailable || !this.isEditMode) return false;
    return Boolean(this.sidePanelOutlineGet(itemId)?.textSource);
  }

  sidePanelTextIs(itemId: string): boolean {
    return this.sidePanelText?.itemId === itemId;
  }

  // the label to show for an item: the one just saved, until the new
  // configuration arrives; undefined when the displayed label is current
  sidePanelTextPendingGet(itemId: string): string | undefined {
    return this.sidePanelTextPending?.itemId === itemId ? this.sidePanelTextPending.text : undefined;
  }

  // editing a label is an edit action like any other: the open block
  // session is left (saved) first
  async sidePanelTextEditStart(itemId: string): Promise<boolean> {
    if (!this.sidePanelTextIsEditable(itemId)) return false;
    if (this.sidePanelText?.status === 'submitting') return false;
    const isLeft = await this.sessionLeave();
    if (!isLeft) return false;
    runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockMoveClear();
      this.sidePanelText = { itemId, status: 'editing', message: '' };
    });
    return true;
  }

  sidePanelTextCancel(itemId: string) {
    if (!this.sidePanelTextIs(itemId) || this.sidePanelText.status === 'submitting') return;
    this.sidePanelText = undefined;
  }

  // writes the label; an unchanged or empty text only ends the editing
  async sidePanelTextSubmit(itemId: string, text: string): Promise<EditResult> {
    const edit = this.sidePanelText;
    if (!edit || edit.itemId !== itemId || edit.status === 'submitting') {
      return { code: -1, message: 'no label edit is open for this item' };
    }
    const outline = this.sidePanelOutlineGet(itemId);
    if (!outline?.textSource || !this.api) {
      return { code: -1, message: 'the label of this item cannot be edited' };
    }
    const textNext = text.replace(/\s+/g, ' ').trim();
    const textShown = this.docStore.textDisplayGet(outline.textLocalized);
    if (textNext === '' || textNext === textShown.text) {
      runInAction(() => {
        this.sidePanelText = undefined;
      });
      return { code: 0, message: '' };
    }
    runInAction(() => {
      edit.status = 'submitting';
      edit.message = '';
    });
    const configDocBefore = this.sourceStore.configDoc;
    const result = await this.api.sidePanelTextApply({
      file: outline.textSource.file,
      nodePath: outline.textSource.path,
      language: textShown.language,
      text: textNext,
      textBase: outline.isTextAuthored ? textShown.text : undefined,
    });
    runInAction(() => {
      if (result.code !== 0) {
        edit.status = 'error';
        edit.message = result.message || 'The label was not saved.';
        return;
      }
      // the new configuration is reported by the server as data; until it
      // is here, the item shows the saved label itself
      if (this.sourceStore.configDoc === configDocBefore) {
        this.sidePanelTextPending = { itemId, text: textNext };
      }
      if (this.sidePanelText === edit) this.sidePanelText = undefined;
    });
    return result;
  }

  private sidePanelOutlineGet(itemId: string): any {
    return this.docStore.treeModel.itemOutlineById.get(itemId);
  }

  // ---------- deletion ----------

  async deleteConfirmSet(path: string, blockIndex: number): Promise<boolean> {
    if (this.deleteConfirm?.status === 'submitting') return false;
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    runInAction(() => {
      this.insertMenu = undefined;
      this.blockMoveClear();
      this.deleteConfirm = { path, blockIndex, status: 'confirming', message: '' };
    });
    return true;
  }

  deleteConfirmClear() {
    if (this.deleteConfirm?.status === 'submitting') return;
    this.deleteConfirm = undefined;
  }

  deleteConfirmIs(path: string, blockIndex: number): boolean {
    return this.deleteConfirm?.path === path && this.deleteConfirm.blockIndex === blockIndex;
  }

  async blockDelete(path: string, blockIndex: number): Promise<boolean> {
    const confirm = this.deleteConfirm;
    if (!confirm || confirm.path !== path || confirm.blockIndex !== blockIndex || confirm.status === 'submitting') {
      return false;
    }
    runInAction(() => {
      confirm.status = 'submitting';
      confirm.message = '';
    });
    const result = await this.blockDeleteApply(path, blockIndex, () => {
      if (this.deleteConfirm === confirm) this.deleteConfirm = undefined;
    });
    if (result.code !== 0) {
      runInAction(() => {
        confirm.status = 'error';
        confirm.message = result.message;
      });
      return false;
    }
    return true;
  }

  // the delete operation of one block, shared by the confirmed deletion and
  // by canceling a created block
  private blockDeleteApply(path: string, blockIndex: number, onApplied: () => void): Promise<EditResult> {
    const model = this.docEditByPath[path]?.model;
    if (!model || !model.blockList[blockIndex]) {
      return Promise.resolve({ code: -1, message: 'The block no longer exists.' });
    }
    return this.operationApply(path, blockDeleteOperationBuild(model, blockIndex), {
      messageFailure: 'The block was not deleted.',
      onApplied,
    });
  }
}

// the block text an editor's event describes: { text } as is, { raw, props }
// of a component editor rebuilt into the block (submitted props replace the
// authored props of the same name only)
function eventBlockTextGet(eventData: Record<string, any>, block: any): string | undefined {
  if (typeof eventData.text === 'string') return eventData.text;
  if (block?.component && (eventData.raw !== undefined || eventData.props !== undefined)) {
    const props = eventData.props ? { ...block.component.props, ...eventData.props } : undefined;
    return componentBlockTextBuild(block, { raw: eventData.raw, props });
  }
  return undefined;
}
