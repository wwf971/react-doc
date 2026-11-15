// The display of a node (card-diagram-impl.md#the-display-of-a-node), apart from how it is drawn
// (CardSimple.jsx): a node is drawn `detailed`, as the card of its kind, or `simple`, as a mark
// with its name under it, for a picture of a system at the level of an overview. A kind that can
// be drawn simple says so in its contract:
//
//   contract.simple   { shape?, width?, contentGet(data) -> { title, text?, Icon?, iconUrl?, isIconFramed?, tone?, family?, badge? } }
//                     shape: tile (default: a white rounded square, the icon in the accent) | circle |
//                     cylinder; width: of a node with no width written; iconUrl: an image that is its own
//                     tile (an official service icon), drawn alone at the size of the mark, or with
//                     isIconFramed a glyph (a resource icon), drawn inside the shape in place of Icon;
//                     family: a class is-{family} a series colors the mark with (--doc-card-accent)
//
// Handles stay what they were written as, in both displays: simple, every one of them is drawn on
// the mark, on its side, at its offset, on the outline of the mark (a circle, the caps of a
// cylinder), so a line keeps the side it arrives at and only its end moves (handleAnchorDrawnOf).
// A handle at the bottom is drawn under the words, at the width of the mark (the anchor `foot`):
// the mark and its words are one thing, and a line leaving downward does not cross its name.
export const NODE_DISPLAY_LIST = ['detailed', 'simple'];
export const CARD_SIMPLE_SHAPE_LIST = ['tile', 'circle', 'cylinder'];
export const CARD_SIMPLE_MARK_SIZE = 60;
export const CARD_SIMPLE_MARK_SIZE_MIN = 24;
export const CARD_SIMPLE_WIDTH = 132;
// the words under the mark: a gap, a line of title, a line of text
export const CARD_SIMPLE_LABEL_HEIGHT = 38;
export const CARD_SIMPLE_HEIGHT = CARD_SIMPLE_MARK_SIZE + CARD_SIMPLE_LABEL_HEIGHT;
// the anchors every handle of a node drawn simple stands on: the mark, and under the words
export const CARD_SIMPLE_ANCHOR = 'mark';
export const CARD_SIMPLE_ANCHOR_FOOT = 'foot';
export const cardSimpleAnchorOf = (side) => (side === 'bottom' ? CARD_SIMPLE_ANCHOR_FOOT : CARD_SIMPLE_ANCHOR);
// how high the caps of a cylinder are, a part of the height of its mark
export const CARD_SIMPLE_CYLINDER_CAP = 0.24;

export function nodeDisplayRead(value, field) {
	if (!NODE_DISPLAY_LIST.includes(value)) throw new Error(`${field} is ${NODE_DISPLAY_LIST.join(' or ')}.`);
	return value;
}

export function cardSimpleShapeOf(contract) {
	const shape = contract?.simple?.shape ?? 'tile';
	return CARD_SIMPLE_SHAPE_LIST.includes(shape) ? shape : 'tile';
}

// the size of the mark in a node: its own with a height left to the content, else as large as
// the box leaves above the words (a node drawn to a size keeps it: a large mark in a large box)
export function cardSimpleMarkSizeOf(size) {
	if (typeof size?.height !== 'number') return CARD_SIMPLE_MARK_SIZE;
	const width = typeof size.width === 'number' ? size.width : Infinity;
	return Math.max(CARD_SIMPLE_MARK_SIZE_MIN, Math.min(size.height - CARD_SIMPLE_LABEL_HEIGHT, width));
}

// where the mark is in the rectangle of its node: at the top, in the middle of its width
export function cardSimpleMarkRectOf(rect, size) {
	const markSize = cardSimpleMarkSizeOf(size);
	return { x: rect.x + (rect.width - markSize) / 2, y: rect.y, width: markSize, height: markSize };
}

// where a handle of a node drawn simple is, in the rectangle of the node: on the outline of the
// mark, or, at the bottom, under the words at the width of the mark
export function cardSimpleHandlePointOf(rect, size, side, offset, shape) {
	const mark = cardSimpleMarkRectOf(rect, size);
	if (side === 'bottom') return { x: mark.x + mark.width * offset, y: rect.y + rect.height };
	return anchorPointOnOutline({ left: mark.x, top: mark.y, width: mark.width, height: mark.height }, side, offset, cardSimpleOutlineOf(shape));
}

// the outline a handle stands on, for the shape of a mark: an ellipse, a cylinder (straight walls,
// elliptic caps) or a rectangle
export const cardSimpleOutlineOf = (shape) => (shape === 'circle' ? 'ellipse' : shape === 'cylinder' ? 'cylinder' : 'rect');

// the point of a handle on an anchor: on its side at its offset, moved onto the outline of the
// anchor when it is not a rectangle, so a line ends on a circle where it touches it.
// rect { left, top, width, height } in any unit; answers { x, y } in the same
export function anchorPointOnOutline(rect, side, offset, outline = 'rect') {
	const { left, top, width, height } = rect;
	const isHorizontal = side === 'top' || side === 'bottom';
	const point = {
		x: isHorizontal ? left + width * offset : side === 'left' ? left : left + width,
		y: isHorizontal ? (side === 'top' ? top : top + height) : top + height * offset,
	};
	if (outline !== 'ellipse' && outline !== 'cylinder') return point;
	const radiusX = width / 2;
	const centerX = left + radiusX;
	if (outline === 'cylinder') {
		if (!isHorizontal) return point;
		const radiusY = (height * CARD_SIMPLE_CYLINDER_CAP) / 2;
		const depth = radiusY * (1 - Math.sqrt(Math.max(0, 1 - ((point.x - centerX) / radiusX) ** 2)));
		return { x: point.x, y: side === 'top' ? top + depth : top + height - depth };
	}
	const radiusY = height / 2;
	const centerY = top + radiusY;
	if (isHorizontal) {
		const part = Math.sqrt(Math.max(0, 1 - ((point.x - centerX) / radiusX) ** 2));
		return { x: point.x, y: side === 'top' ? centerY - radiusY * part : centerY + radiusY * part };
	}
	const part = Math.sqrt(Math.max(0, 1 - ((point.y - centerY) / radiusY) ** 2));
	return { x: side === 'left' ? centerX - radiusX * part : centerX + radiusX * part, y: point.y };
}
