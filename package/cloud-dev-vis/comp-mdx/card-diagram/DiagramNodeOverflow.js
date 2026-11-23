// When the box of a node scrolls (card-diagram-impl.md#the-box-of-a-node). The box is as large as the
// diagram says, and scrolls only what its card really holds beyond it. An overflow of a few pixels is
// no content: the hover room of a cell reaching past its words, an outline with an offset, a size
// rounded by the layout. It is cut, never given a scrollbar. On a system whose scrollbars take room
// (Windows), a scrollbar for such an overflow shrinks the box and makes it overflow the other way too,
// so a title of one line grew two scrollbars while it was edited; a kind fixing it for itself
// (overflow: visible) only moved the trouble to the next kind.
//
//   nodeOverflowWatch(element)   watches a box: data-overflow="scroll" while what it holds exceeds it
//                                by more than NODE_OVERFLOW_SCROLL_MIN on a side, none otherwise.
//                                Answers the function that stops watching
//
// The CSS reads the attribute: a box cuts what exceeds it (overflow: hidden) and scrolls with it
// (overflow: auto). What it holds is measured again whenever its size, the size of what it holds or
// its words change (typing in a cell), once a frame.
import { useLayoutEffect } from 'react';

export const NODE_OVERFLOW_SCROLL_MIN = 8;

// whether a box holds more than it shows by more than the least overflow that scrolls
export function nodeOverflowIsScroll(box, min = NODE_OVERFLOW_SCROLL_MIN) {
	return box.scrollWidth - box.clientWidth > min || box.scrollHeight - box.clientHeight > min;
}

export function nodeOverflowWatch(element) {
	if (!element || typeof ResizeObserver === 'undefined') return () => {};
	let frame = 0;
	const measure = () => {
		frame = 0;
		const isScroll = nodeOverflowIsScroll(element);
		if (isScroll && element.dataset.overflow !== 'scroll') element.dataset.overflow = 'scroll';
		else if (!isScroll && element.dataset.overflow) delete element.dataset.overflow;
	};
	const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
	const resize = new ResizeObserver(schedule);
	const observe = () => {
		resize.disconnect();
		resize.observe(element);
		for (const child of element.children) resize.observe(child);
	};
	observe();
	const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { observe(); schedule(); });
	mutation?.observe(element, { childList: true, subtree: true, characterData: true });
	schedule();
	return () => {
		cancelAnimationFrame(frame);
		resize.disconnect();
		mutation?.disconnect();
	};
}

// the box of a node watched while it is drawn
export function useNodeOverflowWatch(ref) {
	useLayoutEffect(() => nodeOverflowWatch(ref.current), [ref]);
}
