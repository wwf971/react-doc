import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramNodeContent, connectionPathBuild, useDiagramSearchMark } from './DiagramRender.jsx';
import { diagramNormalize, diagramPlacesGet, endpointIsDangling, handleAnchorDrawnOf } from './DiagramERData.js';
import { routePathPolylineGet } from './DiagramRoute.js';

// A diagram drawn without a canvas (card-diagram-impl.md#a-diagram-without-a-canvas): the same
// cards, placed absolutely, their lines in one svg. Nothing pans or zooms; the block is as large
// as what it draws, and scrolls with what holds it. For a place where a canvas would be in the
// way: a side panel, a page that is itself a diagram, a scene inside a card (the switch layer
// draws its embedded scenes with the pieces below).
//
//   DiagramStaticNode    one card: placed by its parent, measuring its anchors; the geometry
//                        goes up once it changes, not per frame
//   DiagramStaticLine    one line between two measured ends
//   DiagramStaticLabel   the label of a line, at its place along it
//   DiagramStatic        a whole diagram, from its data
const pathElement = () => document.createElementNS('http://www.w3.org/2000/svg', 'path');

// a point along a line, by the part of its length (the label of a line)
export function pathPointAt(d, part) {
	const path = pathElement();
	path.setAttribute('d', d);
	const length = path.getTotalLength();
	return path.getPointAtLength(length * part);
}

export const DiagramStaticNode = observer(function DiagramStaticNode({ id, node, position, config, registry, onGeometry, className = 'doc-diagram-static-node' }) {
	const root = useRef(null);
	const searchMark = useDiagramSearchMark(id);
	const anchors = useRef(new Map());
	const refs = useRef(new Map());
	const anchorRef = useCallback((anchorId) => {
		if (!refs.current.has(anchorId)) {
			refs.current.set(anchorId, (element) => {
				if (element) anchors.current.set(anchorId, element);
				else anchors.current.delete(anchorId);
			});
		}
		return refs.current.get(anchorId);
	}, []);
	useLayoutEffect(() => {
		const measure = () => {
			const element = root.current;
			if (!element || !element.offsetWidth) return;
			const bounds = element.getBoundingClientRect();
			const scale = bounds.width / element.offsetWidth || 1;
			const handleList = (node.handles ?? []).flatMap((handle) => {
				const anchorDrawn = handleAnchorDrawnOf(node, handle);
				const target = anchorDrawn === 'body' ? element : anchors.current.get(anchorDrawn) ?? (anchorDrawn !== handle.anchor.target ? element : undefined);
				if (!target) return [];
				const rect = target.getBoundingClientRect();
				const { side, offset } = handle.anchor;
				const isHorizontal = side === 'top' || side === 'bottom';
				const x = ((isHorizontal ? rect.left + rect.width * offset : side === 'left' ? rect.left : rect.right) - bounds.left) / scale;
				const y = ((isHorizontal ? (side === 'top' ? rect.top : rect.bottom) : rect.top + rect.height * offset) - bounds.top) / scale;
				return [{ id: handle.id, x, y, side }];
			});
			onGeometry(id, handleList, { width: element.offsetWidth, height: element.offsetHeight });
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root.current);
		return () => observer.disconnect();
	}, [id, node, onGeometry]);
	const visualization = useMemo(() => ({ nodeId: id, size: node.size, isEdit: false, anchorRef }), [id, node.size, anchorRef]);
	const width = node.isWidthFit ? 'max-content' : node.size.width === 'auto' ? node.sizeDefault.width : node.size.width;
	return (
		<div ref={root} className={className} data-id={id} data-link={node.link ? '' : undefined} data-search={searchMark.state ?? undefined} style={{ left: position.x, top: position.y, width, height: node.size.height === 'auto' ? undefined : node.size.height, zIndex: node.isBackground ? -1 : undefined, pointerEvents: node.isBackground ? 'none' : undefined }}>
			<div className="doc-vis-node-content not-prose">
				<DiagramNodeContent id={id} node={node} config={config} registry={registry} anchorRef={anchorRef} visualization={visualization} />
			</div>
		</div>
	);
});

export const diagramStaticEndsOf = (source, target) => ({ sourceX: source.x, sourceY: source.y, sourcePosition: source.side, targetX: target.x, targetY: target.y, targetPosition: target.side });

export function DiagramStaticLine({ connection, source, target, markerId }) {
	const d = connectionPathBuild(connection, diagramStaticEndsOf(source, target));
	return <path d={d} fill="none" style={connection.style} markerEnd={connection.markerEnd === 'none' || !markerId ? undefined : `url(#${markerId})`} />;
}

export const DiagramStaticLabel = observer(function DiagramStaticLabel({ connection, source, target, className = 'doc-diagram-static-label' }) {
	const searchState = useDiagramSearchMark('').lineStateOf(connection.id);
	const point = useMemo(() => {
		return pathPointAt(connectionPathBuild(connection, diagramStaticEndsOf(source, target)), connection.label.position);
	}, [connection, source, target]);
	return <div className={`${className}${connection.link ? ' is-link' : ''}`} data-search={searchState ?? undefined} style={{ transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)` }}>{connection.label.text}</div>;
});

// A whole diagram, still.
//
//   diagram       the data of a diagram ({ nodes, connections, defaults? }; version 1 when absent)
//   registry      the node registry its kinds come from
//   resolve       the resolver of registered components, when a node names one
//   padding       room around what is drawn, px
//   onNodeClick   (node, event): a click on a card that is not a background. a card with `link`
//                 shows a pointer; what a link opens is the caller's to say
//   onSize        ({ width, height, xOrigin, yOrigin }): the size of the block, and where the point
//                 (0, 0) of the diagram is drawn in it, when either changes. The block starts at what
//                 is drawn farthest up and left (less the padding), so a caller laying something of its
//                 own over the diagram places it from the origin, not from the block's corner
//
// A node with no position written stands where the grid of the diagram puts it; a background
// written `around` other nodes follows them as they are measured. A line ends in an arrow unless
// the diagram says otherwise (markerEnd: none, of the line or of defaults.connection).
export const DiagramStatic = observer(function DiagramStatic({ diagram, registry, resolve, config = {}, padding = 0, onNodeClick, onSize, className = '' }) {
	const markerId = `doc-diagram-arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
	const load = useMemo(() => {
		try {
			return { graph: diagramNormalize({ version: 1, ...diagram }, registry, resolve) };
		} catch (error) {
			return { message: String(error?.message ?? error) };
		}
	}, [diagram, registry, resolve]);
	const [geometry, geometrySet] = useState({ handleById: {}, sizeById: {} });
	const onGeometry = useCallback((id, handleList, size) => {
		geometrySet((previous) => {
			const isHandleSame = JSON.stringify(previous.handleById[id]) === JSON.stringify(handleList);
			const sizeBefore = previous.sizeById[id];
			const isSizeSame = sizeBefore && Math.abs(sizeBefore.width - size.width) < 0.5 && Math.abs(sizeBefore.height - size.height) < 0.5;
			if (isHandleSame && isSizeSame) return previous;
			return { handleById: isHandleSame ? previous.handleById : { ...previous.handleById, [id]: handleList }, sizeById: isSizeSame ? previous.sizeById : { ...previous.sizeById, [id]: size } };
		});
	}, []);
	const graph = load.graph;
	const place = useMemo(() => (graph ? diagramPlacesGet(graph.nodes, graph.layout, geometry.sizeById) : null), [graph, geometry.sizeById]);
	const lineList = useMemo(() => {
		if (!graph) return [];
		const endOf = (endpoint) => {
			if (endpointIsDangling(endpoint)) return { x: endpoint.position.x, y: endpoint.position.y, side: 'left' };
			const position = place.positions.get(endpoint.nodeId);
			const handle = geometry.handleById[endpoint.nodeId]?.find((item) => item.id === endpoint.handleId);
			return position && handle ? { x: position.x + handle.x, y: position.y + handle.y, side: handle.side } : null;
		};
		return graph.connections.flatMap((connection) => {
			const source = endOf(connection.source);
			const target = endOf(connection.target);
			return source && target ? [{ connection, source, target }] : [];
		});
	}, [graph, place, geometry.handleById]);
	// as large as what it draws: the cards as measured (as written until then), and the lines
	const box = useMemo(() => {
		if (!graph) return { x: 0, y: 0, width: 0, height: 0 };
		const pointList = [];
		for (const node of graph.nodes) {
			const position = place.positions.get(node.id) ?? { x: 0, y: 0 };
			const size = place.sizeById.get(node.id) ?? geometry.sizeById[node.id] ?? { width: node.size.width === 'auto' ? node.sizeDefault.width : node.size.width, height: node.size.height === 'auto' ? node.sizeDefault.height : node.size.height };
			pointList.push(position, { x: position.x + size.width, y: position.y + size.height });
		}
		for (const { connection, source, target } of lineList) pointList.push(...routePathPolylineGet(connectionPathBuild(connection, diagramStaticEndsOf(source, target))));
		if (pointList.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
		const xMin = Math.min(...pointList.map((point) => point.x));
		const yMin = Math.min(...pointList.map((point) => point.y));
		return { x: xMin - padding, y: yMin - padding, width: Math.ceil(Math.max(...pointList.map((point) => point.x)) - xMin + padding * 2), height: Math.ceil(Math.max(...pointList.map((point) => point.y)) - yMin + padding * 2) };
	}, [graph, place, geometry.sizeById, lineList, padding]);
	useLayoutEffect(() => { onSize?.({ width: box.width, height: box.height, xOrigin: -box.x, yOrigin: -box.y }); }, [onSize, box.width, box.height, box.x, box.y]);
	if (load.message) return <div className="doc-er-diagram-message is-error" role="alert"><strong>The diagram could not be read.</strong><span>{load.message}</span></div>;
	const nodeClick = onNodeClick ? (event) => {
		const id = event.target.closest?.('.doc-diagram-static-node')?.dataset.id;
		const node = graph.nodes.find((item) => item.id === id);
		if (node && !node.isBackground) onNodeClick(node, event);
	} : undefined;
	return (
		<div className={`doc-diagram-static not-prose${className ? ` ${className}` : ''}`} style={{ width: box.width, height: box.height }} onClick={nodeClick}>
			<div className="doc-diagram-static-world" style={{ transform: `translate(${-box.x}px, ${-box.y}px)` }}>
				<svg className="doc-diagram-static-lines" aria-hidden="true">
					<defs>
						<marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
							<path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
						</marker>
					</defs>
					{lineList.map(({ connection, source, target }) => <DiagramStaticLine key={connection.id} connection={connection} source={source} target={target} markerId={markerId} />)}
				</svg>
				{graph.nodes.filter((node) => node.renderer.type !== 'scene-box').map((node) => (
					<DiagramStaticNode key={node.id} id={node.id} node={node.around ? { ...node, size: place.sizeById.get(node.id) ?? node.size } : node} position={place.positions.get(node.id) ?? { x: 0, y: 0 }} config={config} registry={registry} onGeometry={onGeometry} />
				))}
				{lineList.filter(({ connection }) => connection.label.text).map(({ connection, source, target }) => <DiagramStaticLabel key={connection.id} connection={connection} source={source} target={target} />)}
			</div>
		</div>
	);
});
