import { useEffect, useLayoutEffect } from 'react';

// The wheel over a canvas belongs to the canvas, and never reaches the page
// (card-diagram.md#the-wheel-over-a-canvas). React Flow stops the page from scrolling only
// for a wheel over its own pane: not over the controls, not over anything marked nowheel.
// Both scrolled the page behind the reader's back, so the box of a canvas stops the wheel
// itself, whatever is under the pointer.
//
// An area that scrolls by itself takes the wheel before it gets here (stopPropagation),
// only while it can still scroll; an element marked nowheel keeps it too (a list in the
// create panel), and must not let it through to the page.
export function useCanvasWheelGuard(ref) {
	useEffect(() => {
		const element = ref.current;
		if (!element) return undefined;
		const onWheel = (event) => {
			if (!event.target.closest?.('.nowheel')) event.preventDefault();
		};
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => element.removeEventListener('wheel', onWheel);
	}, [ref]);
}

// the time after the last wheel event that scrolled an area during which the same gesture still
// stops there (a flick reaching the end of the area must not zoom the canvas)
export const WHEEL_GESTURE_MS = 180;

// An area of a card that scrolls by itself (a stack of scenes in its own scene, the body of a
// component in a card whose box is given), on the rule of the canvas
// (card-diagram.md#the-wheel-over-a-canvas): it takes the wheel natively (stopPropagation, the
// browser scrolling it) only while it can still scroll along the way the wheel goes, vertical or
// horizontal; the end of that same gesture stops there (preventDefault) instead of zooming; a pinch
// (ctrlKey) is always the canvas's; anything else goes on to the canvas. isEnabled false: the wheel
// is the canvas's (an area embedded in another card, a still picture)
export function useScrollWheelTake(ref, isEnabled = true) {
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || !isEnabled) return undefined;
		let timeScrolled = 0;
		const onWheel = (event) => {
			if (event.ctrlKey) return;
			const isHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
			const delta = isHorizontal ? event.deltaX : event.deltaY;
			const isScrollable = isHorizontal
				? (delta > 0 ? element.scrollLeft + element.clientWidth < element.scrollWidth - 1 : element.scrollLeft > 0)
				: (delta > 0 ? element.scrollTop + element.clientHeight < element.scrollHeight - 1 : element.scrollTop > 0);
			const now = performance.now();
			if (isScrollable) {
				timeScrolled = now;
				event.stopPropagation();
			} else if (now - timeScrolled < WHEEL_GESTURE_MS) {
				timeScrolled = now;
				event.preventDefault();
				event.stopPropagation();
			}
		};
		element.addEventListener('wheel', onWheel, { passive: false });
		return () => element.removeEventListener('wheel', onWheel);
	}, [ref, isEnabled]);
}

// the strip along an edge that scrolls taken as its scrollbar's: an overlay scrollbar (macOS, a
// headless browser) takes no room and lies over what scrolls, so where it stands is not told by a
// gutter; a scrollbar that takes room is in the strip too
export const SCROLLBAR_STRIP_PX = 12;

// A pointer going down on the scrollbar of an area of a card is the scrollbar's: it neither moves
// the card nor pans the canvas (the rest of the area stays a place to drag the card from): the strip
// along its right edge while it scrolls up and down, along its bottom edge while it scrolls across.
// Listened on the element natively, before the node and the canvas hear it; read in the element's
// own pixels, whatever the zoom of the canvas
export function useScrollbarPointerKeep(ref, isEnabled = true) {
	useEffect(() => {
		const element = ref.current;
		if (!element || !isEnabled) return undefined;
		const onDown = (event) => {
			const rect = element.getBoundingClientRect();
			if (!rect.width || !rect.height) return;
			const x = (event.clientX - rect.left) * (element.offsetWidth / rect.width);
			const y = (event.clientY - rect.top) * (element.offsetHeight / rect.height);
			const isVertical = element.scrollHeight > element.clientHeight + 1;
			const isHorizontal = element.scrollWidth > element.clientWidth + 1;
			const stripRight = Math.max(SCROLLBAR_STRIP_PX, element.offsetWidth - element.clientWidth);
			const stripBottom = Math.max(SCROLLBAR_STRIP_PX, element.offsetHeight - element.clientHeight);
			if ((isVertical && x >= element.offsetWidth - stripRight) || (isHorizontal && y >= element.offsetHeight - stripBottom)) {
				event.stopPropagation();
				isKept = true;
			} else if (event.type === 'pointerdown') isKept = false;
		};
		// the click ending a pointer kept so is the scrollbar's too: what lies under an overlay
		// scrollbar (a control of the component) is not clicked by it
		let isKept = false;
		const onClick = (event) => {
			if (!isKept) return;
			isKept = false;
			event.stopPropagation();
			event.preventDefault();
		};
		element.addEventListener('pointerdown', onDown);
		element.addEventListener('mousedown', onDown);
		element.addEventListener('click', onClick, true);
		return () => {
			element.removeEventListener('pointerdown', onDown);
			element.removeEventListener('mousedown', onDown);
			element.removeEventListener('click', onClick, true);
		};
	}, [ref, isEnabled]);
}
