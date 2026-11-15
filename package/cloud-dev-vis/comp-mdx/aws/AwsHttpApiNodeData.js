import { resourceNodeAnchorsGet, resourceNodeNormalize } from '../card-diagram/ResourceNodeData.js';
import { resourceCardHeightEstimate } from '../card-diagram/TableCardData.js';

// an http api of API Gateway (doc/aws.md): who it lets in, what it lets through, how fast. Its
// property rows are its groups of routes, each a name and what it holds
export const awsHttpApiNodeFields = [
	{ id: 'name', label: 'Name' },
	{ id: 'authorizer', label: 'Authorizer' },
	{ id: 'cors', label: 'CORS' },
	{ id: 'throttle', label: 'Throttle' },
	{ id: 'description', label: 'Description', isMultiline: true },
];

export const awsHttpApiNodeContract = {
	dataNormalize: (data) => resourceNodeNormalize(data, awsHttpApiNodeFields),
	anchorListGet: resourceNodeAnchorsGet,
	sizeDefault: { width: 320, height: 200 },
	sizeEstimate: (node) => ({ height: resourceCardHeightEstimate(node, awsHttpApiNodeFields) }),
};
