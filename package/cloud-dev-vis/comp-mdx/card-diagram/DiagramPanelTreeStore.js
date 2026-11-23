import { makeAutoObservable, observable } from 'mobx';
import { TREE_PAGE_SIZE_DEFAULT, TREE_PAGE_SIZE_LIST, treeRevealState, treeRowListBuild, treeSearchSetBuild, treeWordListOf } from './DiagramPanelTreeData.js';

// The state of a tree of the panel (DiagramPanelTree.jsx), by the keys of its items: what is open,
// the page of each open item, the filter of each paged level, the search of the whole tree, the
// cursor of the keys, where it is scrolled. Nothing of what the tree lists: that is the model a
// tab gives (DiagramPanelTreeData.js). The page size is one choice for every tree, kept in this
// browser.
const PAGE_SIZE_STORAGE_KEY = 'doc-vis-panel-tree-page-size';

function pageSizeRead() {
	try {
		const value = Number(globalThis.localStorage?.getItem(PAGE_SIZE_STORAGE_KEY));
		return TREE_PAGE_SIZE_LIST.includes(value) ? value : TREE_PAGE_SIZE_DEFAULT;
	} catch {
		return TREE_PAGE_SIZE_DEFAULT;
	}
}

export class DiagramPanelTreeStore {
	expandedByKey = {};
	pageByKey = {};
	filterByKey = {};
	searchCollapsedByKey = {};
	search = '';
	pageSize = TREE_PAGE_SIZE_DEFAULT;
	// the item the keys move from, when nothing is selected
	cursorKey = null;
	// where the list is scrolled and how high its box is: the rows drawn are those in view
	scrollTop = 0;
	viewHeight = 240;
	// a row to bring into view: { key, token }, taken by the component
	scrollRequest = null;
	searchCache = null;

	constructor({ pageSize = pageSizeRead() } = {}) {
		this.pageSize = pageSize;
		// searchGet and rowListGet are read while drawing: no actions (an action reads untracked)
		makeAutoObservable(this, { searchCache: false, searchGet: false, rowListGet: false, scrollRequest: observable.ref }, { autoBind: true });
	}

	get state() {
		return { expandedByKey: this.expandedByKey, pageByKey: this.pageByKey, filterByKey: this.filterByKey, searchCollapsedByKey: this.searchCollapsedByKey, pageSize: this.pageSize };
	}

	get wordList() { return treeWordListOf(this.search); }

	// what the search keeps of a model, made once per model and words (keepKey: what is selected,
	// kept in sight whatever it holds)
	searchGet(model, keepKey = null) {
		if (!this.wordList.length) return null;
		const cache = this.searchCache;
		if (cache && cache.model === model && cache.search === this.search && cache.keepKey === keepKey) return cache.result;
		const result = treeSearchSetBuild(model, this.wordList, new Set(keepKey ? [keepKey] : []));
		this.searchCache = { model, search: this.search, keepKey, result };
		return result;
	}

	rowListGet(model, keepKey = null) {
		return treeRowListBuild(model, this.state, this.searchGet(model, keepKey));
	}

	// ---------- the author's choices ----------

	toggle(key, isExpanded, model) {
		if (this.wordList.length) {
			const isOpen = !this.searchCollapsedByKey[key];
			this.searchCollapsedByKey = { ...this.searchCollapsedByKey, [key]: isExpanded === undefined ? isOpen : !isExpanded };
			return;
		}
		const isOpen = this.expandedByKey[key] ?? Boolean(model?.isExpandedDefault?.(key));
		this.expandedByKey = { ...this.expandedByKey, [key]: isExpanded === undefined ? !isOpen : Boolean(isExpanded) };
	}

	pageSet(parentKey, page) {
		this.pageByKey = { ...this.pageByKey, [parentKey]: Math.max(0, Math.floor(Number(page) || 0)) };
	}

	filterSet(parentKey, text) {
		this.filterByKey = { ...this.filterByKey, [parentKey]: String(text ?? '') };
		this.pageByKey = { ...this.pageByKey, [parentKey]: 0 };
	}

	searchSet(text) {
		this.search = String(text ?? '');
		this.searchCollapsedByKey = {};
	}

	pageSizeSet(size) {
		const value = Number(size);
		if (!TREE_PAGE_SIZE_LIST.includes(value)) return;
		// the first item of the page shown stays on the page shown
		this.pageByKey = Object.fromEntries(Object.entries(this.pageByKey).map(([key, page]) => [key, Math.floor((page * this.pageSize) / value)]));
		this.pageSize = value;
		try {
			globalThis.localStorage?.setItem(PAGE_SIZE_STORAGE_KEY, String(value));
		} catch {
			// kept while the page is open
		}
	}

	cursorSet(key) { this.cursorKey = key; }

	viewSet({ scrollTop, viewHeight }) {
		if (scrollTop !== undefined) this.scrollTop = scrollTop;
		if (viewHeight !== undefined && viewHeight > 0) this.viewHeight = viewHeight;
	}

	scrollRequestTake() { this.scrollRequest = null; }

	// what is selected elsewhere made seen: open above it, the pages turned to it, a filter hiding it
	// emptied; the row is brought into view (the component does, only when it is out of view)
	reveal(key, model) {
		if (!key || !model) return;
		const search = this.searchGet(model, key);
		const state = this.state;
		const next = treeRevealState(model, state, key, search);
		if (next !== state) {
			this.expandedByKey = next.expandedByKey;
			this.pageByKey = next.pageByKey;
			this.filterByKey = next.filterByKey;
			this.searchCollapsedByKey = next.searchCollapsedByKey;
		}
		this.scrollRequest = { key, token: (this.scrollRequest?.token ?? 0) + 1 };
	}
}
