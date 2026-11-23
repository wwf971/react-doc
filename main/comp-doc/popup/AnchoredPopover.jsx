// AnchoredPopover: the surface of an inline overlay (a dropdown, a tooltip)
// that must not be clipped by an ancestor's overflow, e.g. the overflow:auto
// wrapper Fumadocs puts around every Markdown table. It is shown in the
// browser's top layer (popover="manual") while its node stays under its
// owner, so styles, context and DOM containment (outside-click, edit session)
// still treat it as part of the owner. Placed against anchorRef (below, or
// above when it does not fit), clamped to the viewport, following scroll and
// resize. Mount it only while open; the caller owns dismissal, focus and
// aria. Design: doc_page_impl_popup.md, "Inline Tooltips and Dropdowns".
//
//   placement  'below' (default): under the anchor, above it when there is
//              no room. 'corner': a corner of it on the top left of the
//              anchor, a point (a panel opened where the pointer was or a
//              line was let go): right of and below it when it fits, else
//              the other way on that axis, moved inside only when neither
//              fits (popup-place.js); the side taken is kept while it fits
//   isTracked  the anchor also moves with no scroll and no resize (a node
//              of a canvas panned or zoomed): followed every frame
//   isShownFirst  what it holds is mounted only once it is shown: for a
//              field inside taking the focus as it mounts (autoFocus, which
//              React runs before any effect, while a popover not yet shown
//              is not displayed and cannot take it)
//
// A popup opened from inside one in the top layer must be in the top layer
// too: a portal into the body stands under it, whatever its z-index.
//
// It is shown in a layout effect, before any effect of its owner or of what
// it holds runs (one focusing an item finds it displayed). It is placed in
// an effect, once the anchor's ref is attached (an owner's ref is attached
// after the layout effects of what it holds) and what it holds is drawn.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { POPUP_MARGIN, popupCornerPlaceOf } from './popup-place.js';
import './AnchoredPopover.css';

export function AnchoredPopover({ anchorRef, children, className = '', placement = 'below', isTracked = false, isShownFirst = false, ...props }) {
  const ref = useRef(null);
  const sideRef = useRef({});
  const [isShown, isShownSet] = useState(false);

  useLayoutEffect(() => {
    const popup = ref.current;
    if (!popup) return undefined;
    popup.showPopover();
    isShownSet(true);
    return () => { if (popup.matches(':popover-open')) popup.hidePopover(); };
  }, []);

  useEffect(() => {
    const popup = ref.current;
    const anchor = anchorRef.current;
    if (!popup || !anchor || !isShown) return undefined;
    const view = anchor.ownerDocument.defaultView;
    const positionUpdate = () => {
      const rect = anchor.getBoundingClientRect();
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const widthViewport = anchor.ownerDocument.documentElement.clientWidth;
      const heightViewport = view.innerHeight;
      if (placement === 'corner') {
        const at = popupCornerPlaceOf({ x: rect.left, y: rect.top }, { width, height }, { left: 0, top: 0, right: widthViewport, bottom: heightViewport }, POPUP_MARGIN, sideRef.current);
        sideRef.current = at.side;
        popup.style.left = `${Math.round(at.x)}px`;
        popup.style.top = `${Math.round(at.y)}px`;
        return;
      }
      const top = rect.bottom + 2 + height <= heightViewport - 8
        ? rect.bottom + 2
        : rect.top - height - 2;
      popup.style.left = `${Math.max(8, Math.min(rect.left, widthViewport - width - 8))}px`;
      popup.style.top = `${Math.max(8, Math.min(top, heightViewport - height - 8))}px`;
    };
    positionUpdate();
    const observer = new ResizeObserver(positionUpdate);
    observer.observe(anchor);
    observer.observe(popup);
    view.addEventListener('resize', positionUpdate);
    view.addEventListener('scroll', positionUpdate, true);
    let frame = 0;
    if (isTracked) {
      let anchorLast = '';
      const follow = () => {
        const rect = anchor.getBoundingClientRect();
        const key = `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
        if (key !== anchorLast) {
          anchorLast = key;
          positionUpdate();
        }
        frame = view.requestAnimationFrame(follow);
      };
      frame = view.requestAnimationFrame(follow);
    }
    return () => {
      view.cancelAnimationFrame(frame);
      observer.disconnect();
      view.removeEventListener('resize', positionUpdate);
      view.removeEventListener('scroll', positionUpdate, true);
    };
  }, [anchorRef, placement, isTracked, isShown]);

  return <span {...props} ref={ref} popover="manual" className={`doc-anchored-popover ${className}`}>{isShown || !isShownFirst ? children : null}</span>;
}