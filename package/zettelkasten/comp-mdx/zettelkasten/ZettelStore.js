import { makeAutoObservable, observable } from 'mobx';
import { timeTextGet } from '../../../../main/frontend/src/lib/time-text.js';
import { zettelDocTextBuild } from './ZettelDoc.js';
import { ZETTEL_PROGRESS_KEY, ZETTEL_PROGRESS_STATUS_LIST, zettelAnswerCheck, zettelAssetPathBuild, zettelPathOf, zettelPathRead, zettelSearch } from './ZettelData.js';

// The state of one zettelkasten block while it is on the page (doc/README.md#the-state-of-a-block):
// which card is read and which place of it is asked to be seen, the way there and back, how
// the block is laid out, the search, the answers a reader chose. It is
// the block's (useCompStateStore), so it survives the popup, edit mode and coming back to the
// document. Nothing here is saved: what is kept (a note, how a question went) is written into
// the object through the api of its mode, which the components hand in with each request.
export const ZETTEL_LAYOUT_LIST = ['split', 'map', 'card'];
export const ZETTEL_PANEL_LIST = ['map', 'outline', 'question', 'note'];

export class ZettelStore {
	// the scene path of what is read: a card, or the questions below a card
	path = '';
	// a place of the card to bring into view: version changes with every request
	placeTarget = { path: '', place: '', version: 0 };
	historyList = [];
	forwardList = [];
	// the path the map was last asked to go to: its own reports are ignored until it arrives
	pathAsked = '';
	layout = 'split';
	panel = 'map';
	searchText = '';
	isSearchOpen = false;
	searchIndexActive = 0;
	// practice: a question hides its answer until the reader asks for it
	isPractice = false;
	revealKeySet = observable.set();
	choiceByQuestion = observable.map({}, { deep: false });
	questionFilter = { hub: '', status: '' };
	outlineClosedSet = observable.set();
	// a card being made below another, a card about to be removed, the card to open once made
	cardNew = { parent: '', title: '', isBusy: false, message: '' };
	cardRemove = { key: '', isBusy: false, message: '' };
	cardOpenPending = '';
	// the note about to be added: the card and the place of it chosen
	noteAdd = { target: '', place: '', isBusy: false, message: '' };
	// what could not be done, said above the card
	message = '';

	constructor({ pathInitial = '', isPractice = false, layout = '', panel = '' } = {}) {
		this.path = pathInitial;
		this.isPractice = isPractice;
		if (ZETTEL_LAYOUT_LIST.includes(layout)) this.layout = layout;
		if (ZETTEL_PANEL_LIST.includes(panel)) this.panel = panel;
		makeAutoObservable(this, { historyList: observable.ref, forwardList: observable.ref, placeTarget: observable.ref, noteAdd: observable.ref, cardNew: observable.ref, cardRemove: observable.ref, questionFilter: observable.ref }, { autoBind: true });
	}

	// ---------- where the reader is ----------

	// the start of a block: the card its parameters name, once the model can say where it is
	pathEnsure(model, zettelParam) {
		if (this.path && zettelPathRead(model, this.path)) return;
		const key = zettelParam && model.zettelByKey.has(zettelParam) ? zettelParam : model.rootKey;
		this.path = zettelPathOf(model, key);
	}

	go(path, { place = '', isHistory = true, isFromMap = false } = {}) {
		if (!path) return;
		if (path !== this.path) {
			if (isHistory && this.path) {
				this.historyList = [...this.historyList.slice(-60), this.path];
				this.forwardList = [];
			}
			this.path = path;
			if (!isFromMap) this.pathAsked = path;
		}
		this.placeTarget = { path, place, version: this.placeTarget.version + 1 };
	}

	zettelOpen(model, key, place = '') {
		const path = zettelPathOf(model, key);
		if (!path) {
			this.message = `There is no card "${key}".`;
			return;
		}
		this.message = '';
		this.go(path, { place });
	}

	// what the map says it shows now: taken as the reader's own move, unless it is on its way
	// to where this store sent it
	mapPathAccept(path) {
		if (this.pathAsked) {
			if (path === this.pathAsked) this.pathAsked = '';
			return;
		}
		if (path && path !== this.path) this.go(path, { isFromMap: true });
	}

	back() {
		const list = this.historyList;
		if (list.length === 0) return;
		this.forwardList = [...this.forwardList.slice(-60), this.path];
		this.historyList = list.slice(0, -1);
		this.go(list[list.length - 1], { isHistory: false });
	}

	forward() {
		const list = this.forwardList;
		if (list.length === 0) return;
		this.historyList = [...this.historyList.slice(-60), this.path];
		this.forwardList = list.slice(0, -1);
		this.go(list[list.length - 1], { isHistory: false });
	}

	layoutSet(layout) {
		if (ZETTEL_LAYOUT_LIST.includes(layout)) this.layout = layout;
	}

	panelSet(panel) {
		if (ZETTEL_PANEL_LIST.includes(panel)) this.panel = panel;
	}

	outlineToggle(key) {
		if (this.outlineClosedSet.has(key)) this.outlineClosedSet.delete(key);
		else this.outlineClosedSet.add(key);
	}

	questionFilterSet(change) {
		this.questionFilter = { ...this.questionFilter, ...change };
	}

	// ---------- search ----------

	searchTextSet(text) {
		this.searchText = text;
		this.searchIndexActive = 0;
		this.isSearchOpen = text.trim() !== '';
	}

	searchClose() {
		this.isSearchOpen = false;
	}

	searchOpen() {
		this.isSearchOpen = this.searchText.trim() !== '';
	}

	searchResultListGet(model) {
		return zettelSearch(model, this.searchText, { limit: 24 });
	}

	searchMove(model, step) {
		const count = this.searchResultListGet(model).length;
		if (count > 0) this.searchIndexActive = (this.searchIndexActive + step + count) % count;
	}

	searchChoose(model, index = this.searchIndexActive) {
		const hit = this.searchResultListGet(model)[index];
		if (!hit) return;
		this.isSearchOpen = false;
		this.zettelOpen(model, hit.zettel.key);
	}

	// ---------- questions ----------

	practiceSet(isPractice) {
		this.isPractice = isPractice;
		if (isPractice) {
			this.revealKeySet.clear();
			this.choiceByQuestion.clear();
		}
	}

	isRevealed(key) {
		return !this.isPractice || this.revealKeySet.has(key);
	}

	choiceListOf(key) {
		return this.choiceByQuestion.get(key) ?? [];
	}

	// an option clicked before the answer is shown: chosen, or taken back; a question with one
	// answer keeps one choice
	choiceToggle(question, optionId) {
		if (this.revealKeySet.has(question.key)) return;
		const list = this.choiceListOf(question.key);
		if (list.includes(optionId)) this.choiceByQuestion.set(question.key, list.filter((id) => id !== optionId));
		else this.choiceByQuestion.set(question.key, question.answer.length <= 1 ? [optionId] : [...list, optionId].sort());
	}

	// the answer shown. with options chosen, the result is kept as the reader's progress
	async reveal(service, model, question) {
		this.revealKeySet.add(question.key);
		const choiceList = this.choiceListOf(question.key);
		if (choiceList.length === 0) return { code: 0 };
		return this.progressSet(service, model, question.key, zettelAnswerCheck(question, choiceList) ? 'right' : 'wrong');
	}

	hide(key) {
		this.revealKeySet.delete(key);
		this.choiceByQuestion.delete(key);
	}

	// how a question went, written into the progress item of the object (created on the first one)
	async progressSet(service, model, key, status) {
		if (!service?.isWritable) return { code: -1, message: service?.writeUnavailableReason || 'The object cannot be written here.' };
		const statusByQuestion = { ...model.progress.statusByQuestion };
		if (ZETTEL_PROGRESS_STATUS_LIST.includes(status)) statusByQuestion[key] = { status, time: timeTextGet() };
		else delete statusByQuestion[key];
		const data = { statusByQuestion };
		if (model.progress.key) return service.assetWrite(model.progress.key, data, `progress: ${key} ${status || 'cleared'}`);
		return service.assetCreate({ key: ZETTEL_PROGRESS_KEY, kind: 'progress', name: 'Progress', pathList: ['/progress'], partition: notePartitionOf(service), data });
	}

	// ---------- cards made and removed (while the document of the block is edited) ----------

	cardNewOpen(parent) {
		this.cardNew = { parent, title: '', isBusy: false, message: '' };
	}

	cardNewTitleSet(title) {
		this.cardNew = { ...this.cardNew, title, message: '' };
	}

	cardNewClose() {
		this.cardNew = { parent: '', title: '', isBusy: false, message: '' };
	}

	// a new card below another: one level down (an area below the root, a topic below an area, a
	// fact below a topic), with the title given and a first line to write over; then it is opened
	async cardNewRun(service, model) {
		const { parent, title } = this.cardNew;
		const titleText = title.trim();
		const parentZettel = model.zettelByKey.get(parent);
		if (!parentZettel || !titleText) {
			this.cardNew = { ...this.cardNew, message: 'A card needs a title.' };
			return { code: -1 };
		}
		if (!service?.isEditable) {
			this.cardNew = { ...this.cardNew, message: service?.editUnavailableReason || 'The object cannot be written here.' };
			return { code: -1 };
		}
		const keyBase = titleText.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'card';
		let key = keyBase;
		for (let index = 2; service.assetResolve(key).status !== 'unknown'; index += 1) key = `${keyBase}-${index}`;
		const level = { root: 'hub', hub: 'topic' }[parentZettel.level] ?? 'fact';
		const chain = [];
		for (let one = parentZettel; one && one.key !== model.rootKey; one = model.zettelByKey.get(one.parentKey)) chain.unshift(one.key);
		this.cardNew = { ...this.cardNew, isBusy: true, message: '' };
		const result = await service.assetCreate({ key, kind: 'zettel', lang: 'md', name: titleText, pathList: [zettelAssetPathBuild('zettel', [...chain, key])], partition: parentZettel.partition || undefined, text: zettelDocTextBuild({ level, parent, title: titleText, summary: '' }, 'A new card: write what it says.') });
		if (result?.code !== 0) {
			this.cardNew = { ...this.cardNew, isBusy: false, message: result?.message || 'The card could not be made.' };
			return result;
		}
		this.cardNewClose();
		this.cardOpenPending = key;
		return result;
	}

	// the card made a moment ago is opened once the model has it
	cardOpenPendingTake(model) {
		const key = this.cardOpenPending;
		if (!key || !model.zettelByKey.has(key)) return;
		this.cardOpenPending = '';
		this.zettelOpen(model, key);
	}

	cardRemoveAsk(key) {
		this.cardRemove = { key, isBusy: false, message: '' };
	}

	cardRemoveClose() {
		this.cardRemove = { key: '', isBusy: false, message: '' };
	}

	// a card taken out of the box (deleted softly, as every asset of an object is); a card with
	// cards below it is not removed. the reader is left at the card above
	async cardRemoveRun(service, model) {
		const zettel = model.zettelByKey.get(this.cardRemove.key);
		if (!zettel) return { code: -1 };
		if (!service?.isEditable) {
			this.cardRemove = { ...this.cardRemove, message: service?.editUnavailableReason || 'The object cannot be written here.' };
			return { code: -1 };
		}
		this.cardRemove = { ...this.cardRemove, isBusy: true, message: '' };
		const result = await service.assetRemove(zettel.key);
		if (result?.code !== 0) {
			this.cardRemove = { ...this.cardRemove, isBusy: false, message: result?.message || 'The card could not be removed.' };
			return result;
		}
		this.cardRemoveClose();
		if (zettel.parentKey) this.zettelOpen(model, zettel.parentKey);
		return result;
	}

	// ---------- notes (while the document of the block is edited) ----------

	noteAddPlaceSet(target, place) {
		this.noteAdd = { target, place, isBusy: false, message: '' };
	}

	// a new note on a card: a document of the object in the partition of notes, with a first
	// line to write over; its text is then edited block by block, as any document
	async noteAddRun(service, target) {
		if (!service?.isEditable) {
			this.noteAdd = { ...this.noteAdd, target, message: service?.editUnavailableReason || 'The object cannot be written here.' };
			return { code: -1 };
		}
		const place = this.noteAdd.target === target ? this.noteAdd.place : '';
		this.noteAdd = { target, place, isBusy: true, message: '' };
		const time = timeTextGet();
		const result = await service.assetCreate({ kind: 'note', lang: 'md', name: `Note ${time}`, pathList: [zettelAssetPathBuild('note', [target, time])], partition: notePartitionOf(service), text: zettelDocTextBuild({ target, ...(place ? { place } : {}), timeCreate: time }, 'A new note.') });
		this.noteAdd = { target, place, isBusy: false, message: result?.code === 0 ? '' : result?.message || 'The note could not be written.' };
		return result;
	}

	async noteRemove(service, key) {
		if (!service?.isEditable) return { code: -1, message: service?.editUnavailableReason };
		const result = await service.assetRemove(key);
		if (result?.code !== 0) this.message = result?.message || 'The note could not be removed.';
		return result;
	}
}

// the partition what the reader writes goes to: the one named "note" when the type declares
// it, else the default (doc/README.md#partitions)
export function notePartitionOf(service) {
	const list = service?.partitionList ?? [];
	return (list.find((partition) => partition.id === 'note') ?? list.find((partition) => partition.isDefault) ?? list[0])?.id;
}
