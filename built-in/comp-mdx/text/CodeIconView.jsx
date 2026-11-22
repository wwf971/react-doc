import { useMemo, useRef } from 'react';
import { computed, makeAutoObservable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Check, Copy, Eye, FileCode, History, LoaderCircle, Pencil, Upload, X } from '../../../main/frontend/UICommon.js';
import { PanelPopup } from '../../../main/comp-doc/popup/PanelPopup.jsx';
import { CodeEditor } from '../../../main/comp-doc/code-editor/CodeEditor.jsx';
import { EditActions } from '../../../main/comp-doc/edit/EditActions.jsx';
import { useCompStateStore } from '../../../main/comp-doc/registry/use-comp-state.js';
import { EDIT_POPUP_CLASS, useEditOutsidePointer } from '../../../main/comp-doc/edit/use-edit-outside-pointer.js';
import { useWheelContain } from '../../../main/comp-doc/popup/use-wheel-contain.js';
import { codeLangSearch } from '../../../main/comp-doc/code-editor/code-lang-list.js';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { useCodeLinesOpener } from '../../../main/comp-doc/code-editor/code-lines-open.js';
import './code-fence.css';

// The icon view of a code block (main/doc_page_impl_mdx_code.md#the-icon-view):
// the block stands as a square tile, a code icon over its title (or its
// language), and its lines open in a dialog when the tile is clicked:
//
//   ┌──────┐
//   │  ▤   │        a tile, square; the number of lines is said on hover
//   │a.py  │
//   └──────┘
//
// the dialog is a code editor (CodeEditor: line numbers, folding, the words
// colored by their language, a text too) with a View and an Edit mode
// (main/doc_page_impl_mdx_code.md#editing-the-lines):
//
//   setup.py                        sql [Copy] [👁 View | ✎ Edit]  [⤢] [×]     view
//   setup.py  [sql ▾] [✓ Save] [× Cancel] [👁 View | ✎ Edit]  [⤢] [×]       edit: the language and the actions in the header line
//
// it opens in Edit when the document is being edited and the lines can be
// written, else in View; Edit is greyed out, with the reason, where they
// cannot. In Edit the language is a field with the languages met most in a
// list below it (code-lang-list.js) and takes any word; the editor colors the
// draft by it at once. Save writes the lines and the language (onSave: into
// the fence of the document, or into the asset item of a block of Code) and
// goes back to View; a failed save stays in Edit with its message. Cancel
// drops the draft and goes back to View; Escape in the editor is Cancel, in
// View it closes the dialog; Ctrl/⌘ + S or Ctrl/⌘ + Enter saves.
//
// what the dialog holds (open, the mode, the draft, a save in flight) is kept
// by the component state layer under the block's key (stateConfig), not by
// this mount: a save rewrites the block, which mounts again, and the dialog
// stays as it was.
//
//   lang, title, lineCount   what the tile says
//   value                    the lines
//   place                    'listItem' when the block is a list item
//   stateConfig              { stateKey, compId }: the block, for the state layer
//   editReason               '' when the lines can be written here, else why not
//   isEditStart              the dialog opens in Edit (the document is being edited)
//   onSave(text, lang)       -> Promise<{ code, message }>; lang: the language of the
//                            draft, undefined when it did not change
//   assetMove                optional, a block whose lines are in the document:
//                            { reason, onMove() -> Promise<{ code, message, data: { itemId } }> }.
//                            the To asset button of the header, asked there first
//                            (doc_page_impl_mdx_code.md#the-lines-in-the-asset-service-layer);
//                            moved, the block is a block of Code reading the item,
//                            and its dialog is open where this one was
//   assetOpen                optional, a block whose lines are an item of the store:
//                            { onOpen() }: the Asset button, the asset panel of the
//                            item (its versions and history)
//   align                    'bottom' (default) | 'top': where the tile stands in
//                            the line of text it is in (CodeBlockIconAlign)
//
// the dialog opens from elsewhere too (codeLinesOpen of code-lines-open.js,
// under the key of the block, which the tile carries as data-code-key); a
// block of another view has the same dialog through CodeLinesDialogHost,
// drawn only while it is open.
//
// the header, in View and in Edit:
//
//   setup.py      sql [Copy] [⇧ To asset] [👁 View | ✎ Edit] [⤢] [×]      lines in the document
//   setup.py      sql [Copy] [⏱ Asset]    [👁 View | ✎ Edit] [⤢] [×]      lines in the asset store
//   setup.py      Move the lines into the asset store? [Move] [Keep] [👁 View | ✎ Edit] [⤢] [×]

const PANEL_ID = 'docCodeLines';
const LANG_TEXT_LIST = ['', 'text', 'txt', 'plaintext', 'plain'];

class CodeLinesStore {
  isOpen = false;
  mode = 'view';
  draft = '';
  langDraft = '';
  // the list of languages below the field: open, filtered by what was typed
  // (all of them while nothing was typed since it opened), the entry the keys are on
  langMenuIsOpen = false;
  langIsFiltered = false;
  langIndexActive = -1;
  status = 'idle';
  message = '';
  isCopied = false;
  // the move of the lines into the asset service layer: '' | 'confirming' | 'submitting' | 'error'
  assetMoveStatus = '';
  assetMoveMessage = '';

  constructor() {
    makeAutoObservable(this);
  }

  open(mode, value, lang) {
    this.isOpen = true;
    this.mode = mode;
    this.draft = value;
    this.langDraft = lang;
    this.status = 'idle';
    this.message = '';
    this.langMenuIsOpen = false;
  }

  close() {
    this.isOpen = false;
    this.mode = 'view';
    this.status = 'idle';
    this.message = '';
    this.langMenuIsOpen = false;
    if (this.assetMoveStatus !== 'submitting') this.assetMoveStatusSet('');
  }

  viewOpen() {
    this.isOpen = true;
    this.viewEnter();
  }

  assetMoveStatusSet(status, message = '') {
    this.assetMoveStatus = status;
    this.assetMoveMessage = message;
  }

  // the lines go into the asset service layer; the block becomes a block of
  // Code, which mounts with a state of its own (keyed by the item): its dialog
  // is opened there, so the author goes on where this one was
  async assetMove(assetMove, dialogNextOpen) {
    if (this.assetMoveStatus === 'submitting' || !assetMove?.onMove) return;
    this.assetMoveStatusSet('submitting');
    let result;
    try {
      result = await assetMove.onMove();
    } catch (error) {
      result = { code: -1, message: String(error?.message ?? error) };
    }
    runInAction(() => {
      if (result?.code !== 0) {
        this.assetMoveStatusSet('error', result?.message || 'The lines were not moved.');
        return;
      }
      this.assetMoveStatusSet('');
      if (result.data?.itemId) dialogNextOpen?.(result.data.itemId);
      this.isOpen = false;
      this.mode = 'view';
    });
  }


  editEnter(value, lang) {
    this.mode = 'edit';
    this.draft = value;
    this.langDraft = lang;
    this.status = 'idle';
    this.message = '';
  }

  viewEnter() {
    this.mode = 'view';
    this.status = 'idle';
    this.message = '';
    this.langMenuIsOpen = false;
  }

  langType(text) {
    this.langDraft = text;
    this.langMenuIsOpen = true;
    this.langIsFiltered = true;
    this.langIndexActive = -1;
  }

  langChoose(lang) {
    this.langDraft = lang;
    this.langMenuIsOpen = false;
  }

  langMenuOpenSet(isOpen) {
    this.langMenuIsOpen = isOpen;
    this.langIsFiltered = false;
    this.langIndexActive = -1;
  }

  langIndexActiveMove(step, count) {
    if (count === 0) return;
    this.langIndexActive = (this.langIndexActive + step + count) % count;
  }

  draftSet(text) {
    this.draft = text;
    if (this.status === 'error') this.status = 'idle';
  }

  copiedSet(isCopied) {
    this.isCopied = isCopied;
  }

  // langCurrent: the language the block has; the draft's is handed only when it differs
  async save(onSave, langCurrent) {
    if (this.status === 'saving' || !onSave) return;
    this.status = 'saving';
    this.message = '';
    this.langMenuIsOpen = false;
    const text = this.draft;
    const lang = this.langDraft.trim();
    let result;
    try {
      result = await onSave(text, lang !== '' && lang !== langCurrent ? lang : undefined);
    } catch (error) {
      result = { code: -1, message: String(error?.message ?? error) };
    }
    runInAction(() => {
      if (result?.code === 0) {
        this.mode = 'view';
        this.status = 'idle';
        return;
      }
      this.status = 'error';
      this.message = result?.message || 'The lines were not saved.';
    });
  }
}

export const CodeIconView = observer(function CodeIconView(props) {
  const {
    lang = '', title = '', lineCount, place, value = '', stateConfig, editReason = 'the lines cannot be written here', isEditStart = false, align = 'bottom',
  } = props;
  const store = useCompStateStore(stateConfig ?? {}, 'codeLines', () => new CodeLinesStore());
  const isText = LANG_TEXT_LIST.includes(String(lang).toLowerCase());
  const label = title || (isText ? 'text' : lang);
  const countText = lineCount > 0 ? `${lineCount} line${lineCount === 1 ? '' : 's'}` : '';
  const isEditable = editReason === '';
  const open = () => store.open(isEditStart && isEditable ? 'edit' : 'view', value, lang);
  useCodeLinesOpener(stateConfig?.stateKey, open);
  return (
    <>
      <button
        type="button"
        className="doc-code-icon not-prose"
        data-place={place || undefined}
        data-align={align}
        data-code-key={stateConfig?.stateKey || undefined}
        title={`${title || (isText ? 'Text' : `Code · ${lang}`)}${countText ? ` · ${countText}` : ''}: click to show${isEditable ? ' or edit' : ''} the lines`}
        aria-label={`${label}${countText ? `, ${countText}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={store.isOpen}
        onClick={open}
      >
        <span className="doc-code-icon-glyph"><FileCode aria-hidden="true" size={20} strokeWidth={1.7} /></span>
        <span className="doc-code-icon-label">{label}</span>
      </button>
      <CodeLinesDialog {...props} store={store} />
    </>
  );
});

// The dialog of a code block drawn in another view (card, plain): nothing is
// drawn, and no state is kept, until something opens it (codeLinesOpen: a
// double click on the chip of the block in the editor of a list item). the
// props are those of CodeIconView.
export const CodeLinesDialogHost = observer(function CodeLinesDialogHost(props) {
  const { compStateStore } = useDocStores();
  const { lang = '', value = '', stateConfig, editReason = 'the lines cannot be written here', isEditStart = false } = props;
  const key = stateConfig?.stateKey;
  useCodeLinesOpener(key, () => {
    const state = compStateStore?.stateEnsure(`${key}|codeLines`, { initial: () => new CodeLinesStore(), compId: stateConfig?.compId ?? '' });
    state?.value?.open?.(isEditStart && editReason === '' ? 'edit' : 'view', value, lang);
  });
  // whether its dialog is open, as a computed value: the state layer gets an
  // entry whenever a component makes its state, during a render of its own (an
  // icon taking the place of this block's view), and this host is drawn again
  // only when the answer changes, never during that render
  const isOpenValue = useMemo(
    () => computed(() => Boolean(key && compStateStore?.stateGet(`${key}|codeLines`)?.value?.isOpen)),
    [compStateStore, key],
  );
  if (!isOpenValue.get()) return null;
  return <CodeLinesDialogHeld {...props} />;
});

// the dialog while it is open: the state held by this mount
const CodeLinesDialogHeld = observer(function CodeLinesDialogHeld(props) {
  const store = useCompStateStore(props.stateConfig ?? {}, 'codeLines', () => new CodeLinesStore());
  return <CodeLinesDialog {...props} store={store} />;
});

// the dialog of the lines: View and Edit, the language, Copy, To asset / Asset
const CodeLinesDialog = observer(function CodeLinesDialog(props) {
  // closed, the dialog draws nothing: its header is not built for every tile of the page
  if (!props.store.isOpen) return null;
  return <CodeLinesDialogOpen {...props} />;
});

const CodeLinesDialogOpen = observer(function CodeLinesDialogOpen({
  store, lang = '', title = '', value = '', editReason = 'the lines cannot be written here', onSave, assetMove, assetOpen,
}) {
  const { compStateStore } = useDocStores();
  const isText = LANG_TEXT_LIST.includes(String(lang).toLowerCase());
  const isEditable = editReason === '';
  const isEdit = store.mode === 'edit';
  const langShown = isEdit ? store.langDraft : lang;
  const isDirty = isEdit && (store.draft !== value || (store.langDraft.trim() !== '' && store.langDraft.trim() !== lang));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      store.copiedSet(true);
      setTimeout(() => store.copiedSet(false), 1400);
    } catch {
      store.copiedSet(false);
    }
  };
  const cancel = () => store.viewEnter();
  const save = () => void store.save(onSave, lang);
  // the dialog of the block of Code the lines became, open in View (its state
  // is keyed by the item: compStateKeyBuild). the block may have mounted
  // already, with a state of its own: that one is opened
  const dialogNextOpen = (itemId) => {
    const state = compStateStore?.stateEnsure(`asset:local/${itemId}|codeLines`, { initial: () => new CodeLinesStore(), compId: 'common/Code' });
    state?.value?.viewOpen?.();
  };
  const assetReason = assetMove ? (assetMove.reason || (isDirty ? 'save or cancel the changes of the lines first' : '')) : '';
  const isAssetMoveAsked = store.assetMoveStatus === 'confirming' || store.assetMoveStatus === 'submitting';
  const assetControl = isAssetMoveAsked ? (
    <span className="doc-code-lines-confirm" role="alertdialog" aria-label="Move the lines into the asset service layer?">
      <span>Move the lines into the asset store?</span>
      <button type="button" className="doc-button" disabled={store.assetMoveStatus === 'submitting'}
        onClick={() => void store.assetMove(assetMove, dialogNextOpen)}>
        {store.assetMoveStatus === 'submitting'
          ? <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-spin" />
          : <Upload aria-hidden="true" size={12} strokeWidth={2.2} />}
        <span>Move</span>
      </button>
      <button type="button" className="doc-button" disabled={store.assetMoveStatus === 'submitting'} onClick={() => store.assetMoveStatusSet('')}>
        <X aria-hidden="true" size={12} strokeWidth={2.2} />
        <span>Keep</span>
      </button>
    </span>
  ) : assetMove ? (
    <button type="button" className="doc-button" disabled={assetReason !== ''}
      title={assetReason || 'Move the lines into the asset service layer: the block becomes a block of Code reading them, versioned there'}
      onClick={() => store.assetMoveStatusSet('confirming')}>
      <Upload aria-hidden="true" size={12} strokeWidth={2.2} />
      <span>To asset</span>
    </button>
  ) : assetOpen ? (
    <button type="button" className="doc-button" title="Asset: the item the lines are, its versions and history" onClick={() => assetOpen.onOpen()}>
      <History aria-hidden="true" size={12} strokeWidth={2.2} />
      <span>Asset</span>
    </button>
  ) : null;

  const headerRightContent = (
    <span className="doc-block-popup-head doc-code-lines-head not-prose">
      {isEdit ? <CodeLangField store={store} /> : <span className="doc-code-lines-lang" title="the language of the lines">{lang || 'text'}</span>}
      {isEdit ? (
        <EditActions
          status={store.status === 'saving' ? 'submitting' : store.status === 'error' ? 'error' : 'editing'}
          message={store.message}
          isSubmitDisabled={!isDirty}
          titleCancel="Cancel: drop the changes and show the lines (Esc)"
          onSubmit={save}
          onCancel={cancel}
        />
      ) : (
        <button type="button" className="doc-button" title="Copy the lines" onClick={() => void copy()}>
          {store.isCopied ? <Check aria-hidden="true" size={12} strokeWidth={2.2} /> : <Copy aria-hidden="true" size={12} strokeWidth={2.2} />}
          <span>{store.isCopied ? 'Copied' : 'Copy'}</span>
        </button>
      )}
      {assetControl}
      {store.assetMoveStatus === 'error' ? (
        <span className="doc-error doc-code-lines-message" role="alert" title={store.assetMoveMessage}>{store.assetMoveMessage}</span>
      ) : null}
      <span className="doc-edit-segment" role="group" aria-label="Mode">
        <button type="button" className={isEdit ? undefined : 'is-active'} aria-pressed={!isEdit}
          title={isDirty ? 'View: the changes not saved are dropped' : 'View the lines'} onClick={cancel}>
          <Eye aria-hidden="true" size={12} strokeWidth={2.2} />
          <span>View</span>
        </button>
        <button type="button" className={isEdit ? 'is-active' : undefined} aria-pressed={isEdit}
          disabled={!isEditable} title={isEditable ? 'Edit the lines' : editReason}
          onClick={() => { if (!isEdit) store.editEnter(value, lang); }}>
          <Pencil aria-hidden="true" size={12} strokeWidth={2.2} />
          <span>Edit</span>
        </button>
      </span>
    </span>
  );

  return (
    <PanelPopup
      panelId={PANEL_ID}
      title={title || (isText ? 'Text' : `Code · ${lang}`)}
      isOpen={store.isOpen}
      onClose={() => store.close()}
      headerRightContent={headerRightContent}
      // a popup of the edit layer: a click in it is not a click on the block it belongs to
      className={`doc-code-lines-popup ${EDIT_POPUP_CLASS}`}
      bodyClassName="doc-code-lines-body"
    >
      <CodeEditor
        value={isEdit ? store.draft : value}
        lang={langShown}
        isReadOnly={!isEdit}
        label={title || lang || 'Lines'}
        onChange={(text) => store.draftSet(text)}
        onSave={isEdit ? save : undefined}
        onCancel={isEdit ? cancel : undefined}
      />
    </PanelPopup>
  );
});

// the language of the draft: a field taking any word, with the languages met
// most listed below it (all of them when it opens, those matching what is
// typed after); ArrowDown / ArrowUp move in the list, Enter takes the entry the
// keys are on (or keeps what is typed), Escape closes the list, a pointer
// going down outside it closes it too
const CodeLangField = observer(function CodeLangField({ store }) {
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const isOpen = store.langMenuIsOpen;
  useEditOutsidePointer(rootRef, isOpen, () => store.langMenuOpenSet(false));
  useWheelContain(listRef, isOpen);
  const langList = codeLangSearch(store.langIsFiltered ? store.langDraft : '');
  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) store.langMenuOpenSet(true);
      store.langIndexActiveMove(event.key === 'ArrowDown' ? 1 : -1, langList.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = langList[store.langIndexActive];
      if (chosen) store.langChoose(chosen.id);
      else store.langMenuOpenSet(false);
      return;
    }
    // the list closes first; the dialog is not left by this Escape
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      store.langMenuOpenSet(false);
    }
  };
  return (
    <span ref={rootRef} className="doc-code-lang-field">
      <input
        type="text"
        className="doc-code-lang-input"
        value={store.langDraft}
        placeholder="language"
        aria-label="The language of the lines"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        spellCheck={false}
        onFocus={() => store.langMenuOpenSet(true)}
        onClick={() => { if (!isOpen) store.langMenuOpenSet(true); }}
        onChange={(event) => store.langType(event.target.value)}
        onKeyDown={keyDownHandle}
      />
      {isOpen ? (
        <span ref={listRef} className="doc-search-result-list doc-code-lang-list" role="listbox" aria-label="Languages">
          {langList.length === 0 ? (
            <span className="doc-search-none">“{store.langDraft.trim()}”: not in the list, written as typed</span>
          ) : langList.map((entry, index) => (
            <span
              key={entry.id}
              className="doc-search-result doc-code-lang-option"
              role="option"
              aria-selected={index === store.langIndexActive}
              data-active={index === store.langIndexActive ? '' : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => store.langChoose(entry.id)}
            >
              <span className="doc-search-result-name">{entry.label}</span>
              <span className="doc-search-result-label">{entry.id}</span>
              {entry.id === store.langDraft.trim() ? <Check aria-hidden="true" size={12} strokeWidth={2.2} className="doc-code-lang-current" /> : null}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
});

// the text of the highlighted children of a <pre> (the spans of its lines and
// the line breaks between them), without the last line break
export function codeTextFromChildren(children) {
  const partList = [];
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') {
      partList.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object' && node.props) walk(node.props.children);
  };
  walk(children);
  return partList.join('').replace(/\n$/, '');
}
