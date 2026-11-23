import { useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowLeft, ArrowRight, ArrowUp, ChevronRight } from '../../../../main/frontend/UICommon.js';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import { ScrollHorizontal } from '../../../../main/comp-doc/scroll/ScrollHorizontal.jsx';
import './PathNavBar.css';

// The path bar of a path-based view (card-diagram-flexible-switch.md#the-path-bar): back, forward
// and up, then one button per segment of the path shown, a click switching to it; the chevron
// before a segment lists the places beside it, the last chevron the places below. A path wider
// than its place does not wrap and has no scrollbar: a strip moved by the wheel or a drag
// (ScrollHorizontal). The switch layer draws its bar with it (SwitchPathBar.jsx); any other view
// of a tree of paths may too, with a nav of PathNav.js.
//
//   nav            what it walks (PathNav.js: pathNavBuild, or a store answering the same)
//   noun           { one, many }: what a place is called in the titles ('scene', 'scenes'); words
//                  without a noun when absent
//   isHeld         the bar goes nowhere (an unsaved edit elsewhere): its path is greyed out
//   pathEnd        after the last segment, before the menu of what is below (the views of a scene)
//   trailing       at the right: the buttons of the host
//   itemRender     how an item of a menu is drawn (item) => node; its label by default
//   rootIcon       an icon component drawn for the root segment instead of its words (a house for the
//                  top of a tree of folders, which has no name of its own); its words stay its title
//   className      added to the bar's own (doc-switch-bar)
export const PathNavBar = observer(function PathNavBar({ nav, noun, isHeld = false, pathEnd, trailing, itemRender, rootIcon: RootIcon, className = '', label = 'Path' }) {
	const word = pathNavWordBuild(noun);
	const current = nav.pathCurrent;
	const childList = nav.childListGet(current);
	// the segment of the place shown, with what follows it, stays in sight
	const scroll = nav.pathScroll;
	const stripRef = useRef(null);
	useLayoutEffect(() => {
		const strip = stripRef.current;
		const segment = strip?.querySelector('[aria-current="page"]')?.closest('.doc-switch-path-item');
		if (!segment) return;
		scroll.reveal(segment.offsetLeft, strip.offsetWidth - segment.offsetLeft);
		scroll.reveal(segment.offsetLeft, segment.offsetWidth);
	}, [scroll, current, scroll.widthOuter, scroll.widthInner]);
	const labelUp = nav.pathUp ? nav.labelGet(nav.pathUp) : '';
	return (
		<div className={`doc-switch-bar not-prose${isHeld ? ' is-editing' : ''}${className ? ` ${className}` : ''}`}>
			<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title={word.back} aria-label={word.back} disabled={isHeld || !nav.isBackPossible} onClick={nav.back}>
				<ArrowLeft size={16} aria-hidden="true" />
			</button>
			<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title={word.forward} aria-label={word.forward} disabled={isHeld || !nav.isForwardPossible} onClick={nav.forward}>
				<ArrowRight size={16} aria-hidden="true" />
			</button>
			<button type="button" className="doc-button-icon is-panel doc-switch-bar-button" title={labelUp ? `Up to ${labelUp}` : 'Up one level'} aria-label="Up one level" disabled={isHeld || !nav.pathUp} onClick={nav.up}>
				<ArrowUp size={16} aria-hidden="true" />
			</button>
			<ScrollHorizontal store={scroll} className="doc-switch-path" innerClassName="doc-switch-path-list" innerRef={stripRef} innerProps={{ role: 'navigation', 'aria-label': label }}>
				{nav.pathChain.map((path, index) => {
					const isIcon = Boolean(RootIcon) && index === 0 && path === nav.root;
					return (
						<span key={path} className="doc-switch-path-item">
							{index > 0 ? <PathNavSibling nav={nav} path={path} word={word} itemRender={itemRender} /> : null}
							<button type="button" className={`doc-switch-path-segment${isIcon ? ' is-icon' : ''}`} aria-current={path === current ? 'page' : undefined} aria-label={isIcon ? nav.labelGet(path) : undefined} title={nav.labelGet(path)} onClick={() => void nav.pathSet(path)}>
								{isIcon ? <RootIcon size={15} aria-hidden="true" /> : nav.labelGet(path)}
							</button>
						</span>
					);
				})}
				{pathEnd}
				{childList.length > 0 ? <PathNavChildren nav={nav} childList={childList} word={word} itemRender={itemRender} /> : null}
			</ScrollHorizontal>
			{trailing ? <span className="doc-switch-bar-trailing">{trailing}</span> : null}
		</div>
	);
});

// the titles of the bar: with the noun of a place, or in words that need none
function pathNavWordBuild(noun) {
	if (!noun) return { back: 'Back', forward: 'Forward', beside: 'What lies beside this one', below: 'What lies below this one' };
	return { back: `Back to the previous ${noun.one}`, forward: `Forward to the ${noun.one} left`, beside: `The ${noun.many} beside this one`, below: `The ${noun.many} below this one` };
}

function PathNavMenuItem({ nav, item, isCurrent, itemRender, onGo }) {
	return (
		<button type="button" aria-label={item.label} data-current={isCurrent ? '' : undefined} onClick={() => { onGo(); void nav.pathSet(item.path); }}>
			{itemRender ? itemRender(item) : <span>{item.label}</span>}
			{item.description ? <em>{item.description}</em> : null}
		</button>
	);
}

// a menu of places at a chevron: it closes on a choice (its items) and when the focus leaves it
function PathNavMenu({ anchorRef, isOpen, children }) {
	return isOpen ? <AnchoredPopover anchorRef={anchorRef} className="doc-switch-path-menu">{children}</AnchoredPopover> : null;
}

const pathNavMenuBlur = (isOpenSet) => (event) => {
	if (!event.relatedTarget?.closest?.('.doc-switch-path-menu')) isOpenSet(false);
};

// the chevron before a segment: the places beside it, when there are others
const PathNavSibling = observer(function PathNavSibling({ nav, path, word, itemRender }) {
	const ref = useRef(null);
	const [isOpen, isOpenSet] = useState(false);
	const siblingList = nav.siblingListGet(path);
	if (siblingList.length <= 1) return <ChevronRight size={13} className="doc-switch-path-gap" aria-hidden="true" />;
	return (
		<>
			<button ref={ref} type="button" className="doc-switch-path-chevron" title={word.beside} aria-label={`List ${word.beside.charAt(0).toLowerCase()}${word.beside.slice(1)}`} aria-expanded={isOpen} onClick={() => isOpenSet(!isOpen)} onBlur={pathNavMenuBlur(isOpenSet)}>
				<ChevronRight size={13} aria-hidden="true" />
			</button>
			<PathNavMenu anchorRef={ref} isOpen={isOpen}>
				{siblingList.map((item) => <PathNavMenuItem key={item.path} nav={nav} item={item} isCurrent={item.path === path} itemRender={itemRender} onGo={() => isOpenSet(false)} />)}
			</PathNavMenu>
		</>
	);
});

// the way further down from the place shown: what lies below it, in the same menu
const PathNavChildren = observer(function PathNavChildren({ nav, childList, word, itemRender }) {
	const ref = useRef(null);
	const [isOpen, isOpenSet] = useState(false);
	return (
		<span className="doc-switch-path-item">
			<button ref={ref} type="button" className="doc-switch-path-chevron is-more" title={word.below} aria-label={`List ${word.below.charAt(0).toLowerCase()}${word.below.slice(1)}`} aria-expanded={isOpen} onClick={() => isOpenSet(!isOpen)} onBlur={pathNavMenuBlur(isOpenSet)}>
				<ChevronRight size={13} aria-hidden="true" />
				<span>{childList.length}</span>
			</button>
			<PathNavMenu anchorRef={ref} isOpen={isOpen}>
				{childList.map((item) => <PathNavMenuItem key={item.path} nav={nav} item={item} itemRender={itemRender} onGo={() => isOpenSet(false)} />)}
			</PathNavMenu>
		</span>
	);
});
