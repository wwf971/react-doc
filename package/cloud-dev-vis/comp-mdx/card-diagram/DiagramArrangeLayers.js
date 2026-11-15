import { diagramGeometryMovedBuild } from './DiagramArrange.js';
import { diagramGeometryEstimateBuild, nodeIsSimple } from './DiagramArrangeOutline.js';
import { anchorPointOnOutline, cardSimpleHandlePointOf, cardSimpleShapeOf } from './CardSimpleData.js';
import { CARD_FOOTER_HEIGHT, cardFooterIsShown } from './TableCardData.js';
import { diagramLabelsPlace, diagramLaneCountByGapGet, diagramLineSceneGet, diagramLinesRoute, LANE_SPACING_MIN } from './DiagramArrangeRouter.js';

// The arrangers of a diagram read downward (card-diagram-arrange.md#the-layer-arrangers): what a
// system is made of, top to bottom in the order a request passes it. They know no kind of card.
//
//   layers         places the cards in layers by their lines, what a line goes to under what it
//                  comes from, the cards of one layer side by side; turns the handles of the cards
//                  as a whole to face each other; routes every right-angled line in a lane of its own
//   lanes-down     keeps the cards where they are, in rows; routes the lines between the rows
//   lanes-across   keeps the cards where they are, in columns; routes the lines between the columns
//
//   ┌───┐                    a line between two layers leaves the bottom of its card, turns in a lane
//   │ a │                    of its own in the gap under it, and enters the top of the other; a line
//   └─┬─┘                    across several layers runs down a track between the cards of the layers
//  ┌──┴───────┐              it passes. a gap is as high as its lanes need
//  ▼          ▼
// ┌───┐     ┌───┐
// │ b │     │ c │
// └───┘     └───┘
//
// The lines are routed by the lane router (DiagramArrangeRouter.js), which routes cards standing in
// columns: the diagram is turned a quarter (x for y, the top of a card for its left), routed, and the
// routes turned back. A line between two sides of cards of one row is what the router does not do:
// it is left to the line type, and reported.
const GAP_LAYER = 64;
const GAP_CARD = 56;
const round = (value) => Math.round(value * 10) / 10;

// ---------- a quarter turn: rows become columns, the top of a card its left
const SIDE_TURNED = { top: 'left', left: 'top', bottom: 'right', right: 'bottom' };
const DIRECTION_TURNED = { 'x+': 'y+', 'y+': 'x+', 'x-': 'y-', 'y-': 'x-' };

function geometryTurn(geometry) {
	return {
		rectOf: (nodeId) => {
			const rect = geometry.rectOf(nodeId);
			return rect ? { ...rect, x: rect.y, y: rect.x, width: rect.height, height: rect.width } : null;
		},
		endOf: (connection, role) => {
			const end = geometry.endOf(connection, role);
			return end ? { x: end.y, y: end.x, side: SIDE_TURNED[end.side] ?? end.side } : null;
		},
	};
}

const handleTurn = (value) => (typeof value === 'string' ? DIRECTION_TURNED[value] ?? value : value && typeof value === 'object' ? { x: value.y, y: value.x } : value);

export function routeTurn(route) {
	if (!route) return route;
	const turned = { ...route };
	if (route.anchorList) turned.anchorList = route.anchorList.map((anchor) => ({ ...anchor, x: anchor.y ?? 0, y: anchor.x ?? 0, ...(anchor.handleIn !== undefined ? { handleIn: handleTurn(anchor.handleIn) } : {}), ...(anchor.handleOut !== undefined ? { handleOut: handleTurn(anchor.handleOut) } : {}) }));
	for (const role of ['source', 'target']) if (route[role]?.handle !== undefined) turned[role] = { ...route[role], handle: handleTurn(route[role].handle) };
	return turned;
}

// the lines of a diagram routed by the lane router: as they stand (across), or turned (down)
function linesRoute(diagram, geometry, options, isDown) {
	const scene = diagramLineSceneGet(diagram, isDown ? geometryTurn(geometry) : geometry, options);
	const { routeById, reportList } = diagramLinesRoute({ ...scene, measureType: 'step' });
	const routeByIdDrawn = isDown ? Object.fromEntries(Object.entries(routeById).map(([id, route]) => [id, routeTurn(route)])) : routeById;
	const reportListDrawn = [...scene.reportList, ...reportList].map((report) => (isDown && report.kind === 'skipped' && /top or bottom/.test(report.message) ? { ...report, message: `${report.connectionId}: both of its ends leave a card through its left or right side, which lanes between rows do not route` } : report));
	const labels = diagramLabelsPlace(diagram, geometry, routeByIdDrawn, options);
	return { routeById: routeByIdDrawn, labelPositionById: labels.positionById, reportList: [...reportListDrawn, ...labels.reportList] };
}

// ---------- the layers

// the layer of each card: one under the deepest card a line comes to it from. a cycle is cut where
// it was entered; a card no line reaches stands in the first layer
function layerByNodeGet(idList, lineList) {
	const sourceListOf = new Map(idList.map((id) => [id, []]));
	for (const { from, to } of lineList) if (from !== to && sourceListOf.has(to) && sourceListOf.has(from)) sourceListOf.get(to).push(from);
	const layerById = new Map();
	const layerOf = (id, chain) => {
		if (layerById.has(id)) return layerById.get(id);
		if (chain.includes(id)) return -1;
		const sourceList = sourceListOf.get(id);
		const layer = sourceList.length ? 1 + Math.max(-1, ...sourceList.map((source) => layerOf(source, [...chain, id]))) : 0;
		layerById.set(id, layer);
		return layer;
	};
	idList.forEach((id) => layerOf(id, []));
	return layerById;
}

// the order of the cards of a layer: as they stand left to right when they were placed apart
// (an author's order is kept), else under the middle of the cards their lines come from
function layerOrderBuild(layerList, rectById, lineList) {
	const indexOf = new Map();
	return layerList.map((idList, layer) => {
		const xList = idList.map((id) => rectById.get(id).x);
		const isPlaced = new Set(xList).size === xList.length;
		const weightOf = (id) => {
			const list = lineList.filter((line) => line.to === id && indexOf.has(line.from)).map((line) => indexOf.get(line.from));
			return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : Infinity;
		};
		const order = idList.map((id, at) => ({ id, at, key: isPlaced || layer === 0 ? rectById.get(id).x : weightOf(id) }))
			.sort((a, b) => (a.key === b.key ? a.at - b.at : a.key === Infinity ? 1 : b.key === Infinity ? -1 : a.key - b.key))
			.map((item) => item.id);
		order.forEach((id, index) => indexOf.set(id, index));
		return order;
	});
}

// the sides an anchor of a node offers, read from its kind as the diagram reads them (the body,
// which every node has, on every side)
function anchorSideListOf(contract, data, target) {
	const sideAll = ['left', 'right', 'top', 'bottom'];
	if (!contract?.anchorListGet) return target === 'body' ? sideAll : [];
	try {
		const anchor = contract.anchorListGet(contract.dataNormalize ? contract.dataNormalize(data ?? {}) : (data ?? {})).find((item) => item.id === target);
		return anchor?.sideList ?? (target === 'body' ? sideAll : []);
	} catch {
		return [];
	}
}

// the side a handle is turned to: one on a card as a whole (body) or on a node drawn simple, for
// every line at it, the side most of them want; one on a part of a card (a row, the title line)
// keeps its side, and so does one whose anchor does not offer the side wanted. answers
// [{ nodeId, handleId, side }] of the handles that may move, with the side they stand on then
function handleSideListGet(diagram, registry, layerOf, rectById) {
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	const voteByKey = new Map();
	const vote = (endpoint, side) => {
		const key = `${endpoint.nodeId}/${endpoint.handleId}`;
		const entry = voteByKey.get(key) ?? { nodeId: endpoint.nodeId, handleId: endpoint.handleId, countBySide: {}, sideFirst: side };
		entry.countBySide[side] = (entry.countBySide[side] ?? 0) + 1;
		voteByKey.set(key, entry);
	};
	for (const { source, target } of diagram.connections ?? []) {
		if (!source?.nodeId || !target?.nodeId || !layerOf.has(source.nodeId) || !layerOf.has(target.nodeId)) continue;
		const layerSource = layerOf.get(source.nodeId);
		const layerTarget = layerOf.get(target.nodeId);
		if (layerTarget > layerSource) { vote(source, 'bottom'); vote(target, 'top'); }
		else if (layerTarget < layerSource) { vote(source, 'top'); vote(target, 'bottom'); }
		else {
			const isRight = rectById.get(target.nodeId).x > rectById.get(source.nodeId).x;
			vote(source, isRight ? 'right' : 'left');
			vote(target, isRight ? 'left' : 'right');
		}
	}
	const list = [];
	for (const entry of voteByKey.values()) {
		const node = nodeById.get(entry.nodeId);
		const handle = node?.handles?.find((item) => item.id === entry.handleId);
		if (!handle) continue;
		const contract = registry?.kindByType?.[node.renderer?.type]?.contract;
		const target = handle.anchor?.target ?? 'body';
		if (target !== 'body' && !nodeIsSimple(diagram, node, contract)) continue;
		const sideWanted = Object.entries(entry.countBySide).sort((a, b) => b[1] - a[1] || (a[0] === entry.sideFirst ? -1 : b[0] === entry.sideFirst ? 1 : 0))[0][0];
		const side = anchorSideListOf(contract, node.data, target).includes(sideWanted) ? sideWanted : handle.anchor?.side;
		list.push({ nodeId: entry.nodeId, handleId: entry.handleId, side, sideBefore: handle.anchor?.side, offsetBefore: handle.anchor?.offset ?? 0.5 });
	}
	return list;
}

// handles that would meet on one side of a card stand apart along it, in the order of where their
// lines go (left to right under a card, top to bottom beside it), so their lines leave from places
// of their own instead of sharing a stretch. answers the changes: a side, an offset when it moved
function handleSpread(diagram, sideList, positionById, rectById) {
	const centerOf = (nodeId) => {
		const rect = rectById.get(nodeId);
		const position = positionById[nodeId] ?? rect;
		return rect ? { x: position.x + rect.width / 2, y: position.y + rect.height / 2 } : { x: 0, y: 0 };
	};
	const otherListOf = (nodeId, handleId) => (diagram.connections ?? []).flatMap((line) => {
		if (line.source?.nodeId === nodeId && line.source.handleId === handleId && line.target?.nodeId) return [centerOf(line.target.nodeId)];
		if (line.target?.nodeId === nodeId && line.target.handleId === handleId && line.source?.nodeId) return [centerOf(line.source.nodeId)];
		return [];
	});
	const groupByKey = new Map();
	for (const item of sideList) groupByKey.set(`${item.nodeId}/${item.side}`, [...(groupByKey.get(`${item.nodeId}/${item.side}`) ?? []), item]);
	const changeList = [];
	for (const group of groupByKey.values()) {
		const axis = group[0].side === 'top' || group[0].side === 'bottom' ? 'x' : 'y';
		const isSpread = group.length > 1 && group.some((item, index) => group.some((other, at) => at !== index && Math.abs(other.offsetBefore - item.offsetBefore) < 0.01));
		const orderOf = (item) => {
			const list = otherListOf(item.nodeId, item.handleId);
			return list.length ? list.reduce((sum, point) => sum + point[axis], 0) / list.length : 0;
		};
		const ordered = isSpread ? [...group].sort((a, b) => orderOf(a) - orderOf(b)) : group;
		ordered.forEach((item, index) => {
			const offset = isSpread ? Math.round(((index + 1) / (group.length + 1)) * 1000) / 1000 : undefined;
			const isOffsetChanged = offset !== undefined && Math.abs(offset - item.offsetBefore) > 0.001;
			if (item.side !== item.sideBefore || isOffsetChanged) changeList.push({ nodeId: item.nodeId, handleId: item.handleId, side: item.side, ...(isOffsetChanged ? { offset } : {}) });
		});
	}
	return changeList;
}

// where the end of a line is once its handle turned: on the side of its card, or of the mark of a
// node drawn simple, at its offset
function endChangedOfBuild(diagram, registry) {
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	return (connection, role, rect, change) => {
		const node = nodeById.get(connection[role].nodeId);
		const handle = node?.handles?.find((item) => item.id === connection[role].handleId);
		if (!handle) return null;
		const contract = registry?.kindByType?.[node.renderer?.type]?.contract;
		const offset = change.offset ?? handle.anchor?.offset ?? 0.5;
		const point = nodeIsSimple(diagram, node, contract)
			? cardSimpleHandlePointOf(rect, node.size, change.side, offset, cardSimpleShapeOf(contract))
			: anchorPointOnOutline({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }, change.side, offset);
		return { ...point, side: change.side };
	};
}

export const diagramArrangerLayers = {
	id: 'layers',
	label: 'Layers, top to bottom',
	description: 'Places the cards in layers by their lines: what a line goes to stands under what it comes from, the cards of a layer side by side in the order they stand. Turns the handles of the cards to face each other, then gives every right-angled line a lane of its own and places the labels.',
	geometryEstimate: (diagram, options) => diagramGeometryEstimateBuild(diagram, { ...options, positionFallback: options?.origin ?? { x: 0, y: 0 } }),
	arrange(diagram, geometry, { gapLayer = GAP_LAYER, gapCard = GAP_CARD, ...options } = {}) {
		const rectById = new Map((diagram.nodes ?? []).flatMap((node) => {
			const rect = geometry.rectOf(node.id);
			return rect && !rect.isBackground ? [[node.id, rect]] : [];
		}));
		const idList = [...rectById.keys()];
		if (idList.length === 0) return {};
		const origin = options.origin ?? { x: Math.min(...idList.map((id) => rectById.get(id).x)), y: Math.min(...idList.map((id) => rectById.get(id).y)) };
		const lineList = (diagram.connections ?? []).filter((line) => line.source?.nodeId && line.target?.nodeId).map((line) => ({ from: line.source.nodeId, to: line.target.nodeId }));
		const layerOf = layerByNodeGet(idList, lineList);
		const layerList = [];
		for (const id of idList) (layerList[layerOf.get(id)] ??= []).push(id);
		const layerOrder = layerOrderBuild(layerList.map((list) => list ?? []), rectById, lineList);
		const sideList = handleSideListGet(diagram, options.registry, layerOf, rectById);
		const endChangedOf = endChangedOfBuild(diagram, options.registry);
		// a card a line now leaves at its bottom draws its footer: it is that much taller
		const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
		for (const item of sideList) {
			const node = nodeById.get(item.nodeId);
			const isCard = Boolean(options.registry?.kindByType?.[node?.renderer?.type]?.schema) && !nodeIsSimple(diagram, node, options.registry?.kindByType?.[node?.renderer?.type]?.contract);
			if (item.side !== 'bottom' || !isCard || cardFooterIsShown(node) || rectById.get(item.nodeId)?.isFooted) continue;
			rectById.set(item.nodeId, { ...rectById.get(item.nodeId), height: rectById.get(item.nodeId).height + CARD_FOOTER_HEIGHT, isFooted: true });
		}
		const geometryFooted = { rectOf: (nodeId) => (rectById.get(nodeId)?.isFooted ? rectById.get(nodeId) : geometry.rectOf(nodeId)), endOf: geometry.endOf };
		// the layers centered on the widest
		const widthOf = (order) => order.reduce((sum, id) => sum + rectById.get(id).width, 0) + gapCard * Math.max(0, order.length - 1);
		const widthMax = Math.max(...layerOrder.map(widthOf));
		const placeWith = (gapByLayer) => {
			const positionById = {};
			let y = origin.y;
			layerOrder.forEach((order, layer) => {
				let x = origin.x + (widthMax - widthOf(order)) / 2;
				for (const id of order) {
					positionById[id] = { x: round(x), y: round(y) };
					x += rectById.get(id).width + gapCard;
				}
				y += Math.max(0, ...order.map((id) => rectById.get(id).height)) + (gapByLayer.get(layer + 1) ?? gapLayer);
			});
			return positionById;
		};
		// room for the lanes: where the layers stand does not change which gaps a line needs
		const lockedSet = new Set((diagram.nodes ?? []).filter((node) => node.isPositionLocked).map((node) => node.id));
		const positionFirst = placeWith(new Map());
		const handleSideList = handleSpread(diagram, sideList, positionFirst, rectById);
		const sceneFirst = diagramLineSceneGet(diagram, geometryTurn(diagramGeometryMovedBuild(geometryFooted, positionFirst, handleSideList, { endChangedOf })), options);
		const gapByLayer = new Map([...diagramLaneCountByGapGet(sceneFirst.lineList.filter((line) => layerOf.has(line.sourceNodeId) && layerOf.has(line.targetNodeId)), layerOf)].map(([gap, count]) => [gap, Math.max(gapLayer, LANE_SPACING_MIN * (count + 1))]));
		const positionById = Object.fromEntries(Object.entries(placeWith(gapByLayer)).filter(([id]) => !lockedSet.has(id)));
		const geometryMoved = diagramGeometryMovedBuild(geometryFooted, positionById, handleSideList, { endChangedOf });
		return { positionById, handleSideList, ...linesRoute(diagram, geometryMoved, options, true) };
	},
};

export const diagramArrangerLanesDown = {
	id: 'lanes-down',
	label: 'Route the lines, cards in rows',
	description: 'Keeps the cards where they are, read as rows top to bottom. Replaces the anchors of every right-angled line, giving each a lane of its own in the gaps between the rows, and places the labels clear of the cards.',
	geometryEstimate: (diagram, options) => diagramGeometryEstimateBuild(diagram, options),
	arrange: (diagram, geometry, options = {}) => linesRoute(diagram, geometry, options, true),
};

export const diagramArrangerLanesAcross = {
	id: 'lanes-across',
	label: 'Route the lines, cards in columns',
	description: 'Keeps the cards where they are, read as columns left to right. Replaces the anchors of every right-angled line, giving each a lane of its own in the gaps between the columns, and places the labels clear of the cards.',
	geometryEstimate: (diagram, options) => diagramGeometryEstimateBuild(diagram, options),
	arrange: (diagram, geometry, options = {}) => linesRoute(diagram, geometry, options, false),
};
