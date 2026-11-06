import { makeAutoObservable, observable, runInAction } from 'mobx';
import { applyNodeChanges } from '@xyflow/react';
import { yamlStringify } from '../../../../main/frontend/src/lib/yaml.js';
import { DiagramERStore } from '../card-diagram/DiagramERStore.js';
import { diagramPositionsGet } from '../card-diagram/DiagramERData.js';
import {
	SWITCH_EMBED_CHROME_HEIGHT, switchCameraBetween, switchCameraChildOf, switchCameraFit, switchCameraParentOf, switchEase, switchEmbedMapBuild, switchMaskClipBuild, switchMorphBuild,
	switchMorphFrameAt, switchMorphStyleBuild, switchPathChain, switchPathHashRead, switchPathNormalize, switchPathParent, switchPortalItemStyleBuild, switchPortalStyleBuild, switchRectUnion,
	switchRouteFind, switchStackItemLayout, switchStepSecondGet,
} from './SwitchData.js';

const VIEW_BOX_TYPE = 'view-box';
const VIEW_EMBED_TYPE = 'view-embed';
const VIEW_STACK_TYPE = 'view-stack';
const STACK_ITEM_MARGIN = 10;
const FLOW_READY_FRAME_MIN = 2;
const FLOW_READY_MS_MAX = 450;
const MEASURE_MS_MAX = 500;

const isMotionReduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The state of one switching viewport (card-diagram-flexible-switch.md). It knows
// the views through a provider (a document, or anything generating them from data),
// holds a canvas store of the card diagram framework per view it has seen, and the
// nodes and edges the one React Flow canvas of the block draws now.
//
//   pathCurrent        the view shown, or the view a transition goes to
//   pathFlow           the view whose nodes are on the canvas (in a portal: the parent)
//   nodeListFlow, edgeListFlow   what React Flow is given; nodes of a view keep their identity
//   plan               the steps of the transition running, null at rest
//   mask               { path, camera } the static drawing over the canvas while its nodes
//                      are replaced, so a swap of nodes is never seen
//   isBoxAdjust        the bounding box of the view is shown and can be moved and resized
//
// A transition is a list of steps; a step is drawn by frameApply(progress), from any
// clock: stepRun below (requestAnimationFrame), or remotion's frame (seek). Between
// two steps the nodes of the canvas change, under the mask.
export class SwitchStore {
	provider = null;
	pathCurrent = '';
	pathFlow = '';
	nodeListFlow = [];
	edgeListFlow = [];
	plan = null;
	stepIndex = -1;
	mask = null;
	isCameraReady = false;
	isBoxAdjust = false;
	historyList = [];
	message = '';
	box = null;
	measureVersion = 0;
	measurePathList = [];
	flowVersion = 0;
	flowIsInitialized = false;
	captureHint = null;

	constructor({ provider, registry, resolve, pathInitial = '', scope = '' }) {
		this.registry = registry;
		this.resolve = resolve;
		this.scope = scope;
		this.entryByPath = new Map();
		this.cameraByPath = new Map();
		this.embedBodyByKey = new Map();
		this.stackElementByKey = new Map();
		this.stackScrollByKey = new Map();
		this.stackScrollKeyByKey = new Map();
		this.stackAreaByKey = new Map();
		this.stackItemByKey = new Map();
		this.itemInitial = '';
		this.maskElement = null;
		this.maskWorldElement = null;
		this.styleElement = null;
		this.viewportApi = null;
		this.captureHintTimer = 0;
		this.flowWaiterList = [];
		this.measureWaiterList = [];
		this.morph = null;
		this.step = null;
		this.providerVersion = 0;
		this.runToken = 0;
		this.isSeekBusy = false;
		makeAutoObservable(this, {
			isSeekBusy: false, seek: false, seekEnd: false, showAt: false, planRun: false, stepEnter: false, stepExit: false, pathSet: false, stepRun: false, registry: false, resolve: false, scope: false, entryByPath: false, cameraByPath: false, embedBodyByKey: false, stackElementByKey: false, stackScrollByKey: false, stackAreaByKey: false, stackItemByKey: false, itemInitial: false, maskElement: false, maskWorldElement: false, styleElement: false, viewportApi: false,
			captureHintTimer: false, flowWaiterList: false, measureWaiterList: false, morph: false, step: false, providerVersion: false, runToken: false, stackScrollKeyByKey: false,
			provider: observable.ref, nodeListFlow: observable.shallow, edgeListFlow: observable.shallow, plan: observable.ref, mask: observable.ref, box: observable.ref,
			historyList: observable.ref, measurePathList: observable.ref, captureHint: observable.ref,
		}, { autoBind: true });
		this.providerSet(provider, pathInitial);
	}

	// ---------- the views ----------

	// new views: the cached ones are forgotten; the block stays where it is when
	// that view still exists
	providerSet(provider, pathInitial = '') {
		this.provider = provider;
		this.providerVersion += 1;
		this.entryByPath.clear();
		this.embedBodyByKey.clear();
		this.stackScrollKeyByKey.clear();
		this.runToken += 1;
		this.plan = null;
		this.step = null;
		this.morph = null;
		this.mask = null;
		const wanted = switchPathHashRead(pathInitial || this.pathCurrent || provider.root);
		const pathWanted = wanted.path;
		if (wanted.itemId) this.itemInitial = wanted.itemId;
		const path = provider.viewGet(pathWanted) ? pathWanted : provider.root;
		if (pathInitial && path !== pathWanted) this.message = `There is no view ${pathWanted}.`;
		this.pathCurrent = path;
		this.flowSet(path);
		this.styleWrite('');
		this.measureVersion += 1;
	}

	entryGet(path) {
		let entry = this.entryByPath.get(path);
		if (entry) return entry;
		let desc = null;
		let error = '';
		try {
			desc = this.provider.viewGet(path);
		} catch (cause) {
			error = String(cause?.message ?? cause);
		}
		if (!desc && !error) return null;
		const canvas = new DiagramERStore('', this.resolve, 620, this.registry);
		entry = { path, desc: desc ?? { path, label: path, diagram: { nodes: [] } }, canvas };
		this.entrySourceLoad(entry);
		if (error) canvas.loadState = { status: 'error', message: error };
		this.entryByPath.set(path, entry);
		return entry;
	}

	// a box written in the view's description is a bounding box node of the diagram,
	// the one form the rest of the layer reads
	entrySourceLoad(entry) {
		const { diagram, box } = entry.desc;
		const nodes = [...(diagram.nodes ?? [])];
		if (box && !nodes.some((node) => node.renderer?.type === VIEW_BOX_TYPE)) {
			nodes.push({ id: 'view-box', renderer: { type: VIEW_BOX_TYPE }, position: { x: box.x, y: box.y }, size: { width: box.width, height: box.height }, data: {} });
		}
		entry.canvas.sourceLoad(yamlStringify({ version: 1, ...diagram, nodes }));
	}

	graphNodeListOf(entry) {
		return entry?.canvas.graph?.nodes ?? [];
	}

	// what shows another view in a view: a card, or an item of a scrolling stack
	embedListOf(path) {
		return this.graphNodeListOf(this.entryGet(path)).flatMap((node) => {
			if (node.renderer.type === VIEW_EMBED_TYPE) return [{ id: node.id, node, view: switchPathNormalize(node.data.view), box: node.data.box, padding: node.data.padding }];
			if (node.renderer.type === VIEW_STACK_TYPE) return (node.data.itemList ?? []).filter((item) => item.view).map((item) => ({ id: node.id, itemId: item.id, node, view: switchPathNormalize(item.view), box: item.box, padding: item.padding }));
			return [];
		});
	}

	embedOf(parent, child) {
		return this.embedListOf(parent).find((embed) => embed.view === child);
	}

	// the nearest view above a path that embeds it; else the first view above it
	embedderOf(path) {
		for (const parent of switchPathChain(switchPathParent(path)).reverse()) {
			if (this.embedOf(parent, path)) return parent;
		}
		return '';
	}

	isSharedBetween(from, to) {
		const idSetFrom = new Set(this.graphNodeListOf(this.entryGet(from)).map((node) => node.id));
		return this.graphNodeListOf(this.entryGet(to)).some((node) => node.renderer.type !== VIEW_BOX_TYPE && idSetFrom.has(node.id));
	}

	labelGet(path) {
		return this.provider.labelGet(path);
	}

	get pathChain() {
		return switchPathChain(this.pathCurrent);
	}

	get descCurrent() {
		return this.entryGet(this.pathCurrent)?.desc ?? null;
	}

	get loadError() {
		const state = this.entryGet(this.pathCurrent)?.canvas.loadState;
		return state?.status === 'error' ? state.message : '';
	}

	// a segment of the path: the views beside it, for its menu
	siblingListGet(path) {
		const parent = switchPathParent(path);
		return parent ? this.provider.childListGet(parent) : [];
	}

	// ---------- geometry ----------

	measurementSet(path, nodeId, size) {
		const entry = this.entryByPath.get(path);
		if (!entry) return;
		const previous = entry.canvas.measurements[nodeId];
		if (previous && Math.abs(previous.width - size.width) < 0.5 && Math.abs(previous.height - size.height) < 0.5) return;
		entry.canvas.measurementSet(nodeId, size);
		this.measureVersion += 1;
		this.measureWaiterCheck();
	}

	nodeSizeOf(entry, node) {
		const measured = entry.canvas.measurements[node.id];
		return {
			width: node.size.width === 'auto' ? measured?.width ?? node.sizeDefault.width : node.size.width,
			height: node.size.height === 'auto' ? measured?.height ?? node.sizeDefault.height : node.size.height,
		};
	}

	entryPositionsGet(entry) {
		const graph = entry.canvas.graph;
		return graph ? diagramPositionsGet(graph.nodes, graph.layout, entry.canvas.measurements) : new Map();
	}

	// the box of a view: a region named by a bounding box node, a rect, the first
	// bounding box node, or everything drawn
	viewBoxGet(path, region) {
		void this.measureVersion;
		const entry = this.entryGet(path);
		if (!entry?.canvas.graph) return { x: 0, y: 0, width: 100, height: 100 };
		if (region && typeof region === 'object') return region;
		const nodes = entry.canvas.graph.nodes;
		const positions = this.entryPositionsGet(entry);
		const rectOf = (node) => ({ ...positions.get(node.id), ...this.nodeSizeOf(entry, node) });
		const boxNode = region ? nodes.find((node) => node.renderer.type === VIEW_BOX_TYPE && node.id === region) : nodes.find((node) => node.renderer.type === VIEW_BOX_TYPE);
		if (boxNode) return rectOf(boxNode);
		return switchRectUnion(nodes.filter((node) => node.renderer.type !== VIEW_BOX_TYPE).map(rectOf)) ?? { x: 0, y: 0, width: 100, height: 100 };
	}

	// whether the box of a view is one somebody chose: then an embedding shows that part
	// alone. what a view draws has no such edge: its lines may run outside its cards
	viewBoxIsChosen(path, region) {
		return Boolean(region) || this.graphNodeListOf(this.entryGet(path)).some((node) => node.renderer.type === VIEW_BOX_TYPE);
	}

	cameraDefaultGet(path) {
		return switchCameraFit(this.viewBoxGet(path), this.box ?? { width: 800, height: 600 });
	}

	cameraOf(path) {
		return this.cameraByPath.get(path) ?? this.cameraDefaultGet(path);
	}

	embedBodySet(nodeId, view, body) {
		const key = `${nodeId}|${view}`;
		const previous = this.embedBodyByKey.get(key);
		if (previous && previous.x === body.x && previous.y === body.y && previous.width === body.width && previous.height === body.height) return;
		this.embedBodyByKey.set(key, body);
	}

	// the body of an embedding card in the coordinates of the card
	embedBodyGet(node) {
		const view = switchPathNormalize(node.data.view);
		const measured = this.embedBodyByKey.get(`${node.id}|${view}`);
		if (measured) return measured;
		const width = typeof node.size.width === 'number' ? node.size.width : node.sizeDefault.width;
		const height = typeof node.size.height === 'number' ? node.size.height : node.sizeDefault.height;
		return { x: 0, y: SWITCH_EMBED_CHROME_HEIGHT, width, height: height - SWITCH_EMBED_CHROME_HEIGHT };
	}

	// the embedded world in the coordinates of the parent view
	embedPlaceGet(parent, embed) {
		const entry = this.entryGet(parent);
		const { node } = embed;
		const position = this.entryPositionsGet(entry).get(node.id) ?? { x: 0, y: 0 };
		const box = this.viewBoxGet(embed.view, embed.box);
		if (embed.itemId) {
			const key = this.stackKey(parent, node.id);
			const area = this.stackAreaByKey.get(key);
			const item = this.stackItemByKey.get(`${key}|${embed.itemId}`);
			if (area && item) {
				const scroll = this.stackScrollGet(key);
				const body = { x: position.x + area.x + item.x, y: position.y + area.y + item.y - scroll, width: item.width, height: item.height };
				const top = Math.max(body.y, position.y + area.y);
				const bottom = Math.min(body.y + body.height, position.y + area.y + area.height);
				return { body, map: switchStackItemLayout(item.width, box, embed.padding).map, rectVisible: { x: body.x, y: top, width: body.width, height: Math.max(0, bottom - top) } };
			}
		}
		const bodyLocal = this.embedBodyGet(node);
		const body = { ...bodyLocal, x: position.x + bodyLocal.x, y: position.y + bodyLocal.y };
		return { body, map: switchEmbedMapBuild(body, box, embed.padding), rectVisible: body };
	}

	// ---------- a scrolling stack ----------

	// a stack is drawn several times (on the canvas, embedded, over the canvas as the
	// mask): its scroll position is one, here, by the view it belongs to and its node
	stackKey(path, nodeId) {
		const key = `${path}|${nodeId}`;
		const node = this.graphNodeListOf(this.entryGet(path)).find((item) => item.id === nodeId);
		const focusPath = node?.renderer.type === VIEW_STACK_TYPE && node.data.focusPath;
		this.stackScrollKeyByKey.set(key, focusPath ? `${switchPathNormalize(focusPath)}|${nodeId}` : key);
		return key;
	}

	stackScrollGet(key) {
		return this.stackScrollByKey.get(this.stackScrollKeyByKey.get(key) ?? key) ?? 0;
	}

	stackElementAdd(key, element) {
		if (!this.stackElementByKey.has(key)) this.stackElementByKey.set(key, new Set());
		this.stackElementByKey.get(key).add(element);
		element.scrollTop = this.stackScrollGet(key);
	}

	stackElementSync(key, element) {
		const top = this.stackScrollGet(key);
		if (Math.abs(element.scrollTop - top) >= 1) element.scrollTop = top;
	}

	stackElementRemove(key, element) {
		this.stackElementByKey.get(key)?.delete(element);
	}

	stackAreaSet(key, area) {
		this.stackAreaByKey.set(key, area);
		this.measureWaiterCheck();
	}

	stackItemSet(key, itemId, place) {
		this.stackItemByKey.set(`${key}|${itemId}`, place);
		this.measureWaiterCheck();
	}

	// the reader scrolled one drawing: the others follow
	stackScrollReport(key, element) {
		if (this.plan) return;
		const top = this.stackScrollGet(key);
		if (Math.abs(top - element.scrollTop) < 1) return;
		// cut short while its items are still getting their height: not the reader's doing
		if (element.scrollTop < top && element.scrollTop + element.clientHeight >= element.scrollHeight - 1) return;
		element.dataset.isSettled = '1';
		this.stackScrollSet(key, element.scrollTop);
	}

	stackScrollSet(key, top) {
		const keyScroll = this.stackScrollKeyByKey.get(key) ?? key;
		this.stackScrollByKey.set(keyScroll, top);
		for (const [keyElement, elements] of this.stackElementByKey) {
			if ((this.stackScrollKeyByKey.get(keyElement) ?? keyElement) !== keyScroll) continue;
			for (const element of elements) {
				if (Math.abs(element.scrollTop - top) >= 1) element.scrollTop = top;
			}
		}
	}

	// the stack of a view holding an item, by the item's id
	stackOfItem(path, itemId) {
		return this.graphNodeListOf(this.entryGet(path)).find((node) => node.renderer.type === VIEW_STACK_TYPE && (node.data.itemList ?? []).some((item) => item.id === itemId));
	}

	// the scroll position showing an item: where it is, when it is already in view
	stackScrollTargetGet(key, itemId) {
		const area = this.stackAreaByKey.get(key);
		const item = this.stackItemByKey.get(`${key}|${itemId}`);
		const scroll = this.stackScrollGet(key);
		if (!area || !item) return scroll;
		if (item.top >= scroll && item.top + item.fullHeight <= scroll + area.height) return scroll;
		return Math.max(0, Math.min(area.contentHeight - area.height, item.top - STACK_ITEM_MARGIN));
	}

	// a stack scrolled by a program: to an item, or to a position. gliding, or at once
	scrollTo({ path = this.pathCurrent, nodeId, itemId, top, isInstant = false }) {
		const nodeIdFound = nodeId ?? this.stackOfItem(path, itemId)?.id;
		if (!nodeIdFound) return false;
		const key = this.stackKey(path, nodeIdFound);
		const target = top ?? this.stackScrollTargetGet(key, itemId);
		if (isInstant) {
			this.stackScrollSet(key, target);
			return true;
		}
		return this.planRun([{ type: 'scroll', path, nodeId: nodeIdFound, itemId, top: target }], this.pathCurrent);
	}

	// ---------- the nodes on the canvas ----------

	flowNodeDecorate(entry, node) {
		const nodeGraph = node.data?.node;
		if (!nodeGraph) return node;
		const link = nodeGraph.link ?? (nodeGraph.renderer.type === VIEW_EMBED_TYPE ? nodeGraph.data.view : undefined);
		const isBox = nodeGraph.renderer.type === VIEW_BOX_TYPE;
		const measured = entry.canvas.measurements[node.id];
		return {
			...node,
			draggable: isBox && this.isBoxAdjust,
			selectable: false,
			zIndex: isBox ? 900 : node.zIndex,
			className: link ? 'is-linked' : undefined,
			initialWidth: measured?.width,
			initialHeight: measured?.height,
			position: this.entryPositionsGet(entry).get(node.id) ?? node.position,
		};
	}

	flowListOf(path) {
		const entry = this.entryGet(path);
		if (!entry) return { nodeList: [], edgeList: [] };
		return { nodeList: entry.canvas.nodeList.map((node) => this.flowNodeDecorate(entry, node)), edgeList: [...entry.canvas.edgeList] };
	}

	flowSet(path) {
		const { nodeList, edgeList } = this.flowListOf(path);
		this.pathFlow = path;
		this.nodeListFlow = nodeList;
		this.edgeListFlow = edgeList;
		this.flowVersion += 1;
		this.flowIsInitialized = false;
	}

	// what React Flow reports of its nodes: measured sizes, the drag of the box
	nodeListChange(changeList) {
		if (changeList.length === 0) return;
		this.nodeListFlow = applyNodeChanges(changeList, this.nodeListFlow.slice());
	}

	flowInitializedSet(isInitialized) {
		this.flowIsInitialized = isInitialized;
		if (isInitialized) this.flowWaiterCheck();
	}

	flowWaiterCheck() {
		if (!this.flowIsInitialized) return;
		const list = this.flowWaiterList;
		this.flowWaiterList = [];
		for (const resolve of list) resolve();
	}

	// the nodes just put on the canvas are measured, and their lines drawn
	flowReady() {
		return new Promise((resolve) => {
			let isDone = false;
			const done = () => {
				if (isDone) return;
				isDone = true;
				clearTimeout(timer);
				let count = FLOW_READY_FRAME_MIN;
				const frame = () => {
					count -= 1;
					if (count <= 0) resolve();
					else requestAnimationFrame(frame);
				};
				requestAnimationFrame(frame);
			};
			const timer = setTimeout(done, FLOW_READY_MS_MAX);
			this.flowWaiterList.push(done);
			if (this.flowIsInitialized) this.flowWaiterCheck();
		});
	}

	// ---------- measuring a view before it is shown ----------

	isEntryMeasured(entry) {
		return this.graphNodeListOf(entry).every((node) => {
			// where the items of a stack are is known only once it was drawn
			if (node.renderer.type === VIEW_STACK_TYPE) {
				const key = this.stackKey(entry.path, node.id);
				return this.stackAreaByKey.has(key) && (node.data.itemList ?? []).every((item) => this.stackItemByKey.has(`${key}|${item.id}`));
			}
			return node.renderer.type === VIEW_BOX_TYPE || (node.size.width !== 'auto' && node.size.height !== 'auto') || entry.canvas.measurements[node.id];
		});
	}

	measureWaiterCheck() {
		this.measureWaiterList = this.measureWaiterList.filter((waiter) => {
			const isDone = waiter.pathList.every((path) => this.isEntryMeasured(this.entryGet(path)));
			if (!isDone) return true;
			// two frames more: what the view embeds settles; then the host draws nothing
			requestAnimationFrame(() => requestAnimationFrame(() => {
				waiter.resolve();
				if (this.measureWaiterList.length === 0) runInAction(() => { this.measurePathList = []; });
			}));
			return false;
		});
	}

	// the off-screen host (SwitchCanvas) draws these views once, so their sizes are
	// known: a camera and a morph need them before the nodes reach the canvas
	viewsMeasured(pathList) {
		const pending = pathList.filter((path) => {
			const entry = this.entryGet(path);
			return entry && !this.isEntryMeasured(entry);
		});
		if (pending.length === 0) return Promise.resolve();
		this.measurePathList = [...new Set([...this.measurePathList, ...pending])];
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.measureWaiterList = this.measureWaiterList.filter((waiter) => waiter.resolve !== finish);
				if (this.measureWaiterList.length === 0) runInAction(() => { this.measurePathList = []; });
				finish();
			}, MEASURE_MS_MAX);
			const finish = () => {
				clearTimeout(timer);
				resolve();
			};
			this.measureWaiterList.push({ pathList: pending, resolve: finish });
		});
	}

	// ---------- the viewport ----------

	viewportApiSet(api) {
		this.viewportApi = api;
	}

	boxSet(box) {
		if (this.box && this.box.width === box.width && this.box.height === box.height) return;
		this.box = box;
		this.cameraByPath.clear();
		if (!this.plan) this.cameraApply(this.cameraDefaultGet(this.pathCurrent));
	}

	cameraApply(camera) {
		this.viewportApi?.viewportSet(camera);
	}

	// what the canvas reports of its camera. the reader's own view of a path is kept
	// while the block lives, and is where a return to the path arrives
	cameraReport(camera, isFromUser) {
		if (!this.plan && isFromUser && this.isCameraReady) this.cameraByPath.set(this.pathCurrent, { ...camera });
	}

	// the first paint: the nodes are measured, the camera can fit them
	flowFirstReady() {
		if (this.isCameraReady) return;
		this.cameraApply(this.cameraOf(this.pathCurrent));
		this.isCameraReady = true;
		if (this.itemInitial) {
			this.scrollTo({ itemId: this.itemInitial, isInstant: true });
			this.itemInitial = '';
		}
	}

	// the camera back to the default of the view, gliding
	cameraReset() {
		this.cameraByPath.delete(this.pathCurrent);
		return this.planRun([{ type: 'camera', path: this.pathCurrent, cameraTo: this.cameraDefaultGet(this.pathCurrent) }], this.pathCurrent);
	}

	// a state of an animation showing a region of its view
	boxCameraGet(path, region) {
		return switchCameraFit(this.viewBoxGet(path, region), this.box ?? { width: 800, height: 600 });
	}

	styleWrite(text) {
		if (this.styleElement) this.styleElement.textContent = text;
	}

	styleElementSet(element) {
		this.styleElement = element;
	}

	// ---------- switching ----------

	// a click on a card, a line's label, a tab, a segment of the path
	async pathSet(pathInput, { isHistory = true, cameraTo = null } = {}) {
		const { path, itemId } = switchPathHashRead(pathInput);
		if (!this.provider.viewGet(path)) {
			this.message = `There is no view ${path}.`;
			return false;
		}
		this.message = '';
		if (path === this.pathCurrent && !this.plan) {
			if (itemId) return this.scrollTo({ path, itemId });
			if (cameraTo) return this.planRun([{ type: 'camera', path, cameraTo }], path);
			return this.cameraReset();
		}
		if (this.plan) this.planFinishNow();
		if (isHistory) this.historyList = [...this.historyList.slice(-30), this.pathCurrent];
		const stepList = [...this.routeBuild(this.pathCurrent, path), ...(itemId ? [{ type: 'scroll', path, itemId }] : [])];
		return this.planRun(stepList, path, cameraTo);
	}

	back() {
		const list = this.historyList;
		if (list.length === 0) return;
		const path = list[list.length - 1];
		this.historyList = list.slice(0, -1);
		void this.pathSet(path, { isHistory: false });
	}

	routeBuild(from, to) {
		const stepList = switchRouteFind(from, to, {
			embedOf: (parent, child) => this.embedOf(parent, child),
			isShared: (a, b) => this.isSharedBetween(a, b),
			embedderOf: (path) => this.embedderOf(path),
		});
		// into an item of a stack: first the item in view
		return stepList.flatMap((step) => (step.type === 'portal' && step.direction === 'in' && step.itemId ? [{ type: 'scroll', path: step.parent, nodeId: step.nodeId, itemId: step.itemId }, step] : [step]));
	}

	stepPathListOf(stepList) {
		return [...new Set(stepList.flatMap((step) => (step.type === 'portal' ? [step.parent, step.child] : step.type === 'morph' ? [step.from, step.to] : [step.path])))];
	}

	// the transition, from the current view to a path: its steps resolved one after
	// another, each drawn by the clock
	async planRun(stepList, pathTo, cameraTo = null) {
		const token = ++this.runToken;
		await this.viewsMeasured(this.stepPathListOf(stepList));
		if (token !== this.runToken) return false;
		runInAction(() => {
			this.plan = { stepList, pathTo, cameraTo };
			this.pathCurrent = pathTo;
		});
		const isInstant = isMotionReduced();
		for (let index = 0; index < stepList.length; index += 1) {
			if (token !== this.runToken) return false;
			await this.stepEnter(index);
			if (token !== this.runToken) return false;
			await this.stepRun(switchStepSecondGet(stepList[index], this.provider.transition) * (isInstant || this.step?.isNoop ? 0 : 1), token);
			if (token !== this.runToken) return false;
			await this.stepExit(index);
		}
		if (token === this.runToken) this.planEnd();
		return true;
	}

	// a transition cut short: the view it was going to, at once
	planFinishNow() {
		const pathTo = this.plan?.pathTo;
		this.runToken += 1;
		this.plan = null;
		this.step = null;
		this.morph = null;
		this.mask = null;
		this.styleWrite('');
		if (pathTo) {
			this.pathCurrent = pathTo;
			this.flowSet(pathTo);
			this.cameraApply(this.cameraOf(pathTo));
		}
	}

	planEnd() {
		this.plan = null;
		this.step = null;
		this.morph = null;
		this.stepIndex = -1;
		this.styleWrite('');
	}

	// a step resolved: the nodes it draws on the canvas, its two cameras. what it starts
	// from is the camera the viewport has now, so a reader's own view takes part
	async stepEnter(index) {
		const stepInput = this.plan.stepList[index];
		const isLast = index === this.plan.stepList.length - 1;
		const box = this.box ?? { width: 800, height: 600 };
		const cameraNow = this.viewportApi?.viewportGet() ?? this.cameraOf(this.pathFlow);
		const cameraEnd = (path) => (isLast && this.plan.cameraTo ? this.plan.cameraTo : this.cameraOf(path));
		let step = stepInput;
		if (stepInput.type === 'portal') {
			const embed = this.embedOf(stepInput.parent, stepInput.child);
			// back to an item scrolled away: it comes into view first
			if (stepInput.direction === 'out' && embed.itemId) this.scrollTo({ path: stepInput.parent, nodeId: embed.id, itemId: embed.itemId, isInstant: true });
			const { body, map, rectVisible } = this.embedPlaceGet(stepInput.parent, embed);
			const place = { body, map, rectVisible, isOverlay: Boolean(embed.itemId) };
			if (stepInput.direction === 'in') {
				const cameraChild = cameraEnd(stepInput.child);
				step = { ...stepInput, ...place, cameraFrom: cameraNow, cameraTo: switchCameraParentOf(cameraChild, body, map), cameraChild };
			} else {
				step = { ...stepInput, ...place, cameraFrom: switchCameraParentOf(cameraNow, body, map), cameraTo: cameraEnd(stepInput.parent), cameraChild: cameraNow };
			}
			// how far the clip of the card opens: past every side of the viewport, in its local pixels
			const zoomBig = Math.max(stepInput.direction === 'in' ? step.cameraTo.zoom : step.cameraFrom.zoom, 1e-6);
			step.clipOpen = (Math.max(box.width, box.height) / zoomBig) * 1.5;
		} else if (stepInput.type === 'morph') {
			const listFrom = this.flowListOf(stepInput.from);
			const listTo = this.flowListOf(stepInput.to);
			this.morph = switchMorphBuild({ nodeListFrom: listFrom.nodeList, edgeListFrom: listFrom.edgeList, nodeListTo: listTo.nodeList, edgeListTo: listTo.edgeList, registry: this.registry });
			step = { ...stepInput, cameraFrom: cameraNow, cameraTo: cameraEnd(stepInput.to) };
		} else if (stepInput.type === 'scroll') {
			const nodeId = stepInput.nodeId ?? this.stackOfItem(stepInput.path, stepInput.itemId)?.id ?? '';
			const key = this.stackKey(stepInput.path, nodeId);
			const scrollFrom = this.stackScrollGet(key);
			const scrollTo = stepInput.top ?? this.stackScrollTargetGet(key, stepInput.itemId);
			step = { ...stepInput, key, scrollFrom, scrollTo, isNoop: Math.abs(scrollFrom - scrollTo) < 1, cameraFrom: cameraNow, cameraTo: cameraNow };
		} else {
			step = { ...stepInput, cameraFrom: cameraNow, cameraTo: stepInput.cameraTo ?? this.cameraOf(stepInput.path) };
		}
		runInAction(() => {
			this.step = step;
			this.stepIndex = index;
		});
		if (step.type === 'portal') {
			if (this.pathFlow !== step.parent) {
				// out of the embedded view: its drawing stays over the canvas until the
				// nodes of the parent are measured
				runInAction(() => {
					this.mask = step.direction === 'out' ? { path: step.child, camera: step.cameraChild, clip: step.isOverlay ? this.maskClipGet(step, step.cameraFrom, 1) : undefined } : null;
					this.flowSet(step.parent);
				});
				this.cameraApply(step.cameraFrom);
				this.frameApply(0);
				await this.flowReady();
				if (!step.isOverlay) runInAction(() => { this.mask = null; });
			} else {
				if (step.isOverlay) {
					const cameraChild = switchCameraChildOf(step.cameraFrom, step.body, step.map);
					runInAction(() => { this.mask = { path: step.child, camera: cameraChild, clip: this.maskClipGet(step, step.cameraFrom, 0) }; });
				}
				this.frameApply(0);
			}
		} else if (step.type === 'morph') {
			runInAction(() => {
				this.pathFlow = step.to;
				this.nodeListFlow = this.morph.itemList.map((item) => {
					const node = this.nodeListFlow.find((flow) => flow.id === item.flow.id);
					return { ...item.flow, measured: node?.measured ?? item.flow.measured };
				});
				this.edgeListFlow = this.morph.edgeItemList.map((item) => item.flow);
				this.flowVersion += 1;
				this.flowIsInitialized = false;
			});
			this.frameApply(0);
			await this.flowReady();
		} else {
			this.frameApply(0);
		}
	}

	// the clock of a block: requestAnimationFrame
	stepRun(second, token) {
		if (second <= 0) {
			this.frameApply(1);
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			const start = performance.now();
			const frame = (now) => {
				if (token !== this.runToken) { resolve(); return; }
				const progress = Math.min(1, (now - start) / (second * 1000));
				this.frameApply(switchEase(progress));
				if (progress >= 1) resolve();
				else requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		});
	}

	// a step at a progress: the camera moved, the nodes placed, the stylesheet written
	frameApply(progress) {
		const { step } = this;
		if (!step) return;
		if (step.type === 'scroll') {
			this.stackScrollSet(step.key, step.scrollFrom + (step.scrollTo - step.scrollFrom) * progress);
			return;
		}
		const camera = switchCameraBetween(step.cameraFrom, step.cameraTo, progress);
		this.viewportApi?.viewportSet(camera);
		if (step.type === 'portal') {
			const amount = step.direction === 'in' ? progress : 1 - progress;
			if (step.isOverlay) {
				this.styleWrite(switchPortalItemStyleBuild(step.nodeId, step.itemId, amount, this.scope));
				const cameraChild = switchCameraChildOf(camera, step.body, step.map);
				if (this.maskWorldElement) this.maskWorldElement.style.transform = `translate(${cameraChild.x}px, ${cameraChild.y}px) scale(${cameraChild.zoom})`;
				if (this.maskElement) this.maskElement.style.clipPath = this.maskClipGet(step, camera, amount);
			} else {
				this.styleWrite(switchPortalStyleBuild(step.nodeId, amount, step.clipOpen, this.scope));
			}
		} else if (step.type === 'morph') {
			const frame = switchMorphFrameAt(this.morph, progress);
			this.styleWrite(switchMorphStyleBuild(this.morph, frame, this.scope));
			if (frame.moveList.length > 0) this.nodeListMove(frame.moveList);
		}
	}

	// the mask of a portal into a stack item: the part of the item in view, opening
	maskClipGet(step, camera, amount) {
		const rect = step.rectVisible;
		const rectScreen = { x: camera.x + rect.x * camera.zoom, y: camera.y + rect.y * camera.zoom, width: rect.width * camera.zoom, height: rect.height * camera.zoom };
		return switchMaskClipBuild(rectScreen, this.box ?? { width: 800, height: 600 }, Math.min(1, Math.max(0, (amount - 0.1) / 0.6)));
	}

	maskElementSet(element, world) {
		this.maskElement = element;
		this.maskWorldElement = world;
	}

	nodeListMove(moveList) {
		const moveById = new Map(moveList.map((move) => [move.id, move]));
		this.nodeListFlow = this.nodeListFlow.map((node) => {
			const move = moveById.get(node.id);
			if (!move) return node;
			return {
				...node,
				position: { x: move.x, y: move.y },
				style: { ...node.style, ...(move.width !== undefined ? { width: move.width } : {}), ...(move.height !== undefined ? { height: move.height } : {}) },
			};
		});
	}

	// the end of a step: the nodes of the view it arrived at
	async stepExit(index) {
		const { step } = this;
		if (!step) return;
		runInAction(() => { this.step = null; });
		if (step.type === 'portal' && step.direction === 'in') {
			runInAction(() => {
				this.mask = { path: step.child, camera: step.cameraChild };
				this.styleWrite('');
				this.flowSet(step.child);
			});
			this.cameraApply(step.cameraChild);
			await this.flowReady();
			runInAction(() => { this.mask = null; });
		} else if (step.type === 'morph') {
			runInAction(() => {
				this.styleWrite('');
				this.flowSet(step.to);
			});
			this.cameraApply(step.cameraTo);
		} else if (step.type === 'portal') {
			this.styleWrite('');
			this.cameraApply(step.cameraTo);
			if (step.isOverlay) runInAction(() => { this.mask = null; });
		} else if (step.type === 'camera') {
			this.cameraApply(step.cameraTo);
		}
		this.morph = null;
		void index;
	}

	// ---------- played by another clock ----------

	// the steps of a way between two views, for a clock of its own (the animation
	// layer): how long each lasts is known without measuring anything
	routeTimelineGet(from, to, { transition = this.provider.transition, itemId = '' } = {}) {
		const stepList = from === to ? [{ type: 'camera', path: to }] : this.routeBuild(from, to);
		if (itemId) stepList.push({ type: 'scroll', path: to, itemId });
		const secondList = stepList.map((step) => switchStepSecondGet(step, transition));
		return { stepList, secondList, second: secondList.reduce((sum, value) => sum + value, 0) };
	}

	// the view at a progress of a way (animation layer): enters the step the
	// progress is in and draws it. the frame decides everything, also when seeking
	async seek(way, progress) {
		if (this.isSeekBusy) return;
		const total = way.timeline.second || 1;
		let elapsed = progress * total;
		let index = 0;
		while (index < way.timeline.stepList.length - 1 && elapsed > way.timeline.secondList[index]) {
			elapsed -= way.timeline.secondList[index];
			index += 1;
		}
		const part = way.timeline.secondList[index] > 0 ? Math.min(1, elapsed / way.timeline.secondList[index]) : 1;
		if (way.id !== this.plan?.wayId || index !== this.stepIndex) {
			this.isSeekBusy = true;
			if (way.id !== this.plan?.wayId) {
				const stepList = way.timeline.stepList.map((step, position) => (position === way.timeline.stepList.length - 1 && step.type === 'camera' ? { ...step, cameraTo: way.cameraTo } : step));
				runInAction(() => {
					this.plan = { stepList, pathTo: way.to, cameraTo: way.cameraTo, wayId: way.id };
					this.pathCurrent = way.to;
					this.stepIndex = -1;
				});
			} else if (this.stepIndex >= 0) {
				await this.stepExit(this.stepIndex);
			}
			try {
				if (way.id === this.plan?.wayId) await this.stepEnter(index);
			} finally {
				this.isSeekBusy = false;
			}
			return;
		}
		this.frameApply(switchEase(part));
	}

	// the end of a way played by another clock: the view it reached, at rest
	async seekEnd() {
		if (!this.plan) return;
		const pathTo = this.plan.pathTo;
		this.isSeekBusy = true;
		if (this.step) await this.stepExit(this.stepIndex);
		this.isSeekBusy = false;
		runInAction(() => {
			this.planEnd();
			this.pathCurrent = pathTo;
		});
	}

	// a state of an animation shown at once
	async showAt(path, region, itemId = '') {
		runInAction(() => {
			this.runToken += 1;
			this.isSeekBusy = false;
			this.plan = null;
			this.step = null;
			this.morph = null;
			this.mask = null;
			this.stepIndex = -1;
			this.styleWrite('');
			this.pathCurrent = path;
			if (this.pathFlow !== path) this.flowSet(path);
		});
		await this.viewsMeasured([path]);
		this.cameraApply(region ? this.boxCameraGet(path, region) : this.cameraDefaultGet(path));
		if (itemId) this.scrollTo({ path, itemId, isInstant: true });
	}

	// ---------- the bounding box ----------

	boxAdjustToggle() {
		this.isBoxAdjust = !this.isBoxAdjust;
		if (this.isBoxAdjust) this.boxEnsure();
		this.nodeListFlow = this.nodeListFlow.map((node) => (node.data?.node?.renderer.type === VIEW_BOX_TYPE ? { ...node, draggable: this.isBoxAdjust } : node));
	}

	// a view without a box gets one around what it draws: a box of the session until
	// it is moved or resized, which saves it
	boxEnsure() {
		const entry = this.entryGet(this.pathCurrent);
		if (!entry || this.graphNodeListOf(entry).some((node) => node.renderer.type === VIEW_BOX_TYPE)) return;
		entry.desc = { ...entry.desc, box: this.viewBoxGet(this.pathCurrent) };
		this.entrySourceLoad(entry);
		this.measureVersion += 1;
		this.flowSet(this.pathCurrent);
	}

	// the box dropped or resized: it is the box of the view from now on
	boxCommit(nodeId, params) {
		const node = this.nodeListFlow.find((item) => item.id === nodeId);
		if (!node) return;
		const rect = {
			x: Math.round(params?.x ?? node.position.x),
			y: Math.round(params?.y ?? node.position.y),
			width: Math.round(params?.width ?? node.width ?? node.measured?.width ?? node.style?.width),
			height: Math.round(params?.height ?? node.height ?? node.measured?.height ?? node.style?.height),
		};
		const entry = this.entryGet(this.pathCurrent);
		const diagram = entry.desc.diagram;
		const isAuthored = (diagram.nodes ?? []).some((item) => item.id === nodeId);
		entry.desc = {
			...entry.desc,
			box: rect,
			diagram: isAuthored ? { ...diagram, nodes: diagram.nodes.map((item) => (item.id === nodeId ? { ...item, position: { x: rect.x, y: rect.y }, size: { width: rect.width, height: rect.height } } : item)) } : diagram,
		};
		this.entrySourceLoad(entry);
		this.measureVersion += 1;
		this.cameraByPath.delete(this.pathCurrent);
		const save = this.provider.boxSave?.(this.pathCurrent, rect, nodeId);
		if (save?.then) {
			const failed = (text) => this.captureHintSet('failed', `The bounding box holds while the page is open: ${text}`);
			save.then((result) => { if (result && result.code !== undefined && result.code !== 0) failed(result.message); }, (error) => failed(String(error?.message ?? error)));
		}
	}

	// ---------- pictures ----------

	captureHintSet(status, text) {
		clearTimeout(this.captureHintTimer);
		this.captureHint = { status, text };
		if (status === 'working') return;
		this.captureHintTimer = setTimeout(() => runInAction(() => { this.captureHint = null; }), status === 'failed' ? 9000 : 2600);
	}
}
