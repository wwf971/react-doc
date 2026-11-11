import { lineTypeOfConnection } from './DiagramArrange.js';
import { routeTypeIsRightAngle } from './DiagramRoute.js';

// The outline arranger (card-diagram-arrange.md#the-outline-arranger): a graph read downward in a
// narrow place. Its nodes stand one under another, each on a row of its own, indented by a level
// its caller gives; its lines run straight, vertical or horizontal, in the margin beside the rows.
//
//   ◯ above                    a line from the bottom (or top) of a node to the side of another
//   │                          turns once, under (or over) the node it leaves: the lines leaving
//   ◯ above                    one handle downward are a trunk, which is the stretch at the end
//   └──◉ the one               they share (card-diagram-usage.md#no-lines-on-top-of-each-other)
//        ├──◯ below
//        └──◯ below            a line between two handles on the same side (left, or right) goes
//   ┌─────◯ another            out into the margin on that side, along a lane of its own, and
//   └─────◯ that it uses       back in
//
// It knows no kind of card. Where an anchor is in a node comes from the kind, when the caller
// passes the registry (contract.anchorRectEstimate), else from the node's rectangle.
//
//   options   origin?: { x, y }                 the top left of the first row
//             levelById?: { nodeId: 0, 1, .. }  the indent of a row; 0 when absent
//             gapBeforeById?: { nodeId: px }    room over a row, to set groups apart
//             indent?, rowGap?, laneGap?        px: 22, 8, 10
//             isPlaced?: false                  keeps the nodes where they are, routes only
//             registry?                         for geometryEstimate
const INDENT = 22;
const ROW_GAP = 8;
const LANE_GAP = 10;
const round = (value) => Math.round(value * 100) / 100;
const isSide = (side) => side === 'left' || side === 'right';

// where things are, from what the data says alone: the written size of a node (else the default
// of its kind), a handle on the side of its anchor's rectangle
export function diagramGeometryEstimateBuild(diagram, { registry, positionFallback = { x: 0, y: 0 } } = {}) {
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	const contractOf = (node) => registry?.kindByType?.[node.renderer?.type]?.contract;
	const rectOf = (nodeId) => {
		const node = nodeById.get(nodeId);
		if (!node) return null;
		const position = node.position && node.position !== 'auto' ? node.position : positionFallback;
		const sizeDefault = { width: 220, height: 100, ...contractOf(node)?.sizeDefault };
		const width = typeof node.size?.width === 'number' ? node.size.width : sizeDefault.width;
		const height = typeof node.size?.height === 'number' ? node.size.height : sizeDefault.height;
		return { x: position.x, y: position.y, width, height, isBackground: contractOf(node)?.isBackground === true };
	};
	const endOf = (connection, role) => {
		const endpoint = connection[role];
		const node = nodeById.get(endpoint?.nodeId);
		const handle = node?.handles?.find((item) => item.id === endpoint.handleId);
		const rectNode = node ? rectOf(node.id) : null;
		if (!handle || !rectNode) return null;
		const { side = 'right', target = 'body', offset = 0.5 } = handle.anchor ?? {};
		const rect = contractOf(node)?.anchorRectEstimate?.(node, target, rectNode) ?? rectNode;
		if (side === 'top' || side === 'bottom') return { x: rect.x + rect.width * offset, y: side === 'top' ? rect.y : rect.y + rect.height, side };
		return { x: side === 'left' ? rect.x : rect.x + rect.width, y: rect.y + rect.height * offset, side };
	};
	return { rectOf, endOf };
}

const routeOfPointList = (pointList, target) => ({ anchorList: pointList.map((point, index) => ({ id: `a${index + 1}`, along: 1, x: round(point.x - target.x), y: round(point.y - target.y) })) });

export const diagramArrangerOutline = {
	id: 'outline',
	label: 'Outline',
	description: 'Stands the nodes one under another, indented by level. A right-angled line leaving the bottom of a node turns once into the side of another; a line between two handles on one side gets a lane of its own in the margin.',
	geometryEstimate: (diagram, options) => diagramGeometryEstimateBuild(diagram, options),
	arrange(diagram, geometry, { origin = { x: 0, y: 0 }, levelById = {}, gapBeforeById = {}, indent = INDENT, rowGap = ROW_GAP, laneGap = LANE_GAP, isPlaced = true } = {}) {
		const reportList = [];
		const positionById = {};
		const rectById = new Map();
		let y = origin.y;
		for (const node of diagram.nodes ?? []) {
			const rect = geometry.rectOf(node.id);
			if (!rect) continue;
			if (rect.isBackground || !isPlaced) { rectById.set(node.id, rect); continue; }
			y += gapBeforeById[node.id] ?? 0;
			const position = { x: round(origin.x + (levelById[node.id] ?? 0) * indent), y: round(y) };
			positionById[node.id] = position;
			rectById.set(node.id, { ...rect, ...position });
			y += rect.height + rowGap;
		}
		// an end moves with its node
		const endOf = (connection, role) => {
			const end = geometry.endOf(connection, role);
			const before = geometry.rectOf(connection[role].nodeId);
			const after = rectById.get(connection[role].nodeId);
			return end && before && after ? { ...end, x: end.x + after.x - before.x, y: end.y + after.y - before.y } : null;
		};
		const routeById = {};
		const laneLineList = [];
		for (const connection of diagram.connections ?? []) {
			if (!routeTypeIsRightAngle(lineTypeOfConnection(diagram, connection))) continue;
			const source = connection.source?.nodeId ? endOf(connection, 'source') : null;
			const target = connection.target?.nodeId ? endOf(connection, 'target') : null;
			if (!source || !target) {
				reportList.push({ kind: 'skipped', connectionId: connection.id, message: `${connection.id}: it has a free end, or is not drawn` });
				continue;
			}
			if (isSide(source.side) && source.side === target.side) {
				laneLineList.push({ id: connection.id, source, target, side: source.side });
			} else if (!isSide(source.side) && isSide(target.side)) {
				// down (or up) from the node, then into the side of the other
				const isForward = (source.side === 'bottom' ? target.y > source.y : target.y < source.y) && (target.side === 'left' ? target.x > source.x : target.x < source.x);
				if (isForward) routeById[connection.id] = routeOfPointList([{ x: source.x, y: target.y }], target);
				else reportList.push({ kind: 'skipped', connectionId: connection.id, message: `${connection.id}: its target is not on the way of a line leaving the ${source.side} of its source` });
			} else if (isSide(source.side) && !isSide(target.side)) {
				const isForward = (target.side === 'top' ? target.y > source.y : target.y < source.y) && (source.side === 'right' ? target.x > source.x : target.x < source.x);
				if (isForward) routeById[connection.id] = routeOfPointList([{ x: target.x, y: source.y }], target);
				else reportList.push({ kind: 'skipped', connectionId: connection.id, message: `${connection.id}: its source is not on the way of a line arriving at the ${target.side} of its target` });
			} else if (!isSide(source.side) && Math.abs(source.x - target.x) < 0.5) {
				routeById[connection.id] = null;
			} else {
				reportList.push({ kind: 'skipped', connectionId: connection.id, message: `${connection.id}: the outline has no way between a ${source.side} and a ${target.side} handle` });
			}
		}
		// the lanes: the shortest line nearest the rows, so lines of one handle nest without crossing;
		// a lane is shared only by lines that do not run side by side
		const placedList = [];
		for (const line of [...laneLineList].sort((a, b) => Math.abs(a.source.y - a.target.y) - Math.abs(b.source.y - b.target.y))) {
			const yMin = Math.min(line.source.y, line.target.y);
			const yMax = Math.max(line.source.y, line.target.y);
			if (yMax - yMin < 0.5) { routeById[line.id] = null; continue; }
			// clear of every card standing beside its stretch
			const xList = [line.source.x, line.target.x];
			for (const rect of rectById.values()) {
				if (rect.isBackground || rect.y + rect.height <= yMin || rect.y >= yMax) continue;
				xList.push(line.side === 'left' ? rect.x : rect.x + rect.width);
			}
			const xInner = line.side === 'left' ? Math.min(...xList) : Math.max(...xList);
			const xOf = (lane) => xInner + (line.side === 'left' ? -1 : 1) * laneGap * (lane + 1);
			let lane = 0;
			while (placedList.some((other) => other.side === line.side && other.yMin <= yMax && yMin <= other.yMax && Math.abs(other.x - xOf(lane)) < laneGap - 0.5)) lane += 1;
			placedList.push({ side: line.side, yMin, yMax, x: xOf(lane) });
			routeById[line.id] = routeOfPointList([{ x: xOf(lane), y: line.source.y }, { x: xOf(lane), y: line.target.y }], line.target);
		}
		return { positionById, routeById, reportList };
	},
};
