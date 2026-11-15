import { awsRowCardAnchorListGet, awsRowCardNormalize, awsRowCardSchemaBuild } from './AwsCardData.js';
import { rowCardHeightEstimate } from '../card-diagram/TableCardData.js';

// a table of DynamoDB, or one kind of its rows (doc/aws.md): the patterns of its keys, and its
// attributes, each with the key it is (an index: GSI), its type and what it holds; how the table
// is billed is said in its description. A line can leave an attribute (attribute/{id}): what a
// row points at. A line to the card as a whole ends at its title line, as on every table card
export const awsDynamodbKeyList = ['', 'PK', 'SK', 'GSI PK', 'GSI SK'];
export const awsDynamodbTypeList = ['', 'S', 'N', 'B', 'BOOL', 'M', 'L', 'SS', 'NS'];

export const awsDynamodbTableSchema = awsRowCardSchemaBuild({
	type: 'aws-dynamodb-table',
	labelNode: 'DynamoDB table',
	labelRow: 'Attribute',
	labelRowPlural: 'Attributes',
	labelSubtitle: 'Table',
	rowListKey: 'attributes',
	anchorPrefix: 'attribute',
	fieldList: [
		{ id: 'key', label: 'Key', kind: 'enum', values: awsDynamodbKeyList, valueLabels: { '': 'None' } },
		{ id: 'name', label: 'Attribute', kind: 'text' },
		{ id: 'type', label: 'Type', kind: 'enum', values: awsDynamodbTypeList, valueLabels: { '': 'Any' } },
		{ id: 'holds', label: 'Holds', kind: 'text', isMultiline: true },
	],
	headFieldList: [
		{ id: 'pk', label: 'pk', kind: 'text' },
		{ id: 'sk', label: 'sk', kind: 'text' },
	],
	rowNew: () => ({ name: 'attribute', type: 'S' }),
});

export const awsDynamodbTableNodeContract = {
	dataNormalize: (data) => awsRowCardNormalize(data, awsDynamodbTableSchema),
	anchorListGet: (data) => awsRowCardAnchorListGet(data, awsDynamodbTableSchema),
	anchorSideDrawn: 'header',
	sizeDefault: { width: 380, height: 220 },
	// the columns as AwsDynamodbTableNode draws them: key, attribute, type, what it holds
	sizeEstimate: (node) => ({ height: rowCardHeightEstimate(node, awsDynamodbTableSchema, 380, [0.16, 0.28, 0.14, 0.42]) }),
};
