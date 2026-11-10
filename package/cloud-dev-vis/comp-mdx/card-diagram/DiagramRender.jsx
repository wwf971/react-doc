import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { BaseEdge, Handle, Position, ViewportPortal, getBezierPath, getSmoothStepPath, getStraightPath, useUpdateNodeInternals, useViewport } from '@xyflow/react';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { DiagramCreatePanel } from './DiagramCreatePanel.jsx';
import { cardSchemaGet } from './TableCardSchema.js';
import { endpointIsDangling, handleAnchorDrawnOf } from './DiagramERData.js';
import { routeIsEmpty, routeResolve, routeTypeHasAnchors } from './DiagramRoute.js';
import { DiagramRouteControls } from './DiagramRouteControls.jsx';

// what every node and edge of a canvas shares: the component config, the
// node registry of the component (registry, node-registry.js: the card of
// each node type), the editor of the visual edit mode (undefined while reading), the measurement
// callback of the canvas store, and the geometry every edge reports as it
// draws (edgeGeometry: id -> { sourceX, sourceY, targetX, targetY,
// sourcePosition, targetPosition, midX, midY, d }), which the editor uses to
// place the edit card of a line, to draw a line being detached, and to find
// lines lying on top of each other
export const DiagramRenderContext = createContext({});

// search (card-diagram-impl.md#search): DiagramRenderContext.search is the search of the canvas
// (DiagramSearchStore), absent where nothing searches; the marks of a card and of its parts are
// read from it here
// the scene a card is drawn in, for its marks: '' in a diagram of one scene; the switch layer
// gives the path of the scene focused on the canvas, and of each scene drawn inside a card.
// a value, or a function read while rendering (an observable path)
export const DiagramSearchPathContext = createContext('');

// how a node (and its parts) is marked: 'match', 'current' or null. read in an observer
export function useDiagramSearchMark(nodeId) {
	const { search } = useContext(DiagramRenderContext);
	const pathValue = useContext(DiagramSearchPathContext);
	const path = typeof pathValue === 'function' ? pathValue() : pathValue;
	return {
		state: search?.stateOf(path, nodeId) ?? null,
		partStateOf: (partId) => search?.stateOf(path, nodeId, partId) ?? null,
		lineStateOf: (connectionId) => search?.lineStateOf(path, connectionId) ?? null,
	};
}

const positions = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom };

// the node component React Flow renders, around the card. while a node is
// dragged React Flow renders it every frame with its new position; the
// card inside is given the same props (node, anchorRef, visualization keep
// their identity), so it is not rendered again, and the other nodes are
// not touched at all (DiagramERStore: nodeList keeps their identity)
export const DiagramNode = observer(function DiagramNode({ id, data }) {
	const { node } = data;
	const { config = {}, registry, measurementSet, editor } = useContext(DiagramRenderContext);
	const root = useRef(null);
	const searchMark = useDiagramSearchMark(id);
	const anchors = useRef(new Map());
	const refs = useRef(new Map());
	const measureCurrent = useRef(() => {});
	const [geometry, geometrySet] = useState({ handles: [], missing: [] });
	const updateNodeInternals = useUpdateNodeInternals();
	const anchorRef = useCallback(anchorId => {
		if (!refs.current.has(anchorId)) refs.current.set(anchorId, element => {
			if (element) anchors.current.set(anchorId, element);
			else anchors.current.delete(anchorId);
			measureCurrent.current();
		});
		return refs.current.get(anchorId);
	}, []);
	useLayoutEffect(() => {
		let frame;
		const measure = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const element = root.current;
				if (!element || !element.offsetWidth) return;
				const bounds = element.getBoundingClientRect();
				const scale = bounds.width / element.offsetWidth || 1;
				// a row left out by rowDisplay has no anchor drawn, which matters only if a handle is on it
				// a card of many views draws other rows in each: a handle on a row not drawn now stands on the side of the card
				const isViewed = Boolean(node.data?.viewList?.length);
				const isAnchorNeeded = anchor => !isViewed && (!node.data?.rowDisplay || node.handles.some(handle => handle.anchor.target === anchor.id));
				const missing = node.anchors.filter(anchor => anchor.id !== 'body' && !anchors.current.has(anchor.id) && isAnchorNeeded(anchor)).map(anchor => anchor.id);
				const handles = node.handles.flatMap(handle => {
					const anchorDrawn = handleAnchorDrawnOf(node, handle);
					const target = anchorDrawn === 'body' ? element : anchors.current.get(anchorDrawn) ?? (isViewed || anchorDrawn !== handle.anchor.target ? element : null);
					if (!target) return [];
					observer.observe(target);
					const rect = target.getBoundingClientRect();
					const { side, offset } = handle.anchor;
					const horizontal = side === 'top' || side === 'bottom';
					const left = ((horizontal ? rect.left + rect.width * offset : side === 'left' ? rect.left : rect.right) - bounds.left) / scale;
					const top = ((horizontal ? side === 'top' ? rect.top : rect.bottom : rect.top + rect.height * offset) - bounds.top) / scale;
					return [{ ...handle, left, top, isHidden: top < 0 || top > element.offsetHeight || left < -1 || left > element.offsetWidth + 1 }];
				});
				geometrySet(previous => JSON.stringify(previous) === JSON.stringify({ handles, missing }) ? previous : { handles, missing });
				measurementSet?.(id, { width: element.offsetWidth, height: element.offsetHeight });
			});
		};
		const observer = new ResizeObserver(measure);
		measureCurrent.current = measure;
		observer.observe(root.current);
		root.current.addEventListener('scroll', measure, true);
		measure();
		return () => {
			measureCurrent.current = () => {};
			cancelAnimationFrame(frame);
			observer.disconnect();
			root.current?.removeEventListener('scroll', measure, true);
		};
	}, [id, node, measurementSet]);
	useLayoutEffect(() => { updateNodeInternals(id); }, [geometry, id, updateNodeInternals]);
	const visualization = useMemo(() => ({ nodeId: id, size: node.size, isEdit: false, anchorRef }), [id, node.size, anchorRef]);
	const selection = editor?.store.selection;
	const connectionSelected = selection?.nodeId === id && selection.connectionId ? editor.store.connectionGet(selection.connectionId) : undefined;
	const isConnectable = Boolean(editor) && !editor.isLocked;
	return (
		<div ref={root} className={`doc-vis-node${node.isBackground && !editor ? ' is-background' : ''}${node.size.height === 'auto' ? ' is-height-auto' : ''}`} data-search={searchMark.state ?? undefined} style={{ height: node.size.height === 'auto' ? 'auto' : '100%' }}>
			<div className="doc-vis-node-content not-prose">
				<DiagramNodeContent id={id} node={node} config={config} registry={registry} editor={editor} anchorRef={anchorRef} visualization={visualization} />
			</div>
			{geometry.missing.length ? <div className="doc-vis-node-error" role="alert">Missing anchors: {geometry.missing.join(', ')}</div> : null}
			{node.handles.map(handle => geometry.handles.find(item => item.id === handle.id) ?? { ...handle, left: '50%', top: '50%', isHidden: true }).map(handle => {
				const isSelected = Boolean(connectionSelected) && ['source', 'target'].some(role => !endpointIsDangling(connectionSelected[role]) && connectionSelected[role].nodeId === id && connectionSelected[role].handleId === handle.id);
				const count = editor ? editor.store.handleConnectionListGet(id, handle.id).length : 0;
				return <Handle key={handle.id} id={handle.id} type={handle.direction === 'in' ? 'target' : 'source'} position={positions[handle.anchor.side]} isConnectable={isConnectable}
					className={`doc-er-table-handle is-${handle.direction}${isSelected ? ' is-selected' : ''}${count ? ' is-occupied' : ''}${editor ? ' is-editable' : ''}${handle.isMarkerHidden && !editor ? ' is-marker-hidden' : ''}`}
					title={editor ? `${handle.id}: ${count === 0 ? 'drag to connect' : `${count} connection${count === 1 ? '' : 's'}; click to select one, drag to connect`}` : undefined}
					style={{ left: handle.left, top: handle.top, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)', visibility: handle.isHidden ? 'hidden' : 'visible' }}
					onClick={editor ? event => { event.stopPropagation(); editor.handleClick(id, handle.id); } : undefined} />;
			})}
		</div>
	);
});

// the content of a node: a registered component (renderer.component), or the
// card of its kind in the node registry of the component
export const DiagramNodeContent = observer(function DiagramNodeContent({ id, node, config, registry, editor, anchorRef, visualization }) {
	if (node.renderer.component) return <RegisteredComp compName={node.renderer.component} placement="visualizationNode" input={{ data: node.data }} configRuntime={{ ...config, instanceId: `${config.instanceId ?? 'diagram'}:node:${id}`, isEdit: false, visualization }} />;
	const Card = registry?.kindByType[node.renderer.type]?.Card;
	if (!Card) return <div className="doc-vis-node-error" role="alert">No card draws a {node.renderer.type} node.</div>;
	return <Card node={node} schema={cardSchemaGet(node, registry)} anchorRef={anchorRef} editor={editor} nodeId={id} />;
});

// the node a dangling end of a connection ends on: one handle at the node's
// origin and no size. while reading it is invisible (the edge draws the end);
// in the editor it shows a dot that can be dragged, above the cards, to move
// the end or to drop it on a handle; a click on it selects the line
export const DiagramPointNode = observer(function DiagramPointNode({ data }) {
	const { editor } = useContext(DiagramRenderContext);
	return <div className="doc-vis-point">
		<Handle id="end" type="source" position={Position.Left} isConnectable={false} className="doc-vis-point-handle" />
		{editor ? <div className="doc-vis-point-dot" title="Drag the free end; drop it on a handle to attach it. Click to select the line" onClick={event => { event.stopPropagation(); editor.selectConnection(data.connectionId); }} /> : null}
	</div>;
});

// the temporary node of the create panel, at the canvas position that was
// double-clicked; drawn at screen scale whatever the zoom
export const DiagramCreateNode = observer(function DiagramCreateNode({ data }) {
	const { editor, config } = useContext(DiagramRenderContext);
	const { zoom } = useViewport();
	if (!editor) return null;
	return <div className="doc-vis-create nodrag nopan nowheel" style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top left' }}>
		<DiagramCreatePanel position={data.position} editor={editor} objectService={config?.object} sessionKey={`diagram-create:${config?.instanceId ?? 'diagram'}`} />
	</div>;
});

// the path of a line: its route when it has one (DiagramRoute.js), else what React
// Flow's helper draws between the two ends
export function pathBuild(type, props) {
	if (routeTypeHasAnchors(type) && !routeIsEmpty(props.route)) return routeResolve(type, props.route, props).d;
	if (type === 'polyline') {
		const waypoints = props.waypoints ?? [];
		return `M ${props.sourceX},${props.sourceY} ${[...waypoints, { x: props.targetX, y: props.targetY }].map(point => `L ${point.x},${point.y}`).join(' ')}`;
	}
	const helper = type === 'straight' ? getStraightPath : type === 'bezier' ? getBezierPath : getSmoothStepPath;
	return helper({ ...props, ...(type === 'step' ? { borderRadius: 0 } : {}) })[0];
}

// the path of a connection between its two ends, wherever it is drawn: the canvas,
// a static view, a label placed along it
export function connectionPathBuild(connection, ends) {
	return pathBuild(connection.renderer.type, {
		...ends,
		route: connection.route,
		waypoints: connection.route?.waypoints,
		isSourceFree: endpointIsDangling(connection.source),
		isTargetFree: endpointIsDangling(connection.target),
	});
}

export const DiagramEdge = observer(function DiagramEdge(props) {
	const { config = {}, editor, edgeGeometry } = useContext(DiagramRenderContext);
	const { connection } = props.data;
	const searchState = useDiagramSearchMark('').lineStateOf(props.id);
	const pathRef = useRef(null);
	const [labelPoint, labelPointSet] = useState(null);
	const isSelected = editor?.store.selection?.connectionId === props.id;
	// while an anchor or a handle of this line is dragged, the route being dragged
	// (the draft holds the route it had, until the drop)
	const routeDraft = isSelected && editor.store.routeDraft?.connectionId === props.id ? editor.store.routeDraft.route : undefined;
	const connectionDrawn = routeDraft === undefined ? connection : { ...connection, route: routeDraft };
	const pathValue = connectionPathBuild(connectionDrawn, props);
	useLayoutEffect(() => {
		if (!pathRef.current) return;
		const length = pathRef.current.getTotalLength();
		const point = pathRef.current.getPointAtLength(length * connection.label.position);
		labelPointSet({ x: point.x, y: point.y });
		// the edit card stands at the middle of the two ends, not of the path: a
		// change of the route does not move it (the card never moves under the author)
		edgeGeometry?.set(props.id, { sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY, sourcePosition: props.sourcePosition, targetPosition: props.targetPosition, midX: (props.sourceX + props.targetX) / 2, midY: (props.sourceY + props.targetY) / 2, d: pathValue });
	}, [pathValue, connection.label.position, props.id, edgeGeometry]);
	const ends = ['source', 'target'].filter(role => endpointIsDangling(connection[role])).map(role => (
		<circle key={role} className="doc-vis-edge-end" cx={role === 'source' ? props.sourceX : props.targetX} cy={role === 'source' ? props.sourceY : props.targetY} r={4} />
	));
	if (connection.renderer.component) {
		return <>
			<RegisteredComp compName={connection.renderer.component} placement="visualizationEdge" input={{ data: connection.data }} configRuntime={{ ...config, instanceId: `${config.instanceId ?? 'diagram'}:edge:${props.id}`, isEdit: false, visualization: { connectionId: props.id, connection, source: { x: props.sourceX, y: props.sourceY, side: props.sourcePosition }, target: { x: props.targetX, y: props.targetY, side: props.targetPosition }, markerStart: props.markerStart, markerEnd: props.markerEnd, isEdit: false, BaseEdge } }} />
			{ends}
		</>;
	}
	return <>
		{isSelected && routeTypeHasAnchors(connection.renderer.type) && !editor.isLocked ? <ViewportPortal><DiagramRouteControls editor={editor} connection={connectionDrawn} ends={props} /></ViewportPortal> : null}
		<path ref={pathRef} d={pathValue} fill="none" stroke="none" pointerEvents="none" />
		{isSelected ? <path d={pathValue} fill="none" className="doc-vis-edge-selection" pointerEvents="none" /> : null}
		<BaseEdge id={props.id} path={pathValue} markerStart={props.markerStart} markerEnd={props.markerEnd} style={connection.style} interactionWidth={props.interactionWidth ?? 24}
			label={connection.label.text} labelX={labelPoint?.x ?? (props.sourceX + props.targetX) / 2} labelY={labelPoint?.y ?? (props.sourceY + props.targetY) / 2}
			labelStyle={{ fontSize: 11, fontWeight: 650 }} labelBgPadding={[6, 3]} labelBgBorderRadius={3}
			labelBgStyle={searchState ? { fill: searchState === 'current' ? 'rgb(249 115 22 / 55%)' : 'rgb(250 204 21 / 55%)' } : undefined} />
		{ends}
	</>;
});

// the line React Flow draws while a connection is dragged. for a connection
// being detached from a handle it runs from the connection's other end
// (its geometry as last drawn) to the pointer, in the connection's own
// style, so the author sees the line they are moving and not a new one
export const DiagramConnectionLine = observer(function DiagramConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, connectionStatus }) {
	const { editor, edgeGeometry } = useContext(DiagramRenderContext);
	const interaction = editor?.store.interaction;
	let from = { x: fromX, y: fromY, position: fromPosition };
	let style = { stroke: '#2563eb', strokeWidth: 1.5, strokeDasharray: '5 4' };
	if (interaction?.type === 'detach') {
		const geometry = edgeGeometry?.get(interaction.connectionId);
		const connection = editor.store.connectionGet(interaction.connectionId);
		if (geometry) from = interaction.role === 'source' ? { x: geometry.targetX, y: geometry.targetY, position: geometry.targetPosition } : { x: geometry.sourceX, y: geometry.sourceY, position: geometry.sourcePosition };
		if (connection) style = { ...connection.style };
	}
	const [path] = getSmoothStepPath({ sourceX: from.x, sourceY: from.y, sourcePosition: from.position, targetX: toX, targetY: toY, targetPosition: toPosition });
	return <g className={`doc-vis-connection-line${connectionStatus ? ` is-${connectionStatus}` : ''}`}>
		<path d={path} fill="none" style={style} />
		<circle cx={toX} cy={toY} r={4} className="doc-vis-edge-end" />
	</g>;
});
