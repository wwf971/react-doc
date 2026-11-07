import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';

// The pure part of the switching layer (card-diagram-flexible-switch.md): paths,
// documents, the tabs of a view, bounding boxes and cameras, the way from one view
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

export function switchPresentationBuild(path, isEmbedded = false) {
	return { path: switchPathNormalize(path), isEmbedded, isFocused: !isEmbedded };
}

export function switchStackPresentationBuild(data, presentation) {
	if (!data.focusPath) return presentation;
	const path = switchPathNormalize(data.focusPath);
	return switchPresentationBuild(path, presentation.isEmbedded || presentation.path !== path);
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

// ---------- paths ----------

// a path of a view: "/" separates its segments, always from the root, as a path
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

// a path may name an item of a scrolling stack of its view: /overview/plan#batch
export function switchPathHashRead(path) {
	const [pathOnly, itemId] = String(path ?? '').split('#');
	return { path: switchPathNormalize(pathOnly), itemId: itemId || '' };
}

export function switchPathLast(path) {
	const normalized = switchPathNormalize(path);
	return normalized.slice(normalized.lastIndexOf('/') + 1);
}

// ---------- the document of a block ----------

function mapping(value, field) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be a mapping.`);
	return value;
}

// the box of a view written by hand: { x, y, width, height }
export function switchRectRead(value, field) {
	mapping(value, field);
	const rect = { x: Number(value.x), y: Number(value.y), width: Number(value.width), height: Number(value.height) };
	if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
		throw new Error(`${field} must be { x, y, width, height } with a positive size.`);
	}
	return rect;
}

// the document of a CardDiagramSwitch block: its views by path. A view holds a
// diagram of the card diagram format, or names another view and arranges some of
// its nodes in tabs (one more view per tab, below its path).
export function switchDocNormalize(input) {
	const value = typeof input === 'string' ? yamlParse(input) : input;
	mapping(value, 'the document');
	if (value.version !== 1) throw new Error('A switch document needs version: 1.');
	if (!Array.isArray(value.viewList) || value.viewList.length === 0) throw new Error('A switch document needs a viewList with at least one view.');
	const viewByPath = new Map();
	for (const view of value.viewList) {
		mapping(view, 'a view');
		if (typeof view.path !== 'string' || !view.path.trim()) throw new Error('Every view needs a path.');
		const path = switchPathNormalize(view.path);
		if (viewByPath.has(path)) throw new Error(`The view ${path} is written twice.`);
		if (!view.diagram && !view.tabs) throw new Error(`The view ${path} needs a diagram, or tabs.`);
		if (view.tabs) switchTabsRead(view.tabs, path);
		viewByPath.set(path, {
			...view,
			path,
			label: String(view.label ?? switchPathLast(path)),
			description: String(view.description ?? ''),
			labelItemList: view.labelItemList,
			box: view.box === undefined ? undefined : switchRectRead(view.box, `${path}.box`),
		});
	}
	for (const view of viewByPath.values()) {
		if (view.tabs && !viewByPath.has(switchPathNormalize(view.tabs.of))) throw new Error(`The tabs of ${view.path} name a view that does not exist: ${view.tabs.of}.`);
	}
	const root = switchPathNormalize(value.root ?? value.viewList[0].path);
	if (!viewByPath.has(root)) throw new Error(`The root ${root} is not a view.`);
	return { title: String(value.title ?? ''), root, height: value.height, transition: value.transition ?? {}, defaults: value.defaults, viewByPath };
}

// the views of a document, as the layer asks for them. onBoxSave: what a box the
// reader adjusted does (rewrites the block, when the block can be written)
export function switchProviderFromDoc(spec, { onBoxSave } = {}) {
	const tabsOwnerOf = (path) => {
		const parent = switchPathParent(path);
		const view = spec.viewByPath.get(parent);
		return view?.tabs && view.tabs.memberList.some((member) => member.id === switchPathLast(path)) ? view : null;
	};
	const diagramOf = (view, focus) => {
		if (!view.tabs) return view.diagram;
		const base = spec.viewByPath.get(switchPathNormalize(view.tabs.of));
		return switchTabsApply(base.diagram, view.tabs, focus, view.path);
	};
	const childPathList = (path) => {
		const list = [...spec.viewByPath.keys()].filter((key) => switchPathParent(key) === path);
		const view = spec.viewByPath.get(path);
		if (view?.tabs) list.push(...view.tabs.memberList.map((member) => `${path}/${member.id}`));
		return list;
	};
	const descriptionOf = (path) => {
		const owner = tabsOwnerOf(path);
		if (owner) return owner.tabs.memberList.find((member) => member.id === switchPathLast(path))?.description ?? '';
		return spec.viewByPath.get(path)?.description ?? '';
	};
	const provider = {
		root: spec.root,
		title: spec.title,
		transition: spec.transition,
		labelGet: (path) => {
			const owner = tabsOwnerOf(path);
			if (owner) return owner.tabs.memberList.find((member) => member.id === switchPathLast(path))?.label ?? switchPathLast(path);
			return spec.viewByPath.get(path)?.label ?? switchPathLast(path);
		},
		childListGet: (path) => childPathList(path).map((child) => ({ path: child, label: provider.labelGet(child), description: descriptionOf(child), labelItemList: spec.viewByPath.get(child)?.labelItemList })),
		viewGet: (path) => {
			const owner = tabsOwnerOf(path);
			const view = owner ?? spec.viewByPath.get(path);
			if (!view) return null;
			const diagram = diagramOf(view, owner ? switchPathLast(path) : undefined);
			return { path, label: provider.labelGet(path), description: descriptionOf(path), diagram: { defaults: spec.defaults, ...diagram }, box: owner ? undefined : view.box };
		},
		boxSave: onBoxSave,
	};
	return provider;
}

// ---------- the tabs of a view ----------

function switchTabsRead(tabs, path) {
	mapping(tabs, `${path}.tabs`);
	if (typeof tabs.of !== 'string') throw new Error(`The tabs of ${path} need "of": the view whose nodes they arrange.`);
	if (!Array.isArray(tabs.memberList) || tabs.memberList.length < 2) throw new Error(`The tabs of ${path} need a memberList of at least two nodes.`);
	mapping(tabs.position, `${path}.tabs.position`);
	mapping(tabs.size, `${path}.tabs.size`);
	const idSet = new Set();
	for (const member of tabs.memberList) {
		if (!member?.id) throw new Error(`A member of the tabs of ${path} needs an id: a node of the view.`);
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
export function switchTabsApply(diagram, tabs, focusInput, viewPath) {
	const { memberList, position, size } = tabs;
	const headerId = tabs.id ?? 'tabs';
	const focus = memberList.some((member) => member.id === focusInput) ? focusInput : memberList[0].id;
	const memberSet = new Set(memberList.map((member) => member.id));
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	for (const member of memberList) {
		if (!nodeById.has(member.id)) throw new Error(`The tabs name a node the view does not have: ${member.id}.`);
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
		renderer: { type: 'view-tabs' },
		position: { x: position.x, y: position.y },
		size: { width: size.width, height: SWITCH_TAB_HEADER_HEIGHT },
		data: {
			focus,
			tabList: memberList.map((member) => ({ id: member.id, label: member.label ?? member.id, tone: member.tone, link: member.link ?? (viewPath ? `${viewPath}/${member.id}` : undefined) })),
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

// how the world of an embedded view is placed in the body of its card: the box
// fits the body with a small margin, centered. local = scale * child + (tx, ty)
export function switchEmbedMapBuild(body, box, padding = SWITCH_EMBED_PADDING) {
	const inner = 1 - 2 * padding;
	const scale = Math.min((body.width * inner) / box.width, (body.height * inner) / box.height);
	return { scale, tx: (body.width - box.width * scale) / 2 - box.x * scale, ty: (body.height - box.height * scale) / 2 - box.y * scale };
}

// how an item of a scrolling stack holds a view: the box fits the width of the item
// and the item is as tall as that makes it, so a stack never shrinks a view to make
// everything visible at once; a wide box does not enlarge past a limit.
export function switchStackItemLayout(width, box, padding = SWITCH_EMBED_PADDING) {
	const pad = width * padding;
	const scale = Math.min(SWITCH_STACK_ITEM_SCALE_MAX, (width - 2 * pad) / box.width);
	return {
		height: box.height * scale + 2 * pad,
		map: { scale, tx: (width - box.width * scale) / 2 - box.x * scale, ty: pad - box.y * scale },
	};
}

// an embedding names a part of a view: what lies outside that box stays out. the margin
// is opened by a portal (--doc-switch-open), so the rest comes into view as the box grows
export function switchBoxClipBuild(box) {
	const open = 'var(--doc-switch-open, 0px)';
	return `inset(calc(${box.y}px - ${open}) calc(${-(box.x + box.width)}px - ${open}) calc(${-(box.y + box.height)}px - ${open}) calc(${box.x}px - ${open}))`;
}

// the inverse of switchCameraParentOf: the camera of the embedded view at a camera of the parent
export function switchCameraChildOf(cameraParent, body, map) {
	return { x: cameraParent.x + (body.x + map.tx) * cameraParent.zoom, y: cameraParent.y + (body.y + map.ty) * cameraParent.zoom, zoom: cameraParent.zoom * map.scale };
}

// the camera of the parent view which draws an embedded view exactly where the
// camera of that view would: what makes the swap between the two invisible.
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

// ---------- the way from one view to another ----------

// The steps from one view to another:
//   a view embedded in the one shown      a portal in: into the card, then the view
//   the view shown embedded in the other  a portal out: the same way back
//   nodes in common                       a morph: they move, the others fade
//   a view embedding both, above them     out to it, then in
//   nothing in common                     a morph still: one fades out, the other in
//
//   embedOf(from, to)     the node of the view `from` embedding `to`, or undefined
//   isShared(from, to)    whether the two views have nodes in common
//   embedderOf(path)      the nearest view above a path that embeds it, or ''
export function switchRouteFind(from, to, { embedOf, isShared, embedderOf }) {
	if (from === to) return [];
	const portalOf = (direction, parent, child) => {
		const embed = embedOf(parent, child);
		return { type: 'portal', direction, parent, child, nodeId: embed.id, ...(embed.itemId ? { itemId: embed.itemId } : {}) };
	};
	const portalIn = (parent, child) => portalOf('in', parent, child);
	const portalOut = (parent, child) => portalOf('out', parent, child);
	if (embedOf(from, to)) return [portalIn(from, to)];
	if (embedOf(to, from)) return [portalOut(to, from)];
	if (isShared(from, to)) return [{ type: 'morph', from, to }];
	const chainOf = (path) => {
		const chain = [path];
		for (let current = embedderOf(path); current && chain.length < 6 && !chain.includes(current); current = embedderOf(current)) chain.push(current);
		return chain;
	};
	const chainFrom = chainOf(from);
	const chainTo = chainOf(to);
	const common = chainFrom.find((path) => chainTo.includes(path));
	if (!common) return [{ type: 'morph', from, to }];
	const stepList = [];
	for (let index = 0; chainFrom[index] !== common; index += 1) stepList.push(portalOut(chainFrom[index + 1], chainFrom[index]));
	const indexTo = chainTo.indexOf(common);
	for (let index = indexTo; index > 0; index -= 1) stepList.push(portalIn(chainTo[index], chainTo[index - 1]));
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
// of the view left still have a handle while they fade
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
	// without a node in common the two views do not overlap: one leaves, then the other comes
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
// what lay outside the box of the embedded view comes into view.
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
// inside it, so the embedded view is not opened in place: its static drawing stands
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
