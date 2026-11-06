import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagramEditStore } from './DiagramEditStore.js';
import { diagramNormalize } from './DiagramERData.js';
import { pathResolve, pathParse } from './DiagramEditPath.js';
import { cardDiagramNodeRegistry } from './card-diagram-node-registry.js';
import {
	routeAnchorCoupleSet, routeAnchorHandleSet, routeAnchorInsertAt, routeAnchorPlaceOf, routeAnchorPointGet, routeDirectionFacingList, routeEndHandleSet, routeHandleDirectionListGet, routeNormalize, routeOverlapListGet, routePathRunListGet, routeResolve,
} from './DiagramRoute.js';

const ends = { sourceX: 0, sourceY: 0, sourcePosition: 'right', targetX: 300, targetY: 200, targetPosition: 'left' };

const directionOf = (a, b) => (Math.abs(a.x - b.x) < 0.5 ? (b.y > a.y ? 'y+' : 'y-') : (b.x > a.x ? 'x+' : 'x-'));

function assertRightAngled(pointList) {
	for (let index = 0; index < pointList.length - 1; index += 1) {
		const a = pointList[index];
		const b = pointList[index + 1];
		assert.ok(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5, `run ${index} is not axis-aligned: ${JSON.stringify([a, b])}`);
	}
}

test('a route is validated by the family of its line type', () => {
	assert.equal(routeNormalize(undefined, 'smoothstep'), null);
	assert.equal(routeNormalize({}, 'smoothstep'), null);
	assert.deepEqual(routeNormalize({ anchorList: [{ y: 10 }] }, 'step'), { anchorList: [{ id: 'a1', along: 0.5, x: 0, y: 10 }] });
	assert.deepEqual(routeNormalize({ anchorList: [{ handleIn: 'auto', handleOut: 'x+' }] }, 'step').anchorList[0].handleOut, 'x+');
	assert.throws(() => routeNormalize({ anchorList: [{ handleIn: { x: 1, y: 2 } }] }, 'smoothstep'), /right-angled/);
	assert.throws(() => routeNormalize({ anchorList: [{ handleIn: 'x+' }] }, 'bezier'), /vector/);
	assert.throws(() => routeNormalize({ anchorList: [{ along: 2 }] }, 'bezier'), /along/);
	assert.throws(() => routeNormalize({ anchorList: [{ id: 'a' }, { id: 'a' }] }, 'bezier'), /duplicate/);
	assert.throws(() => routeNormalize({ waypoints: [] }, 'bezier'), /unknown key "waypoints"/);
});

test('the normalization of a diagram accepts a route only on a line type with anchors', () => {
	const diagram = (renderer, route) => ({ version: 1, nodes: [{ id: 'a', renderer: { type: 'table' }, data: { name: 'A', fields: [{ id: 'f', label: 'F' }], rows: [] }, handles: [{ id: 'o', direction: 'out', anchor: { side: 'right' } }, { id: 'i', direction: 'in', anchor: { side: 'left' } }] }], connections: [{ id: 'c', source: { nodeId: 'a', handleId: 'o' }, target: { nodeId: 'a', handleId: 'i' }, renderer, route }] });
	const route = { anchorList: [{ y: 40 }] };
	assert.equal(diagramNormalize(diagram({ type: 'smoothstep' }, route), cardDiagramNodeRegistry).connections[0].route.anchorList[0].id, 'a1');
	assert.throws(() => diagramNormalize(diagram({ type: 'straight' }, route), cardDiagramNodeRegistry), /does not accept route/);
	assert.throws(() => diagramNormalize(diagram({ type: 'polyline' }, route), cardDiagramNodeRegistry), /waypoints/);
});

test('an anchor moves with the ends: rigid when both translate, a share when one does', () => {
	const anchor = { id: 'a', along: 0.25, ...routeAnchorPlaceOf({ x: 100, y: 40 }, ends, 0.25) };
	assert.deepEqual(routeAnchorPointGet(anchor, ends), { x: 100, y: 40 });
	const both = { ...ends, sourceX: 50, sourceY: 70, targetX: 350, targetY: 270 };
	assert.deepEqual(routeAnchorPointGet(anchor, both), { x: 150, y: 110 });
	const targetOnly = { ...ends, targetX: 400, targetY: 200 };
	assert.deepEqual(routeAnchorPointGet(anchor, targetOnly), { x: 125, y: 40 });
	const sourceOnly = { ...ends, sourceX: 40 };
	assert.deepEqual(routeAnchorPointGet(anchor, sourceOnly), { x: 130, y: 40 });
});

test('a place on the chord takes its share, clamped; offset is what remains', () => {
	const place = routeAnchorPlaceOf({ x: 150, y: 100 }, ends);
	assert.deepEqual(place, { along: 0.5, x: 0, y: 0 });
	assert.equal(routeAnchorPlaceOf({ x: -100, y: 0 }, ends).along, 0);
	assert.equal(routeAnchorPlaceOf({ x: 900, y: 900 }, ends).along, 1);
	assert.equal(routeAnchorPlaceOf({ x: 5, y: 5 }, { ...ends, targetX: 0, targetY: 0 }).along, 0.5);
});

test('a right-angled line through an auto anchor takes the fewest bends', () => {
	const lane = routeResolve('smoothstep', { anchorList: [{ id: 'a', along: 0.5, x: 30, y: 0 }] }, ends);
	assertRightAngled(lane.pointList);
	assert.deepEqual(lane.pointList, [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 200 }, { x: 300, y: 200 }]);
	assert.deepEqual([lane.anchorList[0].handleIn, lane.anchorList[0].handleOut], ['y-', 'y+']);
	assert.equal(lane.anchorList[0].isInSet, false);
	const down = { sourceX: 0, sourceY: 0, sourcePosition: 'bottom', targetX: -400, targetY: 200, targetPosition: 'top' };
	const nested = routeResolve('smoothstep', { anchorList: [{ id: 'a', along: 0.5, x: 0, y: -30 }] }, down);
	assert.deepEqual(nested.pointList, [{ x: 0, y: 0 }, { x: 0, y: 70 }, { x: -400, y: 70 }, { x: -400, y: 200 }]);
});

test('a handle set is kept, whichever way it points, and the line stays right-angled', () => {
	const away = routeResolve('step', { anchorList: [{ id: 'a', along: 0.5, x: 0, y: 0, handleOut: 'x-' }] }, ends);
	assertRightAngled(away.pointList);
	const at = away.pointList.findIndex((point) => point.x === 150 && point.y === 100);
	assert.ok(at > 0);
	assert.equal(directionOf(away.pointList[at], away.pointList[at + 1]), 'x-');
	for (const handleIn of ['x+', 'x-', 'y+', 'y-']) {
		for (const handleOut of ['x+', 'x-', 'y+', 'y-']) {
			const resolved = routeResolve('step', { anchorList: [{ id: 'a', along: 0.5, x: 0, y: 0, handleIn, handleOut }] }, ends);
			assertRightAngled(resolved.pointList);
			assert.equal(resolved.anchorList[0].handleIn, handleIn);
			assert.equal(resolved.anchorList[0].handleOut, handleOut);
		}
	}
});

test('the ends leave and arrive perpendicular to their sides by default, a set handle overrides', () => {
	const plain = routeResolve('step', { anchorList: [{ id: 'a', along: 0.5, x: 0, y: 0 }] }, ends);
	assert.equal(plain.source.handle, 'x+');
	assert.equal(plain.target.handle, 'x-');
	assert.equal(directionOf(plain.pointList[0], plain.pointList[1]), 'x+');
	const set = routeResolve('step', routeEndHandleSet('step', null, 'source', 'y+'), ends);
	assert.equal(set.source.handle, 'y+');
	assert.equal(set.source.isSet, true);
	assert.equal(directionOf(set.pointList[0], set.pointList[1]), 'y+');
	const free = routeResolve('step', { anchorList: [{ id: 'a', along: 0.5, x: 0, y: 0 }] }, { ...ends, isSourceFree: true, sourcePosition: 'left' });
	assert.notEqual(free.source.handle, 'x-');
});

test('dragging a right-angled handle offers the two directions facing the neighbour', () => {
	assert.deepEqual(routeDirectionFacingList({ x: 0, y: 0 }, { x: 10, y: -30 }), ['y-', 'x+']);
	assert.deepEqual(routeDirectionFacingList({ x: 0, y: 0 }, { x: 10, y: 0 }), ['x+']);
	assert.deepEqual(routeDirectionFacingList({ x: 0, y: 0 }, { x: 0, y: 0 }), []);
	assert.equal(routeHandleDirectionListGet({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 5, y: 50 })[0], 'y+');
	assert.equal(routeHandleDirectionListGet({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 5 })[0], 'x+');
	assert.deepEqual([...routeHandleDirectionListGet({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: -50, y: -5 })].sort(), ['x+', 'y+']);
	assert.equal(routeHandleDirectionListGet({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 5, y: 50 })[0], 'y+');
});

test('a curve keeps its shape when an anchor is inserted on it', () => {
	const route = { anchorList: [{ id: 'a1', along: 0.5, x: 0, y: 0, handleIn: { x: -60, y: 0 }, handleOut: { x: 60, y: 0 } }] };
	const before = routeResolve('bezier', route, ends);
	const { route: next, anchorId } = routeAnchorInsertAt('bezier', route, ends, { x: 220, y: 120 });
	assert.equal(anchorId, 'a2');
	assert.deepEqual(next.anchorList.map((anchor) => anchor.id), ['a1', 'a2']);
	const after = routeResolve('bezier', next, ends);
	const sample = (piece, t) => {
		const mt = 1 - t;
		const of = (axis) => mt ** 3 * piece.p0[axis] + 3 * mt * mt * t * piece.c1[axis] + 3 * mt * t * t * piece.c2[axis] + t ** 3 * piece.p1[axis];
		return { x: of('x'), y: of('y') };
	};
	const inserted = after.anchorList[1];
	const onOriginal = [...Array(200).keys()].map((index) => sample(before.pieceList[1], index / 199));
	const distanceToOriginal = (point) => Math.min(...onOriginal.map((other) => Math.hypot(other.x - point.x, other.y - point.y)));
	assert.ok(distanceToOriginal(inserted) < 2);
	assert.ok(distanceToOriginal(sample(after.pieceList[1], 0.5)) < 2.5);
	assert.ok(distanceToOriginal(sample(after.pieceList[2], 0.5)) < 8, 'the end keeps a default control, close at this split');
});

test('a right-angled line keeps its shape when an anchor is added on it', () => {
	const samePoints = (route) => routeResolve('smoothstep', route, ends).pointList.map((point) => ({ x: Math.round(point.x * 100) / 100 + 0, y: Math.round(point.y * 100) / 100 + 0 }));
	const before = samePoints(null);
	assert.deepEqual(before, [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 200 }, { x: 300, y: 200 }]);
	for (const point of [{ x: 150, y: 90 }, { x: 40, y: 0 }, { x: 260, y: 200 }]) {
		const { route, anchorId } = routeAnchorInsertAt('smoothstep', null, ends, point);
		assert.deepEqual(samePoints(route), before, `at ${JSON.stringify(point)}`);
		assert.equal(new Set(route.anchorList.map((anchor) => anchor.id)).size, route.anchorList.length);
		assert.ok(route.anchorList.some((anchor) => anchor.id === anchorId));
	}
	assert.equal(routeAnchorInsertAt('smoothstep', null, ends, { x: 150, y: 90 }).route.anchorList.length, 1, 'on the middle run, no corner is needed');
	const moved = routeAnchorInsertAt('smoothstep', { anchorList: [{ id: 'a1', along: 0.5, x: 40, y: 0 }] }, ends, { x: 30, y: 0 });
	assert.equal(moved.anchorId, 'a2');
	assert.deepEqual(samePoints(moved.route), samePoints({ anchorList: [{ id: 'a1', along: 0.5, x: 40, y: 0 }] }));
});

test('a coupled handle takes the other along, keeping its length; decoupled it moves alone', () => {
	const route = { anchorList: [{ id: 'a', along: 0.5, x: 0, y: 0, handleIn: { x: -30, y: 0 }, handleOut: { x: 60, y: 0 } }] };
	const coupled = routeAnchorHandleSet('bezier', route, 'a', 'out', { x: 0, y: 50 }).anchorList[0];
	assert.deepEqual(coupled.handleOut, { x: 0, y: 50 });
	assert.deepEqual(coupled.handleIn, { x: -0, y: -30 });
	const free = routeAnchorHandleSet('bezier', route, 'a', 'out', { x: 0, y: 50 }, { isDecouple: true }).anchorList[0];
	assert.equal(free.isCoupled, false);
	assert.deepEqual(free.handleIn, { x: -30, y: 0 });
	const recoupled = routeAnchorCoupleSet('bezier', { anchorList: [free] }, 'a', true).anchorList[0];
	assert.equal(recoupled.isCoupled, undefined);
	assert.deepEqual(recoupled.handleOut, { x: 0, y: 50 });
	assert.deepEqual(recoupled.handleIn, { x: -0, y: -30 });
	assert.throws(() => routeAnchorCoupleSet('step', route, 'a', true), /no coupling/);
});

test('a curve without handles at an anchor arrives straight; an end without a handle leaves along its side', () => {
	const resolved = routeResolve('bezier', { anchorList: [{ id: 'a', along: 0.5, x: 0, y: 0 }] }, ends);
	assert.deepEqual(resolved.pieceList[0].c2, resolved.pieceList[0].p1);
	assert.equal(resolved.pieceList[0].c1.y, 0);
	assert.ok(resolved.pieceList[0].c1.x > 0);
	assert.equal(resolved.pieceList[1].c2.y, 200);
	assert.ok(resolved.pieceList[1].c2.x < 300);
});

test('overlap: lines lying on each other are found, a shared end and a crossing are not', () => {
	const run = (d) => routePathRunListGet(d);
	assert.deepEqual(run('M 0 0 L 10 0 Q 15 0 15 5 L 15 20'), [{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }, { from: { x: 15, y: 5 }, to: { x: 15, y: 20 } }]);
	assert.deepEqual(run('M0,0 C 1,1 2,2 3,3'), []);
	const list = routeOverlapListGet([
		{ id: 'a', d: 'M 0 50 L 100 50', sourceKey: 's1', targetKey: 't1' },
		{ id: 'b', d: 'M 40 50 L 200 50', sourceKey: 's2', targetKey: 't2' },
		{ id: 'c', d: 'M 50 0 L 50 100', sourceKey: 's3', targetKey: 't3' },
		{ id: 'd', d: 'M 0 50 L 30 50', sourceKey: 's1', targetKey: 't4' },
		{ id: 'e', d: 'M 500 50 L 700 50', sourceKey: 's5', targetKey: 't5' },
	]);
	assert.deepEqual(list, [{ a: 'a', b: 'b', length: 60, kind: 'stretch' }]);
});

test('overlap: a straight stretch is one run however many pieces draw it', () => {
	assert.deepEqual(routePathRunListGet('M 0 0 L 20 0 L 50 0 Q 60 0 60 10 L 60 100'), [{ from: { x: 0, y: 0 }, to: { x: 50, y: 0 } }, { from: { x: 60, y: 10 }, to: { x: 60, y: 100 } }]);
	// going back along itself is not one run
	assert.equal(routePathRunListGet('M 0 0 L 50 0 L 20 0').length, 2);
});

test('overlap: lines at one place may share the final run into it, and only that', () => {
	const pairOf = (dA, dB, keysB = { sourceKey: 's2', targetKey: 't' }) => routeOverlapListGet([{ id: 'a', d: dA, sourceKey: 's1', targetKey: 't' }, { id: 'b', d: dB, ...keysB }]);
	// each down its own lane, together on the way into the place
	assert.deepEqual(pairOf('M 0 0 L 50 0 L 50 100 L 200 100', 'M 0 200 L 80 200 L 80 100 L 200 100'), []);
	// together down a lane as well: a trunk, which is not allowed
	assert.deepEqual(pairOf('M 0 0 L 50 0 L 50 100 L 200 100', 'M 0 50 L 50 50 L 50 100 L 200 100'), [{ a: 'a', b: 'b', length: 50, kind: 'stretch' }]);
	// the run into the place is exempt only for what shares that place
	assert.equal(pairOf('M 0 0 L 50 0 L 50 100 L 200 100', 'M 0 200 L 80 200 L 80 100 L 200 100', { sourceKey: 's2', targetKey: 't2' })[0].length, 120);
	// a line leaving the place another arrives at shares that place
	assert.deepEqual(pairOf('M 0 0 L 50 0 L 50 100 L 200 100', 'M 200 100 L 80 100 L 80 300', { sourceKey: 't', targetKey: 't2' }), []);
	// a line ending in a curve has no final run to share
	assert.equal(pairOf('M 0 0 L 100 0 C 120 0 120 50 200 50', 'M 0 0 L 100 0 C 120 0 120 80 200 80', { sourceKey: 's2', targetKey: 't' })[0].kind, 'stretch');
	// curves are not looked at
	assert.deepEqual(pairOf('M 0 0 C 10 10 20 20 30 30', 'M 0 0 C 10 10 20 20 30 30', { sourceKey: 's1', targetKey: 't' }), []);
});

test('overlap: lines between the same two places keep some of their way apart', () => {
	const pairOf = (dA, dB, keysB = { sourceKey: 's', targetKey: 't' }) => routeOverlapListGet([{ id: 'a', d: dA, sourceKey: 's', targetKey: 't' }, { id: 'b', d: dB, ...keysB }]);
	// one on the other, drawn with nothing but final runs
	assert.deepEqual(pairOf('M 0 0 L 200 0', 'M 0 0 L 200 0'), [{ a: 'a', b: 'b', length: 200, kind: 'whole' }]);
	assert.deepEqual(pairOf('M 0 0 L 100 0 L 100 100', 'M 0 0 L 100 0 L 100 100'), [{ a: 'a', b: 'b', length: 200, kind: 'whole' }]);
	// one on the other, through a middle
	assert.equal(pairOf('M 0 0 L 50 0 L 50 100 L 200 100', 'M 0 0 L 50 0 L 50 100 L 200 100')[0].kind, 'stretch');
	// the way back over the way there
	assert.equal(pairOf('M 0 0 L 200 0', 'M 200 0 L 0 0', { sourceKey: 't', targetKey: 's' })[0].kind, 'whole');
	// apart in the middle: together only at the two ends
	assert.deepEqual(pairOf('M 0 0 L 50 0 L 50 100 L 200 100', 'M 0 0 L 80 0 L 80 100 L 200 100'), []);
	// a straight one and one going around it
	assert.deepEqual(pairOf('M 0 0 L 200 0', 'M 0 0 L 50 0 L 50 50 L 150 50 L 150 0 L 200 0'), []);
	// curves are not looked at
	assert.deepEqual(pairOf('M 0 0 C 10 10 20 20 30 30', 'M 0 0 C 10 10 20 20 30 30'), []);
});

// ---------- the commands of the editor ----------

const line = { id: 'l', source: { nodeId: 'a', handleId: 'o' }, target: { nodeId: 'b', handleId: 'i' } };
const sourceOf = (lineExtra = {}) => JSON.stringify({ version: 1, nodes: [
	{ id: 'a', renderer: { type: 'table' }, position: { x: 0, y: 0 }, data: { name: 'A', fields: [{ id: 'f', label: 'F' }], rows: [] }, handles: [{ id: 'o', direction: 'out', anchor: { side: 'right' } }] },
	{ id: 'b', renderer: { type: 'table' }, position: { x: 400, y: 0 }, data: { name: 'B', fields: [{ id: 'f', label: 'F' }], rows: [] }, handles: [{ id: 'i', direction: 'in', anchor: { side: 'left' } }] },
], connections: [{ ...line, ...lineExtra }] });
const storeOf = (lineExtra) => new DiagramEditStore(sourceOf(lineExtra), 'diagram', undefined, cardDiagramNodeRegistry);

test('anchors are added, moved and removed as steps of the history', () => {
	const store = storeOf();
	const before = store.valueCurrent;
	const anchorId = store.connectionAnchorAdd('l', { point: { x: 150, y: 100 }, ends });
	assert.equal(anchorId, 'a1');
	assert.equal(store.selection.anchorId, 'a1');
	const added = store.valueCurrent;
	assert.ok(store.connectionAnchorMove('l', 'a1', { point: { x: 180, y: 100 }, ends }));
	assert.equal(store.connectionRouteGet('l').anchorList[0].along < 1, true);
	store.undo();
	assert.equal(store.valueCurrent, added);
	store.redo();
	assert.notEqual(store.valueCurrent, added);
	assert.ok(store.connectionAnchorRemove('l', 'a1'));
	assert.equal(store.connectionRouteGet('l'), null);
	assert.equal(store.selection.anchorId, undefined);
	assert.equal(store.selection.connectionId, 'l');
	store.undo();
	store.undo();
	store.undo();
	assert.equal(store.valueCurrent, before);
	assert.equal(store.history.isUndoAvailable, false);
});

test('a line type without anchors refuses, saying why, and changes nothing', () => {
	const store = storeOf({ renderer: { type: 'straight' } });
	const before = store.valueCurrent;
	assert.equal(store.connectionAnchorAdd('l', { along: 0.5, x: 0, y: 0 }), null);
	assert.match(store.message, /straight line has no anchors/);
	assert.equal(store.valueCurrent, before);
	assert.equal(store.history.isUndoAvailable, false);
});

test('a dragged route is one step at the drop; a refused one changes nothing', () => {
	const store = storeOf();
	store.connectionAnchorAdd('l', { along: 0.5, x: 0, y: 40 });
	const before = store.valueCurrent;
	store.routeDraftSet('l', { anchorList: [{ id: 'a1', along: 0.5, x: 0, y: 80 }] });
	assert.equal(store.valueCurrent, before, 'the draft is not touched while dragging');
	store.routeDraftSet('l', { anchorList: [{ id: 'a1', along: 0.5, x: 0, y: 90 }] });
	assert.ok(store.routeDraftCommit());
	assert.equal(store.routeDraft, null);
	assert.equal(store.connectionRouteGet('l').anchorList[0].y, 90);
	store.undo();
	assert.equal(store.valueCurrent, before);
	assert.equal(store.connectionAnchorHandleSet('l', 'a1', 'out', 'nowhere'), false);
	assert.match(store.message, /right-angled/);
	assert.equal(store.valueCurrent, before);
});

test('a route is kept within its family of line types and not across, an undo brings it back', () => {
	const store = storeOf();
	store.connectionAnchorAdd('l', { along: 0.5, x: 0, y: 40 });
	assert.ok(store.connectionSet('l', 'lineType', 'step'));
	assert.equal(store.connectionRouteGet('l').anchorList.length, 1);
	const kept = store.valueCurrent;
	assert.ok(store.connectionSet('l', 'lineType', 'bezier'));
	assert.equal(store.connectionRouteGet('l'), null);
	assert.ok(store.connectionSet('l', 'lineType', 'straight'));
	store.undo();
	store.undo();
	assert.equal(store.valueCurrent, kept);
});

test('the handles of ends and anchors go through the store, and reset', () => {
	const store = storeOf({ renderer: { type: 'bezier' } });
	assert.ok(store.connectionEndHandleSet('l', 'source', { x: 80, y: -40 }));
	assert.deepEqual(store.connectionRouteGet('l').source, { handle: { x: 80, y: -40 } });
	store.connectionAnchorAdd('l', { along: 0.5, x: 0, y: 0, handleIn: { x: -20, y: 0 }, handleOut: { x: 20, y: 0 } });
	assert.ok(store.connectionAnchorCoupleSet('l', 'a1', false));
	assert.ok(store.connectionAnchorHandleSet('l', 'a1', 'in', { x: -10, y: -10 }));
	assert.deepEqual(store.connectionRouteGet('l').anchorList[0].handleOut, { x: 20, y: 0 });
	assert.ok(store.connectionAnchorHandlesPull('l', 'a1', ends));
	assert.equal(store.connectionRouteGet('l').anchorList[0].isCoupled, undefined);
	assert.ok(store.connectionRouteSet('l', null));
	assert.equal(store.connectionGet('l').route, undefined);
});

test('the path reaches the anchors of a line, by itself and through a card; what is gone goes up', () => {
	const store = storeOf();
	store.connectionAnchorAdd('l', { along: 0.5, x: 0, y: 40 });
	const atLine = pathResolve(pathParse('connection(id=l) > anchors > anchor(id=a1)'), store);
	assert.equal(atLine.display.anchorId, 'a1');
	assert.equal(atLine.display.tab, 'line');
	const list = pathResolve(pathParse('connection(id=l) > anchors'), store);
	assert.equal(list.display.view, 'list');
	assert.equal(list.display.isAnchors, true);
	const fromCard = pathResolve(pathParse('node(id=a) > lines > line(id=l) > anchors > index=0'), store);
	assert.equal(fromCard.display.anchorId, 'a1');
	assert.equal(fromCard.display.nodeId, 'a');
	assert.equal(fromCard.path.at(-1).id, 'a1');
	store.anchorSelect('l', 'a1');
	store.connectionAnchorRemove('l', 'a1');
	assert.equal(store.selection.anchorId, undefined);
	assert.deepEqual(store.path, [{ kind: 'connection', id: 'l' }]);
	const gone = pathResolve(pathParse('connection(id=l) > anchors > anchor(id=zz)'), store);
	assert.deepEqual(gone.path, [{ kind: 'connection', id: 'l' }, { kind: 'anchors' }]);
});
