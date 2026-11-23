import { makeAutoObservable, observable } from 'mobx';
import { yamlDocumentParse, yamlParse, yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { EditHistory } from '../card-diagram/DiagramEditHistory.js';
import { DiagramPanelStore } from '../card-diagram/DiagramPanelStore.js';
import { DiagramPanelTreeStore } from '../card-diagram/DiagramPanelTreeStore.js';
import { GRAPH_CAMERA_REST, panelGraphZoomClamp } from '../card-diagram/DiagramPanelGraph.jsx';
import { switchDocNormalize, switchPathIsWithin, switchPathLast, switchPathNormalize, switchPathParent, switchPathViewRead, switchPresentationBuild, switchViewResolve } from './SwitchData.js';
import { switchPathPrefixMove } from './SwitchRef.js';
import { SCENE_TREE_BLOCK_KEY, sceneKeyOf, sceneTreeKeyRead, switchDocPathMove, switchDocViewIdMove, switchSceneRefIndexBuild, switchSceneTreeIndexBuild, switchSceneTreeModelBuild, viewKeyOf } from './SwitchSceneEditTree.js';

// The visual edit mode of a block of scenes, the **block session**
// (card-diagram-flexible-switch.md#editing-a-block-of-scenes): the document of scenes drafted as a
// whole, its scenes, views and mounts organized from the tab Scenes of the panel, and the diagram of
// one scene (or one view) at a time on the canvas, in the visual editor of the framework.
//
//   sourceBase   the document as it stands: every command of the panel, and every commit of the
//                canvas, writes it; the history of the block is made of its texts
//   draftByKey   the diagram on the canvas as the editor reports it, by target, not yet committed
//   target       { key, path, view, label, location }: what the canvas edits. key: the path, @view
//                for a view; location: where its diagram is in the document
//   focusKey     an item of the tree of scenes selected (a scene, a view, the block, a folder, a
//                mount, a tab): its card is the properties column's. One selection with the canvas's:
//                selecting on one side lets go of the other
//   editToken    the editor opens again when it changes: another target, or its diagram rewritten
//                by a command or an undo of the block
//
// **One history for the block.** The canvas keeps its own while a scene is open; what it changed
// becomes one step of the block's history when it is committed: before any command of the panel,
// before another target opens, before an undo of the block. So the block's history is linear over
// the whole document, and an undo of it puts the document back exactly.
export class SwitchSceneEditStore {
	sourceInitial = '';
	sourceBase = '';
	targetKey = '';
	draftByKey = new Map();
	message = '';
	focusKey = null;
	editToken = 0;
	menu = null;
	// the scenes mounted from elsewhere, as the block read them (CardDiagramSwitch.jsx: useSwitchMounts)
	mounted = null;
	graph = { camera: null };
	// the last report of the editor (its save target), on which the reports of the block are made
	reportBase = { lang: 'yaml' };
	// what the scene on the canvas offers the panel (SwitchSceneEditFeature.js): sceneRefPlace(path,
	// { isEmbed, viewId, position? }) a link or an embedded scene placed there; select(what)
	canvasApi = null;
	// what the editor opened next selects ({ nodeId } or { connectionId }): a reference opened
	selectNext = null;

	constructor(source, { onReport } = {}) {
		this.sourceInitial = String(source ?? '');
		this.sourceBase = this.sourceInitial;
		this.onReport = onReport ?? null;
		this.history = new EditHistory({ isSame: (a, b) => a.source === b.source });
		this.panel = new DiagramPanelStore();
		this.tree = new DiagramPanelTreeStore();
		// what reads (called while drawing) is no action: an action reads untracked
		const readList = ['scenePathNextOf', 'textOf', 'draftDiagramOf', 'sceneEntryOf', 'viewIndexOf', 'targetKeyOf', 'focusFallbackOf', 'mountIndexOf', 'keyOfPath', 'isBlockKey', 'reportOf'];
		makeAutoObservable(this, { sourceInitial: false, history: false, panel: false, tree: false, onReport: false, mounted: observable.ref, menu: observable.ref, reportBase: observable.ref, canvasApi: observable.ref, selectNext: observable.ref, ...Object.fromEntries(readList.map(name => [name, false])) }, { autoBind: true });
		this.targetKey = this.targetList[0]?.key ?? '';
		// a document the viewport cannot read cannot be edited visually: its text can
		this.message = this.specRead.message || (this.targetList.length === 0 ? 'This block has no scene with a diagram of its own to edit.' : '');
		this.isReadable = !this.message;
	}

	// ---------- the document ----------

	get valueBase() {
		try { return yamlParse(this.sourceBase) ?? {}; } catch { return {}; }
	}

	// the document as the viewport reads it; its reason when it does not read
	get specRead() {
		try { return { spec: switchDocNormalize(this.sourceBase), message: '' }; } catch (error) { return { spec: null, message: String(error?.message ?? error) }; }
	}

	get spec() { return this.specRead.spec; }
	get defaults() { return this.valueBase.defaults; }
	// the feature layers the document offers its scenes while they are edited
	get featureList() { return this.spec?.featureList ?? []; }
	get mountList() { return this.spec?.mountList ?? []; }

	// every scene with a diagram, every view with one, in the order of the document
	get targetList() {
		const value = this.valueBase;
		const sceneByPath = this.spec?.sceneByPath;
		return (Array.isArray(value.sceneList) ? value.sceneList : []).flatMap((scene, sceneIndex) => {
			if (!scene || typeof scene.path !== 'string') return [];
			const path = switchPathNormalize(scene.path);
			const label = sceneByPath?.get(path)?.label ?? path;
			if (scene.diagram) return [{ key: path, path, view: null, label: `${path}`, title: label, diagram: scene.diagram, location: ['sceneList', sceneIndex, 'diagram'] }];
			return (scene.viewList ?? []).map((view, viewIndex) => ({ key: `${path}@${view.id}`, path, view: view.id, label: `${path} @${view.label ?? view.id}`, title: label, diagram: view.diagram, location: ['sceneList', sceneIndex, 'viewList', viewIndex, 'diagram'] }));
		});
	}

	get target() { return this.targetList.find((item) => item.key === this.targetKey) ?? null; }

	// the diagram of a target as the editor reads it: version 1, with the defaults of the document
	// where the diagram has none of its own (they are taken away again when it is written back)
	textOf(target) {
		if (this.draftByKey.has(target.key)) return this.draftByKey.get(target.key);
		const { diagram } = target;
		return yamlStringify({ version: 1, ...(this.defaults && !diagram.defaults ? { defaults: this.defaults } : {}), ...diagram });
	}

	// the target a path names, as the session opens on it (where the reader was: config.edit.at): the
	// scene, or the view the path names, or the first view of the scene; false when it names none
	// (a scene shown from a mount is edited where it is held)
	targetAtSet(path) {
		const key = String(path ?? '');
		const found = this.targetList.find((item) => item.key === key) ?? this.targetList.find((item) => item.path === switchPathViewRead(key).path);
		if (!found) return false;
		this.targetKey = found.key;
		return true;
	}

	// a target chosen by its key: what was done to the one on the canvas is committed first
	targetSet(key) {
		if (!this.targetList.some((item) => item.key === key) || key === this.targetKey) return;
		this.canvasCommit();
		this.targetKey = key;
		this.editToken += 1;
	}

	draftSet(key, raw) {
		this.draftByKey.set(key, String(raw ?? ''));
	}

	// a diagram drafted, as it would be written into its place: no version, the document's defaults
	// taken away again when the diagram did not have its own
	draftDiagramOf(target, raw) {
		const { version: _version, ...diagram } = yamlParse(raw) ?? {};
		if (!target.diagram.defaults && JSON.stringify(diagram.defaults) === JSON.stringify(this.defaults)) delete diagram.defaults;
		return diagram;
	}

	// the whole document again, every draft written into the place of its diagram
	get sourceDraft() {
		if (this.draftByKey.size === 0) return this.sourceBase;
		const document = yamlDocumentParse(this.sourceBase);
		for (const [key, raw] of this.draftByKey) {
			const target = this.targetList.find((item) => item.key === key);
			if (!target) continue;
			document.setIn(target.location, document.createNode(this.draftDiagramOf(target, raw)));
		}
		return document.toString();
	}

	// the document with the drafts, as values: what the tree and the relations read (only the
	// diagrams drafted are read again, not the whole text)
	get value() {
		let value = this.valueBase;
		for (const [key, raw] of this.draftByKey) {
			const target = this.targetList.find((item) => item.key === key);
			if (!target) continue;
			try { value = valueSetIn(value, target.location, this.draftDiagramOf(target, raw)); } catch { /* a draft not read: the diagram as it was */ }
		}
		return value;
	}

	get isDirty() { return this.sourceDraft !== this.sourceInitial; }

	// what the page is told: the document, not the diagram of one scene
	reportOf(report) {
		return { ...this.reportBase, ...(report ?? {}), raw: this.sourceDraft, lang: 'yaml', isDirty: this.isDirty };
	}

	mountedSet(mounted) { this.mounted = mounted ?? null; }
	// the last report of the editor (its save target): the reports of the block's commands are made on it
	reportBaseSet(report) { if (report) this.reportBase = { ...report }; }

	// ---------- the history of the block ----------

	// what the canvas changed since the last commit becomes one step of the block's history
	canvasCommit() {
		if (this.draftByKey.size === 0) return;
		const before = this.sourceBase;
		const after = this.sourceDraft;
		const label = `Drawing in ${this.target?.label ?? 'a scene'}`;
		this.draftByKey.clear();
		if (after === before) return;
		this.history.record({ source: before, label }, { source: after, label });
		this.sourceBase = after;
	}

	// a command of the panel: the change made on the yaml document (comments kept), refused with its
	// reason when it throws or the result does not read; one step of the history (typed values grouped
	// by groupKey). change(document, value) may answer what the command made (a key to focus)
	// targetKeyOf(key): where the target on the canvas went (a command moving paths says it)
	docChange(change, { label, groupKey = null, targetKeyOf = null } = {}) {
		this.canvasCommit();
		const before = this.sourceBase;
		let made;
		let next;
		try {
			const document = yamlDocumentParse(before);
			made = change(document, yamlParse(before) ?? {});
			next = document.toString();
			switchDocNormalize(next);
		} catch (error) {
			this.message = String(error?.message ?? error);
			return null;
		}
		this.message = '';
		if (next === before) return made ?? true;
		this.history.record({ source: before, label }, { source: next, label }, groupKey);
		this.sourceSet(next, { targetKeyOf });
		return made ?? true;
	}

	// the document replaced (a command, an undo, a redo): what pointed at something gone is resolved
	// again, the editor opened again when its diagram changed, the page told
	sourceSet(source, { targetKeyOf = null } = {}) {
		const targetBefore = this.target;
		const textBefore = targetBefore ? this.textOf(targetBefore) : '';
		this.draftByKey.clear();
		this.sourceBase = source;
		const targetKeyMoved = targetBefore && targetKeyOf ? targetKeyOf(targetBefore.key) : null;
		if (targetKeyMoved && targetKeyMoved !== this.targetKey && this.targetList.some(item => item.key === targetKeyMoved)) {
			this.targetKey = targetKeyMoved;
			if (this.textOf(this.target) !== textBefore) this.editToken += 1;
		} else if (!this.target) {
			// the target gone (removed, moved): the scene above it, else the first
			const pathBefore = targetBefore?.path ?? '';
			const near = this.targetList.find(item => item.path === pathBefore) ?? this.targetList.find(item => switchPathIsWithin(pathBefore, item.path)) ?? this.targetList[0];
			this.targetKey = near?.key ?? '';
			this.editToken += 1;
		} else if (this.textOf(this.target) !== textBefore) this.editToken += 1;
		if (this.focusKey && !this.treeModel.itemGet(this.focusKey)) this.focusKey = this.focusFallbackOf(this.focusKey);
		this.onReport?.();
	}

	// an item gone: the nearest item above it that is still there
	focusFallbackOf(key) {
		let { path } = sceneTreeKeyRead(key);
		while (path && path !== '/') {
			const keyAbove = this.treeIndex.keyOfPath(path);
			if (this.treeModel.itemGet(keyAbove)) return keyAbove;
			path = switchPathParent(path);
		}
		return null;
	}

	get undoLabel() { return this.history.past.at(-1)?.stateBefore.label ?? ''; }
	get redoLabel() { return this.history.future.at(-1)?.label ?? ''; }
	get isUndoAvailable() { return this.draftByKey.size > 0 || this.history.isUndoAvailable; }
	get isRedoAvailable() { return this.history.isRedoAvailable; }

	undo() {
		this.canvasCommit();
		const label = this.undoLabel;
		const state = this.history.undo({ source: this.sourceBase, label });
		if (!state) return false;
		this.sourceSet(state.source);
		return true;
	}

	redo() {
		const label = this.redoLabel;
		const state = this.history.redo({ source: this.sourceBase, label });
		if (!state) return false;
		this.sourceSet(state.source);
		return true;
	}

	// ---------- the tree, the relations ----------

	get treeIndex() { return switchSceneTreeIndexBuild(this.value, this.mountList); }
	get treeModel() { return switchSceneTreeModelBuild(this.treeIndex, this.mounted?.provider ?? null); }
	get refIndex() { return switchSceneRefIndexBuild(this.value); }
	// the key of the item on the canvas in the tree
	get editedKey() { const target = this.target; return target ? (target.view ? viewKeyOf(target.path, target.view) : sceneKeyOf(target.path)) : null; }
	// what the tab shows as selected: its focus, else (nothing selected on the canvas either) the
	// item on the canvas
	get selectedKey() { return this.focusKey; }
	get relationKey() { return this.focusKey ?? this.editedKey; }

	get graphKey() { return this.relationKey ?? ''; }
	get graphCamera() { return this.graph.camera?.key === this.graphKey ? this.graph.camera : { key: this.graphKey, ...GRAPH_CAMERA_REST }; }
	graphCameraSet(camera) { this.graph.camera = { ...camera, key: this.graphKey, zoom: panelGraphZoomClamp(camera.zoom) }; }
	graphCameraReset() { this.graph.camera = null; }

	// a scene of the document: { scene, index }
	sceneEntryOf(path) {
		const normalized = switchPathNormalize(path);
		const index = (this.valueBase.sceneList ?? []).findIndex(scene => switchPathNormalize(scene?.path) === normalized);
		return index < 0 ? null : { scene: this.valueBase.sceneList[index], index };
	}

	// the target an item opens: a scene with a diagram, its view shown focused when it has views, a view
	targetKeyOf(key) {
		const { kind, path, viewId } = sceneTreeKeyRead(key);
		if (kind === 'view') return this.targetList.some(item => item.key === `${path}@${viewId}`) ? `${path}@${viewId}` : null;
		if (kind !== 'scene') return null;
		if (this.targetList.some(item => item.key === path)) return path;
		const desc = this.spec?.sceneByPath.get(path);
		if (!desc?.viewList) return null;
		return `${path}@${switchViewResolve(desc, switchPresentationBuild(path))}`;
	}

	// an item selected in the tree or the graph. isOpen: the canvas goes to it, when it can be opened
	focusSet(key, { isOpen = false } = {}) {
		this.focusKey = key;
		if (isOpen) {
			const targetKey = this.targetKeyOf(key);
			if (targetKey) this.targetSet(targetKey);
		}
		this.menu = null;
	}

	focusClear() { this.focusKey = null; }

	canvasApiSet(api) { this.canvasApi = api; }

	// a reference opened where it stands: the scene (or view) holding it on the canvas, the node or the
	// line holding it selected there
	refOpen(ref) {
		const targetKey = ref.fromViewId ? `${ref.fromPath}@${ref.fromViewId}` : ref.fromPath;
		const select = ref.nodeId ? { nodeId: ref.nodeId } : ref.connectionId ? { connectionId: ref.connectionId } : null;
		this.focusKey = null;
		this.menu = null;
		if (targetKey === this.targetKey) { if (select) this.canvasApi?.select(select); return; }
		this.selectNext = select;
		this.targetSet(targetKey);
	}

	// taken by the editor that opens
	selectNextTake() { const select = this.selectNext; this.selectNext = null; return select; }
	menuOpen(menu) { this.menu = menu; }
	menuClose() { this.menu = null; }

	// ---------- commands: the block ----------

	blockSet(key, value, { groupKey = null } = {}) {
		return this.docChange((document) => {
			const path = key.split('.');
			if (value === '' || value === null || value === undefined || (key === 'featureList' && Array.isArray(value) && !value.length)) {
				if (document.hasIn(path)) document.deleteIn(path);
			} else document.setIn(path, document.createNode(value));
		}, { label: `Block: ${key}`, groupKey });
	}

	rootSet(path) {
		return this.docChange((document) => { document.set('root', switchPathNormalize(path)); }, { label: `First scene: ${path}` });
	}

	// ---------- commands: scenes ----------

	// the scenes a reference may name, own and mounted, with their views: [{ value, label, title,
	// path, viewId }] (value: the path, @view for a view). A mount of very many is listed up to a bound
	get scenePathChoiceList() {
		const list = [];
		const model = this.treeModel;
		const visit = (key) => {
			if (list.length > 4000) return;
			const item = model.itemGet(key);
			if (item?.kind === 'scene') list.push({ value: item.path, label: `${item.label} — ${item.path}`, title: item.label, path: item.path, viewId: '' });
			if (item?.kind === 'view') list.push({ value: `${item.path}@${item.viewId}`, label: `${model.itemGet(sceneKeyOf(item.path))?.label ?? item.path} @${item.label} — ${item.path}@${item.viewId}`, title: `${item.label}`, path: item.path, viewId: item.viewId });
			for (const child of model.childKeyListGet(key)) visit(child);
		};
		visit(SCENE_TREE_BLOCK_KEY);
		return list;
	}

	// the path a new scene below a path takes: the next free segment scene-N
	scenePathNextOf(parentPath = '') {
		const parent = parentPath && parentPath !== '/' ? switchPathNormalize(parentPath) : '';
		const pathTaken = new Set([...(this.spec?.sceneByPath.keys() ?? []), ...this.mountList.map(mount => mount.path)]);
		let number = 1;
		while (pathTaken.has(`${parent}/scene-${number}`)) number += 1;
		return `${parent}/scene-${number}`;
	}

	// a new scene below a path (the top level for '' or '/'), made at once: the next free segment
	// scene-N, the label Scene N, an empty diagram; placed after what stands below that path
	sceneCreate(parentPath = '') {
		const parent = parentPath && parentPath !== '/' ? switchPathNormalize(parentPath) : '';
		if (parent && this.mountList.some(mount => switchPathIsWithin(parent, mount.path))) {
			this.message = `${parent} is in a mount: its scenes are held elsewhere.`;
			return null;
		}
		const path = this.scenePathNextOf(parent);
		const number = Number(switchPathLast(path).slice('scene-'.length));
		const made = this.docChange((document, value) => {
			const list = value.sceneList ?? [];
			let at = list.length;
			list.forEach((scene, index) => { if (parent && switchPathIsWithin(switchPathNormalize(scene.path), parent)) at = index + 1; });
			document.get('sceneList').items.splice(at, 0, document.createNode({ path, label: `Scene ${number}`, diagram: { nodes: [] } }));
			return path;
		}, { label: `New scene ${path}` });
		if (!made) return null;
		this.tree.reveal(sceneKeyOf(path), this.treeModel);
		this.focusSet(sceneKeyOf(path), { isOpen: true });
		return path;
	}

	// a folder (a path with scenes below it) made a scene of its own
	folderSceneCreate(path) {
		const normalized = switchPathNormalize(path);
		const made = this.docChange((document, value) => {
			const list = value.sceneList ?? [];
			const at = list.findIndex(scene => switchPathIsWithin(switchPathNormalize(scene.path), normalized));
			document.get('sceneList').items.splice(at < 0 ? list.length : at, 0, document.createNode({ path: normalized, label: switchPathLast(normalized), diagram: { nodes: [] } }));
			return normalized;
		}, { label: `New scene ${normalized}` });
		if (made) this.focusSet(sceneKeyOf(normalized), { isOpen: true });
		return made;
	}

	// a value of a scene: label, title, description, isTitleHidden, viewDefault, viewHover,
	// viewSwitcherLayout, isViewSearchable. Empty, false or null takes the key away
	sceneSet(path, key, value, { groupKey = null } = {}) {
		const entry = this.sceneEntryOf(path);
		if (!entry) return null;
		return this.docChange((document) => {
			const at = ['sceneList', entry.index, key];
			if (value === '' || value === null || value === undefined || value === false) { if (document.hasIn(at)) document.deleteIn(at); } else document.setIn(at, document.createNode(value));
		}, { label: `${path}: ${key}`, groupKey });
	}

	// a scene moved to another path (renamed, or put under another): what is below it moves with it,
	// and every reference to them in every scene of the block is written again
	scenePathSet(path, pathNew) {
		const from = switchPathNormalize(path);
		const to = switchPathNormalize(pathNew);
		if (from === to) return true;
		const made = this.docChange((document, value) => {
			if (to === '/' || /[@#]/.test(pathNew)) throw new Error(`${pathNew} is no path for a scene.`);
			if (switchPathIsWithin(to, from)) throw new Error(`${from} cannot go below itself.`);
			const pathList = (value.sceneList ?? []).map(scene => switchPathNormalize(scene.path));
			const kept = new Set(pathList.filter(item => !switchPathIsWithin(item, from)));
			const taken = pathList.filter(item => switchPathIsWithin(item, from)).map(item => switchPathPrefixMove(item, from, to)).find(item => kept.has(item));
			if (taken) throw new Error(`${taken} is a scene already.`);
			const mount = this.mountList.find(item => switchPathIsWithin(to, item.path) && !switchPathIsWithin(item.path, from));
			if (mount) throw new Error(`${to} is in the mount ${mount.path}: its paths are its source's.`);
			switchDocPathMove(document, value, from, to);
			return to;
		}, { label: `Move ${from} to ${to}`, targetKeyOf: (key) => { const [path, view] = key.split('@'); const moved = switchPathPrefixMove(path, from, to); return moved ? `${moved}${view ? `@${view}` : ''}` : key; } });
		if (!made) return null;
		const keyNew = this.treeIndex.keyOfPath(to);
		this.focusKey = keyNew;
		this.tree.reveal(keyNew, this.treeModel);
		return made;
	}

	// a scene taken away alone: what is below it stays (its folder too); the references naming it stay
	// and say they name nothing. isBelowToo: with everything below its path
	sceneRemove(path, { isBelowToo = false } = {}) {
		const from = switchPathNormalize(path);
		return this.docChange((document, value) => {
			const indexList = (value.sceneList ?? []).map((scene, index) => [switchPathNormalize(scene.path), index]).filter(([item]) => (isBelowToo ? switchPathIsWithin(item, from) : item === from)).map(([, index]) => index);
			if (indexList.length >= (value.sceneList ?? []).length) throw new Error('A block keeps at least one scene.');
			for (const index of indexList.reverse()) document.deleteIn(['sceneList', index]);
			if (value.root && (isBelowToo ? switchPathIsWithin(switchPathNormalize(value.root), from) : switchPathNormalize(value.root) === from)) document.delete('root');
		}, { label: isBelowToo ? `Remove ${from} and what is below it` : `Remove ${from}` });
	}

	// a scene, with what is below it, moved one place among the scenes beside it
	sceneMove(path, step) {
		const from = switchPathNormalize(path);
		const parent = switchPathParent(from);
		return this.docChange((document, value) => {
			const list = value.sceneList ?? [];
			const pathList = list.map(scene => switchPathNormalize(scene.path));
			// the scenes beside it, by the first place of what stands below each
			const siblingOf = item => {
				const chain = item.split('/').filter(Boolean);
				const depth = (parent ? parent.split('/').filter(Boolean).length : 0) + 1;
				return chain.length >= depth && switchPathParent(`/${chain.slice(0, depth).join('/')}`) === parent ? `/${chain.slice(0, depth).join('/')}` : null;
			};
			const siblingList = [...new Set(pathList.map(siblingOf).filter(Boolean))];
			const index = siblingList.indexOf(from);
			const other = siblingList[index + step];
			if (index < 0 || !other) throw new Error(step < 0 ? `${from} is the first.` : `${from} is the last.`);
			const blockOf = at => pathList.map((item, itemIndex) => (switchPathIsWithin(item, at) ? itemIndex : -1)).filter(itemIndex => itemIndex >= 0);
			const moving = blockOf(from);
			const nodeList = moving.map(itemIndex => document.get('sceneList').items[itemIndex]);
			for (const itemIndex of moving.slice().reverse()) document.get('sceneList').items.splice(itemIndex, 1);
			const pathListAfter = pathList.filter((_, itemIndex) => !moving.includes(itemIndex));
			const otherIndexList = pathListAfter.map((item, itemIndex) => (switchPathIsWithin(item, other) ? itemIndex : -1)).filter(itemIndex => itemIndex >= 0);
			const at = step < 0 ? otherIndexList[0] : otherIndexList.at(-1) + 1;
			document.get('sceneList').items.splice(at, 0, ...nodeList);
		}, { label: `Move ${from} ${step < 0 ? 'up' : 'down'}` });
	}

	// ---------- commands: views ----------

	// a new view of a scene: empty, or a copy of a view (node ids kept, so a switch between them is a
	// morph). The first new view of a scene with one diagram makes it a scene of views: its diagram
	// the view main, the new one the second
	viewAdd(path, { from = null } = {}) {
		const entry = this.sceneEntryOf(path);
		if (!entry) return null;
		const scenePath = switchPathNormalize(path);
		const made = this.docChange((document) => {
			const { scene, index } = entry;
			if (scene.tabs) throw new Error(`${scenePath} arranges another scene in tabs: it has no views of its own.`);
			const viewList = scene.viewList ?? [{ id: 'main', label: 'Main', diagram: scene.diagram ?? { nodes: [] } }];
			let number = viewList.length;
			while (viewList.some(view => view.id === `view-${number}`)) number += 1;
			const id = `view-${number}`;
			const source = from ? viewList.find(view => view.id === from) : null;
			const view = { id, label: source ? `${source.label ?? source.id} (copy)` : `View ${number}`, diagram: source ? structuredClone(source.diagram) : { nodes: [] } };
			if (!scene.viewList) {
				document.deleteIn(['sceneList', index, 'diagram']);
				document.setIn(['sceneList', index, 'viewList'], document.createNode([viewList[0], view]));
			} else document.addIn(['sceneList', index, 'viewList'], document.createNode(view));
			return id;
		}, { label: from ? `Duplicate the view ${from} of ${scenePath}` : `New view of ${scenePath}` });
		if (!made) return null;
		this.tree.reveal(viewKeyOf(scenePath, made), this.treeModel);
		this.focusSet(viewKeyOf(scenePath, made), { isOpen: true });
		return made;
	}

	viewIndexOf(entry, viewId) { return (entry?.scene.viewList ?? []).findIndex(view => view.id === viewId); }

	// a view taken away: never the last (a scene of views keeps one); the choices naming it go with it
	viewRemove(path, viewId) {
		const entry = this.sceneEntryOf(path);
		const viewIndex = this.viewIndexOf(entry, viewId);
		if (viewIndex < 0) return null;
		return this.docChange((document) => {
			const { scene, index } = entry;
			if (scene.viewList.length <= 1) throw new Error(`The view ${viewId} is the last of ${scene.path}: a scene of views keeps one (Back to one diagram makes it a scene of one diagram).`);
			document.deleteIn(['sceneList', index, 'viewList', viewIndex]);
			for (const field of ['viewDefault', 'viewHover']) {
				const choice = scene[field];
				if (choice === viewId) document.deleteIn(['sceneList', index, field]);
				else if (Array.isArray(choice)) {
					const kept = choice.filter(rule => rule?.view !== viewId);
					if (kept.length) document.setIn(['sceneList', index, field], document.createNode(kept)); else document.deleteIn(['sceneList', index, field]);
				}
			}
		}, { label: `Remove the view ${viewId} of ${path}` });
	}

	// the one view left made the diagram of the scene again
	viewListCollapse(path) {
		const entry = this.sceneEntryOf(path);
		if (!entry?.scene.viewList) return null;
		return this.docChange((document) => {
			const { scene, index } = entry;
			if (scene.viewList.length !== 1) throw new Error(`${scene.path} has ${scene.viewList.length} views: only the last one left can become its diagram.`);
			document.setIn(['sceneList', index, 'diagram'], document.createNode(scene.viewList[0].diagram ?? { nodes: [] }));
			for (const key of ['viewList', 'viewDefault', 'viewHover', 'viewSwitcherLayout', 'isViewSearchable', 'isViewSwitcherHidden', 'isViewSwitcherHiddenEmbedded', 'isViewSwitcherHiddenFocused']) if (document.hasIn(['sceneList', index, key])) document.deleteIn(['sceneList', index, key]);
		}, { label: `${path}: back to one diagram` });
	}

	// a value of a view: label, title, description, isAvailableEmbedded, isAvailableFocused,
	// isFrameHiddenEmbedded. The availabilities are true when not written
	viewSet(path, viewId, key, value, { groupKey = null } = {}) {
		const entry = this.sceneEntryOf(path);
		const viewIndex = this.viewIndexOf(entry, viewId);
		if (viewIndex < 0) return null;
		const isDefaultTrue = key === 'isAvailableEmbedded' || key === 'isAvailableFocused';
		return this.docChange((document) => {
			const at = ['sceneList', entry.index, 'viewList', viewIndex, key];
			const isAbsent = value === '' || value === null || value === undefined || (isDefaultTrue ? value === true : value === false);
			if (isAbsent) { if (document.hasIn(at)) document.deleteIn(at); } else document.setIn(at, document.createNode(value));
		}, { label: `${path} @${viewId}: ${key}`, groupKey });
	}

	// a view renamed: the choices and every reference naming it follow
	viewIdSet(path, viewId, viewIdNew) {
		const id = String(viewIdNew ?? '').trim();
		const entry = this.sceneEntryOf(path);
		if (!entry || id === viewId) return true;
		const made = this.docChange((document, value) => {
			if (!/^[^\s/@#]+$/.test(id)) throw new Error('The id of a view has no spaces, /, @ or #.');
			if (entry.scene.viewList?.some(view => view.id === id)) throw new Error(`${path} has a view ${id} already.`);
			switchDocViewIdMove(document, value, path, viewId, id);
			return id;
		}, { label: `Rename the view ${viewId} of ${path}`, targetKeyOf: key => (key === `${switchPathNormalize(path)}@${viewId}` ? `${switchPathNormalize(path)}@${id}` : key) });
		if (made) this.focusKey = viewKeyOf(switchPathNormalize(path), id);
		return made;
	}

	// a view shown by default (when it is focused), or while a pointer rests on a card embedding it
	viewChoiceSet(path, field, viewId) {
		return this.sceneSet(path, field, viewId || null);
	}

	viewMove(path, viewId, step) {
		const entry = this.sceneEntryOf(path);
		const viewIndex = this.viewIndexOf(entry, viewId);
		if (viewIndex < 0) return null;
		return this.docChange((document) => {
			const items = document.getIn(['sceneList', entry.index, 'viewList']).items;
			const to = viewIndex + step;
			if (to < 0 || to >= items.length) throw new Error(step < 0 ? `The view ${viewId} is the first.` : `The view ${viewId} is the last.`);
			const [node] = items.splice(viewIndex, 1);
			items.splice(to, 0, node);
		}, { label: `Move the view ${viewId} ${step < 0 ? 'up' : 'down'}` });
	}

	// ---------- commands: mounts ----------

	// a mount: the scenes of a document held in an asset item, under a new path of the top level
	mountAdd({ store = 'local', name, path } = {}) {
		const itemName = String(name ?? '').trim();
		if (!itemName) { this.message = 'A mount names the asset item holding its scenes.'; return null; }
		const pathTaken = new Set([...(this.spec?.sceneByPath.keys() ?? []), ...this.mountList.map(mount => mount.path)]);
		let number = 1;
		while (pathTaken.has(`/mount-${number}`)) number += 1;
		const pathNew = switchPathNormalize(path || `/mount-${number}`);
		const made = this.docChange((document) => {
			const mount = { path: pathNew, label: itemName, from: { asset: { store, name: itemName } } };
			if (document.has('mountList')) document.addIn(['mountList'], document.createNode(mount)); else document.set('mountList', document.createNode([mount]));
			return pathNew;
		}, { label: `New mount ${pathNew}` });
		if (made) this.focusSet(this.treeIndex.keyOfPath(pathNew));
		return made;
	}

	mountIndexOf(path) { return (this.valueBase.mountList ?? []).findIndex(mount => switchPathNormalize(mount?.path) === switchPathNormalize(path)); }

	// a mount taken away: the references to its scenes stay, naming nothing
	mountRemove(path) {
		const index = this.mountIndexOf(path);
		if (index < 0) return null;
		return this.docChange((document, value) => {
			if ((value.mountList ?? []).length === 1) document.delete('mountList'); else document.deleteIn(['mountList', index]);
		}, { label: `Remove the mount ${path}` });
	}

	// a value of a mount: label, sourcePath, from.asset.store, from.asset.name. Its path moves with
	// scenePathSet, so the references to its scenes follow
	mountSet(path, key, value, { groupKey = null } = {}) {
		const index = this.mountIndexOf(path);
		if (index < 0) return null;
		return this.docChange((document) => {
			const at = ['mountList', index, ...key.split('.')];
			if (value === '' || value === null || value === undefined) { if (document.hasIn(at) && key !== 'from.asset.name') document.deleteIn(at); } else document.setIn(at, value);
		}, { label: `Mount ${path}: ${key}`, groupKey });
	}

	// ---------- commands: tabs ----------

	tabsSet(path, key, value) {
		const entry = this.sceneEntryOf(path);
		if (!entry?.scene.tabs) return null;
		return this.docChange((document) => { document.setIn(['sceneList', entry.index, 'tabs', key], document.createNode(value)); }, { label: `${path}: tabs ${key}` });
	}

	tabMemberSet(path, memberId, key, value, { groupKey = null } = {}) {
		const entry = this.sceneEntryOf(path);
		const memberIndex = (entry?.scene.tabs?.memberList ?? []).findIndex(member => member.id === memberId);
		if (memberIndex < 0) return null;
		return this.docChange((document) => {
			const at = ['sceneList', entry.index, 'tabs', 'memberList', memberIndex, key];
			if (value === '' || value === null || value === undefined) { if (document.hasIn(at)) document.deleteIn(at); } else document.setIn(at, value);
		}, { label: `${path}: tab ${memberId}`, groupKey });
	}

	tabMemberRemove(path, memberId) {
		const entry = this.sceneEntryOf(path);
		const memberIndex = (entry?.scene.tabs?.memberList ?? []).findIndex(member => member.id === memberId);
		if (memberIndex < 0) return null;
		return this.docChange((document) => {
			if (entry.scene.tabs.memberList.length <= 2) throw new Error(`The tabs of ${path} keep at least two members.`);
			document.deleteIn(['sceneList', entry.index, 'tabs', 'memberList', memberIndex]);
		}, { label: `${path}: remove the tab ${memberId}` });
	}

	// a key the tree names, for a reader: where it is
	keyOfPath(path) { return this.treeIndex.keyOfPath(switchPathNormalize(path)); }
	isBlockKey(key) { return key === SCENE_TREE_BLOCK_KEY; }
}

// a value with the value at location replaced: copies along the way, the rest shared
function valueSetIn(value, location, next) {
	if (!location.length) return next;
	const [key, ...rest] = location;
	const copy = Array.isArray(value) ? value.slice() : { ...value };
	copy[key] = valueSetIn(value?.[key], rest, next);
	return copy;
}
