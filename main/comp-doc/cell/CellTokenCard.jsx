import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '../../frontend/UICommon.js';
import { EDIT_POPUP_CLASS, EDIT_POPUP_SELECTOR } from '../edit/use-edit-outside-pointer.js';
import './Cell.css';

// The card of a token (doc_page_impl_edit_cell.md#the-card-of-a-token): the kind's Card in a
// floating frame, beside a token selected where it is drawn (placement 'right') or under a token
// marked in the typed text (placement 'below'). What it holds and what may be done in it is the
// kind's; the frame places it, keeps it in the window and closes it. It is a popup of the edit
// layer: a pointer in it is not a click outside what is being edited.
//
//   anchorRectGet()   the box of the token now ({ left, top, right, bottom })
//   observeElementGet()   optional: an element whose size moves the token (its value, its surface)
//   placeRectGet()    optional: the box of the place the token is typed in (its surface): how wide
//                     a card asking to be wide is, and where its left edge stands then
//   placement         'right' (its top edge at the token's; to its left, or under it, when the
//                     window has no room; kept in the window, what does not fit scrolls inside) |
//                     'below' (its left edge at the token's, under it, standing in the page: as
//                     tall as it is, it may go past the bottom of the window, and the page scrolls
//                     to the rest of it; cardHostGet says in which box)
//   part, cell        the token and its cell
//   where             'value' | 'surface': handed to the Card
//   markedBy          how the token came to be marked in the typed text ('pointer', 'key', 'open',
//                     'insert': a slash action just wrote it), handed to the Card: one opened on a
//                     token just made may take the focus, to go on with it at once
//   tokenSet(change)  the token written again ({ body?, param? }), or taken out (null)
//   close(how)        how: 'escape' | 'button' | 'outside' (a pointer going down outside the card
//                     and outside isInsideGet(target): the token, the surface it is typed in) |
//                     'done' (the Card closed itself, its work done: a value saved). the focus goes
//                     back to the typed text after all but 'outside'
//
// The Card is handed widthSet(width): 'wide' asks for a card as wide as the place the token is
// typed in (a block: as wide as the block, so a text breaks into the lines it will have there;
// twice the usual width where no place is known), 'normal' gives the usual width back. What is
// wide is the kind's to say (a value that is a text), never the frame's
export function CellTokenCard({ anchorRectGet, observeElementGet, placeRectGet, placement = 'right', part, cell, where = 'value', markedBy, tokenSet, close, isInsideGet }) {
  const cardRef = useRef(null);
  const [place, placeSet] = useState(null);
  const [widthMode, widthModeSet] = useState('normal');
  // the box it stands in, chosen once (a card under a token: cardHostGet; beside one: the body)
  const [host] = useState(() => (placement === 'below' ? cardHostGet(observeElementGet?.()) : document.body));
  const placeRectGetRef = useRef(placeRectGet);
  placeRectGetRef.current = placeRectGet;
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
      const placeRect = widthMode === 'wide' ? placeRectGetRef.current?.() : undefined;
      const placeNext = placement === 'below'
        ? tokenCardPlaceBelowGet(rect, card.offsetWidth, widthMode === 'wide' ? cardWidthWideGet(placeRect) : undefined, placeRect, host)
        : tokenCardPlaceRightGet(rect, card.offsetWidth, card.offsetHeight, widthMode === 'wide' ? cardWidthWideGet(placeRect) : undefined);
      placeSet((placeBefore) => (placeBefore && placeBefore.left === placeNext.left && placeBefore.top === placeNext.top && placeBefore.maxHeight === placeNext.maxHeight && placeBefore.width === placeNext.width ? placeBefore : placeNext));
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
  }, [placement, part.start, part.end, widthMode]);

  useEffect(() => {
    // a popup of the edit layer opened from what the card holds (the bar of words selected in a
    // text typed in it, a menu) is the card's: a pointer or a key in it is not one elsewhere
    const isInPopupOwn = (target) => {
      const popup = target instanceof Element ? target.closest(EDIT_POPUP_SELECTOR) : null;
      return Boolean(popup) && popup !== cardRef.current && !popup.contains(cardRef.current);
    };
    const pointerDownHandle = (event) => {
      if (event.button !== 0) return;
      if (cardRef.current?.contains(event.target) || isInsideGetRef.current?.(event.target) || isInPopupOwn(event.target)) return;
      closeRef.current('outside');
    };
    const keyDownHandle = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isInPopupOwn(event.target)) return;
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
  const widthSet = (mode) => widthModeSet(mode === 'wide' ? 'wide' : 'normal');
  return createPortal(
    <div
      ref={cardRef}
      className={`doc-popover doc-cell-token-card not-prose ${EDIT_POPUP_CLASS}`}
      data-placement={placement}
      role="dialog"
      aria-label={`${part.kind.label}: ${where === 'surface' ? 'what it is' : 'edit'}`}
      style={place ? { left: place.left, top: place.top, maxHeight: place.maxHeight, width: place.width } : { left: 0, top: 0, visibility: 'hidden' }}
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
      <Card token={part} cell={cell} tokenSet={tokenSet} close={(how = 'done') => close(how)} widthSet={widthSet} where={where} markedBy={markedBy} />
    </div>,
    host,
  );
}

// how wide a wide card is: the place the token is typed in, at least the usual width and within
// the window; twice the usual width where no place is known
const CARD_WIDTH_MARGIN = 6;
function cardWidthWideGet(placeRect) {
  const widthNormal = 272;
  const widthWindow = window.innerWidth - CARD_WIDTH_MARGIN * 2;
  const width = placeRect && placeRect.right > placeRect.left ? placeRect.right - placeRect.left : widthNormal * 2;
  return Math.round(Math.max(Math.min(widthNormal, widthWindow), Math.min(width, widthWindow)));
}

// to the right of the token, its top edge at the token's; to its left when the window has no room
// at the right, under it when neither side has. kept inside the window, and what does not fit
// scrolls inside the card
function tokenCardPlaceRightGet(rect, widthCardNow, heightCard, widthWide) {
  const gap = 8;
  const margin = 6;
  const widthCard = widthWide ?? widthCardNow;
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
  return { left: Math.round(left), top: Math.round(top), maxHeight: Math.max(120, window.innerHeight - top - margin), width: widthWide };
}

// The box a card under a token stands in: inside the box that scrolls the page (the outermost one
// around the token that scrolls up and down), the nearest positioned box around the token that no
// box clips between it and that scroller, so that the card scrolls with the page, the wheel over it
// scrolls the page, and one taller than the window makes the page scroll further, to its end. A box
// inside that clips (a panel that scrolls of its own, a cell that scrolls sideways and so up and
// down too) is passed over with what is inside it: the card stands over its edges, as a popover
// does, and follows the token when it scrolls (placeRead on every scroll). A box clipping only
// sideways (overflow-x: clip, a layout's grid) cuts nothing under the token. The page's scroller is
// itself the host when it is positioned and nothing inside it is; else the body, whose scroll is
// the window's
function cardHostGet(element) {
  let host;
  let scrollerLast;
  for (let one = element?.parentElement; one && one !== document.body && one !== document.documentElement; one = one.parentElement) {
    const style = getComputedStyle(one);
    const isPositioned = style.position !== 'static' || style.transform !== 'none';
    if (style.overflowY !== 'visible') {
      // the host as it stood under this box, kept when the box is a scroller: the outermost one wins
      const isScroller = /(auto|scroll)/.test(style.overflowY) && one.scrollHeight > one.clientHeight + 1;
      if (isScroller) scrollerLast = { element: one, host, isPositioned };
      host = undefined;
      continue;
    }
    if (!host && isPositioned) host = one;
  }
  if (!scrollerLast) return host ?? document.body;
  return scrollerLast.host ?? (scrollerLast.isPositioned ? scrollerLast.element : document.body);
}

// under the token, its left edge at the token's, kept inside the width of the window, in the
// coordinates of the box it stands in (cardHostGet). As tall as it is: one going past the bottom of
// the window is scrolled to, as anything else there. A wide card stands under the place the token
// is typed in, its left edge at the place's
function tokenCardPlaceBelowGet(rect, widthCardNow, widthWide, placeRect, host) {
  const gap = 4;
  const margin = CARD_WIDTH_MARGIN;
  const widthCard = widthWide ?? widthCardNow;
  const leftWanted = widthWide !== undefined && placeRect ? placeRect.left : rect.left;
  const left = Math.max(margin, Math.min(leftWanted, window.innerWidth - widthCard - margin));
  const top = rect.bottom + gap;
  if (!host || host === document.body) return { left: Math.round(left + window.scrollX), top: Math.round(top + window.scrollY), maxHeight: undefined, width: widthWide };
  const hostRect = host.getBoundingClientRect();
  return {
    left: Math.round(left - hostRect.left - host.clientLeft + host.scrollLeft),
    top: Math.round(top - hostRect.top - host.clientTop + host.scrollTop),
    maxHeight: undefined,
    width: widthWide,
  };
}
