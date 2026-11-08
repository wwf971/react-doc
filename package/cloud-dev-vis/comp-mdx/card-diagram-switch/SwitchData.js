import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';

// The pure part of the switching layer (card-diagram-flexible-switch.md): paths,
// documents, the tabs of a scene, bounding boxes and cameras, the way from one scene
// to another, and what a frame of that way looks like. Nothing here knows a store,
// React Flow or a clock: a frame is a function of a step and a progress, so a
// requestAnimationFrame loop and remotion's frame drive it alike.

export const SWITCH_TAB_HEADER_HEIGHT = 40;
export const SWITCH_EMBED_CHROME_HEIGHT = 34;
export const SWITCH_EMBED_PADDING = 0.03;
export const SWITCH_FIT_PADDING = 0.06;
export const SWITCH_FIT_ZOOM_MAX = 1.25;
export const SWITCH_ZOOM_MIN = 0.02;
export const SWITCH_ZOOM_MAX = 64;
export const SWITCH_SECOND_PORTAL = 0.75;
export const SWITCH_SECOND_MORPH = 0.65;
export const SWITCH_SECOND_CAMERA = 0.5;
export const SWITCH_SECOND_SCROLL = 0.4;
export const SWITCH_STACK_ITEM_SCALE_MAX = 1.1;
const SWITCH_EDGE_HOVER_STROKE = '#64748b';

// how a scene is being presented: which scene and which of its views, embedded or focused,
// and when embedded, the scene directly holding it. pathEmbedder is not the parent in the
// tree of paths: a scene may embed one that lies anywhere
export function switchPresentationBuild(path, isEmbedded = false, pathEmbedder = null) {
	const { path: scene, view } = switchPathViewRead(path);
	return { path: scene, view, isEmbedded, isFocused: !isEmbedded, pathEmbedder: isEmbedded && pathEmbedder ? switchPathViewRead(pathEmbedder).path : null };
}

export function switchStackPresentationBuild(data, presentation) {
	if (!data.focusPath) return presentation;
	const path = switchPathNormalize(data.focusPath);
	return switchPresentationBuild(path, presentation.isEmbedded || presentation.path !== path, presentation.isEmbedded ? presentation.pathEmbedder : presentation.path);
}

export function switchStackFrameIsVisible(data, presentation) {
	return !presentation.isFocused || data.isFrameVisibleFocused !== false;
}

// a stack at the height of its items, with no scrollbar, or scrolling in the height of its
// node. isHeightFullEmbedded and isHeightFullFocused say which by presentation, as the frame
// and the title do; what a program or the reader chose (override) goes first
export function switchStackHeightIsFull(data, presentation, override) {
	if (override !== undefined) return override;
	return (presentation.isEmbedded ? data.isHeightFullEmbedded : data.isHeightFullFocused) === true;
}

export function switchStackTitleBarNormalize(value) {
	if (value === undefined) return undefined;
	const title = typeof value === 'string' ? { text: value } : mapping(value, 'titleBar');
	for (const key of ['isVisibleEmbedded', 'isVisibleFocused']) {
		if (title[key] !== undefined && typeof title[key] !== 'boolean') throw new Error(`titleBar.${key} must be a boolean.`);
	}
	if (title.text !== undefined && typeof title.text !== 'string') throw new Error('titleBar.text must be text.');
	if (title.text !== undefined && title.itemList !== undefined) throw new Error('titleBar uses text or itemList, not both.');
	if (title.itemList !== undefined) {
		if (!Array.isArray(title.itemList)) throw new Error('titleBar.itemList must be a list.');
		const idSet = new Set();
		for (const item of title.itemList) {
			if (!item || typeof item.id !== 'string' || !item.id.trim() || idSet.has(item.id)) throw new Error('Every titleBar item needs a unique nonempty id.');
			idSet.add(item.id);
			if (item.type === 'text') {
				if (typeof item.text !== 'string') throw new Error(`titleBar item ${item.id} needs text.`);
			} else if (item.type === 'component') {
				if (typeof item.comp !== 'string' || !item.comp.trim()) throw new Error(`titleBar item ${item.id} needs comp.`);
				if (item.data !== undefined) mapping(item.data, `titleBar item ${item.id}.data`);
			} else throw new Error(`Unknown titleBar item type: ${item.type}.`);
		}
	}
	return title;
}

export function switchStackTitleBarRead(data, presentation) {
	const title = switchStackTitleBarNormalize(data.titleBar);
	if (!title) return data.isChromeHidden ? null : { isLegacy: true, text: data.title };
	const isVisible = presentation.isEmbedded ? title.isVisibleEmbedded : title.isVisibleFocused;
	return isVisible === false ? null : { ...title, text: title.text ?? data.title ?? '' };
}

// a line while the pointer rests on its label: a band along it and the line itself solid, in
// the line's own color, so the whole of it can be followed, also a thin or a dashed one
export function switchEdgeHoverStyleBuild(style = {}) {
	const stroke = style.stroke ?? SWITCH_EDGE_HOVER_STROKE;
	const width = Number(style.strokeWidth) || 1;
	return {
		band: { stroke, strokeWidth: width + 6, strokeOpacity: 0.22, strokeLinecap: 'round' },
		line: { stroke, strokeWidth: width + 0.75 },
	};
}

// ---------- paths ----------

// a path of a scene: "/" separates its segments, always from the root, as a path
// of the assets of a frontend object is read
export function switchPathNormalize(path) {
	const segmentList = String(path ?? '').split('/').map((segment) => segment.trim()).filter(Boolean);
	return `/${segmentList.join('/')}`;
}

export function switchPathParent(path) {
	const normalized = switchPathNormalize(path);
	const index = normalized.lastIndexOf('/');
	return index <= 0 ? '' : normalized.slice(0, index);
}

// every folder of a path, the root first: /a/b -> [/a, /a/b]
export function switchPathChain(path) {
	const chain = [];
	let current = switchPathNormalize(path);
	while (current && current !== '/') {
		chain.unshift(current);
		current = switchPathParent(current);
	}
	return chain;
}

// a path may name an item of a scrolling stack of its scene: /overview/plan#batch
export function switchPathHashRead(path) {
	const [pathOnly, itemId] = String(path ?? '').split('#');
	return { path: switchPathNormalize(pathOnly), itemId: itemId || '' };
}

// a path may name a view of its scene: /overview/er@matrix
export function switchPathViewRead(path) {
	const text = String(path ?? '');
	const index = text.lastIndexOf('@');
	return index < 0 ? { path: switchPathNormalize(text), view: '' } : { path: switchPathNormalize(text.slice(0, index)), view: text.slice(index + 1).trim() };
}

export function switchPathViewBuild(path, view) {
	return view ? `${path}@${view}` : path;
}

export function switchPathLast(path) {
	const normalized = switchPathNormalize(path);
	return normalized.slice(normalized.lastIndexOf('/') + 1);
}

// ---------- the views of a scene ----------

// A scene has one or more views and shows one at a time, as a table card does. A scene
// without a viewList has one view, its diagram, and nothing here applies to it.
//
//   viewList      [{ id, label?, description?, diagram, box?, isAvailableEmbedded?, isAvailableFocused?, isFrameHiddenEmbedded? }]
//                 isFrameHiddenEmbedded: a card showing this view is this view alone: no frame, no
//                 title line, no margin, the view filling the whole card
//   viewDefault   the id of a view; an ordered list of rules, the first match wins:
//                 [{ when?: { isEmbedded?, isFocused?, embedder? }, view }], embedder being a
//                 path, /a/* for what lies below a path, or a list of those; or, in code,
//                 a function of the presentation answering an id
//   viewHover     the view shown while a pointer rests on a card embedding the scene, in the
//                 same forms as viewDefault; none without one
export function switchViewListCheck(desc, path) {
	if (!Array.isArray(desc.viewList) || desc.viewList.length === 0) throw new Error(`The viewList of ${path} must list at least one view.`);
	const idSet = new Set();
	for (const view of desc.viewList) {
		mapping(view, `a view of ${path}`);
		if (typeof view.id !== 'string' || !/^[^\s/@#]+$/.test(view.id)) throw new Error(`Every view of ${path} needs an id without spaces, /, @ or #.`);
		if (idSet.has(view.id)) throw new Error(`The scene ${path} has two views of the id "${view.id}".`);
		if (!view.diagram) throw new Error(`The view ${view.id} of ${path} needs a diagram.`);
		idSet.add(view.id);
	}
	for (const field of ['viewDefault', 'viewHover']) switchViewChoiceCheck(desc[field], field, idSet, path);
	if (desc.viewSwitcherLayout !== undefined && !['menu', 'tabs'].includes(desc.viewSwitcherLayout)) throw new Error(`The viewSwitcherLayout of ${path} is menu or tabs.`);
	if (desc.isViewSearchable !== undefined && typeof desc.isViewSearchable !== 'boolean') throw new Error(`The isViewSearchable of ${path} is true or false.`);
	for (const view of desc.viewList) if (view.title !== undefined && typeof view.title !== 'string') throw new Error(`The title of the view ${view.id} of ${path} is text.`);
}

// the views a search finds: every word of the text in the label, the description or the id
// of a view, whatever the case; all of them for no text
export function switchViewSearch(viewList, text) {
	const wordList = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
	if (wordList.length === 0) return viewList;
	return viewList.filter((view) => {
		const haystack = [view.label, view.description, view.id].filter(Boolean).join('\n').toLowerCase();
		return wordList.every((word) => haystack.includes(word));
	});
}

function switchViewChoiceCheck(value, field, idSet, path) {
	if (value === undefined || typeof value === 'function') return;
	const named = (id) => {
		if (!idSet.has(id)) throw new Error(`The ${field} of ${path} names a view it does not have: ${id}.`);
	};
	if (typeof value === 'string') { named(value); return; }
	if (!Array.isArray(value)) throw new Error(`The ${field} of ${path} must be the id of a view, or a list of rules.`);
	for (const rule of value) {
		mapping(rule, `a rule of the ${field} of ${path}`);
		named(rule.view);
		if (rule.when === undefined) continue;
		mapping(rule.when, `when of a rule of the ${field} of ${path}`);
		for (const key of Object.keys(rule.when)) {
			if (!['isEmbedded', 'isFocused', 'embedder'].includes(key)) throw new Error(`A rule of the ${field} of ${path} has an unknown condition: ${key}.`);
		}
	}
}

// what viewDefault or viewHover answers in a presentation, best first
function switchViewChoiceIdListOf(value, presentation) {
	if (typeof value === 'function') return [value(presentation)];
	if (Array.isArray(value)) return value.filter((rule) => switchViewRuleMatch(rule.when, presentation)).map((rule) => rule.view);
	return [value];
}

// the views a reader may switch to in a presentation. a scene hiding them all from a
// presentation would have nothing to show, so then they are all there
export function switchViewListOf(desc, presentation) {
	const list = desc.viewList.filter((view) => (presentation.isEmbedded ? view.isAvailableEmbedded : view.isAvailableFocused) !== false);
	return list.length > 0 ? list : desc.viewList;
}

function switchViewEmbedderMatch(embedder, pathEmbedder) {
	if (!pathEmbedder) return false;
	return [].concat(embedder).some((pattern) => {
		const text = String(pattern);
		return text.endsWith('/*') ? pathEmbedder.startsWith(`${switchPathNormalize(text.slice(0, -2))}/`) : pathEmbedder === switchPathNormalize(text);
	});
}

function switchViewRuleMatch(when = {}, presentation) {
	if (when.isEmbedded !== undefined && when.isEmbedded !== presentation.isEmbedded) return false;
	if (when.isFocused !== undefined && when.isFocused !== presentation.isFocused) return false;
	return when.embedder === undefined || switchViewEmbedderMatch(when.embedder, presentation.pathEmbedder);
}

// which view a scene shows in a presentation: the first of wantedList available there (a
// reader's choice, what the embedding asks for), then viewDefault, then the first available
export function switchViewResolve(desc, presentation, wantedList = []) {
	const list = switchViewListOf(desc, presentation);
	const isAvailable = (id) => list.some((view) => view.id === id);
	const wanted = wantedList.find(isAvailable);
	if (wanted) return wanted;
	return switchViewChoiceIdListOf(desc.viewDefault, presentation).find(isAvailable) ?? list[0].id;
}

// the view shown while a pointer rests on a card embedding a scene, '' for none. viewAsked:
// what that card asks for, which goes first; false: none on this card
export function switchViewHoverResolve(desc, presentation, viewAsked) {
	if (viewAsked === false) return '';
	const list = switchViewListOf(desc, presentation);
	const isAvailable = (id) => list.some((view) => view.id === id);
	return [viewAsked, ...switchViewChoiceIdListOf(desc.viewHover, presentation)].find(isAvailable) ?? '';
}

export function switchViewSwitcherIsShown(desc, presentation) {
	if (desc.isViewSwitcherHidden) return false;
	return !(presentation.isEmbedded ? desc.isViewSwitcherHiddenEmbedded : desc.isViewSwitcherHiddenFocused);
}

export function switchViewFrameIsHidden(desc, viewId) {
	return Boolean(desc?.viewList?.find((view) => view.id === viewId)?.isFrameHiddenEmbedded);
}

// the whole of a card in the coordinates of its body, given the body: its border on the sides
// and below as on the left, and the title line above
export function switchEmbedCardRectOf(body) {
	return { x: 0, y: 0, width: body.width + 2 * body.x, height: body.y + body.height + body.x };
}

// what the canvas draws of a scene at a view: one diagram, as a scene without views has.
// null: the scene has no such view
export function switchViewDescGet(desc, viewId) {
	if (!desc.viewList) return viewId ? null : desc;
	const view = desc.viewList.find((item) => item.id === viewId);
	if (!view) return null;
	return { path: switchPathViewBuild(desc.path, viewId), label: desc.label, description: view.description ?? desc.description, diagram: view.diagram, box: view.box };
}

// ---------- the document of a block ----------

function mapping(value, field) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be a mapping.`);
	return value;
}

// the box of a scene written by hand: { x, y, width, height }
export function switchRectRead(value, field) {
	mapping(value, field);
	const rect = { x: Number(value.x), y: Number(value.y), width: Number(value.width), height: Number(value.height) };
	if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
		throw new Error(`${field} must be { x, y, width, height } with a positive size.`);
	}
	return rect;
}

// the document of a CardDiagramSwitch block: its scenes by path. A scene holds a
// diagram of the card diagram format, or names another scene and arranges some of
// its nodes in tabs (one more scene per tab, below its path).
export function switchDocNormalize(input) {
	const value = typeof input === 'string' ? yamlParse(input) : input;
	mapping(value, 'the document');
	if (value.version !== 1) throw new Error('A switch document needs version: 1.');
	if (!Array.isArray(value.sceneList) || value.sceneList.length === 0) throw new Error('A switch document needs a sceneList with at least one scene.');
	const sceneByPath = new Map();
	for (const scene of value.sceneList) {
		mapping(scene, 'a scene');
		if (typeof scene.path !== 'string' || !scene.path.trim()) throw new Error('Every scene needs a path.');
		if (/[@#]/.test(scene.path)) throw new Error(`The path ${scene.path} has @ or #, which name a view or an item of a scene.`);
		const path = switchPathNormalize(scene.path);
		if (sceneByPath.has(path)) throw new Error(`The scene ${path} is written twice.`);
		if ([scene.diagram, scene.tabs, scene.viewList].filter(Boolean).length !== 1) throw new Error(`The scene ${path} needs one of a diagram, tabs or a viewList.`);
		if (scene.viewList) switchViewListCheck(scene, path);
		if (scene.tabs) switchTabsRead(scene.tabs, path);
		sceneByPath.set(path, {
			...scene,
			path,
			label: String(scene.label ?? switchPathLast(path)),
			description: String(scene.description ?? ''),
			labelItemList: scene.labelItemList,
			box: scene.box === undefined ? undefined : switchRectRead(scene.box, `${path}.box`),
			viewList: scene.viewList?.map((view) => ({ ...view, box: view.box === undefined ? undefined : switchRectRead(view.box, `${path}@${view.id}.box`) })),
		});
	}
	for (const scene of sceneByPath.values()) {
		if (scene.tabs && !sceneByPath.has(switchPathNormalize(scene.tabs.of))) throw new Error(`The tabs of ${scene.path} name a scene that does not exist: ${scene.tabs.of}.`);
		if (scene.tabs && !sceneByPath.get(switchPathNormalize(scene.tabs.of)).diagram) throw new Error(`The tabs of ${scene.path} arrange the nodes of one diagram, and ${scene.tabs.of} has views.`);
	}
	const root = switchPathNormalize(value.root ?? value.sceneList[0].path);
	if (!sceneByPath.has(root)) throw new Error(`The root ${root} is not a scene.`);
	return { title: String(value.title ?? ''), root, height: value.height, transition: value.transition ?? {}, defaults: value.defaults, sceneByPath };
}

// the scenes of a document, as the layer asks for them. onBoxSave: what a box the
// reader adjusted does (rewrites the block, when the block can be written)
export function switchProviderFromDoc(spec, { onBoxSave, signature } = {}) {
	const tabsOwnerOf = (path) => {
		const parent = switchPathParent(path);
		const scene = spec.sceneByPath.get(parent);
		return scene?.tabs && scene.tabs.memberList.some((member) => member.id === switchPathLast(path)) ? scene : null;
	};
	const diagramOf = (scene, focus) => {
		if (!scene.tabs) return scene.diagram;
		const base = spec.sceneByPath.get(switchPathNormalize(scene.tabs.of));
		return switchTabsApply(base.diagram, scene.tabs, focus, scene.path);
	};
	const childPathList = (path) => {
		const list = [...spec.sceneByPath.keys()].filter((key) => switchPathParent(key) === path);
		const scene = spec.sceneByPath.get(path);
		if (scene?.tabs) list.push(...scene.tabs.memberList.map((member) => `${path}/${member.id}`));
		return list;
	};
	const descriptionOf = (path) => {
		const owner = tabsOwnerOf(path);
		if (owner) return owner.tabs.memberList.find((member) => member.id === switchPathLast(path))?.description ?? '';
		return spec.sceneByPath.get(path)?.description ?? '';
	};
	const provider = {
		// the text of the document: a provider built again from the same text is the same
		signature,
		root: spec.root,
		title: spec.title,
		transition: spec.transition,
		labelGet: (path) => {
			const owner = tabsOwnerOf(path);
			if (owner) return owner.tabs.memberList.find((member) => member.id === switchPathLast(path))?.label ?? switchPathLast(path);
			return spec.sceneByPath.get(path)?.label ?? switchPathLast(path);
		},
		childListGet: (path) => childPathList(path).map((child) => ({ path: child, label: provider.labelGet(child), description: descriptionOf(child), labelItemList: spec.sceneByPath.get(child)?.labelItemList })),
		sceneGet: (path) => {
			const owner = tabsOwnerOf(path);
			const scene = owner ?? spec.sceneByPath.get(path);
			if (!scene) return null;
			if (scene.viewList) {
				const { viewDefault, viewHover, isViewSwitcherHidden, isViewSwitcherHiddenEmbedded, isViewSwitcherHiddenFocused, viewSwitcherLayout, isViewSearchable, title, isTitleHidden } = scene;
				return { path, label: provider.labelGet(path), description: descriptionOf(path), title, isTitleHidden, viewDefault, viewHover, isViewSwitcherHidden, isViewSwitcherHiddenEmbedded, isViewSwitcherHiddenFocused, viewSwitcherLayout, isViewSearchable, viewList: scene.viewList.map((view) => ({ ...view, diagram: { defaults: spec.defaults, ...view.diagram } })) };
			}
			const diagram = diagramOf(scene, owner ? switchPathLast(path) : undefined);
			return { path, label: provider.labelGet(path), description: descriptionOf(path), title: owner ? undefined : scene.title, isTitleHidden: (owner ?? scene).isTitleHidden, diagram: { defaults: spec.defaults, ...diagram }, box: owner ? undefined : scene.box };
		},
		boxSave: onBoxSave,
	};
	return provider;
}

// ---------- the tabs of a scene ----------

function switchTabsRead(tabs, path) {
	mapping(tabs, `${path}.tabs`);
	if (typeof tabs.of !== 'string') throw new Error(`The tabs of ${path} need "of": the scene whose nodes they arrange.`);
	if (!Array.isArray(tabs.memberList) || tabs.memberList.length < 2) throw new Error(`The tabs of ${path} need a memberList of at least two nodes.`);
	mapping(tabs.position, `${path}.tabs.position`);
	mapping(tabs.size, `${path}.tabs.size`);
	const idSet = new Set();
	for (const member of tabs.memberList) {
		if (!member?.id) throw new Error(`A member of the tabs of ${path} needs an id: a node of the scene.`);
		if (idSet.has(member.id)) throw new Error(`The tabs of ${path} name the node ${member.id} twice.`);
		idSet.add(member.id);
	}
}

// A diagram with some of its nodes in tabs: the header takes the place, the focused
// member stands under it, the others leave. Lines are rewired, never dropped: an end
// on a member that left moves to that member's tab, at the side facing the other end;
// a line whose two ends left runs between the two tabs, dashed.
//
//   tabs   { id?, memberList: [{ id, label, tone?, link? }], position, size: { width, height? } }
export function switchTabsApply(diagram, tabs, focusInput, scenePath) {
	const { memberList, position, size } = tabs;
	const headerId = tabs.id ?? 'tabs';
	const focus = memberList.some((member) => member.id === focusInput) ? focusInput : memberList[0].id;
	const memberSet = new Set(memberList.map((member) => member.id));
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	for (const member of memberList) {
		if (!nodeById.has(member.id)) throw new Error(`The tabs name a node the scene does not have: ${member.id}.`);
	}
	const handleById = new Map();
	const tabEndpoint = (memberId, side) => {
		const id = `tab:${memberId}:${side}`;
		if (!handleById.has(id)) handleById.set(id, { id, direction: 'both', anchor: { target: `tab/${memberId}`, side } });
		return { nodeId: headerId, handleId: id };
	};
	const yOf = (nodeId) => {
		if (nodeId === focus) return position.y;
		const node = nodeById.get(nodeId);
		return node?.position && node.position !== 'auto' ? node.position.y : 0;
	};
	const connections = (diagram.connections ?? []).map((connection) => {
		const sourceHidden = memberSet.has(connection.source?.nodeId) && connection.source.nodeId !== focus;
		const targetHidden = memberSet.has(connection.target?.nodeId) && connection.target.nodeId !== focus;
		if (!sourceHidden && !targetHidden) return connection;
		const sideFacing = (otherId) => (!memberSet.has(otherId) && yOf(otherId) > position.y ? 'bottom' : 'top');
		const next = { ...connection };
		if (sourceHidden) next.source = tabEndpoint(connection.source.nodeId, sideFacing(connection.target?.nodeId));
		if (targetHidden) next.target = tabEndpoint(connection.target.nodeId, sideFacing(connection.source?.nodeId));
		if (sourceHidden && targetHidden) next.style = { ...connection.style, stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' };
		// the words of a line between tabs would stand over the header
		if (sourceHidden && targetHidden) next.label = { text: '' };
		return next;
	});
	const header = {
		id: headerId,
		renderer: { type: 'scene-tabs' },
		position: { x: position.x, y: position.y },
		size: { width: size.width, height: SWITCH_TAB_HEADER_HEIGHT },
		data: {
			focus,
			tabList: memberList.map((member) => ({ id: member.id, label: member.label ?? member.id, tone: member.tone, link: member.link ?? (scenePath ? `${scenePath}/${member.id}` : undefined) })),
		},
		handles: [...handleById.values()],
	};
	const nodes = [];
	for (const node of diagram.nodes ?? []) {
		if (memberSet.has(node.id) && node.id !== focus) continue;
		if (node.id === focus) {
			nodes.push({ ...node, position: { x: position.x, y: position.y + SWITCH_TAB_HEADER_HEIGHT }, size: { width: size.width, height: size.height ?? 'auto' } });
			continue;
		}
		nodes.push(node);
	}
	nodes.push(header);
	return { ...diagram, nodes, connections };
}

// ---------- boxes and cameras ----------

export function switchRectUnion(rectList) {
	if (rectList.length === 0) return null;
	const left = Math.min(...rectList.map((rect) => rect.x));
	const top = Math.min(...rectList.map((rect) => rect.y));
	const right = Math.max(...rectList.map((rect) => rect.x + rect.width));
	const bottom = Math.max(...rectList.map((rect) => rect.y + rect.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

// the camera showing a box in a viewport of the given size. a fit stops at a zoom,
// so a few cards stay compact instead of filling the viewport
export function switchCameraFit(box, viewport, { padding = SWITCH_FIT_PADDING, zoomMax = SWITCH_FIT_ZOOM_MAX, zoomMin = SWITCH_ZOOM_MIN } = {}) {
	const widthInner = viewport.width * (1 - 2 * padding);
	const heightInner = viewport.height * (1 - 2 * padding);
	const zoom = Math.max(zoomMin, Math.min(zoomMax, widthInner / box.width, heightInner / box.height));
	return { x: viewport.width / 2 - (box.x + box.width / 2) * zoom, y: viewport.height / 2 - (box.y + box.height / 2) * zoom, zoom };
}

// how the world of an embedded scene is placed in the body of its card: the box
// fits the body with a small margin, centered. local = scale * child + (tx, ty)
export function switchEmbedMapBuild(body, box, padding = SWITCH_EMBED_PADDING) {
	const inner = 1 - 2 * padding;
	const scale = Math.min((body.width * inner) / box.width, (body.height * inner) / box.height);
	return { scale, tx: (body.width - box.width * scale) / 2 - box.x * scale, ty: (body.height - box.height * scale) / 2 - box.y * scale };
}

// how an item of a scrolling stack holds a scene: the box fits the width of the item
// and the item is as tall as that makes it, so a stack never shrinks a scene to make
// everything visible at once; a wide box does not enlarge past a limit.
export function switchStackItemLayout(width, box, padding = SWITCH_EMBED_PADDING) {
	const pad = width * padding;
	const scale = Math.min(SWITCH_STACK_ITEM_SCALE_MAX, (width - 2 * pad) / box.width);
	return {
		height: box.height * scale + 2 * pad,
		map: { scale, tx: (width - box.width * scale) / 2 - box.x * scale, ty: pad - box.y * scale },
	};
}

// an embedding names a part of a scene: what lies outside that box stays out. the margin
// is opened by a portal (--doc-switch-open), so the rest comes into view as the box grows
export function switchBoxClipBuild(box) {
	const open = 'var(--doc-switch-open, 0px)';
	return `inset(calc(${box.y}px - ${open}) calc(${-(box.x + box.width)}px - ${open}) calc(${-(box.y + box.height)}px - ${open}) calc(${box.x}px - ${open}))`;
}

// the inverse of switchCameraParentOf: the camera of the embedded scene at a camera of the parent
export function switchCameraChildOf(cameraParent, body, map) {
	return { x: cameraParent.x + (body.x + map.tx) * cameraParent.zoom, y: cameraParent.y + (body.y + map.ty) * cameraParent.zoom, zoom: cameraParent.zoom * map.scale };
}

// the camera of the parent scene which draws an embedded scene exactly where the
// camera of that scene would: what makes the swap between the two invisible.
//   body     the body of the card, in the coordinates of the parent
//   map      switchEmbedMapBuild(body, box)
export function switchCameraParentOf(cameraChild, body, map) {
	const zoom = cameraChild.zoom / map.scale;
	return { x: cameraChild.x - (body.x + map.tx) * zoom, y: cameraChild.y - (body.y + map.ty) * zoom, zoom };
}

// two cameras, by a progress. the zoom moves evenly in its logarithm and the
// translation follows the zoom, so everything moves away from one fixed point of the
// screen: a zoom into a card goes straight into it. two cameras of one zoom pan.
export function switchCameraBetween(from, to, progress) {
	if (progress <= 0) return from;
	if (progress >= 1) return to;
	if (Math.abs(Math.log(to.zoom / from.zoom)) < 1e-4) {
		return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress, zoom: from.zoom };
	}
	const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * progress);
	const part = (zoom - from.zoom) / (to.zoom - from.zoom);
	return { x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part, zoom };
}

export function switchEase(progress) {
	const value = Math.max(0, Math.min(1, progress));
	return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

function partOf(progress, start, end) {
	return Math.max(0, Math.min(1, (progress - start) / (end - start)));
}

// ---------- the way from one scene to another ----------

// The steps from one scene to another:
//   a scene embedded in the one shown      a portal in: into the card, then the scene
//   the scene shown embedded in the other  a portal out: the same way back
//   nodes in common                       a morph: they move, the others fade
//   a scene embedding both, above them     out to it, then in
//   two views of one scene                 a morph
//   nothing in common                     a morph still: one fades out, the other in
//
// A card may show another view of a scene than the one focusing it arrives at, and the end
// of a portal is exactly what the card shows. So a portal goes to what the card shows, and
// a morph follows to the view asked for; on the way out, in the opposite order. A card with
// a hover view opens through it, and shows it for as long as the portal lasts.
//
//   embedOf(from, to)     the node of the scene `from` embedding `to`, or undefined;
//                         its `path` says the view the card shows for a portal
//   isShared(from, to)    whether the two scenes have nodes in common
//   embedderOf(path)      the nearest scene above a path that embeds it, or ''
export function switchRouteFind(from, to, { embedOf, isShared, embedderOf }) {
	if (from === to) return [];
	const morphOf = (start, end) => ({ type: 'morph', from: start, to: end });
	const portalOf = (direction, parent, child, embed) => ({ type: 'portal', direction, parent, child, nodeId: embed.id, ...(embed.itemId ? { itemId: embed.itemId } : {}) });
	const portalIn = (parent, child) => {
		const embed = embedOf(parent, child);
		const shown = embed.path ?? child;
		return [portalOf('in', parent, shown, embed), ...(shown === child ? [] : [morphOf(shown, child)])];
	};
	const portalOut = (parent, child) => {
		const embed = embedOf(parent, child);
		const shown = embed.path ?? child;
		return [...(shown === child ? [] : [morphOf(child, shown)]), portalOf('out', parent, shown, embed)];
	};
	if (switchPathViewRead(from).path === switchPathViewRead(to).path) return [morphOf(from, to)];
	if (embedOf(from, to)) return portalIn(from, to);
	if (embedOf(to, from)) return portalOut(to, from);
	if (isShared(from, to)) return [morphOf(from, to)];
	const chainOf = (path) => {
		const chain = [path];
		for (let current = embedderOf(path); current && chain.length < 6 && !chain.includes(current); current = embedderOf(current)) chain.push(current);
		return chain;
	};
	const chainFrom = chainOf(from);
	const chainTo = chainOf(to);
	const common = chainFrom.find((path) => chainTo.includes(path));
	if (!common) return [morphOf(from, to)];
	const stepList = [];
	for (let index = 0; chainFrom[index] !== common; index += 1) stepList.push(...portalOut(chainFrom[index + 1], chainFrom[index]));
	const indexTo = chainTo.indexOf(common);
	for (let index = indexTo; index > 0; index -= 1) stepList.push(...portalIn(chainTo[index], chainTo[index - 1]));
	return stepList;
}

export function switchStepSecondGet(step, transition = {}) {
	const second = step.type === 'portal' ? transition.secondPortal ?? SWITCH_SECOND_PORTAL
		: step.type === 'camera' ? transition.secondCamera ?? SWITCH_SECOND_CAMERA
		: step.type === 'scroll' ? transition.secondScroll ?? SWITCH_SECOND_SCROLL
		: transition.secondMorph ?? SWITCH_SECOND_MORPH;
	return Math.max(0, Number(second) || 0);
}

// ---------- a morph ----------

// the content of two nodes of one id is the same (they move as one), or not (the
// old card fades out and the new one in, both moving). a kind may ignore a part of
// its data that may change in place, by its contract's morphKeyGet
function nodeContentKey(node, registry) {
	const morphKeyGet = registry?.kindByType[node.renderer?.type]?.contract?.morphKeyGet;
	return JSON.stringify([node.renderer, morphKeyGet ? morphKeyGet(node.data) : node.data]);
}

function sizeNumber(value) {
	return typeof value === 'number' ? value : undefined;
}

function edgeSignature(edge) {
	return JSON.stringify([edge.source, edge.sourceHandle, edge.target, edge.targetHandle, edge.data?.connection?.label?.text, edge.style]);
}

// the nodes and edges of a morph: what is in both moves; what is in one fades. the
// node handed to React Flow is the target's, with the handles of both, so the lines
// of the scene left still have a handle while they fade
export function switchMorphBuild({ nodeListFrom, edgeListFrom, nodeListTo, edgeListTo, registry }) {
	const nodeFromById = new Map(nodeListFrom.map((node) => [node.id, node]));
	const nodeToById = new Map(nodeListTo.map((node) => [node.id, node]));
	const renamedFromById = new Map();
	const itemList = [];
	const placeOf = (node) => ({ x: node.position.x, y: node.position.y, width: sizeNumber(node.data?.node?.size?.width) ?? sizeNumber(node.style?.width), height: sizeNumber(node.data?.node?.size?.height) ?? sizeNumber(node.style?.height) });
	let sharedCount = 0;
	for (const nodeTo of nodeListTo) {
		const nodeFrom = nodeFromById.get(nodeTo.id);
		if (!nodeFrom || !nodeTo.data?.node || !nodeFrom.data?.node) {
			itemList.push({ flow: nodeTo, from: placeOf(nodeTo), to: placeOf(nodeTo), role: nodeFrom ? 'same' : 'in' });
			continue;
		}
		if (nodeContentKey(nodeFrom.data.node, registry) === nodeContentKey(nodeTo.data.node, registry)) {
			const handles = [...nodeTo.data.node.handles, ...nodeFrom.data.node.handles.filter((handle) => !nodeTo.data.node.handles.some((item) => item.id === handle.id))];
			itemList.push({ flow: { ...nodeTo, data: { node: { ...nodeTo.data.node, handles } } }, from: placeOf(nodeFrom), to: placeOf(nodeTo), role: 'same' });
			sharedCount += 1;
		} else {
			const idOut = `~from:${nodeFrom.id}`;
			renamedFromById.set(nodeFrom.id, idOut);
			itemList.push({ flow: { ...nodeFrom, id: idOut }, from: placeOf(nodeFrom), to: { ...placeOf(nodeTo), width: placeOf(nodeFrom).width, height: placeOf(nodeFrom).height }, role: 'out' });
			itemList.push({ flow: nodeTo, from: { ...placeOf(nodeFrom), width: placeOf(nodeTo).width, height: placeOf(nodeTo).height }, to: placeOf(nodeTo), role: 'in' });
			sharedCount += 1;
		}
	}
	for (const nodeFrom of nodeListFrom) {
		if (!nodeToById.has(nodeFrom.id)) itemList.push({ flow: nodeFrom, from: placeOf(nodeFrom), to: placeOf(nodeFrom), role: 'out' });
	}
	const edgeItemList = [];
	const edgeToById = new Map(edgeListTo.map((edge) => [edge.id, edge]));
	for (const edgeFrom of edgeListFrom) {
		const edgeTo = edgeToById.get(edgeFrom.id);
		if (edgeTo && edgeSignature(edgeTo) === edgeSignature(edgeFrom) && !renamedFromById.has(edgeFrom.source) && !renamedFromById.has(edgeFrom.target)) continue;
		edgeItemList.push({
			flow: { ...edgeFrom, id: edgeTo ? `~from:${edgeFrom.id}` : edgeFrom.id, source: renamedFromById.get(edgeFrom.source) ?? edgeFrom.source, target: renamedFromById.get(edgeFrom.target) ?? edgeFrom.target },
			role: 'out',
		});
	}
	const edgeOutIdSet = new Set(edgeItemList.filter((item) => item.flow.id.startsWith('~from:')).map((item) => item.flow.id.slice(6)));
	const edgeFromById = new Map(edgeListFrom.map((edge) => [edge.id, edge]));
	for (const edgeTo of edgeListTo) {
		edgeItemList.push({ flow: edgeTo, role: edgeFromById.has(edgeTo.id) && !edgeOutIdSet.has(edgeTo.id) ? 'same' : 'in' });
	}
	return { itemList, edgeItemList, sharedCount };
}

// where the nodes of a morph are at a progress: { id, x, y, width?, height? } of those
// that move, and the opacities of those that fade.
export function switchMorphFrameAt(morph, progress) {
	const isShared = morph.sharedCount > 0;
	// without a node in common the two scenes do not overlap: one leaves, then the other comes
	const fadeOut = 1 - partOf(progress, 0, isShared ? 0.55 : 0.45);
	const fadeIn = partOf(progress, isShared ? 0.35 : 0.55, 1);
	const moveList = [];
	for (const item of morph.itemList) {
		const { from, to } = item;
		if (from.x === to.x && from.y === to.y && from.width === to.width && from.height === to.height) continue;
		moveList.push({
			id: item.flow.id,
			x: from.x + (to.x - from.x) * progress,
			y: from.y + (to.y - from.y) * progress,
			width: from.width !== undefined && to.width !== undefined ? from.width + (to.width - from.width) * progress : to.width,
			height: from.height !== undefined && to.height !== undefined ? from.height + (to.height - from.height) * progress : to.height,
		});
	}
	return { moveList, fadeOut, fadeIn };
}

const idSelector = (id) => JSON.stringify(String(id));

// a frame of a morph as a stylesheet of the block
export function switchMorphStyleBuild(morph, frame, scope) {
	const ruleOf = (itemList, attribute, opacity) => (itemList.length ? `${itemList.map((item) => `${scope} ${attribute}[data-id=${idSelector(item.flow.id)}]`).join(',')}{opacity:${opacity.toFixed(3)}}` : '');
	const nodeOut = morph.itemList.filter((item) => item.role === 'out');
	const nodeIn = morph.itemList.filter((item) => item.role === 'in');
	const edgeOut = morph.edgeItemList.filter((item) => item.role === 'out');
	const edgeIn = morph.edgeItemList.filter((item) => item.role === 'in');
	const labelRule = (itemList, opacity) => (itemList.length ? `${itemList.map((item) => `${scope} [data-edge-id=${idSelector(item.flow.id)}]`).join(',')}{opacity:${opacity.toFixed(3)}}` : '');
	return [
		ruleOf(nodeOut, '.react-flow__node', frame.fadeOut), ruleOf(nodeIn, '.react-flow__node', frame.fadeIn),
		ruleOf(edgeOut, '.react-flow__edge', frame.fadeOut), ruleOf(edgeIn, '.react-flow__edge', frame.fadeIn),
		labelRule(edgeOut, frame.fadeOut), labelRule(edgeIn, frame.fadeIn),
	].join('\n');
}

// ---------- a portal ----------

// a frame of a portal as a stylesheet: `amount` runs from 0, the parent as it is, to
// 1, the card opened over the whole viewport: the others fade, the card loses its
// frame and its title, and its clip opens by `clipOpen` (in its local pixels), so
// what lay outside the box of the embedded scene comes into view.
export function switchPortalStyleBuild(nodeId, amount, clipOpen, scope) {
	const node = `${scope} .react-flow__node[data-id=${idSelector(nodeId)}]`;
	const fade = 1 - partOf(amount, 0.05, 0.7);
	const chrome = 1 - partOf(amount, 0.4, 0.9);
	const open = partOf(amount, 0.35, 1);
	return [
		`${scope} .react-flow__node:not([data-id=${idSelector(nodeId)}]){opacity:${fade.toFixed(3)}}`,
		`${scope} .react-flow__edge,${scope} [data-edge-id]{opacity:${fade.toFixed(3)}}`,
		`${node}{z-index:4000 !important}`,
		`${node} .doc-switch-embed-chrome{opacity:${chrome.toFixed(3)}}`,
		`${node} .doc-switch-embed{background:color-mix(in srgb,var(--color-fd-background) ${(chrome * 100).toFixed(1)}%,transparent);border-color:transparent;box-shadow:none}`,
		`${node} .doc-switch-embed-body{overflow:visible;clip-path:inset(${(-clipOpen * open).toFixed(1)}px);background:none}`,
		`${node} .doc-switch-embed-world{--doc-switch-open:${(clipOpen * open * 4).toFixed(1)}px}`,
	].join('\n');
}

// a frame of a portal into an item of a scrolling stack. the scroll area clips what is
// inside it, so the embedded scene is not opened in place: its static drawing stands
// over the canvas (the mask), and here the item it left and everything else fade.
export function switchPortalItemStyleBuild(nodeId, itemId, amount, scope) {
	const node = `${scope} .react-flow__node[data-id=${idSelector(nodeId)}]`;
	const fade = 1 - partOf(amount, 0.05, 0.7);
	const chrome = 1 - partOf(amount, 0.4, 0.9);
	const item = `[data-stack-item=${idSelector(itemId)}]`;
	return [
		`${scope} .react-flow__node:not([data-id=${idSelector(nodeId)}]){opacity:${fade.toFixed(3)}}`,
		`${scope} .react-flow__edge,${scope} [data-edge-id]{opacity:${fade.toFixed(3)}}`,
		`${node} .doc-switch-stack{background:color-mix(in srgb,var(--color-fd-background) ${(chrome * 100).toFixed(1)}%,transparent);border-color:transparent;box-shadow:none}`,
		`${node} .doc-switch-stack-chrome{opacity:${chrome.toFixed(3)}}`,
		`${node} .doc-switch-stack-item:not(${item}){opacity:${fade.toFixed(3)}}`,
		`${node} ${item}{background:none;border-color:transparent;box-shadow:none}`,
		`${node} ${item} .doc-switch-stack-item-chrome{opacity:${chrome.toFixed(3)}}`,
		`${node} ${item} .doc-switch-stack-item-body{visibility:hidden}`,
	].join('\n');
}

// how far the mask of such a portal is open: from the part of the item in view, in
// pixels of the viewport, to the whole viewport
export function switchMaskClipBuild(rect, viewport, open) {
	const top = Math.max(0, rect.y) * (1 - open);
	const left = Math.max(0, rect.x) * (1 - open);
	const bottom = Math.max(0, viewport.height - rect.y - rect.height) * (1 - open);
	const right = Math.max(0, viewport.width - rect.x - rect.width) * (1 - open);
	return `inset(${top.toFixed(1)}px ${right.toFixed(1)}px ${bottom.toFixed(1)}px ${left.toFixed(1)}px)`;
}
