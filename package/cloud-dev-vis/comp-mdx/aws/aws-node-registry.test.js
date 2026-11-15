import assert from 'node:assert/strict';
import test from 'node:test';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { diagramNormalize, cardStandaloneNormalize } from '../card-diagram/DiagramERData.js';
import { DiagramEditStore } from '../card-diagram/DiagramEditStore.js';
import { cardSchemaGet } from '../card-diagram/TableCardSchema.js';
import { cardDiagramNodeRegistry } from '../card-diagram/card-diagram-node-registry.js';
import { diagramGeometryEstimateBuild } from '../card-diagram/DiagramArrangeOutline.js';
import { routeOverlapListGet, routeResolve } from '../card-diagram/DiagramRoute.js';
import { switchDocNormalize } from '../card-diagram-switch/SwitchData.js';
import { awsNodeKindList, awsNodeRegistry, awsResourceNodeRegistry } from './aws-node-registry.js';
import { awsResourceSourceDefaultCreate, awsSourceDefaultCreate, awsSwitchSourceDefaultCreate } from './AwsSource.js';
import { AWS_ICON_LIST, awsIconUrlRegister } from './AwsIcon.js';

// every kind as the create panel makes it, in one diagram
function sourceCreate() {
	let index = 0;
	const nodes = awsNodeKindList.map((kind) => kind.create.nodeCreate((prefix) => `${prefix}-${index++}`));
	return JSON.stringify({ version: 1, nodes, connections: [] });
}

test('every AWS kind is complete, made valid by the create panel, and only in the AWS registries', () => {
	const graph = diagramNormalize(JSON.parse(sourceCreate()), awsNodeRegistry);
	assert.equal(graph.nodes.length, awsNodeKindList.length);
	for (const kind of awsNodeKindList) {
		assert.ok(kind.contract.anchorListGet && kind.contract.sizeDefault && kind.Card && kind.create, kind.type);
		assert.ok(kind.contract.simple, `${kind.type} has a simple display`);
		assert.equal(cardDiagramNodeRegistry.kindByType[kind.type], undefined);
		const node = graph.nodes.find((item) => item.renderer.type === kind.type);
		// a fresh node is read downward: in on top of the card, out at its bottom
		assert.ok(node.handles.every((handle) => handle.anchor.target === 'body' && (handle.direction === 'in' ? handle.anchor.side === 'top' : handle.anchor.side === 'bottom')), kind.type);
	}
	assert.throws(() => diagramNormalize(JSON.parse(sourceCreate()), cardDiagramNodeRegistry), /unknown node type/);
	// a standalone card is a kind that is a card: the log group is not
	assert.equal(awsResourceNodeRegistry.kindByType['aws-log-group'], undefined);
	assert.equal(cardStandaloneNormalize(yamlParse(awsResourceSourceDefaultCreate().raw), awsResourceNodeRegistry).renderer.type, 'aws-lambda');
});

test('a resource card has its head fields and property rows; a cell typed is one step, undone', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, awsNodeRegistry);
	const schema = cardSchemaGet(store.nodeGet('lambda-1'), awsNodeRegistry);
	assert.deepEqual(schema.headFieldList.map((field) => field.id), ['runtime', 'memory', 'timeout', 'role']);
	assert.deepEqual(schema.fieldList.map((field) => field.id), ['name', 'value']);
	assert.ok(store.fieldSet('lambda-1', null, 'runtime', 'python3.12'));
	assert.equal(store.nodeGet('lambda-1').data.runtime, 'python3.12');
	assert.ok(store.undo());
	assert.equal(store.nodeGet('lambda-1').data.runtime, '');
	assert.equal(store.fieldSet('lambda-1', null, 'runtime', {}), false);
	assert.match(store.message, /must be text/);
});

test('a DynamoDB table and a route group have rows of fixed fields, each an anchor', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, awsNodeRegistry);
	const table = store.nodeGet('table-2');
	const schemaTable = cardSchemaGet(table, awsNodeRegistry);
	assert.deepEqual(schemaTable.fieldList.map((field) => field.id), ['key', 'name', 'type', 'holds']);
	assert.equal(schemaTable.isFieldListEditable, false);
	assert.ok(store.rowInsert('table-2', 2));
	assert.equal(store.nodeGet('table-2').data.attributes.length, 3);
	assert.ok(store.fieldSet('table-2', 'pk', 'key', 'SK'));
	assert.equal(store.fieldSet('table-2', 'pk', 'type', 'X'), false);
	assert.match(store.message, /not one of/);
	const graph = diagramNormalize(JSON.parse(store.rawDraft === store.rawInitial ? sourceCreate() : JSON.stringify(store.value)), awsNodeRegistry);
	assert.ok(graph.nodes.find((node) => node.id === 'table-2').anchors.some((anchor) => anchor.id === 'attribute/pk'));
	const routes = graph.nodes.find((node) => node.renderer.type === 'aws-route-group');
	assert.deepEqual(cardSchemaGet(routes, awsNodeRegistry).fieldList.map((field) => field.id), ['method', 'path', 'auth']);
	assert.equal(routes.data.routes[0].auth, 'token');
	assert.throws(() => diagramNormalize({ version: 1, nodes: [{ id: 'r', renderer: { type: 'aws-route-group' }, data: { name: 'r', routes: [{ id: 'a', method: 'FETCH', path: '/' }] } }] }, awsNodeRegistry), /not one of/);
});

test('a node is drawn simple and back as one step; the whole diagram too, its nodes following', () => {
	const store = new DiagramEditStore(sourceCreate(), 'diagram', undefined, awsNodeRegistry);
	assert.equal(store.nodeDisplayGet('s3-bucket-3'), 'detailed');
	assert.ok(store.nodeDisplaySet('s3-bucket-3', 'simple'));
	assert.equal(store.nodeGet('s3-bucket-3').display, 'simple');
	assert.ok(store.undo());
	assert.equal(store.nodeGet('s3-bucket-3').display, undefined);
	assert.ok(store.diagramDisplaySet('simple'));
	assert.equal(store.value.defaults.node.display, 'simple');
	assert.ok(diagramNormalize(store.value, awsNodeRegistry).nodes.every((node) => node.display === 'simple'));
	// one card among simple marks: it says so, the others follow the diagram
	assert.ok(store.nodeDisplaySet('s3-bucket-3', 'detailed'));
	assert.equal(store.nodeGet('s3-bucket-3').display, 'detailed');
	assert.ok(store.diagramDisplaySet('detailed'));
	assert.equal(store.value.defaults, undefined);
	assert.equal(store.nodeGet('s3-bucket-3').display, undefined);
	// a kind without one cannot be drawn simple
	const generic = new DiagramEditStore(JSON.stringify({ version: 1, nodes: [{ id: 'n', renderer: { type: 'card-note' }, data: { title: 'n' } }] }), 'diagram', undefined, awsNodeRegistry);
	assert.equal(generic.nodeDisplaySet('n', 'simple'), false);
});

test('the starting texts are valid, laid out by the layer arranger, with no line on another', () => {
	const diagram = yamlParse(awsSourceDefaultCreate().raw);
	const graph = diagramNormalize(diagram, awsNodeRegistry);
	assert.ok(graph.nodes.every((node) => node.position !== 'auto'));
	const geometry = diagramGeometryEstimateBuild(diagram, { registry: awsNodeRegistry });
	const lineList = diagram.connections.map((connection) => {
		const a = geometry.endOf(connection, 'source');
		const b = geometry.endOf(connection, 'target');
		return { id: connection.id, d: routeResolve('step', connection.route ?? null, { sourceX: a.x, sourceY: a.y, sourcePosition: a.side, targetX: b.x, targetY: b.y, targetPosition: b.side }).d, sourceKey: `${connection.source.nodeId}/${connection.source.handleId}`, targetKey: `${connection.target.nodeId}/${connection.target.handleId}` };
	});
	assert.deepEqual(routeOverlapListGet(lineList), []);
	const scene = switchDocNormalize(awsSwitchSourceDefaultCreate().raw).sceneByPath.get('/system');
	const [overview, resources] = scene.viewList;
	assert.deepEqual(overview.diagram.nodes.map((node) => node.id), resources.diagram.nodes.map((node) => node.id));
	assert.ok(diagramNormalize(overview.diagram, awsNodeRegistry).nodes.filter((node) => node.renderer.type.startsWith('aws-')).every((node) => node.display === 'simple'));
	// simple marks stand closer than cards
	const height = (diagramValue) => Math.max(...diagramValue.nodes.map((node) => node.position.y));
	assert.ok(height(overview.diagram) < height(resources.diagram));
});

// the official icons (AwsIcon.js): every kind has its file named, and a kind is drawn with what
// was fetched, a glyph inside its tile. last in this file: what is registered stays registered
test('every AWS kind names its official icon, and is drawn with it once it is fetched', () => {
	const typeList = awsNodeKindList.map((kind) => kind.type);
	assert.deepEqual([...AWS_ICON_LIST.map((item) => item.type)].sort(), [...typeList].sort());
	const contentOf = (type) => awsNodeRegistry.kindByType[type].contract.simple.contentGet({ name: 'a' });
	assert.equal(contentOf('aws-lambda').iconUrl, undefined);
	awsIconUrlRegister({ './icon-official/aws-lambda.svg': '/lambda.svg', './icon-official/aws-iam-role.svg': '/role.svg', './icon-official/not-a-kind.svg': '/x.svg' });
	assert.deepEqual([contentOf('aws-lambda').iconUrl, contentOf('aws-lambda').isIconFramed], ['/lambda.svg', false]);
	assert.deepEqual([contentOf('aws-iam-role').iconUrl, contentOf('aws-iam-role').isIconFramed], ['/role.svg', true]);
	assert.equal(contentOf('aws-s3-bucket').iconUrl, undefined);
});
