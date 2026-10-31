import { yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';

export function powerAutomateSourceDefaultCreate() {
	const nodes = [
		{ id: 'trigger', data: { name: 'Account updated', kind: 'trigger', connector: 'Microsoft Dataverse', operation: 'When a row is added, modified or deleted', properties: [{ id: 'table', name: 'Table', value: 'account' }, { id: 'filter', name: 'Filter columns', value: 'creditlimit' }] } },
		{ id: 'condition', data: { name: 'Approval required?', kind: 'condition', expression: "@greater(triggerOutputs()?['body/creditlimit'], 10000)", properties: [] } },
		{ id: 'approval', data: { name: 'Request approval', kind: 'action', connector: 'Approvals', operation: 'Start and wait for an approval', properties: [{ id: 'type', name: 'Approval type', value: 'Approve/Reject - First to respond' }, { id: 'owner', name: 'Assigned to', value: 'Environment variable: approver' }] } },
		{ id: 'finish', data: { name: 'No approval needed', kind: 'terminate', operation: 'Terminate', properties: [{ id: 'status', name: 'Status', value: 'Succeeded' }] } },
	].map(node => ({ ...node, renderer: { type: 'power-automate' }, handles: [
		{ id: 'in', direction: 'in', anchor: { target: 'header', side: 'left' } },
		{ id: 'out', direction: 'out', anchor: { target: 'header', side: 'right' } },
	] }));
	const connection = (id, source, target, label) => ({ id, source: { nodeId: source, handleId: 'out' }, target: { nodeId: target, handleId: 'in' }, label: { text: label } });
	return { lang: 'yaml', raw: yamlStringify({ version: 1, viewport: { size: { height: 740 } }, nodes, connections: [connection('start', 'trigger', 'condition', 'Succeeded'), connection('yes', 'condition', 'approval', 'Yes'), connection('no', 'condition', 'finish', 'No')] }) };
}