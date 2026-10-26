import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { MaximizeIcon, RestoreIcon } from '@wwf971/react-comp-misc';
import { X } from '../../../main/frontend/UICommon.js';
import './TextPanelDemo.css';

// minimal popup panel for the demo app. an embedding host supplies its own
// panel implementation through config.panelComponent; this demo panel
// implements the whole panel contract (doc_page_impl.md#the-panel-contract):
// data.title, config.className / config.bodyClassName, headerRightContent,
// content, the closeRequest event; with config.isExpandVisible, a maximize /
// restore button that asks for config.isExpanded to change
// (expandChangeRequest { isExpanded }); and moving and resizing:
//
//   config.isMovable    the empty parts of the header (not its buttons or
//                       fields) drag the panel
//   config.isResizable  its edges and corners resize it
//   config.rect         { x, y, width, height } in px of the window, the
//                       caller's: absent, the panel is centered in the size
//                       its className gives; width / height only, centered
//                       in that size
//   rectChangeRequest { rect, kind: 'move' | 'resize', isEnd }
//                       asked on every pointer move of a drag, isEnd on the
//                       last one. a maximized panel neither moves nor resizes
const resizeEdgeList = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const sizeMin = { width: 320, height: 180 };
// what of a moved panel stays in the window: the header can always be grabbed
const keepVisible = { x: 80, y: 32 };

export function TextPanelDemo({ data = {}, config = {}, headerRightContent, content, onEvent }) {
	const panelRef = useRef(null);
	const dragRef = useRef(null);
	const isLayoutActive = !config.isExpanded;
	const isMovable = isLayoutActive && config.isMovable === true;
	const isResizable = isLayoutActive && config.isResizable === true;
	const rect = isLayoutActive ? config.rect : undefined;

	const dragStart = (event, kind, edge = '') => {
		const rectStart = panelRef.current?.getBoundingClientRect();
		if (!rectStart) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			kind,
			edge,
			pointerX: event.clientX,
			pointerY: event.clientY,
			rect: { x: rectStart.left, y: rectStart.top, width: rectStart.width, height: rectStart.height },
		};
	};

	const dragMove = (event, isEnd = false) => {
		const drag = dragRef.current;
		if (!drag) return;
		const dx = event.clientX - drag.pointerX;
		const dy = event.clientY - drag.pointerY;
		const rectNext = drag.kind === 'move' ? rectMoved(drag.rect, dx, dy) : rectResized(drag.rect, drag.edge, dx, dy);
		if (isEnd) dragRef.current = null;
		onEvent?.('rectChangeRequest', { rect: rectNext, kind: drag.kind, isEnd });
	};

	const dragHandlers = {
		onPointerMove: (event) => dragMove(event),
		onPointerUp: (event) => dragMove(event, true),
		onPointerCancel: (event) => dragMove(event, true),
	};

	const headerPointerDown = (event) => {
		if (!isMovable || event.button !== 0) return;
		if (event.target.closest('button, a, input, textarea, select, [role="button"], [contenteditable]')) return;
		dragStart(event, 'move');
	};

	const panelStyle = rect ? rectStyleGet(rect) : undefined;

	const panel = (
		<section
			ref={panelRef}
			className={`text-panel${config.isPopup ? ' is-popup' : ''}${config.isExpanded ? ' is-expanded' : ''}${config.className ? ` ${config.className}` : ''} doc-text-panel-demo`}
			role={config.isPopup ? 'dialog' : undefined}
			aria-modal={config.isPopup ? 'true' : undefined}
			aria-label={typeof data.title === 'string' ? data.title : undefined}
			data-placed={rect?.x !== undefined ? '' : undefined}
			style={panelStyle}
			onMouseDown={(event) => event.stopPropagation()}
		>
			<header
				className="doc-text-panel-demo-header"
				data-movable={isMovable ? '' : undefined}
				onPointerDown={headerPointerDown}
				{...dragHandlers}
			>
				<h2>{data.title}</h2>
				<div className="doc-text-panel-demo-header-actions">
					{headerRightContent}
					{config.isExpandVisible ? (
						<button
							type="button"
							title={config.isExpanded ? '元のサイズに戻す' : '最大化'}
							aria-label={config.isExpanded ? '元のサイズに戻す' : '最大化'}
							onClick={() => onEvent?.('expandChangeRequest', { isExpanded: !config.isExpanded })}
						>
							{config.isExpanded ? <RestoreIcon width={16} height={16} /> : <MaximizeIcon width={16} height={16} />}
						</button>
					) : null}
					{config.isCloseVisible ? (
						<button type="button" title="閉じる" aria-label="閉じる" onClick={() => onEvent?.('closeRequest')}>
							<X size={16} />
						</button>
					) : null}
				</div>
			</header>
			<div className={`doc-text-panel-demo-body${config.bodyClassName ? ` ${config.bodyClassName}` : ''}`}>
				{content}
			</div>
			{isResizable ? resizeEdgeList.map((edge) => (
				<div
					key={edge}
					className="doc-text-panel-demo-resize"
					data-edge={edge}
					aria-hidden="true"
					onPointerDown={(event) => {
						if (event.button === 0) dragStart(event, 'resize', edge);
					}}
					{...dragHandlers}
				/>
			)) : null}
		</section>
	);
	if (!config.isPopup) return panel;
	return createPortal(
		<div className={`doc-text-panel-demo-overlay${config.isExpanded ? ' is-expanded' : ''}`} onMouseDown={() => onEvent?.('closeRequest')}>
			{panel}
		</div>,
		document.body,
	);
}

// a rect placed by the caller: fixed in the window; a size alone keeps the
// panel centered. the limits of the className are the drag's to keep now
function rectStyleGet(rect) {
	const style = { maxWidth: 'none', maxHeight: 'none' };
	if (rect.width !== undefined) style.width = `${Math.min(rect.width, window.innerWidth)}px`;
	if (rect.height !== undefined) style.height = `${Math.min(rect.height, window.innerHeight)}px`;
	if (rect.x !== undefined && rect.y !== undefined) {
		style.position = 'fixed';
		style.left = `${rect.x}px`;
		style.top = `${rect.y}px`;
		style.margin = 0;
	}
	return style;
}

// moved by the pointer, its header kept in the window
function rectMoved(rect, dx, dy) {
	return {
		...rect,
		x: clamp(rect.x + dx, keepVisible.x - rect.width, window.innerWidth - keepVisible.x),
		y: clamp(rect.y + dy, 0, window.innerHeight - keepVisible.y),
	};
}

// one edge or a corner moved by the pointer, never smaller than sizeMin,
// never past the window
function rectResized(rect, edge, dx, dy) {
	let left = rect.x;
	let top = rect.y;
	let right = rect.x + rect.width;
	let bottom = rect.y + rect.height;
	if (edge.includes('w')) left = clamp(left + dx, 0, right - sizeMin.width);
	if (edge.includes('e')) right = clamp(right + dx, left + sizeMin.width, window.innerWidth);
	if (edge.includes('n')) top = clamp(top + dy, 0, bottom - sizeMin.height);
	if (edge.includes('s')) bottom = clamp(bottom + dy, top + sizeMin.height, window.innerHeight);
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}
