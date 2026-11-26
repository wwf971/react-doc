import { applyNodeChanges, MarkerType } from '@xyflow/react';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { makeAutoObservable, observable } from 'mobx';
import { diagramNormalize, diagramPlacesGet, viewportNormalize, endpointIsDangling, pointNodeIdBuild } from './DiagramERData.js';
import { depthKeyOfConnection, depthKeyOfNode, depthZIndexTopGet, diagramDepthZIndexMapGet } from './DiagramDepth.js';

// the style of a node on the canvas: its size as written, or what places it says (sizePlaced: a
// background drawn around other nodes, a node a placer sizes: diagramPlacesGet)
function nodeStyleOf(node, sizePlaced) {
	if (node.around) return { width: sizePlaced?.width ?? 1, height: sizePlaced?.height ?? 1 };
	const height = sizePlaced?.height ?? (node.size.height === 'auto' ? undefined : node.size.height);
	return { width: sizePlaced?.width ?? (node.isWidthFit ? 'max-content' : node.size.width === 'auto' ? node.sizeDefault.width : node.size.width), ...(height === undefined ? {} : { height }) };
}

const viewStates = new WeakMap();

// The camera a canvas remembers across mounts: one state per owner (the source store of the page,
// useDocStores().sourceStore) and block (config.sourcePath, config.blockIndex). CardDiagram.jsx reads
// it once as a canvas mounts, so a canvas taking the place of another (the editor replacing the
// reading canvas, the reading canvas drawn again after a save) opens where the reader was.
//
// As it is kept today, the owner is told apart by identity, never by what it holds: two canvases share
// a camera only when their host gives both the very same source store object. A host that builds its
// source store per mount (an object spread in a render or a useMemo, `{ ...base, configDoc }`) gives
// each canvas an owner of its own: nothing fails, every editor simply opens fitted. The camera is also
// kept only for a viewport of the same signature (its size: CardDiagram.jsx), so the two canvases are
// drawn at one height too. What is worth keeping is the behaviour (entering the editor moves nothing);
// these conditions belong to this way of keeping the camera, and go with it if it is reworked.
export function diagramViewStateGet(owner, config) {
	if (!owner || !config.sourcePath || config.blockIndex === undefined) return {};
	let states = viewStates.get(owner);
	if (!states) { states = new Map(); viewStates.set(owner, states); }
	const key = JSON.stringify([config.sourcePath, config.blockIndex]);
	if (!states.has(key)) {
		if (states.size >= 100) states.delete(states.keys().next().value);
		states.set(key, {});
	}
	return states.get(key);
}

// The canvas model of a diagram: the authored graph turned into the nodes and
// edges React Flow draws. A dangling end of a connection is a hidden point
// node (type visualizationPoint) that the edge ends on; it is never part of
// the authored data (card-diagram-impl.md#react-flow-boundary).
//
// nodeList and edgeList are shallow observables: the lists change, their
// items are the plain objects React Flow is given, and an item keeps its
// identity until it changes. A drag therefore replaces one node per frame
// (applyNodeChanges copies only what changed) and leaves every other card
// unrendered; a deep clone of the whole list per frame is what made
// dragging sluggish (card-diagram-impl.md#react-flow-boundary).
class DiagramERStore {
	source = '';
	graph = null;
	viewport = viewportNormalize();
	measurements = Object.create(null);
	positionsTemporary = Object.create(null);
	// what the placers of the diagram answered the last time its nodes were placed (Map placer id ->
	// its answer: diagramPlacesGet), for whoever draws over the canvas; and the place of a node a
	// placer places while it is dragged (Map id -> { x, y }), which what follows it follows
	placed = new Map();
	placeOverride = null;
	// while words are typed in the editor (placeHoldSet), a size measured moves nothing: the places
	// follow when the typing pauses or ends, as the draft does (card-diagram-impl.md#history)
	isPlaceHeld = false;
	isPlacePending = false;
	nodeList = [];
	edgeList = [];
	loadState = { status: 'idle', message: '' };
	graphVersion = 0;

	// registry: the node registry of the component (node-registry.js)
	constructor(source = '', rendererResolve, height = 620, registry) {
		this.rendererResolve = rendererResolve;
		this.registry = registry;
		this.height = height;
		// the graph, the measurements and the temporary positions are plain data:
		// nothing renders from them, and the nodes handed to React Flow are
		// built from the graph, so they must not be observable proxies
		makeAutoObservable(this, { rendererResolve: false, registry: false, graph: observable.ref, viewport: observable.ref, measurements: false, positionsTemporary: false, placed: observable.ref, placeOverride: false, isPlaceHeld: false, isPlacePending: false, nodeList: observable.shallow, edgeList: observable.shallow }, { autoBind: true });
		this.sourceLoad(source);
	}

	sourceLoad(source = '', isDraft = false) {
		const previous = new Map(isDraft ? this.nodeList.map(node => [node.id, node]) : []);
		this.source = String(source || '');
		if (!isDraft) {
			this.measurements = Object.create(null);
			this.positionsTemporary = Object.create(null);
		}
		this.placeOverride = null;
		if (!this.source.trim()) {
			this.graph = null;
			this.nodeList = [];
			this.edgeList = [];
			this.loadState = { status: 'empty', message: 'The diagram data is empty.' };
			this.graphVersion += 1;
			return;
		}

		try {
			// a generator hands its data as JSON (the switch layer), which reads far faster than YAML
			// for a large scene; an author writes YAML
			const data = this.source.trimStart().startsWith('{') ? jsonOrYamlParse(this.source) : yamlParse(this.source);
			this.graph = diagramNormalize(data, this.registry, this.rendererResolve, this.height);
			this.viewport = this.graph.viewport;
			const { positions, sizeById, placedById } = diagramPlacesGet(this.graph.nodes, this.graph.layout, this.measurements);
			this.placed = placedById;
			this.isPlacePending = false;
			// what is drawn over what (DiagramDepth.js): the z-index of each node and line, from their
			// depths; a diagram that writes none gets the numbers it always had. A free end is over
			// everything, so its dot is always reached
			const zIndexByKey = diagramDepthZIndexMapGet(this.graph);
			const zIndexTop = depthZIndexTopGet(zIndexByKey);
			const pointNodes = [];
			const endpointNode = (connection, role) => {
				const endpoint = connection[role];
				if (!endpointIsDangling(endpoint)) return { node: endpoint.nodeId, handle: endpoint.handleId };
				const id = pointNodeIdBuild(connection.id, role);
				pointNodes.push({ id, type: 'visualizationPoint', position: { ...endpoint.position }, draggable: false, selectable: false, focusable: false, connectable: false, ...(zIndexTop ? { zIndex: zIndexTop } : {}), style: { width: 1, height: 1 }, data: { connectionId: connection.id, role } });
				return { node: id, handle: 'end' };
			};
			const marker = value => value === 'none' ? undefined : { type: value === 'arrow' ? MarkerType.Arrow : MarkerType.ArrowClosed, width: 13, height: 13 };
			this.edgeList = this.graph.connections.map(connection => {
				const source = endpointNode(connection, 'source');
				const target = endpointNode(connection, 'target');
				return {
					id: connection.id, type: 'visualizationEdge',
					source: source.node, target: target.node, sourceHandle: source.handle, targetHandle: target.handle,
					style: connection.style, animated: connection.isAnimated,
					markerStart: marker(connection.markerStart), markerEnd: marker(connection.markerEnd),
					interactionWidth: 24,
					...(zIndexByKey.get(depthKeyOfConnection(connection.id)) ? { zIndex: zIndexByKey.get(depthKeyOfConnection(connection.id)) } : {}),
					data: { connection },
				};
			});
			this.nodeList = [
				...this.graph.nodes.map(node => {
					// a draft reloaded keeps where each node is on the canvas, unless
					// the draft now says otherwise (a position remembered, cleared,
					// locked, or put back by an undo): then the authored position
					// (or the layout, for auto) is where the node goes, and the
					// place a drag left it is forgotten
					const before = previous.get(node.id);
					const isPositionAuthoredChanged = Boolean(before) && !positionEquals(before.data.node.position, node.position);
					if (isPositionAuthoredChanged) delete this.positionsTemporary[node.id];
					// a size the draft now says otherwise: the width a resize left on
					// the canvas node would hide it
					const { width: _width, height: _height, ...beforeWithoutSize } = before ?? {};
					const isSizeAuthoredChanged = Boolean(before) && (before.data.node.size.width !== node.size.width || before.data.node.size.height !== node.size.height);
					// a node a placer places is where the placer says, whatever a drag left
					const isPlaced = this.nodeIsPlaced(node.id);
					return {
						...(isSizeAuthoredChanged ? beforeWithoutSize : before),
						id: node.id, type: 'visualizationNode', position: before && !isPositionAuthoredChanged && !isPlaced ? before.position : positions.get(node.id),
						zIndex: zIndexByKey.get(depthKeyOfNode(node.id)) ?? 0,
						style: nodeStyleOf(node, sizeById.get(node.id)),
						...(node.around || node.isDerived ? { draggable: false } : {}),
						data: { node },
					};
				}),
				...pointNodes,
			];
			this.loadState = { status: 'done', message: '' };
		} catch (error) {
			this.graph = null;
			this.nodeList = [];
			this.edgeList = [];
			this.loadState = {
				status: 'error',
				message: String(error?.message || error),
			};
		}
		if (!isDraft) this.graphVersion += 1;
	}

	nodeListChange(changeList) {
		const changes = changeList.filter(change => change.type !== 'position' || !this.nodeList.find(node => node.id === change.id)?.data.node?.isPositionLocked);
		if (!changes.length) return;
		this.nodeList = applyNodeChanges(changes, this.nodeList.slice());
		let isPlacedMoved = false;
		for (const change of changes) {
			if (change.type !== 'position' || !change.position) continue;
			if (this.nodeIsPlaced(change.id)) {
				// a node a placer places, dragged: what follows it follows it at once. the place is
				// kept until the draft says where it goes (sourceLoad) or the drag is given up (placeOverrideClear)
				(this.placeOverride ??= new Map()).set(change.id, { x: change.position.x, y: change.position.y });
				isPlacedMoved = true;
			} else this.positionsTemporary[change.id] = { x: change.position.x, y: change.position.y };
		}
		if (isPlacedMoved) this.placesApply();
	}

	nodeIsPlaced(id) {
		return Boolean(this.graph?.layout.placerList?.some(placer => placer.isPlaced(id)));
	}

	// a place held while something a placer knows by a key of its own is dragged (the anchor of a
	// group): what follows it follows it there, as for a node dragged
	placeOverrideSet(key, position) {
		(this.placeOverride ??= new Map()).set(key, { x: position.x, y: position.y });
		this.placesApply();
	}

	// a dragged place given up: every node a placer places goes back where the placer says
	placeOverrideClear() {
		if (!this.placeOverride) return;
		this.placeOverride = null;
		this.placesApply();
	}

	measurementSet(id, size) {
		const previous = this.measurements[id];
		if (previous && Math.abs(previous.width - size.width) < 0.5 && Math.abs(previous.height - size.height) < 0.5) return;
		this.measurements[id] = size;
		if (this.isPlaceHeld) this.isPlacePending = true;
		else this.placesApply();
	}

	placeHoldSet(isHeld) {
		this.isPlaceHeld = isHeld;
		if (isHeld || !this.isPlacePending) return;
		this.isPlacePending = false;
		this.placesApply();
	}

	// where every node is now (the automatic layout, the placers, the backgrounds around others),
	// put on the canvas: a node whose place and size did not change keeps its identity
	placesApply() {
		if (!this.graph) return;
		try {
			const nodes = this.graph.nodes.map(node => this.positionsTemporary[node.id] ? { ...node, position: this.positionsTemporary[node.id] } : node);
			const { positions, sizeById, placedById } = diagramPlacesGet(nodes, this.graph.layout, this.measurements, this.placeOverride);
			this.placed = placedById;
			this.nodeList = this.nodeList.map(node => {
				if (node.type !== 'visualizationNode') return node;
				const position = positions.get(node.id);
				const style = sizeById.has(node.id) ? nodeStyleOf(node.data.node, sizeById.get(node.id)) : null;
				const isSizeSame = !style || (node.style?.width === style.width && node.style?.height === style.height);
				if (position && node.position?.x === position.x && node.position?.y === position.y && isSizeSame) return node;
				return { ...node, ...(position ? { position } : {}), ...(isSizeSame ? {} : { style }) };
			});
		} catch (error) {
			this.loadState = { status: 'error', message: error.message };
		}
	}
}

// the "copy the source" action of a diagram block, an action of the block's
// toolbar (BlockPopupSurface actionList): the host copies when it answers
// copyRequest, else the clipboard api; status names the last outcome
class DiagramCopyStore {
	status = 'idle';

	constructor() {
		makeAutoObservable(this, {}, { autoBind: true });
	}

	get label() {
		return this.status === 'copied' ? 'Copied' : this.status === 'failed' ? 'Could not copy' : 'Copy the diagram YAML';
	}

	statusSet(status) {
		this.status = status;
	}

	async copy(text, onEvent) {
		const result = await onEvent?.('copyRequest', { text });
		if (result?.code === 0) return;
		try {
			await navigator.clipboard.writeText(text);
			this.statusSet('copied');
		} catch {
			this.statusSet('failed');
		}
	}
}

export { DiagramERStore, DiagramCopyStore };

// two authored positions of a node as one: both 'auto', or the same point
function positionEquals(a, b) {
	if (a === 'auto' || b === 'auto') return a === b;
	return a?.x === b?.x && a?.y === b?.y;
}

// a text that looks like JSON: read as JSON, else as YAML (a flow mapping an author wrote)
function jsonOrYamlParse(text) {
	try {
		return JSON.parse(text);
	} catch {
		return yamlParse(text);
	}
}
