import { cardViewDefaultGet, cardViewRowListGet, cardViewSourceOf } from '../../card-diagram/TableCardData.js';

// Where the cards of an ER diagram are, for a caller with nothing drawn to ask: a generator,
// or an api on a document that is not open. The sizes are what a Dataverse card draws, read
// off the drawn card, and rows and titles wrap by an estimate of the width of their words. It
// stays an estimate, so the result is checked on the drawn diagram
// (card-diagram-usage.md#no-lines-on-top-of-each-other).
const HEIGHT_HEAD = 62;
const HEIGHT_TITLE = 28;
const TABLE_TYPE_LIST = ['table', 'dataverse-table', 'dataverse-choice'];
const HEIGHT_ROW = 33;
const WIDTH_DEFAULT = 410;
const HEIGHT_DEFAULT = 60;
const HEIGHT_BREAK = 24;
const HEIGHT_BREAK_LAST = 32;
const BACKGROUND_TYPE_LIST = ['color-block'];
const DATAVERSE_TYPE_LIST = ['dataverse-table', 'dataverse-choice'];
const DATAVERSE_WIDTH = 400;
const DATAVERSE_TITLE = 36;
const DATAVERSE_TITLE_BADGE = 41;
const DATAVERSE_TITLE_CHOICE = 47;
const DATAVERSE_TITLE_LINE = 23;
const DATAVERSE_FIELD_HEADER = 39;
const DATAVERSE_ROW = 32;
const DATAVERSE_ROW_LINE = 9;
// the room of the words of a card 400 wide, and of a title beside its badge and its logical name
const DATAVERSE_NAME_ROOM = 100;
const DATAVERSE_LOGICAL_ROOM = 110;
const DATAVERSE_TITLE_ROOM = 340;
const DATAVERSE_BADGE_ROOM = 70;
const SCALE_TITLE = 1.25;

// the width of words at the size of a row, by the kind of letter
function widthOfWords(text) {
	let width = 0;
	for (const letter of String(text ?? '')) {
		if (letter.charCodeAt(0) > 0x2e7f) width += 11.5;
		else if ('iljtfr. '.includes(letter)) width += 3.4;
		else if ('mw'.includes(letter)) width += 9;
		else width += 6.1;
	}
	return width;
}

const isDataverse = (node) => DATAVERSE_TYPE_LIST.includes(node.renderer?.type);
const scaleOfWidth = (node) => (typeof node.size?.width === 'number' ? node.size.width : DATAVERSE_WIDTH) / DATAVERSE_WIDTH;

function dataverseRowHeightOf(node, id) {
	const column = (node.data.columns ?? []).find((item) => item.id === id);
	if (!column) return DATAVERSE_ROW;
	const scale = scaleOfWidth(node);
	const lineCount = Math.max(Math.ceil(widthOfWords(column.name) / (DATAVERSE_NAME_ROOM * scale)), Math.ceil(widthOfWords(column.nameLogical) / (DATAVERSE_LOGICAL_ROOM * scale)), 1);
	return DATAVERSE_ROW + (lineCount - 1) * DATAVERSE_ROW_LINE;
}

function dataverseTitleHeightOf(node) {
	const isChoice = node.renderer?.type === 'dataverse-choice';
	const hasBadge = isChoice || Boolean(node.data?.badge);
	const room = DATAVERSE_TITLE_ROOM * scaleOfWidth(node) - (hasBadge ? DATAVERSE_BADGE_ROOM : 0) - widthOfWords(node.data?.nameLogical);
	const isWrapped = widthOfWords(node.data?.name) * SCALE_TITLE > room;
	return (isChoice ? DATAVERSE_TITLE_CHOICE : hasBadge ? DATAVERSE_TITLE_BADGE : DATAVERSE_TITLE) + (isWrapped ? DATAVERSE_TITLE_LINE : 0);
}

const titleHeightOf = (node) => (isDataverse(node) ? dataverseTitleHeightOf(node) : HEIGHT_TITLE);
const headHeightOf = (node) => (isDataverse(node) ? dataverseTitleHeightOf(node) + DATAVERSE_FIELD_HEADER : HEIGHT_HEAD);
// the rows as drawn: rowDisplay chooses and orders them, and a break takes a line of its own.
// a closed break stands for the rows behind it, an open one is a line over them
const rowDrawnListOf = (node) => {
	if (!node.data) return [];
	const view = cardViewDefaultGet(node.data);
	const source = cardViewSourceOf(node.data, node.data.columns ? 'columns' : 'rows');
	const rowOf = (id) => ({ id, height: isDataverse(node) ? dataverseRowHeightOf(node, id) : HEIGHT_ROW });
	return (view.rowDisplay ?? cardViewRowListGet(view, source).map((row) => row.id)).flatMap((entry, index, list) => {
		if (typeof entry === 'string' && entry !== '...') return [rowOf(entry)];
		if (entry?.rowList && entry.isExpanded) return [{ height: HEIGHT_BREAK }, ...entry.rowList.map(rowOf)];
		return [{ idList: entry?.rowList ?? [], height: index === list.length - 1 ? HEIGHT_BREAK_LAST : HEIGHT_BREAK }];
	});
};

export function erGeometryEstimateBuild(diagram, { positionFallback } = {}) {
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	const rectOf = (nodeId) => {
		const node = nodeById.get(nodeId);
		if (!node) return null;
		const position = node.position && node.position !== 'auto' ? node.position : positionFallback;
		if (!position) return null;
		const rowList = rowDrawnListOf(node);
		const width = typeof node.size?.width === 'number' ? node.size.width : WIDTH_DEFAULT;
		const height = typeof node.size?.height === 'number' ? node.size.height : rowList.length ? headHeightOf(node) + rowList.reduce((sum, row) => sum + row.height, 0) : HEIGHT_DEFAULT;
		return { x: position.x, y: position.y, width, height, isBackground: BACKGROUND_TYPE_LIST.includes(node.renderer?.type) };
	};
	const endOf = (connection, role) => {
		const endpoint = connection[role];
		const node = nodeById.get(endpoint?.nodeId);
		const handle = node?.handles?.find((item) => item.id === endpoint.handleId);
		const rect = endpoint?.nodeId ? rectOf(endpoint.nodeId) : null;
		if (!handle || !rect) return null;
		const { side = 'right', target = 'body', offset } = handle.anchor ?? {};
		if (side === 'top' || side === 'bottom') return { x: rect.x + rect.width * (offset ?? 0.5), y: side === 'top' ? rect.y : rect.y + rect.height, side };
		const rowDrawnList = rowDrawnListOf(node);
		const rowIndex = rowDrawnList.findIndex((row) => [row.id, ...(row.idList ?? [])].some((id) => `column/${id}` === target || `row/${id}` === target));
		const y = rowIndex >= 0 ? headHeightOf(node) + rowDrawnList.slice(0, rowIndex).reduce((sum, row) => sum + row.height, 0) + rowDrawnList[rowIndex].height / 2 : target === 'header' || (target === 'body' && (offset ?? 0.5) === 0.5 && TABLE_TYPE_LIST.includes(node.renderer?.type)) ? titleHeightOf(node) / 2 : rect.height * (offset ?? 0.5);
		return { x: side === 'left' ? rect.x : rect.x + rect.width, y: rect.y + y, side };
	};
	return { rectOf, endOf };
}
