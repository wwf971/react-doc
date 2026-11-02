// AnchoredPopover: the surface of an inline overlay (a dropdown, a tooltip)
// that must not be clipped by an ancestor's overflow, e.g. the overflow:auto
// wrapper Fumadocs puts around every Markdown table. It is shown in the
// browser's top layer (popover="manual") while its node stays under its
// owner, so styles, context and DOM containment (outside-click, edit session)
// still treat it as part of the owner. Placed against anchorRef (below, or
// above when it does not fit), clamped to the viewport, following scroll and
// resize. Mount it only while open; the caller owns dismissal, focus and
// aria. Design: doc_page_impl_popup.md, "Inline Tooltips and Dropdowns".
import { useEffect, useRef } from 'react';
import './AnchoredPopover.css';

export function AnchoredPopover({ anchorRef, children, className = '', ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    const popup = ref.current;
    const anchor = anchorRef.current;
    if (!popup || !anchor) return;
    const view = anchor.ownerDocument.defaultView;
    const positionUpdate = () => {
      const rect = anchor.getBoundingClientRect();
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const widthViewport = anchor.ownerDocument.documentElement.clientWidth;
      const heightViewport = view.innerHeight;
      const top = rect.bottom + 2 + height <= heightViewport - 8
        ? rect.bottom + 2
        : rect.top - height - 2;
      popup.style.left = `${Math.max(8, Math.min(rect.left, widthViewport - width - 8))}px`;
      popup.style.top = `${Math.max(8, Math.min(top, heightViewport - height - 8))}px`;
    };
    popup.showPopover();
    positionUpdate();
    const observer = new ResizeObserver(positionUpdate);
    observer.observe(anchor);
    observer.observe(popup);
    view.addEventListener('resize', positionUpdate);
    view.addEventListener('scroll', positionUpdate, true);
    return () => {
      observer.disconnect();
      view.removeEventListener('resize', positionUpdate);
      view.removeEventListener('scroll', positionUpdate, true);
      if (popup.matches(':popover-open')) popup.hidePopover();
    };
  }, [anchorRef]);

  return <span {...props} ref={ref} popover="manual" className={`doc-anchored-popover ${className}`}>{children}</span>;
}