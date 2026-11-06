// The canvases on the page now, for what works a diagram from outside the component: the
// apis of a diagram (DiagramApiList.js) ask where the ends of a line are drawn, and
// whether an edit session is open on the block. Nothing else keeps anything here.
//
//   canvas   { sourcePath, title, sourceGet(), lineListGet(), endsGet(connectionId, connection), editorGet(), geometryGet() }
//            a switching viewport also has store, so that a check can walk through its views
import { endpointIsDangling } from './DiagramERData.js';

const canvasSet = new Set();

export function diagramCanvasRegister(canvas) {
	canvasSet.add(canvas);
	return () => canvasSet.delete(canvas);
}

export const diagramCanvasListGet = () => [...canvasSet];

// the canvas drawing this data of a document: its data is what the block says, or the
// draft of a session opened on it
export function diagramCanvasFind(sourcePath, raw) {
	return diagramCanvasListGet().find((canvas) => canvas.sourcePath === sourcePath && (canvas.editorGet()?.store.rawInitial === raw || canvas.sourceGet() === raw));
}

// the two ends of a line as it was last drawn (edgeGeometry of the canvas), in the terms of DiagramRoute.js
export function diagramCanvasEndsGet(edgeGeometry, connectionId, connection) {
	const geometry = edgeGeometry?.get(connectionId);
	if (!geometry) return null;
	const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = geometry;
	return { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, isSourceFree: endpointIsDangling(connection?.source), isTargetFree: endpointIsDangling(connection?.target) };
}

// the lines of a canvas as they are drawn, for routeOverlapListGet: an end is known by
// its node and handle
const endKeyOf = (endpoint) => (endpointIsDangling(endpoint) ? '' : `${endpoint.nodeId}/${endpoint.handleId}`);

export function diagramCanvasLineListGet(edgeGeometry, connectionList) {
	return connectionList.flatMap((connection) => {
		const d = edgeGeometry?.get(connection.id)?.d;
		return d ? [{ id: connection.id, d, sourceKey: endKeyOf(connection.source), targetKey: endKeyOf(connection.target) }] : [];
	});
}

// where things are on a canvas, for an arranger (DiagramArrange.js): the cards as measured, the
// ends of the lines as last drawn
export function diagramCanvasGeometryBuild(store, edgeGeometry) {
	return {
		rectOf: (nodeId) => {
			const node = store.nodeList.find((item) => item.id === nodeId);
			if (!node?.position || !node.data?.node) return null;
			const { size, sizeDefault, isBackground } = node.data.node;
			const measured = store.measurements[nodeId];
			return {
				x: node.position.x, y: node.position.y, isBackground,
				width: size.width === 'auto' ? measured?.width ?? sizeDefault.width : size.width,
				height: size.height === 'auto' ? measured?.height ?? sizeDefault.height : size.height,
			};
		},
		endOf: (connection, role) => {
			const ends = diagramCanvasEndsGet(edgeGeometry, connection.id, connection);
			if (!ends || (role === 'source' ? ends.isSourceFree : ends.isTargetFree)) return null;
			return role === 'source' ? { x: ends.sourceX, y: ends.sourceY, side: ends.sourcePosition } : { x: ends.targetX, y: ends.targetY, side: ends.targetPosition };
		},
	};
}
