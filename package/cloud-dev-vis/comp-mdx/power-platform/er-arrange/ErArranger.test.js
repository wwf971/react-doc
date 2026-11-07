import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramArrangeApply, diagramArrangeRun } from '../../card-diagram/DiagramArrange.js';
import { routeOverlapListGet, routePathPolylineGet, routePathRunListGet, routePolylineLengthGet, routePolylinePointAt, routeResolve } from '../../card-diagram/DiagramRoute.js';
import { labelPositionListPlace, labelSizeEstimate } from '../../card-diagram/DiagramLabelPlace.js';
import { DiagramEditStore } from '../../card-diagram/DiagramEditStore.js';
import { powerPlatformNodeRegistry } from '../power-platform-node-registry.js';
import { erGeometryEstimateBuild } from './ErGeometry.js';
import { erArrangerColumns, erArrangerLanes, erArrangerList, erArrangerSpread } from './er-arranger-list.js';

// a schema as cards and lines: { table: [tables it refers to] }, every card its own handles
function diagramOf(schema) {
	const nodes = Object.keys(schema).map((name) => ({
		id: name, renderer: { type: 'dataverse-table' }, position: { x: 0, y: 0 }, size: { width: 400, height: 'auto' },
		data: { name, nameLogical: name, columns: [{ id: 'id', name: 'Id', nameLogical: 'id', type: 'Unique identifier', key: 'PK' }, ...schema[name].map((to, index) => ({ id: `c${index}`, name: to, nameLogical: to, type: 'Lookup' }))] },
		handles: [{ id: 'pk', direction: 'in', anchor: { target: 'column/id', side: 'left' } }, ...schema[name].map((_, index) => ({ id: `c${index}`, direction: 'out', anchor: { target: `column/c${index}`, side: 'right' } }))],
	}));
	const connections = Object.entries(schema).flatMap(([name, list]) => list.map((to, index) => ({ id: `${name}.${index}`, source: { nodeId: name, handleId: `c${index}` }, target: { nodeId: to, handleId: 'pk' } })));
	return { nodes, connections };
}

// the drawn lines of a diagram, from the estimate: what a test can check without a browser
function lineListOf(diagram) {
	const geometry = erGeometryEstimateBuild(diagram);
	return diagram.connections.map((connection) => {
		const a = geometry.endOf(connection, 'source');
		const b = geometry.endOf(connection, 'target');
		const ends = { sourceX: a.x, sourceY: a.y, sourcePosition: a.side, targetX: b.x, targetY: b.y, targetPosition: b.side };
		return { id: connection.id, d: routeResolve('smoothstep', connection.route ?? null, ends).d, sourceKey: `${connection.source.nodeId}/${connection.source.handleId}`, targetKey: `${connection.target.nodeId}/${connection.target.handleId}`, sourceNodeId: connection.source.nodeId, targetNodeId: connection.target.nodeId };
	});
}

function linesOverCards(diagram) {
	const geometry = erGeometryEstimateBuild(diagram);
	return lineListOf(diagram).filter((line) => routePathRunListGet(line.d).some((run) => diagram.nodes.some((node) => {
		if (node.id === line.sourceNodeId || node.id === line.targetNodeId) return false;
		const rect = geometry.rectOf(node.id);
		return Math.max(run.from.x, run.to.x) > rect.x + 1 && Math.min(run.from.x, run.to.x) < rect.x + rect.width - 1 && Math.max(run.from.y, run.to.y) > rect.y + 1 && Math.min(run.from.y, run.to.y) < rect.y + rect.height - 1;
	})));
}

const arranged = (schema, arranger = erArrangerColumns) => diagramArrangeApply(diagramOf(schema), arranger);

test('er-columns: what a line goes to stands at its right, with handles facing each other', () => {
	const { diagram } = arranged({ post: ['user'], user: [] });
	const nodeOf = (id) => diagram.nodes.find((node) => node.id === id);
	assert.ok(nodeOf('post').position.x < nodeOf('user').position.x);
	assert.equal(nodeOf('post').handles.find((handle) => handle.id === 'c0').anchor.side, 'right');
	assert.equal(nodeOf('user').handles.find((handle) => handle.id === 'pk').anchor.side, 'left');
});

test('two lines at one height in different columns do not run together', () => {
	// comment.0 crosses the column of post at the height where post.0 leaves
	const { diagram } = arranged({ user: [], post: ['user'], comment: ['user', 'post'], tag: [], posttag: ['post', 'tag'] });
	assert.deepEqual(routeOverlapListGet(lineListOf(diagram)), []);
	assert.deepEqual(linesOverCards(diagram).map((line) => line.id), []);
});

test('a line across columns stays between their cards', () => {
	const { diagram } = arranged({ t0: ['t1', 't2', 't3', 't4'], t1: ['t2', 't4'], t2: ['t3'], t3: ['t4'], t4: [] });
	assert.deepEqual(routeOverlapListGet(lineListOf(diagram)), []);
	assert.deepEqual(linesOverCards(diagram).map((line) => line.id), []);
});

test('a gap is as wide as the lanes crossing it need', () => {
	const schema = { user: [] };
	for (let index = 0; index < 40; index += 1) schema[`t${index}`] = ['user'];
	const { diagram, reportList } = arranged(schema);
	const xList = [...new Set(diagram.connections.map((line) => line.route.anchorList[0].x))].sort((a, b) => a - b);
	assert.equal(xList.length, 40);
	for (let index = 1; index < xList.length; index += 1) assert.ok(xList[index] - xList[index - 1] >= 11.9, `${xList[index - 1]} ${xList[index]}`);
	assert.deepEqual(reportList, []);
	assert.deepEqual(routeOverlapListGet(lineListOf(diagram)), []);
});

test('a cycle and a line from a table to itself get lanes like any other', () => {
	const { diagram } = arranged({ a: ['b'], b: ['c'], c: ['a'], employee: ['employee', 'a'] });
	for (const line of diagram.connections) assert.ok(line.route?.anchorList.length, line.id);
	assert.deepEqual(routeOverlapListGet(lineListOf(diagram)), []);
	const self = diagram.nodes.find((node) => node.id === 'employee').handles;
	assert.equal(self.find((handle) => handle.id === 'pk').anchor.side, 'right');
	assert.equal(self.find((handle) => handle.id === 'c0').anchor.side, 'right');
});

test('er-lanes keeps the cards where they are, placed by hand', () => {
	const diagram = diagramOf({ a: ['c'], b: ['c'], c: [] });
	const placeOf = { a: { x: 40, y: 500 }, b: { x: 80, y: 40 }, c: { x: 900, y: 200 } };
	for (const node of diagram.nodes) node.position = placeOf[node.id];
	const { diagram: next } = diagramArrangeApply(diagram, erArrangerLanes);
	for (const node of next.nodes) assert.deepEqual(node.position, placeOf[node.id]);
	assert.deepEqual(routeOverlapListGet(lineListOf(next)), []);
	const [one, two] = next.connections.map((line) => line.route.anchorList[0].x);
	assert.notEqual(one, two);
});

test('an arranger replaces the anchors it finds', () => {
	const diagram = diagramOf({ a: ['b'], b: [] });
	diagram.nodes[1].position = { x: 800, y: 0 };
	diagram.connections[0].route = { anchorList: [{ id: 'mine', along: 0.5, x: 0, y: 300 }, { id: 'other', along: 0.2, x: 0, y: 100 }] };
	const { diagram: next } = diagramArrangeApply(diagram, erArrangerLanes);
	assert.equal(next.connections[0].route.anchorList.length, 1);
	assert.notEqual(next.connections[0].route.anchorList[0].id, 'mine');
	assert.equal(diagram.connections[0].route.anchorList.length, 2, 'the diagram given is not changed');
});

test('only the lines named change, and curves and free ends are left alone', () => {
	const diagram = diagramOf({ a: ['c', 'c'], c: [] });
	diagram.nodes[1].position = { x: 800, y: 0 };
	const { routeById } = diagramArrangeRun(diagram, erArrangerLanes, { connectionIdList: ['a.0'] });
	assert.deepEqual(Object.keys(routeById), ['a.0']);
	const bezier = diagramOf({ a: ['c'], c: [] });
	bezier.nodes[1].position = { x: 800, y: 0 };
	bezier.connections[0].renderer = { type: 'bezier' };
	assert.deepEqual(diagramArrangeRun(bezier, erArrangerLanes).routeById, {});
	const free = diagramOf({ a: ['c'], c: [] });
	free.nodes[1].position = { x: 800, y: 0 };
	free.connections[0].target = { position: { x: 700, y: 50 } };
	const result = diagramArrangeRun(free, erArrangerLanes);
	assert.deepEqual(result.routeById, {});
	assert.equal(result.reportList[0].kind, 'skipped');
});

test('a locked card stays where it is', () => {
	const diagram = diagramOf({ a: ['b'], b: [] });
	diagram.nodes[1].position = { x: 30, y: 30 };
	diagram.nodes[1].isPositionLocked = true;
	const { positionById } = diagramArrangeRun(diagram, erArrangerColumns);
	assert.equal(positionById.b, undefined);
	assert.ok(positionById.a);
});

test('the same arranger on a draft is one step of the history, and an undo brings all back', () => {
	const diagram = diagramOf({ a: ['b'], b: [] });
	diagram.nodes[1].position = { x: 800, y: 0 };
	diagram.connections[0].route = { anchorList: [{ id: 'mine', along: 0.5, x: 0, y: 300 }] };
	const raw = JSON.stringify({ version: 1, ...diagram });
	const store = new DiagramEditStore(raw, 'diagram', undefined, powerPlatformNodeRegistry);
	assert.deepEqual(store.arrangeApply(erArrangerColumns, { geometry: erGeometryEstimateBuild(store.value) }), []);
	assert.notEqual(store.connections[0].route.anchorList[0].id, 'mine');
	store.undo();
	assert.equal(store.connections[0].route.anchorList[0].id, 'mine');
	assert.equal(store.history.isUndoAvailable, false);
	store.redo();
	assert.notEqual(store.connections[0].route.anchorList[0].id, 'mine');
});

test('the registry of the series offers the arrangers, for diagrams with tables', () => {
	assert.deepEqual(powerPlatformNodeRegistry.arrangerList.map((item) => item.id), erArrangerList.map((item) => item.id));
	assert.equal(erArrangerLanes.isApplicable({ nodes: [{ renderer: { type: 'power-automate' } }] }), false);
	assert.equal(erArrangerLanes.isApplicable(diagramOf({ a: [] })), true);
});

// two columns of two tables each, and lines from the first column to a third, past the second
function diagramAcross() {
	const cardOf = (id, x, y) => ({ id, renderer: { type: 'dataverse-table' }, position: { x, y }, size: { width: 300, height: 200 }, data: { name: id, nameLogical: id, columns: [] }, handles: [{ id: 'in', direction: 'in', anchor: { side: 'left' } }, { id: 'out', direction: 'out', anchor: { side: 'right' } }] });
	const nodes = [cardOf('a', 0, 0), cardOf('b', 0, 260), cardOf('m', 340, 0), cardOf('n', 340, 260), cardOf('x', 680, 0), cardOf('y', 680, 260)];
	const lineOf = (from, to, text) => ({ id: `${from}-${to}`, source: { nodeId: from, handleId: 'out' }, target: { nodeId: to, handleId: 'in' }, label: { text, position: 0.5 } });
	return { nodes, connections: [lineOf('a', 'x', '12 columns'), lineOf('m', 'y', '8 columns'), lineOf('b', 'y', '3 columns'), lineOf('n', 'x', 'many columns')] };
}

const labelRectOf = (diagram, connection) => {
	const geometry = erGeometryEstimateBuild(diagram);
	const a = geometry.endOf(connection, 'source');
	const b = geometry.endOf(connection, 'target');
	const ends = { sourceX: a.x, sourceY: a.y, sourcePosition: a.side, targetX: b.x, targetY: b.y, targetPosition: b.side };
	const polyline = routePathPolylineGet(routeResolve('smoothstep', connection.route ?? null, ends).d);
	const point = routePolylinePointAt(polyline, connection.label.position);
	const size = labelSizeEstimate(connection.label.text);
	return { x: point.x - size.width / 2, y: point.y - size.height / 2, ...size };
};
const rectsMeet = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('er-spread keeps the columns and their order, widens only a gap too narrow, and clears the lines', () => {
	const diagram = diagramAcross();
	const { diagram: result, reportList } = diagramArrangeApply(diagram, erArrangerSpread);
	const xOf = (id) => result.nodes.find((node) => node.id === id).position.x;
	const yOf = (id) => result.nodes.find((node) => node.id === id).position.y;
	assert.equal(xOf('a'), 0, 'the first column stays');
	assert.ok(xOf('m') > 300, 'in the same order');
	assert.ok(xOf('x') > xOf('m'));
	assert.equal(xOf('a'), xOf('b'), 'a column stays one column');
	assert.equal(xOf('m'), xOf('n'));
	for (const id of ['a', 'b', 'm', 'n', 'x', 'y']) assert.equal(yOf(id), diagram.nodes.find((node) => node.id === id).position.y, 'no card changes its row');
	assert.deepEqual(routeOverlapListGet(lineListOf(result)), []);
	assert.deepEqual(linesOverCards(result).map((line) => line.id), []);
	assert.deepEqual(reportList.filter((report) => report.kind === 'overlap'), []);
	const wide = { ...diagram, nodes: diagram.nodes.map((node) => ({ ...node, position: { x: node.position.x * 3, y: node.position.y } })) };
	assert.deepEqual(Object.keys(diagramArrangeRun(wide, erArrangerSpread).positionById), [], 'gaps wide enough stay as they are');
});

test('the lines of a table as a whole leave and arrive at its title line, in the estimate as drawn', () => {
	const { diagram: result } = diagramArrangeApply(diagramAcross(), erArrangerSpread);
	const geometry = erGeometryEstimateBuild(result);
	const end = geometry.endOf(result.connections[0], 'source');
	assert.equal(end.y, result.nodes.find((node) => node.id === 'a').position.y + 18);
});

test('an arranger places the labels of lines clear of the cards and of each other', () => {
	for (const arranger of [erArrangerSpread, erArrangerLanes]) {
		const { diagram: result, reportList } = diagramArrangeApply(diagramAcross(), arranger);
		const geometry = erGeometryEstimateBuild(result);
		const rectList = result.connections.map((connection) => labelRectOf(result, connection));
		for (const [index, rect] of rectList.entries()) {
			for (const node of result.nodes) assert.ok(!rectsMeet(rect, geometry.rectOf(node.id)), `${arranger.id}: ${result.connections[index].id} over ${node.id}`);
			for (const other of rectList.slice(index + 1)) assert.ok(!rectsMeet(rect, other), `${arranger.id}: two labels meet`);
		}
		assert.deepEqual(reportList.filter((report) => report.kind === 'label'), []);
	}
});

test('labels: a curve has its label placed too, and only lines in scope move', () => {
	const diagram = diagramAcross();
	const curved = { ...diagram, connections: diagram.connections.map((connection) => ({ ...connection, renderer: { type: 'bezier' } })) };
	const { routeById, labelPositionById } = diagramArrangeRun(curved, erArrangerLanes);
	assert.deepEqual(routeById, {}, 'a curve keeps its route');
	assert.deepEqual(Object.keys(labelPositionById).sort(), curved.connections.map((connection) => connection.id).sort());
	const { labelPositionById: oneOnly } = diagramArrangeRun(diagram, erArrangerSpread, { connectionIdList: ['a-x'] });
	assert.deepEqual(Object.keys(oneOnly), ['a-x']);
});

test('the label placer: a place free of cards, nothing to place without words, and a report when none is free', () => {
	const line = (id, x0, x1, y, text, position = 0.5) => ({ id, d: `M ${x0} ${y} L ${x1} ${y}`, text, position });
	const card = { id: 'card', x: 100, y: 0, width: 200, height: 40 };
	const clear = labelPositionListPlace({ rectList: [card], lineList: [line('a', 0, 400, 20, 'label')] });
	assert.ok(clear.positionById.a < 0.2 || clear.positionById.a > 0.8, `outside the card: ${clear.positionById.a}`);
	assert.deepEqual(clear.reportList, []);
	assert.equal(labelPositionListPlace({ rectList: [], lineList: [line('a', 0, 400, 20, 'label', 0.7)] }).positionById.a, 0.7, 'with nothing in the way it stays where it was asked');
	assert.deepEqual(labelPositionListPlace({ lineList: [line('a', 0, 400, 20, '')] }).positionById, {});
	const covered = labelPositionListPlace({ rectList: [{ id: 'big', x: -100, y: -100, width: 800, height: 400 }], lineList: [line('a', 0, 400, 20, 'label')] });
	assert.equal(covered.reportList[0].kind, 'label');
	// two labels on two lines at one height spread apart
	const two = labelPositionListPlace({ lineList: [line('a', 0, 400, 20, 'label', 0.5), line('b', 0, 400, 22, 'label', 0.5)] });
	assert.ok(Math.abs(two.positionById.a - two.positionById.b) > 0.1, 'apart');
	assert.ok(labelSizeEstimate('移行').width > labelSizeEstimate('ab').width);
});

test('a path read as points, curves sampled, and a point at a part of its length', () => {
	const polyline = routePathPolylineGet('M 0 0 L 100 0 Q 110 0 110 10 L 110 100');
	assert.deepEqual(polyline[0], { x: 0, y: 0 });
	assert.deepEqual(polyline[polyline.length - 1], { x: 110, y: 100 });
	assert.ok(Math.abs(routePolylineLengthGet(polyline) - 205.7) < 1);
	assert.deepEqual(routePolylinePointAt(routePathPolylineGet('M 0 0 L 100 0'), 0.25), { x: 25, y: 0 });
	assert.equal(routePathPolylineGet('M 0 0 C 10 0 20 10 30 10').length, 17);
});

test('the same on a draft: the label moves with the route, one step of the history', () => {
	const raw = JSON.stringify({ version: 1, ...diagramAcross() });
	const store = new DiagramEditStore(raw, 'diagram', undefined, powerPlatformNodeRegistry);
	store.arrangeApply(erArrangerSpread, { geometry: erGeometryEstimateBuild(store.value) });
	const moved = store.connections.map((connection) => connection.label.position);
	assert.ok(moved.some((position) => position !== 0.5), 'a label moved');
	assert.ok(store.connections[0].route.anchorList.length > 0);
	store.undo();
	assert.deepEqual(store.connections.map((connection) => connection.label.position), [0.5, 0.5, 0.5, 0.5]);
	assert.equal(store.connections[0].route, undefined);
	assert.equal(store.history.isUndoAvailable, false);
	store.redo();
	assert.deepEqual(store.connections.map((connection) => connection.label.position), moved);
});

test('the estimate of a Dataverse card: its title line, its field header, its rows, and what wraps', () => {
	const cardOf = (renderer, data) => ({ id: 'c', renderer: { type: renderer }, position: { x: 0, y: 0 }, size: { width: 400, height: 'auto' }, data });
	const heightOf = (node) => erGeometryEstimateBuild({ nodes: [node] }).rectOf('c').height;
	const column = (id, name, nameLogical) => ({ id, name, nameLogical, type: 'Text' });
	// sizes as read off drawn cards of the migration example
	assert.equal(heightOf(cardOf('dataverse-table', { name: 'エリア', nameLogical: 'new_area', columns: [column('a', 'エリア', 'new_areaid'), column('b', 'エリア名', 'new_name')] })), 36 + 39 + 2 * 32);
	assert.equal(heightOf(cardOf('dataverse-table', { name: 'T', nameLogical: 't', columns: [column('a', 'A', 'new_propertymasterid')] })), 36 + 39 + 41, 'a long logical name wraps');
	assert.equal(heightOf(cardOf('dataverse-table', { name: 'T', nameLogical: 't', columns: [column('a', 'A', 'internalemailaddress')] })), 36 + 39 + 32, 'narrow letters of as many do not');
	assert.equal(heightOf(cardOf('dataverse-table', { name: 'T', nameLogical: 't', columns: [column('a', 'インポート シーケンス番号', 'x')] })), 36 + 39 + 41, 'a long name wraps');
	assert.equal(heightOf(cardOf('dataverse-table', { name: '物件マスタ', nameLogical: 'new_propertymaster', badge: 'Master', columns: [column('a', 'A', 'a')] })), 41 + 39 + 32);
	assert.equal(heightOf(cardOf('dataverse-choice', { name: '掲載状況', nameLogical: 'new_listingstatus', columns: [column('a', '1', '1')] })), 47 + 39 + 32);
	assert.equal(heightOf(cardOf('dataverse-choice', { name: 'エリアメール用ステータス', nameLogical: 'new_areamailstatus', columns: [column('a', '1', '1')] })), 70 + 39 + 32, 'a long title wraps beside its badge');
});

test('levels above a card are counted per card, so a line to one card stays clear of the card above it', () => {
	const cardOf = (id, x, y, side) => ({ id, renderer: { type: 'dataverse-choice' }, position: { x, y }, size: { width: 300, height: 100 }, data: { name: id, nameLogical: id, columns: [] }, handles: [{ id: 'in', direction: 'in', anchor: { side } }, { id: 'out', direction: 'out', anchor: { side: 'right' } }] });
	const nodes = [cardOf('a', 0, 0, 'left'), cardOf('b', 0, 150, 'left'), cardOf('p', 500, 0, 'top'), cardOf('q', 500, 150, 'top'), cardOf('r', 1000, 0, 'top'), cardOf('s', 1000, 150, 'top')];
	const lineOf = (from, to) => ({ id: `${from}-${to}`, source: { nodeId: from, handleId: 'out' }, target: { nodeId: to, handleId: 'in' } });
	const diagram = { nodes, connections: [lineOf('a', 'p'), lineOf('a', 'q'), lineOf('b', 'r'), lineOf('b', 's')] };
	const { diagram: result } = diagramArrangeApply(diagram, erArrangerLanes);
	assert.deepEqual(linesOverCards(result).map((line) => line.id), []);
	const line = result.connections.find((item) => item.id === 'a-q');
	const levelAbove = line.route.anchorList[0].y;
	assert.ok(levelAbove >= -30, `a single line to a card stands near it: ${levelAbove}`);
});

test('the estimate of a card with rows behind a break: closed one line, open a bar and its rows, and a line to a row behind it ends on the break', () => {
	const column = (id) => ({ id, name: id, nameLogical: id, type: 'Text' });
	const nodeOf = (entry) => ({ id: 'c', renderer: { type: 'dataverse-table' }, position: { x: 0, y: 0 }, size: { width: 400, height: 'auto' }, handles: [{ id: 'on', direction: 'out', anchor: { target: 'column/b', side: 'right' } }, { id: 'after', direction: 'out', anchor: { target: 'column/d', side: 'right' } }], data: { name: 'T', nameLogical: 't', columns: ['a', 'b', 'c', 'd'].map(column), rowDisplay: ['a', entry, 'd'] } });
	const head = 36 + 39;
	const closed = erGeometryEstimateBuild({ nodes: [nodeOf({ break: '2', rowList: ['b', 'c'] })] });
	const open = erGeometryEstimateBuild({ nodes: [nodeOf({ break: '2', rowList: ['b', 'c'], isExpanded: true })] });
	assert.equal(closed.rectOf('c').height, head + 32 + 24 + 32);
	assert.equal(open.rectOf('c').height, head + 32 + 24 + 32 + 32 + 32);
	const endOf = (geometry, handleId) => geometry.endOf({ source: { nodeId: 'c', handleId } }, 'source').y;
	assert.equal(endOf(closed, 'on'), head + 32 + 12, 'on the break');
	assert.equal(endOf(open, 'on'), head + 32 + 24 + 16, 'on its row');
	assert.equal(endOf(closed, 'after'), head + 32 + 24 + 16);
});

