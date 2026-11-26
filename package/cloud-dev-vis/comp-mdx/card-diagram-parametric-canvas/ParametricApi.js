import { MEMBER_ROOT_ID, PARAMETRIC_FEATURE_ID, groupKeyOf } from './ParametricData.js';
import { ParametricEditStore } from './ParametricEditStore.js';
import { toolListBuild } from './ParametricTool.js';
import { referencePointWrite } from './ParametricReferencePoint.js';

// The apis of the parametric canvas (card-diagram-parametric-canvas.md#for-an-agent): what the tool
// bar, the panel and the edit card do to the groups of a diagram, for an agent or a script. They
// join the apis of every diagram component whose registry lists the feature (DiagramApiList.js:
// feature.apiListBuild), and every write is a command of the session (ParametricEditStore.js), so
// its validation and its step of the history are the editor's: on the draft of an open session
// when there is one, else written into the block as a save would.
//
// The session is the open editor's when the diagram is edited, else one made for the call over the
// draft (sizes as written: a member whose card follows its content is placed by its estimate).
export function parametricApiListBuild({ catalog, toolMap }) {
	return ({ changeApi, readApi }) => {
		// the session of the call, and what to do once it is done
		const sessionOf = (store, diagram) => {
			const open = diagram?.editor?.featureList?.find(item => item.id === PARAMETRIC_FEATURE_ID);
			if (open) return { session: open, done: () => {} };
			const session = new ParametricEditStore({ store, registry: store.registry, catalog, toolMapGet: () => toolMap });
			return { session, done: () => session.dispose() };
		};
		const withSession = command => (store, params, endsGet, diagram) => {
			const { session, done } = sessionOf(store, diagram);
			try { return command(session, params); } finally { done(); }
		};
		const groupParam = { name: 'groupId', type: 'string', isRequired: true, description: 'the id of the group (parametricGroupListGet lists them)' };
		const memberParam = { name: 'memberId', type: 'string', isRequired: true, description: 'the id of the member' };
		return [
			readApi({
				name: 'parametricGroupListGet',
				label: 'Read the parametric groups of a diagram',
				description: 'Every group with its origin and its members: what each places (a node, or a layout and its parameters), what it follows (its parents, its slot in a pattern), how (its constraint), in a few words, and the box where it stands.',
				paramList: [],
			}, (store, params, diagram) => {
				const { session, done } = sessionOf(store, diagram);
				try {
					const solved = session.solve();
					return {
						groupList: session.model.groupList.map(group => ({
							id: group.id, name: group.name, root: group.root,
							memberList: group.memberList.map((member) => {
								const box = solved.boxByKey.get(groupKeyOf(group.id, member.id));
								return {
									id: member.id, name: member.name || undefined, nodeId: member.nodeId ?? undefined, layout: member.layout ?? undefined,
									parentIdList: member.parentIdList, slot: member.slot ?? undefined, constraint: member.constraint ?? undefined,
									// the reference points it declares and its default one, as written (that of its outline when absent)
									outline: member.outline.kind,
									referencePointList: member.referencePointList.length ? member.referencePointList.map(item => ({ id: item.id, name: item.name || undefined, point: referencePointWrite(item.point, catalog.referenceFormatList) })) : undefined,
									referencePointDefault: referencePointWrite(member.referencePointDefault, catalog.referenceFormatList),
									summary: session.memberSummaryOf(group.id, member.id),
									box: box ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) } : undefined,
								};
							}),
						})),
						constraintTypeList: catalog.constraintTypeList.map(item => item.type),
						layoutTypeList: catalog.layoutTypeList.map(item => ({ type: item.type, slotList: item.slotList?.map(slot => slot.id) })),
						referenceFormatList: catalog.referenceFormatList.map(item => ({ id: item.id, outlineKindList: item.outlineKindList })),
						toolList: toolListBuild(toolMap).filter(tool => tool.type === 'tool').map(tool => ({ id: tool.id, label: tool.label, create: tool.create })),
					};
				} finally { done(); }
			}),
			changeApi({ name: 'parametricGroupAdd', label: 'Add a parametric group', description: 'Its origin at a place; nodes given go into it where they stand. Answers the id of the group.', paramList: [
				{ name: 'x', type: 'number', isRequired: true, description: 'the origin, in diagram coordinates' },
				{ name: 'y', type: 'number', isRequired: true, description: 'the origin' },
				{ name: 'nodeIdList', type: 'list', description: 'free nodes to take in, where they stand' },
			] }, withSession((session, { x, y, nodeIdList }) => session.groupAdd({ x, y }, { nodeIdList: nodeIdList ?? [] }))),
			changeApi({ name: 'parametricMemberAdd', label: 'Put a node into a parametric group', description: 'A free node becomes a member under a parent (the origin when absent), where it stands. Answers the id of the member.', paramList: [
				groupParam, { name: 'nodeId', type: 'string', isRequired: true, description: 'the free node' }, { name: 'parentId', type: 'string', description: 'the member it follows; the origin when absent' },
			] }, withSession((session, { groupId, nodeId, parentId }) => session.memberAdd(groupId, nodeId, { parentId: parentId || MEMBER_ROOT_ID }))),
			changeApi({ name: 'parametricMemberParentSet', label: 'Put a member under another parent', description: 'It stays where it is: its constraint is computed so. Under a layout, the layout places it (a pattern into a free slot).', paramList: [
				groupParam, memberParam, { name: 'parentId', type: 'string', isRequired: true, description: 'the new parent: a member, or root' },
				{ name: 'constraintType', type: 'string', description: 'the constraint it gets under a parent that is no layout (offset when absent)' },
			] }, withSession((session, { groupId, memberId, parentId, constraintType }) => session.memberParentSet(groupId, memberId, parentId, constraintType ? { type: constraintType } : undefined))),
			changeApi({ name: 'parametricMemberSet', label: 'Change how a member is placed', description: 'Another constraint type (computed to keep it where it is), or one parameter of its constraint or of its layout (gap, side, columns, …).', paramList: [
				groupParam, memberParam,
				{ name: 'constraintType', type: 'string', description: 'another constraint type: offset, beside, between …' },
				{ name: 'of', type: 'string', valueList: ['constraint', 'layout'], description: 'whose parameter key is: its constraint, or its layout' },
				{ name: 'key', type: 'string', description: 'the parameter' },
				{ name: 'value', type: 'any', description: 'its value' },
			] }, withSession((session, { groupId, memberId, constraintType, of, key, value }) => {
				if (constraintType) return session.memberConstraintTypeSet(groupId, memberId, constraintType);
				if (!key) { session.store.message = 'Say constraintType, or the key and the value of a parameter.'; return false; }
				return of === 'layout' ? session.memberLayoutParamSet(groupId, memberId, key, value) : session.memberConstraintParamSet(groupId, memberId, key, value);
			})),
			changeApi({ name: 'parametricReferencePointSet', label: 'Change the reference points of a member', description: 'The points a constraint places or measures from. add: declares one (answers its id); set: its name or where it is; remove: takes it away, what was measured by it measured by the same place of the box; default: makes one its default reference point (pointId absent: that of its outline again), nothing moving.', paramList: [
				groupParam, memberParam,
				{ name: 'action', type: 'string', isRequired: true, valueList: ['add', 'set', 'remove', 'default'], description: 'what to do' },
				{ name: 'pointId', type: 'string', description: 'the id of a declared reference point (set, remove, default)' },
				{ name: 'name', type: 'string', description: 'its name (add, set)' },
				{ name: 'point', type: 'any', description: 'where it is, as written: center, { side: left, index: 2, count: 3 }, { angle: 45 }, { vertex: 2 }, { lineX, lineY } (add, set)' },
			] }, withSession((session, { groupId, memberId, action, pointId, name, point }) => {
				const read = () => (point === undefined ? undefined : session.referencePointReadOf(point));
				if (action === 'add') return session.memberReferencePointAdd(groupId, memberId, { point: read(), name });
				if (action === 'set') return session.memberReferencePointSet(groupId, memberId, pointId, { name, point: read() });
				if (action === 'remove') return session.memberReferencePointRemove(groupId, memberId, pointId);
				if (action === 'default') return session.memberReferencePointDefaultSet(groupId, memberId, pointId || null);
				session.store.message = 'action is one of add, set, remove, default.';
				return false;
			})),
			changeApi({ name: 'parametricLocatorLineSet', label: 'Change the lines of a locator', description: 'add: a line on an axis (after its last one unless a place is given; answers its id); set: its place or its name (what stands on it follows; isFollowerShifted: the lines after it move as far); remove: what stood on it stays where it stands.', paramList: [
				groupParam, memberParam,
				{ name: 'axis', type: 'string', isRequired: true, valueList: ['x', 'y'], description: 'x: its vertical lines; y: its horizontal lines' },
				{ name: 'action', type: 'string', isRequired: true, valueList: ['add', 'set', 'remove'], description: 'what to do' },
				{ name: 'lineId', type: 'string', description: 'the id of the line (set, remove)' },
				{ name: 'at', type: 'number', description: 'its place from the origin of the locator (add, set)' },
				{ name: 'name', type: 'string', description: 'its name (add, set)' },
				{ name: 'isFollowerShifted', type: 'boolean', description: 'set: the lines after it move as far' },
			] }, withSession((session, { groupId, memberId, axis, action, lineId, at, name, isFollowerShifted }) => {
				if (action === 'add') return session.locatorLineAdd(groupId, memberId, axis, { at, name });
				if (action === 'set') return session.locatorLineSet(groupId, memberId, axis, lineId, { at, name }, { isFollowerShifted: isFollowerShifted === true });
				if (action === 'remove') return session.locatorLineRemove(groupId, memberId, axis, lineId);
				session.store.message = 'action is one of add, set, remove.';
				return false;
			})),
			changeApi({ name: 'parametricMemberRemove', label: 'Take a member out of its group', description: 'What followed it follows its parent, where it stands; its node stays, free, unless isNodeRemoved.', paramList: [
				groupParam, memberParam, { name: 'isNodeRemoved', type: 'boolean', description: 'its node goes with it' },
			] }, withSession((session, { groupId, memberId, isNodeRemoved }) => session.memberRemove(groupId, memberId, { isNodeRemoved: isNodeRemoved === true }))),
			changeApi({ name: 'parametricToolPlace', label: 'Make what a tool makes, at a place', description: 'A tool of the tool bar (parametricGroupListGet lists them), or a create of your own ({ what: node | layout | group | connection, … }), its top left corner at a place; into a group under a parent when groupId is given, else free.', paramList: [
				{ name: 'toolId', type: 'string', description: 'the id of a tool' },
				{ name: 'create', type: 'any', description: 'what to make, in the place of a tool' },
				{ name: 'x', type: 'number', isRequired: true, description: 'the place, in diagram coordinates' },
				{ name: 'y', type: 'number', isRequired: true, description: 'the place' },
				{ name: 'groupId', type: 'string', description: 'the group it goes into' },
				{ name: 'parentId', type: 'string', description: 'the member it goes under (a layout arranges it); the origin when absent' },
			] }, withSession((session, { toolId, create, x, y, groupId, parentId }) => {
				const tool = create ? { id: 'api', label: 'What was asked', create } : session.toolList.find(item => item.id === toolId && item.type === 'tool');
				if (!tool) { session.store.message = `No tool has the id "${toolId}".`; return null; }
				return session.toolPlace(tool, { x, y }, groupId ? { groupId, parentId: parentId || MEMBER_ROOT_ID } : null);
			})),
		];
	};
}
