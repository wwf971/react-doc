export function dataverseCardNormalize(data = {}) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Card data must be a mapping.');
	if (!Array.isArray(data.columns) || !data.columns.length) throw new Error('Card columns must be a non-empty list.');
	const ids = new Set();
	return {
		...data,
		name: String(data.name || data.id || ''),
		nameLogical: String(data.nameLogical || ''),
		description: String(data.description || ''),
		columns: data.columns.map((column) => {
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
		}),
	};
}

export function dataverseAnchorListGet(data) {
	return [
		{ id: 'body', sideList: ['left', 'right', 'top', 'bottom'] },
		...data.columns.map(column => ({ id: `column/${column.id}`, sideList: ['left', 'right'] })),
		{ id: 'header', sideList: ['left', 'right'] },
	];
}