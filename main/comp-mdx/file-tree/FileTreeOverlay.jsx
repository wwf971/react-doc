import { useLayoutEffect } from 'react';
import { observer } from 'mobx-react-lite';
import './FileTreeOverlay.css';

// annotation layer drawn above the rows of one FileTree. it is an absolutely
// positioned, zero-size box at the content origin of the tree, so it scrolls
// together with the rows. the svg inside has a real size covering the
// drawing, with a viewBox of the same size, so it scales exactly like the
// html rows under zoom or transforms.
//
// it measures the rendered tree (row names, children clips, its own labels)
// and writes the result into FileTreeOverlayStore. measuring repeats whenever
// any of these elements changes size: container resize, font load, folder
// open/close animation, gutter width change, or data change. the store derives
// the shapes, so this component only renders what the store computed.
const FileTreeOverlay = observer(function FileTreeOverlay({ overlayStore, rootRef }) {
	const nodeList = overlayStore.treeStore.nodeList;
	const annotationList = overlayStore.annotationList;

	useLayoutEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;
		let frameId = 0;
		const measure = () => {
			frameId = 0;
			overlayStore.geometrySet(geometryMeasure(root));
		};
		const measureSchedule = () => {
			if (!frameId) frameId = requestAnimationFrame(measure);
		};
		measure();
		if (typeof ResizeObserver === 'undefined') return undefined;
		const observer = new ResizeObserver(measureSchedule);
		observer.observe(root);
		const selector = '[data-file-tree-row-key], [data-file-tree-clip-key], [data-file-tree-overlay-label-id]';
		for (const el of elListOwnGet(root, selector)) observer.observe(el);
		return () => {
			observer.disconnect();
			if (frameId) cancelAnimationFrame(frameId);
		};
		// rows and labels are re-collected only when they can be added or
		// removed: on tree data change and on annotation change.
	}, [overlayStore, rootRef, nodeList, annotationList]);

	const { width, height } = overlayStore.canvasSize;
	return (
		<div className="doc-file-tree-overlay">
			<svg
				className="doc-file-tree-overlay-svg"
				width={width}
				height={height}
				viewBox={`0 0 ${Math.max(width, 1)} ${Math.max(height, 1)}`}
				aria-hidden="true"
			>
				{overlayStore.shapeList.map(({ annotation, shape }) => {
					if (!shape) return null;
					const ShapeRender = shapeRenderByType[annotation.type];
					return <ShapeRender key={annotation.id} annotation={annotation} shape={shape} />;
				})}
			</svg>
			{overlayStore.shapeList.map(({ annotation, shape }) => (
				<FileTreeOverlayLabel key={annotation.id} annotation={annotation} shape={shape} />
			))}
		</div>
	);
});

// the label is always mounted, also before its position is known, because its
// measured size decides the lane width and therefore the gutter width.
function FileTreeOverlayLabel({ annotation, shape }) {
	if (!annotation.text) return null;
	const position = shape?.label;
	return (
		<div
			className="doc-file-tree-overlay-label"
			data-file-tree-overlay-label-id={annotation.id}
			style={{
				left: position?.x ?? 0,
				top: position?.y ?? 0,
				maxWidth: annotation.style.textMaxWidth,
				color: annotation.style.textColor,
				visibility: position ? 'visible' : 'hidden',
			}}
		>
			{annotation.text}
		</div>
	);
}

function FileTreeOverlayArrow({ annotation, shape }) {
	const { style } = annotation;
	return (
		<g className="doc-file-tree-overlay-arrow">
			{shape.trunkPath ? (
				<path d={shape.trunkPath} style={lineStyleGet(style, style.lineStyle)} />
			) : null}
			{shape.branchList.map((branch) => (
				<g key={branch.key}>
					<path d={branch.path} style={lineStyleGet(style, branch.lineStyle)} />
					<FileTreeOverlayArrowMarker marker={branch.marker} style={style} />
				</g>
			))}
		</g>
	);
}

function FileTreeOverlayArrowMarker({ marker, style }) {
	if (!marker) return null;
	const markerStyle = {
		stroke: style.color,
		strokeWidth: style.lineWidth,
		strokeLinejoin: 'round',
		strokeLinecap: 'round',
		fill: marker.isHollow ? 'var(--color-fd-card)' : style.color,
	};
	if (marker.kind === 'circle') {
		return <circle cx={marker.cx} cy={marker.cy} r={marker.r} style={markerStyle} />;
	}
	if (marker.kind === 'polyline') {
		return <polyline points={marker.points} style={{ ...markerStyle, fill: 'none' }} />;
	}
	return <polygon points={marker.points} style={markerStyle} />;
}

const shapeRenderByType = {
	arrow: FileTreeOverlayArrow,
};

// problems in authored annotations. shown below the tree, which still renders
// with every annotation that is valid.
const FileTreeOverlayWarning = observer(function FileTreeOverlayWarning({ overlayStore }) {
	if (overlayStore.warningList.length === 0) return null;
	return (
		<div className="doc-file-tree-overlay-warning" role="alert">
			{overlayStore.warningList.map((warning, index) => (
				<span key={index}>{warning}</span>
			))}
		</div>
	);
});

function lineStyleGet(style, lineStyle) {
	return {
		fill: 'none',
		stroke: style.color,
		strokeWidth: style.lineWidth,
		strokeLinecap: 'round',
		strokeLinejoin: 'round',
		strokeDasharray: dashArrayGet(lineStyle, style.lineWidth),
	};
}

// round line caps lengthen every dash by the line width, so gaps include it.
function dashArrayGet(lineStyle, lineWidth) {
	if (lineStyle === 'dashed') return `3 ${3 + lineWidth}`;
	if (lineStyle === 'dotted') return `0 ${2 + lineWidth * 1.5}`;
	return undefined;
}

// positions are css px in the coordinates of the tree content (scroll offset
// included), which are also the coordinates of the overlay layer.
// getBoundingClientRect() returns on-screen px, which differ from css px when
// an ancestor has css zoom or a scale transform, so every on-screen distance
// is divided by the on-screen scale of the tree.
function geometryMeasure(root) {
	const rootRect = root.getBoundingClientRect();
	const scaleX = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1;
	const scaleY = root.offsetHeight > 0 ? rootRect.height / root.offsetHeight : 1;
	const xGet = (xScreen) => pxRound((xScreen - rootRect.left) / scaleX - root.clientLeft + root.scrollLeft);
	const yGet = (yScreen) => pxRound((yScreen - rootRect.top) / scaleY - root.clientTop + root.scrollTop);
	const geometry = { mainRight: 0, rowByKey: {}, clipBottomByKey: {}, labelSizeById: {} };
	for (const rowEl of elListOwnGet(root, '[data-file-tree-row-key]')) {
		const mainEl = rowEl.querySelector(':scope > [data-file-tree-main]');
		const nameEl = mainEl?.querySelector('[data-file-tree-name]');
		if (!nameEl) continue;
		const mainRect = mainEl.getBoundingClientRect();
		const nameRect = nameEl.getBoundingClientRect();
		geometry.mainRight = Math.max(geometry.mainRight, xGet(mainRect.right));
		geometry.rowByKey[rowEl.dataset.fileTreeRowKey] = {
			nameRight: xGet(nameRect.right),
			yCenter: yGet((nameRect.top + nameRect.bottom) / 2),
			height: pxRound(nameRect.height / scaleY),
		};
	}
	for (const clipEl of elListOwnGet(root, '[data-file-tree-clip-key]')) {
		geometry.clipBottomByKey[clipEl.dataset.fileTreeClipKey] = yGet(clipEl.getBoundingClientRect().bottom);
	}
	for (const labelEl of elListOwnGet(root, '[data-file-tree-overlay-label-id]')) {
		geometry.labelSizeById[labelEl.dataset.fileTreeOverlayLabelId] = {
			width: pxRound(labelEl.offsetWidth),
			height: pxRound(labelEl.offsetHeight),
		};
	}
	return geometry;
}

// elements of this tree only, never of another FileTree nested in a description.
function elListOwnGet(root, selector) {
	return [...root.querySelectorAll(selector)].filter((el) => el.closest('[data-file-tree-root]') === root);
}

function pxRound(value) {
	return Math.round(value * 2) / 2;
}

export { FileTreeOverlay, FileTreeOverlayWarning };
