import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramArrangeApply } from './DiagramArrange.js';
import { routeOverlapListGet, routePathPolylineGet, routeResolve } from './DiagramRoute.js';
import { diagramNormalize } from './DiagramERData.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { diagramGeometryEstimateBuild } from './DiagramArrangeOutline.js';
import { diagramArrangerRows } from './DiagramArrangeRows.js';

const registry = cardDiagramNodeRegistry;
const WIDTH = 200;
const HEIGHT = 30;
// a handle: [id, direction, side, anchor]: on the mark of the node, or at the end of its words
const iconOf = (id, handleList) => ({ id, renderer: { type: 'card-icon' }, position: { x: 0, y: 0 }, size: { width: WIDTH, height: HEIGHT }, data: { title: id },
	handles: handleList.map(([handleId, direction, side, target = 'icon']) => ({ id: handleId, direction, anchor: { target, side } })) });
const lineOf = (id, source, target) => ({ id, source: { nodeId: source[0], handleId: source[1] }, target: { nodeId: target[0], handleId: target[1] } });
const DOWN = ['down', 'out', 'bottom'];
const UP = ['up', 'in', 'top'];
const KEYS = ['keys', 'out', 'right', 'text'];
const BESIDE = ['beside', 'in', 'right', 'text'];
const LEFT = ['left', 'in', 'left'];

// the steps of a plan: a main column, what is computed for it a column to the right, and what is
// computed for that a column further. b is used again further down, by g and m of the next column,
// past e and f of its own; c is used again by m, past d, g and n; n is joined to h, past m
//
//   row   0 a   1 b   2 c   3 d   4 e   5 f   6 g   7 k   8 n   9 m   10 h
//   col   0     0     1     1     0     0     1     2     1     1     0
function planBuild(options = {}) {
	const nodes = [
		iconOf('a', [DOWN, KEYS]), iconOf('b', [UP, DOWN]), iconOf('c', [UP, DOWN]), iconOf('d', [UP, DOWN]), iconOf('e', [UP, DOWN, BESIDE]), iconOf('f', [UP, DOWN]),
		iconOf('g', [LEFT, DOWN, KEYS]), iconOf('k', [UP, DOWN]), iconOf('n', [UP, DOWN, BESIDE]), iconOf('m', [UP, LEFT]), iconOf('h', [UP, BESIDE]),
	];
	const connections = [
		lineOf('a-b', ['a', 'down'], ['b', 'up']), lineOf('a-c', ['a', 'keys'], ['c', 'up']), lineOf('c-d', ['c', 'down'], ['d', 'up']), lineOf('d-e', ['d', 'down'], ['e', 'beside']),
		lineOf('b-e', ['b', 'down'], ['e', 'up']), lineOf('e-f', ['e', 'down'], ['f', 'up']), lineOf('f-h', ['f', 'down'], ['h', 'up']),
		lineOf('b-g', ['b', 'down'], ['g', 'left']), lineOf('b-m', ['b', 'down'], ['m', 'left']), lineOf('g-k', ['g', 'keys'], ['k', 'up']), lineOf('k-n', ['k', 'down'], ['n', 'beside']),
		lineOf('g-n', ['g', 'down'], ['n', 'up']), lineOf('c-m', ['c', 'down'], ['m', 'up']), lineOf('n-h', ['n', 'down'], ['h', 'beside']),
	];
	const columnById = { c: 1, d: 1, g: 1, k: 2, n: 1, m: 1 };
	return diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerRows, { registry, columnById, ...options });
}

function lineListOf(diagram) {
	const geometry = diagramGeometryEstimateBuild(diagram, { registry });
	return diagram.connections.map((connection) => {
		const a = geometry.endOf(connection, 'source');
		const b = geometry.endOf(connection, 'target');
		const ends = { sourceX: a.x, sourceY: a.y, sourcePosition: a.side, targetX: b.x, targetY: b.y, targetPosition: b.side };
		return { id: connection.id, connection, d: routeResolve('step', connection.route ?? null, ends).d, sourceKey: `${connection.source.nodeId}/${connection.source.handleId}`, targetKey: `${connection.target.nodeId}/${connection.target.handleId}` };
	});
}

// the stretches of a line that run along a node it does not end at, nearer than `margin`
function alongNodeListGet(diagram, margin) {
	const out = [];
	for (const line of lineListOf(diagram)) {
		const pointList = routePathPolylineGet(line.d);
		for (const node of diagram.nodes) {
			if (node.id === line.connection.source.nodeId || node.id === line.connection.target.nodeId) continue;
			const rect = { left: node.position.x - margin, right: node.position.x + node.size.width + margin, top: node.position.y - margin, bottom: node.position.y + node.size.height + margin };
			for (let index = 1; index < pointList.length; index += 1) {
				const [p, q] = [pointList[index - 1], pointList[index]];
				if (Math.max(p.x, q.x) > rect.left && Math.min(p.x, q.x) < rect.right && Math.max(p.y, q.y) > rect.top && Math.min(p.y, q.y) < rect.bottom) out.push(`${line.id} along ${node.id}`);
			}
		}
	}
	return out;
}

test('the rows stand one under another, each in its column, a column as far from the one at its left as the lines between them need', () => {
	const { diagram, reportList } = planBuild();
	assert.deepEqual(reportList, []);
	const positionOf = (id) => diagram.nodes.find((node) => node.id === id).position;
	assert.deepEqual(positionOf('a'), { x: 0, y: 0 });
	assert.deepEqual(positionOf('b'), { x: 0, y: 40 });
	// b turns twice in the gap under it (to g and to m): the gap is a level higher
	assert.equal(positionOf('c').y - positionOf('b').y, HEIGHT + 10 + 6);
	// the channel left of column 2 holds b to g, b to m and c to m beside column 2, and n to h beside column 1: four tracks
	assert.equal(positionOf('c').x, WIDTH + 5 * 12);
	assert.equal(positionOf('g').x, positionOf('c').x);
	// nothing runs in the channel left of column 3: the columns stand the least apart
	assert.equal(positionOf('k').x, positionOf('c').x + WIDTH + 24);
	assert.equal(diagramNormalize(diagram, registry).nodes.length, 11);
});

test('the lines of the rows are straight stretches, none lies on another, none runs along a node', () => {
	const { diagram } = planBuild();
	const lineList = lineListOf(diagram);
	for (const line of lineList) {
		const pointList = routePathPolylineGet(line.d);
		for (let index = 1; index < pointList.length; index += 1) {
			const isStraight = Math.abs(pointList[index].x - pointList[index - 1].x) < 0.01 || Math.abs(pointList[index].y - pointList[index - 1].y) < 0.01;
			assert.ok(isStraight, `${line.id} has a slanted stretch`);
		}
	}
	assert.deepEqual(routeOverlapListGet(lineList), []);
	assert.deepEqual(alongNodeListGet(diagram, 3), []);
});

test('a line turns once where its way down is free, and takes a track of a channel where it is not', () => {
	const { diagram } = planBuild();
	const lineList = lineListOf(diagram);
	const pointsOf = (id) => routePathPolylineGet(lineList.find((line) => line.id === id).d);
	const positionOf = (id) => diagram.nodes.find((node) => node.id === id).position;
	const markX = (id) => positionOf(id).x + 13;
	// down the column of d, then into the end of the words of e: one corner, under the mark of d
	assert.deepEqual(pointsOf('d-e').map((point) => point.x).slice(0, 2), [markX('d'), markX('d')]);
	assert.equal(pointsOf('d-e').length, 3);
	// along the row of a, then down into the top of c: one corner, over the mark of c
	assert.equal(pointsOf('a-c').length, 3);
	assert.equal(pointsOf('a-c')[1].x, markX('c'));
	// b to e is straight down its column: c and d stand in another
	assert.ok(pointsOf('b-e').every((point) => point.x === markX('b')));
	// b to g and b to m: e and f stand in the way down, so each goes by a track of the channel left of column 2,
	// the nearer one turning higher and running nearer the column: they do not cross. The shorter a line, the
	// nearer its track: c to m runs between them
	const [toG, toM] = [pointsOf('b-g'), pointsOf('b-m')];
	const trackOf = (pointList) => pointList[2].x;
	assert.equal(trackOf(toG), positionOf('g').x - 12);
	assert.equal(trackOf(toM), positionOf('g').x - 36);
	assert.equal(toM[1].y - toG[1].y, 6);
	// c to m, in one column past d, g and n: out to the channel left of the column, and back in over m
	assert.equal(trackOf(pointsOf('c-m')), positionOf('g').x - 24);
	assert.equal(pointsOf('c-m')[pointsOf('c-m').length - 2].x, markX('m'));
	// n to h, past m: by the track next to the column of h
	assert.equal(trackOf(pointsOf('n-h')), WIDTH + 12);
});

test('the rows say what they do not route, and route what stands as it is', () => {
	const nodes = [iconOf('a', [UP, ['out', 'out', 'left']]), iconOf('b', [DOWN, ['in', 'in', 'right', 'text']])];
	const { reportList } = diagramArrangeApply({ version: 1, nodes, connections: [lineOf('b-a', ['b', 'down'], ['a', 'up']), lineOf('a-b', ['a', 'out'], ['b', 'in'])] }, diagramArrangerRows, { registry });
	assert.deepEqual(reportList.map((report) => report.kind), ['skipped', 'skipped']);
	// nodes kept where they are: their columns are read off them, and a channel too narrow for its tracks is said
	const placed = planBuild().diagram;
	const squeezed = { ...placed, nodes: placed.nodes.map((node) => (node.position.x > 0 ? { ...node, position: { ...node.position, x: node.position.x - 40 } } : node)), connections: placed.connections.map(({ route: _route, ...rest }) => rest) };
	const again = diagramArrangeApply(squeezed, diagramArrangerRows, { registry, isPlaced: false });
	assert.deepEqual(again.diagram.nodes.map((node) => node.position), squeezed.nodes.map((node) => node.position));
	assert.deepEqual(again.reportList.map((report) => report.kind), ['narrow']);
	assert.deepEqual(routeOverlapListGet(lineListOf(again.diagram)), []);
});
