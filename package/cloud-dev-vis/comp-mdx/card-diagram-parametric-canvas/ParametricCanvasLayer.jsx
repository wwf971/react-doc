import { useContext, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Panel, ViewportPortal, useReactFlow, useViewport } from '@xyflow/react';
import { DiagramRenderContext } from '../card-diagram/DiagramRender.jsx';
import { MEMBER_ROOT_ID, groupKeyOf, memberIsFramedWhenRead } from './ParametricData.js';
import { rootOverrideKeyOf } from './ParametricSolve.js';
import { ParametricToolBar } from './ParametricToolBar.jsx';
import { nodeResizeAxisListOf, nodeResizeHandlePointListOf } from '../card-diagram/DiagramNodeResize.js';
import { REFERENCE_POINT_DEFAULT, outlineReferenceDefaultOf, referencePointLabelOf, referencePointResolve } from './ParametricReferencePoint.js';

// What the parametric canvas draws over the canvas while a diagram is edited
// (card-diagram-parametric-canvas.md#on-the-canvas), inside React Flow, in the coordinates of the diagram:
//
//   the origin of each group   a mark that is clicked (the group is focused, its edit card
//                                   beside it) and dragged (the whole group moves with it, and the
//                                   drop writes its place). It steps aside (faded, no pointer) while
//                                   it lies on a resize handle of the member selected
//   the box of each layout member   a dashed frame around what it arranges, with its name: a click
//                                   on the name focuses it. An empty one says what goes into it; one
//                                   not framed when the diagram is read is drawn faded
//                                   (ParametricReadLayer.jsx draws the others when it is read)
//   a layout that draws itself      what its type draws in the place of the frame (a locator: its
//                                   lines and chevrons, ParametricLocatorLayer.jsx: layoutUiByType)
//   the relations of what is selected   its parents framed; the reference points its constraint
//                                   measures by marked (a diamond on the parent, one on the
//                                   member), a dashed line from the one to the other; its default
//                                   reference point ringed
//   the reference points of a member    while it is in that mode: every one with its name, the
//                                   default ringed; a click opens one in the edit card
//   while a line of a locator is dragged   the cancel area, at the bottom of the viewport
//   while a tool is armed           the gesture surface: it takes the pointer over the whole canvas
//                                   (so a box can start over a card), hands every pointer event to
//                                   the session as the gesture, and the ghost of what the gesture
//                                   will make is drawn (ParametricCreateMode.js, ParametricCreator.js)
// and the tool bar, at the top left of the viewport.
//
// It reads where things stand from what the placer of the canvas last answered (canvasStore.placed:
// the solve, with the sizes as drawn), so it follows a drag frame by frame without solving anything.
const LAYOUT_EMPTY_SIZE = { width: 150, height: 40 };

export const ParametricCanvasLayer = observer(function ParametricCanvasLayer({ session, editor }) {
	const { canvasStore } = useContext(DiagramRenderContext);
	const solved = canvasStore?.placed.get(session.id);
	const boxOf = (groupId, memberId) => solved?.boxByKey.get(groupKeyOf(groupId, memberId));
	const selected = session.selected;
	const mode = session.modeShown;
	const guide = solved && selected?.memberId ? guideBuild(session, selected, solved, boxOf, mode) : GUIDE_NONE;
	const guideList = guide.guideList;
	const { zoom } = useViewport();
	const handlePointList = solved ? resizeHandlePointListOf(session, boxOf, canvasStore) : [];
	// within the reach of a resize handle (as large on the screen at every zoom)
	const isOnHandle = point => handlePointList.some(handle => Math.hypot(handle.x - point.x, handle.y - point.y) < 12 / zoom);
	return (
		<>
			<ParametricToolBar session={session} editor={editor} />
			{/* a line of a locator dragged: let go here, nothing is written (ParametricLocatorLayer.jsx) */}
			{session.lineDrag ? <Panel position="bottom-center" className={`doc-param-cancel${session.lineDrag.isOverCancel ? ' is-over' : ''}`}><span>Drop here to cancel</span><em>or press Esc</em></Panel> : null}
			{session.toolArmed ? <GestureSurface session={session} editor={editor} /> : null}
			{session.toolArmed ? <ViewportPortal><GestureGhost session={session} /></ViewportPortal> : null}
			{solved ? (
				<ViewportPortal>
					{guideList.length ? (
						<svg className="doc-param-guide" width="1" height="1" aria-hidden="true">
							{guideList.map((guide, index) => (guide.from ? <line key={index} x1={guide.from.x} y1={guide.from.y} x2={guide.to.x} y2={guide.to.y} /> : null))}
							{guideList.map((guide, index) => <rect key={`box-${index}`} x={guide.box.x - 3} y={guide.box.y - 3} width={guide.box.width + 6} height={guide.box.height + 6} rx="4" />)}
						</svg>
					) : null}
					{session.model.groupList.flatMap(group => group.memberList.filter(member => member.layout).map((member) => {
						const box = boxOf(group.id, member.id);
						if (!box) return null;
						const isEmpty = !box.width && !box.height;
						const isSelected = selected?.kind === 'member' && selected.groupId === group.id && selected.memberId === member.id;
						// a layout type that draws itself (a locator: its lines), in the place of the frame
						const TypeLayer = session.layoutUiByType?.[member.layout.type]?.CanvasLayer;
						if (TypeLayer) return <TypeLayer key={`${group.id}/${member.id}`} session={session} editor={editor} group={group} member={member} box={box} isSelected={isSelected} childBoxList={group.memberList.filter(other => other.parentIdList.includes(member.id)).map(other => boxOf(group.id, other.id)).filter(Boolean)} />;
						const names = session.memberLabelOf(group.id, member.id);
						const size = isEmpty ? LAYOUT_EMPTY_SIZE : { width: box.width, height: box.height };
						return (
							<div key={`${group.id}/${member.id}`} className={`doc-param-layout-box${isSelected ? ' is-selected' : ''}${isEmpty ? ' is-empty' : ''}${memberIsFramedWhenRead(member, session.catalog) ? '' : ' is-unframed-when-read'}`} style={{ transform: `translate(${box.x - 6}px, ${box.y - 6}px)`, width: size.width + 12, height: size.height + 12 }}>
								<button type="button" className="doc-param-layout-tab nodrag nopan" title={`${names.label}: ${session.memberSummaryOf(group.id, member.id)}`} onClick={(event) => { event.stopPropagation(); session.focusSet({ kind: 'member', groupId: group.id, memberId: member.id }); }}>{names.label}</button>
								{isEmpty ? <span className="doc-param-layout-empty">Select it, then place things with a tool</span> : null}
							</div>
						);
					}))}
					{guide.markList.map(mark => (
						<div key={mark.key} className={`doc-param-ref is-${mark.kind}${mark.isDefault ? ' is-default' : ''}${mark.isOpen ? ' is-open' : ''}`} style={{ transform: `translate(${mark.x}px, ${mark.y}px)` }}>
							{mark.open
								? <button type="button" className="doc-param-ref-mark nodrag nopan" title={mark.title} aria-label={mark.title} onClick={(event) => { event.stopPropagation(); mark.open(); }} />
								: <span className="doc-param-ref-mark" title={mark.title} />}
							{mark.label ? <span className="doc-param-ref-name">{mark.label}</span> : null}
						</div>
					))}
					{session.model.groupList.map((group) => {
						const box = boxOf(group.id, MEMBER_ROOT_ID);
						return box ? <OriginMark key={group.id} session={session} editor={editor} groupId={group.id} position={box} name={session.groupGet(group.id)?.name || 'Group'} isSelected={selected?.groupId === group.id && (selected.kind === 'group' || guideList.some(guide => guide.isFromRoot))} isFocused={selected?.kind === 'group' && selected.groupId === group.id} isYielding={isOnHandle(box)} /> : null;
					})}
				</ViewportPortal>
			) : null}
		</>
	);
});

// the surface a tool armed lays over the canvas. It knows no mode: it reports where the pointer
// is, where it went down, whether it moved since and the keys held (the gesture), and that the
// pointer went up. The wheel is handed on to the canvas, which zooms as ever; a right-click lets
// the tool go
const GESTURE_DRAG_MIN = 4;
const GestureSurface = observer(function GestureSurface({ session, editor }) {
	const { screenToFlowPosition } = useReactFlow();
	const press = useRef(null);
	// Escape lets the tool go wherever the keyboard focus is: arming a tool from a dropdown takes
	// the focus out of the editor with the button that is gone, and the keys of the editor are its
	// root's. Taken before the page sees it, as the editor takes its own keys
	useEffect(() => {
		const keyDown = (event) => {
			if (event.key !== 'Escape' || event.isComposing) return;
			if (!session.keyDown(event)) return;
			press.current = null;
			event.preventDefault();
			event.stopPropagation();
		};
		document.addEventListener('keydown', keyDown, true);
		return () => document.removeEventListener('keydown', keyDown, true);
	}, [session]);
	const gestureOf = (event) => {
		const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
		const down = press.current;
		return { pointNow: point, pointDown: down?.point ?? null, isDragged: Boolean(down) && Math.hypot(event.clientX - down.x, event.clientY - down.y) >= GESTURE_DRAG_MIN, isShift: event.shiftKey, isAlt: event.altKey };
	};
	return (
		<div
			className="doc-param-gesture"
			onPointerDown={(event) => {
				if (event.button !== 0 || editor.isLocked) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				press.current = { x: event.clientX, y: event.clientY, point: screenToFlowPosition({ x: event.clientX, y: event.clientY }) };
				session.gestureSet(gestureOf(event));
			}}
			onPointerMove={event => session.gestureSet(gestureOf(event))}
			onPointerUp={(event) => {
				if (!press.current) return;
				session.gestureSet(gestureOf(event));
				press.current = null;
				session.gestureEnd(editor);
			}}
			onPointerCancel={() => { press.current = null; session.gestureSet(null); }}
			onPointerLeave={() => { if (!press.current) session.gestureSet(null); }}
			onClick={event => event.stopPropagation()}
			onDoubleClick={event => event.stopPropagation()}
			onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); press.current = null; session.toolDisarm(); }}
			onWheel={(event) => {
				const pane = event.currentTarget.parentElement?.querySelector('.react-flow__pane');
				pane?.dispatchEvent(new WheelEvent('wheel', { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true }));
			}}
		/>
	);
});

// what the gesture so far will make, in the coordinates of the diagram: the boxes and lines its
// creator answers (an outline where it would go; filled lightly while a box is being drawn), a
// thing pointed at marked, a few words beside it (a size). Before the gesture starts, the cue of
// the mode beside the pointer: what to do, and how to give up
const GestureGhost = observer(function GestureGhost({ session }) {
	const ghost = session.ghostNow;
	const gesture = session.gesture;
	const isDrawing = session.placementNow?.kind === 'box';
	const boxList = ghost?.boxList ?? [];
	const boxOwn = boxList.find(box => !box.isMark);
	const cue = gesture?.pointNow && !gesture.pointDown ? session.toolModeArmed?.cue : '';
	return (
		<>
			{ghost ? (
				<svg className="doc-param-ghost-line" width="1" height="1" aria-hidden="true">
					{(ghost.lineList ?? []).map((line, index) => <line key={index} x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} />)}
				</svg>
			) : null}
			{boxList.map((box, index) => <div key={index} className={`doc-param-ghost${box.isMark ? ' is-mark' : isDrawing ? ' is-drawn' : ''}`} style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height }} />)}
			{ghost?.text && boxOwn ? <div className="doc-param-ghost-text" style={{ transform: `translate(${boxOwn.x}px, ${boxOwn.y + boxOwn.height}px)` }}><span>{ghost.text}</span></div> : null}
			{cue ? (
				<div className="doc-param-cue" style={{ transform: `translate(${gesture.pointNow.x}px, ${gesture.pointNow.y}px)` }}>
					<span><strong>{cue}</strong><em>Esc or right-click: cancel</em></span>
				</div>
			) : null}
		</>
	);
});

// the mark of the origin of a group. A press without a move focuses the group; a drag moves the origin,
// held by the canvas as a dragged place (so the group follows at once), and the drop writes it
const OriginMark = observer(function OriginMark({ session, editor, groupId, position, name, isSelected, isFocused, isYielding }) {
	const { screenToFlowPosition } = useReactFlow();
	const drag = useRef(null);
	const pointerDown = (event) => {
		if (event.button !== 0 || editor.isLocked) return;
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
		drag.current = { offsetX: at.x - position.x, offsetY: at.y - position.y, xStart: event.clientX, yStart: event.clientY, isMoved: false, place: null };
	};
	const pointerMove = (event) => {
		const state = drag.current;
		if (!state) return;
		if (!state.isMoved && Math.hypot(event.clientX - state.xStart, event.clientY - state.yStart) < 3) return;
		state.isMoved = true;
		const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
		state.place = { x: Math.round(at.x - state.offsetX), y: Math.round(at.y - state.offsetY) };
		editor.canvas.current?.placeOverrideSet?.(rootOverrideKeyOf(groupId), state.place);
	};
	const pointerUp = (event) => {
		const state = drag.current;
		drag.current = null;
		if (!state) return;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		if (!state.isMoved || !state.place) { session.focusSet({ kind: 'group', groupId }); return; }
		const valueBefore = editor.store.valueCurrent;
		editor.change(() => session.groupRootSet(groupId, state.place));
		if (editor.store.valueCurrent === valueBefore) editor.canvas.current?.placeOverrideClear?.();
	};
	return (
		<div className={`doc-param-origin nodrag nopan${isSelected ? ' is-selected' : ''}${isFocused ? ' is-focused' : ''}${isYielding ? ' is-yielding' : ''}`} style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
			<button type="button" className="doc-param-origin-mark" title={`${name}: its origin. Drag it to move the whole group; click it for the group`} aria-label={`Origin of ${name}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onClick={event => event.stopPropagation()} />
			<span className="doc-param-origin-name">{name}</span>
		</div>
	);
});

// where the resize handles of the node selected stand (DiagramNodeResize.js: the same rule the
// handles are drawn by), when it is a member of a group
function resizeHandlePointListOf(session, boxOf, canvasStore) {
	const selection = session.store.selection;
	if (!selection?.nodeId || selection.connectionId) return [];
	const at = session.memberOfNode(selection.nodeId);
	const box = at ? boxOf(at.groupId, at.memberId) : null;
	const node = canvasStore?.nodeList?.find(item => item.id === selection.nodeId)?.data?.node;
	if (!box || !node) return [];
	return nodeResizeHandlePointListOf(box, nodeResizeAxisListOf(node, session.registry?.kindByType[node.renderer?.type]?.contract));
}

const GUIDE_NONE = { guideList: [], markList: [] };

// what is drawn of the member selected (card-diagram-parametric-canvas.md#on-the-canvas):
//   guideList   its parents, each framed ({ box, isFromRoot }), with a line to it ({ from, to }):
//               between the reference points its constraint measures by, else (a constraint naming
//               none: beside) between the sides of the two boxes that face each other. A layout
//               that arranges it holds it inside its box: its frame says so, no line
//   markList    reference points, on the canvas: { key, kind: own | parent | declared, x, y, isDefault?,
//               label?, title, open? }. Its default one, and those its constraint names; in the mode
//               of its reference points, every one of them instead, each opening in the edit card
function guideBuild(session, selected, solved, boxOf, mode) {
	const group = session.groupModelGet(selected.groupId);
	const member = group?.memberById.get(selected.memberId);
	const box = boxOf(selected.groupId, selected.memberId);
	if (!member || !box) return GUIDE_NONE;
	const formatList = session.formatList;
	const atOf = (definition) => { const offset = referencePointResolve(definition, member, box, formatList); return { x: box.x + offset.x, y: box.y + offset.y }; };
	const markList = [];
	if (mode?.kind === 'referencePoint') {
		// every reference point it has: that of its outline, then those it declares
		const isOutlineDefault = !member.referencePointDefault;
		const outlinePoint = outlineReferenceDefaultOf(member.outline);
		markList.push({ key: 'outline', kind: 'declared', ...atOf(outlinePoint), isDefault: isOutlineDefault, label: referencePointLabelOf(outlinePoint, member, formatList), title: `The reference point of its outline${isOutlineDefault ? ': its default one' : ''}` });
		for (const declared of member.referencePointList) {
			const isDefault = member.referencePointDefault?.format === 'own' && member.referencePointDefault.id === declared.id;
			const words = declared.name || referencePointLabelOf(declared.point, member, formatList);
			markList.push({ key: `declared:${declared.id}`, kind: 'declared', ...atOf(declared.point), isDefault, isOpen: mode.pointId === declared.id, label: words, title: `${words}${isDefault ? ': its default one' : ''}. Click to change it`, open: () => session.referencePointModeEnter(selected.groupId, selected.memberId, declared.id) });
		}
		return { guideList: [], markList };
	}
	markList.push({ key: 'default', kind: 'own', ...atOf(REFERENCE_POINT_DEFAULT), isDefault: true, title: `Its default reference point: ${referencePointLabelOf(REFERENCE_POINT_DEFAULT, member, formatList).replace(/^default \((.*)\)$/, '$1')}` });
	// the reference points its constraint measures by, where it has one
	const constraintType = member.constraint ? session.catalog.constraintTypeByType[member.constraint.type] : null;
	const pointDefinitionList = (constraintType?.propertyList ?? []).filter(definition => definition.kind === 'referencePoint');
	const context = pointDefinitionList.length ? session.constraintContextOf(selected.groupId, selected.memberId, constraintType, member.constraint, member.parentIdList, box, solved) : null;
	const ownAtList = [];
	const parentAtByIndex = {};
	for (const definition of pointDefinitionList) {
		const value = member.constraint[definition.id];
		if (definition.of === 'self') {
			const offset = context.pointOf(definition.id);
			const at = { x: box.x + offset.x, y: box.y + offset.y };
			ownAtList.push(at);
			if (value?.format !== 'default') markList.push({ key: `own:${definition.id}`, kind: 'own', ...at, title: `${definition.label}: ${referencePointLabelOf(value, member, formatList)}` });
		} else if (boxOf(selected.groupId, member.parentIdList[definition.of])) {
			const at = context.pointOf(definition.id);
			parentAtByIndex[definition.of] = at;
			const parentSubject = session.memberSubjectOf(selected.groupId, member.parentIdList[definition.of]);
			if (parentSubject.outline?.kind !== 'point') markList.push({ key: `parent:${definition.id}`, kind: 'parent', ...at, title: `${definition.label}: ${referencePointLabelOf(value, parentSubject, formatList)}` });
		}
	}
	const guideList = member.parentIdList.flatMap((parentId, index) => {
		const parentBox = boxOf(selected.groupId, parentId);
		if (!parentBox) return [];
		const isArranging = member.isArranged && index === 0;
		const link = isArranging ? {} : parentAtByIndex[index] && ownAtList.length ? { from: parentAtByIndex[index], to: ownAtList[0] } : boxLinkOf(parentBox, box);
		return [{ ...link, box: parentBox, isFromRoot: parentId === MEMBER_ROOT_ID }];
	});
	return { guideList, markList };
}

// a straight line between two boxes: from the middle of the side of each that faces the other
function boxLinkOf(a, b) {
	const centerOf = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
	const ca = centerOf(a);
	const cb = centerOf(b);
	const edgeOf = (box, center, toward) => {
		const dx = toward.x - center.x;
		const dy = toward.y - center.y;
		if (!box.width && !box.height) return center;
		if (Math.abs(dx) * box.height >= Math.abs(dy) * box.width) return { x: center.x + Math.sign(dx) * box.width / 2, y: center.y };
		return { x: center.x, y: center.y + Math.sign(dy) * box.height / 2 };
	};
	return { from: edgeOf(a, ca, cb), to: edgeOf(b, cb, ca) };
}
