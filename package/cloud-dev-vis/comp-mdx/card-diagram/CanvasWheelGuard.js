import { useEffect } from 'react';

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
