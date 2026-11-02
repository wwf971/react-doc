import { applyNodeChanges, MarkerType } from '@xyflow/react';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { makeAutoObservable, observable } from 'mobx';
import { diagramNormalize, diagramPositionsGet, viewportNormalize, endpointIsDangling, pointNodeIdBuild } from './DiagramERData.js';

const viewStates = new WeakMap();

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
		makeAutoObservable(this, { rendererResolve: false, registry: false, graph: observable.ref, viewport: observable.ref, measurements: false, positionsTemporary: false, nodeList: observable.shallow, edgeList: observable.shallow }, { autoBind: true });
		this.sourceLoad(source);
	}

	sourceLoad(source = '', isDraft = false) {
		const previous = new Map(isDraft ? this.nodeList.map(node => [node.id, node]) : []);
		this.source = String(source || '');
		if (!isDraft) {
			this.measurements = Object.create(null);
			this.positionsTemporary = Object.create(null);
		}
		if (!this.source.trim()) {
			this.graph = null;
			this.nodeList = [];
			this.edgeList = [];
			this.loadState = { status: 'empty', message: 'The diagram data is empty.' };
			this.graphVersion += 1;
			return;
		}

		try {
			const data = yamlParse(this.source);
			this.graph = diagramNormalize(data, this.registry, this.rendererResolve, this.height);
			this.viewport = this.graph.viewport;
			const positions = diagramPositionsGet(this.graph.nodes, this.graph.layout, this.measurements);
			const pointNodes = [];
			const endpointNode = (connection, role) => {
				const endpoint = connection[role];
				if (!endpointIsDangling(endpoint)) return { node: endpoint.nodeId, handle: endpoint.handleId };
				const id = pointNodeIdBuild(connection.id, role);
				pointNodes.push({ id, type: 'visualizationPoint', position: { ...endpoint.position }, draggable: false, selectable: false, focusable: false, connectable: false, style: { width: 1, height: 1 }, data: { connectionId: connection.id, role } });
				return { node: id, handle: 'end' };
			};
			const marker = value => value === 'none' ? undefined : { type: value === 'arrow' ? MarkerType.Arrow : MarkerType.ArrowClosed, width: 16, height: 16 };
			this.edgeList = this.graph.connections.map(connection => {
				const source = endpointNode(connection, 'source');
				const target = endpointNode(connection, 'target');
				return {
					id: connection.id, type: 'visualizationEdge',
					source: source.node, target: target.node, sourceHandle: source.handle, targetHandle: target.handle,
					style: connection.style, animated: connection.isAnimated,
					markerStart: marker(connection.markerStart), markerEnd: marker(connection.markerEnd),
					interactionWidth: 24,
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
					return {
						...before,
						id: node.id, type: 'visualizationNode', position: before && !isPositionAuthoredChanged ? before.position : positions.get(node.id),
						style: { width: node.size.width === 'auto' ? node.sizeDefault.width : node.size.width, ...(node.size.height === 'auto' ? {} : { height: node.size.height }) },
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
		for (const change of changes) {
			if (change.type === 'position' && change.position) this.positionsTemporary[change.id] = { x: change.position.x, y: change.position.y };
		}
	}

	measurementSet(id, size) {
		const previous = this.measurements[id];
		if (previous && Math.abs(previous.width - size.width) < 0.5 && Math.abs(previous.height - size.height) < 0.5) return;
		this.measurements[id] = size;
		if (!this.graph) return;
		try {
			const nodes = this.graph.nodes.map(node => this.positionsTemporary[node.id] ? { ...node, position: this.positionsTemporary[node.id] } : node);
			const positions = diagramPositionsGet(nodes, this.graph.layout, this.measurements);
			// a node whose place did not change keeps its identity
			this.nodeList = this.nodeList.map(node => {
				if (node.type !== 'visualizationNode') return node;
				const position = positions.get(node.id);
				return position && node.position?.x === position.x && node.position?.y === position.y ? node : { ...node, position };
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
