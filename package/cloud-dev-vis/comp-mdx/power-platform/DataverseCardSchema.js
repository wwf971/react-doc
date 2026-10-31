// The card schemas of the Dataverse kinds (TableCardSchema.js of the base
// series): the fields of a column are fixed. Used by their kinds in
// power-platform-node-registry.js
export const dataverseKeyList = ['', 'PK', 'FK'];
export const dataverseTypeList = ['Text', 'Multiline Text', 'Whole Number', 'Decimal Number', 'Floating Point Number', 'Currency', 'Date', 'Date and Time', 'Choice', 'Choices', 'Lookup', 'Customer', 'Owner', 'Boolean', 'Unique identifier', 'UUID', 'String', 'Option'];

const dataverseFieldList = [
	{ id: 'key', label: 'Key', kind: 'enum', values: dataverseKeyList, valueLabels: { '': 'None' } },
	{ id: 'name', label: 'Column', kind: 'text' },
	{ id: 'nameLogical', label: 'Logical name', kind: 'text' },
	{ id: 'type', label: 'Type', kind: 'enum', values: dataverseTypeList, isSearchable: true },
];

export const dataverseTableSchema = {
	type: 'dataverse-table',
	kind: 'dataverse',
	labelNode: 'Table',
	labelRow: 'Column',
	labelRowPlural: 'Columns',
	labelField: 'Field',
	labelFieldPlural: 'Fields',
	reasonFieldListFixed: 'The fields of a Dataverse table card are fixed: Key, Column, Logical name and Type.',
	rowListKey: 'columns',
	anchorPrefix: 'column',
	fieldList: dataverseFieldList,
	isFieldListEditable: false,
	headFieldList: [],
	nodePropertyList: [{ id: 'name', label: 'Name', kind: 'text' }, { id: 'nameLogical', label: 'Logical name', kind: 'text' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
	rowPropertyList: [{ id: 'isRequired', label: 'Required', kind: 'bool' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }],
	rowNew: () => ({ name: 'Column', type: 'Text' }),
	isHeaderHandleAllowed: () => false,
};

export const dataverseChoiceSchema = {
	type: 'dataverse-choice',
	kind: 'dataverse',
	labelNode: 'Choice',
	labelRow: 'Option',
	labelRowPlural: 'Options',
	labelField: 'Field',
	labelFieldPlural: 'Fields',
	reasonFieldListFixed: 'The fields of a choice card are fixed: Key, Option, Logical name and Type.',
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
};

// a standalone Dataverse card written before `version: 1`: the table itself,
// or under `entity` (DiagramDataverseEntity, power-platform.md)
export function dataverseCardLegacyConvert(value) {
	return { version: 1, node: { id: value?.entity?.id ?? value?.id ?? 'entity', renderer: { type: 'dataverse-table' }, data: value?.entity ?? value } };
}
