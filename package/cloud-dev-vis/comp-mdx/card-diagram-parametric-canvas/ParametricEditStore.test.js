import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { DiagramEditStore } from '../card-diagram/DiagramEditStore.js';
import { diagramNormalize, diagramPlacesGet } from '../card-diagram/DiagramERData.js';
import { nodeRegistryBuild } from '../card-diagram/node-registry.js';
import { cardBriefNodeKind, cardLabelNodeKind, cardNoteNodeKind } from '../card-diagram/card-diagram-node-registry.js';
import { PARAMETRIC_DATA_KEY, PARAMETRIC_FEATURE_ID } from './ParametricData.js';
import { constraintTypeListDefault } from './ParametricConstraint.js';
import { layoutTypeListDefault } from './ParametricLayout.js';
import { parametricCatalogBuild } from './ParametricCatalog.js';
import { parametricGraphResolveBuild } from './ParametricSolve.js';
import { ParametricEditStore } from './ParametricEditStore.js';
import { parametricToolMapDefault, toolBarBuild, toolListBuild, toolMapMerge } from './ParametricTool.js';

const catalog = parametricCatalogBuild({ constraintTypeList: constraintTypeListDefault, layoutTypeList: layoutTypeListDefault });
const feature = { id: PARAMETRIC_FEATURE_ID, dataKey: PARAMETRIC_DATA_KEY, graphResolve: parametricGraphResolveBuild(catalog) };
const registry = nodeRegistryBuild({ id: 'test', label: 'Test', kindList: [cardNoteNodeKind, cardBriefNodeKind, cardLabelNodeKind], featureList: [feature] });

const noteOf = (id, extra = {}) => ({ id, renderer: { type: 'card-note' }, size: { width: 100, height: 40 }, data: { title: id }, handles: [{ id: 'in', direction: 'in', anchor: { side: 'left' } }, { id: 'out', direction: 'out', anchor: { side: 'right' } }], ...extra });
const sourceOf = value => JSON.stringify({ version: 1, viewport: { featureList: [PARAMETRIC_FEATURE_ID] }, ...value });

function sessionOf(value) {
	const store = new DiagramEditStore(sourceOf(value), 'diagram', undefined, registry);
	let idCount = 0;
	const session = new ParametricEditStore({ store, registry, catalog, toolMapGet: () => parametricToolMapDefault, idGet: () => `id${(idCount += 1)}` });
	return { store, session };
}
// where the draft puts every node, with the sizes as written
function placesOf(store) {
	const graph = diagramNormalize(parse(store.rawDraft), registry);
	return diagramPlacesGet(graph.nodes, graph.layout, {});
}
const positionOf = (store, nodeId) => placesOf(store).positions.get(nodeId);

const groupValue = {
	nodes: [noteOf('a'), noteOf('b'), noteOf('c'), noteOf('free', { position: { x: 500, y: 300 } })],
	connections: [{ id: 'l1', source: { nodeId: 'a', handleId: 'out' }, target: { nodeId: 'b', handleId: 'in' } }],
	parametric: { groupList: [{ id: 'g', root: { x: 100, y: 50 }, memberList: [
		{ id: 'm1', node: 'a' },
		{ id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'beside', side: 'right', gap: 60 } },
		{ id: 'm3', node: 'c', parent: 'm2', constraint: { type: 'offset', x: 0, y: 100 } },
	] }] },
};

test('the engine places the members of a group, and refuses a group that cannot be read', () => {
	const { store } = sessionOf(groupValue);
	assert.deepEqual(positionOf(store, 'a'), { x: 100, y: 50 });
	assert.deepEqual(positionOf(store, 'b'), { x: 260, y: 50 });
	assert.deepEqual(positionOf(store, 'c'), { x: 260, y: 150 });
	assert.deepEqual(positionOf(store, 'free'), { x: 500, y: 300 });
	assert.throws(() => new DiagramEditStore(sourceOf({ nodes: [noteOf('a')], parametric: { groupList: [{ id: 'g', memberList: [{ id: 'm1', node: 'zz' }] }] } }), 'diagram', undefined, registry), /"zz" is not a node/);
	assert.throws(() => new DiagramEditStore(sourceOf({ viewport: { featureList: ['ink'] }, nodes: [] }), 'diagram', undefined, registry), /unknown feature "ink"/);
});

test('a drop is a parameter of the constraint, undone and redone as one step', () => {
	const { store, session } = sessionOf(groupValue);
	assert.equal(session.memberDrop('b', { x: 300, y: 70 }), true);
	assert.deepEqual(store.value.parametric.groupList[0].memberList[1].constraint, { type: 'beside', side: 'right', gap: 100, shift: 20 });
	assert.deepEqual(positionOf(store, 'b'), { x: 300, y: 70 });
	// what follows it followed
	assert.deepEqual(positionOf(store, 'c'), { x: 300, y: 170 });
	store.undo();
	assert.deepEqual(positionOf(store, 'b'), { x: 260, y: 50 });
	store.redo();
	assert.deepEqual(positionOf(store, 'c'), { x: 300, y: 170 });
});

test('a free node joins a group where it stands, and leaves it where it stands', () => {
	const { store, session } = sessionOf(groupValue);
	const memberId = session.memberAdd('g', 'free');
	assert.ok(memberId);
	assert.deepEqual(positionOf(store, 'free'), { x: 500, y: 300 });
	assert.equal(store.nodeGet('free').position, undefined);
	assert.deepEqual(store.value.parametric.groupList[0].memberList.at(-1), { id: memberId, node: 'free', constraint: { type: 'offset', x: 400, y: 250 } });
	assert.equal(session.memberAdd('g', 'free'), null);
	assert.equal(session.memberRemove('g', memberId), true);
	assert.deepEqual(store.nodeGet('free').position, { x: 500, y: 300 });
	store.undo();
	assert.equal(session.nodeIsPlaced('free'), true);
});

test('a member moved under another parent, or given another constraint type, stays where it is', () => {
	const { store, session } = sessionOf(groupValue);
	const before = positionOf(store, 'c');
	assert.equal(session.memberParentSet('g', 'm3', 'm1'), true);
	assert.deepEqual(positionOf(store, 'c'), before);
	assert.equal(store.value.parametric.groupList[0].memberList[2].parent, 'm1');
	assert.equal(session.memberConstraintTypeSet('g', 'm3', 'beside'), true);
	assert.deepEqual(positionOf(store, 'c'), before);
	assert.equal(session.memberParentSet('g', 'm3', 'root'), true);
	assert.deepEqual(positionOf(store, 'c'), before);
	assert.equal(store.value.parametric.groupList[0].memberList[2].parent, undefined);
	assert.equal(session.memberBetweenSet('g', 'm3', 'm1', 'm2'), true);
	assert.deepEqual(positionOf(store, 'c'), before);
	// a circle is refused, with its reason, and nothing changes
	assert.equal(session.memberParentSet('g', 'm1', 'm3'), false);
	assert.match(store.message, /in a circle/);
	assert.deepEqual(positionOf(store, 'c'), before);
});

test('a member removed leaves what followed it where it stands, under its parent', () => {
	const { store, session } = sessionOf(groupValue);
	const before = { b: positionOf(store, 'b'), c: positionOf(store, 'c') };
	assert.equal(session.memberRemove('g', 'm2'), true);
	assert.deepEqual(store.nodeGet('b').position, before.b);
	assert.deepEqual(positionOf(store, 'c'), before.c);
	assert.equal(store.value.parametric.groupList[0].memberList.find(member => member.id === 'm3').parent, 'm1');
	store.undo();
	assert.deepEqual(positionOf(store, 'c'), before.c);
	// with its node: the line on it is left with a free end
	assert.equal(session.memberRemove('g', 'm2', { isNodeRemoved: true }), true);
	assert.equal(store.nodeGet('b'), undefined);
	assert.ok(store.connectionGet('l1').target.position);
});

test('a group is made, moved and removed; its nodes stay where they stand', () => {
	const { store, session } = sessionOf(groupValue);
	const groupId = session.groupAdd({ x: 480, y: 280 }, { nodeIdList: ['free'] });
	assert.ok(groupId);
	assert.deepEqual(positionOf(store, 'free'), { x: 500, y: 300 });
	assert.equal(session.groupRootSet(groupId, { x: 0, y: 0 }), true);
	assert.deepEqual(positionOf(store, 'free'), { x: 20, y: 20 });
	assert.equal(session.groupRemove('g'), true);
	assert.deepEqual(store.nodeGet('a').position, { x: 100, y: 50 });
	assert.deepEqual(store.nodeGet('c').position, { x: 260, y: 150 });
	assert.equal(store.value.parametric.groupList.length, 1);
});

test('an array orders its children, and a drop on the canvas reorders them', () => {
	const { store, session } = sessionOf({ nodes: [noteOf('a'), noteOf('b'), noteOf('c')], parametric: { groupList: [{ id: 'g', root: { x: 0, y: 0 }, memberList: [
		{ id: 'row', layout: { type: 'array', direction: 'row', gap: 20 } },
		{ id: 'm1', node: 'a', parent: 'row' }, { id: 'm2', node: 'b', parent: 'row' }, { id: 'm3', node: 'c', parent: 'row' },
	] }] } });
	assert.deepEqual(positionOf(store, 'c'), { x: 240, y: 0 });
	assert.equal(session.memberDrop('c', { x: -30, y: 5 }), true);
	assert.deepEqual(store.value.parametric.groupList[0].memberList.map(member => member.id), ['row', 'm3', 'm1', 'm2']);
	assert.deepEqual(positionOf(store, 'c'), { x: 0, y: 0 });
	assert.deepEqual(positionOf(store, 'a'), { x: 120, y: 0 });
	// dropped where it is: nothing changes
	assert.equal(session.memberDrop('c', { x: 10, y: 0 }), false);
	assert.equal(session.memberLayoutParamSet('g', 'row', 'gap', 0), true);
	assert.deepEqual(positionOf(store, 'b'), { x: 200, y: 0 });
});

test('a tool places what it makes: free, into the group selected, or under the layout focused', () => {
	const { store, session } = sessionOf(groupValue);
	const toolOf = id => session.toolList.find(tool => tool.id === id);
	// nothing selected: a free element
	const freeId = session.toolPlace(toolOf('note'), { x: 700, y: 10 });
	assert.deepEqual(store.nodeGet(freeId).position, { x: 700, y: 10 });
	assert.equal(session.nodeIsPlaced(freeId), false);
	// a member selected: into its group, under the origin, at that place
	store.select('a');
	const memberNodeId = session.toolPlace(toolOf('label'), { x: 150, y: 400 });
	assert.equal(session.nodeIsPlaced(memberNodeId), true);
	assert.deepEqual(positionOf(store, memberNodeId), { x: 150, y: 400 });
	store.undo();
	assert.equal(store.nodeGet(memberNodeId), undefined);
	// a layout: a group of its own when nothing is selected, then what is placed goes under it
	store.selectionClear();
	const layoutId = session.toolPlace(toolOf('layout-row'), { x: 0, y: 600 });
	assert.deepEqual(session.selected, { kind: 'member', groupId: session.focus.groupId, memberId: layoutId });
	const first = session.toolPlace(toolOf('note'), { x: 999, y: 999 });
	session.focusSet({ kind: 'member', groupId: store.value.parametric.groupList.at(-1).id, memberId: layoutId });
	const second = session.toolPlace(toolOf('note'), { x: 999, y: 999 });
	assert.deepEqual(positionOf(store, first), { x: 0, y: 600 });
	// a note is 170 wide when nothing says otherwise, and the row has a gap of 40
	assert.deepEqual(positionOf(store, second), { x: 210, y: 600 });
	assert.equal(session.toolPlace(toolOf('group'), { x: 5, y: 5 }) !== null, true);
});

test('the tree lists the groups with their members and lines, then the free elements, narrowed by a search', () => {
	const { store, session } = sessionOf(groupValue);
	assert.deepEqual(session.treeItemList.map(item => `${item.depth}:${item.kind}:${item.label}`), ['0:group:Group', '1:node:a', '2:node:b', '3:node:c', '2:line:to b', '0:free:Free elements', '1:node:free']);
	store.select('b');
	assert.equal(session.treeItemList.find(item => item.nodeId === 'b').isSelected, true);
	assert.deepEqual(session.selected, { kind: 'node', nodeId: 'b', groupId: 'g', memberId: 'm2' });
	// what holds the words typed, with what it stands under
	session.panelSearchSet('to b');
	assert.deepEqual(session.treeItemListShown.map(item => item.label), ['Group', 'a', 'to b']);
	session.panelSearchSet('');
	session.treeItemToggle('member:g/m1');
	assert.deepEqual(session.treeItemList.map(item => item.label), ['Group', 'a', 'Free elements', 'free']);
	assert.equal(session.treeItemList[1].hasChildren, true);
});

test('the focus of a group and the path of the editor are one selection', () => {
	const { store, session } = sessionOf(groupValue);
	session.focusSet({ kind: 'group', groupId: 'g' });
	assert.deepEqual(session.selected, { kind: 'group', groupId: 'g' });
	store.select('a');
	assert.equal(session.focus, null);
	assert.equal(session.selected.kind, 'node');
	session.focusSet({ kind: 'group', groupId: 'g' });
	assert.equal(store.display, null);
	session.groupRemove('g');
	assert.equal(session.selected, null);
	session.dispose();
});

test('the tools are a mapping merged entry by entry, in the order of their ranks', () => {
	const toolMap = toolMapMerge(parametricToolMapDefault, { note: null, 'my-note': { label: 'Blue note', rank: 'd', create: { what: 'node', kind: 'card-note', data: { tone: 'blue' } } }, label: { ...parametricToolMapDefault.label, isHidden: true } });
	const bar = toolBarBuild(toolListBuild(toolMap));
	assert.deepEqual(bar.topList.map(tool => tool.id), ['group', 'my-note', 'text', 'shape', 'card', 'layout', 'pattern', 'line']);
	assert.deepEqual(bar.moreList.map(tool => tool.id), ['label']);
	assert.deepEqual(bar.childListOf('layout').map(tool => tool.id), ['layout-row', 'layout-column', 'layout-repeat', 'layout-grid']);
	assert.deepEqual(bar.childListOf('pattern').map(tool => tool.id), ['pattern-caption', 'pattern-badge']);
});

test('the edit card stands in the panel or beside the thing, as the author chose; a folded panel lets it float', () => {
	const { session } = sessionOf(groupValue);
	session.iconGet = name => name;
	assert.equal(session.isCardDocked, true);
	assert.deepEqual(session.cardHeadActionListGet(), []);
	session.cardPlaceSet('float');
	assert.equal(session.isCardDocked, false);
	assert.deepEqual(session.cardHeadActionListGet().map(action => action.id), ['card-dock']);
	session.cardHeadActionListGet()[0].act();
	assert.equal(session.isCardDocked, true);
	// folded, the card floats; docked again, the panel opens
	session.panelCollapsedSet(true);
	assert.equal(session.isCardDocked, false);
	session.cardPlaceSet('dock');
	assert.equal(session.panel.isCollapsed, false);
	assert.equal(session.isCardDocked, true);
});
