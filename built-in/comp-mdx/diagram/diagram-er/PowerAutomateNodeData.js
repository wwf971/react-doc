import { resourceNodeNormalize, resourceNodeAnchorsGet } from './ResourceNodeData.js';

export const powerAutomateNodeFields = [
	{ id: 'name', label: 'Name' },
	{ id: 'kind', label: 'Step', defaultValue: 'action', values: ['trigger', 'action', 'condition', 'scope', 'loop', 'terminate'] },
	{ id: 'connector', label: 'Connector' },
	{ id: 'operation', label: 'Operation' },
	{ id: 'expression', label: 'Expression', isMultiline: true },
	{ id: 'description', label: 'Description', isMultiline: true },
];

export const powerAutomateNodeContract = {
	dataNormalize: data => resourceNodeNormalize(data, powerAutomateNodeFields),
	anchorListGet: resourceNodeAnchorsGet,
	sizeDefault: { width: 360, height: 260 },
};