import { applyNodeChanges, MarkerType } from '@xyflow/react';
import { yamlParse } from '../../../../main/frontend/src/lib/yaml.js';
import { makeAutoObservable, toJS } from 'mobx';
import { diagramNormalize, diagramPositionsGet, viewportNormalize } from './DiagramERData.js';

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
	isExpanded = false;
	copyStatus = 'idle';

	constructor(source = '', rendererResolve, height = 620) {
		this.rendererResolve = rendererResolve;
		this.height = height;
		makeAutoObservable(this, { rendererResolve: false }, { autoBind: true });
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
			this.loadState = { status: 'empty', message: 'ER diagram data is empty.' };
			this.graphVersion += 1;
			return;
		}

		try {
			const data = yamlParse(this.source);
			this.graph = diagramNormalize(data, this.rendererResolve, this.height);
			this.viewport = this.graph.viewport;
			const positions = diagramPositionsGet(this.graph.nodes, this.graph.layout, this.measurements);
			this.nodeList = this.graph.nodes.map(node => ({
				...previous.get(node.id),
				id: node.id, type: 'visualizationNode', position: previous.get(node.id)?.position ?? positions.get(node.id),
				style: { width: node.size.width === 'auto' ? node.sizeDefault.width : node.size.width, ...(node.size.height === 'auto' ? {} : { height: node.size.height }) },
				data: { node },
			}));
			const marker = value => value === 'none' ? undefined : { type: value === 'arrow' ? MarkerType.Arrow : MarkerType.ArrowClosed, width: 16, height: 16 };
			this.edgeList = this.graph.connections.map(connection => ({
				id: connection.id, type: 'visualizationEdge',
				source: connection.source.nodeId, target: connection.target.nodeId,
				sourceHandle: `source:${connection.source.handleId}`, targetHandle: `target:${connection.target.handleId}`,
				style: connection.style, animated: connection.isAnimated,
				markerStart: marker(connection.markerStart), markerEnd: marker(connection.markerEnd),
				data: { connection },
			}));
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
		const changes = changeList.filter(change => change.type !== 'position' || !this.nodeList.find(node => node.id === change.id)?.data.node.isPositionLocked);
		this.nodeList = applyNodeChanges(changes, toJS(this.nodeList));
		for (const change of changes) {
			if (change.type === 'position' && change.position) this.positionsTemporary[change.id] = change.position;
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
			this.nodeList = this.nodeList.map(node => ({ ...node, position: positions.get(node.id) }));
		} catch (error) {
			this.loadState = { status: 'error', message: error.message };
		}
	}

	expandedSet(isExpanded) {
		this.isExpanded = isExpanded;
	}

	copyStatusSet(copyStatus) {
		this.copyStatus = copyStatus;
	}
}

export { DiagramERStore };
