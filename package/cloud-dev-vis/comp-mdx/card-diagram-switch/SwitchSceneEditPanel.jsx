import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { FileText, FolderTreeIcon, Layers, Plug, Rows3, Undo2 } from '../../../../main/frontend/UICommon.js';
import { DiagramCreatePanel } from '../card-diagram/DiagramCreatePanel.jsx';
import { usePopupCornerOffset, windowRectGet } from '../card-diagram/DiagramPopupPlace.js';
import { DiagramPanelTree, DiagramPanelTreeSearch } from '../card-diagram/DiagramPanelTree.jsx';
import { DiagramPanelGraph } from '../card-diagram/DiagramPanelGraph.jsx';
import { DiagramEditCard } from '../card-diagram/DiagramEditCard.jsx';
import { sceneActionListBuild, sceneCardModelBuild } from './SwitchSceneEditCard.js';
import { sceneGraphBuild, sceneGraphLegend } from './SwitchSceneEditGraph.js';
import { SWITCH_SCENE_DRAG_TYPE } from './SwitchSceneEditFeature.js';

// The tab Scenes of the panel of the editor (card-diagram-flexible-switch.md#the-scenes-tab), brought
// by the visual edit mode of a block of scenes (SwitchSceneEdit.jsx), which keeps the panel for the
// whole session. Two parts, and the properties of what is focused in the panel's column:
//
//   tree         the block, its scenes by path, their views, folders, mounts, tabs: a paged tree; a
//                click focuses an item and opens it on the canvas when it can be (a scene, a view);
//                the keys focus without opening (Enter opens); a right-click lists what can be done;
//                a scene or a view dragged onto the canvas is a link to it there (Alt: embedded)
//   relations    what leads to the item focused and what it leads to, as a graph; a click goes there
//
// It holds no state of its own: everything is the block session's (SwitchSceneEditStore.js).
const ICON_BY_KIND = { block: Layers, scene: Layers, view: FileText, folder: FolderTreeIcon, mount: Plug, tab: Rows3 };

// a small editor for the cards of the tab: the block session answers what an edit card asks of a store
export function sceneCardEditorOf(store) {
	return { store, isLocked: false, navigate: () => {}, change: operation => operation() };
}

export function switchScenePanelTabBuild(store) {
	return {
		id: 'scenes',
		label: 'Scenes',
		title: 'The scenes of the block: their paths, their views, how they lead to each other',
		Icon: Layers,
		rank: 10,
		Head: () => <ScenesHead store={store} />,
		Body: () => <ScenesBody store={store} />,
	};
}

// the card of the properties column: what is focused, else (nothing selected on the canvas either)
// the scene on the canvas
export function switchSceneCardSourceBuild(store) {
	return {
		id: 'scenes', rank: 10,
		cardGet: () => {
			const key = store.focusKey ?? store.editedKey;
			const model = key ? sceneCardModelBuild(store, key, { mountAsk: () => store.menuOpen({ ...menuPlaceDefault(), key: 'block', actionIdInitial: 'mount-new' }) }) : null;
			return model ? { model, editor: sceneCardEditorOf(store) } : null;
		},
	};
}

const menuPlaceDefault = () => ({ x: Math.round(innerWidth / 2 - 160), y: Math.round(innerHeight / 3) });

const ScenesHead = observer(function ScenesHead({ store }) {
	const search = store.tree.searchGet(store.treeModel, store.focusKey);
	const sceneCount = store.spec?.sceneByPath.size ?? 0;
	return <>
		<span className="doc-note doc-vis-panel-count">{sceneCount} {sceneCount === 1 ? 'scene' : 'scenes'}{store.mountList.length ? ` · ${store.mountList.length} ${store.mountList.length === 1 ? 'mount' : 'mounts'}` : ''}</span>
		<DiagramPanelTreeSearch tree={store.tree} placeholder="Find a scene or a view" foundCount={search ? search.matchKeySet.size : null} />
		<span className="doc-vis-panel-head-actions" role="group" aria-label="History of the block">
			<button type="button" className="doc-button-icon" title={store.isUndoAvailable ? `Undo: ${store.undoLabel || 'the drawing on the canvas'} (the block's steps)` : 'Nothing of the block to undo'} aria-label="Undo a step of the block" disabled={!store.isUndoAvailable} onClick={() => store.undo()}><Undo2 size={13} /></button>
			<button type="button" className="doc-button-icon is-mirrored" title={store.isRedoAvailable ? `Redo: ${store.redoLabel}` : 'Nothing of the block to redo'} aria-label="Redo a step of the block" disabled={!store.isRedoAvailable} onClick={() => store.redo()}><Undo2 size={13} /></button>
		</span>
	</>;
});

const ScenesBody = observer(function ScenesBody({ store }) {
	const modelBase = store.treeModel;
	// the model with the icons and marks of the rows: one object while the session's is the same
	const model = useMemo(() => ({
		...modelBase,
		itemGet: (key) => {
			const item = modelBase.itemGet(key);
			if (!item) return item;
			const markList = [];
			if (item.kind === 'scene' && item.path === store.treeIndex.root) markList.push({ id: 'root', label: 'first', title: 'The first scene of the block', tone: 'blue' });
			// a scene of a mount stands under its mount, which says where it is held: its row says it on hover
			return { ...item, Icon: ICON_BY_KIND[item.kind] ?? Layers, markList, isDimmed: item.kind === 'folder', kindLabel: item.kind === 'mount' ? 'mount' : '', title: item.isMounted ? `${item.label}: held elsewhere, read-only here` : undefined };
		},
	}), [modelBase]); // eslint-disable-line react-hooks/exhaustive-deps
	// what is focused, or opened on the canvas, is made seen in the tree
	const revealKey = store.focusKey ?? store.editedKey;
	useEffect(() => { if (revealKey) store.tree.reveal(revealKey, model); }, [revealKey]); // eslint-disable-line react-hooks/exhaustive-deps
	const menuOpenAt = (key, event) => {
		if (!sceneActionListBuild(store, key).length) return;
		event.preventDefault();
		store.focusSet(key);
		store.menuOpen({ x: event.clientX, y: event.clientY, key });
	};
	const graph = sceneGraphBuild(store, store.relationKey);
	const keyDown = (event) => {
		const isMod = (event.ctrlKey || event.metaKey) && !event.altKey;
		if (!isMod || event.key.toLowerCase() !== 'z' || ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.shiftKey) store.redo(); else store.undo();
	};
	return <>
		<div className="doc-switch-scene-tree" onKeyDown={keyDown}>
			<DiagramPanelTree tree={store.tree} model={model} selectedKey={store.focusKey} markedKey={store.editedKey} ariaLabel="The scenes of the block" emptyText="The block has no scene."
				onItemClick={key => store.focusSet(key, { isOpen: true })}
				onCursor={key => store.focusSet(key)}
				onItemContext={menuOpenAt}
				onItemDelete={(key) => { store.focusSet(key); store.canvasApi?.removeAsk?.(); }}
				dragTypeGet={(key) => { const item = modelBase.itemGet(key); return item && (item.kind === 'scene' || item.kind === 'view') ? SWITCH_SCENE_DRAG_TYPE : null; }} />
		</div>
		<DiagramPanelGraph diagram={graph?.diagram ?? null} camera={store.graphCamera} cameraSet={store.graphCameraSet} cameraReset={store.graphCameraReset} legend={sceneGraphLegend}
			onNodeClick={(nodeId) => {
				if (graph?.moreById[nodeId]) { const rect = document.querySelector(`.doc-vis-panel [data-node-id="${nodeId}"]`)?.getBoundingClientRect(); store.menuOpen({ x: rect ? rect.left : menuPlaceDefault().x, y: rect ? rect.bottom + 4 : menuPlaceDefault().y, keyList: graph.moreById[nodeId] }); return; }
				const key = graph?.targetById[nodeId];
				if (key) store.focusSet(key, { isOpen: true });
			}}
			emptyText="Select a scene: what leads to it and what it leads to are drawn here." ariaLabel="Relations of the scene" />
		{store.menu ? <ScenesMenu store={store} /> : null}
	</>;
});

// the menu of an item (a right-click on its row): the panel of a right-click, where the pointer was.
// Also the list a node "more" of the graph stands for, and the question of a new mount
const ScenesMenu = observer(function ScenesMenu({ store }) {
	const { menu } = store;
	const rootRef = useRef(null);
	const offset = usePopupCornerOffset(rootRef, windowRectGet, `${menu.x}:${menu.y}`);
	const menuEditor = useMemo(() => ({ store: null, createClose: () => store.menuClose(), change: operation => operation() }), [store]);
	let actionList;
	let heading;
	if (menu.keyList) {
		heading = 'Also related';
		actionList = menu.keyList.map(key => { const item = store.treeModel.itemGet(key); return { id: key, label: item?.label ?? key, description: item?.path ?? '', start: () => { store.focusSet(key, { isOpen: true }); } }; });
	} else {
		const item = store.treeModel.itemGet(menu.key);
		heading = item?.label ?? 'Scenes';
		actionList = sceneActionListBuild(store, menu.key, { mountAsk: () => {} }).map(action => (action.id === 'mount-new'
			? { id: action.id, label: action.label, description: 'The name of the asset item holding a document of scenes', start: () => ({ id: 'mount-name', label: 'Mount', placeholder: 'Name of the asset item (store local)', isText: true, choose: ({ text }) => { store.mountAdd({ name: text }); } }) }
			: { id: action.id, label: action.label, kind: action.kind, isDisabled: action.isDisabled, reason: action.reason, start: () => { action.act(); } }));
	}
	return createPortal(
		<div ref={rootRef} className="doc-edit-popup doc-vis-create doc-vis-panel-menu" style={{ left: menu.x, top: menu.y, transform: `translate(${offset.x}px, ${offset.y}px)` }}>
			<DiagramCreatePanel key={`${menu.x}:${menu.y}:${menu.key ?? ''}`} position={{ x: 0, y: 0 }} editor={menuEditor} actionList={actionList} actionIdInitial={menu.actionIdInitial} isActionOnly heading={heading} placeholder="What to do with it" ariaLabel="Actions" />
		</div>,
		document.body,
	);
});

// the card of what is focused, floating beside its row, when the author keeps cards beside things
export const SwitchSceneFloatingCard = observer(function SwitchSceneFloatingCard({ store }) {
	const key = store.focusKey;
	if (!key || store.panel.isCardDocked || !store.panel.hasTabs) return null;
	const model = sceneCardModelBuild(store, key, { mountAsk: () => store.menuOpen({ ...menuPlaceDefault(), key: 'block', actionIdInitial: 'mount-new' }) });
	if (!model) return null;
	const anchorRectGet = () => (document.querySelector(`.doc-vis-panel .doc-vis-tree-item[data-key="${CSS.escape(key)}"]`) ?? document.querySelector('.doc-vis-panel .doc-vis-tree'))?.getBoundingClientRect() ?? null;
	return <DiagramEditCard editor={sceneCardEditorOf(store)} card={{ model, anchorRectGet, close: store.focusClear }} headActionList={[]} />;
});
