// Where the cards of an ER diagram are, for a caller with nothing drawn to ask: a generator,
// or an api on a document that is not open. The sizes are the ones a table card draws when
// nothing wraps; a wrapped row makes the real card taller, so the result is checked on the
// drawn diagram (card-diagram-usage.md#no-lines-on-top-of-each-other).
const HEIGHT_HEAD = 62;
const HEIGHT_ROW = 33;
const WIDTH_DEFAULT = 410;
const HEIGHT_DEFAULT = 60;
const BACKGROUND_TYPE_LIST = ['color-block'];
const rowListOf = (node) => node.data?.columns ?? node.data?.rows ?? [];

export function erGeometryEstimateBuild(diagram, { positionFallback } = {}) {
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	const rectOf = (nodeId) => {
		const node = nodeById.get(nodeId);
		if (!node) return null;
		const position = node.position && node.position !== 'auto' ? node.position : positionFallback;
		if (!position) return null;
		const rowList = rowListOf(node);
		const width = typeof node.size?.width === 'number' ? node.size.width : WIDTH_DEFAULT;
		const height = typeof node.size?.height === 'number' ? node.size.height : rowList.length ? HEIGHT_HEAD + HEIGHT_ROW * rowList.length : HEIGHT_DEFAULT;
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
		const rowIndex = rowListOf(node).findIndex((row) => `column/${row.id}` === target || `row/${row.id}` === target);
		const y = rowIndex >= 0 ? HEIGHT_HEAD + HEIGHT_ROW * (rowIndex + 0.5) : target === 'header' ? HEIGHT_HEAD / 2 : rect.height * (offset ?? 0.5);
		return { x: side === 'left' ? rect.x : rect.x + rect.width, y: rect.y + y, side };
	};
	return { rectOf, endOf };
}
