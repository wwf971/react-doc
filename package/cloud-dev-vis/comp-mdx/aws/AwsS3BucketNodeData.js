import { resourceNodeAnchorsGet, resourceNodeNormalize } from '../card-diagram/ResourceNodeData.js';
import { resourceCardHeightEstimate } from '../card-diagram/TableCardData.js';

// a bucket of S3 (doc/aws.md): who reaches it, whether it keeps versions. Its property rows are
// its key prefixes and its lifecycle rules, each a name and what it holds or does
export const awsS3BucketNodeFields = [
	{ id: 'name', label: 'Name' },
	{ id: 'access', label: 'Access' },
	{ id: 'versioning', label: 'Versioning' },
	{ id: 'description', label: 'Description', isMultiline: true },
];

export const awsS3BucketNodeContract = {
	dataNormalize: (data) => resourceNodeNormalize(data, awsS3BucketNodeFields),
	anchorListGet: resourceNodeAnchorsGet,
	sizeDefault: { width: 320, height: 200 },
	sizeEstimate: (node) => ({ height: resourceCardHeightEstimate(node, awsS3BucketNodeFields) }),
};
