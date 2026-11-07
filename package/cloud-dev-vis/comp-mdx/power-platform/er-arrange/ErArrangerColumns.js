import { diagramGeometryMovedBuild } from '../../card-diagram/DiagramArrange.js';
import { erLaneCountByGapGet, erLinesRoute, LANE_SPACING_MIN, LEVEL_FIRST, LEVEL_STEP } from './ErLineRouter.js';
import { erGeometryEstimateBuild } from './ErGeometry.js';
import { erLabelsPlace, erLineSceneGet, erArrangerIsApplicable } from './ErArrangerLanes.js';

const GAP_COLUMN = 170;
const GAP_ROW = 56;
const BELOW_MARGIN = 20;
const BELOW_TYPE_LIST = ['dataverse-choice'];

// the column of each card: what a line goes to stands at the right of where it comes from.
// a cycle has no such order, and is cut where it was entered
function columnByNodeGet(idList, lineList) {
	const targetListOf = new Map(idList.map((id) => [id, []]));
	for (const { from, to } of lineList) if (from !== to) targetListOf.get(from)?.push(to);
	const depthById = new Map();
	const depthOf = (id, chain) => {
		if (depthById.has(id)) return depthById.get(id);
		if (chain.includes(id)) return 0;
		const targetList = targetListOf.get(id).filter((target) => targetListOf.has(target));
		const depth = targetList.length ? 1 + Math.max(...targetList.map((target) => depthOf(target, [...chain, id]))) : 0;
		depthById.set(id, depth);
		return depth;
	};
	idList.forEach((id) => depthOf(id, []));
	const depthMax = Math.max(0, ...depthById.values());
	return new Map(idList.map((id) => [id, depthMax - depthById.get(id)]));
}

// the side of the handles at the two ends of each line, towards each other: a handle many
// lines share takes the side most of them want. one on top or bottom stays there
function handleSideListGet(diagram, geometry, columnOf) {
	const voteByKey = new Map();
	const vote = (endpoint, side) => {
		const key = `${endpoint.nodeId}/${endpoint.handleId}`;
		const entry = voteByKey.get(key) ?? { nodeId: endpoint.nodeId, handleId: endpoint.handleId, left: 0, right: 0, firstSide: side };
		entry[side] += 1;
		voteByKey.set(key, entry);
	};
	for (const connection of diagram.connections ?? []) {
		const { source, target } = connection;
		if (!source?.nodeId || !target?.nodeId) continue;
		const columnSource = columnOf.get(source.nodeId);
		const columnTarget = columnOf.get(target.nodeId);
		if (columnSource === undefined) continue;
		if (columnTarget === undefined) { vote(source, 'right'); continue; }
		vote(source, columnTarget < columnSource ? 'left' : 'right');
		vote(target, columnTarget > columnSource ? 'left' : 'right');
	}
	const list = [];
	for (const entry of voteByKey.values()) {
		const node = diagram.nodes.find((item) => item.id === entry.nodeId);
		const sideNow = node?.handles?.find((handle) => handle.id === entry.handleId)?.anchor?.side;
		if (sideNow === 'top' || sideNow === 'bottom') continue;
		const side = entry.left === entry.right ? entry.firstSide : entry.left > entry.right ? 'left' : 'right';
		if (side !== sideNow) list.push({ nodeId: entry.nodeId, handleId: entry.handleId, side });
	}
	return list;
}

// the cards in columns by what refers to what, option sets below the tables, room in each gap
// for the lines crossing it, then the lines as er-lanes routes them
export const erArrangerColumns = {
	id: 'er-columns',
	label: 'Place the cards in columns and route the lines',
	description: 'Moves the cards into columns: what a line goes to stands at its right, option sets below. Then replaces the anchors of every right-angled line.',
	isApplicable: erArrangerIsApplicable,
	geometryEstimate: (diagram, options) => erGeometryEstimateBuild(diagram, { ...options, positionFallback: options?.origin ?? { x: 0, y: 0 } }),
	arrange(diagram, geometry, options = {}) {
		const rectById = new Map((diagram.nodes ?? []).flatMap((node) => {
			const rect = geometry.rectOf(node.id);
			return rect ? [[node.id, rect]] : [];
		}));
		const nodeList = (diagram.nodes ?? []).filter((node) => rectById.has(node.id) && !rectById.get(node.id).isBackground);
		const belowList = nodeList.filter((node) => BELOW_TYPE_LIST.includes(node.renderer?.type));
		const tableList = nodeList.filter((node) => !belowList.includes(node));
		// re-applied by hand, the diagram stays where it was on the canvas
		const origin = options.origin ?? {
			x: nodeList.length ? Math.min(...nodeList.map((node) => rectById.get(node.id).x)) : 0,
			y: nodeList.length ? Math.min(...nodeList.map((node) => rectById.get(node.id).y)) : 0,
		};
		const attachedList = (diagram.connections ?? []).filter((line) => line.source?.nodeId && line.target?.nodeId).map((line) => ({ from: line.source.nodeId, to: line.target.nodeId }));
		const columnOf = columnByNodeGet(tableList.map((node) => node.id), attachedList);
		const columnCount = Math.max(0, ...columnOf.values()) + 1;
		const handleSideList = handleSideListGet(diagram, geometry, columnOf);

		// each column stacked, the option sets below the first column using them
		const widthByColumn = Array.from({ length: columnCount }, () => 0);
		for (const node of tableList) widthByColumn[columnOf.get(node.id)] = Math.max(widthByColumn[columnOf.get(node.id)], rectById.get(node.id).width);
		const belowColumnOf = new Map(belowList.map((node) => {
			const columnList = attachedList.filter((line) => line.to === node.id && columnOf.has(line.from)).map((line) => columnOf.get(line.from));
			return [node.id, columnList.length ? Math.min(...columnList) : columnCount - 1];
		}));
		const belowLineCount = attachedList.filter((line) => belowColumnOf.has(line.to)).length;
		const gapBelow = Math.max(40, LEVEL_FIRST + 8 + LEVEL_STEP * belowLineCount);
		const placeWith = (gapWidthByColumn) => {
			const xByColumn = [];
			let x = origin.x;
			for (let column = 0; column < columnCount; column += 1) {
				xByColumn.push(x);
				x += widthByColumn[column] + (gapWidthByColumn.get(column + 1) ?? GAP_COLUMN);
			}
			const heightByColumn = new Map();
			const positionById = {};
			for (const node of tableList) {
				const column = columnOf.get(node.id);
				const top = heightByColumn.get(column) ?? 0;
				positionById[node.id] = { x: xByColumn[column], y: origin.y + top };
				heightByColumn.set(column, top + rectById.get(node.id).height + GAP_ROW);
			}
			const heightTables = Math.max(0, ...heightByColumn.values());
			const heightBelowByColumn = new Map();
			for (const node of belowList) {
				const column = belowColumnOf.get(node.id);
				const top = heightBelowByColumn.get(column) ?? 0;
				positionById[node.id] = { x: xByColumn[column], y: origin.y + heightTables + gapBelow + BELOW_MARGIN + top };
				heightBelowByColumn.set(column, top + rectById.get(node.id).height + gapBelow);
			}
			return positionById;
		};
		// room for the lanes: where the columns stand does not change which gaps a line needs
		const positionFirst = placeWith(new Map());
		const sceneFirst = erLineSceneGet(diagram, diagramGeometryMovedBuild(geometry, positionFirst, handleSideList), options);
		const columnAllOf = new Map([...columnOf, ...belowColumnOf]);
		const gapWidthByColumn = new Map([...erLaneCountByGapGet(sceneFirst.lineList.filter((line) => columnAllOf.has(line.sourceNodeId) && columnAllOf.has(line.targetNodeId)), columnAllOf)].map(([gap, count]) => [gap, Math.max(GAP_COLUMN, LANE_SPACING_MIN * (count + 1))]));
		const positionById = Object.fromEntries(Object.entries(placeWith(gapWidthByColumn)).filter(([id]) => !(diagram.nodes.find((node) => node.id === id)?.isPositionLocked)));
		const geometryMoved = diagramGeometryMovedBuild(geometry, positionById, handleSideList);
		const scene = erLineSceneGet(diagram, geometryMoved, options);
		const { routeById, reportList } = erLinesRoute(scene);
		const labels = erLabelsPlace(diagram, geometryMoved, routeById, options);
		return { positionById, handleSideList, routeById, labelPositionById: labels.positionById, reportList: [...scene.reportList, ...reportList, ...labels.reportList] };
	},
};
