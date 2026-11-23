import { observer } from 'mobx-react-lite';
import { Pencil, Plus, Scan, Search, SquareDashedMousePointer } from '../../../../main/frontend/UICommon.js';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { CARD_ICON_BY_NAME } from '../card-diagram/CompactCard.jsx';
import { PathNavBar } from './PathNavBar.jsx';
import { SwitchViewSwitcher } from './SwitchViewSwitcher.jsx';
import { switchPresentationBuild } from './SwitchData.js';

// The bar over a switching viewport (card-diagram-flexible-switch.md#the-path-bar): the path bar of
// a path-based view (PathNavBar.jsx, the side feature of this layer that any other view of a tree of
// paths uses too), walking the scenes, with what is the switch's own: the views of the scene after
// its last segment, and at the right what acts on the scene shown: find in it (the bar mod+f opens
// over the canvas), the camera back to its default, the box.

// An item of a menu: its label, or, when it has one, its labelItemList: a list of things of
// different types (card-diagram-flexible-switch.md#the-path-bar)
//
//   { type: 'text', text }               words
//   { type: 'icon', icon }               an icon by its name, as a card names one
//   { type: 'custom', comp, data? }      a React component, given { data }; by its name, a
//                                        registered component with the placement visualizationNode
function SwitchMenuItemContent({ item }) {
	if (!item.labelItemList?.length) return <span>{item.label}</span>;
	return (
		<span className="doc-switch-path-menu-label">
			{item.labelItemList.map((part, index) => {
				if (part.type === 'icon') {
					const Icon = CARD_ICON_BY_NAME[part.icon];
					return Icon ? <Icon key={index} size={14} aria-hidden="true" /> : null;
				}
				if (part.type === 'custom') {
					if (typeof part.comp === 'string') return <RegisteredComp key={index} compName={part.comp} placement="visualizationNode" input={{ data: part.data ?? {} }} configRuntime={{ instanceId: `switch-menu:${item.path}:${index}` }} />;
					const Comp = part.comp;
					return Comp ? <Comp key={index} data={part.data ?? {}} /> : null;
				}
				return <span key={index}>{part.text}</span>;
			})}
		</span>
	);
}

// trailing: buttons of the host before those of the viewport (a picture, a copy); end: after them,
// at the end of the bar (what takes the viewport elsewhere: into a window of its own)
export const SwitchPathBar = observer(function SwitchPathBar({ store, trailing, end }) {
	const scene = store.sceneCurrent;
	// what the path bar walks: the scenes, by the store of the viewport (its history, its strip)
	const nav = {
		pathCurrent: scene,
		pathChain: store.pathChain,
		pathUp: store.pathUp,
		isBackPossible: store.historyList.length > 0,
		isForwardPossible: store.forwardList.length > 0,
		pathScroll: store.pathScroll,
		labelGet: (path) => store.labelGet(path),
		siblingListGet: (path) => store.siblingListGet(path),
		childListGet: (path) => store.provider.childListGet(path),
		pathSet: (path) => void store.pathSet(path),
		back: store.back,
		forward: store.forward,
		up: store.up,
	};
	// a scene edited in place: what acts on the canvas is put away while the editor stands over it,
	// and once something changed the bar goes nowhere until its Save or Cancel (the editor's own
	// bar, over the canvas); an edit that changed nothing is left by going elsewhere
	const isEditing = Boolean(store.sceneEdit);
	const isHeld = Boolean(store.sceneEdit?.isDirty) || store.sceneEdit?.status === 'submitting';
	return (
		<PathNavBar
			nav={nav}
			noun={SWITCH_NOUN}
			label="Path of the scene"
			isHeld={isHeld}
			itemRender={(item) => <SwitchMenuItemContent item={item} />}
			pathEnd={<SwitchViewSwitcher store={store} presentation={switchPresentationBuild(scene)} />}
			trailing={(
				<>
					{isHeld ? <span className="doc-switch-bar-note">Unsaved changes: Save or Cancel over the canvas</span> : null}
					{store.sceneEditDesc && !isHeld ? (
						<button type="button" className="doc-button-icon is-panel doc-switch-bar-button is-edit" title={isEditing ? 'Stop editing this scene' : 'Edit this scene where it is drawn: click a cell, a card or a line, draw lines between the handles'} aria-label="Edit this scene in place" aria-pressed={isEditing} onClick={() => (isEditing ? store.sceneEditEnd() : store.sceneEditStart())}>
							<Pencil size={16} aria-hidden="true" />
						</button>
					) : null}
					{!isEditing ? trailing : null}
					{!isEditing && store.commandListOf({ kind: 'canvas' }).list.length > 0 ? (
						<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title="What can be done in this scene (or double-click the canvas; right-click a card or a line for what can be done with it)" aria-label="What can be done in this scene"
							aria-pressed={store.command?.target.kind === 'canvas'} onClick={() => (store.command ? store.commandClose() : store.commandOpenCentered())}>
							<Plus size={16} aria-hidden="true" />
						</button>
					) : null}
					{!isEditing ? <SwitchSearchButton store={store} /> : null}
					{!isEditing ? (
						<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title="Back to the default range of this scene" aria-label="Fit the scene" onClick={() => void store.cameraReset()}>
							<Scan size={16} aria-hidden="true" />
						</button>
					) : null}
					{!isEditing ? (
						<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title="Adjust the bounding box of this scene (the red frame): the range shown by default and when embedded" aria-label="Adjust the bounding box" aria-pressed={store.isBoxAdjust} onClick={store.boxAdjustToggle}>
							<SquareDashedMousePointer size={16} aria-hidden="true" />
						</button>
					) : null}
					{end}
				</>
			)}
		/>
	);
});

// what a place of the bar is called in its titles: "Back to the previous scene"
const SWITCH_NOUN = { one: 'scene', many: 'scenes' };

// the search of the block, seen: the bar opens at the top right of the canvas, below it, as
// mod+f with the pointer over the canvas opens it (card-diagram-impl.md#search)
const SwitchSearchButton = observer(function SwitchSearchButton({ store }) {
	const search = store.searchStoreGet();
	return (
		<button type="button" className="doc-button-icon is-panel doc-switch-bar-button is-search" title="Find in the diagram, and in the scenes inside its cards" aria-label="Find in the diagram" aria-pressed={search.isOpen} onClick={() => (search.isOpen ? search.close() : search.open())}>
			<Search size={16} aria-hidden="true" />
		</button>
	);
});
