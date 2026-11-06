import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useReactFlow, useViewport } from '@xyflow/react';
import { routeAnchorHandleSet, routeAnchorMove, routeAnchorPlaceOf, routeDirectionVectorGet, routeEndHandleSet, routeEndPointGet, routeHandleDirectionListGet, routeResolve, routeTypeIsBezier } from './DiagramRoute.js';

// The anchors and handles of the focused line, over the cards, in edit mode only
// (card-diagram-connection-line.md). They keep their screen size at any zoom and take
// the pointer themselves. A gesture draws through routeDraft of the store and writes
// one step at the drop, so an undo takes back the whole drag; a press without a move
// only selects.
//
// Two handles on one side of an anchor would hide each other: their tips are drawn at
// different distances along it, so either can be picked up.
const DRAG_THRESHOLD = 3;
const TIP_DISTANCE = 26;
const TIP_DISTANCE_NEAR = 16;
const TIP_DISTANCE_FAR = 38;
const SNAP_DISTANCE = 6;

function nearAxis(vector) {
	const angle = Math.round(Math.atan2(vector.y, vector.x) / (Math.PI / 4)) * (Math.PI / 4);
	const size = Math.hypot(vector.x, vector.y);
	return { x: Math.cos(angle) * size, y: Math.sin(angle) * size };
}

export const DiagramRouteControls = observer(function DiagramRouteControls({ editor, connection, ends }) {
	const { store } = editor;
	const { screenToFlowPosition } = useReactFlow();
	const { zoom } = useViewport();
	const gestureRef = useRef(null);
	const type = connection.renderer.type;
	const isBezier = routeTypeIsBezier(type);
	const endsFull = { sourceX: ends.sourceX, sourceY: ends.sourceY, sourcePosition: ends.sourcePosition, targetX: ends.targetX, targetY: ends.targetY, targetPosition: ends.targetPosition, isSourceFree: connection.source.position !== undefined, isTargetFree: connection.target.position !== undefined };
	const route = connection.route ?? null;
	const resolved = routeResolve(type, route, endsFull);
	const anchorIdSelected = store.selection?.anchorId;
	const pointList = [routeEndPointGet(endsFull, 'source'), ...resolved.anchorList, routeEndPointGet(endsFull, 'target')];

	// one press: nothing happens until the pointer has moved, so a click selects only
	const pressStart = (event, { onMove, onClick }) => {
		event.stopPropagation();
		event.preventDefault();
		const start = { x: event.clientX, y: event.clientY };
		const gesture = { isMoving: false };
		gestureRef.current = gesture;
		const move = (moveEvent) => {
			if (!gesture.isMoving) {
				if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_THRESHOLD) return;
				gesture.isMoving = true;
				store.interactionSet({ type: 'route', connectionId: connection.id });
			}
			onMove(screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY }), moveEvent);
		};
		const end = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			window.removeEventListener('pointercancel', end);
			gestureRef.current = null;
			if (gesture.isMoving) {
				store.interactionSet(null);
				editor.change(() => store.routeDraftCommit());
			} else onClick?.();
			editor.focusRoot();
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', end);
	};

	const anchorPress = (event, anchor, index) => {
		const before = pointList[index];
		const after = pointList[index + 2];
		const origin = { x: anchor.x, y: anchor.y };
		pressStart(event, {
			onClick: () => editor.anchorSelect(connection.id, anchor.id),
			onMove: (pointer, moveEvent) => {
				if (store.selection?.anchorId !== anchor.id) store.anchorSelect(connection.id, anchor.id);
				let point = { ...pointer };
				if (moveEvent.shiftKey) {
					if (Math.abs(point.x - origin.x) > Math.abs(point.y - origin.y)) point.y = origin.y;
					else point.x = origin.x;
				}
				// a right-angled line lined up with a neighbour has no small jog
				if (!isBezier) {
					for (const neighbour of [before, after]) {
						if (Math.abs(point.x - neighbour.x) < SNAP_DISTANCE / zoom) point.x = neighbour.x;
						if (Math.abs(point.y - neighbour.y) < SNAP_DISTANCE / zoom) point.y = neighbour.y;
					}
				}
				store.routeDraftSet(connection.id, routeAnchorMove(route, anchor.id, routeAnchorPlaceOf(point, endsFull)));
			},
		});
	};

	// a handle dragged: a direction snapped among those allowed, or the vector to the pointer
	const handlePress = (event, tip) => {
		pressStart(event, {
			onMove: (pointer, moveEvent) => {
				if (isBezier) {
					let vector = { x: pointer.x - tip.from.x, y: pointer.y - tip.from.y };
					if (moveEvent.shiftKey) vector = nearAxis(vector);
					store.routeDraftSet(connection.id, tip.role
						? routeEndHandleSet(type, route, tip.role, vector)
						: routeAnchorHandleSet(type, route, tip.anchorId, tip.side, vector, { isDecouple: moveEvent.altKey }));
					return;
				}
				const [direction] = routeHandleDirectionListGet(tip.from, tip.neighbour, pointer);
				store.routeDraftSet(connection.id, tip.role
					? routeEndHandleSet(type, route, tip.role, direction)
					: routeAnchorHandleSet(type, route, tip.anchorId, tip.side, direction));
			},
		});
	};

	// the second click of a double-click on a handle: back to auto, or none
	const handleClear = (event, tip) => {
		event.stopPropagation();
		editor.change(() => (tip.role
			? store.connectionEndHandleSet(connection.id, tip.role, null)
			: store.connectionAnchorHandleSet(connection.id, tip.anchorId, tip.side, null)));
	};

	const tipList = [];
	const tipAdd = (tip) => tipList.push(tip);
	if (isBezier) {
		const ghost = TIP_DISTANCE / zoom;
		for (const role of ['source', 'target']) {
			const end = resolved[role];
			const from = { x: end.x, y: end.y };
			const isDegenerate = Math.hypot(end.control.x - from.x, end.control.y - from.y) < 1;
			const neighbour = role === 'source' ? pointList[1] : pointList[pointList.length - 2];
			const size = Math.hypot(neighbour.x - from.x, neighbour.y - from.y) || 1;
			const to = isDegenerate ? { x: from.x + (neighbour.x - from.x) / size * ghost, y: from.y + (neighbour.y - from.y) / size * ghost } : end.control;
			tipAdd({ key: role, role, from, to, isSet: end.isSet, label: role === 'source' ? 'Start handle' : 'End handle' });
		}
		const anchor = resolved.anchorList.find((item) => item.id === anchorIdSelected);
		if (anchor) {
			const from = { x: anchor.x, y: anchor.y };
			for (const [side, handle, sign] of [['in', anchor.handleIn, -1], ['out', anchor.handleOut, 1]]) {
				const to = handle ? { x: from.x + handle.x, y: from.y + handle.y } : { x: from.x + anchor.tangent.x * ghost * sign, y: from.y + anchor.tangent.y * ghost * sign };
				tipAdd({ key: `${anchor.id}:${side}`, anchorId: anchor.id, side, from, to, isSet: Boolean(handle), label: side === 'in' ? 'In handle' : 'Out handle' });
			}
		}
	} else {
		for (const role of ['source', 'target']) {
			const end = resolved[role];
			const from = { x: end.x, y: end.y };
			const vector = routeDirectionVectorGet(end.handle);
			const neighbour = role === 'source' ? pointList[1] : pointList[pointList.length - 2];
			tipAdd({ key: role, role, from, neighbour, to: { x: from.x + vector.x * TIP_DISTANCE / zoom, y: from.y + vector.y * TIP_DISTANCE / zoom }, isSet: end.isSet, direction: end.handle, label: role === 'source' ? 'Start handle' : 'End handle' });
		}
		const anchorIndex = resolved.anchorList.findIndex((item) => item.id === anchorIdSelected);
		if (anchorIndex >= 0) {
			const anchor = resolved.anchorList[anchorIndex];
			const from = { x: anchor.x, y: anchor.y };
			const isSameWay = anchor.handleIn === anchor.handleOut;
			for (const [side, direction, isSet, neighbour, distance] of [
				['in', anchor.handleIn, anchor.isInSet, pointList[anchorIndex], isSameWay ? TIP_DISTANCE_NEAR : TIP_DISTANCE],
				['out', anchor.handleOut, anchor.isOutSet, pointList[anchorIndex + 2], isSameWay ? TIP_DISTANCE_FAR : TIP_DISTANCE],
			]) {
				const vector = routeDirectionVectorGet(direction);
				tipAdd({ key: `${anchor.id}:${side}`, anchorId: anchor.id, side, from, neighbour, to: { x: from.x + vector.x * distance / zoom, y: from.y + vector.y * distance / zoom }, isSet, direction, label: side === 'in' ? 'In handle' : 'Out handle' });
			}
		}
	}

	return <div className="doc-vis-route nodrag nopan" data-connection-id={connection.id}>
		<svg className="doc-vis-route-stems" aria-hidden="true">
			{tipList.map((tip) => <line key={tip.key} x1={tip.from.x} y1={tip.from.y} x2={tip.to.x} y2={tip.to.y} className={`doc-vis-route-stem${tip.isSet ? ' is-set' : ''}`} />)}
		</svg>
		{tipList.map((tip) => <div key={tip.key}
			className={`doc-vis-route-tip is-${tip.side ?? (tip.role === 'source' ? 'out' : 'in')}${tip.isSet ? ' is-set' : ''}`}
			data-route-handle={tip.key}
			style={{ left: tip.to.x, top: tip.to.y }}
			title={`${tip.label}: ${isBezier ? (tip.isSet ? 'drag to shape the curve (Alt: decouple, Shift: 45°); double-click to remove' : 'drag to pull it out') : `${tip.isSet ? tip.direction : `auto (${tip.direction})`}; drag to set the direction, double-click for auto`}`}
			onPointerDown={(event) => handlePress(event, tip)}
			onDoubleClick={(event) => handleClear(event, tip)}
		/>)}
		{resolved.anchorList.map((anchor, index) => <div key={anchor.id}
			className={`doc-vis-route-anchor${anchor.id === anchorIdSelected ? ' is-selected' : ''}`}
			data-route-anchor={anchor.id}
			style={{ left: anchor.x, top: anchor.y }}
			title={`Anchor ${anchor.id}: drag to move (Shift: along one axis), Delete or double-click to remove`}
			onPointerDown={(event) => anchorPress(event, anchor, index)}
			onDoubleClick={(event) => { event.stopPropagation(); editor.change(() => store.connectionAnchorRemove(connection.id, anchor.id)); }}
		/>)}
	</div>;
});
