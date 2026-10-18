import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import type { DocConfigStore } from './DocConfigStore.js';
import type { AssetUsageChange, DocAssetStore } from './DocAssetStore.js';
import { compileDoc } from '../lib/mdx-compile.js';
import { docEditApiCreate } from '../lib/doc-edit-api.js';
import { ASSET_REF_LANG, ASSET_STORE_ID_LOCAL, assetRefLangIs, assetRefParse, assetRefTextBuild } from '../lib/doc-asset-ref.js';
import { compDefinitionNormalize, compIdResolve, compInputNormalize } from '../../../comp-doc/registry/comp-registry.js';
import {
  COMP_EDIT_MODE_SOURCE_ID,
  compEditModeListGet,
  compEditModeSource,
  compMetaGet,
  compViewModeListGet,
} from '../../../comp-doc/registry/comp-expose.js';
import {
  blockDeleteOperationBuild,
  blockInsertOperationBuild,
  blockReplaceOperationBuild,
  blockSwapOperationBuild,
  componentBlockTextBuild,
  componentTemplateTextBuild,
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
//   session           the one block being edited, or the frontmatter / whole document,
//                     in one edit mode of the block (editModeId)
//   blockViewModeById the view mode a reader picked for a block, by "path#index"
//   blockModeMenu     the one mode menu (view modes / edit modes of a block) that is open
//   insertMenu        the one insert menu that is open, anchored to a block toolbar
//   deleteConfirm     the one block whose deletion waits for confirmation
//   blockMove         the one block being moved up or down (swapped with its
//                     neighbor), or the failure of the last move
//   blockAssetMove    the one block whose inline data waits for the
//                     confirmation of its move into the asset store, is
//                     being moved, or the failure of the last such move
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

// where the caret is when the editing surface opens
// (doc_page_impl_edit.md#where-the-caret-goes): at the end (an edit started
// from the toolbar), at the start, the whole text selected (a block created
// from a template: typing replaces it), at the text nearest to a point of
// the screen (the block was clicked there), or on the first / last line at
// an x of the screen (entered from the neighbor block by a focus shift: the
// caret keeps its column). points are viewport coordinates.
export type EditSelectionInitial =
  | 'all'
  | 'start'
  | 'end'
  | { type: 'point'; clientX: number; clientY: number }
  | { type: 'line'; line: 'first' | 'last'; clientX: number };

export type EditPoint = { clientX: number; clientY: number };

export type EditSession = {
  type: EditSessionType;
  path: string;
  // block: index of the block; -1 for the frontmatter and the whole document
  blockIndex: number;
  // the block was created from the insert menu by this session; cancel removes it
  isCreated: boolean;
  // the edit mode the block is open in (doc_page_impl_mdx_comp.md#view-modes-and-edit-modes):
  // one the component exposes, or the built-in 'source'; the frontmatter and
  // the whole document are always 'source'
  editModeId: string;
  selectionInitial: EditSelectionInitial;
  textInitial: string;
  textDraft: string;
  // increases only when the text is set by code (a level control, a
  // template), so the uncontrolled editing surface knows when to rewrite its DOM
  draftVersion: number;
  // the draft of the asset data, for a block whose data is a reference into
  // the asset store, open in an edit mode of its component (an isAssetOnly
  // component): the component edits the asset, not the lines of the block.
  // a leave writes it into the asset object; undefined while unchanged
  assetDraft?: EditAssetDraft;
  // the asset object created for this block when it was created from the
  // insert menu (an isAssetOnly component); canceling the creation deletes
  // it (softly) with the block
  assetObjectIdCreated?: string;
  status: 'editing' | 'submitting' | 'error';
  message: string;
};

export type EditAssetDraft = {
  store: string;
  objectId: string;
  raw: string;
  // the metadata of the version the data is saved as; undefined keeps the head's
  versionMetadata?: Record<string, unknown>;
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

// one entry of the mode menu of a block: a view mode or an edit mode as the
// component exposes it (comp-expose.js), plus whether it can be chosen now
export type EditModeEntry = {
  id: string;
  label: string;
  description: string;
  icon?: any;
  isBuiltin: boolean;
  isDefault: boolean;
  isDisabled: boolean;
  disabledReason: string;
};

// the one block whose mode menu is open
export type EditBlockModeMenu = {
  path: string;
  blockIndex: number;
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

// the one component block whose inline data waits for the confirmation of
// its move into the asset store, is being moved, or the failure of the last
// such move
export type EditBlockAssetMove = {
  path: string;
  blockIndex: number;
  status: 'confirming' | 'submitting' | 'error';
  message: string;
};

// the one side-panel item whose label is being edited in place. the same
// item is rendered in several places at once (the side panel, the
// breadcrumb, the footer cards, the toc popover, a mobile side panel next
// to the desktop one); ownerId is the rendered label the edit was started
// from (its instance id), and only that label shows the editor and may
// finish the edit
export type EditSidePanelText = {
  itemId: string;
  ownerId: string;
  status: 'editing' | 'submitting' | 'error';
  message: string;
};

// what one rendered label shows of the label edit of its item
export type EditSidePanelTextState = {
  status: '' | 'editing' | 'submitting' | 'error';
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

type DocEvent = { type: string; data: Record<string, any>; source: Record<string, any>; point?: EditPoint };

// the event types the edit route of the event layer brings here: the
// session events of the editor of the open session, and the block events
// the block wrapper or a toolbar reports for the block it belongs to
export const editEventTypeList = [
  'editDraftChange',
  'editTextSetRequest',
  'editSubmitRequest',
  'editCancelRequest',
  'editFocusShiftRequest',
  'editBlockEnterRequest',
  'editBlockMoveRequest',
  'editBlockAssetMoveRequest',
  'dataReplaceRequest',
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
  blockViewModeById: Record<string, string> = {};
  blockModeMenu: EditBlockModeMenu | undefined = undefined;
  insertMenu: EditInsertMenu | undefined = undefined;
  deleteConfirm: EditDeleteConfirm | undefined = undefined;
  blockMove: EditBlockMove | undefined = undefined;
  blockAssetMove: EditBlockAssetMove | undefined = undefined;
  // the text a block was just saved as, shown in its place until the document
  // is compiled again, so the saved block never flashes back to its old text
  blockTextPending: { path: string; blockIndex: number; text: string } | undefined = undefined;
  sidePanelText: EditSidePanelText | undefined = undefined;
  // the rendered label whose request to start editing is waiting for the
  // open block session to be left; a later request replaces it
  sidePanelTextStartOwnerId: string | undefined = undefined;
  // the label an item was just saved as, shown until the side panel is built
  // from the new configuration, for the same reason as blockTextPending
  sidePanelTextPending: { itemId: string; text: string } | undefined = undefined;
  // the leave in progress, so that a second leave request waits for it
  leavePromise: Promise<boolean> | undefined;
  // what the editor of the open session does before its draft is saved
  // (sessionSubmitPrepareSet)
  submitPrepare: { session: EditSession; handler: () => Promise<EditResult | void> } | undefined;
  reactionDispose: (() => void) | undefined;
  reactionConfigDispose: (() => void) | undefined;

  // the asset store, for moving a block's inline data into it
  assetStore: DocAssetStore | undefined;

  constructor(
    sourceStore: DocSourceStore,
    docStore: DocStore,
    configStore: DocConfigStore,
    options?: { endpoint?: string; assetStore?: DocAssetStore },
  ) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.configStore = configStore;
    this.assetStore = options?.assetStore;
    this.api = options?.endpoint ? docEditApiCreate(options.endpoint) : undefined;
    makeAutoObservable(this, {
      api: false,
      assetStore: false,
      configStore: false,
      docStore: false,
      sourceStore: false,
      docEditByPath: observable.shallow,
      sourceByPath: observable.shallow,
      compilePendingByPath: false,
      leavePromise: false,
      sidePanelTextStartOwnerId: false,
      submitPrepare: false,
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
          if (this.blockAssetMove && this.blockAssetMove.path !== path) this.blockAssetMove = undefined;
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
      this.blockAssetMoveClear();
      // a label still being typed is dropped: it was never saved
      if (this.sidePanelText?.status !== 'submitting') this.sidePanelText = undefined;
      this.sidePanelTextStartOwnerId = undefined;
    });
    return true;
  }

  editModeToggle(): Promise<boolean> {
    return this.editModeSet(!this.isEditMode);
  }

  // 'click':  a click anywhere on the block, as well as the Edit button (the default)
  // 'button': the Edit button of the block toolbar only
  get blockEnterMode(): 'button' | 'click' {
    return this.configStore.valueGlobalGet('EditBlockEnterMode') === 'button' ? 'button' : 'click';
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
      // the block a confirmation names may be another one now
      if (isChanged && this.blockAssetMove?.path === path && this.blockAssetMove.status === 'confirming') {
        this.blockAssetMove = undefined;
      }
      if (isChanged && this.blockModeMenu?.path === path) this.blockModeMenu = undefined;
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
      // the view modes picked for the blocks are kept by block index; when
      // the new text has another number of blocks the indices name other
      // blocks, so the picks of this document are dropped
      const blockCountBefore = this.docEditByPath[path]?.model?.blockList.length;
      const blockCountNext = stateNext.model?.blockList.length;
      if (blockCountBefore !== undefined && blockCountBefore !== blockCountNext) this.blockViewModeClearForPath(path);
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
      if (this.blockModeMenu?.path === path) this.blockModeMenu = undefined;
      if (this.blockAssetMove?.path === path) this.blockAssetMoveClear();
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
      || this.blockAssetMove?.status === 'submitting'
      || this.sidePanelText?.status === 'submitting';
  }

  // opens the block in one of its edit modes (blockEditModeListGet): the
  // requested one, else the default. a read-only block, or a mode the block
  // does not have, opens nothing. the same block already open in another
  // mode is left (saved) and opened again in the requested one.
  async sessionBlockStart(
    path: string,
    blockIndex: number,
    options: { isCreated?: boolean; selectionInitial?: EditSelectionInitial; editModeId?: string } = {},
  ): Promise<boolean> {
    const modeList = this.blockEditModeListGet(path, blockIndex);
    const editModeId = options.editModeId ?? modeList.find((mode) => mode.isDefault)?.id;
    const mode = modeList.find((modeOne) => modeOne.id === editModeId);
    if (!mode || mode.isDisabled) return false;
    if (this.sessionIs(path, 'block', blockIndex) && this.session?.editModeId === editModeId) return true;
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
      editModeId: mode.id,
      selectionInitial: options.selectionInitial ?? 'end',
    });
    return true;
  }

  // ---------- view modes and edit modes of a block ----------
  // what a block can be shown as and edited as comes from the component's
  // definition (comp-expose.js); a block without a component is shown one
  // way and edited as source (doc_page_impl_mdx_comp.md#view-modes-and-edit-modes)

  // the registry definition of a component block; undefined for other blocks
  private blockDefinitionGet(path: string, blockIndex: number): any {
    const component = this.docEditByPath[path]?.model?.blockList[blockIndex]?.component;
    if (!component) return undefined;
    const compId = compIdResolve(this.sourceStore.configDoc, String(component.compName ?? ''));
    return compDefinitionNormalize(this.docStore.compById[compId]);
  }

  // a component that declares itself read-only: nothing of the block can
  // be edited from the page, so no edit mode exists for it
  blockIsReadOnly(path: string, blockIndex: number): boolean {
    const definition = this.blockDefinitionGet(path, blockIndex);
    return Boolean(definition) && compMetaGet(definition).isReadOnly;
  }

  // a component that is entered only through an explicit control (the
  // toolbar's Edit button, the mode menu): a click on the block or a focus
  // shift from its neighbor does not open it, whatever EditBlockEnterMode is
  blockIsEditEnterButtonOnly(path: string, blockIndex: number): boolean {
    const definition = this.blockDefinitionGet(path, blockIndex);
    return Boolean(definition) && compMetaGet(definition).isEditEnterButtonOnly;
  }

  blockViewModeListGet(path: string, blockIndex: number): EditModeEntry[] {
    const definition = this.blockDefinitionGet(path, blockIndex);
    return compViewModeListGet(definition).map((mode) => ({ ...mode, isDisabled: false, disabledReason: '' }));
  }

  // the view mode a reader picked for the block; undefined means the
  // component's default (RegisteredComp resolves it)
  blockViewModeGet(path: string, blockIndex: number): string | undefined {
    return this.blockViewModeById[blockViewModeKeyBuild(path, blockIndex)];
  }

  blockViewModeSet(path: string, blockIndex: number, viewModeId: string): boolean {
    const isKnown = this.blockViewModeListGet(path, blockIndex).some((mode) => mode.id === viewModeId);
    if (!isKnown) return false;
    this.blockViewModeById[blockViewModeKeyBuild(path, blockIndex)] = viewModeId;
    return true;
  }

  private blockViewModeClearForPath(path: string) {
    for (const key of Object.keys(this.blockViewModeById)) {
      if (key.startsWith(`${path}#`)) delete this.blockViewModeById[key];
    }
  }

  // the edit modes of the block, for the mode menu and for opening it. a
  // component block: what its component exposes, with the built-in source
  // mode (comp-expose.js); when its data is a reference into the asset
  // store, only the source mode can be entered, since the component's
  // editor would edit the asset's text and not the lines of this block
  // (doc_page_impl_asset.md#edit-mode). any other block: the source mode.
  // a component declared isAssetOnly is the other way round
  // (blockEditModeAssetOnlyListGet).
  blockEditModeListGet(path: string, blockIndex: number): EditModeEntry[] {
    const block = this.docEditByPath[path]?.model?.blockList[blockIndex];
    if (!block) return [];
    if (!block.component) return [{ ...compEditModeSource, isDefault: true, isDisabled: false, disabledReason: '' }];
    const definition = this.blockDefinitionGet(path, blockIndex);
    const isAssetRef = assetRefLangIs(block.component.lang);
    const modeList = compEditModeListGet(definition);
    if (compMetaGet(definition).isAssetOnly) return this.blockEditModeAssetOnlyListGet(block, definition, modeList);
    if (!isAssetRef) return modeList.map((mode) => ({ ...mode, isDisabled: false, disabledReason: '' }));
    const isSourceListed = modeList.some((mode) => mode.id === COMP_EDIT_MODE_SOURCE_ID);
    const modeListAsset = modeList.map((mode) => ({
      ...mode,
      isDefault: mode.id === COMP_EDIT_MODE_SOURCE_ID,
      isDisabled: mode.id !== COMP_EDIT_MODE_SOURCE_ID,
      disabledReason: mode.id !== COMP_EDIT_MODE_SOURCE_ID ? 'the data is in the asset store; edit it through the asset panel' : '',
    }));
    if (!isSourceListed && !compMetaGet(definition).isReadOnly) {
      modeListAsset.push({ ...compEditModeSource, isDefault: true, isDisabled: false, disabledReason: '' });
    }
    return modeListAsset;
  }

  // the edit modes of a block of an isAssetOnly component
  // (doc_page_impl_edit.md#asset-only-components): its data is only ever in
  // the asset store, so the component's own modes edit the referenced asset
  // (the session's assetDraft) and are what the block opens in. the source
  // mode, when the component accepts it, is kept for the lines of the
  // block. a block with the data written inline cannot be edited in the
  // component's modes until "to asset" moved the data; a reference pinned to
  // a version other than the head cannot, since a save writes the head.
  private blockEditModeAssetOnlyListGet(block: any, definition: any, modeList: any[]): EditModeEntry[] {
    let disabledReason = '';
    if (!assetRefLangIs(block.component.lang)) {
      disabledReason = 'the data must be in the asset store; move it there with "to asset" first';
    } else {
      const reference = assetRefParse(block.component.raw);
      if (reference.message) disabledReason = reference.message;
      else if (reference.versionId !== 'head') disabledReason = `the reference reads version ${reference.versionId}, not the head; a save writes the head`;
      else if (!this.assetStore?.isWritable) disabledReason = this.assetWriteUnavailableReasonGet();
    }
    return modeList.map((mode) => {
      const isSource = mode.id === COMP_EDIT_MODE_SOURCE_ID;
      return {
        ...mode,
        isDisabled: !isSource && Boolean(disabledReason),
        disabledReason: isSource ? '' : disabledReason,
      };
    });
  }

  // why the asset store cannot be written now: no store, a failed status
  // request, a read-only snapshot (DocAssetStore.writeUnavailableReason)
  private assetWriteUnavailableReasonGet(): string {
    return this.assetStore ? this.assetStore.writeUnavailableReason : 'The page has no asset store.';
  }

  // the mode menu is offered where there is something to choose: a
  // component block with more than one view mode or more than one edit mode
  blockModeMenuIsAvailable(path: string, blockIndex: number): boolean {
    const block = this.docEditByPath[path]?.model?.blockList[blockIndex];
    if (!block?.component) return false;
    return this.blockViewModeListGet(path, blockIndex).length > 1 || this.blockEditModeListGet(path, blockIndex).length > 1;
  }

  blockModeMenuIs(path: string, blockIndex: number): boolean {
    return this.blockModeMenu?.path === path && this.blockModeMenu.blockIndex === blockIndex;
  }

  blockModeMenuOpen(path: string, blockIndex: number) {
    this.blockModeMenu = { path, blockIndex };
  }

  blockModeMenuClose() {
    this.blockModeMenu = undefined;
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
      type: 'frontmatter',
      path,
      blockIndex: -1,
      textInitial: frontmatter.text,
      isCreated: false,
      editModeId: COMP_EDIT_MODE_SOURCE_ID,
      selectionInitial: 'all',
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
      type: 'document',
      path,
      blockIndex: -1,
      textInitial: source.text ?? '',
      isCreated: false,
      editModeId: COMP_EDIT_MODE_SOURCE_ID,
      selectionInitial: 'all',
    });
    return true;
  }

  private sessionStart(
    sessionPartial: Pick<EditSession, 'type' | 'path' | 'blockIndex' | 'textInitial' | 'isCreated' | 'editModeId' | 'selectionInitial'>,
  ) {
    runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockModeMenu = undefined;
      this.blockMoveClear();
      this.blockAssetMoveClear();
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

  // a draft event of the open block session is about asset data when the
  // component rendered the data of a reference (event.source.asset) in one
  // of its own edit modes: the block is an isAssetOnly component's
  // (blockEditModeAssetOnlyListGet enables nothing else)
  private sessionAssetDraftIsFor(event: DocEvent): boolean {
    const session = this.session;
    if (!session || session.type !== 'block' || session.editModeId === COMP_EDIT_MODE_SOURCE_ID) return false;
    return Boolean(event.source.asset?.isFromAsset);
  }

  // { raw, versionMetadata? } of the component's editor
  private sessionAssetDraftSet(event: DocEvent) {
    const session = this.session;
    if (!session || session.status === 'submitting') return;
    const asset = event.source.asset;
    const versionMetadata = event.data.versionMetadata;
    session.assetDraft = {
      store: String(asset.store),
      objectId: String(asset.objectId),
      raw: String(event.data.raw ?? session.assetDraft?.raw ?? ''),
      versionMetadata: versionMetadata && typeof versionMetadata === 'object' ? { ...versionMetadata } : session.assetDraft?.versionMetadata,
    };
    if (session.status === 'error') {
      session.status = 'editing';
      session.message = '';
    }
  }

  // the asset draft written into its object, in the object's save mode: the
  // block (the reference) is not touched. the session closes once the store
  // answers.
  private async sessionAssetDraftSubmit(session: EditSession, assetDraft: EditAssetDraft): Promise<boolean> {
    if (!this.assetStore?.isWritable) {
      this.sessionFail(this.assetWriteUnavailableReasonGet());
      return false;
    }
    const block = this.docEditByPath[session.path]?.model?.blockList[session.blockIndex];
    if (!block?.component) {
      this.sessionFail('The block no longer exists.');
      return false;
    }
    runInAction(() => {
      session.status = 'submitting';
      session.message = '';
    });
    const result = await this.assetStore.objectUpdate(
      assetDraft.store,
      assetDraft.objectId,
      { text: assetDraft.raw },
      undefined,
      `${block.component.compName} edited in ${session.path}`,
      this.blockDependencyListGet(block, assetDraft.raw, session.path),
      assetDraft.versionMetadata,
    );
    runInAction(() => {
      if (result.code !== 0) {
        session.status = 'error';
        session.message = result.message;
        return;
      }
      if (this.session === session) this.session = undefined;
    });
    return result.code === 0;
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
    if (session.status === 'submitting' || this.leavePromise) return false;
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
      // the object made for the block is referenced by nothing now; deleted
      // softly, so it can still be restored from the asset store
      if (session.assetObjectIdCreated && this.assetStore) {
        await this.assetStore.objectDelete(ASSET_STORE_ID_LOCAL, session.assetObjectIdCreated);
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

  // an editor that holds part of its draft outside the reported one (an
  // engine's open cell editor) registers what completes it; every leave
  // awaits it before the draft is read. the handler reports the completed
  // draft as usual (editDraftChange) and resolves { code: 0 }, or a failure
  // the session then shows, staying open. returns the unregistration.
  sessionSubmitPrepareSet(session: EditSession, handler: () => Promise<EditResult | void>): () => void {
    const submitPrepare = { session, handler };
    this.submitPrepare = submitPrepare;
    return () => {
      if (this.submitPrepare === submitPrepare) this.submitPrepare = undefined;
    };
  }

  private async sessionSubmit(): Promise<boolean> {
    const session = this.session;
    if (!session) return false;
    if (session.status === 'submitting') return false;
    const submitPrepare = this.submitPrepare?.session === session ? this.submitPrepare : undefined;
    if (submitPrepare) {
      let result: EditResult | void;
      try {
        result = await submitPrepare.handler();
      } catch (error: any) {
        result = { code: -1, message: String(error?.message ?? error) };
      }
      if (this.session !== session) return this.session === undefined;
      if (result && result.code !== 0) {
        this.sessionFail(result.message || 'The editor could not complete its change.');
        return false;
      }
    }
    if (session.assetDraft) return this.sessionAssetDraftSubmit(session, session.assetDraft);
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
  // is left (saved), the neighbor opens with the caret on its near line. with
  // the caret position of the leaving surface (point, viewport coordinates)
  // the caret keeps its x on that line; without it, it goes to the near end.
  // nothing happens at the first / last block, nor before a block that is
  // entered only through its Edit button.
  async sessionFocusShift(direction: EditFocusShiftDirection, point?: EditPoint): Promise<boolean> {
    const session = this.session;
    if (!session || session.type !== 'block') return false;
    const blockIndexNext = direction === 'next' ? session.blockIndex + 1 : session.blockIndex - 1;
    if (blockIndexNext < 0 || blockIndexNext >= this.blockCountGet(session.path)) return false;
    if (this.blockIsEditEnterButtonOnly(session.path, blockIndexNext)) return false;
    let selectionInitial: EditSelectionInitial;
    if (point) {
      selectionInitial = { type: 'line', line: direction === 'next' ? 'first' : 'last', clientX: point.clientX };
    } else {
      selectionInitial = direction === 'next' ? 'start' : 'end';
    }
    return this.sessionBlockStart(session.path, blockIndexNext, { selectionInitial });
  }

  // ---------- events of the edit domain ----------

  // the handler the edit route of the event layer calls. a block event names
  // its block through event.source (sourcePath, blockIndex); the session
  // events are accepted only from the editor of the open session.
  async eventHandle(event: DocEvent): Promise<EditResult | undefined> {
    if (event.type === 'editBlockEnterRequest' || event.type === 'editBlockMoveRequest' || event.type === 'editBlockAssetMoveRequest') {
      const path = String(event.source.sourcePath ?? '');
      const blockIndex = Number(event.source.blockIndex);
      if (!path || !Number.isInteger(blockIndex)) {
        return { code: -1, message: `${event.type} needs the document path and the block index` };
      }
      if (event.type === 'editBlockEnterRequest') {
        // with a point (the block was clicked) the caret goes to the text
        // nearest to it; without one (the toolbar button) to the end. the
        // edit mode is the one named by the request (the mode menu), else
        // the block's default
        if (this.blockIsReadOnly(path, blockIndex)) return { code: -1, message: 'the component is read-only' };
        const selectionInitial: EditSelectionInitial = event.point ? { type: 'point', ...event.point } : 'end';
        const editModeId = typeof event.data.editModeId === 'string' ? event.data.editModeId : undefined;
        const isStarted = await this.sessionBlockStart(path, blockIndex, { selectionInitial, editModeId });
        return isStarted ? { code: 0, message: '' } : { code: -1, message: this.session?.message || 'the block was not opened for editing' };
      }
      if (event.type === 'editBlockMoveRequest') {
        const direction: EditBlockMoveDirection = event.data.direction === 'up' ? 'up' : 'down';
        const isMoved = await this.blockMoveApply(path, blockIndex, direction);
        return isMoved ? { code: 0, message: '' } : { code: -1, message: this.blockMove?.message || 'the block was not moved' };
      }
      const isMovedToAsset = await this.blockAssetMoveApply(path, blockIndex);
      return isMovedToAsset
        ? { code: 0, message: '' }
        : { code: -1, message: this.blockAssetMove?.message || 'the data was not moved into the asset store' };
    }

    if (event.type === 'dataReplaceRequest') return this.dataReplaceApply(event);

    if (event.type.startsWith('sidePanelText')) {
      const itemId = String(event.source.itemId ?? '');
      if (!itemId) return { code: -1, message: `${event.type} needs the item id` };
      // the rendered label that reported the event
      const ownerId = String(event.source.instanceId ?? '');
      if (!ownerId) return { code: -1, message: `${event.type} needs the instance id of the label` };
      if (event.type === 'sidePanelTextEditStartRequest') {
        const isStarted = await this.sidePanelTextEditStart(itemId, ownerId);
        return isStarted ? { code: 0, message: '' } : { code: -1, message: 'the label of this item cannot be edited' };
      }
      if (event.type === 'sidePanelTextSubmitRequest') {
        return this.sidePanelTextSubmit(itemId, ownerId, String(event.data.text ?? ''));
      }
      if (event.type === 'sidePanelTextCancelRequest') {
        const isCanceled = this.sidePanelTextCancel(itemId, ownerId);
        return isCanceled ? { code: 0, message: '' } : { code: -1, message: 'no label edit is open in this label' };
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
      if (this.sessionAssetDraftIsFor(event)) {
        this.sessionAssetDraftSet(event);
        return { code: 0, message: '' };
      }
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
      if (this.sessionAssetDraftIsFor(event)) {
        if (event.data.raw !== undefined) this.sessionAssetDraftSet(event);
      } else {
        const text = eventBlockTextGet(event.data, block);
        if (text !== undefined) this.sessionDraftSet(text);
      }
      const isSubmitted = await this.sessionLeave();
      return isSubmitted ? { code: 0, message: '' } : { code: -1, message: this.session?.message ?? 'the edit was not saved' };
    }
    if (event.type === 'editFocusShiftRequest') {
      const direction: EditFocusShiftDirection = event.data.direction === 'previous' ? 'previous' : 'next';
      const isShifted = await this.sessionFocusShift(direction, event.point);
      return isShifted ? { code: 0, message: '' } : { code: -1, message: `no block ${direction === 'next' ? 'after' : 'before'} this one the caret can enter` };
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
      this.blockAssetMoveClear();
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

  // a new block of an isAssetOnly component (doc_page_impl_edit.md#asset-only-components):
  // its starting data (template.assetSource, from the component's factory)
  // becomes a new object of the local asset store, in the save mode the
  // component declares, then the block is written at the border of the open
  // insert menu as a reference to it, and opened in its default edit mode.
  // the document is written last: when that write fails, the object made
  // for it is deleted again (softly) and the document is as it was.
  async blockCreateAsAsset(
    path: string,
    template: { compName: string; assetSource: { lang: string; raw: string; props: Record<string, unknown> } },
  ): Promise<boolean> {
    const menu = this.insertMenu;
    if (!menu || menu.path !== path || menu.status === 'submitting') return false;
    const failSet = (message: string) => {
      runInAction(() => {
        menu.status = 'error';
        menu.message = message;
      });
    };
    const model = this.docEditByPath[path]?.model;
    if (!model) {
      failSet('The document is not loaded.');
      return false;
    }
    if (!this.assetStore?.isWritable) {
      failSet(`${template.compName} keeps its data in the asset store, which cannot be written: ${this.assetWriteUnavailableReasonGet()}`);
      return false;
    }
    runInAction(() => {
      menu.status = 'submitting';
      menu.message = '';
    });
    const compId = compIdResolve(this.sourceStore.configDoc, template.compName);
    const definition = compDefinitionNormalize(this.docStore.compById[compId]);
    const resultCreate = await this.assetStore.objectCreate({
      store: ASSET_STORE_ID_LOCAL,
      lang: template.assetSource.lang,
      text: template.assetSource.raw,
      note: `${template.compName} block created in ${path}`,
      saveMode: compMetaGet(definition).assetSaveMode,
      component: { name: template.compName },
    });
    const objectId: string = resultCreate.data?.object?.objectId ?? '';
    if (resultCreate.code !== 0 || !objectId) {
      failSet(resultCreate.message || 'The asset object of the new block was not created.');
      return false;
    }
    const text = componentTemplateTextBuild(template.compName, {
      lang: ASSET_REF_LANG,
      raw: assetRefTextBuild({ store: ASSET_STORE_ID_LOCAL, objectId }),
      props: template.assetSource.props,
    });
    const result = await this.operationApply(path, blockInsertOperationBuild(model, menu.borderIndex, text), {
      messageFailure: 'The block was not created.',
      onApplied: () => {
        if (this.insertMenu === menu) this.insertMenu = undefined;
      },
    });
    if (result.code !== 0) {
      await this.assetStore.objectDelete(ASSET_STORE_ID_LOCAL, objectId);
      failSet(result.message);
      return false;
    }
    void this.assetStore.usageNotify([{ type: 'docChange', docPath: path }]);
    const isStarted = await this.sessionBlockStart(path, menu.borderIndex, { isCreated: true, selectionInitial: 'all' });
    if (isStarted) {
      runInAction(() => {
        if (this.session) this.session.assetObjectIdCreated = objectId;
      });
    }
    return isStarted;
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
    // the store keeps an observable copy of what it is given: the copy is
    // the one compared and changed below
    const move = runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockAssetMoveClear();
      this.blockMove = { path, blockIndex, direction, status: 'submitting', message: '' };
      return this.blockMove!;
    });
    const usageChangeList = blockSwapUsageChangeListBuild(model, indexUpper, path);
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
    void this.assetStore?.usageNotify(usageChangeList);
    return true;
  }

  // ---------- moving a block's data into the asset store ----------

  // a component block with its data written inline in a fenced block can
  // move that data into the asset store (doc_page_impl_asset.md): a component
  // block with a reference already, or without a fenced block, cannot
  blockAssetMoveIsAvailable(path: string, blockIndex: number): boolean {
    if (!this.assetStore?.isWritable) return false;
    const component = this.docEditByPath[path]?.model?.blockList[blockIndex]?.component;
    return Boolean(component) && component.nodeType === 'code' && !assetRefLangIs(component.lang);
  }

  blockAssetMoveIs(path: string, blockIndex: number): boolean {
    return this.blockAssetMove?.path === path && this.blockAssetMove.blockIndex === blockIndex;
  }

  blockAssetMoveClear() {
    if (this.blockAssetMove?.status === 'submitting') return;
    this.blockAssetMove = undefined;
  }

  // the move is confirmed in the toolbar first, like a deletion: the "to
  // asset" button asks, the confirmation reports editBlockAssetMoveRequest
  async blockAssetMoveConfirmSet(path: string, blockIndex: number): Promise<boolean> {
    if (this.blockAssetMove?.status === 'submitting') return false;
    if (!this.blockAssetMoveIsAvailable(path, blockIndex)) return false;
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockMoveClear();
      this.blockAssetMove = { path, blockIndex, status: 'confirming', message: '' };
    });
    return true;
  }

  blockAssetMoveConfirmIs(path: string, blockIndex: number): boolean {
    return this.blockAssetMoveIs(path, blockIndex) && this.blockAssetMove!.status !== 'error';
  }

  // the inline data of the block becomes an object of the local asset store
  // (in its default folder, with the block's language, in the save mode its
  // component declares), and the fenced block is rewritten as the reference
  // to that object by id (lang "asset"). the object gets no name: a name
  // means one object of the store, and the store answers an existing object
  // for a name it has, so naming it after the component would make the
  // second Image block reference the first one's data. the person names it
  // in the asset panel. the object is created first and the document is
  // written last: only that write makes the move happen. when it fails, the
  // object stays in the store, the block keeps its inline data and works as
  // before. requested through the event layer (editBlockAssetMoveRequest).
  private async blockAssetMoveApply(path: string, blockIndex: number): Promise<boolean> {
    if (this.blockAssetMove?.status === 'submitting') return false;
    const failSet = (message: string) => {
      runInAction(() => {
        this.blockAssetMove = { path, blockIndex, status: 'error', message };
      });
    };
    if (!this.assetStore?.isWritable) {
      failSet(this.assetWriteUnavailableReasonGet());
      return false;
    }
    if (!this.blockAssetMoveIsAvailable(path, blockIndex)) {
      failSet('only a component block with inline data in a fenced block can move it into the asset store');
      return false;
    }
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    const model = this.docEditByPath[path]?.model;
    const block = model?.blockList[blockIndex];
    if (!block?.component) return false;
    // the observable copy the store keeps, as in blockMoveApply
    const move = runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockMove = undefined;
      this.blockAssetMove = { path, blockIndex, status: 'submitting', message: '' };
      return this.blockAssetMove!;
    });
    const resultCreate = await this.assetStore.objectCreate({
      store: ASSET_STORE_ID_LOCAL,
      lang: block.component.lang,
      text: block.component.raw,
      note: `${block.component.compName} data moved from ${path}`,
      dependencyList: this.blockDependencyListGet(block, block.component.raw, path),
      saveMode: compMetaGet(this.blockDefinitionGet(path, blockIndex)).assetSaveMode,
      component: { name: block.component.compName },
    });
    const objectId: string = resultCreate.data?.object?.objectId ?? '';
    if (resultCreate.code !== 0 || !objectId) {
      runInAction(() => {
        move.status = 'error';
        move.message = resultCreate.message || 'The asset object was not created.';
      });
      return false;
    }
    const referenceText = assetRefTextBuild({ store: ASSET_STORE_ID_LOCAL, objectId });
    const text = componentBlockTextBuild(block, { raw: referenceText, lang: ASSET_REF_LANG });
    const result = await this.operationApply(path, blockReplaceOperationBuild(block, text), {
      messageFailure: 'The block was not rewritten as a reference.',
      onApplied: () => {
        if (this.blockAssetMove === move) this.blockAssetMove = undefined;
        this.blockTextPending = { path, blockIndex, text };
      },
    });
    if (result.code !== 0) {
      runInAction(() => {
        move.status = 'error';
        move.message = `${result.message} The data is in the asset store as object ${objectId}.`;
      });
      return false;
    }
    void this.assetStore.usageNotify([{ type: 'docChange', docPath: path }]);
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

  // the label edit as one rendered label of the item shows it: the editor
  // (editing / submitting) only in the label the edit was started from; a
  // failed save in every label of the item that can be edited, so the edit
  // can be retried from any of them; nothing in the others
  sidePanelTextStateGet(itemId: string, ownerId: string, isLabelEditable: boolean): EditSidePanelTextState {
    const edit = this.sidePanelText;
    if (!edit || edit.itemId !== itemId) return { status: '', message: '' };
    if (edit.ownerId === ownerId) return { status: edit.status, message: edit.message };
    if (edit.status === 'error' && isLabelEditable) return { status: 'error', message: edit.message };
    return { status: '', message: '' };
  }

  // the label to show for an item: the one just saved, until the new
  // configuration arrives; undefined when the displayed label is current
  sidePanelTextPendingGet(itemId: string): string | undefined {
    return this.sidePanelTextPending?.itemId === itemId ? this.sidePanelTextPending.text : undefined;
  }

  // editing a label is an edit action like any other: the open block
  // session is left (saved) first. a label being edited elsewhere (another
  // item, or another rendering of the same item) is dropped, unsaved, for
  // the new one; one being saved refuses. of two requests started while the
  // session is being left, the later one opens.
  async sidePanelTextEditStart(itemId: string, ownerId: string): Promise<boolean> {
    if (!this.sidePanelTextIsEditable(itemId)) return false;
    if (this.sidePanelText?.status === 'submitting') return false;
    this.sidePanelTextStartOwnerId = ownerId;
    const isLeft = await this.sessionLeave();
    const isRequestCurrent = this.sidePanelTextStartOwnerId === ownerId;
    if (isRequestCurrent) this.sidePanelTextStartOwnerId = undefined;
    if (!isLeft || !isRequestCurrent) return false;
    if (!this.sidePanelTextIsEditable(itemId) || this.sidePanelText?.status === 'submitting') return false;
    runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
      this.blockMoveClear();
      this.blockAssetMoveClear();
      this.sidePanelText = { itemId, ownerId, status: 'editing', message: '' };
    });
    return true;
  }

  // only the label the edit was started from ends it
  sidePanelTextCancel(itemId: string, ownerId: string): boolean {
    const edit = this.sidePanelText;
    if (!edit || edit.itemId !== itemId || edit.ownerId !== ownerId || edit.status === 'submitting') return false;
    this.sidePanelText = undefined;
    return true;
  }

  // a rendered label is gone (the mobile side panel closed, the layout
  // changed, the tree was rebuilt): an edit it was showing is dropped
  // unsaved, as is its waiting request to start one. a save in progress
  // finishes; a failed save stays, shown by the other labels of the item.
  sidePanelTextOwnerRelease(ownerId: string) {
    if (this.sidePanelTextStartOwnerId === ownerId) this.sidePanelTextStartOwnerId = undefined;
    if (this.sidePanelText?.ownerId === ownerId && this.sidePanelText.status === 'editing') this.sidePanelText = undefined;
  }

  // writes the label; an unchanged or empty text only ends the editing.
  // only the label the edit was started from submits it: the blur of any
  // other label, or of one already replaced, is refused
  async sidePanelTextSubmit(itemId: string, ownerId: string, text: string): Promise<EditResult> {
    const edit = this.sidePanelText;
    if (!edit || edit.itemId !== itemId || edit.ownerId !== ownerId || edit.status !== 'editing') {
      return { code: -1, message: 'no label edit is open in this label' };
    }
    const outline = this.sidePanelOutlineGet(itemId);
    if (!outline?.textSource || !this.api) {
      return { code: -1, message: 'the label of this item cannot be edited' };
    }
    const textNext = text.replace(/\s+/g, ' ').trim();
    const textShown = this.docStore.textDisplayGet(outline.textLocalized);
    if (textNext === '' || textNext === textShown.text) {
      runInAction(() => {
        if (this.sidePanelText === edit) this.sidePanelText = undefined;
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
      this.blockAssetMoveClear();
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

  // the asset object a component block's data comes from, when the block is
  // a reference that resolves to one: what deleting the block may delete
  // with it (doc_page_impl_asset.md#objects-for-components).
  //   usageCountOther   the other blocks of the documents that reference it
  blockAssetObjectGet(path: string, blockIndex: number): {
    store: string; objectId: string; name: string; isDeleted: boolean; isLocked: boolean; usageCountOther: number;
  } | undefined {
    const component = this.docEditByPath[path]?.model?.blockList[blockIndex]?.component;
    if (!component || !assetRefLangIs(component.lang) || !this.assetStore) return undefined;
    const reference = assetRefParse(component.raw);
    if (reference.message) return undefined;
    const objectId = this.assetStore.refObjectIdGet(reference);
    const object = objectId ? this.assetStore.objectGet(reference.store, objectId) : undefined;
    if (!object) return undefined;
    const usageCountOther = this.assetStore.usageListGet(reference.store, objectId)
      .filter((usage) => !(usage.place.docPath === path && usage.place.sourceLine === component.markerLine))
      .length;
    return { store: reference.store, objectId, name: object.name, isDeleted: object.isDeleted, isLocked: object.isLocked, usageCountOther };
  }

  // deletes the confirmed block. isAssetDeleted: the asset object the
  // block's data comes from is deleted with it (softly: the deletion mark,
  // restorable in its panel). the object is marked first and the document
  // written last, the write being the step that makes the deletion happen:
  // when it fails, the mark is taken back and both are as they were. a
  // block deleted without its object leaves the object to the store, where
  // an object no block references any more shows as an orphan.
  async blockDelete(path: string, blockIndex: number, options: { isAssetDeleted?: boolean } = {}): Promise<boolean> {
    const confirm = this.deleteConfirm;
    if (!confirm || confirm.path !== path || confirm.blockIndex !== blockIndex || confirm.status === 'submitting') {
      return false;
    }
    const failSet = (message: string) => {
      runInAction(() => {
        confirm.status = 'error';
        confirm.message = message;
      });
    };
    runInAction(() => {
      confirm.status = 'submitting';
      confirm.message = '';
    });
    const block = this.docEditByPath[path]?.model?.blockList[blockIndex];
    const usageChange = blockUsageLinesGet(this.docEditByPath[path]?.model, block);
    const assetObject = options.isAssetDeleted ? this.blockAssetObjectGet(path, blockIndex) : undefined;
    const isAssetMarked = Boolean(assetObject && !assetObject.isDeleted);
    if (options.isAssetDeleted && !assetObject) {
      failSet('The asset object of the block is not known, so it was not deleted; the block was kept.');
      return false;
    }
    if (isAssetMarked) {
      const resultAsset = await this.assetStore!.objectDelete(assetObject!.store, assetObject!.objectId);
      if (resultAsset.code !== 0) {
        failSet(`The asset object was not deleted, so the block was kept: ${resultAsset.message}`);
        return false;
      }
    }
    const result = await this.blockDeleteApply(path, blockIndex, () => {
      if (this.deleteConfirm === confirm) this.deleteConfirm = undefined;
    });
    if (result.code !== 0) {
      if (isAssetMarked) await this.assetStore!.objectRestore(assetObject!.store, assetObject!.objectId);
      failSet(result.message);
      return false;
    }
    if (usageChange) void this.assetStore?.usageNotify([{ type: 'remove', docPath: path, ...usageChange }]);
    return true;
  }

  // ---------- data replacement requested by a component ----------

  // a component asks for its data to be replaced with new text
  // (dataReplaceRequest { raw, dependencyList? }; doc_page_impl_mdx_comp.md
  // #component-awareness). the block is named by event.source; when the
  // block's data is an asset (event.source.asset), the asset object is
  // updated in its save mode and the block is untouched; otherwise the
  // fenced block of the component is rewritten in the document. the
  // dependencies recorded with asset data are what the component's
  // definition extracts from the new data, unless the request names them.
  private async dataReplaceApply(event: DocEvent): Promise<EditResult> {
    const path = String(event.source.sourcePath ?? '');
    const blockIndex = Number(event.source.blockIndex);
    const raw = String(event.data.raw ?? '');
    if (!path || !Number.isInteger(blockIndex)) {
      return { code: -1, message: 'dataReplaceRequest needs the document path and the block index (the document must be in edit mode)' };
    }
    const block = this.docEditByPath[path]?.model?.blockList[blockIndex];
    if (!block?.component) return { code: -1, message: 'dataReplaceRequest names a block that is not a component block' };
    const dependencyList = Array.isArray(event.data.dependencyList)
      ? event.data.dependencyList
      : this.blockDependencyListGet(block, raw, path);

    const asset = event.source.asset;
    if (asset?.isFromAsset) {
      if (!this.assetStore?.isWritable) return { code: -1, message: this.assetWriteUnavailableReasonGet() };
      const result = await this.assetStore.objectUpdate(
        asset.store,
        asset.objectId,
        { text: raw },
        undefined,
        `${block.component.compName} data replaced from ${path}`,
        dependencyList,
      );
      return { code: result.code, data: result.data, message: result.message };
    }

    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return { code: -1, message: 'the open edit session was not left' };
    const text = componentBlockTextBuild(block, { raw });
    return this.operationApply(path, blockReplaceOperationBuild(block, text), {
      messageFailure: 'The data of the block was not replaced.',
      onApplied: () => {
        this.blockTextPending = { path, blockIndex, text };
      },
    });
  }

  // the dependencies of a component's data as its definition declares them
  // (compDefine assetDependencyListGet): source references are resolved
  // relative to the document into source paths; a reference naming no
  // file of the source is dropped.
  private blockDependencyListGet(block: any, raw: string, path: string): any[] {
    const compName = String(block.component?.compName ?? '');
    const compId = compIdResolve(this.sourceStore.configDoc, compName);
    const definition = compDefinitionNormalize(this.docStore.compById[compId]);
    if (typeof definition?.assetDependencyListGet !== 'function') return [];
    const { data } = compInputNormalize(definition, { raw, lang: block.component.lang, propsAuthored: block.component.props ?? {} });
    const dependencyList: any[] = [];
    for (const dependency of definition.assetDependencyListGet(data) ?? []) {
      if (dependency?.type === 'source') {
        const entry = this.sourceStore.fileResolve(String(dependency.path ?? ''), path);
        if (entry) dependencyList.push({ type: 'source', path: entry.internalPath });
        continue;
      }
      if (dependency?.type === 'asset' && dependency.objectId) {
        dependencyList.push({ type: 'asset', objectId: dependency.objectId, ...(dependency.versionId ? { versionId: dependency.versionId } : {}) });
      }
    }
    return dependencyList;
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

function blockViewModeKeyBuild(path: string, blockIndex: number): string {
  return `${path}#${blockIndex}`;
}

// the lines of a block in the content without frontmatter, the lines the
// usage index counts in (doc_page_impl_asset.md#usage); the model counts
// lines of the whole file
function blockUsageLinesGet(model: any, block: any): { lineStart: number; lineEnd: number } | undefined {
  if (!block) return undefined;
  const lineOffset = model?.frontmatter?.lineEnd ?? 0;
  return { lineStart: block.lineStart - lineOffset, lineEnd: block.lineEnd - lineOffset };
}

// what swapping a block with the next one does to the places of the
// references in them: the lower block moves to where the upper one started,
// the upper one follows the lower one and the lines between them
function blockSwapUsageChangeListBuild(model: any, indexUpper: number, path: string): AssetUsageChange[] {
  const blockUpper = model.blockList[indexUpper];
  const blockLower = model.blockList[indexUpper + 1];
  const linesUpper = blockUsageLinesGet(model, blockUpper)!;
  const linesLower = blockUsageLinesGet(model, blockLower)!;
  return [
    { type: 'move', docPath: path, ...linesLower, docPathTo: path, lineStartTo: linesUpper.lineStart },
    { type: 'move', docPath: path, ...linesUpper, docPathTo: path, lineStartTo: linesUpper.lineStart + (blockLower.lineEnd - blockUpper.lineEnd) },
  ];
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
