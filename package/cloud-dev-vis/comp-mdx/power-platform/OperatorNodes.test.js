import assert from 'node:assert/strict';
import test from 'node:test';
import { diagramNormalize } from '../card-diagram/DiagramERData.js';
import { DiagramEditStore } from '../card-diagram/DiagramEditStore.js';
import { cardSchemaGet } from '../card-diagram/TableCardSchema.js';
import { cardDiagramNodeRegistry } from '../card-diagram/card-diagram-node-registry.js';
import { dataverseEntityNodeRegistry, powerPlatformNodeRegistry } from './power-platform-node-registry.js';
import { operatorMappingNormalize, operatorNodeKindList } from './OperatorNodes.js';

function sourceCreate() {
	return JSON.stringify({ version: 1, nodes: operatorNodeKindList.map(kind => kind.create.nodeCreate(prefix => prefix)), connections: [] });
}

test('operators have compact defaults and explicit left/right handles only in Power Platform', () => {
	const graph = diagramNormalize(JSON.parse(sourceCreate()), powerPlatformNodeRegistry);
	for (const kind of operatorNodeKindList) {
		assert.ok(kind.contract.sizeDefault.width < powerPlatformNodeRegistry.kindByType['dataverse-table'].contract.sizeDefault.width);
		const node = graph.nodes.find(item => item.renderer.type === kind.type);
		assert.deepEqual(node.handles.map(handle => handle.anchor.side), ['left', 'right']);
		assert.deepEqual(node.anchors.find(anchor => anchor.id === 'body').sideList, ['left', 'right']);
		assert.equal(cardDiagramNodeRegistry.kindByType[kind.type], undefined);
		assert.equal(dataverseEntityNodeRegistry.kindByType[kind.type], undefined);
		const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, powerPlatformNodeRegistry);
		assert.ok(store.nodeAdd(kind.type, { x: 20, y: 40 }));
		assert.equal(store.handleSideSet(node.id, 'body', 'top', true), false);
	}
	assert.deepEqual(graph.nodes[0].handles.map(handle => handle.direction), ['in', 'in']);
	assert.deepEqual(graph.nodes[1].handles.map(handle => handle.direction), ['in', 'out']);
	assert.throws(() => diagramNormalize(JSON.parse(sourceCreate()), cardDiagramNodeRegistry), /unknown node type/);
});

test('operation header and text edit, cancel and round-trip through the existing draft', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, powerPlatformNodeRegistry);
	store.cellStart('operation', null, 'description');
	assert.equal(store.fieldSet('operation', null, 'description', 'Trim whitespace'), true);
	store.cellCancel();
	assert.equal(store.isDirty, false);
	assert.equal(store.fieldSet('operation', null, 'name', 'Normalize email'), true);
	assert.equal(store.fieldSet('operation', null, 'description', 'Trim and lowercase'), true);
	const restored = new DiagramEditStore(store.rawDraft, 'diagram', undefined, powerPlatformNodeRegistry);
	assert.equal(restored.nodeGet('operation').data.name, 'Normalize email');
	assert.equal(restored.nodeGet('operation').data.description, 'Trim and lowercase');
	assert.equal(store.fieldSet('operation', null, 'description', {}), false);
	assert.match(store.message, /must be text/);
});

test('mapping has exactly two fixed columns and editable stable entries', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, powerPlatformNodeRegistry);
	const schema = cardSchemaGet(store.nodeGet('mapping'), powerPlatformNodeRegistry);
	assert.deepEqual(schema.fieldList.map(field => field.id), ['key', 'value']);
	assert.equal(store.columnInsert('mapping', 0), null);
	assert.equal(store.columnRemove('mapping', 'key'), false);
	assert.equal(store.columnMove('mapping', 'value', 0), false);
	assert.equal(store.columnLabelSet('mapping', 'key', 'Third'), false);
	assert.equal(store.fieldSet('mapping', 'entry-1', 'third', 'No'), false);
	assert.equal(store.fieldSet('mapping', null, 'name', 'Status mapping'), true);
	assert.equal(store.fieldSet('mapping', 'entry-1', 'key', 'active'), true);
	assert.equal(store.fieldSet('mapping', 'entry-1', 'value', 'Enabled'), true);
	store.cellStart('mapping', 'entry-1', 'value');
	store.fieldSet('mapping', 'entry-1', 'value', 'Cancelled draft');
	store.cellCancel();
	assert.equal(store.rowGet('mapping', 'entry-1').value, 'Enabled');
	const rowId = store.rowInsert('mapping');
	assert.ok(rowId);
	assert.equal(store.fieldSet('mapping', rowId, 'key', 'inactive'), true);
	assert.equal(store.fieldSet('mapping', rowId, 'value', 'Disabled'), true);
	assert.equal(store.rowMove('mapping', rowId, 0), true);
	assert.equal(store.handleSideSet('mapping', `row/${rowId}`, 'right', true), true);
	assert.equal(store.rowRemove('mapping', rowId), true);
	const restored = new DiagramEditStore(store.rawDraft, 'diagram', undefined, powerPlatformNodeRegistry);
	assert.equal(restored.rowGet('mapping', 'entry-1').key, 'active');
	assert.equal(restored.rowGet('mapping', 'entry-1').value, 'Enabled');
	assert.equal(restored.nodeGet('mapping').data.fields, undefined);
	assert.throws(() => operatorMappingNormalize({ fields: [{ id: 'extra' }] }), /exactly two fixed columns/);
	assert.throws(() => operatorMappingNormalize({ rows: [{ id: 'same' }, { id: 'same' }] }), /Duplicate row/);
	assert.deepEqual(operatorMappingNormalize(operatorMappingNormalize({ rows: [] })), operatorMappingNormalize({ rows: [] }));
});

test('abandon label defaults, edits, cancels and round-trips through the existing draft', () => {
	const source = JSON.parse(sourceCreate());
	source.nodes.find(node => node.id === 'abandon').data = {};
	const store = new DiagramEditStore(JSON.stringify(source), 'diagram', undefined, powerPlatformNodeRegistry);
	assert.equal(diagramNormalize(store.value, powerPlatformNodeRegistry).nodes.find(node => node.id === 'abandon').data.name, 'Abandon');
	store.cellStart('abandon', null, 'name');
	assert.equal(store.fieldSet('abandon', null, 'name', 'Ignore legacy value'), true);
	store.cellCancel();
	assert.deepEqual(store.nodeGet('abandon').data, {});
	assert.equal(store.isDirty, false);
	assert.equal(store.fieldSet('abandon', null, 'name', 'Discard'), true);
	const restored = new DiagramEditStore(store.rawDraft, 'diagram', undefined, powerPlatformNodeRegistry);
	assert.equal(restored.nodeGet('abandon').data.name, 'Discard');
	assert.equal(store.fieldSet('abandon', null, 'name', ''), true);
	assert.equal(store.nodeGet('abandon').data.name, '');
	assert.equal(store.fieldSet('abandon', null, 'name', {}), false);
	assert.match(store.message, /must be text/);
});

test('abandon receives connections on either side and never supplies an output by default', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, powerPlatformNodeRegistry);
	assert.ok(store.connectionCreate({ nodeId: 'operation', handleId: 'right' }, { nodeId: 'abandon', handleId: 'left' }));
	assert.ok(store.connectionCreate({ nodeId: 'mapping', handleId: 'right' }, { nodeId: 'abandon', handleId: 'right' }));
	assert.equal(store.connectionCreate({ nodeId: 'abandon', handleId: 'left' }, { nodeId: 'operation', handleId: 'left' }), null);
	assert.equal(diagramNormalize(store.value, powerPlatformNodeRegistry).connections.length, 2);
});