import { diagramArrangeApply } from '../card-diagram/DiagramArrange.js';
import { diagramArrangerLanesAcross, diagramArrangerLanesDown, diagramArrangerLayers } from '../card-diagram/DiagramArrangeLayers.js';
import { diagramGeometryEstimateBuild } from '../card-diagram/DiagramArrangeOutline.js';
import { switchPathLast, switchPathNormalize, switchPathParent } from '../card-diagram-switch/SwitchData.js';

// A system on AWS described as data, and the scenes drawn from it (doc/aws.md#scenes-generated-from-a-description):
// a provider of the switching layer, as a migration is drawn from its data items. The description is
// what a deployment script can write from the plan it makes resources from; every scene is a function
// of it, with stable ids, laid out by the layer arrangers.
//
//   description   { version: 1, title?, root?, height?, depthMax?, clientList?, groupList }
//   client        { id, title, text?, tone? }                       outside every group: a page, a script
//   group         { id, label, project?, description?, icon?, tone?, resourceList, relationList?, flowList? }
//   resource      { id, kind, name, data?, isEdge?, detail? }       kind: a renderer type of the AWS registry
//   relation      { from, to, label? }                              ends: a resource of the group, `group.resource`,
//                                                                    or a client
//   flow          { id, label, title?, stepList: [{ from, to, label? }], note?: { title, text, tone? } }
//   detail        { routeGroupList: [{ id, name, nameLogical?, routes }] }       the routes of an api
//                 { rowKindList: [{ id, name, pk, sk, column?, description?, attributes }],
//                   linkList?: [{ from: 'kind.attribute', to: 'kind', label? }] }  the kinds of rows of a table
//                 { partList: [{ id, title, tag?, text?, tone? }], linkList?: [{ from, to, label? }] }  parts: modules, keys
//
//   {root}                      the groups as frames showing their overview, the clients, what passes between them
//   {root}/{group}              @resources (cards), @overview (marks), @{flow}: the same cards, the
//                               steps of one flow as the lines; @frame, embedded only: its own resources as
//                               marks, what the frame of the group shows in {root}
//   {root}/{group}/{resource}   the detail of a resource
export const AWS_ARCHITECTURE_ROOT = '/system';
const CARD_WIDTH = 300;
const NOTE_WIDTH = 230;
const STEP_STYLE = { stroke: '#2563eb', strokeWidth: 2 };
const LINK_STYLE = { stroke: '#64748b', strokeWidth: 1.5 };

const mapping = (value, field) => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be a mapping.`);
	return value;
};
const listOf = (value, field) => {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error(`${field} must be a list.`);
	return value;
};
const idCheck = (value, field) => {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new Error(`${field} must be an id of letters, digits, _ and -.`);
	return value;
};

// the description checked, and its ends resolved: a resource is known by `group.resource`
export function awsArchitectureNormalize(input) {
	const value = mapping(input, 'the description');
	if (value.version !== 1) throw new Error('An architecture needs version: 1.');
	const clientById = new Map();
	for (const client of listOf(value.clientList, 'clientList')) {
		mapping(client, 'a client');
		idCheck(client.id, 'the id of a client');
		if (clientById.has(client.id)) throw new Error(`The client ${client.id} is written twice.`);
		clientById.set(client.id, { ...client, title: String(client.title ?? client.id), text: client.text === undefined ? undefined : String(client.text) });
	}
	const groupList = listOf(value.groupList, 'groupList').map((group) => {
		mapping(group, 'a group');
		idCheck(group.id, 'the id of a group');
		const resourceList = listOf(group.resourceList, `${group.id}.resourceList`).map((resource) => {
			mapping(resource, `a resource of ${group.id}`);
			idCheck(resource.id, `the id of a resource of ${group.id}`);
			if (typeof resource.kind !== 'string') throw new Error(`${group.id}.${resource.id} needs a kind.`);
			return { ...resource, key: `${group.id}.${resource.id}`, group: group.id, name: String(resource.name ?? resource.id), data: mapping(resource.data ?? {}, `${group.id}.${resource.id}.data`) };
		});
		return { ...group, label: String(group.label ?? group.id), resourceList, relationList: listOf(group.relationList, `${group.id}.relationList`), flowList: listOf(group.flowList, `${group.id}.flowList`) };
	});
	const groupIdSet = new Set();
	const resourceByKey = new Map();
	for (const group of groupList) {
		if (groupIdSet.has(group.id)) throw new Error(`The group ${group.id} is written twice.`);
		if (clientById.has(group.id)) throw new Error(`${group.id} is the id of a group and of a client.`);
		groupIdSet.add(group.id);
		for (const resource of group.resourceList) {
			if (resourceByKey.has(resource.key)) throw new Error(`The resource ${resource.key} is written twice.`);
			resourceByKey.set(resource.key, resource);
		}
	}
	// an end: a client, a resource of the group, or group.resource
	const endResolve = (end, group, field) => {
		if (typeof end !== 'string' || !end) throw new Error(`${field} names nothing.`);
		if (clientById.has(end)) return end;
		const key = end.includes('.') ? end : `${group.id}.${end}`;
		if (!resourceByKey.has(key)) throw new Error(`${field} names ${end}, which is neither a client nor a resource.`);
		return key;
	};
	for (const group of groupList) {
		group.relationList = group.relationList.map((relation, index) => {
			mapping(relation, `a relation of ${group.id}`);
			return { id: `${group.id}.r${index + 1}`, from: endResolve(relation.from, group, `${group.id}.relationList[${index}].from`), to: endResolve(relation.to, group, `${group.id}.relationList[${index}].to`), label: relation.label === undefined ? '' : String(relation.label) };
		});
		const flowIdSet = new Set();
		group.flowList = group.flowList.map((flow) => {
			mapping(flow, `a flow of ${group.id}`);
			idCheck(flow.id, `the id of a flow of ${group.id}`);
			if (['resources', 'overview'].includes(flow.id) || flowIdSet.has(flow.id)) throw new Error(`The flow ${flow.id} of ${group.id} has an id already taken.`);
			flowIdSet.add(flow.id);
			const stepList = listOf(flow.stepList, `${group.id}.${flow.id}.stepList`).map((step, index) => ({ from: endResolve(step.from, group, `${group.id}.${flow.id} step ${index + 1}`), to: endResolve(step.to, group, `${group.id}.${flow.id} step ${index + 1}`), label: step.label === undefined ? '' : String(step.label) }));
			return { ...flow, label: String(flow.label ?? flow.id), stepList };
		});
	}
	const root = switchPathNormalize(value.root ?? AWS_ARCHITECTURE_ROOT);
	return { title: String(value.title ?? ''), root, height: value.height, depthMax: value.depthMax, clientById, groupList, resourceByKey };
}

// ---------- the nodes

const handle = (id, direction, side) => ({ id, direction, anchor: { target: 'body', side } });
const lineOf = (id, [source, handleSource], [target, handleTarget], label, extra = {}) => ({ id, source: { nodeId: source, handleId: handleSource }, target: { nodeId: target, handleId: handleTarget }, ...(label ? { label: { text: label } } : {}), ...extra });

// a resource as its card, or as its mark (aws-mark: at a glance, and where it belongs to another
// group, whose own scene draws its card): under one id in every view, so a switch moves the card
// into its mark
function resourceNodeBuild(model, key, { isMark, isExternal }) {
	const resource = model.resourceByKey.get(key);
	const node = isMark || isExternal
		? { id: key, renderer: { type: 'aws-mark' }, data: { name: resource.name, resourceType: resource.kind }, handles: [] }
		: { id: key, renderer: { type: resource.kind }, size: { width: CARD_WIDTH, height: 'auto' }, data: { ...resource.data, name: resource.name }, handles: [] };
	if (isExternal) node.link = `${model.root}/${resource.group}`;
	else if (resource.detail) node.link = `${model.root}/${resource.group}/${resource.id}`;
	return node;
}

function clientNodeBuild(model, id) {
	const client = model.clientById.get(id);
	return { id, renderer: { type: 'card-note' }, size: { width: NOTE_WIDTH, height: 'auto' }, data: { title: client.title, text: client.text, tone: client.tone ?? 'slate' }, handles: [] };
}

// the nodes of a scene and the lines between them: each line a handle of its own at its source,
// one handle per node to arrive at; the layer arranger turns and spreads them
function graphBuild(model, endList, lineList, { isMark, groupId, styleOf }) {
	const nodeById = new Map();
	for (const end of endList) {
		if (nodeById.has(end)) continue;
		nodeById.set(end, model.clientById.has(end) ? clientNodeBuild(model, end) : resourceNodeBuild(model, end, { isMark, isExternal: model.resourceByKey.get(end).group !== groupId }));
	}
	const handleAdd = (nodeId, item) => {
		const node = nodeById.get(nodeId);
		if (!node.handles.some((one) => one.id === item.id)) node.handles.push(item);
		return item.id;
	};
	const connections = lineList.map((line) => lineOf(line.id, [line.from, handleAdd(line.from, handle(`out-${line.id}`, 'out', 'bottom'))], [line.to, handleAdd(line.to, handle('in', 'in', 'top'))], line.label, styleOf ? { style: styleOf(line) } : {}));
	return { nodes: [...nodeById.values()], connections };
}

// the handles leaving one side of a node stand apart along it, in the order of where their lines
// go: for cards that keep their places (a flow), which no arranger turns or spreads
function handleSpreadByPlace(graph, registry) {
	const geometry = diagramGeometryEstimateBuild(graph, { registry });
	const centerXOf = (nodeId) => { const rect = geometry.rectOf(nodeId); return rect ? rect.x + rect.width / 2 : 0; };
	for (const node of graph.nodes) {
		const outList = node.handles.filter((item) => item.direction === 'out' && item.anchor.side === 'bottom');
		if (outList.length < 2) continue;
		const targetXOf = (item) => centerXOf(graph.connections.find((line) => line.source.nodeId === node.id && line.source.handleId === item.id)?.target.nodeId);
		[...outList].sort((a, b) => targetXOf(a) - targetXOf(b)).forEach((item, index) => { item.anchor.offset = Math.round(((index + 1) / (outList.length + 1)) * 1000) / 1000; });
	}
	return graph;
}

const arranged = (graph, registry, arranger = diagramArrangerLayers, options = {}) => {
	const { version: _version, ...diagram } = diagramArrangeApply({ version: 1, ...graph }, arranger, { registry, ...options }).diagram;
	return diagram;
};

// ---------- the scenes of a group

// every end a group's scenes draw, in one order: its resources, then what its relations reach. a
// flow adds what only its steps reach, in its own view
function groupEndListOf(model, group) {
	const endList = group.resourceList.filter((resource) => !resource.isEdge).map((resource) => resource.key);
	for (const relation of group.relationList) endList.push(relation.from, relation.to);
	endList.push(...group.resourceList.filter((resource) => resource.isEdge).map((resource) => resource.key));
	return [...new Set(endList)];
}

function groupViewListBuild(model, group, registry) {
	const endList = groupEndListOf(model, group);
	const relationList = group.relationList.map((relation, index) => ({ ...relation, id: `r${index + 1}` }));
	const resources = arranged(graphBuild(model, endList, relationList, { groupId: group.id }), registry);
	const overview = arranged(graphBuild(model, endList, relationList, { groupId: group.id, isMark: true }), registry, diagramArrangerLayers, { gapCard: 40 });
	// what the frame of the group shows where everything else is drawn around it: its own resources
	// alone, as marks, and what passes between them
	const ownSet = new Set(group.resourceList.map((resource) => resource.key));
	const frame = arranged(graphBuild(model, endList.filter((end) => ownSet.has(end)), relationList.filter((relation) => ownSet.has(relation.from) && ownSet.has(relation.to)), { groupId: group.id, isMark: true }), registry, diagramArrangerLayers, { gapCard: 40 });
	const viewList = [
		{ id: 'resources', label: 'Resources', title: `${group.label}: its resources`, diagram: resources },
		{ id: 'overview', label: 'Overview', title: `${group.label} at a glance`, diagram: overview },
		{ id: 'frame', label: 'Inside', isAvailableFocused: false, diagram: frame },
	];
	// a flow: the same cards where they stand in the resources, its steps as the lines
	const positionById = new Map(resources.nodes.map((node) => [node.id, node.position]));
	const sizeOf = diagramGeometryEstimateBuild(resources, { registry }).rectOf;
	for (const flow of group.flowList) {
		const stepList = flow.stepList.map((step, index) => ({ ...step, id: `s${index + 1}`, label: `${index + 1}${step.label ? ` ${step.label}` : ''}` }));
		const graph = graphBuild(model, [...new Set([...endList, ...stepList.flatMap((step) => [step.from, step.to])])], stepList, { groupId: group.id, styleOf: () => STEP_STYLE });
		// what only this flow reaches (a deploy user) stands in a column at the left, from the top
		const rectKnownList = [...positionById.keys()].map((id) => sizeOf(id)).filter(Boolean);
		const xLeft = Math.min(...rectKnownList.map((rect) => rect.x)) - NOTE_WIDTH - 90;
		const yTop = Math.min(...rectKnownList.map((rect) => rect.y));
		let newIndex = 0;
		for (const node of graph.nodes) node.position = positionById.get(node.id) ?? { x: xLeft, y: yTop + 120 * newIndex++ };
		if (flow.note) {
			const rectList = graph.nodes.map((node) => sizeOf(node.id)).filter(Boolean);
			const right = Math.max(...rectList.map((rect) => rect.x + rect.width));
			const top = Math.min(...rectList.map((rect) => rect.y));
			graph.nodes.push({ id: `note.${flow.id}`, renderer: { type: 'card-note' }, position: { x: right + 80, y: top }, size: { width: 260, height: 'auto' }, data: { title: String(flow.note.title ?? flow.label), text: flow.note.text === undefined ? undefined : String(flow.note.text), tone: flow.note.tone ?? 'blue' }, handles: [] });
		}
		viewList.push({ id: flow.id, label: flow.label, title: flow.title ? String(flow.title) : `${group.label}: ${flow.label}`, diagram: arranged(handleSpreadByPlace(graph, registry), registry, diagramArrangerLanesDown) });
	}
	return viewList;
}

// ---------- the detail of a resource

function detailDiagramBuild(model, resource, registry) {
	const { detail } = resource;
	if (detail.routeGroupList) {
		const nodes = listOf(detail.routeGroupList, `${resource.key}.detail.routeGroupList`).map((group, index) => ({
			id: String(group.id), renderer: { type: 'aws-route-group' }, size: { width: 330, height: 'auto' },
			data: { name: String(group.name ?? group.id), nameLogical: group.nameLogical ?? `${(group.routes ?? []).length} route${(group.routes ?? []).length === 1 ? '' : 's'}`, routes: (group.routes ?? []).map((route, at) => ({ id: route.id ?? `r${at + 1}`, method: route.method, path: route.path, auth: route.auth ?? 'token' })) },
			handles: [], position: { x: 0, y: 0 }, column: index % 4,
		}));
		return { nodes: columnsPlace(nodes, registry, 370), connections: [] };
	}
	if (detail.rowKindList) {
		const kindList = listOf(detail.rowKindList, `${resource.key}.detail.rowKindList`);
		const nodes = kindList.map((kind, index) => ({
			id: String(kind.id), renderer: { type: 'aws-dynamodb-table' }, size: { width: 360, height: 'auto' },
			data: { name: String(kind.name ?? kind.id), nameLogical: kind.nameLogical ?? `a row of ${resource.name}`, pk: kind.pk ?? '', sk: kind.sk ?? '', ...(kind.description ? { description: String(kind.description) } : {}), attributes: (kind.attributes ?? []).map((attribute) => ({ id: attribute.id ?? attribute.name, name: attribute.name ?? attribute.id, key: attribute.key ?? '', type: attribute.type ?? '', holds: attribute.holds ?? '' })) },
			handles: [], position: { x: 0, y: 0 }, column: Number.isInteger(kind.column) ? kind.column : index % 3,
		}));
		const byId = new Map(nodes.map((node) => [node.id, node]));
		const handleAdd = (node, item) => { if (!node.handles.some((one) => one.id === item.id)) node.handles.push(item); return item.id; };
		const connections = listOf(detail.linkList, `${resource.key}.detail.linkList`).flatMap((link, index) => {
			const [fromKind, attribute] = String(link.from).split('.');
			const from = byId.get(fromKind);
			const to = byId.get(String(link.to));
			if (!from || !to) throw new Error(`${resource.key}: the link ${link.from} to ${link.to} names a kind of row that is not there.`);
			const isRight = to.column > from.column || (to.column === from.column);
			const side = isRight ? 'right' : 'left';
			const sideTarget = to.column > from.column ? 'left' : to.column < from.column ? 'right' : 'right';
			const handleFrom = handleAdd(from, { id: `${attribute ?? 'body'}-${side}`, direction: 'out', anchor: { target: attribute ? `attribute/${attribute}` : 'body', side } });
			const handleTo = handleAdd(to, { id: `in-${sideTarget}`, direction: 'in', anchor: { target: 'body', side: sideTarget } });
			return [lineOf(`l${index + 1}`, [from.id, handleFrom], [to.id, handleTo], link.label ? String(link.label) : '', { style: LINK_STYLE })];
		});
		return arranged({ nodes: columnsPlace(nodes, registry, 540), connections }, registry, diagramArrangerLanesAcross);
	}
	if (detail.partList) {
		const partList = listOf(detail.partList, `${resource.key}.detail.partList`);
		const lineList = listOf(detail.linkList, `${resource.key}.detail.linkList`).map((link, index) => ({ id: `l${index + 1}`, from: String(link.from), to: String(link.to), label: link.label ? String(link.label) : '' }));
		const nodes = partList.map((part) => ({ id: String(part.id), renderer: { type: 'card-note' }, size: { width: NOTE_WIDTH, height: 'auto' }, data: { title: String(part.title ?? part.id), tag: part.tag, text: part.text, tone: part.tone ?? 'slate' }, handles: [] }));
		const byId = new Map(nodes.map((node) => [node.id, node]));
		const handleAdd = (node, item) => { if (!node.handles.some((one) => one.id === item.id)) node.handles.push(item); return item.id; };
		const connections = lineList.map((line) => {
			if (!byId.has(line.from) || !byId.has(line.to)) throw new Error(`${resource.key}: the link ${line.from} to ${line.to} names a part that is not there.`);
			return lineOf(line.id, [line.from, handleAdd(byId.get(line.from), handle(`out-${line.id}`, 'out', 'bottom'))], [line.to, handleAdd(byId.get(line.to), handle('in', 'in', 'top'))], line.label);
		});
		return arranged({ nodes, connections }, registry);
	}
	return { nodes: [], connections: [] };
}

// cards in the columns they name, each column a stack, from the estimated heights
function columnsPlace(nodes, registry, columnStep) {
	const geometry = diagramGeometryEstimateBuild({ nodes }, { registry });
	const topByColumn = new Map();
	return nodes.map(({ column, ...node }) => {
		const top = topByColumn.get(column) ?? 0;
		topByColumn.set(column, top + geometry.rectOf(node.id).height + 40);
		return { ...node, position: { x: column * columnStep, y: top } };
	});
}

// ---------- the scene of everything: the groups as frames

function rootDiagramBuild(model, registry, groupSizeById) {
	const unitOf = (end) => (model.clientById.has(end) ? end : `group.${model.resourceByKey.get(end).group}`);
	const lineByKey = new Map();
	for (const group of model.groupList) {
		for (const relation of group.relationList) {
			const from = unitOf(relation.from);
			const to = unitOf(relation.to);
			if (from === to) continue;
			const key = `${from}>${to}`;
			const line = lineByKey.get(key) ?? { id: `u${lineByKey.size + 1}`, from, to, labelList: [] };
			if (relation.label && !line.labelList.includes(relation.label)) line.labelList.push(relation.label);
			lineByKey.set(key, line);
		}
	}
	const nodeById = new Map();
	for (const client of model.clientById.values()) {
		if ([...lineByKey.values()].some((line) => line.from === client.id || line.to === client.id)) nodeById.set(client.id, clientNodeBuild(model, client.id));
	}
	for (const group of model.groupList) {
		const size = groupSizeById.get(group.id);
		nodeById.set(`group.${group.id}`, { id: `group.${group.id}`, renderer: { type: 'scene-embed' }, size, data: { scene: `${model.root}/${group.id}`, title: group.label, subtitle: group.project, icon: group.icon ?? 'cloud', tone: group.tone ?? 'teal' }, handles: [] });
	}
	const handleAdd = (nodeId, item) => {
		const node = nodeById.get(nodeId);
		if (!node.handles.some((one) => one.id === item.id)) node.handles.push(item);
		return item.id;
	};
	const connections = [...lineByKey.values()].map((line) => {
		const label = line.labelList.length > 2 ? `${line.labelList.slice(0, 2).join(' · ')} …` : line.labelList.join(' · ');
		return lineOf(line.id, [line.from, handleAdd(line.from, handle(`out-${line.id}`, 'out', 'bottom'))], [line.to, handleAdd(line.to, handle(`in-${line.id}`, 'in', 'top'))], label);
	});
	return arranged({ nodes: [...nodeById.values()], connections }, registry, diagramArrangerLayers, { gapCard: 90, gapLayer: 90 });
}

// the size of the frame of a group: its inside drawn at one scale in every frame (a smaller one only
// for a group too wide), so the marks of all groups read alike; as wide as its title needs at least
const FRAME_SCALE = 0.62;
function groupSizeOf(frame, registry) {
	const geometry = diagramGeometryEstimateBuild(frame, { registry });
	const rectList = frame.nodes.map((node) => geometry.rectOf(node.id)).filter(Boolean);
	if (rectList.length === 0) return { width: 220, height: 140 };
	const width = Math.max(...rectList.map((rect) => rect.x + rect.width)) - Math.min(...rectList.map((rect) => rect.x));
	const height = Math.max(...rectList.map((rect) => rect.y + rect.height)) - Math.min(...rectList.map((rect) => rect.y));
	const scale = Math.min(FRAME_SCALE, 680 / Math.max(1, width));
	return { width: Math.round(Math.max(220, scale * width + 48)), height: Math.round(scale * height + 34 + 48) };
}

// ---------- the provider

export function awsArchitectureProviderBuild(model, registry, { signature } = {}) {
	const viewListByGroup = new Map();
	const viewListOf = (group) => {
		if (!viewListByGroup.has(group.id)) viewListByGroup.set(group.id, groupViewListBuild(model, group, registry));
		return viewListByGroup.get(group.id);
	};
	let rootDiagram = null;
	const rootDiagramGet = () => {
		if (!rootDiagram) rootDiagram = rootDiagramBuild(model, registry, new Map(model.groupList.map((group) => [group.id, groupSizeOf(viewListOf(group).find((view) => view.id === 'frame').diagram, registry)])));
		return rootDiagram;
	};
	const detailCache = new Map();
	const groupOf = (id) => model.groupList.find((group) => group.id === id);
	const resourceOfPath = (path) => {
		const group = groupOf(switchPathLast(switchPathParent(path)));
		return group && switchPathParent(switchPathParent(path)) === model.root ? model.resourceByKey.get(`${group.id}.${switchPathLast(path)}`) : null;
	};
	const labelGet = (path) => {
		if (path === model.root) return model.title || switchPathLast(path) || 'system';
		const group = switchPathParent(path) === model.root ? groupOf(switchPathLast(path)) : null;
		if (group) return group.label;
		return resourceOfPath(path)?.name ?? switchPathLast(path);
	};
	const provider = {
		signature,
		root: model.root,
		title: model.title,
		labelGet,
		childListGet: (path) => {
			if (path === model.root) return model.groupList.map((group) => ({ path: `${model.root}/${group.id}`, label: group.label, description: group.description }));
			const group = switchPathParent(path) === model.root ? groupOf(switchPathLast(path)) : null;
			if (!group) return [];
			return group.resourceList.filter((resource) => resource.detail).map((resource) => ({ path: `${path}/${resource.id}`, label: resource.name }));
		},
		sceneGet: (path) => {
			if (path === model.root) return { path, label: labelGet(path), description: '', title: model.title || undefined, diagram: rootDiagramGet() };
			const group = switchPathParent(path) === model.root ? groupOf(switchPathLast(path)) : null;
			if (group) {
				return { path, label: group.label, description: group.description ?? '', title: group.label, viewList: viewListOf(group), viewDefault: [{ when: { isEmbedded: true }, view: 'frame' }, { view: 'resources' }], isViewSwitcherHiddenEmbedded: true };
			}
			const resource = resourceOfPath(path);
			if (!resource?.detail) return null;
			if (!detailCache.has(resource.key)) detailCache.set(resource.key, detailDiagramBuild(model, resource, registry));
			return { path, label: resource.name, description: '', title: `${resource.name}: ${resource.detail.title ?? (resource.detail.routeGroupList ? 'its routes' : resource.detail.rowKindList ? 'the kinds of its rows' : 'its parts')}`, diagram: detailCache.get(resource.key) };
		},
	};
	return provider;
}
