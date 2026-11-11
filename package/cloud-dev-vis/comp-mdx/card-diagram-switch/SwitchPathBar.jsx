import { useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Scan, Search, SquareDashedMousePointer } from '../../../../main/frontend/UICommon.js';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { ScrollHorizontal } from '../../../../main/comp-doc/scroll/ScrollHorizontal.jsx';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import { CARD_ICON_BY_NAME } from '../card-diagram/CompactCard.jsx';
import { SwitchViewSwitcher } from './SwitchViewSwitcher.jsx';
import { switchPresentationBuild } from './SwitchData.js';

// The bar over a switching viewport (card-diagram-flexible-switch.md#the-path-bar):
// the path of the scene shown, aligned to the left, one button per segment. A click on
// a segment switches to it; the chevron before a segment lists the scenes beside it.
// At the right, what acts on the scene shown: find in it (the bar mod+f opens over the canvas),
// the camera back to its default, the box.
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

const SwitchPathSibling = observer(function SwitchPathSibling({ store, path }) {
	const ref = useRef(null);
	const [isOpen, isOpenSet] = useState(false);
	const siblingList = store.siblingListGet(path);
	if (siblingList.length <= 1) return <ChevronRight size={13} className="doc-switch-path-gap" aria-hidden="true" />;
	return (
		<>
			<button ref={ref} type="button" className="doc-switch-path-chevron" title="The scenes beside this one" aria-label="List the scenes beside this one" aria-expanded={isOpen} onClick={() => isOpenSet(!isOpen)} onBlur={(event) => {
				if (!event.relatedTarget?.closest?.('.doc-switch-path-menu')) isOpenSet(false);
			}}>
				<ChevronRight size={13} aria-hidden="true" />
			</button>
			{isOpen ? (
				<AnchoredPopover anchorRef={ref} className="doc-switch-path-menu">
					{siblingList.map((item) => (
						<button key={item.path} type="button" aria-label={item.label} data-current={item.path === path ? '' : undefined} onClick={() => { isOpenSet(false); void store.pathSet(item.path); }}>
							<SwitchMenuItemContent item={item} />
							{item.description ? <em>{item.description}</em> : null}
						</button>
					))}
				</AnchoredPopover>
			) : null}
		</>
	);
});

export const SwitchPathBar = observer(function SwitchPathBar({ store, trailing }) {
	const chain = store.pathChain;
	const scene = store.sceneCurrent;
	const childList = store.provider.childListGet(scene);
	// a path wider than its place is moved by the wheel over it or a drag, without a scrollbar
	// (ScrollHorizontal); the segment of the scene shown, with what follows it, stays in sight
	const scroll = store.pathScroll;
	const stripRef = useRef(null);
	useLayoutEffect(() => {
		const strip = stripRef.current;
		const segment = strip?.querySelector('[aria-current="page"]')?.closest('.doc-switch-path-item');
		if (!segment) return;
		scroll.reveal(segment.offsetLeft, strip.offsetWidth - segment.offsetLeft);
		scroll.reveal(segment.offsetLeft, segment.offsetWidth);
	}, [scroll, scene, scroll.widthOuter, scroll.widthInner]);
	return (
		<div className="doc-switch-bar not-prose">
			<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title="Back to the previous scene" aria-label="Back to the previous scene" disabled={store.historyList.length === 0} onClick={store.back}>
				<ArrowLeft size={16} aria-hidden="true" />
			</button>
			<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title="Forward to the scene left" aria-label="Forward to the scene left" disabled={store.forwardList.length === 0} onClick={store.forward}>
				<ArrowRight size={16} aria-hidden="true" />
			</button>
			<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title={store.pathUp ? `Up to ${store.labelGet(store.pathUp)}` : 'Up one level'} aria-label="Up one level" disabled={!store.pathUp} onClick={store.up}>
				<ArrowUp size={16} aria-hidden="true" />
			</button>
			<ScrollHorizontal store={scroll} className="doc-switch-path" innerClassName="doc-switch-path-list" innerRef={stripRef} innerProps={{ role: 'navigation', 'aria-label': 'Path of the scene' }}>
				{chain.map((path, index) => (
					<span key={path} className="doc-switch-path-item">
						{index > 0 ? <SwitchPathSibling store={store} path={path} /> : null}
						<button type="button" className="doc-switch-path-segment" aria-current={path === scene ? 'page' : undefined} title={store.labelGet(path)} onClick={() => void store.pathSet(path)}>
							{store.labelGet(path)}
						</button>
					</span>
				))}
				<SwitchViewSwitcher store={store} presentation={switchPresentationBuild(scene)} />
				{childList.length > 0 ? <SwitchPathChildren store={store} childList={childList} /> : null}
			</ScrollHorizontal>
			<span className="doc-switch-bar-trailing">
				{trailing}
				<SwitchSearchButton store={store} />
				<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title="Back to the default range of this scene" aria-label="Fit the scene" onClick={() => void store.cameraReset()}>
					<Scan size={16} aria-hidden="true" />
				</button>
				<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title="Adjust the bounding box of this scene (the red frame): the range shown by default and when embedded" aria-label="Adjust the bounding box" aria-pressed={store.isBoxAdjust} onClick={store.boxAdjustToggle}>
					<SquareDashedMousePointer size={16} aria-hidden="true" />
				</button>
			</span>
		</div>
	);
});

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

// the way further down from the scene shown: its children, in the same menu
const SwitchPathChildren = observer(function SwitchPathChildren({ store, childList }) {
	const ref = useRef(null);
	const [isOpen, isOpenSet] = useState(false);
	return (
		<span className="doc-switch-path-item">
			<button ref={ref} type="button" className="doc-switch-path-chevron is-more" title="The scenes below this one" aria-label="List the scenes below this one" aria-expanded={isOpen} onClick={() => isOpenSet(!isOpen)} onBlur={(event) => {
				if (!event.relatedTarget?.closest?.('.doc-switch-path-menu')) isOpenSet(false);
			}}>
				<ChevronRight size={13} aria-hidden="true" />
				<span>{childList.length}</span>
			</button>
			{isOpen ? (
				<AnchoredPopover anchorRef={ref} className="doc-switch-path-menu">
					{childList.map((item) => (
						<button key={item.path} type="button" aria-label={item.label} onClick={() => { isOpenSet(false); void store.pathSet(item.path); }}>
							<SwitchMenuItemContent item={item} />
							{item.description ? <em>{item.description}</em> : null}
						</button>
					))}
				</AnchoredPopover>
			) : null}
		</span>
	);
});
