import { makeAutoObservable, observable, reaction } from 'mobx';
import type { DocStore } from './DocStore.js';
import type { DocEditStore } from './DocEditStore.js';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocAssetStore } from './DocAssetStore.js';
import { compIdResolve } from '../../../comp-doc/registry/comp-registry.js';
import { COMP_EDIT_MODE_SOURCE_ID } from '../../../comp-doc/registry/comp-expose.js';

// The block popup (design: doc_page_impl_popup.md): one component block of
// the document shown in a popup dialog, in View or in Edit, opened from the
// block. A component opts in by rendering itself inside BlockPopupSurface;
// this store owns everything else, the same for every component:
//
//   popup          the open popup, or undefined. one at a time.
//     key          the block's identity: document, marker line, component
//     path         the document of the block
//     sourceLine   the line of the block's marker comment (DocComp sourceLine)
//     compId       the component of the block
//     title        the dialog title
//     assetInfo    where the block's data comes from (RegisteredComp assetInfo)
//     isExpanded   maximized to the window
//     heightInline the height the block had in the page, kept as a
//                  placeholder there while it is in the popup
//     generation   increases with every open and close: an Edit entry that
//                  started for an earlier popup does nothing when it ends
//     transition   'idle' | 'entering' | 'leaving' | 'canceling': one change
//                  of mode at a time
//     message      why the last change of mode failed
//   surfaceList    the surfaces on the page; the last one registered under
//                  the popup's key is the one shown in it (the view surface
//                  and the edit surface of a block replace each other)
//   slotElement    where the popup puts the active surface (its content)
//   floatElement   where the floating bar of the block's editor goes (its header)
//
// the mode is not stored: it is Edit while the edit layer has the block open
// in one of its component's edit modes (DocEditStore.session), View
// otherwise. Edit opens the block's session, View leaves it (the draft is
// saved), Cancel drops it; persistence is the edit layer's.
export type BlockPopupTransition = 'idle' | 'entering' | 'leaving' | 'canceling';

export type BlockPopup = {
  key: string;
  path: string;
  sourceLine: number;
  compId: string;
  title: string;
  assetInfo: any;
  isExpanded: boolean;
  heightInline: number;
  generation: number;
  transition: BlockPopupTransition;
  message: string;
};

export type BlockPopupOpenRequest = {
  path: string;
  sourceLine: number;
  compId: string;
  title: string;
  assetInfo?: any;
  heightInline?: number;
};

export type BlockPopupEditState = {
  // the View / Edit switch is shown: the page can edit documents
  isOffered: boolean;
  isEnabled: boolean;
  // why Edit is disabled
  reason: string;
};

type BlockPopupStores = {
  docStore: Pick<DocStore, 'docCurrentPath'>;
  editStore: DocEditStore;
  sourceStore: Pick<DocSourceStore, 'configDoc'>;
  assetStore?: Pick<DocAssetStore, 'isWritable' | 'writeUnavailableReason'>;
};

export function blockPopupKeyBuild(path: string, sourceLine: number, compId: string): string {
  return `${path}#${sourceLine}#${compId}`;
}

export class DocBlockPopupStore {
  popup: BlockPopup | undefined = undefined;
  surfaceList: { token: number; key: string }[] = [];
  slotElement: HTMLElement | null = null;
  floatElement: HTMLElement | null = null;
  stores: BlockPopupStores;
  generationLast = 0;
  surfaceTokenLast = 0;
  reactionDispose: (() => void) | undefined;

  constructor(stores: BlockPopupStores) {
    this.stores = stores;
    makeAutoObservable(this, {
      stores: false,
      generationLast: false,
      surfaceTokenLast: false,
      reactionDispose: false,
      slotElement: observable.ref,
      floatElement: observable.ref,
    });
  }

  init() {
    // another page: the popup closes, an Edit entry in flight is dropped
    this.reactionDispose = reaction(
      () => this.stores.docStore.docCurrentPath,
      () => this.closeForce(),
    );
  }

  dispose() {
    this.reactionDispose?.();
    this.reactionDispose = undefined;
  }

  // ---------- open and close ----------

  get isOpen(): boolean {
    return this.popup !== undefined;
  }

  isOpenFor(key: string): boolean {
    return this.popup?.key === key;
  }

  open(request: BlockPopupOpenRequest) {
    if (this.popup) return;
    this.generationLast += 1;
    this.popup = {
      key: blockPopupKeyBuild(request.path, request.sourceLine, request.compId),
      path: request.path,
      sourceLine: request.sourceLine,
      compId: request.compId,
      title: request.title,
      assetInfo: request.assetInfo,
      isExpanded: false,
      heightInline: request.heightInline ?? 0,
      generation: this.generationLast,
      transition: 'idle',
      message: '',
    };
  }

  // the block returns to its place in the page as it is: an open session
  // stays open there, neither saved nor dropped. refused while a change of
  // mode or a save is running.
  close(): boolean {
    if (!this.popup) return true;
    if (this.isBusy) return false;
    this.closeForce();
    return true;
  }

  private closeForce() {
    if (!this.popup) return;
    this.generationLast += 1;
    this.popup = undefined;
  }

  expandedSet(isExpanded: boolean) {
    if (this.popup) this.popup.isExpanded = isExpanded;
  }

  // ---------- surfaces ----------

  surfaceRegister(key: string): number {
    this.surfaceTokenLast += 1;
    this.surfaceList.push({ token: this.surfaceTokenLast, key });
    return this.surfaceTokenLast;
  }

  surfaceUnregister(token: number) {
    this.surfaceList = this.surfaceList.filter((surface) => surface.token !== token);
  }

  // the surface that the popup shows: the last one registered under its key
  get surfaceActiveToken(): number | undefined {
    const key = this.popup?.key;
    if (key === undefined) return undefined;
    for (let index = this.surfaceList.length - 1; index >= 0; index -= 1) {
      if (this.surfaceList[index].key === key) return this.surfaceList[index].token;
    }
    return undefined;
  }

  surfaceIsInPopup(token: number): boolean {
    return this.slotElement !== null && this.surfaceActiveToken === token;
  }

  slotElementSet(element: HTMLElement | null) {
    this.slotElement = element;
  }

  floatElementSet(element: HTMLElement | null) {
    this.floatElement = element;
  }

  // ---------- mode ----------

  // the index of the popup's block in the edit model of its document;
  // undefined while the model is not loaded or the block is gone
  blockIndexGet(): number | undefined {
    const popup = this.popup;
    if (!popup) return undefined;
    const model = this.stores.editStore.docEditGet(popup.path)?.model;
    if (!model) return undefined;
    const configDoc = this.stores.sourceStore.configDoc;
    const index = model.blockList.findIndex((block: any) => (
      block.component?.markerLine === popup.sourceLine
      && compIdResolve(configDoc, String(block.component.compName ?? '')) === popup.compId
    ));
    return index < 0 ? undefined : index;
  }

  get mode(): 'view' | 'edit' {
    const popup = this.popup;
    const session = this.stores.editStore.session;
    if (!popup || !session || session.type !== 'block' || session.path !== popup.path) return 'view';
    if (session.editModeId === COMP_EDIT_MODE_SOURCE_ID) return 'view';
    return session.blockIndex === this.blockIndexGet() ? 'edit' : 'view';
  }

  // a change of mode, or a save of the session, is running
  get isBusy(): boolean {
    if (!this.popup) return false;
    if (this.popup.transition !== 'idle') return true;
    return this.mode === 'edit' && this.stores.editStore.session?.status === 'submitting';
  }

  // whether Edit can be chosen, and why not. before the edit model of the
  // document is loaded, what the block's data allows is judged from where
  // it comes from; entering Edit checks the block's edit modes again.
  get editState(): BlockPopupEditState {
    const popup = this.popup;
    const editStore = this.stores.editStore;
    if (!popup || !editStore.isAvailable) return { isOffered: false, isEnabled: false, reason: '' };
    if (popup.path !== this.stores.docStore.docCurrentPath || !editStore.docIsEditable(popup.path)) {
      return { isOffered: true, isEnabled: false, reason: 'This document cannot be edited here.' };
    }
    const blockIndex = this.blockIndexGet();
    if (blockIndex !== undefined) {
      const reason = this.editModeReasonGet(popup.path, blockIndex);
      return { isOffered: true, isEnabled: reason === '', reason };
    }
    const assetInfo = popup.assetInfo;
    if (assetInfo?.isFromAsset) {
      let reason = '';
      if (!this.stores.assetStore?.isWritable) reason = this.stores.assetStore?.writeUnavailableReason || 'The page has no asset store.';
      else if (assetInfo.isLocked) reason = 'The asset is locked.';
      else if (assetInfo.isHead === false) reason = 'The block reads a version other than the head; a save writes the head.';
      return { isOffered: true, isEnabled: reason === '', reason };
    }
    return { isOffered: true, isEnabled: true, reason: '' };
  }

  // '' when the block has an enabled edit mode of its component, else why not
  private editModeReasonGet(path: string, blockIndex: number): string {
    const modeList = this.stores.editStore.blockEditModeListGet(path, blockIndex)
      .filter((mode) => mode.id !== COMP_EDIT_MODE_SOURCE_ID);
    if (modeList.some((mode) => !mode.isDisabled)) return '';
    return modeList.find((mode) => mode.disabledReason)?.disabledReason || 'The block has no editor of its own.';
  }

  // Edit: the document goes into edit mode when it is not, its edit model is
  // loaded, and the block opens in its component's default edit mode
  async editEnter(): Promise<boolean> {
    const popup = this.popup;
    if (!popup || this.isBusy || this.mode === 'edit' || !this.editState.isEnabled) return false;
    const { editStore } = this.stores;
    const generation = popup.generation;
    const isCurrent = () => this.popup?.generation === generation;
    this.transitionSet('entering', '');

    if (!editStore.isEditMode) {
      const isEditMode = await editStore.editModeSet(true);
      if (!isCurrent()) return false;
      if (!isEditMode) return this.transitionFail('The document could not enter edit mode.');
    }
    await editStore.docEditEnsure(popup.path);
    if (!isCurrent()) return false;
    const blockIndex = this.blockIndexGet();
    if (blockIndex === undefined) {
      return this.transitionFail(editStore.docEditGet(popup.path)?.message || 'The block is no longer in the document.');
    }
    const reason = this.editModeReasonGet(popup.path, blockIndex);
    if (reason) return this.transitionFail(reason);
    const modeList = editStore.blockEditModeListGet(popup.path, blockIndex)
      .filter((mode) => mode.id !== COMP_EDIT_MODE_SOURCE_ID && !mode.isDisabled);
    const mode = modeList.find((modeOne) => modeOne.isDefault) ?? modeList[0];
    const isStarted = await editStore.sessionBlockStart(popup.path, blockIndex, { editModeId: mode.id });
    if (!isCurrent()) return false;
    if (!isStarted) {
      return this.transitionFail(editStore.session?.message || 'The block could not be opened for editing.');
    }
    this.transitionSet('idle', '');
    return true;
  }

  // View: the session is left, saving the draft (the editor completes it
  // first, DocEditStore.sessionSubmitPrepareSet). a failed save stays in
  // Edit; the editor's bar shows why.
  async viewEnter(): Promise<boolean> {
    const popup = this.popup;
    if (!popup || this.isBusy || this.mode !== 'edit') return false;
    const generation = popup.generation;
    this.transitionSet('leaving', '');
    const isLeft = await this.stores.editStore.sessionLeave();
    if (this.popup?.generation !== generation) return isLeft;
    this.transitionSet('idle', '');
    return isLeft;
  }

  // Cancel: the session's draft is dropped, the popup shows View
  async editCancel(): Promise<boolean> {
    const popup = this.popup;
    if (!popup || this.isBusy || this.mode !== 'edit') return false;
    const generation = popup.generation;
    this.transitionSet('canceling', '');
    const isCanceled = await this.stores.editStore.sessionCancel();
    if (this.popup?.generation !== generation) return isCanceled;
    this.transitionSet('idle', '');
    return isCanceled;
  }

  private transitionSet(transition: BlockPopupTransition, message: string) {
    if (!this.popup) return;
    this.popup.transition = transition;
    this.popup.message = message;
  }

  private transitionFail(message: string): false {
    this.transitionSet('idle', message);
    return false;
  }
}
