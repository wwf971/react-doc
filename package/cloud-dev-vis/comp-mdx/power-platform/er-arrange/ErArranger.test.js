import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramArrangeApply, diagramArrangeRun } from '../../card-diagram/DiagramArrange.js';
import { routeOverlapListGet, routePathRunListGet, routeResolve } from '../../card-diagram/DiagramRoute.js';
import { DiagramEditStore } from '../../card-diagram/DiagramEditStore.js';
import { powerPlatformNodeRegistry } from '../power-platform-node-registry.js';
import { erGeometryEstimateBuild } from './ErGeometry.js';
import { erArrangerColumns, erArrangerLanes, erArrangerList } from './er-arranger-list.js';

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
