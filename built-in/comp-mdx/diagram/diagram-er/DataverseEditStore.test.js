import assert from 'node:assert/strict';
import test from 'node:test';
import { DataverseEditStore } from './DataverseEditStore.js';
import { DiagramERStore, diagramViewStateGet } from './DiagramERStore.js';
import { powerAutomateSourceDefaultCreate } from './PowerAutomateNodeSource.js';
import { businessRuleSourceDefaultCreate } from './BusinessRuleNodeSource.js';

test('resource starters edit fields and properties, restore cells, and reject invalid drafts', () => {
	for (const source of [powerAutomateSourceDefaultCreate(), businessRuleSourceDefaultCreate()]) {
		const store = new DataverseEditStore('# Keep this comment\n' + source.raw);
		const node = store.nodes[0];
		store.focusSet(node.id);
		assert.equal(store.rowFocused, undefined);
		assert.equal(store.propertyAdd(node.id), true);
		const row = store.rowsGet(store.nodeFocused).at(-1);
		store.cellStart(node.id, row.id, 'value');
		assert.equal(store.fieldSet(node.id, row.id, 'value', 'Configured'), true);
		store.cellCancel();
		assert.equal(store.rowsGet(store.nodeFocused).at(-1).value, '');
		assert.equal(store.fieldSet(node.id, null, 'kind', 'invalid'), false);
		assert.match(store.message, /unsupported value/);
		assert.equal(store.propertyRemove(node.id, row.id), true);
		assert.equal(store.isDirty, false);
		assert.match(store.rawDraft, /^# Keep this comment/);
	}
});

test('resource graph commands preserve identities and prevent dangling connections', () => {
	const store = new DataverseEditStore(powerAutomateSourceDefaultCreate().raw);
	assert.equal(store.nodeRemove('trigger'), false);
	assert.match(store.message, /connections first/);
	assert.equal(store.connectionSet('yes', 'label', 'Approved path'), true);
	assert.equal(store.connections.find(item => item.id === 'yes').label.text, 'Approved path');
	assert.equal(store.connectionSet('yes', 'target', { nodeId: 'missing', handleId: 'in' }), false);
	assert.equal(store.nodeAdd('business-rule'), true);
	assert.equal(store.nodeAdd('power-automate'), true);
	assert.equal(store.connectionAdd(), true);
	const connection = store.connections.at(-1);
	assert.equal(store.connectionSet(connection.id, 'target', { nodeId: 'business-rule-1', handleId: 'in' }), true);
	assert.equal(store.nodeRemove('business-rule-1'), false);
	assert.equal(store.connectionRemove(connection.id), true);
	assert.equal(store.nodeRemove('business-rule-1'), true);
	assert.equal(store.propertyRemove('trigger', 'filter'), true);
	store.handleModeSet('trigger', 'table', 'right');
	const handle = store.nodes[0].handles.find(item => item.anchor.target === 'property/table');
	assert.equal(store.connectionSet('start', 'source', { nodeId: 'trigger', handleId: handle.id }), true);
	assert.equal(store.propertyRemove('trigger', 'table'), false);
	assert.match(store.message, /connections first/);
	assert.equal(store.report.saveTarget, 'asset');
});

function sourceCreate() {
	return JSON.stringify({ version: 1, nodes: [
		{ id: 'table', renderer: { type: 'dataverse-table' }, data: { name: 'Table', columns: [{ id: 'email', name: 'Email', type: 'Text' }] }, handles: [{ id: 'email-out', direction: 'out', anchor: { target: 'column/email', side: 'right' } }] },
		{ id: 'choice', renderer: { type: 'dataverse-choice' }, data: { name: 'Choice', columns: [{ id: 'value' }] }, handles: [{ id: 'header-in', direction: 'in', anchor: { target: 'header', side: 'left' } }] },
	], connections: [{ id: 'link', source: { nodeId: 'table', handleId: 'email-out' }, target: { nodeId: 'choice', handleId: 'header-in' } }] });
}

test('cell draft and semantic focus are independent; Escape restores dirty state', () => {
	const store = new DataverseEditStore(sourceCreate());
	store.cellStart('table', 'email', 'name');
	store.fieldSet('table', 'email', 'name', 'Work email');
	assert.equal(store.isDirty, true);
	assert.deepEqual({ ...store.focus }, { nodeId: 'table', rowId: 'email' });
	store.cellCancel();
	assert.equal(store.isDirty, false);
	assert.equal(store.rawDraft, store.rawInitial);
	store.focusSet('table');
	assert.equal(store.focus.rowId, null);
	store.cellStart('table', 'email', 'name');
	store.fieldSet('table', 'email', 'name', 'Draft retained');
	const draft = store.rawDraft;
	store.focusSet(null);
	assert.equal(store.focus, null);
	assert.equal(store.cell, null);
	assert.equal(store.rawDraft, draft);
	assert.equal(store.isDirty, true);
});

test('row handles keep connection identity when moved and refuse destructive removal', () => {
	const store = new DataverseEditStore(sourceCreate());
	assert.equal(store.handleModeSet('table', 'email', 'left'), true);
	assert.equal(store.nodes[0].handles[0].id, 'email-out');
	assert.equal(store.handleModeGet('table', 'email'), 'left');
	assert.equal(store.handleModeSet('table', 'email', 'both'), true);
	assert.equal(store.handleModeGet('table', 'email'), 'both');
	assert.equal(store.handleModeSet('table', 'email', 'none'), false);
	assert.match(store.message, /connected/);
	assert.equal(store.handleModeGet('table', 'email'), 'both');
});

test('standalone cards retain handle configuration and choose save target without writing', () => {
	const node = JSON.parse(sourceCreate()).nodes[0];
	const store = new DataverseEditStore(JSON.stringify({ version: 1, node }), 'card');
	assert.equal(store.handleModeSet('table', 'email', 'none'), true);
	assert.equal(store.handleModeGet('table', 'email'), 'none');
	store.saveTargetSet('inline');
	assert.equal(store.report.saveTarget, 'inline');
	assert.equal(store.report.lang, 'yaml');
	assert.equal(store.isDirty, true);
});

test('remembered positions follow dragging and locked positions require unlocking', () => {
	const store = new DataverseEditStore(sourceCreate());
	assert.equal(store.nodeMove('table', { x: 20, y: 30 }), false);
	assert.equal(store.isDirty, false);
	assert.equal(store.positionRememberSet('table', true, { x: 20, y: 30 }), true);
	assert.equal(store.nodeMove('table', { x: 50, y: 60 }), true);
	assert.deepEqual(store.nodes[0].position, { x: 50, y: 60 });
	assert.equal(store.positionLockSet('table', true, { x: 50, y: 60 }), true);
	assert.equal(store.nodeMove('table', { x: 70, y: 80 }), false);
	assert.equal(store.positionRememberSet('table', false), false);
	assert.deepEqual(store.nodes[0].position, { x: 50, y: 60 });
	assert.equal(new DataverseEditStore(store.rawDraft).nodes[0].isPositionLocked, true);
	assert.equal(store.positionLockSet('table', false), true);
	assert.equal(store.nodeMove('table', { x: 70, y: 80 }), true);
	assert.equal(store.positionRememberSet('table', false), true);
	assert.equal(store.nodes[0].position, 'auto');
});

test('locking an automatic node captures its position and invalid coordinates are rejected', () => {
	const store = new DataverseEditStore(sourceCreate());
	assert.equal(store.positionLockSet('table', true, { x: 100, y: 200 }), true);
	assert.deepEqual(store.nodes[0].position, { x: 100, y: 200 });
	store.positionLockSet('table', false);
	assert.equal(store.positionRememberSet('table', true, { x: NaN, y: 0 }), false);
	assert.deepEqual(store.nodes[0].position, { x: 100, y: 200 });
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

test('canvas ignores movement of locked nodes but keeps measurement updates', () => {
	const draft = new DataverseEditStore(sourceCreate());
	draft.positionLockSet('table', true, { x: 100, y: 200 });
	const canvas = new DiagramERStore(draft.rawDraft);
	canvas.nodeListChange([{ type: 'position', id: 'table', position: { x: 0, y: 0 } }]);
	assert.deepEqual({ ...canvas.nodeList[0].position }, { x: 100, y: 200 });
	canvas.nodeListChange([{ type: 'dimensions', id: 'table', dimensions: { width: 410, height: 200 } }]);
	assert.equal(canvas.nodeList[0].measured.height, 200);
});

test('locked nodes reject automatic positions and nonboolean lock flags', () => {
	const value = JSON.parse(sourceCreate());
	value.nodes[0].isPositionLocked = true;
	assert.throws(() => new DataverseEditStore(JSON.stringify(value)), /explicit position/);
	value.nodes[0].isPositionLocked = 'true';
	assert.throws(() => new DataverseEditStore(JSON.stringify(value)), /must be boolean/);
});