import { cardViewNormalize, cardViewSourceOf } from '../card-diagram/TableCardData.js';

export function dataverseCardNormalize(data = {}) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Card data must be a mapping.');
	if (!Array.isArray(data.columns)) throw new Error('Card columns must be a list.');
	const ids = new Set();
	const columns = data.columns.map((column) => {
		if (!column || typeof column.id !== 'string' || !column.id.trim()) throw new Error('Column id must be a non-empty string.');
		if (ids.has(column.id)) throw new Error(`Duplicate column id "${column.id}".`);
		ids.add(column.id);
		return {
			...column,
			name: String(column.name || column.id),
			nameLogical: String(column.nameLogical || ''),
			type: String(column.type || ''),
			key: String(column.key || '').trim().toUpperCase(),
			description: String(column.description || ''),
			isRequired: Boolean(column.isRequired),
		};
	});
	// the records of the table, for its views: { id, <column id>: value }
	if (data.rows !== undefined && !Array.isArray(data.rows)) throw new Error('Card rows must be a list.');
	const recordIds = new Set();
	const rows = data.rows?.map((record) => {
		if (!record || typeof record.id !== 'string' || !record.id.trim()) throw new Error('A record id must be a non-empty string.');
		if (recordIds.has(record.id)) throw new Error(`Duplicate record id "${record.id}".`);
		recordIds.add(record.id);
		return record;
	});
	const dataNext = {
		...data,
		name: String(data.name || data.id || ''),
		nameLogical: String(data.nameLogical || ''),
		description: String(data.description || ''),
		columns,
		...(rows ? { rows } : {}),
	};
	return { ...dataNext, ...cardViewNormalize(dataNext, cardViewSourceOf(dataNext, 'columns')) };
}

// a table card has no handle on its title line: handles belong to its rows
// (card-diagram-impl.md#handles-and-anchors)
export function dataverseAnchorListGet(data) {
	return [
		{ id: 'body', sideList: ['left', 'right', 'top', 'bottom'] },
		...data.columns.map(column => ({ id: `column/${column.id}`, sideList: ['left', 'right'] })),
		...(data.rows ?? []).map(record => ({ id: `row/${record.id}`, sideList: ['left', 'right'] })),
	];
}

// a choice card is referenced as a whole: connections attach to its header
export function dataverseChoiceAnchorListGet(data) {
	return [...dataverseAnchorListGet(data), { id: 'header', sideList: ['left', 'right'] }];
}

