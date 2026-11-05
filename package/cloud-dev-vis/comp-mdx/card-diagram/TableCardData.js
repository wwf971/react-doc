// The generic table node (renderer type `table`): a titled card whose rows and
// fields are both authored. The Dataverse and resource cards are variants of
// the same card with fixed fields (TableCardSchema.js).
//
//   data
//     name, nameLogical?, description?
//     isHeaderHandleEnabled?   handles may sit on the title line (off by default)
//     fields: [{ id, label }]  the columns of the card, in order
//     rows:   [{ id, <fieldId>: text ..., isEllipsis?, tone? }]
//       isEllipsis   the row stands for rows left out: one centered "..." (or
//                    its first field's text), a card can then show a table
//                    of any length in a few lines
//     columnTemplate?     the widths of the columns, as css grid columns (5rem 1fr 4rem)
//     isCompact?          the dense look: small type, tight rows, a dark title line
//     isFieldHeaderHidden?  no line of field names
//     tone?               the color of the title line: blue, teal, green, amber, red, violet, slate
//     rowGroupList?: [{ id, rowFrom, rowTo, label?, tone? }]
//       rows of the card taken together: a bracket beside them, on the right edge
//       of the card, with an anchor group/<id> a line can leave from. what a
//       table split into batches is drawn with
export const tableCardFieldListDefault = [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }];

export function tableCardNormalize(data = {}) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Table data must be a mapping.');
	const fieldsInput = data.fields === undefined ? tableCardFieldListDefault : data.fields;
	if (!Array.isArray(fieldsInput) || !fieldsInput.length) throw new Error('Table fields must be a non-empty list.');
	const fieldIds = new Set();
	const fields = fieldsInput.map((field) => {
		if (!field || typeof field.id !== 'string' || !field.id.trim()) throw new Error('Field id must be a non-empty string.');
		if (field.id === 'id') throw new Error('A field cannot be named "id".');
		if (fieldIds.has(field.id)) throw new Error(`Duplicate field id "${field.id}".`);
		fieldIds.add(field.id);
		return { ...field, label: String(field.label ?? field.id) };
	});
	if (data.rows !== undefined && !Array.isArray(data.rows)) throw new Error('Table rows must be a list.');
	if (data.isHeaderHandleEnabled !== undefined && typeof data.isHeaderHandleEnabled !== 'boolean') throw new Error('isHeaderHandleEnabled must be boolean.');
	const rowIds = new Set();
	const rowIdList = (data.rows ?? []).map(row => row?.id);
	const groupIds = new Set();
	const rowGroupList = (data.rowGroupList ?? []).map((group) => {
		if (!group || typeof group.id !== 'string' || !group.id.trim()) throw new Error('A row group needs an id.');
		if (groupIds.has(group.id)) throw new Error(`Duplicate row group id "${group.id}".`);
		groupIds.add(group.id);
		for (const key of ['rowFrom', 'rowTo']) {
			if (!rowIdList.includes(group[key])) throw new Error(`Row group "${group.id}": ${key} "${group[key]}" is not a row.`);
		}
		if (rowIdList.indexOf(group.rowFrom) > rowIdList.indexOf(group.rowTo)) throw new Error(`Row group "${group.id}": rowFrom comes after rowTo.`);
		return { ...group, label: String(group.label ?? '') };
	});
	return {
		...data,
		rowGroupList,
		name: String(data.name || data.id || ''),
		nameLogical: String(data.nameLogical || ''),
		description: String(data.description || ''),
		isHeaderHandleEnabled: data.isHeaderHandleEnabled === true,
		fields,
		rows: (data.rows ?? []).map((row) => {
			if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim()) throw new Error('Row id must be a non-empty string.');
			if (rowIds.has(row.id)) throw new Error(`Duplicate row id "${row.id}".`);
			rowIds.add(row.id);
			const result = { ...row };
			for (const field of fields) result[field.id] = row[field.id] === undefined || row[field.id] === null ? '' : String(row[field.id]);
			return result;
		}),
	};
}

export function tableCardAnchorListGet(data) {
	return [
		{ id: 'body', sideList: ['left', 'right', 'top', 'bottom'] },
		...data.rows.map(row => ({ id: `row/${row.id}`, sideList: ['left', 'right'] })),
		...(data.isHeaderHandleEnabled ? [{ id: 'header', sideList: ['left', 'right'] }] : []),
		...(data.rowGroupList ?? []).map(group => ({ id: `group/${group.id}`, sideList: ['right'] })),
	];
}
