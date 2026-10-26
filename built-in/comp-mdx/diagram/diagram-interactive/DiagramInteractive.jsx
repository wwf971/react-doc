import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Expand, Scan, X } from '../../../../main/frontend/UICommon.js';
import './DiagramInteractive.css';

function DiagramInline({ children, contentSize, displayMode }) {
	const viewportRef = useRef(null);
	const [widthViewport, setWidthViewport] = useState(0);
	const widthContent = Number(contentSize?.width) || 0;
	const heightContent = Number(contentSize?.height) || 0;

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return undefined;
		const widthSet = () => setWidthViewport(viewport.clientWidth);
		widthSet();
		if (typeof ResizeObserver === 'undefined') return undefined;
		const observer = new ResizeObserver(widthSet);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, []);

	const isFit = displayMode === 'fit' && widthContent > 0 && heightContent > 0;
	const scale = isFit && widthViewport > 0 ? Math.min(1, widthViewport / widthContent) : 1;
	const styleViewport = isFit ? { height: `${Math.round(heightContent * scale)}px` } : undefined;
	const styleContent = isFit ? {
		height: `${heightContent}px`,
		transform: `scale(${scale})`,
		width: `${widthContent}px`,
	} : undefined;

	return (
		<div
			ref={viewportRef}
			className={`doc-diagram-interactive-inline is-${isFit ? 'fit' : 'contain'}`}
			style={styleViewport}
		>
			{isFit ? <div className="doc-diagram-interactive-inline-content" style={styleContent}>{children}</div> : children}
		</div>
	);
}

function DiagramPanZoom({ children, contentSize, maxScale = 8, minScale = 0.1, padding = 32, renderMode = 'transform' }) {
	const viewportRef = useRef(null);
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
		const width = Number(contentSize?.width) || 0;
		const height = Number(contentSize?.height) || 0;
		if (!viewport || !width || !height) return;
		const scale = Math.min(
			Math.max(1, viewport.clientWidth - padding * 2) / width,
			Math.max(1, viewport.clientHeight - padding * 2) / height,
		);
		transformSet({
			scale,
			x: (viewport.clientWidth - width * scale) / 2,
			y: (viewport.clientHeight - height * scale) / 2,
		});
	}, [contentSize?.height, contentSize?.width, padding, transformSet]);

	useEffect(() => {
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
			const scale = Math.max(minScale, Math.min(maxScale, current.scale * Math.exp(-event.deltaY * 0.0015)));
			const contentX = (pointerX - current.x) / current.scale;
			const contentY = (pointerY - current.y) / current.scale;
			isInteractedRef.current = true;
			transformSet({
				scale,
				x: pointerX - contentX * scale,
				y: pointerY - contentY * scale,
			});
			event.preventDefault();
		};
		viewport.addEventListener('wheel', wheelHandle, { passive: false });
		return () => viewport.removeEventListener('wheel', wheelHandle);
	}, [maxScale, minScale, transformSet]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport || typeof ResizeObserver === 'undefined') return undefined;
		const observer = new ResizeObserver(() => {
			if (!isInteractedRef.current) fitApply();
		});
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [fitApply]);

	const width = Number(contentSize?.width) || 0;
	const height = Number(contentSize?.height) || 0;
	const content = renderMode === 'layout' ? (
		<div
			className="doc-diagram-pan-zoom-content is-layout"
			style={{ left: `${Math.round(transform.x)}px`, top: `${Math.round(transform.y)}px` }}
		>
			<div className="doc-diagram-pan-zoom-layout" style={{ height: `${height}px`, width: `${width}px`, zoom: transform.scale }}>
				{children}
			</div>
		</div>
	) : (
		<div
			className="doc-diagram-pan-zoom-content"
			style={{
				height: `${height}px`,
				transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
				width: `${width}px`,
			}}
		>
			{children}
		</div>
	);

	return (
		<div
			ref={viewportRef}
			className="doc-diagram-pan-zoom"
			onDoubleClick={() => {
				isInteractedRef.current = false;
				fitApply();
			}}
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
				if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onPointerCancel={() => { dragRef.current = null; }}
		>
			{content}
		</div>
	);
}

function DiagramInteractive({ ariaLabel, children, className = '', contentSize, displayMode = 'contain', onEvent, renderMode = 'transform', title = 'Diagram' }) {
	const titleId = useId();
	const [isExpanded, setIsExpanded] = useState(false);
	const [displayModeCurrent, setDisplayModeCurrent] = useState(displayMode === 'fit' ? 'fit' : 'contain');

	const isExpandedSet = useCallback(async (value) => {
		const result = await onEvent?.('expandChangeRequest', { isExpanded: value });
		if (!result?.isHandled) setIsExpanded(value);
	}, [onEvent]);

	const displayModeToggle = useCallback(async () => {
		const displayModeNext = displayModeCurrent === 'fit' ? 'contain' : 'fit';
		const result = await onEvent?.('displayModeChangeRequest', { displayMode: displayModeNext });
		if (!result?.isHandled) setDisplayModeCurrent(displayModeNext);
	}, [displayModeCurrent, onEvent]);

	useEffect(() => {
		if (!isExpanded) return undefined;
		const keyDownHandle = (event) => {
			if (event.key === 'Escape') void isExpandedSet(false);
		};
		window.addEventListener('keydown', keyDownHandle);
		return () => window.removeEventListener('keydown', keyDownHandle);
	}, [isExpanded, isExpandedSet]);

	const displayModeLabel = displayModeCurrent === 'fit' ? 'Contain 表示に切り替え' : 'Fit 表示に切り替え';

	const popup = isExpanded && typeof document !== 'undefined' ? createPortal(
		<div className="doc-diagram-interactive-overlay" onMouseDown={() => void isExpandedSet(false)}>
			<section
				aria-labelledby={titleId}
				aria-modal="true"
				className="doc-diagram-interactive-popup"
				onMouseDown={(event) => event.stopPropagation()}
				role="dialog"
			>
				<header className="doc-diagram-interactive-popup-header">
					<h2 id={titleId} className="doc-diagram-interactive-popup-title">{title}</h2>
					<span>ホイールで拡大・縮小、ドラッグで移動</span>
					<button aria-label="拡大表示を閉じる" onClick={() => void isExpandedSet(false)} title="拡大表示を閉じる" type="button">
						<X size={18} />
					</button>
				</header>
				<div className="doc-diagram-interactive-popup-content">
					<DiagramPanZoom contentSize={contentSize} renderMode={renderMode}>{children}</DiagramPanZoom>
				</div>
			</section>
		</div>,
		document.body,
	) : null;

	return (
		<figure aria-label={ariaLabel || title} className={`doc-diagram-interactive not-prose is-${displayModeCurrent} ${className}`.trim()}>
			<div className="doc-diagram-interactive-toolbar">
				<button
					aria-label={displayModeLabel}
					aria-pressed={displayModeCurrent === 'fit'}
					onClick={() => void displayModeToggle()}
					title={displayModeLabel}
					type="button"
				>
					<Scan size={17} />
				</button>
				<button aria-label="図を拡大表示" onClick={() => void isExpandedSet(true)} title="図を拡大表示" type="button">
					<Expand size={17} />
				</button>
			</div>
			<DiagramInline contentSize={contentSize} displayMode={displayModeCurrent}>{children}</DiagramInline>
			{popup}
		</figure>
	);
}

export { DiagramInteractive, DiagramPanZoom };