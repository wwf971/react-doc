import assert from 'node:assert/strict';
import test from 'node:test';
import { treeRevealState, treeRowListBuild, treeSearchSetBuild, treeWordListOf } from './DiagramPanelTreeData.js';
import { DiagramPanelTreeStore } from './DiagramPanelTreeStore.js';

// a tree of a root holding 45 children (a00..a44); a03 holds 30 (a03/b00..b29), a05 holds 2
function modelBuild() {
	const childByKey = new Map([['root', Array.from({ length: 45 }, (_, index) => `a${String(index).padStart(2, '0')}`)]]);
	childByKey.set('a03', Array.from({ length: 30 }, (_, index) => `a03/b${String(index).padStart(2, '0')}`));
	childByKey.set('a05', ['a05/x', 'a05/y']);
	const parentByKey = new Map([['root', '']]);
	for (const [parent, list] of childByKey) for (const key of list) parentByKey.set(key, parent);
	return {
		rootKeyList: ['root'],
		itemGet: key => ({ key, label: key }),
		childKeyListGet: key => childByKey.get(key) ?? [],
		parentKeyGet: key => parentByKey.get(key) ?? '',
		searchTextGet: key => (key === 'a05/y' ? 'yellow' : key),
		isExpandedDefault: key => key === 'root',
	};
}
const stateOf = (patch = {}) => ({ expandedByKey: {}, pageByKey: {}, filterByKey: {}, searchCollapsedByKey: {}, pageSize: 20, ...patch });
const shapeOf = rowList => rowList.map(row => (row.type === 'pager' ? `${'  '.repeat(row.depth)}[${row.page + 1}/${row.pageCount} ${row.from}-${row.to} of ${row.total}]` : `${'  '.repeat(row.depth)}${row.key}`));

test('a level over the page size is shown a page at a time, under a pager row', () => {
	const model = modelBuild();
	const rowList = treeRowListBuild(model, stateOf());
	assert.equal(rowList[0].key, 'root');
	assert.equal(rowList[1].type, 'pager');
	assert.deepEqual([rowList[1].page, rowList[1].pageCount, rowList[1].from, rowList[1].to, rowList[1].total], [0, 3, 1, 20, 45]);
	assert.equal(rowList.length, 1 + 1 + 20);
	const last = treeRowListBuild(model, stateOf({ pageByKey: { root: 9 } }));
	assert.deepEqual([last[1].page, last[1].from, last[1].to], [2, 41, 45], 'a page past the end is the last');
	// below the size: no pager
	assert.equal(treeRowListBuild(model, stateOf({ pageSize: 50 })).some(row => row.type === 'pager'), false);
});

test('opening an item inside a page inserts its children there; its page keeps the same siblings; pages nest', () => {
	const model = modelBuild();
	const closed = treeRowListBuild(model, stateOf());
	const open = treeRowListBuild(model, stateOf({ expandedByKey: { a03: true, a05: true } }));
	const siblingOf = rowList => rowList.filter(row => row.type === 'item' && row.depth === 1).map(row => row.key);
	assert.deepEqual(siblingOf(open), siblingOf(closed), 'the page of the parent holds the same children');
	const shape = shapeOf(open);
	const at = shape.indexOf('  a03');
	assert.equal(shape[at + 1], '    [1/2 1-20 of 30]', 'a nested level has a pager of its own');
	assert.equal(shape[at + 2], '    a03/b00');
	assert.equal(shape[at + 22], '  a04');
	assert.deepEqual(shape.slice(shape.indexOf('  a05') + 1, shape.indexOf('  a05') + 3), ['    a05/x', '    a05/y']);
	// the nested level on its second page; the root level stays on its first
	const second = treeRowListBuild(model, stateOf({ expandedByKey: { a03: true }, pageByKey: { a03: 1 } }));
	assert.equal(shapeOf(second)[shapeOf(second).indexOf('  a03') + 1], '    [2/2 21-30 of 30]');
});

test('the filter of a level narrows its children; its pager stays while it is typed', () => {
	const model = modelBuild();
	const rowList = treeRowListBuild(model, stateOf({ filterByKey: { root: 'a4' } }));
	assert.equal(rowList[1].type, 'pager', 'the row with the field stays though five fit on a page');
	assert.deepEqual([rowList[1].total, rowList[1].countLevel, rowList[1].filter], [5, 45, 'a4']);
	assert.deepEqual(rowList.slice(2).map(row => row.key), ['a40', 'a41', 'a42', 'a43', 'a44']);
});

test('a search keeps what holds every word and what is above it, open, each level still paged', () => {
	const model = modelBuild();
	const search = treeSearchSetBuild(model, treeWordListOf('yellow'));
	assert.deepEqual([...search.matchKeySet], ['a05/y']);
	assert.deepEqual(shapeOf(treeRowListBuild(model, stateOf(), search)), ['root', '  a05', '    a05/y']);
	// closed during the search: closed; the author's own choices are not touched
	assert.deepEqual(shapeOf(treeRowListBuild(model, stateOf({ searchCollapsedByKey: { a05: true } }), search)), ['root', '  a05']);
	const many = treeSearchSetBuild(model, treeWordListOf('b'));
	const rowList = treeRowListBuild(model, stateOf(), many);
	assert.equal(rowList.find(row => row.type === 'pager' && row.parentKey === 'a03').total, 30);
	// what is selected stays in sight
	assert.equal(treeSearchSetBuild(model, treeWordListOf('yellow'), new Set(['a40'])).shownKeySet.has('a40'), true);
});

test('a reveal opens what is above, turns each page to the next one down, empties a filter hiding it', () => {
	const model = modelBuild();
	const state = stateOf({ expandedByKey: { root: false }, filterByKey: { a03: 'b0' } });
	const next = treeRevealState(model, state, 'a03/b25');
	assert.equal(next.expandedByKey.root, true);
	assert.equal(next.expandedByKey.a03, true);
	assert.equal(next.pageByKey.root, 0);
	assert.equal(next.pageByKey.a03, 1);
	assert.equal(next.filterByKey.a03, undefined);
	const shape = shapeOf(treeRowListBuild(model, next));
	assert.ok(shape.includes('    a03/b25'));
	assert.equal(treeRevealState(model, state, 'nowhere'), state, 'a key not in the tree changes nothing');
	assert.equal(treeRevealState(model, stateOf(), 'a44').pageByKey.root, 2);
});

test('the store: a page size changed keeps the first item shown on the page shown; a reveal asks to scroll', () => {
	const model = modelBuild();
	const tree = new DiagramPanelTreeStore({ pageSize: 10 });
	tree.pageSet('root', 3);
	tree.pageSizeSet(20);
	assert.equal(tree.pageByKey.root, 1);
	tree.reveal('a03/b29', model);
	assert.equal(tree.expandedByKey.a03, true);
	assert.equal(tree.pageByKey.a03, 1);
	assert.equal(tree.scrollRequest.key, 'a03/b29');
	tree.toggle('a03', undefined, model);
	assert.equal(tree.expandedByKey.a03, false);
	tree.searchSet('yellow');
	assert.deepEqual(shapeOf(tree.rowListGet(model)), ['root', '  a05', '    a05/y']);
	tree.toggle('a05', undefined, model);
	assert.deepEqual(shapeOf(tree.rowListGet(model)), ['root', '  a05']);
	tree.searchSet('');
	assert.equal(tree.expandedByKey.a05, undefined, 'closing during a search is not the author\'s choice');
});
