import { switchPathChain, switchPathIsWithin, switchPathLast, switchPathNormalize, switchPathParent } from './SwitchData.js';
import { switchMountFromText } from './SwitchMount.js';
import { switchPathPrefixMove, switchRefListGet } from './SwitchRef.js';

// A block of scenes as a tree, and the references between its scenes
// (card-diagram-flexible-switch.md#the-scenes-tab). Pure: the tab Scenes draws what it answers
// (SwitchSceneEditPanel.jsx), the block session rewrites with it (SwitchSceneEditStore.js).
//
// The tree (keys stable across changes of the document):
//   block               block                     the document; its children: the top level
//   scene:{path}        scene                     a scene, own or mounted (isMounted); its children:
//                                                 its views, its tab members, then what is below its path
//   view:{path}@{id}    view                      a view of a scene of views
//   folder:{path}       folder                    a path with scenes below it and none of its own
//   mount:{path}        mount                     a mount; its children: the scenes its source has
//                                                 there (read lazily from the provider)
//   tab:{path}          tab                       a member of a scene of tabs (path: the scene it is)
// Children are in the order of the document (a folder where its first scene is; mounts after the
// own scenes).
export const SCENE_TREE_BLOCK_KEY = 'block';
export const sceneKeyOf = path => `scene:${path}`;
export const viewKeyOf = (path, viewId) => `view:${path}@${viewId}`;

// what a key names: { kind, path, viewId? }
export function sceneTreeKeyRead(key) {
	const text = String(key ?? '');
	if (text === SCENE_TREE_BLOCK_KEY) return { kind: 'block', path: '' };
	const index = text.indexOf(':');
	const kind = text.slice(0, index);
	const rest = text.slice(index + 1);
	if (kind === 'view') {
		const at = rest.lastIndexOf('@');
		return { kind, path: rest.slice(0, at), viewId: rest.slice(at + 1) };
	}
	return { kind, path: rest };
}

// the segment of a path beside a label, when it says something the label does not (Overview and
// overview say the same)
function segmentShownOf(label, segment) {
	return String(label).toLowerCase().replace(/\s+/g, '-') === String(segment).toLowerCase() ? '' : segment;
}

function sceneSummaryOf(scene) {
	if (scene.tabs) return `tabs of ${switchPathNormalize(scene.tabs.of)}`;
	if (scene.viewList) return `${scene.viewList.length} ${scene.viewList.length === 1 ? 'view' : 'views'}`;
	return '';
}

// the view ids a choice (viewDefault, viewHover) names: an id, or the views of its rules
function viewChoiceIdList(value) {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.map(rule => rule?.view).filter(Boolean);
	return [];
}

// the own part of the tree: everything the document says. value: the document (parsed, drafts
// applied); mountList: its mounts as read (switchMountRead)
export function switchSceneTreeIndexBuild(value, mountList = []) {
	const sceneList = Array.isArray(value?.sceneList) ? value.sceneList : [];
	const sceneByPath = new Map();
	sceneList.forEach((scene, index) => { if (scene && typeof scene.path === 'string') sceneByPath.set(switchPathNormalize(scene.path), { scene, index }); });
	const mountByPath = new Map(mountList.map(mount => [mount.path, mount]));
	// every path standing in the tree, with the order of the first scene at or below it
	const orderByPath = new Map();
	const pathAdd = (path, order) => {
		for (const at of switchPathChain(path)) orderByPath.set(at, Math.min(orderByPath.get(at) ?? Infinity, order));
	};
	for (const [path, { index }] of sceneByPath) pathAdd(path, index);
	mountList.forEach((mount, index) => pathAdd(mount.path, sceneList.length + index));
	const keyOfPath = path => (sceneByPath.has(path) ? sceneKeyOf(path) : mountByPath.has(path) ? `mount:${path}` : `folder:${path}`);
	const itemByKey = {};
	const childKeyListByKey = {};
	const parentKeyByKey = {};
	const childPathListByPath = new Map();
	for (const path of orderByPath.keys()) {
		const parent = switchPathParent(path);
		if (!childPathListByPath.has(parent)) childPathListByPath.set(parent, []);
		childPathListByPath.get(parent).push(path);
	}
	const childPathListOf = path => (childPathListByPath.get(path) ?? []).slice().sort((a, b) => orderByPath.get(a) - orderByPath.get(b));
	const add = (item, parentKey, childKeyList = []) => {
		itemByKey[item.key] = item;
		parentKeyByKey[item.key] = parentKey;
		childKeyListByKey[item.key] = childKeyList;
	};
	const pathItemAdd = (path, parentKey) => {
		const key = keyOfPath(path);
		const childKeyList = [];
		const scene = sceneByPath.get(path)?.scene;
		const mount = mountByPath.get(path);
		const last = switchPathLast(path);
		if (scene) {
			const label = String(scene.label ?? last);
			const defaultIdList = viewChoiceIdList(scene.viewDefault);
			const hoverIdList = viewChoiceIdList(scene.viewHover);
			add({ key, kind: 'scene', path, label, segment: segmentShownOf(label, last), summary: sceneSummaryOf(scene), isTabs: Boolean(scene.tabs), viewIdList: (scene.viewList ?? []).map(view => view.id), title: scene.title ?? '' }, parentKey, childKeyList);
			for (const view of scene.viewList ?? []) {
				const viewKey = viewKeyOf(path, view.id);
				const viewLabel = String(view.label ?? view.id);
				const markList = [];
				// a choice by rules (in its text) names views under conditions: said as such
				const isDefaultRule = Array.isArray(scene.viewDefault);
				if (isDefaultRule ? defaultIdList.includes(view.id) : scene.viewDefault === view.id) markList.push(isDefaultRule ? 'default by a rule' : 'default');
				if (hoverIdList.includes(view.id)) markList.push(Array.isArray(scene.viewHover) ? 'hover by a rule' : 'hover');
				add({ key: viewKey, kind: 'view', path, viewId: view.id, label: viewLabel, segment: segmentShownOf(viewLabel, view.id), summary: markList.join(' · ') }, key);
				childKeyList.push(viewKey);
			}
			for (const member of scene.tabs?.memberList ?? []) {
				const tabPath = `${path}/${member.id}`;
				const tabKey = `tab:${tabPath}`;
				add({ key: tabKey, kind: 'tab', path: tabPath, owner: path, memberId: member.id, label: String(member.label ?? member.id), segment: '', summary: '' }, key);
				childKeyList.push(tabKey);
			}
			// a mount at the path of an own scene (its cover): under the scene
			if (mount) {
				add({ key: `mount:${path}`, kind: 'mount', path, label: mount.label || last, segment: '', summary: switchMountFromText(mount), mount }, key);
				childKeyList.push(`mount:${path}`);
			}
		} else if (mount) {
			add({ key, kind: 'mount', path, label: mount.label || last, segment: '', summary: switchMountFromText(mount), mount }, parentKey, childKeyList);
		} else {
			add({ key, kind: 'folder', path, label: last, segment: '', summary: '' }, parentKey, childKeyList);
		}
		for (const child of childPathListOf(path)) {
			if (mount && !scene) continue;
			childKeyList.push(keyOfPath(child));
			pathItemAdd(child, key);
		}
	};
	const blockChildList = [];
	add({ key: SCENE_TREE_BLOCK_KEY, kind: 'block', path: '', label: String(value?.title ?? '') || 'Scenes', isNameDefault: !value?.title, segment: '', summary: `${sceneByPath.size} ${sceneByPath.size === 1 ? 'scene' : 'scenes'}${mountList.length ? ` · ${mountList.length} ${mountList.length === 1 ? 'mount' : 'mounts'}` : ''}` }, '', blockChildList);
	for (const path of childPathListOf('')) {
		blockChildList.push(keyOfPath(path));
		pathItemAdd(path, SCENE_TREE_BLOCK_KEY);
	}
	const root = switchPathNormalize(value?.root ?? sceneList[0]?.path ?? '/');
	return { itemByKey, childKeyListByKey, parentKeyByKey, sceneByPath, mountByPath, root, keyOfPath };
}

// the model of the tree (DiagramPanelTreeData.js): the own part from the index, the mounted part
// read lazily from the provider of the viewport (SwitchMount.js), kept while the model is
export function switchSceneTreeModelBuild(index, provider = null) {
	const mountedByKey = new Map();
	const mountedEntryOf = (key) => {
		if (mountedByKey.has(key)) return mountedByKey.get(key);
		let entry = null;
		const { kind, path, viewId } = sceneTreeKeyRead(key);
		const at = provider?.mountOf?.(path);
		if (at?.provider && (kind === 'scene' || kind === 'view')) {
			const desc = at.provider.sceneGet(at.sourcePath);
			if (desc && kind === 'scene') {
				const last = switchPathLast(path);
				const viewIdList = (desc.viewList ?? []).map(view => view.id);
				const childPathList = provider.childListGet(path).map(child => child.path);
				entry = {
					item: { key, kind: 'scene', path, label: desc.label ?? last, segment: segmentShownOf(desc.label ?? last, last), summary: viewIdList.length ? `${viewIdList.length} views` : '', isMounted: true, mountPath: at.mount.path, viewIdList },
					childKeyList: [...viewIdList.map(id => viewKeyOf(path, id)), ...childPathList.map(sceneKeyOf)],
				};
			} else if (desc && kind === 'view') {
				const view = desc.viewList?.find(item => item.id === viewId);
				if (view) entry = { item: { key, kind: 'view', path, viewId, label: view.label ?? viewId, segment: '', summary: '', isMounted: true, mountPath: at.mount.path }, childKeyList: [] };
			}
		}
		mountedByKey.set(key, entry);
		return entry;
	};
	const mountChildKeyList = (path) => {
		const at = provider?.mountOf?.(path);
		if (!at?.provider) return [];
		return provider.childListGet(path).map(child => sceneKeyOf(child.path));
	};
	return {
		index,
		provider,
		rootKeyList: [SCENE_TREE_BLOCK_KEY],
		itemGet: key => index.itemByKey[key] ?? mountedEntryOf(key)?.item ?? null,
		childKeyListGet: (key) => {
			if (key.startsWith('mount:')) return mountChildKeyList(key.slice(6));
			return index.childKeyListByKey[key] ?? mountedEntryOf(key)?.childKeyList ?? [];
		},
		parentKeyGet: (key) => {
			if (key in index.parentKeyByKey) return index.parentKeyByKey[key];
			const { kind, path } = sceneTreeKeyRead(key);
			if (kind === 'view') return sceneKeyOf(path);
			const at = provider?.mountOf?.(path);
			if (!at) return '';
			const parent = switchPathParent(path);
			return parent === at.mount.path || !switchPathIsWithin(parent, at.mount.path) ? `mount:${at.mount.path}` : sceneKeyOf(parent);
		},
		searchTextGet: (key) => {
			const item = index.itemByKey[key] ?? mountedEntryOf(key)?.item;
			return item ? `${item.label} ${item.path ?? ''} ${item.viewId ?? ''} ${item.summary ?? ''}` : '';
		},
		isExpandedDefault: key => key === SCENE_TREE_BLOCK_KEY,
	};
}

// the diagrams of the own scenes, each with where it is in the document:
// [{ path, viewId, diagram, location: ['sceneList', i, 'diagram'] | [..., 'viewList', j, 'diagram'] }]
export function switchDocDiagramListGet(value) {
	const list = [];
	(value?.sceneList ?? []).forEach((scene, sceneIndex) => {
		if (!scene || typeof scene.path !== 'string') return;
		const path = switchPathNormalize(scene.path);
		if (scene.diagram) list.push({ path, viewId: '', diagram: scene.diagram, location: ['sceneList', sceneIndex, 'diagram'] });
		(scene.viewList ?? []).forEach((view, viewIndex) => { if (view?.diagram) list.push({ path, viewId: view.id, diagram: view.diagram, location: ['sceneList', sceneIndex, 'viewList', viewIndex, 'diagram'] }); });
	});
	return list;
}

// every reference of the own scenes, from where to where: [{ kind, ref, path (the scene named),
// suffix, fromPath, fromViewId, nodeId?, nodeIndex?, connectionId?, connectionIndex?, where,
// location }], with the tabs of a scene (kind tabs) and the first scene of the block (kind root)
export function switchSceneRefListGet(value) {
	const list = [];
	for (const { path, viewId, diagram, location } of switchDocDiagramListGet(value)) {
		for (const ref of switchRefListGet(diagram)) list.push({ ...ref, fromPath: path, fromViewId: viewId, location });
	}
	(value?.sceneList ?? []).forEach((scene) => {
		if (scene?.tabs?.of) list.push({ kind: 'tabs', ref: scene.tabs.of, path: switchPathNormalize(scene.tabs.of), suffix: '', fromPath: switchPathNormalize(scene.path), fromViewId: '' });
	});
	return list;
}

// the references by the scene they name, and by the scene they are in
export function switchSceneRefIndexBuild(value) {
	const inByPath = new Map();
	const outByPath = new Map();
	for (const ref of switchSceneRefListGet(value)) {
		if (!inByPath.has(ref.path)) inByPath.set(ref.path, []);
		inByPath.get(ref.path).push(ref);
		if (!outByPath.has(ref.fromPath)) outByPath.set(ref.fromPath, []);
		outByPath.get(ref.fromPath).push(ref);
	}
	return { inByPath, outByPath };
}

// ---------- rewrites of a yaml document (comments kept) ----------

// a scene and everything below it moved from one path to another, in a yaml Document: the paths of
// the scenes and mounts, the tabs naming them, the first scene, and every reference of every own
// scene, keeping what follows a reference (@view, #item). value: the document as read (the same text)
export function switchDocPathMove(document, value, from, to) {
	const pathFrom = switchPathNormalize(from);
	const pathTo = switchPathNormalize(to);
	const moveOf = path => switchPathPrefixMove(path, pathFrom, pathTo);
	(value.sceneList ?? []).forEach((scene, index) => {
		const moved = moveOf(scene.path);
		if (moved) document.setIn(['sceneList', index, 'path'], moved);
		const tabsMoved = scene.tabs?.of ? moveOf(scene.tabs.of) : null;
		if (tabsMoved) document.setIn(['sceneList', index, 'tabs', 'of'], tabsMoved);
	});
	(value.mountList ?? []).forEach((mount, index) => {
		const moved = moveOf(mount.path);
		if (moved) document.setIn(['mountList', index, 'path'], moved);
	});
	if (value.root) {
		const moved = moveOf(value.root);
		if (moved) document.set('root', moved);
	}
	let count = 0;
	for (const ref of switchSceneRefListGet(value)) {
		if (!ref.location) continue;
		const moved = moveOf(ref.path);
		if (!moved) continue;
		const at = ref.nodeIndex !== undefined ? [...ref.location, 'nodes', ref.nodeIndex, ...ref.where] : [...ref.location, 'connections', ref.connectionIndex, ...ref.where];
		document.setIn(at, `${moved}${ref.suffix}`);
		count += 1;
	}
	return count;
}

// a view renamed, in a yaml Document: its id, the choices naming it, the references naming it
// (@id), the embedded scenes asking for it (data.view)
export function switchDocViewIdMove(document, value, path, viewId, viewIdNew) {
	const scenePath = switchPathNormalize(path);
	const sceneIndex = (value.sceneList ?? []).findIndex(scene => switchPathNormalize(scene.path) === scenePath);
	const scene = value.sceneList[sceneIndex];
	const viewIndex = (scene?.viewList ?? []).findIndex(view => view.id === viewId);
	if (viewIndex < 0) throw new Error(`The scene ${scenePath} has no view ${viewId}.`);
	document.setIn(['sceneList', sceneIndex, 'viewList', viewIndex, 'id'], viewIdNew);
	for (const field of ['viewDefault', 'viewHover']) {
		const choice = scene[field];
		if (choice === viewId) document.setIn(['sceneList', sceneIndex, field], viewIdNew);
		else if (Array.isArray(choice)) choice.forEach((rule, ruleIndex) => { if (rule?.view === viewId) document.setIn(['sceneList', sceneIndex, field, ruleIndex, 'view'], viewIdNew); });
	}
	for (const ref of switchSceneRefListGet(value)) {
		if (!ref.location || ref.path !== scenePath) continue;
		const base = ref.nodeIndex !== undefined ? [...ref.location, 'nodes', ref.nodeIndex] : [...ref.location, 'connections', ref.connectionIndex];
		if (ref.suffix === `@${viewId}` || ref.suffix.startsWith(`@${viewId}#`)) document.setIn([...base, ...ref.where], `${scenePath}${ref.suffix.replace(`@${viewId}`, `@${viewIdNew}`)}`);
		if (ref.kind === 'embed' && document.getIn([...base, 'data', 'view']) === viewId) document.setIn([...base, 'data', 'view'], viewIdNew);
	}
}
