import { makeAutoObservable, observable } from 'mobx';
import { timeTextGet } from '../../../../main/frontend/src/lib/time-text.js';
import { zettelDocTextBuild } from './ZettelDoc.js';
import { ZETTEL_PROGRESS_KEY, ZETTEL_PROGRESS_STATUS_LIST, zettelAnswerCheck, zettelAssetPathBuild, zettelChainOf, zettelContainCycleText, zettelGet, zettelSearch } from './ZettelData.js';
import { zettelConnectionAddMeta, zettelConnectionRemoveMeta } from './ZettelConnect.js';
import { ZETTEL_PLACE_ALL } from './ZettelScenes.js';

// The state of one zettelkasten block while it is on the page (doc/README.md#the-state-of-a-block):
// which zettel is shown and how (its text, its connections, its flow), which places of the
// connection view are shown, whether the zettel is expanded, the way there and back, the search,
// the side panel of the explorer, the answers a reader chose, and the dialog open. It is the
// block's (useCompStateStore), so it survives the popup, edit mode and coming back to the
// document. Nothing here is saved: what is kept (a note, a connection, how a question went) is
// written into the object through the api of its mode, which the components hand in with each request.
export const ZETTEL_VIEW_LIST = ['text', 'link', 'flow'];
export const ZETTEL_PANEL_LIST = ['', 'outline', 'question', 'note'];

const dialogClosed = null;

export class ZettelStore {
	// the zettel shown, and a place of it to bring into view (version changes with every request)
	zettelKey = '';
	placeTarget = { key: '', place: '', version: 0 };
	historyList = [];
	forwardList = [];
	// how the zettel is shown: its text, its connections, its flow. viewShown is what is drawn: it
	// follows view once the change has played (ZettelMotion.js)
	view = 'text';
	viewShown = 'text';
	// the places of the connection view shown: letters of ZETTEL_PLACE_LIST
	placeCode = ZETTEL_PLACE_ALL;
	isExpanded = false;
	// the viewport of the scenes is drawn once it is first asked for, and kept; the width of the card
	isSceneMounted = false;
	cardWidth = 0;
	// the width of the block, which the height of a zettel follows
	deskWidth = 0;
	// the explorer: what its side panel shows ('' none)
	panel = '';
	searchText = '';
	isSearchOpen = false;
	searchIndexActive = 0;
	// practice: a question hides its answer until the reader asks for it
	isPractice = false;
	revealKeySet = observable.set();
	choiceByQuestion = observable.map({}, { deep: false });
	questionFilter = { hub: '', status: '' };
	outlineClosedSet = observable.set();
	// the menu of the title bar, and the dialog open over the zettel (edit mode):
	//   { kind: cardNew, title }   { kind: cardRemove }   { kind: connect, type, targetText, targetKey, labelKind, labelText, labelKey, labelRef, isDirected }
	// each with isBusy and message
	isMenuOpen = false;
	dialog = dialogClosed;
	cardOpenPending = '';
	// the note about to be added: the zettel and the place of it chosen
	noteAdd = { target: '', place: '', isBusy: false, message: '' };
	// what could not be done, said above the zettel
	message = '';

	constructor({ isPractice = false, panel = '', view = '', placeCode = '' } = {}) {
		this.isPractice = isPractice;
		if (ZETTEL_PANEL_LIST.includes(panel)) this.panel = panel;
		if (ZETTEL_VIEW_LIST.includes(view)) {
			this.view = view;
			this.viewShown = view;
			// a block starting with a scene draws it at once
			this.isSceneMounted = view !== 'text';
		}
		if (placeCode) this.placeCode = [...new Set(String(placeCode))].sort().join('');
		makeAutoObservable(this, { historyList: observable.ref, forwardList: observable.ref, placeTarget: observable.ref, noteAdd: observable.ref, dialog: observable.ref, questionFilter: observable.ref }, { autoBind: true });
	}

	// ---------- where the reader is ----------

	// the start of a block: the zettel its parameters name, once the model can say where it is
	zettelEnsure(model, keyParam) {
		if (this.zettelKey && zettelGet(model, this.zettelKey)) return;
		this.zettelKey = keyParam && zettelGet(model, keyParam) ? keyParam : model.rootKey;
	}

	go(key, { place = '', isHistory = true } = {}) {
		if (!key) return;
		if (key !== this.zettelKey) {
			if (isHistory && this.zettelKey) {
				this.historyList = [...this.historyList.slice(-60), this.zettelKey];
				this.forwardList = [];
			}
			this.zettelKey = key;
			this.isMenuOpen = false;
			this.dialog = dialogClosed;
		}
		this.placeTarget = { key, place, version: this.placeTarget.version + 1 };
	}

	zettelOpen(model, key, place = '') {
		if (!zettelGet(model, key)) {
			this.message = `There is no zettel "${key}".`;
			return;
		}
		this.message = '';
		this.go(key, { place });
	}

	// a zettel opened with its text: a link followed, the zettel in the middle of the connections clicked
	zettelRead(model, key, place = '') {
		this.zettelOpen(model, key, place);
		this.viewSet('text');
	}

	back() {
		const list = this.historyList;
		if (list.length === 0) return;
		this.forwardList = [...this.forwardList.slice(-60), this.zettelKey];
		this.historyList = list.slice(0, -1);
		this.go(list[list.length - 1], { isHistory: false });
	}

	forward() {
		const list = this.forwardList;
		if (list.length === 0) return;
		this.historyList = [...this.historyList.slice(-60), this.zettelKey];
		this.forwardList = list.slice(0, -1);
		this.go(list[list.length - 1], { isHistory: false });
	}

	viewSet(view) {
		if (ZETTEL_VIEW_LIST.includes(view)) this.view = view;
	}

	// the change of view has played: what is drawn is what was asked
	viewShownSet(view) {
		this.viewShown = view;
	}

	sceneMount() {
		this.isSceneMounted = true;
	}

	cardWidthSet(width) {
		if (width > 0 && Math.abs(width - this.cardWidth) >= 1) this.cardWidth = width;
	}

	deskWidthSet(width) {
		if (width > 0 && Math.abs(width - this.deskWidth) >= 1) this.deskWidth = width;
	}

	placeToggle(letter) {
		const set = new Set(this.placeCode);
		if (set.has(letter)) set.delete(letter);
		else set.add(letter);
		this.placeCode = [...set].sort().join('');
	}

	placeCodeSet(code) {
		this.placeCode = [...new Set(String(code))].sort().join('');
	}

	expandToggle() {
		this.isExpanded = !this.isExpanded;
	}

	panelSet(panel) {
		if (ZETTEL_PANEL_LIST.includes(panel)) this.panel = this.panel === panel ? '' : panel;
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

	// ---------- the menu and the dialogs of the title bar (while the document is edited) ----------

	menuToggle() {
		this.isMenuOpen = !this.isMenuOpen;
	}

	menuClose() {
		this.isMenuOpen = false;
	}

	dialogOpen(kind) {
		this.isMenuOpen = false;
		if (kind === 'cardNew') this.dialog = { kind, title: '', isBusy: false, message: '' };
		else if (kind === 'cardRemove') this.dialog = { kind, isBusy: false, message: '' };
		else if (kind === 'connect') this.dialog = { kind, type: 'link', targetText: '', targetKey: '', labelKind: 'none', labelText: '', labelKey: '', labelRef: '', isDirected: true, isBusy: false, message: '' };
	}

	dialogChange(change) {
		if (this.dialog) this.dialog = { ...this.dialog, ...change, message: change.message ?? '' };
	}

	dialogClose() {
		this.dialog = dialogClosed;
	}

	// a new zettel held by the one shown: one level down (an area below the root, a topic below an
	// area, a fact below a topic), with the title given and a first line to write over; then it is opened
	async cardNewRun(service, model) {
		const parentZettel = zettelGet(model, this.zettelKey);
		const titleText = String(this.dialog?.title ?? '').trim();
		if (!parentZettel || !titleText) {
			this.dialogChange({ message: 'A zettel needs a title.' });
			return { code: -1 };
		}
		if (!service?.isEditable) {
			this.dialogChange({ message: service?.editUnavailableReason || 'The object cannot be written here.' });
			return { code: -1 };
		}
		const keyBase = titleText.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'zettel';
		let key = keyBase;
		for (let index = 2; service.assetResolve(key).status !== 'unknown'; index += 1) key = `${keyBase}-${index}`;
		const level = { root: 'hub', hub: 'topic' }[parentZettel.level] ?? 'fact';
		const chain = zettelChainOf(model, parentZettel.key).filter((one) => one.key !== model.rootKey).map((one) => one.key);
		this.dialogChange({ isBusy: true });
		const result = await service.assetCreate({ key, kind: 'zettel', lang: 'md', name: titleText, pathList: [zettelAssetPathBuild('zettel', [...chain, key])], partition: parentZettel.partition || undefined, text: zettelDocTextBuild({ level, parent: parentZettel.key, title: titleText, summary: '' }, 'A new zettel: write what it says.') });
		if (result?.code !== 0) {
			this.dialogChange({ isBusy: false, message: result?.message || 'The zettel could not be made.' });
			return result;
		}
		this.dialogClose();
		this.cardOpenPending = key;
		return result;
	}

	// the zettel made a moment ago is opened once the model has it
	cardOpenPendingTake(model) {
		const key = this.cardOpenPending;
		if (!key || !zettelGet(model, key)) return;
		this.cardOpenPending = '';
		this.zettelRead(model, key);
	}

	// the zettel shown taken out of the box (deleted softly, as every asset of an object is); one
	// holding others is not removed. the reader is left at the zettel above
	async cardRemoveRun(service, model) {
		const zettel = zettelGet(model, this.zettelKey);
		if (!zettel) return { code: -1 };
		if (!service?.isEditable) {
			this.dialogChange({ message: service?.editUnavailableReason || 'The object cannot be written here.' });
			return { code: -1 };
		}
		this.dialogChange({ isBusy: true });
		const result = await service.assetRemove(zettel.key);
		if (result?.code !== 0) {
			this.dialogChange({ isBusy: false, message: result?.message || 'The zettel could not be removed.' });
			return result;
		}
		this.dialogClose();
		if (zettel.parentKey) this.go(zettel.parentKey, { isHistory: false });
		return result;
	}

	// the reason a connection asked in the dialog cannot be written ('' when it can): the other
	// zettel exists and is another one, and a containment closes no cycle
	connectCheck(model) {
		const dialog = this.dialog;
		if (dialog?.kind !== 'connect') return '';
		const target = zettelGet(model, dialog.targetKey);
		if (!target) return 'Choose the zettel to connect to.';
		if (target.key === this.zettelKey) return 'A zettel is not connected to itself.';
		if (dialog.type === 'contain') return zettelContainCycleText(model, this.zettelKey, target.key);
		if (dialog.type === 'containedBy') return zettelContainCycleText(model, target.key, this.zettelKey);
		if (dialog.labelKind === 'zettel' && !zettelGet(model, dialog.labelKey)) return 'Choose the zettel the connection is labelled by.';
		if (dialog.labelKind === 'object' && !dialog.labelRef.trim()) return 'Write the reference of the object (frontend:…).';
		return '';
	}

	// the connection asked, written into the frontmatter of the zettel shown (checked first)
	async connectRun(service, model, { editStore } = {}) {
		const dialog = this.dialog;
		const reason = this.connectCheck(model);
		if (reason) {
			this.dialogChange({ message: reason });
			return { code: -1, message: reason };
		}
		const label = dialog.labelKind === 'text' ? { kind: 'text', text: dialog.labelText.trim() } : dialog.labelKind === 'zettel' ? { kind: 'zettel', key: dialog.labelKey } : dialog.labelKind === 'object' ? { kind: 'object', ref: dialog.labelRef.trim() } : null;
		this.dialogChange({ isBusy: true });
		const result = await zettelMetaWrite(service, this.zettelKey, (text) => zettelConnectionAddMeta(text, { type: dialog.type, to: dialog.targetKey, label, isDirected: dialog.isDirected }), `connection to ${dialog.targetKey}`, editStore);
		if (result.code !== 0) {
			this.dialogChange({ isBusy: false, message: result.message || 'The connection could not be written.' });
			return result;
		}
		this.dialogClose();
		return result;
	}

	// a connection the zettel shown wrote, taken out of its frontmatter
	async connectionRemoveRun(service, connection, { editStore } = {}) {
		this.dialogChange({ isBusy: true });
		const result = await zettelMetaWrite(service, this.zettelKey, (text) => zettelConnectionRemoveMeta(text, connection), `connection to ${connection.to} removed`, editStore);
		this.dialogChange({ isBusy: false, message: result.code === 0 ? '' : result.message || 'The connection could not be removed.' });
		return result;
	}

	// ---------- notes (while the document of the block is edited) ----------

	noteAddPlaceSet(target, place) {
		this.noteAdd = { target, place, isBusy: false, message: '' };
	}

	// a new note on a zettel: a document of the object in the partition of notes, with a first
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

// the frontmatter of a zettel changed and written: its text as the object holds it now, changed
// by `change`, written back; the edit layer, when it holds the document, reads it again so its
// next block edit starts from this text
async function zettelMetaWrite(service, key, change, note, editStore) {
	if (!service?.isEditable) return { code: -1, message: service?.editUnavailableReason || 'The object cannot be written here.' };
	const read = service.assetTextGet(key);
	if (read.status !== 'done') return { code: -1, message: read.message || 'The zettel is not read yet.' };
	const result = await service.assetWrite(key, change(read.text), note);
	if (result?.code === 0) {
		const docPath = service.docPathGet(key);
		if (docPath && editStore?.docEditByPath?.[docPath]) void editStore.docEditEnsure(docPath);
	}
	return result ?? { code: -1, message: 'no answer' };
}

// the partition what the reader writes goes to: the one named "note" when the type declares
// it, else the default (doc/README.md#partitions)
export function notePartitionOf(service) {
	const list = service?.partitionList ?? [];
	return (list.find((partition) => partition.id === 'note') ?? list.find((partition) => partition.isDefault) ?? list[0])?.id;
}
