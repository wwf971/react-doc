import { makeAutoObservable } from 'mobx';

// The state of a horizontal strip wider than its container (ScrollHorizontal.jsx; the rule:
// ai-skills app-dev/references/frontend-scrollable-horizontal.md): how far the inner strip is
// moved to the left, and the two widths that bound it. Everything the strip does is a change of
// offset here: the wheel over it, a drag, a part brought into sight. No scrollbar is involved.
//
//   offset        how far the strip is moved left, from 0 to overflow
//   align         left: it starts at its left end; right: at its right end
const DRAG_THRESHOLD = 4;

export class ScrollHorizontalStore {
	offset = 0;
	widthOuter = 0;
	widthInner = 0;
	align = 'left';
	isPlaced = false;
	drag = null;

	constructor({ align = 'left' } = {}) {
		this.align = align;
		makeAutoObservable(this, { drag: false }, { autoBind: true });
	}

	get overflow() {
		return Math.max(0, this.widthInner - this.widthOuter);
	}

	get isOverflowing() {
		return this.overflow > 0.5;
	}

	offsetSet(value) {
		this.offset = Math.min(this.overflow, Math.max(0, value));
	}

	// the widths, measured: the first time the strip goes to the end its alignment names
	sizeSet(widthOuter, widthInner) {
		this.widthOuter = widthOuter;
		this.widthInner = widthInner;
		if (!this.isPlaced && widthOuter > 0) {
			this.isPlaced = true;
			this.offset = this.align === 'right' ? this.overflow : 0;
			return;
		}
		this.offsetSet(this.offset);
	}

	// the wheel over the strip: either of its directions moves it. true when the strip took
	// it (the page then does not scroll); a strip that fits leaves the wheel to the page
	wheel(deltaX, deltaY) {
		if (!this.isOverflowing) return false;
		this.offsetSet(this.offset + (Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY));
		return true;
	}

	// a part of the strip, from left to left + width in its own pixels, brought into sight
	reveal(left, width) {
		if (left < this.offset) this.offsetSet(left);
		else if (left + width > this.offset + this.widthOuter) this.offsetSet(left + width - this.widthOuter);
	}

	// a drag moves the strip once the pointer went past a few pixels; a click that became a
	// drag is not a click (dragEnd answers whether it was one)
	dragStart(x) {
		this.drag = { x, offset: this.offset, isMoved: false };
	}

	dragMove(x) {
		if (!this.drag || !this.isOverflowing) return;
		if (!this.drag.isMoved && Math.abs(x - this.drag.x) < DRAG_THRESHOLD) return;
		this.drag.isMoved = true;
		this.offsetSet(this.drag.offset - (x - this.drag.x));
	}

	dragEnd() {
		const isMoved = Boolean(this.drag?.isMoved);
		this.drag = null;
		return isMoved;
	}
}
