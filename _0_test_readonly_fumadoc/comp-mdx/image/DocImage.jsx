import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { Copy, Expand, Scan, X } from 'lucide-react';
import { DocImageStore } from './DocImageStore.js';
import './DocImage.css';

function ImagePanZoom({ alt, sourceUrl }) {
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

	const containApply = useCallback(() => {
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

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return undefined;
		const wheelHandle = (event) => {
			const current = transformRef.current;
			const rect = viewport.getBoundingClientRect();
			const pointerX = event.clientX - rect.left;
			const pointerY = event.clientY - rect.top;
			const scale = Math.max(0.05, Math.min(16, current.scale * Math.exp(-event.deltaY * 0.0015)));
			const imageX = (pointerX - current.x) / current.scale;
			const imageY = (pointerY - current.y) / current.scale;
			isInteractedRef.current = true;
			transformSet({
				scale,
				x: pointerX - imageX * scale,
				y: pointerY - imageY * scale,
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
			if (!isInteractedRef.current) containApply();
		});
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [containApply]);

	return (
		<div
			ref={viewportRef}
			className="doc-image-pan-viewport"
			onDoubleClick={() => {
				isInteractedRef.current = false;
				containApply();
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
				if (event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
			}}
			onPointerCancel={() => { dragRef.current = null; }}
		>
			<img
				className="doc-image-pan-content"
				src={sourceUrl}
				alt={alt}
				draggable="false"
				onLoad={(event) => {
					sizeRef.current = {
						height: event.currentTarget.naturalHeight,
						width: event.currentTarget.naturalWidth,
					};
					isInteractedRef.current = false;
					containApply();
				}}
				style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
			/>
		</div>
	);
}

const DocImage = observer(function DocImage({ data = {}, config = {}, onEvent }) {
	const source = String(data.src ?? data.source ?? '').trim();
	const sourceUrl = config.assetUrlGet?.(source) ?? source;
	const alt = String(data.alt ?? data.caption ?? '');
	const displayModeDefault = config.displayMode === 'fill' ? 'fill' : 'contain';
	const [store] = useState(() => new DocImageStore(displayModeDefault));
	const titleId = useId();
	const width = sizeCssGet(config.width ?? data.maxWidth) ?? '100%';
	const height = sizeCssGet(config.height) ?? 'auto';

	useEffect(() => {
		if (!store.isExpanded) return undefined;
		const keyDownHandle = (event) => {
			if (event.key === 'Escape') void isExpandedSet(false);
		};
		window.addEventListener('keydown', keyDownHandle);
		return () => window.removeEventListener('keydown', keyDownHandle);
	}, [store.isExpanded]);

	const isExpandedSet = async (isExpanded) => {
		const result = await onEvent?.('expandChangeRequest', { isExpanded });
		if (!result?.isHandled) store.expandedSet(isExpanded);
	};

	const displayModeToggle = async () => {
		const displayMode = store.displayMode === 'contain' ? 'fill' : 'contain';
		const result = await onEvent?.('displayModeChangeRequest', { displayMode });
		if (!result?.isHandled) store.displayModeSet(displayMode);
	};

	const imageCopy = async () => {
		const result = await onEvent?.('copyRequest', { source, sourceUrl });
		if (result?.isHandled) return;
		try {
			const blob = await imagePngBlobGet(sourceUrl);
			if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
				throw new Error('Image clipboard is not available.');
			}
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			store.copyStatusSet('copied');
		} catch {
			store.copyStatusSet('failed');
		}
	};

	if (!source || !sourceUrl) {
		return (
		<div className="doc-image-error" role="alert">
			Image source could not be resolved.
		</div>
		);
	}

	const copyLabel = store.copyStatus === 'copied'
		? 'コピーしました'
		: store.copyStatus === 'failed'
			? 'コピーできませんでした'
			: '画像をコピー';
	const displayModeLabel = store.displayMode === 'contain' ? 'Fill 表示に切り替え' : 'Contain 表示に切り替え';
	const styleArea = { '--doc-image-width': width, '--doc-image-height': height };
	const popup = store.isExpanded && typeof document !== 'undefined' ? createPortal(
		<div className="doc-image-overlay" onMouseDown={() => void isExpandedSet(false)}>
			<section
				className="doc-image-popup"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				onMouseDown={(event) => event.stopPropagation()}
			>
				<header className="doc-image-popup-header">
					<h2 id={titleId}>{data.caption || alt || 'Image'}</h2>
					<button type="button" title="拡大表示を閉じる" aria-label="拡大表示を閉じる" onClick={() => void isExpandedSet(false)}>
						<X size={18} />
					</button>
				</header>
				<div className="doc-image-popup-content">
					<ImagePanZoom alt={alt} sourceUrl={sourceUrl} />
				</div>
			</section>
		</div>,
		document.body,
	) : null;

	return (
		<figure
			className={`doc-image is-${store.displayMode}`}
			style={styleArea}
		>
			<div className="doc-image-body">
				<div className="doc-image-toolbar">
					<button type="button" title={displayModeLabel} aria-label={displayModeLabel} aria-pressed={store.displayMode === 'contain'} onClick={() => void displayModeToggle()}>
						<Scan size={17} />
					</button>
					<button type="button" title={copyLabel} aria-label={copyLabel} onClick={() => void imageCopy()}>
						<Copy size={17} />
					</button>
					<button type="button" title="画像を拡大表示" aria-label="画像を拡大表示" onClick={() => void isExpandedSet(true)}>
						<Expand size={17} />
					</button>
				</div>
				<div className="doc-image-viewport">
					<img src={sourceUrl} alt={alt} loading="lazy" decoding="async" />
				</div>
			</div>
			{data.caption ? <figcaption>{data.caption}</figcaption> : null}
			{popup}
		</figure>
	);
});

function sizeCssGet(value) {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'number') return value > 0 ? `${value}px` : undefined;
	const valueTrimmed = String(value).trim();
	if (/^\d+(?:\.\d+)?$/.test(valueTrimmed)) return `${valueTrimmed}px`;
	if (/^\d+(?:\.\d+)?(?:px|rem|em|vw|%)$/.test(valueTrimmed)) return valueTrimmed;
	return undefined;
}

async function imagePngBlobGet(sourceUrl) {
	const response = await fetch(sourceUrl);
	if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
	const blobSource = await response.blob();
	const image = await createImageBitmap(blobSource);
	const canvas = document.createElement('canvas');
	canvas.width = image.width;
	canvas.height = image.height;
	canvas.getContext('2d').drawImage(image, 0, 0);
	image.close();
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image conversion failed.')), 'image/png');
	});
}

export { DocImage };