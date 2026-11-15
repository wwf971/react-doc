import { resourceNodeAnchorsGet, resourceNodeNormalize } from '../card-diagram/ResourceNodeData.js';
import { resourceCardHeightEstimate } from '../card-diagram/TableCardData.js';

// a user pool of Cognito (doc/aws.md): who signs in there, and how. Its property rows are its app
// clients and its groups
export const awsCognitoUserPoolNodeFields = [
	{ id: 'name', label: 'Name' },
	{ id: 'mfa', label: 'MFA' },
	{ id: 'description', label: 'Description', isMultiline: true },
];

export const awsCognitoUserPoolNodeContract = {
	dataNormalize: (data) => resourceNodeNormalize(data, awsCognitoUserPoolNodeFields),
	anchorListGet: resourceNodeAnchorsGet,
	sizeDefault: { width: 300, height: 160 },
	sizeEstimate: (node) => ({ height: resourceCardHeightEstimate(node, awsCognitoUserPoolNodeFields) }),
};
