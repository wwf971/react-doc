import { dataverseCardNormalize, dataverseAnchorListGet } from './DataverseCardData.js';

const sides = ['left', 'right', 'top', 'bottom'];
const lineTypes = ['straight', 'bezier', 'step', 'smoothstep', 'polyline'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function mapping(value, field) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be a mapping.`);
	return value;
}

function text(value, field) {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
	return value;
}

function number(value, field, min = -Infinity) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`${field} must be finite and >= ${min}.`);
	return value;
}

function dimension(value, field) {
	if (value === undefined || value === 'auto') return 'auto';
	if (number(value, field, 0) === 0) throw new Error(`${field} must be positive.`);
	return value;
}

function point(value, field) {
	mapping(value, field);
	return { x: number(value.x, `${field}.x`), y: number(value.y, `${field}.y`) };
}

function list(value, field) {
	if (!Array.isArray(value)) throw new Error(`${field} must be a list.`);
	return value;
}

function unique(items, field) {
	const result = new Map();
	for (const item of items) {
		text(item.id, `${field}.id`);
		if (result.has(item.id)) throw new Error(`${field}: duplicate id "${item.id}".`);
		result.set(item.id, item);
	}
	return result;
}

function rendererRead(value, field, placement, resolve) {
	mapping(value, field);
	if (own(value, 'type') === own(value, 'component')) throw new Error(`${field} requires exactly one of type or component.`);
	if (value.component !== undefined) {
		text(value.component, `${field}.component`);
		const contract = resolve?.(value.component, placement);
		if (!contract) throw new Error(`${field}: component "${value.component}" must expose ${placement}.`);
		return { renderer: { component: value.component }, contract };
	}
	const type = text(value.type, `${field}.type`);
	if (placement === 'visualizationEdge') {
		if (!lineTypes.includes(type)) throw new Error(`${field}: unknown line type "${type}".`);
		return { renderer: { type }, contract: {} };
	}
	if (type === 'dataverse-table' || type === 'dataverse-choice') {
		return { renderer: { type }, contract: { dataNormalize: dataverseCardNormalize, anchorListGet: dataverseAnchorListGet, sizeDefault: { width: 410, height: 320 } } };
	}
	if (type === 'operator') {
		return { renderer: { type }, contract: { anchorListGet: () => [{ id: 'body', sideList: sides }], sizeDefault: { width: 220, height: 100 } } };
	}
	throw new Error(`${field}: unknown node type "${type}".`);
}

export function viewportNormalize(value = {}, height = 620) {
	mapping(value, 'viewport');
	if (['x', 'y', 'zoomRange'].some(key => own(value, key))) throw new Error('Use viewport.view for the camera and viewport.zoom for zoom limits.');
	const size = mapping(value.size ?? {}, 'viewport.size');
	const zoom = mapping(value.zoom ?? {}, 'viewport.zoom');
	const min = number(zoom.min ?? 0.15, 'viewport.zoom.min', Number.MIN_VALUE);
	const max = number(zoom.max ?? 2.5, 'viewport.zoom.max', min);
	const view = value.view === undefined || value.view === 'auto' ? 'auto' : {
		...point(value.view, 'viewport.view'),
		zoom: number(value.view.zoom, 'viewport.view.zoom', min),
	};
	if (view !== 'auto' && view.zoom > max) throw new Error('viewport.view.zoom exceeds viewport.zoom.max.');
	let range = 'auto';
	if (value.range !== undefined && value.range !== 'auto') {
		mapping(value.range, 'viewport.range');
		range = {};
		for (const axis of ['x', 'y']) {
			const bounds = list(value.range[axis], `viewport.range.${axis}`);
			if (bounds.length !== 2) throw new Error(`viewport.range.${axis} needs [min, max].`);
			range[axis] = [number(bounds[0], axis), number(bounds[1], axis, bounds[0])];
		}
		if (view !== 'auto' && (view.x < range.x[0] || view.x > range.x[1] || view.y < range.y[0] || view.y > range.y[1])) throw new Error('viewport.view translation is outside viewport.range.');
	}
	if (value.isMiniMapVisible !== undefined && typeof value.isMiniMapVisible !== 'boolean') throw new Error('viewport.isMiniMapVisible must be boolean.');
	return { size: { width: dimension(size.width, 'viewport.size.width'), height: dimension(size.height ?? height, 'viewport.size.height') }, view, range, zoom: { min, max }, isMiniMapVisible: value.isMiniMapVisible ?? false };
}

export function diagramLegacyConvert(value, height = 620) {
	const nodes = list(value.tables, 'tables').map((table, index) => {
		const { position, kind, ...data } = table;
		return {
			id: table.id,
			renderer: { type: kind === 'choice' ? 'dataverse-choice' : 'dataverse-table' },
			position: { x: position?.x ?? (index % 2) * 520, y: position?.y ?? Math.floor(index / 2) * 440 },
			data,
			handles: [],
		};
	});
	const nodesById = unique(nodes, 'tables');
	const handles = new Map();
	const endpoint = (valueEndpoint, role, sideDefault) => {
		const node = nodesById.get(valueEndpoint?.tableId);
		if (!node) throw new Error(`Unknown table "${valueEndpoint?.tableId}".`);
		const side = valueEndpoint.side ?? sideDefault;
		const key = JSON.stringify([node.id, valueEndpoint.columnId, role, side]);
		if (!handles.has(key)) {
			const handle = { id: `handle-${node.handles.length + 1}`, direction: role, anchor: { target: node.renderer.type === 'dataverse-choice' ? 'header' : `column/${valueEndpoint.columnId}`, side } };
			node.handles.push(handle);
			handles.set(key, handle.id);
		}
		return { nodeId: node.id, handleId: handles.get(key) };
	};
	const connections = list(value.relationships ?? [], 'relationships').map(relationship => {
		const isForward = (nodesById.get(relationship.source?.tableId)?.position.x ?? 0) <= (nodesById.get(relationship.target?.tableId)?.position.x ?? 0);
		return { id: relationship.id, source: endpoint(relationship.source, 'out', isForward ? 'right' : 'left'), target: endpoint(relationship.target, 'in', isForward ? 'left' : 'right'), label: { text: String(relationship.label || '') } };
	});
	return { version: 1, viewport: { size: { height } }, nodes, connections };
}

export function diagramNormalize(input, resolve, height = 620) {
	mapping(input, 'diagram');
	const isLegacy = input.version === undefined && own(input, 'tables');
	if (isLegacy && (own(input, 'nodes') || own(input, 'connections'))) throw new Error('Mixed diagram grammars.');
	const value = isLegacy ? diagramLegacyConvert(input, height) : input;
	if (value.version !== 1 || own(value, 'tables') || own(value, 'relationships')) throw new Error('Use version: 1 with nodes and connections.');
	if (own(value, 'zoomRange')) throw new Error('Use viewport.zoom instead of zoomRange.');
	const defaults = mapping(value.defaults ?? {}, 'defaults');
	const layout = mapping(defaults.layout ?? {}, 'defaults.layout');
	if ((layout.type ?? 'grid') !== 'grid') throw new Error('Only grid layout is supported.');
	const columns = number(layout.columns ?? 2, 'layout.columns', 1);
	if (!Number.isInteger(columns)) throw new Error('layout.columns must be an integer.');
	const gap = mapping(layout.gap ?? {}, 'layout.gap');
	const layoutResolved = { columns, gap: { x: number(gap.x ?? 110, 'gap.x', 0), y: number(gap.y ?? 60, 'gap.y', 0) } };
	const nodes = list(value.nodes, 'nodes').map(node => {
		mapping(node, 'node');
		const id = text(node.id, 'node.id');
		if (node.isPositionLocked !== undefined && typeof node.isPositionLocked !== 'boolean') throw new Error(`${id}.isPositionLocked must be boolean.`);
		if (node.isPositionLocked && (!node.position || node.position === 'auto')) throw new Error(`${id}: a locked node requires an explicit position.`);
		const { renderer, contract } = rendererRead(node.renderer, `${id}.renderer`, 'visualizationNode', resolve);
		const dataInput = mapping(node.data ?? {}, `${id}.data`);
		const data = mapping(contract.dataNormalize ? contract.dataNormalize(dataInput) : dataInput, `${id}.data`);
		if (typeof contract.anchorListGet !== 'function') throw new Error(`${id}: renderer requires anchorListGet.`);
		const anchors = [...list(contract.anchorListGet(data), `${id}.anchors`)];
		const anchorsById = unique(anchors, `${id}.anchors`);
		if (!anchorsById.has('body')) anchors.push({ id: 'body', sideList: sides });
		for (const anchor of anchors) {
			if (!Array.isArray(anchor.sideList) || !anchor.sideList.length || anchor.sideList.some(side => !sides.includes(side))) throw new Error(`${id}: invalid sides for anchor "${anchor.id}".`);
		}
		const size = mapping(node.size ?? {}, `${id}.size`);
		const sizeResolved = { width: dimension(size.width, `${id}.width`), height: dimension(size.height, `${id}.height`) };
		const sizeDefault = { width: 220, height: 100, ...contract.sizeDefault };
		for (const axis of ['width', 'height']) {
			number(sizeDefault[axis], `${id}.sizeDefault.${axis}`, Number.MIN_VALUE);
			if (sizeResolved[axis] !== 'auto' && contract.sizeMin?.[axis] && sizeResolved[axis] < contract.sizeMin[axis]) throw new Error(`${id}.${axis} is smaller than renderer minimum.`);
		}
		const handles = list(node.handles ?? [], `${id}.handles`).map(handle => {
			text(handle.id, `${id}.handle.id`);
			if (!['in', 'out', 'both'].includes(handle.direction)) throw new Error(`${id}.${handle.id}: direction must be in, out, or both.`);
			const anchorInput = mapping(handle.anchor, `${id}.${handle.id}.anchor`);
			const anchor = renderer.type === 'dataverse-choice' && anchorInput.target?.startsWith('column/') && anchorsById.has(anchorInput.target)
				? { target: 'header', side: 'left', offset: 0.5 }
				: anchorInput;
			const target = anchor.target ?? 'body';
			const definition = anchors.find(item => item.id === target);
			if (!definition?.sideList.includes(anchor.side)) throw new Error(`${id}.${handle.id}: unknown anchor or unsupported side.`);
			const offset = number(anchor.offset ?? 0.5, `${id}.${handle.id}.offset`, 0);
			if (offset > 1) throw new Error(`${id}.${handle.id}: offset exceeds 1.`);
			return { ...handle, anchor: { target, side: anchor.side, offset } };
		});
		unique(handles, `${id}.handles`);
		return { ...node, id, renderer, data, anchors, handles, size: sizeResolved, sizeDefault, position: node.position === undefined || node.position === 'auto' ? 'auto' : point(node.position, `${id}.position`) };
	});
	const nodesById = unique(nodes, 'nodes');
	const connectionDefault = mapping(defaults.connection ?? {}, 'defaults.connection');
	if (['id', 'source', 'target'].some(key => own(connectionDefault, key))) throw new Error('Connection defaults cannot contain identity or endpoints.');
	const connections = list(value.connections ?? [], 'connections').map(connection => {
		const id = text(connection.id, 'connection.id');
		const { renderer, contract } = rendererRead(connection.renderer ?? connectionDefault.renderer ?? { type: 'smoothstep' }, `${id}.renderer`, 'visualizationEdge', resolve);
		for (const role of ['source', 'target']) {
			const endpoint = mapping(connection[role], `${id}.${role}`);
			const handle = nodesById.get(endpoint.nodeId)?.handles.find(item => item.id === endpoint.handleId);
			if (!handle || (handle.direction !== 'both' && handle.direction !== (role === 'source' ? 'out' : 'in'))) throw new Error(`${id}.${role}: missing or incompatible handle.`);
		}
		const style = { stroke: '#64748b', strokeWidth: 1.5, ...mapping(connectionDefault.style ?? {}, 'default style'), ...mapping(connection.style ?? {}, `${id}.style`) };
		number(style.strokeWidth, `${id}.strokeWidth`, Number.MIN_VALUE);
		text(style.stroke, `${id}.stroke`);
		if (Object.keys(style).some(key => !['stroke', 'strokeWidth', 'strokeDasharray'].includes(key))) throw new Error(`${id}: unsupported line style.`);
		if (style.strokeDasharray !== undefined && !/^\d+(?:\.\d+)?(?:[ ,]+\d+(?:\.\d+)?)*$/.test(String(style.strokeDasharray))) throw new Error(`${id}: invalid strokeDasharray.`);
		const label = { text: '', position: 0.5, ...mapping(connectionDefault.label ?? {}, 'default label'), ...mapping(connection.label ?? {}, `${id}.label`) };
		if (typeof label.text !== 'string' || number(label.position, `${id}.label.position`, 0) > 1) throw new Error(`${id}: invalid label.`);
		const route = own(connection, 'route') ? connection.route : connectionDefault.route;
		if (route != null) {
			if (renderer.type === 'polyline') list(mapping(route, `${id}.route`).waypoints, `${id}.waypoints`).forEach(item => point(item, `${id}.waypoint`));
			else if (typeof contract.routeValidate === 'function') contract.routeValidate(route);
			else throw new Error(`${id}: renderer does not accept route data.`);
		}
		const result = { ...connectionDefault, ...connection, id, renderer, style, label, route, data: mapping(connection.data ?? connectionDefault.data ?? {}, `${id}.data`), markerStart: connection.markerStart ?? connectionDefault.markerStart ?? 'none', markerEnd: connection.markerEnd ?? connectionDefault.markerEnd ?? 'arrowClosed', isAnimated: connection.isAnimated ?? connectionDefault.isAnimated ?? false };
		if (![result.markerStart, result.markerEnd].every(marker => ['none', 'arrow', 'arrowClosed'].includes(marker))) throw new Error(`${id}: invalid marker.`);
		if (typeof result.isAnimated !== 'boolean') throw new Error(`${id}: isAnimated must be boolean.`);
		return result;
	});
	unique(connections, 'connections');
	return { nodes, connections, layout: layoutResolved, viewport: viewportNormalize(value.viewport, height) };
}

export function diagramPositionsGet(nodes, layout, measurements = {}) {
	const dimensions = node => ({ width: node.size.width === 'auto' ? measurements[node.id]?.width ?? node.sizeDefault.width : node.size.width, height: node.size.height === 'auto' ? measurements[node.id]?.height ?? node.sizeDefault.height : node.size.height });
	const automatic = nodes.filter(node => node.position === 'auto');
	const cell = { width: Math.max(1, ...automatic.map(node => dimensions(node).width)) + layout.gap.x, height: Math.max(1, ...automatic.map(node => dimensions(node).height)) + layout.gap.y };
	const occupied = nodes.filter(node => node.position !== 'auto').map(node => ({ ...node.position, ...dimensions(node) }));
	const positions = new Map(nodes.filter(node => node.position !== 'auto').map(node => [node.id, node.position]));
	let cursor = 0;
	for (const node of automatic) {
		let candidate;
		let attempts = 0;
		do {
			if (++attempts > 10000) throw new Error('Automatic grid is obstructed; change positions or grid settings.');
			candidate = { x: (cursor % layout.columns) * cell.width, y: Math.floor(cursor / layout.columns) * cell.height, ...dimensions(node) };
			cursor += 1;
		} while (occupied.some(rect => candidate.x < rect.x + rect.width + layout.gap.x && candidate.x + candidate.width + layout.gap.x > rect.x && candidate.y < rect.y + rect.height + layout.gap.y && candidate.y + candidate.height + layout.gap.y > rect.y));
		occupied.push(candidate);
		positions.set(node.id, { x: candidate.x, y: candidate.y });
	}
	return positions;
}

export function dataverseStandaloneNormalize(input) {
	const node = input.version === undefined ? { id: input.entity?.id ?? input.id ?? 'entity', renderer: { type: 'dataverse-table' }, data: input.entity ?? input } : input.node;
	if (input.version !== undefined && input.version !== 1) throw new Error('Unsupported card version.');
	const graph = diagramNormalize({ version: 1, nodes: [node] });
	if (graph.nodes[0].renderer.type !== 'dataverse-table') throw new Error('DiagramDataverseEntity requires a dataverse-table node.');
	return graph.nodes[0];
}