import { switchRefListGet } from './SwitchRef.js';
import { SCENE_TREE_BLOCK_KEY, sceneKeyOf, sceneTreeKeyRead } from './SwitchSceneEditTree.js';

// The relations of what is focused in the tab Scenes (card-diagram-flexible-switch.md#the-scenes-tab),
// as a small diagram drawn without a canvas (DiagramPanelGraph.jsx), laid out as a tree read downward
// (a narrow part grows in height, not in width): what leads to it above, each line running down one
// lane at the left into it; itself; what it leads to below, branching off the same lane. Icon nodes,
// right-angled lines. One node per other scene and side, its relations joined in its words; the line
// takes the look of the strongest. At most six a side, the rest one node "more".
//
//   ◆ Overview            it is below
//   ◆ Index               embeds it
//   │
//   ◆ Detail  /overview/detail
//   ├─ ◆ Columns          below it
//   └─ ◆ Keys             embedded · linked
//
//   sceneGraphBuild(store, key) -> { diagram, targetById, moreById } | null
//   targetById   what a click on a node focuses (a key of the tree)
//   moreById     the keys a node "more" stands for
const ROW_STEP = 42;
const INDENT = 34;
const SIDE_MAX = 6;
const NODE_SIZE = { width: 220, height: 34 };
const handles = [
	{ id: 'top', direction: 'in', anchor: { target: 'icon', side: 'top' } },
	{ id: 'bottom', direction: 'out', anchor: { target: 'icon', side: 'bottom' } },
	{ id: 'left-in', direction: 'in', anchor: { target: 'icon', side: 'left' } },
	{ id: 'left-out', direction: 'out', anchor: { target: 'icon', side: 'left' } },
];
// the relations, strongest first, and how their lines look
export const SCENE_RELATION_LIST = [
	{ id: 'path', label: 'path', stroke: '#94a3b8', tone: 'slate', wordAbove: 'it is below', wordBelow: 'below it' },
	{ id: 'embed', label: 'embeds', stroke: '#3b82f6', tone: 'blue', wordAbove: 'embeds it', wordBelow: 'embedded' },
	{ id: 'stack', label: 'stacks', stroke: '#3b82f6', tone: 'blue', wordAbove: 'stacks it', wordBelow: 'stacked' },
	{ id: 'tabs', label: 'tabs', stroke: '#8b5cf6', tone: 'violet', wordAbove: 'arranges it in tabs', wordBelow: 'arranged in tabs' },
	{ id: 'link', label: 'links', stroke: '#0d9488', tone: 'teal', isDashed: true, wordAbove: 'links to it', wordBelow: 'linked' },
	{ id: 'alias', label: 'scroll', stroke: '#94a3b8', tone: 'slate', isDashed: true, wordAbove: 'keeps its scroll', wordBelow: 'its scroll' },
];
const relationById = Object.fromEntries(SCENE_RELATION_LIST.map(relation => [relation.id, relation]));
const rankOf = id => SCENE_RELATION_LIST.findIndex(relation => relation.id === id);
export const sceneGraphLegend = SCENE_RELATION_LIST.filter(relation => relation.id !== 'alias' && relation.id !== 'stack').map(relation => ({ id: relation.id, label: relation.label, tone: relation.tone, isDashed: relation.isDashed }));
const ICON_BY_KIND = { block: 'layers', scene: 'layers', view: 'file', folder: 'folder', mount: 'plug', tab: 'split', missing: 'warning' };

// the references going out of a scene of the block, or of a mounted scene (read from its source)
function outListOf(store, path, viewId) {
	const item = store.treeModel.itemGet(sceneKeyOf(path));
	if (item?.isMounted) {
		const desc = store.mounted?.provider?.sceneGet(path);
		const diagramList = desc?.viewList ? desc.viewList.filter(view => !viewId || view.id === viewId).map(view => view.diagram) : [desc?.diagram];
		return diagramList.filter(Boolean).flatMap(diagram => switchRefListGet(diagram));
	}
	return (store.refIndex.outByPath.get(path) ?? []).filter(ref => !viewId || ref.fromViewId === viewId || ref.kind === 'tabs');
}

export function sceneGraphBuild(store, key) {
	if (!key) return null;
	const model = store.treeModel;
	const item = model.itemGet(key);
	if (!item) return null;
	const { kind, path, viewId } = sceneTreeKeyRead(key);
	// the other scenes, by side: path -> { key, relationSet }
	const above = new Map();
	const below = new Map();
	const join = (side, otherKey, relationId) => {
		if (!otherKey || otherKey === key) return;
		if (!side.has(otherKey)) side.set(otherKey, new Set());
		side.get(otherKey).add(relationId);
	};
	const keyOfPath = (scenePath) => {
		const own = store.treeIndex.itemByKey[store.treeIndex.keyOfPath(scenePath)];
		if (own) return own.key;
		const mounted = model.itemGet(sceneKeyOf(scenePath));
		return mounted ? mounted.key : `missing:${scenePath}`;
	};
	if (kind === 'block') {
		for (const child of model.childKeyListGet(SCENE_TREE_BLOCK_KEY)) join(below, child, 'path');
	} else {
		const parentKey = model.parentKeyGet(kind === 'view' ? sceneKeyOf(path) : key);
		if (kind === 'view') join(above, sceneKeyOf(path), 'path');
		else if (parentKey && parentKey !== SCENE_TREE_BLOCK_KEY) join(above, parentKey, 'path');
		if (kind === 'tab') join(above, sceneKeyOf(item.owner), 'tabs');
		for (const ref of store.refIndex.inByPath.get(path) ?? []) {
			if (viewId && !(ref.suffix.startsWith(`@${viewId}`) || ref.kind === 'embed')) continue;
			join(above, sceneKeyOf(ref.fromPath), ref.kind);
		}
		if (kind !== 'view') for (const child of model.childKeyListGet(key)) if (!child.startsWith('view:')) join(below, child, child.startsWith('tab:') ? 'tabs' : 'path');
		if (kind === 'scene' || kind === 'view') for (const ref of outListOf(store, path, viewId)) join(below, keyOfPath(ref.path), ref.kind);
	}
	const nodes = [];
	const connections = [];
	const targetById = {};
	const moreById = {};
	const nodeAdd = (id, x, y, data, target) => {
		nodes.push({ id, renderer: { type: 'card-icon' }, position: { x, y }, size: NODE_SIZE, data, handles });
		if (target) targetById[id] = target;
	};
	const wordsOf = (otherKey, relationSet, isAbove) => [...relationSet].sort((a, b) => rankOf(a) - rankOf(b)).map(id => (isAbove ? relationById[id]?.wordAbove : relationById[id]?.wordBelow) ?? id).join(' · ');
	const sideLay = (side, isAbove, rowStart) => {
		const list = [...side.entries()].sort(([, a], [, b]) => Math.min(...[...a].map(rankOf)) - Math.min(...[...b].map(rankOf)));
		const shown = list.length > SIDE_MAX ? list.slice(0, SIDE_MAX - 1) : list;
		const restList = list.slice(shown.length);
		const idList = [];
		shown.forEach(([otherKey, relationSet], index) => {
			const id = `${isAbove ? 'a' : 'b'}${index}`;
			const other = model.itemGet(otherKey);
			const isMissing = otherKey.startsWith('missing:');
			const strongest = [...relationSet].sort((a, b) => rankOf(a) - rankOf(b))[0];
			const otherKind = isMissing ? 'missing' : other?.kind ?? 'scene';
			nodeAdd(id, INDENT, (rowStart + index) * ROW_STEP, {
				title: isMissing ? `No scene ${otherKey.slice(8)}` : other?.label ?? otherKey,
				text: isMissing ? 'named, but not in the block' : wordsOf(otherKey, relationSet, isAbove),
				icon: ICON_BY_KIND[otherKind] ?? 'layers', tone: isMissing ? 'red' : relationById[strongest]?.tone ?? 'slate',
			}, isMissing ? null : otherKey);
			idList.push({ id, relation: strongest });
		});
		if (restList.length) {
			const index = shown.length;
			const id = `${isAbove ? 'a' : 'b'}-more`;
			nodeAdd(id, INDENT, (rowStart + index) * ROW_STEP, { title: `⋯ ${restList.length} more`, text: 'click to list them', icon: 'list-checks', tone: 'slate' });
			moreById[id] = restList.map(([otherKey]) => otherKey);
			idList.push({ id, relation: 'path' });
		}
		return { idList, rowCount: shown.length + (restList.length ? 1 : 0) };
	};
	const aboveLaid = sideLay(above, true, 0);
	const rowSelf = aboveLaid.rowCount;
	const selfLabel = kind === 'view' ? `${model.itemGet(sceneKeyOf(path))?.label ?? path} @${item.label}` : item.label;
	const selfText = kind === 'block' ? item.summary : [path, item.summary].filter(Boolean).join(' · ');
	nodeAdd('self', 0, rowSelf * ROW_STEP, { title: selfLabel, text: selfText, icon: ICON_BY_KIND[kind] ?? 'layers', tone: 'blue', isFocus: true }, key);
	const belowLaid = sideLay(below, false, rowSelf + 1);
	// above: from the left of each, down the lane into the top of it; below: from its bottom, down
	// the lane, into the left of each
	const link = (from, fromHandle, to, toHandle, relation) => {
		const look = relationById[relation] ?? relationById.path;
		connections.push({ id: `${from}--${to}`, source: { nodeId: from, handleId: fromHandle }, target: { nodeId: to, handleId: toHandle }, renderer: { type: 'smoothstep' }, style: { stroke: look.stroke, strokeWidth: 1.3, ...(look.isDashed ? { strokeDasharray: '5 4' } : {}) }, markerEnd: 'arrowClosed' });
	};
	for (const { id, relation } of aboveLaid.idList) link(id, 'left-out', 'self', 'top', relation);
	for (const { id, relation } of belowLaid.idList) link('self', 'bottom', id, 'left-in', relation);
	return { diagram: { nodes, connections }, targetById, moreById };
}
