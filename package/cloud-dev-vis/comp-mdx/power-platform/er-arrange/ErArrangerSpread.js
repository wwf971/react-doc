import { diagramGeometryMovedBuild } from '../../card-diagram/DiagramArrange.js';
import { erColumnListGet, erLaneCountByGapGet, erLinesRoute, LANE_SPACING_MIN } from './ErLineRouter.js';
import { erGeometryEstimateBuild } from './ErGeometry.js';
import { erArrangerIsApplicable, erLabelsPlace, erLineSceneGet } from './ErArrangerLanes.js';

const LANE_SPACING_WANTED = LANE_SPACING_MIN + 4;

// what er-lanes does, for cards that already stand where they mean something, but too close for
// the lines they need: the columns and the order within them stay, each gap only grows to hold
// its lanes. for a diagram put together from arranged parts, as two ER diagrams with the lines
// between them, where placing every card anew would lose what the parts say
export const erArrangerSpread = {
	id: 'er-spread',
	label: 'Widen the gaps and route the lines',
	description: 'Keeps the columns and the order of the cards. Widens a gap too narrow for its lines, replaces the anchors of every right-angled line, and places their labels clear of the cards.',
	isApplicable: erArrangerIsApplicable,
	geometryEstimate: (diagram, options) => erGeometryEstimateBuild(diagram, options),
	arrange(diagram, geometry, options = {}) {
		const rectList = (diagram.nodes ?? []).flatMap((node) => {
			const rect = geometry.rectOf(node.id);
			return rect ? [{ ...rect, id: node.id }] : [];
		});
		const columnList = erColumnListGet(rectList);
		const columnOf = new Map();
		columnList.forEach((column, index) => column.idList.forEach((id) => columnOf.set(id, index)));
		const sceneFirst = erLineSceneGet(diagram, geometry, options);
		const countByGap = erLaneCountByGapGet(sceneFirst.lineList.filter((line) => columnOf.has(line.sourceNodeId) && columnOf.has(line.targetNodeId)), columnOf);
		const lockedSet = new Set((diagram.nodes ?? []).filter((node) => node.isPositionLocked).map((node) => node.id));
		// a column with a locked card stays, and what stands right of it moves on from there
		let shift = 0;
		const positionById = {};
		columnList.forEach((column, index) => {
			if (index > 0) {
				const widthNow = column.left + shift - (columnList[index - 1].right + (columnList[index - 1].shift ?? 0));
				const widthWanted = ((countByGap.get(index) ?? 0) + 1) * LANE_SPACING_WANTED;
				shift += Math.max(0, widthWanted - widthNow);
			}
			if (column.idList.some((id) => lockedSet.has(id))) {
				column.shift = 0;
				shift = 0;
				return;
			}
			column.shift = shift;
			if (shift === 0) return;
			for (const id of column.idList) {
				const rect = rectList.find((item) => item.id === id);
				positionById[id] = { x: rect.x + shift, y: rect.y };
			}
		});
		const geometryMoved = diagramGeometryMovedBuild(geometry, positionById);
		const scene = erLineSceneGet(diagram, geometryMoved, options);
		const { routeById, reportList } = erLinesRoute(scene);
		const labels = erLabelsPlace(diagram, geometryMoved, routeById, options);
		return { positionById, routeById, labelPositionById: labels.positionById, reportList: [...scene.reportList, ...reportList, ...labels.reportList] };
	},
};
