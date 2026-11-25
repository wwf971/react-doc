import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { Brackets, Paintbrush, RemoveFormatting, Type } from '../../frontend/UICommon.js';
import { StoreContext } from '../../frontend/src/store/context.js';
import { EditButtonGroup } from '../edit/EditButtonGroup.jsx';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import { cellSurfaceRangeRectGet } from './cell-surface.js';
import './Cell.css';

// The bar of the words selected in a cell being typed (doc_page_impl_edit_cell.md#the-style-bar):
// under the selection, floating, a button group of the edit layer with the style kinds of the
// cell: a flag is a button pressed while every selected word has it (bold), a kind with values
// lists them under the bar (a color, a size), a look a component names stands under "Styles".
// What a button does is the surface's (cell-style-surface.js): the bar only says which.
//
//   surface   the styled surface of the cell (CellStyleSurface): its state says what is selected
//             and what style those words share
//   cell      the cell: its style kinds
//   isRaw     the text is typed as it is kept, its markup written out: only the switch is offered
//   isLocked  nothing can be changed now
//
// It takes no focus (the selection stays in the text), but for a value typed by hand. It stands
// under the last line of the selection (above its first when the window has no room under it),
// and a pointer in it is not a click outside what is being edited (doc-edit-popup).
const LOOK_PICK_NAME = '#look';

export const CellStyleBar = observer(function CellStyleBar({ surface, cell, isRaw = false, isLocked = false }) {
  const cellStore = useContext(StoreContext)?.cellStore;
  const barRef = useRef(null);
  const [place, placeSet] = useState(null);
  const { selection, style, isStylable, pickName, version } = surface.state;
  const isShown = Boolean(selection);

  // where it stands: under the selected words, kept in the window
  useLayoutEffect(() => {
    if (!isShown) {
      placeSet(null);
      return undefined;
    }
    const placeRead = () => {
      const bar = barRef.current;
      const rect = surface.element && selection ? cellSurfaceRangeRectGet(surface.element, selection.start, selection.end) : undefined;
      if (!bar || !rect) return;
      const placeNext = barPlaceGet(rect, bar.offsetWidth, bar.offsetHeight);
      placeSet((placeBefore) => (placeBefore && placeBefore.left === placeNext.left && placeBefore.top === placeNext.top ? placeBefore : placeNext));
    };
    placeRead();
    window.addEventListener('scroll', placeRead, true);
    window.addEventListener('resize', placeRead);
    return () => {
      window.removeEventListener('scroll', placeRead, true);
      window.removeEventListener('resize', placeRead);
    };
    // version: the surface was written again, or the selection moved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShown, selection?.start, selection?.end, version, pickName, isRaw]);

  // the focus in the bar keeps it (a value typed by hand): the surface is told its element
  useEffect(() => {
    surface.barElement = barRef.current;
    return () => { surface.barElement = null; };
  });

  if (!isShown) return null;
  const styleList = cell?.styleList ?? [];
  const lookList = styleList.filter((kind) => kind.type === 'flag' && !kind.Icon);
  const isDisabled = !isStylable;
  const reason = 'no word is selected: a token has no style';
  const actionList = isRaw ? [] : [
    ...styleList.filter((kind) => kind.type === 'flag' && kind.Icon).map((kind) => ({
      id: kind.name,
      Icon: kind.Icon,
      title: `${kind.label}${shortcutTextGet(kind.shortcut)}`,
      isPressed: style[kind.name] === true,
      isDisabled,
      reason,
      act: () => surface.flagToggle(kind.name),
    })),
    ...styleList.filter((kind) => kind.type === 'value').map((kind) => ({
      id: kind.name,
      Icon: valueIconGet(kind, typeof style[kind.name] === 'string' ? style[kind.name] : ''),
      title: `${kind.label}${typeof style[kind.name] === 'string' ? `: ${style[kind.name]}` : ''}`,
      isPressed: pickName === kind.name,
      isDisabled,
      reason,
      act: () => surface.pickSet(kind.name),
    })),
    ...(lookList.length > 0 ? [{
      id: LOOK_PICK_NAME,
      Icon: Paintbrush,
      title: 'Styles',
      isPressed: pickName === LOOK_PICK_NAME,
      isDisabled,
      reason,
      act: () => surface.pickSet(LOOK_PICK_NAME),
    }] : []),
    { id: 'clear', Icon: RemoveFormatting, title: 'No style: the words as the cell draws them', isDisabled, reason, act: () => surface.styleClear() },
  ];
  // the text as it is kept, for looking into it: one switch for the page
  if (cellStore) {
    actionList.push({
      id: 'raw',
      Icon: Brackets,
      title: isRaw
        ? 'The text is typed as it is kept, its style markup written out ([[words|b]]). Click to draw the styles again.'
        : 'Type the text as it is kept, its style markup written out ([[words|b]]): for looking into it.',
      isPressed: isRaw,
      act: () => cellStore.styleRawSet(!isRaw),
    });
  }
  if (actionList.length === 0) return null;
  const kindPicked = isRaw ? undefined : styleList.find((kind) => kind.type === 'value' && kind.name === pickName);
  return createPortal(
    <div
      ref={barRef}
      className={`doc-cell-style-bar not-prose ${EDIT_POPUP_CLASS}`}
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
      // the selection stays in the typed text: a button takes no focus. a value typed by hand does
      onMouseDown={(event) => { if (!event.target.closest?.('.doc-cell-style-value')) event.preventDefault(); }}
      // what is done here is the bar's: it reaches nothing of the cell around the typed text
      // (a key in a typed value is not a key of the cell)
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <EditButtonGroup actionList={actionList} isLocked={isLocked} ariaLabel="The style of the selected words" />
      {kindPicked ? <CellStylePick key={kindPicked.name} kind={kindPicked} value={typeof style[kindPicked.name] === 'string' ? style[kindPicked.name] : ''} surface={surface} cell={cell} /> : null}
      {!isRaw && pickName === LOOK_PICK_NAME ? <CellStyleLookPick lookList={lookList} style={style} surface={surface} cell={cell} /> : null}
    </div>,
    document.body,
  );
});

// the values of a kind, under the bar: none, those it offers (a color as a tile, anything else
// by its label, drawn as it draws words), and one typed by hand where the kind checks one
function CellStylePick({ kind, value, surface, cell }) {
  const [message, messageSet] = useState('');
  const valueRef = useRef(null);
  // Enter was typed in the value: a value refused keeps the field, to be typed again
  const isEnterRef = useRef(false);
  const isSwatch = kind.optionList.some((option) => option.swatch);
  const isOffered = kind.optionList.some((option) => option.value === value);
  const choose = (valueNext) => {
    surface.styleChange({ [kind.name]: valueNext });
    surface.pickSet('');
  };
  return (
    <div className="doc-popover doc-cell-style-pick" role="group" aria-label={kind.label}>
      <div className="doc-cell-style-pick-list" data-swatch={isSwatch ? '' : undefined}>
        <button type="button" className="doc-cell-style-option" data-none="" aria-pressed={value === ''} title={`No ${kind.label.toLowerCase()} of its own`} onClick={() => choose(null)}>
          {isSwatch ? <span className="doc-cell-style-tile" data-none="" aria-hidden="true" /> : 'None'}
        </button>
        {kind.optionList.map((option) => (
          <button key={option.value} type="button" className="doc-cell-style-option" aria-pressed={value === option.value} title={option.swatch ? `${option.label} ${option.value}` : option.value} aria-label={option.label} onClick={() => choose(option.value)}>
            {option.swatch
              ? <span className="doc-cell-style-tile" style={{ background: option.swatch }} aria-hidden="true" />
              : <span style={cell.styleCssGet({ [kind.name]: option.value })}>{option.label}</span>}
          </button>
        ))}
      </div>
      {kind.valueCheck ? (
        <div className="doc-cell-style-value-row">
          <EditValueInline
            ref={valueRef}
            className="doc-edit-value doc-cell-style-value"
            value={isOffered ? '' : value}
            placeholder={kind.valuePlaceholder || 'a value'}
            aria-label={`${kind.label}: a value typed`}
            onInput={() => { if (message) messageSet(''); }}
            onCommit={(valueTyped) => {
              const valueNext = valueTyped.trim();
              if (valueNext === '') return;
              const problem = kind.valueCheck(valueNext);
              const isEnter = isEnterRef.current;
              isEnterRef.current = false;
              if (!problem) {
                choose(valueNext);
                return;
              }
              messageSet(problem);
              // the field left the focus to keep its value (Enter): it takes it back
              if (isEnter) setTimeout(() => valueRef.current?.focus(), 0);
            }}
            onKeyDown={(event) => {
              isEnterRef.current = event.key === 'Enter';
              if (event.key !== 'Escape') return;
              // back to the typed text, the words still selected
              event.preventDefault();
              surface.pickSet('');
              surface.surfaceFocus(surface.selection);
            }}
          />
          {message ? <span className="doc-error doc-cell-style-message" role="alert">{message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// the looks a component names for its cells (flags without a button of their own): each on or
// off, drawn as it draws words
function CellStyleLookPick({ lookList, style, surface, cell }) {
  return (
    <div className="doc-popover doc-cell-style-pick" role="group" aria-label="Styles">
      <div className="doc-cell-style-pick-list">
        {lookList.map((kind) => (
          <button key={kind.name} type="button" className="doc-cell-style-option" aria-pressed={style[kind.name] === true} title={kind.description || kind.label} onClick={() => surface.flagToggle(kind.name)}>
            <span style={cell.styleCssGet({ [kind.name]: true })}>{kind.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// the button of a kind with values: its icon, over a line in the color chosen (a color kind)
// or marked as having a value. kept by kind and value, so a button is the same element while
// nothing of it changes
const valueIconByKey = new Map();
function valueIconGet(kind, value) {
  const key = `${kind.name}:${value}`;
  let Icon = valueIconByKey.get(key);
  if (!Icon) {
    const KindIcon = kind.Icon ?? Type;
    const isSwatch = kind.optionList.some((option) => option.swatch);
    Icon = function CellStyleValueIcon(props) {
      return (
        <span className="doc-cell-style-icon" data-value={value !== '' ? '' : undefined} style={isSwatch && value !== '' ? { '--doc-cell-style-swatch': value } : undefined}>
          <KindIcon {...props} />
        </span>
      );
    };
    if (valueIconByKey.size > 200) valueIconByKey.clear();
    valueIconByKey.set(key, Icon);
  }
  return Icon;
}

function shortcutTextGet(shortcut) {
  if (!shortcut) return '';
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  const keyText = shortcut.split('+').map((piece) => (piece === 'shift' ? 'Shift' : piece.toUpperCase())).join(' + ');
  return ` (${isMac ? '⌘' : 'Ctrl'} + ${keyText})`;
}

// under the selection, its left edge at the selection's; above it when the window has no room
// under it. kept inside the window
function barPlaceGet(rect, widthBar, heightBar) {
  const gap = 6;
  const margin = 6;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - widthBar - margin));
  let top = rect.bottom + gap;
  if (top + heightBar > window.innerHeight - margin && rect.top - gap - heightBar >= margin) top = rect.top - gap - heightBar;
  return { left: Math.round(left), top: Math.round(top) };
}
