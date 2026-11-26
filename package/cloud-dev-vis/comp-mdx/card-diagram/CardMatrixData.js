// The generic matrix card (card-diagram-impl.md#node-registries): rows and columns with
// headers, and a mark where a row and a column meet. It knows nothing of what they are:
// whoever fills it says what a mark means.
//
//   rowList, columnList   [{ id, label, title?, link?, tone?, isGroupStart?, band? }]; link: a path a click on the header
//                         opens; title: what a pointer resting on the header reads (its label without one);
//                         isGroupStart: a thick line before it, dividing the rows (or the columns) into groups;
//                         band: { id, tone }, its row (or column) shaded across the matrix in the tone; where a
//                         row and a column of the same band cross, shaded lighter (cardMatrixBandOf): a band of
//                         rows and of columns reads as a cross
//   cellList              [{ row, column, mark?, title?, link?, tone? }]; mark: small words beside the dot,
//                         which stays in the middle of the cell, a count say; title: what a pointer resting on it reads; link:
//                         a path a click on the cell opens; tone: the cell filled in a tone and its dot in it, so cells read
//                         as a heatmap (a state per cell, say)
//   title?, subtitle?, tone?
//   rowAxisLabel?, columnAxisLabel?   what the corner says the rows and the columns are
//   columnHeadDirection?  vertical (default), for many columns, or horizontal
//   rowHeadWidth?, cellSize?   in pixels
//   isDiagonalMarked?     shade where a row and the column of the same id meet
export const CARD_MATRIX_ROW_HEAD_WIDTH = 220;
export const CARD_MATRIX_CELL_SIZE = 30;
export const CARD_MATRIX_TONE_LIST = ['blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'];

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
	for (const item of [...data.rowList, ...data.columnList]) {
		if (item.band === undefined || item.band === null) continue;
		if (typeof item.band !== 'object' || item.band.id === undefined || !CARD_MATRIX_TONE_LIST.includes(item.band.tone)) {
			throw new Error(`The band of a row or a column of a matrix is { id, tone }, its tone one of ${CARD_MATRIX_TONE_LIST.join(', ')}: ${item.id}.`);
		}
	}
	for (const cell of data.cellList ?? []) {
		if (!rowIdSet.has(cell?.row) || !columnIdSet.has(cell?.column)) throw new Error(`A cell of a matrix names a row or a column it does not have: ${cell?.row}, ${cell?.column}.`);
		if (cell.tone !== undefined && !CARD_MATRIX_TONE_LIST.includes(cell.tone)) throw new Error(`The tone of a cell of a matrix is one of ${CARD_MATRIX_TONE_LIST.join(', ')}: ${cell.tone}.`);
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

// the band a cell is shaded by: { tone, isCross } (isCross: its row and its column of one band, the lighter
// middle of a cross), or null
export function cardMatrixBandOf(row, column) {
	const rowBand = row?.band ?? null;
	const columnBand = column?.band ?? null;
	if (rowBand && columnBand && rowBand.id === columnBand.id) return { tone: rowBand.tone, isCross: true };
	const band = rowBand ?? columnBand;
	return band ? { tone: band.tone, isCross: false } : null;
}
