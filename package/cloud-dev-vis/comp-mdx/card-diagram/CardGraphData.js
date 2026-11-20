// A graph in one card (CardGraph.jsx): many things, each a small square or a label, and the lines
// between them, drawn by one node of a diagram however many there are, for a graph too large for a
// node per thing (thousands of tables and what looks up what). Whoever builds it places the items
// (diagramScatterLayout); the card draws them where they are said to be.
//
//   data { itemList: [{ id, x, y, shape: square | label, width?, title, text?, tone?, variant?, link? }],
//          lineList: [{ from, to, color?, dash?, width?, opacity?, isArrow?, title? }],
//          squareSize?, labelHeight? }
//   x, y        the top left of an item in the card; a label is width wide (else as wide as
//               labelWidthEstimate says), a square squareSize (14)
//   tone        of the compact cards; variant: dashed | bar
//   link        what a click on the item opens on a canvas that switches scenes (data-switch-link)
//   lineList    from an item to an item (their ids), straight, from the edge of one to the edge of
//               the other, an arrow at its end unless isArrow is false; opacity: a line that tells
//               little drawn lighter (a pointer on its item lights it whole); title: what a pointer
//               resting on it reads
//
// A search finds an item by either of its names (title, text), marked where it is drawn
// ([data-search-part="item/{id}"]): a square found shows its name beside it, and the camera
// brings it into view. A pointer resting on an item shows its name and lights its lines.
export const CARD_GRAPH_TONE_LIST = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'];
export const CARD_GRAPH_SQUARE_SIZE = 14;
export const CARD_GRAPH_LABEL_HEIGHT = 22;
const PAD = 16;

// how wide a label of these words is drawn, about: what a generator places it by
export function cardGraphLabelWidthEstimate(title, { min = 56, max = 200 } = {}) {
	const text = String(title ?? '');
	let width = 0;
	for (const character of text) width += character.charCodeAt(0) > 0x2e80 ? 11 : 6.2;
	return Math.round(Math.max(min, Math.min(max, width + 18)));
}

export function cardGraphItemSizeOf(data, item) {
	if (item.shape === 'label') return { width: item.width ?? cardGraphLabelWidthEstimate(item.title), height: data.labelHeight ?? CARD_GRAPH_LABEL_HEIGHT };
	const size = data.squareSize ?? CARD_GRAPH_SQUARE_SIZE;
	return { width: size, height: size };
}

export function cardGraphNormalize(data) {
	if (!Array.isArray(data.itemList)) throw new Error('A graph card needs itemList.');
	if (data.lineList !== undefined && !Array.isArray(data.lineList)) throw new Error('The lineList of a graph card is a list.');
	const idSet = new Set();
	for (const item of data.itemList) {
		if (!item || typeof item.id !== 'string' || !item.id || idSet.has(item.id)) throw new Error('Every item of a graph card needs a unique nonempty id.');
		if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) throw new Error(`The item ${item.id} of a graph card needs x and y.`);
		if (!['square', 'label'].includes(item.shape)) throw new Error(`The item ${item.id} of a graph card is a square or a label.`);
		if (item.tone !== undefined && !CARD_GRAPH_TONE_LIST.includes(item.tone)) throw new Error(`The tone of ${item.id} is one of ${CARD_GRAPH_TONE_LIST.join(', ')}.`);
		idSet.add(item.id);
	}
	for (const line of data.lineList ?? []) {
		if (!idSet.has(line?.from) || !idSet.has(line?.to)) throw new Error(`A line of a graph card joins two of its items: ${line?.from} → ${line?.to}.`);
	}
	return data;
}

// as large as its items reach, and a margin
export function cardGraphSizeGet(data) {
	let width = 0;
	let height = 0;
	for (const item of data.itemList) {
		const size = cardGraphItemSizeOf(data, item);
		width = Math.max(width, item.x + size.width);
		height = Math.max(height, item.y + size.height);
	}
	return { width: Math.ceil(width + PAD * 2), height: Math.ceil(height + PAD * 2) };
}

export const CARD_GRAPH_PAD = PAD;

// the point where a line from the middle of a box towards a point leaves the box
export function cardGraphEdgePoint(box, toward) {
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const dx = toward.x - cx;
	const dy = toward.y - cy;
	if (dx === 0 && dy === 0) return { x: cx, y: cy };
	const scale = Math.min(dx === 0 ? Infinity : (box.width / 2) / Math.abs(dx), dy === 0 ? Infinity : (box.height / 2) / Math.abs(dy));
	return { x: cx + dx * scale, y: cy + dy * scale };
}

// what a search of the canvas finds in it (DiagramSearch.js): each item by either of its names
export function cardGraphSearchMatch(node, helper) {
	const partList = (node.data?.itemList ?? []).filter((item) => helper.test(item.title) || helper.test(item.text)).map((item) => ({ id: `item/${item.id}` }));
	return partList.length ? { partList, childList: [] } : null;
}
