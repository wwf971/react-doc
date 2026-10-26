import { useContext, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { toJS } from 'mobx';
import { observer } from 'mobx-react-lite';
import {
	Background,
	Controls,
	MiniMap,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
	useNodesInitialized,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Copy, Expand, X } from '../../../../main/frontend/UICommon.js';
import { DiagramERStore, diagramViewStateGet } from './DiagramERStore.js';
import { DiagramNode, DiagramEdge, DiagramRenderContext } from './DiagramRender.jsx';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import './DiagramER.css';
import { DataverseVisualEdit } from './DataverseVisualEdit.jsx';

function DiagramER({ data = {}, config = {}, onEvent }) {
	if (config.isEdit && config.edit?.modeId === 'visual') return <DataverseVisualEdit data={data} config={config} onEvent={onEvent} kind="diagram" renderContent={props => <DiagramERView {...props} config={config} onEvent={onEvent} />} />;
	return <DiagramERView data={data} config={config} onEvent={onEvent} />;
}

const DiagramERView = observer(function DiagramERView({ data = {}, config = {}, onEvent, editor }) {
	const sourceDiagram = data.source || data.raw || '';
	const { compById, sourceStore } = useDocStores();
	const [viewState] = useState(() => diagramViewStateGet(sourceStore, config));
	const [store] = useState(() => new DiagramERStore(sourceDiagram, (name, placement) => {
		const definition = compDefinitionNormalize(compById[compIdResolve(sourceStore.configDoc, name)]);
		if (!definition?.placementList?.includes(placement)) return undefined;
		return definition.expose?.[placement];
	}, heightGet(data.height ?? config.height)));
	const titleId = useId();
	// the height is an authored prop (data.height); config.height is the
	// form a host passes it in
	const heightDiagram = store.viewport.size.height === 'auto' ? 620 : store.viewport.size.height;
	const context = { config, editor, measurementSet: store.measurementSet };

	const isExpandedSet = async (isExpanded) => {
		const result = await onEvent?.('expandChangeRequest', { isExpanded });
		if (result?.code !== 0) store.expandedSet(isExpanded);
	};

	useEffect(() => {
		if (store.source !== sourceDiagram) store.sourceLoad(sourceDiagram, Boolean(editor));
	}, [sourceDiagram, store]);

	useEffect(() => {
		if (!store.isExpanded) return undefined;
		const keyDownHandle = (event) => {
			if (event.key === 'Escape') void isExpandedSet(false);
		};
		window.addEventListener('keydown', keyDownHandle);
		return () => window.removeEventListener('keydown', keyDownHandle);
	}, [store.isExpanded]);

	async function sourceCopy() {
		const result = await onEvent?.('copyRequest', { text: sourceDiagram });
		if (result?.code === 0) return;
		try {
			await navigator.clipboard.writeText(sourceDiagram);
			store.copyStatusSet('copied');
		} catch {
			store.copyStatusSet('failed');
		}
	}

	const copyLabel = store.copyStatus === 'copied'
		? 'コピーしました'
		: store.copyStatus === 'failed'
			? 'コピーできませんでした'
			: 'ER 図の YAML をコピー';
	const popup = store.isExpanded && typeof document !== 'undefined' ? createPortal(
		<div className="doc-er-diagram-overlay" onMouseDown={() => void isExpandedSet(false)}>
			<section
				className="doc-er-diagram-popup"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="doc-er-diagram-popup-header">
					<h2 id={titleId}>{data.title ?? 'ER Diagram'}</h2>
					<button type="button" title="拡大表示を閉じる" aria-label="拡大表示を閉じる" onClick={() => void isExpandedSet(false)}>
						<X size={18} />
					</button>
				</header>
				<div className="doc-er-diagram-popup-content">
					<ReactFlowProvider>
						<DiagramRenderContext.Provider value={context}><DiagramERCanvas store={store} /></DiagramRenderContext.Provider>
					</ReactFlowProvider>
				</div>
			</section>
		</div>,
		document.body,
	) : null;

	return (
		<figure
			className="doc-er-diagram"
			aria-label={data.title ?? 'ER Diagram'}
			style={{ '--doc-er-diagram-height': `${heightDiagram}px`, width: store.viewport.size.width === 'auto' ? '100%' : store.viewport.size.width, maxWidth: '100%' }}
		>
			{!editor ? <div className="doc-er-diagram-toolbar">
				<button type="button" title={copyLabel} aria-label={copyLabel} onClick={sourceCopy}>
					<Copy size={17} />
				</button>
				<button type="button" title="図を拡大表示" aria-label="図を拡大表示" onClick={() => void isExpandedSet(true)}>
					<Expand size={17} />
				</button>
			</div> : null}
			<div className="doc-er-diagram-viewport">
				<ReactFlowProvider>
					<DiagramRenderContext.Provider value={context}><DiagramERCanvas store={store} viewState={viewState} isEditing={Boolean(editor)} /></DiagramRenderContext.Provider>
				</ReactFlowProvider>
			</div>
			{popup}
		</figure>
	);
});

const DiagramERCanvas = observer(function DiagramERCanvas({ store, viewState, isEditing = false }) {
	const { editor } = useContext(DiagramRenderContext);
	const { fitView, setViewport, getViewport, getNode } = useReactFlow();
	const isInitialized = useNodesInitialized();
	const graphVersion = store.graphVersion;
	const viewport = store.viewport;
	const nodeList = toJS(store.nodeList).map(node => ({ ...node, draggable: !node.data.node.isPositionLocked && !editor?.isLocked }));
	const edgeList = toJS(store.edgeList);
	const signature = JSON.stringify(viewport);
	const viewRemembered = viewState?.signature === signature ? viewState.view : undefined;

	useEffect(() => {
		if (!editor) return;
		const canvas = {
			positionGet: id => getNode(id)?.position,
			viewRemember: () => { if (viewState) Object.assign(viewState, { signature, view: { ...getViewport() } }); },
		};
		editor.canvas.current = canvas;
		return () => { if (editor.canvas.current === canvas) editor.canvas.current = null; };
	}, [editor?.canvas, getNode, getViewport, viewState, signature]);

	useEffect(() => {
		if (store.loadState.status !== 'done' || !isInitialized) return undefined;
		let frameIdInner;
		const frameId = requestAnimationFrame(() => {
			frameIdInner = requestAnimationFrame(() => {
				const view = viewState?.signature === signature ? viewState.view : viewport.view;
				const operation = !view || view === 'auto' ? fitView({ padding: 0.12, duration: 0, minZoom: viewport.zoom.min, maxZoom: viewport.zoom.max }) : setViewport(view);
				void operation.then(() => rangeApply(getViewport()));
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
				<strong>Failed to read ER diagram data.</strong>
				<span>{store.loadState.message}</span>
			</div>
		);
	}
	if (store.loadState.status !== 'done') {
		return <div className="doc-er-diagram-message">ER diagram data is empty.</div>;
	}

	return (
		<ReactFlow
			className="doc-er-diagram-flow"
			nodes={nodeList}
			edges={edgeList}
			nodeTypes={nodeTypes}
			edgeTypes={edgeTypes}
			defaultViewport={viewRemembered ?? (viewport.view === 'auto' ? { x: 0, y: 0, zoom: 1 } : viewport.view)}
			fitViewOptions={{ padding: 0.12 }}
			minZoom={viewport.zoom.min}
			maxZoom={viewport.zoom.max}
			onMove={(_event, view) => { if (viewState) Object.assign(viewState, { signature, view: { ...view } }); }}
			onMoveEnd={(_event, view) => rangeApply(view)}
			proOptions={{ hideAttribution: true }}
			nodesDraggable={!editor?.isLocked}
			onNodeDragStop={isEditing ? (_event, node) => {
				const authored = editor.store.nodes.find(item => item.id === node.id);
				if (authored?.position && authored.position !== 'auto' && !authored.isPositionLocked) editor.change(() => editor.store.nodeMove(node.id, node.position));
			} : undefined}
			onPaneClick={isEditing ? editor.clearFocus : undefined}
			onNodeClick={isEditing ? (event, node) => {
				if (node.data.node.renderer.type?.startsWith('dataverse-')) editor.focus(node.id, null, event.currentTarget);
			} : undefined}
			nodesConnectable={false}
			elementsSelectable={false}
			multiSelectionKeyCode={null}
			onNodesChange={store.nodeListChange}
		>
			<Background gap={18} size={1} />
			<Controls showInteractive={false} />
			{viewport.isMiniMapVisible ? <MiniMap position="bottom-right" pannable zoomable /> : null}
		</ReactFlow>
	);
});

const nodeTypes = { visualizationNode: DiagramNode };
const edgeTypes = { visualizationEdge: DiagramEdge };

function heightGet(value) {
	const height = Number(value);
	return Number.isFinite(height) ? Math.max(360, Math.min(1000, height)) : 620;
}

export { DiagramER, DiagramER as DocDiagramER };
