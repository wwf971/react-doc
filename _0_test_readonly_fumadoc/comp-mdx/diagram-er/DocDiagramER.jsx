import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toJS } from 'mobx';
import { observer } from 'mobx-react-lite';
import {
	Background,
	Controls,
	Handle,
	MiniMap,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Copy, Expand, X } from 'lucide-react';
import { DocDiagramERStore } from './DocDiagramERStore.js';
import './DocDiagramER.css';

function DocDiagramER({ height = 620, raw = '', source = '', title = 'ER Diagram' }) {
	const sourceDiagram = source || raw;
	const [store] = useState(() => new DocDiagramERStore(sourceDiagram));
	const [isExpanded, setIsExpanded] = useState(false);
	const [copyStatus, setCopyStatus] = useState('idle');
	const titleId = useId();
	const heightDiagram = heightGet(height);

	useEffect(() => {
		if (store.source !== sourceDiagram) store.sourceLoad(sourceDiagram);
	}, [sourceDiagram, store]);

	useEffect(() => {
		if (!isExpanded) return undefined;
		const keyDownHandle = (event) => {
			if (event.key === 'Escape') setIsExpanded(false);
		};
		window.addEventListener('keydown', keyDownHandle);
		return () => window.removeEventListener('keydown', keyDownHandle);
	}, [isExpanded]);

	async function sourceCopy() {
		try {
			await navigator.clipboard.writeText(sourceDiagram);
			setCopyStatus('copied');
		} catch {
			setCopyStatus('failed');
		}
	}

	const copyLabel = copyStatus === 'copied'
		? 'コピーしました'
		: copyStatus === 'failed'
			? 'コピーできませんでした'
			: 'ER 図の YAML をコピー';
	const popup = isExpanded && typeof document !== 'undefined' ? createPortal(
		<div className="doc-er-diagram-overlay" onMouseDown={() => setIsExpanded(false)}>
			<section
				className="doc-er-diagram-popup"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="doc-er-diagram-popup-header">
					<h2 id={titleId}>{title}</h2>
					<button type="button" title="拡大表示を閉じる" aria-label="拡大表示を閉じる" onClick={() => setIsExpanded(false)}>
						<X size={18} />
					</button>
				</header>
				<div className="doc-er-diagram-popup-content">
					<ReactFlowProvider>
						<DocDiagramERCanvas store={store} />
					</ReactFlowProvider>
				</div>
			</section>
		</div>,
		document.body,
	) : null;

	return (
		<figure
			className="doc-er-diagram"
			aria-label={title}
			style={{ '--doc-er-diagram-height': `${heightDiagram}px` }}
		>
			<div className="doc-er-diagram-toolbar">
				<button type="button" title={copyLabel} aria-label={copyLabel} onClick={sourceCopy}>
					<Copy size={17} />
				</button>
				<button type="button" title="図を拡大表示" aria-label="図を拡大表示" onClick={() => setIsExpanded(true)}>
					<Expand size={17} />
				</button>
			</div>
			<div className="doc-er-diagram-viewport">
				<ReactFlowProvider>
					<DocDiagramERCanvas store={store} />
				</ReactFlowProvider>
			</div>
			{popup}
		</figure>
	);
}

const DocDiagramERCanvas = observer(function DocDiagramERCanvas({ store }) {
	const { fitView } = useReactFlow();
	const graphVersion = store.graphVersion;
	const nodeList = toJS(store.nodeList);
	const edgeList = toJS(store.edgeList);

	useEffect(() => {
		if (store.loadState.status !== 'done') return undefined;
		let frameIdInner;
		const frameId = requestAnimationFrame(() => {
			frameIdInner = requestAnimationFrame(() => fitView({ padding: 0.12, duration: 260 }));
		});
		return () => {
			cancelAnimationFrame(frameId);
			if (frameIdInner) cancelAnimationFrame(frameIdInner);
		};
	}, [fitView, graphVersion, store]);

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
			fitView
			fitViewOptions={{ padding: 0.12 }}
			minZoom={0.15}
			maxZoom={2.5}
			nodesDraggable
			nodesConnectable={false}
			elementsSelectable={false}
			multiSelectionKeyCode={null}
			onNodesChange={store.nodeListChange}
		>
			<Background gap={18} size={1} />
			<MiniMap pannable zoomable nodeStrokeWidth={2} />
			<Controls showInteractive={false} />
		</ReactFlow>
	);
});

const ERTableNode = observer(function ERTableNode({ data }) {
	const { table, handleListByColumnId = {} } = data;
	return (
		<div className="doc-er-table">
			<div className="doc-er-table-title">
				<span>{table.name}</span>
				{table.nameLogical ? <span>{table.nameLogical}</span> : null}
			</div>
			<div className="doc-er-table-column-header nodrag">
				<span>Key</span>
				<span>列</span>
				<span>論理名</span>
				<span>型</span>
			</div>
			{table.columnList.map((column) => (
				<div key={column.id} className="doc-er-table-column nodrag">
					<span className={`doc-er-table-key${column.key ? ' is-set' : ''}`}>{column.key}</span>
					<span className="doc-er-table-column-name">{column.name}</span>
					<span className="doc-er-table-column-logical">{column.nameLogical || column.id}</span>
					<span className="doc-er-table-column-type">{column.type}</span>
					{(handleListByColumnId[column.id] || []).map((handle) => (
						<Handle
							key={handle.id}
							id={handle.id}
							type={handle.role}
							position={positionBySide[handle.side]}
							className={`doc-er-table-handle is-${handle.role}`}
							isConnectable={false}
						/>
					))}
				</div>
			))}
		</div>
	);
});

const nodeTypes = { erTable: ERTableNode };
const positionBySide = {
	left: Position.Left,
	right: Position.Right,
};

function heightGet(value) {
	const height = Number(value);
	return Number.isFinite(height) ? Math.max(360, Math.min(1000, height)) : 620;
}

export { DocDiagramER };
