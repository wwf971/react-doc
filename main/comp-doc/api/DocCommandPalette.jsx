import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { SquareTerminal } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { compIconDefault } from '../registry/comp-icon.jsx';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import { SourcePathInput } from '../source/SourcePathInput.jsx';
import './DocApi.css';

// The command palette (design: doc_page_impl_api_command_palette.md): a
// popover at the top of the window, as in VS Code, with a field and the
// apis the registry lists for it (DocPaletteStore.itemList). Typing
// narrows the list; ArrowUp / ArrowDown move the highlight; Enter or a
// click runs the highlighted api and closes the palette; Escape and a
// pointer going down outside close it. An api that cannot run now is
// greyed out with its reason as its hover title and stays where it is, so
// the list does not jump as the page changes.
//
// an api with parameters opens the params step in the same popover
// (DocPaletteStore.step): one field per parameter, read by its type (a
// choice for a boolean or a valueList, a path with completion for a source
// path, a text otherwise); Enter runs when the fields read and check (what
// does not is said under them, in a line that is always there, so the form
// never moves), Escape goes back to the list. an api whose params are all
// optional runs on Enter at once, with its defaults.
//
// the palette renders the state of the store and nothing else: it has one
// fixed width, and its list has a fixed maximum height and scrolls, so the
// popover never changes size while the reader types.
export const DocCommandPalette = observer(function DocCommandPalette() {
  const { paletteStore } = useDocStores();
  if (!paletteStore.isOpen) return null;
  return createPortal(<DocCommandPaletteOpen />, document.body);
});

const DocCommandPaletteOpen = observer(function DocCommandPaletteOpen() {
  const { paletteStore } = useDocStores();
  const rootRef = useRef(null);
  const isParamsStep = paletteStore.step === 'params';

  // a pointer going down outside closes the palette (a click in it keeps
  // the field focused: the items prevent the pointer down). the completion
  // list of a path field is rendered outside, into the body: a pointer
  // there is a choice in the field, not a click outside
  useEffect(() => {
    const pointerDownHandle = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest('.doc-source-path-list')) return;
      paletteStore.close();
    };
    document.addEventListener('pointerdown', pointerDownHandle, true);
    return () => document.removeEventListener('pointerdown', pointerDownHandle, true);
  }, [paletteStore]);

  // a field that blurs to nowhere (a path field commits on Enter and leaves
  // the focus on the body) hands the focus to the popover itself, so the
  // keys of the palette keep working
  const blurHandle = (event) => {
    if (event.relatedTarget) return;
    const root = rootRef.current;
    requestAnimationFrame(() => {
      if (root && root.isConnected && document.activeElement === document.body) root.focus();
    });
  };

  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (isParamsStep) {
      // Enter in a path field is the field's first (it takes the entry
      // highlighted in its completion list, or commits the text); it runs
      // the api when nothing was highlighted. Enter on a choice button runs
      // as well (Space or a click presses the button), so an api whose
      // params are all optional runs on Enter wherever the focus is
      if (event.key === 'Enter') {
        if (document.querySelector('.doc-source-path-list [data-active]')) return;
        event.preventDefault();
        const fieldBefore = event.target;
        void paletteStore.paramsRun();
        // the fields did not read or check: the step stays, and the field
        // the reader was in keeps the focus (a path field leaves it on Enter)
        if (paletteStore.step === 'params' && fieldBefore instanceof HTMLElement && fieldBefore.isConnected) fieldBefore.focus();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (event.defaultPrevented && event.target instanceof Element && event.target.closest('.doc-source-path-input')) return;
        paletteStore.paramsBack();
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      paletteStore.itemActiveMove(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      paletteStore.itemActiveMove(event.key === 'PageDown' ? 8 : -8);
      return;
    }
    if (event.key === 'Home' && event.ctrlKey) {
      event.preventDefault();
      paletteStore.itemActiveSet(0);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void paletteStore.choose();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      paletteStore.close();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`doc-palette doc-popover not-prose ${EDIT_POPUP_CLASS}`}
      role="dialog"
      aria-label="Command palette"
      tabIndex={-1}
      onKeyDown={keyDownHandle}
      onBlur={blurHandle}
    >
      {isParamsStep ? <PaletteParams /> : <PaletteList />}
    </div>
  );
});

// ---------- the list step ----------

const PaletteList = observer(function PaletteList() {
  const { paletteStore } = useDocStores();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const itemList = paletteStore.itemList;
  const indexActive = paletteStore.itemIndexActive;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // the highlighted item stays in view
  useEffect(() => {
    const element = listRef.current?.querySelector('[data-active]');
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [indexActive, itemList.length]);

  const queryTrim = paletteStore.query.trim().toLowerCase();
  return (
    <>
      <div className="doc-palette-field">
        <SquareTerminal className="doc-palette-field-icon" size={13} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className="doc-palette-input"
          value={paletteStore.query}
          placeholder="Type a command"
          aria-label="Command"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          spellCheck={false}
          onChange={(event) => paletteStore.querySet(event.target.value)}
        />
        <span className="doc-palette-count">{itemList.length}</span>
      </div>
      <div ref={listRef} className="doc-palette-list" role="listbox" aria-label="Commands">
        {itemList.length === 0 ? (
          <div className="doc-palette-none">{queryTrim === '' ? 'No command is listed.' : `Nothing matches “${paletteStore.query.trim()}”.`}</div>
        ) : itemList.map((item, index) => {
          const Icon = item.icon ?? compIconDefault;
          return (
            <div
              key={item.id}
              className="doc-palette-item"
              role="option"
              aria-selected={index === indexActive}
              aria-disabled={!item.isAvailable || undefined}
              data-active={index === indexActive ? '' : undefined}
              data-disabled={item.isAvailable ? undefined : ''}
              title={item.isAvailable ? item.id : `${item.reason} (${item.id})`}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => paletteStore.itemActiveSet(index)}
              onClick={() => void paletteStore.choose(index)}
            >
              <Icon className="doc-palette-item-icon" size={13} aria-hidden="true" />
              <span className="doc-palette-item-label">
                {item.category ? <span className="doc-palette-item-category">{textHighlight(item.category, queryTrim)}: </span> : null}
                {textHighlight(item.label, queryTrim)}
                {item.isParamAsked ? <span className="doc-palette-item-more" title="asks for parameters">…</span> : null}
              </span>
              {item.description ? <span className="doc-palette-item-description">{item.description}</span> : null}
              {item.isRecent && queryTrim === '' ? <span className="doc-palette-item-recent">recently used</span> : null}
              {item.hotkey ? <kbd className="doc-palette-item-key">{item.hotkey}</kbd> : null}
            </div>
          );
        })}
      </div>
      <div className="doc-palette-hint">↑ ↓ move · Enter run · Esc close</div>
    </>
  );
});

// ---------- the params step ----------

const PaletteParams = observer(function PaletteParams() {
  const { paletteStore, docStore } = useDocStores();
  const formRef = useRef(null);
  const definition = paletteStore.definitionParams;
  const paramItemList = paletteStore.paramItemList;

  // the first field takes the focus
  useEffect(() => {
    const first = formRef.current?.querySelector('input, [contenteditable]:not([contenteditable="false"]), button');
    first?.focus?.();
  }, []);

  if (!definition) return null;
  const Icon = definition.icon ?? compIconDefault;
  const hint = paletteStore.isParamRequiredAny
    ? 'Enter run · Esc back · Tab next field · * required'
    : 'Enter run (every parameter is optional: Enter at once runs with the defaults) · Esc back';
  return (
    <>
      <div className="doc-palette-params-head">
        <Icon className="doc-palette-item-icon" size={13} aria-hidden="true" />
        <span className="doc-palette-params-title">
          {definition.category ? <span className="doc-palette-item-category">{definition.category}: </span> : null}
          {definition.label}
        </span>
        <span className="doc-palette-item-description" title={definition.id}>{definition.description || definition.id}</span>
      </div>
      <div ref={formRef} className="doc-palette-params" role="group" aria-label={`Parameters of ${definition.label}`}>
        {paramItemList.map((param) => (
          <div key={param.name} className="doc-palette-param">
            <label className="doc-palette-param-name" htmlFor={`doc-palette-param-${param.name}`} title={param.type}>
              {param.name}
              {param.isRequired ? <span className="doc-palette-param-required" aria-label="required">*</span> : null}
              <span className="doc-palette-param-type">{param.type}</span>
            </label>
            <ParamControl param={param} docPageAlias={docStore.docPageCurrentAlias ?? ''} />
            {param.description || param.valueDefault !== undefined ? (
              <span className="doc-palette-param-description">
                {param.description}
                {param.valueDefault !== undefined ? ` (default ${JSON.stringify(param.valueDefault)})` : ''}
              </span>
            ) : null}
          </div>
        ))}
        <p className="doc-note doc-palette-params-message" data-error={paletteStore.paramMessage ? '' : undefined} role="alert">
          {paletteStore.paramMessage || ' '}
        </p>
      </div>
      <div className="doc-palette-hint">{hint}</div>
    </>
  );
});

// one parameter's field, by its type: a choice of buttons for a boolean or
// a valueList (the pressed one is the value; pressing it again clears it),
// a path with completion for a source path, a text otherwise (JSON for a
// mapping or a list)
const ParamControl = observer(function ParamControl({ param, docPageAlias }) {
  const { paletteStore } = useDocStores();
  const inputId = `doc-palette-param-${param.name}`;
  const choiceList = param.type === 'boolean' ? ['true', 'false'] : param.valueList?.map((value) => String(value));
  if (choiceList) {
    return (
      <span className="doc-palette-param-choice" id={inputId} role="group">
        {choiceList.map((choice) => (
          <button
            key={choice}
            type="button"
            className="doc-button-dialog"
            aria-pressed={param.text === choice}
            onClick={() => paletteStore.paramTextSet(param.name, param.text === choice ? '' : choice)}
          >
            {choice}
          </button>
        ))}
      </span>
    );
  }
  if (param.type === 'sourcePath') {
    return (
      <SourcePathInput
        className="doc-palette-param-path"
        value={param.text}
        spec={param.pathSpec ?? { kind: 'any' }}
        placeholder={param.pathSpec?.kind === 'dir' ? '~page:root/dir' : '~page:root/dir/file.md'}
        docPageAlias={docPageAlias}
        onChange={(text) => paletteStore.paramTextSet(param.name, text)}
        onCommit={(text) => paletteStore.paramTextSet(param.name, text)}
      />
    );
  }
  const placeholder = param.type === 'object' ? '{ "key": value }' : param.type === 'list' ? '[ ... ]' : param.type === 'number' ? '0' : '';
  return (
    <input
      id={inputId}
      type="text"
      className="doc-palette-param-input"
      value={param.text}
      placeholder={placeholder}
      inputMode={param.type === 'number' ? 'decimal' : undefined}
      spellCheck={false}
      onChange={(event) => paletteStore.paramTextSet(param.name, event.target.value)}
    />
  );
});

// the first word of the query marked in a text
function textHighlight(text, queryLower) {
  const word = queryLower.split(/\s+/)[0] ?? '';
  if (word === '') return text;
  const textLower = text.toLowerCase();
  const partList = [];
  let indexStart = 0;
  let indexMatch = textLower.indexOf(word);
  while (indexMatch !== -1) {
    if (indexMatch > indexStart) partList.push(text.slice(indexStart, indexMatch));
    const indexEnd = indexMatch + word.length;
    partList.push(<mark key={indexMatch} className="doc-palette-match">{text.slice(indexMatch, indexEnd)}</mark>);
    indexStart = indexEnd;
    indexMatch = textLower.indexOf(word, indexStart);
  }
  if (indexStart < text.length) partList.push(text.slice(indexStart));
  return partList;
}
