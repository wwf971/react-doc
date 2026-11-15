import { resourceNodeAnchorsGet, resourceNodeNormalize } from '../card-diagram/ResourceNodeData.js';
import { resourceCardHeightEstimate } from '../card-diagram/TableCardData.js';

// a function of Lambda (doc/aws.md): what it runs on, how much it may use, as whom. Its property
// rows are its environment, by name only (a value is config of a deployment, or a secret)
export const awsLambdaNodeFields = [
	{ id: 'name', label: 'Name' },
	{ id: 'runtime', label: 'Runtime' },
	{ id: 'memory', label: 'Memory' },
	{ id: 'timeout', label: 'Timeout' },
	{ id: 'role', label: 'Role' },
	{ id: 'description', label: 'Description', isMultiline: true },
];

export const awsLambdaNodeContract = {
	dataNormalize: (data) => resourceNodeNormalize(data, awsLambdaNodeFields),
	anchorListGet: resourceNodeAnchorsGet,
	sizeDefault: { width: 320, height: 220 },
	sizeEstimate: (node) => ({ height: resourceCardHeightEstimate(node, awsLambdaNodeFields) }),
};
