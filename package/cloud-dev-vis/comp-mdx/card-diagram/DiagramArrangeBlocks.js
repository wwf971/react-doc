import { diagramGeometryMovedBuild, lineTypeOfConnection } from './DiagramArrange.js';
import { diagramGeometryEstimateBuild } from './DiagramArrangeOutline.js';
import { diagramLaneWidthOf, diagramLinesRoute } from './DiagramArrangeRouter.js';
import { endpointKeyOf } from './DiagramERData.js';
import { routeTypeIsRightAngle } from './DiagramRoute.js';

// The blocks arranger (card-diagram-arrange.md#the-blocks-arranger): blocks of any height, each holding
// cards, stood in columns of one width the way a page of documentation stands its sections: each
// block goes, in its order, where the columns it takes are lowest so far, and the gap between two
// columns is the gap between two blocks of a column.
//
//   ┌ A ────┐  ┌ B ────┐  ┌ C ────┐       A, B, C first, one a column; D to the shortest column (A's),
//   │       │  │       │  │       │       E, two columns wide, where its two columns are lowest
//   └───────┘  │       │  │       │
//   ┌ D ────┐  │       │  └───────┘
//   │       │  └───────┘
//   └───────┘  ┌ E ───────────────┐
//              └──────────────────┘
//
// A block is a background card (its contract says isBackground: a color block); a card belongs to
// the smallest block its rectangle stands in, and moves with it, its place in the block kept. A block
// is one column wide, or as many as its width takes (columnWidth: the width of a column, else the
// narrowest block's; a block of two columns is two columns and the gap between them wide; a block a
// little wider takes one more, so no block stands over the next column). How many
// columns: given (columnCount), else as many as make the whole nearest a shape (aspect: width over
// height), never fewer than the widest block takes.
//
// The lines between cards of two blocks are routed (the lane router, DiagramArrangeRouter.js): out of
// the side of a card facing the other block (both on the right when the two blocks share a column),
// along a lane of the gap between two columns, across the columns between them on a track clear of
// the blocks, into the other card. A line turns laneMargin from a block at least, its lanes
// LANE_SPACING_MIN apart: each gap is as wide as its lanes need so (one gap still at least);
// the handle of an end is turned to face where its line goes, so a caller gives a card a handle per
// side it may be left from, or one per line. A line between two cards of one block is the block's own
// business (its layout routes it): left as it is, as is every line outside connectionIdList.
//
//   options   origin?: { x, y }        the top left of the first column
//             gap?                     px between two columns and between two blocks of a column (32)
//             gapColumn?               px between two columns at least, when they hold lines (gap)
//             columnWidth?             the width of one column; else the narrowest block's
//             columnCount?             the columns; else from aspect (or from columnById)
//             columnById?              { blockId: column }: a block that must stand in a column (the
//                                      columns a page reads through, with lines between them), stacked
//                                      there in its order; the others go where it is lowest
//             aspect?                  the shape aimed at when the count is not given (1.8)
//             blockIdList?             the blocks, in their order; else every background card
//             connectionIdList?        the lines that may be routed; else every right-angled line
//                                      between cards of two blocks
//             laneMargin?              px from a block to the nearest lane of a gap: where a line
//                                      turns, well clear of the block it leaves or enters (40)
//             registry?                for geometryEstimate
const GAP = 32;
const ASPECT = 1.8;
const LANE_MARGIN = 40;
const round = (value) => Math.round(value * 100) / 100;

// Where each block goes, in order: the run of span columns whose highest is lowest so far (the
// leftmost of equals); a block given its column is stacked there. { placeList: [{ column, y }],
// columnHeight }
export function blockColumnPlace(heightList, columnCount, gap = GAP, columnFixedList = [], spanList = []) {
	const columnHeight = Array.from({ length: columnCount }, () => 0);
	const placeList = heightList.map((height, index) => {
		const span = Math.min(columnCount, Math.max(1, spanList[index] ?? 1));
		const fixed = columnFixedList[index];
		const topOf = (start) => Math.max(...columnHeight.slice(start, start + span));
		let column = Number.isInteger(fixed) && fixed >= 0 && fixed + span <= columnCount ? fixed : -1;
		if (column < 0) {
			column = 0;
			for (let start = 1; start + span <= columnCount; start += 1) if (topOf(start) < topOf(column)) column = start;
		}
		const top = topOf(column);
		const y = top === 0 ? 0 : top + gap;
		for (let one = column; one < column + span; one += 1) columnHeight[one] = y + height;
		return { column, y };
	});
	return { placeList, columnHeight };
}

// as many columns as make the blocks nearest the shape asked (width over height): at least the widest
// block's span, never more than every span side by side. sizeList: [{ width, height, span? }]
export function blockColumnCountOf(sizeList, aspect = ASPECT, gap = GAP) {
	const unit = Math.min(...sizeList.map((size) => (size.width + gap) / (size.span ?? 1) - gap));
	const spanList = sizeList.map((size) => size.span ?? 1);
	const countMin = Math.max(1, ...spanList);
	const countMax = Math.max(countMin, spanList.reduce((sum, span) => sum + span, 0));
	let best = countMin;
	let bestScore = Infinity;
	for (let count = countMin; count <= countMax; count += 1) {
		const { columnHeight } = blockColumnPlace(sizeList.map((size) => size.height), count, gap, [], spanList);
		const total = { width: count * unit + (count - 1) * gap, height: Math.max(...columnHeight) };
		const score = Math.abs(Math.log((total.width / Math.max(1, total.height)) / aspect));
		if (score < bestScore - 1e-9) { best = count; bestScore = score; }
	}
	return best;
}

export const diagramArrangerBlocks = {
	id: 'blocks',
	label: 'Blocks in columns',
	description: 'Stands the blocks (background cards) in columns, each where its columns are lowest, with one gap between columns and between blocks; the cards of a block move with it. The lines between cards of two blocks get lanes in the gaps between the columns, each gap as wide as its lanes need.',
	geometryEstimate: (diagram, options) => diagramGeometryEstimateBuild(diagram, options),
	isApplicable: (diagram) => (diagram.nodes ?? []).filter((node) => node.renderer?.type === 'color-block').length >= 2,
	arrange(diagram, geometry, { origin = { x: 0, y: 0 }, gap = GAP, gapColumn, columnWidth, columnCount, columnById = {}, aspect = ASPECT, blockIdList, connectionIdList, laneMargin = LANE_MARGIN } = {}) {
		const nodeList = diagram.nodes ?? [];
		const rectOf = (id) => geometry.rectOf(id);
		const blockList = (blockIdList ?? nodeList.filter((node) => rectOf(node.id)?.isBackground).map((node) => node.id))
			.map((id) => ({ id, rect: rectOf(id) })).filter((one) => one.rect);
		if (blockList.length === 0) return { reportList: [{ kind: 'skipped', message: 'no block to arrange: a block is a background card' }] };
		// the cards of each block: the smallest block a card's rectangle stands in
		const blockIdSet = new Set(blockList.map((one) => one.id));
		const memberById = new Map(blockList.map((one) => [one.id, []]));
		const blockOfNode = new Map(blockList.map((one) => [one.id, one.id]));
		const isInside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
		for (const node of nodeList) {
			if (blockIdSet.has(node.id)) continue;
			const rect = rectOf(node.id);
			if (!rect) continue;
			const holder = blockList.filter((one) => isInside(rect, one.rect)).sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
			if (holder) {
				memberById.get(holder.id).push({ id: node.id, rect });
				blockOfNode.set(node.id, holder.id);
			}
		}
		// the columns: one width; a block as many wide as its width takes
		const unit = columnWidth ?? Math.min(...blockList.map((one) => one.rect.width));
		const spanList = blockList.map((one) => Math.max(1, Math.ceil((one.rect.width + gap) / (unit + gap) - 0.02)));
		const columnFixedList = blockList.map((one) => columnById[one.id]);
		const columnFixedMax = Math.max(-1, ...columnFixedList.filter(Number.isInteger).map((column, index) => column + spanList[index] - 1));
		const countAsked = columnCount ?? (columnFixedMax >= 0 ? 0 : blockColumnCountOf(blockList.map((one, index) => ({ ...one.rect, span: spanList[index] })), aspect, gap));
		const count = Math.max(1, columnFixedMax + 1, ...spanList, countAsked);
		const { placeList } = blockColumnPlace(blockList.map((one) => one.rect.height), count, gap, columnFixedList, spanList);
		// the lines between cards of two blocks, and which side of its card each end faces: toward the
		// other block, both on the right when their blocks share a column
		const idSet = connectionIdList ? new Set(connectionIdList) : null;
		const nodeById = new Map(nodeList.map((node) => [node.id, node]));
		const columnOfBlock = new Map(blockList.map((one, index) => [one.id, { left: placeList[index].column, right: placeList[index].column + spanList[index] - 1 }]));
		const lineList = (diagram.connections ?? []).flatMap((connection) => {
			if (idSet && !idSet.has(connection.id)) return [];
			if (!routeTypeIsRightAngle(lineTypeOfConnection(diagram, connection))) return [];
			const sourceBlock = blockOfNode.get(connection.source?.nodeId);
			const targetBlock = blockOfNode.get(connection.target?.nodeId);
			if (!sourceBlock || !targetBlock || sourceBlock === targetBlock) return [];
			const source = columnOfBlock.get(sourceBlock);
			const target = columnOfBlock.get(targetBlock);
			const side = source.right < target.left ? ['right', 'left'] : source.left > target.right ? ['left', 'right'] : ['right', 'right'];
			const gapOf = (column, at) => (at === 'right' ? column.right + 1 : column.left);
			return [{ connection, sourceBlock, targetBlock, side, gapList: [gapOf(source, side[0]), gapOf(target, side[1])] }];
		});
		// each gap as wide as its lanes need, laneMargin from the blocks at its sides: a line into one
		// gap has one lane there, a line across columns one lane in each gap at its ends
		const laneCountByGap = new Map();
		for (const { gapList } of lineList) for (const one of new Set(gapList)) laneCountByGap.set(one, (laneCountByGap.get(one) ?? 0) + 1);
		const gapWidthOf = (index) => Math.max(gapColumn ?? gap, diagramLaneWidthOf(laneCountByGap.get(index) ?? 0, laneMargin));
		const xOfColumn = [origin.x];
		for (let column = 1; column < count; column += 1) xOfColumn.push(xOfColumn[column - 1] + unit + gapWidthOf(column));
		const positionById = {};
		blockList.forEach((block, index) => {
			const { column, y } = placeList[index];
			const at = { x: round(xOfColumn[column]), y: round(origin.y + y) };
			positionById[block.id] = at;
			for (const member of memberById.get(block.id)) positionById[member.id] = { x: round(at.x + member.rect.x - block.rect.x), y: round(at.y + member.rect.y - block.rect.y) };
		});
		if (lineList.length === 0) return { positionById, reportList: [] };
		// the handles turned to face where their lines go: the first line of a handle decides
		const handleSideList = [];
		const sideByHandle = new Map();
		for (const { connection, side } of lineList) {
			['source', 'target'].forEach((role, roleIndex) => {
				const { nodeId, handleId } = connection[role];
				const key = `${nodeId}/${handleId}`;
				const handle = nodeById.get(nodeId)?.handles?.find((one) => one.id === handleId);
				if (!handle || sideByHandle.has(key)) return;
				sideByHandle.set(key, side[roleIndex]);
				if ((handle.anchor?.side ?? 'right') !== side[roleIndex]) handleSideList.push({ nodeId, handleId, side: side[roleIndex] });
			});
		}
		// routed where the blocks will be: the blocks are what a line keeps clear of, and their columns the router's
		const geometryMoved = diagramGeometryMovedBuild(geometry, positionById, handleSideList);
		const rectList = blockList.map((one) => ({ ...geometryMoved.rectOf(one.id), id: one.id, isBackground: false }));
		const routerLineList = lineList.flatMap(({ connection, sourceBlock, targetBlock }) => {
			const source = geometryMoved.endOf(connection, 'source');
			const target = geometryMoved.endOf(connection, 'target');
			return source && target ? [{ id: connection.id, type: lineTypeOfConnection(diagram, connection), source, target, sourceNodeId: sourceBlock, targetNodeId: targetBlock, sourceKey: endpointKeyOf(connection.source), targetKey: endpointKeyOf(connection.target) }] : [];
		});
		const { routeById, reportList } = diagramLinesRoute({ rectList, lineList: routerLineList, measureType: 'step', laneMargin });
		return { positionById, handleSideList, routeById, reportList };
	},
};
