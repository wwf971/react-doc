import { MEMBER_ROOT_ID, PARAMETRIC_FEATURE_ID, copyNodeIdBuild, groupKeyOf, parametricRead } from './ParametricData.js';

// The solver of the parametric canvas (card-diagram-parametric-canvas.md#the-solver): where every
// member of every group stands, from the model (ParametricData.js) and the sizes of the nodes as
// drawn. Pure.
//
//   sizes    bottom-up: an object member is as large as its node (or as its size binding says), a
//            layout member as large as its layout makes its children
//   places   top-down: the origin, then each member from its parents by its constraint, a child
//            of a layout member where the layout puts it
//
// parametricSolve(model, catalog, { sizeOf(nodeId), override? }) answers
//   positionById   Map nodeId -> { x, y }: the nodes of the members, and the copies a repeat spawns
//   sizeById       Map nodeId -> { width?, height? }: the sizes bound to another member
//   boxByKey       Map `${groupId}/${memberId}` -> { x, y, width, height }: every member, `root` too
// override: Map nodeId -> { x, y }, the place of a node while it is dragged: what follows it follows
// it there, before anything is written
export function parametricSolve(model, catalog, { sizeOf, override }) {
	const result = { positionById: new Map(), sizeById: new Map(), boxByKey: new Map() };
	for (const group of model.groupList) groupSolve(group, catalog, sizeOf, override, result);
	return result;
}

// the key of the place of a origin while it is dragged, among the places of dragged nodes
export const rootOverrideKeyOf = groupId => `~root:${groupId}`;

function groupSolve(group, catalog, sizeOf, override, result) {
	const sizeById = new Map();
	const arrangementById = new Map();
	const boxById = new Map();
	const sizeOpenSet = new Set();
	const sizeGet = (memberId) => {
		if (memberId === MEMBER_ROOT_ID) return { width: 0, height: 0 };
		if (sizeById.has(memberId)) return sizeById.get(memberId);
		if (sizeOpenSet.has(memberId)) throw new Error(`parametric group ${group.id}: the size of member ${memberId} follows from itself.`);
		sizeOpenSet.add(memberId);
		const member = group.memberById.get(memberId);
		let size;
		if (member.layout) {
			const arrangement = catalog.layoutTypeByType[member.layout.type].arrange(member.layout, group.childListOf(memberId).map(child => ({ id: child.id, slot: child.slot, size: sizeGet(child.id) })));
			arrangementById.set(memberId, arrangement);
			size = arrangement.size;
		} else {
			size = { ...sizeOf(member.nodeId) };
			for (const axis of ['width', 'height']) {
				const binding = member.sizeBinding?.[axis];
				if (binding) size[axis] = Math.max(1, sizeGet(binding.memberId)[axis] * binding.factor + binding.add);
			}
		}
		sizeOpenSet.delete(memberId);
		sizeById.set(memberId, size);
		return size;
	};
	const boxGet = (memberId) => {
		if (boxById.has(memberId)) return boxById.get(memberId);
		let box;
		// the origin: where it is written, or where it is being dragged to (rootOverrideKeyOf)
		if (memberId === MEMBER_ROOT_ID) box = { ...(override?.get(rootOverrideKeyOf(group.id)) ?? group.root), width: 0, height: 0 };
		else {
			const member = group.memberById.get(memberId);
			const size = sizeGet(memberId);
			const parentDirect = group.memberById.get(member.parentIdList[0]);
			const dragged = member.nodeId ? override?.get(member.nodeId) : undefined;
			let position;
			if (dragged) position = dragged;
			else if (parentDirect?.layout) {
				const parentBox = boxGet(parentDirect.id);
				const place = arrangementById.get(parentDirect.id).placeById.get(memberId) ?? { x: 0, y: 0 };
				position = { x: parentBox.x + place.x, y: parentBox.y + place.y };
			} else position = catalog.constraintTypeByType[member.constraint.type].solve(member.constraint, { size, parentBoxList: member.parentIdList.map(boxGet) });
			box = { x: position.x, y: position.y, width: size.width, height: size.height };
		}
		boxById.set(memberId, box);
		return box;
	};
	result.boxByKey.set(groupKeyOf(group.id, MEMBER_ROOT_ID), boxGet(MEMBER_ROOT_ID));
	for (const member of group.memberList) {
		const box = boxGet(member.id);
		result.boxByKey.set(groupKeyOf(group.id, member.id), box);
		if (!member.nodeId) continue;
		result.positionById.set(member.nodeId, { x: box.x, y: box.y });
		if (member.sizeBinding) {
			const bound = {};
			for (const axis of ['width', 'height']) if (member.sizeBinding[axis]) bound[axis] = box[axis];
			result.sizeById.set(member.nodeId, bound);
		}
	}
	// the copies of a repeat: every node under it again, moved by the step of each copy
	for (const member of group.memberList) {
		const copyList = member.layout ? arrangementById.get(member.id)?.copyList ?? [] : [];
		if (!copyList.length) continue;
		for (const descendant of group.descendantListOf(member.id)) {
			if (!descendant.nodeId) continue;
			const box = boxGet(descendant.id);
			for (const copy of copyList) result.positionById.set(copyNodeIdBuild(group.id, member.id, copy.index, descendant.nodeId), { x: box.x + copy.x, y: box.y + copy.y });
		}
	}
}

// the placer of a diagram with groups (DiagramERData.js: layout.placerList): the engine asks it
// which nodes it places, and to place them each time sizes or a dragged place changed. What it
// answers (the solve) is kept by the canvas for whoever draws over it
export function parametricPlacerBuild(model, catalog) {
	const nodeIdSet = new Set([...model.memberByNodeId.keys(), ...model.copyList.map(copy => copy.nodeId)]);
	return {
		id: PARAMETRIC_FEATURE_ID,
		isPlaced: nodeId => nodeIdSet.has(nodeId),
		place({ nodes, positions, sizeById, sizeOf, override }) {
			const nodeById = new Map(nodes.map(node => [node.id, node]));
			const solved = parametricSolve(model, catalog, { sizeOf: nodeId => sizeOf(nodeById.get(nodeId)), override });
			for (const [nodeId, position] of solved.positionById) positions.set(nodeId, position);
			for (const [nodeId, size] of solved.sizeById) sizeById.set(nodeId, size);
			return solved;
		},
	};
}

// the nodes a repeat spawns, from the nodes of the diagram as normalized: a copy is drawn like its
// source and is nobody's to edit or to connect (isDerived), so it has no handles
export function parametricCopyNodeListBuild(model, nodes) {
	const nodeById = new Map(nodes.map(node => [node.id, node]));
	return model.copyList.flatMap((copy) => {
		const source = nodeById.get(copy.nodeIdSource);
		return source ? [{ ...source, id: copy.nodeId, handles: [], position: { x: 0, y: 0 }, isDerived: true, derived: { featureId: PARAMETRIC_FEATURE_ID, nodeIdSource: copy.nodeIdSource, groupId: copy.groupId, memberId: copy.memberId, index: copy.index } }] : [];
	});
}

// what the feature answers the engine for a diagram (node-registry.js: feature.graphResolve): the
// section read against the nodes, the copies its repeats spawn, and its placer. It is solved once
// here with the sizes as written, so what cannot be solved (a size that follows from itself) is
// refused when the diagram is read, with its reason, and never while it is drawn
export function parametricGraphResolveBuild(catalog) {
	return (value, graph) => {
		if (value === undefined || value === null) return undefined;
		const model = parametricRead(value, { nodes: graph.nodes, catalog });
		if (!model.groupList.length) return { data: { model } };
		const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
		const sizeWrittenOf = (nodeId) => {
			const node = nodeById.get(nodeId);
			return { width: node.size.width === 'auto' ? node.sizeDefault.width : node.size.width, height: node.size.height === 'auto' ? node.sizeDefault.height : node.size.height };
		};
		parametricSolve(model, catalog, { sizeOf: sizeWrittenOf });
		return { data: { model }, nodeList: parametricCopyNodeListBuild(model, graph.nodes), placer: parametricPlacerBuild(model, catalog) };
	};
}
