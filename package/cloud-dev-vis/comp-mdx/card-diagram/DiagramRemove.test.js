import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagramEditStore } from './DiagramEditStore.js';
import { diagramRemovalOf } from './DiagramRemove.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';

// What Delete takes away of what is selected, and what depends on it (card-diagram-impl.md#removing-what-is-selected)
const registry = cardDiagramNodeRegistry;
const noteOf = (id, extra = {}) => ({ id, renderer: { type: 'card-note' }, position: { x: 0, y: 0 }, size: { width: 160, height: 60 }, data: { title: id[0].toUpperCase() + id.slice(1) }, handles: [{ id: 'in', direction: 'in', anchor: { side: 'left' } }, { id: 'out', direction: 'out', anchor: { side: 'right' } }], ...extra });
const value = {
	version: 1,
	nodes: [
		noteOf('source'),
		noteOf('target', { position: { x: 300, y: 0 } }),
		noteOf('alone', { position: { x: 0, y: 300 } }),
		{ id: 'table', renderer: { type: 'table' }, position: { x: 600, y: 0 }, data: { name: 'Orders', fields: [{ id: 'name', label: 'Name' }, { id: 'kind', label: 'Kind' }], rows: [{ id: 'a', name: 'Row a', kind: 'x' }, { id: 'b', name: 'Row b' }] }, handles: [{ id: 'a-out', direction: 'out', anchor: { target: 'row/a', side: 'right' } }] },
		{ id: 'frame', renderer: { type: 'color-block' }, around: { nodeIdList: ['source', 'target'], padding: 20 }, data: { tone: 'blue' }, handles: [] },
		{ id: 'frame-alone', renderer: { type: 'color-block' }, around: { nodeIdList: ['alone'], padding: 10 }, data: { tone: 'green' }, handles: [] },
	],
	connections: [
		{ id: 'l1', source: { nodeId: 'source', handleId: 'out' }, target: { nodeId: 'target', handleId: 'in' } },
		{ id: 'l2', source: { nodeId: 'table', handleId: 'a-out' }, target: { nodeId: 'target', handleId: 'in' } },
	],
};
const storeOf = () => new DiagramEditStore(JSON.stringify(value), 'diagram', undefined, registry);

test('a node with nothing on it goes at once; one with lines and frames says what becomes of them', () => {
	const store = storeOf();
	store.select('target');
	const removal = diagramRemovalOf(store);
	assert.equal(removal.kind, 'node');
	assert.equal(removal.what, '"Target"');
	assert.deepEqual(removal.dependentList.map(item => [item.id, item.count]), [['lines', 2], ['around', 1]]);
	const before = store.rawDraft;
	assert.equal(removal.run(), true);
	assert.equal(store.nodeGet('target'), undefined);
	// its lines keep a free end, the frame around it frames what else it framed
	assert.ok(store.connectionGet('l1').target.position);
	assert.deepEqual(store.nodeGet('frame').around.nodeIdList, ['source']);
	assert.equal(store.display, null);
	assert.equal(store.undo(), true);
	assert.equal(store.rawDraft, before);
});

test('a frame drawn around a node alone stays where it is, at its size, when the node goes', () => {
	const store = storeOf();
	store.select('alone');
	const removal = diagramRemovalOf(store, { boxGet: id => (id === 'frame-alone' ? { x: -10, y: 290, width: 180, height: 80 } : null) });
	assert.deepEqual(removal.dependentList.map(item => item.id), ['around-alone']);
	removal.run();
	const frame = store.nodeGet('frame-alone');
	assert.equal(frame.around, undefined);
	assert.deepEqual(frame.position, { x: -10, y: 290 });
	assert.deepEqual(frame.size, { width: 180, height: 80 });
	// without the box as drawn, it is estimated from the sizes written
	const other = storeOf();
	other.nodeRemove('alone');
	assert.deepEqual(other.nodeGet('frame-alone').position, { x: -10, y: 290 });
	assert.deepEqual(other.nodeGet('frame-alone').size, { width: 180, height: 80 });
});

test('a line, an anchor, a row and a column are what is selected when they are; a cell and a list take nothing', () => {
	const store = storeOf();
	store.selectConnection('l1');
	assert.deepEqual([diagramRemovalOf(store).kind, diagramRemovalOf(store).dependentList.length], ['line', 0]);
	store.select('table', { rowId: 'a' });
	const row = diagramRemovalOf(store);
	assert.equal(row.kind, 'row');
	assert.deepEqual(row.dependentList.map(item => [item.id, item.count]), [['lines', 1]]);
	row.run();
	assert.equal(store.rowGet('table', 'a'), undefined);
	// the path is the list of rows now: a second Delete does not take the card
	assert.equal(diagramRemovalOf(store), null);
	store.select('table', { fieldId: 'kind' });
	const field = diagramRemovalOf(store);
	assert.equal(field.kind, 'field');
	assert.deepEqual(field.dependentList.map(item => [item.id, item.count]), []);
	store.select('table', { rowId: 'b', fieldId: 'name' });
	assert.equal(diagramRemovalOf(store), null);
	// a column of a card whose columns are fixed: not taken, with the reason
	const fixed = new DiagramEditStore(JSON.stringify({ version: 1, nodes: [noteOf('n')] }), 'diagram', undefined, registry);
	fixed.select('n');
	assert.equal(diagramRemovalOf(fixed).kind, 'node');
});

test('a draft whose structure is given takes its lines and nothing else', () => {
	const store = new DiagramEditStore(JSON.stringify(value), 'diagram', undefined, registry, { isStructureFixed: true });
	store.select('target');
	assert.equal(diagramRemovalOf(store), null);
	store.selectConnection('l1');
	assert.equal(diagramRemovalOf(store).kind, 'line');
});
