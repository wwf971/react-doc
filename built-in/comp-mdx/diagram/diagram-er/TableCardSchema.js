import { powerAutomateNodeFields } from './PowerAutomateNodeData.js';
import { businessRuleNodeFields } from './BusinessRuleNodeData.js';

// What the generic table card (TableCard.jsx) and the editor (DiagramEditStore.js)
// know about a node type: where its rows live, which fields a row shows,
// which properties the Table / Row tabs of the edit card offer, and whether
// its fields are authored (the generic `table` type) or fixed (the Dataverse
// and resource cards). A node type without a schema is not a card.
//
//   property   { id, label, kind: 'text' | 'enum' | 'bool', values?, isMultiline?, isSearchable? }
//   field      a property shown as a column of the card
export const dataverseKeyList = ['', 'PK', 'FK'];
export const dataverseTypeList = ['Text', 'Multiline Text', 'Whole Number', 'Decimal Number', 'Floating Point Number', 'Currency', 'Date', 'Date and Time', 'Choice', 'Choices', 'Lookup', 'Customer', 'Owner', 'Boolean', 'Unique identifier', 'UUID', 'String', 'Option'];

const dataverseFieldList = [
	{ id: 'key', label: 'Key', kind: 'enum', values: dataverseKeyList, valueLabels: { '': 'None' } },
	{ id: 'name', label: 'Column', kind: 'text' },
	{ id: 'nameLogical', label: 'Logical name', kind: 'text' },
	{ id: 'type', label: 'Type', kind: 'enum', values: dataverseTypeList, isSearchable: true },
];

function resourceSchema(type, fieldsResource, labelNode) {
	const headFieldList = fieldsResource.slice(1).filter(field => field.id !== 'description').map(field => ({ id: field.id, label: field.label, kind: field.values ? 'enum' : 'text', values: field.values, isMultiline: field.isMultiline, defaultValue: field.defaultValue }));
	return {
		type,
		kind: 'resource',
		labelNode,
		labelRow: 'Property',
		rowListKey: 'properties',
		anchorPrefix: 'property',
		fieldList: [{ id: 'name', label: 'Property', kind: 'text' }, { id: 'value', label: 'Value', kind: 'text', isMultiline: true }],
		isFieldListEditable: false,
		headFieldList,
		nodePropertyList: [{ id: 'name', label: 'Name', kind: 'text' }, ...headFieldList, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
		rowPropertyList: [{ id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
		rowNew: () => ({ name: 'Property', value: '' }),
		isHeaderHandleAllowed: () => true,
	};
}

const schemaByType = {
	'dataverse-table': {
		type: 'dataverse-table',
		kind: 'dataverse',
		labelNode: 'Table',
		labelRow: 'Column',
		rowListKey: 'columns',
		anchorPrefix: 'column',
		fieldList: dataverseFieldList,
		isFieldListEditable: false,
		headFieldList: [],
		nodePropertyList: [{ id: 'name', label: 'Name', kind: 'text' }, { id: 'nameLogical', label: 'Logical name', kind: 'text' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
		rowPropertyList: [{ id: 'isRequired', label: 'Required', kind: 'bool' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
		rowNew: () => ({ name: 'Column', type: 'Text' }),
		isHeaderHandleAllowed: () => false,
	},
	'dataverse-choice': {
		type: 'dataverse-choice',
		kind: 'dataverse',
		labelNode: 'Choice',
		labelRow: 'Option',
		rowListKey: 'columns',
		anchorPrefix: 'column',
		fieldList: dataverseFieldList,
		isFieldListEditable: false,
		headFieldList: [],
		nodePropertyList: [{ id: 'name', label: 'Name', kind: 'text' }, { id: 'nameLogical', label: 'Logical name', kind: 'text' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
		rowPropertyList: [{ id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
		rowNew: () => ({ name: 'Option', type: 'Option' }),
		// a choice is referenced as a whole: its rows take no handles
		isRowHandleAllowed: () => false,
		isHeaderHandleAllowed: () => true,
	},
	table: {
		type: 'table',
		kind: 'table',
		labelNode: 'Table',
		labelRow: 'Row',
		rowListKey: 'rows',
		anchorPrefix: 'row',
		fieldList: [],
		isFieldListEditable: true,
		headFieldList: [],
		nodePropertyList: [{ id: 'name', label: 'Name', kind: 'text' }, { id: 'nameLogical', label: 'Subtitle', kind: 'text' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }, { id: 'isHeaderHandleEnabled', label: 'Title handles', kind: 'bool' }],
		rowPropertyList: [],
		rowNew: fields => Object.fromEntries(fields.map((field, index) => [field.id, index === 0 ? 'Row' : ''])),
		isHeaderHandleAllowed: data => data.isHeaderHandleEnabled === true,
	},
	'power-automate': resourceSchema('power-automate', powerAutomateNodeFields, 'Flow step'),
	'business-rule': resourceSchema('business-rule', businessRuleNodeFields, 'Business rule'),
};

// the schema of a node, with the field list of a generic table resolved from
// its data; null for a node that is not a card (an operator, a component)
export function cardSchemaGet(node) {
	const schema = schemaByType[node?.renderer?.type];
	if (!schema) return null;
	if (schema.kind !== 'table') return schema;
	const fields = Array.isArray(node.data?.fields) && node.data.fields.length ? node.data.fields : [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }];
	return { ...schema, fieldList: fields.map(field => ({ id: field.id, label: String(field.label ?? field.id), kind: 'text' })) };
}

export function cardRowListGet(node) {
	const schema = cardSchemaGet(node);
	return schema ? node.data?.[schema.rowListKey] ?? [] : [];
}

export function cardRowAnchorBuild(schema, rowId) {
	return `${schema.anchorPrefix}/${rowId}`;
}
