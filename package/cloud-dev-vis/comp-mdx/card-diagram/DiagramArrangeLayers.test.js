import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramArrangeApply } from './DiagramArrange.js';
import { labelLengthOf, routeOverlapListGet, routePathPolylineGet, routePolylineLengthGet, routePolylinePointAt, routeResolve } from './DiagramRoute.js';
import { diagramNormalize, endpointKeyOf } from './DiagramERData.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { diagramGeometryEstimateBuild, nodeIsSimple } from './DiagramArrangeOutline.js';
import { labelBandWidthOf } from './DiagramLabelPlace.js';
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

test('lanes-across with a band of labels: the labels of the lines leaving a column stand one under another beside it, no lane in the band', () => {
	const cardTall = (id, x, side, offsetList) => ({ id, renderer: { type: 'card-brief' }, position: { x, y: 0 }, size: { width: WIDTH, height: 240 }, data: { title: id, icon: 'database' },
		handles: offsetList.map((offset, index) => ({ id: `h${index}`, direction: side === 'right' ? 'out' : 'in', anchor: { side, offset } })) });
	const nodes = [cardTall('left', 0, 'right', [0.2, 0.4, 0.6, 0.8]), cardTall('right', 420, 'left', [0.8, 0.6, 0.4, 0.2])];
	const connections = [0, 1, 2, 3].map((index) => ({ id: `l${index}`, source: { nodeId: 'left', handleId: `h${index}` }, target: { nodeId: 'right', handleId: `h${index}` }, renderer: { type: 'smoothstep' }, label: { text: `rule ${index}` } }));
	const { diagram } = diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerLanesAcross, { registry, laneMargin: 10, labelBand: 90 });
	// every lane stands past the band (the right of the card, 160, and 90 more)
	for (const connection of diagram.connections) {
		const lane = 420 + connection.route.anchorList[0].x;
		assert.ok(lane >= 160 + 90 - 0.5, `${connection.id}: lane at ${lane}`);
	}
	// each label at the middle of the band: as far from where its line leaves, the same x for all
	assert.deepEqual(diagram.connections.map((connection) => connection.label.distance), [45, 45, 45, 45]);
	const geometry = diagramGeometryEstimateBuild(diagram, { registry });
	const xList = diagram.connections.map((connection) => {
		const [source, target] = [geometry.endOf(connection, 'source'), geometry.endOf(connection, 'target')];
		const d = routeResolve('smoothstep', connection.route, { sourceX: source.x, sourceY: source.y, sourcePosition: source.side, targetX: target.x, targetY: target.y, targetPosition: target.side }).d;
		const polyline = routePathPolylineGet(d);
		return Math.round(routePolylinePointAt(polyline, labelLengthOf(routePolylineLengthGet(polyline), connection.label) / routePolylineLengthGet(polyline)).x);
	});
	assert.deepEqual(new Set(xList), new Set([205]));
	// a band as wide as its labels (labelBand: true): the middle of the widest label and its room
	const { diagram: auto } = diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerLanesAcross, { registry, laneMargin: 10, labelBand: true });
	assert.deepEqual(new Set(auto.connections.map((connection) => connection.label.distance)), new Set([labelBandWidthOf(['rule 0']) / 2]));
	// arranged again without the band: the labels are placed along their lines as ever, the distance gone
	const { diagram: plain } = diagramArrangeApply(diagram, diagramArrangerLanesAcross, { registry, laneMargin: 10 });
	assert.ok(plain.connections.every((connection) => connection.label.distance === undefined && typeof connection.label.position === 'number'));
});

test('lanes-across with a margin: a line turns that far from its card, and from its end when the end stands past the card (after the words of an icon node)', () => {
	const iconOf = (id, x, y, handles) => ({ id, renderer: { type: 'card-icon' }, position: { x, y }, size: { width: 200, height: 36 }, data: { title: id }, handles });
	const nodes = [
		iconOf('a', 0, 0, [{ id: 'out', anchor: { target: 'text', side: 'right' } }]),
		iconOf('b', 0, 60, [{ id: 'out', anchor: { target: 'body', side: 'right' } }]),
		iconOf('c', 300, 100, [{ id: 'in', anchor: { target: 'icon', side: 'left' } }]),
	];
	const connections = ['a', 'b'].map((id) => ({ id: `${id}>c`, source: { nodeId: id, handleId: 'out' }, target: { nodeId: 'c', handleId: 'in' }, renderer: { type: 'smoothstep' } }));
	const { diagram } = diagramArrangeApply({ version: 1, nodes, connections }, diagramArrangerLanesAcross, { registry, laneMargin: 20 });
	// the words of a fill their card: its end is 12 px past it, so no lane stands nearer the column than 200 + 12 + 20
	const laneList = diagram.connections.map((connection) => 300 + connection.route.anchorList[0].x);
	for (const lane of laneList) assert.ok(lane >= 232 - 0.5 && lane <= 280 + 0.5, String(lane));
	assert.equal(new Set(laneList).size, 2);
});
