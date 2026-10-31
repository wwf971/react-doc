import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagramEditStore } from './DiagramEditStore.js';
import { pathParse, pathFormat, pathResolve, pathLabelListGet, tabPathGet } from './DiagramEditPath.js';
import { powerPlatformNodeRegistry } from '../power-platform/power-platform-node-registry.js';

const registry = powerPlatformNodeRegistry;

function sourceCreate() {
	return JSON.stringify({ version: 1, nodes: [
		{ id: 'customer', renderer: { type: 'dataverse-table' }, data: { name: 'Customer', columns: [{ id: 'id', name: 'ID', type: 'Unique identifier', key: 'PK' }, { id: 'name', name: 'Name', type: 'Text' }] }, handles: [{ id: 'id-out', direction: 'out', anchor: { target: 'column/id', side: 'right' } }] },
		{ id: 'order', renderer: { type: 'table' }, data: { name: 'Order', fields: [{ id: 'what', label: 'What' }, { id: 'amount', label: 'Amount' }], rows: [{ id: 'r1', what: 'Pens', amount: '2' }] }, handles: [{ id: 'in', direction: 'in', anchor: { target: 'row/r1', side: 'left' } }] },
		{ id: 'rule', renderer: { type: 'business-rule' }, data: { name: 'Rule', properties: [] }, handles: [] },
	], connections: [{ id: 'buys', source: { nodeId: 'customer', handleId: 'id-out' }, target: { nodeId: 'order', handleId: 'in' }, label: { text: 'buys' } }] });
}

test('the three spellings of a subject route to the same canonical path and display', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	const byId = pathResolve(pathParse('node(id=customer) > rows > row(id=name)'), store);
	const byIndex = pathResolve(pathParse('node(id=customer) > rows > index=1'), store);
	const byName = pathResolve(pathParse('node(id=customer) > columns > name=Name'), store);
	assert.deepEqual(byIndex.path, byId.path);
	assert.deepEqual(byName.path, byId.path);
	assert.equal(pathFormat(byId.path), 'node(id=customer) > rows > row(id=name)');
	assert.deepEqual(byId.display, { principal: 'node', nodeId: 'customer', connectionId: null, rowId: 'name', fieldId: null, propId: null, tab: 'row', view: 'detail' });
	// the card's own word for its fields, and the list with "all"
	assert.equal(pathResolve(pathParse('node(id=order) > columns > all'), store).display.tab, 'column');
	assert.equal(pathResolve(pathParse('node(id=order) > columns'), store).display.view, 'list');
	assert.equal(pathResolve(pathParse('node(id=customer) > fields > name=Type'), store).display.fieldId, 'type');
	// a cell is a field under a row
	const cell = pathResolve(pathParse('node(id=customer) > rows > id=name > id=type'), store);
	assert.equal(cell.display.tab, 'cell');
	assert.equal(pathFormat(cell.path), 'node(id=customer) > rows > row(id=name) > field(id=type)');
	assert.deepEqual(pathLabelListGet(cell.path, store), ['Customer', 'Columns', 'Name', 'Type']);
});

test('a subject that does not exist redirects to its list, and a principal that is gone to nothing', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	assert.equal(pathResolve(pathParse('node(id=customer) > rows > id=missing'), store).display.view, 'list');
	assert.equal(pathResolve(pathParse('node(id=customer) > rows > id=name > id=missing'), store).display.tab, 'row');
	assert.equal(pathResolve(pathParse('node(id=nobody) > rows'), store).display, null);
	assert.equal(pathResolve(pathParse('connection(id=nobody)'), store).display, null);
	assert.equal(pathResolve(pathParse('node(id=rule) > prop(id=scope)'), store).display.propId, 'scope');
	assert.equal(pathResolve(pathParse('node(id=rule) > prop(id=nothing)'), store).display.propId, null);
	assert.deepEqual(pathResolve(pathParse('connection(id=buys) > rows'), store).path, [{ kind: 'connection', id: 'buys' }]);
	// a line reached from the card must be attached to the card
	assert.equal(pathResolve(pathParse('node(id=rule) > lines > id=buys'), store).display.view, 'list');
	assert.equal(pathResolve(pathParse('node(id=order) > lines > index=0'), store).display.connectionId, 'buys');
});

test('the store keeps its path canonical through data changes and tab clicks', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	store.pathSet(pathParse('node(id=customer) > columns > index=1'));
	assert.deepEqual(store.selection, { nodeId: 'customer', rowId: 'name', fieldId: null, connectionId: null, propId: null });
	assert.equal(store.cardTabSet('cell'), false);
	assert.equal(store.cardTabSet('column'), true);
	assert.equal(store.display.view, 'list');
	assert.equal(store.cardTabSet('row'), true);
	assert.equal(store.display.rowId, null);
	store.select('customer', { rowId: 'name', fieldId: 'type' });
	assert.deepEqual(tabPathGet(store.display, 'column'), [{ kind: 'node', id: 'customer' }, { kind: 'fields' }, { kind: 'field', id: 'type' }]);
	assert.equal(store.rowRemove('customer', 'name'), true);
	assert.deepEqual(store.path, [{ kind: 'node', id: 'customer' }, { kind: 'rows' }]);
	store.select('order', { rowId: 'r1' });
	assert.equal(store.nodeRemove('customer', () => null), true);
	assert.equal(store.display.nodeId, 'order');
	store.pathUp();
	assert.equal(store.display.view, 'list');
	store.pathUp();
	assert.equal(store.display.tab, 'table');
	store.pathUp();
	assert.equal(store.selection, null);
});

test('a redirect rule of the host is applied after the built-in ones', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, registry);
	store.redirectRuleList.push((display, path) => display?.tab === 'cell' ? path.slice(0, 3) : null);
	store.select('customer', { rowId: 'name', fieldId: 'type' });
	assert.equal(store.display.tab, 'row');
	store.redirectRuleList.push(() => [{ kind: 'node', id: 'loop' }]);
	store.select('customer');
	assert.equal(store.display, null);
});
