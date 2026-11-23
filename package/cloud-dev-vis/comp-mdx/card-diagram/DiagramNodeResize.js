// What of a node its resize handles change (card-diagram-impl.md#the-selection-and-resizing). Pure.
// One rule for every node of every series, read from what the node is, so no kind has to ask for
// resize handles; a kind for which the rule is wrong says so (contract.resizeAxisList).
//
//   a node drawn to a size (a width and a height written: a shape, a color block, a database)
//                                     its width and its height
//   a node as high as its content (height auto: a table, a note, a resource card)
//                                     its width; the height keeps following the content
//   a node as wide as its words (isWidthFit: a label), drawn around others, derived by a feature,
//   pinned to the viewport, or drawn simple (a mark)
//                                     nothing
//
// contract.resizeAxisList: ['width', 'height'] | ['width'] | ['height'] | [] (a text: its width, so its
// words wrap; an icon: its width; what a generator writes: nothing).
export const NODE_RESIZE_AXIS_LIST = ['width', 'height'];

export function nodeResizeAxisListOf(node, contract) {
	if (!node || node.isDerived || node.around || node.pin !== undefined || node.display === 'simple') return [];
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
