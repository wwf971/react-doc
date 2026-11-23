import { useLayoutEffect, useRef, useState } from 'react';

// Where a popup opened at a point stands (a context menu, the panel of a double-click): **a corner
// of it on the point**. To the right of and below the point when it fits in its bound, else the
// other way on that axis (its right edge, its bottom edge on the point), and moved inside only when
// neither fits. A popup shifted to stay inside, with no corner where it was asked for, reads as
// opened somewhere else.
//
//   popupCornerPlaceOf(point, size, bound, margin) -> { x, y }   pure: the top left corner of the popup
//   usePopupCornerOffset(ref, boundRectGet, key) -> { x, y }     the offset, in pixels of the screen,
//                     from where the popup is drawn (its top left corner on the point) to where it
//                     stands. Measured once it is drawn, before it is painted; again only when it grows
//                     past its bound (a corner chosen is kept while the popup shrinks: no jump)
export const POPUP_MARGIN = 8;

export function popupCornerPlaceOf(point, size, bound, margin = POPUP_MARGIN) {
	const axisPlace = (at, extent, min, max) => {
		if (at + extent <= max - margin) return at;
		if (at - extent >= min + margin) return at - extent;
		return Math.max(min + margin, Math.min(max - margin - extent, at));
	};
	return { x: axisPlace(point.x, size.width, bound.left, bound.right), y: axisPlace(point.y, size.height, bound.top, bound.bottom) };
}

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

// the bound of a popup in the page: the window
export const windowRectGet = () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
