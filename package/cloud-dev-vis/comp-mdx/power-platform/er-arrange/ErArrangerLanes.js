import { lineTypeOfConnection } from '../../card-diagram/DiagramArrange.js';
import { routeResolve, routeTypeIsRightAngle } from '../../card-diagram/DiagramRoute.js';
import { erLinesRoute } from './ErLineRouter.js';
import { erGeometryEstimateBuild } from './ErGeometry.js';

const TABLE_TYPE_LIST = ['dataverse-table', 'dataverse-choice', 'table'];
export const erArrangerIsApplicable = (diagram) => (diagram.nodes ?? []).some((node) => TABLE_TYPE_LIST.includes(node.renderer?.type));

// what the line router needs of a diagram: its cards and its right-angled, attached lines.
// a line out of scope stays as it is and counts as something to keep off
export function erLineSceneGet(diagram, geometry, { connectionIdList } = {}) {
	const idSet = connectionIdList ? new Set(connectionIdList) : null;
	const rectList = (diagram.nodes ?? []).flatMap((node) => {
		const rect = geometry.rectOf(node.id);
		return rect ? [{ ...rect, id: node.id }] : [];
	});
	const lineList = [];
	const placedList = [];
	const reportList = [];
	const keyOf = (endpoint) => `${endpoint.nodeId}/${endpoint.handleId}`;
	for (const connection of diagram.connections ?? []) {
		const type = lineTypeOfConnection(diagram, connection);
		if (!routeTypeIsRightAngle(type)) continue;
		const source = connection.source?.nodeId ? geometry.endOf(connection, 'source') : null;
		const target = connection.target?.nodeId ? geometry.endOf(connection, 'target') : null;
		if (!source || !target) {
			reportList.push({ kind: 'skipped', connectionId: connection.id, message: `${connection.id}: it has a free end, or is not drawn` });
			continue;
		}
		const line = { id: connection.id, type, source, target, sourceNodeId: connection.source.nodeId, targetNodeId: connection.target.nodeId, sourceKey: keyOf(connection.source), targetKey: keyOf(connection.target) };
		if (idSet && !idSet.has(connection.id)) {
			const ends = { sourceX: source.x, sourceY: source.y, sourcePosition: source.side, targetX: target.x, targetY: target.y, targetPosition: target.side };
			placedList.push({ id: line.id, d: routeResolve(type, connection.route ?? null, ends).d, sourceKey: line.sourceKey, targetKey: line.targetKey });
		} else lineList.push(line);
	}
	return { rectList, lineList, placedList, reportList };
}

// the cards stay where they are; every right-angled line gets a new route
export const erArrangerLanes = {
	id: 'er-lanes',
	label: 'Route the lines',
	description: 'Keeps the cards where they are. Replaces the anchors of every right-angled line, giving each a lane of its own.',
	isApplicable: erArrangerIsApplicable,
	geometryEstimate: (diagram, options) => erGeometryEstimateBuild(diagram, options),
	arrange(diagram, geometry, options) {
		const scene = erLineSceneGet(diagram, geometry, options);
		const { routeById, reportList } = erLinesRoute(scene);
		return { routeById, reportList: [...scene.reportList, ...reportList] };
	},
};
