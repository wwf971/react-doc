import { yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { diagramDependenciesCollect } from '../card-diagram/DiagramERSource.js';

// the starting text of a new block: two cards and a line that is drawn
export function animationSourceDefaultCreate() {
	return { lang: 'yaml', raw: yamlStringify({
		version: 1,
		diagram: {
			nodes: [
				{ id: 'a', renderer: { type: 'operator' }, position: { x: 0, y: 0 }, data: { label: 'From' }, handles: [{ id: 'out', direction: 'out', anchor: { side: 'right' } }] },
				{ id: 'b', renderer: { type: 'operator' }, position: { x: 320, y: 0 }, data: { label: 'To' }, handles: [{ id: 'in', direction: 'in', anchor: { side: 'left' } }] },
			],
			connections: [{ id: 'a-b', source: { nodeId: 'a', handleId: 'out' }, target: { nodeId: 'b', handleId: 'in' } }],
		},
		stateList: [
			{ id: 'start', name: 'Start', description: 'Only the first card.', hide: ['b', 'connection/a-b'] },
			{ id: 'end', name: 'End', description: 'The line is drawn, the second card appears.', show: ['b', 'connection/a-b'] },
		],
	}) };
}

// the build-time dependencies (doc_page_impl_mdx_comp.md#components-of-a-doc-page):
// those of its diagram
export function animationDependenciesCollect(data, context) {
	try {
		const document = data.source || data.raw ? yamlParse(data.source || data.raw) : data;
		const nodeList = (document.diagram?.nodes ?? []).map((node) => (node.use ? { ...document.nodeDefineById?.[node.use], ...node } : node));
		diagramDependenciesCollect({ ...document.diagram, nodes: nodeList }, context);
	} catch (error) {
		context.warn(`Animation dependencies could not be collected: ${error.message}`);
	}
}
