import { MEMBER_ROOT_ID } from './ParametricData.js';

// The relations of what is selected, as a small diagram of the card diagram format
// (card-diagram-parametric-canvas.md#the-panel): what it follows above it, itself in the middle, what
// follows it below, icon nodes joined by right-angled lines. Drawn without a canvas (DiagramStatic).
// Pure: the diagram, and for each of its nodes the thing a click on it selects.
//
//   parametricGraphBuild(session) -> { diagram, targetById } | null (nothing selected)
//   target   what treeItemSelect takes: { kind, nodeId?, connectionId?, groupId?, memberId? }
const COLUMN_STEP = 210;
const ROW_STEP = 76;
const NODE_SIZE = { width: 190, height: 34 };
const handles = [{ id: 'top', direction: 'in', anchor: { target: 'icon', side: 'top' } }, { id: 'bottom', direction: 'out', anchor: { target: 'icon', side: 'bottom' } }];
const ICON_BY_KIND = { group: 'layers', root: 'layers', layout: 'table-properties', node: 'boxes', line: 'waypoints' };

export function parametricGraphBuild(session) {
	const selected = session.selected;
	if (!selected) return null;
	const nodes = [];
	const connections = [];
	const targetById = {};
	// the words of a thing: its name, and under it how it is placed (or what it is)
	const add = (id, row, column, { kind, title, text, isFocus = false, target }) => {
		nodes.push({ id, renderer: { type: 'card-icon' }, position: { x: column * COLUMN_STEP, y: row * ROW_STEP }, size: NODE_SIZE, data: { title, text, icon: ICON_BY_KIND[kind] ?? 'boxes', tone: isFocus ? 'blue' : 'slate', isFocus }, handles });
		targetById[id] = target;
	};
	const link = (from, to) => connections.push({ id: `${from}--${to}`, source: { nodeId: from, handleId: 'bottom' }, target: { nodeId: to, handleId: 'top' }, renderer: { type: 'smoothstep' }, style: { stroke: '#94a3b8', strokeWidth: 1.2 }, markerEnd: 'arrowClosed' });
	const memberOf = (groupId, memberId, isFocus = false) => {
		if (memberId === MEMBER_ROOT_ID) return { kind: 'root', title: 'Origin', text: session.groupGet(groupId)?.name || 'Group', isFocus, target: { kind: 'group', groupId } };
		const member = session.memberGet(groupId, memberId);
		const names = session.memberLabelOf(groupId, memberId);
		return { kind: member?.layout ? 'layout' : 'node', title: names.label, text: session.memberSummaryOf(groupId, memberId), isFocus, target: member?.node ? { kind: 'node', nodeId: member.node } : { kind: 'layout', groupId, memberId } };
	};
	const lineOf = (connectionId, isFocus = false) => ({ kind: 'line', title: session.store.connectionGet(connectionId)?.label?.text || connectionId, text: 'line', isFocus, target: { kind: 'line', connectionId } });

	if (selected.kind === 'line') {
		// a line: the two things it joins above it
		const connection = session.store.connectionGet(selected.connectionId);
		const endList = ['source', 'target'].map(role => connection?.[role]?.nodeId).filter(Boolean);
		endList.forEach((nodeId, index) => {
			const at = session.memberOfNode(nodeId);
			add(`p${index}`, 0, index, at ? memberOf(at.groupId, at.memberId) : { kind: 'node', title: session.nodeLabelOf(nodeId).label, text: 'free element', target: { kind: 'node', nodeId } });
			link(`p${index}`, 'self');
		});
		add('self', endList.length ? 1 : 0, 0, lineOf(selected.connectionId, true));
		return { diagram: { nodes, connections }, targetById };
	}
	if (selected.kind === 'node' && !selected.memberId) {
		add('self', 0, 0, { kind: 'node', title: session.nodeLabelOf(selected.nodeId).label, text: 'free element', isFocus: true, target: { kind: 'node', nodeId: selected.nodeId } });
		return { diagram: { nodes, connections }, targetById };
	}
	const group = session.groupModelGet(selected.groupId);
	if (!group) return null;
	const memberId = selected.kind === 'group' ? MEMBER_ROOT_ID : selected.memberId;
	const parentIdList = memberId === MEMBER_ROOT_ID ? [] : group.memberById.get(memberId)?.parentIdList ?? [];
	parentIdList.forEach((parentId, index) => {
		add(`p${index}`, 0, index, memberOf(group.id, parentId));
		link(`p${index}`, 'self');
	});
	const rowSelf = parentIdList.length ? 1 : 0;
	add('self', rowSelf, 0, memberOf(group.id, memberId, true));
	// what follows it: the members naming it as a parent, then the lines listed under it
	const followerList = [
		...group.memberList.filter(member => member.parentIdList.includes(memberId)).map(member => memberOf(group.id, member.id)),
		...session.lineList.filter(line => line.groupId === group.id && line.memberIdDirect === memberId).map(line => lineOf(line.connectionId)),
	];
	followerList.forEach((follower, index) => {
		add(`c${index}`, rowSelf + 1, index, follower);
		link('self', `c${index}`);
	});
	return { diagram: { nodes, connections }, targetById };
}
