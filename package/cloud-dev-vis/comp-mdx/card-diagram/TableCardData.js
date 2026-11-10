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
//     rowDisplay?: which rows the card shows, in which order, with row breaks where rows are
//       left out (cardRowDisplayNormalize below); without it, all of them as they stand
//     viewList?, viewDefault?, isViewSwitcherHidden?: its views (cardViewNormalize below)
//     rowGroupList?: [{ id, rowFrom, rowTo, label?, tone? }]
//       rows of the card taken together: a bracket beside them, on the right edge
//       of the card, with an anchor group/<id> a line can leave from. what a
//       table split into batches is drawn with
export const tableCardFieldListDefault = [{ id: 'name', label: 'Name' }, { id: 'value', label: 'Value' }];

// The rows a card shows (../power-platform/comp-diagram-er.md#choosing-rows): a list of what to draw from
// top to bottom, of any card whose rows are data of its own, whatever a row means there.
//
//   rowDisplay: [accountid, '...', status, { break: 12 columns }, modifiedon]
//
//   an id          that row. a row may be left out, and come in another order
//   '...'          a row break: the mark an axis has where part of it is cut away
//   { break: text }  a row break saying what was cut
//   { break?: text, rowList: [ids], isExpanded? }   a row break with rows behind it: the reader
//                  opens it to see them, and closes it again. closed at first unless isExpanded
//
// the rows stay in the data whole: this says only what is drawn, and the editor shows them all
export const CARD_ROW_BREAK = '...';

export function cardRowDisplayNormalize(rowDisplay, rowList) {
	if (rowDisplay === undefined || rowDisplay === null) return undefined;
	if (!Array.isArray(rowDisplay)) throw new Error('rowDisplay must be a list.');
	const idSet = new Set(rowList.map((row) => row.id));
	const seen = new Set();
	const idTake = (value) => {
		const id = String(value);
		if (!idSet.has(id)) throw new Error(`rowDisplay names "${id}", which is not a row.`);
		if (seen.has(id)) throw new Error(`rowDisplay names "${id}" twice.`);
		seen.add(id);
		return id;
	};
	return rowDisplay.map((entry) => {
		if (entry === CARD_ROW_BREAK) return entry;
		if (entry && typeof entry === 'object') {
			if (entry.rowList !== undefined) {
				if (!Array.isArray(entry.rowList) || entry.rowList.length === 0) throw new Error('rowList of a row break must list the rows behind it.');
				if (entry.isExpanded !== undefined && typeof entry.isExpanded !== 'boolean') throw new Error('isExpanded of a row break must be a boolean.');
				return { break: String(entry.break ?? ''), rowList: entry.rowList.map(idTake), ...(entry.isExpanded === undefined ? {} : { isExpanded: entry.isExpanded }) };
			}
			if (entry.break === undefined) throw new Error('A rowDisplay entry is a row id, "...", { break: text } or { break: text, rowList: [ids] }.');
			return { break: String(entry.break) };
		}
		return idTake(entry);
	});
}

// the rows a list draws or holds behind a row break: every one of them is shown, not left out
export function cardRowDisplayIdListOf(rowDisplay) {
	return (rowDisplay ?? []).flatMap((entry) => (entry === CARD_ROW_BREAK ? [] : typeof entry === 'object' ? entry.rowList ?? [] : [entry]));
}

// a list without a row. a row break losing its last row stays, as a mark that holds nothing
export function cardRowDisplayWithout(rowDisplay, rowId) {
	return rowDisplay.flatMap((entry) => {
		if (entry === rowId) return [];
		if (typeof entry !== 'object' || !entry.rowList?.includes(rowId)) return [entry];
		const rowList = entry.rowList.filter((id) => id !== rowId);
		if (rowList.length > 0) return [{ ...entry, rowList }];
		return [entry.break ? { break: entry.break } : CARD_ROW_BREAK];
	});
}

// what is drawn: [{ row }, { break: { id, text, rowList?, isExpanded? } }], from what
// cardRowDisplayNormalize kept
export function cardRowDisplayItemListGet(rowDisplay, rowList) {
	if (!rowDisplay) return rowList.map((row) => ({ row }));
	const rowById = new Map(rowList.map((row) => [row.id, row]));
	return rowDisplay.map((entry, index) => {
		if (entry === CARD_ROW_BREAK) return { break: { id: `~break-${index}`, index, text: '' } };
		if (typeof entry === 'object') return { break: { id: `~break-${index}`, index, text: entry.break, ...(entry.rowList ? { rowList: entry.rowList.map((id) => rowById.get(id)), isExpanded: entry.isExpanded === true } : {}) } };
		return { row: rowById.get(entry) };
	});
}

// The views of a table card (../power-platform/comp-diagram-er.md#table-card-views): a card has one or more views,
// each of a view mode, and shows one at a time.
//
//   viewList?: [{ id, label?, mode, ...its parameters }]
//     plain    the rows of the card as they are     rowDisplay?
//     column   a visual row per column of the table rowDisplay? (of columns), valueRowId? (a
//                                                   record whose values stand beside them),
//                                                   labelColumn?, labelValue?, columnTemplate?
//     row      a visual row per record              rowDisplay? (of records), fieldDisplay? (the
//                                                   columns, in order), columnTemplate?
//   viewDefault?   the id of the view shown first; else the first one
//   isViewSwitcherHidden?   the menu of views on the title line; shown when views are declared,
//                  not clickable with only one of them, hidden by default without any
//
// a card declaring none has one view, plain, whose rowDisplay is the card's own. a card
// declaring some has those, plain only if it is one of them.
export const CARD_VIEW_MODE_LIST = ['plain', 'column', 'row'];
export const CARD_VIEW_MODE_LABEL = { plain: 'Plain', column: 'Column', row: 'Row' };
export const CARD_VIEW_PLAIN_ID = 'plain';

// what the views of a card are drawn from. a table's columns are its fields, or a Dataverse
// card's columns; its records are its rows. rowListKey: where the card's own rows are
export function cardViewSourceOf(data, rowListKey) {
	return {
		rowList: data?.[rowListKey] ?? [],
		columnList: (data?.fields ?? data?.columns ?? []).map((column) => ({ ...column, label: column.label ?? column.name ?? column.id })),
		recordList: data?.rows ?? [],
	};
}

// the rows a view chooses among
export function cardViewRowListGet(view, source) {
	return view.mode === 'column' ? source.columnList : view.mode === 'row' ? source.recordList : source.rowList;
}

// the views of a card, a card declaring none having its plain view
export function cardViewListGet(data) {
	if (data?.viewList?.length) return data.viewList;
	return [{ id: CARD_VIEW_PLAIN_ID, label: CARD_VIEW_MODE_LABEL.plain, mode: 'plain', rowDisplay: data?.rowDisplay, isImplicit: true }];
}

export function cardViewDefaultGet(data) {
	const viewList = cardViewListGet(data);
	return viewList.find((view) => view.id === data?.viewDefault) ?? viewList[0];
}

export const cardViewLabelOf = (view) => view.label ?? view.id;

// whether the menu of views stands on the title line
export const cardViewSwitcherIsShown = (data) => (data?.isViewSwitcherHidden === undefined ? Boolean(data?.viewList?.length) : !data.isViewSwitcherHidden);

// what a view draws: the fields across, the items down (cardRowDisplayItemListGet), and the
// prefix of the anchor of a row. fieldListPlain: the fields of the card, for a plain view
export function cardViewDrawBuild(view, source, fieldListPlain) {
	if (view.mode === 'column') {
		const record = source.recordList.find((item) => item.id === view.valueRowId);
		const rowList = source.columnList.map((column) => ({ id: column.id, tone: column.tone, '~column': column.label, '~value': record ? String(record[column.id] ?? '') : '' }));
		const fieldList = [{ id: '~column', label: view.labelColumn ?? 'Column' }, ...(record ? [{ id: '~value', label: view.labelValue ?? 'Value' }] : [])];
		return { isPlain: false, fieldList, rowList, itemList: cardRowDisplayItemListGet(view.rowDisplay, rowList), anchorPrefix: 'column', columnTemplate: view.columnTemplate ?? (record ? '1fr 1.2fr' : '1fr') };
	}
	if (view.mode === 'row') {
		const fieldList = (view.fieldDisplay ?? source.columnList.map((column) => column.id)).map((id) => source.columnList.find((column) => column.id === id)).filter(Boolean);
		return { isPlain: false, fieldList, rowList: source.recordList, itemList: cardRowDisplayItemListGet(view.rowDisplay, source.recordList), anchorPrefix: 'row', columnTemplate: view.columnTemplate ?? `repeat(${fieldList.length}, minmax(0, 1fr))` };
	}
	return { isPlain: true, fieldList: fieldListPlain, rowList: source.rowList, itemList: cardRowDisplayItemListGet(view.rowDisplay, source.rowList) };
}

// the part of a card's normalized data about its views
export function cardViewNormalize(data, source) {
	const { viewList, viewDefault, isViewSwitcherHidden } = data;
	if (isViewSwitcherHidden !== undefined && typeof isViewSwitcherHidden !== 'boolean') throw new Error('isViewSwitcherHidden must be boolean.');
	if (viewList === undefined || viewList === null || (Array.isArray(viewList) && viewList.length === 0)) {
		if (viewDefault !== undefined && viewDefault !== CARD_VIEW_PLAIN_ID) throw new Error(`viewDefault names "${viewDefault}", which is not a view.`);
		return { viewList: undefined, rowDisplay: cardRowDisplayNormalize(data.rowDisplay, source.rowList) };
	}
	if (!Array.isArray(viewList)) throw new Error('viewList must be a list.');
	if (data.rowDisplay !== undefined && data.rowDisplay !== null) throw new Error('A card with views says rowDisplay in each view.');
	const idSet = new Set();
	const viewListNext = viewList.map((view) => {
		if (!view || typeof view.id !== 'string' || !view.id.trim()) throw new Error('A view needs an id.');
		if (idSet.has(view.id)) throw new Error(`Duplicate view id "${view.id}".`);
		idSet.add(view.id);
		if (!CARD_VIEW_MODE_LIST.includes(view.mode)) throw new Error(`View "${view.id}": the mode must be one of ${CARD_VIEW_MODE_LIST.join(', ')}.`);
		if (view.mode === 'row' && !source.recordList.length) throw new Error(`View "${view.id}": a row view needs the records of the table, in rows.`);
		if (view.mode === 'column' && !source.columnList.length) throw new Error(`View "${view.id}": a column view needs the columns of the table.`);
		if (view.mode !== 'column' && view.valueRowId !== undefined) throw new Error(`View "${view.id}": valueRowId belongs to a column view.`);
		if (view.mode !== 'row' && view.fieldDisplay !== undefined) throw new Error(`View "${view.id}": fieldDisplay belongs to a row view.`);
		if (view.valueRowId !== undefined && !source.recordList.some((record) => record.id === view.valueRowId)) throw new Error(`View "${view.id}": valueRowId names "${view.valueRowId}", which is not a record.`);
		if (view.fieldDisplay !== undefined) {
			if (!Array.isArray(view.fieldDisplay) || !view.fieldDisplay.length) throw new Error(`View "${view.id}": fieldDisplay must be a list of columns.`);
			for (const id of view.fieldDisplay) if (!source.columnList.some((column) => column.id === id)) throw new Error(`View "${view.id}": fieldDisplay names "${id}", which is not a column.`);
		}
		let rowDisplay;
		try {
			rowDisplay = cardRowDisplayNormalize(view.rowDisplay, cardViewRowListGet(view, source));
		} catch (error) {
			throw new Error(`View "${view.id}": ${error.message}`);
		}
		return { ...view, label: String(view.label ?? view.id), rowDisplay };
	});
	if (viewDefault !== undefined && !idSet.has(viewDefault)) throw new Error(`viewDefault names "${viewDefault}", which is not a view.`);
	return { viewList: viewListNext, rowDisplay: undefined };
}

// the views after something they name is gone: a row of the card, a column, a record
export function cardViewListPrune(viewList, { plainId, columnId, recordId }) {
	const without = (list, id) => (list && id !== undefined ? cardRowDisplayWithout(list, id) : list);
	return viewList.map((view) => {
		const removed = view.mode === 'plain' ? plainId : view.mode === 'column' ? columnId : recordId;
		const { rowDisplay, fieldDisplay, valueRowId, ...rest } = view;
		const rowDisplayNext = without(rowDisplay, removed);
		const fieldDisplayNext = without(fieldDisplay, columnId);
		return {
			...rest,
			...(rowDisplayNext ? { rowDisplay: rowDisplayNext } : {}),
			...(fieldDisplayNext?.length ? { fieldDisplay: fieldDisplayNext } : {}),
			...(valueRowId !== undefined && valueRowId !== recordId ? { valueRowId } : {}),
		};
	});
}

// a rowDisplay keeping some rows, in the order they stand, with a row break for each run of
// rows left out. textOf(count): what a row break says, if anything. isFoldable: the rows left out
// stand behind their row break, for the reader to open. for what generates diagrams
export function cardRowDisplayKeepBuild(rowIdList, keepIdList, { textOf, isFoldable = false } = {}) {
	const keepSet = new Set(keepIdList);
	const list = [];
	let idLeftList = [];
	const breakAdd = () => {
		if (idLeftList.length === 0) return;
		const text = textOf?.(idLeftList.length);
		if (isFoldable) list.push({ ...(text ? { break: text } : {}), rowList: idLeftList });
		else list.push(text ? { break: text } : CARD_ROW_BREAK);
		idLeftList = [];
	};
	for (const id of rowIdList) {
		if (keepSet.has(id)) {
			breakAdd();
			list.push(id);
		} else idLeftList.push(id);
	}
	breakAdd();
	return list;
}

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
	const rows = (data.rows ?? []).map((row) => {
		if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim()) throw new Error('Row id must be a non-empty string.');
		if (rowIds.has(row.id)) throw new Error(`Duplicate row id "${row.id}".`);
		rowIds.add(row.id);
		const result = { ...row };
		for (const field of fields) result[field.id] = row[field.id] === undefined || row[field.id] === null ? '' : String(row[field.id]);
		return result;
	});
	return {
		...data,
		rowGroupList,
		...cardViewNormalize(data, cardViewSourceOf({ ...data, fields, rows }, 'rows')),
		name: String(data.name || data.id || ''),
		nameLogical: String(data.nameLogical || ''),
		description: String(data.description || ''),
		isHeaderHandleEnabled: data.isHeaderHandleEnabled === true,
		fields,
		rows,
	};
}

export function tableCardAnchorListGet(data) {
	return [
		{ id: 'body', sideList: ['left', 'right', 'top', 'bottom'] },
		...data.rows.map(row => ({ id: `row/${row.id}`, sideList: ['left', 'right'] })),
		...(data.viewList?.some(view => view.mode === 'column') ? data.fields.map(field => ({ id: `column/${field.id}`, sideList: ['left', 'right'] })) : []),
		...(data.isHeaderHandleEnabled ? [{ id: 'header', sideList: ['left', 'right'] }] : []),
		...(data.rowGroupList ?? []).map(group => ({ id: `group/${group.id}`, sideList: ['right'] })),
	];
}
