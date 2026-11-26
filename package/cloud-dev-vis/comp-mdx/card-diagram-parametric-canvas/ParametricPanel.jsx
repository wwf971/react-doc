import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { Group, Layers, ListTree, Rows3, Square, Waypoints } from '../../../../main/frontend/UICommon.js';
import { DiagramCreatePanel } from '../card-diagram/DiagramCreatePanel.jsx';
import { usePopupCornerOffset, windowRectGet } from '../card-diagram/DiagramPopupPlace.js';
import { DiagramPanelTree, DiagramPanelTreeSearch } from '../card-diagram/DiagramPanelTree.jsx';
import { DiagramPanelGraph } from '../card-diagram/DiagramPanelGraph.jsx';
import { actionListBuild } from './ParametricEditModel.js';
import { parametricGraphBuild } from './ParametricPanelGraph.js';

// The tab Structure of the panel of the editor (card-diagram-parametric-canvas.md#the-panel): the
// structure of the scene. The panel is the editor's (DiagramPanel.jsx), with its properties column;
// this tab brings two parts:
//
//   tree         the groups with their members under their direct parents, then the free elements,
//                a paged tree (DiagramPanelTree.jsx): a long level is shown a page at a time; a search
//                in the head; a click selects, a right-click opens what can be done with it (the panel
//                of a right-click on the canvas)
//   relations    what is selected among what it follows and what follows it, as a graph
//
// Everything it shows is read from the session (ParametricEditStore): it holds no state of its own.
const ICON_BY_KIND = { group: Group, layout: Rows3, node: Square, line: Waypoints, free: Layers };

// the tab, as the session registers it in the panel (ParametricFeature.jsx: panelTabGet). editorGet:
// the editor as it is now (the editor is drawn again; the tab is registered once)
export function parametricPanelTabBuild(session, editorGet) {
	return {
		id: 'structure',
		label: 'Structure',
		title: 'The structure of the scene edited: its parametric groups, their members, the free elements',
		Icon: ListTree,
		rank: 20,
		Head: () => <StructureHead session={session} />,
		Body: () => <StructureBody session={session} editorGet={editorGet} />,
	};
}

const StructureHead = observer(function StructureHead({ session }) {
	const count = session.groupList.length;
	const search = session.tree.searchGet(session.treeModel, session.selectedKey);
	return <>
		<span className="doc-note doc-vis-panel-count">{count} {count === 1 ? 'group' : 'groups'}</span>
		<DiagramPanelTreeSearch tree={session.tree} placeholder="Find in the scene" foundCount={search ? search.matchKeySet.size : null} />
	</>;
});

const StructureBody = observer(function StructureBody({ session, editorGet }) {
	const editor = editorGet();
	const treeModelBase = session.treeModel;
	// the model with the icons of the rows: one object while the session's model is the same, so
	// what the search keeps of it is not made again per drawing
	const model = useMemo(() => ({ ...treeModelBase, itemGet: (key) => { const item = treeModelBase.itemGet(key); return item ? { ...item, Icon: ICON_BY_KIND[item.kind] ?? Square } : item; } }), [treeModelBase]);
	const selectedKey = session.selectedKey;
	// what is selected on the canvas is made seen in the tree: its pages turned to it
	useEffect(() => { if (selectedKey) session.tree.reveal(selectedKey, model); }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps
	if (!editor) return null;
	const menuOpen = (key, event) => {
		const item = treeModelBase.itemGet(key);
		const target = !item ? null : item.nodeId ? { kind: 'node', nodeId: item.nodeId } : item.connectionId ? { kind: 'line', connectionId: item.connectionId } : item.kind === 'group' ? { kind: 'group', groupId: item.groupId } : item.kind === 'layout' ? { kind: 'member', groupId: item.groupId, memberId: item.memberId } : null;
		if (!target || editor.isLocked || !actionListBuild(session, target, editor, session.toolIconGet).length) return;
		event.preventDefault();
		session.treeItemSelect(key, editor);
		session.menuOpen({ x: event.clientX, y: event.clientY, target, label: item.label });
	};
	const graph = parametricGraphBuild(session);
	return <>
		<DiagramPanelTree tree={session.tree} model={model} selectedKey={selectedKey} ariaLabel="The scene" emptyText="The scene is empty. Pick a tool and click the canvas."
			onItemClick={key => (key === 'free' ? session.tree.toggle(key, undefined, model) : session.treeItemSelect(key, editor))}
			onCursor={key => { if (key !== 'free') session.treeItemSelect(key, editor); }}
			onItemContext={menuOpen}
			onItemDelete={(key) => { if (key !== 'free') { session.treeItemSelect(key, editor); editor.removeAsk?.(); } }} />
		<DiagramPanelGraph diagram={graph?.diagram ?? null} camera={session.graphCamera} cameraSet={session.graphCameraSet} cameraReset={session.graphCameraReset}
			onNodeClick={nodeId => session.treeItemSelect(graph?.targetById[nodeId] ?? {}, editor)}
			emptyText="Select something: what it follows and what follows it are drawn here." />
		{session.menu ? <PanelMenu session={session} editor={editor} /> : null}
	</>;
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
		<div ref={rootRef} className="doc-edit-popup doc-vis-create doc-vis-panel-menu" style={{ left: menu.x, top: menu.y, transform: `translate(${offset.x}px, ${offset.y}px)` }}>
			<DiagramCreatePanel key={`${menu.x}:${menu.y}`} position={position} editor={menuEditor} actionList={actionListBuild(session, menu.target, menuEditor, session.toolIconGet)} isActionOnly heading={menu.label} placeholder="What to do with it" ariaLabel="Actions" />
		</div>,
		document.body,
	);
});
