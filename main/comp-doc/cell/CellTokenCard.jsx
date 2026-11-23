import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '../../frontend/UICommon.js';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import './Cell.css';

// The card of a token (doc_page_impl_edit_cell.md#the-card-of-a-token): the kind's Card in a
// floating frame, beside a token selected where it is drawn (placement 'right') or under a token
// marked in the typed text (placement 'below'). What it holds and what may be done in it is the
// kind's; the frame places it, keeps it in the window and closes it. It is a popup of the edit
// layer: a pointer in it is not a click outside what is being edited.
//
//   anchorRectGet()   the box of the token now ({ left, top, right, bottom })
//   observeElementGet()   optional: an element whose size moves the token (its value, its surface)
//   placement         'right' (its top edge at the token's; to its left, or under it, when the
//                     window has no room) | 'below' (its left edge at the token's; above it when
//                     the window has no room under it)
//   part, cell        the token and its cell
//   where             'value' | 'surface': handed to the Card
//   tokenSet(change)  the token written again ({ body?, param? }), or taken out (null)
//   close(how)        how: 'escape' | 'button' | 'outside' (a pointer going down outside the card
//                     and outside isInsideGet(target): the token, the surface it is typed in) |
//                     'done' (the Card closed itself, its work done: a value saved). the focus goes
//                     back to the typed text after all but 'outside'
export function CellTokenCard({ anchorRectGet, observeElementGet, placement = 'right', part, cell, where = 'value', tokenSet, close, isInsideGet }) {
  const cardRef = useRef(null);
  const [place, placeSet] = useState(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const anchorRectGetRef = useRef(anchorRectGet);
  anchorRectGetRef.current = anchorRectGet;
  const isInsideGetRef = useRef(isInsideGet);
  isInsideGetRef.current = isInsideGet;

  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => placeRead());
    let frame = 0;
    let isObserved = false;
    const placeRead = () => {
      const rect = anchorRectGetRef.current?.();
      const card = cardRef.current;
      if (!rect || !card) return false;
      if (!isObserved) {
        isObserved = true;
        const observed = observeElementGet?.();
        if (observed) observer.observe(observed);
        observer.observe(card);
      }
      const placeNext = placement === 'below'
        ? tokenCardPlaceBelowGet(rect, card.offsetWidth, card.offsetHeight)
        : tokenCardPlaceRightGet(rect, card.offsetWidth, card.offsetHeight);
      placeSet((placeBefore) => (placeBefore && placeBefore.left === placeNext.left && placeBefore.top === placeNext.top && placeBefore.maxHeight === placeNext.maxHeight ? placeBefore : placeNext));
      return true;
    };
    // a card mounted in the same turn as its token (a token selected already when its text is
    // drawn again) meets no anchor yet: it is placed on the next frame then, never left out of sight
    if (!placeRead()) frame = requestAnimationFrame(placeRead);
    window.addEventListener('scroll', placeRead, { capture: true, passive: true });
    window.addEventListener('resize', placeRead);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', placeRead, { capture: true });
      window.removeEventListener('resize', placeRead);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement, part.start, part.end]);

  useEffect(() => {
    const pointerDownHandle = (event) => {
      if (event.button !== 0) return;
      if (cardRef.current?.contains(event.target) || isInsideGetRef.current?.(event.target)) return;
      closeRef.current('outside');
    };
    const keyDownHandle = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current('escape');
    };
    document.addEventListener('pointerdown', pointerDownHandle, true);
    document.addEventListener('keydown', keyDownHandle, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDownHandle, true);
      document.removeEventListener('keydown', keyDownHandle, true);
    };
  }, []);

  const Card = part.kind.Card;
  return createPortal(
    <div
      ref={cardRef}
      className={`doc-popover doc-cell-token-card not-prose ${EDIT_POPUP_CLASS}`}
      data-placement={placement}
      role="dialog"
      aria-label={`${part.kind.label}: ${where === 'surface' ? 'what it is' : 'edit'}`}
      style={place ? { left: place.left, top: place.top, maxHeight: place.maxHeight } : { left: 0, top: 0, visibility: 'hidden' }}
      // a click in the card is the card's: it reaches nothing under it, and the focus a pointer
      // takes away from the typed text is given back only by what the card does
      onClick={(event) => event.stopPropagation()}
    >
      <div className="doc-cell-token-card-head">
        <span className="doc-cell-token-card-title">{part.kind.label}</span>
        <button type="button" className="doc-cell-token-card-close" title="Close (Esc)" aria-label="Close" onClick={() => close('button')}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {/* the Card may close itself when its work is done (close()): the kind decides, e.g. after a
          value is saved; the token stays, and a click on it opens the card again */}
      <Card token={part} cell={cell} tokenSet={tokenSet} close={(how = 'done') => close(how)} where={where} />
    </div>,
    document.body,
  );
}

// to the right of the token, its top edge at the token's; to its left when the window has no room
// at the right, under it when neither side has. kept inside the window, and what does not fit
// scrolls inside the card
function tokenCardPlaceRightGet(rect, widthCard, heightCard) {
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

// under the token, its left edge at the token's; above it when the window has no room under it
// for the card (or for 200px of it) and has more above. kept inside the window
function tokenCardPlaceBelowGet(rect, widthCard, heightCard) {
  const gap = 4;
  const margin = 6;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - widthCard - margin));
  const roomBelow = window.innerHeight - rect.bottom - gap - margin;
  const roomAbove = rect.top - gap - margin;
  const isAbove = roomBelow < Math.min(heightCard, 200) && roomAbove > roomBelow;
  if (isAbove) {
    const maxHeight = Math.max(120, roomAbove);
    return { left: Math.round(left), top: Math.round(Math.max(margin, rect.top - gap - Math.min(heightCard, maxHeight))), maxHeight };
  }
  return { left: Math.round(left), top: Math.round(rect.bottom + gap), maxHeight: Math.max(120, roomBelow) };
}
