import { LOCATOR_AXIS_LIST, locatorChevronPlaceOf } from './ParametricLocator.js';
import { lineLabelOf } from './ParametricReferencePoint.js';

// What a locator shows of itself in the editor, as data (card-diagram-parametric-canvas.md#locators):
// the sections of its edit card (its lines, a number each; where its chevrons stand), the card of
// its mode (the lines of an axis listed, one of them open: named, moved, removed) and what a
// right-click offers. In the forms of the framework (DiagramEditCardModel.js), wired to the layout
// type by the feature (ParametricFeature.jsx: layoutUiByType.locator), so the layer that builds the
// cards names no layout type.
const AXIS_WORDS = { x: { one: 'vertical line', many: 'Vertical lines' }, y: { one: 'horizontal line', many: 'Horizontal lines' } };
const round = value => Math.round(value * 100) / 100;

// how many members stand on a line (name it in their constraint)
function lineUseCountOf(session, groupId, memberId, axis, lineId) {
	const key = axis === 'x' ? 'lineX' : 'lineY';
	const group = session.groupModelGet(groupId);
	// on its axis: the line a locate constraint names (or runs from, or to), or a reference point of the locator on it
	const isOn = (name, value) => Boolean(value) && typeof value === 'object' && (name === key ? value.line === lineId || value.from === lineId || value.to === lineId : value.format === 'line' && value[key] === lineId);
	return group.memberList.filter(member => member.parentIdList.includes(memberId) && member.constraint && Object.entries(member.constraint).some(([name, value]) => isOn(name, value))).length;
}

// the sections of the edit card of a locator: per axis, its lines with their places (typed there),
// and the way to the list where they are named and removed; then where its chevrons stand
export function locatorCardSectionListBuild({ session, groupId, memberId, member, change }) {
	const sectionList = [];
	for (const { axis } of LOCATOR_AXIS_LIST) {
		const lineList = session.locatorLineListOf(groupId, memberId, axis);
		const words = AXIS_WORDS[axis];
		sectionList.push({
			id: `locator-${axis}`, label: `${words.many} (${lineList.length})`,
			propertyList: lineList.map(line => ({
				id: `line-${axis}-${line.id}`, label: lineLabelOf(lineList, line.id, axis), kind: 'number', value: round(line.at), step: 1,
				set: (value) => { const number = Number(value); return Number.isFinite(number) && change(() => session.locatorLineSet(groupId, memberId, axis, line.id, { at: number }, { groupKey: `parametric:${groupId}/${memberId}/line/${axis}/${line.id}` })); },
			})),
			note: lineList.length ? '' : `No ${words.one} yet: it gives no place on this axis but its origin.`,
			actionList: [
				{ id: `line-add-${axis}`, label: `Add ${words.one}`, act: () => Boolean(change(() => session.locatorLineAdd(groupId, memberId, axis))) },
				{ id: `line-list-${axis}`, label: 'Name, remove…', isDisabled: !lineList.length, reason: 'It has none.', act: () => { session.locatorLineModeEnter(groupId, memberId, axis); return true; } },
			],
		});
	}
	const place = locatorChevronPlaceOf(member.layout);
	const chevronProperty = (key, label, value, isShown) => (isShown ? [{
		id: key, label, kind: 'number', value: round(value), step: 1,
		set: (next) => { const number = Number(next); return Number.isFinite(number) && change(() => session.locatorChevronSet(groupId, memberId, key, number, { groupKey: `parametric:${groupId}/${memberId}/${key}` })); },
	}] : []);
	sectionList.push({
		id: 'locator-chevron', label: 'Chevrons',
		propertyList: [...chevronProperty('chevronY', 'Row at Y', place.y, member.layout.xList.length > 0), ...chevronProperty('chevronX', 'Column at X', place.x, member.layout.yList.length > 0)],
		note: 'The chevrons mark where its lines are while it is not focused. Where they stand moves nothing else; drag them on the canvas too.',
		actionList: [{ id: 'chevron-reset', label: 'Beside the lines again', isDisabled: member.layout.chevronX === null && member.layout.chevronY === null, reason: 'They stand there.', act: () => Boolean(change(() => (session.locatorChevronSet(groupId, memberId, 'chevronX', null), session.locatorChevronSet(groupId, memberId, 'chevronY', null)))) }],
	});
	return sectionList;
}

// the card of the mode of a locator: the lines of an axis, in the order of their places, or one of
// them open (its name, its place, its removal)
export function locatorModeCardBuild({ session, mode, names, change }) {
	if (mode.kind !== 'locatorLine') return null;
	const { groupId, memberId, axis } = mode;
	const words = AXIS_WORDS[axis];
	const lineList = session.locatorLineListOf(groupId, memberId, axis);
	const sorted = [...lineList].sort((a, b) => a.at - b.at);
	const segmentList = [{ name: names.label, open: () => session.modeLeave() }, { name: words.many, open: () => session.locatorLineModeEnter(groupId, memberId, axis) }];
	const line = mode.lineId ? lineList.find(item => item.id === mode.lineId) : null;
	if (!line) {
		return { title: names.label, kindLabel: words.many, tabList: [], tabId: null, segmentList, view: {
			type: 'list', id: `locator-lines-${axis}`, label: `${words.many} (${sorted.length})`,
			itemList: sorted.map((item) => {
				const count = lineUseCountOf(session, groupId, memberId, axis, item.id);
				return { id: item.id, name: lineLabelOf(lineList, item.id, axis), badge: String(round(item.at)), sub: count ? `${count} ${count === 1 ? 'thing stands' : 'things stand'} on it` : '', isSelected: false, open: () => session.locatorLineModeEnter(groupId, memberId, axis, item.id), isRemovable: true, removeReason: '' };
			}),
			isReorderable: false, reorderReason: 'Lines stand in the order of their places.',
			move: () => false,
			remove: id => change(() => session.locatorLineRemove(groupId, memberId, axis, id)),
			add: { id: 'line-add', label: `Add ${words.one}`, act: () => Boolean(change(() => session.locatorLineAdd(groupId, memberId, axis))) },
			actionList: [{ id: 'line-done', label: 'Done', act: () => { session.modeLeave(); return true; } }],
			note: 'A line removed leaves what stood on it where it stands.',
			sectionList: [],
		} };
	}
	const groupKeyOfParam = id => `parametric:${groupId}/${memberId}/line/${axis}/${line.id}/${id}`;
	const count = lineUseCountOf(session, groupId, memberId, axis, line.id);
	return { title: names.label, kindLabel: words.one, tabList: [], tabId: null, segmentList: [...segmentList, { name: lineLabelOf(lineList, line.id, axis), open: () => {} }], view: { type: 'detail', sectionList: [
		{ id: 'locator-line', label: words.one[0].toUpperCase() + words.one.slice(1), actionList: [],
			note: count ? `${count} ${count === 1 ? 'thing stands' : 'things stand'} on it and ${count === 1 ? 'follows' : 'follow'} when it moves.` : 'Nothing stands on it yet.',
			propertyList: [
				{ id: 'name', label: 'Name', kind: 'text', value: line.name, placeholder: lineLabelOf(lineList.map(item => ({ ...item, name: '' })), line.id, axis), set: value => change(() => session.locatorLineSet(groupId, memberId, axis, line.id, { name: String(value).trim() }, { groupKey: groupKeyOfParam('name') })) },
				{ id: 'at', label: axis === 'x' ? 'X from its origin' : 'Y from its origin', kind: 'number', value: round(line.at), step: 1, set: (value) => { const number = Number(value); return Number.isFinite(number) && change(() => session.locatorLineSet(groupId, memberId, axis, line.id, { at: number }, { groupKey: groupKeyOfParam('at') })); } },
			] },
		{ id: 'locator-line-actions', label: '', propertyList: [], note: '', actionList: [
			{ id: 'line-remove', label: 'Remove line', kind: 'danger', act: () => change(() => session.locatorLineRemove(groupId, memberId, axis, line.id)) },
			{ id: 'line-done', label: 'Done', act: () => { session.modeLeave(); return true; } },
		] },
	] } };
}

// what a right-click on a locator offers beside what every member has
export function locatorActionListBuild({ session, groupId, memberId, run }) {
	return LOCATOR_AXIS_LIST.map(({ axis }) => ({ id: `locator-line-add-${axis}`, label: `Add ${AXIS_WORDS[axis].one}`, description: 'After its last one; drag it where it belongs.', keywordList: ['line', 'locator'], start: run(() => session.locatorLineAdd(groupId, memberId, axis)) }));
}
