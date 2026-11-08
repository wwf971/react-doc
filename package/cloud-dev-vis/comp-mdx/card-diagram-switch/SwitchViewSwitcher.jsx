import { useLayoutEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Search } from '../../../../main/frontend/UICommon.js';
import { ValueMenu } from '../card-diagram/DiagramValueControls.jsx';
import { switchViewSearch } from './SwitchData.js';
import { ScrollHorizontal } from '../../../../main/comp-doc/scroll/ScrollHorizontal.jsx';
import { ScrollHorizontalStore } from '../../../../main/comp-doc/scroll/ScrollHorizontalStore.js';

const clickStop = (event) => event.stopPropagation();

// The views of a scene to switch between (card-diagram-flexible-switch.md#the-views-of-a-scene),
// in the same control as a table card's: words alone when there is one to show. For the
// presentation it is given: in the path bar for the scene focused, in the title line of what
// embeds it. viewAsked: the view that embedding asks for; viewShown: what it shows now, if the
// pointer has made that another view.
export const SwitchViewSwitcher = observer(function SwitchViewSwitcher({ store, presentation, viewAsked, viewShown }) {
	const switcher = store?.viewSwitcherGet(presentation, viewAsked);
	if (!switcher?.isShown) return null;
	const { viewList } = switcher;
	const view = viewList.some((item) => item.id === viewShown) ? viewShown : switcher.view;
	const labelOf = (id) => viewList.find((item) => item.id === id)?.label ?? id;
	if (viewList.length <= 1) return <span className="doc-card-view-switcher is-single doc-switch-view-switcher nodrag nopan">{labelOf(view)}</span>;
	return (
		<span className="doc-switch-view-switcher" onClick={clickStop}>
			<ValueMenu label="View" className="doc-card-view-switcher" value={view} values={viewList.map((item) => item.id)} valueLabels={Object.fromEntries(viewList.map((item) => [item.id, item.label]))} onChange={(next) => { void store.viewSet({ path: presentation.path, view: next, pathEmbedder: presentation.pathEmbedder }); }} />
		</span>
	);
});

// The views as tabs (viewSwitcherLayout: tabs), in a row of their own under the title line of
// what embeds the scene (a stack item): one tab per view, in one line moved sideways by the
// wheel or a drag, without a scrollbar (ScrollHorizontal), so finding or choosing one never
// changes the height of the row; with isViewSearchable, a
// field before them keeps the tabs whose words match (switchViewSearch). Enter shows the
// first one found, Escape empties the field. A tab shows its view at once, as the menu does.
// isInert: drawn in a static copy (a mask, a picture), where nothing takes the pointer.
// isWheelTaken: the wheel moves the tabs where the stack holding them takes the wheel (its own
// scene); in a stack embedded in a card the wheel is the canvas's, and a drag moves them.
export const SwitchViewTabs = observer(function SwitchViewTabs({ store, presentation, viewAsked, isInert = false, isWheelTaken = true }) {
	const switcher = store?.viewSwitcherGet(presentation, viewAsked);
	const [text, textSet] = useState('');
	const [scroll] = useState(() => new ScrollHorizontalStore());
	const stripRef = useRef(null);
	const viewList = switcher?.viewList ?? [];
	const view = switcher?.view;
	// the tab shown stays in sight: the strip is moved, never the page
	useLayoutEffect(() => {
		const tab = stripRef.current?.querySelector('[aria-selected="true"]');
		if (tab) scroll.reveal(tab.offsetLeft, tab.offsetWidth);
	}, [scroll, view, text, scroll.widthOuter]);
	if (!switcher?.isShown) return null;
	const foundList = switcher.isSearchable ? switchViewSearch(viewList, text) : viewList;
	const choose = (id) => { void store.viewSet({ path: presentation.path, view: id, pathEmbedder: presentation.pathEmbedder }); };
	return (
		<div className={`doc-switch-view-tabs nodrag nopan${isInert ? ' is-inert' : ''}`} onClick={clickStop}>
			{switcher.isSearchable ? (
				<label className="doc-search-field doc-switch-view-tabs-search">
					<Search size={12} className="doc-search-field-icon" aria-hidden="true" />
					<input
						className="doc-search-field-input"
						type="search"
						value={text}
						placeholder="Search"
						aria-label="Find a view"
						tabIndex={isInert ? -1 : undefined}
						onChange={(event) => textSet(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' && foundList[0]) { event.preventDefault(); choose(foundList[0].id); }
							else if (event.key === 'Escape' && text) { event.stopPropagation(); textSet(''); }
						}}
					/>
					{text ? <span className="doc-switch-view-tabs-count">{foundList.length} / {viewList.length}</span> : null}
				</label>
			) : null}
			<ScrollHorizontal store={scroll} isWheelEnabled={isWheelTaken} className="doc-switch-view-tabs-strip" innerClassName="doc-switch-view-tabs-list" innerRef={stripRef} innerProps={{ role: 'tablist', 'aria-label': 'Views' }}>
				{foundList.map((item) => (
					<button
						key={item.id}
						type="button"
						role="tab"
						className="doc-switch-tab"
						aria-selected={item.id === view}
						title={item.description ? `${item.label}\n${item.description}` : item.label}
						tabIndex={isInert ? -1 : undefined}
						onClick={() => choose(item.id)}
					>
						{item.label}
					</button>
				))}
				{foundList.length === 0 ? <span className="doc-switch-view-tabs-none">No view matches</span> : null}
			</ScrollHorizontal>
		</div>
	);
});
