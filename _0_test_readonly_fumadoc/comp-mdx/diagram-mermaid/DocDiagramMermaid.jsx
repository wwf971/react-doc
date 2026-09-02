import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { Copy, Expand, Scan, X } from 'lucide-react';
import { DocDiagramMermaidStore } from './DocDiagramMermaidStore.js';
import './DocDiagramMermaid.css';

let mermaidPromise;

function laneIconByIdParse(value = '', assetUrlGet = (path) => path) {
	return Object.fromEntries(value.split('|').flatMap((entry) => {
		const indexSeparator = entry.indexOf(':');
		if (indexSeparator < 0) return [];
		const laneId = entry.slice(0, indexSeparator).trim();
		const imagePath = entry.slice(indexSeparator + 1).trim();
		const imageUrl = assetUrlGet(imagePath);
		return laneId && imageUrl ? [[laneId, imageUrl]] : [];
	}));
}

function swimlaneIconsApply(svg, iconByLaneId) {
	const namespaceSvg = 'http://www.w3.org/2000/svg';
	let titleTopMin;

	for (const [laneId, imageUrl] of Object.entries(iconByLaneId)) {
		const lane = [...svg.querySelectorAll('g.cluster.swimlane')]
			.find((element) => element.getAttribute('data-id') === laneId);
		const title = lane?.querySelector(':scope > rect.swimlane-title');
		const body = lane?.querySelector(':scope > rect.swimlane-body');
		const label = lane?.querySelector(':scope > g.swimlane-label');
		if (!lane || !title || !body || !label) continue;

		const titleX = Number(title.getAttribute('x'));
		const titleY = Number(title.getAttribute('y'));
		const titleWidth = Number(title.getAttribute('width'));
		const bodyY = Number(body.getAttribute('y'));
		const labelBox = label.getBBox();
		if (![titleX, titleY, titleWidth, bodyY, labelBox.width, labelBox.height].every(Number.isFinite)
			|| bodyY <= titleY) continue;

		// Grow top-oriented headers upward so larger icons do not displace or
		// overlap Mermaid's laid-out lane content.
		const titleHeight = 64;
		const titleTop = bodyY - titleHeight;
		const iconSize = Math.max(24, Math.min(38, titleHeight - labelBox.height - 7));
		const icon = document.createElementNS(namespaceSvg, 'image');
		icon.setAttribute('class', 'doc-mdx-diagram-mermaid-lane-icon');
		icon.setAttribute('href', imageUrl);
		icon.setAttribute('x', String(titleX + (titleWidth - iconSize) / 2));
		icon.setAttribute('y', String(titleTop + 3));
		icon.setAttribute('width', String(iconSize));
		icon.setAttribute('height', String(iconSize));
		icon.setAttribute('preserveAspectRatio', 'xMidYMid meet');

		title.setAttribute('y', String(titleTop));
		title.setAttribute('height', String(titleHeight));
		label.setAttribute(
			'transform',
			`translate(${titleX + (titleWidth - labelBox.width) / 2}, ${bodyY - labelBox.height - 2})`,
		);
		lane.insertBefore(icon, label);
		titleTopMin = titleTopMin === undefined ? titleTop : Math.min(titleTopMin, titleTop);
	}

	return titleTopMin;
}

function mermaidGet(mermaidLoad) {
	if (!mermaidPromise) {
		if (typeof mermaidLoad !== 'function') {
			return Promise.reject(new Error('DocDiagramMermaid requires config.mermaidLoad.'));
		}
		mermaidPromise = mermaidLoad().then(({ default: mermaid }) => {
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: 'strict',
				theme: 'neutral',
			});
			return mermaid;
		});
	}
	return mermaidPromise;
}

function MermaidSvg({ displayMode = 'fill', iconByLaneId = {}, mermaidLoad, onReady, sourceDiagram }) {
	const id = `doc-mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
	const contentRef = useRef(null);
	const renderHostRef = useRef(null);
	const [state, setState] = useState({ status: 'loading', svg: '', message: '' });

	useEffect(() => {
		let isCancelled = false;
		setState({ status: 'loading', svg: '', message: '' });

		void mermaidGet(mermaidLoad)
			.then((mermaid) => mermaid.render(id, sourceDiagram, renderHostRef.current))
			.then(({ svg }) => {
				if (!isCancelled) setState({ status: 'done', svg, message: '' });
			})
			.catch((error) => {
				if (!isCancelled) {
					setState({
						status: 'error',
						svg: '',
						message: String(error?.message ?? error),
					});
				}
			});

		return () => {
			isCancelled = true;
		};
	}, [id, mermaidLoad, sourceDiagram]);

	useLayoutEffect(() => {
		if (state.status !== 'done' || !contentRef.current) return;
		// Insert Mermaid's original markup only when a new SVG is rendered.
		// Reassigning dangerouslySetInnerHTML during popup state changes can
		// restore Mermaid's responsive width and discard the intrinsic sizing.
		contentRef.current.innerHTML = state.svg;
	}, [state.status, state.svg]);

	useLayoutEffect(() => {
		if (state.status !== 'done') return;
		const svg = contentRef.current?.querySelector('svg');
		const valuesViewBox = svg?.getAttribute('viewBox')?.trim().split(/[ ,]+/).map(Number);
		if (!svg || valuesViewBox?.length !== 4) return;

		const [viewBoxX, viewBoxY, width] = valuesViewBox;
		let height = valuesViewBox[3];
		if (!(width > 0) || !(height > 0)) return;

		const titleTopMin = swimlaneIconsApply(svg, iconByLaneId);
		if (Number.isFinite(titleTopMin) && titleTopMin < viewBoxY) {
			const paddingTop = 4;
			const viewBoxTop = titleTopMin - paddingTop;
			height += viewBoxY - viewBoxTop;
			svg.setAttribute('viewBox', `${viewBoxX} ${viewBoxTop} ${width} ${height}`);
		}
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		onReady?.({ height, width });
	}, [iconByLaneId, onReady, state.status, state.svg]);

	useLayoutEffect(() => {
		if (state.status !== 'done') return;
		const svg = contentRef.current?.querySelector('svg');
		if (!svg) return;
		if (displayMode === 'contain') {
			svg.style.width = '100%';
			svg.style.height = 'auto';
			svg.style.maxWidth = '100%';
		} else {
			svg.style.width = `${svg.getAttribute('width')}px`;
			svg.style.height = `${svg.getAttribute('height')}px`;
			svg.style.maxWidth = 'none';
		}
	}, [displayMode, state.status, state.svg]);

	if (state.status === 'error') {
		return (
			<>
				<div ref={renderHostRef} className="doc-mdx-diagram-mermaid-render-host" aria-hidden="true" />
				<div className="doc-mdx-diagram-mermaid-error" role="alert">
					<strong>Failed to render Mermaid diagram.</strong>
					<span>{state.message}</span>
				</div>
			</>
		);
	}

	if (state.status === 'loading') {
		return (
			<>
				<div ref={renderHostRef} className="doc-mdx-diagram-mermaid-render-host" aria-hidden="true" />
				<div className="doc-mdx-diagram-mermaid-loading">図を読み込んでいます。</div>
			</>
		);
	}

	return (
		<>
			<div ref={renderHostRef} className="doc-mdx-diagram-mermaid-render-host" aria-hidden="true" />
			<div ref={contentRef} className={`doc-mdx-diagram-mermaid-content is-${displayMode}`} />
		</>
	);
}

function useHorizontalDragScroll(viewportRef) {
	const dragRef = useRef(null);

	return {
		onPointerDown(event) {
			const viewport = viewportRef.current;
			if (event.button !== 0 || event.pointerType === 'touch' || !viewport
				|| viewport.scrollWidth <= viewport.clientWidth) return;
			dragRef.current = { pointerId: event.pointerId, scrollLeft: viewport.scrollLeft, x: event.clientX };
			viewport.dataset.isDragReady = 'true';
			viewport.setPointerCapture(event.pointerId);
		},
		onPointerMove(event) {
			const viewport = viewportRef.current;
			const drag = dragRef.current;
			if (!viewport || drag?.pointerId !== event.pointerId) return;
			const delta = event.clientX - drag.x;
			if (Math.abs(delta) > 3) viewport.dataset.isDragging = 'true';
			viewport.scrollLeft = drag.scrollLeft - delta;
			event.preventDefault();
		},
		onPointerEnd(event) {
			const viewport = viewportRef.current;
			if (dragRef.current?.pointerId !== event.pointerId) return;
			dragRef.current = null;
			delete viewport?.dataset.isDragReady;
			delete viewport?.dataset.isDragging;
			if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
		},
	};
}

function MermaidPanZoom({ iconByLaneId, mermaidLoad, sourceDiagram }) {
	const viewportRef = useRef(null);
	const sizeRef = useRef(null);
	const transformRef = useRef({ scale: 1, x: 0, y: 0 });
	const dragRef = useRef(null);
	const isInteractedRef = useRef(false);
	const [transform, setTransform] = useState(transformRef.current);

	const transformSet = useCallback((value) => {
		transformRef.current = value;
		setTransform(value);
	}, []);

	const fitApply = useCallback(() => {
		const viewport = viewportRef.current;
		const size = sizeRef.current;
		if (!viewport || !size) return;
		const padding = 32;
		const scale = Math.min(
			Math.max(1, viewport.clientWidth - padding * 2) / size.width,
			Math.max(1, viewport.clientHeight - padding * 2) / size.height,
		);
		transformSet({
			scale,
			x: (viewport.clientWidth - size.width * scale) / 2,
			y: (viewport.clientHeight - size.height * scale) / 2,
		});
	}, [transformSet]);

	const diagramReady = useCallback((size) => {
		sizeRef.current = size;
		isInteractedRef.current = false;
		fitApply();
	}, [fitApply]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return undefined;
		const wheelHandle = (event) => {
			const current = transformRef.current;
			const rect = viewport.getBoundingClientRect();
			const pointerX = event.clientX - rect.left;
			const pointerY = event.clientY - rect.top;
			const scale = Math.max(0.1, Math.min(8, current.scale * Math.exp(-event.deltaY * 0.0015)));
			const worldX = (pointerX - current.x) / current.scale;
			const worldY = (pointerY - current.y) / current.scale;
			isInteractedRef.current = true;
			transformSet({
				scale,
				x: pointerX - worldX * scale,
				y: pointerY - worldY * scale,
			});
			event.preventDefault();
		};
		viewport.addEventListener('wheel', wheelHandle, { passive: false });
		return () => viewport.removeEventListener('wheel', wheelHandle);
	}, [transformSet]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport || typeof ResizeObserver === 'undefined') return undefined;
		const observer = new ResizeObserver(() => {
			if (!isInteractedRef.current) fitApply();
		});
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [fitApply]);

	return (
		<div
			ref={viewportRef}
			className="doc-mdx-diagram-mermaid-pan-viewport"
			onDoubleClick={fitApply}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				const current = transformRef.current;
				dragRef.current = {
					pointerId: event.pointerId,
					pointerX: event.clientX,
					pointerY: event.clientY,
					scale: current.scale,
					x: current.x,
					y: current.y,
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				const drag = dragRef.current;
				if (drag?.pointerId !== event.pointerId) return;
				isInteractedRef.current = true;
				transformSet({
					scale: drag.scale,
					x: drag.x + event.clientX - drag.pointerX,
					y: drag.y + event.clientY - drag.pointerY,
				});
			}}
			onPointerUp={(event) => {
				if (dragRef.current?.pointerId !== event.pointerId) return;
				dragRef.current = null;
				if (event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
			}}
			onPointerCancel={() => { dragRef.current = null; }}
		>
			<div
				className="doc-mdx-diagram-mermaid-pan-content"
				style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
			>
				<MermaidSvg
					iconByLaneId={iconByLaneId}
					mermaidLoad={mermaidLoad}
					onReady={diagramReady}
					sourceDiagram={sourceDiagram}
				/>
			</div>
		</div>
	);
}

const DocDiagramMermaid = observer(function DocDiagramMermaid({ data = {}, config = {}, onEvent }) {
	const displayModeDefault = config.displayMode === 'fill' || config.displayMode === 'intrinsic' ? 'fill' : 'contain';
	const [store] = useState(() => new DocDiagramMermaidStore(displayModeDefault));
	const sourceDiagram = data.source || data.raw || '';
	const displayModeResolved = store.displayMode;
	const iconByLaneId = useMemo(
		() => laneIconByIdParse(data.laneIcons, config.assetUrlGet),
		[data.laneIcons, config.assetUrlGet],
	);
	const titleId = useId();
	const viewportRef = useRef(null);
	const dragHandlers = useHorizontalDragScroll(viewportRef);

	const isExpandedSet = async (isExpanded) => {
		const result = await onEvent?.('expandChangeRequest', { isExpanded });
		if (!result?.isHandled) store.expandedSet(isExpanded);
	};

	const displayModeToggle = async () => {
		const displayMode = displayModeResolved === 'contain' ? 'fill' : 'contain';
		const result = await onEvent?.('displayModeChangeRequest', { displayMode });
		if (!result?.isHandled) store.displayModeSet(displayMode);
	};

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
		if (result?.isHandled) return;
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
			: 'Mermaid ソースをコピー';
	const displayModeLabel = displayModeResolved === 'contain'
		? 'Fill 表示に切り替え'
		: 'Contain 表示に切り替え';

	const popup = store.isExpanded && typeof document !== 'undefined' ? createPortal(
		<div className="doc-mdx-diagram-mermaid-overlay" onMouseDown={() => void isExpandedSet(false)}>
			<section
				className="doc-mdx-diagram-mermaid-popup"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="doc-mdx-diagram-mermaid-popup-header">
					<h2 id={titleId}>{data.title ?? 'Diagram'}</h2>
					<button type="button" title="拡大表示を閉じる" aria-label="拡大表示を閉じる" onClick={() => void isExpandedSet(false)}>
						<X size={18} />
					</button>
				</header>
				<div className="doc-mdx-diagram-mermaid-popup-content">
					<MermaidPanZoom
						iconByLaneId={iconByLaneId}
						mermaidLoad={config.mermaidLoad}
						sourceDiagram={sourceDiagram}
					/>
				</div>
			</section>
		</div>,
		document.body,
	) : null;

	return (
		<figure className="doc-mdx-diagram-mermaid" aria-label={data.title ?? 'Diagram'}>
			<div className="doc-mdx-diagram-mermaid-toolbar">
				<button
					type="button"
					title={displayModeLabel}
					aria-label={displayModeLabel}
					aria-pressed={displayModeResolved === 'contain'}
					onClick={() => void displayModeToggle()}
				>
					<Scan size={17} />
				</button>
				<button type="button" title={copyLabel} aria-label={copyLabel} onClick={sourceCopy}>
					<Copy size={17} />
				</button>
				<button type="button" title="図を拡大表示" aria-label="図を拡大表示" onClick={() => void isExpandedSet(true)}>
					<Expand size={17} />
				</button>
			</div>
			<div
				ref={viewportRef}
				className={`doc-mdx-diagram-mermaid-viewport is-${displayModeResolved}`}
				onPointerCancel={dragHandlers.onPointerEnd}
				onPointerDown={dragHandlers.onPointerDown}
				onPointerMove={dragHandlers.onPointerMove}
				onPointerUp={dragHandlers.onPointerEnd}
			>
				<MermaidSvg
					displayMode={displayModeResolved}
					iconByLaneId={iconByLaneId}
					mermaidLoad={config.mermaidLoad}
					sourceDiagram={sourceDiagram}
				/>
			</div>
			{popup}
		</figure>
	);
});

export { DocDiagramMermaid };