import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { ChevronDown, ChevronRight, ChevronUp, Group, Layers, ListTree, LocateFixed, Rows3, Search, Square, Waypoints, X } from '../../../../main/frontend/UICommon.js';
import { textHighlight } from '../../../../main/comp-doc/object/ObjectSearchPanel.jsx';
import { DiagramStatic } from '../card-diagram/DiagramStatic.jsx';
import { DiagramCreatePanel } from '../card-diagram/DiagramCreatePanel.jsx';
import { DiagramEditCardContent } from '../card-diagram/DiagramEditCard.jsx';
import { usePopupCornerOffset, windowRectGet } from '../card-diagram/DiagramPopupPlace.js';
import { cardModelBuild } from '../card-diagram/DiagramEditCardModel.js';
import { nodeRegistryBuild } from '../card-diagram/node-registry.js';
import { CardIcon } from '../card-diagram/CardIcon.jsx';
import { cardIconAnchorListGet, cardIconAnchorRectEstimate, cardIconNormalize } from '../card-diagram/CardIconData.js';
import { focusCardModelBuild, actionListBuild } from './ParametricEditModel.js';
import { parametricGraphBuild } from './ParametricPanelGraph.js';
import { CARD_PLACE_DOCK, CARD_PLACE_FLOAT } from './ParametricEditStore.js';

// The panel of the parametric canvas (card-diagram-parametric-canvas.md#the-panel): the structure of
// the scene, beside the viewport while the diagram is edited. As wide as the viewport: under it in
// the page, floating over what follows (nothing is added to the flow of the page); at the bottom
// of the block popup. Three parts:
//
//   tree         the groups with their members under their direct parents, then the free elements;
//                narrowed by a search; a click focuses a thing, a right-click opens what can be done
//                with it (the panel of a right-click on the canvas)
//   relations    what is selected among what it follows and what follows it, as a graph
//   properties   the edit card of what is selected, docked here while the panel is open (folded,
//                the card floats beside the thing again)
//
// Everything it shows is read from the session (ParametricEditStore): it holds no state of its own.
const ICON_BY_KIND = { group: Group, layout: Rows3, node: Square, line: Waypoints, free: Layers };
// the registry of the graph of relations: icon nodes alone. Its own, so the graph is drawn the
// same whatever the kinds of the diagram edited (and this file imports no registry of a series)
const graphRegistry = nodeRegistryBuild({ id: 'parametric-relations', label: 'Relations', kindList: [{ type: 'card-icon', label: 'Icon', contract: { dataNormalize: cardIconNormalize, anchorListGet: cardIconAnchorListGet, anchorRectEstimate: cardIconAnchorRectEstimate, sizeDefault: { width: 190, height: 34 } }, schema: null, Card: CardIcon }] });

export const ParametricPanel = observer(function ParametricPanel({ session, editor, isInPopup }) {
	const isCollapsed = session.panel.isCollapsed;
	return (
		<section className={`doc-param-panel doc-edit-popup not-prose${isInPopup ? ' is-popup' : ''}${isCollapsed ? ' is-collapsed' : ''}`} aria-label="Structure of the scene" onDoubleClick={event => event.stopPropagation()}>
			<header className="doc-param-panel-head">
				<ListTree size={13} aria-hidden="true" />
				<strong>Structure</strong>
				<span className="doc-note doc-param-panel-count">{session.groupList.length} {session.groupList.length === 1 ? 'group' : 'groups'}</span>
				{isCollapsed ? null : (
					<span className="doc-param-search">
						<Search size={12} aria-hidden="true" />
						<input type="text" value={session.panel.search} placeholder="Find in the scene" aria-label="Find in the scene" spellCheck={false} onChange={event => session.panelSearchSet(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && session.panel.search) { event.stopPropagation(); session.panelSearchSet(''); } }} />
						{session.panel.search ? <button type="button" className="doc-button-icon" title="Clear" aria-label="Clear the search" onClick={() => session.panelSearchSet('')}><X size={11} /></button> : null}
					</span>
				)}
				{isCollapsed ? null : <CardPlaceSwitch session={session} />}
				<button type="button" className="doc-button-icon doc-param-panel-fold" title={isCollapsed ? 'Show the structure' : 'Fold the panel (an edit card docked in it floats beside what is selected meanwhile)'} aria-label={isCollapsed ? 'Show the structure' : 'Fold the panel'} aria-expanded={!isCollapsed} onClick={() => session.panelCollapsedSet(!isCollapsed)}>
					{isCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
				</button>
			</header>
			{isCollapsed ? null : (
				<div className={`doc-param-panel-body${session.isCardDocked ? '' : ' is-card-floating'}`}>
					<PanelTree session={session} editor={editor} />
					<PanelGraph session={session} editor={editor} />
					{session.isCardDocked ? <PanelCard session={session} editor={editor} /> : null}
				</div>
			)}
			{session.menu ? <PanelMenu session={session} editor={editor} /> : null}
		</section>
	);
});

// the tree of the scene. An item says what it is (its icon, its words, its kind) and, dimmed, how
// it is placed; the words typed in the search are marked in it
const PanelTree = observer(function PanelTree({ session, editor }) {
	const itemList = session.treeItemListShown;
	const wordList = session.panel.search.toLowerCase().split(/\s+/).filter(Boolean);
	const menuOpen = (event, item) => {
		const target = item.nodeId ? { kind: 'node', nodeId: item.nodeId } : item.connectionId ? { kind: 'line', connectionId: item.connectionId } : item.kind === 'group' ? { kind: 'group', groupId: item.groupId } : item.kind === 'layout' ? { kind: 'member', groupId: item.groupId, memberId: item.memberId } : null;
		if (!target || editor.isLocked || !actionListBuild(session, target, editor, session.toolIconGet).length) return;
		event.preventDefault();
		session.treeItemSelect(item, editor);
		session.menuOpen({ x: event.clientX, y: event.clientY, target, label: item.label });
	};
	return (
		<div className="doc-param-tree" role="tree" aria-label="The scene">
			{itemList.length === 0 ? <p className="doc-note doc-param-empty">{wordList.length ? `Nothing in the scene matches “${session.panel.search.trim()}”.` : 'The scene is empty. Pick a tool and click the canvas.'}</p> : null}
			{itemList.map((item) => {
				const Icon = ICON_BY_KIND[item.kind] ?? Square;
				return (
					<div key={item.key} role="treeitem" aria-selected={item.isSelected} aria-expanded={item.hasChildren ? !item.isCollapsed : undefined} className={`doc-param-tree-item is-${item.kind}${item.isSelected ? ' is-selected' : ''}`} style={{ paddingLeft: 6 + item.depth * 14 }}
						onClick={() => (item.kind === 'free' ? session.treeItemToggle(item.key) : session.treeItemSelect(item, editor))} onContextMenu={event => menuOpen(event, item)}>
						<button type="button" className="doc-param-tree-fold" tabIndex={-1} aria-label={item.isCollapsed ? 'Unfold' : 'Fold'} style={{ visibility: item.hasChildren ? 'visible' : 'hidden' }} onClick={(event) => { event.stopPropagation(); session.treeItemToggle(item.key); }}>
							{item.isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
						</button>
						<Icon size={12} aria-hidden="true" className="doc-param-tree-icon" />
						<span className={`doc-param-tree-label${item.isNameDefault ? ' is-default' : ''}`}>{textHighlight(item.label, wordList)}</span>
						{item.kindLabel && item.kind !== 'group' ? <span className="doc-param-tree-kind">{textHighlight(item.kindLabel, wordList)}</span> : null}
						{item.summary ? <span className="doc-param-tree-summary">{textHighlight(item.summary, wordList)}</span> : null}
					</div>
				);
			})}
		</div>
	);
});

// what is selected among what it follows and what follows it. A click on a node of the graph
// selects that thing. The part is a small canvas of its own: the wheel over it zooms around the
// pointer and never scrolls the page (a pinch too), a drag pans, the button at its corner puts the
// camera back; the camera is the session's (graphCamera)
const GRAPH_DRAG_MIN = 3;
const PanelGraph = observer(function PanelGraph({ session, editor }) {
	const graph = parametricGraphBuild(session);
	const key = graph ? JSON.stringify(graph.diagram) : '';
	// the diagram keeps its identity while it says the same: the static diagram reads it once
	const diagram = useMemo(() => (key ? JSON.parse(key) : null), [key]);
	const hostRef = useRef(null);
	const drag = useRef(null);
	const camera = session.graphCamera;
	// the wheel is taken natively (not passive), so the page never scrolls under it
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return undefined;
		const wheel = (event) => {
			event.preventDefault();
			event.stopPropagation();
			const rect = host.getBoundingClientRect();
			const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
			const now = session.graphCamera;
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			const zoom = Math.min(3, Math.max(0.3, now.zoom * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015))));
			// the point of the graph under the pointer stays under it
			session.graphCameraSet({ zoom, x: pointer.x - ((pointer.x - now.x) * zoom) / now.zoom, y: pointer.y - ((pointer.y - now.y) * zoom) / now.zoom });
		};
		host.addEventListener('wheel', wheel, { passive: false });
		return () => host.removeEventListener('wheel', wheel);
	}, [session]);
	const pointerDown = (event) => {
		if (event.button !== 0) return;
		drag.current = { x: event.clientX, y: event.clientY, camera: session.graphCamera, isMoved: false };
	};
	const pointerMove = (event) => {
		const state = drag.current;
		if (!state) return;
		const dx = event.clientX - state.x;
		const dy = event.clientY - state.y;
		if (!state.isMoved && Math.hypot(dx, dy) < GRAPH_DRAG_MIN) return;
		if (!state.isMoved) event.currentTarget.setPointerCapture(event.pointerId);
		state.isMoved = true;
		session.graphCameraSet({ ...state.camera, x: state.camera.x + dx, y: state.camera.y + dy });
	};
	const pointerUp = (event) => {
		const state = drag.current;
		drag.current = null;
		if (state?.isMoved) {
			event.currentTarget.releasePointerCapture?.(event.pointerId);
			// the click that ends a drag selects nothing
			const swallow = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
			window.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
		}
	};
	const isAtRest = camera.x === 0 && camera.y === 0 && camera.zoom === 1;
	return (
		<div ref={hostRef} className="doc-param-graph" aria-label="Relations of what is selected" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }}>
			{diagram ? (
				<div className="doc-param-graph-view" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
					<DiagramStatic diagram={diagram} registry={graphRegistry} padding={14} onNodeClick={node => session.treeItemSelect(graph.targetById[node.id] ?? {}, editor)} />
				</div>
			) : <p className="doc-note doc-param-empty">Select something: what it follows and what follows it are drawn here.</p>}
			{diagram && !isAtRest ? <button type="button" className="doc-button-icon doc-param-graph-reset" title="Back to the whole graph at its size" aria-label="Reset the view of the graph" onPointerDown={event => event.stopPropagation()} onClick={() => session.graphCameraReset()}><LocateFixed size={12} /></button> : null}
		</div>
	);
});

// the edit card of what is selected, docked: the card of the editor for a node or a line (with
// the sections of the features), the card of the feature for a group or a layout member
const PanelCard = observer(function PanelCard({ session, editor }) {
	const focus = session.focusShown;
	const model = editor.store.display ? cardModelBuild(editor) : focus ? focusCardModelBuild(session, focus, editor) : null;
	// its head offers to float it beside the thing again
	const headActionList = [{ id: 'card-float', label: 'Float beside what is selected', Icon: session.iconGet('float'), act: () => session.cardPlaceSet(CARD_PLACE_FLOAT) }];
	return (
		<div className={`doc-param-card doc-vis-card-panel${model && !model.tabList.length ? ' is-values' : ''}`} aria-label="Properties of what is selected">
			{model ? <DiagramEditCardContent editor={editor} model={model} onClose={null} headActionList={headActionList} /> : <p className="doc-note doc-param-empty">Its properties are edited here.</p>}
		</div>
	);
});

// where the edit card stands, said and switched in the head of the panel: in the panel, or beside
// the thing selected (as a card stands everywhere else). The card's own head switches it too
const CardPlaceSwitch = observer(function CardPlaceSwitch({ session }) {
	const optionList = [
		{ place: CARD_PLACE_DOCK, label: 'In the panel', title: 'The properties of what is selected stand in the panel, at its right', icon: 'dock' },
		{ place: CARD_PLACE_FLOAT, label: 'Beside it', title: 'The properties of what is selected stand in a card beside it, on the canvas', icon: 'float' },
	];
	return (
		<span className="doc-param-card-place" role="group" aria-label="Edit card">
			<span className="doc-param-card-place-label">Edit card</span>
			<span className="doc-button-group">
				{optionList.map(({ place, label, title, icon }) => {
					const Icon = session.iconGet(icon);
					return <button key={place} type="button" aria-pressed={session.panel.cardPlace === place} title={title} onClick={() => session.cardPlaceSet(place)}><Icon size={12} aria-hidden="true" />{label}</button>;
				})}
			</span>
		</span>
	);
});

// the menu of an item of the tree: the panel of a right-click, where the pointer was. What its
// actions add goes to the middle of the canvas, or where the thing they are of stands
const PanelMenu = observer(function PanelMenu({ session, editor }) {
	const { menu } = session;
	const menuEditor = useMemo(() => ({ ...editor, createClose: () => session.menuClose() }), [editor, session]);
	const position = editor.canvas.current?.centerGet?.() ?? { x: 0, y: 0 };
	// a corner of it where the pointer was, the one that keeps it in the window
	const rootRef = useRef(null);
	const offset = usePopupCornerOffset(rootRef, windowRectGet, `${menu.x}:${menu.y}`);
	return createPortal(
		<div ref={rootRef} className="doc-edit-popup doc-vis-create doc-param-menu" style={{ left: menu.x, top: menu.y, transform: `translate(${offset.x}px, ${offset.y}px)` }}>
			<DiagramCreatePanel key={`${menu.x}:${menu.y}`} position={position} editor={menuEditor} actionList={actionListBuild(session, menu.target, menuEditor, session.toolIconGet)} isActionOnly heading={menu.label} placeholder="What to do with it" ariaLabel="Actions" />
		</div>,
		document.body,
	);
});
