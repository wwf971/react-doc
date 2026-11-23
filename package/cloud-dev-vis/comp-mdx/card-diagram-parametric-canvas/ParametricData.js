// The data of the parametric canvas (card-diagram-parametric-canvas.md): the section `parametric`
// of a diagram, read and validated. Pure: no React, no canvas, no store.
//
//   parametric
//     groupList   [{ id, name?, root: { x, y }, memberList }]
//   member        { id, name?, node | layout, parent? | parentList?, constraint?, slot?, size? }
//     node        the id of the node of the diagram it places (an object member)
//     layout      { type, ... }: it arranges its children and places nothing itself (a layout member)
//     parent      the member it follows; `root` (the origin of the group) when absent.
//                 parentList for a constraint of several parents, the first the direct one
//     constraint  { type, ... } of a constraint type (ParametricConstraint.js); `offset` when absent.
//                 not read for a child of a layout member, which the layout places
//     slot        the slot of the parent's layout it fills (a pattern)
//     size        { width?, height? }, each { member, factor?, add? }: taken from another member
//
// A line of a group is not written: it is a connection of the diagram whose two ends are on
// members of the group (parametricLineListGet).
//
// Words kept apart (card-diagram-parametric-canvas.md#points-handles-and-anchors): a **point** is a
// point of the box of a member, what a constraint places or measures from; a **handle** is where a
// connection line leaves or arrives, standing on an **anchor** of the card (both of the framework,
// never read here); a **resize handle** changes the size of the node selected (the editor's). The
// **origin** of a group (`root`) is its one free place.
export const PARAMETRIC_FEATURE_ID = 'parametric-canvas';
export const PARAMETRIC_DATA_KEY = 'parametric';
export const MEMBER_ROOT_ID = 'root';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function mappingRead(value, field) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be a mapping.`);
	return value;
}

export function textRead(value, field) {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
	return value;
}

export function numberRead(value, field, min = -Infinity, max = Infinity) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field} must be a number${min > -Infinity ? ` >= ${min}` : ''}${max < Infinity ? ` <= ${max}` : ''}.`);
	return value;
}

export function choiceRead(value, field, valueList) {
	if (!valueList.includes(value)) throw new Error(`${field} is one of ${valueList.join(', ')}.`);
	return value;
}

// ---------- points ----------

// a point of the bounding box of a member, as fractions of the box: { x, y }, (0, 0) its top left
// corner. An author writes a name, a side with an offset along it, or the fractions themselves.
// A point is geometry of the box alone: a connection handle is not one (it belongs to the lines)
export const POINT_BY_NAME = {
	'top-left': { x: 0, y: 0 }, top: { x: 0.5, y: 0 }, 'top-right': { x: 1, y: 0 },
	left: { x: 0, y: 0.5 }, center: { x: 0.5, y: 0.5 }, right: { x: 1, y: 0.5 },
	'bottom-left': { x: 0, y: 1 }, bottom: { x: 0.5, y: 1 }, 'bottom-right': { x: 1, y: 1 },
};
export const SIDE_LIST = ['top', 'right', 'bottom', 'left'];

const sidePointOf = (side, offset) => (side === 'top' ? { x: offset, y: 0 } : side === 'bottom' ? { x: offset, y: 1 } : side === 'left' ? { x: 0, y: offset } : { x: 1, y: offset });

export function pointRead(value, field) {
	if (value === undefined || value === null) return null;
	if (typeof value === 'string') {
		const point = POINT_BY_NAME[value];
		if (!point) throw new Error(`${field}: unknown point "${value}" (${Object.keys(POINT_BY_NAME).join(', ')}).`);
		return { ...point };
	}
	mappingRead(value, field);
	if (own(value, 'handle')) throw new Error(`${field}: a point is of the box, not a connection handle: write the side it stands on, { side: right, offset: 0.5 }.`);
	if (own(value, 'side')) return sidePointOf(choiceRead(value.side, `${field}.side`, SIDE_LIST), numberRead(value.offset ?? 0.5, `${field}.offset`));
	return { x: numberRead(value.x, `${field}.x`), y: numberRead(value.y, `${field}.y`) };
}

// the name of a point, when it has one
export function pointNameOf(point) {
	return Object.keys(POINT_BY_NAME).find(name => POINT_BY_NAME[name].x === point.x && POINT_BY_NAME[name].y === point.y) ?? null;
}

// where a point of a box is on the canvas. box: { x, y, width, height }
export const pointAt = (box, point) => ({ x: box.x + box.width * point.x, y: box.y + box.height * point.y });

// ---------- the section ----------

export const groupKeyOf = (groupId, memberId) => `${groupId}/${memberId}`;

// the id of a node a repeat spawns: never an authored id (those do not start with ~)
export const copyNodeIdBuild = (groupId, memberId, index, nodeId) => `~copy:${groupId}:${memberId}:${index}:${nodeId}`;

// the section read against the nodes of the diagram (authored or normalized: their id, handles,
// around). catalog: { constraintTypeByType, layoutTypeByType }. Answers the model:
//   groupList        [{ id, name, root, memberList, memberById, childListOf(memberId), descendantListOf(memberId) }]
//   memberByNodeId   Map nodeId -> { groupId, memberId }
//   copyList         [{ nodeId, nodeIdSource, groupId, memberId, index }]: the nodes the repeats spawn
// a member read: { id, name, nodeId, layout, slot, parentIdList, constraint, sizeBinding }
export function parametricRead(value, { nodes = [], catalog }) {
	const model = { groupList: [], memberByNodeId: new Map(), copyList: [] };
	if (value === undefined || value === null) return model;
	mappingRead(value, PARAMETRIC_DATA_KEY);
	const nodeById = new Map(nodes.map(node => [node.id, node]));
	const groupIdSet = new Set();
	const groupListInput = value.groupList ?? [];
	if (!Array.isArray(groupListInput)) throw new Error('parametric.groupList must be a list.');
	for (const groupInput of groupListInput) {
		mappingRead(groupInput, 'parametric group');
		const groupId = textRead(groupInput.id, 'parametric group id');
		if (groupIdSet.has(groupId)) throw new Error(`parametric: duplicate group "${groupId}".`);
		groupIdSet.add(groupId);
		const field = `parametric group ${groupId}`;
		const rootInput = mappingRead(groupInput.root ?? { x: 0, y: 0 }, `${field}.root`);
		const root = { x: numberRead(rootInput.x, `${field}.root.x`), y: numberRead(rootInput.y, `${field}.root.y`) };
		const memberListInput = groupInput.memberList ?? [];
		if (!Array.isArray(memberListInput)) throw new Error(`${field}.memberList must be a list.`);
		const memberById = new Map();
		// first every member with what it is, so a constraint may name any of them
		const memberList = memberListInput.map((memberInput) => {
			mappingRead(memberInput, `${field} member`);
			const id = textRead(memberInput.id, `${field} member id`);
			if (id === MEMBER_ROOT_ID) throw new Error(`${field}: "${MEMBER_ROOT_ID}" is the origin of the group, not a member id.`);
			if (memberById.has(id)) throw new Error(`${field}: duplicate member "${id}".`);
			const fieldMember = `${field} member ${id}`;
			if (own(memberInput, 'node') === own(memberInput, 'layout')) throw new Error(`${fieldMember} has exactly one of node or layout.`);
			let nodeId = null;
			let layout = null;
			if (own(memberInput, 'node')) {
				nodeId = textRead(memberInput.node, `${fieldMember}.node`);
				const node = nodeById.get(nodeId);
				if (!node) throw new Error(`${fieldMember}: "${nodeId}" is not a node of the diagram.`);
				if (node.around) throw new Error(`${fieldMember}: "${nodeId}" is drawn around other nodes, which place it.`);
				if (model.memberByNodeId.has(nodeId)) throw new Error(`${fieldMember}: the node "${nodeId}" is placed by another member already.`);
				model.memberByNodeId.set(nodeId, { groupId, memberId: id });
			} else {
				const layoutInput = mappingRead(memberInput.layout, `${fieldMember}.layout`);
				const layoutType = catalog.layoutTypeByType[layoutInput.type];
				if (!layoutType) throw new Error(`${fieldMember}: unknown layout type "${layoutInput.type}" (${Object.keys(catalog.layoutTypeByType).join(', ')}).`);
				layout = layoutType.read(layoutInput, `${fieldMember}.layout`);
			}
			if (own(memberInput, 'parent') && own(memberInput, 'parentList')) throw new Error(`${fieldMember} has parent or parentList, not both.`);
			const parentIdList = own(memberInput, 'parentList') ? [...memberInput.parentList] : [memberInput.parent ?? MEMBER_ROOT_ID];
			if (!Array.isArray(parentIdList) || parentIdList.length === 0 || parentIdList.some(parentId => typeof parentId !== 'string')) throw new Error(`${fieldMember}.parentList is a list of member ids.`);
			const member = { id, name: typeof memberInput.name === 'string' ? memberInput.name : '', nodeId, layout, slot: memberInput.slot ?? null, parentIdList, constraint: null, sizeBinding: null, input: memberInput };
			memberById.set(id, member);
			return member;
		});
		const childListOf = memberId => memberList.filter(member => member.parentIdList[0] === memberId);
		for (const member of memberList) {
			const fieldMember = `${field} member ${member.id}`;
			const memberInput = member.input;
			for (const parentId of member.parentIdList) {
				if (parentId === member.id) throw new Error(`${fieldMember} cannot follow itself.`);
				if (parentId !== MEMBER_ROOT_ID && !memberById.has(parentId)) throw new Error(`${fieldMember}: its parent "${parentId}" is not a member of the group.`);
			}
			const parentDirect = memberById.get(member.parentIdList[0]);
			if (parentDirect?.layout) {
				// a child of a layout member: the layout places it
				const layoutType = catalog.layoutTypeByType[parentDirect.layout.type];
				if (member.parentIdList.length > 1) throw new Error(`${fieldMember}: a child of a layout has one parent.`);
				if (layoutType.childMax !== undefined && childListOf(parentDirect.id).length > layoutType.childMax) throw new Error(`${field} member ${parentDirect.id}: a ${layoutType.label.toLowerCase()} takes ${layoutType.childMax === 1 ? 'one child' : `${layoutType.childMax} children`}.`);
				if (layoutType.slotList) {
					if (!layoutType.slotList.some(slot => slot.id === member.slot)) throw new Error(`${fieldMember}: its slot is one of ${layoutType.slotList.map(slot => slot.id).join(', ')}.`);
					if (childListOf(parentDirect.id).filter(item => item.slot === member.slot).length > 1) throw new Error(`${field} member ${parentDirect.id}: the slot "${member.slot}" is filled twice.`);
				}
			} else {
				const constraintInput = mappingRead(memberInput.constraint ?? { type: 'offset' }, `${fieldMember}.constraint`);
				const constraintType = catalog.constraintTypeByType[constraintInput.type ?? 'offset'];
				if (!constraintType) throw new Error(`${fieldMember}: unknown constraint type "${constraintInput.type}" (${Object.keys(catalog.constraintTypeByType).join(', ')}).`);
				if (constraintType.parentCount !== member.parentIdList.length) throw new Error(`${fieldMember}: a ${constraintType.type} constraint has ${constraintType.parentCount === 1 ? 'one parent' : `${constraintType.parentCount} parents`}.`);
				// pointRead(value, key): a point of the box of the member or of a parent
				member.constraint = constraintType.read(constraintInput, {
					field: `${fieldMember}.constraint`,
					pointRead: (pointValue, key) => pointRead(pointValue, `${fieldMember}.constraint.${key}`),
				});
			}
			if (memberInput.size !== undefined) {
				if (member.layout) throw new Error(`${fieldMember}: the size of a layout follows from its children.`);
				const sizeInput = mappingRead(memberInput.size, `${fieldMember}.size`);
				member.sizeBinding = {};
				for (const axis of ['width', 'height']) {
					if (sizeInput[axis] === undefined) continue;
					const binding = mappingRead(sizeInput[axis], `${fieldMember}.size.${axis}`);
					const memberId = textRead(binding.member, `${fieldMember}.size.${axis}.member`);
					if (memberId === member.id || !memberById.has(memberId)) throw new Error(`${fieldMember}.size.${axis}: "${memberId}" is not another member of the group.`);
					member.sizeBinding[axis] = { memberId, factor: numberRead(binding.factor ?? 1, `${fieldMember}.size.${axis}.factor`), add: numberRead(binding.add ?? 0, `${fieldMember}.size.${axis}.add`) };
				}
			}
		}
		for (const member of memberList) delete member.input;
		// the place of a member follows from its parents: no member may be its own ancestor
		const stateById = new Map();
		const visit = (memberId, chain) => {
			if (memberId === MEMBER_ROOT_ID || stateById.get(memberId) === 'done') return;
			if (stateById.get(memberId) === 'open') throw new Error(`${field}: ${[...chain, memberId].join(' -> ')} follow each other in a circle.`);
			stateById.set(memberId, 'open');
			for (const parentId of memberById.get(memberId).parentIdList) visit(parentId, [...chain, memberId]);
			stateById.set(memberId, 'done');
		};
		for (const member of memberList) visit(member.id, []);
		const descendantListOf = (memberId) => {
			const result = [];
			const walk = (id) => { for (const child of childListOf(id)) { result.push(child); walk(child.id); } };
			walk(memberId);
			return result;
		};
		const group = { id: groupId, name: typeof groupInput.name === 'string' ? groupInput.name : '', root, memberList, memberById, childListOf, descendantListOf };
		// what a repeat spawns: a copy of every node under it, for each further time
		for (const member of memberList) {
			if (!member.layout) continue;
			const copyCount = catalog.layoutTypeByType[member.layout.type].copyCountGet?.(member.layout) ?? 0;
			for (let index = 1; index <= copyCount; index += 1) {
				for (const descendant of descendantListOf(member.id)) {
					if (descendant.nodeId) model.copyList.push({ nodeId: copyNodeIdBuild(groupId, member.id, index, descendant.nodeId), nodeIdSource: descendant.nodeId, groupId, memberId: member.id, memberIdSource: descendant.id, index });
				}
			}
		}
		model.groupList.push(group);
	}
	return model;
}

// the lines of a group: the connections of the diagram whose two ends are on members of it. Its
// parents are those two members; the direct one, under which a tree lists it, is the end more to
// the left (xOf(memberId), when places are known), else its source
export function parametricLineListGet(model, connections, xOf) {
	const result = [];
	for (const connection of connections ?? []) {
		const sourceAt = model.memberByNodeId.get(connection.source?.nodeId);
		const targetAt = model.memberByNodeId.get(connection.target?.nodeId);
		if (!sourceAt || !targetAt || sourceAt.groupId !== targetAt.groupId) continue;
		const isTargetLeft = xOf ? (xOf(targetAt.groupId, targetAt.memberId) ?? 0) < (xOf(sourceAt.groupId, sourceAt.memberId) ?? 0) : false;
		result.push({ connectionId: connection.id, groupId: sourceAt.groupId, memberIdList: [sourceAt.memberId, targetAt.memberId], memberIdDirect: isTargetLeft ? targetAt.memberId : sourceAt.memberId });
	}
	return result;
}
