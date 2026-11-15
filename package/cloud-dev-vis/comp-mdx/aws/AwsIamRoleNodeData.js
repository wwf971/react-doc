import { resourceNodeAnchorsGet, resourceNodeNormalize } from '../card-diagram/ResourceNodeData.js';
import { resourceCardHeightEstimate } from '../card-diagram/TableCardData.js';

// a role of IAM (doc/aws.md): who assumes it. Its property rows are what it allows, by service
export const awsIamRoleNodeFields = [
	{ id: 'name', label: 'Name' },
	{ id: 'assumedBy', label: 'Assumed by' },
	{ id: 'description', label: 'Description', isMultiline: true },
];

export const awsIamRoleNodeContract = {
	dataNormalize: (data) => resourceNodeNormalize(data, awsIamRoleNodeFields),
	anchorListGet: resourceNodeAnchorsGet,
	sizeDefault: { width: 300, height: 180 },
	sizeEstimate: (node) => ({ height: resourceCardHeightEstimate(node, awsIamRoleNodeFields) }),
};
