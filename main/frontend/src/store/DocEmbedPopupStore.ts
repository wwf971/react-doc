import { makeAutoObservable, observable, runInAction } from 'mobx';
import { embedPathBuild } from '../lib/doc-edit-embed.js';

// The popup of an MDX block (doc_page_impl_mdx_embed.md#the-popup): the
// document written in the block, read, or edited in edit mode. One per page,
// and the page's, not the block's: the block is drawn by its host document,
// which the page draws again on every write of that document, and every edit
// made in the popup is one. A popup the block owned would be drawn anew at
// each, taking the caret and the open session in it along (the reason the
// block popup is the page's too, doc_page_impl_popup.md#why-the-page-owns-it).
//
// the block asks for it (open) and keeps it current while it is open
// (update: its title and text as the host has them now, its line); the
// page draws it (DocEmbedPopup).
//
//   popup   the open popup, or undefined:
//     { key        the block that opened it (its component state key)
//       hostPath   the document the block is written in
//       line       the line of the block's marker (the embedded path)
//       title      what the marker says
//       raw        the text of the embedded document, as the block last drew it
//       Renderer   the renderer of the page: the document in View
//       mode       'view' | 'edit' }
export type EmbedPopup = {
  key: string;
  hostPath: string;
  line: number;
  title: string;
  raw: string;
  Renderer: any;
  mode: 'view' | 'edit';
};
type EmbedPopupContent = Pick<EmbedPopup, 'title' | 'raw' | 'line' | 'Renderer'>;

export class DocEmbedPopupStore {
  popup: EmbedPopup | undefined = undefined;
  isCopied = false;
  // the title being written: '' | 'saving' | 'error'
  titleStatus = '';
  titleMessage = '';
  editStore: any;

  constructor({ editStore }: { editStore: any }) {
    this.editStore = editStore;
    makeAutoObservable(this, { popup: observable.ref, editStore: false });
  }

  // the path of the embedded document shown (lib/doc-edit-embed.js)
  get path(): string {
    const popup = this.popup;
    return popup ? embedPathBuild(popup.hostPath, popup.line) : '';
  }

  isOpenFor(key: string): boolean {
    return Boolean(key) && this.popup?.key === key;
  }

  // '' when the document can be edited from the page, else why not
  get editReason(): string {
    const popup = this.popup;
    if (!popup) return '';
    if (!Number.isInteger(popup.line) || popup.line < 1) return 'the line of the block in its document is not known';
    if (this.editStore?.docIsEditable?.(popup.hostPath)) return '';
    return this.editStore?.isAvailable ? 'this document cannot be written from the page' : 'editing is available on the development server only';
  }

  // the popup shows the edit body: Edit chosen, and the page in edit mode
  get isEditShown(): boolean {
    return this.popup?.mode === 'edit' && this.editReason === '' && Boolean(this.editStore?.isEditMode);
  }

  // opened in Edit when the page is being edited and the document can be written
  open(entry: Omit<EmbedPopup, 'mode'>) {
    this.popup = { ...entry, mode: 'view' };
    if (this.editStore?.isEditMode && this.editReason === '') this.popup = { ...this.popup, mode: 'edit' };
    this.isCopied = false;
    this.titleStatus = '';
    this.titleMessage = '';
  }

  // the block drew itself again (the host was written): what it says now
  update(key: string, content: EmbedPopupContent) {
    const popup = this.popup;
    if (!popup || popup.key !== key) return;
    if (popup.title === content.title && popup.raw === content.raw && popup.line === content.line && popup.Renderer === content.Renderer) return;
    this.popup = { ...popup, ...content };
  }

  close() {
    this.popup = undefined;
  }

  // View, or Edit: the page goes into edit mode first, as its own switch would
  async modeSet(mode: 'view' | 'edit') {
    if (!this.popup) return;
    if (mode === 'edit') {
      if (this.editReason !== '') return;
      if (!this.editStore?.isEditMode) {
        const isOn = await this.editStore?.editModeSet?.(true);
        if (!isOn) return;
      }
    }
    runInAction(() => {
      if (this.popup) this.popup = { ...this.popup, mode };
    });
  }

  async copy() {
    const raw = this.popup?.raw ?? '';
    try {
      await navigator.clipboard.writeText(raw);
      runInAction(() => { this.isCopied = true; });
      setTimeout(() => runInAction(() => { this.isCopied = false; }), 1400);
    } catch {
      runInAction(() => { this.isCopied = false; });
    }
  }

  // the title written on the block's marker; '' removes it
  async titleSave(title: string) {
    const popup = this.popup;
    if (!popup || this.titleStatus === 'saving') return;
    this.titleStatus = 'saving';
    this.titleMessage = '';
    let result: any;
    try {
      result = await this.editStore.mdxEmbedTitleSet(popup.hostPath, popup.line, title);
    } catch (error: any) {
      result = { code: -1, message: String(error?.message ?? error) };
    }
    runInAction(() => {
      if (result?.code === 0) {
        this.titleStatus = '';
        if (this.popup?.key === popup.key) this.popup = { ...this.popup, title: String(result.data?.title ?? title) };
        return;
      }
      this.titleStatus = 'error';
      this.titleMessage = result?.message || 'The title was not written.';
    });
  }
}
