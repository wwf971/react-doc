// What the generic table card (TableCard.jsx) and the editor (DiagramEditStore.js)
// know about a node type, the `schema` of its kind in the node registry
// (node-registry.js): where its rows live, which fields a row shows,
// which properties the Table / Row tabs of the edit card offer, and whether
// its fields are authored (the generic `table` type) or fixed (the Dataverse
// and resource cards). A node type without a schema is not a card.
//
//   property   { id, label, kind: 'text' | 'enum' | 'bool' | 'number', values?, valueLabels?, valuesKey?,
//                valueLabelsKey?, valueTones?, isMultiline?, isSearchable?, isReadOnly?, placeholder? }
//              placeholder: what a text left empty says in its field of the edit card (the value
//              that holds while none is typed)
//              valuesKey: the key of a row holding the values that row can take, where they
//              differ from row to row; valueLabelsKey: the key of a row holding words of its
//              own for some values; valueTones: { value: tone }, the color a value is written
//              in where it is a cell; isReadOnly: a value that is shown, never changed
//   field      a property shown as a column of the card
//
// A card says more of its rows than its kind knows through its data (fieldExtraList,
// rowPropertyExtraList, below): what a diagram keeps of each column of a table, of each option.
//   viewModeList  the view modes a card of this kind can have (TableCardData.js); plain alone
//              when absent
//   displayPropertyList   how the card looks, in the Display section of the edit card: a
//              property left at its default is taken out of the data
//
// the words of a card: labelNode (the card), labelRow / labelRowPlural (one
// row of it: a Column of a Dataverse table, an Option, a Property, a Row),
// labelField / labelFieldPlural (one field: a Field of a fixed card, a Column
// of a generic table). the edit card names its tabs, its lists and the
// segments of its path with them (DiagramEditPath.js). reasonFieldListFixed
// is what the edit card says where the fields cannot be changed

// the schema of a resource card (ResourceNodeCard.jsx): head fields under
// the title, taken from the fields of the resource but its name and
// description, and property rows, each a name and a value
export function resourceCardSchemaBuild(type, fieldsResource, labelNode) {
	const headFieldList = fieldsResource.slice(1).filter(field => field.id !== 'description').map(field => ({ id: field.id, label: field.label, kind: field.values ? 'enum' : 'text', values: field.values, isMultiline: field.isMultiline, defaultValue: field.defaultValue }));
	return {
		type,
		kind: 'resource',
		labelNode,
		labelRow: 'Property',
		labelRowPlural: 'Properties',
		labelField: 'Field',
		labelFieldPlural: 'Fields',
		reasonFieldListFixed: `The fields of a ${labelNode.toLowerCase()} card are fixed: a property is a name and a value.`,
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

const TONE = { id: 'tone', label: 'Title color', kind: 'enum', values: ['', 'blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'], valueLabels: { '': 'Default', blue: 'Blue', teal: 'Teal', green: 'Green', amber: 'Amber', red: 'Red', violet: 'Violet', slate: 'Slate' } };

// what a card with fixed fields offers of the same
export const cardDisplayPropertyListFixed = [{ id: 'isFieldHeaderHidden', label: 'Hide the field names', kind: 'bool' }, TONE];

export const tableCardSchema = {
	type: 'table',
	kind: 'table',
	labelNode: 'Table',
	labelRow: 'Row',
	labelRowPlural: 'Rows',
	labelField: 'Column',
	labelFieldPlural: 'Columns',
	reasonFieldListFixed: '',
	rowListKey: 'rows',
	anchorPrefix: 'row',
	fieldList: [],
	isFieldListEditable: true,
	headFieldList: [],
	nodePropertyList: [{ id: 'name', label: 'Name', kind: 'text' }, { id: 'nameLogical', label: 'Subtitle', kind: 'text' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }, { id: 'isHeaderHandleEnabled', label: 'Title handles', kind: 'bool' }],
	rowPropertyList: [],
	viewModeList: ['plain', 'column', 'row'],
	displayPropertyList: [
		{ id: 'isCompact', label: 'Compact', kind: 'bool' },
		{ id: 'isFieldHeaderHidden', label: 'Hide the column names', kind: 'bool' },
		TONE,
		{ id: 'columnTemplate', label: 'Column widths (css grid)', kind: 'text' },
	],
	rowNew: fields => Object.fromEntries(fields.map((field, index) => [field.id, index === 0 ? 'Row' : ''])),
	isHeaderHandleAllowed: data => data.isHeaderHandleEnabled === true,
};

// the footer of a card (TableCard.jsx): a strip under its rows, the anchor `footer`, which a
// line leaving the bottom of the card leaves from. data.footer: true (shown, empty) or its text;
// drawn too while a handle stands on it (cardFooterIsShown, TableCardData.js)
export const CARD_FOOTER_ANCHOR = 'footer';
export const cardFooterProperty = { id: 'footer', label: 'Footer text', kind: 'text' };

// a field or a property written in the data of a node, as the editor reads it: text typed (the
// default), a choice among values (enum), a yes or no (bool), a number; read only where the
// data says so. isDeclared: said by the data, not by the kind
function propertyAuthoredOf(property) {
	const kind = ['enum', 'bool', 'number'].includes(property.kind) ? property.kind : 'text';
	return {
		id: property.id, label: String(property.label ?? property.id), kind, isDeclared: true,
		...(kind === 'enum' ? { values: property.values ?? [], valueLabels: property.valueLabels, valuesKey: property.valuesKey, valueLabelsKey: property.valueLabelsKey, valueTones: property.valueTones, isSearchable: property.isSearchable === true } : {}),
		...(kind === 'number' ? { min: property.min, max: property.max, step: property.step } : {}),
		...(property.isMultiline ? { isMultiline: true } : {}),
		...(property.placeholder ? { placeholder: String(property.placeholder) } : {}),
		...(property.isReadOnly ? { isReadOnly: true } : {}),
		...(property.width ? { width: property.width } : {}),
	};
}

// the schema of a node, with the field list of a generic table resolved from
// its data; null for a node that is not a card (an operator, a component)
// or whose type the registry does not know.
//
// A card of any kind may say more of its rows in its data, beside what its kind fixes:
//   fieldExtraList         further fields, drawn as columns after those of the kind: [{ id, label,
//                          kind?, values?, valueLabels?, valuesKey?, isSearchable?, isReadOnly?, width? }]
//                          (width: of its column, a css grid track)
//   rowPropertyExtraList   further properties of a row, edited in the edit card and not drawn
export function cardSchemaGet(node, registry) {
	const schema = registry?.kindByType[node?.renderer?.type]?.schema;
	if (!schema) return null;
	const fieldExtraList = Array.isArray(node.data?.fieldExtraList) ? node.data.fieldExtraList.map(propertyAuthoredOf) : [];
	const rowPropertyExtraList = Array.isArray(node.data?.rowPropertyExtraList) ? node.data.rowPropertyExtraList.map(propertyAuthoredOf) : [];
	const extra = fieldExtraList.length || rowPropertyExtraList.length ? { fieldExtraList, rowPropertyList: [...schema.rowPropertyList, ...rowPropertyExtraList] } : null;
	if (schema.kind !== 'table') return extra ? { ...schema, ...extra, fieldList: [...schema.fieldList, ...fieldExtraList] } : schema;
	const fields = Array.isArray(node.data?.fields) && node.data.fields.length ? node.data.fields : [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }];
	return { ...schema, ...extra, fieldList: [...fields.map(propertyAuthoredOf), ...fieldExtraList] };
}

// the properties of a node itself, which the edit card offers and a cell of the node may type:
// those of its schema; for a node that is not a card, those of its kind (contract.propertyList),
// else the words every node may have, and then those its data declares (propertyList: a label
// carrying settings, a mark with what it stands for)
export const nodePropertyListDefault = [{ id: 'label', label: 'Label', kind: 'text' }, { id: 'name', label: 'Name', kind: 'text' }, { id: 'description', label: 'Description', kind: 'text', isMultiline: true }];

export function nodePropertyListGet(node, registry) {
	const kind = registry?.kindByType[node?.renderer?.type];
	if (kind?.schema) return kind.schema.nodePropertyList;
	const declared = Array.isArray(node?.data?.propertyList) ? node.data.propertyList.map(propertyAuthoredOf) : [];
	return [...(kind?.contract?.propertyList ?? nodePropertyListDefault), ...declared];
}

// the values a row can take in a field: its own where the field names a key of the row for them
export function fieldValuesOf(definition, row) {
	const own = definition.valuesKey ? row?.[definition.valuesKey] : undefined;
	return Array.isArray(own) ? own : definition.values;
}

// the words of the values of a field for a row: those of the field, and over them the row's own
export function fieldValueLabelsOf(definition, row) {
	const own = definition.valueLabelsKey ? row?.[definition.valueLabelsKey] : undefined;
	return own && typeof own === 'object' ? { ...definition.valueLabels, ...own } : definition.valueLabels;
}

// a field as one row has it: its values and their words resolved for that row
export function fieldOfRow(definition, row) {
	return definition.valuesKey || definition.valueLabelsKey ? { ...definition, values: fieldValuesOf(definition, row), valueLabels: fieldValueLabelsOf(definition, row) } : definition;
}

export function cardRowListGet(node, registry) {
	const schema = cardSchemaGet(node, registry);
	return schema ? node.data?.[schema.rowListKey] ?? [] : [];
}

export function cardRowAnchorBuild(schema, rowId) {
	return `${schema.anchorPrefix}/${rowId}`;
}
