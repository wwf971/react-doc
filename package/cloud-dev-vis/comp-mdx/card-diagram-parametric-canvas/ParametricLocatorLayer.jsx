import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useReactFlow } from '@xyflow/react';
import { LOCATOR_AXIS_LIST, locatorChevronPlaceOf } from './ParametricLocator.js';
import { lineExtentOf, lineLabelOf } from './ParametricReferencePoint.js';

// A locator over the canvas (card-diagram-parametric-canvas.md#locators), in the coordinates of the
// diagram: its lines, and a chevron for each where the row (the column) of chevrons stands.
//
//   focused        its lines in full, each with its name; a chevron is grabbed to move its line, the
//                  rail the chevrons stand on to move them all (where they stand moves nothing else),
//                  a + at the end of a rail adds a line, a click on a chevron opens its line
//   not focused    as its `display` says: hint (chevrons only), light (faint lines), full, hidden
//   read           (isRead: the diagram is read, ParametricReadLayer.jsx) full and light as said,
//                  nothing else, and nothing answers
//
// **A line dragged moves nothing until it is dropped.** The drag is held by the session (lineDrag):
// only a ghost of the line follows the pointer, so however many things stand on the locator, none
// is placed or drawn anew while the pointer moves. Dropped, the line is written as one step and
// everything is placed once; dropped on the cancel area (ParametricCanvasLayer.jsx, at the bottom of
// the viewport) or with Escape, nothing is written. Shift: the lines after it move with it (the gap
// before it changes, the others keep theirs).
const LINE_REACH = 10;
const LINE_LENGTH_MIN = 120;
const DRAG_START = 3;

// where a locator is drawn, from its box as solved: its origin, its lines and its rails on the canvas.
// childBoxList: the boxes of what stands on it, which its lines reach
export function locatorGeometryOf(layout, box, childBoxList = []) {
	const origin = { x: box.x - lineExtentOf(layout.xList).min, y: box.y - lineExtentOf(layout.yList).min };
	const chevron = locatorChevronPlaceOf(layout);
	const rail = { x: origin.x + chevron.x, y: origin.y + chevron.y };
	const xLineList = layout.xList.map(line => ({ ...line, place: origin.x + line.at }));
	const yLineList = layout.yList.map(line => ({ ...line, place: origin.y + line.at }));
	// how far the lines of an axis run across: over the lines of the other axis and what stands on it
	const reachOf = (lineOtherList, startKey, sizeKey, originAt, railAt, hasRail) => {
		const valueList = [...lineOtherList.map(line => line.place), ...childBoxList.flatMap(child => [child[startKey], child[startKey] + child[sizeKey]])];
		let from = valueList.length ? Math.min(...valueList) : originAt;
		let to = valueList.length ? Math.max(...valueList) : originAt;
		if (to - from < 8) to = from + LINE_LENGTH_MIN;
		if (hasRail) from = Math.min(from, railAt);
		return { from: from - LINE_REACH, to: to + LINE_REACH };
	};
	return {
		origin, rail, xLineList, yLineList,
		xReach: reachOf(yLineList, 'y', 'height', origin.y, rail.y, layout.xList.length > 0),
		yReach: reachOf(xLineList, 'x', 'width', origin.x, rail.x, layout.yList.length > 0),
	};
}

// a chevron pointing at its line: down for a vertical line (the row above the lines), right for a horizontal one
const ChevronMark = ({ axis }) => (
	<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
		<path d={axis === 'x' ? 'M2.5 3.5 L6 8.5 L9.5 3.5' : 'M3.5 2.5 L8.5 6 L3.5 9.5'} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
	</svg>
);

export const ParametricLocatorLayer = observer(function ParametricLocatorLayer({ session, editor, group, member, box, childBoxList, isSelected = false, isRead = false }) {
	const layout = member.layout;
	const display = isSelected ? 'focused' : layout.display;
	if (display === 'hidden' || (isRead && display !== 'full' && display !== 'light')) return null;
	const geometry = locatorGeometryOf(layout, box, childBoxList);
	const isLineShown = display !== 'hint';
	const isNameShown = display === 'focused' || display === 'full';
	const drag = !isRead && session.lineDrag?.groupId === group.id && session.lineDrag.memberId === member.id ? session.lineDrag : null;
	const names = isRead ? null : session.memberLabelOf(group.id, member.id);
	return (
		<div className={`doc-param-locator is-${display}${isRead ? ' is-read' : ''}${drag ? ' is-dragging' : ''}`}>
			<svg className="doc-param-locator-lines" width="1" height="1" aria-hidden="true">
				{isLineShown ? geometry.xLineList.map(line => <line key={`x-${line.id}`} x1={line.place} y1={geometry.xReach.from} x2={line.place} y2={geometry.xReach.to} />) : null}
				{isLineShown ? geometry.yLineList.map(line => <line key={`y-${line.id}`} x1={geometry.yReach.from} y1={line.place} x2={geometry.yReach.to} y2={line.place} />) : null}
				{drag?.axis === 'x' ? <line className="is-ghost" x1={geometry.origin.x + drag.at} y1={geometry.xReach.from} x2={geometry.origin.x + drag.at} y2={geometry.xReach.to} /> : null}
				{drag?.axis === 'y' ? <line className="is-ghost" x1={geometry.yReach.from} y1={geometry.origin.y + drag.at} x2={geometry.yReach.to} y2={geometry.origin.y + drag.at} /> : null}
			</svg>
			{isRead ? null : LOCATOR_AXIS_LIST.map(({ axis }) => <LocatorRail key={axis} axis={axis} session={session} editor={editor} group={group} member={member} geometry={geometry} isSelected={isSelected} drag={drag} />)}
			{isNameShown ? [...geometry.xLineList.map(line => ({ ...line, axis: 'x' })), ...geometry.yLineList.map(line => ({ ...line, axis: 'y' }))].filter(line => line.name).map(line => (
				<span key={`name-${line.axis}-${line.id}`} className={`doc-param-locator-name is-${line.axis}`} style={{ transform: line.axis === 'x' ? `translate(${line.place}px, ${geometry.rail.y}px)` : `translate(${geometry.rail.x}px, ${line.place}px)` }}><span>{line.name}</span></span>
			)) : null}
			{isRead ? null : (
				<button type="button" className="doc-param-locator-tab nodrag nopan" style={{ transform: `translate(${Math.min(geometry.rail.x, geometry.origin.x + (layout.xList.length ? lineExtentOf(layout.xList).min : 0))}px, ${Math.min(geometry.rail.y, geometry.origin.y + (layout.yList.length ? lineExtentOf(layout.yList).min : 0))}px)` }}
					title={`${names.label}: ${session.memberSummaryOf(group.id, member.id)}. Click to focus it`} onClick={(event) => { event.stopPropagation(); session.focusSet({ kind: 'member', groupId: group.id, memberId: member.id }); }}>
					<span>{names.label}</span>
				</button>
			)}
			{drag && drag.axis !== 'chevronX' && drag.axis !== 'chevronY' ? (
				<span className="doc-param-locator-drag-text" style={{ transform: drag.axis === 'x' ? `translate(${geometry.origin.x + drag.at}px, ${geometry.rail.y}px)` : `translate(${geometry.rail.x}px, ${geometry.origin.y + drag.at}px)` }}>
					<span>{drag.isOverCancel ? 'Cancel' : `${Math.round(drag.at)}${drag.isFollowerShifted ? ' · the following too' : ''}`}</span>
				</span>
			) : null}
		</div>
	);
});

// the rail of an axis: the row of chevrons of the vertical lines, or the column of those of the
// horizontal ones. A chevron dragged moves its line; the rail itself dragged moves the chevrons
// (chevronY, chevronX); the + at its end adds a line. All of it only while the diagram is edited
const LocatorRail = observer(function LocatorRail({ axis, session, editor, group, member, geometry, isSelected, drag }) {
	const { screenToFlowPosition } = useReactFlow();
	const press = useRef(null);
	const lineList = axis === 'x' ? geometry.xLineList : geometry.yLineList;
	const railKey = axis === 'x' ? 'chevronY' : 'chevronX';
	const isRailDragged = drag?.axis === railKey;
	// where the rail stands across its axis: as written, or where it is being dragged to
	const railAt = isRailDragged ? (axis === 'x' ? geometry.origin.y : geometry.origin.x) + drag.at : axis === 'x' ? geometry.rail.y : geometry.rail.x;
	// Escape gives a drag up wherever the keyboard focus is
	useEffect(() => {
		const keyDown = (event) => {
			if (event.key !== 'Escape' || !press.current?.isMoved) return;
			event.preventDefault();
			event.stopPropagation();
			press.current = null;
			session.lineDragSet(null);
			editor.store.interactionSet(null);
		};
		document.addEventListener('keydown', keyDown, true);
		return () => document.removeEventListener('keydown', keyDown, true);
	}, [session, editor]);
	if (!lineList.length) return null;
	const flowOf = event => screenToFlowPosition({ x: event.clientX, y: event.clientY });
	// whether the pointer is over the cancel area of the viewport (the drag keeps the pointer: asked by place)
	const isOverCancelOf = (event) => {
		const rect = event.currentTarget.closest('.react-flow')?.querySelector('.doc-param-cancel')?.getBoundingClientRect();
		return Boolean(rect) && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
	};
	const sorted = [...lineList].sort((a, b) => a.at - b.at);
	const pressStart = (event, target) => {
		if (event.button !== 0 || editor.isLocked) return;
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		press.current = { ...target, x: event.clientX, y: event.clientY, flow: flowOf(event), isMoved: false };
	};
	const pressMove = (event) => {
		const state = press.current;
		if (!state) return;
		if (!state.isMoved && Math.hypot(event.clientX - state.x, event.clientY - state.y) < DRAG_START) return;
		if (!state.isMoved) { state.isMoved = true; editor.store.interactionSet({ type: 'locatorLine' }); }
		const now = flowOf(event);
		if (state.kind === 'rail') {
			// the rail moves across its axis
			const delta = axis === 'x' ? now.y - state.flow.y : now.x - state.flow.x;
			session.lineDragSet({ groupId: group.id, memberId: member.id, axis: railKey, at: Math.round(state.at + delta), isOverCancel: isOverCancelOf(event) });
			return;
		}
		// a line moves along its axis, never past its neighbours (Shift: the following move with it,
		// so only the one before it stops it)
		const isFollowerShifted = event.shiftKey;
		const index = sorted.findIndex(line => line.id === state.lineId);
		const min = index > 0 ? sorted[index - 1].at + 1 : -Infinity;
		const max = !isFollowerShifted && index < sorted.length - 1 ? sorted[index + 1].at - 1 : Infinity;
		const delta = axis === 'x' ? now.x - state.flow.x : now.y - state.flow.y;
		session.lineDragSet({ groupId: group.id, memberId: member.id, axis, lineId: state.lineId, at: Math.round(Math.max(min, Math.min(max, state.at + delta))), isFollowerShifted, isOverCancel: isOverCancelOf(event) });
	};
	const pressEnd = (event) => {
		const state = press.current;
		press.current = null;
		if (!state) return;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		if (!state.isMoved) {
			// a click: the locator focused; focused already, the line opened in its card
			if (state.kind === 'line' && isSelected) session.locatorLineModeEnter(group.id, member.id, axis, state.lineId);
			else session.focusSet({ kind: 'member', groupId: group.id, memberId: member.id });
			return;
		}
		editor.store.interactionSet(null);
		editor.change(() => session.lineDragEnd({ isCancelled: event.type === 'pointercancel' }));
	};
	const handlers = { onPointerMove: pressMove, onPointerUp: pressEnd, onPointerCancel: pressEnd, onClick: event => event.stopPropagation(), onDoubleClick: event => event.stopPropagation() };
	const from = sorted[0].place;
	const to = sorted[sorted.length - 1].place;
	const placeOf = (along, across) => (axis === 'x' ? `translate(${along}px, ${across}px)` : `translate(${across}px, ${along}px)`);
	const railWritten = (axis === 'x' ? geometry.rail.y - geometry.origin.y : geometry.rail.x - geometry.origin.x);
	return (
		<>
			{isSelected ? (
				<div className={`doc-param-locator-rail is-${axis} nodrag nopan`} title="Drag to move the chevrons: nothing else moves" style={{ transform: placeOf(from, railAt), [axis === 'x' ? 'width' : 'height']: Math.max(1, to - from) }}
					onPointerDown={event => pressStart(event, { kind: 'rail', at: railWritten })} {...handlers} />
			) : null}
			{lineList.map((line) => {
				const label = lineLabelOf(lineList, line.id, axis);
				return (
					<button key={line.id} type="button" className={`doc-param-locator-chevron is-${axis} nodrag nopan${drag?.lineId === line.id && drag.axis === axis ? ' is-dragged' : ''}`} style={{ transform: placeOf(line.place, railAt) }}
						title={isSelected ? `${label} at ${Math.round(line.at)}: drag to move it (Shift: the lines after it too), click for its name` : `${label} at ${Math.round(line.at)}`} aria-label={`${axis === 'x' ? 'Vertical' : 'Horizontal'} line ${label}`}
						onPointerDown={event => pressStart(event, { kind: 'line', lineId: line.id, at: line.at })} {...handlers}>
						<ChevronMark axis={axis} />
					</button>
				);
			})}
			{isSelected ? (
				<button type="button" className={`doc-param-locator-add is-${axis} nodrag nopan`} style={{ transform: placeOf(to, railAt) }} title={`Add a ${axis === 'x' ? 'vertical' : 'horizontal'} line after the last`} aria-label="Add a line"
					onClick={(event) => { event.stopPropagation(); editor.change(() => session.locatorLineAdd(group.id, member.id, axis)); }}><span>+</span></button>
			) : null}
		</>
	);
});
