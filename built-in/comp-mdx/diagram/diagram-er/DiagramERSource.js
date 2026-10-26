import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';

function nodeExample(id, name) {
	return {
		id, renderer: { type: 'dataverse-table' }, data: {
			name, nameLogical: id,
			columns: [{ id: 'id', name: 'ID', type: 'uuid', key: 'PK' }, { id: 'name', name: 'Name', type: 'text' }],
		},
	};
}

export function diagramSourceDefaultCreate() {
	const customer = nodeExample('customer', 'Customer');
	const order = nodeExample('order', 'Order');
	customer.handles = [{ id: 'id-out', direction: 'out', anchor: { target: 'column/id', side: 'right' } }];
	order.data.columns.push({ id: 'customerId', name: 'Customer', type: 'uuid', key: 'FK' });
	order.handles = [{ id: 'customer-in', direction: 'in', anchor: { target: 'column/customerId', side: 'left' } }];
	return { lang: 'yaml', raw: yamlStringify({ version: 1, viewport: { size: { height: 620 } }, nodes: [customer, order], connections: [{ id: 'orderCustomer', source: { nodeId: 'customer', handleId: 'id-out' }, target: { nodeId: 'order', handleId: 'customer-in' }, label: { text: 'places' } }] }) };
}

export function dataverseSourceDefaultCreate() {
	return { lang: 'yaml', raw: yamlStringify({ version: 1, node: nodeExample('example', 'Example') }) };
}

export function diagramDependenciesCollect(data, context) {
	try {
		const graph = data.source || data.raw ? yamlParse(data.source || data.raw) : data;
		for (const node of graph.nodes ?? []) {
			if (node.renderer?.component) context.componentCollect(node.renderer.component, node.data ?? {});
		}
		for (const connection of graph.connections ?? []) {
			const renderer = connection.renderer ?? graph.defaults?.connection?.renderer;
			if (renderer?.component) context.componentCollect(renderer.component, connection.data ?? graph.defaults?.connection?.data ?? {});
		}
	} catch (error) {
		context.warn(`Diagram dependencies could not be collected: ${error.message}`);
	}
}