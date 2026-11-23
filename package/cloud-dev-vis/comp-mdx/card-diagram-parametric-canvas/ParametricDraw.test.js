import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagramEditStore } from '../card-diagram/DiagramEditStore.js';
import { diagramNormalize } from '../card-diagram/DiagramERData.js';
import { nodeRegistryBuild } from '../card-diagram/node-registry.js';
import { cardDiagramNodeRegistry, cardNoteNodeKind } from '../card-diagram/card-diagram-node-registry.js';
import { PARAMETRIC_FEATURE_ID, memberIsFramedWhenRead } from './ParametricData.js';
import { layoutTypeBadge, layoutTypeCaption, layoutTypeGrid } from './ParametricLayout.js';
import { ParametricEditStore } from './ParametricEditStore.js';
import { parametricCanvasFeature } from './ParametricFeature.jsx';
import { parametricToolMapDefault } from './ParametricTool.js';
import { shapePointListOf } from './ParametricShapeData.js';

// the kinds it draws with, the layouts and patterns it ships, and words typed in the panel of the
// empty canvas (card-diagram-parametric-canvas.md#drawing-kinds, #patterns)
const registry = cardDiagramNodeRegistry;
const sourceOf = value => JSON.stringify({ version: 1, viewport: { featureList: [PARAMETRIC_FEATURE_ID] }, nodes: [], connections: [], ...value });
function sessionOf(value = {}) {
	const store = new DiagramEditStore(sourceOf(value), 'diagram', undefined, registry);
	let idCount = 0;
	const session = new ParametricEditStore({ store, registry, catalog: parametricCanvasFeature.catalog, toolMapGet: () => parametricToolMapDefault, idGet: () => `id${(idCount += 1)}` });
	return { store, session, editor: { store, change: operation => operation(), featureList: [session], handlePositionGet: () => null } };
}
const sizeOf = (width, height) => ({ width, height });

test('the feature brings its kinds to every registry listing it, once', () => {
	assert.ok(registry.kindByType.shape && registry.kindByType.text);
	assert.ok(registry.createEntryList.some(entry => entry.id === 'shape'));
	// a registry rebuilt from another's kinds (the switch layer) holds them once
	const rebuilt = nodeRegistryBuild({ id: 'again', label: 'Again', kindList: registry.kindList, featureList: registry.featureList });
	assert.equal(rebuilt.kindList.filter(kind => kind.type === 'shape').length, 1);
	const own = nodeRegistryBuild({ id: 'own', label: 'Own', kindList: [cardNoteNodeKind] });
	assert.equal(own.kindByType.shape, undefined);
});

test('a shape and a text are read, and refused with what is wrong', () => {
	const shapeOf = (data, style) => ({ id: 's', renderer: { type: 'shape' }, position: { x: 0, y: 0 }, size: { width: 100, height: 60 }, ...(style ? { style } : {}), data, handles: [] });
	assert.doesNotThrow(() => diagramNormalize(JSON.parse(sourceOf({ nodes: [shapeOf({ shape: 'diamond', text: 'Go?', strokeWidth: 2, isDashed: true }, { fill: 'amber', stroke: '#111827' })] })), registry));
	assert.throws(() => diagramNormalize(JSON.parse(sourceOf({ nodes: [shapeOf({ shape: 'star' })] })), registry), /A shape is one of rect/);
	assert.throws(() => diagramNormalize(JSON.parse(sourceOf({ nodes: [shapeOf({ shape: 'rect', strokeWidth: 40 })] })), registry), /0 to 12 wide/);
	const textOf = data => ({ id: 't', renderer: { type: 'text' }, position: { x: 0, y: 0 }, data, handles: [] });
	assert.doesNotThrow(() => diagramNormalize(JSON.parse(sourceOf({ nodes: [textOf({ text: 'Title', textSize: 'xl', weight: 'bold', tone: 'blue' })] })), registry));
	assert.throws(() => diagramNormalize(JSON.parse(sourceOf({ nodes: [textOf({})] })), registry), /needs its words/);
	assert.deepEqual(shapePointListOf('diamond'), [[50, 0], [100, 50], [50, 100], [0, 50]]);
	assert.equal(shapePointListOf('rect'), null);
});

test('a grid puts its children in rows of its columns, each column as wide as its widest', () => {
	const layout = layoutTypeGrid.read({ columns: 2, gapX: 10, gapY: 5 }, 'grid');
	const childList = [{ id: 'a', size: sizeOf(30, 20) }, { id: 'b', size: sizeOf(50, 10) }, { id: 'c', size: sizeOf(40, 30) }];
	const { size, placeById } = layoutTypeGrid.arrange(layout, childList);
	assert.deepEqual(placeById.get('a'), { x: 0, y: 0 });
	assert.deepEqual(placeById.get('b'), { x: 50, y: 0 });
	assert.deepEqual(placeById.get('c'), { x: 0, y: 25 });
	assert.deepEqual(size, { width: 100, height: 55 });
	// a box dropped on the second row, right of c, comes after it
	assert.equal(layoutTypeGrid.indexFromPlace(layout, [{ x: 0, y: 0, width: 30, height: 20 }, { x: 50, y: 0, width: 50, height: 10 }, { x: 0, y: 25, width: 40, height: 30 }], { x: 60, y: 30, width: 10, height: 10 }), 3);
	assert.throws(() => layoutTypeGrid.read({ columns: 1.5 }, 'grid'), /integer/);
});

test('a caption stands on its side of the subject, aligned along it; a badge on a corner', () => {
	const childList = [{ id: 's', slot: 'subject', size: sizeOf(100, 60) }, { id: 'c', slot: 'caption', size: sizeOf(40, 10) }];
	const below = layoutTypeCaption.arrange(layoutTypeCaption.read({ side: 'bottom', gap: 8, align: 0.5 }, 'l'), childList);
	assert.deepEqual([below.placeById.get('s'), below.placeById.get('c'), below.size], [{ x: 0, y: 0 }, { x: 30, y: 68 }, { width: 100, height: 78 }]);
	const left = layoutTypeCaption.arrange(layoutTypeCaption.read({ side: 'left', gap: 6, align: 0 }, 'l'), childList);
	assert.deepEqual([left.placeById.get('c'), left.placeById.get('s'), left.size], [{ x: 0, y: 0 }, { x: 46, y: 0 }, { width: 146, height: 60 }]);
	const badge = layoutTypeBadge.arrange(layoutTypeBadge.read({ corner: 'top-right', inset: 0 }, 'l'), [{ id: 's', slot: 'subject', size: sizeOf(100, 60) }, { id: 'b', slot: 'badge', size: sizeOf(20, 10) }]);
	assert.deepEqual([badge.placeById.get('s'), badge.placeById.get('b'), badge.size], [{ x: 0, y: 5 }, { x: 90, y: 0 }, { width: 110, height: 65 }]);
});

test('a pattern is made whole in one step, its slots filled; a full pattern refuses another member', () => {
	const { store, session } = sessionOf();
	const memberId = session.layoutCreate({ type: 'caption' }, { x: 40, y: 40 });
	assert.ok(memberId);
	const group = store.value.parametric.groupList[0];
	assert.deepEqual(group.memberList.map(member => [member.slot ?? null, member.parent ?? null]), [[null, null], ['subject', memberId], ['caption', memberId]]);
	assert.deepEqual(store.nodes.map(node => [node.renderer.type, node.data.text ?? node.data.shape]), [['shape', 'rounded'], ['text', 'Caption']]);
	assert.equal(session.memberSummaryOf(group.id, group.memberList[2].id), 'its caption');
	assert.equal(store.history.length, 1);
	// a node of its own, then put under the full pattern: refused, saying why
	const noteId = session.nodeCreate({ kind: 'card-note' }, { position: { x: 400, y: 40 } }, { groupId: group.id, parentId: 'root' });
	const noteMemberId = session.memberOfNode(noteId).memberId;
	assert.equal(session.memberParentSet(group.id, noteMemberId, memberId), false);
	assert.match(store.message, /no free slot: Subject and Caption are filled/);
	// the caption taken out of it leaves a slot the note then fills
	assert.equal(session.memberRemove(group.id, group.memberList[2].id, { isNodeRemoved: true }), true);
	assert.equal(session.memberParentSet(group.id, noteMemberId, memberId), true);
	assert.equal(store.value.parametric.groupList[0].memberList.find(member => member.id === noteMemberId).slot, 'caption');
	// undone back to nothing, step by step
	while (store.undo());
	assert.equal(store.nodes.length, 0);
	assert.equal(store.value.parametric, undefined);
});

test('words typed in the panel of the empty canvas are a text there, into the group of what is selected', () => {
	const { store, session, editor } = sessionOf();
	const take = session.createTextGet({ kind: 'canvas' }, editor);
	assert.equal(take.label, 'Text');
	assert.equal(session.createTextGet({ kind: 'node', nodeId: 'x' }, editor), null);
	take.take('A remark', { x: 120, y: 80 });
	const node = store.nodes.at(-1);
	assert.deepEqual([node.renderer.type, node.data.text, node.position], ['text', 'A remark', { x: 120, y: 80 }]);
	assert.equal(store.selection.nodeId, node.id);
	// a tool carries a style: what it makes is filled so
	const id = session.toolPlace({ id: 'amber-box', label: 'Amber box', create: { what: 'node', kind: 'shape', data: { shape: 'rect' }, style: { fill: 'amber' } } }, { x: 0, y: 0 }, null);
	assert.deepEqual(store.nodeGet(id).style, { fill: 'amber' });
});

test('an agent reads the groups and changes them through the apis, each a command of the session', () => {
	const apiByName = {};
	const changeApi = (options, command) => ({ name: options.name, run: (store, params) => command(store, params, () => null, {}) });
	const readApi = (options, read) => ({ name: options.name, run: (store, params) => read(store, params, {}) });
	for (const api of parametricCanvasFeature.apiListBuild({ changeApi, readApi })) apiByName[api.name] = api;
	assert.deepEqual(Object.keys(apiByName), ['parametricGroupListGet', 'parametricGroupAdd', 'parametricMemberAdd', 'parametricMemberParentSet', 'parametricMemberSet', 'parametricMemberRemove', 'parametricToolPlace']);
	const store = new DiagramEditStore(sourceOf({ nodes: [{ id: 'a', renderer: { type: 'card-note' }, position: { x: 100, y: 40 }, size: { width: 120, height: 40 }, data: { title: 'A' }, handles: [] }] }), 'diagram', undefined, registry);
	const groupId = apiByName.parametricGroupAdd.run(store, { x: 100, y: 40, nodeIdList: ['a'] });
	assert.ok(groupId);
	const rowId = apiByName.parametricToolPlace.run(store, { toolId: 'layout-row', x: 100, y: 140, groupId });
	assert.ok(rowId);
	assert.ok(apiByName.parametricToolPlace.run(store, { create: { what: 'node', kind: 'text', data: { text: 'one' } }, x: 0, y: 0, groupId, parentId: rowId }));
	assert.equal(apiByName.parametricMemberSet.run(store, { groupId, memberId: rowId, of: 'layout', key: 'gap', value: 12 }), true);
	const read = apiByName.parametricGroupListGet.run(store, {});
	const group = read.groupList[0];
	assert.equal(group.memberList.length, 3);
	assert.deepEqual(group.memberList.find(member => member.id === rowId).layout, { type: 'array', direction: 'row', gap: 12, align: 0.5 });
	assert.ok(read.toolList.some(tool => tool.id === 'pattern-caption'));
	assert.equal(apiByName.parametricToolPlace.run(store, { toolId: 'nothing', x: 0, y: 0 }), null);
	assert.match(store.message, /No tool has the id "nothing"/);
});

test('a member resized by its corners keeps the corner where it was put: its size and its constraint, one step', () => {
	const { store, session } = sessionOf({
		nodes: [{ id: 'a', renderer: { type: 'shape' }, size: { width: 100, height: 60 }, data: { shape: 'rect' }, handles: [] }, { id: 'b', renderer: { type: 'shape' }, size: { width: 80, height: 60 }, data: { shape: 'ellipse' }, handles: [] }],
		parametric: { groupList: [{ id: 'g', root: { x: 0, y: 0 }, memberList: [{ id: 'm1', node: 'a' }, { id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'beside', side: 'right', gap: 40 } }] }] },
	});
	// b dragged by its top left corner: 20 further left, 10 higher, larger by as much
	assert.equal(session.nodeResize('b', { x: 120, y: -10, width: 100, height: 80 }), true);
	assert.deepEqual(store.nodeGet('b').size, { width: 100, height: 80 });
	const box = session.solve().boxByKey.get('g/m2');
	assert.deepEqual([box.x, box.y, box.width, box.height], [120, -10, 100, 80]);
	assert.equal(store.history.length, 1);
	assert.equal(session.nodeResize('free', { x: 0, y: 0, width: 10, height: 10 }), false);
});

test('a layout is framed when the diagram is read as its type says, a pattern not; the card writes only what differs', () => {
	const { store, session } = sessionOf({ parametric: { groupList: [{ id: 'g', root: { x: 0, y: 0 }, memberList: [
		{ id: 'row', name: 'Stages', layout: { type: 'array', direction: 'row', gap: 20 } },
		{ id: 'cap', layout: { type: 'caption', side: 'bottom', gap: 6 } },
	] }] } });
	const memberOf = id => session.groupModelGet('g').memberById.get(id);
	assert.equal(memberIsFramedWhenRead(memberOf('row'), session.catalog), true);
	assert.equal(memberIsFramedWhenRead(memberOf('cap'), session.catalog), false);
	// set against what the type says: written; back to it: taken out again
	assert.equal(session.memberFramedWhenReadSet('g', 'row', false), true);
	assert.equal(session.memberGet('g', 'row').isFramedWhenRead, false);
	assert.equal(memberIsFramedWhenRead(memberOf('row'), session.catalog), false);
	assert.equal(session.memberFramedWhenReadSet('g', 'row', true), true);
	assert.equal('isFramedWhenRead' in session.memberGet('g', 'row'), false);
	assert.equal(session.memberFramedWhenReadSet('g', 'cap', true), true);
	assert.equal(session.memberGet('g', 'cap').isFramedWhenRead, true);
	assert.equal(store.history.length, 3);
	// only a layout has a frame, and the value is a boolean
	assert.throws(() => sessionOf({ nodes: [{ id: 'n', renderer: { type: 'text' }, data: { text: 'n' }, handles: [] }], parametric: { groupList: [{ id: 'g', root: { x: 0, y: 0 }, memberList: [{ id: 'm', node: 'n', isFramedWhenRead: true }] }] } }), /isFramedWhenRead is of a layout member/);
	assert.throws(() => sessionOf({ parametric: { groupList: [{ id: 'g', root: { x: 0, y: 0 }, memberList: [{ id: 'row', layout: { type: 'array' }, isFramedWhenRead: 'yes' }] }] } }), /isFramedWhenRead is true or false/);
});
