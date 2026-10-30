import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagramEditStore } from './DiagramEditStore.js';
import { DiagramERStore, diagramViewStateGet } from './DiagramERStore.js';
import { powerAutomateSourceDefaultCreate } from './PowerAutomateNodeSource.js';
import { businessRuleSourceDefaultCreate } from './BusinessRuleNodeSource.js';
import { diagramNormalize, endpointIsDangling } from './DiagramERData.js';

function sourceCreate() {
	return JSON.stringify({ version: 1, nodes: [
		{ id: 'table', renderer: { type: 'dataverse-table' }, data: { name: 'Table', columns: [{ id: 'email', name: 'Email', type: 'Text' }, { id: 'phone', name: 'Phone', type: 'Text' }] }, handles: [{ id: 'email-out', direction: 'out', anchor: { target: 'column/email', side: 'right' } }] },
		{ id: 'choice', renderer: { type: 'dataverse-choice' }, data: { name: 'Choice', columns: [{ id: 'value' }] }, handles: [{ id: 'header-in', direction: 'in', anchor: { target: 'header', side: 'left' } }] },
	], connections: [{ id: 'link', source: { nodeId: 'table', handleId: 'email-out' }, target: { nodeId: 'choice', handleId: 'header-in' } }] });
}

const positionGet = (nodeId, handleId) => ({ x: 100, y: 50, side: /left|in$/.test(handleId) ? 'left' : 'right' });

test('resource starters edit fields and rows, restore cells, and reject invalid drafts', () => {
	for (const source of [powerAutomateSourceDefaultCreate(), businessRuleSourceDefaultCreate()]) {
		const store = new DiagramEditStore('# Keep this comment\n' + source.raw);
		const node = store.nodes[0];
		store.select(node.id);
		assert.equal(store.rowSelected, undefined);
		const rowId = store.rowInsert(node.id);
		assert.ok(rowId);
		assert.equal(store.selection.rowId, rowId);
		store.cellStart(node.id, rowId, 'value');
		assert.equal(store.fieldSet(node.id, rowId, 'value', 'Configured'), true);
		store.cellCancel();
		assert.equal(store.rowGet(node.id, rowId).value, '');
		assert.equal(store.fieldSet(node.id, null, 'kind', 'invalid'), false);
		assert.match(store.message, /unsupported value/);
		assert.equal(store.rowRemove(node.id, rowId), true);
		assert.equal(store.isDirty, false);
		assert.match(store.rawDraft, /^# Keep this comment/);
	}
});

test('cell draft and selection are independent; Escape restores dirty state', () => {
	const store = new DiagramEditStore(sourceCreate());
	store.cellStart('table', 'email', 'name');
	store.fieldSet('table', 'email', 'name', 'Work email');
	assert.equal(store.isDirty, true);
	assert.deepEqual({ ...store.selection }, { nodeId: 'table', rowId: 'email', fieldId: 'name', connectionId: null, propId: null });
	assert.equal(store.cardTab, 'cell');
	assert.equal(store.isCardShown, false);
	store.cellCancel();
	assert.equal(store.isDirty, false);
	assert.equal(store.rawDraft, store.rawInitial);
	assert.equal(store.isCardShown, true);
	store.select('table');
	assert.equal(store.selection.rowId, null);
	assert.equal(store.cardTab, 'table');
	store.cellStart('table', 'email', 'name');
	store.fieldSet('table', 'email', 'name', 'Draft retained');
	const draft = store.rawDraft;
	store.selectionClear();
	assert.equal(store.selection, null);
	assert.equal(store.cell, null);
	assert.equal(store.rawDraft, draft);
	assert.equal(store.isDirty, true);
});

test('rows are inserted at an index, moved, and removed with their handles detaching connections', () => {
	const store = new DiagramEditStore(sourceCreate());
	const id = store.rowInsert('table', 0);
	assert.equal(store.rowsGet(store.nodeGet('table'))[0].id, id);
	assert.equal(store.rowMove('table', id, 2), true);
	assert.deepEqual(store.rowsGet(store.nodeGet('table')).map(row => row.id), ['email', 'phone', id]);
	assert.equal(store.rowRemove('table', 'email', positionGet), true);
	const connection = store.connectionGet('link');
	assert.equal(endpointIsDangling(connection.source), true);
	assert.deepEqual(connection.source.position, { x: 148, y: 50 });
	assert.equal(store.nodeGet('table').handles.length, 0);
	assert.equal(store.selection.nodeId, 'table');
});

test('removing a handle reroutes its connections to the other side, or detaches them', () => {
	const store = new DiagramEditStore(sourceCreate());
	assert.equal(store.handleSideSet('table', 'column/email', 'left', true), true);
	const left = store.nodeGet('table').handles.find(handle => handle.anchor.side === 'left');
	assert.equal(left.id, 'email-left');
	assert.equal(store.handleSideSet('table', 'column/email', 'right', false, positionGet), true);
	assert.deepEqual(store.connectionGet('link').source, { nodeId: 'table', handleId: 'email-left' });
	assert.equal(store.handleSideSet('table', 'column/email', 'left', false, positionGet), true);
	assert.deepEqual(store.connectionGet('link').source, { position: { x: 52, y: 50 } });
	assert.equal(store.nodeGet('table').handles.length, 0);
});

test('a connection attaches only to a compatible handle with room, and either end can dangle', () => {
	const store = new DiagramEditStore(sourceCreate());
	assert.equal(store.handleSideSet('table', 'column/phone', 'right', true), true);
	assert.equal(store.handleAttachPolicySet('table', 'phone-right', 'single'), true);
	const id = store.connectionCreate({ nodeId: 'table', handleId: 'phone-right' }, { position: { x: 400, y: 20 } });
	assert.ok(id);
	assert.equal(store.connectionCreate({ nodeId: 'table', handleId: 'phone-right' }, { position: { x: 400, y: 90 } }), null);
	assert.match(store.message, /one connection/);
	assert.equal(store.connectionEndpointSet(id, 'target', { nodeId: 'choice', handleId: 'header-in' }), true);
	assert.equal(store.connectionEndpointSet(id, 'source', { nodeId: 'choice', handleId: 'header-in' }), false);
	assert.match(store.message, /no outgoing/);
	assert.equal(store.connectionEndpointSet(id, 'target', { nodeId: 'table', handleId: 'phone-right' }), false);
	assert.match(store.message, /same handle/);
	assert.equal(store.connectionEndpointSet(id, 'source', { position: { x: 10.4, y: 20.6 } }), true);
	assert.deepEqual(store.connectionGet(id).source, { position: { x: 10, y: 21 } });
	assert.deepEqual(store.connectionOrient({ nodeId: 'choice', handleId: 'header-in' }, { nodeId: 'table', handleId: 'email-out' }), { source: { nodeId: 'table', handleId: 'email-out' }, target: { nodeId: 'choice', handleId: 'header-in' } });
	assert.equal(store.connectionOrient({ nodeId: 'table', handleId: 'email-out' }, { nodeId: 'table', handleId: 'email-out' }), null);
	const graph = diagramNormalize(store.value);
	assert.equal(graph.connections.length, 2);
});

test('a handle click rotates through its connections and ends on the list of the lines', () => {
	const store = new DiagramEditStore(sourceCreate());
	store.connectionCreate({ nodeId: 'table', handleId: 'email-out' }, { position: { x: 400, y: 20 } });
	store.handleClick('table', 'email-out');
	assert.deepEqual({ ...store.selection }, { nodeId: 'table', rowId: null, fieldId: null, connectionId: 'link', propId: null });
	assert.equal(store.cardTab, 'line');
	assert.equal(store.display.view, 'detail');
	store.handleClick('table', 'email-out');
	assert.equal(store.selection.connectionId, 'connection-1');
	store.handleClick('table', 'email-out');
	assert.equal(store.selection.connectionId, null);
	assert.equal(store.cardTab, 'line');
	assert.equal(store.display.view, 'list');
	store.handleClick('table', 'email-out');
	assert.equal(store.selection.connectionId, 'link');
	// removing the line selected from the card goes back to the card's lines
	assert.equal(store.connectionRemove('link'), true);
	assert.deepEqual(store.path, [{ kind: 'node', id: 'table' }, { kind: 'lines' }]);
	store.selectConnection('connection-1');
	assert.deepEqual({ ...store.selection }, { connectionId: 'connection-1' });
	assert.equal(store.connectionRemove('connection-1'), true);
	assert.equal(store.selection, null);
});

test('connection presentation fields are validated and dash presets round-trip', () => {
	const store = new DiagramEditStore(sourceCreate());
	assert.equal(store.connectionSet('link', 'label', 'places'), true);
	assert.equal(store.connectionSet('link', 'lineType', 'bezier'), true);
	assert.equal(store.connectionSet('link', 'lineType', 'curvy'), false);
	assert.equal(store.connectionSet('link', 'strokeWidth', 0), false);
	assert.equal(store.connectionSet('link', 'strokeWidth', 2.5), true);
	assert.equal(store.connectionSet('link', 'stroke', '#b45309'), true);
	assert.equal(store.connectionSet('link', 'strokeDash', 'dotted'), true);
	assert.equal(store.strokeDashGet(store.connectionGet('link')), 'dotted');
	assert.equal(store.connectionSet('link', 'strokeDash', 'solid'), true);
	assert.equal(store.strokeDashGet(store.connectionGet('link')), 'solid');
	assert.equal(store.connectionSet('link', 'markerStart', 'arrow'), true);
	assert.equal(store.connectionSet('link', 'markerEnd', 'circle'), false);
	assert.equal(store.connectionSet('link', 'isAnimated', true), true);
	const connection = diagramNormalize(store.value).connections[0];
	assert.equal(connection.renderer.type, 'bezier');
	assert.equal(connection.style.strokeWidth, 2.5);
	assert.equal(connection.markerStart, 'arrow');
	assert.equal(connection.isAnimated, true);
});

test('nodes and connections are created from the registry and a removed node leaves dangling ends', () => {
	const store = new DiagramEditStore(sourceCreate());
	const id = store.nodeAdd('table', { x: 30.6, y: 40 });
	assert.equal(id, 'table-1');
	assert.deepEqual(store.nodeGet(id).position, { x: 31, y: 40 });
	assert.equal(store.selection.nodeId, id);
	assert.equal(store.nodeAdd('connection', { x: 0, y: 0 }), null);
	const connectionId = store.connectionCreateDangling({ x: 10, y: 10 });
	assert.deepEqual(store.connectionGet(connectionId).target, { position: { x: 170, y: 10 } });
	assert.deepEqual({ ...store.selection }, { connectionId });
	assert.equal(store.nodeRemove('choice', positionGet), true);
	assert.equal(store.nodeGet('choice'), undefined);
	assert.deepEqual(store.connectionGet('link').target, { position: { x: 52, y: 50 } });
	assert.equal(store.selection, null);
});

test('a generic table edits its fields and keeps its rows in step', () => {
	const store = new DiagramEditStore(sourceCreate());
	const id = store.nodeAdd('table', { x: 0, y: 0 });
	const fieldId = store.columnInsert(id, 1);
	assert.equal(fieldId, 'field-1');
	assert.equal(store.cardTab, 'column');
	assert.equal(store.columnLabelSet(id, fieldId, 'Unit'), true);
	assert.equal(store.columnMove(id, fieldId, 0), true);
	assert.deepEqual(store.nodeGet(id).data.fields.map(field => field.id), ['field-1', 'name', 'value']);
	assert.equal(store.fieldSet(id, 'row-1', 'field-1', 'mm'), true);
	assert.equal(store.columnRemove(id, 'field-1'), true);
	assert.equal(store.rowGet(id, 'row-1')['field-1'], undefined);
	assert.equal(store.columnInsert('table', 0), null);
	assert.equal(store.fieldSet(id, null, 'isHeaderHandleEnabled', true), true);
	assert.equal(store.handleSideSet(id, 'header', 'left', true), true);
	assert.equal(store.fieldSet(id, null, 'isHeaderHandleEnabled', false), false);
	assert.match(store.message, /unknown anchor/);
});

test('standalone cards edit rows and handles and choose a save target without writing', () => {
	const node = JSON.parse(sourceCreate()).nodes[0];
	const store = new DiagramEditStore(JSON.stringify({ version: 1, node }), 'card');
	assert.equal(store.handleSideSet('table', 'column/email', 'right', false), true);
	assert.equal(store.nodeGet('table').handles.length, 0);
	assert.ok(store.rowInsert('table', 1));
	assert.equal(store.nodeAdd('table', { x: 0, y: 0 }), null);
	store.saveTargetSet('inline');
	assert.equal(store.report.saveTarget, 'inline');
	assert.equal(store.report.lang, 'yaml');
	assert.equal(store.isDirty, true);
});

test('remembered positions follow dragging and locked positions require unlocking', () => {
	const store = new DiagramEditStore(sourceCreate());
	assert.equal(store.nodeMove('table', { x: 20, y: 30 }), false);
	assert.equal(store.isDirty, false);
	assert.equal(store.positionRememberSet('table', true, { x: 20, y: 30 }), true);
	assert.equal(store.nodeMove('table', { x: 50, y: 60 }), true);
	assert.deepEqual(store.nodes[0].position, { x: 50, y: 60 });
	assert.equal(store.positionLockSet('table', true, { x: 50, y: 60 }), true);
	assert.equal(store.nodeMove('table', { x: 70, y: 80 }), false);
	assert.equal(store.positionRememberSet('table', false), false);
	assert.equal(new DiagramEditStore(store.rawDraft).nodes[0].isPositionLocked, true);
	assert.equal(store.positionLockSet('table', false), true);
	assert.equal(store.nodeMove('table', { x: 70, y: 80 }), true);
	assert.equal(store.positionRememberSet('table', false), true);
	assert.equal(store.nodes[0].position, 'auto');
});

test('camera state belongs to the document block across edit and read instances', () => {
	const owner = {};
	const config = { sourcePath: '/doc.md', blockIndex: 3, instanceId: 'edit:/doc.md:3' };
	const state = diagramViewStateGet(owner, config);
	state.view = { x: 70, y: -40, zoom: 0.65 };
	assert.equal(diagramViewStateGet(owner, { ...config, instanceId: 'read-instance' }), state);
	assert.notEqual(diagramViewStateGet(owner, { ...config, blockIndex: 4 }), state);
	assert.notEqual(diagramViewStateGet({}, config), state);
});

test('the canvas ignores movement of locked nodes and draws dangling ends as point nodes', () => {
	const draft = new DiagramEditStore(sourceCreate());
	draft.positionLockSet('table', true, { x: 100, y: 200 });
	draft.connectionCreateDangling({ x: 5, y: 6 });
	const canvas = new DiagramERStore(draft.rawDraft);
	canvas.nodeListChange([{ type: 'position', id: 'table', position: { x: 0, y: 0 } }]);
	assert.deepEqual({ ...canvas.nodeList[0].position }, { x: 100, y: 200 });
	canvas.nodeListChange([{ type: 'dimensions', id: 'table', dimensions: { width: 410, height: 200 } }]);
	assert.equal(canvas.nodeList[0].measured.height, 200);
	const points = canvas.nodeList.filter(node => node.type === 'visualizationPoint');
	assert.equal(points.length, 2);
	assert.deepEqual({ ...points[0].position }, { x: 5, y: 6 });
	const edge = canvas.edgeList.find(item => item.id === 'connection-1');
	assert.equal(edge.source, points[0].id);
	assert.equal(edge.sourceHandle, 'end');
});

test('invalid node declarations are rejected with their reason', () => {
	const value = JSON.parse(sourceCreate());
	value.nodes[0].isPositionLocked = true;
	assert.throws(() => new DiagramEditStore(JSON.stringify(value)), /explicit position/);
	value.nodes[0].isPositionLocked = 'true';
	assert.throws(() => new DiagramEditStore(JSON.stringify(value)), /must be boolean/);
	const single = JSON.parse(sourceCreate());
	single.nodes[1].handles[0].attachPolicy = 'single';
	single.connections.push({ id: 'second', source: { position: { x: 0, y: 0 } }, target: { nodeId: 'choice', handleId: 'header-in' } });
	assert.throws(() => diagramNormalize(single), /accepts one connection/);
	const header = JSON.parse(sourceCreate());
	header.nodes[0].handles.push({ id: 'title', direction: 'in', anchor: { target: 'header', side: 'left' } });
	assert.throws(() => diagramNormalize(header), /unknown anchor/);
});
