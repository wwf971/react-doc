// What of a node its resize handles change (card-diagram-impl.md#the-selection-and-resizing). Pure.
// One rule for every node of every series, read from what the node is, so no kind has to ask for
// resize handles; a kind for which the rule is wrong says so (contract.resizeAxisList).
//
//   a node drawn to a size (a width and a height written: a shape, a color block, a database)
//                                     its width and its height
//   a node as high as its content (height auto: a table, a note, a resource card)
//                                     its width; the height keeps following the content
//   a node as wide as its words (isWidthFit: a label), drawn around others, derived by a feature,
//   or pinned to the viewport
//                                     nothing
//
// contract.resizeAxisList: ['width', 'height'] | ['width'] | ['height'] | [] (an icon: its width; a
// mark, what a generator writes: nothing). A kind that lists its size modes (below) is resized as its mode says.
export const NODE_RESIZE_AXIS_LIST = ['width', 'height'];

export function nodeResizeAxisListOf(node, contract) {
	if (!node || node.isDerived || node.around || node.pin !== undefined) return [];
	if (contract?.sizeModeList) return NODE_SIZE_MODE_BY_ID[nodeSizeModeOf(node)].axisList;
	if (Array.isArray(contract?.resizeAxisList)) return contract.resizeAxisList.filter(axis => NODE_RESIZE_AXIS_LIST.includes(axis));
	if (node.isWidthFit) return [];
	return node.size?.height === 'auto' ? ['width'] : ['width', 'height'];
}

// where the resize handles of a box stand, for whoever must keep clear of them (the origin of a
// parametric group): the corners, and the middles of the edges that change
export function nodeResizeHandlePointListOf(box, axisList) {
	if (!axisList.length) return [];
	const isWidth = axisList.includes('width');
	const isHeight = axisList.includes('height');
	const pointList = [[0, 0], [1, 0], [0, 1], [1, 1]];
	if (isWidth) pointList.push([0, 0.5], [1, 0.5]);
	if (isHeight) pointList.push([0.5, 0], [0.5, 1]);
	return pointList.map(([fx, fy]) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy }));
}

// The size modes of a node: how its box is taken, for a kind whose box follows what it holds (a
// text, a component in a card). contract.sizeModeList lists the modes of the kind (an id, or
// { id, label, note } in the kind's own words), the first being that of a node with no size
// written; the edit card switches between them (Box) when there are several. The mode is read from
// the size as written, never written beside it, so the two cannot disagree:
//
//   fit    no size: as wide and as high as what it holds (a text: its words, lines broken only
//          where they say); nothing to resize (the box is derived from what it holds)
//   wrap   a width alone: what it holds takes that width (a text wraps within it, a long word
//          too), its height follows; its width resized
//   tall   a height alone: as wide as what it holds, its height given; its height resized
//   box    a width and a height; both resized
// what does not fit an axis given is the kind's to show: a component in a card scrolls it
// (card-diagram-impl.md#a-component-in-a-card)
export const NODE_SIZE_MODE_BY_ID = {
	fit: { id: 'fit', label: 'Fits the words', note: 'The box follows the words; Shift + Enter breaks a line.', sizeText: 'no size', axisList: [] },
	wrap: { id: 'wrap', label: 'A width, the words wrap', note: '', sizeText: 'a width alone', axisList: ['width'] },
	tall: { id: 'tall', label: 'A height, the width follows', note: '', sizeText: 'a height alone', axisList: ['height'] },
	box: { id: 'box', label: 'A width and a height', note: '', sizeText: 'a width and a height', axisList: ['width', 'height'] },
};

// the modes a kind lists, each with its words: [{ id, label, note, sizeText, axisList }]
export function nodeSizeModeListOf(contract) {
	return (Array.isArray(contract?.sizeModeList) ? contract.sizeModeList : []).map((item) => {
		const id = typeof item === 'string' ? item : item?.id;
		const mode = NODE_SIZE_MODE_BY_ID[id];
		if (!mode) return null;
		return typeof item === 'string' ? mode : { ...mode, label: item.label ?? mode.label, note: item.note ?? mode.note };
	}).filter(Boolean);
}

// the ids of the modes a kind lists
export function nodeSizeModeIdListOf(contract) {
	return nodeSizeModeListOf(contract).map(mode => mode.id);
}

// the mode of a node as normalized (size: { width, height }, each a number or 'auto')
export function nodeSizeModeOf(node) {
	const isWidth = typeof node.size?.width === 'number';
	const isHeight = typeof node.size?.height === 'number';
	if (isWidth) return isHeight ? 'box' : 'wrap';
	return isHeight ? 'tall' : 'fit';
}

// the size a node takes in a mode, from the box it has now (as measured, else as written): the
// same box at the moment of the switch, so nothing jumps; undefined: no size at all. Rounded up,
// a pixel spare: the browser rounds what it measures, and a box a hair narrower than its words
// would wrap the last of them
export function nodeSizeOfMode(mode, boxNow) {
	if (mode === 'fit') return undefined;
	const width = Math.max(1, Math.ceil(boxNow.width) + 1);
	const height = Math.max(1, Math.ceil(boxNow.height) + 1);
	if (mode === 'wrap') return { width };
	if (mode === 'tall') return { height };
	return { width, height };
}
