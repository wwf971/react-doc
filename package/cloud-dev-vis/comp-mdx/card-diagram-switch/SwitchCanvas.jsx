import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Background, Controls, EdgeLabelRenderer, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, useStoreApi } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Check, CircleAlert, LoaderCircle } from '../../../../main/frontend/UICommon.js';
import { DiagramEdge, DiagramNode, DiagramPointNode, DiagramRenderContext, DiagramSearchPathContext, connectionPathBuild, useDiagramSearchMark } from '../card-diagram/DiagramRender.jsx';
import { useCanvasWheelGuard } from '../card-diagram/CanvasWheelGuard.js';
import { CanvasStill, useCanvasStill } from '../card-diagram/CanvasStill.jsx';
import { DiagramSearchBar, useDiagramSearchHost } from '../card-diagram/DiagramSearchView.jsx';
import { DiagramCreatePanel } from '../card-diagram/DiagramCreatePanel.jsx';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { DiagramPinLayer } from '../card-diagram/DiagramPinLayer.jsx';
import '../card-diagram/DiagramVisualEdit.css';
import { diagramCanvasLineListGet, diagramCanvasRegister } from '../card-diagram/DiagramCanvasRegistry.js';
import '../card-diagram/DiagramER.css';
import { SwitchContext, SwitchStaticScene, pathLabelPointAt } from './SwitchStatic.jsx';
import { SWITCH_ZOOM_MAX, SWITCH_ZOOM_MIN, switchEdgeHoverStyleBuild, switchPresentationBuild } from './SwitchData.js';

// The one React Flow canvas of a switching viewport: the nodes of the scene shown, or
// of a transition, handed over by the store. Every frame of a transition goes through
// the store (SwitchStore.frameApply): a camera, a few positions, one stylesheet. No card
// renders per frame.
//
//   children     drawn inside the canvas: the animation layer's <Sequence>s
const nodeMouseEnterNoop = () => {};
// narrower than the closest lanes an arranger leaves, so the pointer finds the line it is on
const SWITCH_EDGE_HIT_WIDTH = 10;
const errorNoop = () => {};

// the commands of the scene shown, or of a card or a line of it, opened where the pointer is
// (card-diagram-flexible-switch.md#commands): the point in the box of the canvas, the position on
// the canvas. Answers whether something opened (else the event goes on as it would)
function switchCommandOpenAt(store, rf, event, target) {
	const box = event.target.closest?.('.doc-switch-viewport')?.getBoundingClientRect();
	if (!box) return false;
	const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
	const isOpen = store.commandOpen({ ...target, position }, { x: event.clientX - box.left, y: event.clientY - box.top });
	if (isOpen) { event.preventDefault(); event.stopPropagation(); }
	return isOpen;
}

// what a click on a card of the scene shown is on, in the terms of a draft of it: the card, its
// row and the cell of it (data-row-id, data-field: TableCard.jsx), or a value of the card itself
function switchEditTargetOf(event, nodeId) {
	const rowId = event.target.closest?.('[data-row-id]')?.dataset.rowId;
	const field = event.target.closest?.('[data-field]')?.dataset.field;
	return { nodeId, ...(rowId ? { rowId, ...(field ? { fieldId: field } : {}) } : field ? { propId: field } : {}) };
}

// a scene edited in place starts its edit from a click on a thing of it, that thing focused
// (card-diagram-flexible-switch.md#a-scene-edited-in-place). Not at the end of a drag that
// selected words. Answers whether it started
function switchEditStartAt(store, target) {
	if (!store.sceneEditDesc || window.getSelection?.()?.toString()) return false;
	const select = store.sceneEditSelectOf(target);
	return select ? store.sceneEditStart(select) : false;
}

// a line of a scene: the line of the framework, with its label as html, which a
// link makes a button (the label of a table mapping opens the mapping of that column)
const SwitchEdge = observer(function SwitchEdge(props) {
	const { connection } = props.data;
	const store = useContext(SwitchContext)?.store;
	const searchState = useDiagramSearchMark('').lineStateOf(props.id) ?? undefined;
	const rf = useReactFlow();
	const commandOpen = (event) => { if (store) switchCommandOpenAt(store, rf, event, { kind: 'line', connection }); };
	const hasLabel = Boolean(connection.label?.text);
	const dataBase = useMemo(() => (hasLabel ? { ...props.data, connection: { ...connection, label: { ...connection.label, text: '' } } } : props.data), [hasLabel, props.data, connection]);
	// the pointer on the line or on its label marks both, the line whole, as it may run far from
	// its label. the state is this line's own, so entering a line renders that line alone. not
	// while a transition moves everything
	const [isPointerOn, isPointerOnSet] = useState(false);
	const isHovered = isPointerOn && !store?.plan;
	const hoverProps = { onPointerEnter: () => isPointerOnSet(true), onPointerLeave: () => isPointerOnSet(false), onFocus: () => isPointerOnSet(true), onBlur: () => isPointerOnSet(false) };
	const isPathNeeded = hasLabel || isHovered;
	const d = useMemo(() => (isPathNeeded ? connectionPathBuild(connection, props) : ''), [isPathNeeded, connection, props.sourceX, props.sourceY, props.targetX, props.targetY, props.sourcePosition, props.targetPosition]);
	const point = useMemo(() => (hasLabel && d ? pathLabelPointAt(d, connection.label) : null), [hasLabel, d, connection.label.position, connection.label.distance]); // eslint-disable-line react-hooks/exhaustive-deps
	const hoverStyle = isHovered ? switchEdgeHoverStyleBuild(connection.style) : null;
	const labelHoverClass = isHovered ? ' is-line-hovered' : '';
	// React Flow marks a line as not panning the canvas, for dragging its ends; here it takes the
	// pointer only to answer a hover, and a drag starting on it pans as anywhere else
	const lineRef = useRef(null);
	useLayoutEffect(() => { lineRef.current?.closest('.react-flow__edge')?.classList.remove('nopan'); });
	return <>
		{hoverStyle ? <path className="doc-switch-edge-hover" d={d} fill="none" style={hoverStyle.band} pointerEvents="none" /> : null}
		<g ref={lineRef} {...hoverProps}><DiagramEdge {...props} data={dataBase} interactionWidth={SWITCH_EDGE_HIT_WIDTH} /></g>
		{hoverStyle ? <path className="doc-switch-edge-hover" d={d} fill="none" style={hoverStyle.line} pointerEvents="none" /> : null}
		{hasLabel && point ? (
			<EdgeLabelRenderer>
				{connection.link ? (
					<button
						type="button"
						className={`doc-switch-edge-label is-link nodrag nopan${labelHoverClass}`}
						data-edge-id={props.id}
						data-search={searchState}
						title={connection.linkTitle}
						style={{ transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)` }}
						{...hoverProps}
						onContextMenu={commandOpen}
						onClick={(event) => {
							event.stopPropagation();
							isPointerOnSet(false);
							// a link the provider answers itself is not a scene, as for a card (linkOpen)
							if (store?.provider?.linkOpen?.(connection.link) === true) return;
							void store?.pathSet(connection.link);
						}}
					>
						{connection.label.text}
					</button>
				) : (
					<div className={`doc-switch-edge-label is-hoverable nodrag nopan${labelHoverClass}`} data-edge-id={props.id} data-search={searchState} {...hoverProps} onContextMenu={commandOpen} onClick={() => { if (store) switchEditStartAt(store, { connectionId: connection.id }); }} style={{ transform: `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)` }}>{connection.label.text}</div>
				)}
			</EdgeLabelRenderer>
		) : null}
	</>;
});

const nodeTypes = { visualizationNode: DiagramNode, visualizationPoint: DiagramPointNode };
const edgeTypes = { visualizationEdge: SwitchEdge };

const CAMERA_START = { x: 0, y: 0, zoom: 1 };

const SwitchFlow = observer(function SwitchFlow({ store, children }) {
	const rf = useReactFlow();
	const flowStore = useStoreApi();
	const isInitialized = useNodesInitialized();
	const { flowVersion } = store;
	useEffect(() => {
		// originGet: where the canvas stands on the screen, for a camera handed to another canvas taking
		// its place (config.viewInitial with origin: the editor of the block)
		store.viewportApiSet({
			viewportSet: (camera) => { void rf.setViewport(camera); },
			viewportGet: () => rf.getViewport(),
			originGet: () => { const rect = flowStore.getState().domNode?.getBoundingClientRect(); return rect ? { x: rect.left, y: rect.top } : null; },
		});
		return () => {
			store.cameraLive = { ...rf.getViewport() };
			store.viewportApiSet(null);
		};
	}, [store, rf, flowStore]);
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
			defaultViewport={store.cameraLive ?? CAMERA_START}
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
			onDoubleClick={(event) => { if (!isMoving && event.target.classList?.contains('react-flow__pane')) switchCommandOpenAt(store, rf, event, { kind: 'canvas' }); }}
			onPaneContextMenu={(event) => { if (!isMoving) switchCommandOpenAt(store, rf, event, { kind: 'canvas' }); }}
			onNodeContextMenu={(event, node) => { if (!isMoving && node.data?.node) switchCommandOpenAt(store, rf, event, { kind: 'node', node: node.data.node }); }}
			onEdgeContextMenu={(event, edge) => { if (!isMoving && edge.data?.connection) switchCommandOpenAt(store, rf, event, { kind: 'line', connection: edge.data.connection }); }}
			onEdgeClick={(_event, edge) => { if (!isMoving && !store.isBoxAdjust && edge.data?.connection && !edge.data.connection.link) switchEditStartAt(store, { connectionId: edge.id }); }}
			onNodeClick={(event, node) => {
				if (isMoving || store.isBoxAdjust) return;
				const nodeGraph = node.data?.node;
				// a part of a card may open something of its own (data-switch-link)
				const link = event.target.closest?.('[data-switch-link]')?.dataset.switchLink ?? nodeGraph?.link ?? (nodeGraph?.renderer.type === 'scene-embed' ? nodeGraph.data.scene : undefined);
				if (event.target.closest?.('button')) return;
				// no link: in a scene edited in place, the click starts the edit on what was clicked
				if (!link) { switchEditStartAt(store, switchEditTargetOf(event, node.id)); return; }
				// command:{id}: that command of the scene, in its state (a dashed row making something: New
				// action). A click never opens what can be done with a thing: that is a right-click
				if (link.startsWith('command:')) {
					const actionId = link.slice('command:'.length);
					if (actionId) switchCommandOpenAt(store, rf, event, { kind: 'canvas', actionId });
					return;
				}
				// a link the provider answers itself leaves the viewport (a page of the host): it is not a scene
				if (store.provider?.linkOpen?.(link) === true) return;
				void store.pathSet(link);
			}}
			onNodeDragStop={(_event, node) => { if (node.data?.node?.renderer.type === 'scene-box') store.boxCommit(node.id); }}
		>
			<Background gap={18} size={1} />
			<Controls showInteractive={false} />
			{children}
		</ReactFlow>
	);
});

// the panel of the commands open: the panel a double-click opens on a canvas being edited
// (DiagramCreatePanel), with no diagram being edited: the commands are its actions, some asking
// for what they need state by state. A corner of it stands where the pointer was, the one that
// keeps it inside the canvas (DiagramPopupPlace.js)
const SwitchCommandPanel = observer(function SwitchCommandPanel({ store }) {
	const { command } = store;
	const rootRef = useRef(null);
	// what a command is given as editor: no diagram being edited, the scene it is done in (go: to another;
	// edit: that scene, or this one, edited in place once it is shown)
	const editor = useMemo(() => ({ store: null, createClose: () => store.commandClose(), createChoose: () => store.commandClose(),
		scene: {
			get path() { return store.command?.path ?? store.pathCurrent; },
			go: (path) => { void store.pathSet(path); },
			edit: async (path) => {
				if (path && path !== store.pathCurrent) await store.pathSet(path);
				for (let wait = 0; store.plan && wait < 60; wait += 1) await new Promise((resolve) => { setTimeout(resolve, 50); });
				store.sceneEditStart();
			},
		} }), [store]);
	if (!command) return null;
	// the point is a pixel of the viewport; the panel stands in the top layer with a corner on it, so
	// near an edge of the viewport it reaches beyond it (AnchoredPopover, placement 'corner')
	const key = `${command.path}:${command.target.kind}:${command.point.x}:${command.point.y}`;
	return (
		<div ref={rootRef} className="doc-switch-command nodrag nopan" style={{ left: command.point.x, top: command.point.y }}>
			<AnchoredPopover key={key} anchorRef={rootRef} placement="corner" isShownFirst className="doc-vis-create-popover">
				<DiagramCreatePanel key={key} position={command.target.position} editor={editor} actionList={command.list} actionIdInitial={command.actionId || undefined}
					heading={command.heading ?? ''} placeholder={command.placeholder ?? 'What to do'} ariaLabel={command.heading || 'What can be done here'} />
			</AnchoredPopover>
		</div>
	);
});

// what covers the canvas while its nodes are replaced: the scene drawn statically, at the camera of the canvas
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
				<SwitchStaticScene store={store} path={mask.path} />
			</div>
		</div>
	);
});

// the scenes a transition is about to show, measured once, out of sight
const SwitchMeasureHost = observer(function SwitchMeasureHost({ store }) {
	return (
		<div className="doc-switch-measure" aria-hidden="true">
			{store.measurePathList.map((path) => <SwitchStaticScene key={path} store={store} path={path} />)}
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

// the search of a block: a find scope of the page, its bar, the camera brought to what is
// current. an item inside a stack of the scene shown is scrolled to first
const SwitchSearchHost = observer(function SwitchSearchHost({ store, search, hostRef }) {
	const rf = useReactFlow();
	useDiagramSearchHost({
		hostRef,
		search,
		label: store.provider?.title || 'Scenes',
		versionGet: () => [store.pathCurrent, store.flowVersion],
		cameraGet: () => rf.getViewport(),
		cameraSet: (camera) => {
			store.cameraReport(camera, true);
			void rf.setViewport(camera, { duration: 220 });
		},
		revealPrepare: (item) => {
			const holder = [...item.chain, item].find((entry) => entry.path === store.pathCurrent && entry.partId?.startsWith('item/'));
			if (holder) store.scrollTo({ nodeId: holder.nodeId, itemId: holder.partId.slice('item/'.length), isInstant: true });
		},
	});
	return <DiagramSearchBar search={search} />;
});

// what the scene on the canvas pins to the viewport (a legend): over the canvas, still while it moves
const SwitchPinLayer = observer(function SwitchPinLayer({ store, registry, config }) {
	const pinList = store.entryByPath.get(store.pathFlow)?.canvas.graph?.pinList;
	return <DiagramPinLayer pinList={pinList} registry={registry} config={config} />;
});

// the canvas in a box of its own, measured: the box is what cameras fit. a block
// playing it under another clock (the animation layer) puts this inside its composition
export const SwitchCanvas = observer(function SwitchCanvas({ store, config, registry, isStillOuter = false, children }) {
	const boxRef = useRef(null);
	useCanvasWheelGuard(boxRef);
	// a block mounted again holds the picture it left until the canvas drew; under the
	// animation layer the block holds it around the player, which draws the canvas late
	const still = useCanvasStill(config, 'switch', boxRef, { isEnabled: !isStillOuter });
	const [, readySet] = useState(false);
	// the search of the block (card-diagram-impl.md#search), kept with its store
	const search = useMemo(() => store.searchStoreGet(), [store]);
	const context = useMemo(() => ({
		config,
		registry,
		search,
		measurementSet: (id, size) => store.measurementSet(store.pathFlow, id, size),
		edgeGeometry: new Map(),
		sceneBox: { get isAdjust() { return store.isBoxAdjust; }, resizeEnd: (nodeId, params) => store.boxCommit(nodeId, params) },
	}), [config, registry, store, search]);
	// the scene shown, for the check of its lines (DiagramCanvasRegistry.js). only those it
	// shows are looked at: the geometry of a scene left stays behind
	useEffect(() => diagramCanvasRegister({
		sourcePath: config?.sourcePath ?? '',
		store,
		get title() { return store.pathFlow; },
		sourceGet: () => '',
		editorGet: () => null,
		endsGet: () => null,
		lineListGet: () => diagramCanvasLineListGet(context.edgeGeometry, store.entryGet(store.pathFlow)?.canvas.graph?.connections ?? []),
	}), [store, config, context]);
	const switchContext = useMemo(() => ({ store, isStatic: false, depth: 0, pathChain: [], get presentation() { return switchPresentationBuild(store.pathFlow, false, null, { depth: 0, depthMax: store.depthRenderMax }); } }), [store]);
	const searchPathGet = useMemo(() => () => store.pathFlow, [store]);
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
			<CanvasStill still={still} />
			<SwitchHint store={store} />
			<style ref={styleRef} />
			<ReactFlowProvider>
				<DiagramRenderContext.Provider value={context}>
					<SwitchContext.Provider value={switchContext}>
						<DiagramSearchPathContext.Provider value={searchPathGet}>
							<SwitchFlow store={store}>{children}</SwitchFlow>
						</DiagramSearchPathContext.Provider>
						<SwitchMask store={store} />
						<SwitchMeasureHost store={store} />
					</SwitchContext.Provider>
				</DiagramRenderContext.Provider>
				<SwitchSearchHost store={store} search={search} hostRef={boxRef} />
			</ReactFlowProvider>
			<SwitchCommandPanel store={store} />
			<SwitchPinLayer store={store} registry={registry} config={config} />
			{store.loadError ? (
				<div className="doc-er-diagram-message is-error doc-switch-error" role="alert">
					<strong>This scene could not be drawn.</strong>
					<span>{store.loadError}</span>
				</div>
			) : null}
		</div>
	);
});
