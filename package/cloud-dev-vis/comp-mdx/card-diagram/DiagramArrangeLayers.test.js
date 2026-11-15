import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramArrangeApply } from './DiagramArrange.js';
import { routeOverlapListGet, routePathPolylineGet, routeResolve } from './DiagramRoute.js';
import { diagramNormalize, endpointKeyOf } from './DiagramERData.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { diagramGeometryEstimateBuild, nodeIsSimple } from './DiagramArrangeOutline.js';
import { diagramArrangerLanesAcross, diagramArrangerLanesDown, diagramArrangerLayers, routeTurn } from './DiagramArrangeLayers.js';
import { anchorPointOnOutline, cardSimpleHandlePointOf, cardSimpleMarkRectOf } from './CardSimpleData.js';

const registry = cardDiagramNodeRegistry;
const WIDTH = 160;
const HEIGHT = 60;
// a card of a fixed size, handles on its body: [id, direction, side]
const cardOf = (id, handleList, extra = {}) => ({ id, renderer: { type: 'card-brief' }, position: { x: 0, y: 0 }, size: { width: WIDTH, height: HEIGHT }, data: { title: id, icon: 'database' }, handles: handleList.map(([handleId, direction, side]) => ({ id: handleId, direction, anchor: { side } })), ...extra });
const lineOf = (id, source, target, extra = {}) => ({ id, source: { nodeId: source[0], handleId: source[1] }, target: { nodeId: target[0], handleId: target[1] }, ...extra });

// a page, an api, a function, and below it a table, a bucket and a role; the page also reads the
// bucket by itself, past the api and the function. The handles start on the sides the author left
function systemBuild(extra = {}) {
	const nodes = [
		cardOf('page', [['out', 'out', 'right'], ['bytes', 'out', 'right']]),
		cardOf('api', [['in', 'in', 'left'], ['out', 'out', 'right']]),
		cardOf('function', [['in', 'in', 'left'], ['out', 'out', 'right']]),
		cardOf('table', [['in', 'in', 'left']]),
		cardOf('bucket', [['in', 'in', 'left']]),
		cardOf('role', [['in', 'in', 'left']]),
	];
	const connections = [
		lineOf('request', ['page', 'out'], ['api', 'in']), lineOf('call', ['api', 'out'], ['function', 'in']),
		lineOf('rows', ['function', 'out'], ['table', 'in']), lineOf('objects', ['function', 'out'], ['bucket', 'in']), lineOf('runs-as', ['function', 'out'], ['role', 'in']),
		lineOf('upload', ['page', 'bytes'], ['bucket', 'in'], { label: { text: 'signed url' } }),
	];
	return { version: 1, nodes, connections, ...extra };
}

function lineListOf(diagram) {
	const geometry = diagramGeometryEstimateBuild(diagram, { registry });
	const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
	const keyOf = (endpoint) => endpointKeyOf(endpoint, nodeById.get(endpoint.nodeId), nodeIsSimple(diagram, nodeById.get(endpoint.nodeId), registry.kindByType[nodeById.get(endpoint.nodeId).renderer.type].contract));
	return diagram.connections.map((connection) => {
		const a = geometry.endOf(connection, 'source');
		const b = geometry.endOf(connection, 'target');
		const ends = { sourceX: a.x, sourceY: a.y, sourcePosition: a.side, targetX: b.x, targetY: b.y, targetPosition: b.side };
		return { id: connection.id, d: routeResolve('step', connection.route ?? null, ends).d, sourceKey: keyOf(connection.source), targetKey: keyOf(connection.target), connection };
	});
}

// the stretches of a line over a card it does not end at
function overCardListGet(diagram) {
	const geometry = diagramGeometryEstimateBuild(diagram, { registry });
	const out = [];
	for (const line of lineListOf(diagram)) {
		const pointList = routePathPolylineGet(line.d);
		for (const node of diagram.nodes) {
			if (node.id === line.connection.source.nodeId || node.id === line.connection.target.nodeId) continue;
			const rect = geometry.rectOf(node.id);
			for (let index = 1; index < pointList.length; index += 1) {
				const [p, q] = [pointList[index - 1], pointList[index]];
				if (Math.max(p.x, q.x) > rect.x && Math.min(p.x, q.x) < rect.x + rect.width && Math.max(p.y, q.y) > rect.y && Math.min(p.y, q.y) < rect.y + rect.height) out.push(`${line.id} over ${node.id}`);
			}
		}
	}
	return out;
}

test('layers: what a line goes to stands under what it comes from, a layer centered on the widest', () => {
	const { diagram, reportList } = diagramArrangeApply(systemBuild(), diagramArrangerLayers, { registry });
	assert.deepEqual(reportList.filter((report) => report.kind !== 'label'), []);
	const positionOf = (id) => diagram.nodes.find((node) => node.id === id).position;
	assert.equal(positionOf('page').y, 0);
	assert.ok(positionOf('api').y > positionOf('page').y + HEIGHT);
	assert.ok(positionOf('function').y > positionOf('api').y + HEIGHT);
	// table, bucket, role: one layer, side by side in the order of the data, centered under the function
	assert.equal(positionOf('table').y, positionOf('bucket').y);
	assert.ok(positionOf('table').x < positionOf('bucket').x && positionOf('bucket').x < positionOf('role').x);
	assert.equal(positionOf('function').x + WIDTH / 2, positionOf('bucket').x + WIDTH / 2);
	// the handles of the cards as a whole are turned: out of the bottom, into the top
	const sideOf = (nodeId, handleId) => diagram.nodes.find((node) => node.id === nodeId).handles.find((handle) => handle.id === handleId).anchor.side;
	assert.equal(sideOf('function', 'out'), 'bottom');
	assert.equal(sideOf('table', 'in'), 'top');
	assert.equal(diagramNormalize(diagram, registry).nodes.length, 6);
});

test('layers: no line lies on another or runs over a card, also one across several layers', () => {
	const { diagram } = diagramArrangeApply(systemBuild(), diagramArrangerLayers, { registry });
	const lineList = lineListOf(diagram);
	for (const line of lineList) {
		const pointList = routePathPolylineGet(line.d);
		for (let index = 1; index < pointList.length; index += 1) {
			const isStraight = Math.abs(pointList[index].x - pointList[index - 1].x) < 0.01 || Math.abs(pointList[index].y - pointList[index - 1].y) < 0.01;
			assert.ok(isStraight, `${line.id} has a slanted stretch`);
		}
	}
	assert.deepEqual(routeOverlapListGet(lineList), []);
	assert.deepEqual(overCardListGet(diagram), []);
	// the upload passes the api and the function: it has a route of its own
	assert.ok(diagram.connections.find((line) => line.id === 'upload').route.anchorList.length >= 2);
});

test('layers: cards placed apart keep their order in a layer; a locked card stays', () => {
	const base = systemBuild();
	const nodes = base.nodes.map((node) => (node.id === 'role' ? { ...node, position: { x: -400, y: 300 } } : node.id === 'table' ? { ...node, position: { x: 400, y: 300 } } : node.id === 'bucket' ? { ...node, position: { x: 0, y: 300 } } : node));
	const { diagram } = diagramArrangeApply({ ...base, nodes }, diagramArrangerLayers, { registry });
	const xOf = (id) => diagram.nodes.find((node) => node.id === id).position.x;
	assert.ok(xOf('role') < xOf('bucket') && xOf('bucket') < xOf('table'));
	const locked = { ...base, nodes: base.nodes.map((node) => (node.id === 'page' ? { ...node, position: { x: 900, y: 900 }, isPositionLocked: true } : node)) };
	assert.deepEqual(diagramArrangeApply(locked, diagramArrangerLayers, { registry }).diagram.nodes.find((node) => node.id === 'page').position, { x: 900, y: 900 });
});

test('layers: a handle on a part of a card keeps its side; a handle on a node drawn simple is turned and drawn on its mark', () => {
	const table = { id: 'rows', renderer: { type: 'table' }, position: { x: 0, y: 0 }, size: { width: 240, height: 'auto' }, data: { name: 'rows', fields: [{ id: 'name', label: 'Name' }], rows: [{ id: 'a', name: 'a' }] }, handles: [{ id: 'a', direction: 'out', anchor: { target: 'row/a', side: 'right' } }] };
	const simple = cardOf('simple', [['in', 'in', 'left']], { display: 'simple', size: { width: WIDTH, height: 'auto' } });
	const { diagram } = diagramArrangeApply({ version: 1, nodes: [table, simple], connections: [lineOf('a', ['rows', 'a'], ['simple', 'in'])] }, diagramArrangerLayers, { registry });
	assert.equal(diagram.nodes[0].handles[0].anchor.side, 'right');
	assert.equal(diagram.nodes[1].handles[0].anchor.side, 'top');
	// the end of the line is the top of the round mark, in the middle of the node
	const geometry = diagramGeometryEstimateBuild(diagram, { registry });
	const end = geometry.endOf(diagram.connections[0], 'target');
	const rect = geometry.rectOf('simple');
	assert.deepEqual({ x: end.x, y: end.y }, { x: rect.x + WIDTH / 2, y: rect.y });
	assert.deepEqual(diagramNormalize(diagram, registry).nodes[1].display, 'simple');
});

test('a diagram drawn simple by default: its kinds with a simple display, every handle on the mark, one end per place', () => {
	const diagram = systemBuild({ defaults: { node: { display: 'simple' } } });
	const graph = diagramNormalize(diagram, registry);
	assert.ok(graph.nodes.every((node) => node.display === 'simple'));
	// handles of one side and offset of a node drawn simple are one end of lines
	const page = diagram.nodes[0];
	assert.equal(endpointKeyOf({ nodeId: 'page', handleId: 'out' }, page, true), endpointKeyOf({ nodeId: 'page', handleId: 'bytes' }, page, true));
	assert.notEqual(endpointKeyOf({ nodeId: 'page', handleId: 'out' }, page, false), endpointKeyOf({ nodeId: 'page', handleId: 'bytes' }, page, false));
	// a kind without one keeps its card, unless the node asks: then it says so
	const withNote = { ...diagram, nodes: [...diagram.nodes, { id: 'note', renderer: { type: 'card-note' }, data: { title: 'n' } }] };
	assert.equal(diagramNormalize(withNote, registry).nodes.at(-1).display, 'detailed');
	assert.throws(() => diagramNormalize({ ...withNote, nodes: [...diagram.nodes, { id: 'note', renderer: { type: 'card-note' }, display: 'simple', data: { title: 'n' } }] }, registry), /note: a card-note node has no simple display/);
	assert.throws(() => diagramNormalize({ ...diagram, defaults: { node: { display: 'round' } } }, registry), /defaults.node.display is detailed or simple/);
	const { diagram: arranged } = diagramArrangeApply(diagram, diagramArrangerLayers, { registry });
	assert.deepEqual(routeOverlapListGet(lineListOf(arranged)), []);
});

test('a handle on a round mark stands on its outline', () => {
	const rect = { left: 0, top: 0, width: 100, height: 100 };
	assert.deepEqual(anchorPointOnOutline(rect, 'top', 0.5, 'ellipse'), { x: 50, y: 0 });
	const point = anchorPointOnOutline(rect, 'right', 0.2, 'ellipse');
	assert.equal(point.y, 20);
	assert.ok(Math.abs(Math.hypot(point.x - 50, point.y - 50) - 50) < 1e-9);
	assert.deepEqual(anchorPointOnOutline(rect, 'right', 0.2, 'rect'), { x: 100, y: 20 });
	// a cylinder: its walls are straight, its caps elliptic
	assert.deepEqual(anchorPointOnOutline(rect, 'left', 0.3, 'cylinder'), { x: 0, y: 30 });
	assert.ok(anchorPointOnOutline(rect, 'top', 0.1, 'cylinder').y > 0);
	assert.deepEqual(cardSimpleMarkRectOf({ x: 0, y: 0, width: 140, height: 98 }, { width: 140, height: 'auto' }), { x: 40, y: 0, width: 60, height: 60 });
	// at the bottom of a node drawn simple: under its words, at the width of the mark
	assert.deepEqual(cardSimpleHandlePointOf({ x: 0, y: 0, width: 140, height: 98 }, { width: 140, height: 'auto' }, 'bottom', 0.25, 'tile'), { x: 55, y: 98 });
	assert.deepEqual(cardSimpleHandlePointOf({ x: 0, y: 0, width: 140, height: 98 }, { width: 140, height: 'auto' }, 'left', 0.5, 'circle'), { x: 40, y: 30 });
});

test('the lanes arrangers keep the cards and route the lines, down the rows or across the columns', () => {
	const placed = diagramArrangeApply(systemBuild(), diagramArrangerLayers, { registry }).diagram;
	const bare = { ...placed, connections: placed.connections.map(({ route: _route, ...rest }) => rest) };
	const down = diagramArrangeApply(bare, diagramArrangerLanesDown, { registry });
	assert.deepEqual(down.diagram.nodes.map((node) => node.position), bare.nodes.map((node) => node.position));
	assert.deepEqual(routeOverlapListGet(lineListOf(down.diagram)), []);
	const across = diagramArrangeApply(bare, diagramArrangerLanesAcross, { registry });
	assert.deepEqual(across.diagram.nodes.map((node) => node.position), bare.nodes.map((node) => node.position));
	// a quarter turn twice is no turn
	const route = { anchorList: [{ id: 'a1', along: 1, x: 3, y: -7, handleIn: 'x+', handleOut: 'y-' }], source: { handle: 'y+' } };
	assert.deepEqual(routeTurn(routeTurn(route)), route);
	assert.deepEqual(routeTurn(route).anchorList[0], { id: 'a1', along: 1, x: -7, y: 3, handleIn: 'y+', handleOut: 'x-' });
});
