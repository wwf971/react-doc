import { action, makeAutoObservable, observable } from 'mobx';

// The panel of the visual editor (card-diagram-impl.md#the-panel): the part under the canvas whose
// tabs the features and the hosts bring (the parametric canvas: Structure; a block of scenes:
// Scenes), with one properties column for all of them. This store is its state, and nothing else:
// what a tab lists is the tab's, what the column shows is asked of the sources of cards.
//
// Whoever keeps it renders it (DiagramPanel.jsx): the editor of a diagram keeps one of its own; a
// host that opens several diagrams one after another (a block of scenes) keeps one for all of
// them and gives it to each editor (config.panel), so its tabs, their trees and the choices made
// in it stay while another diagram opens.
//
//   tab          { id, label, Icon?, rank, Head?({ panel }), Body({ panel }) }: registered by who
//                brings it (tabRegister answers its removal)
//   card source  { id, rank, cardGet() -> { model, editor, anchorRectGet?, close? } | null }: what
//                the properties column shows is the card of the first source (by rank) answering one.
//                The canvas of the editor answers what is selected there; a host answers its own
//                focus, and what it shows when nothing is selected
//   cardPlace    where the edit card stands, the author's choice: 'dock' (in the column) or 'float'
//                (beside the thing selected, as everywhere else). Kept in this browser
export const PANEL_CARD_PLACE_DOCK = 'dock';
export const PANEL_CARD_PLACE_FLOAT = 'float';
const CARD_PLACE_STORAGE_KEY = 'doc-vis-panel-card-place';
// the key the parametric canvas kept it under before the panel was a layer of its own
const CARD_PLACE_STORAGE_KEY_BEFORE = 'doc-param-card-place';

function storageRead(key) {
	try {
		return globalThis.localStorage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function storageWrite(key, value) {
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch {
		// a browser keeping no storage: the choice lasts while the page is open
	}
}

export function panelCardPlaceRead() {
	const value = storageRead(CARD_PLACE_STORAGE_KEY) ?? storageRead(CARD_PLACE_STORAGE_KEY_BEFORE);
	return value === PANEL_CARD_PLACE_FLOAT ? PANEL_CARD_PLACE_FLOAT : PANEL_CARD_PLACE_DOCK;
}

export class DiagramPanelStore {
	isCollapsed = false;
	tabIdChosen = null;
	cardPlace = PANEL_CARD_PLACE_DOCK;
	tabList = [];
	cardSourceList = [];

	constructor({ cardPlace = panelCardPlaceRead() } = {}) {
		this.cardPlace = cardPlace;
		makeAutoObservable(this, { tabList: observable.shallow, cardSourceList: observable.shallow }, { autoBind: true });
	}

	// ---------- tabs ----------

	// a tab brought by a feature or a host: in the panel until the function answered is called. A tab
	// of the same id replaces the one there (an editor opened again brings its tab again)
	tabRegister(tab) {
		this.tabList = [...this.tabList.filter(item => item.id !== tab.id), tab];
		return action(() => { this.tabList = this.tabList.filter(item => item !== tab); });
	}

	get tabListSorted() { return this.tabList.slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || String(a.id).localeCompare(String(b.id))); }

	// the tab shown: the one chosen while it is there, else the first. A tab gone for a moment (the
	// editor of another scene opening) leaves the choice as it was, so it is shown again when back
	get tab() {
		const list = this.tabListSorted;
		return list.find(item => item.id === this.tabIdChosen) ?? list[0] ?? null;
	}

	get hasTabs() { return this.tabList.length > 0; }

	tabSet(tabId) {
		this.tabIdChosen = tabId;
		this.isCollapsed = false;
	}

	collapsedSet(isCollapsed) { this.isCollapsed = Boolean(isCollapsed); }

	// ---------- the properties column ----------

	// the edit card stands in the panel when the author docked it there and the panel is open; else
	// it floats beside what is selected (a folded panel has no room for it)
	get isCardDocked() { return this.cardPlace === PANEL_CARD_PLACE_DOCK && !this.isCollapsed && this.hasTabs; }

	// docked: the panel is opened if it was folded, so the card has its place
	cardPlaceSet(place) {
		this.cardPlace = place === PANEL_CARD_PLACE_DOCK ? PANEL_CARD_PLACE_DOCK : PANEL_CARD_PLACE_FLOAT;
		if (this.cardPlace === PANEL_CARD_PLACE_DOCK) this.isCollapsed = false;
		storageWrite(CARD_PLACE_STORAGE_KEY, this.cardPlace);
	}

	cardSourceRegister(source) {
		this.cardSourceList = [...this.cardSourceList.filter(item => item.id !== source.id), source];
		return action(() => { this.cardSourceList = this.cardSourceList.filter(item => item !== source); });
	}

	// the card of what is selected: the first source answering one
	get card() {
		for (const source of this.cardSourceList.slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))) {
			const card = source.cardGet();
			if (card) return card;
		}
		return null;
	}
}
