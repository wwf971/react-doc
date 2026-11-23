import { useLayoutEffect, useRef, useState } from 'react';
import { POPUP_MARGIN, popupCornerPlaceOf, windowRectGet } from '../../../../main/comp-doc/popup/popup-place.js';

// Where a popup opened at a point stands: a corner of it on the point (popupCornerPlaceOf, shared
// with the popups of the top layer: @react-doc/main/comp-doc/popup/popup-place.js). This hook is for
// a popup drawn in the page (a portal into the body); one that would be clipped by the canvas around
// it is drawn in the top layer instead (AnchoredPopover, placement 'corner').
//
//   usePopupCornerOffset(ref, boundRectGet, key) -> { x, y }     the offset, in pixels of the screen,
//                     from where the popup is drawn (its top left corner on the point) to where it
//                     stands. Measured once it is drawn, before it is painted; again only when it grows
//                     past its bound (a corner chosen is kept while the popup shrinks: no jump)
export { POPUP_MARGIN, popupCornerPlaceOf, windowRectGet };

export function usePopupCornerOffset(ref, boundRectGet, key) {
	const [offset, offsetSet] = useState({ x: 0, y: 0 });
	const offsetRef = useRef(offset);
	offsetRef.current = offset;
	const boundRef = useRef(boundRectGet);
	boundRef.current = boundRectGet;
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return undefined;
		const place = (isGrownOnly) => {
			const rect = element.getBoundingClientRect();
			const bound = boundRef.current(element);
			if (!bound || !rect.width) return;
			const now = offsetRef.current;
			if (isGrownOnly && rect.right <= bound.right - POPUP_MARGIN + 0.5 && rect.bottom <= bound.bottom - POPUP_MARGIN + 0.5) return;
			const origin = { x: rect.left - now.x, y: rect.top - now.y };
			const at = popupCornerPlaceOf(origin, { width: rect.width, height: rect.height }, bound);
			const next = { x: Math.round(at.x - origin.x), y: Math.round(at.y - origin.y) };
			if (next.x !== now.x || next.y !== now.y) { offsetRef.current = next; offsetSet(next); }
		};
		place(false);
		const observer = new ResizeObserver(() => place(true));
		observer.observe(element);
		return () => observer.disconnect();
	}, [key]); // eslint-disable-line react-hooks/exhaustive-deps
	return offset;
}

