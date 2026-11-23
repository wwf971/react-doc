import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { DiagramEditStore } from '../card-diagram/DiagramEditStore.js';
import { diagramNormalize, diagramPlacesGet } from '../card-diagram/DiagramERData.js';
import { nodeRegistryBuild } from '../card-diagram/node-registry.js';
import { cardLabelNodeKind, cardNoteNodeKind, colorBlockNodeKind } from '../card-diagram/card-diagram-node-registry.js';
import { PARAMETRIC_DATA_KEY, PARAMETRIC_FEATURE_ID } from './ParametricData.js';
import { parametricCatalogBuild } from './ParametricCatalog.js';
import { parametricGraphResolveBuild } from './ParametricSolve.js';
import { ParametricEditStore } from './ParametricEditStore.js';
import { createModeClick, createModeDragBox, createModeDragLine, createModeNextTo, createModeParamOf } from './ParametricCreateMode.js';
import { parametricToolMapDefault } from './ParametricTool.js';
import { toolDetailBuild } from './ParametricToolModel.js';

const catalog = parametricCatalogBuild();
const feature = { id: PARAMETRIC_FEATURE_ID, dataKey: PARAMETRIC_DATA_KEY, graphResolve: parametricGraphResolveBuild(catalog) };
const registry = nodeRegistryBuild({ id: 'test', label: 'Test', kindList: [cardNoteNodeKind, cardLabelNodeKind, colorBlockNodeKind], featureList: [feature] });
const noteOf = (id, extra = {}) => ({ id, renderer: { type: 'card-note' }, size: { width: 100, height: 40 }, data: { title: id }, handles: [], ...extra });
const editor = { change: (operation) => { operation(); }, isLocked: false };
const gestureOf = (pointNow, pointDown = null, extra = {}) => ({ pointNow, pointDown, isDragged: Boolean(pointDown), isShift: false, isAlt: false, ...extra });

function sessionOf(value = {}) {
	const store = new DiagramEditStore(JSON.stringify({ version: 1, nodes: [], ...value }), 'diagram', undefined, registry);
	let idCount = 0;
	const session = new ParametricEditStore({ store, registry, catalog, toolMapGet: () => parametricToolMapDefault, idGet: () => `id${(idCount += 1)}` });
	return { store, session, toolOf: id => session.toolList.find(tool => tool.id === id) };
}
const positionOf = (store, nodeId) => { const graph = diagramNormalize(parse(store.rawDraft), registry); return diagramPlacesGet(graph.nodes, graph.layout, {}).positions.get(nodeId); };
const groupValue = { nodes: [noteOf('a'), noteOf('b', { position: { x: 600, y: 400 } })], parametric: { groupList: [{ id: 'g', root: { x: 100, y: 100 }, memberList: [{ id: 'm1', node: 'a' }] }] } };

test('a create mode turns a gesture into a placement, knowing no thing', () => {
	const param = mode => createModeParamOf(mode);
	assert.equal(createModeClick.placementOf(gestureOf(null), param(createModeClick), {}), null);
	assert.deepEqual(createModeClick.placementOf(gestureOf({ x: 10.4, y: 20.6 }), param(createModeClick), {}), { kind: 'point', point: { x: 10, y: 21 }, hold: { x: 0.5, y: 0.5 } });
	// a box dragged out, whichever way. Before the drag starts nothing is placed (nothing is drawn),
	// and a press without a drag is a click only as the pointer goes up
	assert.deepEqual(createModeDragBox.placementOf(gestureOf({ x: 50, y: 20 }, { x: 200, y: 120 }), param(createModeDragBox), {}), { kind: 'box', rect: { x: 50, y: 20, width: 150, height: 100 } });
	assert.equal(createModeDragBox.placementOf(gestureOf({ x: 50, y: 20 }), param(createModeDragBox), {}), null);
	assert.equal(createModeDragBox.placementOf(gestureOf({ x: 50, y: 20 }, { x: 50, y: 20 }, { isDragged: false }), param(createModeDragBox), {}), null);
	assert.equal(createModeDragBox.placementOf(gestureOf({ x: 50, y: 20 }, { x: 50, y: 20 }, { isDragged: false, isEnd: true }), param(createModeDragBox), {}).kind, 'point');
	assert.equal(createModeDragLine.placementOf(gestureOf({ x: 50, y: 20 }), param(createModeDragLine), {}), null);
	// Shift keeps it square, Alt grows it from its center; the parameters of the mode do the same
	assert.deepEqual(createModeDragBox.placementOf(gestureOf({ x: 160, y: 130 }, { x: 100, y: 100 }, { isShift: true }), param(createModeDragBox), {}).rect, { x: 100, y: 100, width: 60, height: 60 });
	assert.deepEqual(createModeDragBox.placementOf(gestureOf({ x: 160, y: 130 }, { x: 100, y: 100 }), { isSquare: false, isFromCenter: true }, {}).rect, { x: 40, y: 70, width: 120, height: 60 });
	assert.deepEqual(createModeDragLine.placementOf(gestureOf({ x: 90, y: 14 }, { x: 10, y: 10 }, { isShift: true }), param(createModeDragLine), {}), { kind: 'segment', from: { x: 10, y: 10 }, to: { x: 90, y: 10 } });
	// beside the thing nearest to the pointer, on the side the pointer is at
	const targetList = [{ nodeId: 'a', box: { x: 0, y: 0, width: 100, height: 40 } }, { nodeId: 'b', box: { x: 400, y: 0, width: 100, height: 40 } }];
	assert.deepEqual(createModeNextTo.placementOf(gestureOf({ x: 130, y: 20 }), param(createModeNextTo), { targetList }), { kind: 'beside', target: targetList[0], side: 'right', gap: 40 });
	assert.equal(createModeNextTo.placementOf(gestureOf({ x: 450, y: 70 }), param(createModeNextTo), { targetList }).side, 'bottom');
	assert.equal(createModeNextTo.placementOf(gestureOf({ x: 95, y: 20 }), param(createModeNextTo), { targetList }).side, 'right');
	assert.equal(createModeNextTo.placementOf(gestureOf({ x: 130, y: 20 }), { gap: 40, isGapFromPointer: true }, { targetList }).gap, 30);
	assert.equal(createModeNextTo.placementOf(gestureOf({ x: 250, y: 300 }), param(createModeNextTo), { targetList }), null);
});

test('the modes a tool offers follow from what its creator takes, never from the name of a kind', () => {
	const { session, toolOf } = sessionOf();
	const modesOf = id => session.toolModeListOf(toolOf(id)).map(mode => mode.id);
	// a node drawn to a size is dragged out; one as high as its content is clicked, and takes a width from a box
	assert.deepEqual(modesOf('card-block'), ['drag-box', 'click', 'next-to']);
	assert.deepEqual(modesOf('note'), ['click', 'next-to', 'drag-box']);
	// one as wide as its words takes no box
	assert.deepEqual(modesOf('label'), ['click', 'next-to']);
	assert.deepEqual(modesOf('layout-row'), ['click', 'drag-line', 'next-to']);
	assert.deepEqual(modesOf('group'), ['click', 'drag-box']);
	assert.deepEqual(modesOf('line'), ['drag-line', 'click']);
	// a kind this diagram does not have: nothing places it
	assert.deepEqual(modesOf('card-table'), []);
	assert.equal(session.toolModeDefaultOf(toolOf('card-block')).id, 'drag-box');
	// a tool names its default, and keeps the parameters of a mode
	session.toolSet('card-block', { ...toolOf('card-block'), mode: 'click', modeParam: { 'drag-box': { isSquare: true } } });
	assert.equal(session.toolModeDefaultOf(toolOf('card-block')).id, 'click');
	assert.deepEqual(session.toolModeParamOf(toolOf('card-block'), createModeDragBox), { isSquare: true, isFromCenter: false });
	const detail = toolDetailBuild(session, toolOf('card-block'));
	assert.deepEqual(detail.modeList.map(item => [item.mode.id, item.isDefault]), [['drag-box', false], ['click', true], ['next-to', false]]);
	detail.modeList[0].defaultSet();
	assert.equal(session.toolModeDefaultOf(toolOf('card-block')).id, 'drag-box');
	assert.deepEqual(detail.sectionList.map(section => section.id), ['tool', 'node']);
});

test('a gesture places what the tool makes: a block dragged out takes the box', () => {
	const { store, session, toolOf } = sessionOf();
	session.toolArm('card-block');
	assert.equal(session.toolModeArmed.id, 'drag-box');
	session.gestureSet(gestureOf({ x: 300, y: 260 }, { x: 40, y: 60 }));
	assert.deepEqual(session.placementNow, { kind: 'box', rect: { x: 40, y: 60, width: 260, height: 200 } });
	assert.deepEqual(session.ghostNow.boxList, [{ x: 40, y: 60, width: 260, height: 200 }]);
	session.gestureEnd(editor);
	const node = store.nodes.at(-1);
	assert.equal(node.renderer.type, 'color-block');
	assert.deepEqual(node.position, { x: 40, y: 60 });
	assert.deepEqual(node.size, { width: 260, height: 200 });
	assert.equal(session.toolArmedId, null);
	// a box smaller than the kind allows is made as small as it allows
	session.toolArm('card-block');
	session.gestureSet(gestureOf({ x: 510, y: 505 }, { x: 500, y: 500 }));
	session.gestureEnd(editor);
	assert.deepEqual(store.nodes.at(-1).size, { width: 80, height: 60 });
	// a note takes its width from a box, and stays as high as its content; the tool kept armed stays
	session.toolSet('note', { ...toolOf('note'), isKeptArmed: true });
	session.toolArm('note', 'drag-box');
	session.gestureSet(gestureOf({ x: 320, y: 700 }, { x: 20, y: 600 }));
	session.gestureEnd(editor);
	assert.deepEqual(store.nodes.at(-1).size, { width: 300 });
	assert.equal(session.toolArmedId, 'note');
	// in a mode of a drag: no ghost before the press, a press without a drag puts it at its own size
	session.toolArm('card-block');
	session.gestureSet(gestureOf({ x: 900, y: 700 }));
	assert.equal(session.ghostNow, null);
	session.gestureSet(gestureOf({ x: 900, y: 700 }, { x: 900, y: 700 }, { isDragged: false }));
	assert.equal(session.ghostNow, null);
	session.gestureEnd(editor);
	assert.deepEqual(store.nodes.at(-1).position, { x: 700, y: 550 });
	assert.equal(store.nodes.at(-1).size.width, 400);
	store.undo();
	// a click puts it with its center at the pointer, at its own size (a note: 170 × 48)
	session.toolArm('note', 'click');
	session.gestureSet(gestureOf({ x: 1000, y: 1000 }));
	session.gestureEnd(editor);
	assert.deepEqual(store.nodes.at(-1).position, { x: 915, y: 976 });
	store.undo();
	assert.equal(store.nodes.length, 3);
});

test('next to a member the new thing follows it; next to a free element it is free', () => {
	const { store, session } = sessionOf(groupValue);
	session.toolArm('note', 'next-to');
	// a is at 100, 100 (100 × 40): the pointer at its right
	session.gestureSet(gestureOf({ x: 230, y: 120 }));
	assert.equal(session.placementNow.target.memberId, 'm1');
	assert.equal(session.ghostNow.boxList.length, 2);
	session.gestureEnd(editor);
	const member = store.value.parametric.groupList[0].memberList.at(-1);
	assert.deepEqual({ parent: member.parent, constraint: member.constraint }, { parent: 'm1', constraint: { type: 'beside', side: 'right', gap: 40 } });
	assert.deepEqual(positionOf(store, member.node), { x: 240, y: 96 });
	// under the free element b (600, 400)
	session.toolArm('note', 'next-to');
	session.gestureSet(gestureOf({ x: 650, y: 470 }));
	session.gestureEnd(editor);
	const free = store.nodes.at(-1);
	assert.equal(session.nodeIsPlaced(free.id), false);
	assert.deepEqual(free.position, { x: 565, y: 480 });
	// away from everything: nothing is made, and the tool stays armed
	session.toolArm('note', 'next-to');
	session.gestureSet(gestureOf({ x: 3000, y: 3000 }));
	session.gestureEnd(editor);
	assert.equal(session.toolArmedId, 'note');
	assert.equal(store.nodes.length, 4);
});

test('a group dragged out takes in the free elements inside it; a layout dragged runs the way of the drag; a line joins two points', () => {
	const { store, session } = sessionOf(groupValue);
	session.toolArm('group', 'drag-box');
	session.gestureSet(gestureOf({ x: 800, y: 500 }, { x: 560, y: 380 }));
	assert.match(session.ghostNow.text, /1 element/);
	session.gestureEnd(editor);
	const group = store.value.parametric.groupList.at(-1);
	assert.deepEqual(group.root, { x: 560, y: 380 });
	assert.deepEqual(group.memberList.map(member => member.node), ['b']);
	assert.deepEqual(positionOf(store, 'b'), { x: 600, y: 400 });
	store.selectionClear();
	session.toolArm('layout-row', 'drag-line');
	session.gestureSet(gestureOf({ x: 20, y: 900 }, { x: 10, y: 700 }));
	session.gestureEnd(editor);
	const layoutGroup = store.value.parametric.groupList.at(-1);
	assert.deepEqual(layoutGroup.root, { x: 10, y: 700 });
	assert.equal(layoutGroup.memberList[0].layout.direction, 'column');
	session.toolArm('line');
	assert.equal(session.toolModeArmed.id, 'drag-line');
	session.gestureSet(gestureOf({ x: 300, y: 50 }, { x: 10, y: 20 }));
	assert.deepEqual(session.ghostNow.lineList, [{ from: { x: 10, y: 20 }, to: { x: 300, y: 50 } }]);
	session.gestureEnd(editor);
	assert.deepEqual(store.connections.at(-1).source, { position: { x: 10, y: 20 } });
	assert.deepEqual(store.connections.at(-1).target, { position: { x: 300, y: 50 } });
});

test('what can be done with a thing right-clicked: a free node, a member, a line can be removed', () => {
	const { store, session } = sessionOf({ ...groupValue, connections: [{ id: 'l1', source: { position: { x: 0, y: 0 } }, target: { position: { x: 50, y: 0 } } }] });
	const idsOf = target => session.createActionListGet(target, editor).map(action => action.id);
	assert.deepEqual(idsOf({ kind: 'node', nodeId: 'b' }), ['group-join-g', 'group-new', 'node-remove']);
	assert.ok(idsOf({ kind: 'node', nodeId: 'a' }).includes('node-remove'));
	assert.deepEqual(idsOf({ kind: 'line', connectionId: 'l1' }), ['line-remove']);
	session.createActionListGet({ kind: 'node', nodeId: 'b' }, editor).find(action => action.id === 'node-remove').start({ editor });
	assert.equal(store.nodeGet('b'), undefined);
	session.createActionListGet({ kind: 'line', connectionId: 'l1' }, editor)[0].start({ editor });
	assert.equal(store.connectionGet('l1'), undefined);
	store.undo();
	assert.ok(store.connectionGet('l1'));
});

test('the camera of the graph of relations is of what is selected, and zooms within its bounds', () => {
	const { store, session } = sessionOf(groupValue);
	store.select('a');
	assert.deepEqual(session.graphCamera, { key: session.graphKey, x: 0, y: 0, zoom: 1 });
	session.graphCameraSet({ x: 10, y: 20, zoom: 9 });
	assert.equal(session.graphCamera.zoom, 3);
	// another thing selected starts from the rest; back to the first, too
	store.select('b');
	assert.equal(session.graphCamera.zoom, 1);
});
