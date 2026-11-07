// The generic matrix card (card-diagram-impl.md#node-registries): rows and columns with
// headers, and a mark where a row and a column meet. It knows nothing of what they are:
// whoever fills it says what a mark means.
//
//   rowList, columnList   [{ id, label, link?, tone? }]; link: a path a click on the header opens
//   cellList              [{ row, column, mark?, title? }]; mark: what the cell shows, a dot by
//                         default; title: what a pointer resting on it reads
//   title?, subtitle?, tone?
//   rowAxisLabel?, columnAxisLabel?   what the corner says the rows and the columns are
//   columnHeadDirection?  vertical (default), for many columns, or horizontal
//   rowHeadWidth?, cellSize?   in pixels
//   isDiagonalMarked?     shade where a row and the column of the same id meet
export const CARD_MATRIX_ROW_HEAD_WIDTH = 220;
export const CARD_MATRIX_CELL_SIZE = 30;
export const CARD_MATRIX_MARK_DEFAULT = '●';

function idListCheck(list, name) {
	if (!Array.isArray(list)) throw new Error(`A matrix needs data.${name}.`);
	const idSet = new Set();
	for (const item of list) {
		if (!item || item.id === undefined || idSet.has(item.id)) throw new Error(`Every item of data.${name} of a matrix needs a unique id.`);
		idSet.add(item.id);
	}
	return idSet;
}

export function cardMatrixNormalize(data) {
	const rowIdSet = idListCheck(data.rowList, 'rowList');
	const columnIdSet = idListCheck(data.columnList, 'columnList');
	for (const cell of data.cellList ?? []) {
		if (!rowIdSet.has(cell?.row) || !columnIdSet.has(cell?.column)) throw new Error(`A cell of a matrix names a row or a column it does not have: ${cell?.row}, ${cell?.column}.`);
	}
	if (data.columnHeadDirection !== undefined && !['vertical', 'horizontal'].includes(data.columnHeadDirection)) throw new Error('data.columnHeadDirection of a matrix is vertical or horizontal.');
	return data;
}

// as wide as its columns, so a generator can place it without drawing it
export function cardMatrixWidthGet(data) {
	return (data.rowHeadWidth ?? CARD_MATRIX_ROW_HEAD_WIDTH) + (data.columnList?.length ?? 0) * (data.cellSize ?? CARD_MATRIX_CELL_SIZE);
}

export function cardMatrixCellOf(data) {
	const cellByKey = new Map();
	for (const cell of data.cellList ?? []) cellByKey.set(`${cell.row}|${cell.column}`, cell);
	return (rowId, columnId) => cellByKey.get(`${rowId}|${columnId}`);
}
