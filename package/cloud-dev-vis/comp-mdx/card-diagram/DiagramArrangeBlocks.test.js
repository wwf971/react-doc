import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramArrangeApply } from './DiagramArrange.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { blockColumnCountOf, blockColumnPlace, diagramArrangerBlocks } from './DiagramArrangeBlocks.js';

const registry = cardDiagramNodeRegistry;
const blockOf = (id, height, x = 0, y = 0) => ({ id, renderer: { type: 'color-block' }, position: { x, y }, size: { width: 240, height }, data: { tone: 'slate', itemList: [] }, handles: [] });
const iconOf = (id, x, y) => ({ id, renderer: { type: 'card-icon' }, position: { x, y }, size: { width: 200, height: 30 }, data: { title: id }, handles: [] });

test('each block goes to the column shortest so far, in its order, one gap between columns and between blocks', () => {
	const { placeList, columnHeight } = blockColumnPlace([300, 500, 200, 100, 150], 3, 20);
	assert.deepEqual(placeList, [{ column: 0, y: 0 }, { column: 1, y: 0 }, { column: 2, y: 0 }, { column: 2, y: 220 }, { column: 0, y: 320 }]);
	assert.deepEqual(columnHeight, [470, 500, 320]);
});

test('without a count, as many columns as make the whole nearest its shape', () => {
	const sizeList = Array.from({ length: 6 }, () => ({ width: 240, height: 240 }));
	assert.equal(blockColumnCountOf(sizeList, 1.5, 0), 3);
	assert.equal(blockColumnCountOf(sizeList, 6, 0), 6);
	assert.equal(blockColumnCountOf([{ width: 240, height: 100 }], 2, 0), 1);
});

test('the cards of a block move with it, their place in the block kept; a card in no block stays', () => {
	// three blocks stacked as written, one card in each, one card in none
	const nodes = [
		blockOf('a', 300, 0, 0), iconOf('a1', 14, 50),
		blockOf('b', 500, 0, 400), iconOf('b1', 14, 460),
		blockOf('c', 200, 0, 1000), iconOf('c1', 20, 1020),
		iconOf('free', 900, 900),
	];
	const { diagram } = diagramArrangeApply({ version: 1, nodes, connections: [] }, diagramArrangerBlocks, { registry, gap: 24, columnCount: 3, origin: { x: 10, y: 10 } });
	const at = Object.fromEntries(diagram.nodes.map((node) => [node.id, node.position]));
	assert.deepEqual(at.a, { x: 10, y: 10 });
	assert.deepEqual(at.b, { x: 274, y: 10 });
	assert.deepEqual(at.c, { x: 538, y: 10 });
	assert.deepEqual(at.a1, { x: 24, y: 60 });
	assert.deepEqual(at.b1, { x: 288, y: 70 });
	assert.deepEqual(at.c1, { x: 558, y: 30 });
	assert.deepEqual(at.free, { x: 900, y: 900 });
});

test('a block may be given its column: stacked there in its order, with the gap between columns its own', () => {
	const nodes = [blockOf('t', 200), blockOf('q1', 100), blockOf('q2', 100), blockOf('r', 150)];
	const { diagram } = diagramArrangeApply({ version: 1, nodes, connections: [] }, diagramArrangerBlocks, { registry, gap: 20, gapColumn: 100, columnById: { t: 0, q1: 1, q2: 1, r: 2 } });
	const at = Object.fromEntries(diagram.nodes.map((node) => [node.id, node.position]));
	assert.deepEqual([at.t, at.q1, at.q2, at.r], [{ x: 0, y: 0 }, { x: 340, y: 0 }, { x: 340, y: 120 }, { x: 680, y: 0 }]);
});

test('a block wider than a column takes as many as its width does, where they are lowest together', () => {
	// columns of 100, gap 20: a block 220 wide takes two
	const { placeList } = blockColumnPlace([100, 300, 50, 80], 3, 20, [], [1, 1, 1, 2]);
	// the wide one: columns 0 and 1 stand 300 high together, 1 and 2 as high; the leftmost of equals
	assert.deepEqual(placeList, [{ column: 0, y: 0 }, { column: 1, y: 0 }, { column: 2, y: 0 }, { column: 0, y: 320 }]);
	const nodes = [blockOf('a', 100), blockOf('b', 100), { ...blockOf('wide', 60), size: { width: 500, height: 60 } }];
	const { diagram } = diagramArrangeApply({ version: 1, nodes, connections: [] }, diagramArrangerBlocks, { registry, gap: 20 });
	const at = Object.fromEntries(diagram.nodes.map((node) => [node.id, node.position]));
	assert.deepEqual([at.a, at.b, at.wide], [{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 0, y: 120 }]);
});

test('a line between cards of two blocks leaves toward the other block, gets a lane in the gap, and the gap is as wide as its lanes', () => {
	const rowOf = (id, x, y, side) => ({ ...iconOf(id, x, y), handles: [{ id: side, anchor: { target: 'body', side } }] });
	const lineOf = (id, source, target) => ({ id, source: { nodeId: source, handleId: 'right' }, target: { nodeId: target, handleId: 'left' }, renderer: { type: 'smoothstep' } });
	const nodes = [
		blockOf('left', 200, 0, 0), ...[1, 2, 3, 4, 5].map((one) => rowOf(`l${one}`, 20, one * 34 - 14, 'right')),
		blockOf('right', 200, 0, 300), rowOf('r1', 20, 340, 'left'),
	];
	const connections = [1, 2, 3, 4, 5].map((one) => lineOf(`line-${one}`, `l${one}`, 'r1'));
	const { diagram, reportList } = diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerBlocks, { registry, gap: 20, columnById: { left: 0, right: 1 } });
	const at = Object.fromEntries(diagram.nodes.map((node) => [node.id, node.position]));
	// five lanes in the gap between, 12 px apart, a place kept at each margin, 40 px from the blocks: wider than the gap of 20 asked
	assert.deepEqual(at.right, { x: 240 + 152, y: 0 });
	assert.deepEqual(at.r1, { x: 240 + 152 + 20, y: 40 });
	assert.deepEqual(reportList, []);
	// each turns in a lane of its own, between the two blocks
	const laneOf = (connection) => at.r1.x + connection.route.anchorList[0].x;
	const laneList = diagram.connections.filter((one) => one.route).map(laneOf);
	assert.equal(new Set(laneList).size, laneList.length);
	// a line turns 40 px from a block at least
	for (const lane of laneList) assert.ok(lane >= 240 + 40 - 0.5 && lane <= 392 - 40 + 0.5, String(lane));
	// a line of two cards of one block is left as it is
	const inner = diagramArrangeApply({ version: 1, nodes, connections: [{ ...lineOf('inner', 'l1', 'l2'), target: { nodeId: 'l2', handleId: 'right' } }] }, diagramArrangerBlocks, { registry, gap: 20, columnById: { left: 0, right: 1 } });
	assert.equal(inner.diagram.connections[0].route, undefined);
});

test('two rows at one height in the gap: the line that must turn before the others turns at the margin, never nearer the block', () => {
	const rowOf = (id, x, y, side) => ({ ...iconOf(id, x, y), handles: [{ id: side, anchor: { target: 'body', side } }] });
	const lineOf = (id, source, target) => ({ id, source: { nodeId: source, handleId: 'right' }, target: { nodeId: target, handleId: 'left' }, renderer: { type: 'smoothstep' } });
	// a and p at one height: a's line to s must turn before b's line to p ends its run at that height
	const nodes = [
		blockOf('left', 200, 0, 0), rowOf('a', 20, 40, 'right'), rowOf('b', 20, 100, 'right'),
		blockOf('top', 120, 0, 300), rowOf('p', 20, 340, 'left'),
		blockOf('bottom', 120, 0, 500), rowOf('s', 20, 560, 'left'),
	];
	const connections = [lineOf('b>p', 'b', 'p'), lineOf('a>s', 'a', 's'), lineOf('b>s', 'b', 's')];
	const { diagram } = diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerBlocks, { registry, gap: 20, columnById: { left: 0, top: 1, bottom: 1 } });
	const at = Object.fromEntries(diagram.nodes.map((node) => [node.id, node.position]));
	const laneOf = (connection) => at[connection.target.nodeId].x + connection.route.anchorList[0].x;
	for (const connection of diagram.connections) {
		const lane = laneOf(connection);
		assert.ok(lane >= 240 + 40 - 0.5 && lane <= at.top.x - 40 + 0.5, `${connection.id} turns at ${lane}, the gap ${240} to ${at.top.x}`);
	}
	assert.equal(new Set(diagram.connections.map(laneOf)).size, 3);
});

test('the ends of a line between blocks of one column both face right, the handle turned', () => {
	const rowOf = (id, x, y) => ({ ...iconOf(id, x, y), handles: [{ id: 'h', anchor: { target: 'body', side: 'left' } }] });
	const nodes = [blockOf('top', 100, 0, 0), rowOf('t1', 20, 30), blockOf('bottom', 100, 0, 200), rowOf('b1', 20, 230)];
	const connections = [{ id: 'down', source: { nodeId: 't1', handleId: 'h' }, target: { nodeId: 'b1', handleId: 'h' }, renderer: { type: 'smoothstep' } }];
	const { diagram } = diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerBlocks, { registry, gap: 20, columnCount: 1 });
	const sideOf = (id) => diagram.nodes.find((node) => node.id === id).handles[0].anchor.side;
	assert.deepEqual([sideOf('t1'), sideOf('b1')], ['right', 'right']);
	assert.ok(diagram.connections[0].route);
});

test('it is offered for a diagram of two blocks or more', () => {
	assert.equal(diagramArrangerBlocks.isApplicable({ nodes: [blockOf('a', 10)] }), false);
	assert.equal(diagramArrangerBlocks.isApplicable({ nodes: [blockOf('a', 10), blockOf('b', 10)] }), true);
});
