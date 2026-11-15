import { yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { diagramArrangeApply } from '../card-diagram/DiagramArrange.js';
import { diagramArrangerLayers } from '../card-diagram/DiagramArrangeLayers.js';
import { awsHandleOf } from './AwsCardData.js';
import { awsNodeRegistry } from './aws-node-registry.js';

// The starting text of the blocks of the AWS series (doc/aws.md): a small system read downward,
// laid out by the layer arranger when the block is made, so its first layout is the arranger's
// and the author edits it from there.
function systemBuild() {
	const nodes = [
		{ id: 'page', renderer: { type: 'card-note' }, size: { width: 200, height: 'auto' }, data: { title: 'The page', text: 'a browser', tone: 'slate' }, handles: [awsHandleOf('out', 'out')] },
		{ id: 'api', renderer: { type: 'aws-http-api' }, size: { width: 300, height: 'auto' }, data: { name: '{prefix}--api', authorizer: 'jwt: the user pool', cors: 'any origin', throttle: '20 / s', properties: [{ id: 'items', name: 'items', value: 'create, get, update' }] }, handles: [awsHandleOf('in', 'in'), awsHandleOf('out', 'out')] },
		{ id: 'function', renderer: { type: 'aws-lambda' }, size: { width: 300, height: 'auto' }, data: { name: '{prefix}--api', runtime: 'python3.12', memory: '512 MB', timeout: '29 s', role: '{prefix}--api-role', properties: [{ id: 'table', name: 'TABLE_DATA', value: 'the table' }] }, handles: [awsHandleOf('in', 'in'), awsHandleOf('rows', 'out'), awsHandleOf('objects', 'out')] },
		{ id: 'table', renderer: { type: 'aws-dynamodb-table' }, size: { width: 300, height: 'auto' }, data: { name: 'items', nameLogical: '{prefix}--data', pk: 'pk (S)', sk: 'sk (S)', description: 'billed per request', attributes: [{ id: 'pk', key: 'PK', name: 'pk', type: 'S', holds: 'the owner' }, { id: 'sk', key: 'SK', name: 'sk', type: 'S', holds: 'the item' }] }, handles: [awsHandleOf('in', 'in')] },
		{ id: 'bucket', renderer: { type: 'aws-s3-bucket' }, size: { width: 300, height: 'auto' }, data: { name: '{prefix}--data', access: 'private', versioning: 'off', properties: [{ id: 'data', name: 'data/', value: 'large bytes' }] }, handles: [awsHandleOf('in', 'in')] },
	];
	const lineOf = (id, source, target, text) => ({ id, source: { nodeId: source[0], handleId: source[1] }, target: { nodeId: target[0], handleId: target[1] }, label: { text } });
	const connections = [lineOf('request', ['page', 'out'], ['api', 'in'], 'https + token'), lineOf('call', ['api', 'out'], ['function', 'in'], 'invoke'), lineOf('rows', ['function', 'rows'], ['table', 'in'], 'rows'), lineOf('objects', ['function', 'objects'], ['bucket', 'in'], 'objects')];
	return { nodes, connections };
}

const arranged = (diagram) => diagramArrangeApply({ version: 1, ...diagram }, diagramArrangerLayers, { registry: awsNodeRegistry }).diagram;

export function awsSourceDefaultCreate() {
	return { lang: 'yaml', raw: yamlStringify({ ...arranged(systemBuild()), viewport: { size: { height: 720 } } }) };
}

// two views of one system: an overview, every node drawn simple, and the resources as cards. the
// same ids in both, so switching moves each card into its mark
export function awsSwitchSourceDefaultCreate() {
	const system = systemBuild();
	// the marks without the widths of the cards: as wide as a mark and its words
	const overview = arranged({ ...system, nodes: system.nodes.map(({ size: _size, ...node }) => node), defaults: { node: { display: 'simple' } } });
	const resources = arranged(system);
	// the two views share the objects of their lines: written out in each, without yaml aliases
	return { lang: 'yaml', raw: yamlStringify({ version: 1, height: 620, sceneList: [{
		path: '/system', label: 'System', title: 'A small system on AWS',
		viewList: [{ id: 'overview', label: 'Overview', diagram: overview }, { id: 'resources', label: 'Resources', diagram: resources }],
		viewDefault: 'overview',
	}] }, { aliasDuplicateObjects: false }) };
}

export function awsResourceSourceDefaultCreate() {
	const node = systemBuild().nodes.find((item) => item.id === 'function');
	return { lang: 'yaml', raw: yamlStringify({ version: 1, node: { ...node, handles: [] } }) };
}

// a system of several groups, written as a description (AwsArchitecture.js): the starting text of
// DiagramAwsArchitecture, and the larger example of its author document
export function awsArchitectureExampleBuild() {
	const card = (id, kind, name, data = {}, extra = {}) => ({ id, kind, name, data, ...extra });
	return {
		version: 1,
		title: 'A small shop on AWS',
		clientList: [
			{ id: 'browser', title: 'The shop page', text: 'a browser', tone: 'slate' },
			{ id: 'staff', title: 'The staff console', text: 'a browser, signed in as staff', tone: 'slate' },
		],
		groupList: [
			{
				id: 'catalog', label: 'Catalog', project: 'catalog/', tone: 'blue', icon: 'table',
				resourceList: [
					card('api', 'aws-http-api', '{prefix}--catalog-api', { authorizer: 'none for reading', cors: 'any origin', throttle: '100 / s' }, { detail: { routeGroupList: [
						{ id: 'read', name: 'Reading', routes: [{ method: 'GET', path: '/product/list', auth: 'none' }, { method: 'GET', path: '/product/get', auth: 'none' }] },
						{ id: 'write', name: 'Writing', routes: [{ method: 'POST', path: '/product/set' }, { method: 'POST', path: '/product/remove' }] },
					] } }),
					card('function', 'aws-lambda', '{prefix}--catalog', { runtime: 'python3.12', memory: '256 MB', timeout: '10 s' }),
					card('table', 'aws-dynamodb-table', 'products', { nameLogical: '{prefix}--catalog', pk: 'p#{productId}', sk: 'product', attributes: [{ id: 'price', name: 'price', type: 'N', holds: 'in cents' }] }),
					card('images', 'aws-s3-bucket', '{prefix}--images', { access: 'public read', versioning: 'off' }),
				],
				relationList: [
					{ from: 'browser', to: 'api', label: 'products' },
					{ from: 'staff', to: 'api', label: 'edit products' },
					{ from: 'api', to: 'function' },
					{ from: 'function', to: 'table', label: 'rows' },
					{ from: 'browser', to: 'images', label: 'images' },
				],
			},
			{
				id: 'orders', label: 'Orders', project: 'orders/', tone: 'amber', icon: 'list-checks',
				resourceList: [
					card('api', 'aws-http-api', '{prefix}--order-api', { authorizer: 'jwt: the user pool', cors: 'any origin', throttle: '20 / s' }),
					card('function', 'aws-lambda', '{prefix}--order', { runtime: 'python3.12', memory: '512 MB', timeout: '29 s', role: '{prefix}--order-role' }),
					card('table', 'aws-dynamodb-table', 'orders', { nameLogical: '{prefix}--order', pk: 'u#{userId}', sk: 'o#{orderId}', attributes: [{ id: 'status', name: 'status', type: 'S', holds: 'placed, paid, sent' }] }, { detail: {
						rowKindList: [
							{ id: 'order', name: 'order', pk: 'u#{userId}', sk: 'o#{orderId}', column: 0, attributes: [{ name: 'orderId', type: 'S', holds: 'its id' }, { name: 'status', type: 'S', holds: 'placed, paid, sent' }] },
							{ id: 'line', name: 'line', pk: 'o#{orderId}', sk: 'l#{productId}', column: 1, attributes: [{ name: 'productId', type: 'S', holds: 'a product of the catalog' }, { name: 'count', type: 'N' }] },
						],
						linkList: [{ from: 'order.orderId', to: 'line', label: 'o#{orderId}' }],
					} }),
					card('logs', 'aws-log-group', '/aws/lambda/{prefix}--order', { retention: '30 days' }),
				],
				relationList: [
					{ from: 'browser', to: 'api', label: 'place an order' },
					{ from: 'api', to: 'auth.pool', label: 'checks the token' },
					{ from: 'api', to: 'function' },
					{ from: 'function', to: 'table', label: 'rows' },
					{ from: 'function', to: 'catalog.table', label: 'prices' },
					{ from: 'function', to: 'logs' },
				],
				flowList: [{
					id: 'place', label: 'Placing an order', stepList: [
						{ from: 'browser', to: 'api', label: 'POST /order/place' },
						{ from: 'api', to: 'auth.pool', label: 'the token' },
						{ from: 'api', to: 'function', label: 'the request' },
						{ from: 'function', to: 'catalog.table', label: 'the prices' },
						{ from: 'function', to: 'table', label: 'the order and its lines' },
					],
					note: { title: 'One write', text: 'the order and its lines in one transaction' },
				}],
			},
			{
				id: 'auth', label: 'Sign-in', project: 'auth/', tone: 'red', icon: 'shield',
				resourceList: [
					card('pool', 'aws-cognito-user-pool', '{prefix}--users', { mfa: 'optional: TOTP' }),
					card('staff-group', 'aws-iam-role', '{prefix}--staff', { assumedBy: 'the staff group of the pool' }),
				],
				relationList: [
					{ from: 'browser', to: 'pool', label: 'sign in' },
					{ from: 'staff', to: 'pool', label: 'sign in' },
					{ from: 'pool', to: 'staff-group', label: 'staff' },
				],
			},
		],
	};
}

export function awsArchitectureSourceDefaultCreate() {
	return { lang: 'yaml', raw: yamlStringify(awsArchitectureExampleBuild()) };
}
