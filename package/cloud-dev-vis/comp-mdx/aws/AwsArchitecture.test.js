import assert from 'node:assert/strict';
import test from 'node:test';
import { diagramNormalize, endpointKeyOf } from '../card-diagram/DiagramERData.js';
import { diagramGeometryEstimateBuild } from '../card-diagram/DiagramArrangeOutline.js';
import { routeOverlapListGet, routeResolve } from '../card-diagram/DiagramRoute.js';
import { switchRegistryBuild } from '../card-diagram-switch/SwitchNodeKinds.jsx';
import { awsNodeRegistry } from './aws-node-registry.js';
import { awsArchitectureNormalize, awsArchitectureProviderBuild } from './AwsArchitecture.js';
import { awsArchitectureExampleBuild } from './AwsSource.js';

const registry = switchRegistryBuild(awsNodeRegistry);

// the lines of a diagram as the estimate places their ends, with sharp corners
function overlapListOf(diagram) {
	const geometry = diagramGeometryEstimateBuild(diagram, { registry });
	const keyOf = (endpoint) => endpointKeyOf(endpoint);
	return routeOverlapListGet(diagram.connections.map((connection) => {
		const a = geometry.endOf(connection, 'source');
		const b = geometry.endOf(connection, 'target');
		return { id: connection.id, d: routeResolve('step', connection.route ?? null, { sourceX: a.x, sourceY: a.y, sourcePosition: a.side, targetX: b.x, targetY: b.y, targetPosition: b.side }).d, sourceKey: keyOf(connection.source), targetKey: keyOf(connection.target) };
	}));
}

test('an architecture: every scene and view drawn from the description is a valid diagram', () => {
	const model = awsArchitectureNormalize(awsArchitectureExampleBuild());
	const provider = awsArchitectureProviderBuild(model, registry);
	assert.deepEqual(provider.childListGet('/system').map((child) => child.path), ['/system/catalog', '/system/orders', '/system/auth']);
	const root = provider.sceneGet('/system');
	const graph = diagramNormalize({ version: 1, ...root.diagram }, registry);
	// the groups as frames showing their scene, the clients beside them, lines between them
	assert.deepEqual(graph.nodes.filter((node) => node.renderer.type === 'scene-embed').map((node) => node.data.scene), ['/system/catalog', '/system/orders', '/system/auth']);
	assert.ok(graph.connections.some((line) => line.source.nodeId === 'group.orders' && line.target.nodeId === 'group.auth'));
	assert.ok(graph.connections.some((line) => line.source.nodeId === 'browser' && line.target.nodeId === 'group.catalog'));
	const orders = provider.sceneGet('/system/orders');
	assert.deepEqual(orders.viewList.map((view) => view.id), ['resources', 'overview', 'frame', 'place']);
	for (const view of orders.viewList) diagramNormalize({ version: 1, ...view.diagram }, registry);
	// the same ids in every view of a group, so switching moves each card into its mark
	const idsOf = (view) => view.diagram.nodes.map((node) => node.id).filter((id) => !id.startsWith('note.')).sort();
	assert.deepEqual(idsOf(orders.viewList[0]), idsOf(orders.viewList[1]));
	assert.ok(idsOf(orders.viewList[0]).every((id) => idsOf(orders.viewList[3]).includes(id)));
	// the frame of the group: its own resources alone
	assert.ok(orders.viewList[2].diagram.nodes.every((node) => node.id.startsWith('orders.')));
	// at a glance, every resource is its mark (aws-mark), standing for the kind of its card
	const resourceNodeListOf = (view) => view.diagram.nodes.filter((node) => model.resourceByKey.has(node.id));
	assert.ok(resourceNodeListOf(orders.viewList[1]).every((node) => node.renderer.type === 'aws-mark' && node.data.resourceType === model.resourceByKey.get(node.id).kind));
	assert.ok(resourceNodeListOf(orders.viewList[2]).every((node) => node.renderer.type === 'aws-mark'));
	// what another group holds stands at the edge, as its mark, opening its group
	const external = orders.viewList[0].diagram.nodes.find((node) => node.id === 'auth.pool');
	assert.deepEqual([external.renderer.type, external.data.resourceType], ['aws-mark', model.resourceByKey.get('auth.pool').kind]);
	assert.equal(external.link, '/system/auth');
	assert.notEqual(orders.viewList[0].diagram.nodes.find((node) => node.id === 'orders.api').renderer.type, 'aws-mark');
	// the flow keeps the cards where they stand and draws its steps
	assert.deepEqual(orders.viewList[3].diagram.nodes.find((node) => node.id === 'orders.api').position, orders.viewList[0].diagram.nodes.find((node) => node.id === 'orders.api').position);
	assert.equal(orders.viewList[3].diagram.connections[0].label.text, '1 POST /order/place');
	// the detail of a resource
	assert.equal(provider.childListGet('/system/catalog')[0].path, '/system/catalog/api');
	const routes = provider.sceneGet('/system/catalog/api');
	assert.equal(diagramNormalize({ version: 1, ...routes.diagram }, registry).nodes.length, 2);
	const rows = provider.sceneGet('/system/orders/table');
	assert.equal(diagramNormalize({ version: 1, ...rows.diagram }, registry).connections.length, 1);
	assert.equal(provider.sceneGet('/system/catalog/function'), null);
	assert.equal(provider.labelGet('/system/orders'), 'Orders');
});

test('an architecture: no line on another in the scenes it lays out', () => {
	const model = awsArchitectureNormalize(awsArchitectureExampleBuild());
	const provider = awsArchitectureProviderBuild(model, registry);
	for (const group of model.groupList) {
		for (const view of provider.sceneGet(`/system/${group.id}`).viewList) assert.deepEqual(overlapListOf(view.diagram), [], `${group.id}@${view.id}`);
	}
	assert.deepEqual(overlapListOf(provider.sceneGet('/system').diagram), []);
});

test('an architecture says what is wrong with it, naming the place', () => {
	const example = awsArchitectureExampleBuild();
	assert.throws(() => awsArchitectureNormalize({ ...example, version: 2 }), /version: 1/);
	const broken = structuredClone(example);
	broken.groupList[1].relationList.push({ from: 'api', to: 'auth.nothing' });
	assert.throws(() => awsArchitectureNormalize(broken), /orders.relationList\[6\].to names auth.nothing/);
	const twice = structuredClone(example);
	twice.groupList.push({ id: 'auth', resourceList: [] });
	assert.throws(() => awsArchitectureNormalize(twice), /The group auth is written twice/);
});
