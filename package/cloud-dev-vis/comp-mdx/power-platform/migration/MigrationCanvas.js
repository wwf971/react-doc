import { diagramArrangeApply } from '../../card-diagram/DiagramArrange.js';
import { erGeometryEstimateBuild } from '../er-arrange/ErGeometry.js';
import { erArrangerColumns } from '../er-arrange/er-arranger-list.js';
import { migrationDiagramDefaults, migrationErGraphBuild } from './MigrationScenes.js';

// A canvas of one database a person arranges (power-platform-migration.md#a-canvas-drawn-by-hand):
// one diagram of the card diagram format, edited with the visual editor, in which the tables and
// option sets of a database stand where they were put, beside whatever was added by hand (a note,
// a color block, a line).
//
// The diagram holds two sorts of things:
//   of the database   nodes table:{db}:{logical}, choice:{db}:{logical}, external:{db}:{logical} and
//                     connections lookup:{db}:…, choice:{db}:…: made from the model, never by hand.
//                     migrationCanvasSync makes them again from the model as it is now, each node
//                     keeping where it stands
//   by hand           everything else: left as it is
//
// So the data is read again from the database without the drawing: a table that changed is drawn
// as it is now where it stood, one that is gone leaves with its lines, one that is new is placed
// (at a point, when one is given: where a reader double-clicked; else beside what is drawn).
const GAP_COLUMN = 170;
const GAP_ROW = 56;
const DB_NODE_PREFIX_LIST = ['table', 'choice', 'external'];
const DB_LINE_PREFIX_LIST = ['lookup', 'choice'];

const prefixIs = (id, prefixList, dbId) => prefixList.some((prefix) => String(id).startsWith(`${prefix}:${dbId}:`));
export const migrationCanvasNodeIsOfDb = (node, dbId) => prefixIs(node.id, DB_NODE_PREFIX_LIST, dbId);
const lineIsOfDb = (connection, dbId) => prefixIs(connection.id, DB_LINE_PREFIX_LIST, dbId);

// the logical names of the tables a drawing holds: what the canvas keeps when the drawing is saved
export function migrationCanvasTableListOf(diagram, dbId) {
	const prefix = `table:${dbId}:`;
	return (diagram?.nodes ?? []).filter((node) => String(node.id).startsWith(prefix)).map((node) => String(node.id).slice(prefix.length));
}

const rectOfBuild = (nodes) => {
	const geometry = erGeometryEstimateBuild({ nodes });
	return (nodeId) => geometry.rectOf(nodeId);
};

// diagram: the drawing as saved (null for a canvas never drawn). model: of the items of the canvas.
// position: where what is new goes. answers { diagram, addedList, removedList } (node ids)
export function migrationCanvasSync(diagramInput, model, dbId, { position, erColumnCountMax } = {}) {
	const diagramOld = diagramInput ?? { nodes: [], connections: [] };
	const generated = migrationErGraphBuild(model, dbId, { erColumnCountMax });
	const nodeOldById = new Map((diagramOld.nodes ?? []).map((node) => [node.id, node]));
	const generatedIdSet = new Set(generated.nodes.map((node) => node.id));
	const isDrawnBefore = (diagramOld.nodes ?? []).some((node) => migrationCanvasNodeIsOfDb(node, dbId));
	const removedList = (diagramOld.nodes ?? []).filter((node) => migrationCanvasNodeIsOfDb(node, dbId) && !generatedIdSet.has(node.id)).map((node) => node.id);
	const removedSet = new Set(removedList);
	// the lines by hand: kept while both their ends stand
	const endStands = (endpoint) => !endpoint?.nodeId || (nodeOldById.has(endpoint.nodeId) && !removedSet.has(endpoint.nodeId));
	const lineHandList = (diagramOld.connections ?? []).filter((connection) => !lineIsOfDb(connection, dbId) && endStands(connection.source) && endStands(connection.target));
	const handleUsedSet = new Set(lineHandList.flatMap((connection) => [connection.source, connection.target]).filter((endpoint) => endpoint?.nodeId).map((endpoint) => `${endpoint.nodeId}|${endpoint.handleId}`));
	const addedList = [];
	const nodeOfDbList = generated.nodes.map((node) => {
		const old = nodeOldById.get(node.id);
		if (!old) {
			addedList.push(node.id);
			return node;
		}
		// where it stands and how large it was made are the reader's; a handle a line by hand ends on stays
		const handleIdSet = new Set(node.handles.map((handle) => handle.id));
		const handleKeptList = (old.handles ?? []).filter((handle) => !handleIdSet.has(handle.id) && handleUsedSet.has(`${node.id}|${handle.id}`));
		return { ...node, position: old.position ?? node.position, ...(old.size ? { size: old.size } : {}), ...(old.isPositionLocked ? { isPositionLocked: true } : {}), handles: [...node.handles, ...handleKeptList] };
	});
	const placedList = isDrawnBefore || addedList.length === 0 ? addedPlace(nodeOfDbList, new Set(addedList), generated.connections, position) : allArrange(nodeOfDbList, generated.connections, position);
	const nodeHandList = (diagramOld.nodes ?? []).filter((node) => !migrationCanvasNodeIsOfDb(node, dbId));
	// a line of the database keeps the route a reader gave it while it runs between the same ends
	const lineOldById = new Map((diagramOld.connections ?? []).map((connection) => [connection.id, connection]));
	const endSame = (a, b) => a?.nodeId === b?.nodeId && a?.handleId === b?.handleId;
	const lineOfDbList = generated.connections.map((connection) => {
		const old = lineOldById.get(connection.id);
		return old?.route && endSame(old.source, connection.source) && endSame(old.target, connection.target) ? { ...connection, route: old.route } : connection;
	});
	const { nodes: nodesOld, connections: connectionsOld, ...rest } = diagramOld;
	return {
		diagram: { version: 1, defaults: migrationDiagramDefaults, ...rest, nodes: [...nodeHandList, ...placedList], connections: [...lineOfDbList, ...lineHandList] },
		addedList,
		removedList,
	};
}

// nothing of the database was drawn yet: everything is arranged as an ER diagram, from the point given
function allArrange(nodeList, connections, position) {
	const origin = position ? { x: Math.round(position.x), y: Math.round(position.y) } : { x: 0, y: 0 };
	// the places alone are taken: the lines stay plain, so they follow a card that is moved
	return diagramArrangeApply({ nodes: nodeList, connections }, erArrangerColumns, { origin }).diagram.nodes;
}

// what is new beside what stands: the tables one under another from the point (else at the right
// of everything drawn), each with the option sets and outside tables that came with it at its right
function addedPlace(nodeList, addedSet, connections, position) {
	if (addedSet.size === 0) return nodeList;
	const rectOf = rectOfBuild(nodeList.map((node) => (addedSet.has(node.id) ? { ...node, position: { x: 0, y: 0 } } : node)));
	const standList = nodeList.filter((node) => !addedSet.has(node.id)).map((node) => rectOf(node.id)).filter(Boolean);
	const start = position
		? { x: Math.round(position.x), y: Math.round(position.y) }
		: { x: standList.length ? Math.max(...standList.map((rect) => rect.x + rect.width)) + GAP_COLUMN : 0, y: standList.length ? Math.min(...standList.map((rect) => rect.y)) : 0 };
	const isTable = (id) => String(id).startsWith('table:');
	const tableAddedList = nodeList.filter((node) => addedSet.has(node.id) && isTable(node.id));
	const positionById = new Map();
	let y = start.y;
	const sideOf = (tableId) => connections.filter((connection) => connection.source.nodeId === tableId && addedSet.has(connection.target.nodeId) && !isTable(connection.target.nodeId) && !positionById.has(connection.target.nodeId)).map((connection) => connection.target.nodeId);
	for (const table of tableAddedList) {
		const rect = rectOf(table.id);
		positionById.set(table.id, { x: start.x, y });
		let ySide = y;
		for (const sideId of [...new Set(sideOf(table.id))]) {
			positionById.set(sideId, { x: start.x + rect.width + GAP_COLUMN, y: ySide });
			ySide += (rectOf(sideId)?.height ?? 120) + GAP_ROW;
		}
		y = Math.max(y + rect.height, ySide - GAP_ROW) + GAP_ROW;
	}
	// what came without a new table (an option set a column now uses): under the rest
	for (const node of nodeList) {
		if (!addedSet.has(node.id) || positionById.has(node.id)) continue;
		positionById.set(node.id, { x: start.x, y });
		y += (rectOf(node.id)?.height ?? 120) + GAP_ROW;
	}
	return nodeList.map((node) => (positionById.has(node.id) ? { ...node, position: positionById.get(node.id) } : node));
}
