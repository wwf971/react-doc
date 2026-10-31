// What the generic table card (TableCard.jsx) and the editor (DiagramEditStore.js)
// know about a node type, the `schema` of its kind in the node registry
// (node-registry.js): where its rows live, which fields a row shows,
// which properties the Table / Row tabs of the edit card offer, and whether
// its fields are authored (the generic `table` type) or fixed (the Dataverse
// and resource cards). A node type without a schema is not a card.
//
//   property   { id, label, kind: 'text' | 'enum' | 'bool', values?, isMultiline?, isSearchable? }
//   field      a property shown as a column of the card
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
	rowNew: fields => Object.fromEntries(fields.map((field, index) => [field.id, index === 0 ? 'Row' : ''])),
	isHeaderHandleAllowed: data => data.isHeaderHandleEnabled === true,
};

// the schema of a node, with the field list of a generic table resolved from
// its data; null for a node that is not a card (an operator, a component)
// or whose type the registry does not know
export function cardSchemaGet(node, registry) {
	const schema = registry?.kindByType[node?.renderer?.type]?.schema;
	if (!schema) return null;
	if (schema.kind !== 'table') return schema;
	const fields = Array.isArray(node.data?.fields) && node.data.fields.length ? node.data.fields : [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }];
	return { ...schema, fieldList: fields.map(field => ({ id: field.id, label: String(field.label ?? field.id), kind: 'text' })) };
}

export function cardRowListGet(node, registry) {
	const schema = cardSchemaGet(node, registry);
	return schema ? node.data?.[schema.rowListKey] ?? [] : [];
}

export function cardRowAnchorBuild(schema, rowId) {
	return `${schema.anchorPrefix}/${rowId}`;
}
