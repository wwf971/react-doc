import { POINT_BY_NAME, MEMBER_ROOT_ID, pointNameOf, groupKeyOf } from './ParametricData.js';

// What the parametric canvas shows of a thing in the editor, as data (card-diagram-parametric-canvas.md#the-editor):
// the sections it adds to the edit card of a node, the edit card of a group or of a layout member,
// and what can be done with a thing (the actions of the panel of a right-click). In the forms of
// the framework (DiagramEditCardModel.js: section, property, action; DiagramCreatePanel.jsx:
// action, state), so the same components draw them.
const POINT_CUSTOM = 'custom';
const pointNameList = Object.keys(POINT_BY_NAME);
const pointLabels = { 'top-left': 'Top left', top: 'Top', 'top-right': 'Top right', left: 'Left', center: 'Center', right: 'Right', 'bottom-left': 'Bottom left', bottom: 'Bottom', 'bottom-right': 'Bottom right', [POINT_CUSTOM]: 'Custom' };
const round = value => Math.round(value * 1000) / 1000;

// a command of the session run as a change of the editor (the draft is reported after it)
function changeOf(editor, operation) {
	let result = false;
	editor.change(() => { result = operation(); });
	return Boolean(result);
}

// the properties of the parameters of a constraint or a layout (their propertyList), for the edit
// card. valueOf(id): the value as resolved; set(id, value, isTyped): writes one
function paramPropertyListBuild(definitionList, valueOf, set) {
	return definitionList.flatMap((definition) => {
		const value = valueOf(definition.id);
		if (definition.kind === 'number') {
			return [{ id: definition.id, label: definition.label, kind: 'number', value: round(value ?? definition.valueDefault), step: definition.step, min: definition.min, max: definition.max, set: (next) => { const number = Number(next); return Number.isFinite(number) && set(definition.id, number, true); } }];
		}
		if (definition.kind === 'enum') {
			// the values of a menu are words: a number is written back as the number it stands for
			return [{ id: definition.id, label: definition.label, kind: 'enum', value: String(value ?? definition.valueDefault), values: definition.values.map(String), valueLabels: Object.fromEntries(definition.values.map(item => [String(item), definition.valueLabels?.[item] ?? String(item)])), set: next => set(definition.id, definition.values.find(item => String(item) === next), false) }];
		}
		if (definition.kind === 'point') {
			// a point of a box: one of the nine named ones, or fractions of the box typed
			const point = value ?? POINT_BY_NAME[definition.valueDefault];
			const name = pointNameOf(point) ?? POINT_CUSTOM;
			const propertyList = [{ id: definition.id, label: definition.label, kind: 'enum', value: name, values: [...pointNameList, POINT_CUSTOM], valueLabels: pointLabels, set: next => set(definition.id, next === POINT_CUSTOM ? { x: round(point.x), y: round(point.y) } : next, false) }];
			if (name === POINT_CUSTOM) {
				for (const axis of ['x', 'y']) propertyList.push({ id: `${definition.id}-${axis}`, label: `${definition.label} ${axis.toUpperCase()}`, kind: 'number', value: round(point[axis]), step: 0.05, set: (next) => { const number = Number(next); return Number.isFinite(number) && set(definition.id, { ...point, [axis]: number }, true); } });
			}
			return propertyList;
		}
		return [];
	});
}

// the members a member may follow: every other member that does not follow it, and the origin
function parentCandidateListGet(session, groupId, memberId) {
	const group = session.groupModelGet(groupId);
	const descendantIdSet = new Set(group.descendantListOf(memberId).map(member => member.id));
	return [MEMBER_ROOT_ID, ...group.memberList.filter(member => member.id !== memberId && !descendantIdSet.has(member.id)).map(member => member.id)];
}

const memberWordsOf = (session, groupId, memberId) => {
	const names = session.memberLabelOf(groupId, memberId);
	return names.kindLabel && memberId !== MEMBER_ROOT_ID ? `${names.label} (${names.kindLabel.toLowerCase()})` : names.label;
};

// how a member is placed: its parent, its constraint type, the parameters of the constraint; for a
// child of a layout, the layout that places it
function placementSectionBuild(session, groupId, memberId, editor) {
	const group = session.groupModelGet(groupId);
	const member = group.memberById.get(memberId);
	const groupWritten = session.groupGet(groupId);
	const candidateList = parentCandidateListGet(session, groupId, memberId);
	const labelsOf = idList => Object.fromEntries(idList.map(id => [id, memberWordsOf(session, groupId, id)]));
	const parentDirect = group.memberById.get(member.parentIdList[0]);
	const propertyList = [{
		id: 'parent', label: member.parentIdList.length > 1 ? 'First parent' : 'Parent', kind: 'enum', value: member.parentIdList[0], values: candidateList, valueLabels: labelsOf(candidateList), isSearchable: candidateList.length > 8,
		set: next => changeOf(editor, () => (member.parentIdList.length > 1 ? session.memberBetweenSet(groupId, memberId, next, member.parentIdList[1]) : session.memberParentSet(groupId, memberId, next, { type: member.constraint?.type }))),
	}];
	let note;
	if (parentDirect?.layout) note = `Its ${session.catalog.layoutTypeByType[parentDirect.layout.type].label.toLowerCase()} places it. Drag it among the others to order it.`;
	else {
		const constraintType = session.catalog.constraintTypeByType[member.constraint.type];
		if (member.parentIdList.length > 1) {
			const secondList = candidateList.filter(id => id !== member.parentIdList[0]);
			propertyList.push({ id: 'parent-second', label: 'Second parent', kind: 'enum', value: member.parentIdList[1], values: secondList, valueLabels: labelsOf(secondList), isSearchable: secondList.length > 8, set: next => changeOf(editor, () => session.memberBetweenSet(groupId, memberId, member.parentIdList[0], next)) });
		}
		propertyList.push({
			id: 'constraint-type', label: 'Placed by', kind: 'enum', value: constraintType.type, values: session.catalog.constraintTypeList.map(type => type.type), valueLabels: Object.fromEntries(session.catalog.constraintTypeList.map(type => [type.type, type.label])),
			set: next => changeOf(editor, () => session.memberConstraintTypeSet(groupId, memberId, next)),
		});
		propertyList.push(...paramPropertyListBuild(constraintType.propertyList, id => member.constraint[id], (id, value, isTyped) => changeOf(editor, () => session.memberConstraintParamSet(groupId, memberId, id, value, { groupKey: isTyped ? `parametric:${groupId}/${memberId}/constraint/${id}` : null }))));
		note = constraintType.description;
	}
	return { id: 'parametric-placement', label: `Placement in ${groupWritten?.name || 'its group'}`, propertyList, note, actionList: [] };
}

// the size of an object member taken from another member, or its own
function sizeSectionBuild(session, groupId, memberId, editor) {
	const group = session.groupModelGet(groupId);
	const member = group.memberById.get(memberId);
	const otherList = group.memberList.filter(other => other.id !== memberId).map(other => other.id);
	const valueLabels = { '': 'Its own', ...Object.fromEntries(otherList.map(id => [id, memberWordsOf(session, groupId, id)])) };
	return {
		id: 'parametric-size', label: 'Size', actionList: [],
		propertyList: [['width', 'Width from'], ['height', 'Height from']].map(([axis, label]) => ({ id: `size-${axis}`, label, kind: 'enum', value: member.sizeBinding?.[axis]?.memberId ?? '', values: ['', ...otherList], valueLabels, isSearchable: otherList.length > 8, set: next => changeOf(editor, () => session.memberSizeBindingSet(groupId, memberId, axis, next || null)) })),
	};
}

// what the feature adds to the edit card of a node: for a member how it is placed and sized, for
// a free element the groups it can join
export function nodeSectionListBuild(session, nodeId, editor) {
	const at = session.memberOfNode(nodeId);
	if (!at) {
		return [{ id: 'parametric-free', label: 'Placement', propertyList: [], note: 'A free element: its place is its own. In a group its place follows from the members it is put under.', actionList: [
			...session.groupList.map(group => ({ id: `group-join-${group.id}`, label: `Add to ${group.name || 'the group'}`, act: () => changeOf(editor, () => session.memberAdd(group.id, nodeId)) })),
			{ id: 'group-new', label: 'New group with it', act: () => changeOf(editor, () => session.groupAdd(session.nodePositionGet(nodeId), { nodeIdList: [nodeId] })) },
		] }];
	}
	return [
		placementSectionBuild(session, at.groupId, at.memberId, editor),
		sizeSectionBuild(session, at.groupId, at.memberId, editor),
		{ id: 'parametric-actions', label: '', propertyList: [], actionList: [{ id: 'member-remove', label: 'Take out of the group', act: () => changeOf(editor, () => session.memberRemove(at.groupId, at.memberId)) }] },
	];
}

// the edit card of what the feature focuses: a group (its origin), or a layout member
export function focusCardModelBuild(session, focus, editor) {
	const modelOf = (title, kindLabel, sectionList) => ({ title, kindLabel, tabList: [], tabId: null, segmentList: [], view: { type: 'detail', sectionList } });
	if (focus.kind === 'group') {
		const group = session.groupGet(focus.groupId);
		const rootSet = (axis, value) => { const number = Number(value); return Number.isFinite(number) && changeOf(editor, () => session.groupRootSet(group.id, { ...group.root, [axis]: number }, { groupKey: `parametric:${group.id}/root/${axis}` })); };
		return modelOf(group.name || 'Group', 'Parametric group', [
			{ id: 'group', label: 'Group', actionList: [], note: 'Everything in the group follows its origin: move it and the whole group moves.', propertyList: [
				{ id: 'name', label: 'Name', kind: 'text', value: group.name ?? '', placeholder: 'Group', set: value => changeOf(editor, () => session.groupNameSet(group.id, String(value).trim())) },
				{ id: 'root-x', label: 'Root X', kind: 'number', value: group.root?.x ?? 0, step: 1, set: value => rootSet('x', value) },
				{ id: 'root-y', label: 'Root Y', kind: 'number', value: group.root?.y ?? 0, step: 1, set: value => rootSet('y', value) },
			] },
			{ id: 'group-actions', label: '', propertyList: [], actionList: [{ id: 'group-remove', label: 'Remove group', kind: 'danger', act: () => changeOf(editor, () => session.groupRemove(group.id)) }], note: 'Its elements stay where they stand, as free elements.' },
		]);
	}
	const member = session.groupModelGet(focus.groupId).memberById.get(focus.memberId);
	const memberWritten = session.memberGet(focus.groupId, focus.memberId);
	const layoutType = session.catalog.layoutTypeByType[member.layout.type];
	return modelOf(memberWritten.name || layoutType.label, 'Layout', [
		{ id: 'layout', label: layoutType.label, actionList: [], note: layoutType.description, propertyList: [
			{ id: 'name', label: 'Name', kind: 'text', value: memberWritten.name ?? '', placeholder: layoutType.label, set: value => changeOf(editor, () => session.memberNameSet(focus.groupId, focus.memberId, String(value).trim())) },
			...paramPropertyListBuild(layoutType.propertyList, id => member.layout[id], (id, value, isTyped) => changeOf(editor, () => session.memberLayoutParamSet(focus.groupId, focus.memberId, id, value, { groupKey: isTyped ? `parametric:${focus.groupId}/${focus.memberId}/layout/${id}` : null }))),
		] },
		placementSectionBuild(session, focus.groupId, focus.memberId, editor),
		{ id: 'layout-actions', label: '', propertyList: [], actionList: [{ id: 'member-remove', label: 'Remove layout', kind: 'danger', act: () => changeOf(editor, () => session.memberRemove(focus.groupId, focus.memberId)) }], note: 'Its children stay where they stand, under its parent.' },
	]);
}

// where the box of a focus is on the screen, for its edit card: the origin of a group, the
// box of a layout member
export function focusRectGet(session, focus, editor) {
	const canvas = editor.canvas.current;
	const box = canvas?.placedGet?.(session.id)?.boxByKey.get(groupKeyOf(focus.groupId, focus.kind === 'group' ? MEMBER_ROOT_ID : focus.memberId));
	return box && canvas.boxRectGet ? canvas.boxRectGet(box.width || box.height ? box : { x: box.x - 8, y: box.y - 8, width: 16, height: 16 }) : null;
}

// ---------- what can be done with a thing (the panel of a right-click) ----------

// a state of the panel asking for a member of a group: the words typed narrow them
function memberPickStateBuild(session, groupId, idList, { id, label, placeholder, choose }) {
	return {
		id, label, placeholder,
		search: (text) => {
			const wordList = text.toLowerCase().split(/\s+/).filter(Boolean);
			const entryList = idList.map(memberId => ({ id: memberId, label: session.memberLabelOf(groupId, memberId).label, description: memberId === MEMBER_ROOT_ID ? 'the origin of the group' : session.memberSummaryOf(groupId, memberId) }))
				.filter(entry => wordList.every(word => `${entry.label} ${entry.description}`.toLowerCase().includes(word)));
			return { entryList, note: entryList.length ? '' : 'No member matches.' };
		},
		choose,
	};
}

// the tools as actions: what each makes is put at the place asked, into a group when one is given
function toolActionListBuild(session, toolIconGet, target, positionGet) {
	return session.toolList.filter(tool => tool.type === 'tool' && tool.create && (!target || tool.create.what === 'node' || tool.create.what === 'layout')).map(tool => ({
		id: `tool:${tool.id}`, label: target ? `Add ${tool.label.toLowerCase()}` : tool.label, description: tool.description ?? '', icon: toolIconGet?.(tool), keywordList: [tool.create.what, tool.create.kind ?? '', tool.create.layout?.type ?? ''],
		start: ({ position, editor }) => { editor.change(() => session.toolPlace(tool, positionGet ? positionGet() : position, target)); },
	}));
}

// target: { kind: canvas | node | line | group | member, position?, nodeId?, connectionId?, groupId?, memberId? }
// toolIconGet(tool): the icon of a tool, from whoever draws (this file knows no icon)
export function actionListBuild(session, target, editor, toolIconGet) {
	const run = operation => ({ editor: editorGiven }) => { changeOf(editorGiven ?? editor, operation); };
	// an action taking something away: in red, with the icon of removing (whoever draws gives it)
	const removeLook = { kind: 'danger', ...(session.iconGet?.('remove') ? { icon: session.iconGet('remove') } : {}) };
	// on the empty canvas: into the group of what is selected, else a free element (the session decides)
	if (target.kind === 'canvas') return toolActionListBuild(session, toolIconGet, undefined);
	if (target.kind === 'group') {
		const group = session.groupGet(target.groupId);
		if (!group) return [];
		// what is added from a list goes a little below the origin, where it is seen
		const positionGet = () => ({ x: (group.root?.x ?? 0) + 24, y: (group.root?.y ?? 0) + 24 });
		return [
			...toolActionListBuild(session, toolIconGet, { groupId: group.id, parentId: MEMBER_ROOT_ID }, positionGet),
			{ id: 'group-remove', label: 'Remove group', description: 'Its elements stay where they stand, as free elements.', ...removeLook, start: run(() => session.groupRemove(group.id)) },
		];
	}
	// a line: taken away (in a group or not, a line is a connection of the diagram)
	if (target.kind === 'line') {
		return session.store.connectionGet(target.connectionId) ? [{ id: 'line-remove', label: 'Remove line', description: 'The line goes; what it joined stays.', keywordList: ['delete', 'connection'], ...removeLook, start: run(() => session.store.connectionRemove(target.connectionId)) }] : [];
	}
	const at = target.kind === 'node' ? session.memberOfNode(target.nodeId) : target.kind === 'member' ? { groupId: target.groupId, memberId: target.memberId } : null;
	if (target.kind === 'node' && !at) {
		return [
			...session.groupList.map(group => ({ id: `group-join-${group.id}`, label: `Add to ${group.name || 'the group'}`, description: 'It becomes a member under the origin, where it stands.', start: run(() => session.memberAdd(group.id, target.nodeId)) })),
			{ id: 'group-new', label: 'New group with it', description: 'A parametric group whose origin it follows.', start: run(() => session.groupAdd(session.nodePositionGet(target.nodeId), { nodeIdList: [target.nodeId] })) },
			{ id: 'node-remove', label: 'Remove node', description: 'The node goes; its lines keep a free end where it was.', keywordList: ['delete'], ...removeLook, start: run(() => session.store.nodeRemove(target.nodeId, editor.handlePositionGet)) },
		];
	}
	if (!at) return [];
	const group = session.groupModelGet(at.groupId);
	const member = group?.memberById.get(at.memberId);
	if (!member) return [];
	const candidateList = parentCandidateListGet(session, at.groupId, at.memberId);
	const isLayoutChild = Boolean(group.memberById.get(member.parentIdList[0])?.layout);
	const actionList = [];
	if (member.layout) {
		const box = session.solve().boxByKey.get(groupKeyOf(at.groupId, at.memberId));
		actionList.push(...toolActionListBuild(session, toolIconGet, { groupId: at.groupId, parentId: at.memberId }, () => ({ x: box.x, y: box.y })));
	}
	actionList.push({
		id: 'member-parent', label: 'Put under…', description: 'Another member, or the origin, becomes its parent. It stays where it is.', keywordList: ['parent', 'move', 'child'],
		start: () => memberPickStateBuild(session, at.groupId, candidateList.filter(id => id !== member.parentIdList[0]), { id: 'member-parent', label: 'Put under', placeholder: 'Which member', choose: (entry, api) => { changeOf(api.editor ?? editor, () => session.memberParentSet(at.groupId, at.memberId, entry.id)); } }),
	});
	for (const constraintType of session.catalog.constraintTypeList) {
		const isCurrent = !isLayoutChild && member.constraint?.type === constraintType.type;
		actionList.push({ id: `constraint-${constraintType.type}`, label: `Place by: ${constraintType.label.toLowerCase()}`, description: constraintType.description, keywordList: ['constraint'], isDisabled: isLayoutChild || isCurrent, reason: isLayoutChild ? 'Its layout places it.' : 'It is placed so already.', start: run(() => session.memberConstraintTypeSet(at.groupId, at.memberId, constraintType.type)) });
	}
	actionList.push({ id: 'member-remove', label: member.layout ? 'Remove layout' : 'Take out of the group', description: member.layout ? 'Its children stay where they stand, under its parent.' : 'It stays where it stands, as a free element.', ...(member.layout ? removeLook : {}), start: run(() => session.memberRemove(at.groupId, at.memberId)) });
	if (member.nodeId) actionList.push({ id: 'node-remove', label: 'Remove node', description: 'The node goes; what followed it follows its parent, its lines keep a free end.', keywordList: ['delete'], ...removeLook, start: run(() => session.memberRemove(at.groupId, at.memberId, { isNodeRemoved: true, positionGet: editor.handlePositionGet })) });
	return actionList;
}
