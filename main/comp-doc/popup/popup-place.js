// Where a popup opened at a point stands (a context menu, the panel of a double-click, a search
// opened where a line was let go): **a corner of it on the point**. To the right of and below the
// point when it fits in its bound, else the other way on that axis (its right edge, its bottom edge
// on the point), and moved inside only when neither fits. A popup shifted to stay inside, with no
// corner where it was asked for, reads as opened somewhere else. Design: doc_page_impl_popup.md,
// "Inline Tooltips and Dropdowns".
//
//   popupCornerPlaceOf(point, size, bound, margin, sideKept) -> { x, y, side }   pure: the top left
//                 corner of the popup, and the side it took on each axis ({ x: 'after' | 'before' |
//                 'inside', y: … }). sideKept: the sides taken before, kept while they still fit,
//                 so a popup that shrinks or grows within its bound does not jump to the other side
export const POPUP_MARGIN = 8;

export function popupCornerPlaceOf(point, size, bound, margin = POPUP_MARGIN, sideKept = {}) {
	const axisPlace = (at, extent, min, max, kept) => {
		const isAfterFit = at + extent <= max - margin;
		const isBeforeFit = at - extent >= min + margin;
		if (kept === 'before' && isBeforeFit) return [at - extent, 'before'];
		if (isAfterFit) return [at, 'after'];
		if (isBeforeFit) return [at - extent, 'before'];
		return [Math.max(min + margin, Math.min(max - margin - extent, at)), 'inside'];
	};
	const [x, sideX] = axisPlace(point.x, size.width, bound.left, bound.right, sideKept.x);
	const [y, sideY] = axisPlace(point.y, size.height, bound.top, bound.bottom, sideKept.y);
	return { x, y, side: { x: sideX, y: sideY } };
}

// the bound of a popup in the page: the window
export const windowRectGet = () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
