import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreContext } from '../../../../main/frontend/src/store/context.js';
import { ValueMenu } from './DiagramValueControls.jsx';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagramEditStore } from './DiagramEditStore.js';
import { cardModelBuild } from './DiagramEditCardModel.js';
import { CardCell } from './TableCard.jsx';
import { fieldOfRow, nodePropertyListGet } from './TableCardSchema.js';
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
	// a typed field of the edit card groups until the path moves elsewhere; a color dragged in a
	// picker groups under the key of its picking, a color picked from a swatch is a step of its own
	assert.equal(store.connectionSet('link', 'label', 'p'), true);
	assert.equal(store.connectionSet('link', 'label', 'pl'), true);
	assert.equal(store.connectionSet('link', 'stroke', '#000000', { groupKey: 'color:pick-1' }), true);
	assert.equal(store.connectionSet('link', 'stroke', '#111111', { groupKey: 'color:pick-1' }), true);
	assert.equal(store.history.length, 4);
	store.selectConnection('link');
	assert.equal(store.connectionSet('link', 'stroke', '#2563eb'), true);
	assert.equal(store.connectionSet('link', 'stroke', '#dc2626'), true);
	assert.equal(store.history.length, 6);
	assert.equal(store.undo(), true);
	assert.equal(store.connectionGet('link').style.stroke, '#2563eb');
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
	const source = JSON.stringify({ version: 1, nodes: [{ id: 'box', renderer: { type: 'scene-box' }, position: { x: 10, y: 20 }, size: { width: 300, height: 200 }, data: {} }] });
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

test('the create panel is opened at a place, and in the state of an action when asked to', () => {
	const store = new DiagramEditStore(JSON.stringify({ version: 1, nodes: [], connections: [] }), 'diagram', undefined, registry);
	store.createOpen({ x: 1, y: 2 });
	assert.deepEqual(store.create, { position: { x: 1, y: 2 }, actionId: undefined });
	store.createOpen({ x: 3, y: 4 }, { actionId: 'table-add' });
	assert.equal(store.create.actionId, 'table-add');
	store.createClose();
	assert.equal(store.create, null);
});

test('a graph made by a generator replaces the nodes and the lines in one step, undone whole; an invalid one is refused', () => {
	const box = (id, x) => ({ id, renderer: { type: 'scene-box' }, position: { x, y: 0 }, size: { width: 100, height: 100 }, data: {} });
	const store = new DiagramEditStore(JSON.stringify({ version: 1, nodes: [box('a', 0)], connections: [] }), 'diagram', undefined, registry);
	assert.equal(store.graphSet({ nodes: [box('a', 50), box('b', 300)], connections: [] }, { selectId: 'b' }), true);
	assert.deepEqual(store.nodes.map(node => [node.id, node.position.x]), [['a', 50], ['b', 300]]);
	assert.equal(store.selection?.nodeId, 'b');
	assert.equal(store.undo(), true);
	assert.deepEqual(store.nodes.map(node => [node.id, node.position.x]), [['a', 0]]);
	assert.equal(store.redo(), true);
	assert.equal(store.nodes.length, 2);
	// two nodes of one id: refused, the draft and the history as they were
	assert.equal(store.graphSet({ nodes: [box('a', 0), box('a', 9)], connections: [] }), false);
	assert.ok(store.message);
	assert.equal(store.nodes.length, 2);
});

test('the canvas follows a size the draft says otherwise, over what a resize left on the node', () => {
	const sourceOf = (width) => JSON.stringify({ version: 1, nodes: [{ id: 'box', renderer: { type: 'scene-box' }, position: { x: 0, y: 0 }, size: { width, height: 200 }, data: {} }] });
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

test('a row break with rows behind it, in the editor: the list stays one list, and each change is a step', () => {
	const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, value: id }));
	const raw = JSON.stringify({ version: 1, nodes: [{ id: 't', renderer: { type: 'table' }, position: { x: 0, y: 0 }, data: { name: 'T', fields: [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }], rows, rowDisplay: ['a', 'b', 'c', '...', 'd'] } }] });
	const store = new DiagramEditStore(raw, 'diagram', undefined, cardDiagramNodeRegistry);
	const listOf = () => store.nodeGet('t').data.rowDisplay;
	assert.equal(store.rowBreakFoldSet('t', 3, { rowList: ['b', 'c'] }), true);
	assert.deepEqual(listOf(), ['a', { break: '', rowList: ['b', 'c'] }, 'd'], 'the rows leave the places they had');
	assert.equal(store.rowBreakFoldSet('t', 1, { isExpanded: true }), true);
	assert.deepEqual(listOf()[1], { break: '', rowList: ['b', 'c'], isExpanded: true });
	store.rowBreakTextSet('t', 1, 'two');
	assert.deepEqual(listOf()[1], { break: 'two', rowList: ['b', 'c'], isExpanded: true }, 'its words change alone');
	assert.equal(store.rowShownSet('t', 'b', true), false, 'a row behind a break is shown already');
	store.rowShownSet('t', 'b', false);
	assert.deepEqual(listOf()[1].rowList, ['c']);
	assert.equal(store.rowBreakFoldSet('t', 0, { rowList: ['d'] }), false, 'a row is not a row break');
	assert.match(store.message, /no row break/);
	store.rowBreakFoldSet('t', 1, { rowList: [] });
	assert.deepEqual(listOf(), ['a', { break: 'two' }, 'd'], 'no rows behind it: the mark alone');
	store.undo();
	assert.deepEqual(listOf()[1].rowList, ['c'], 'one step');
});

test('a value menu in a cell with no value draws nothing, as the card does when reading; its menu still names it', () => {
	const render = (props) => renderToStaticMarkup(createElement(StoreContext.Provider, { value: { componentConfig: {} } }, createElement(ValueMenu, { label: 'Key', values: ['', 'PK'], valueLabels: { '': 'None' }, onChange: () => {}, ...props })));
	assert.doesNotMatch(render({ value: '', isCell: true }), /None/);
	assert.match(render({ value: 'PK', isCell: true }), /PK/);
	assert.match(render({ value: '', isCell: false }), /None/, 'outside a cell the control says so');
});


// ---------- a draft whose structure is given (DiagramEditStore.js: scope)

// two cards saying more of their rows than their kind knows, a label carrying settings, a line
function scopedSourceCreate() {
	return JSON.stringify({ version: 1, nodes: [
		{ id: 'settings', renderer: { type: 'card-label' }, position: { x: 0, y: 0 }, isPositionLocked: true, data: { title: 'Settings', name: 'First',
			propertyList: [{ id: 'name', label: 'Name' }, { id: 'kind', label: 'Kind', isReadOnly: true }, { id: 'size', label: 'Size', placeholder: 'as its plan says: 100' }, { id: 'isOn', label: 'On', kind: 'bool' }], kind: 'Comparison', size: '', isOn: true } },
		{ id: 'source', renderer: { type: 'dataverse-table' }, position: { x: 0, y: 60 }, isPositionLocked: true, data: { name: 'Source',
			fieldExtraList: [{ id: 'compare', label: 'Compared as', kind: 'enum', values: ['', 'same', 'ignore', 'kept'], valueLabels: { same: 'same value', ignore: 'Not compared', kept: 'as written' }, valuesKey: 'compareValueList', valueLabelsKey: 'compareLabels', valueTones: { same: 'teal' }, width: '9rem' }],
			rowPropertyExtraList: [{ id: 'reason', label: 'Why', isMultiline: true }],
			columns: [{ id: 'a', name: 'A', type: 'Text', compare: 'same', compareValueList: ['', 'same', 'ignore'] }, { id: 'b', name: 'B', type: 'Text', compare: 'kept', compareLabels: { kept: 'trim' } }] },
			handles: [{ id: 'c-a', direction: 'out', anchor: { target: 'column/a', side: 'right' }, attachPolicy: 'single' }, { id: 'c-b', direction: 'out', anchor: { target: 'column/b', side: 'right' }, attachPolicy: 'single' }] },
		{ id: 'target', renderer: { type: 'table' }, position: { x: 700, y: 60 }, isPositionLocked: true, data: { name: 'Target', fields: [{ id: 'value', label: 'Value', isReadOnly: true }, { id: 'way', label: 'Way', kind: 'enum', values: ['x', 'y'] }], rows: [{ id: 'r1', value: '1', way: 'x' }] },
			handles: [{ id: 'r1', direction: 'in', anchor: { target: 'row/r1', side: 'left' } }] },
	], connections: [{ id: 'rule-a', source: { nodeId: 'source', handleId: 'c-a' }, target: { nodeId: 'target', handleId: 'r1' } }] });
}

test('a card says more of its rows through its data: further fields as columns, further properties, values and words of a row\'s own', () => {
	const store = new DiagramEditStore(scopedSourceCreate(), 'diagram', undefined, registry);
	const schema = store.schemaGet('source');
	// the fields of the kind, then the one declared; a property of a row beside those of the kind
	assert.deepEqual(schema.fieldList.map(field => field.id), ['key', 'name', 'nameLogical', 'type', 'compare']);
	assert.deepEqual(schema.fieldExtraList.map(field => [field.id, field.kind, field.width]), [['compare', 'enum', '9rem']]);
	assert.ok(schema.rowPropertyList.some(property => property.id === 'reason' && property.isMultiline));
	// a field written in the data of a generic table keeps what it is: a choice, a value only shown
	assert.deepEqual(store.schemaGet('target').fieldList.map(field => [field.id, field.kind, Boolean(field.isReadOnly)]), [['value', 'text', true], ['way', 'enum', false]]);
	assert.equal(store.fieldSet('target', 'r1', 'value', '2'), false);
	assert.equal(store.fieldSet('target', 'r1', 'way', 'y'), true);
	// the values a row can take, and the words of its own for one of them
	const compare = schema.fieldList.at(-1);
	assert.deepEqual(fieldOfRow(compare, store.rowGet('source', 'a')).values, ['', 'same', 'ignore']);
	assert.deepEqual(fieldOfRow(compare, store.rowGet('source', 'b')).values, ['', 'same', 'ignore', 'kept']);
	assert.equal(fieldOfRow(compare, store.rowGet('source', 'b')).valueLabels.kept, 'trim');
	assert.equal(fieldOfRow(compare, store.rowGet('source', 'a')).valueLabels.kept, 'as written');
	assert.equal(store.fieldSet('source', 'a', 'compare', 'ignore'), true);
	assert.equal(store.fieldSet('source', 'a', 'reason', 'not needed'), true);
	assert.equal(store.rowGet('source', 'a').reason, 'not needed');
	// a cell that only shows reads as the words of its value, in its tone; an empty choice as nothing
	const cellOf = (rowId, editor) => renderToStaticMarkup(createElement(CardCell, { editor, nodeId: 'source', rowId, field: fieldOfRow(compare, new DiagramEditStore(scopedSourceCreate(), 'diagram', undefined, registry).rowGet('source', rowId)), value: rowId === 'a' ? 'same' : 'kept' }));
	assert.match(cellOf('a'), /data-field="compare" data-cell-tone="teal">same value</);
	assert.match(cellOf('b'), />trim</);
	// a label: a node that is no card, with the properties its data declares beside the words of its kind
	assert.deepEqual(nodePropertyListGet(store.nodeGet('settings'), registry).map(property => property.id), ['title', 'name', 'kind', 'size', 'isOn']);
	assert.equal(store.fieldSet('settings', null, 'name', 'Second'), true);
	assert.equal(store.fieldSet('settings', null, 'kind', 'Other'), false);
	assert.equal(store.fieldSet('settings', null, 'isOn', false), true);
	assert.equal(store.nodeGet('settings').data.isOn, false);
	// the words of a compact card are typed too (they were refused: the editor did not know them)
	const note = new DiagramEditStore(JSON.stringify({ version: 1, nodes: [{ id: 'n', renderer: { type: 'card-note' }, data: { title: 'T', text: '' } }] }), 'diagram', undefined, registry);
	assert.equal(note.fieldSet('n', null, 'title', 'Typed'), true);
	assert.equal(note.undo(), true);
	assert.equal(note.nodeGet('n').data.title, 'T');
});

test('a draft whose structure is given: values and lines alone, what follows from a change written with it, the edit card of values', () => {
	const scope = {
		isStructureFixed: true,
		fieldIsEditable: (node, rowId, fieldId) => (node.id === 'settings' ? fieldId !== 'title' : node.id === 'source' && Boolean(rowId) && ['compare', 'reason'].includes(fieldId)),
		// a column not compared loses its line; a line drawn from one gives it the plain way
		react: (value, before) => {
			const columns = value.nodes.find(node => node.id === 'source').data.columns;
			const lineOf = (list, id) => (list ?? []).find(line => line.source.handleId === `c-${id}`);
			let isChanged = false;
			const columnBefore = id => before.nodes.find(node => node.id === 'source').data.columns.find(column => column.id === id);
			for (const column of columns) {
				const line = lineOf(value.connections, column.id);
				if (column.compare !== columnBefore(column.id).compare) {
					if (column.compare === 'ignore' && line) { value.connections = value.connections.filter(one => one !== line); isChanged = true; }
				} else if (line && !lineOf(before.connections, column.id) && column.compare !== 'same') { column.compare = 'same'; isChanged = true; }
			}
			return isChanged ? { ...value } : undefined;
		},
	};
	const store = new DiagramEditStore(scopedSourceCreate(), 'diagram', undefined, registry, scope);
	assert.equal(store.isStructureFixed, true);
	// which values: what the scope says, never one its definition only shows
	assert.equal(store.fieldIsEditable('source', 'a', 'compare'), true);
	assert.equal(store.fieldIsEditable('source', 'a', 'name'), false);
	assert.equal(store.fieldIsEditable('settings', null, 'name'), true);
	assert.equal(store.fieldIsEditable('settings', null, 'kind'), false);
	assert.equal(store.fieldIsEditable('settings', null, 'title'), false);
	assert.equal(store.fieldSet('source', 'a', 'name', 'Other'), false);
	assert.equal(store.fieldSet('target', 'r1', 'way', 'y'), false);
	// what follows from a change is written with it: one step, taken back as one
	assert.equal(store.fieldSet('source', 'a', 'compare', 'ignore'), true);
	assert.equal(store.connections.length, 0);
	assert.equal(store.undo(), true);
	assert.deepEqual([store.rowGet('source', 'a').compare, store.connections.length], ['same', 1]);
	assert.equal(store.redo(), true);
	assert.deepEqual([store.rowGet('source', 'a').compare, store.connections.length], ['ignore', 0]);
	// a line drawn: the cell follows; the source handle takes one line
	assert.ok(store.connectionCreate({ nodeId: 'source', handleId: 'c-a' }, { nodeId: 'target', handleId: 'r1' }));
	assert.equal(store.rowGet('source', 'a').compare, 'same');
	assert.equal(store.connectionCreate({ nodeId: 'source', handleId: 'c-a' }, { nodeId: 'target', handleId: 'r1' }), null);
	// the edit card: no tabs, no path; the values that may change, and those the data declared to say
	const editor = { store, change: operation => operation(), handlePositionGet: positionGet };
	store.select('settings');
	const settings = cardModelBuild(editor);
	assert.deepEqual([settings.title, settings.tabList.length, settings.segmentList.length], ['Settings', 0, 0]);
	assert.deepEqual(settings.view.sectionList[0].propertyList.map(property => [property.id, property.kind, Boolean(property.isReadOnly)]), [['name', 'text', false], ['kind', 'text', true], ['size', 'text', false], ['isOn', 'bool', false]]);
	assert.equal(settings.view.sectionList[0].propertyList[2].placeholder, 'as its plan says: 100');
	assert.equal(settings.view.sectionList[0].propertyList[0].set('Renamed'), true);
	assert.equal(store.nodeGet('settings').data.name, 'Renamed');
	// a row: its choice with the values and words of that row, and what is said of it
	store.select('source', { rowId: 'b' });
	const row = cardModelBuild(editor);
	assert.deepEqual([row.title, row.kindLabel], ['B', 'Column']);
	assert.deepEqual(row.view.sectionList[0].propertyList.map(property => property.id), ['compare', 'reason']);
	assert.equal(row.view.sectionList[0].propertyList[0].valueLabels.kept, 'trim');
	// a line: the two things it joins, and its removal; nothing of how it looks
	store.selectConnection(store.connections[0].id);
	const line = cardModelBuild(editor);
	assert.equal(line.title, 'A → 1');
	assert.deepEqual(line.view.sectionList[0].propertyList.map(property => [property.id, property.value]), [['source', 'Source / A'], ['target', 'Target / 1']]);
	assert.deepEqual(line.view.sectionList[0].actionList.map(action => action.id), ['connection-remove']);
	// a thing with nothing to change has no card
	store.select('target', { rowId: 'r1' });
	assert.equal(cardModelBuild(editor), null);
	store.select('target');
	assert.equal(cardModelBuild(editor), null);
	// without a scope the card is the whole one, as in a document
	const free = new DiagramEditStore(scopedSourceCreate(), 'diagram', undefined, registry);
	free.select('source');
	assert.ok(cardModelBuild({ store: free, change: operation => operation(), handlePositionGet: positionGet }).tabList.length > 0);
});

test('a line of a draft whose structure is given keeps data of its own, its card drawn by the host; the create panel opened for something', () => {
	const store = new DiagramEditStore(scopedSourceCreate(), 'diagram', undefined, registry, { isStructureFixed: true, fieldIsEditable: () => false });
	const id = store.connections[0].id;
	// a value of the line: kept in its data, one step, taken back as one, taken away with undefined
	assert.equal(store.connectionDataSet(id, 'rule', { compare: 'pipeline', stepList: [{ op: 'trim' }] }), true);
	assert.deepEqual(store.connectionGet(id).data.rule, { compare: 'pipeline', stepList: [{ op: 'trim' }] });
	assert.equal(store.undo(), true);
	assert.equal(store.connectionGet(id).data?.rule, undefined);
	assert.equal(store.redo(), true);
	assert.equal(store.connectionDataSet(id, 'rule', undefined), true);
	assert.equal(store.connectionGet(id).data?.rule, undefined);
	assert.equal(store.connectionDataSet('none', 'rule', 1), false);
	// the card of the line: the host's, beside it, when the host draws one; else the editor's
	store.selectConnection(id);
	const render = () => 'the host card';
	const hosted = cardModelBuild({ store, change: operation => operation(), handlePositionGet: positionGet, lineCardGet: connection => (connection.id === id ? { title: 'Rule', width: 420, render } : null) });
	assert.deepEqual([hosted.title, hosted.view.type, hosted.view.width, hosted.view.render()], ['Rule', 'host', 420, 'the host card']);
	assert.equal(cardModelBuild({ store, change: operation => operation(), handlePositionGet: positionGet, lineCardGet: () => null }).view.type, 'detail');
	// the create panel opened in the state of an action, for something: what it was opened for reaches it
	store.createOpen({ x: 10, y: 20 }, { actionId: 'pick', param: { from: { nodeId: 'source', handleId: 'c-a' } } });
	assert.deepEqual(store.create, { position: { x: 10, y: 20 }, actionId: 'pick', param: { from: { nodeId: 'source', handleId: 'c-a' } } });
});

test('the box of a node scrolls only what its card holds beyond it by more than a few pixels', async () => {
	const { NODE_OVERFLOW_SCROLL_MIN, nodeOverflowIsScroll } = await import('./DiagramNodeOverflow.js');
	const box = (scrollWidth, clientWidth, scrollHeight = 48, clientHeight = 48) => ({ scrollWidth, clientWidth, scrollHeight, clientHeight });
	// the hover room of a cell reaching past its words, an outline: cut, no scrollbar
	assert.equal(nodeOverflowIsScroll(box(204, 200)), false);
	assert.equal(nodeOverflowIsScroll(box(200 + NODE_OVERFLOW_SCROLL_MIN, 200)), false);
	// what a card really holds beyond its box: scrolled, either way
	assert.equal(nodeOverflowIsScroll(box(200 + NODE_OVERFLOW_SCROLL_MIN + 1, 200)), true);
	assert.equal(nodeOverflowIsScroll(box(200, 200, 300, 48)), true);
});

test('depth: a number of a node or a line and the four moves, each one step an undo takes back; the canvas and the edit card follow', () => {
	const source = JSON.stringify({ version: 1, nodes: [
		{ id: 'block', renderer: { type: 'color-block' }, position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, data: { tone: 'blue' } },
		{ id: 'a', renderer: { type: 'card-note' }, position: { x: 20, y: 20 }, data: { title: 'A' }, handles: [{ id: 'out', direction: 'out', anchor: { side: 'right' } }] },
		{ id: 'b', renderer: { type: 'card-note' }, position: { x: 300, y: 20 }, data: { title: 'B' }, handles: [{ id: 'in', direction: 'in', anchor: { side: 'left' } }] },
		{ id: 'shape', renderer: { type: 'card-note' }, position: { x: 150, y: 10 }, data: { title: 'S' } },
		{ id: 'pinned', renderer: { type: 'card-note' }, pin: 'top-right', data: { title: 'P' } },
	], connections: [{ id: 'line', source: { nodeId: 'a', handleId: 'out' }, target: { nodeId: 'b', handleId: 'in' } }] });
	const store = new DiagramEditStore(source, 'diagram', undefined, registry);
	const order = () => store.depthOrderList.map(item => item.key);
	const orderInitial = ['node:block', 'connection:line', 'node:a', 'node:b', 'node:shape'];
	// no depth written: backgrounds, lines, nodes as written; a pinned node has no place
	assert.deepEqual(order(), orderInitial);

	// a depth typed is a step; 0 takes the key away, and the draft is what it was
	assert.equal(store.depthSet({ nodeId: 'a' }, 2), true);
	assert.equal(store.nodeGet('a').depth, 2);
	assert.equal(store.depthGet({ nodeId: 'a' }), 2);
	assert.equal(order().at(-1), 'node:a');
	assert.equal(store.depthSet({ nodeId: 'a' }, 0), true);
	assert.equal('depth' in store.nodeGet('a'), false);
	assert.equal(store.isDirty, false);
	assert.equal(store.undo(), true);
	assert.equal(store.nodeGet('a').depth, 2);
	assert.equal(store.undo(), true);
	assert.deepEqual(order(), orderInitial);
	assert.equal(store.history.isUndoAvailable, false);
	// what is no number, a node pinned to the viewport: refused, nothing changed
	assert.equal(store.depthSet({ nodeId: 'a' }, Number.NaN), false);
	assert.equal(store.depthSet({ nodeId: 'pinned' }, 1), false);
	assert.match(store.message, /pinned to the viewport/);
	assert.equal(store.depthSet({ connectionId: 'none' }, 1), false);
	assert.equal(store.history.isUndoAvailable, false);

	// the shape lies on the line and on the block, not on the other notes
	const rectByKey = { 'node:block': { x: 0, y: 0, width: 400, height: 300 }, 'node:a': { x: 20, y: 20, width: 100, height: 60 }, 'node:b': { x: 300, y: 20, width: 100, height: 60 }, 'node:shape': { x: 150, y: 10, width: 100, height: 80 }, 'connection:line': { x: 120, y: 50, width: 180, height: 0 } };
	const geometry = { rectOf: key => rectByKey[key] ?? null };
	// sent backward: under the line, still over the block, the other notes still over the line
	assert.equal(store.depthMove({ nodeId: 'shape' }, 'backward', { geometry }), true);
	assert.deepEqual(order(), ['node:block', 'node:shape', 'connection:line', 'node:a', 'node:b']);
	// the canvas draws it: a z-index from the depths, lines and nodes without one as they were
	const canvas = new DiagramERStore(store.rawDraft, undefined, 620, registry);
	const zIndexOf = id => canvas.nodeList.find(node => node.id === id).zIndex;
	assert.ok(zIndexOf('block') < zIndexOf('shape') && zIndexOf('shape') < 0);
	assert.equal(zIndexOf('a'), 0);
	assert.equal(canvas.edgeList[0].zIndex, undefined);
	// one step, whatever it wrote
	assert.equal(store.undo(), true);
	assert.deepEqual(order(), orderInitial);
	assert.equal(store.isDirty, false);
	assert.equal(store.redo(), true);
	assert.deepEqual(order(), ['node:block', 'node:shape', 'connection:line', 'node:a', 'node:b']);
	// and forward again: over the line, as it was
	assert.equal(store.depthMove({ nodeId: 'shape' }, 'forward', { geometry }), true);
	assert.deepEqual(order().slice(0, 3), ['node:block', 'connection:line', 'node:shape']);
	store.undo();
	store.undo();

	// nothing to pass: refused with its reason, no step
	assert.equal(store.depthMove({ nodeId: 'shape' }, 'forward', { geometry }), false);
	assert.equal(store.message, 'Nothing lies over it.');
	assert.equal(store.depthMove({ nodeId: 'block' }, 'back'), false);
	assert.equal(store.message, 'It is behind everything already.');
	assert.equal(store.depthMove({ nodeId: 'shape' }, 'sideways'), false);
	assert.equal(store.history.isUndoAvailable, false);
	assert.equal(store.depthMoveReasonGet({ nodeId: 'shape' }, 'front'), 'It is in front of everything already.');
	assert.equal(store.depthMoveReasonGet({ nodeId: 'shape' }, 'back'), '');

	// a line to the front: over every node
	assert.equal(store.depthMove({ connectionId: 'line' }, 'front'), true);
	assert.equal(store.connectionGet('line').depth, 1);
	assert.equal(order().at(-1), 'connection:line');
	assert.equal(new DiagramERStore(store.rawDraft, undefined, 620, registry).edgeList[0].zIndex, 2);
	assert.equal(store.undo(), true);
	assert.equal('depth' in store.connectionGet('line'), false);

	// the edit card: the depth and the four moves, greyed with why when there is nothing to pass
	store.select('shape');
	const editor = { store, change: operation => operation(), handlePositionGet: positionGet };
	const depthSection = () => cardModelBuild(editor).view.sectionList.find(section => section.id === 'depth');
	assert.deepEqual(depthSection().actionList.map(action => [action.id, action.isDisabled]), [['depth-front', true], ['depth-forward', true], ['depth-backward', false], ['depth-back', false]]);
	assert.equal(depthSection().actionList[0].reason, 'It is in front of everything already.');
	assert.equal(depthSection().propertyList[0].value, 0);
	assert.equal(depthSection().propertyList[0].set(-3), true);
	assert.equal(store.nodeGet('shape').depth, -3);
	assert.equal(order()[0], 'node:shape');
	assert.equal(depthSection().actionList.find(action => action.id === 'depth-front').act(), true);
	assert.equal(order().at(-1), 'node:shape');
	// a line has the section too; a node pinned to the viewport has none
	store.selectConnection('line');
	assert.ok(cardModelBuild(editor).view.sectionList.some(section => section.id === 'depth'));

	// a draft whose structure is given takes no depth; a depth that is no number does not read
	const fixed = new DiagramEditStore(source, 'diagram', undefined, registry, { isStructureFixed: true });
	assert.equal(fixed.depthSet({ nodeId: 'a' }, 1), false);
	assert.equal(fixed.depthMove({ nodeId: 'a' }, 'front'), false);
	assert.throws(() => diagramNormalize({ version: 1, nodes: [{ id: 'a', renderer: { type: 'card-note' }, data: { title: 'A' }, depth: 'high' }] }, registry), /a\.depth must be a number/);
	assert.throws(() => diagramNormalize({ version: 1, nodes: [], connections: [{ id: 'l', source: { position: { x: 0, y: 0 } }, target: { position: { x: 9, y: 9 } }, depth: '1' }] }, registry), /l\.depth must be a number/);
});
