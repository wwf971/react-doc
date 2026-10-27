import { resourceNodeNormalize, resourceNodeAnchorsGet } from './ResourceNodeData.js';

export const businessRuleNodeFields = [
	{ id: 'name', label: 'Name' },
	{ id: 'kind', label: 'Step', defaultValue: 'condition', values: ['condition', 'action'] },
	{ id: 'table', label: 'Table' },
	{ id: 'scope', label: 'Scope', defaultValue: 'All Forms', values: ['Entity', 'All Forms', 'Specific Form'] },
	{ id: 'action', label: 'Action', defaultValue: '', values: ['', 'setValue', 'setRequired', 'setVisibility', 'setEnabled', 'showError', 'recommendation'] },
	{ id: 'expression', label: 'Condition', isMultiline: true },
	{ id: 'description', label: 'Description', isMultiline: true },
];

export const businessRuleNodeContract = {
	dataNormalize: data => resourceNodeNormalize(data, businessRuleNodeFields),
	anchorListGet: resourceNodeAnchorsGet,
	sizeDefault: { width: 360, height: 260 },
};