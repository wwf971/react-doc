import test from 'node:test';
import assert from 'node:assert/strict';
import { yamlParse } from '../../../../../main/frontend/src/lib/yaml.js';
import { diagramNormalize } from '../../card-diagram/DiagramERData.js';
import { switchRegistryBuild } from '../../card-diagram-switch/SwitchNodeKinds.jsx';
import { erGeometryEstimateBuild } from '../er-arrange/ErGeometry.js';
import { routeOverlapListGet, routePathPolylineGet, routePathRunListGet, routePolylinePointAt, routeResolve } from '../../card-diagram/DiagramRoute.js';
import { labelSizeEstimate } from '../../card-diagram/DiagramLabelPlace.js';
import { switchPresentationBuild, switchViewHoverResolve, switchViewListOf, switchViewResolve } from '../../card-diagram-switch/SwitchData.js';
import { powerPlatformNodeRegistry } from '../power-platform-node-registry.js';
import { migrationCategoryOf, migrationModelBuild, migrationPathBuild, migrationRankBuild } from './MigrationData.js';
import { migrationProviderBuild } from './MigrationScenes.js';
import { migrationEditAdapterByKind, migrationItemNewBuild } from './MigrationEditData.js';

const itemList = [
	{ key: 'ex.system', kind: 'system', path: '/example/system', data: { source: { id: 'pw', name: 'PW' }, target: { id: 'connect', name: 'Connect' }, labels: { overview: 'All' } } },
	{ key: 'ex.pw.t.a', kind: 'schema-table', path: '/example/schema/pw/table/a', data: { db: 'pw', logical: 'a', name: 'A', columnList: [{ id: 'aid', name: 'A', logical: 'aid', type: 'Unique identifier', key: 'PK' }, { id: 'bid', name: 'B', logical: 'bid', type: 'Lookup', lookup: 'ex.pw.t.b' }, { id: 'st', name: 'Status', logical: 'st', type: 'Choice', choice: 'ex.pw.c.st' }, { id: 'memo', name: 'Memo', logical: 'memo', type: 'Text' }] } },
	{ key: 'ex.pw.t.b', kind: 'schema-table', path: '/example/schema/pw/table/b', data: { db: 'pw', logical: 'b', name: 'B', columnList: [{ id: 'bid', name: 'B', logical: 'bid', type: 'Unique identifier', key: 'PK' }] } },
	{ key: 'ex.cn.t.x', kind: 'schema-table', path: '/example/schema/connect/table/x', data: { db: 'connect', logical: 'x', name: 'X', columnList: [{ id: 'xid', name: 'X', logical: 'xid', type: 'Unique identifier', key: 'PK' }, { id: 'state', name: 'State', logical: 'state', type: 'Choice', choice: 'ex.cn.c.state' }, { id: 'origin', name: 'Origin', logical: 'origin', type: 'Text' }] } },
	{ key: 'ex.pw.c.st', kind: 'schema-choice', path: '/example/schema/pw/choice/st', data: { db: 'pw', logical: 'st', name: 'Status', optionList: [{ value: 1, label: 'On' }, { value: 2, label: 'Off' }] } },
	{ key: 'ex.cn.c.state', kind: 'schema-choice', path: '/example/schema/connect/choice/state', data: { db: 'connect', logical: 'state', name: 'State', optionList: [{ value: 10, label: 'On' }, { value: 20, label: 'Off' }] } },
	{ key: 'ex.map.choice.st--state', kind: 'mapping-choice', path: '/example/mapping/choice/st--state', data: { source: 'ex.pw.c.st', target: 'ex.cn.c.state', label: 'Status', optionList: [{ from: 1, to: 10 }, { from: 2, to: null }] } },
	{ key: 'ex.map.table.a--x', kind: 'mapping-table', path: '/example/mapping/table/a--x', data: { source: 'ex.pw.t.a', target: 'ex.cn.t.x', columnKeyList: ['ex.map.column.a--x.xid', 'ex.map.column.a--x.state', 'ex.map.column.a--x.memo', 'ex.map.column.a--x.origin'] } },
	{ key: 'ex.map.column.a--x.xid', kind: 'mapping-column', path: '/example/mapping/column/a--x/xid', data: { id: 'xid', name: 'X', table: 'ex.map.table.a--x', source: 'aid', target: 'xid', kind: 'copy', label: 'copy', stepList: [] } },
	{ key: 'ex.map.column.a--x.state', kind: 'mapping-column', path: '/example/mapping/column/a--x/state', data: { id: 'state', name: 'State', table: 'ex.map.table.a--x', source: 'st', target: 'state', kind: 'choice', label: 'choice', stepList: [{ op: 'text', name: 'Check', description: 'x' }, { op: 'choice', mapping: 'ex.map.choice.st--state' }] } },
	{ key: 'ex.map.column.a--x.memo', kind: 'mapping-column', path: '/example/mapping/column/a--x/memo', data: { id: 'memo', name: 'Memo', table: 'ex.map.table.a--x', source: 'memo', target: null, kind: 'abandon', label: 'drop', stepList: [{ op: 'abandon' }] } },
	{ key: 'ex.map.column.a--x.origin', kind: 'mapping-column', path: '/example/mapping/column/a--x/origin', data: { id: 'origin', name: 'Origin', table: 'ex.map.table.a--x', source: null, target: 'origin', kind: 'default', label: 'PW', stepList: [] } },
	{ key: 'ex.plan', kind: 'plan', path: '/example/plan', data: { batchList: [{ table: 'ex.pw.t.a', file: 'a-1.csv', range: '[0, 1)', rowCount: 1 }] } },
	{ key: 'ex.report.run', kind: 'report-run', path: '/example/report/run', data: { stat: { total: 1, success: 1, dlq: 0 }, batchList: [{ file: 'a-1.csv', rowCount: 1, success: 1, dlq: 0 }], dlqList: [] } },
	{ key: 'ex.report.verify', kind: 'report-verify', path: '/example/report/verify', data: { stat: { total: 1, matched: 1, exception: 0 }, checkList: [], exceptionList: [] } },
];
// the diagram a scene shows by default: of its first view, if it has views
const diagramShownOf = (providerOf, path) => {
	const scene = providerOf.sceneGet(path);
	return scene.diagram ?? scene.viewList[0].diagram;
};
const model = migrationModelBuild('example', itemList);
const provider = migrationProviderBuild(model);
const registry = switchRegistryBuild(powerPlatformNodeRegistry);

test('run and verify flows place locations and outputs in base-layer color blocks', () => {
	for (const kind of ['run', 'verify']) {
		const diagram = provider.sceneGet(`/overview/${kind}/flow`).diagram;
		const blocks = diagram.nodes.filter(node => node.renderer.type === 'color-block');
		assert.equal(blocks.length, 4);
		const blockOf = id => blocks.find(node => node.id === `flow-area:${id}`);
		const target = diagram.nodes.find(node => node.id === `${kind === 'run' ? 'flow-target' : 'verify-target'}:ex.cn.t.x`);
		const report = diagram.nodes.find(node => node.id === (kind === 'run' ? 'flow-report' : 'verify-report'));
		const contains = (block, node) => node.position.x >= block.position.x && node.position.x + node.size.width <= block.position.x + block.size.width && node.position.y >= block.position.y && node.position.y < block.position.y + block.size.height - 40;
		assert.ok(contains(blockOf('target'), target));
		assert.ok(contains(blockOf('artifacts'), report));
		assert.equal(target.renderer.type, 'table');
		assert.equal(target.data.name, 'X');
		// the outputs block only holds the report and its label
		assert.ok(blockOf('artifacts').size.height < blockOf('target').size.height);
		assert.equal(blockOf('artifacts').position.y + blockOf('artifacts').size.height, blockOf('source').position.y + blockOf('source').size.height);
		for (const id of ['source', 'target']) assert.equal(blockOf(id).data.itemList[0].icon, 'database');
		for (const node of diagram.nodes.filter(node => node.id.startsWith('flow-table:'))) assert.ok(contains(blockOf('source'), node));
		for (const node of diagram.nodes.filter(node => node.id.startsWith('flow-batch:'))) assert.ok(contains(blockOf('server'), node));
		assert.ok(target.position.x > blockOf('server').position.x + blockOf('server').size.width);
	}
});

test('a path names its category and its item', () => {
	assert.equal(migrationCategoryOf('/real/schema/pw/table/a'), 'real');
	assert.equal(migrationPathBuild('real', 'schema-table', { db: 'pw', logical: 'a' }), '/real/schema/pw/table/a');
	assert.equal(migrationPathBuild('example', 'mapping-column', { source: 'a', target: 'x', id: 'c' }), '/example/mapping/column/a--x/c');
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

test('every scene of the tree is a valid diagram', () => {
	const pathList = pathAllGet(provider.root);
	assert.ok(pathList.includes('/overview/mapping/a--x/state'));
	assert.ok(pathList.includes('/overview/tabs/run'));
	assert.ok(pathList.includes('/overview/pw/a'));
	for (const path of pathList) {
		const scene = provider.sceneGet(path);
		assert.ok(scene, path);
		for (const holder of scene.viewList ?? [scene]) assert.doesNotThrow(() => diagramNormalize({ version: 1, ...holder.diagram }, registry), path);
		assert.ok(provider.labelGet(path), path);
	}
	assert.equal(provider.labelGet('/overview'), 'All');
	assert.equal(provider.sceneGet('/overview/nothing'), null);
});

test('a table keeps its node id across the scenes, so a switch moves it', () => {
	const idOf = (path) => diagramShownOf(provider, path).nodes.map((node) => node.id);
	const id = 'table:pw:a';
	for (const path of ['/overview/pw', '/overview/mapping', '/overview/mapping/a--x', '/overview/mapping/a--x/state', '/overview/pw/a']) assert.ok(idOf(path).includes(id), path);
});

test('ER: lookups end on the primary key, option sets on their card, mappings carry a link', () => {
	const { connections } = diagramShownOf(provider, '/overview/pw');
	const lookup = connections.find((item) => item.id === 'lookup:pw:a:bid');
	assert.equal(lookup.target.nodeId, 'table:pw:b');
	assert.ok(connections.some((item) => item.id === 'choice:pw:a:st' && item.target.nodeId === 'choice:pw:st'));
	const mapping = provider.sceneGet('/overview/mapping').diagram.connections.find((item) => item.id === 'map:a--x');
	assert.equal(mapping.link, '/overview/mapping/a--x');
	const row = provider.sceneGet('/overview/mapping/a--x').diagram.connections.find((item) => item.id === 'column:ex.map.column.a--x.state');
	assert.equal(row.link, '/overview/mapping/a--x/state');
	assert.equal(row.label.text, 'choice');
});

test('a bounding box in the layout item is the box of its scene', () => {
	const modelBox = migrationModelBuild('example', [...itemList, { key: 'ex.layout', kind: 'layout', path: '/example/layout', data: { sceneByPath: { '/overview/pw/a': { box: { x: 1, y: 2, width: 30, height: 40 } }, '/overview/pw@matrix': { box: { x: 5, y: 6, width: 70, height: 80 } } } } }]);
	assert.deepEqual(migrationProviderBuild(modelBox).sceneGet('/overview/pw/a').box, { x: 1, y: 2, width: 30, height: 40 });
	const { viewList } = migrationProviderBuild(modelBox).sceneGet('/overview/pw');
	assert.equal(viewList[0].box, undefined, 'a box is of one view');
	assert.deepEqual(viewList[1].box, { x: 5, y: 6, width: 70, height: 80 });
	assert.equal(migrationProviderBuild(modelBox).sceneGet('/overview').box, undefined);
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

test('edit: a table mapping unchanged writes nothing; lines become column mappings', () => {
	const item = model.mappingTableByKey.get('ex.map.table.a--x');
	const adapter = adapterOf('mapping-table');
	const raw = adapter.sourceBuild(item, model);
	assert.deepEqual(adapter.writesBuild(raw, item, model), { writeList: [], createList: [], removeList: [] });
	const doc = yamlParse(raw);
	// a line removed, one drawn to another target column, one abandoned
	const without = { ...doc, connections: doc.connections.filter((line) => line.id !== 'column:ex.map.column.a--x.xid') };
	const removed = adapter.writesBuild(JSON.stringify(without), item, model);
	assert.deepEqual(removed.removeList, ['ex.map.column.a--x.xid']);
	assert.ok(!removed.writeList.find((write) => write.ref === item.key).data.columnKeyList.includes('ex.map.column.a--x.xid'));
	const drawn = { ...doc, connections: [...without.connections, { id: 'connection-1', source: { nodeId: 'source', handleId: 'col-bid' }, target: { nodeId: 'target', handleId: 'col-xid' } }] };
	const redrawn = adapter.writesBuild(JSON.stringify(drawn), item, model);
	assert.deepEqual(redrawn.createList, [], 'a line drawn where one was removed is that column mapping');
	assert.equal(redrawn.writeList.find((write) => write.ref === 'ex.map.column.a--x.xid').data.source, 'bid');
	const abandoned = { ...doc, connections: [...doc.connections, { id: 'connection-2', source: { nodeId: 'source', handleId: 'col-bid' }, target: { nodeId: 'operator-abandon', handleId: 'left' } }] };
	const created = adapter.writesBuild(JSON.stringify(abandoned), item, model);
	assert.equal(created.createList[0].key, 'ex.map.column.a--x.bid');
	assert.equal(created.createList[0].pathList[0], '/example/mapping/column/a--x/bid');
	assert.equal(created.createList[0].data.target, null);
	assert.equal(created.createList[0].data.kind, 'abandon');
	assert.ok(created.writeList.find((write) => write.ref === item.key).data.columnKeyList.includes('ex.map.column.a--x.bid'));
	const wrong = { ...doc, connections: [{ id: 'connection-3', source: { nodeId: 'operator-abandon', handleId: 'left' }, target: { nodeId: 'source', handleId: 'col-bid' } }] };
	assert.throws(() => adapter.writesBuild(JSON.stringify(wrong), item, model), /must join/);
});

test('edit: a column mapping is its chain of operators', () => {
	const item = model.mappingColumnByKey.get('ex.map.column.a--x.state');
	const adapter = adapterOf('mapping-column');
	const raw = adapter.sourceBuild(item, model);
	const data = adapter.writesBuild(raw, item, model).writeList[0].data;
	assert.deepEqual([data.source, data.target], ['st', 'state']);
	assert.deepEqual(data.stepList, item.stepList);
	// a step inserted by its lines, the abandon of another column kept as a chain
	const doc = yamlParse(raw);
	doc.connections.push({ id: 'extra', source: { nodeId: 'step-0', handleId: 'right' }, target: { nodeId: 'target', handleId: 'col-origin' } });
	assert.throws(() => adapter.writesBuild(JSON.stringify(doc), item, model), /more than one way out/);
	const memo = model.mappingColumnByKey.get('ex.map.column.a--x.memo');
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

test('a report is a stack of its sections, each opening its scene', () => {
	const { nodes } = provider.sceneGet('/overview/plan').diagram;
	assert.equal(nodes[0].renderer.type, 'scene-stack');
	const idList = nodes[0].data.itemList.map((item) => item.id);
	assert.deepEqual(idList, ['mapping:a--x', 'choice:st--state', 'order', 'batch']);
	assert.equal(nodes[0].data.itemList[0].scene, '/overview/mapping/a--x');
});

test('report stacks show their localized simple title in overview and focus', () => {
	const labels = { plan: 'Plan title', run: 'Run title', verify: 'Verify title' };
	const modelTitle = migrationModelBuild('example', itemList.map((item) => item.kind === 'system' ? { ...item, data: { ...item.data, labels } } : item));
	const providerTitle = migrationProviderBuild(modelTitle);
	for (const id of ['plan', 'run', 'verify']) {
		const { data } = providerTitle.sceneGet(`/overview/${id}`).diagram.nodes[0];
		assert.deepEqual(data.titleBar, { text: labels[id], isVisibleEmbedded: true, isVisibleFocused: true });
	}
});

test('overview reports are the scrolling containers themselves, shared with focused scenes', () => {
	const overview = provider.sceneGet('/overview').diagram;
	for (const id of ['plan', 'run', 'verify']) {
		const parent = overview.nodes.find((node) => node.id === `report:${id}`);
		const focused = provider.sceneGet(`/overview/${id}`).diagram.nodes[0];
		assert.equal(parent.renderer.type, 'scene-stack');
		assert.equal(parent.link, `/overview/${id}`);
		assert.equal(parent.data.focusPath, `/overview/${id}`);
		assert.equal(parent.data.isFrameVisibleFocused, true);
		assert.equal(parent.id, focused.id);
		assert.deepEqual(parent.data, focused.data);
		assert.ok(!overview.nodes.some((node) => node.renderer.type === 'scene-embed' && node.data.scene === `/overview/${id}`));
		const tab = provider.sceneGet(`/overview/tabs/${id}`).diagram.nodes.find((node) => node.id === parent.id);
		assert.equal(tab.renderer.type, 'scene-stack');
	}
});

test('a report shows how it goes first; its tables are a click away, not stacked', () => {
	for (const [path, detailList] of [['/overview/run', ['/overview/run/batch', '/overview/run/dlq']], ['/overview/verify', ['/overview/verify/check', '/overview/verify/exception']]]) {
		const { itemList } = provider.sceneGet(path).diagram.nodes[0].data;
		assert.equal(itemList[0].id, 'flow');
		assert.equal(itemList[0].scene, `${path}/flow`);
		for (const detail of detailList) {
			assert.ok(itemList.some((item) => item.link === detail && item.node), detail);
			assert.ok(!itemList.some((item) => item.scene === detail), `${detail} is not stacked as a table`);
		}
	}
	const run = provider.sceneGet('/overview/run/flow').diagram;
	const idList = run.nodes.map((node) => node.id);
	for (const id of ['flow-table:ex.pw.t.a', 'flow-batch:a-1.csv', 'flow-send', 'flow-target:ex.cn.t.x', 'flow-retry', 'flow-dlq', 'flow-report']) assert.ok(idList.includes(id), id);
	assert.equal(run.nodes.find((node) => node.id === 'flow-dlq').link, '/overview/run/dlq');
	const verify = provider.sceneGet('/overview/verify/flow').diagram.nodes.map((node) => node.id);
	for (const id of ['flow-batch:a-1.csv', 'verify-set', 'verify-compare', 'verify-target:ex.cn.t.x', 'verify-exception', 'verify-report']) assert.ok(verify.includes(id), id);
});

test('run and verify flows color each table and all its batches alike, including DLQ batches', () => {
	const batchList = [
		{ table: 'ex.pw.t.a', file: 'a-1.csv', range: '[0, 100)', rowCount: 100 },
		{ table: 'ex.pw.t.a', file: 'a-2.csv', range: '[100, 150)', rowCount: 50 },
		{ table: 'ex.pw.t.b', file: 'b-1.csv', range: '[0, 100)', rowCount: 100 },
		{ table: 'ex.pw.t.b', file: 'b-2.csv', range: '[100, 150)', rowCount: 50 },
	];
	const modelFlow = migrationModelBuild('example', itemList.map((item) => {
		if (item.kind === 'plan') return { ...item, data: { batchList } };
		if (item.kind === 'report-run') return { ...item, data: { batchList: batchList.map((batch) => ({ ...batch, success: batch.rowCount - (batch.file === 'b-2.csv' ? 1 : 0), dlq: batch.file === 'b-2.csv' ? 1 : 0 })) } };
		return item;
	}));
	const providerFlow = migrationProviderBuild(modelFlow);
	for (const path of ['/overview/run/flow', '/overview/verify/flow']) {
		const { nodes } = providerFlow.sceneGet(path).diagram;
		const nodeOf = (id) => nodes.find((node) => node.id === id);
		assert.equal(nodeOf('flow-table:ex.pw.t.a').data.tone, 'blue');
		assert.equal(nodeOf('flow-table:ex.pw.t.b').data.tone, 'teal');
		for (const batch of batchList) {
			const table = nodeOf(`flow-table:${batch.table}`);
			const card = nodeOf(`flow-batch:${batch.file}`);
			assert.equal(card.data.tone, table.data.tone, `${path}: ${batch.file}`);
			assert.ok(table.data.rowGroupList.every((group) => group.tone === table.data.tone));
			if (path === '/overview/verify/flow') assert.ok(card.data.statList.includes(batch.range));
		}
		if (path === '/overview/run/flow') assert.ok(nodeOf('flow-batch:b-2.csv').data.statList.includes('49 success / 1 dead letters'));
	}
});

test('the order is drawn from the lookups of the target, wrapping long rows', () => {
	const tableOf = (logical, lookup) => ({ key: logical, kind: 'schema-table', path: `/example/schema/connect/table/${logical}`, data: { db: 'connect', logical, name: logical, columnList: lookup ? [{ id: 'c', lookup }] : [] } });
	const modelMany = migrationModelBuild('example', [itemList[0], tableOf('a'), tableOf('b'), tableOf('c'), tableOf('d'), tableOf('e'), tableOf('f', 'a')]);
	const { nodes, connections } = migrationProviderBuild(modelMany).sceneGet('/overview/plan/order').diagram;
	const yOf = (id) => nodes.find((node) => node.id === `rank-table:${id}`).position.y;
	assert.equal(yOf('a'), yOf('d'));
	assert.ok(yOf('e') > yOf('a'), 'the fifth of a rank is on the next line');
	assert.ok(yOf('f') > yOf('e'));
	assert.equal(connections.length, 1);
	assert.equal(connections[0].source.nodeId, 'rank-table:f');
	assert.equal(connections[0].target.nodeId, 'rank-table:a');
});

test('the flows end in the tables of the target, in the tone of the tables they come from', () => {
	const tableOf = (key, name, db) => ({ key, kind: 'schema-table', path: `/example/schema/${db}/table/${name}`, data: { db, logical: name, name: name.toUpperCase(), columnList: [] } });
	const mappingOf = (source, target) => ({ key: `map.${source}`, kind: 'mapping-table', path: `/example/mapping/table/${source}`, data: { source, target, columnKeyList: [] } });
	const modelTwo = migrationModelBuild('example', [
		tableOf('s.a', 'a', 'pw'), tableOf('s.b', 'b', 'pw'), tableOf('t.a', 'ta', 'connect'), tableOf('t.b', 'tb', 'connect'),
		mappingOf('s.a', 't.a'), mappingOf('s.b', 't.b'),
		{ key: 'plan', kind: 'plan', path: '/example/plan', data: { batchList: [{ table: 's.a', file: 'a-1.csv', rowCount: 100 }, { table: 's.a', file: 'a-2.csv', rowCount: 50 }, { table: 's.b', file: 'b-1.csv', rowCount: 150 }] } },
		{ key: 'run', kind: 'report-run', path: '/example/report/run', data: { stat: {}, batchList: [{ file: 'a-1.csv', success: 100 }, { file: 'a-2.csv', success: 50 }, { file: 'b-1.csv', success: 149 }] } },
		{ key: 'verify', kind: 'report-verify', path: '/example/report/verify', data: { stat: {}, checkList: [], exceptionList: [] } },
	]);
	const providerTwo = migrationProviderBuild(modelTwo);
	const run = providerTwo.sceneGet('/overview/run/flow').diagram;
	const nodeOf = (diagram, id) => diagram.nodes.find((node) => node.id === id);
	assert.equal(nodeOf(run, 'flow-target:t.a').data.tone, nodeOf(run, 'flow-table:s.a').data.tone);
	assert.equal(nodeOf(run, 'flow-target:t.b').data.tone, nodeOf(run, 'flow-table:s.b').data.tone);
	assert.equal(nodeOf(run, 'flow-target:t.a').data.rows[0].name, '150 row');
	assert.equal(nodeOf(run, 'flow-target:t.b').data.rows[0].name, '149 row');
	for (const id of ['t.a', 't.b']) {
		assert.ok(run.connections.some((line) => line.source.nodeId === 'flow-send' && line.target.nodeId === `flow-target:${id}`));
		assert.ok(run.connections.some((line) => line.source.nodeId === `flow-target:${id}` && line.target.nodeId === 'flow-report'));
	}
	const verify = providerTwo.sceneGet('/overview/verify/flow').diagram;
	for (const id of ['t.a', 't.b']) assert.ok(verify.connections.some((line) => line.source.nodeId === `verify-target:${id}` && line.target.nodeId === 'verify-compare'));
	assert.doesNotThrow(() => diagramNormalize({ version: 1, ...run }, registry));
});

test('a plan whose tables have no mapping yet ends in the database itself', () => {
	const modelBare = migrationModelBuild('example', [
		{ key: 's.a', kind: 'schema-table', path: '/example/schema/pw/table/a', data: { db: 'pw', logical: 'a', name: 'A', columnList: [] } },
		{ key: 'plan', kind: 'plan', path: '/example/plan', data: { batchList: [{ table: 's.a', file: 'a-1.csv', rowCount: 1 }] } },
		{ key: 'run', kind: 'report-run', path: '/example/report/run', data: { stat: {}, batchList: [] } },
	]);
	const diagram = migrationProviderBuild(modelBare).sceneGet('/overview/run/flow').diagram;
	assert.equal(diagram.nodes.find((node) => node.id === 'flow-target').renderer.type, 'card-brief');
});

test('the patterns of finding a row: a title, then lanes of data titled with the tables they apply to', () => {
	const tableOf = (key, db, logical, columnIdList) => ({ key, kind: 'schema-table', path: `/example/schema/${db}/table/${logical}`, data: { db, logical, name: logical.toUpperCase(), columnList: columnIdList.map((id) => ({ id, name: id, logical: id, type: 'Text' })) } });
	const mappingOf = (source, target, match) => ({ key: `map.${source}`, kind: 'mapping-table', path: `/example/mapping/table/${source}`, data: { source, target, columnKeyList: [], ...(match ? { match } : {}) } });
	const modelMatch = migrationModelBuild('example', [
		tableOf('s.a', 'pw', 'a', ['id']), tableOf('t.a', 'connect', 'ta', ['id']),
		tableOf('s.u', 'pw', 'u', ['id', 'domain']), tableOf('t.u', 'connect', 'tu', ['id', 'domain']),
		tableOf('s.n', 'pw', 'n', ['tableid', 'u', 'a']), tableOf('t.n', 'connect', 'tn', ['tableid', 'u', 'a']),
		mappingOf('s.a', 't.a'), mappingOf('s.u', 't.u', 'key'), mappingOf('s.n', 't.n', 'pair'),
		{ key: 'verify', kind: 'report-verify', path: '/example/report/verify', data: { stat: {}, checkList: [], exceptionList: [], matchIntro: 'What this is about.', matchList: [
			{ id: 'guid', title: 'Same GUID', source: { table: 's.a', rowList: [{ column: 'id', value: 'x', isKey: true }] }, target: { table: 't.a', rowList: [{ column: 'id', value: 'x', isKey: true }] }, stepList: [{ id: 'read', title: 'Read', from: 'id', to: 'id' }], result: { title: 'Found' } },
			{ id: 'key', title: 'Another column', source: { table: 's.u', rowList: [{ column: 'domain', value: 'A', isKey: true }] }, target: { table: 't.u', rowList: [{ column: 'domain', value: 'a', isKey: true }] }, stepList: [{ id: 'find', title: 'Find', from: 'domain', to: 'domain' }], result: { title: 'GUID map' } },
			{ id: 'pair', title: 'The pair', source: { table: 's.n', rowList: [{ column: 'tableid', value: 't' }, { column: 'u', value: '1', isKey: true }, { column: 'a', value: '2', isKey: true }] }, target: { table: 't.n', rowList: [{ column: 'tableid', value: 't' }, { column: 'u', value: '9', isKey: true }, { column: 'a', value: '2', isKey: true }] }, stepList: [{ id: 'u', title: 'User', from: 'u', to: 'u' }, { id: 'a', title: 'Area', from: 'a', to: 'a' }], result: { title: 'Pair found' } },
		] } },
	]);
	const providerMatch = migrationProviderBuild(modelMatch);
	const registryMatch = switchRegistryBuild(powerPlatformNodeRegistry);
	const all = providerMatch.sceneGet('/overview/verify/match').diagram;
	assert.doesNotThrow(() => diagramNormalize({ version: 1, ...all }, registryMatch));
	const nodeOf = (diagram, id) => diagram.nodes.find((node) => node.id === id);
	const laneTextOf = (id) => nodeOf(all, `match:${id}:lane`).data.itemList.map((item) => item.text).join(' | ');
	assert.equal(laneTextOf('guid'), 'Pattern 1: Same GUID | Tables: TA');
	assert.equal(laneTextOf('key'), 'Pattern 2: Another column | Tables: TU');
	assert.equal(laneTextOf('pair'), 'Pattern 3: The pair | Tables: TN');
	// the title of what this part is about comes first, the title of a pattern above its lane
	const intro = nodeOf(all, 'match:intro');
	assert.deepEqual(intro.data.itemList.map((item) => [item.level, item.text]), [[1, 'Finding the row in the target'], [undefined, 'What this is about.']]);
	assert.ok(intro.position.y + intro.size.height <= nodeOf(all, 'match:guid:lane').position.y);
	assert.equal(nodeOf(all, 'match:guid:lane').data.labelSide, 'top');
	assert.equal(nodeOf(all, 'match:guid:lane').data.itemList[0].level, 2);
	assert.ok(nodeOf(all, 'match:guid:source').position.y > nodeOf(all, 'match:guid:lane').position.y + 40);
	// the key is what the lines join, and what is not the key has no line
	const rowOf = (id) => nodeOf(all, 'match:pair:source').data.rows.find((row) => row.id === id);
	assert.ok(rowOf('u').tone);
	assert.ok(!rowOf('tableid').tone);
	assert.ok(all.connections.some((line) => line.source.nodeId === 'match:pair:source' && line.target.nodeId === 'match:pair:step:u'));
	assert.ok(!nodeOf(all, 'match:pair:source').handles.some((handle) => handle.anchor.target === 'row/tableid'));
	// the columns of the flows: their headings, each card inside its column, what the server does in one column
	const lane = nodeOf(all, 'match:pair:lane');
	assert.deepEqual(lane.data.columnList.map((column) => [column.icon, column.text]), [['database', 'Source database (Source)'], ['server', 'Migration server'], ['database', 'Target database (Target)']]);
	assert.ok(nodeOf(all, 'match:pair:source').data.nameLogical === 'n', 'the database is said by the column');
	const inColumn = (node, column) => node.position.x >= lane.position.x + column.x && node.position.x + node.size.width <= lane.position.x + column.x + column.width;
	const [columnSource, columnServer, columnTarget] = lane.data.columnList;
	assert.ok(inColumn(nodeOf(all, 'match:pair:source'), columnSource));
	assert.ok(inColumn(nodeOf(all, 'match:pair:target'), columnTarget));
	const serverNodeList = ['step:u', 'step:a', 'result'].map((part) => nodeOf(all, `match:pair:${part}`));
	for (const node of serverNodeList) assert.ok(inColumn(node, columnServer), node.id);
	assert.equal(new Set(serverNodeList.map((node) => node.position.x)).size, 1);
	assert.ok(serverNodeList[0].position.y < serverNodeList[1].position.y && serverNodeList[1].position.y < serverNodeList[2].position.y);
	assert.ok(all.connections.some((line) => line.source.nodeId === 'match:pair:target' && line.target.nodeId === 'match:pair:result'));
	// the lines stay in their pattern
	for (const line of all.connections) assert.equal(line.source.nodeId.split(':')[1], line.target.nodeId.split(':')[1], line.id);
	// lanes do not overlap
	const laneList = ['guid', 'key', 'pair'].map((id) => nodeOf(all, `match:${id}:lane`));
	for (let index = 1; index < laneList.length; index += 1) assert.ok(laneList[index].position.y >= laneList[index - 1].position.y + laneList[index - 1].size.height);
	// a pattern alone keeps its node ids, so a switch or an animation moves them
	const one = providerMatch.sceneGet('/overview/verify/match/pair').diagram;
	assert.doesNotThrow(() => diagramNormalize({ version: 1, ...one }, registryMatch));
	assert.ok(nodeOf(one, 'match:pair:source'));
	assert.ok(!nodeOf(one, 'match:guid:source'));
	assert.ok(!nodeOf(one, 'match:intro'));
	assert.equal(providerMatch.labelGet('/overview/verify/match/key'), 'Another column');
	assert.deepEqual(providerMatch.childListGet('/overview/verify/match').map((item) => item.path), ['guid', 'key', 'pair'].map((id) => `/overview/verify/match/${id}`));
	// in the report, after its flow; and the step comparing values opens it
	const stack = providerMatch.sceneGet('/overview/verify').diagram.nodes[0].data.itemList;
	assert.deepEqual(stack.slice(0, 2).map((item) => item.id), ['flow', 'match']);
	assert.equal(nodeOf(providerMatch.sceneGet('/overview/verify/flow').diagram, 'verify-compare').link, '/overview/verify/match');
	assert.equal(providerMatch.sceneGet('/overview/verify/nothing'), null);
});

test('a report with no patterns has no such section', () => {
	const provider = migrationProviderBuild(migrationModelBuild('example', [{ key: 'verify', kind: 'report-verify', path: '/example/report/verify', data: { stat: {}, checkList: [], exceptionList: [] } }]));
	assert.equal(provider.sceneGet('/overview/verify/match'), null);
	assert.ok(!provider.sceneGet('/overview/verify').diagram.nodes[0].data.itemList.some((item) => item.id === 'match'));
});

// many batches, a master table, the plan after the migration
const itemPostListBuild = () => {
	const tableOf = (key, db, logical, columnList, extra = {}) => ({ key, kind: 'schema-table', path: `/example/schema/${db}/table/${logical}`, data: { db, logical, name: logical.toUpperCase(), columnList, ...extra } });
	const column = (id, extra = {}) => ({ id, name: id, logical: id, type: 'Text', ...extra });
	const rowsOf = (...idList) => ({ rowList: idList.map((id, index) => ({ column: id, value: `v${index}`, isKey: index === 0 })) });
	return [
		{ key: 'sys', kind: 'system', path: '/example/system', data: { source: { id: 'pw', name: 'PW' }, target: { id: 'connect', name: 'Connect' }, tool: { name: 'Tool', stepList: [{ id: 'plan', name: 'p', report: 'plan' }, { id: 'run', name: 'r', report: 'run' }, { id: 'verify', name: 'v', report: 'verify' }, { id: 'post', name: 'x', report: 'post' }] }, labels: {} } },
		tableOf('s.m', 'pw', 'm', [column('mid', { key: 'PK' }), column('code')], { isMaster: true }),
		tableOf('t.m', 'connect', 'tm', [column('mid', { key: 'PK' }), column('code')], { isMaster: true }),
		tableOf('s.a', 'pw', 'a', [column('aid', { key: 'PK' }), column('m', { lookup: 's.m', key: 'FK' })]),
		tableOf('t.a', 'connect', 'ta', [column('aid', { key: 'PK' }), column('m', { lookup: 't.m', key: 'FK' }), column('createdon')]),
		{ key: 'map.m', kind: 'mapping-table', path: '/example/mapping/table/m--tm', data: { source: 's.m', target: 't.m', isTableLevel: true, match: 'key', label: 'As a table', columnKeyList: [] } },
		{ key: 'map.a', kind: 'mapping-table', path: '/example/mapping/table/a--ta', data: { source: 's.a', target: 't.a', columnKeyList: [] } },
		{ key: 'plan', kind: 'plan', path: '/example/plan', data: { batchList: [{ table: 's.a', file: 'a-001.csv', rowCount: 100 }, { table: 's.a', isOmitted: true, count: 298, rowCount: 29800 }, { table: 's.a', file: 'a-300.csv', rowCount: 50 }] } },
		{ key: 'run', kind: 'report-run', path: '/example/report/run', data: { stat: { success: 29950, dlq: 0 }, batchList: [{ file: 'a-001.csv', rowCount: 100, success: 100, dlq: 0 }, { isOmitted: true, count: 298, rowCount: 29800, success: 29800, dlq: 0 }, { file: 'a-300.csv', rowCount: 50, success: 50, dlq: 0 }] } },
		{ key: 'verify', kind: 'report-verify', path: '/example/report/verify', data: { stat: {}, checkList: [], exceptionList: [] } },
		{ key: 'post', kind: 'plan-post', path: '/example/plan-post', data: {
			intro: 'After it all.',
			master: { title: 'Fix references', source: { table: 's.m', ...rowsOf('code', 'mid') }, target: { table: 't.m', ...rowsOf('code', 'mid') }, referSource: { table: 's.a', ...rowsOf('m', 'aid') }, referTarget: { table: 't.a', ...rowsOf('m', 'aid') }, stepList: [{ id: 'map', title: 'Map' }, { id: 'find', title: 'Find' }, { id: 'write', title: 'Write' }] },
			audit: { title: 'System columns', source: { table: 's.a', ...rowsOf('aid') }, targetRun: { table: 't.a', label: 'Loaded', rowList: [{ column: 'createdon', value: 'now', tone: 'red' }] }, targetPost: { table: 't.a', label: 'After', rowList: [{ column: 'createdon', value: 'then', tone: 'green' }] }, stepRun: { title: 'Create' }, stepPost: { title: 'Script' } },
		} },
	];
};

test('many batches: the first, the last, and dots between them in the rows and the cards', () => {
	const provider = migrationProviderBuild(migrationModelBuild('example', itemPostListBuild()));
	for (const kind of ['run', 'verify']) {
		const diagram = provider.sceneGet(`/overview/${kind}/flow`).diagram;
		const nodeOf = (id) => diagram.nodes.find((node) => node.id === id);
		const dots = diagram.nodes.filter((node) => node.renderer.type === 'card-three-dots');
		assert.equal(dots.length, 1);
		assert.equal(dots[0].data.text, '298 batches');
		assert.ok(nodeOf('flow-batch:a-001.csv').position.y < dots[0].position.y && dots[0].position.y < nodeOf('flow-batch:a-300.csv').position.y);
		const table = nodeOf('flow-table:s.a');
		const rowNameList = table.data.rows.map((row) => (row.isEllipsis ? '...' : row.name));
		assert.deepEqual(rowNameList, ['row 1', '...', 'row 100', '...', '...', '...', 'row 29,901', '...', 'row 29,950']);
		assert.equal(table.data.rowGroupList.length, 2);
		assert.ok(diagram.connections.some((line) => line.source.nodeId === 'flow-table:s.a' && line.target.nodeId === dots[0].id && line.style.strokeDasharray));
		assert.equal(nodeOf(`${kind === 'run' ? 'flow' : 'verify'}-target:t.a`).data.rows[0].name, '29,950 row');
	}
	assert.ok(provider.sceneGet('/overview/run').diagram.nodes[0].data.itemList.find((item) => item.id === 'result').node.data.text.startsWith('300 batches'));
	assert.ok(provider.sceneGet('/overview/run/batch').diagram.nodes[0].data.rows[1].file.includes('298'));
	assert.ok(provider.sceneGet('/overview/plan/batch').diagram.nodes.find((node) => node.id === 'batch:s.a').data.rows[1].file.includes('298'));
});

test('a master table is told apart wherever it is drawn, and maps as a whole table', () => {
	const provider = migrationProviderBuild(migrationModelBuild('example', itemPostListBuild()));
	const er = diagramShownOf(provider, '/overview/pw');
	const master = er.nodes.find((node) => node.id === 'table:pw:m');
	assert.equal(master.data.badge, 'Master');
	assert.equal(master.data.tone, 'amber');
	assert.equal(er.nodes.find((node) => node.id === 'table:pw:a').data.badge, undefined);
	const mapping = provider.sceneGet('/overview/mapping/m--tm').diagram;
	assert.deepEqual(mapping.connections.map((line) => [line.source.nodeId, line.target.nodeId, line.label.text]), [['table:pw:m', 'table:connect:tm', 'As a table']]);
	assert.deepEqual(provider.childListGet('/overview/mapping/m--tm'), []);
	assert.equal(provider.sceneGet('/overview/plan/order').diagram.nodes.find((node) => node.data?.title === 'TM').data.tone, 'amber');
});

test('the plan after the migration: a report of its own, in the overview and the tabs', () => {
	const provider = migrationProviderBuild(migrationModelBuild('example', itemPostListBuild()));
	const registryPost = switchRegistryBuild(powerPlatformNodeRegistry);
	for (const path of ['/overview', '/overview/tabs/post', '/overview/post', '/overview/post/master', '/overview/post/audit']) {
		assert.doesNotThrow(() => diagramNormalize({ version: 1, ...provider.sceneGet(path).diagram }, registryPost), path);
	}
	assert.deepEqual(provider.sceneGet('/overview/post').diagram.nodes[0].data.itemList.map((item) => item.id), ['intro', 'master', 'audit']);
	assert.equal(provider.labelGet('/overview/post/master'), 'Fix references');
	assert.ok(provider.childListGet('/overview').some((item) => item.path === '/overview/post'));
	const overview = provider.sceneGet('/overview').diagram;
	const reportList = ['plan', 'run', 'verify', 'post'].map((id) => overview.nodes.find((node) => node.id === `report:${id}`));
	for (let index = 1; index < reportList.length; index += 1) assert.ok(reportList[index].position.x >= reportList[index - 1].position.x + reportList[index - 1].size.width + 100);
	assert.ok(overview.connections.some((line) => line.id === 'verify-post'));
	assert.ok(overview.connections.some((line) => line.id === 'make:post' && line.target.nodeId === 'report:post'));
	// its server is one of its own
	const master = provider.sceneGet('/overview/post/master').diagram;
	const block = master.nodes.find((node) => node.id === 'post-master:block');
	assert.deepEqual(block.data.columnList.map((column) => column.text), ['Source database (PW)', 'Post-processing server', 'Target database (Connect)']);
	assert.match(block.data.itemList.at(-1).text, /Columns to update: TA\.m/);
	assert.equal(master.nodes.find((node) => node.id === 'post-master:source').data.badge, 'Master');
	assert.equal(master.nodes.find((node) => node.id === 'post-master:refer-source').data.badge, undefined);
	const audit = provider.sceneGet('/overview/post/audit').diagram;
	assert.deepEqual(audit.nodes.find((node) => node.id === 'post-audit:block').data.columnList.map((column) => column.text), ['Source database (PW)', 'Migration server', 'Post-processing server', 'Target database (Connect)']);
	assert.equal(audit.nodes.find((node) => node.id === 'post-audit:target-run').data.rows[0].tone, 'red');
	assert.equal(audit.nodes.find((node) => node.id === 'post-audit:target-post').data.rows[0].tone, 'green');
	assert.match(audit.nodes.find((node) => node.id === 'post-audit:target-run').data.nameLogical, /^Loaded \/ /);
});

test('the reports are at full height, in the overview and on their own; without the item there is no such report', () => {
	const provider = migrationProviderBuild(migrationModelBuild('example', itemPostListBuild()));
	for (const id of ['plan', 'run', 'verify', 'post']) {
		const { data } = provider.sceneGet(`/overview/${id}`).diagram.nodes[0];
		assert.equal(data.isHeightFullEmbedded, true);
		assert.equal(data.isHeightFullFocused, true);
	}
	const providerBare = migrationProviderBuild(migrationModelBuild('example', itemPostListBuild().filter((item) => item.kind !== 'plan-post')));
	assert.equal(providerBare.sceneGet('/overview/post'), null);
	assert.ok(!providerBare.sceneGet('/overview').diagram.nodes.some((node) => node.id === 'report:post'));
	assert.ok(!providerBare.sceneGet('/overview').diagram.connections.some((line) => line.id === 'make:post' || line.id === 'verify-post'));
});


test('every line of an ER diagram has a lane of its own', () => {
	const tableOf = (logical, lookupList = [], choiceList = []) => ({ key: `t.${logical}`, kind: 'schema-table', path: `/example/schema/pw/table/${logical}`, data: { db: 'pw', logical, name: logical, columnList: [
		{ id: 'id', name: 'Id', type: 'Unique identifier', key: 'PK' },
		...lookupList.map((target) => ({ id: `to-${target}`, name: target, type: 'Lookup', lookup: `t.${target}` })),
		...choiceList.map((choice) => ({ id: `of-${choice}`, name: choice, type: 'Choice', choice: `c.${choice}` })),
	] } });
	const lanes = migrationModelBuild('example', [
		{ key: 'sys', kind: 'system', path: '/example/system', data: { source: { id: 'pw', name: 'PW' }, target: { id: 'connect', name: 'Connect' }, labels: {} } },
		tableOf('one', ['user', 'area'], ['state']),
		tableOf('two', ['user', 'area'], ['state']),
		tableOf('user'),
		tableOf('area'),
		{ key: 'c.state', kind: 'schema-choice', path: '/example/schema/pw/choice/state', data: { db: 'pw', logical: 'state', name: 'state', optionList: [{ value: 1, label: 'A' }] } },
	]);
	const lineList = diagramShownOf(migrationProviderBuild(lanes), '/overview/pw').connections;
	const lookupList = lineList.filter((line) => line.id.startsWith('lookup:'));
	assert.equal(lookupList.length, 4);
	for (const line of lookupList) assert.equal(line.route.anchorList[0].along, 1, 'the lane follows the table referred to');
	assert.equal(new Set(lookupList.map((line) => line.route.anchorList[0].x)).size, 4, 'lines to one place too');
	// lines to one option set: a lane and a level each
	const choiceLineList = lineList.filter((line) => line.id.startsWith('choice:'));
	assert.equal(choiceLineList.length, 2);
	assert.equal(new Set(choiceLineList.map((line) => line.route.anchorList[0].x)).size, 2);
	assert.equal(new Set(choiceLineList.map((line) => line.route.anchorList[0].y)).size, 2);
	// the scene of one table: a lane per line at each side
	const user = migrationProviderBuild(lanes).sceneGet('/overview/pw/user').diagram.connections;
	assert.equal(new Set(user.map((line) => line.route.anchorList[0].x)).size, user.length);
});

test('the lines fanning out of the tool each have a level of their own, the farthest out the highest', () => {
	const lineList = migrationProviderBuild(migrationModelBuild('example', itemPostListBuild())).sceneGet('/overview').diagram.connections;
	const levelOf = (id) => lineList.find((line) => line.id === id).route.anchorList[0].y;
	assert.ok(levelOf('make:plan') < levelOf('make:run'));
	assert.ok(levelOf('make:post') < levelOf('make:verify'));
});

// an option set used by one column, and global ones, on tables of a mapping
function modelOptionSetBuild() {
	const tableOf = (db, logical, columnList) => ({ key: `t.${db}.${logical}`, kind: 'schema-table', path: `/example/schema/${db}/table/${logical}`, data: { db, logical, name: logical, columnList } });
	const choiceOf = (db, logical, isGlobal) => ({ key: `c.${db}.${logical}`, kind: 'schema-choice', path: `/example/schema/${db}/choice/${logical}`, data: { db, logical, name: logical, ...(isGlobal ? {} : { isGlobal: false }), optionList: [{ value: 1, label: 'One' }] } });
	const pk = { id: 'id', name: 'Id', type: 'Unique identifier', key: 'PK' };
	const filler = Array.from({ length: 5 }, (_, index) => ({ id: `f${index}`, name: `F${index}`, type: 'Text' }));
	return migrationModelBuild('example', [
		{ key: 'sys', kind: 'system', path: '/example/system', data: { source: { id: 'pw', name: 'PW' }, target: { id: 'connect', name: 'Connect' }, labels: { columnUnit: 'cols' } } },
		tableOf('pw', 'a', [pk, ...filler, { id: 'shared', name: 'Shared', type: 'Choice', choice: 'c.pw.shared' }, { id: 'own', name: 'Own', type: 'Choice', choice: 'c.pw.own' }]),
		tableOf('pw', 'b', [pk, { id: 'shared', name: 'Shared', type: 'Choice', choice: 'c.pw.shared' }, ...filler]),
		tableOf('connect', 'x', [pk, { id: 'ownx', name: 'Own', type: 'Choice', choice: 'c.connect.ownx' }]),
		choiceOf('pw', 'shared', true), choiceOf('pw', 'own', false), choiceOf('connect', 'ownx', false),
		{ key: 'm.t', kind: 'mapping-table', path: '/example/mapping/table/a--x', data: { source: 't.pw.a', target: 't.connect.x', columnKeyList: ['m.c'] } },
		{ key: 'm.c', kind: 'mapping-column', path: '/example/mapping/column/a--x/ownx', data: { id: 'ownx', name: 'Own', table: 'm.t', source: 'own', target: 'ownx', stepList: [{ op: 'choice', mapping: 'm.o' }] } },
		{ key: 'm.o', kind: 'mapping-choice', path: '/example/mapping/choice/own--ownx', data: { source: 'c.pw.own', target: 'c.connect.ownx', label: 'Own', optionList: [{ from: 1, to: 1 }] } },
	]);
}

test('an option set has a scene: the tables using it cut down to the columns pointing to it', () => {
	const provider = migrationProviderBuild(modelOptionSetBuild());
	const { diagram } = provider.sceneGet('/overview/pw/shared');
	assert.equal(provider.labelGet('/overview/pw/shared'), 'shared');
	assert.doesNotThrow(() => diagramNormalize({ version: 1, ...diagram }, registry));
	assert.deepEqual(diagram.nodes.map((node) => node.id), ['table:pw:a', 'table:pw:b', 'choice:pw:shared']);
	const tableA = diagram.nodes[0];
	assert.deepEqual(tableA.data.rowDisplay, ['id', { break: '5 cols' }, 'shared', { break: '1 cols' }]);
	assert.equal(tableA.data.columns.length, 8, 'the rows stay in the data');
	assert.deepEqual(diagram.nodes[1].data.rowDisplay, ['id', 'shared', { break: '5 cols' }]);
	assert.deepEqual(diagram.connections.map((line) => line.target.nodeId), ['choice:pw:shared', 'choice:pw:shared']);
	for (const line of diagram.connections) assert.ok(line.route.anchorList.length, 'an arranger gave it a lane');
	assert.equal(diagramShownOf(provider, '/overview/pw').nodes.find((node) => node.id === 'choice:pw:shared').link, '/overview/pw/shared');
	assert.ok(provider.childListGet('/overview/pw').some((item) => item.path === '/overview/pw/shared'));
});

test('an option set of one column is drawn with its table, not in the ER diagram', () => {
	const provider = migrationProviderBuild(modelOptionSetBuild());
	const nodeIdOf = (path) => diagramShownOf(provider, path).nodes.map((node) => node.id);
	assert.ok(!nodeIdOf('/overview/pw').includes('choice:pw:own'));
	assert.ok(nodeIdOf('/overview/pw').includes('choice:pw:shared'));
	assert.ok(nodeIdOf('/overview/pw/a').includes('choice:pw:own'));
	assert.equal(provider.sceneGet('/overview/pw/a').diagram.nodes.find((node) => node.id === 'choice:pw:own').data.isGlobal, false);
	assert.equal(provider.sceneGet('/overview/pw/own').diagram.nodes.length, 2, 'it has a scene too');
	for (const path of ['/overview/mapping/a--x', '/overview/mapping/a--x/ownx']) {
		const diagram = diagramShownOf(provider, path);
		assert.doesNotThrow(() => diagramNormalize({ version: 1, ...diagram }, registry), path);
		for (const id of ['choice:pw:own', 'choice:connect:ownx']) assert.ok(diagram.nodes.some((node) => node.id === id), `${path} ${id}`);
		assert.ok(diagram.connections.some((line) => line.source.nodeId === 'table:pw:a' && line.target.nodeId === 'choice:pw:own'), path);
	}
	assert.equal(provider.sceneGet('/overview/mapping/a--x').diagram.connections.find((line) => line.id === 'map-choice:m.o').link, '/overview/choice/own--ownx');
	assert.ok(!provider.sceneGet('/overview/mapping/a--x/ownx').diagram.connections.some((line) => line.id === 'map-choice:m.o'));
});

test('the menu shows an icon beside a database and an option set', () => {
	const provider = migrationProviderBuild(modelOptionSetBuild());
	const itemOf = (parent, path) => provider.childListGet(parent).find((item) => item.path === path);
	assert.deepEqual(itemOf('/overview', '/overview/pw').labelItemList, [{ type: 'icon', icon: 'database' }, { type: 'text', text: 'PW' }]);
	assert.equal(itemOf('/overview/pw', '/overview/pw/shared').labelItemList[0].icon, 'list-checks');
	assert.equal(itemOf('/overview/pw', '/overview/pw/a').labelItemList, undefined);
});

test('what does not fit about an option set is said', () => {
	const base = modelOptionSetBuild();
	const list = (extra) => migrationModelBuild('example', [{ key: 'c', kind: 'schema-choice', path: '/x', data: { db: 'pw', logical: 'a', optionList: [], ...extra } }, { key: 't', kind: 'schema-table', path: '/y', data: { db: 'pw', logical: 'a', columnList: [{ id: 'one', choice: 'c' }, { id: 'two', choice: 'c' }] } }]).problemList;
	assert.ok(list({}).some((text) => text.includes('same logical name')));
	assert.ok(list({ isGlobal: false }).some((text) => text.includes('2 columns use it')));
	assert.equal(base.problemList.length, 0);
});

test('a database has three views: a cylinder on its card, the ER diagram on hover and focused, its lookups as a matrix', () => {
	const scene = provider.sceneGet('/overview/pw');
	assert.deepEqual(scene.viewList.map((view) => view.id), ['diagram', 'matrix', 'icon']);
	assert.equal(switchViewResolve(scene, switchPresentationBuild('/overview/pw', true, '/overview')), 'icon');
	assert.equal(switchViewResolve(scene, switchPresentationBuild('/overview/pw')), 'diagram');
	assert.equal(switchViewHoverResolve(scene, switchPresentationBuild('/overview/pw', true, '/overview')), 'diagram');
	assert.deepEqual(switchViewListOf(scene, switchPresentationBuild('/overview/pw')).map((view) => view.id), ['diagram', 'matrix']);
	assert.deepEqual(switchViewListOf(scene, switchPresentationBuild('/overview/pw', true, '/overview')).map((view) => view.id), ['diagram', 'icon']);
	const [icon] = scene.viewList[2].diagram.nodes;
	assert.equal(icon.renderer.type, 'card-database');
	assert.equal(icon.data.title, 'PW');
	assert.equal(scene.viewList[2].isFrameHiddenEmbedded, true);
	// it fills the card embedding it, so a line arriving at the side of the card ends on its wall
	const card = provider.sceneGet('/overview').diagram.nodes.find((node) => node.id === 'db:source');
	assert.deepEqual(icon.size, card.size);
	assert.ok(scene.viewList[0].diagram.nodes.some((node) => node.id === 'table:pw:a'), 'the ER diagram keeps the node ids of its tables');
	const [matrix] = scene.viewList[1].diagram.nodes;
	assert.equal(matrix.renderer.type, 'card-matrix');
	assert.deepEqual(matrix.data.rowList.map((row) => row.id), ['a', 'b']);
	assert.deepEqual(matrix.data.columnList.map((column) => column.id), ['a', 'b']);
	assert.equal(matrix.data.rowList[0].link, '/overview/pw/a');
	for (const cell of matrix.data.cellList) assert.equal(cell.link, `/overview/pw/${cell.row}/${cell.column}`);
	const tableList = itemList.filter((item) => item.kind === 'schema-table' && item.data.db === 'pw');
	const lookupCount = tableList.reduce((sum, item) => sum + new Set(item.data.columnList.map((column) => column.lookup).filter(Boolean)).size, 0);
	assert.equal(matrix.data.cellList.length, lookupCount);
	assert.ok(matrix.size.width > 0 && matrix.size.height === 'auto');
	// the other scenes have one view, their diagram
	assert.equal(provider.sceneGet('/overview/pw/a').viewList, undefined);
});

test('a lookup matrix counts the columns behind a mark, and leaves out what is not a table of the database', () => {
	const table = (logical, columnList) => ({ key: `t.${logical}`, kind: 'schema-table', path: `/example/schema/pw/table/${logical}`, data: { db: 'pw', logical, name: logical.toUpperCase(), columnList } });
	const list = [
		{ key: 'sys', kind: 'system', path: '/example/system', data: { source: { id: 'pw', name: 'PW' }, target: { id: 'cn', name: 'CN' }, labels: { viewLookupMatrix: 'M' } } },
		table('p', [{ id: 'pid', name: 'P', key: 'PK' }]),
		table('q', [{ id: 'one', name: 'One', lookup: 't.p' }, { id: 'two', name: 'Two', lookup: 't.p' }, { id: 'far', name: 'Far', lookup: 't.r' }, { id: 'lost', name: 'Lost', lookup: 'nothing' }]),
		{ ...table('r', [{ id: 'rid', name: 'R', key: 'PK' }]), data: { db: 'cn', logical: 'r', name: 'R', columnList: [{ id: 'rid', name: 'R', key: 'PK' }] } },
	];
	const [matrix] = migrationProviderBuild(migrationModelBuild('example', list)).sceneGet('/overview/pw').viewList[1].diagram.nodes;
	assert.equal(matrix.data.title, 'PW: M');
	assert.deepEqual(matrix.data.cellList, [{ row: 'q', column: 'p', link: '/overview/pw/q/p', title: 'Q → P: One, Two', mark: '2' }]);
});

test('the estimate of a line to a table as a whole ends at its title line, as it is drawn', () => {
	const nodes = [
		{ id: 't', renderer: { type: 'dataverse-table' }, position: { x: 0, y: 100 }, size: { width: 400, height: 300 }, data: { columns: [] }, handles: [{ id: 'side', direction: 'out', anchor: { side: 'right' } }, { id: 'low', direction: 'out', anchor: { side: 'right', offset: 0.8 } }] },
		{ id: 'n', renderer: { type: 'card-note' }, position: { x: 600, y: 100 }, size: { width: 200, height: 100 }, data: {}, handles: [{ id: 'side', direction: 'in', anchor: { side: 'left' } }] },
	];
	const geometry = erGeometryEstimateBuild({ nodes });
	const lineOf = (handleId) => ({ source: { nodeId: 't', handleId }, target: { nodeId: 'n', handleId: 'side' } });
	assert.equal(geometry.endOf(lineOf('side'), 'source').y, 118);
	assert.equal(geometry.endOf(lineOf('low'), 'source').y, 340, 'a place written on purpose stays');
	assert.equal(geometry.endOf(lineOf('side'), 'target').y, 150, 'another kind keeps the middle of its side');
});

test('one lookup has a scene of its own: the two tables cut down, and a link from each column to its mapping', () => {
	const table = (db, logical, columnList) => ({ key: `t.${db}.${logical}`, kind: 'schema-table', path: `/example/schema/${db}/table/${logical}`, data: { db, logical, name: logical.toUpperCase(), columnList } });
	const list = [
		{ key: 'sys', kind: 'system', path: '/example/system', data: { source: { id: 'pw', name: 'PW' }, target: { id: 'cn', name: 'CN' } } },
		table('pw', 'p', [{ id: 'pid', name: 'P', key: 'PK' }, { id: 'other', name: 'Other' }]),
		table('pw', 'q', [{ id: 'qid', name: 'Q', key: 'PK' }, { id: 'one', name: 'One', lookup: 't.pw.p' }, { id: 'two', name: 'Two', lookup: 't.pw.p' }, { id: 'memo', name: 'Memo' }, { id: 'self', name: 'Self', lookup: 't.pw.q' }]),
		table('cn', 'x', [{ id: 'xid', name: 'X', key: 'PK' }, { id: 'in', name: 'In', lookup: 't.cn.y' }]),
		table('cn', 'y', [{ id: 'yid', name: 'Y', key: 'PK' }]),
		{ key: 'map.t', kind: 'mapping-table', path: '/example/mapping/table/q--x', data: { source: 't.pw.q', target: 't.cn.x', columnKeyList: ['map.c'] } },
		{ key: 'map.c', kind: 'mapping-column', path: '/example/mapping/column/q--x/in', data: { id: 'in', name: 'In', table: 'map.t', source: 'one', target: 'in', kind: 'text', label: 'l', stepList: [] } },
	];
	const providerLookup = migrationProviderBuild(migrationModelBuild('example', list));
	const { nodes, connections } = providerLookup.sceneGet('/overview/pw/q/p').diagram;
	assert.deepEqual(nodes.map((node) => node.id), ['table:pw:q', 'table:pw:p', 'link:mapping:one'], 'the same ids as elsewhere, so a switch moves them');
	assert.deepEqual(connections.map((line) => line.id), ['lookup:pw:q:one', 'lookup:pw:q:two']);
	assert.equal(connections[0].target.handleId, 'pk');
	const link = nodes[2];
	assert.equal(link.renderer.type, 'scene-link');
	assert.equal(link.link, '/overview/mapping/q--x/in');
	assert.equal(link.size, undefined, 'no width written: it is as wide as its words');
	assert.ok(link.data.title.includes('One'));
	assert.doesNotThrow(() => diagramNormalize({ version: 1, nodes, connections }, registry));
	assert.equal(diagramNormalize({ version: 1, nodes, connections }, registry).nodes[2].isWidthFit, true);
	// the target side: what the column comes from
	assert.equal(providerLookup.sceneGet('/overview/cn/x/y').diagram.nodes.find((node) => node.id === 'link:mapping:in').link, '/overview/mapping/q--x/in');
	// a table looking itself up is one card, and a column with no mapping has no link
	const self = providerLookup.sceneGet('/overview/pw/q/q').diagram;
	assert.deepEqual(self.nodes.map((node) => node.id), ['table:pw:q']);
	assert.equal(self.connections.length, 1);
	assert.doesNotThrow(() => diagramNormalize({ version: 1, ...self }, registry));
	// what is not a lookup names nothing
	assert.equal(providerLookup.sceneGet('/overview/pw/p/q'), null);
	assert.equal(providerLookup.sceneGet('/overview/pw/q/nothing'), null);
	// it can be found from the path bar, under the table
	assert.deepEqual(providerLookup.childListGet('/overview/pw/q').map((child) => child.path), ['/overview/pw/q/p', '/overview/pw/q/q']);
	assert.equal(providerLookup.labelGet('/overview/pw/q/p'), '→ P');
	assert.deepEqual(providerLookup.childListGet('/overview/pw/p'), []);
});

test('the labels of the column mappings of two tables stand in one column', () => {
	const { connections } = provider.sceneGet('/overview/mapping/a--x').diagram;
	const positionList = connections.filter((line) => line.id.startsWith('column:') && line.target.handleId.startsWith('column-') && line.label?.text).map((line) => line.label.position);
	assert.ok(positionList.length >= 2);
	assert.deepEqual([...new Set(positionList)], [0.5]);
});

test('in the scene of one column the rows left out stand behind a break a reader can open', () => {
	const { nodes } = provider.sceneGet('/overview/mapping/a--x/state').diagram;
	const table = nodes.find((node) => node.id === 'table:pw:a');
	const folded = table.data.rowDisplay.filter((entry) => typeof entry === 'object');
	assert.ok(folded.length > 0 || table.data.rowDisplay.every((entry) => typeof entry === 'string'));
	for (const entry of folded) {
		assert.ok(entry.rowList.length > 0);
		assert.equal(entry.isExpanded, undefined, 'closed at first');
		assert.ok(entry.break);
	}
	assert.equal(new Set([...table.data.rowDisplay.filter((entry) => typeof entry === 'string'), ...folded.flatMap((entry) => entry.rowList)]).size, table.data.columns.length, 'every column is there');
	assert.doesNotThrow(() => diagramNormalize({ version: 1, nodes, connections: provider.sceneGet('/overview/mapping/a--x/state').diagram.connections }, registry));
});

test('abandoned columns have a lane each: their lines share only the last run into the card, their labels apart', () => {
	const table = (db, logical, columnList) => ({ key: `t.${logical}`, kind: 'schema-table', path: `/example/schema/${db}/table/${logical}`, data: { db, logical, name: logical.toUpperCase(), columnList } });
	const column = (id) => ({ id, name: id, logical: id, type: 'Text' });
	const abandonOf = (id) => ({ key: `c.${id}`, kind: 'mapping-column', path: `/example/mapping/column/s--t/${id}`, data: { id, name: id, table: 'm', source: id, target: null, kind: 'abandon', label: 'Abandon', stepList: [{ op: 'abandon' }] } });
	const idList = ['one', 'two', 'three'];
	const list = [
		{ key: 'sys', kind: 'system', path: '/example/system', data: { source: { id: 'pw', name: 'PW' }, target: { id: 'cn', name: 'CN' } } },
		table('pw', 's', [column('keep'), ...idList.map(column)]),
		table('cn', 't', [column('keep')]),
		{ key: 'm', kind: 'mapping-table', path: '/example/mapping/table/s--t', data: { source: 't.s', target: 't.t', columnKeyList: ['c.keep', ...idList.map((id) => `c.${id}`)] } },
		{ key: 'c.keep', kind: 'mapping-column', path: '/example/mapping/column/s--t/keep', data: { id: 'keep', name: 'keep', table: 'm', source: 'keep', target: 'keep', kind: 'copy', label: 'Copy', stepList: [] } },
		...idList.map(abandonOf),
	];
	const diagram = migrationProviderBuild(migrationModelBuild('example', list)).sceneGet('/overview/mapping/s--t').diagram;
	const geometry = erGeometryEstimateBuild(diagram);
	const lineList = diagram.connections.map((connection) => {
		const a = geometry.endOf(connection, 'source');
		const b = geometry.endOf(connection, 'target');
		const ends = { sourceX: a.x, sourceY: a.y, sourcePosition: a.side, targetX: b.x, targetY: b.y, targetPosition: b.side };
		return { id: connection.id, label: connection.label, d: routeResolve('smoothstep', connection.route ?? null, ends).d, sourceKey: `${connection.source.nodeId}/${connection.source.handleId}`, targetKey: `${connection.target.nodeId}/${connection.target.handleId}` };
	});
	assert.deepEqual(routeOverlapListGet(lineList), []);
	const abandonedList = lineList.filter((line) => line.targetKey === 'operator:abandon/left');
	assert.equal(abandonedList.length, 3);
	const laneList = abandonedList.map((line) => routePathRunListGet(line.d).find((run) => Math.abs(run.from.x - run.to.x) < 1).from.x);
	assert.equal(new Set(laneList.map(Math.round)).size, 3, `a lane each: ${laneList}`);
	const rectList = abandonedList.map((line) => {
		const point = routePolylinePointAt(routePathPolylineGet(line.d), line.label.position);
		const size = labelSizeEstimate(line.label.text);
		return { x: point.x - size.width / 2, y: point.y - size.height / 2, ...size };
	});
	rectList.forEach((a, index) => rectList.slice(index + 1).forEach((b) => assert.ok(!(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height), 'two labels meet')));
	assert.equal(lineList.find((line) => line.id === 'column:c.keep').label.position, 0.5, 'a line across the gap keeps its place in the column of labels');
	assert.equal(diagram.connections.find((line) => line.id === 'column:c.keep').route, undefined, 'and its straight way');
});

