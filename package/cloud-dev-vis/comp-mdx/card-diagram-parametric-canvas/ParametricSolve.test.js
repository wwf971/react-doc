import test from 'node:test';
import assert from 'node:assert/strict';
import { pointRead, copyNodeIdBuild, parametricLineListGet, parametricRead } from './ParametricData.js';
import { constraintTypeBeside, constraintTypeBetween, constraintTypeListDefault, constraintTypeOffset } from './ParametricConstraint.js';
import { layoutTypeArray, layoutTypeListDefault } from './ParametricLayout.js';
import { parametricCatalogBuild } from './ParametricCatalog.js';
import { parametricCopyNodeListBuild, parametricPlacerBuild, parametricSolve } from './ParametricSolve.js';

const catalog = parametricCatalogBuild({ constraintTypeList: constraintTypeListDefault, layoutTypeList: layoutTypeListDefault });
const nodeListOf = idList => idList.map(id => ({ id, handles: [{ id: 'out', direction: 'out', anchor: { side: 'right', offset: 0.25 } }] }));
const sizeById = { a: { width: 100, height: 40 }, b: { width: 60, height: 20 }, c: { width: 80, height: 80 }, d: { width: 50, height: 50 } };
const sizeOf = nodeId => sizeById[nodeId] ?? { width: 10, height: 10 };
const read = (groupList, idList = ['a', 'b', 'c', 'd']) => parametricRead({ groupList }, { nodes: nodeListOf(idList), catalog });
const solve = (model, override) => parametricSolve(model, catalog, { sizeOf, override });

test('a point of a box is read from a name, a side or fractions, never from a connection handle', () => {
	assert.deepEqual(pointRead('center', 'p'), { x: 0.5, y: 0.5 });
	assert.deepEqual(pointRead({ side: 'top', offset: 0.25 }, 'p'), { x: 0.25, y: 0 });
	assert.deepEqual(pointRead({ x: 0.2, y: 0.9 }, 'p'), { x: 0.2, y: 0.9 });
	assert.throws(() => pointRead({ handle: 'out' }, 'p'), /not a connection handle: write the side it stands on/);
	assert.throws(() => pointRead('middle', 'p'), /unknown point "middle"/);
	// the keys of a constraint written before the points had a word of their own say what to write
	assert.throws(() => read([{ id: 'g', root: { x: 0, y: 0 }, memberList: [{ id: 'm1', node: 'a' }, { id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'offset', anchorParent: 'bottom' } }] }]), /write pointParent \(a point of the box\) for anchorParent/);
});

test('a member without a constraint stands at the origin, and an offset moves it', () => {
	const model = read([{ id: 'g', root: { x: 100, y: 50 }, memberList: [{ id: 'm1', node: 'a' }, { id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'offset', x: 10, y: 60, point: 'center', pointParent: 'bottom' } }] }]);
	const solved = solve(model);
	assert.deepEqual(solved.positionById.get('a'), { x: 100, y: 50 });
	// the center of b (60 × 20) at the bottom middle of a (150, 90) plus (10, 60)
	assert.deepEqual(solved.positionById.get('b'), { x: 130, y: 140 });
	assert.deepEqual(solved.boxByKey.get('g/root'), { x: 100, y: 50, width: 0, height: 0 });
});

test('beside puts an edge of the member at a gap from the facing edge of its parent', () => {
	const place = (side, extra = {}) => solve(read([{ id: 'g', root: { x: 0, y: 0 }, memberList: [{ id: 'm1', node: 'a' }, { id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'beside', side, gap: 20, ...extra } }] }])).positionById.get('b');
	assert.deepEqual(place('right'), { x: 120, y: 10 });
	assert.deepEqual(place('left'), { x: -80, y: 10 });
	assert.deepEqual(place('bottom'), { x: 20, y: 60 });
	// the bottom edge of b 20 above the top edge of a
	assert.deepEqual(place('top'), { x: 20, y: -40 });
	assert.deepEqual(place('top', { align: 0, shift: 5 }), { x: 5, y: -40 });
});

test('between places a member between two parents', () => {
	const model = read([{ id: 'g', root: { x: 0, y: 0 }, memberList: [
		{ id: 'm1', node: 'a' },
		{ id: 'm2', node: 'c', constraint: { type: 'offset', x: 300, y: 0 } },
		{ id: 'm3', node: 'b', parentList: ['m1', 'm2'], constraint: { type: 'between', t: 0.5, y: -100 } },
	] }]);
	// the centers: a (50, 20), c (340, 40): the middle (195, 30), up 100, less half of b
	assert.deepEqual(solve(model).positionById.get('b'), { x: 165, y: -80 });
});

test('an array places its children in a row at one gap, and is as large as they make it', () => {
	const model = read([{ id: 'g', root: { x: 10, y: 10 }, memberList: [
		{ id: 'row', layout: { type: 'array', direction: 'row', gap: 20, align: 0.5 }, constraint: { type: 'offset', x: 0, y: 100 } },
		{ id: 'm1', node: 'a', parent: 'row' },
		{ id: 'm2', node: 'c', parent: 'row' },
		{ id: 'm3', node: 'b', parent: 'row' },
		{ id: 'm4', node: 'd', parent: 'row', constraint: { type: 'beside', side: 'bottom', gap: 10 } },
	] }]);
	const solved = solve(model);
	assert.deepEqual(solved.boxByKey.get('g/row'), { x: 10, y: 110, width: 100 + 20 + 80 + 20 + 60 + 20 + 50, height: 80 });
	assert.deepEqual(solved.positionById.get('a'), { x: 10, y: 130 });
	assert.deepEqual(solved.positionById.get('c'), { x: 130, y: 110 });
	assert.deepEqual(solved.positionById.get('b'), { x: 230, y: 140 });
	assert.equal(layoutTypeArray.indexFromPlace(model.groupList[0].memberById.get('row').layout, [solved.boxByKey.get('g/m1'), solved.boxByKey.get('g/m2')], { x: 100, y: 0, width: 60, height: 20 }), 1);
});

test('a size is taken from another member', () => {
	const model = read([{ id: 'g', root: { x: 0, y: 0 }, memberList: [{ id: 'm1', node: 'a' }, { id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'beside', side: 'bottom', gap: 10 }, size: { width: { member: 'm1', factor: 2, add: 10 } } }] }]);
	const solved = solve(model);
	assert.deepEqual(solved.sizeById.get('b'), { width: 210 });
	assert.deepEqual(solved.positionById.get('b'), { x: -55, y: 50 });
});

test('a repeat spawns its child, and what is under it', () => {
	const model = read([{ id: 'g', root: { x: 0, y: 0 }, memberList: [
		{ id: 'rep', layout: { type: 'repeat', count: 3, direction: 'row', gap: 10 } },
		{ id: 'm1', node: 'a', parent: 'rep' },
		{ id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'beside', side: 'bottom', gap: 5 } },
	] }]);
	assert.equal(model.copyList.length, 4);
	const solved = solve(model);
	assert.deepEqual(solved.positionById.get(copyNodeIdBuild('g', 'rep', 2, 'a')), { x: 220, y: 0 });
	assert.deepEqual(solved.positionById.get(copyNodeIdBuild('g', 'rep', 1, 'b')), { x: 130, y: 45 });
	const copyList = parametricCopyNodeListBuild(model, nodeListOf(['a', 'b']));
	assert.equal(copyList.length, 4);
	assert.equal(copyList[0].isDerived, true);
	assert.deepEqual(copyList[0].handles, []);
	const placer = parametricPlacerBuild(model, catalog);
	assert.equal(placer.isPlaced('a'), true);
	assert.equal(placer.isPlaced(copyList[0].id), true);
	assert.equal(placer.isPlaced('c'), false);
});

test('a dragged member is where the pointer has it, and what follows it follows it there', () => {
	const model = read([{ id: 'g', root: { x: 0, y: 0 }, memberList: [{ id: 'm1', node: 'a' }, { id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'beside', side: 'right', gap: 20 } }] }]);
	const solved = solve(model, new Map([['a', { x: 500, y: 300 }]]));
	assert.deepEqual(solved.positionById.get('a'), { x: 500, y: 300 });
	assert.deepEqual(solved.positionById.get('b'), { x: 620, y: 310 });
});

test('a drop is written as the parameters of the constraint, and solving them gives the place back', () => {
	const model = read([{ id: 'g', root: { x: 0, y: 0 }, memberList: [
		{ id: 'm1', node: 'a' },
		{ id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'offset', point: 'center', pointParent: 'right' } },
		{ id: 'm3', node: 'c', parent: 'm1', constraint: { type: 'beside', side: 'top', gap: 20 } },
		{ id: 'm4', node: 'd', parentList: ['m1', 'm3'], constraint: { type: 'between' } },
	] }]);
	const solved = solve(model);
	const group = model.groupList[0];
	const position = { x: 333, y: -47 };
	for (const [memberId, type] of [['m2', constraintTypeOffset], ['m3', constraintTypeBeside], ['m4', constraintTypeBetween]]) {
		const member = group.memberById.get(memberId);
		const context = { size: sizeOf(member.nodeId), parentBoxList: member.parentIdList.map(parentId => solved.boxByKey.get(`g/${parentId}`)) };
		const written = type.fromPlace({ type: type.type }, member.constraint, context, position);
		const constraintNext = type.read({ ...member.constraint, ...written }, { field: 'c', pointRead: (value) => value ?? null });
		const placed = type.solve({ ...member.constraint, ...constraintNext, point: member.constraint.point, pointParent: member.constraint.pointParent, pointA: member.constraint.pointA, pointB: member.constraint.pointB }, context);
		assert.deepEqual({ x: Math.round(placed.x), y: Math.round(placed.y) }, position, memberId);
	}
});

test('what cannot be solved is refused with the member named', () => {
	assert.throws(() => read([{ id: 'g', memberList: [{ id: 'm1', node: 'zz' }] }]), /"zz" is not a node/);
	assert.throws(() => read([{ id: 'g', memberList: [{ id: 'm1', node: 'a' }, { id: 'm2', node: 'a' }] }]), /placed by another member/);
	assert.throws(() => read([{ id: 'g', memberList: [{ id: 'm1', node: 'a', parent: 'm2' }, { id: 'm2', node: 'b', parent: 'm1' }] }]), /in a circle/);
	assert.throws(() => read([{ id: 'g', memberList: [{ id: 'm1', node: 'a', parent: 'm9' }] }]), /is not a member of the group/);
	assert.throws(() => read([{ id: 'g', memberList: [{ id: 'm1', node: 'a', constraint: { type: 'between' } }] }]), /two|2 parents/);
	assert.throws(() => read([{ id: 'g', memberList: [{ id: 'm1', node: 'a', constraint: { type: 'spiral' } }] }]), /unknown constraint type/);
	assert.throws(() => read([{ id: 'g', memberList: [{ id: 'rep', layout: { type: 'repeat' } }, { id: 'm1', node: 'a', parent: 'rep' }, { id: 'm2', node: 'b', parent: 'rep' }] }]), /takes one child/);
	assert.throws(() => read([{ id: 'g', memberList: [{ id: 'm1', node: 'a', layout: { type: 'array' } }] }]), /exactly one of node or layout/);
	// a size that follows from itself is found when it is solved
	const model = read([{ id: 'g', memberList: [{ id: 'm1', node: 'a', size: { width: { member: 'm2' } } }, { id: 'm2', node: 'b', size: { width: { member: 'm1' } } }] }]);
	assert.throws(() => solve(model), /follows from itself/);
});

test('a line of a group is a connection between two of its members, listed under the one more to the left', () => {
	const model = read([{ id: 'g', root: { x: 0, y: 0 }, memberList: [{ id: 'm1', node: 'a' }, { id: 'm2', node: 'b', parent: 'm1', constraint: { type: 'beside', side: 'left', gap: 20 } }] }]);
	const solved = solve(model);
	const connections = [{ id: 'l1', source: { nodeId: 'a', handleId: 'out' }, target: { nodeId: 'b', handleId: 'out' } }, { id: 'l2', source: { nodeId: 'a', handleId: 'out' }, target: { nodeId: 'c', handleId: 'out' } }, { id: 'l3', source: { position: { x: 0, y: 0 } }, target: { nodeId: 'b', handleId: 'out' } }];
	const lineList = parametricLineListGet(model, connections, (groupId, memberId) => solved.boxByKey.get(`${groupId}/${memberId}`)?.x);
	assert.deepEqual(lineList, [{ connectionId: 'l1', groupId: 'g', memberIdList: ['m1', 'm2'], memberIdDirect: 'm2' }]);
});
