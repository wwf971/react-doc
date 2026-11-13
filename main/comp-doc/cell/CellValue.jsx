import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { X } from '../../frontend/UICommon.js';
import { cellTextRangeReplace, cellTokenTextBuild } from '../../frontend/src/lib/doc-cell.js';
import { StoreContext } from '../../frontend/src/store/context.js';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import './Cell.css';

// A cell text drawn (doc_page_impl_edit_cell.md#drawing-and-typing): its text
// as it is, and every token drawn by its kind: a link by the navigation
// layer, a view of an object by the view of its types, a value of the
// component's own data as that value. It adds no element of its own, so the
// text takes the type and the box of where it stands; with a className it is
// one span.
//
//   cell        the cell of the component (useCell)
//   text        the text kept in the data
//   textEmpty   what is drawn for an empty text (a placeholder, a dash); default nothing
//
// A token whose kind has a card can be selected where it is drawn and changed
// from the card beside it (#a-token-selected-its-card), in a value that says
// it can be edited:
//
//   isEditable            whether a click on such a token selects it
//   cellKey               the value, unique on the page while it is drawn: which
//                         token is selected is the store's (DocCellStore.token)
//   onTextChange(text)    the text with the token written again or taken out:
//                         the component saves it, as it saves a typed text
export const CellValue = observer(function CellValue({ cell, text, textEmpty = null, className = '', isEditable = false, cellKey = '', onTextChange }) {
  const value = String(text ?? '');
  if (value === '') return textEmpty;
  const partList = cell.parse(value);
  const isTokenSelectable = isEditable && cellKey !== '' && typeof onTextChange === 'function';
  const content = partList.map((part) => (part.type === 'text'
    ? part.text
    : <CellToken key={`${part.start}:${part.raw}`} part={part} cell={cell} text={value} cellKey={isTokenSelectable ? cellKey : ''} onTextChange={onTextChange} />));
  return className ? <span className={className}>{content}</span> : content;
});

// one token, drawn by its kind; a kind that only says a text (or nothing) is
// text. with a card and a value that can be edited, a click selects it
const CellToken = observer(function CellToken({ part, cell, text, cellKey, onTextChange }) {
  const cellStore = useContext(StoreContext)?.cellStore;
  const elementRef = useRef(null);
  const Render = part.kind.Render;
  const isSelectable = Boolean(part.kind.Card && cellKey && cellStore);
  const isSelected = isSelectable && cellStore.tokenIsSelected(cellKey, part.start);
  if (!Render && !isSelectable) {
    const textPlain = part.kind.textGet?.(part, cell);
    return textPlain === undefined || textPlain === null ? part.raw : String(textPlain);
  }
  const textPlain = Render ? undefined : part.kind.textGet?.(part, cell);
  return (
    <span
      ref={elementRef}
      className="doc-cell-token"
      data-cell-token={part.name}
      data-selectable={isSelectable ? '' : undefined}
      data-selected={isSelected ? '' : undefined}
      // the click selects the token before anything inside it, or the value around it, takes
      // it. its card is a child of this element for React though it is drawn elsewhere (a
      // portal), so a click in the card passes here too and is left to the card
      onClickCapture={isSelectable ? (event) => {
        if (!elementRef.current?.contains(event.target)) return;
        event.stopPropagation();
        event.preventDefault();
        cellStore.tokenSelect(cellKey, part.start);
      } : undefined}
    >
      {Render ? <Render token={part} cell={cell} /> : textPlain ?? part.raw}
      {isSelected ? (
        <CellTokenCard
          anchorRef={elementRef}
          part={part}
          cell={cell}
          close={() => cellStore.tokenSelectClear(cellKey)}
          tokenSet={(change) => {
            const rawNext = change === null ? '' : cellTokenTextBuild(part, change);
            if (change === null) cellStore.tokenSelectClear(cellKey);
            if (rawNext !== part.raw) onTextChange(cellTextRangeReplace(text, part.start, part.end, rawNext));
          }}
        />
      ) : null}
    </span>
  );
});

// The card of a selected token: the kind's Card in a floating frame to the
// right of the token (below it when the window has no room there), its top
// edge at the token's, so nothing the author does in it moves it. It is a
// popup of the edit layer: a pointer in it is not a click outside what is
// being edited. Escape, the close button and a pointer going down elsewhere
// close it.
function CellTokenCard({ anchorRef, part, cell, tokenSet, close }) {
  const cardRef = useRef(null);
  const [place, placeSet] = useState(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useLayoutEffect(() => {
    const placeRead = () => {
      const anchor = anchorRef.current;
      const card = cardRef.current;
      if (!anchor || !card) return;
      placeSet(tokenCardPlaceGet(anchor.getBoundingClientRect(), card.offsetWidth, card.offsetHeight));
    };
    placeRead();
    window.addEventListener('scroll', placeRead, { capture: true, passive: true });
    window.addEventListener('resize', placeRead);
    const observer = new ResizeObserver(placeRead);
    if (anchorRef.current) observer.observe(anchorRef.current);
    return () => {
      window.removeEventListener('scroll', placeRead, { capture: true });
      window.removeEventListener('resize', placeRead);
      observer.disconnect();
    };
  }, [anchorRef]);

  useEffect(() => {
    const pointerDownHandle = (event) => {
      if (event.button !== 0) return;
      if (cardRef.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      closeRef.current();
    };
    const keyDownHandle = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('pointerdown', pointerDownHandle, true);
    document.addEventListener('keydown', keyDownHandle, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDownHandle, true);
      document.removeEventListener('keydown', keyDownHandle, true);
    };
  }, [anchorRef]);

  const Card = part.kind.Card;
  return createPortal(
    <div
      ref={cardRef}
      className={`doc-popover doc-cell-token-card not-prose ${EDIT_POPUP_CLASS}`}
      role="dialog"
      aria-label={`${part.kind.label}: edit`}
      style={place ? { left: place.left, top: place.top, maxHeight: place.maxHeight } : { left: 0, top: 0, visibility: 'hidden' }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="doc-cell-token-card-head">
        <span className="doc-cell-token-card-title">{part.kind.label}</span>
        <button type="button" className="doc-cell-token-card-close" title="Close (Esc)" aria-label="Close" onClick={close}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <Card token={part} cell={cell} tokenSet={tokenSet} close={close} />
    </div>,
    document.body,
  );
}

// to the right of the token, its top edge at the token's; to its left when the
// window has no room at the right, under it when neither side has. kept inside
// the window, and what does not fit scrolls inside the card
function tokenCardPlaceGet(rect, widthCard, heightCard) {
  const gap = 8;
  const margin = 6;
  let left = rect.right + gap;
  let top = rect.top;
  if (left + widthCard > window.innerWidth - margin) {
    const leftOther = rect.left - gap - widthCard;
    if (leftOther >= margin) left = leftOther;
    else {
      left = Math.max(margin, Math.min(rect.left, window.innerWidth - widthCard - margin));
      top = rect.bottom + gap;
    }
  }
  top = Math.max(margin, Math.min(top, Math.max(margin, window.innerHeight - Math.min(heightCard, 160) - margin)));
  return { left: Math.round(left), top: Math.round(top), maxHeight: Math.max(120, window.innerHeight - top - margin) };
}
