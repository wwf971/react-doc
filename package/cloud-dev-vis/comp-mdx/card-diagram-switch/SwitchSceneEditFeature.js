import { switchPathLast } from './SwitchData.js';
import { switchRefIs, switchRefSplit } from './SwitchRef.js';
import { sceneKeyOf } from './SwitchSceneEditTree.js';

// The switch layer as a feature of the visual editor (card-diagram-flexible-switch.md#the-switch-layer-as-a-feature-of-the-editor):
// while a diagram is edited for a block session (config.sceneEdit: SwitchSceneEdit.jsx), the scenes
// of the block are within reach of the canvas. Everything it changes is the diagram on the canvas,
// through DiagramEditStore.changeApply (the canvas's history); the scenes themselves are the block
// session's. It answers the generic hooks of a session (DiagramVisualEdit.jsx):
//
//   cardSectionListGet     a node or a line naming a scene: the section Scene of its card (Opens,
//                          Shows, the view it shows), and Edit that scene
//   createActionListGet    on the canvas: Link to a scene, Embed a scene, New scene linked from here;
//                          on a node or a line with a link: Open its scene
//   dropAccept, drop       a row of the tree of scenes dropped on the canvas: a link to it (Alt: embedded)
//   focusClear             something selected on the canvas: the focus of the panel lets go
//   editorAttach           the editor, for what the panel asks of the canvas (sceneEdit.canvasApi)
export const SWITCH_SCENE_FEATURE_ID = 'scene-switch';
export const SWITCH_SCENE_DRAG_TYPE = 'application/x-doc-switch-scene';
const SCENE_EMBED_SIZE = { width: 480, height: 340 };

function idNextOf(prefix, itemList) {
	let index = 1;
	while (itemList.some(item => item.id === `${prefix}-${index}`)) index += 1;
	return `${prefix}-${index}`;
}

export class SwitchSceneEditSession {
	id = SWITCH_SCENE_FEATURE_ID;
	isOn = true;
	editorGet = () => null;

	constructor({ store, sceneEdit }) {
		this.store = store;
		this.sceneEdit = sceneEdit;
		this.api = { sceneRefPlace: (ref, options) => this.sceneRefPlace(ref, options), select: what => this.select(what) };
	}

	editorAttach(editorGet) {
		this.editorGet = editorGet;
		this.sceneEdit.canvasApiSet(this.api);
		// a reference opened in another scene: its node selected once the canvas is there
		const select = this.sceneEdit.selectNextTake();
		if (select) requestAnimationFrame(() => this.select(select));
	}

	dispose() { if (this.sceneEdit.canvasApi === this.api) this.sceneEdit.canvasApiSet(null); }

	focusClear() { this.sceneEdit.focusClear(); }

	select(what) {
		const editor = this.editorGet();
		if (!editor || !what) return;
		if (what.nodeId && this.store.nodeGet(what.nodeId)) editor.select(what.nodeId);
		else if (what.connectionId && this.store.connectionGet(what.connectionId)) editor.selectConnection(what.connectionId);
	}

	labelOf(path) { return this.sceneEdit.treeModel.itemGet(sceneKeyOf(path))?.label ?? switchPathLast(path); }

	// a link to a scene (ref: a path, maybe @view), or the scene embedded in a card, placed on the
	// canvas (where it was asked, else in its middle), selected
	sceneRefPlace(ref, { isEmbed = false, viewId = '', position } = {}) {
		const editor = this.editorGet();
		if (!editor || editor.isLocked) return null;
		const { path } = switchRefSplit(ref);
		const at = position ?? editor.canvas.current?.centerGet?.() ?? { x: 0, y: 0 };
		const point = { x: Math.round(at.x), y: Math.round(at.y) };
		const label = this.labelOf(path);
		const node = isEmbed
			? { id: idNextOf('embed', this.store.nodes), renderer: { type: 'scene-embed' }, position: point, size: SCENE_EMBED_SIZE, data: { scene: path, ...(viewId ? { view: viewId } : {}), title: label }, handles: [{ id: 'in', direction: 'in', anchor: { side: 'left' } }, { id: 'out', direction: 'out', anchor: { side: 'right' } }] }
			: { id: idNextOf('link', this.store.nodes), renderer: { type: 'scene-link' }, position: point, link: ref, data: { title: label, icon: 'arrow-right-left', tone: 'teal' } };
		let isChanged = false;
		editor.change(() => {
			isChanged = this.store.changeApply((documentNext) => {
				if (!documentNext.has('nodes')) documentNext.set('nodes', documentNext.createNode([]));
				documentNext.addIn(['nodes'], documentNext.createNode(node));
			});
		});
		if (isChanged) editor.select(node.id);
		return isChanged ? node.id : null;
	}

	// ---------- the edit card of a node or a line naming a scene ----------

	refSet(target, where, value) {
		const editor = this.editorGet();
		if (!editor) return false;
		let isChanged = false;
		editor.change(() => {
			isChanged = this.store.changeApply((documentNext) => {
				const base = target.kind === 'node' ? this.store.nodePathGet(target.nodeId) : ['connections', this.store.connections.findIndex(connection => connection.id === target.connectionId)];
				const at = [...base, ...where];
				if (value === '' || value === null || value === undefined) { if (documentNext.hasIn(at)) documentNext.deleteIn(at); } else documentNext.setIn(at, value);
			});
		});
		return isChanged;
	}

	cardSectionListGet(target) {
		const thing = target.kind === 'node' ? this.store.nodeGet(target.nodeId) : target.kind === 'line' ? this.store.connectionGet(target.connectionId) : null;
		if (!thing) return [];
		const isEmbed = target.kind === 'node' && thing.renderer?.type === 'scene-embed';
		const isLink = switchRefIs(thing.link) || (target.kind === 'node' && thing.renderer?.type === 'scene-link');
		if (!isEmbed && !isLink) return [];
		const choiceList = this.sceneEdit.scenePathChoiceList;
		const choiceOf = (value, isViewOffered) => {
			const list = choiceList.filter(choice => isViewOffered || !choice.viewId);
			const values = list.map(choice => choice.value);
			if (value && !values.includes(value)) values.unshift(value);
			return { values, valueLabels: { ...Object.fromEntries(list.map(choice => [choice.value, choice.label])), ...(value && !list.some(choice => choice.value === value) ? { [value]: `${value} (no such scene)` } : {}) } };
		};
		const propertyList = [];
		const refText = isEmbed ? thing.data?.scene : thing.link;
		const { path } = switchRefSplit(refText ?? '');
		const isMissing = Boolean(refText) && !this.sceneEdit.treeModel.itemGet(sceneKeyOf(path)) && !this.sceneEdit.treeModel.itemGet(this.sceneEdit.keyOfPath(path));
		if (isLink) {
			const choice = choiceOf(thing.link ?? '', true);
			propertyList.push({ id: 'link', label: 'Opens', kind: 'enum', value: thing.link ?? '', values: choice.values, valueLabels: choice.valueLabels, isSearchable: true, set: value => this.refSet(target, ['link'], value) });
		}
		if (isEmbed) {
			const choice = choiceOf(thing.data?.scene ?? '', false);
			propertyList.push({ id: 'scene', label: 'Shows', kind: 'enum', value: thing.data?.scene ?? '', values: choice.values, valueLabels: choice.valueLabels, isSearchable: true, set: value => this.refSet(target, ['data', 'scene'], value) });
			const viewIdList = this.sceneEdit.treeModel.itemGet(sceneKeyOf(path))?.viewIdList ?? [];
			if (viewIdList.length) propertyList.push({ id: 'view', label: 'Its view', kind: 'enum', value: thing.data?.view ?? '', values: ['', ...viewIdList], valueLabels: { '': 'As its rules say' }, set: value => this.refSet(target, ['data', 'view'], value || null) });
		}
		return [{
			id: 'scene', label: 'Scene', propertyList,
			note: isMissing ? `No scene ${path} in the block: it was removed or moved. Choose another.` : '',
			actionList: [{ id: 'scene-open', label: 'Edit that scene', isDisabled: !refText || isMissing || this.sceneEdit.target?.path === path, reason: isMissing ? 'It names no scene.' : 'It is the scene on the canvas.', act: () => this.sceneEdit.focusSet(sceneKeyOf(path), { isOpen: true }) }],
		}];
	}

	// ---------- the panel of a double-click and of a right-click ----------

	sceneSearchState(id, label, choose) {
		return {
			id, label, placeholder: 'Find a scene by its words or its path',
			search: (text) => {
				const wordList = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
				const list = this.sceneEdit.scenePathChoiceList.filter(choice => !choice.viewId && wordList.every(word => choice.label.toLowerCase().includes(word)));
				return { entryList: list.slice(0, 60).map(choice => ({ id: choice.value, label: choice.title, description: choice.value })), note: list.length > 60 ? `${list.length - 60} more: type more words.` : '' };
			},
			choose: (entry) => { choose(entry.id); },
		};
	}

	createActionListGet(target, editor) {
		if (editor.isLocked) return [];
		if (target.kind === 'canvas') {
			const position = target.position;
			const sceneEdit = this.sceneEdit;
			return [
				{ id: 'scene-link', label: 'Link to a scene…', description: 'A pill opening a scene of the block', keywordList: ['link', 'scene', 'go'], start: () => this.sceneSearchState('scene-link', 'Link to', path => this.sceneRefPlace(path, { position })) },
				{ id: 'scene-embed', label: 'Embed a scene…', description: 'A card showing a scene of the block', keywordList: ['embed', 'scene', 'card'], start: () => this.sceneSearchState('scene-embed', 'Embed', path => this.sceneRefPlace(path, { isEmbed: true, position })) },
				{ id: 'scene-new-linked', label: 'New scene, linked from here', description: 'A scene below this one, and a link to it here', keywordList: ['new', 'scene', 'child'], isDisabled: !sceneEdit.target, reason: 'No scene is on the canvas.', start: () => {
					const pathParent = sceneEdit.target.path;
					// the link first (the canvas's history), then the scene (the block's): the commit of the
					// canvas comes with the new scene, which then opens
					const pathNew = sceneEdit.scenePathNextOf(pathParent);
					this.sceneRefPlace(pathNew, { position });
					sceneEdit.sceneCreate(pathParent);
				} },
			];
		}
		const thing = target.kind === 'node' ? this.store.nodeGet(target.nodeId) : target.kind === 'line' ? this.store.connectionGet(target.connectionId) : null;
		const refText = thing ? (switchRefIs(thing.link) ? thing.link : thing.renderer?.type === 'scene-embed' ? thing.data?.scene : null) : null;
		if (!refText) return [];
		const { path } = switchRefSplit(refText);
		return [{ id: 'scene-open', label: 'Open its scene', description: path, isDisabled: this.sceneEdit.target?.path === path, reason: 'It is the scene on the canvas.', start: () => { this.sceneEdit.focusSet(sceneKeyOf(path), { isOpen: true }); } }];
	}

	// ---------- a row of the tree of scenes dropped on the canvas ----------

	dropAccept(dataTransfer) { return Array.from(dataTransfer?.types ?? []).includes(SWITCH_SCENE_DRAG_TYPE); }

	drop(dataTransfer, position, editor, { isAlt = false } = {}) {
		const key = dataTransfer.getData(SWITCH_SCENE_DRAG_TYPE);
		const item = this.sceneEdit.treeModel.itemGet(key);
		if (!item || !editor) return;
		if (item.kind === 'view') this.sceneRefPlace(isAlt ? item.path : `${item.path}@${item.viewId}`, { isEmbed: isAlt, viewId: item.viewId, position });
		else this.sceneRefPlace(item.path, { isEmbed: isAlt, position });
	}
}

// the feature, as the switch registry lists it (switchRegistryBuild): a session only for an editor of
// a block session
export const switchSceneEditFeature = {
	id: SWITCH_SCENE_FEATURE_ID,
	label: 'Scenes of a block',
	editCreate({ store, config }) {
		return config?.sceneEdit ? new SwitchSceneEditSession({ store, sceneEdit: config.sceneEdit }) : null;
	},
};
