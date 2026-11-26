// The depth of the things of a diagram (card-diagram-impl.md#depth): which is drawn over which. Pure.
//
// A node and a connection may write `depth`, a number, 0 when absent. The drawing order, from the
// bottom to the top, is the order by three things:
//
//   depth       a higher one is drawn over a lower one
//   class       at one depth: a background (a color block) under the lines, the lines under the nodes
//   index       at one depth and class: what is written later over what is written earlier
//
// So a diagram that writes no depth is drawn as it always was. A node pinned to the viewport is not
// on the canvas and has no place in this order; a node a feature derives (a copy of a repeat) has
// the depth of its source.
//
//   diagramDepthOrderListGet   the things in drawing order
//   diagramDepthZIndexMapGet   the z-index each thing is drawn with (React Flow, the static renderers)
//   diagramDepthMove           the depths to write so that one thing goes to the front, to the back,
//                              or one step over or under what lies on it
export const DEPTH_CLASS_BACKGROUND = 0;
export const DEPTH_CLASS_LINE = 1;
export const DEPTH_CLASS_NODE = 2;
export const DEPTH_MOVE_LIST = ['front', 'forward', 'backward', 'back'];
export const DEPTH_MOVE_LABEL = { front: 'Bring to front', forward: 'Bring forward', backward: 'Send backward', back: 'Send to back' };
export const DEPTH_MOVE_DESCRIPTION = { front: 'over everything', forward: 'over the nearest thing lying on it', backward: 'under the nearest thing lying under it', back: 'under everything' };
// the keys of each move in the editor (DiagramVisualEdit.jsx)
export const DEPTH_MOVE_KEY = { front: 'Ctrl/⌘ + Shift + ]', forward: 'Ctrl/⌘ + ]', backward: 'Ctrl/⌘ + [', back: 'Ctrl/⌘ + Shift + [' };

export const depthKeyOfNode = nodeId => `node:${nodeId}`;
export const depthKeyOfConnection = connectionId => `connection:${connectionId}`;
// the key of a target of the editor: { nodeId } or { connectionId }
export const depthKeyOfTarget = target => (target?.connectionId !== undefined && target?.nodeId === undefined ? depthKeyOfConnection(target.connectionId) : depthKeyOfNode(target?.nodeId));

// the target of the editor a key stands for
export const depthTargetOfKey = key => (key.startsWith('connection:') ? { connectionId: key.slice('connection:'.length) } : { nodeId: key.slice('node:'.length) });

// why a move has nothing to do, in a few words
export const DEPTH_MOVE_NOTHING_REASON = { front: 'It is in front of everything already.', back: 'It is behind everything already.', forward: 'Nothing lies over it.', backward: 'Nothing lies under it.' };

// the depth of a thing as written: a finite number, 0 when absent. Throws naming the field
export function depthRead(value, field) {
	if (value === undefined || value === null) return 0;
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field}.depth must be a number: a higher one is drawn over a lower one.`);
	return value;
}

const depthOf = item => (typeof item?.depth === 'number' && Number.isFinite(item.depth) ? item.depth : 0);

// a thing over another in the drawing order: by depth, then class, then index
function orderCompare(a, b) {
	return a.depth - b.depth || a.classRank - b.classRank || a.index - b.index;
}

// the things of a diagram in drawing order, bottom to top:
//   [{ key, kind: 'node' | 'connection', id, depth, classRank, index }]
// nodes, connections: as normalized (isBackground on a node) or as written; isBackgroundOf(node):
// whether a node as written is a background, where the nodes are not normalized
export function diagramDepthOrderListGet({ nodes = [], connections = [] } = {}, { isBackgroundOf = node => node.isBackground === true } = {}) {
	const list = [];
	nodes.forEach((node, index) => {
		if (!node || node.pin !== undefined) return;
		list.push({ key: depthKeyOfNode(node.id), kind: 'node', id: node.id, depth: depthOf(node), classRank: isBackgroundOf(node) ? DEPTH_CLASS_BACKGROUND : DEPTH_CLASS_NODE, index });
	});
	connections.forEach((connection, index) => {
		if (!connection) return;
		list.push({ key: depthKeyOfConnection(connection.id), kind: 'connection', id: connection.id, depth: depthOf(connection), classRank: DEPTH_CLASS_LINE, index });
	});
	return list.sort(orderCompare);
}

// the z-index each thing is drawn with: Map key -> integer. The depths written are ranked, 0 at
// rank 0 (also when nothing has it); at rank r a background is 2r - 1, a line and a node 2r (a line
// is drawn before a node in every renderer, so it stays under it). A diagram that writes no depth
// gets the numbers it always had: backgrounds -1, lines and nodes 0
export function diagramDepthZIndexMapGet(graph, option) {
	const orderList = diagramDepthOrderListGet(graph, option);
	const depthList = [...new Set([0, ...orderList.map(item => item.depth)])].sort((a, b) => a - b);
	const rankZero = depthList.indexOf(0);
	const rankByDepth = new Map(depthList.map((depth, index) => [depth, index - rankZero]));
	return new Map(orderList.map(item => [item.key, 2 * rankByDepth.get(item.depth) - (item.classRank === DEPTH_CLASS_BACKGROUND ? 1 : 0)]));
}

// the same, kept for a graph as normalized (never changed once read): for a renderer that draws it
// again and again (a diagram without a canvas, a scene inside a card)
const zIndexMapByGraph = new WeakMap();
export function diagramDepthZIndexMapOf(graph) {
	if (!graph) return new Map();
	if (!zIndexMapByGraph.has(graph)) zIndexMapByGraph.set(graph, diagramDepthZIndexMapGet(graph));
	return zIndexMapByGraph.get(graph);
}

// the highest z-index of a diagram, never under 0: what must stay over everything is drawn above it
export function depthZIndexTopGet(zIndexByKey) {
	let top = 0;
	for (const zIndex of zIndexByKey.values()) if (zIndex > top) top = zIndex;
	return top;
}

// the lines of a diagram by the z-index they are drawn with, lowest first: a renderer that draws
// its lines in an svg draws one svg per level, so a line with a depth is over or under the cards
//   lineList   [{ connection, ... }]  ->  [{ zIndex, lineList }]
export function depthLineLevelListGet(lineList, zIndexByKey) {
	const listByZIndex = new Map();
	for (const line of lineList) {
		const zIndex = zIndexByKey.get(depthKeyOfConnection(line.connection.id)) ?? 0;
		if (!listByZIndex.has(zIndex)) listByZIndex.set(zIndex, []);
		listByZIndex.get(zIndex).push(line);
	}
	return [...listByZIndex].sort((a, b) => a[0] - b[0]).map(([zIndex, list]) => ({ zIndex, lineList: list }));
}

const tieIsOver = (a, b) => a.classRank - b.classRank > 0 || (a.classRank === b.classRank && a.index > b.index);

// the depths of a list that is the drawing order wanted, bottom to top, each thing keeping its
// depth where that keeps the order. isUpward: read from the bottom, a thing that would not be over
// the one before takes the smallest step up that puts it there; else read from the top, the mirror
function depthListAssign(list, isUpward) {
	const result = new Map();
	const sequence = isUpward ? list : [...list].reverse();
	let before = null;
	for (const item of sequence) {
		let depth = item.depth;
		if (before) {
			const isTieKept = isUpward ? tieIsOver(item, before) : tieIsOver(before, item);
			const isKept = isUpward ? depth > before.depth || (depth === before.depth && isTieKept) : depth < before.depth || (depth === before.depth && isTieKept);
			if (!isKept) depth = isTieKept ? before.depth : isUpward ? Math.floor(before.depth) + 1 : Math.ceil(before.depth) - 1;
		}
		if (depth !== item.depth) result.set(item.key, depth);
		before = { ...item, depth };
	}
	return result;
}

// a depth for the target alone that puts it between its two neighbours in the list, when there is
// one: a whole number first, else the middle of the two
function depthOfTargetAloneGet(list, at) {
	const item = list[at];
	const under = list[at - 1] ?? null;
	const over = list[at + 1] ?? null;
	const isFitting = (depth) => {
		const one = { ...item, depth };
		return (!under || orderCompare(one, under) > 0) && (!over || orderCompare(over, one) > 0);
	};
	const candidateList = [
		...(under ? [under.depth, Math.floor(under.depth) + 1] : []),
		...(over ? [over.depth, Math.ceil(over.depth) - 1] : []),
		...(under && over && under.depth < over.depth ? [(under.depth + over.depth) / 2] : []),
	];
	return candidateList.find(isFitting);
}

// One thing moved in the drawing order: the depths to write, Map key -> depth, of the things whose
// depth changes (empty: nothing to do, the thing is there already or nothing lies over / under it).
//   orderList       diagramDepthOrderListGet
//   targetKey       the thing moved
//   how             front (over everything), back (under everything),
//                   forward (just over the nearest thing over it), backward (just under the nearest under it)
//   overlapKeySet   the things lying on the target as drawn: forward and backward step over the
//                   nearest of them, so each step is seen; every thing when absent
// The result is exact: the target takes its new place and every other pair of things keeps its
// order. As few depths as possible are written: the target alone where a depth of its own fits
// between its new neighbours, else whichever of reading upward and reading downward changes fewer.
export function diagramDepthMove(orderList, targetKey, how, { overlapKeySet } = {}) {
	const at = orderList.findIndex(item => item.key === targetKey);
	if (at < 0) return new Map();
	const target = orderList[at];
	const rest = orderList.filter(item => item.key !== targetKey);
	let atNew;
	if (how === 'front') atNew = rest.length;
	else if (how === 'back') atNew = 0;
	else {
		const isCounted = item => !overlapKeySet || overlapKeySet.has(item.key);
		if (how === 'forward') {
			const index = orderList.findIndex((item, indexItem) => indexItem > at && isCounted(item));
			if (index < 0) return new Map();
			// just over it: after it in the list without the target
			atNew = index;
		} else if (how === 'backward') {
			let index = -1;
			for (let indexItem = at - 1; indexItem >= 0; indexItem -= 1) if (isCounted(orderList[indexItem])) { index = indexItem; break; }
			if (index < 0) return new Map();
			atNew = index;
		} else return new Map();
	}
	if (atNew === at) return new Map();
	const list = [...rest.slice(0, atNew), target, ...rest.slice(atNew)];
	const depthAlone = depthOfTargetAloneGet(list, atNew);
	if (depthAlone !== undefined) return depthAlone === target.depth ? new Map() : new Map([[targetKey, depthAlone]]);
	const upward = depthListAssign(list, true);
	const downward = depthListAssign(list, false);
	return downward.size < upward.size ? downward : upward;
}

// two boxes lying on each other ({ x, y, width, height }), with a little room: a level line has no height
export function depthRectIsOverlapping(a, b, margin = 2) {
	return a.x - margin < b.x + b.width && a.x + a.width + margin > b.x && a.y - margin < b.y + b.height && a.y + a.height + margin > b.y;
}
