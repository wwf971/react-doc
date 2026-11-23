import { observer } from 'mobx-react-lite';
import { ChevronDown, ChevronUp, PanelBottom, PictureInPicture2 } from '../../../../main/frontend/UICommon.js';
import { DiagramEditCardContent } from './DiagramEditCard.jsx';
import { PANEL_CARD_PLACE_DOCK, PANEL_CARD_PLACE_FLOAT } from './DiagramPanelStore.js';
import './DiagramPanel.css';

// The panel of the visual editor (card-diagram-impl.md#the-panel), drawn by whoever keeps its
// store (DiagramPanelStore.js): the editor of a diagram, or a host keeping one panel for several
// diagrams (a block of scenes). As wide as the viewport: under it in the page, floating over what
// follows (nothing is added to the flow of the page); at the bottom of the block popup. It folds
// to one line.
//
//   head    the tabs (a switch, or the one tab's name), what the tab shown adds (its count, its
//           search, its buttons), where the edit card stands, the fold
//   body    the tab's tree and middle part (its Body), then the properties of what is selected:
//           one column for every tab, the card of the first source answering one
export const DiagramPanel = observer(function DiagramPanel({ panel, isInPopup = false }) {
	const tab = panel.tab;
	if (!tab) return null;
	const isCollapsed = panel.isCollapsed;
	return (
		<section className={`doc-vis-panel doc-edit-popup not-prose${isInPopup ? ' is-popup' : ''}${isCollapsed ? ' is-collapsed' : ''}`} aria-label="Panel of the editor" onDoubleClick={event => event.stopPropagation()}>
			<header className="doc-vis-panel-head">
				<PanelTabSwitch panel={panel} />
				{isCollapsed || !tab.Head ? null : <tab.Head panel={panel} />}
				{isCollapsed ? null : <PanelCardPlaceSwitch panel={panel} />}
				<button type="button" className="doc-button-icon doc-vis-panel-fold" title={isCollapsed ? 'Show the panel' : 'Fold the panel (an edit card docked in it floats beside what is selected meanwhile)'} aria-label={isCollapsed ? 'Show the panel' : 'Fold the panel'} aria-expanded={!isCollapsed} onClick={() => panel.collapsedSet(!isCollapsed)}>
					{isCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
				</button>
			</header>
			{isCollapsed ? null : (
				<div className={`doc-vis-panel-body${panel.isCardDocked ? '' : ' is-card-floating'}`}>
					<tab.Body panel={panel} />
					{panel.isCardDocked ? <PanelCard panel={panel} /> : null}
				</div>
			)}
		</section>
	);
});

// the tabs: a switch with two or more, the name of the one there is otherwise
const PanelTabSwitch = observer(function PanelTabSwitch({ panel }) {
	const list = panel.tabListSorted;
	if (list.length === 1) {
		const { Icon, label } = list[0];
		return <span className="doc-vis-panel-title">{Icon ? <Icon size={13} aria-hidden="true" /> : null}<strong>{label}</strong></span>;
	}
	return (
		<span className="doc-button-group doc-vis-panel-tabs" role="tablist" aria-label="Tabs of the panel">
			{list.map(({ id, label, Icon, title }) => (
				<button key={id} type="button" role="tab" aria-selected={panel.tab?.id === id} aria-pressed={panel.tab?.id === id} title={title ?? label} onClick={() => panel.tabSet(id)}>
					{Icon ? <Icon size={12} aria-hidden="true" /> : null}{label}
				</button>
			))}
		</span>
	);
});

// the edit card of what is selected, docked: whatever its source (the canvas, a host) answers.
// Its head offers to float it beside the thing again
const PanelCard = observer(function PanelCard({ panel }) {
	const card = panel.card;
	const headActionList = [{ id: 'card-float', label: 'Float beside what is selected', Icon: PictureInPicture2, act: () => panel.cardPlaceSet(PANEL_CARD_PLACE_FLOAT) }];
	return (
		<div className={`doc-vis-panel-card doc-vis-card-panel${card && !card.model.tabList.length ? ' is-values' : ''}`} aria-label="Properties of what is selected">
			{card ? <DiagramEditCardContent editor={card.editor} model={card.model} onClose={null} headActionList={[...(card.headActionList ?? []), ...headActionList]} /> : <p className="doc-note doc-vis-panel-empty">Select something: its properties are edited here.</p>}
		</div>
	);
});

// where the edit card stands, said and switched in the head of the panel: in the panel, or beside
// the thing selected (as a card stands everywhere else). The card's own head switches it too
const PanelCardPlaceSwitch = observer(function PanelCardPlaceSwitch({ panel }) {
	const optionList = [
		{ place: PANEL_CARD_PLACE_DOCK, label: 'In the panel', title: 'The properties of what is selected stand in the panel, at its right', Icon: PanelBottom },
		{ place: PANEL_CARD_PLACE_FLOAT, label: 'Beside it', title: 'The properties of what is selected stand in a card beside it', Icon: PictureInPicture2 },
	];
	return (
		<span className="doc-vis-panel-card-place" role="group" aria-label="Edit card">
			<span className="doc-vis-panel-card-place-label">Edit card</span>
			<span className="doc-button-group">
				{optionList.map(({ place, label, title, Icon }) => <button key={place} type="button" aria-pressed={panel.cardPlace === place} title={title} onClick={() => panel.cardPlaceSet(place)}><Icon size={12} aria-hidden="true" />{label}</button>)}
			</span>
		</span>
	);
});

// the button of the head of an edit card floating beside the thing: into the panel. None while the
// card is docked, or where there is no panel
export function panelCardHeadActionListGet(panel) {
	return panel && panel.hasTabs && !panel.isCardDocked ? [{ id: 'card-dock', label: 'Dock in the panel under the canvas', Icon: PanelBottom, act: () => panel.cardPlaceSet(PANEL_CARD_PLACE_DOCK) }] : [];
}
