import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagramEditStore } from './DiagramEditStore.js';
import { DiagramERStore, diagramViewStateGet } from './DiagramERStore.js';
import { powerAutomateSourceDefaultCreate } from '../power-platform/PowerAutomateNodeSource.js';
import { businessRuleSourceDefaultCreate } from '../power-platform/BusinessRuleNodeSource.js';
import { diagramNormalize, endpointIsDangling } from './DiagramERData.js';
import { dataverseEntityNodeRegistry, powerPlatformNodeRegistry } from '../power-platform/power-platform-node-registry.js';

// the engine is tested on the registry of the Power Platform series, which
// holds every card variant (fixed fields, resource fields, authored fields)
const registry = powerPlatformNodeRegistry;

function sourceCreate() {
	return JSON.stringify({ version: 1, nodes: [
		{ id: 'table', renderer: { type: 'dataverse-table' }, data: { name: 'Table', columns: [{ id: 'email', name: 'Email', type: 'Text' }, { id: 'phone', name: 'Phone', type: 'Text' }] }, handles: [{ id: 'email-out', direction: 'out', anchor: { target: 'column/email', side: 'right' } }] },
		{ id: 'choice', renderer: { type: 'dataverse-choice' }, data: { name: 'Choice', columns: [{ id: 'value' }] }, handles: [{ id: 'header-in', direction: 'in', anchor: { target: 'header', side: 'left' } }] },
	], connections: [{ id: 'link', source: { nodeId: 'table', handleId: 'email-out' }, target: { nodeId: 'choice', handleId: 'header-in' } }] });
}

const positionGet = (nodeId, handleId) => ({ x: 100, y: 50, side: /left|in$/.test(handleId) ? 'left' : 'right' });

test('resource starters edit fields and rows, restore cells, and reject invalid drafts', () => {
	for (const source of [powerAutomateSourceDefaultCreate(), businessRuleSourceDefaultCreate()]) {
		const store = new DiagramEditStore('# Keep this comment\n' + source.raw, 'diagram', undefined, registry);
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
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
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
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
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
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
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
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
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
	const graph = diagramNormalize(store.value, registry);
	assert.equal(graph.connections.length, 2);
});

test('a handle click rotates through its connections and ends on the list of the lines', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
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
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
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
	const connection = diagramNormalize(store.value, registry).connections[0];
	assert.equal(connection.renderer.type, 'bezier');
	assert.equal(connection.style.strokeWidth, 2.5);
	assert.equal(connection.markerStart, 'arrow');
	assert.equal(connection.isAnimated, true);
});

test('nodes and connections are created from the registry and a removed node leaves dangling ends', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
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
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
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
	const store = new DiagramEditStore(JSON.stringify({ version: 1, node }), 'card', undefined, dataverseEntityNodeRegistry);
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
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	assert.equal(store.nodeMove('table', { x: 20, y: 30 }), false);
	assert.equal(store.isDirty, false);
	assert.equal(store.positionRememberSet('table', true, { x: 20, y: 30 }), true);
	assert.equal(store.nodeMove('table', { x: 50, y: 60 }), true);
	assert.deepEqual(store.nodes[0].position, { x: 50, y: 60 });
	assert.equal(store.positionLockSet('table', true, { x: 50, y: 60 }), true);
	assert.equal(store.nodeMove('table', { x: 70, y: 80 }), false);
	assert.equal(store.positionRememberSet('table', false), false);
	assert.equal(new DiagramEditStore(store.rawDraft, 'diagram', undefined, registry).nodes[0].isPositionLocked, true);
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
	const draft = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	draft.positionLockSet('table', true, { x: 100, y: 200 });
	draft.connectionCreateDangling({ x: 5, y: 6 });
	const canvas = new DiagramERStore(draft.rawDraft, undefined, 620, registry);
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
	assert.throws(() => new DiagramEditStore(JSON.stringify(value), 'diagram', undefined, registry), /explicit position/);
	value.nodes[0].isPositionLocked = 'true';
	assert.throws(() => new DiagramEditStore(JSON.stringify(value), 'diagram', undefined, registry), /must be boolean/);
	const single = JSON.parse(sourceCreate());
	single.nodes[1].handles[0].attachPolicy = 'single';
	single.connections.push({ id: 'second', source: { position: { x: 0, y: 0 } }, target: { nodeId: 'choice', handleId: 'header-in' } });
	assert.throws(() => diagramNormalize(single, registry), /accepts one connection/);
	const header = JSON.parse(sourceCreate());
	header.nodes[0].handles.push({ id: 'title', direction: 'in', anchor: { target: 'header', side: 'left' } });
	assert.throws(() => diagramNormalize(header, registry), /unknown anchor/);
});

// ---------- the history of the draft (card-diagram-impl.md#history) ----------

test('a new store has no history, and every command through changeApply is undone and redone', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	assert.equal(store.history.isUndoAvailable, false);
	assert.equal(store.history.isRedoAvailable, false);
	assert.equal(store.undo(), false);
	const rowId = store.rowInsert('table', 0);
	assert.equal(store.handleSideSet('table', 'column/phone', 'left', true), true);
	assert.equal(store.connectionSet('link', 'lineType', 'bezier'), true);
	assert.equal(store.nodeRemove('choice', positionGet), true);
	assert.equal(store.history.length, 4);
	const rawAfter = store.rawDraft;
	assert.equal(store.undo(), true);
	assert.ok(store.nodeGet('choice'));
	assert.deepEqual(store.connectionGet('link').target, { nodeId: 'choice', handleId: 'header-in' });
	assert.equal(store.undo(), true);
	assert.equal(store.connectionGet('link').renderer, undefined);
	assert.equal(store.undo(), true);
	assert.equal(store.nodeGet('table').handles.length, 1);
	assert.equal(store.undo(), true);
	assert.equal(store.rowGet('table', rowId), undefined);
	assert.equal(store.isDirty, false);
	assert.equal(store.rawDraft, store.rawInitial);
	assert.equal(store.history.isUndoAvailable, false);
	assert.equal(store.history.isRedoAvailable, true);
	for (let index = 0; index < 4; index += 1) assert.equal(store.redo(), true);
	assert.equal(store.rawDraft, rawAfter);
	assert.equal(store.redo(), false);
	// a new change after an undo drops what could be redone
	assert.equal(store.undo(), true);
	assert.equal(store.connectionSet('link', 'isAnimated', true), true);
	assert.equal(store.history.isRedoAvailable, false);
	assert.equal(store.redo(), false);
});

test('the selection is not a step of the history, and the path is re-resolved after an undo', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	store.select('table', { rowId: 'email' });
	store.selectConnection('link');
	store.cardTabSet('line');
	store.selectionClear();
	assert.equal(store.history.isUndoAvailable, false);
	const rowId = store.rowInsert('table');
	assert.equal(store.selection.rowId, rowId);
	assert.equal(store.undo(), true);
	// the row the path led to is gone: the path goes to the list of rows
	assert.deepEqual(store.path, [{ kind: 'node', id: 'table' }, { kind: 'rows' }]);
	assert.equal(store.selection.rowId, null);
	store.select('table', { rowId: 'phone' });
	assert.equal(store.redo(), true);
	// a redo does not move the selection either
	assert.equal(store.selection.rowId, 'phone');
	assert.ok(store.rowGet('table', rowId));
});

test('the typing in a cell is one step, a cell restored with Escape leaves none, and a picked value is a step of its own', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	store.cellStart('table', 'email', 'name');
	for (const text of ['W', 'Wo', 'Wor', 'Work']) assert.equal(store.fieldSet('table', 'email', 'name', text), true);
	store.cellEnd();
	assert.equal(store.history.length, 1);
	store.cellStart('table', 'email', 'name');
	assert.equal(store.fieldSet('table', 'email', 'name', 'Work email'), true);
	store.cellEnd();
	assert.equal(store.history.length, 2);
	assert.equal(store.undo(), true);
	assert.equal(store.rowGet('table', 'email').name, 'Work');
	assert.equal(store.undo(), true);
	assert.equal(store.rowGet('table', 'email').name, 'Email');
	assert.equal(store.history.isUndoAvailable, false);
	// typed and restored: nothing to undo
	store.cellStart('table', 'phone', 'name');
	store.fieldSet('table', 'phone', 'name', 'P');
	store.fieldSet('table', 'phone', 'name', 'Ph');
	store.cellCancel();
	assert.equal(store.rowGet('table', 'phone').name, 'Phone');
	assert.equal(store.history.isUndoAvailable, false);
	// a value that was not there is removed again by Escape, and leaves no step
	store.cellStart('table', 'phone', 'description');
	store.fieldSet('table', 'phone', 'description', 'A phone');
	store.cellCancel();
	assert.equal(Object.hasOwn(store.rowGet('table', 'phone'), 'description'), false);
	assert.equal(store.history.isUndoAvailable, false);
	// a value picked from a menu: each pick is a step
	assert.equal(store.fieldSet('table', 'email', 'key', 'PK'), true);
	assert.equal(store.fieldSet('table', 'email', 'key', 'FK'), true);
	assert.equal(store.history.length, 2);
	// a typed field of the edit card groups until the path moves elsewhere
	assert.equal(store.connectionSet('link', 'label', 'p'), true);
	assert.equal(store.connectionSet('link', 'label', 'pl'), true);
	assert.equal(store.connectionSet('link', 'stroke', '#000000'), true);
	assert.equal(store.connectionSet('link', 'stroke', '#111111'), true);
	assert.equal(store.history.length, 4);
	store.selectConnection('link');
	assert.equal(store.connectionSet('link', 'stroke', '#222222'), true);
	assert.equal(store.history.length, 5);
	assert.equal(store.undo(), true);
	assert.equal(store.connectionGet('link').style.stroke, '#111111');
	assert.equal(store.undo(), true);
	assert.equal(store.connectionGet('link').style, undefined);
	assert.equal(store.connectionGet('link').label.text, 'pl');
});

test('a refused change, a change that changes nothing, and a gesture in progress leave the history alone', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	assert.equal(store.connectionSet('link', 'lineType', 'curvy'), false);
	assert.equal(store.fieldSet('table', 'email', 'name', 'Email'), true);
	assert.equal(store.history.isUndoAvailable, false);
	assert.equal(store.rowMove('table', 'email', 1), true);
	store.interactionSet({ type: 'nodeDrag', nodeId: 'table' });
	assert.equal(store.undo(), false);
	assert.deepEqual(store.rowsGet(store.nodeGet('table')).map(row => row.id), ['phone', 'email']);
	store.interactionSet(null);
	assert.equal(store.undo(), true);
	assert.deepEqual(store.rowsGet(store.nodeGet('table')).map(row => row.id), ['email', 'phone']);
	store.historyClear();
	assert.equal(store.history.isUndoAvailable, false);
	assert.equal(store.history.isRedoAvailable, false);
});

test('an undo keeps the comments of the initial text and the canvas follows an undone position', () => {
	const store = new DiagramEditStore('# Keep this comment\n' + powerAutomateSourceDefaultCreate().raw, 'diagram', undefined, registry);
	const node = store.nodes[0];
	assert.equal(store.positionRememberSet(node.id, true, { x: 10, y: 20 }), true);
	assert.equal(store.nodeMove(node.id, { x: 300, y: 400 }), true);
	const canvas = new DiagramERStore(store.rawDraft, undefined, 620, registry);
	assert.deepEqual({ ...canvas.nodeList[0].position }, { x: 300, y: 400 });
	// a drag in progress leaves the canvas node where the pointer is; the
	// draft reloaded keeps that place while the authored position is unchanged
	canvas.nodeListChange([{ type: 'position', id: node.id, position: { x: 310, y: 410 } }]);
	canvas.sourceLoad(store.rawDraft, true);
	assert.deepEqual({ ...canvas.nodeList[0].position }, { x: 310, y: 410 });
	assert.equal(store.undo(), true);
	canvas.sourceLoad(store.rawDraft, true);
	assert.deepEqual({ ...canvas.nodeList[0].position }, { x: 10, y: 20 });
	assert.equal(canvas.positionsTemporary[node.id], undefined);
	assert.equal(store.undo(), true);
	assert.equal(store.isDirty, false);
	assert.match(store.rawDraft, /^# Keep this comment/);
});

test('a node resized is one step of the draft, undone whole; a size below its minimum is refused', () => {
	const source = JSON.stringify({ version: 1, nodes: [{ id: 'box', renderer: { type: 'view-box' }, position: { x: 10, y: 20 }, size: { width: 300, height: 200 }, data: {} }] });
	const store = new DiagramEditStore(source, 'diagram', undefined, registry);
	assert.equal(store.nodeResize('box', { x: 15.4, y: 25, width: 400.2, height: 250 }), true);
	assert.deepEqual(store.nodes[0].position, { x: 15, y: 25 });
	assert.deepEqual(store.nodes[0].size, { width: 400, height: 250 });
	assert.equal(store.undo(), true);
	assert.deepEqual(store.nodes[0].position, { x: 10, y: 20 });
	assert.deepEqual(store.nodes[0].size, { width: 300, height: 200 });
	assert.equal(store.redo(), true);
	assert.deepEqual(store.nodes[0].size, { width: 400, height: 250 });
	assert.equal(store.nodeResize('box', { x: 0, y: 0, width: 10, height: 10 }), false);
	assert.match(store.message, /smaller than renderer minimum/);
	assert.deepEqual(store.nodes[0].size, { width: 400, height: 250 });
});

test('the canvas follows a size the draft says otherwise, over what a resize left on the node', () => {
	const sourceOf = (width) => JSON.stringify({ version: 1, nodes: [{ id: 'box', renderer: { type: 'view-box' }, position: { x: 0, y: 0 }, size: { width, height: 200 }, data: {} }] });
	const canvas = new DiagramERStore(sourceOf(300), undefined, 620, registry);
	canvas.nodeListChange([{ id: 'box', type: 'dimensions', dimensions: { width: 240, height: 200 }, setAttributes: true }]);
	assert.equal(canvas.nodeList[0].width, 240);
	canvas.sourceLoad(sourceOf(300), true);
	assert.equal(canvas.nodeList[0].width, 240, 'a draft reloaded with the same size keeps the node');
	canvas.sourceLoad(sourceOf(500), true);
	assert.equal(canvas.nodeList[0].width, undefined);
	assert.equal(canvas.nodeList[0].style.width, 500);
});

test('removing a row takes it out of rowDisplay', () => {
	const raw = JSON.stringify({ version: 1, nodes: [{ id: 't', renderer: { type: 'table' }, position: { x: 0, y: 0 }, data: { name: 'T', fields: [{ id: 'f', label: 'F' }], rows: [{ id: 'a', f: '1' }, { id: 'b', f: '2' }], rowDisplay: ['a', '...', 'b'] }, handles: [] }], connections: [] });
	const store = new DiagramEditStore(raw, 'diagram', undefined, registry);
	assert.equal(store.rowRemove('t', 'b'), true, store.message);
	assert.deepEqual(store.nodeGet('t').data.rowDisplay, ['a', '...']);
});

test('the rows a card shows and its row breaks are steps of the draft', () => {
	const raw = JSON.stringify({ version: 1, nodes: [{ id: 't', renderer: { type: 'table' }, position: { x: 0, y: 0 }, data: { name: 'T', fields: [{ id: 'f', label: 'F' }], rows: [{ id: 'a', f: '1' }, { id: 'b', f: '2' }, { id: 'c', f: '3' }] }, handles: [{ id: 'h', direction: 'out', anchor: { target: 'row/c', side: 'right' } }] }], connections: [] });
	const store = new DiagramEditStore(raw, 'diagram', undefined, registry);
	const display = () => store.nodeGet('t').data.rowDisplay;
	// a row break on a card showing all its rows starts a list
	assert.equal(store.rowBreakInsert('t', { afterRowId: 'a' }), 1);
	assert.deepEqual(display(), ['a', '...', 'b', 'c']);
	store.rowBreakTextSet('t', 1, 'two');
	store.rowBreakTextSet('t', 1, 'two more');
	assert.deepEqual(display()[1], { break: 'two more' });
	store.rowBreakTextSet('t', 1, '');
	assert.equal(display()[1], '...');
	// hide, show, move
	assert.equal(store.rowShownSet('t', 'b', false), true);
	assert.deepEqual(display(), ['a', '...', 'c']);
	assert.equal(store.rowShownSet('t', 'c', false), false, 'a row with a handle stays');
	assert.match(store.message, /handle/);
	assert.equal(store.rowShownSet('t', 'b', true, 0), true);
	assert.deepEqual(display(), ['b', 'a', '...', 'c']);
	store.rowDisplayMove('t', 3, 0);
	assert.deepEqual(display(), ['c', 'b', 'a', '...']);
	store.rowDisplayEntryRemove('t', 3);
	assert.deepEqual(display(), ['c', 'b', 'a']);
	// two row breaks side by side are refused
	assert.equal(store.rowBreakInsert('t', { afterRowId: 'a' }), 3);
	assert.equal(store.rowBreakInsert('t', { afterRowId: 'a' }), null);
	assert.match(store.message, /already there/);
	assert.equal(store.rowBreakInsert('t', { afterRowId: 'b' }), 2);
	assert.equal(store.rowBreakInsert('t'), null);
	store.rowDisplaySet('t', ['c', 'b', 'a']);
	// a row added shows; a row break after a row left out is refused
	const added = store.rowInsert('t');
	assert.ok(display().includes(added));
	store.rowShownSet('t', added, false);
	assert.equal(store.rowBreakInsert('t', { afterRowId: added }), null);
	// a wrong list is refused, the draft kept
	assert.equal(store.rowDisplaySet('t', ['nope']), false);
	assert.match(store.message, /not a row/);
	assert.deepEqual(display(), ['c', 'b', 'a']);
	// all rows again, and one undo brings the list back
	store.rowDisplaySet('t', null);
	assert.equal(display(), undefined);
	store.undo();
	assert.deepEqual(display(), ['c', 'b', 'a']);
});

test('the display of a card is set in the edit card, and a default leaves the data', () => {
	const raw = JSON.stringify({ version: 1, nodes: [{ id: 't', renderer: { type: 'table' }, position: { x: 0, y: 0 }, data: { name: 'T', fields: [{ id: 'f', label: 'F' }], rows: [{ id: 'a', f: '1' }] }, handles: [] }], connections: [] });
	const store = new DiagramEditStore(raw, 'diagram', undefined, registry);
	assert.equal(store.fieldSet('t', null, 'isCompact', true), true);
	assert.equal(store.nodeGet('t').data.isCompact, true);
	assert.equal(store.fieldSet('t', null, 'isCompact', false, true), true);
	assert.equal('isCompact' in store.nodeGet('t').data, false);
	assert.equal(store.fieldSet('t', null, 'tone', 'teal'), true);
});

test('the views of a card are steps of the draft, and what they name goes with what is removed', () => {
	const raw = JSON.stringify({ version: 1, nodes: [{ id: 't', renderer: { type: 'table' }, position: { x: 0, y: 0 }, data: { name: 'T', fields: [{ id: 'f', label: 'F' }, { id: 'g', label: 'G' }], rows: [{ id: 'a', f: '1', g: '2' }, { id: 'b', f: '3', g: '4' }], rowDisplay: ['a', '...'] }, handles: [] }], connections: [] });
	const store = new DiagramEditStore(raw, 'diagram', undefined, registry);
	const data = () => store.nodeGet('t').data;
	// the first view declared keeps the plain view the card had, with its list
	const id = store.viewAdd('t', 'row');
	assert.deepEqual(data().viewList.map((view) => [view.id, view.mode]), [['plain', 'plain'], [id, 'row']]);
	assert.deepEqual(data().viewList[0].rowDisplay, ['a', '...']);
	assert.equal(data().rowDisplay, undefined);
	assert.equal(store.cardViewGet('t').id, id, 'it is the one shown now');
	// rows shown are those of the view shown
	store.rowDisplaySet('t', ['b']);
	assert.deepEqual(data().viewList[1].rowDisplay, ['b']);
	assert.deepEqual(data().viewList[0].rowDisplay, ['a', '...']);
	store.cardViewSet('t', 'plain');
	assert.deepEqual(store.rowDisplayCurrentGet('t'), ['a', '...']);
	// parameters; another mode chooses among other rows
	store.viewSet('t', id, { fieldDisplay: ['g'] });
	assert.deepEqual(data().viewList[1].fieldDisplay, ['g']);
	store.viewSet('t', id, { mode: 'column' });
	assert.equal(data().viewList[1].mode, 'column');
	assert.equal(data().viewList[1].fieldDisplay, undefined);
	assert.equal(data().viewList[1].rowDisplay, undefined);
	store.viewSet('t', id, { valueRowId: 'b' });
	// default and switcher
	assert.equal(store.viewDefaultSet('t', id), true);
	assert.equal(data().viewDefault, id);
	assert.equal(store.viewSwitcherShownSet('t', false), true);
	assert.equal(data().isViewSwitcherHidden, true);
	// removed things leave the views valid
	assert.equal(store.rowRemove('t', 'b'), true, store.message);
	assert.equal(data().viewList[1].valueRowId, undefined);
	assert.equal(store.columnRemove('t', 'g'), true, store.message);
	// a wrong list is refused
	assert.equal(store.viewListWrite('t', [{ id: 'x', mode: 'nope' }]), false);
	assert.match(store.message, /mode must be/);
	// the last view gone: the plain view of the card, and no default naming a view gone
	assert.equal(store.viewRemove('t', id), true);
	assert.equal(data().viewDefault, undefined);
	assert.equal(store.viewRemove('t', 'plain'), true);
	assert.equal(data().viewList, undefined);
	assert.equal(store.cardViewGet('t').isImplicit, true);
});
