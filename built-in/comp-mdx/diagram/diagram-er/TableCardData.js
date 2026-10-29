// The generic table node (renderer type `table`): a titled card whose rows and
// fields are both authored. The Dataverse and resource cards are variants of
// the same card with fixed fields (TableCardSchema.js).
//
//   data
//     name, nameLogical?, description?
//     isHeaderHandleEnabled?   handles may sit on the title line (off by default)
//     fields: [{ id, label }]  the columns of the card, in order
//     rows:   [{ id, <fieldId>: text ... }]
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
	return {
		...data,
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
	];
}
