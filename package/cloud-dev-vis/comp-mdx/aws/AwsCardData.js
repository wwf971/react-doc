import { cardDisplayPropertyListFixed } from '../card-diagram/TableCardSchema.js';
import { cardViewNormalize, cardViewSourceOf } from '../card-diagram/TableCardData.js';

// What the cards of the AWS series share (doc/aws.md): the families of services, each with its
// accent (AwsCard.css), and the cards whose rows have fixed fields (the kinds of rows of a
// DynamoDB table, the routes of a group), built on the table card of the base series.
//
//   family            services                                   accent (of the official icons)
//   aws-network       API Gateway                                violet
//   aws-compute       Lambda                                     orange
//   aws-database      DynamoDB                                   magenta
//   aws-storage       S3                                         green
//   aws-security      IAM, Cognito                               red
//   aws-management    CloudWatch                                 pink
export const AWS_FAMILY_LIST = ['aws-network', 'aws-compute', 'aws-database', 'aws-storage', 'aws-security', 'aws-management'];

const sideAllList = ['left', 'right', 'top', 'bottom'];

// a handle on the card as a whole, written as a series writes them: in on top, out at the bottom,
// since a system is read downward in the order a request passes it
export const awsHandleOf = (id, direction, side = direction === 'in' ? 'top' : 'bottom', target = 'body') => ({ id, direction, anchor: { target, side } });

// ---------- a card of rows with fixed fields

// the schema of a card of rows with fixed fields (TableCardSchema.js): fieldList are the columns,
// headFieldList what stands under the title, the subtitle being nameLogical
export function awsRowCardSchemaBuild({ type, labelNode, labelRow, labelRowPlural, rowListKey, anchorPrefix, fieldList, headFieldList = [], labelSubtitle, rowNew }) {
	return {
		type,
		kind: 'aws-rows',
		labelNode,
		labelRow,
		labelRowPlural,
		labelField: 'Field',
		labelFieldPlural: 'Fields',
		reasonFieldListFixed: `The fields of a ${labelNode.toLowerCase()} card are fixed: ${fieldList.map((field) => field.label).join(', ')}.`,
		rowListKey,
		anchorPrefix,
		fieldList,
		isFieldListEditable: false,
		headFieldList,
		nodePropertyList: [{ id: 'name', label: 'Name', kind: 'text' }, { id: 'nameLogical', label: labelSubtitle, kind: 'text' }, ...headFieldList, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
		rowPropertyList: [{ id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
		viewModeList: ['plain'],
		displayPropertyList: cardDisplayPropertyListFixed,
		rowNew,
		isHeaderHandleAllowed: () => true,
	};
}

// the data of such a card checked: every field text (an enum one of its values), every row an id
export function awsRowCardNormalize(data, schema) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${schema.labelNode} data must be a mapping.`);
	const rowInput = data[schema.rowListKey] ?? [];
	if (!Array.isArray(rowInput)) throw new Error(`${schema.rowListKey} must be a list.`);
	const idSet = new Set();
	const rowList = rowInput.map((row) => {
		if (!row || typeof row.id !== 'string' || !row.id.trim()) throw new Error(`A ${schema.labelRow.toLowerCase()} needs an id.`);
		if (idSet.has(row.id)) throw new Error(`Duplicate ${schema.labelRow.toLowerCase()} id "${row.id}".`);
		idSet.add(row.id);
		const rowNext = { ...row, description: String(row.description ?? '') };
		for (const field of schema.fieldList) {
			const value = String(row[field.id] ?? field.defaultValue ?? '');
			if (field.values && !field.values.includes(value)) throw new Error(`${row.id}.${field.id}: "${value}" is not one of ${field.values.filter(Boolean).join(', ')}.`);
			rowNext[field.id] = value;
		}
		return rowNext;
	});
	const dataNext = { ...data, name: String(data.name ?? ''), nameLogical: String(data.nameLogical ?? ''), description: String(data.description ?? ''), [schema.rowListKey]: rowList };
	for (const field of schema.headFieldList) dataNext[field.id] = String(data[field.id] ?? '');
	return { ...dataNext, ...cardViewNormalize(dataNext, cardViewSourceOf(dataNext, schema.rowListKey)) };
}

// the card as a whole on every side, its title line, each row on its left and right
export function awsRowCardAnchorListGet(data, schema) {
	return [
		{ id: 'body', sideList: sideAllList },
		{ id: 'header', sideList: sideAllList },
		...(data[schema.rowListKey] ?? []).map((row) => ({ id: `${schema.anchorPrefix}/${row.id}`, sideList: ['left', 'right'] })),
	];
}
