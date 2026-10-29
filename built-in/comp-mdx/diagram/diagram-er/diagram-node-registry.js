import { Boxes, GitBranch, ListChecks, Table2, TableProperties, Waypoints, Workflow } from '../../../../main/frontend/UICommon.js';
import { powerAutomateNodeFields } from './PowerAutomateNodeData.js';
import { businessRuleNodeFields } from './BusinessRuleNodeData.js';

// What the create panel of a diagram offers (DiagramCreatePanel.jsx): the
// node cards that can be added, and a connection. A fixed list for now; a
// registered component with the visualizationNode placement is still added
// through the source. `create(idNext)` returns the authored node (without its
// position), `idNext(prefix)` gives an id unused in the diagram.
function resourceCreate(type, fields, name) {
	return (idNext) => {
		const data = Object.fromEntries(fields.map(field => [field.id, field.defaultValue ?? '']));
		data.name = name;
		data.properties = [];
		return { id: idNext(type), renderer: { type }, data, handles: [
			{ id: 'in', direction: 'in', anchor: { target: 'header', side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { target: 'header', side: 'right' } },
		] };
	};
}

export const diagramNodeRegistry = [
	{ id: 'table', label: 'Table', description: 'A titled card with rows and columns of your own.', icon: Table2, keywordList: ['generic', 'grid', 'rows'],
		create: idNext => ({ id: idNext('table'), renderer: { type: 'table' }, data: { name: 'Table', fields: [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }], rows: [{ id: 'row-1', name: 'Row', value: '' }] }, handles: [] }) },
	{ id: 'dataverse-table', label: 'Dataverse table', description: 'Columns with key, logical name and type.', icon: TableProperties, keywordList: ['entity', 'er'],
		create: idNext => ({ id: idNext('table'), renderer: { type: 'dataverse-table' }, data: { name: 'Table', nameLogical: '', columns: [{ id: 'id', name: 'ID', nameLogical: 'id', type: 'Unique identifier', key: 'PK', isRequired: true }] }, handles: [] }) },
	{ id: 'dataverse-choice', label: 'Dataverse choice', description: 'A global choice with its options.', icon: ListChecks, keywordList: ['option set', 'enum'],
		create: idNext => ({ id: idNext('choice'), renderer: { type: 'dataverse-choice' }, data: { name: 'Choice', nameLogical: '', columns: [{ id: 'option-1', name: 'Option', nameLogical: '1', type: 'Option' }] }, handles: [{ id: 'header-in', direction: 'in', anchor: { target: 'header', side: 'left' } }] }) },
	{ id: 'operator', label: 'Operator', description: 'A step with a label and a note.', icon: Boxes, keywordList: ['step', 'process'],
		create: idNext => ({ id: idNext('step'), renderer: { type: 'operator' }, data: { label: 'Step', description: '' }, handles: [
			{ id: 'in', direction: 'in', anchor: { side: 'left' } },
			{ id: 'out', direction: 'out', anchor: { side: 'right' } },
		] }) },
	{ id: 'power-automate', label: 'Power Automate step', description: 'Trigger, action, condition, scope, loop or terminate.', icon: Workflow, keywordList: ['flow'],
		create: resourceCreate('power-automate', powerAutomateNodeFields, 'Flow step') },
	{ id: 'business-rule', label: 'Business rule', description: 'A Dataverse condition or action.', icon: GitBranch, keywordList: ['rule'],
		create: resourceCreate('business-rule', businessRuleNodeFields, 'Business rule') },
	{ id: 'connection', label: 'Connection', description: 'A line with two free ends; drag an end onto a handle.', icon: Waypoints, keywordList: ['line', 'edge', 'relationship'], isConnection: true },
];

export function diagramRegistrySearch(query) {
	const queryLower = query.trim().toLowerCase();
	if (!queryLower) return diagramNodeRegistry.map(entry => ({ entry, rank: 0 }));
	return diagramNodeRegistry.map(entry => {
		const rank = entry.label.toLowerCase().includes(queryLower) ? 0 : entry.id.includes(queryLower) || entry.keywordList.some(keyword => keyword.includes(queryLower)) ? 1 : entry.description.toLowerCase().includes(queryLower) ? 2 : -1;
		return { entry, rank };
	}).filter(item => item.rank >= 0).sort((a, b) => a.rank - b.rank);
}
