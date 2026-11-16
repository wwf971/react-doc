// An arranger for a flow of cards (the contract: package cloud-dev-vis,
// doc/card-diagram-arrange.md): steps joined by lines, laid out in ranks from left to right,
// the ranks wrapping into bands so a long chain turns downward instead of running on. The
// scenes of a zettelkasten are generated from data nobody arranges by hand, so their layout
// is this rule, run again whenever the data changes. It knows nothing of zettels: it reads
// nodes and connections.
//
//   rank      the longest way from a step without a line arriving (a loop back is ignored)
//   band      ranksPerBand ranks side by side; the next band lies below
//   in a rank the cards one under another, ordered by where their neighbours of the rank before
//             stand, the rank centered on the middle of its band
//   handles   a line to a later rank of the same band leaves right and arrives left; a line
//             into another band, or back, leaves the bottom and arrives at the top
//
// the lines are curves (bezier), which fan out of a card without sharing a stretch.

const NOTE_PADDING_Y = 10;
const NOTE_LINE_TITLE = 14;
const NOTE_LINE_TEXT = 13;
const NOTE_CHAR_TITLE = 6.2;
const NOTE_CHAR_TEXT = 5.4;

const lineCountOf = (text, width, charWidth) => {
	const perLine = Math.max(8, Math.floor((width - 18) / charWidth));
	// words wrap, so a line holds a little less than its width in letters
	return String(text ?? '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * 1.08) / perLine)), 0);
};

// the height a zettel card (ZettelKinds.jsx) draws at: its bar, then its summary cut to a few
// lines (the card clamps it to the same count, so a height written from this always holds it)
export const ZETTEL_MINI_BAR = 30;
export const ZETTEL_MINI_LINE = 15;
export const ZETTEL_MINI_LINE_MAX = { compact: 0, normal: 3, center: 7 };
export function zettelMiniHeightEstimate(node) {
	const data = node.data ?? {};
	const width = typeof node.size?.width === 'number' ? node.size.width : 220;
	const size = data.size ?? 'normal';
	if (size === 'compact') return ZETTEL_MINI_BAR + 2;
	let height = 2;
	if (size === 'center') {
		const perTitle = Math.max(10, Math.floor((width - 46) / 7.6));
		height += 14 + Math.min(3, Math.ceil((String(data.title ?? '').length * 1.06) / perTitle)) * 18;
	} else height += ZETTEL_MINI_BAR;
	if (data.text) height += Math.min(ZETTEL_MINI_LINE_MAX[size], lineCountOf(data.text, width + 4, 5.75)) * ZETTEL_MINI_LINE + 9;
	if (data.statList?.length) height += 24;
	return height;
}

// the height a compact card will draw at, from its words: an estimate, on the tall side
export function zettelCardHeightEstimate(node) {
	const width = typeof node.size?.width === 'number' ? node.size.width : 200;
	const data = node.data ?? {};
	const type = node.renderer?.type;
	if (typeof node.size?.height === 'number') return node.size.height;
	if (type === 'zettel-card') return zettelMiniHeightEstimate(node);
	if (type === 'card-brief' || type === 'scene-link') return data.statList?.length ? 44 : 38;
	if (type === 'card-three-dots') return 40;
	const titleText = `${data.title ?? ''}${data.tag ? `  ${data.tag}` : ''}`;
	let height = NOTE_PADDING_Y + lineCountOf(titleText, width, NOTE_CHAR_TITLE) * NOTE_LINE_TITLE;
	if (data.text) height += 2 + lineCountOf(data.text, width, NOTE_CHAR_TEXT) * NOTE_LINE_TEXT;
	if (data.metaList?.length) height += 26;
	return height;
}

function geometryEstimate(diagram) {
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	const rectOf = (nodeId) => {
		const node = nodeById.get(nodeId);
		if (!node) return null;
		return { x: node.position?.x ?? 0, y: node.position?.y ?? 0, width: typeof node.size?.width === 'number' ? node.size.width : 200, height: zettelCardHeightEstimate(node), isBackground: node.renderer?.type === 'color-block' };
	};
	const endOf = (connection, role) => {
		const rect = rectOf(connection[role].nodeId);
		if (!rect) return null;
		const side = nodeById.get(connection[role].nodeId)?.handles?.find((handle) => handle.id === connection[role].handleId)?.anchor?.side ?? (role === 'source' ? 'right' : 'left');
		if (side === 'left' || side === 'right') return { x: side === 'left' ? rect.x : rect.x + rect.width, y: rect.y + rect.height / 2, side };
		return { x: rect.x + rect.width / 2, y: side === 'top' ? rect.y : rect.y + rect.height, side };
	};
	return { rectOf, endOf };
}

// the rank of every node: the longest way from a source, lines closing a loop left out
export function zettelFlowRankBuild(nodeIdList, edgeList) {
	const outByNode = new Map(nodeIdList.map((id) => [id, []]));
	for (const edge of edgeList) if (outByNode.has(edge.from) && outByNode.has(edge.to)) outByNode.get(edge.from).push(edge.to);
	const rankById = new Map();
	const stateById = new Map();
	const backSet = new Set();
	// depth first, to find the lines that close a loop
	const visit = (id) => {
		stateById.set(id, 'open');
		for (const next of outByNode.get(id)) {
			if (stateById.get(next) === 'open') backSet.add(`${id}\u0000${next}`);
			else if (!stateById.has(next)) visit(next);
		}
		stateById.set(id, 'done');
	};
	for (const id of nodeIdList) if (!stateById.has(id)) visit(id);
	const rankOf = (id) => {
		if (rankById.has(id)) return rankById.get(id);
		rankById.set(id, 0);
		let rank = 0;
		for (const edge of edgeList) {
			if (edge.to !== id || !outByNode.has(edge.from) || backSet.has(`${edge.from}\u0000${edge.to}`) || edge.from === id) continue;
			rank = Math.max(rank, rankOf(edge.from) + 1);
		}
		rankById.set(id, rank);
		return rank;
	};
	for (const id of nodeIdList) rankOf(id);
	return rankById;
}

export const zettelArrangerFlow = {
	id: 'zettel-flow',
	label: 'Flow in ranks',
	description: 'Steps in ranks from left to right, the ranks wrapping into bands; lines leave right and arrive left, or bottom to top between bands.',
	geometryEstimate,
	// options: { nodeIdList?: the cards arranged (the rest stay), origin?, ranksPerBand = 4, gapX = 90, gapY = 26, gapBand = 70 }
	arrange(diagram, geometry, { nodeIdList, origin = { x: 0, y: 0 }, ranksPerBand = 4, gapX = 90, gapY = 26, gapBand = 70 } = {}) {
		const idList = nodeIdList ?? (diagram.nodes ?? []).filter((node) => node.renderer?.type !== 'color-block').map((node) => node.id);
		const idSet = new Set(idList);
		const connectionList = (diagram.connections ?? []).filter((connection) => idSet.has(connection.source.nodeId) && idSet.has(connection.target.nodeId));
		const edgeList = connectionList.map((connection) => ({ from: connection.source.nodeId, to: connection.target.nodeId }));
		const rankById = zettelFlowRankBuild(idList, edgeList);
		const rankCount = Math.max(0, ...rankById.values()) + 1;
		const idListByRank = Array.from({ length: rankCount }, () => []);
		for (const id of idList) idListByRank[rankById.get(id)].push(id);
		// the order in a rank: by the mean place of the neighbours in the rank before
		const orderById = new Map();
		idListByRank.forEach((list, rank) => {
			if (rank > 0) {
				const meanOf = (id) => {
					const placeList = edgeList.filter((edge) => edge.to === id && rankById.get(edge.from) < rank && orderById.has(edge.from)).map((edge) => orderById.get(edge.from));
					return placeList.length > 0 ? placeList.reduce((sum, place) => sum + place, 0) / placeList.length : Number.MAX_SAFE_INTEGER;
				};
				const mean = new Map(list.map((id) => [id, meanOf(id)]));
				list.sort((a, b) => mean.get(a) - mean.get(b) || idList.indexOf(a) - idList.indexOf(b));
			}
			list.forEach((id, index) => orderById.set(id, index));
		});
		const sizeOf = (id) => geometry.rectOf(id) ?? { width: 200, height: 48 };
		const widthByRank = idListByRank.map((list) => Math.max(0, ...list.map((id) => sizeOf(id).width)));
		const heightByRank = idListByRank.map((list) => list.reduce((sum, id) => sum + sizeOf(id).height, 0) + Math.max(0, list.length - 1) * gapY);
		const positionById = {};
		let bandTop = origin.y;
		for (let bandStart = 0; bandStart < rankCount; bandStart += ranksPerBand) {
			const rankList = Array.from({ length: Math.min(ranksPerBand, rankCount - bandStart) }, (_, index) => bandStart + index);
			const bandHeight = Math.max(...rankList.map((rank) => heightByRank[rank]));
			let x = origin.x;
			for (const rank of rankList) {
				let y = bandTop + (bandHeight - heightByRank[rank]) / 2;
				for (const id of idListByRank[rank]) {
					const size = sizeOf(id);
					positionById[id] = { x: Math.round(x + (widthByRank[rank] - size.width) / 2), y: Math.round(y) };
					y += size.height + gapY;
				}
				x += widthByRank[rank] + gapX;
			}
			bandTop += bandHeight + gapBand;
		}
		const bandOf = (id) => Math.floor(rankById.get(id) / ranksPerBand);
		const handleSideList = [];
		for (const connection of connectionList) {
			const { source, target } = connection;
			const isForward = bandOf(source.nodeId) === bandOf(target.nodeId) && rankById.get(target.nodeId) > rankById.get(source.nodeId);
			const isDown = bandOf(target.nodeId) > bandOf(source.nodeId);
			const isSameRank = rankById.get(target.nodeId) === rankById.get(source.nodeId);
			const isBelow = (positionById[target.nodeId]?.y ?? 0) > (positionById[source.nodeId]?.y ?? 0);
			const sideSource = isForward ? 'right' : isDown || (isSameRank && isBelow) ? 'bottom' : 'top';
			const sideTarget = isForward ? 'left' : isDown || (isSameRank && isBelow) ? 'top' : isSameRank ? 'bottom' : 'top';
			handleSideList.push({ nodeId: source.nodeId, handleId: source.handleId, side: sideSource }, { nodeId: target.nodeId, handleId: target.handleId, side: sideTarget });
		}
		return { positionById, handleSideList, reportList: [] };
	},
};

// An arranger for the connection view of a zettel (doc/README.md#the-connection-view): the zettel
// in the middle and everything connected to it around, each place in a frame (a zettel-frame
// drawn around its cards). It reads which place a card stands in from its data and nothing of
// zettels:
//
//   data.place   center | container | child | child-question | in | in-question | out | group
//   frames       zettel-frame nodes with around, data.place the place of the cards they hold
//
//            ┌ container ─────────┐            above, a grid (gridColumnMax columns)
//            └─────────┬──────────┘
//   ┌ in ──────┐  ┌────▼────┐  ┌ out ─────┐    the left column: back links, then the questions
//   │          ├─►│ center  ├─►│          │    using it; the right column: forward links, then
//   └──────────┘  └────┬────┘  ├ group ───┤    the groups, one frame each. the middle row is as
//                      │       └──────────┘    tall as its tallest column, all three centered in it
//            ┌ child ──▼──────────┐            below, a grid; the questions it holds start a row
//            └────────────────────┘            of their own
//
// the handles of the center on one side are set apart along it, in the order of the frames
// they lead to. options: { gapSide = 120 (gapLeft, gapRight: one side wider, for the labels of its lines), gapBand = 54, gapFrame = 18,
// gapGridX = 14, gapGridY = 12, gridColumnMax = 4 }
export const zettelArrangerConnection = {
	id: 'zettel-connection',
	label: 'A zettel and its connections',
	description: 'The zettel in the middle: what holds it above, what it holds below, its back links on the left, its forward links and groups on the right, each place in a frame.',
	geometryEstimate,
	isApplicable: (diagram) => (diagram.nodes ?? []).some((node) => node.data?.place === 'center'),
	arrange(diagram, geometry, { gapSide = 120, gapLeft = gapSide, gapRight = gapSide, gapBand = 54, gapFrame = 18, gapGridX = 14, gapGridY = 12, gridColumnMax = 4 } = {}) {
		const nodeList = diagram.nodes ?? [];
		const center = nodeList.find((node) => node.data?.place === 'center');
		if (!center) return { positionById: {}, handleSideList: [], reportList: [{ kind: 'skipped', message: 'no node has the place center' }] };
		const sizeOf = (node) => {
			const rect = geometry.rectOf(node.id);
			return { width: rect?.width ?? 220, height: rect?.height ?? 40 };
		};
		const paddingOf = (frame) => {
			const padding = frame.around?.padding ?? 0;
			return typeof padding === 'number' ? { top: padding, right: padding, bottom: padding, left: padding } : { top: 0, right: 0, bottom: 0, left: 0, ...padding };
		};
		const nodeById = new Map(nodeList.map((node) => [node.id, node]));
		const frameList = nodeList.filter((node) => node.renderer?.type === 'zettel-frame' && node.around).map((frame) => ({ frame, place: frame.data?.place, padding: paddingOf(frame), memberList: frame.around.nodeIdList.map((id) => nodeById.get(id)).filter(Boolean) }));
		const positionById = {};
		// a grid of cards, rows as tall as their tallest card; a card of another place than the
		// first starts a row of its own. answers the size of what it fills
		const gridMeasure = (memberList) => {
			const blockList = [];
			for (const node of memberList) {
				const last = blockList[blockList.length - 1];
				if (last && last.place === node.data?.place) last.nodeList.push(node);
				else blockList.push({ place: node.data?.place, nodeList: [node] });
			}
			const rowList = [];
			for (const block of blockList) {
				const columnCount = Math.min(gridColumnMax, block.nodeList.length);
				for (let start = 0; start < block.nodeList.length; start += columnCount) {
					const row = block.nodeList.slice(start, start + columnCount);
					rowList.push({ nodeList: row, height: Math.max(...row.map((node) => sizeOf(node).height)), width: row.reduce((sum, node) => sum + sizeOf(node).width, 0) + (row.length - 1) * gapGridX, isBlockStart: start === 0 && rowList.length > 0 });
				}
			}
			const width = Math.max(0, ...rowList.map((row) => row.width));
			const height = rowList.reduce((sum, row) => sum + row.height + (row.isBlockStart ? gapGridY * 2 : 0), 0) + Math.max(0, rowList.length - 1) * gapGridY;
			return { rowList, width, height };
		};
		const gridPlace = (grid, left, top) => {
			let y = top;
			grid.rowList.forEach((row, index) => {
				if (index > 0) y += gapGridY + (row.isBlockStart ? gapGridY * 2 : 0);
				let x = left;
				for (const node of row.nodeList) {
					positionById[node.id] = { x: Math.round(x), y: Math.round(y) };
					x += sizeOf(node).width + gapGridX;
				}
				y += row.height;
			});
		};
		const columnMeasure = (memberList) => ({ width: Math.max(0, ...memberList.map((node) => sizeOf(node).width)), height: memberList.reduce((sum, node) => sum + sizeOf(node).height, 0) + Math.max(0, memberList.length - 1) * gapGridY });
		const columnPlace = (memberList, left, top) => {
			let y = top;
			for (const node of memberList) {
				positionById[node.id] = { x: Math.round(left), y: Math.round(y) };
				y += sizeOf(node).height + gapGridY;
			}
		};
		const framedOf = (entry, measure) => ({ ...entry, inner: measure, width: measure.width + entry.padding.left + entry.padding.right, height: measure.height + entry.padding.top + entry.padding.bottom });
		const sizeCenter = sizeOf(center);
		const leftList = frameList.filter((entry) => entry.place === 'in' || entry.place === 'in-question').map((entry) => framedOf(entry, columnMeasure(entry.memberList)));
		const rightList = frameList.filter((entry) => entry.place === 'out' || entry.place === 'group').map((entry) => framedOf(entry, columnMeasure(entry.memberList)));
		const topEntry = frameList.find((entry) => entry.place === 'container');
		const bottomEntry = frameList.find((entry) => entry.place === 'child');
		const stackHeight = (list) => list.reduce((sum, entry) => sum + entry.height, 0) + Math.max(0, list.length - 1) * gapFrame;
		const heightMiddle = Math.max(sizeCenter.height, stackHeight(leftList), stackHeight(rightList));
		positionById[center.id] = { x: Math.round(-sizeCenter.width / 2), y: Math.round((heightMiddle - sizeCenter.height) / 2) };
		const sideWidth = (list) => Math.max(0, ...list.map((entry) => entry.width));
		const stackPlace = (list, isLeft) => {
			const width = sideWidth(list);
			let top = (heightMiddle - stackHeight(list)) / 2;
			for (const entry of list) {
				const frameLeft = isLeft ? -sizeCenter.width / 2 - gapLeft - width : sizeCenter.width / 2 + gapRight;
				// the cards of a frame on the left stand against the side facing the center
				const left = isLeft ? frameLeft + width - entry.padding.right - entry.inner.width : frameLeft + entry.padding.left;
				columnPlace(entry.memberList, left, top + entry.padding.top);
				top += entry.height + gapFrame;
			}
		};
		stackPlace(leftList, true);
		stackPlace(rightList, false);
		if (topEntry) {
			const grid = gridMeasure(topEntry.memberList);
			gridPlace(grid, -grid.width / 2, -gapBand - topEntry.padding.bottom - grid.height);
		}
		if (bottomEntry) {
			const grid = gridMeasure(bottomEntry.memberList);
			gridPlace(grid, -grid.width / 2, heightMiddle + gapBand + bottomEntry.padding.top);
		}
		// the handles of the center, set apart along each side in the order of the frames
		const handleSideList = [];
		const sideOrder = (list, sideHandleOf) => {
			const handleIdList = [...new Set(list.map(sideHandleOf).filter(Boolean))];
			return handleIdList.map((handleId, index) => ({ handleId, offset: (index + 1) / (handleIdList.length + 1) }));
		};
		const handleOfFrame = (entry) => entry.frame.data?.handle ?? '';
		for (const { handleId, offset } of sideOrder(leftList, handleOfFrame)) handleSideList.push({ nodeId: center.id, handleId, side: 'left', offset });
		for (const { handleId, offset } of sideOrder(rightList, handleOfFrame)) handleSideList.push({ nodeId: center.id, handleId, side: 'right', offset });
		return { positionById, handleSideList, reportList: [] };
	},
};
