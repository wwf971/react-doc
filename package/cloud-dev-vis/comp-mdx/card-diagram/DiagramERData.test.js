import { cardRowDisplayIdListOf, cardRowDisplayItemListGet, cardRowDisplayKeepBuild, cardRowDisplayNormalize, cardRowDisplayWithout, cardViewDefaultGet, cardViewDrawBuild, cardViewListGet, cardViewListPrune, cardViewSourceOf, cardViewSwitcherIsShown, tableCardNormalize } from './TableCardData.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { dataverseCardNormalize, dataverseAnchorListGet } from '../power-platform/DataverseCardData.js';
import { diagramNormalize, diagramPositionsGet, diagramLegacyConvert, cardStandaloneNormalize, diagramPlacesGet } from './DiagramERData.js';
import { diagramDependenciesCollect, cardDiagramSourceDefaultCreate } from './DiagramERSource.js';
import { diagramSourceDefaultCreate, dataverseSourceDefaultCreate } from '../power-platform/DataverseCardSource.js';
import { dataverseEntityNodeRegistry, powerPlatformNodeRegistry } from '../power-platform/power-platform-node-registry.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';

// the engine is tested on the registry of the Power Platform series, which
// holds every card variant (fixed fields, resource fields, authored fields)
const registry = powerPlatformNodeRegistry;

const nodeCreate = (id, position = 'auto') => ({ id, renderer: { type: 'dataverse-table' }, position, data: { name: id, columns: [{ id: 'value', name: 'Value' }] }, handles: [{ id: 'port', direction: 'both', anchor: { target: 'column/value', side: 'right' } }] });
const diagramCreate = () => ({ version: 1, nodes: [nodeCreate('source', { x: 0, y: 0 }), nodeCreate('target')], connections: [{ id: 'link', source: { nodeId: 'source', handleId: 'port' }, target: { nodeId: 'target', handleId: 'port' } }] });

test('Power Platform resource nodes share the graph, property anchors and connection validation', () => {
	const graph = diagramCreate();
	graph.nodes[0].renderer.type = 'power-automate';
	graph.nodes[0].data = { name: 'On update', kind: 'trigger', connector: 'Dataverse', properties: [{ id: 'filter', name: 'Filter rows', value: 'statecode eq 0' }] };
	graph.nodes[0].handles[0].anchor.target = 'property/filter';
	graph.nodes[1].renderer.type = 'business-rule';
	graph.nodes[1].data = { name: 'Require approval', kind: 'action', action: 'setRequired', table: 'account' };
	graph.nodes[1].handles[0].anchor.target = 'header';
	const result = diagramNormalize(graph, registry);
	assert.equal(result.nodes[0].data.properties[0].value, 'statecode eq 0');
	assert.equal(result.nodes[1].data.scope, 'All Forms');
	assert.equal(result.connections.length, 1);
	graph.nodes[0].data.kind = 'invented';
	assert.throws(() => diagramNormalize(graph, registry), /unsupported value/);
	graph.nodes[0].data.kind = 'trigger';
	graph.nodes[0].data.properties.push({ id: 'filter' });
	assert.throws(() => diagramNormalize(graph, registry), /Duplicate property/);
	graph.nodes[0].data.properties = [{ id: 'filter', value: false }];
	assert.throws(() => diagramNormalize(graph, registry), /must be text/);
});

test('renderer contracts stay immutable and obsolete viewport fields fail explicitly', () => {
	const input = { version: 1, nodes: [{ id: 'custom', renderer: { component: 'Custom' } }] };
	const contract = { anchorListGet: () => Object.freeze([{ id: 'port', sideList: ['left'] }]) };
	assert.equal(diagramNormalize(input, registry, () => contract).nodes[0].anchors.length, 2);
	assert.throws(() => diagramNormalize(input, registry, () => ({ ...contract, dataNormalize: () => null })), /data must be a mapping/);
	assert.throws(() => diagramNormalize({ ...input, nodes: [], zoomRange: {} }, registry), /viewport.zoom/);
	assert.throws(() => diagramNormalize({ ...input, nodes: [], viewport: { x: 20, y: 30, zoom: 1 } }, registry), /viewport.view/);
});

test('custom edge data defaults are shared by runtime and dependency collection', () => {
	const input = diagramCreate();
	input.defaults = { connection: { data: { target: 'default.md' } } };
	assert.deepEqual(diagramNormalize(input, registry).connections[0].data, { target: 'default.md' });
	const collected = [];
	input.defaults.connection.renderer = { component: 'Edge' };
	diagramDependenciesCollect(input, { componentCollect: (...args) => collected.push(args), warn: message => assert.fail(message) });
	assert.deepEqual(collected, [['Edge', { target: 'default.md' }]]);
});
test('insertion templates use the shared graph and fixed-node schemas', () => {
	assert.equal(diagramNormalize(yamlParse(diagramSourceDefaultCreate().raw), registry).connections.length, 1);
	assert.equal(cardStandaloneNormalize(yamlParse(dataverseSourceDefaultCreate().raw), dataverseEntityNodeRegistry).renderer.type, 'dataverse-table');
});

test('a component type draws and creates the kinds of its own registry only', () => {
	const base = yamlParse(cardDiagramSourceDefaultCreate().raw);
	assert.equal(diagramNormalize(base, cardDiagramNodeRegistry).nodes.length, 3);
	// the base series does not know the Dataverse kinds, and says what it knows
	assert.throws(() => diagramNormalize(diagramCreate(), cardDiagramNodeRegistry), /unknown node type "dataverse-table" \(this diagram knows: table, operator, card-note, card-brief, card-three-dots, card-database, card-matrix, scene-box, color-block\)/);
	assert.deepEqual(cardDiagramNodeRegistry.createEntryList.map(entry => entry.id), ['table', 'operator', 'card-note', 'card-brief', 'card-database', 'card-matrix', 'scene-box', 'color-block', 'connection']);
	assert.deepEqual(registry.createEntryList.map(entry => entry.id), ['table', 'operator', 'card-note', 'card-brief', 'card-database', 'card-matrix', 'scene-box', 'color-block', 'operator-abandon', 'operator-text', 'operator-mapping', 'dataverse-table', 'dataverse-choice', 'power-automate', 'business-rule', 'connection']);
	// the standalone Dataverse card takes a Dataverse table alone, and its older form
	assert.throws(() => cardStandaloneNormalize({ version: 1, node: { id: 'x', renderer: { type: 'table' }, data: {} } }, dataverseEntityNodeRegistry), /unknown node type "table"/);
	assert.equal(cardStandaloneNormalize({ entity: { id: 'customer', name: 'Customer', columns: [] } }, dataverseEntityNodeRegistry).id, 'customer');
});

test('nested node and inherited edge renderers delegate dependency collection', () => {
	const collected = [];
	diagramDependenciesCollect({ raw: JSON.stringify({
		defaults: { connection: { renderer: { component: 'custom/Edge' } } },
		nodes: [{ renderer: { component: 'custom/Image' }, data: { src: 'image.png' } }],
		connections: [{ data: { target: 'source.md' } }, { renderer: { type: 'straight' } }],
	}) }, { componentCollect: (...args) => collected.push(args), warn: message => assert.fail(message) });
	assert.deepEqual(collected, [['custom/Image', { src: 'image.png' }], ['custom/Edge', { target: 'source.md' }]]);
});
test('Dataverse cards share field normalization and stable row anchors', () => {
	const card = dataverseCardNormalize({ name: 'Customer', columns: [{ id: 'email', key: ' fk ', isRequired: true, description: 'Contact address' }] });
	assert.equal(card.columns[0].key, 'FK');
	assert.equal(card.columns[0].isRequired, true);
	assert.equal(card.columns[0].description, 'Contact address');
	assert.equal(dataverseAnchorListGet(card)[1].id, 'column/email');
	assert.throws(() => dataverseCardNormalize({ columns: [{ id: 'same' }, { id: 'same' }] }), /Duplicate/);
});

test('generic graph validates explicit handles and line overrides', () => {
	const input = diagramCreate();
	input.defaults = { connection: { style: { stroke: 'red', strokeWidth: 3 }, renderer: { type: 'step' } } };
	input.connections[0].style = { stroke: 'green' };
	const graph = diagramNormalize(input, registry);
	assert.equal(graph.connections[0].style.strokeWidth, 3);
	assert.equal(graph.connections[0].style.stroke, 'green');
	assert.equal(graph.connections[0].renderer.type, 'step');
	input.nodes[0].handles[0].anchor.side = 'left';
	assert.equal(diagramNormalize(input, registry).connections[0].source.handleId, 'port');
	input.connections[0].target.handleId = 'missing';
	assert.throws(() => diagramNormalize(input, registry), /missing or incompatible/);
});

test('automatic layout respects explicit rectangles and measured sizes', () => {
	const graph = diagramNormalize(diagramCreate(), registry);
	const positions = diagramPositionsGet(graph.nodes, graph.layout, { source: { width: 800, height: 900 } });
	assert.deepEqual(positions.get('source'), { x: 0, y: 0 });
	assert.ok(positions.get('target').y >= 900);
	assert.throws(() => diagramNormalize({ version: 1, nodes: [nodeCreate('bad', { x: 1 })] }, registry), /finite/);
});

test('viewport groups canvas size, camera range, zoom and minimap', () => {
	const input = diagramCreate();
	input.viewport = { size: { width: 900, height: 500 }, view: { x: -10, y: 20, zoom: 0.8 }, range: { x: [-100, 100], y: [-100, 100] }, zoom: { min: 0.2, max: 2 }, isMiniMapVisible: true };
	assert.equal(diagramNormalize(input, registry).viewport.isMiniMapVisible, true);
	input.viewport.view.zoom = 3;
	assert.throws(() => diagramNormalize(input, registry), /exceeds/);
});

test('registry renderers require a declared anchor contract and preserve custom content', () => {
	const input = { version: 1, nodes: [{ id: 'operator', renderer: { component: 'etl/Trim' }, data: { operation: 'trim' } }] };
	assert.throws(() => diagramNormalize(input, registry), /must expose/);
	const graph = diagramNormalize(input, registry, (name, placement) => {
		assert.equal(name, 'etl/Trim');
		assert.equal(placement, 'visualizationNode');
		return { anchorListGet: () => [{ id: 'body', sideList: ['left', 'right'] }] };
	});
	assert.equal(graph.nodes[0].data.operation, 'trim');
});

test('legacy conversion retains coordinates, choice identity, and shared handles', () => {
	const legacy = { tables: [{ id: 'first', columns: [{ id: 'value' }] }, { id: 'choice', kind: 'choice', position: { x: 800, y: 40 }, columns: [{ id: 'value' }] }], relationships: ['one', 'two'].map(id => ({ id, source: { tableId: 'first', columnId: 'value' }, target: { tableId: 'choice', columnId: 'value' } })) };
	const converted = diagramLegacyConvert(legacy, 760);
	const graph = diagramNormalize(converted, registry);
	assert.equal(graph.nodes[1].renderer.type, 'dataverse-choice');
	assert.equal(graph.nodes[1].handles.length, 1);
	assert.deepEqual(graph.nodes[1].position, { x: 800, y: 40 });
	assert.equal(graph.viewport.size.height, 760);
});

test('standalone card uses the same node and Dataverse data contract', () => {
	const node = nodeCreate('single');
	node.handles = [];
	assert.deepEqual(cardStandaloneNormalize({ version: 1, node }, dataverseEntityNodeRegistry), diagramNormalize({ version: 1, nodes: [node] }, registry).nodes[0]);
	assert.throws(() => cardStandaloneNormalize({ version: 1, node: { ...node, renderer: { type: 'operator' } } }, dataverseEntityNodeRegistry), /dataverse-table/);
});

test('manual routes are explicit and reject incompatible line types', () => {
	const input = diagramCreate();
	input.connections[0].route = { waypoints: [{ x: 100, y: 200 }] };
	assert.throws(() => diagramNormalize(input, registry), /unknown key "waypoints"/);
	input.connections[0].renderer = { type: 'polyline' };
	assert.equal(diagramNormalize(input, registry).connections[0].route.waypoints.length, 1);
	input.connections[0].route.waypoints[0].x = Infinity;
	assert.throws(() => diagramNormalize(input, registry), /finite/);
});

test('existing choice row handles resolve to the header without mutating authored endpoints', () => {
	const input = diagramLegacyConvert({ tables: [{ id: 'source', columns: [{ id: 'value' }] }, { id: 'choice', kind: 'choice', columns: [{ id: 'value' }] }], relationships: [{ id: 'link', source: { tableId: 'source', columnId: 'value' }, target: { tableId: 'choice', columnId: 'value' } }] });
	input.nodes[1].handles[0].anchor = { target: 'column/value', side: 'right', offset: 0.8 };
	const graph = diagramNormalize(input, registry);
	assert.deepEqual(graph.nodes[1].handles[0].anchor, { target: 'header', side: 'left', offset: 0.5 });
	assert.equal(graph.connections[0].target.handleId, input.connections[0].target.handleId);
	assert.equal(input.nodes[1].handles[0].anchor.target, 'column/value');
});

test('a color block says where its labels go, and which of them are titles', () => {
	const diagramOf = (data) => ({ version: 1, nodes: [{ id: 'b', renderer: { type: 'color-block' }, position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, data, handles: [] }], connections: [] });
	assert.doesNotThrow(() => diagramNormalize(diagramOf({ labelSide: 'top', itemList: [{ id: 't', text: 'T', level: 1 }, { id: 'u', text: 'U' }] }), cardDiagramNodeRegistry));
	assert.throws(() => diagramNormalize(diagramOf({ labelSide: 'left', itemList: [] }), cardDiagramNodeRegistry), /top or the bottom/);
	assert.doesNotThrow(() => diagramNormalize(diagramOf({ fill: 'none', itemList: [] }), cardDiagramNodeRegistry));
	assert.throws(() => diagramNormalize(diagramOf({ fill: 'solid', itemList: [] }), cardDiagramNodeRegistry), /fill: none/);
	assert.throws(() => diagramNormalize(diagramOf({ itemList: [{ id: 't', text: 'T', level: 3 }] }), cardDiagramNodeRegistry), /level 1 or 2/);
	const columnList = [{ id: 'a', x: 0, width: 50, icon: 'database', text: 'A' }, { id: 'b', x: 50, width: 50 }];
	assert.doesNotThrow(() => diagramNormalize(diagramOf({ itemList: [], columnTop: 10, columnList }), cardDiagramNodeRegistry));
	assert.throws(() => diagramNormalize(diagramOf({ itemList: [], columnList }), cardDiagramNodeRegistry), /columnTop/);
	assert.throws(() => diagramNormalize(diagramOf({ itemList: [], columnTop: 10, columnList: [{ id: 'a', x: 0 }] }), cardDiagramNodeRegistry), /x and width/);
	assert.throws(() => diagramNormalize(diagramOf({ itemList: [], columnTop: 10, columnList: [{ id: 'a', x: 0, width: 1, icon: 'nothing' }] }), cardDiagramNodeRegistry), /supported icon/);
});

test('rowDisplay: rows chosen, in any order, with breaks; the rows stay in the data', () => {
	const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
	assert.equal(cardRowDisplayNormalize(undefined, rows), undefined);
	assert.deepEqual(cardRowDisplayNormalize(['c', '...', 'a', { break: 12 }], rows), ['c', '...', 'a', { break: '12' }]);
	assert.throws(() => cardRowDisplayNormalize(['nope'], rows), /not a row/);
	assert.throws(() => cardRowDisplayNormalize(['a', 'a'], rows), /twice/);
	assert.throws(() => cardRowDisplayNormalize('a', rows), /must be a list/);
	assert.throws(() => cardRowDisplayNormalize([{ text: 'x' }], rows), /row id/);
	const item = cardRowDisplayItemListGet(['c', '...', { break: 'two' }], rows);
	assert.equal(item[0].row.id, 'c');
	assert.deepEqual([item[1].break.text, item[2].break.text], ['', 'two']);
	assert.notEqual(item[1].break.id, item[2].break.id);
	assert.equal(cardRowDisplayItemListGet(undefined, rows).length, 3);
	assert.equal(tableCardNormalize({ rows: [{ id: 'a' }], rowDisplay: ['a'] }).rowDisplay[0], 'a');
	assert.throws(() => tableCardNormalize({ rows: [{ id: 'a' }], rowDisplay: ['b'] }), /not a row/);
	assert.deepEqual(cardRowDisplayKeepBuild(['a', 'b', 'c', 'd', 'e'], ['b', 'd']), ['...', 'b', '...', 'd', '...']);
	assert.deepEqual(cardRowDisplayKeepBuild(['a', 'b', 'c', 'd'], ['a', 'b'], { textOf: (count) => `${count} more` }), ['a', 'b', { break: '2 more' }]);
	assert.deepEqual(cardRowDisplayKeepBuild(['a', 'b'], ['a', 'b']), ['a', 'b']);
});

test('a card has views, each of a mode; without any it has its plain view', () => {
	const rows = [{ id: 'a', f: '1', g: '2' }, { id: 'b', f: '3', g: '4' }];
	const fields = [{ id: 'f', label: 'F' }, { id: 'g', label: 'G' }];
	const plainOnly = tableCardNormalize({ fields, rows, rowDisplay: ['a'] });
	assert.equal(plainOnly.viewList, undefined);
	assert.deepEqual(cardViewListGet(plainOnly).map((view) => [view.id, view.mode, view.isImplicit]), [['plain', 'plain', true]]);
	assert.deepEqual(cardViewDefaultGet(plainOnly).rowDisplay, ['a']);
	assert.equal(cardViewSwitcherIsShown(plainOnly), false);
	assert.equal(cardViewSwitcherIsShown({ ...plainOnly, isViewSwitcherHidden: false }), true);
	// two views of one mode, and a default
	const data = tableCardNormalize({ fields, rows, viewDefault: 'few', viewList: [
		{ id: 'all', mode: 'row' },
		{ id: 'few', label: 'Few', mode: 'row', fieldDisplay: ['g'], rowDisplay: ['b', '...'] },
		{ id: 'one', mode: 'column', valueRowId: 'a', rowDisplay: ['g', 'f'] },
		{ id: 'data', mode: 'plain' },
	] });
	assert.equal(cardViewDefaultGet(data).id, 'few');
	assert.equal(cardViewDefaultGet({ viewList: data.viewList }).id, 'all', 'else the first');
	assert.equal(cardViewSwitcherIsShown(data), true);
	assert.equal(cardViewSwitcherIsShown({ ...data, isViewSwitcherHidden: true }), false);
	const source = cardViewSourceOf(data, 'rows');
	const few = cardViewDrawBuild(data.viewList[1], source, []);
	assert.deepEqual(few.fieldList.map((field) => field.id), ['g']);
	assert.deepEqual(few.itemList.map((item) => item.row?.id ?? 'break'), ['b', 'break']);
	assert.equal(few.anchorPrefix, 'row');
	const one = cardViewDrawBuild(data.viewList[2], source, []);
	assert.deepEqual(one.fieldList.map((field) => field.id), ['~column', '~value']);
	assert.deepEqual(one.itemList.map((item) => [item.row['~column'], item.row['~value']]), [['G', '2'], ['F', '1']]);
	assert.equal(one.anchorPrefix, 'column');
	assert.equal(cardViewDrawBuild(data.viewList[3], source, fields).isPlain, true);
	// what does not fit is refused
	const refused = (extra) => () => tableCardNormalize({ fields, rows, ...extra });
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'nope' }] }), /mode must be/);
	assert.throws(refused({ viewList: [{ mode: 'row' }] }), /needs an id/);
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'row' }, { id: 'a', mode: 'row' }] }), /Duplicate view/);
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'row' }], viewDefault: 'b' }), /not a view/);
	assert.throws(refused({ viewDefault: 'b' }), /not a view/);
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'row' }], rowDisplay: ['a'] }), /in each view/);
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'column', rowDisplay: ['a'] }] }), /View "a": rowDisplay names "a"/);
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'row', valueRowId: 'a' }] }), /belongs to a column view/);
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'column', fieldDisplay: ['f'] }] }), /belongs to a row view/);
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'column', valueRowId: 'zz' }] }), /not a record/);
	assert.throws(refused({ viewList: [{ id: 'a', mode: 'row', fieldDisplay: ['zz'] }] }), /not a column/);
	assert.throws(() => tableCardNormalize({ fields, rows: [], viewList: [{ id: 'a', mode: 'row' }] }), /needs the records/);
	// a Dataverse card: its columns are its plain rows, its records are in rows
	const dataverse = dataverseCardNormalize({ columns: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }], rows: [{ id: 'r', x: 1, y: 2 }], viewList: [{ id: 's', mode: 'plain', rowDisplay: ['y'] }, { id: 'r', mode: 'row' }, { id: 'v', mode: 'column', valueRowId: 'r' }] });
	const sourceDataverse = cardViewSourceOf(dataverse, 'columns');
	assert.deepEqual(cardViewDrawBuild(dataverse.viewList[1], sourceDataverse, []).fieldList.map((field) => field.label), ['X', 'Y']);
	assert.deepEqual(cardViewDrawBuild(dataverse.viewList[2], sourceDataverse, []).itemList.map((item) => item.row['~value']), ['1', '2']);
	assert.ok(dataverseAnchorListGet(dataverse).some((anchor) => anchor.id === 'row/r'));
	assert.throws(() => dataverseCardNormalize({ columns: [{ id: 'x' }], viewList: [{ id: 'r', mode: 'row' }] }), /needs the records/);
	// what the views name goes with what they name
	assert.deepEqual(cardViewListPrune(data.viewList, { columnId: 'g' })[1].fieldDisplay, undefined);
	assert.deepEqual(cardViewListPrune(data.viewList, { columnId: 'g' })[2].rowDisplay, ['f']);
	assert.equal(cardViewListPrune(data.viewList, { recordId: 'a' })[2].valueRowId, undefined);
});

test('a row break with rows behind it: every row once, and they count as shown', () => {
	const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
	const list = cardRowDisplayNormalize(['a', { break: 'two', rowList: ['b', 'c'] }, 'd'], rows);
	assert.deepEqual(list, ['a', { break: 'two', rowList: ['b', 'c'] }, 'd']);
	assert.deepEqual(cardRowDisplayNormalize([{ rowList: ['a'], isExpanded: true }], rows), [{ break: '', rowList: ['a'], isExpanded: true }]);
	assert.throws(() => cardRowDisplayNormalize(['a', { rowList: ['a'] }], rows), /names "a" twice/);
	assert.throws(() => cardRowDisplayNormalize([{ rowList: ['z'] }], rows), /not a row/);
	assert.throws(() => cardRowDisplayNormalize([{ rowList: [] }], rows), /must list the rows/);
	assert.throws(() => cardRowDisplayNormalize([{ rowList: ['a'], isExpanded: 'yes' }], rows), /must be a boolean/);
	assert.deepEqual(cardRowDisplayIdListOf(['a', '...', { break: 'x' }, { rowList: ['b', 'c'] }]), ['a', 'b', 'c']);
	const [, item] = cardRowDisplayItemListGet(list, rows);
	assert.deepEqual(item.break.rowList.map((row) => row.id), ['b', 'c']);
	assert.equal(item.break.isExpanded, false, 'closed unless it says otherwise');
	assert.equal(cardRowDisplayItemListGet([{ rowList: ['a'], isExpanded: true }], rows)[0].break.isExpanded, true);
	assert.equal(cardRowDisplayItemListGet(['...'], rows)[0].break.rowList, undefined, 'a plain mark has nothing behind it');
	// a row gone: out of the list, and a break losing its last row stays as a mark
	assert.deepEqual(cardRowDisplayWithout(['a', { break: 't', rowList: ['b', 'c'] }], 'b'), ['a', { break: 't', rowList: ['c'] }]);
	assert.deepEqual(cardRowDisplayWithout([{ break: 't', rowList: ['b'] }], 'b'), [{ break: 't' }]);
	assert.deepEqual(cardRowDisplayWithout([{ break: '', rowList: ['b'] }], 'b'), ['...']);
	assert.deepEqual(cardRowDisplayWithout(['a', 'b'], 'a'), ['b']);
	// generated: the rows left out stand behind their breaks
	assert.deepEqual(cardRowDisplayKeepBuild(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], { isFoldable: true, textOf: (count) => `${count} rows` }), [{ break: '1 rows', rowList: ['a'] }, 'b', { break: '1 rows', rowList: ['c'] }, 'd', { break: '1 rows', rowList: ['e'] }]);
	assert.deepEqual(cardRowDisplayKeepBuild(['a', 'b'], ['b'], { isFoldable: true }), [{ rowList: ['a'] }, 'b']);
});


test('a background around other nodes is the union of their drawn rects, with its padding', () => {
	const diagram = { version: 1, nodes: [
		{ id: 'a', renderer: { type: 'card-note' }, position: { x: 0, y: 100 }, size: { width: 200, height: 'auto' }, data: { title: 'A' }, handles: [] },
		{ id: 'b', renderer: { type: 'card-note' }, position: { x: 300, y: 100 }, size: { width: 200, height: 80 }, data: { title: 'B' }, handles: [] },
		{ id: 'frame', renderer: { type: 'color-block' }, around: { nodeIdList: ['a', 'b'], padding: { top: 40, right: 10, bottom: 10, left: 10 } }, data: { fill: 'none', itemList: [] }, handles: [] },
	], connections: [] };
	const graph = diagramNormalize(diagram, cardDiagramNodeRegistry);
	const places = diagramPlacesGet(graph.nodes, graph.layout, { a: { width: 200, height: 300 } });
	assert.deepEqual(places.positions.get('frame'), { x: -10, y: 60 });
	assert.deepEqual(places.sizeById.get('frame'), { width: 520, height: 350 });
	assert.throws(() => diagramNormalize({ ...diagram, nodes: [...diagram.nodes.slice(0, 2), { ...diagram.nodes[2], around: { nodeIdList: ['c'] } }] }, cardDiagramNodeRegistry), /not a node/);
	assert.throws(() => diagramNormalize({ ...diagram, nodes: [{ ...diagram.nodes[0], around: { nodeIdList: ['b'] } }, ...diagram.nodes.slice(1)] }, cardDiagramNodeRegistry), /only a background/);
});
