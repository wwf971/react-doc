import assert from 'node:assert/strict';
import test from 'node:test';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { dataverseCardNormalize, dataverseAnchorListGet } from '../power-platform/DataverseCardData.js';
import { diagramNormalize, diagramPositionsGet, diagramLegacyConvert, cardStandaloneNormalize } from './DiagramERData.js';
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
	assert.throws(() => diagramNormalize(diagramCreate(), cardDiagramNodeRegistry), /unknown node type "dataverse-table" \(this diagram knows: table, operator\)/);
	assert.deepEqual(cardDiagramNodeRegistry.createEntryList.map(entry => entry.id), ['table', 'operator', 'connection']);
	assert.deepEqual(registry.createEntryList.map(entry => entry.id), ['table', 'operator', 'dataverse-table', 'dataverse-choice', 'power-automate', 'business-rule', 'connection']);
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
	assert.throws(() => diagramNormalize(input, registry), /does not accept/);
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