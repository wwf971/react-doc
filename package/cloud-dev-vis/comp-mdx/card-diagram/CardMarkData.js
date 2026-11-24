// A mark (card-diagram-impl.md#marks), apart from how it is drawn (CardMark.jsx): a node drawn as a
// shape with its name under it, for a picture of a system at the level of an overview. It is a kind
// of its own, which a series builds (cardMarkKindBuild) for the things it draws as marks, saying what
// a mark shows from its data; how it looks, and where its lines end, is the same for every series,
// so an overview reads as one vocabulary of shapes. A diagram showing the same things as cards and as
// marks (the views of a scene) gives a thing the same node id in each: the switch moves the card into
// its mark.
//
//   shape     tile (a white rounded square, the icon in the accent) | circle | cylinder
//   content   contentGet(data) -> { title, text?, Icon?, iconUrl?, isIconFramed?, tone?, family? }
//             iconUrl: an image that is its own tile (an official service icon), drawn alone at the
//             size of the mark, or with isIconFramed a glyph (a resource icon), drawn inside the shape
//             in place of Icon; family: a class is-{family} a series colors the mark with
//             (--doc-card-accent)
//
// Its handles are on the node as a whole (`body`), so an arranger turns them as those of any card,
// and are drawn on the mark (contract.anchorBodyDrawn): at their side and offset, on the outline of
// the mark (a circle, the caps of a cylinder: anchorOutlineOf), a handle at the bottom under the
// words, at the width of the mark (the anchor `foot`): the mark and its words are one thing, and a
// line leaving downward does not cross its name.
export const CARD_MARK_SHAPE_LIST = ['tile', 'circle', 'cylinder'];
export const CARD_MARK_SIZE = 60;
export const CARD_MARK_SIZE_MIN = 24;
export const CARD_MARK_WIDTH = 132;
// the words under the mark: a gap, a line of title, a line of text
export const CARD_MARK_LABEL_HEIGHT = 38;
export const CARD_MARK_HEIGHT = CARD_MARK_SIZE + CARD_MARK_LABEL_HEIGHT;
// the anchors the handles of a mark are drawn on: the mark, and under the words
export const CARD_MARK_ANCHOR = 'mark';
export const CARD_MARK_ANCHOR_FOOT = 'foot';
const CARD_MARK_BODY_DRAWN = Object.freeze({ left: CARD_MARK_ANCHOR, right: CARD_MARK_ANCHOR, top: CARD_MARK_ANCHOR, bottom: CARD_MARK_ANCHOR_FOOT });
const sideAllList = ['left', 'right', 'top', 'bottom'];

export const cardMarkShapeOf = (shape) => (CARD_MARK_SHAPE_LIST.includes(shape) ? shape : 'tile');

// the size of the mark in a node: its own with a height left to the content, else as large as
// the box leaves above the words (a node drawn to a size keeps it: a large mark in a large box)
export function cardMarkSizeOf(size) {
	if (typeof size?.height !== 'number') return CARD_MARK_SIZE;
	const width = typeof size.width === 'number' ? size.width : Infinity;
	return Math.max(CARD_MARK_SIZE_MIN, Math.min(size.height - CARD_MARK_LABEL_HEIGHT, width));
}

// where the mark is in the rectangle of its node: at the top, in the middle of its width
export function cardMarkRectOf(rect, size) {
	const markSize = cardMarkSizeOf(size);
	return { x: rect.x + (rect.width - markSize) / 2, y: rect.y, width: markSize, height: markSize };
}

// the outline a handle stands on, for the shape of a mark: an ellipse, a cylinder (straight walls,
// elliptic caps) or a rectangle (anchorPointOnOutline, DiagramERData.js)
export const cardMarkOutlineOf = (shape) => (shape === 'circle' ? 'ellipse' : shape === 'cylinder' ? 'cylinder' : 'rect');

// the contract of a kind drawn as a mark: one anchor, the node, drawn on the mark; its box as large
// as a mark and its words, which no resize handle changes
export function cardMarkContractBuild({ shape = 'tile', width = CARD_MARK_WIDTH, ...extra } = {}) {
	const shapeKnown = cardMarkShapeOf(shape);
	return {
		anchorListGet: () => [{ id: 'body', sideList: sideAllList }],
		anchorBodyDrawn: CARD_MARK_BODY_DRAWN,
		// what an arranger assumes with nothing drawn (card-diagram-arrange.md#the-contract)
		anchorRectEstimate: (node, anchorId, rect) => {
			if (anchorId === CARD_MARK_ANCHOR) return cardMarkRectOf(rect, node.size);
			if (anchorId !== CARD_MARK_ANCHOR_FOOT) return rect;
			const mark = cardMarkRectOf(rect, node.size);
			return { x: mark.x, y: rect.y + rect.height, width: mark.width, height: 0 };
		},
		anchorOutlineOf: (_node, anchorId) => (anchorId === CARD_MARK_ANCHOR ? cardMarkOutlineOf(shapeKnown) : 'rect'),
		markShape: shapeKnown,
		sizeDefault: { width, height: CARD_MARK_HEIGHT },
		resizeAxisList: [],
		...extra,
	};
}
