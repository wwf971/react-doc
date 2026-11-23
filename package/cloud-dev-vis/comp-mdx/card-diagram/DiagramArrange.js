import { routeCompact } from './DiagramRoute.js';

// Arrangers (card-diagram-arrange.md): what arranges a diagram, kept apart from whatever
// asks for it. An arranger is a pure function from a diagram to a list of changes, so a
// generator of a read-only view, a generator of a first layout people then edit, and the
// editor re-applying it by hand all call the same thing. Nothing here knows a kind of card:
// which arrangers a component offers is said by its node registry (arrangerList).
//
//   arranger   { id, label, description,
//               geometryEstimate?(diagram, options)   where things are, for a caller who
//                                                     has no drawn diagram to ask
//               isApplicable?(diagram)                may it be offered for this diagram
//               arrange(diagram, geometry, options) } the changes
//
//   diagram   the authored data, { nodes, connections, defaults }, never changed in place
//   geometry  { rectOf(nodeId) -> { x, y, width, height, isBackground } | null,
//               endOf(connection, role) -> { x, y, side } | null }
//   options   { connectionIdList?, origin?, ... }: connectionIdList names the only lines
//             that may change; the rest of the options belong to the arranger
//   changes   { positionById?, handleSideList?: [{ nodeId, handleId, side, offset? }],
//               routeById?: { id: route | null }, labelPositionById?: { id: part of its line },
//               labelDistanceById?: { id: px along its line from its source (label.distance) },
//               reportList?: [{ kind, message, connectionId? }] }
//             A label given a part loses a distance it had; one given a distance keeps its part
//
// An arranger owns the routes it answers: the whole route of a line is replaced, its anchors
// removed and created anew. Only what the author locked is out of its reach here.
export const lineTypeOfConnection = (diagram, connection) => (connection.renderer ?? diagram.defaults?.connection?.renderer)?.type ?? 'smoothstep';

// the changes of an arranger, with what it has no right to change taken out
export function diagramArrangeRun(diagram, arranger, { geometry, ...options } = {}) {
	const geometryUsed = geometry ?? arranger.geometryEstimate?.(diagram, options);
	if (!geometryUsed) throw new Error(`The arranger ${arranger.id} needs the diagram drawn.`);
	const changes = arranger.arrange(diagram, geometryUsed, options) ?? {};
	const lockedSet = new Set((diagram.nodes ?? []).filter((node) => node.isPositionLocked).map((node) => node.id));
	const idSet = options.connectionIdList ? new Set(options.connectionIdList) : null;
	const positionById = Object.fromEntries(Object.entries(changes.positionById ?? {}).filter(([id]) => !lockedSet.has(id)));
	const routeById = Object.fromEntries(Object.entries(changes.routeById ?? {}).filter(([id]) => !idSet || idSet.has(id)).map(([id, route]) => [id, routeCompact(route)]));
	const labelPositionById = Object.fromEntries(Object.entries(changes.labelPositionById ?? {}).filter(([id]) => !idSet || idSet.has(id)));
	const labelDistanceById = Object.fromEntries(Object.entries(changes.labelDistanceById ?? {}).filter(([id]) => !idSet || idSet.has(id)));
	return { positionById, handleSideList: changes.handleSideList ?? [], routeById, labelPositionById, labelDistanceById, reportList: changes.reportList ?? [] };
}

// the diagram after an arranger: for a generator, which has the data as plain objects
export function diagramArrangeApply(diagram, arranger, options) {
	const { positionById, handleSideList, routeById, labelPositionById, labelDistanceById, reportList } = diagramArrangeRun(diagram, arranger, options);
	const changeByKey = new Map(handleSideList.map((item) => [`${item.nodeId}/${item.handleId}`, item]));
	const nodes = (diagram.nodes ?? []).map((node) => {
		const handles = node.handles?.map((handle) => {
			const change = changeByKey.get(`${node.id}/${handle.id}`);
			return change ? { ...handle, anchor: { ...handle.anchor, side: change.side, ...(change.offset !== undefined ? { offset: change.offset } : {}) } } : handle;
		});
		return { ...node, ...(handles ? { handles } : {}), ...(positionById[node.id] ? { position: positionById[node.id] } : {}) };
	});
	const connections = (diagram.connections ?? []).map((connection) => {
		const labelOf = () => {
			if (connection.id in labelDistanceById) return { ...connection.label, distance: labelDistanceById[connection.id] };
			const { distance: _distance, ...label } = connection.label ?? {};
			return { ...label, position: labelPositionById[connection.id] };
		};
		const labelled = connection.id in labelPositionById || connection.id in labelDistanceById ? { ...connection, label: labelOf() } : connection;
		if (!(connection.id in routeById)) return labelled;
		const { route: _route, ...rest } = labelled;
		return routeById[connection.id] ? { ...rest, route: routeById[connection.id] } : rest;
	});
	return { diagram: { ...diagram, nodes, connections }, reportList };
}

// the same place asked of a geometry after some cards moved and some handles changed side:
// an arranger placing cards routes the lines where the cards will be. an end whose side did not
// change moves with its card; one that went to the other side of its row stays at its height.
// endChangedOf(connection, role, rect, change): where an end that changed is, for an arranger
// that knows better (one turning a handle from a side to the top)
export function diagramGeometryMovedBuild(geometry, positionById = {}, handleSideList = [], { endChangedOf } = {}) {
	const changeByKey = new Map(handleSideList.map((item) => [`${item.nodeId}/${item.handleId}`, item]));
	const rectOf = (nodeId) => {
		const rect = geometry.rectOf(nodeId);
		return rect && positionById[nodeId] ? { ...rect, ...positionById[nodeId] } : rect;
	};
	const endOf = (connection, role) => {
		const end = geometry.endOf(connection, role);
		if (!end) return null;
		const { nodeId, handleId } = connection[role];
		const before = geometry.rectOf(nodeId);
		const rect = rectOf(nodeId);
		if (!before || !rect) return end;
		const change = changeByKey.get(`${nodeId}/${handleId}`);
		if (!change || (change.side === end.side && change.offset === undefined)) return { ...end, x: end.x + rect.x - before.x, y: end.y + rect.y - before.y };
		const endChanged = endChangedOf?.(connection, role, rect, change);
		if (endChanged) return endChanged;
		const side = change.side;
		if (side === 'left' || side === 'right') return { x: side === 'left' ? rect.x : rect.x + rect.width, y: rect.y + end.y - before.y, side };
		return { x: rect.x + end.x - before.x, y: side === 'top' ? rect.y : rect.y + rect.height, side };
	};
	return { rectOf, endOf };
}
