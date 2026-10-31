import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';

// the starting text of a new CardDiagram block: two generic tables and an
// operator between them, joined by connections from row handles
export function cardDiagramSourceDefaultCreate() {
	const tableCreate = (id, name, rows, side) => ({
		id, renderer: { type: 'table' },
		data: { name, fields: [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }], rows },
		handles: [{ id: `${rows[0].id}-${side === 'right' ? 'out' : 'in'}`, direction: side === 'right' ? 'out' : 'in', anchor: { target: `row/${rows[0].id}`, side } }],
	});
	const source = tableCreate('source', 'Source', [{ id: 'email', name: 'Email', value: 'text' }, { id: 'phone', name: 'Phone', value: 'text' }], 'right');
	const target = tableCreate('target', 'Target', [{ id: 'email', name: 'Email', value: 'text, lower case' }], 'left');
	const step = { id: 'normalize', renderer: { type: 'operator' }, data: { label: 'Normalize', description: 'Trim and lower-case' }, handles: [
		{ id: 'in', direction: 'in', anchor: { side: 'left' } },
		{ id: 'out', direction: 'out', anchor: { side: 'right' } },
	] };
	return { lang: 'yaml', raw: yamlStringify({ version: 1, viewport: { size: { height: 480 } }, nodes: [source, step, target], connections: [
		{ id: 'source-normalize', source: { nodeId: 'source', handleId: 'email-out' }, target: { nodeId: 'normalize', handleId: 'in' } },
		{ id: 'normalize-target', source: { nodeId: 'normalize', handleId: 'out' }, target: { nodeId: 'target', handleId: 'email-in' } },
	] }) };
}

// the build-time dependencies of a diagram (dependencyCollect of the
// manifest, doc_page_impl_mdx_comp.md#components-of-a-doc-page): the data of
// the registered components drawing its nodes and lines
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