import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { DiagramEditStore } from '../card-diagram/DiagramEditStore.js';
import { diagramNormalize, diagramPlacesGet } from '../card-diagram/DiagramERData.js';
import { nodeRegistryBuild } from '../card-diagram/node-registry.js';
import { cardNoteNodeKind } from '../card-diagram/card-diagram-node-registry.js';
import { PARAMETRIC_DATA_KEY, PARAMETRIC_FEATURE_ID, parametricRead } from './ParametricData.js';
import { parametricCatalogBuild } from './ParametricCatalog.js';
import { parametricGraphResolveBuild, parametricSolve } from './ParametricSolve.js';
import { ParametricEditStore } from './ParametricEditStore.js';
import { parametricToolMapDefault } from './ParametricTool.js';
import { shapeNodeKind } from './ParametricShape.jsx';
import { modeCardModelBuild, nodeSectionListBuild } from './ParametricEditModel.js';
import { locatorCardSectionListBuild, locatorModeCardBuild } from './ParametricLocatorModel.js';
import { locatorGeometryOf } from './ParametricLocatorLayer.jsx';

// The locator and the reference points a member declares (card-diagram-parametric-canvas.md#locators,
// #reference-points): read, solved, changed by the commands of the session, with their undo.
const catalog = parametricCatalogBuild();
const feature = { id: PARAMETRIC_FEATURE_ID, dataKey: PARAMETRIC_DATA_KEY, graphResolve: parametricGraphResolveBuild(catalog) };
const registry = nodeRegistryBuild({ id: 'test', label: 'Test', kindList: [cardNoteNodeKind, shapeNodeKind], featureList: [feature] });
const layoutUiByType = { locator: { cardSectionListGet: locatorCardSectionListBuild, modeCardGet: locatorModeCardBuild } };

const shapeOf = (id, extra = {}) => ({ id, renderer: { type: 'shape' }, size: { width: 100, height: 40 }, data: { shape: 'rect' }, handles: [], ...extra });
const sourceOf = value => JSON.stringify({ version: 1, viewport: { featureList: [PARAMETRIC_FEATURE_ID] }, ...value });
function sessionOf(value) {
	const store = new DiagramEditStore(sourceOf(value), 'diagram', undefined, registry);
	let idCount = 0;
	const session = new ParametricEditStore({ store, registry, catalog, layoutUiByType, toolMapGet: () => parametricToolMapDefault, idGet: () => `id${(idCount += 1)}` });
	return { store, session };
}
// where the draft puts every node, and how large, with the sizes as written
function placesOf(store) {
	const graph = diagramNormalize(parse(store.rawDraft), registry);
	const places = diagramPlacesGet(graph.nodes, graph.layout, {});
	const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
	return { positionOf: id => places.positions.get(id), sizeOf: id => ({ width: nodeById.get(id).size.width, height: nodeById.get(id).size.height, ...places.sizeById.get(id) }) };
}
const boxOf = (store, id) => { const places = placesOf(store); return { ...places.positionOf(id), ...places.sizeOf(id) }; };
const memberOf = (store, memberId) => store.value.parametric.groupList[0].memberList.find(member => member.id === memberId);

// |xxx|yyy|zzzzzz|: three blocks between the vertical lines of a locator, as high as its two
// horizontal lines are apart; a label on a crossing
const blocksValue = {
	nodes: [shapeOf('a'), shapeOf('b'), shapeOf('c'), shapeOf('t', { size: { width: 20, height: 12 } })],
	parametric: { groupList: [{ id: 'g', root: { x: 100, y: 50 }, memberList: [
		{ id: 'loc', layout: { type: 'locator', xList: [0, 120, 240, { id: 'end', at: 480, name: 'End' }], yList: [0, 80] } },
		{ id: 'ma', node: 'a', parent: 'loc', constraint: { type: 'locate', lineX: ['1', '2'], lineY: ['1', '2'] } },
		{ id: 'mb', node: 'b', parent: 'loc', constraint: { type: 'locate', lineX: ['2', '3'], lineY: ['1', '2'], inset: 4 } },
		{ id: 'mc', node: 'c', parent: 'loc', constraint: { type: 'locate', lineX: ['3', 'end'], lineY: ['1', '2'] } },
		// its middle on the crossing of the 2nd vertical line and the 2nd horizontal one, 6 lower
		{ id: 'mt', node: 't', parent: 'loc', constraint: { type: 'locate', lineX: '2', lineY: '2', y: 6, point: 'center' } },
	] }] },
};

test('a locator gives lines: a box between two of them takes their distance as its size, a reference point stands on a line or a crossing', () => {
	const { store } = sessionOf(blocksValue);
	assert.deepEqual(boxOf(store, 'a'), { x: 100, y: 50, width: 120, height: 80 });
	// an inset: smaller at each end
	assert.deepEqual(boxOf(store, 'b'), { x: 224, y: 54, width: 112, height: 72 });
	assert.deepEqual(boxOf(store, 'c'), { x: 340, y: 50, width: 240, height: 80 });
	assert.deepEqual(placesOf(store).positionOf('t'), { x: 210, y: 130 });
	// a line named by an id it has not, on lines under what is no locator: refused, naming it
	assert.throws(() => parametricRead({ groupList: [{ id: 'g', memberList: [{ id: 'loc', layout: { type: 'locator', xList: [0, 10] } }, { id: 'm', node: 'a', parent: 'loc', constraint: { type: 'locate', lineX: '7' } }] }] }, { nodes: [{ id: 'a' }], catalog }), /its locator has no line "7"/);
	assert.throws(() => parametricRead({ groupList: [{ id: 'g', memberList: [{ id: 'm', node: 'a', constraint: { type: 'locate' } }] }] }, { nodes: [{ id: 'a' }], catalog }), /its parent is none/);
	assert.throws(() => parametricRead({ groupList: [{ id: 'g', memberList: [{ id: 'loc', layout: { type: 'locator' } }] }] }, { nodes: [], catalog }), /one line at least/);
	assert.throws(() => parametricRead({ groupList: [{ id: 'g', memberList: [{ id: 'loc', layout: { type: 'locator', xList: [0, { id: '1', at: 5 }] } }] }] }, { nodes: [], catalog }), /declared twice/);
});

test('a locator of one dimension, and one whose lines start before its origin: its origin stays the place it is put at', () => {
	const model = parametricRead({ groupList: [{ id: 'g', root: { x: 0, y: 0 }, memberList: [
		{ id: 'loc', layout: { type: 'locator', xList: [-40, 60] }, constraint: { type: 'offset', x: 200, y: 100 } },
		{ id: 'm1', node: 'a', parent: 'loc', constraint: { type: 'locate', lineX: '2' } },
		// under a locator with no other constraint: an offset from its default reference point, its origin
		{ id: 'm2', node: 'b', parent: 'loc', constraint: { type: 'offset', x: 5, y: 7 } },
		// an offset from a crossing chosen as the reference point of the parent
		{ id: 'm3', node: 'c', parent: 'loc', constraint: { type: 'offset', y: 30, pointParent: { lineX: '1' } } },
	] }] }, { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], catalog });
	const solved = parametricSolve(model, catalog, { sizeOf: () => ({ width: 10, height: 10 }) });
	// its box starts at its first line; its origin is where its constraint puts it
	assert.deepEqual(solved.boxByKey.get('g/loc'), { x: 160, y: 100, width: 100, height: 0 });
	assert.deepEqual(solved.positionById.get('a'), { x: 260, y: 100 });
	assert.deepEqual(solved.positionById.get('b'), { x: 205, y: 107 });
	assert.deepEqual(solved.positionById.get('c'), { x: 160, y: 130 });
	const geometry = locatorGeometryOf(model.groupList[0].memberById.get('loc').layout, solved.boxByKey.get('g/loc'), []);
	assert.deepEqual(geometry.origin, { x: 200, y: 100 });
	assert.deepEqual(geometry.xLineList.map(line => line.place), [160, 260]);
	// the row of chevrons stands above the lines unless the locator says where
	assert.equal(geometry.rail.y, 86);
});

test('a line moved moves what stands on it, as one step that an undo takes back; the lines after it follow when asked', () => {
	const { store, session } = sessionOf(blocksValue);
	const before = store.rawDraft;
	assert.equal(session.locatorLineSet('g', 'loc', 'x', '2', { at: 150 }), true);
	// the editor writes every line with its id, so a line inserted later changes no reference
	assert.deepEqual(memberOf(store, 'loc').layout.xList, [{ id: '1', at: 0 }, { id: '2', at: 150 }, { id: '3', at: 240 }, { id: 'end', at: 480, name: 'End' }]);
	assert.deepEqual(boxOf(store, 'a'), { x: 100, y: 50, width: 150, height: 80 });
	assert.deepEqual(boxOf(store, 'b'), { x: 254, y: 54, width: 82, height: 72 });
	assert.deepEqual(placesOf(store).positionOf('t'), { x: 240, y: 130 });
	assert.equal(store.undo(), true);
	assert.equal(store.rawDraft, before);
	// Shift on the canvas: the gap before it changes, the others keep theirs
	session.locatorLineSet('g', 'loc', 'x', '2', { at: 150 }, { isFollowerShifted: true });
	assert.deepEqual(memberOf(store, 'loc').layout.xList.map(line => line.at), [0, 150, 270, 510]);
	assert.deepEqual(boxOf(store, 'c'), { x: 370, y: 50, width: 240, height: 80 });
});

test('a line dragged is held by the session and written when dropped; dropped on the cancel area, nothing is written', () => {
	const { store, session } = sessionOf(blocksValue);
	const before = store.valueCurrent;
	session.lineDragSet({ groupId: 'g', memberId: 'loc', axis: 'x', lineId: '3', at: 300, isFollowerShifted: false, isOverCancel: false });
	// while it is dragged nothing of the draft changes: nothing is placed anew
	assert.equal(store.valueCurrent, before);
	session.lineDragSet({ ...session.lineDrag, at: 320, isOverCancel: true });
	assert.equal(session.lineDragEnd(), false);
	assert.equal(store.valueCurrent, before);
	assert.equal(session.lineDrag, null);
	session.lineDragSet({ groupId: 'g', memberId: 'loc', axis: 'x', lineId: '3', at: 300, isFollowerShifted: false, isOverCancel: false });
	assert.equal(session.lineDragEnd(), true);
	assert.deepEqual(boxOf(store, 'c'), { x: 400, y: 50, width: 180, height: 80 });
	// the rail of the chevrons dragged: only where they stand is written
	session.lineDragSet({ groupId: 'g', memberId: 'loc', axis: 'chevronY', at: -40, isOverCancel: false });
	session.lineDragEnd();
	assert.equal(memberOf(store, 'loc').layout.chevronY, -40);
	assert.deepEqual(boxOf(store, 'c'), { x: 400, y: 50, width: 180, height: 80 });
});

test('a line added gets an id of its own; a line removed leaves what stood on it where it stands, with its size', () => {
	const { store, session } = sessionOf(blocksValue);
	const id = session.locatorLineAdd('g', 'loc', 'x');
	assert.equal(id, 'id1');
	// after the last one, at the gap of the last two
	assert.deepEqual(memberOf(store, 'loc').layout.xList[4], { id: 'id1', at: 720 });
	const boxBefore = { a: boxOf(store, 'a'), b: boxOf(store, 'b'), t: boxOf(store, 't') };
	const before = store.rawDraft;
	assert.equal(session.locatorLineRemove('g', 'loc', 'x', '2'), true);
	assert.deepEqual(memberOf(store, 'loc').layout.xList.map(line => line.id), ['1', '3', 'end', 'id1']);
	// a ran to the line: it keeps its place and its width, as its own; so does b; t keeps its place
	assert.deepEqual(boxOf(store, 'a'), boxBefore.a);
	assert.deepEqual(boxOf(store, 'b'), boxBefore.b);
	assert.deepEqual(boxOf(store, 't'), boxBefore.t);
	assert.equal(memberOf(store, 'ma').constraint.lineX, undefined);
	assert.deepEqual(memberOf(store, 'ma').constraint.lineY, ['1', '2']);
	assert.equal(store.undo(), true);
	assert.equal(store.rawDraft, before);
	// a locator keeps one line at least
	const { store: storeOne, session: sessionOne } = sessionOf({ nodes: [], parametric: { groupList: [{ id: 'g', memberList: [{ id: 'loc', layout: { type: 'locator', xList: [0] } }] }] } });
	assert.equal(sessionOne.locatorLineRemove('g', 'loc', 'x', '1'), false);
	assert.match(storeOne.message, /at least one line/);
});

test('a member dropped on a locator takes the lines nearest to where it was dropped; put under a locator it stands at an offset from its origin', () => {
	const { store, session } = sessionOf({ ...blocksValue, nodes: [...blocksValue.nodes, shapeOf('free', { position: { x: 700, y: 300 } })] });
	// a (between x1 and x2) dropped near the third gap: it runs from x3 to the end
	session.memberDrop('a', { x: 345, y: 52 });
	assert.deepEqual(memberOf(store, 'ma').constraint.lineX, ['3', 'end']);
	assert.deepEqual(boxOf(store, 'a'), { x: 340, y: 50, width: 240, height: 80 });
	// t (its middle on a crossing) dropped a little off the third vertical line: it takes that line
	session.memberDrop('t', { x: 333, y: 126 });
	assert.equal(memberOf(store, 'mt').constraint.lineX, '3');
	assert.equal(memberOf(store, 'mt').constraint.x, undefined);
	// dropped far from every line: it keeps its line and writes how far from it it stands
	session.memberDrop('t', { x: 400, y: 126 });
	assert.equal(memberOf(store, 'mt').constraint.lineX, '3');
	assert.equal(memberOf(store, 'mt').constraint.x, 70);
	// a free node put under the locator: the default constraint, an offset from its default reference point
	const memberId = session.memberAdd('g', 'free', { parentId: 'loc' });
	assert.deepEqual(memberOf(store, memberId).constraint, { type: 'offset', x: 600, y: 250 });
	assert.deepEqual(placesOf(store).positionOf('free'), { x: 700, y: 300 });
	// placed by its lines instead: the nearest ones, at its distance, so it does not move
	assert.equal(session.memberConstraintTypeSet('g', memberId, 'locate'), true);
	assert.deepEqual(memberOf(store, memberId).constraint, { type: 'locate', lineX: 'end', lineY: '2', x: 120, y: 170 });
	assert.deepEqual(placesOf(store).positionOf('free'), { x: 700, y: 300 });
	// between two lines: its width is theirs, and its resize handles leave it alone
	session.memberConstraintPatch('g', memberId, { lineX: ['1', '2'], x: undefined });
	assert.deepEqual(session.nodeResizeAxisListGet('free', ['width', 'height']), ['height']);
	// taken out from under the locator, it keeps its place and the size the lines gave it
	const boxBefore = boxOf(store, 'free');
	session.memberParentSet('g', memberId, 'root');
	assert.equal(memberOf(store, memberId).constraint.type, 'offset');
	assert.deepEqual(boxOf(store, 'free'), boxBefore);
});

test('a locator removed leaves its blocks where they stand, each with the size its lines gave it', () => {
	const { store, session } = sessionOf(blocksValue);
	const before = Object.fromEntries(['a', 'b', 'c', 't'].map(nodeId => [nodeId, boxOf(store, nodeId)]));
	const raw = store.rawDraft;
	assert.equal(session.memberRemove('g', 'loc'), true);
	assert.equal(memberOf(store, 'loc'), undefined);
	// each follows the origin of the group by an offset now, and keeps its box
	assert.equal(memberOf(store, 'mb').constraint.type, 'offset');
	assert.equal(memberOf(store, 'mb').parent, undefined);
	assert.deepEqual(Object.fromEntries(['a', 'b', 'c', 't'].map(nodeId => [nodeId, boxOf(store, nodeId)])), before);
	assert.equal(store.undo(), true);
	assert.equal(store.rawDraft, raw);
});

test('the tool Row of blocks makes a locator with its blocks in one step', () => {
	const { store, session } = sessionOf({ nodes: [] });
	const tool = session.toolList.find(item => item.id === 'locator-blocks');
	const memberId = session.toolPlace(tool, { x: 40, y: 30 });
	assert.ok(memberId);
	assert.equal(store.nodes.length, 3);
	assert.deepEqual(boxOf(store, store.nodes[2].id), { x: 280, y: 30, width: 240, height: 80 });
	assert.deepEqual(session.focusShown, { kind: 'member', groupId: store.value.parametric.groupList[0].id, memberId });
	assert.equal(store.undo(), true);
	assert.equal(store.nodes.length, 0);
});

const pointValue = {
	nodes: [shapeOf('a'), shapeOf('b', { data: { shape: 'ellipse' } }), shapeOf('c')],
	parametric: { groupList: [{ id: 'g', root: { x: 0, y: 0 }, memberList: [
		{ id: 'm1', node: 'a' },
		{ id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'offset', x: 20, y: 60 } },
		{ id: 'm3', node: 'c', parent: 'm2', constraint: { type: 'offset', x: 0, y: 30, pointParent: { direction: 'south' } } },
	] }] },
};

test('a member declares reference points; removing one or changing its default moves nothing', () => {
	const { store, session } = sessionOf(pointValue);
	// the outline of a node is what its kind says: an ellipse offers directions
	assert.equal(session.memberSubjectOf('g', 'm2').outline.kind, 'ellipse');
	assert.deepEqual(placesOf(store).positionOf('c'), { x: 70, y: 130 });
	const id = session.memberReferencePointAdd('g', 'm1');
	assert.equal(id, 'p1');
	// a box starts with the middle of its left edge
	assert.deepEqual(memberOf(store, 'm1').referencePointList, [{ id: 'p1', point: { side: 'left', index: 1, count: 2 } }]);
	session.memberReferencePointSet('g', 'm1', 'p1', { name: 'Outlet', point: session.referencePointReadOf({ side: 'right', index: 3, count: 4 }) });
	assert.deepEqual(memberOf(store, 'm1').referencePointList, [{ id: 'p1', name: 'Outlet', point: { side: 'right', index: 3, count: 4 } }]);
	// b measured from it: it moves there (a parameter changed)
	session.memberConstraintParamSet('g', 'm2', 'pointParent', 'p1');
	assert.deepEqual(placesOf(store).positionOf('b'), { x: 120, y: 90 });
	// made the default of a: what measured by the default of a (a itself, hanging on the origin) is
	// written again so that nothing moves
	const placeBefore = ['a', 'b', 'c'].map(nodeId => placesOf(store).positionOf(nodeId));
	const before = store.rawDraft;
	assert.equal(session.memberReferencePointDefaultSet('g', 'm1', 'p1'), true);
	assert.equal(memberOf(store, 'm1').referencePointDefault, 'p1');
	assert.deepEqual(memberOf(store, 'm1').constraint, { type: 'offset', x: 100, y: 30 });
	assert.deepEqual(['a', 'b', 'c'].map(nodeId => placesOf(store).positionOf(nodeId)), placeBefore);
	assert.equal(store.undo(), true);
	assert.equal(store.rawDraft, before);
	session.memberReferencePointDefaultSet('g', 'm1', 'p1');
	// removed: what named it, and the default, are written as the same place of the box
	assert.equal(session.memberReferencePointRemove('g', 'm1', 'p1'), true);
	assert.equal(memberOf(store, 'm1').referencePointList, undefined);
	assert.deepEqual(memberOf(store, 'm1').referencePointDefault, { x: 1, y: 0.75 });
	assert.deepEqual(memberOf(store, 'm2').constraint.pointParent, { x: 1, y: 0.75 });
	assert.deepEqual(['a', 'b', 'c'].map(nodeId => placesOf(store).positionOf(nodeId)), placeBefore);
	// a reference point named that the thing does not declare is refused, the draft kept
	assert.equal(session.memberConstraintParamSet('g', 'm3', 'pointParent', 'nowhere'), false);
	assert.match(store.message, /declares no reference point "nowhere"/);
});

test('the reference points of a member are a mode of it: listed, one open, in the place of its settings', () => {
	const { store, session } = sessionOf(pointValue);
	const editor = { store, change: operation => operation(), featureList: [session] };
	store.select('b');
	// its settings say its default reference point and lead into the mode
	const section = nodeSectionListBuild(session, 'b', editor).find(item => item.id === 'parametric-reference');
	assert.equal(section.propertyList[0].valueLabels[''], 'Of its outline: top left');
	assert.equal(session.cardModelGet(store.display, editor), null);
	section.actionList[0].act();
	assert.deepEqual(session.modeShown, { kind: 'referencePoint', groupId: 'g', memberId: 'm2', pointId: null });
	let model = session.cardModelGet(store.display, editor);
	assert.equal(model.view.type, 'list');
	assert.deepEqual(model.view.itemList.map(item => [item.name, item.badge]), [['Top left', 'of its outline · default']]);
	// a new one opens at once: a round thing starts at north, and offers directions and an angle
	model.view.add.act();
	assert.equal(session.modeShown.pointId, 'p1');
	model = modeCardModelBuild(session, editor);
	const where = model.view.sectionList[0].propertyList.find(property => property.id === 'point');
	assert.equal(where.value, 'angle:north');
	assert.ok(where.values.includes('angle:custom') && where.values.includes('box:center') && !where.values.includes('edge:divide'));
	where.set('angle:custom');
	model = modeCardModelBuild(session, editor);
	const angle = model.view.sectionList[0].propertyList.find(property => property.id === 'point-angle');
	assert.equal(angle.value, 45);
	angle.set(120);
	assert.deepEqual(memberOf(store, 'm2').referencePointList, [{ id: 'p1', point: { angle: 120 } }]);
	// Escape steps out: the point, the list, the mode
	session.keyDown({ key: 'Escape' });
	assert.equal(session.modeShown.pointId, null);
	session.keyDown({ key: 'Escape' });
	assert.equal(session.modeShown, null);
	// another thing selected: the mode is not of it
	session.referencePointModeEnter('g', 'm2');
	store.select('a');
	assert.equal(session.modeShown, null);
});

test('the edit card of a locator lists its lines; its mode names and removes them', () => {
	const { store, session } = sessionOf(blocksValue);
	const editor = { store, change: operation => operation(), featureList: [session] };
	session.focusSet({ kind: 'member', groupId: 'g', memberId: 'loc' });
	let card = session.cardGet(editor).model;
	const sectionX = card.view.sectionList.find(section => section.id === 'locator-x');
	assert.deepEqual(sectionX.propertyList.map(property => [property.label, property.value]), [['x1', 0], ['x2', 120], ['x3', 240], ['End', 480]]);
	sectionX.propertyList[1].set(130);
	assert.deepEqual(boxOf(store, 'a'), { x: 100, y: 50, width: 130, height: 80 });
	sectionX.actionList.find(action => action.id === 'line-list-x').act();
	card = session.cardGet(editor).model;
	assert.equal(card.view.type, 'list');
	assert.deepEqual(card.view.itemList.map(item => [item.name, item.badge, item.sub]), [['x1', '0', '1 thing stands on it'], ['x2', '130', '3 things stand on it'], ['x3', '240', '2 things stand on it'], ['End', '480', '1 thing stands on it']]);
	card.view.itemList[1].open();
	card = session.cardGet(editor).model;
	card.view.sectionList[0].propertyList.find(property => property.id === 'name').set('Split');
	assert.equal(memberOf(store, 'loc').layout.xList[1].name, 'Split');
	// how a member stands on it reads by the names of its lines
	assert.equal(session.memberSummaryOf('g', 'ma'), 'on x1–Split × y1–y2');
});

test('Delete in the layer: a member card goes with its member, a group, a locator, a line or a reference point open in a mode', async () => {
	const { diagramRemovalOf } = await import('../card-diagram/DiagramRemove.js');
	const removalOf = (store, session) => { const base = diagramRemovalOf(store); const own = session.removalGet(base, {}); return own === undefined ? base : own; };
	// a node a group places: what follows it is said, and it goes with its member
	{
		const { store, session } = sessionOf(pointValue);
		store.select('a');
		const removal = removalOf(store, session);
		assert.deepEqual(removal.dependentList.map(item => [item.id, item.count]), [['followers', 1]]);
		const before = { c: placesOf(store).positionOf('c') };
		assert.equal(removal.run(), true);
		assert.equal(store.nodeGet('a'), undefined);
		assert.equal(memberOf(store, 'm1'), undefined);
		// b follows the origin now, where it stood; c did not move
		assert.equal(memberOf(store, 'm2').parent, undefined);
		assert.deepEqual(placesOf(store).positionOf('c'), before.c);
	}
	// a locator focused: what stands on it is said; in its mode with a line open, the line
	{
		const { store, session } = sessionOf(blocksValue);
		session.focusSet({ kind: 'member', groupId: 'g', memberId: 'loc' });
		const locator = removalOf(store, session);
		assert.equal(locator.kind, 'layout');
		assert.deepEqual(locator.dependentList.map(item => [item.id, item.count]), [['children', 4]]);
		session.locatorLineModeEnter('g', 'loc', 'x');
		assert.equal(removalOf(store, session), null, 'a mode showing its list takes nothing');
		session.locatorLineModeEnter('g', 'loc', 'x', '2');
		const line = removalOf(store, session);
		assert.equal(line.kind, 'locatorLine');
		assert.deepEqual(line.dependentList.map(item => [item.id, item.count]), [['on-it', 3]]);
		assert.equal(line.run(), true);
		assert.deepEqual(memberOf(store, 'loc').layout.xList.map(item => item.id), ['1', '3', 'end']);
		session.focusSet({ kind: 'group', groupId: 'g' });
		const group = removalOf(store, session);
		assert.deepEqual(group.dependentList.map(item => [item.id, item.count]), [['members', 4], ['layouts', 1]]);
	}
	// a reference point open in its mode: what is measured from it is said
	{
		const { store, session } = sessionOf(pointValue);
		const id = session.memberReferencePointAdd('g', 'm1', { point: session.referencePointReadOf({ side: 'right', index: 1, count: 2 }) });
		session.memberConstraintParamSet('g', 'm2', 'pointParent', id);
		session.referencePointModeEnter('g', 'm1', id);
		const removal = removalOf(store, session);
		assert.equal(removal.kind, 'referencePoint');
		assert.deepEqual(removal.dependentList.map(item => [item.id, item.count]), [['measured', 1]]);
		const placeBefore = placesOf(store).positionOf('b');
		assert.equal(removal.run(), true);
		assert.deepEqual(placesOf(store).positionOf('b'), placeBefore);
	}
});
