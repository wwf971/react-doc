import assert from 'node:assert/strict';
import test from 'node:test';
import { depthKeyOfConnection, depthKeyOfNode, depthKeyOfTarget, depthRead, depthRectIsOverlapping, diagramDepthMove, diagramDepthOrderListGet, diagramDepthZIndexMapGet } from './DiagramDepth.js';

const node = (id, depth, isBackground = false) => ({ id, isBackground, ...(depth === undefined ? {} : { depth }) });
const line = (id, depth) => ({ id, ...(depth === undefined ? {} : { depth }) });
const keyList = list => list.map(item => item.key);

// the order after the depths a move answered are written
function orderAfter(graph, changed) {
	const depthOf = (key, item) => (changed.has(key) ? { ...item, depth: changed.get(key) } : item);
	return keyList(diagramDepthOrderListGet({
		nodes: graph.nodes.map(item => depthOf(depthKeyOfNode(item.id), item)),
		connections: graph.connections.map(item => depthOf(depthKeyOfConnection(item.id), item)),
	}));
}

const graphBase = { nodes: [node('block', undefined, true), node('a'), node('shape')], connections: [line('l')] };

test('the order without depths: backgrounds, lines, nodes as written', () => {
	assert.deepEqual(keyList(diagramDepthOrderListGet(graphBase)), ['node:block', 'connection:l', 'node:a', 'node:shape']);
});

test('a depth goes before class and index; a pinned node has no place', () => {
	const graph = { nodes: [node('a', 2), node('b'), node('legend', 9), node('back', -1)], connections: [line('l', 1), line('m')] };
	graph.nodes[2].pin = 'top-right';
	assert.deepEqual(keyList(diagramDepthOrderListGet(graph)), ['node:back', 'connection:m', 'node:b', 'connection:l', 'node:a']);
});

test('a node as written is a background when its kind says so', () => {
	const order = diagramDepthOrderListGet({ nodes: [{ id: 'a', renderer: { type: 'table' } }, { id: 'b', renderer: { type: 'color-block' } }], connections: [] }, { isBackgroundOf: item => item.renderer.type === 'color-block' });
	assert.deepEqual(keyList(order), ['node:b', 'node:a']);
});

test('the z-index of a diagram without depths is what it always was', () => {
	const map = diagramDepthZIndexMapGet(graphBase);
	assert.deepEqual([...map], [['node:block', -1], ['connection:l', 0], ['node:a', 0], ['node:shape', 0]]);
});

test('the z-index ranks the depths, 0 at rank 0 also when nothing has it', () => {
	const map = diagramDepthZIndexMapGet({ nodes: [node('block', 5, true), node('a', 5), node('b', -0.5), node('c', 12)], connections: [line('l', 5), line('m', -0.5)] });
	assert.equal(map.get('node:b'), -2);
	assert.equal(map.get('connection:m'), -2);
	assert.equal(map.get('node:block'), 1);
	assert.equal(map.get('connection:l'), 2);
	assert.equal(map.get('node:a'), 2);
	assert.equal(map.get('node:c'), 4);
});

test('to the front and to the back change only the target, and nothing when it is there', () => {
	const order = diagramDepthOrderListGet(graphBase);
	const front = diagramDepthMove(order, 'node:a', 'front');
	assert.deepEqual([...front], [['node:a', 1]]);
	assert.equal(orderAfter(graphBase, front).at(-1), 'node:a');
	assert.equal(diagramDepthMove(order, 'node:shape', 'front').size, 0);
	const back = diagramDepthMove(order, 'node:shape', 'back');
	assert.deepEqual([...back], [['node:shape', -1]]);
	assert.equal(orderAfter(graphBase, back)[0], 'node:shape');
	assert.equal(diagramDepthMove(order, 'node:block', 'back').size, 0);
	// a line to the front: over every node
	const lineFront = diagramDepthMove(order, 'connection:l', 'front');
	assert.deepEqual([...lineFront], [['connection:l', 1]]);
});

test('a block to the front stays at its depth when its class allows no less', () => {
	const order = diagramDepthOrderListGet(graphBase);
	const front = diagramDepthMove(order, 'node:block', 'front');
	assert.deepEqual([...front], [['node:block', 1]]);
});

test('a shape sent backward goes between the block and the line', () => {
	const graph = { nodes: [node('block', undefined, true), node('shape')], connections: [line('l')] };
	const order = diagramDepthOrderListGet(graph);
	const changed = diagramDepthMove(order, 'node:shape', 'backward');
	assert.deepEqual(orderAfter(graph, changed), ['node:block', 'node:shape', 'connection:l']);
	assert.equal(changed.size, 1);
	assert.deepEqual([...changed], [['connection:l', 1]]);
});

test('a step keeps every other pair in its order, whatever it costs', () => {
	// other nodes over the line: sending the shape under the line must leave them over it
	const order = diagramDepthOrderListGet(graphBase);
	const changed = diagramDepthMove(order, 'node:shape', 'backward', { overlapKeySet: new Set(['connection:l', 'node:block']) });
	assert.deepEqual(orderAfter(graphBase, changed), ['node:block', 'node:shape', 'connection:l', 'node:a']);
});

test('forward and backward step over the nearest thing lying on the target', () => {
	const graph = { nodes: [node('a'), node('b'), node('c'), node('d')], connections: [] };
	const order = diagramDepthOrderListGet(graph);
	// a is under b, c, d; only d lies on it
	const changed = diagramDepthMove(order, 'node:a', 'forward', { overlapKeySet: new Set(['node:d']) });
	assert.deepEqual(orderAfter(graph, changed), ['node:b', 'node:c', 'node:d', 'node:a']);
	assert.deepEqual([...changed], [['node:a', 1]]);
	// without the overlap: one step in the order
	const step = diagramDepthMove(order, 'node:a', 'forward');
	assert.deepEqual(orderAfter(graph, step), ['node:b', 'node:a', 'node:c', 'node:d']);
	// nothing lies over it
	assert.equal(diagramDepthMove(order, 'node:a', 'forward', { overlapKeySet: new Set() }).size, 0);
	assert.equal(diagramDepthMove(order, 'node:a', 'backward').size, 0);
	assert.equal(diagramDepthMove(order, 'node:d', 'forward').size, 0);
	const down = diagramDepthMove(order, 'node:d', 'backward', { overlapKeySet: new Set(['node:b']) });
	assert.deepEqual(orderAfter(graph, down), ['node:a', 'node:d', 'node:b', 'node:c']);
});

test('depths written by hand that are not whole', () => {
	const graph = { nodes: [node('a', 0.5), node('b', 1.5), node('c', 0.25)], connections: [] };
	const order = diagramDepthOrderListGet(graph);
	assert.deepEqual(keyList(order), ['node:c', 'node:a', 'node:b']);
	// c between a and b: the depth of a, over which it is as the one written later
	const changed = diagramDepthMove(order, 'node:c', 'forward');
	assert.deepEqual([...changed], [['node:c', 0.5]]);
	assert.deepEqual(orderAfter(graph, changed), ['node:a', 'node:c', 'node:b']);
	// written before a: the next whole number over a, when it is under b
	const whole = { nodes: [node('c', 0.25), node('a', 0.5), node('b', 1.5)], connections: [] };
	assert.deepEqual([...diagramDepthMove(diagramDepthOrderListGet(whole), 'node:c', 'forward')], [['node:c', 1]]);
	// a line between a node under it and a block over it, no whole number between: the middle
	const tight = { nodes: [node('a', 0.2), node('block', 0.6, true)], connections: [line('l', 0.1)] };
	const middle = diagramDepthMove(diagramDepthOrderListGet(tight), 'connection:l', 'forward');
	assert.deepEqual([...middle], [['connection:l', 0.4]]);
	assert.deepEqual(orderAfter(tight, middle), ['node:a', 'connection:l', 'node:block']);
	const front = diagramDepthMove(order, 'node:c', 'front');
	assert.deepEqual([...front], [['node:c', 1.5]]);
	assert.deepEqual([...diagramDepthMove(diagramDepthOrderListGet(whole), 'node:c', 'front')], [['node:c', 2]]);
});

test('every move of every thing gives exactly the order asked for', () => {
	const graph = { nodes: [node('k', undefined, true), node('a'), node('b', 1), node('c', 1), node('d', -2), node('e', 0.5, true)], connections: [line('l'), line('m', 1), line('n', -2)] };
	const order = diagramDepthOrderListGet(graph);
	for (const target of order) {
		const rest = keyList(order).filter(key => key !== target.key);
		const at = order.indexOf(target);
		const expectedByHow = {
			front: [...rest, target.key],
			back: [target.key, ...rest],
			forward: at < order.length - 1 ? [...rest.slice(0, at + 1), target.key, ...rest.slice(at + 1)] : keyList(order),
			backward: at > 0 ? [...rest.slice(0, at - 1), target.key, ...rest.slice(at - 1)] : keyList(order),
		};
		for (const [how, expected] of Object.entries(expectedByHow)) {
			assert.deepEqual(orderAfter(graph, diagramDepthMove(order, target.key, how)), expected, `${target.key} ${how}`);
		}
	}
});

test('reading a depth, the key of a target, boxes lying on each other', () => {
	assert.equal(depthRead(undefined, 'a'), 0);
	assert.equal(depthRead(-3.5, 'a'), -3.5);
	assert.throws(() => depthRead('2', 'a'), /a\.depth must be a number/);
	assert.throws(() => depthRead(Infinity, 'a'), /a\.depth/);
	assert.equal(depthKeyOfTarget({ nodeId: 'a' }), 'node:a');
	assert.equal(depthKeyOfTarget({ connectionId: 'l' }), 'connection:l');
	assert.equal(depthRectIsOverlapping({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), true);
	assert.equal(depthRectIsOverlapping({ x: 0, y: 0, width: 10, height: 10 }, { x: 40, y: 0, width: 10, height: 10 }), false);
	// a level line has no height
	assert.equal(depthRectIsOverlapping({ x: 0, y: 5, width: 100, height: 0 }, { x: 20, y: 0, width: 10, height: 10 }), true);
});
