import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DiagramNodeContent, DiagramRenderContext, connectionPathBuild } from '../card-diagram/DiagramRender.jsx';
import { endpointIsDangling, handleAnchorDrawnOf } from '../card-diagram/DiagramERData.js';
import { switchPresentationBuild } from './SwitchData.js';

// A scene drawn without React Flow (card-diagram-flexible-switch.md#embedding): the
// same cards, placed absolutely, with its lines in one svg. This is what an embedded
// scene is, what covers the canvas while its nodes are replaced, and what measures a
// scene before it is shown. There is never a second React Flow canvas: a scene inside
// a scene is plain React, scaled by a transform of its parent.
//
// `pathOwner` reaches the cards below: the scene they belong to; `depth` stops a
// scene embedding itself.
export const SwitchContext = createContext(null);

const SWITCH_DEPTH_MAX = 3;
const pathElement = () => document.createElementNS('http://www.w3.org/2000/svg', 'path');

// a point along a line, by the part of its length (the label of a line)
export function pathPointAt(d, part) {
	const path = pathElement();
	path.setAttribute('d', d);
	const length = path.getTotalLength();
	return path.getPointAtLength(length * part);
}

// one card: placed by the scene, measuring its anchors; the geometry goes up once, not per frame
const StaticNode = observer(function StaticNode({ id, node, position, config, registry, onGeometry }) {
	const root = useRef(null);
	const anchors = useRef(new Map());
	const refs = useRef(new Map());
	const measureRef = useRef(() => {});
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
		measureRef.current = measure;
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root.current);
		return () => observer.disconnect();
	}, [id, node, onGeometry]);
	const visualization = useMemo(() => ({ nodeId: id, size: node.size, isEdit: false, anchorRef }), [id, node.size, anchorRef]);
	const width = node.isWidthFit ? 'max-content' : node.size.width === 'auto' ? node.sizeDefault.width : node.size.width;
	return (
		<div ref={root} className="doc-switch-static-node" data-id={id} style={{ left: position.x, top: position.y, width, height: node.size.height === 'auto' ? undefined : node.size.height, zIndex: node.isBackground ? -1 : undefined, pointerEvents: node.isBackground ? 'none' : undefined }}>
			<div className="doc-vis-node-content">
				<DiagramNodeContent id={id} node={node} config={config} registry={registry} anchorRef={anchorRef} visualization={visualization} />
			</div>
		</div>
	);
});

const staticEndsOf = (source, target) => ({ sourceX: source.x, sourceY: source.y, sourcePosition: source.side, targetX: target.x, targetY: target.y, targetPosition: target.side });

function StaticLine({ connection, source, target, markerId }) {
	const d = connectionPathBuild(connection, staticEndsOf(source, target));
	return <path d={d} fill="none" style={connection.style} markerEnd={connection.markerEnd === 'none' ? undefined : `url(#${markerId})`} />;
}

function StaticLabel({ connection, source, target }) {
	const point = useMemo(() => {
		return pathPointAt(connectionPathBuild(connection, staticEndsOf(source, target)), connection.label.position);
	}, [connection, source, target]);
	return <div className={`doc-switch-edge-label${connection.link ? ' is-link' : ''}`} style={{ transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)` }}>{connection.label.text}</div>;
}

export const SwitchStaticScene = observer(function SwitchStaticScene({ store, path, depth = 0, isEmbedded = false, pathEmbedder = null }) {
	const parent = useContext(SwitchContext);
	const { config, registry } = useContext(DiagramRenderContext);
	const markerId = `doc-switch-arrow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
	const [geometryById, geometrySet] = useState({});
	const entry = store.entryGet(path);
	const onGeometry = useCallback((id, handleList, size) => {
		store.measurementSet(path, id, size);
		geometrySet((previous) => {
			const next = JSON.stringify(handleList);
			return JSON.stringify(previous[id]) === next ? previous : { ...previous, [id]: handleList };
		});
	}, [store, path]);
	const context = useMemo(() => ({ store, isStatic: true, depth, pathChain: [...(parent?.pathChain ?? []), path], presentation: switchPresentationBuild(path, isEmbedded, pathEmbedder) }), [store, depth, parent, path, isEmbedded, pathEmbedder]);
	if (!entry?.canvas.graph) return null;
	if (depth >= SWITCH_DEPTH_MAX) return null;
	void store.measureVersion;
	const positions = store.entryPositionsGet(entry);
	const nodeList = entry.canvas.graph.nodes.filter((node) => node.renderer.type !== 'scene-box');
	// a root drawn as the canvas draws it (a mask, the measuring host) has the title of the scene
	// focused; an embedded copy is named by what holds it
	const titleNode = !isEmbedded && depth === 0 ? store.titleNodeOf?.(path) ?? null : null;
	const titleRect = titleNode ? store.titleRectOf(path) : null;
	const endOf = (endpoint) => {
		if (endpointIsDangling(endpoint)) return { x: endpoint.position.x, y: endpoint.position.y, side: 'left' };
		const position = positions.get(endpoint.nodeId);
		const handle = geometryById[endpoint.nodeId]?.find((item) => item.id === endpoint.handleId);
		return position && handle ? { x: position.x + handle.x, y: position.y + handle.y, side: handle.side } : null;
	};
	const lineList = entry.canvas.graph.connections.flatMap((connection) => {
		const source = endOf(connection.source);
		const target = endOf(connection.target);
		return source && target ? [{ connection, source, target }] : [];
	});
	return (
		<SwitchContext.Provider value={context}>
			<div className="doc-switch-static">
				<svg className="doc-switch-static-lines" aria-hidden="true">
					<defs>
						<marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
							<path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
						</marker>
					</defs>
					{lineList.map(({ connection, source, target }) => <StaticLine key={connection.id} connection={connection} source={source} target={target} markerId={markerId} />)}
				</svg>
				{titleNode && titleRect ? <StaticNode key={titleNode.id} id={titleNode.id} node={titleNode} position={titleRect} config={config} registry={registry} onGeometry={onGeometry} /> : null}
				{nodeList.map((node) => (
					<StaticNode key={node.id} id={node.id} node={node.around ? { ...node, size: store.nodeSizeOf(entry, node) } : node} position={positions.get(node.id) ?? { x: 0, y: 0 }} config={config} registry={registry} onGeometry={onGeometry} />
				))}
				{lineList.filter(({ connection }) => connection.label.text).map(({ connection, source, target }) => <StaticLabel key={connection.id} connection={connection} source={source} target={target} />)}
			</div>
		</SwitchContext.Provider>
	);
});
