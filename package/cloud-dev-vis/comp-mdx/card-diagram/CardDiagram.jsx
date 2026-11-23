import { useContext, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
	Background,
	ControlButton,
	Controls,
	MiniMap,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	useNodesInitialized,
	useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Copy, Search } from '../../../../main/frontend/UICommon.js';
import { BlockPopupSurface } from '../../../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { DiagramERStore, DiagramCopyStore, diagramViewStateGet } from './DiagramERStore.js';
import { DiagramNode, DiagramPointNode, DiagramCreateNode, DiagramEdge, DiagramConnectionLine, DiagramRenderContext } from './DiagramRender.jsx';
import { DiagramPinLayer } from './DiagramPinLayer.jsx';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import './DiagramER.css';
import { DiagramVisualEdit } from './DiagramVisualEdit.jsx';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import { useCanvasWheelGuard } from './CanvasWheelGuard.js';
import { CanvasStill, useCanvasStill } from './CanvasStill.jsx';
import { DiagramSearchStore } from './DiagramSearchStore.js';
import { diagramSceneSearch } from './DiagramSearch.js';
import { DiagramSearchBar, useDiagramSearchHost } from './DiagramSearchView.jsx';
import { diagramCanvasGeometryBuild, diagramCanvasLineListGet, diagramCanvasRegister, diagramCanvasEndsGet } from './DiagramCanvasRegistry.js';

// A diagram of nodes and connections on a pannable, zoomable canvas
// (card-diagram-impl.md), drawn with the node registry of its component type
// (node-registry.js): what each node type is and draws, and what the create
// panel offers. A series makes its diagram component with
// cardDiagramCompCreate(registry); CardDiagram is the one of the base series.
// Both modes render inside BlockPopupSurface
// (doc_page_impl_mdx_comp_block.md): the diagram opens in the block popup,
// fills it, and switches between View and Edit there. The outer box of the
// surface carries the block's margins; the figure has none, so it sits
// flush in the popup and the geometry lock of an edit session measures the
// block from the outer box.
const CardDiagramBase = observer(function CardDiagramBase({ data = {}, config = {}, onEvent, registry }) {
	const [copyStore] = useState(() => new DiagramCopyStore());
	const isVisualEdit = config.isEdit && config.edit?.modeId === 'visual';
	// the copy action is one of the block's toolbar (the surface's), never a
	// button group of the diagram's own: one size with the open button
	const actionList = isVisualEdit ? [] : [{ id: 'copy', label: copyStore.label, Icon: Copy, onClick: () => copyStore.copy(data.source || data.raw || '', onEvent) }];
	return (
		<BlockPopupSurface config={config} title={data.title || 'Diagram'} className="doc-er-diagram-shell not-prose" actionList={actionList}>
			{({ isInPopup }) => (isVisualEdit
				? <DiagramVisualEdit data={data} config={config} onEvent={onEvent} kind="diagram" registry={registry} isInPopup={isInPopup} renderContent={props => <DiagramERView {...props} config={config} onEvent={onEvent} registry={registry} isInPopup={isInPopup} />} />
				: <DiagramERView data={data} config={config} onEvent={onEvent} registry={registry} isInPopup={isInPopup} />)}
		</BlockPopupSurface>
	);
});

// the diagram component of a node registry: register it under a tag name
// (compDefine) with the exposure of the component type
export function cardDiagramCompCreate(registry, name) {
	const CompRender = props => <CardDiagramBase {...props} registry={registry} />;
	CompRender.displayName = name;
	return CompRender;
}

export const DiagramERView = observer(function DiagramERView({ data = {}, config = {}, onEvent, registry, editor, isInPopup = false }) {
	const sourceDiagram = data.source || data.raw || '';
	const { compById, docStore, sourceStore } = useDocStores();
	const sourceStoreDocPathGet = () => docStore.docCurrentPath;
	const [viewState] = useState(() => diagramViewStateGet(sourceStore, config));
	const [store] = useState(() => new DiagramERStore(sourceDiagram, (name, placement) => {
		const definition = compDefinitionNormalize(compById[compIdResolve(sourceStore.configDoc, name)]);
		if (!definition?.placementList?.includes(placement)) return undefined;
		return definition.expose?.[placement];
	}, heightGet(data.height ?? config.height), registry));
	const edgeGeometry = useRef(new Map());
	const viewportRef = useRef(null);
	useCanvasWheelGuard(viewportRef);
	const still = useCanvasStill(config, 'diagram', viewportRef);
	// the search of the diagram (card-diagram-impl.md#search): what its graph answers, where it
	// is drawn now
	const [search] = useState(() => new DiagramSearchStore());
	search.searcherSet((request) => {
		return diagramSceneSearch({ path: '', graph: store.graph, rectOf: (id) => diagramNodeRectOf(store, id), request, registry });
	});
	// the height is an authored prop (data.height); config.height is the
	// form a host passes it in
	const heightDiagram = store.viewport.size.height === 'auto' ? 620 : store.viewport.size.height;
	// canvasStore: the canvas model itself, for a layer of a feature drawn over the canvas (what its placer answered: store.placed)
	const context = { config, registry, editor, measurementSet: store.measurementSet, edgeGeometry: edgeGeometry.current, search, canvasStore: store };

	useEffect(() => {
		if (store.source !== sourceDiagram) store.sourceLoad(sourceDiagram, Boolean(editor));
	}, [sourceDiagram, store]);

	// the canvas, for what works a diagram from outside it: the apis of its lines (DiagramApiList.js)
	const canvasEditor = useRef(editor);
	canvasEditor.current = editor;
	useEffect(() => diagramCanvasRegister({
		sourcePath: config.sourcePath ?? sourceStoreDocPathGet(),
		title: data.title ?? '',
		sourceGet: () => store.source,
		editorGet: () => canvasEditor.current,
		endsGet: (connectionId, connection) => diagramCanvasEndsGet(edgeGeometry.current, connectionId, connection),
		lineListGet: () => diagramCanvasLineListGet(edgeGeometry.current, store.graph?.connections ?? [], store.graph?.nodes),
		geometryGet: () => diagramCanvasGeometryBuild(store, edgeGeometry.current),
	}), [store, config.sourcePath, data.title]);

	return (
		<figure
			className={`doc-er-diagram${isInPopup ? ' is-popup' : ''}${editor ? ' is-editing' : ''}`}
			aria-label={data.title ?? 'Diagram'}
			style={{ '--doc-er-diagram-height': `${heightDiagram}px`, width: isInPopup || store.viewport.size.width === 'auto' ? '100%' : store.viewport.size.width, maxWidth: '100%' }}
		>
			<div ref={viewportRef} className="doc-er-diagram-viewport">
				<CanvasStill still={still} />
				<ReactFlowProvider>
					<DiagramRenderContext.Provider value={context}><DiagramERCanvas store={store} viewState={viewState} isEditing={Boolean(editor)} /></DiagramRenderContext.Provider>
					<DiagramSearchHost search={search} hostRef={viewportRef} label={data.title || 'Diagram'} versionGet={() => store.graphVersion} />
				</ReactFlowProvider>
			</div>
		</figure>
	);
});

// where a node is drawn, for the order of what a search found
function diagramNodeRectOf(store, nodeId) {
	const node = store.nodeList.find((item) => item.id === nodeId);
	const measured = store.measurements[nodeId];
	return { x: node?.position?.x ?? 0, y: node?.position?.y ?? 0, width: measured?.width ?? 0, height: measured?.height ?? 0 };
}

// the search of a diagram: a find scope of the page, its bar, the camera brought to what is current
const DiagramSearchHost = observer(function DiagramSearchHost({ search, hostRef, label, versionGet }) {
	const rf = useReactFlow();
	useDiagramSearchHost({ hostRef, search, label, versionGet, cameraGet: () => rf.getViewport(), cameraSet: (camera) => { void rf.setViewport(camera, { duration: 220 }); } });
	return <DiagramSearchBar search={search} />;
});

// the search, seen: a button beside the zoom, for the bar mod+f opens with the pointer over the
// canvas (a diagram of one scene has no bar of its own to hold it, as the switch layer's path bar does)
const DiagramSearchControl = observer(function DiagramSearchControl({ search }) {
	if (!search) return null;
	return (
		<ControlButton className="doc-diagram-search-control" title="Find in the diagram" aria-label="Find in the diagram" aria-pressed={search.isOpen} onClick={() => (search.isOpen ? search.close() : search.open())}>
			<Search aria-hidden="true" />
		</ControlButton>
	);
});

const DiagramERCanvas = observer(function DiagramERCanvas({ store, viewState, isEditing = false }) {
	const { editor, edgeGeometry, search, config, registry } = useContext(DiagramRenderContext);
	const { fitView, setViewport, getViewport, getNode, getInternalNode, screenToFlowPosition, flowToScreenPosition } = useReactFlow();
	const isInitialized = useNodesInitialized();
	// the zoom, as a custom property of the canvas: the controls drawn over a
	// card (the toolbars of a focused row or field) undo it, so they keep
	// their screen size at any zoom (DiagramVisualEdit.css)
	const { zoom } = useViewport();
	const wrapper = useRef(null);
	// drawn at its camera once: a host covering the canvas until then looks at data-ready
	const [isReady, isReadySet] = useState(false);
	const graphVersion = store.graphVersion;
	const viewport = store.viewport;
	const isLocked = Boolean(editor?.isLocked);
	// a draft whose structure is given (DiagramEditStore.js: scope): no node is moved, no route drawn by hand
	const isFixed = Boolean(editor?.store.isStructureFixed);
	const selection = editor?.store.selection;
	const interaction = editor?.store.interaction;
	const create = editor?.store.create;
	// while reading, a node is never dragged: a drag on a card pans the
	// canvas, as on empty space, and a drag in a row selects its text. the
	// node and edge objects handed to React Flow keep their identity while
	// nothing about them changed (decorated once per store item and flag
	// set), so a drag frame re-renders the dragged node alone
	const decorated = useRef(new WeakMap());
	const decorate = (item, flags, build) => {
		const key = JSON.stringify(flags);
		const cached = decorated.current.get(item);
		if (cached?.key === key) return cached.value;
		const value = build();
		decorated.current.set(item, { key, value });
		return value;
	};
	const nodeList = [
		...store.nodeList.map(node => {
			const draggable = node.type === 'visualizationNode' ? isEditing && !isLocked && !isFixed && !node.data.node.isPositionLocked && !node.data.node.isDerived : node.type === 'visualizationPoint' ? isEditing && !isLocked : node.draggable;
			return decorate(node, [draggable], () => ({ ...node, draggable }));
		}),
		// the create panel: a corner of it where it was asked for (DiagramCreateNode turns it about
		// that point to stay inside the canvas)
		...(create ? [{ id: '~create', type: 'visualizationCreate', position: create.position, initialWidth: 300, initialHeight: 240, draggable: false, selectable: false, focusable: false, connectable: false, zIndex: 1000, data: { position: create.position } }] : []),
	];
	const edgeList = store.edgeList.map(edge => {
		const reconnectable = isEditing && !isLocked;
		const className = selection?.connectionId === edge.id ? 'is-selected' : undefined;
		const hidden = interaction?.type === 'detach' && interaction.connectionId === edge.id;
		return decorate(edge, [reconnectable, className, hidden], () => ({ ...edge, reconnectable, className, hidden }));
	});
	const signature = JSON.stringify(viewport);
	// a camera the host hands over as the canvas mounts (config.viewInitial: a canvas taking the
	// place of another, at the place the reader was): it is what the diagram remembers from then on
	const viewInitial = useRef(config?.viewInitial);
	if (viewInitial.current && viewState) {
		Object.assign(viewState, { signature, view: { ...viewInitial.current } });
		viewInitial.current = null;
	}
	const viewRemembered = viewState?.signature === signature ? viewState.view : undefined;

	useEffect(() => {
		if (!editor) return;
		const canvas = {
			positionGet: id => getNode(id)?.position,
			viewRemember: () => { if (viewState) Object.assign(viewState, { signature, view: { ...getViewport() } }); },
			// the center of a handle in canvas coordinates, with the side it faces
			handlePositionGet: (nodeId, handleId) => {
				const internal = getInternalNode(nodeId);
				const bounds = [...(internal?.internals.handleBounds?.source ?? []), ...(internal?.internals.handleBounds?.target ?? [])].find(handle => handle.id === handleId);
				if (!internal || !bounds) return null;
				return { x: internal.internals.positionAbsolute.x + bounds.x + bounds.width / 2, y: internal.internals.positionAbsolute.y + bounds.y + bounds.height / 2, side: bounds.position };
			},
			// the handle nearest to a canvas position, within a radius in canvas units
			handleNearestGet: (position, radius = 18) => {
				let nearest = null;
				for (const node of store.nodeList) {
					if (node.type !== 'visualizationNode') continue;
					const internal = getInternalNode(node.id);

					if (!internal) continue;
					for (const bounds of [...(internal.internals.handleBounds?.source ?? []), ...(internal.internals.handleBounds?.target ?? [])]) {
						const x = internal.internals.positionAbsolute.x + bounds.x + bounds.width / 2;
						const y = internal.internals.positionAbsolute.y + bounds.y + bounds.height / 2;
						const distance = Math.hypot(x - position.x, y - position.y);
						if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { nodeId: node.id, handleId: bounds.id, distance };
					}
				}
				return nearest;
			},
			nodeRectGet: id => wrapper.current?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null,
			edgeRectGet: id => {
				const geometry = edgeGeometry?.get(id);
				if (!geometry) return null;
				// the box of the two ends: the card stands beside the line and not on it, and
				// a change of the route does not move it
				const source = flowToScreenPosition({ x: geometry.sourceX, y: geometry.sourceY });
				const target = flowToScreenPosition({ x: geometry.targetX, y: geometry.targetY });
				const left = Math.min(source.x, target.x);
				const right = Math.max(source.x, target.x);
				const top = Math.min(source.y, target.y);
				const bottom = Math.max(source.y, target.y);
				return { left, right, top, bottom, width: right - left, height: bottom - top };
			},
			edgeEndsGet: (id, connection) => diagramCanvasEndsGet(edgeGeometry, id, connection),
			centerGet: () => {
				const rect = wrapper.current?.getBoundingClientRect();
				return rect ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : null;
			},
			// for the features of the editor (node-registry.js: feature): what a placer answered the
			// last time the nodes were placed, a dragged place given up, and a box of the canvas on the screen
			placedGet: placerId => store.placed.get(placerId),
			nodeSizeGet: id => store.measurements[id] ?? null,
			placeOverrideSet: (key, position) => store.placeOverrideSet(key, position),
			placeOverrideClear: () => store.placeOverrideClear(),
			boxRectGet: (box) => {
				const from = flowToScreenPosition({ x: box.x, y: box.y });
				const to = flowToScreenPosition({ x: box.x + box.width, y: box.y + box.height });
				return { left: from.x, top: from.y, right: to.x, bottom: to.y, width: to.x - from.x, height: to.y - from.y };
			},
		};
		editor.canvas.current = canvas;
		return () => { if (editor.canvas.current === canvas) editor.canvas.current = null; };
	}, [editor?.canvas, getNode, getInternalNode, getViewport, flowToScreenPosition, screenToFlowPosition, viewState, signature, edgeGeometry]);

	useEffect(() => {
		if (store.loadState.status !== 'done' || !isInitialized) return undefined;
		let frameIdInner;
		const frameId = requestAnimationFrame(() => {
			frameIdInner = requestAnimationFrame(() => {
				const view = viewState?.signature === signature ? viewState.view : viewport.view;
				const operation = !view || view === 'auto' ? fitView({ padding: 0.12, duration: 0, minZoom: viewport.zoom.min, maxZoom: viewport.zoom.max }) : setViewport(view);
				void operation.then(() => { rangeApply(getViewport()); isReadySet(true); });
			});
		});
		return () => {
			cancelAnimationFrame(frameId);
			if (frameIdInner) cancelAnimationFrame(frameIdInner);
		};
	}, [fitView, setViewport, graphVersion, isInitialized, store]);

	function rangeApply(view) {
		if (viewport.range === 'auto') return;
		const x = Math.max(viewport.range.x[0], Math.min(viewport.range.x[1], view.x));
		const y = Math.max(viewport.range.y[0], Math.min(viewport.range.y[1], view.y));
		if (x !== view.x || y !== view.y) void setViewport({ ...view, x, y });
	}

	if (store.loadState.status === 'error') {
		return (
			<div className="doc-er-diagram-message is-error" role="alert">
				<strong>The diagram data could not be read.</strong>
				<span>{store.loadState.message}</span>
			</div>
		);
	}
	if (store.loadState.status !== 'done') {
		return <div className="doc-er-diagram-message">The diagram data is empty.</div>;
	}

	return (
		<ReactFlow
			ref={wrapper}
			className={`doc-er-diagram-flow${(editor?.featureList ?? []).map(session => (session.flowClassName ? ` ${session.flowClassName}` : '')).join('')}`}
			data-ready={isReady ? '' : undefined}
			style={{ '--doc-vis-zoom': zoom }}
			nodes={nodeList}
			edges={edgeList}
			nodeTypes={nodeTypes}
			edgeTypes={edgeTypes}
			connectionLineComponent={DiagramConnectionLine}
			defaultViewport={viewRemembered ?? (viewport.view === 'auto' ? { x: 0, y: 0, zoom: 1 } : viewport.view)}
			fitViewOptions={{ padding: 0.12 }}
			minZoom={viewport.zoom.min}
			maxZoom={viewport.zoom.max}
			onMove={(_event, view) => { if (viewState) Object.assign(viewState, { signature, view: { ...view } }); config?.onViewChange?.(view); }}
			onMoveEnd={(_event, view) => rangeApply(view)}
			proOptions={{ hideAttribution: true }}
			nodesDraggable={isEditing && !isLocked}
			nodesConnectable={isEditing && !isLocked}
			nodesFocusable={false}
			edgesFocusable={false}
			edgesReconnectable={isEditing && !isLocked}
			elementsSelectable={false}
			connectionMode="loose"
			connectOnClick={false}
			connectionRadius={24}
			reconnectRadius={12}
			zoomOnDoubleClick={!isEditing}
			deleteKeyCode={null}
			selectionKeyCode={null}
			multiSelectionKeyCode={null}
			onNodesChange={store.nodeListChange}
			onNodeDragStart={isEditing ? (_event, node) => editor.nodeDragStart(node) : undefined}
			onNodeDragStop={isEditing ? (event, node) => editor.nodeDragStop(node, event.clientX !== undefined ? screenToFlowPosition({ x: event.clientX, y: event.clientY }) : null) : undefined}
			// React Flow turns the pointer off on a node that takes no interaction
			// at all; a mouse-enter handler keeps it on, so the text of a card
			// stays selectable while reading and a drag on its title line pans
			onNodeMouseEnter={nodeMouseEnterNoop}
			onNodeClick={isEditing ? (event, node) => {
				if (node.type !== 'visualizationNode') return;
				// a node a feature derives (a copy) stands for its source
				const derived = node.data.node.derived;
				if (derived) editor.select(derived.nodeIdSource);
				else if (!event.target.closest('.doc-card, .doc-vis-operator')) editor.select(node.id);
			} : undefined}
			onEdgeClick={isEditing ? (_event, edge) => { if (editor.store.selection?.connectionId !== edge.id) editor.selectConnection(edge.id); } : undefined}
			onEdgeDoubleClick={isEditing && !isLocked && !isFixed ? (event, edge) => {
				// the browser takes a double-click for selecting the word nearest to it
				window.getSelection()?.removeAllRanges();
				editor.change(() => editor.anchorAdd(edge.id, screenToFlowPosition({ x: event.clientX, y: event.clientY })));
			} : undefined}
			onPaneClick={isEditing ? (event) => {
				// a feature may take the click (a tool armed puts its thing there)
				if (editor.paneClick?.(screenToFlowPosition({ x: event.clientX, y: event.clientY }))) return;
				editor.clearSelection();
				editor.createClose();
			} : undefined}
			// a right-click on a thing, or on the empty canvas: what can be done there, in the panel of a
			// double-click, when a feature or the host offers something; else the browser's own menu
			onNodeContextMenu={isEditing && !isLocked ? (event, node) => {
				if (node.type !== 'visualizationNode') return;
				const nodeId = node.data.node.derived?.nodeIdSource ?? node.id;
				if (editor.contextOpen?.({ kind: 'node', nodeId, position: screenToFlowPosition({ x: event.clientX, y: event.clientY }) })) event.preventDefault();
			} : undefined}
			onEdgeContextMenu={isEditing && !isLocked ? (event, edge) => {
				if (editor.contextOpen?.({ kind: 'line', connectionId: edge.id, position: screenToFlowPosition({ x: event.clientX, y: event.clientY }) })) event.preventDefault();
			} : undefined}
			onPaneContextMenu={isEditing && !isLocked ? (event) => {
				if (editor.contextOpen?.({ kind: 'canvas', position: screenToFlowPosition({ x: event.clientX, y: event.clientY }) })) event.preventDefault();
			} : undefined}
			onDoubleClick={isEditing ? event => { if (event.target.classList?.contains('react-flow__pane')) editor.createOpen(screenToFlowPosition({ x: event.clientX, y: event.clientY })); } : undefined}
			onConnectStart={isEditing ? (_event, params) => editor.connectStart(params.nodeId, params.handleId) : undefined}
			onConnect={isEditing ? connection => editor.connect(connection) : undefined}
			onConnectEnd={isEditing ? (_event, state) => editor.connectEnd(state) : undefined}
			isValidConnection={isEditing ? connection => editor.connectionIsValid(connection) : undefined}
			onReconnectStart={isEditing ? (_event, edge, handleType) => editor.reconnectStart(edge, handleType) : undefined}
			onReconnect={isEditing ? (edge, connection) => editor.reconnect(edge, connection) : undefined}
			onReconnectEnd={isEditing ? (_event, edge, handleType, state) => editor.reconnectEnd(edge, handleType, state) : undefined}
		>
			<Background gap={18} size={1} />
			<Controls showInteractive={false}><DiagramSearchControl search={search} /></Controls>
			{viewport.isMiniMapVisible ? <MiniMap position="bottom-right" pannable zoomable /> : null}
			<DiagramPinLayer pinList={store.graph?.pinList} registry={registry} config={config} />
			{/* what the features of the editor draw over the canvas (a tool bar, the marks of a structure) */}
			{(editor?.featureList ?? []).map(session => (session.CanvasLayer ? <session.CanvasLayer key={session.id} session={session} editor={editor} /> : null))}
		</ReactFlow>
	);
});

const nodeMouseEnterNoop = () => {};
const nodeTypes = { visualizationNode: DiagramNode, visualizationPoint: DiagramPointNode, visualizationCreate: DiagramCreateNode };
const edgeTypes = { visualizationEdge: DiagramEdge };

function heightGet(value) {
	const height = Number(value);
	return Number.isFinite(height) ? Math.max(360, Math.min(1000, height)) : 620;
}

// the diagram of the base series: generic tables and operators
const CardDiagram = cardDiagramCompCreate(cardDiagramNodeRegistry, 'CardDiagram');

export { CardDiagram };
