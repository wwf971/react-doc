import { yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';

export function businessRuleSourceDefaultCreate() {
	const nodes = [
		{ id: 'condition', data: { name: 'Company account?', kind: 'condition', expression: 'customertypecode = 1' } },
		{ id: 'required', data: { name: 'Require telephone', kind: 'action', action: 'setRequired', properties: [{ id: 'column', name: 'Column', value: 'telephone1' }, { id: 'required', name: 'Required', value: 'Business Required' }] } },
		{ id: 'optional', data: { name: 'Telephone optional', kind: 'action', action: 'setRequired', properties: [{ id: 'column', name: 'Column', value: 'telephone1' }, { id: 'required', name: 'Required', value: 'Not Business Required' }] } },
	].map(node => ({ ...node, renderer: { type: 'business-rule' }, data: { table: 'account', scope: 'All Forms', properties: [], ...node.data }, handles: [
		{ id: 'in', direction: 'in', anchor: { target: 'header', side: 'left' } },
		{ id: 'out', direction: 'out', anchor: { target: 'header', side: 'right' } },
	] }));
	return { lang: 'yaml', raw: yamlStringify({ version: 1, viewport: { size: { height: 740 } }, nodes, connections: ['required', 'optional'].map((id, index) => ({ id, source: { nodeId: 'condition', handleId: 'out' }, target: { nodeId: id, handleId: 'in' }, label: { text: index === 0 ? 'True' : 'False' } })) }) };
}