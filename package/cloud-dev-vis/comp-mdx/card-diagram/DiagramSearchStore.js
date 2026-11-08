import { makeAutoObservable, observable } from 'mobx';
import { diagramSearchItemListBuild, diagramSearchRequestBuild, diagramSearchStateBuild } from './DiagramSearch.js';

// The search of one canvas (card-diagram-impl.md#search): what the bar holds, what is found,
// which one is current, and how every place is marked. The host gives the searcher, a
// function of a request answering the result of what it shows (DiagramSearch.js), and runs
// refresh() when the request or what it shows changes (useDiagramSearchHost): a search may
// read scenes not read yet, which is not something a computed value may do.
//
//   isOpen, text, isCaseSensitive, isWholeWord, depthMax    the bar
//   isDepthOffered     whether there are scenes inside scenes to search (the switch layer)
//   itemList, itemCurrent, indexCurrent                     what was found, in order
//   stateOf(path, nodeId, partId?), lineStateOf(path, id)   'match' | 'current' | null
//   focusToken         changes when the bar is asked to take the focus (open again)
//   revealToken        changes when the current item is to be brought into view
export class DiagramSearchStore {
	isOpen = false;
	text = '';
	isCaseSensitive = false;
	isWholeWord = false;
	depthMax = 0;
	isDepthOffered = false;
	keyCurrent = '';
	result = null;
	focusToken = 0;
	revealToken = 0;

	constructor({ searcher, depthMax = 0, isDepthOffered = false } = {}) {
		this.searcher = searcher;
		this.depthMax = depthMax;
		this.isDepthOffered = isDepthOffered;
		makeAutoObservable(this, { searcher: false, result: observable.ref }, { autoBind: true });
	}

	searcherSet(searcher) {
		this.searcher = searcher;
	}

	get request() {
		return diagramSearchRequestBuild({ text: this.text, isCaseSensitive: this.isCaseSensitive, isWholeWord: this.isWholeWord, depthMax: this.isDepthOffered ? this.depthMax : 0 });
	}

	// what is found, for the request as it stands
	refresh() {
		if (!this.isOpen || !this.text || !this.searcher) {
			this.result = null;
			return;
		}
		try {
			this.result = this.searcher(this.request);
		} catch {
			this.result = null;
		}
	}

	get itemList() {
		return diagramSearchItemListBuild(this.result);
	}

	get indexCurrent() {
		if (this.itemList.length === 0) return -1;
		const index = this.itemList.findIndex((item) => item.key === this.keyCurrent);
		return index < 0 ? 0 : index;
	}

	get itemCurrent() {
		return this.indexCurrent < 0 ? null : this.itemList[this.indexCurrent];
	}

	get stateByKey() {
		return diagramSearchStateBuild(this.itemList, this.itemCurrent?.key);
	}

	stateOf(path, nodeId, partId) {
		return this.stateByKey.get(`${path}|${nodeId}${partId ? `|${partId}` : ''}`) ?? null;
	}

	lineStateOf(path, connectionId) {
		return this.stateByKey.get(`${path}|~line|${connectionId}`) ?? null;
	}

	open() {
		this.isOpen = true;
		this.focusToken += 1;
		if (this.text) this.revealToken += 1;
	}

	close() {
		this.isOpen = false;
	}

	// a new text starts again from the first thing found, and shows it
	textSet(text) {
		this.text = text;
		this.keyCurrent = '';
		this.revealToken += 1;
	}

	optionToggle(name) {
		if (!['isCaseSensitive', 'isWholeWord'].includes(name)) return;
		this[name] = !this[name];
		this.keyCurrent = '';
		this.revealToken += 1;
	}

	depthMaxSet(depthMax) {
		this.depthMax = Math.max(0, Number(depthMax) || 0);
		this.revealToken += 1;
	}

	step(delta) {
		const count = this.itemList.length;
		if (count === 0) return;
		this.keyCurrent = this.itemList[(this.indexCurrent + delta + count) % count].key;
		this.revealToken += 1;
	}

	next() {
		this.step(1);
	}

	previous() {
		this.step(-1);
	}
}
