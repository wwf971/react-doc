import { MEMBER_ROOT_ID, groupKeyOf, memberIsFramedWhenRead } from './ParametricData.js';
import { memberParentListOf } from './ParametricSolve.js';
import { REFERENCE_POINT_DEFAULT, outlineReferenceDefaultOf, referenceFormatListOf, referencePointLabelOf, referencePointWrite } from './ParametricReferencePoint.js';

// What the parametric canvas shows of a thing in the editor, as data (card-diagram-parametric-canvas.md#the-editor):
// the sections it adds to the edit card of a node, the edit card of a group or of a layout member,
// the card of a mode of a thing (its reference points), and what can be done with a thing (the
// actions of the panel of a right-click). In the forms of the framework (DiagramEditCardModel.js:
// section, property, action, list; DiagramCreatePanel.jsx: action, state), so the same components
// draw them.
const round = value => Math.round(value * 1000) / 1000;

// a command of the session run as a change of the editor (the draft is reported after it)
function changeOf(editor, operation) {
	let result = false;
	editor.change(() => { result = operation(); });
	return result;
}

// a reference point as properties of an edit card: a menu of what its thing offers (its default
// reference point, the points it declares, then what the formats of its outline offer), and under
// it the parameters of the choice made (an edge and a dividing point, an angle, lines).
//   definition    the reference point as read; subject: the thing it is of (its outline, the
//                 points it declares, its default); isOwnOffered: false for a declared point itself
//   isDefaultWritten   the default reference point is written as the word (a parameter whose absence
//                 means something else: the middle, for between)
//   write(written, isTyped)   keeps it, as written (undefined: the key taken away)
export function referencePointPropertyListBuild({ id, label, definition, subject, formatList, isOwnOffered = true, isDefaultOffered = true, isDefaultWritten = false, write }) {
	const outline = subject.outline;
	const current = definition ?? REFERENCE_POINT_DEFAULT;
	const formatOfferList = referenceFormatListOf(outline, formatList);
	const formatCurrent = formatList.find(format => format.id === current.format);
	// the format of what is written is listed even where the outline no longer offers it (a shape changed)
	if (formatCurrent && !formatOfferList.includes(formatCurrent)) formatOfferList.push(formatCurrent);
	const choiceList = [];
	if (isDefaultOffered) choiceList.push({ key: 'default', label: `Default: ${referencePointLabelOf(REFERENCE_POINT_DEFAULT, subject, formatList).replace(/^default \((.*)\)$/, '$1')}`, definition: REFERENCE_POINT_DEFAULT });
	if (isOwnOffered) for (const declared of subject.referencePointList ?? []) choiceList.push({ key: `own:${declared.id}`, label: declared.name || referencePointLabelOf(declared.point, subject, formatList), definition: { format: 'own', id: declared.id } });
	for (const format of formatOfferList) choiceList.push(...format.choiceListGet(outline));
	const keyCurrent = current.format === 'default' ? 'default' : current.format === 'own' ? `own:${current.id}` : formatCurrent?.keyOf(current) ?? '';
	const writtenOf = next => (next.format === 'default' ? (isDefaultWritten ? 'default' : undefined) : referencePointWrite(next, formatList));
	const propertyList = [{
		id, label, kind: 'enum', value: keyCurrent, values: choiceList.map(choice => choice.key), valueLabels: Object.fromEntries(choiceList.map(choice => [choice.key, choice.label])), isSearchable: choiceList.length > 14,
		set: next => write(writtenOf(choiceList.find(choice => choice.key === next)?.definition ?? REFERENCE_POINT_DEFAULT), false),
	}];
	for (const param of formatCurrent?.paramListGet(current, outline) ?? []) {
		propertyList.push({
			id: `${id}-${param.id}`, label: `· ${param.label}`, kind: param.kind, value: param.value, values: param.values, valueLabels: param.valueLabels, min: param.min, max: param.max, step: param.step,
			set: (next) => {
				if (param.kind !== 'number') return write(writtenOf(param.next(next)), false);
				const number = Number(next);
				return Number.isFinite(number) && write(writtenOf(param.next(number)), true);
			},
		});
	}
	return propertyList;
}

// the properties of the parameters of a constraint or a layout (their propertyList), for the edit
// card. valueOf(id): the value as resolved; set(id, value, isTyped): writes one; patch(keys,
// isTyped, id): writes several (a definition saying apply); subjectOf(of): the thing a reference
// point parameter is of (the member: self; a parent: its place among the parents)
function paramPropertyListBuild(definitionList, { valueOf, set, patch, subjectOf, formatList }) {
	return definitionList.flatMap((definition) => {
		const value = definition.value !== undefined ? definition.value : valueOf(definition.id);
		const write = (next, isTyped) => (definition.apply ? patch(definition.apply(next), isTyped, definition.id) : set(definition.id, next, isTyped));
		if (definition.kind === 'number') {
			return [{ id: definition.id, label: definition.label, kind: 'number', value: round(value ?? definition.valueDefault), step: definition.step, min: definition.min, max: definition.max, set: (next) => { const number = Number(next); return Number.isFinite(number) && write(number, true); } }];
		}
		if (definition.kind === 'enum') {
			// the values of a menu are words: a number is written back as the number it stands for
			return [{ id: definition.id, label: definition.label, kind: 'enum', value: String(value ?? definition.valueDefault), values: definition.values.map(String), valueLabels: Object.fromEntries(definition.values.map(item => [String(item), definition.valueLabels?.[item] ?? String(item)])), isSearchable: definition.isSearchable, set: next => write(definition.values.find(item => String(item) === next), false) }];
		}
		if (definition.kind === 'referencePoint') {
			const subject = subjectOf?.(definition.of);
			// a thing that is one point (the origin of a group) has nothing to choose
			if (!subject || subject.outline?.kind === 'point') return [];
			return referencePointPropertyListBuild({ id: definition.id, label: definition.label, definition: value, subject, formatList, isDefaultWritten: definition.valueDefault !== 'default', write });
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
// child of a layout that arranges its children, the layout that places it
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
	if (member.isArranged) note = `Its ${session.catalog.layoutTypeByType[parentDirect.layout.type].label.toLowerCase()} places it. Drag it among the others to order it.`;
	else {
		const constraintType = session.catalog.constraintTypeByType[member.constraint.type];
		const parentList = memberParentListOf(group, member);
		if (member.parentIdList.length > 1) {
			const secondList = candidateList.filter(id => id !== member.parentIdList[0]);
			propertyList.push({ id: 'parent-second', label: 'Second parent', kind: 'enum', value: member.parentIdList[1], values: secondList, valueLabels: labelsOf(secondList), isSearchable: secondList.length > 8, set: next => changeOf(editor, () => session.memberBetweenSet(groupId, memberId, member.parentIdList[0], next)) });
		}
		// the ways it can be placed under what it follows (on lines only under a locator)
		const typeList = session.catalog.constraintTypeList.filter(type => type.type === constraintType.type || !type.parentReasonGet?.(parentList));
		propertyList.push({
			id: 'constraint-type', label: 'Placed by', kind: 'enum', value: constraintType.type, values: typeList.map(type => type.type), valueLabels: Object.fromEntries(typeList.map(type => [type.type, type.label])),
			set: next => changeOf(editor, () => session.memberConstraintTypeSet(groupId, memberId, next)),
		});
		const groupKeyOfParam = id => `parametric:${groupId}/${memberId}/constraint/${id}`;
		propertyList.push(...paramPropertyListBuild(constraintType.propertyListGet?.(member.constraint, { parentList }) ?? constraintType.propertyList, {
			valueOf: id => member.constraint[id],
			set: (id, value, isTyped) => changeOf(editor, () => session.memberConstraintParamSet(groupId, memberId, id, value, { groupKey: isTyped ? groupKeyOfParam(id) : null })),
			patch: (keys, isTyped, id) => changeOf(editor, () => session.memberConstraintPatch(groupId, memberId, keys, { groupKey: isTyped ? groupKeyOfParam(id) : null })),
			subjectOf: of => (of === 'self' ? member : parentList[of]),
			formatList: session.formatList,
		}));
		note = constraintType.description;
	}
	return { id: 'parametric-placement', label: `Placement in ${groupWritten?.name || 'its group'}`, propertyList, note, actionList: [] };
}

// the reference points of a member, in a few lines: its default one, and the way into the mode
// where they are listed, added and removed (modeCardModelBuild)
function referenceSectionBuild(session, groupId, memberId, editor) {
	const member = session.groupModelGet(groupId).memberById.get(memberId);
	const declaredList = member.referencePointList;
	const outlineLabel = referencePointLabelOf(outlineReferenceDefaultOf(member.outline), member, session.formatList);
	const valueDefault = member.referencePointDefault?.format === 'own' ? member.referencePointDefault.id : member.referencePointDefault ? '~custom' : '';
	const values = ['', ...declaredList.map(item => item.id), ...(valueDefault === '~custom' ? ['~custom'] : [])];
	return {
		id: 'parametric-reference', label: 'Reference points',
		propertyList: [{
			id: 'reference-default', label: 'Default', kind: 'enum', value: valueDefault, values,
			valueLabels: { '': `Of its outline: ${outlineLabel.toLowerCase()}`, '~custom': member.referencePointDefault ? referencePointLabelOf(member.referencePointDefault, member, session.formatList) : '', ...Object.fromEntries(declaredList.map(item => [item.id, item.name || referencePointLabelOf(item.point, member, session.formatList)])) },
			set: next => (next === '~custom' ? false : changeOf(editor, () => session.memberReferencePointDefaultSet(groupId, memberId, next || null))),
		}],
		note: 'What a constraint places or measures from when it names no other point.',
		actionList: [{ id: 'reference-edit', label: `Edit reference points (${declaredList.length + 1})`, act: () => { session.referencePointModeEnter(groupId, memberId); return true; } }],
	};
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
		referenceSectionBuild(session, at.groupId, at.memberId, editor),
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
	const groupKeyOfParam = id => `parametric:${focus.groupId}/${focus.memberId}/layout/${id}`;
	// what a layout type shows of itself beside its parameters (a locator: its lines), from whoever
	// draws the feature (ParametricFeature.jsx: layoutUiByType)
	const typeSectionList = session.layoutUiByType?.[layoutType.type]?.cardSectionListGet?.({ session, groupId: focus.groupId, memberId: focus.memberId, member, editor, change: operation => changeOf(editor, operation) }) ?? [];
	return modelOf(memberWritten.name || layoutType.label, layoutType.isChildConstrained ? layoutType.label : 'Layout', [
		{ id: 'layout', label: layoutType.label, actionList: [], note: layoutType.description, propertyList: [
			{ id: 'name', label: 'Name', kind: 'text', value: memberWritten.name ?? '', placeholder: layoutType.label, set: value => changeOf(editor, () => session.memberNameSet(focus.groupId, focus.memberId, String(value).trim())) },
			// its frame and name are drawn while the diagram is edited; when it is read, if so (a layout
			// that arranges nothing has no frame: how it is shown is a parameter of its own)
			...(layoutType.isChildConstrained ? [] : [{ id: 'isFramedWhenRead', label: 'Framed when read', kind: 'bool', value: memberIsFramedWhenRead(member, session.catalog), set: value => changeOf(editor, () => session.memberFramedWhenReadSet(focus.groupId, focus.memberId, Boolean(value))) }]),
			...paramPropertyListBuild(layoutType.propertyList, {
				valueOf: id => member.layout[id],
				set: (id, value, isTyped) => changeOf(editor, () => session.memberLayoutParamSet(focus.groupId, focus.memberId, id, value, { groupKey: isTyped ? groupKeyOfParam(id) : null })),
				formatList: session.formatList,
			}),
		] },
		...typeSectionList,
		placementSectionBuild(session, focus.groupId, focus.memberId, editor),
		referenceSectionBuild(session, focus.groupId, focus.memberId, editor),
		{ id: 'layout-actions', label: '', propertyList: [], actionList: [{ id: 'member-remove', label: `Remove ${layoutType.label.toLowerCase()}`, kind: 'danger', act: () => changeOf(editor, () => session.memberRemove(focus.groupId, focus.memberId)) }], note: 'Its children stay where they stand, under its parent.' },
	]);
}

// ---------- the card of a mode of a thing ----------

// the edit card of the member selected while it is in a mode of its own (ParametricEditStore.js:
// mode): its reference points listed, one of them open; or what its layout type draws for a mode of
// its own (a locator: the lines of an axis). null: no mode, the card of its settings.
// Its path bar leads back: the member (the mode left), the list, the thing open
export function modeCardModelBuild(session, editor) {
	const mode = session.modeShown;
	if (!mode) return null;
	const names = session.memberLabelOf(mode.groupId, mode.memberId);
	const change = operation => changeOf(editor, operation);
	if (mode.kind !== 'referencePoint') {
		const member = session.groupModelGet(mode.groupId).memberById.get(mode.memberId);
		return session.layoutUiByType?.[member.layout?.type]?.modeCardGet?.({ session, mode, member, names, editor, change }) ?? null;
	}
	const { groupId, memberId } = mode;
	const member = session.groupModelGet(groupId).memberById.get(memberId);
	const formatList = session.formatList;
	const labelOf = definition => referencePointLabelOf(definition, member, formatList);
	const isDefaultOf = pointId => member.referencePointDefault?.format === 'own' && member.referencePointDefault.id === pointId;
	const segmentList = [{ name: names.label, open: () => session.modeLeave() }, { name: 'Reference points', open: () => session.referencePointModeEnter(groupId, memberId) }];
	const declared = mode.pointId ? member.referencePointList.find(item => item.id === mode.pointId) : null;
	if (!declared) {
		const outlineLabel = labelOf(outlineReferenceDefaultOf(member.outline));
		const itemList = [
			{ id: '~outline', name: outlineLabel, badge: member.referencePointDefault ? 'of its outline' : 'of its outline · default', sub: '', isSelected: false, isRemovable: false, removeReason: 'The reference point of its outline is always there.' },
			...member.referencePointList.map(item => ({ id: item.id, name: item.name || labelOf(item.point), badge: isDefaultOf(item.id) ? 'default' : '', sub: item.name ? labelOf(item.point) : '', isSelected: false, open: () => session.referencePointModeEnter(groupId, memberId, item.id), isRemovable: true, removeReason: '' })),
		];
		return { title: names.label, kindLabel: 'Reference points', tabList: [], tabId: null, segmentList, view: {
			type: 'list', id: 'reference-points', label: `Reference points (${itemList.length})`, itemList,
			isReorderable: false, reorderReason: 'Reference points have no order.',
			move: () => false,
			remove: id => change(() => session.memberReferencePointRemove(groupId, memberId, id)),
			add: { id: 'reference-add', label: 'Add reference point', act: () => { const id = change(() => session.memberReferencePointAdd(groupId, memberId)); if (id) session.referencePointModeEnter(groupId, memberId, id); return Boolean(id); } },
			actionList: [{ id: 'reference-done', label: 'Done', act: () => { session.modeLeave(); return true; } }],
			note: 'A reference point is a point of the thing that a constraint places or measures from. It is defined by parameters, so what is measured by it follows when they change.',
			sectionList: [],
		} };
	}
	const useList = session.referencePointUseListOf(groupId, memberId).filter(use => (use.definition?.format === 'own' && use.definition.id === declared.id) || (isDefaultOf(declared.id) && (!use.definition || use.definition.format === 'default')));
	const groupKeyOfParam = id => `parametric:${groupId}/${memberId}/reference/${declared.id}/${id}`;
	return { title: names.label, kindLabel: 'Reference point', tabList: [], tabId: null, segmentList: [...segmentList, { name: declared.name || 'Unnamed', open: () => {} }], view: { type: 'detail', sectionList: [
		{ id: 'reference-point', label: 'Reference point', actionList: [],
			note: useList.length ? `Measured by: ${[...new Set(useList.map(use => session.memberLabelOf(groupId, use.memberId).label))].join(', ')}.` : 'Nothing is measured by it yet: choose it as the reference point of a constraint.',
			propertyList: [
				{ id: 'name', label: 'Name', kind: 'text', value: declared.name, placeholder: labelOf(declared.point), set: value => change(() => session.memberReferencePointSet(groupId, memberId, declared.id, { name: String(value).trim() }, { groupKey: groupKeyOfParam('name') })) },
				...referencePointPropertyListBuild({
					id: 'point', label: 'Where', definition: declared.point, subject: member, formatList, isOwnOffered: false, isDefaultOffered: false,
					write: (written, isTyped) => change(() => session.memberReferencePointSet(groupId, memberId, declared.id, { point: session.referencePointReadOf(written) }, { groupKey: isTyped ? groupKeyOfParam('point') : null })),
				}),
				{ id: 'isDefault', label: 'Its default one', kind: 'bool', value: isDefaultOf(declared.id), set: value => change(() => session.memberReferencePointDefaultSet(groupId, memberId, value ? declared.id : null)) },
			] },
		{ id: 'reference-actions', label: '', propertyList: [], note: 'Removed, what was measured by it is measured by the same place of the box: nothing moves.', actionList: [
			{ id: 'reference-remove', label: 'Remove reference point', kind: 'danger', act: () => change(() => session.memberReferencePointRemove(groupId, memberId, declared.id)) },
			{ id: 'reference-done', label: 'Done', act: () => { session.modeLeave(); return true; } },
		] },
	] } };
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
	const isLayoutChild = member.isArranged;
	const parentList = memberParentListOf(group, member);
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
		const reasonParent = isLayoutChild ? '' : constraintType.parentReasonGet?.(parentList) ?? '';
		actionList.push({ id: `constraint-${constraintType.type}`, label: `Place by: ${constraintType.label.toLowerCase()}`, description: constraintType.description, keywordList: ['constraint'], isDisabled: isLayoutChild || isCurrent || Boolean(reasonParent), reason: isLayoutChild ? 'Its layout places it.' : reasonParent || 'It is placed so already.', start: run(() => session.memberConstraintTypeSet(at.groupId, at.memberId, constraintType.type)) });
	}
	actionList.push({ id: 'reference-edit', label: 'Reference points…', description: 'The points of it that constraints place or measure from: its default one, and those it declares.', keywordList: ['reference', 'point', 'anchor'], start: () => { session.referencePointModeEnter(at.groupId, at.memberId); } });
	if (member.layout) actionList.push(...(session.layoutUiByType?.[member.layout.type]?.actionListGet?.({ session, groupId: at.groupId, memberId: at.memberId, member, run }) ?? []));
	actionList.push({ id: 'member-remove', label: member.layout ? 'Remove layout' : 'Take out of the group', description: member.layout ? 'Its children stay where they stand, under its parent.' : 'It stays where it stands, as a free element.', ...(member.layout ? removeLook : {}), start: run(() => session.memberRemove(at.groupId, at.memberId)) });
	if (member.nodeId) actionList.push({ id: 'node-remove', label: 'Remove node', description: 'The node goes; what followed it follows its parent, its lines keep a free end.', keywordList: ['delete'], ...removeLook, start: run(() => session.memberRemove(at.groupId, at.memberId, { isNodeRemoved: true, positionGet: editor.handlePositionGet })) });
	return actionList;
}
