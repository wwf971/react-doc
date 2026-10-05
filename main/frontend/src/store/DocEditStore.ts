import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import { compileDoc } from '../lib/mdx-compile.js';
import { docEditApiCreate } from '../lib/doc-edit-api.js';
import {
  blockDeleteOperationBuild,
  blockInsertOperationBuild,
  blockReplaceOperationBuild,
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
//   sourceByPath      text + hash of a document as read from disk
//   docEditByPath     the document compiled with block wrappers + its block model
//   session           the one block being edited, or the frontmatter / whole document
//   insertMenu        the one border whose insert menu is open
//   deleteConfirm     the one block whose deletion waits for confirmation
//
// a session ends in one of two ways:
//   leave    the draft is saved when it changed (click outside, another edit
//            action, Save, Ctrl/⌘+Enter, edit mode switched off)
//   cancel   the draft is dropped (Esc, Cancel); a block that was just
//            created from the insert menu is removed again
// every edit action first leaves the open session, so a draft is never lost
// by starting something else.

export type EditSessionType = 'block' | 'frontmatter' | 'document';

export type EditSession = {
  type: EditSessionType;
  path: string;
  // block: index of the block; -1 for the frontmatter and the whole document
  blockIndex: number;
  // the block was created from the insert menu by this session; cancel removes it
  isCreated: boolean;
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
  status: 'open' | 'submitting' | 'error';
  message: string;
};

export type EditDeleteConfirm = {
  path: string;
  blockIndex: number;
  // the border whose button asked for the deletion shows the confirmation
  borderIndex: number;
  status: 'confirming' | 'submitting' | 'error';
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

const messageConflict = 'The document changed on disk since it was loaded. Re-read the file, then edit again.';

export class DocEditStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;
  api: ReturnType<typeof docEditApiCreate> | undefined;
  isAvailable = false;
  isEditMode = false;
  sourceByPath: Record<string, EditSource> = {};
  docEditByPath: Record<string, EditDocState> = {};
  compilePendingByPath: Record<string, { hash: string; promise: Promise<void> }> = {};
  session: EditSession | undefined = undefined;
  insertMenu: EditInsertMenu | undefined = undefined;
  deleteConfirm: EditDeleteConfirm | undefined = undefined;
  // the text a block was just saved as, shown in its place until the document
  // is compiled again, so the saved block never flashes back to its old text
  blockTextPending: { path: string; blockIndex: number; text: string } | undefined = undefined;
  // the leave in progress, so that a second leave request waits for it
  leavePromise: Promise<boolean> | undefined;
  reactionDispose: (() => void) | undefined;

  constructor(sourceStore: DocSourceStore, docStore: DocStore, options?: { endpoint?: string }) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.api = options?.endpoint ? docEditApiCreate(options.endpoint) : undefined;
    makeAutoObservable(this, {
      api: false,
      docEditByPath: observable.shallow,
      sourceByPath: observable.shallow,
      compilePendingByPath: false,
      leavePromise: false,
      reactionDispose: false,
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
        });
        if (isEditMode && this.docIsEditable(path)) void this.docEditEnsure(path);
      },
      { fireImmediately: true },
    );
  }

  dispose() {
    this.reactionDispose?.();
    this.reactionDispose = undefined;
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
    });
    return true;
  }

  editModeToggle(): Promise<boolean> {
    return this.editModeSet(!this.isEditMode);
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
      || this.deleteConfirm?.status === 'submitting';
  }

  async sessionBlockStart(path: string, blockIndex: number, options: { isCreated?: boolean } = {}): Promise<boolean> {
    if (this.sessionIs(path, 'block', blockIndex)) return true;
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    const block = this.docEditByPath[path]?.model?.blockList[blockIndex];
    if (!block) return false;
    this.sessionStart({ type: 'block', path, blockIndex, textInitial: block.text, isCreated: options.isCreated === true });
    return true;
  }

  // the leave before an action that names a block or border index of
  // `path`. when the saved draft changed the number of blocks (a paragraph
  // split in two, a block removed), the indices the action was started with
  // no longer mean the same blocks; the action is dropped and nothing opens.
  private async sessionLeaveForIndexAction(path: string): Promise<boolean> {
    const isSessionOpen = this.session !== undefined;
    const blockCountBefore = this.docEditByPath[path]?.model?.blockList.length;
    const isLeft = await this.sessionLeave();
    if (!isLeft) return false;
    if (!isSessionOpen) return true;
    const blockCountAfter = this.docEditByPath[path]?.model?.blockList.length;
    return blockCountAfter === blockCountBefore;
  }

  async sessionFrontmatterStart(path: string): Promise<boolean> {
    if (this.sessionIs(path, 'frontmatter')) return true;
    const isLeft = await this.sessionLeave();
    if (!isLeft) return false;
    const frontmatter = this.docEditByPath[path]?.model?.frontmatter;
    if (!frontmatter) return false;
    this.sessionStart({ type: 'frontmatter', path, blockIndex: -1, textInitial: frontmatter.text, isCreated: false });
    return true;
  }

  // the whole file, used when the document does not compile
  async sessionDocumentStart(path: string): Promise<boolean> {
    if (this.sessionIs(path, 'document')) return true;
    const isLeft = await this.sessionLeave();
    if (!isLeft) return false;
    const source = this.sourceByPath[path];
    if (source?.status !== 'done') return false;
    this.sessionStart({ type: 'document', path, blockIndex: -1, textInitial: source.text ?? '', isCreated: false });
    return true;
  }

  private sessionStart(sessionPartial: Pick<EditSession, 'type' | 'path' | 'blockIndex' | 'textInitial' | 'isCreated'>) {
    runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = undefined;
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
      const result = await this.blockDeleteApply(session.path, session.blockIndex);
      if (result.code !== 0) {
        runInAction(() => {
          session.status = 'error';
          session.message = result.message;
        });
        return false;
      }
      runInAction(() => {
        this.session = undefined;
      });
      await this.sourceAccept(session.path, result.data.text, result.data.hash);
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
    if (!session || !this.api) return false;
    if (session.status === 'submitting') return false;
    const text = session.textDraft.replace(/\r\n/g, '\n');
    if (text === session.textInitial) {
      runInAction(() => {
        this.session = undefined;
      });
      return true;
    }
    const model = this.docEditByPath[session.path]?.model;
    const source = this.sourceByPath[session.path];
    if (source?.status !== 'done' || !source.hash) {
      this.sessionFail('The document source is not loaded.');
      return false;
    }

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
    const result = await this.api.sourceApply(session.path, source.hash, operation);
    if (result.code !== 0) {
      runInAction(() => {
        session.status = 'error';
        session.message = result.code === -2 ? messageConflict : result.message || 'The edit was not applied.';
      });
      return false;
    }
    runInAction(() => {
      this.session = undefined;
      if (session.type === 'block') {
        this.blockTextPending = { path: session.path, blockIndex: session.blockIndex, text };
      }
    });
    await this.sourceAccept(session.path, result.data.text, result.data.hash);
    return true;
  }

  private sessionFail(message: string) {
    if (!this.session) return;
    this.session.status = 'error';
    this.session.message = message;
  }

  // ---------- insert menu and block creation ----------

  insertMenuIs(path: string, borderIndex: number): boolean {
    return this.insertMenu?.path === path && this.insertMenu.borderIndex === borderIndex;
  }

  async insertMenuOpen(path: string, borderIndex: number): Promise<boolean> {
    if (this.insertMenuIs(path, borderIndex)) return true;
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    runInAction(() => {
      this.deleteConfirm = undefined;
      this.insertMenu = { path, borderIndex, status: 'open', message: '' };
    });
    return true;
  }

  insertMenuClose() {
    if (this.insertMenu?.status === 'submitting') return;
    this.insertMenu = undefined;
  }

  // writes a new block (a template text) before block borderIndex and opens
  // it in edit mode once the document is compiled with it
  async blockCreate(path: string, borderIndex: number, text: string): Promise<boolean> {
    const menu = this.insertMenu;
    if (!menu || menu.path !== path || menu.borderIndex !== borderIndex || menu.status === 'submitting' || !this.api) {
      return false;
    }
    const model = this.docEditByPath[path]?.model;
    const source = this.sourceByPath[path];
    if (!model || source?.status !== 'done' || !source.hash) {
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
    const operation = blockInsertOperationBuild(model, borderIndex, text.replace(/\r\n/g, '\n'));
    const result = await this.api.sourceApply(path, source.hash, operation);
    if (result.code !== 0) {
      runInAction(() => {
        menu.status = 'error';
        menu.message = result.code === -2 ? messageConflict : result.message || 'The block was not created.';
      });
      return false;
    }
    await this.sourceAccept(path, result.data.text, result.data.hash);
    runInAction(() => {
      if (this.insertMenu === menu) this.insertMenu = undefined;
    });
    return this.sessionBlockStart(path, borderIndex, { isCreated: true });
  }

  // ---------- deletion ----------

  // borderIndex: index of the border (= index of the block below it) whose
  // button asked; defaults to the border above the block
  async deleteConfirmSet(path: string, blockIndex: number, borderIndex = blockIndex): Promise<boolean> {
    if (this.deleteConfirm?.status === 'submitting') return false;
    const isLeft = await this.sessionLeaveForIndexAction(path);
    if (!isLeft) return false;
    runInAction(() => {
      this.insertMenu = undefined;
      this.deleteConfirm = { path, blockIndex, borderIndex, status: 'confirming', message: '' };
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
    const result = await this.blockDeleteApply(path, blockIndex);
    if (result.code !== 0) {
      runInAction(() => {
        confirm.status = 'error';
        confirm.message = result.message;
      });
      return false;
    }
    runInAction(() => {
      this.deleteConfirm = undefined;
    });
    await this.sourceAccept(path, result.data.text, result.data.hash);
    return true;
  }

  // the delete operation of one block, shared by the confirmed deletion and
  // by canceling a created block. returns the api result.
  private async blockDeleteApply(path: string, blockIndex: number): Promise<{ code: number; data?: any; message: string }> {
    if (!this.api) return { code: -1, message: 'The edit api is not available.' };
    const model = this.docEditByPath[path]?.model;
    const source = this.sourceByPath[path];
    if (!model || source?.status !== 'done' || !source.hash || !model.blockList[blockIndex]) {
      return { code: -1, message: 'The block no longer exists.' };
    }
    const result = await this.api.sourceApply(path, source.hash, blockDeleteOperationBuild(model, blockIndex));
    if (result.code !== 0) {
      return { code: result.code, message: result.code === -2 ? messageConflict : result.message || 'The block was not deleted.' };
    }
    return result;
  }
}
