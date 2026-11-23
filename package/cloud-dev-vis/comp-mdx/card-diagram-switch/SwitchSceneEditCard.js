import { switchPathIsWithin, switchPathLast, switchPathNormalize, switchPathParent } from './SwitchData.js';
import { switchMountFromText } from './SwitchMount.js';
import { SCENE_TREE_BLOCK_KEY, sceneKeyOf, sceneTreeKeyRead, viewKeyOf } from './SwitchSceneEditTree.js';

// The edit cards of the tab Scenes (card-diagram-flexible-switch.md#the-scenes-tab): the properties
// of what is focused in the tree of a block of scenes, in the model of the edit card of the framework
// (DiagramEditCardModel.js: { title, kindLabel, tabList, segmentList, view: { type: detail,
// sectionList } }), and what can be done with it: the actions of its card are those of its menu (a
// right-click on its row). Every value goes through a command of the block session
// (SwitchSceneEditStore.js), one step of its history, a typed value grouped by its key.
const REF_LIST_SHOWN_MAX = 8;
const REF_KIND_WORD = { link: 'links to it', embed: 'embeds it', stack: 'stacks it', alias: 'keeps its scroll', tabs: 'arranges it in tabs' };

const modelOf = (title, kindLabel, sectionList) => ({ title, kindLabel, tabList: [], tabId: null, segmentList: [], view: { type: 'detail', sectionList } });
const text = (id, label, value, set, extra = {}) => ({ id, label, kind: 'text', value: value ?? '', set, ...extra });
const bool = (id, label, value, set, extra = {}) => ({ id, label, kind: 'bool', value: Boolean(value), set, ...extra });

// where a scene of the block can be put under: the top level, every scene and folder not below it
function parentChoiceOf(store, path) {
	const pathList = new Set();
	for (const scenePath of store.spec?.sceneByPath.keys() ?? []) {
		let at = scenePath;
		while (at) { pathList.add(at); at = switchPathParent(at); }
	}
	const values = ['', ...[...pathList].filter(item => !switchPathIsWithin(item, path) && !store.mountList.some(mount => switchPathIsWithin(item, mount.path))).sort()];
	return { values, valueLabels: Object.fromEntries(values.map(value => [value, value || 'The top level'])) };
}

// the actions of an item, for its card and for its menu: [{ id, label, kind?, isDisabled?, reason?, act }]
// ctx: { canvas } the editor of the scene on the canvas (a link or an embedded scene placed there)
export function sceneActionListBuild(store, key, ctx = {}) {
	const { kind, path, viewId } = sceneTreeKeyRead(key);
	const item = store.treeModel.itemGet(key);
	if (!item) return [];
	const list = [];
	const canvas = ctx.canvas ?? store.canvasApi;
	const isOnCanvas = store.editedKey === key;
	const targetKey = store.targetKeyOf(key);
	const linkActions = () => {
		const reason = !canvas ? 'No diagram is open on the canvas.' : store.target && switchPathNormalize(store.target.path) === path ? 'It is the scene on the canvas.' : '';
		list.push({ id: 'link', label: 'Link to it from the scene edited', isDisabled: Boolean(reason), reason, act: () => canvas.sceneRefPlace(viewId ? `${path}@${viewId}` : path, { isEmbed: false }) });
		list.push({ id: 'embed', label: 'Embed it in the scene edited', isDisabled: Boolean(reason), reason, act: () => canvas.sceneRefPlace(path, { isEmbed: true, viewId }) });
	};
	if (kind === 'block') {
		list.push({ id: 'scene-new', label: 'New scene at the top', act: () => store.sceneCreate('') });
		list.push({ id: 'mount-new', label: 'New mount (scenes held in an asset item)', act: () => ctx.mountAsk?.() });
		return list;
	}
	if (kind === 'folder') {
		list.push({ id: 'scene-make', label: 'Make it a scene', act: () => store.folderSceneCreate(path) });
		list.push({ id: 'scene-new', label: 'New scene below', act: () => store.sceneCreate(path) });
		return list;
	}
	if (kind === 'mount') {
		list.push({ id: 'mount-remove', label: 'Remove the mount', kind: 'danger', act: () => store.mountRemove(path) });
		return list;
	}
	if (item.isMounted) {
		linkActions();
		return list;
	}
	if (kind === 'tab') {
		list.push({ id: 'tab-remove', label: 'Remove this tab', kind: 'danger', act: () => store.tabMemberRemove(item.owner, item.memberId) });
		return list;
	}
	if (kind === 'view') {
		const scene = store.sceneEntryOf(path)?.scene;
		const viewCount = scene?.viewList?.length ?? 0;
		const index = store.viewIndexOf(store.sceneEntryOf(path), viewId);
		list.push({ id: 'open', label: 'Edit it on the canvas', isDisabled: isOnCanvas, reason: 'It is on the canvas.', act: () => store.focusSet(key, { isOpen: true }) });
		linkActions();
		list.push({ id: 'view-duplicate', label: 'Duplicate it', act: () => store.viewAdd(path, { from: viewId }) });
		list.push({ id: 'view-up', label: 'Move up', isDisabled: index <= 0, reason: 'It is the first view.', act: () => store.viewMove(path, viewId, -1) });
		list.push({ id: 'view-down', label: 'Move down', isDisabled: index >= viewCount - 1, reason: 'It is the last view.', act: () => store.viewMove(path, viewId, 1) });
		if (viewCount === 1) list.push({ id: 'view-collapse', label: 'Back to one diagram', act: () => store.viewListCollapse(path) });
		list.push({ id: 'view-remove', label: 'Remove the view', kind: 'danger', isDisabled: viewCount <= 1, reason: 'A scene of views keeps one.', act: () => store.viewRemove(path, viewId) });
		return list;
	}
	// a scene of the block
	const scene = store.sceneEntryOf(path)?.scene;
	const belowCount = [...(store.spec?.sceneByPath.keys() ?? [])].filter(other => other !== path && switchPathIsWithin(other, path)).length;
	list.push({ id: 'open', label: 'Edit it on the canvas', isDisabled: isOnCanvas || !targetKey, reason: isOnCanvas ? 'It is on the canvas.' : 'It arranges another scene in tabs: edit that scene.', act: () => store.focusSet(key, { isOpen: true }) });
	if (scene?.tabs) list.push({ id: 'tabs-of', label: `Edit ${switchPathNormalize(scene.tabs.of)}, which it arranges`, act: () => store.focusSet(sceneKeyOf(switchPathNormalize(scene.tabs.of)), { isOpen: true }) });
	linkActions();
	list.push({ id: 'scene-new', label: 'New scene below', act: () => store.sceneCreate(path) });
	if (!scene?.tabs) list.push({ id: 'view-new', label: scene?.viewList ? 'New view' : 'New view (its diagram becomes the view main)', act: () => store.viewAdd(path) });
	list.push({ id: 'root', label: 'Make it the first scene', isDisabled: store.treeIndex.root === path, reason: 'It is the first scene.', act: () => store.rootSet(path) });
	list.push({ id: 'scene-up', label: 'Move up', act: () => store.sceneMove(path, -1) });
	list.push({ id: 'scene-down', label: 'Move down', act: () => store.sceneMove(path, 1) });
	list.push({ id: 'scene-remove', label: 'Remove the scene (what is below it stays)', kind: 'danger', act: () => store.sceneRemove(path) });
	if (belowCount) list.push({ id: 'scene-remove-all', label: `Remove it with the ${belowCount} ${belowCount === 1 ? 'scene' : 'scenes'} below`, kind: 'danger', act: () => store.sceneRemove(path, { isBelowToo: true }) });
	return list;
}

// the references naming a scene (or one of its views), as actions opening where each one is
function namedBySection(store, path, viewId = '') {
	const refList = (store.refIndex.inByPath.get(path) ?? []).filter(ref => !viewId || ref.suffix.startsWith(`@${viewId}`) || ref.kind === 'embed');
	if (!refList.length) return { id: 'named-by', label: 'Named by', propertyList: [], actionList: [], note: viewId ? 'Nothing of the block names this view.' : 'No scene of the block names it: it is reached by its path alone.' };
	return {
		id: 'named-by', label: `Named by (${refList.length})`, propertyList: [],
		note: refList.length > REF_LIST_SHOWN_MAX ? `The first ${REF_LIST_SHOWN_MAX} are listed; the graph beside shows them all.` : '',
		actionList: refList.slice(0, REF_LIST_SHOWN_MAX).map((ref, index) => ({
			id: `ref-${index}`,
			label: `${store.treeModel.itemGet(sceneKeyOf(ref.fromPath))?.label ?? ref.fromPath}${ref.fromViewId ? ` @${ref.fromViewId}` : ''} ${REF_KIND_WORD[ref.kind] ?? ref.kind}`,
			act: () => store.refOpen(ref),
		})),
	};
}

function actionSection(store, key, ctx) {
	return { id: 'actions', label: '', propertyList: [], actionList: sceneActionListBuild(store, key, ctx).map(action => ({ ...action, act: () => action.act() })), note: '' };
}

// the card of what is focused (or, nothing focused, of what is on the canvas)
export function sceneCardModelBuild(store, key, ctx = {}) {
	const item = store.treeModel.itemGet(key);
	if (!item) return null;
	const { kind, path, viewId } = sceneTreeKeyRead(key);
	const typed = field => `scene:${key}/${field}`;
	if (kind === 'block') {
		const value = store.valueBase;
		const sceneList = [...(store.spec?.sceneByPath.keys() ?? [])];
		const featureList = Array.isArray(value.featureList) ? value.featureList : [];
		const transition = value.transition ?? {};
		const number = (id, label, at, current, extra = {}) => ({ id, label, kind: 'number', value: current ?? '', step: extra.step ?? 1, min: extra.min, set: (next) => { const amount = Number(next); return store.blockSet(at, Number.isFinite(amount) && String(next) !== '' ? amount : null, { groupKey: typed(at) }); } });
		return modelOf(item.label, 'Block of scenes', [
			{ id: 'block', label: 'Block', actionList: [], note: '', propertyList: [
				text('title', 'Title', value.title, next => store.blockSet('title', String(next).trim(), { groupKey: typed('title') }), { placeholder: 'Scenes' }),
				{ id: 'root', label: 'First scene', kind: 'enum', value: store.treeIndex.root, values: sceneList, valueLabels: Object.fromEntries(sceneList.map(scenePath => [scenePath, `${store.treeModel.itemGet(sceneKeyOf(scenePath))?.label ?? scenePath} — ${scenePath}`])), isSearchable: true, set: next => store.rootSet(next) },
				number('height', 'Height', 'height', value.height, { min: 240 }),
				number('depthMax', 'Depth drawn', 'depthMax', value.depthMax, { min: 0 }),
			] },
			{ id: 'editing', label: 'Editing', actionList: [], note: 'The tool bar and the panel of the parametric canvas, offered for every scene edited.', propertyList: [
				bool('parametric', 'Parametric canvas', featureList.includes('parametric-canvas'), next => store.blockSet('featureList', next ? [...new Set([...featureList, 'parametric-canvas'])] : featureList.filter(id => id !== 'parametric-canvas'))),
			] },
			{ id: 'transition', label: 'Transition (seconds)', actionList: [], note: '', propertyList: [
				number('secondPortal', 'Portal', 'transition.secondPortal', transition.secondPortal, { step: 0.05, min: 0 }),
				number('secondMorph', 'Morph', 'transition.secondMorph', transition.secondMorph, { step: 0.05, min: 0 }),
				number('secondCamera', 'Camera', 'transition.secondCamera', transition.secondCamera, { step: 0.05, min: 0 }),
				number('secondScroll', 'Scroll', 'transition.secondScroll', transition.secondScroll, { step: 0.05, min: 0 }),
			] },
			actionSection(store, key, ctx),
		]);
	}
	if (kind === 'folder') {
		return modelOf(item.label, 'Folder', [
			{ id: 'folder', label: path, propertyList: [], actionList: [], note: 'A path with scenes below it and no scene of its own: the path bar goes up past it.' },
			actionSection(store, key, ctx),
		]);
	}
	if (kind === 'mount') {
		const mount = store.mountList.find(entry => entry.path === path);
		const read = store.mounted?.entryList?.find(entry => entry.mount.path === path);
		return modelOf(item.label, 'Mount', [
			{ id: 'mount', label: 'Mount', actionList: [], note: read?.message || `Its scenes are held in the asset item ${switchMountFromText(mount ?? {})} and shown here under ${path}, read-only: they are edited where they are held.`, propertyList: [
				text('label', 'Label', mount?.label, next => store.mountSet(path, 'label', String(next).trim(), { groupKey: typed('label') }), { placeholder: switchPathLast(path) }),
				text('segment', 'Path segment', switchPathLast(path), next => store.scenePathSet(path, `${switchPathParent(path)}/${String(next).trim()}`)),
				text('store', 'Store', mount?.from.asset.store, next => store.mountSet(path, 'from.asset.store', String(next).trim(), { groupKey: typed('store') })),
				text('name', 'Item', mount?.from.asset.name || mount?.from.asset.itemId, next => store.mountSet(path, mount?.from.asset.name ? 'from.asset.name' : 'from.asset.itemId', String(next).trim(), { groupKey: typed('name') })),
				text('sourcePath', 'Part shown', mount?.sourcePath === '/' ? '' : mount?.sourcePath, next => store.mountSet(path, 'sourcePath', String(next).trim(), { groupKey: typed('sourcePath') }), { placeholder: 'All of it (/)' }),
			] },
			actionSection(store, key, ctx),
		]);
	}
	if (item.isMounted) {
		const at = store.mounted?.provider?.mountOf?.(path);
		return modelOf(item.label, kind === 'view' ? 'View (mounted)' : 'Scene (mounted)', [
			{ id: 'mounted', label: kind === 'view' ? `${path} @${viewId}` : path, propertyList: [], actionList: [], note: `Held by ${switchMountFromText(at?.mount ?? {})} (its path there: ${at?.sourcePath ?? path}): edited where it is held. It can be linked to and embedded like any scene.` },
			actionSection(store, key, ctx),
		]);
	}
	if (kind === 'tab') {
		const owner = store.sceneEntryOf(item.owner)?.scene;
		const member = owner?.tabs?.memberList?.find(entry => entry.id === item.memberId);
		return modelOf(item.label, 'Tab', [
			{ id: 'tab', label: 'Tab', actionList: [], note: `A member of the tabs of ${item.owner}: the node ${item.memberId} of ${switchPathNormalize(owner?.tabs?.of ?? '')}, shown alone at ${item.path}.`, propertyList: [
				text('label', 'Label', member?.label, next => store.tabMemberSet(item.owner, item.memberId, 'label', String(next).trim(), { groupKey: typed('label') }), { placeholder: item.memberId }),
				{ id: 'tone', label: 'Tone', kind: 'enum', value: member?.tone ?? '', values: ['', 'blue', 'teal', 'green', 'amber', 'red', 'violet', 'slate'], valueLabels: { '': 'None' }, set: next => store.tabMemberSet(item.owner, item.memberId, 'tone', next || null) },
			] },
			actionSection(store, key, ctx),
		]);
	}
	if (kind === 'view') {
		const entry = store.sceneEntryOf(path);
		const view = entry?.scene.viewList?.find(one => one.id === viewId);
		if (!view) return null;
		const isDefault = entry.scene.viewDefault === viewId;
		const isHover = entry.scene.viewHover === viewId;
		const rulesNote = Array.isArray(entry.scene.viewDefault) || Array.isArray(entry.scene.viewHover) ? 'The scene chooses its views by rules written in its text; they are kept as they are.' : '';
		return modelOf(view.label ?? viewId, 'View', [
			{ id: 'view', label: `${path} @${viewId}`, actionList: [], note: '', propertyList: [
				text('id', 'Id', viewId, next => store.viewIdSet(path, viewId, next)),
				text('label', 'Label', view.label, next => store.viewSet(path, viewId, 'label', String(next).trim(), { groupKey: typed('label') }), { placeholder: viewId }),
				text('title', 'Title', view.title, next => store.viewSet(path, viewId, 'title', String(next).trim(), { groupKey: typed('title') }), { placeholder: 'The title of the scene' }),
				text('description', 'Description', view.description, next => store.viewSet(path, viewId, 'description', String(next), { groupKey: typed('description') }), { isMultiline: true }),
			] },
			{ id: 'shown', label: 'Shown', actionList: [], note: rulesNote, propertyList: [
				bool('isDefault', 'By default', isDefault, next => store.viewChoiceSet(path, 'viewDefault', next ? viewId : null), { isReadOnly: Array.isArray(entry.scene.viewDefault) }),
				bool('isHover', 'On hover', isHover, next => store.viewChoiceSet(path, 'viewHover', next ? viewId : null), { isReadOnly: Array.isArray(entry.scene.viewHover) }),
				bool('isAvailableFocused', 'When focused', view.isAvailableFocused !== false, next => store.viewSet(path, viewId, 'isAvailableFocused', Boolean(next))),
				bool('isAvailableEmbedded', 'When embedded', view.isAvailableEmbedded !== false, next => store.viewSet(path, viewId, 'isAvailableEmbedded', Boolean(next))),
				bool('isFrameHiddenEmbedded', 'Alone in its card', view.isFrameHiddenEmbedded, next => store.viewSet(path, viewId, 'isFrameHiddenEmbedded', Boolean(next))),
			] },
			namedBySection(store, path, viewId),
			actionSection(store, key, ctx),
		]);
	}
	// a scene of the block
	const entry = store.sceneEntryOf(path);
	if (!entry) return null;
	const { scene } = entry;
	const last = switchPathLast(path);
	const parentChoice = parentChoiceOf(store, path);
	const sectionList = [
		{ id: 'scene', label: 'Scene', actionList: [], note: '', propertyList: [
			text('label', 'Label', scene.label, next => store.sceneSet(path, 'label', String(next).trim(), { groupKey: typed('label') }), { placeholder: last }),
			text('title', 'Title', scene.title, next => store.sceneSet(path, 'title', String(next).trim(), { groupKey: typed('title') }), { placeholder: 'Its label' }),
			bool('isTitleHidden', 'Title hidden', scene.isTitleHidden, next => store.sceneSet(path, 'isTitleHidden', Boolean(next))),
			text('description', 'Description', scene.description, next => store.sceneSet(path, 'description', String(next), { groupKey: typed('description') }), { isMultiline: true }),
		] },
		{ id: 'place', label: 'Path', actionList: [], note: 'Renaming or moving it moves what is below it, and rewrites every reference to them in the block.', propertyList: [
			text('segment', 'Segment', last, next => store.scenePathSet(path, `${switchPathParent(path)}/${String(next).trim()}`)),
			{ id: 'under', label: 'Under', kind: 'enum', value: switchPathParent(path), values: parentChoice.values, valueLabels: parentChoice.valueLabels, isSearchable: true, set: next => store.scenePathSet(path, `${next}/${last}`) },
		] },
	];
	if (scene.viewList) {
		const idList = scene.viewList.map(view => view.id);
		const labels = Object.fromEntries(scene.viewList.map(view => [view.id, view.label ?? view.id]));
		const isRules = Array.isArray(scene.viewDefault) || Array.isArray(scene.viewHover);
		sectionList.push({ id: 'views', label: `Views (${idList.length})`, actionList: [], note: isRules ? 'Its views are chosen by rules written in its text; they are kept as they are.' : '', propertyList: [
			...(Array.isArray(scene.viewDefault) ? [] : [{ id: 'viewDefault', label: 'Default view', kind: 'enum', value: scene.viewDefault ?? '', values: ['', ...idList], valueLabels: { '': 'The first', ...labels }, set: next => store.viewChoiceSet(path, 'viewDefault', next) }]),
			...(Array.isArray(scene.viewHover) ? [] : [{ id: 'viewHover', label: 'Hover view', kind: 'enum', value: scene.viewHover ?? '', values: ['', ...idList], valueLabels: { '': 'None', ...labels }, set: next => store.viewChoiceSet(path, 'viewHover', next) }]),
			{ id: 'viewSwitcherLayout', label: 'Switcher', kind: 'enum', value: scene.viewSwitcherLayout ?? 'menu', values: ['menu', 'tabs'], valueLabels: { menu: 'A menu', tabs: 'Tabs' }, set: next => store.sceneSet(path, 'viewSwitcherLayout', next === 'menu' ? null : next) },
			bool('isViewSearchable', 'Views searched', scene.isViewSearchable, next => store.sceneSet(path, 'isViewSearchable', Boolean(next))),
		] });
	}
	if (scene.tabs) {
		const diagramPathList = [...(store.spec?.sceneByPath.values() ?? [])].filter(desc => desc.diagram).map(desc => desc.path);
		sectionList.push({ id: 'tabs', label: 'Tabs', actionList: [], note: `It arranges ${scene.tabs.memberList?.length ?? 0} nodes of another scene in tabs: each tab is a scene of its own below it.`, propertyList: [
			{ id: 'of', label: 'Of', kind: 'enum', value: switchPathNormalize(scene.tabs.of), values: diagramPathList, isSearchable: true, set: next => store.tabsSet(path, 'of', next) },
		] });
	}
	sectionList.push(namedBySection(store, path));
	sectionList.push(actionSection(store, key, ctx));
	return modelOf(scene.label ?? last, scene.tabs ? 'Scene of tabs' : 'Scene', sectionList);
}

export { SCENE_TREE_BLOCK_KEY, sceneKeyOf, viewKeyOf };
