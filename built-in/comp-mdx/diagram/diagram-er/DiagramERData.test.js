import assert from 'node:assert/strict';
import test from 'node:test';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { dataverseCardNormalize, dataverseAnchorListGet } from './DataverseCardData.js';
import { diagramNormalize, diagramPositionsGet, diagramLegacyConvert, dataverseStandaloneNormalize } from './DiagramERData.js';
import { diagramDependenciesCollect, diagramSourceDefaultCreate, dataverseSourceDefaultCreate } from './DiagramERSource.js';

const nodeCreate = (id, position = 'auto') => ({ id, renderer: { type: 'dataverse-table' }, position, data: { name: id, columns: [{ id: 'value', name: 'Value' }] }, handles: [{ id: 'port', direction: 'both', anchor: { target: 'column/value', side: 'right' } }] });
const diagramCreate = () => ({ version: 1, nodes: [nodeCreate('source', { x: 0, y: 0 }), nodeCreate('target')], connections: [{ id: 'link', source: { nodeId: 'source', handleId: 'port' }, target: { nodeId: 'target', handleId: 'port' } }] });

test('renderer contracts stay immutable and obsolete viewport fields fail explicitly', () => {
	const input = { version: 1, nodes: [{ id: 'custom', renderer: { component: 'Custom' } }] };
	const contract = { anchorListGet: () => Object.freeze([{ id: 'port', sideList: ['left'] }]) };
	assert.equal(diagramNormalize(input, () => contract).nodes[0].anchors.length, 2);
	assert.throws(() => diagramNormalize(input, () => ({ ...contract, dataNormalize: () => null })), /data must be a mapping/);
	assert.throws(() => diagramNormalize({ ...input, nodes: [], zoomRange: {} }), /viewport.zoom/);
	assert.throws(() => diagramNormalize({ ...input, nodes: [], viewport: { x: 20, y: 30, zoom: 1 } }), /viewport.view/);
});

test('custom edge data defaults are shared by runtime and dependency collection', () => {
	const input = diagramCreate();
	input.defaults = { connection: { data: { target: 'default.md' } } };
	assert.deepEqual(diagramNormalize(input).connections[0].data, { target: 'default.md' });
	const collected = [];
	input.defaults.connection.renderer = { component: 'Edge' };
	diagramDependenciesCollect(input, { componentCollect: (...args) => collected.push(args), warn: message => assert.fail(message) });
	assert.deepEqual(collected, [['Edge', { target: 'default.md' }]]);
});
test('insertion templates use the shared graph and fixed-node schemas', () => {
	assert.equal(diagramNormalize(yamlParse(diagramSourceDefaultCreate().raw)).connections.length, 1);
	assert.equal(dataverseStandaloneNormalize(yamlParse(dataverseSourceDefaultCreate().raw)).renderer.type, 'dataverse-table');
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
	const graph = diagramNormalize(input);
	assert.equal(graph.connections[0].style.strokeWidth, 3);
	assert.equal(graph.connections[0].style.stroke, 'green');
	assert.equal(graph.connections[0].renderer.type, 'step');
	input.nodes[0].handles[0].anchor.side = 'left';
	assert.equal(diagramNormalize(input).connections[0].source.handleId, 'port');
	input.connections[0].target.handleId = 'missing';
	assert.throws(() => diagramNormalize(input), /missing or incompatible/);
});

test('automatic layout respects explicit rectangles and measured sizes', () => {
	const graph = diagramNormalize(diagramCreate());
	const positions = diagramPositionsGet(graph.nodes, graph.layout, { source: { width: 800, height: 900 } });
	assert.deepEqual(positions.get('source'), { x: 0, y: 0 });
	assert.ok(positions.get('target').y >= 900);
	assert.throws(() => diagramNormalize({ version: 1, nodes: [nodeCreate('bad', { x: 1 })] }), /finite/);
});

test('viewport groups canvas size, camera range, zoom and minimap', () => {
	const input = diagramCreate();
	input.viewport = { size: { width: 900, height: 500 }, view: { x: -10, y: 20, zoom: 0.8 }, range: { x: [-100, 100], y: [-100, 100] }, zoom: { min: 0.2, max: 2 }, isMiniMapVisible: true };
	assert.equal(diagramNormalize(input).viewport.isMiniMapVisible, true);
	input.viewport.view.zoom = 3;
	assert.throws(() => diagramNormalize(input), /exceeds/);
});

test('registry renderers require a declared anchor contract and preserve custom content', () => {
	const input = { version: 1, nodes: [{ id: 'operator', renderer: { component: 'etl/Trim' }, data: { operation: 'trim' } }] };
	assert.throws(() => diagramNormalize(input), /must expose/);
	const graph = diagramNormalize(input, (name, placement) => {
		assert.equal(name, 'etl/Trim');
		assert.equal(placement, 'visualizationNode');
		return { anchorListGet: () => [{ id: 'body', sideList: ['left', 'right'] }] };
	});
	assert.equal(graph.nodes[0].data.operation, 'trim');
});

test('legacy conversion retains coordinates, choice identity, and shared handles', () => {
	const legacy = { tables: [{ id: 'first', columns: [{ id: 'value' }] }, { id: 'choice', kind: 'choice', position: { x: 800, y: 40 }, columns: [{ id: 'value' }] }], relationships: ['one', 'two'].map(id => ({ id, source: { tableId: 'first', columnId: 'value' }, target: { tableId: 'choice', columnId: 'value' } })) };
	const converted = diagramLegacyConvert(legacy, 760);
	const graph = diagramNormalize(converted);
	assert.equal(graph.nodes[1].renderer.type, 'dataverse-choice');
	assert.equal(graph.nodes[1].handles.length, 1);
	assert.deepEqual(graph.nodes[1].position, { x: 800, y: 40 });
	assert.equal(graph.viewport.size.height, 760);
});

test('standalone card uses the same node and Dataverse data contract', () => {
	const node = nodeCreate('single');
	node.handles = [];
	assert.deepEqual(dataverseStandaloneNormalize({ version: 1, node }), diagramNormalize({ version: 1, nodes: [node] }).nodes[0]);
	assert.throws(() => dataverseStandaloneNormalize({ version: 1, node: { ...node, renderer: { type: 'operator' } } }), /dataverse-table/);
});

test('manual routes are explicit and reject incompatible line types', () => {
	const input = diagramCreate();
	input.connections[0].route = { waypoints: [{ x: 100, y: 200 }] };
	assert.throws(() => diagramNormalize(input), /does not accept/);
	input.connections[0].renderer = { type: 'polyline' };
	assert.equal(diagramNormalize(input).connections[0].route.waypoints.length, 1);
	input.connections[0].route.waypoints[0].x = Infinity;
	assert.throws(() => diagramNormalize(input), /finite/);
});

test('existing choice row handles resolve to the header without mutating authored endpoints', () => {
	const input = diagramLegacyConvert({ tables: [{ id: 'source', columns: [{ id: 'value' }] }, { id: 'choice', kind: 'choice', columns: [{ id: 'value' }] }], relationships: [{ id: 'link', source: { tableId: 'source', columnId: 'value' }, target: { tableId: 'choice', columnId: 'value' } }] });
	input.nodes[1].handles[0].anchor = { target: 'column/value', side: 'right', offset: 0.8 };
	const graph = diagramNormalize(input);
	assert.deepEqual(graph.nodes[1].handles[0].anchor, { target: 'header', side: 'left', offset: 0.5 });
	assert.equal(graph.connections[0].target.handleId, input.connections[0].target.handleId);
	assert.equal(input.nodes[1].handles[0].anchor.target, 'column/value');
});