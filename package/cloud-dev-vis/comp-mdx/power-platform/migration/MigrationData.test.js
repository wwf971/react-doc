import test from 'node:test';
import assert from 'node:assert/strict';
import { yamlParse } from '../../../../../main/frontend/src/lib/yaml.js';
import { diagramNormalize } from '../../card-diagram/DiagramERData.js';
import { switchRegistryBuild } from '../../card-diagram-switch/SwitchNodeKinds.jsx';
import { powerPlatformNodeRegistry } from '../power-platform-node-registry.js';
import { migrationCategoryOf, migrationModelBuild, migrationPathBuild, migrationRankBuild } from './MigrationData.js';
import { migrationProviderBuild } from './MigrationViews.js';
import { migrationEditAdapterByKind, migrationItemNewBuild } from './MigrationEditData.js';

const itemList = [
	{ key: 'ex.system', kind: 'system', path: '/example/system', data: { source: { id: 'pw', name: 'PW' }, target: { id: 'connect', name: 'Connect' }, labels: { overview: 'All' } } },
	{ key: 'ex.pw.t.a', kind: 'schema-table', path: '/example/schema/pw/table/a', data: { db: 'pw', logical: 'a', name: 'A', columnList: [{ id: 'aid', name: 'A', logical: 'aid', type: 'Unique identifier', key: 'PK' }, { id: 'bid', name: 'B', logical: 'bid', type: 'Lookup', lookup: 'ex.pw.t.b' }, { id: 'st', name: 'Status', logical: 'st', type: 'Choice', choice: 'ex.pw.c.st' }, { id: 'memo', name: 'Memo', logical: 'memo', type: 'Text' }] } },
	{ key: 'ex.pw.t.b', kind: 'schema-table', path: '/example/schema/pw/table/b', data: { db: 'pw', logical: 'b', name: 'B', columnList: [{ id: 'bid', name: 'B', logical: 'bid', type: 'Unique identifier', key: 'PK' }] } },
	{ key: 'ex.cn.t.x', kind: 'schema-table', path: '/example/schema/connect/table/x', data: { db: 'connect', logical: 'x', name: 'X', columnList: [{ id: 'xid', name: 'X', logical: 'xid', type: 'Unique identifier', key: 'PK' }, { id: 'state', name: 'State', logical: 'state', type: 'Choice', choice: 'ex.cn.c.state' }, { id: 'origin', name: 'Origin', logical: 'origin', type: 'Text' }] } },
	{ key: 'ex.pw.c.st', kind: 'schema-choice', path: '/example/schema/pw/choice/st', data: { db: 'pw', logical: 'st', name: 'Status', optionList: [{ value: 1, label: 'On' }, { value: 2, label: 'Off' }] } },
	{ key: 'ex.cn.c.state', kind: 'schema-choice', path: '/example/schema/connect/choice/state', data: { db: 'connect', logical: 'state', name: 'State', optionList: [{ value: 10, label: 'On' }, { value: 20, label: 'Off' }] } },
	{ key: 'ex.map.choice.st--state', kind: 'mapping-choice', path: '/example/mapping/choice/st--state', data: { source: 'ex.pw.c.st', target: 'ex.cn.c.state', label: 'Status', optionList: [{ from: 1, to: 10 }, { from: 2, to: null }] } },
	{ key: 'ex.map.table.a--x', kind: 'mapping-table', path: '/example/mapping/table/a--x', data: { source: 'ex.pw.t.a', target: 'ex.cn.t.x', rowKeyList: ['ex.map.row.a--x.xid', 'ex.map.row.a--x.state', 'ex.map.row.a--x.memo', 'ex.map.row.a--x.origin'] } },
	{ key: 'ex.map.row.a--x.xid', kind: 'mapping-row', path: '/example/mapping/row/a--x/xid', data: { id: 'xid', name: 'X', table: 'ex.map.table.a--x', source: 'aid', target: 'xid', kind: 'copy', label: 'copy', stepList: [] } },
	{ key: 'ex.map.row.a--x.state', kind: 'mapping-row', path: '/example/mapping/row/a--x/state', data: { id: 'state', name: 'State', table: 'ex.map.table.a--x', source: 'st', target: 'state', kind: 'choice', label: 'choice', stepList: [{ op: 'text', name: 'Check', description: 'x' }, { op: 'choice', mapping: 'ex.map.choice.st--state' }] } },
	{ key: 'ex.map.row.a--x.memo', kind: 'mapping-row', path: '/example/mapping/row/a--x/memo', data: { id: 'memo', name: 'Memo', table: 'ex.map.table.a--x', source: 'memo', target: null, kind: 'abandon', label: 'drop', stepList: [{ op: 'abandon' }] } },
	{ key: 'ex.map.row.a--x.origin', kind: 'mapping-row', path: '/example/mapping/row/a--x/origin', data: { id: 'origin', name: 'Origin', table: 'ex.map.table.a--x', source: null, target: 'origin', kind: 'default', label: 'PW', stepList: [] } },
	{ key: 'ex.plan', kind: 'plan', path: '/example/plan', data: { batchList: [{ table: 'ex.pw.t.a', file: 'a-1.csv', range: '[0, 1)', rowCount: 1 }] } },
	{ key: 'ex.report.run', kind: 'report-run', path: '/example/report/run', data: { stat: { total: 1, success: 1, dlq: 0 }, batchList: [{ file: 'a-1.csv', rowCount: 1, success: 1, dlq: 0 }], dlqList: [] } },
	{ key: 'ex.report.verify', kind: 'report-verify', path: '/example/report/verify', data: { stat: { total: 1, matched: 1, exception: 0 }, checkList: [], exceptionList: [] } },
];
const model = migrationModelBuild('example', itemList);
const provider = migrationProviderBuild(model);
const registry = switchRegistryBuild(powerPlatformNodeRegistry);

test('a path names its category and its item', () => {
	assert.equal(migrationCategoryOf('/real/schema/pw/table/a'), 'real');
	assert.equal(migrationPathBuild('real', 'schema-table', { db: 'pw', logical: 'a' }), '/real/schema/pw/table/a');
	assert.equal(migrationPathBuild('example', 'mapping-row', { source: 'a', target: 'x', id: 'c' }), '/example/mapping/row/a--x/c');
});

test('what does not fit together is said', () => {
	assert.deepEqual(model.problemList, []);
	const modelBroken = migrationModelBuild('example', [{ key: 't', kind: 'schema-table', path: '/example/schema/pw/table/t', data: { db: 'pw', logical: 't', name: 'T', columnList: [{ id: 'c', lookup: 'nothing' }] } }]);
	assert.match(modelBroken.problemList[0], /lookup names a table not found: nothing/);
});

// every path the tree offers is a diagram the framework accepts, with a label
function pathAllGet(path, list = []) {
	list.push(path);
	for (const child of provider.childListGet(path)) pathAllGet(child.path, list);
	return list;
}

test('every view of the tree is a valid diagram', () => {
	const pathList = pathAllGet(provider.root);
	assert.ok(pathList.includes('/overview/mapping/a--x/state'));
	assert.ok(pathList.includes('/overview/tabs/run'));
	assert.ok(pathList.includes('/overview/pw/a'));
	for (const path of pathList) {
		const view = provider.viewGet(path);
		assert.ok(view, path);
		assert.doesNotThrow(() => diagramNormalize({ version: 1, ...view.diagram }, registry), path);
		assert.ok(provider.labelGet(path), path);
	}
	assert.equal(provider.labelGet('/overview'), 'All');
	assert.equal(provider.viewGet('/overview/nothing'), null);
});

test('a table keeps its node id across the views, so a switch moves it', () => {
	const idOf = (path) => provider.viewGet(path).diagram.nodes.map((node) => node.id);
	const id = 'table:pw:a';
	for (const path of ['/overview/pw', '/overview/mapping', '/overview/mapping/a--x', '/overview/mapping/a--x/state', '/overview/pw/a']) assert.ok(idOf(path).includes(id), path);
});

test('ER: lookups end on the primary key, option sets on their card, mappings carry a link', () => {
	const { connections } = provider.viewGet('/overview/pw').diagram;
	const lookup = connections.find((item) => item.id === 'lookup:pw:a:bid');
	assert.equal(lookup.target.nodeId, 'table:pw:b');
	assert.ok(connections.some((item) => item.id === 'choice:pw:a:st' && item.target.nodeId === 'choice:pw:st'));
	const mapping = provider.viewGet('/overview/mapping').diagram.connections.find((item) => item.id === 'map:a--x');
	assert.equal(mapping.link, '/overview/mapping/a--x');
	const row = provider.viewGet('/overview/mapping/a--x').diagram.connections.find((item) => item.id === 'row:ex.map.row.a--x.state');
	assert.equal(row.link, '/overview/mapping/a--x/state');
	assert.equal(row.label.text, 'choice');
});

test('a bounding box in the layout item is the box of its view', () => {
	const modelBox = migrationModelBuild('example', [...itemList, { key: 'ex.layout', kind: 'layout', path: '/example/layout', data: { viewByPath: { '/overview/pw': { box: { x: 1, y: 2, width: 30, height: 40 } } } } }]);
	assert.deepEqual(migrationProviderBuild(modelBox).viewGet('/overview/pw').box, { x: 1, y: 2, width: 30, height: 40 });
	assert.equal(migrationProviderBuild(modelBox).viewGet('/overview').box, undefined);
});

// an item through its draft unchanged writes what it was
const adapterOf = (kind) => migrationEditAdapterByKind[kind];
const dataOf = (item) => { const { key, path, ...data } = item; return data; };

test('edit: a table through its draft comes back the same, its lookups kept', () => {
	const item = model.tableByKey.get('ex.pw.t.a');
	const adapter = adapterOf('schema-table');
	const raw = adapter.sourceBuild(item, model);
	const { writeList } = adapter.writesBuild(raw, item, model);
	assert.equal(writeList[0].ref, item.key);
	assert.deepEqual(writeList[0].data.columnList.map((column) => [column.id, column.logical, column.lookup, column.choice]), item.columnList.map((column) => [column.id, column.logical, column.lookup, column.choice]));
	assert.ok(adapter.registryGet(model).kindByType['dataverse-table'].schema.rowPropertyList.some((property) => property.id === 'lookup' && property.values.includes('ex.pw.t.b')));
});

test('edit: an option set and its mapping', () => {
	const choice = model.choiceByKey.get('ex.pw.c.st');
	const written = adapterOf('schema-choice').writesBuild(adapterOf('schema-choice').sourceBuild(choice, model), choice, model).writeList[0].data;
	assert.deepEqual(written.optionList, choice.optionList);
	const mapping = model.mappingChoiceByKey.get('ex.map.choice.st--state');
	const writtenMapping = adapterOf('mapping-choice').writesBuild(adapterOf('mapping-choice').sourceBuild(mapping, model), mapping, model).writeList[0].data;
	assert.deepEqual(writtenMapping.optionList, mapping.optionList);
	const rawNoValue = adapterOf('schema-choice').sourceBuild(choice, model).replace("nameLogical: \"1\"", 'nameLogical: ""');
	assert.throws(() => adapterOf('schema-choice').writesBuild(rawNoValue, choice, model), /needs a value/);
});

test('edit: a table mapping unchanged writes nothing; lines become row mappings', () => {
	const item = model.mappingTableByKey.get('ex.map.table.a--x');
	const adapter = adapterOf('mapping-table');
	const raw = adapter.sourceBuild(item, model);
	assert.deepEqual(adapter.writesBuild(raw, item, model), { writeList: [], createList: [], removeList: [] });
	const doc = yamlParse(raw);
	// a line removed, one drawn to another target column, one abandoned
	const without = { ...doc, connections: doc.connections.filter((line) => line.id !== 'row:ex.map.row.a--x.xid') };
	const removed = adapter.writesBuild(JSON.stringify(without), item, model);
	assert.deepEqual(removed.removeList, ['ex.map.row.a--x.xid']);
	assert.ok(!removed.writeList.find((write) => write.ref === item.key).data.rowKeyList.includes('ex.map.row.a--x.xid'));
	const drawn = { ...doc, connections: [...without.connections, { id: 'connection-1', source: { nodeId: 'source', handleId: 'col-bid' }, target: { nodeId: 'target', handleId: 'col-xid' } }] };
	const redrawn = adapter.writesBuild(JSON.stringify(drawn), item, model);
	assert.deepEqual(redrawn.createList, [], 'a line drawn where one was removed is that row mapping');
	assert.equal(redrawn.writeList.find((write) => write.ref === 'ex.map.row.a--x.xid').data.source, 'bid');
	const abandoned = { ...doc, connections: [...doc.connections, { id: 'connection-2', source: { nodeId: 'source', handleId: 'col-bid' }, target: { nodeId: 'operator-abandon', handleId: 'left' } }] };
	const created = adapter.writesBuild(JSON.stringify(abandoned), item, model);
	assert.equal(created.createList[0].key, 'ex.map.row.a--x.bid');
	assert.equal(created.createList[0].pathList[0], '/example/mapping/row/a--x/bid');
	assert.equal(created.createList[0].data.target, null);
	assert.equal(created.createList[0].data.kind, 'abandon');
	assert.ok(created.writeList.find((write) => write.ref === item.key).data.rowKeyList.includes('ex.map.row.a--x.bid'));
	const wrong = { ...doc, connections: [{ id: 'connection-3', source: { nodeId: 'operator-abandon', handleId: 'left' }, target: { nodeId: 'source', handleId: 'col-bid' } }] };
	assert.throws(() => adapter.writesBuild(JSON.stringify(wrong), item, model), /must join/);
});

test('edit: a row mapping is its chain of operators', () => {
	const item = model.mappingRowByKey.get('ex.map.row.a--x.state');
	const adapter = adapterOf('mapping-row');
	const raw = adapter.sourceBuild(item, model);
	const data = adapter.writesBuild(raw, item, model).writeList[0].data;
	assert.deepEqual([data.source, data.target], ['st', 'state']);
	assert.deepEqual(data.stepList, item.stepList);
	// a step inserted by its lines, the abandon of another column kept as a chain
	const doc = yamlParse(raw);
	doc.connections.push({ id: 'extra', source: { nodeId: 'step-0', handleId: 'right' }, target: { nodeId: 'target', handleId: 'col-origin' } });
	assert.throws(() => adapter.writesBuild(JSON.stringify(doc), item, model), /more than one way out/);
	const memo = model.mappingRowByKey.get('ex.map.row.a--x.memo');
	const memoData = adapter.writesBuild(adapter.sourceBuild(memo, model), memo, model).writeList[0].data;
	assert.equal(memoData.target, null);
	assert.equal(memoData.kind, 'abandon');
	assert.deepEqual(dataOf(memo).stepList.map((step) => step.op), memoData.stepList.map((step) => step.op));
});

test('new items get their key and path from their names', () => {
	const table = migrationItemNewBuild('schema-table', model, { db: 'connect', logical: 'new_t', name: 'T' });
	assert.equal(table.key, 'ex.connect.table.new_t');
	assert.equal(table.pathList[0], '/example/schema/connect/table/new_t');
	assert.throws(() => migrationItemNewBuild('schema-table', model, { db: 'pw' }), /logical name/);
	const mapping = migrationItemNewBuild('mapping-choice', model, { source: 'ex.pw.c.st', target: 'ex.cn.c.state' });
	assert.equal(mapping.pathList[0], '/example/mapping/choice/st--state');
	assert.deepEqual(mapping.data.optionList, [{ from: 1, to: null }, { from: 2, to: null }]);
});

test('the rank of a table is one past the highest rank it looks up', () => {
	const tableOf = (logical, lookupList = []) => ({ key: logical, kind: 'schema-table', path: `/example/schema/pw/table/${logical}`, data: { db: 'pw', logical, name: logical, columnList: lookupList.map((lookup, index) => ({ id: `c${index}`, lookup })) } });
	const modelRank = migrationModelBuild('example', [
		tableOf('root'), tableOf('other'), tableOf('child', ['root', 'root', 'other']), tableOf('grand', ['child', 'root']),
		tableOf('selfish', ['selfish']), tableOf('loop-a', ['loop-b']), tableOf('loop-b', ['loop-a']),
	]);
	const { rankByKey, groupList, lineList } = migrationRankBuild(modelRank, 'pw');
	assert.equal(rankByKey.get('root'), 1);
	assert.equal(rankByKey.get('child'), 2);
	assert.equal(rankByKey.get('grand'), 3);
	assert.equal(rankByKey.get('selfish'), 1);
	assert.deepEqual(groupList.map((group) => group.rank), [1, 2, 3]);
	// one line per pair, however many columns look up; none to itself
	assert.equal(lineList.filter((line) => line.from === 'child' && line.to === 'root').length, 1);
	assert.ok(!lineList.some((line) => line.from === 'selfish'));
	// a cycle: ranked anyway, its closing lookup said
	assert.ok(lineList.some((line) => line.from === 'loop-b' && line.to === 'loop-a' && line.isCycle) || lineList.some((line) => line.from === 'loop-a' && line.to === 'loop-b' && line.isCycle));
	assert.ok(rankByKey.has('loop-a') && rankByKey.has('loop-b'));
});

test('a report is a stack of its sections, each opening its view', () => {
	const { nodes } = provider.viewGet('/overview/plan').diagram;
	assert.equal(nodes[0].renderer.type, 'view-stack');
	const idList = nodes[0].data.itemList.map((item) => item.id);
	assert.deepEqual(idList, ['mapping:a--x', 'choice:st--state', 'order', 'batch']);
	assert.equal(nodes[0].data.itemList[0].view, '/overview/mapping/a--x');
});

test('a report shows how it goes first; its tables are a click away, not stacked', () => {
	for (const [path, detailList] of [['/overview/run', ['/overview/run/batch', '/overview/run/dlq']], ['/overview/verify', ['/overview/verify/check', '/overview/verify/exception']]]) {
		const { itemList } = provider.viewGet(path).diagram.nodes[0].data;
		assert.equal(itemList[0].id, 'flow');
		assert.equal(itemList[0].view, `${path}/flow`);
		for (const detail of detailList) {
			assert.ok(itemList.some((item) => item.link === detail && item.node), detail);
			assert.ok(!itemList.some((item) => item.view === detail), `${detail} is not stacked as a table`);
		}
	}
	const run = provider.viewGet('/overview/run/flow').diagram;
	const idList = run.nodes.map((node) => node.id);
	for (const id of ['flow-table:ex.pw.t.a', 'flow-batch:a-1.csv', 'flow-send', 'flow-target', 'flow-retry', 'flow-dlq', 'flow-report']) assert.ok(idList.includes(id), id);
	assert.equal(run.nodes.find((node) => node.id === 'flow-dlq').link, '/overview/run/dlq');
	const verify = provider.viewGet('/overview/verify/flow').diagram.nodes.map((node) => node.id);
	for (const id of ['flow-batch:a-1.csv', 'verify-set', 'verify-compare', 'verify-target', 'verify-exception', 'verify-report']) assert.ok(verify.includes(id), id);
});

test('the order is drawn from the lookups of the target, wrapping long rows', () => {
	const tableOf = (logical, lookup) => ({ key: logical, kind: 'schema-table', path: `/example/schema/connect/table/${logical}`, data: { db: 'connect', logical, name: logical, columnList: lookup ? [{ id: 'c', lookup }] : [] } });
	const modelMany = migrationModelBuild('example', [itemList[0], tableOf('a'), tableOf('b'), tableOf('c'), tableOf('d'), tableOf('e'), tableOf('f', 'a')]);
	const { nodes, connections } = migrationProviderBuild(modelMany).viewGet('/overview/plan/order').diagram;
	const yOf = (id) => nodes.find((node) => node.id === `rank-table:${id}`).position.y;
	assert.equal(yOf('a'), yOf('d'));
	assert.ok(yOf('e') > yOf('a'), 'the fifth of a rank is on the next line');
	assert.ok(yOf('f') > yOf('e'));
	assert.equal(connections.length, 1);
	assert.equal(connections[0].source.nodeId, 'rank-table:f');
	assert.equal(connections[0].target.nodeId, 'rank-table:a');
});
