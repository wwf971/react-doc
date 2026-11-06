import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Background, Controls, EdgeLabelRenderer, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, CircleAlert, LoaderCircle } from '../../../../main/frontend/UICommon.js';
import { DiagramEdge, DiagramNode, DiagramPointNode, DiagramRenderContext, connectionPathBuild } from '../card-diagram/DiagramRender.jsx';
import { useCanvasWheelGuard } from '../card-diagram/CanvasWheelGuard.js';
import { diagramCanvasLineListGet, diagramCanvasRegister } from '../card-diagram/DiagramCanvasRegistry.js';
import '../card-diagram/DiagramER.css';
import { SwitchContext, SwitchStaticView, pathPointAt } from './SwitchStatic.jsx';
import { SWITCH_ZOOM_MAX, SWITCH_ZOOM_MIN, switchPresentationBuild } from './SwitchData.js';

// The one React Flow canvas of a switching viewport: the nodes of the view shown, or
// of a transition, handed over by the store. Every frame of a transition goes through
// the store (SwitchStore.frameApply): a camera, a few positions, one stylesheet. No card
// renders per frame.
//
//   children     drawn inside the canvas: the animation layer's <Sequence>s
const nodeMouseEnterNoop = () => {};
const errorNoop = () => {};

// a line of a view: the line of the framework, with its label as html, which a
// link makes a button (the label of a table mapping opens the mapping of that column)
const SwitchEdge = observer(function SwitchEdge(props) {
	const { connection } = props.data;
	const store = useContext(SwitchContext)?.store;
	const hasLabel = Boolean(connection.label?.text);
	const dataBase = useMemo(() => (hasLabel ? { ...props.data, connection: { ...connection, label: { ...connection.label, text: '' } } } : props.data), [hasLabel, props.data, connection]);
	const point = useMemo(() => {
		if (!hasLabel) return null;
		return pathPointAt(connectionPathBuild(connection, props), connection.label.position);
	}, [hasLabel, connection, props.sourceX, props.sourceY, props.targetX, props.targetY, props.sourcePosition, props.targetPosition]);
	return <>
		<DiagramEdge {...props} data={dataBase} />
		{hasLabel && point ? (
			<EdgeLabelRenderer>
				{connection.link ? (
					<button
						type="button"
						className="doc-switch-edge-label is-link nodrag nopan"
						data-edge-id={props.id}
						title={connection.linkTitle}
						style={{ transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)` }}
						onClick={(event) => { event.stopPropagation(); void store?.pathSet(connection.link); }}
					>
						{connection.label.text}
					</button>
				) : (
					<div className="doc-switch-edge-label" data-edge-id={props.id} style={{ transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)` }}>{connection.label.text}</div>
				)}
			</EdgeLabelRenderer>
		) : null}
	</>;
});

const nodeTypes = { visualizationNode: DiagramNode, visualizationPoint: DiagramPointNode };
const edgeTypes = { visualizationEdge: SwitchEdge };

const SwitchFlow = observer(function SwitchFlow({ store, children }) {
	const rf = useReactFlow();
	const isInitialized = useNodesInitialized();
	const { flowVersion } = store;
	useEffect(() => {
		store.viewportApiSet({ viewportSet: (camera) => { void rf.setViewport(camera); }, viewportGet: () => rf.getViewport() });
		return () => store.viewportApiSet(null);
	}, [store, rf]);
	useEffect(() => { store.flowInitializedSet(isInitialized); }, [store, isInitialized, flowVersion]);
	useEffect(() => {
		if (!isInitialized || store.isCameraReady || !store.box) return undefined;
		const frameId = requestAnimationFrame(() => store.flowFirstReady());
		return () => cancelAnimationFrame(frameId);
	}, [store, isInitialized, store.box]);
	const isMoving = Boolean(store.plan);
	return (
		<ReactFlow
			className="doc-er-diagram-flow doc-switch-flow"
			nodes={store.nodeListFlow}
			edges={store.edgeListFlow}
			nodeTypes={nodeTypes}
			edgeTypes={edgeTypes}
			defaultViewport={{ x: 0, y: 0, zoom: 1 }}
			minZoom={SWITCH_ZOOM_MIN}
			maxZoom={SWITCH_ZOOM_MAX}
			proOptions={{ hideAttribution: true }}
			nodesDraggable={store.isBoxAdjust && !isMoving}
			nodesConnectable={false}
			connectionMode="loose"
			nodesFocusable={false}
			edgesFocusable={false}
			edgesReconnectable={false}
			elementsSelectable={false}
			panOnDrag={!isMoving}
			zoomOnScroll={!isMoving}
			zoomOnPinch={!isMoving}
			zoomOnDoubleClick={false}
			deleteKeyCode={null}
			selectionKeyCode={null}
			multiSelectionKeyCode={null}
			onError={errorNoop}
			onNodesChange={store.nodeListChange}
			onNodeMouseEnter={nodeMouseEnterNoop}
			onMove={(event, camera) => store.cameraReport(camera, Boolean(event))}
			onNodeClick={(event, node) => {
				if (isMoving || store.isBoxAdjust) return;
				const nodeGraph = node.data?.node;
				const link = nodeGraph?.link ?? (nodeGraph?.renderer.type === 'view-embed' ? nodeGraph.data.view : undefined);
				if (link && !event.target.closest?.('button')) void store.pathSet(link);
			}}
			onNodeDragStop={(_event, node) => { if (node.data?.node?.renderer.type === 'view-box') store.boxCommit(node.id); }}
		>
			<Background gap={18} size={1} />
			<Controls showInteractive={false} />
			{children}
		</ReactFlow>
	);
});

// what covers the canvas while its nodes are replaced: the view drawn statically, at the camera of the canvas
const SwitchMask = observer(function SwitchMask({ store }) {
	const { mask } = store;
	const rootRef = useRef(null);
	const worldRef = useRef(null);
	useLayoutEffect(() => {
		store.maskElementSet(rootRef.current, worldRef.current);
		return () => store.maskElementSet(null, null);
	}, [store, Boolean(mask)]);
	if (!mask) return null;
	return (
		<div ref={rootRef} className="doc-switch-mask" aria-hidden="true" style={{ clipPath: mask.clip }}>
			<div ref={worldRef} className="doc-switch-embed-world" style={{ transform: `translate(${mask.camera.x}px, ${mask.camera.y}px) scale(${mask.camera.zoom})` }}>
				<SwitchStaticView store={store} path={mask.path} />
			</div>
		</div>
	);
});

// the views a transition is about to show, measured once, out of sight
const SwitchMeasureHost = observer(function SwitchMeasureHost({ store }) {
	return (
		<div className="doc-switch-measure" aria-hidden="true">
			{store.measurePathList.map((path) => <SwitchStaticView key={path} store={store} path={path} />)}
		</div>
	);
});

const SwitchHint = observer(function SwitchHint({ store }) {
	const hint = store.captureHint;
	if (!hint) return null;
	const Icon = { working: LoaderCircle, done: Check, failed: CircleAlert }[hint.status];
	return (
		<div className="doc-anim-capture-hint" data-status={hint.status} role={hint.status === 'failed' ? 'alert' : 'status'}>
			<Icon size={13} aria-hidden="true" />
			<span>{hint.text}</span>
		</div>
	);
});

// the canvas in a box of its own, measured: the box is what cameras fit. a block
// playing it under another clock (the animation layer) puts this inside its composition
export const SwitchCanvas = observer(function SwitchCanvas({ store, config, registry, children }) {
	const boxRef = useRef(null);
	useCanvasWheelGuard(boxRef);
	const [, readySet] = useState(false);
	const context = useMemo(() => ({
		config,
		registry,
		measurementSet: (id, size) => store.measurementSet(store.pathFlow, id, size),
		edgeGeometry: new Map(),
		viewBox: { get isAdjust() { return store.isBoxAdjust; }, resizeEnd: (nodeId, params) => store.boxCommit(nodeId, params) },
	}), [config, registry, store]);
	// the view shown, for the check of its lines (DiagramCanvasRegistry.js). only those it
	// shows are looked at: the geometry of a view left stays behind
	useEffect(() => diagramCanvasRegister({
		sourcePath: config?.sourcePath ?? '',
		store,
		get title() { return store.pathFlow; },
		sourceGet: () => '',
		editorGet: () => null,
		endsGet: () => null,
		lineListGet: () => diagramCanvasLineListGet(context.edgeGeometry, store.entryGet(store.pathFlow)?.canvas.graph?.connections ?? []),
	}), [store, config, context]);
	const switchContext = useMemo(() => ({ store, isStatic: false, depth: 0, pathChain: [], get presentation() { return switchPresentationBuild(store.pathFlow); } }), [store]);
	useLayoutEffect(() => {
		const element = boxRef.current;
		if (!element) return undefined;
		const measure = () => {
			if (element.clientWidth > 0 && element.clientHeight > 0) store.boxSet({ width: element.clientWidth, height: element.clientHeight });
			readySet(true);
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, [store]);
	const styleRef = (element) => store.styleElementSet(element);
	return (
		<div ref={boxRef} className="doc-switch-viewport" data-ready={store.isCameraReady ? '' : undefined}>
			<SwitchHint store={store} />
			<style ref={styleRef} />
			<ReactFlowProvider>
				<DiagramRenderContext.Provider value={context}>
					<SwitchContext.Provider value={switchContext}>
						<SwitchFlow store={store}>{children}</SwitchFlow>
						<SwitchMask store={store} />
						<SwitchMeasureHost store={store} />
					</SwitchContext.Provider>
				</DiagramRenderContext.Provider>
			</ReactFlowProvider>
			{store.loadError ? (
				<div className="doc-er-diagram-message is-error doc-switch-error" role="alert">
					<strong>This view could not be drawn.</strong>
					<span>{store.loadError}</span>
				</div>
			) : null}
		</div>
	);
});
