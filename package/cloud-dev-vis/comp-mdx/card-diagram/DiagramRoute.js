// The route of a connection line (card-diagram-connection-line.md): the anchor
// points a line passes through and the handles at them, as data, and the path
// that follows from them. Pure: no React, no React Flow, no store, so the editor,
// the canvas, the static views and a generator of views use one implementation.
//
//   route       { anchorList?, source?: { handle }, target?: { handle } }
//   anchor      { id, along, x, y, handleIn?, handleOut?, isCoupled? }
//   ends        { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
//                 isSourceFree?, isTargetFree? }
//
// An anchor is kept relative to the two ends, so that it moves with them:
//
//   place = source + along * (target - source) + (x, y)
//
// Both ends translated by one vector translate the line as it is. One end moved by
// d moves each anchor by its share of d (along for the target, 1 - along for the
// source); its handles keep their vectors. Nothing rotates and nothing scales.
//
// The family of the line type says what a handle is:
//
//   right-angled (smoothstep, step)  one of four directions, 'x+' 'x-' 'y+' 'y-', or
//                                    absent (auto: the direction giving the fewest bends)
//   bezier                           a vector { x, y } from the anchor, or absent (none)
//
// A handle points where the line runs on that side: handleIn back to where the line
// came from, handleOut on to where it goes.

export const ROUTE_ANCHOR_TYPE_LIST = ['smoothstep', 'step', 'bezier'];
export const ROUTE_DIRECTION_LIST = ['x+', 'x-', 'y+', 'y-'];
export const ROUTE_SIDE_LIST = ['in', 'out'];
export const ROUTE_ROLE_LIST = ['source', 'target'];

const EPSILON = 0.5;
const STUB = 20;
const CORNER_RADIUS_SMOOTH = 5;
const CURVATURE = 0.25;
const SAMPLE_COUNT = 32;
const DIRECTION_BY_SIDE = { left: 'x-', right: 'x+', top: 'y-', bottom: 'y+' };
const VECTOR_BY_DIRECTION = { 'x+': { x: 1, y: 0 }, 'x-': { x: -1, y: 0 }, 'y+': { x: 0, y: 1 }, 'y-': { x: 0, y: -1 } };
const OPPOSITE_BY_DIRECTION = { 'x+': 'x-', 'x-': 'x+', 'y+': 'y-', 'y-': 'y+' };

export const routeTypeHasAnchors = (type) => ROUTE_ANCHOR_TYPE_LIST.includes(type);
export const routeTypeIsBezier = (type) => type === 'bezier';
export const routeTypeIsRightAngle = (type) => type === 'smoothstep' || type === 'step';
// the line types that can keep one route: only the corners of a right-angled line differ
export const routeTypeFamilyGet = (type) => (routeTypeIsBezier(type) ? 'bezier' : routeTypeIsRightAngle(type) ? 'rightAngle' : '');
export const routeIsEmpty = (route) => !route || (!route.anchorList?.length && route.source?.handle === undefined && route.target?.handle === undefined);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isMapping = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// ---------- reading and validating ----------

function handleRead(value, type, field) {
	if (value === undefined || value === null || value === 'auto') return undefined;
	if (routeTypeIsBezier(type)) {
		if (!isMapping(value) || !finite(value.x) || !finite(value.y)) throw new Error(`${field}: a handle of a curve is a vector { x, y }.`);
		return { x: value.x, y: value.y };
	}
	if (!ROUTE_DIRECTION_LIST.includes(value)) throw new Error(`${field}: a handle of a right-angled line is one of ${ROUTE_DIRECTION_LIST.join(', ')}, or auto.`);
	return value;
}

// the route as a line of this type keeps it: validated, the anchors with ids and
// defaults, what says nothing left out. a message names the place of what is wrong
export function routeNormalize(value, type, field = 'route') {
	if (value === undefined || value === null) return null;
	if (!isMapping(value)) throw new Error(`${field} must be a mapping.`);
	const unknown = Object.keys(value).find((key) => !['anchorList', 'source', 'target'].includes(key));
	if (unknown) throw new Error(`${field}: unknown key "${unknown}" (a line of type ${type} keeps anchorList, source and target).`);
	const idSet = new Set();
	const anchorList = (value.anchorList ?? []).map((anchor, index) => {
		const place = `${field}.anchorList[${index}]`;
		if (!isMapping(anchor)) throw new Error(`${place} must be a mapping.`);
		const id = anchor.id === undefined ? `a${index + 1}` : String(anchor.id);
		if (idSet.has(id)) throw new Error(`${place}: duplicate id "${id}".`);
		idSet.add(id);
		const along = anchor.along ?? 0.5;
		if (!finite(along) || along < 0 || along > 1) throw new Error(`${place}.along must be between 0 and 1.`);
		const x = anchor.x ?? 0;
		const y = anchor.y ?? 0;
		if (!finite(x) || !finite(y)) throw new Error(`${place}: x and y must be numbers.`);
		const handleIn = handleRead(anchor.handleIn, type, `${place}.handleIn`);
		const handleOut = handleRead(anchor.handleOut, type, `${place}.handleOut`);
		if (anchor.isCoupled !== undefined && typeof anchor.isCoupled !== 'boolean') throw new Error(`${place}.isCoupled must be boolean.`);
		return { id, along, x, y, ...(handleIn !== undefined ? { handleIn } : {}), ...(handleOut !== undefined ? { handleOut } : {}), ...(anchor.isCoupled === false ? { isCoupled: false } : {}) };
	});
	const result = {};
	if (anchorList.length) result.anchorList = anchorList;
	for (const role of ROUTE_ROLE_LIST) {
		if (value[role] === undefined || value[role] === null) continue;
		if (!isMapping(value[role])) throw new Error(`${field}.${role} must be a mapping.`);
		const handle = handleRead(value[role].handle, type, `${field}.${role}.handle`);
		if (handle !== undefined) result[role] = { handle };
	}
	return Object.keys(result).length ? result : null;
}

// ---------- where things are ----------

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const length = (a) => Math.hypot(a.x, a.y);
const isSamePoint = (a, b) => Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
const roundOffset = (value) => Math.round(value * 100) / 100;

export const routeEndPointGet = (ends, role) => (role === 'source' ? { x: ends.sourceX, y: ends.sourceY } : { x: ends.targetX, y: ends.targetY });

export function routeAnchorPointGet(anchor, ends) {
	const place = lerp(routeEndPointGet(ends, 'source'), routeEndPointGet(ends, 'target'), anchor.along);
	return { x: place.x + anchor.x, y: place.y + anchor.y };
}

// a point of the canvas as an anchor keeps it: its share along the chord of the two
// ends (the projection, within the ends), and the offset from there. the share may
// be named instead, to say which end the anchor follows
export function routeAnchorPlaceOf(point, ends, alongFixed) {
	const source = routeEndPointGet(ends, 'source');
	const target = routeEndPointGet(ends, 'target');
	const chord = sub(target, source);
	const chordSquare = dot(chord, chord);
	const along = alongFixed ?? (chordSquare < 1 ? 0.5 : Math.max(0, Math.min(1, dot(sub(point, source), chord) / chordSquare)));
	const alongRounded = Math.round(along * 1000) / 1000;
	const place = lerp(source, target, alongRounded);
	return { along: alongRounded, x: roundOffset(point.x - place.x), y: roundOffset(point.y - place.y) };
}

function endDirectionDefault(ends, role) {
	const isFree = role === 'source' ? ends.isSourceFree : ends.isTargetFree;
	if (isFree) return undefined;
	return DIRECTION_BY_SIDE[role === 'source' ? ends.sourcePosition : ends.targetPosition];
}

// ---------- right-angled lines ----------

// the directions from a point facing another: one on a shared axis, two otherwise,
// the longer way first. none for one place
export function routeDirectionFacingList(from, to) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const list = [];
	if (Math.abs(dx) >= EPSILON) list.push({ direction: dx > 0 ? 'x+' : 'x-', size: Math.abs(dx) });
	if (Math.abs(dy) >= EPSILON) list.push({ direction: dy > 0 ? 'y+' : 'y-', size: Math.abs(dy) });
	return list.sort((a, b) => b.size - a.size).map((item) => item.direction);
}

// the polyline from A leaving along a to B arriving from the direction b: as few
// bends as these directions allow, with a short stub where a direction points away
function segmentPointListGet(A, a, B, b) {
	if (isSamePoint(A, B)) return [A, B];
	const va = VECTOR_BY_DIRECTION[a];
	const vb = VECTOR_BY_DIRECTION[b];
	const isHorizontalA = va.x !== 0;
	const isHorizontalB = vb.x !== 0;
	const stubA = add(A, scale(va, STUB));
	const stubB = add(B, scale(vb, STUB));
	if (isHorizontalA === isHorizontalB) {
		if (a === OPPOSITE_BY_DIRECTION[b]) {
			const gap = dot(sub(B, A), va);
			const cross = isHorizontalA ? B.y - A.y : B.x - A.x;
			if (gap >= -EPSILON) {
				if (Math.abs(cross) < EPSILON) return [A, B];
				const middle = lerp(A, B, 0.5);
				return isHorizontalA
					? [A, { x: middle.x, y: A.y }, { x: middle.x, y: B.y }, B]
					: [A, { x: A.x, y: middle.y }, { x: B.x, y: middle.y }, B];
			}
			const middle = lerp(A, B, 0.5);
			return isHorizontalA
				? [A, stubA, { x: stubA.x, y: middle.y }, { x: stubB.x, y: middle.y }, stubB, B]
				: [A, stubA, { x: middle.x, y: stubA.y }, { x: middle.x, y: stubB.y }, stubB, B];
		}
		// both the same way: out past the farther one and back
		if (isHorizontalA) {
			const far = va.x > 0 ? Math.max(stubA.x, stubB.x) : Math.min(stubA.x, stubB.x);
			return [A, { x: far, y: A.y }, { x: far, y: B.y }, B];
		}
		const far = va.y > 0 ? Math.max(stubA.y, stubB.y) : Math.min(stubA.y, stubB.y);
		return [A, { x: A.x, y: far }, { x: B.x, y: far }, B];
	}
	const corner = isHorizontalA ? { x: B.x, y: A.y } : { x: A.x, y: B.y };
	if (dot(sub(corner, A), va) >= -EPSILON && dot(sub(corner, B), vb) >= -EPSILON) return [A, corner, B];
	return isHorizontalA
		? [A, stubA, { x: stubA.x, y: stubB.y }, stubB, B]
		: [A, stubA, { x: stubB.x, y: stubA.y }, stubB, B];
}

// the points that make a difference: no repeated point, no point on a straight run
function pointListSimplify(pointList) {
	const result = [];
	for (const point of pointList) {
		const last = result[result.length - 1];
		if (last && isSamePoint(last, point)) continue;
		const before = result[result.length - 2];
		if (last && before && ((Math.abs(before.x - last.x) < EPSILON && Math.abs(last.x - point.x) < EPSILON) || (Math.abs(before.y - last.y) < EPSILON && Math.abs(last.y - point.y) < EPSILON))
			&& dot(sub(last, before), sub(point, last)) >= 0) {
			result[result.length - 1] = point;
			continue;
		}
		result.push(point);
	}
	return result;
}

// a bend within a segment counts a little more than a corner at an anchor: when both give
// the same number, the line turns at the anchor, so an anchor says where the line runs
const SEGMENT_BEND_COST = 1.01;
const bendCost = (pointList) => Math.max(0, pointListSimplify(pointList).length - 2) * SEGMENT_BEND_COST;

function anchorCostGet(directionIn, directionOut) {
	if (directionOut === OPPOSITE_BY_DIRECTION[directionIn]) return 0;
	return directionOut === directionIn ? 2 : 1;
}

// what an auto handle may become: the directions facing its neighbour, or any of
// the four when there is no telling (the neighbour is at the same place)
function candidateListGet(value, from, to) {
	if (value !== undefined) return [value];
	const facing = routeDirectionFacingList(from, to);
	return facing.length ? facing : ROUTE_DIRECTION_LIST;
}

// the handles of the whole line resolved: a handle that is set is kept, an auto one
// takes the direction that gives the line the fewest bends, the whole line considered
// (each segment by its bends, each anchor 0 straight through, 1 a corner, 2 a hairpin).
// equal costs keep the longer way, so the answer is one and the same for one geometry
function rightAngleResolve(route, ends) {
	const anchorList = route?.anchorList ?? [];
	const source = routeEndPointGet(ends, 'source');
	const target = routeEndPointGet(ends, 'target');
	const pointList = [source, ...anchorList.map((anchor) => routeAnchorPointGet(anchor, ends)), target];
	const sourceSet = route?.source?.handle;
	const targetSet = route?.target?.handle;
	let stateList = candidateListGet(sourceSet ?? endDirectionDefault(ends, 'source'), source, pointList[1]).map((direction) => ({ out: direction, cost: 0, trail: [] }));
	for (let index = 1; index < pointList.length; index += 1) {
		const anchor = anchorList[index - 1];
		const point = pointList[index];
		const inList = index === pointList.length - 1
			? candidateListGet(targetSet ?? endDirectionDefault(ends, 'target'), target, pointList[index - 1])
			: candidateListGet(anchor.handleIn, point, pointList[index - 1]);
		const outList = index === pointList.length - 1 ? [null] : candidateListGet(anchor.handleOut, point, pointList[index + 1]);
		const stateNext = [];
		for (const directionOut of outList) {
			let best = null;
			for (const state of stateList) {
				for (const directionIn of inList) {
					const cost = state.cost + bendCost(segmentPointListGet(pointList[index - 1], state.out, point, directionIn)) + (directionOut ? anchorCostGet(directionIn, directionOut) : 0);
					if (!best || cost < best.cost) best = { out: directionOut, cost, trail: [...state.trail, { out: state.out, in: directionIn }] };
				}
			}
			stateNext.push(best);
		}
		stateList = stateNext;
	}
	const { trail } = stateList.reduce((a, b) => (b.cost < a.cost ? b : a));
	const segmentList = trail.map((step, index) => segmentPointListGet(pointList[index], step.out, pointList[index + 1], step.in));
	return {
		segmentList,
		pointList: pointListSimplify(segmentList.flat()),
		source: { ...source, handle: trail[0].out, isSet: sourceSet !== undefined },
		target: { ...target, handle: trail[trail.length - 1].in, isSet: targetSet !== undefined },
		anchorList: anchorList.map((anchor, index) => ({
			id: anchor.id, ...pointList[index + 1],
			handleIn: trail[index].in, handleOut: trail[index + 1].out,
			isInSet: anchor.handleIn !== undefined, isOutSet: anchor.handleOut !== undefined,
		})),
	};
}

// a polyline as a path, its corners rounded by a radius (0: sharp)
export function routePointListPathGet(pointList, radius = 0) {
	if (pointList.length < 2) return '';
	let d = `M ${pointList[0].x} ${pointList[0].y}`;
	for (let index = 1; index < pointList.length - 1; index += 1) {
		const before = pointList[index - 1];
		const point = pointList[index];
		const after = pointList[index + 1];
		const size = Math.min(radius, length(sub(point, before)) / 2, length(sub(after, point)) / 2);
		if (size <= 0) {
			d += ` L ${point.x} ${point.y}`;
			continue;
		}
		const from = add(point, scale(sub(before, point), size / length(sub(before, point))));
		const to = add(point, scale(sub(after, point), size / length(sub(after, point))));
		d += ` L ${from.x} ${from.y} Q ${point.x} ${point.y} ${to.x} ${to.y}`;
	}
	const last = pointList[pointList.length - 1];
	return `${d} L ${last.x} ${last.y}`;
}

// ---------- curves ----------

// the length of the control of an end without a handle: what a curve without
// anchors uses (React Flow's getBezierPath), so a route starts from the curve it replaces
function controlOffsetGet(distance) {
	return distance >= 0 ? 0.5 * distance : CURVATURE * 25 * Math.sqrt(-distance);
}

function endControlDefault(ends, role, toward) {
	const point = routeEndPointGet(ends, role);
	switch (endDirectionDefault(ends, role)) {
		case 'x-': return { x: point.x - controlOffsetGet(point.x - toward.x), y: point.y };
		case 'x+': return { x: point.x + controlOffsetGet(toward.x - point.x), y: point.y };
		case 'y-': return { x: point.x, y: point.y - controlOffsetGet(point.y - toward.y) };
		case 'y+': return { x: point.x, y: point.y + controlOffsetGet(toward.y - point.y) };
		default: return point;
	}
}

// the cubic pieces of a curve: one per gap between two consecutive points of the
// line. a side with no handle has its control at the anchor (the curve arrives straight)
function bezierResolve(route, ends) {
	const anchorList = route?.anchorList ?? [];
	const source = routeEndPointGet(ends, 'source');
	const target = routeEndPointGet(ends, 'target');
	const anchorPointList = anchorList.map((anchor) => routeAnchorPointGet(anchor, ends));
	const pointList = [source, ...anchorPointList, target];
	const sourceHandle = route?.source?.handle;
	const targetHandle = route?.target?.handle;
	const controlSource = sourceHandle ? add(source, sourceHandle) : endControlDefault(ends, 'source', pointList[1]);
	const controlTarget = targetHandle ? add(target, targetHandle) : endControlDefault(ends, 'target', pointList[pointList.length - 2]);
	const pieceList = [];
	for (let index = 0; index < pointList.length - 1; index += 1) {
		const from = anchorList[index - 1];
		const to = anchorList[index];
		pieceList.push({
			p0: pointList[index],
			c1: index === 0 ? controlSource : from.handleOut ? add(pointList[index], from.handleOut) : pointList[index],
			c2: index === pointList.length - 2 ? controlTarget : to.handleIn ? add(pointList[index + 1], to.handleIn) : pointList[index + 1],
			p1: pointList[index + 1],
		});
	}
	return {
		pieceList,
		source: { ...source, control: controlSource, isSet: sourceHandle !== undefined },
		target: { ...target, control: controlTarget, isSet: targetHandle !== undefined },
		anchorList: anchorList.map((anchor, index) => ({
			id: anchor.id, ...anchorPointList[index],
			handleIn: anchor.handleIn ?? null, handleOut: anchor.handleOut ?? null,
			isInSet: anchor.handleIn !== undefined, isOutSet: anchor.handleOut !== undefined,
			isCoupled: anchor.isCoupled !== false,
			// the way the curve runs through the anchor when it has no handles: where one pulled out starts
			tangent: tangentGet(pointList[index], pointList[index + 2]),
		})),
	};
}

function tangentGet(from, to) {
	const chord = sub(to, from);
	const size = length(chord);
	return size < EPSILON ? { x: 1, y: 0 } : scale(chord, 1 / size);
}

export function routeBezierPathGet(pieceList) {
	if (!pieceList.length) return '';
	return `M ${pieceList[0].p0.x} ${pieceList[0].p0.y} ${pieceList.map((piece) => `C ${piece.c1.x} ${piece.c1.y} ${piece.c2.x} ${piece.c2.y} ${piece.p1.x} ${piece.p1.y}`).join(' ')}`;
}

function pieceSplit(piece, t) {
	const a = lerp(piece.p0, piece.c1, t);
	const b = lerp(piece.c1, piece.c2, t);
	const c = lerp(piece.c2, piece.p1, t);
	const d = lerp(a, b, t);
	const e = lerp(b, c, t);
	const point = lerp(d, e, t);
	return { point, controlBefore: a, handleIn: sub(d, point), handleOut: sub(e, point), controlAfter: c };
}

const piecePointAt = (piece, t) => pieceSplit(piece, t).point;

// ---------- the line as a whole ----------

// everything the route of a line says for these ends: the path, and the points and
// handles the editor draws. line types without anchors have no route
export function routeResolve(type, route, ends) {
	if (routeTypeIsBezier(type)) {
		const resolved = bezierResolve(route, ends);
		return { ...resolved, type, d: routeBezierPathGet(resolved.pieceList) };
	}
	const resolved = rightAngleResolve(route, ends);
	return { ...resolved, type, d: routePointListPathGet(resolved.pointList, type === 'step' ? 0 : CORNER_RADIUS_SMOOTH) };
}

function pointNearestOnSegment(point, a, b) {
	const ab = sub(b, a);
	const square = dot(ab, ab);
	const t = square < 1e-6 ? 0 : Math.max(0, Math.min(1, dot(sub(point, a), ab) / square));
	const nearest = lerp(a, b, t);
	return { point: nearest, distance: length(sub(point, nearest)) };
}

// the gap of the line nearest to a point, and the place on it there:
// { gap, point, t } with t the parameter of a cubic piece of a curve
function lineNearestGet(resolved, point) {
	let best = { distance: Infinity };
	if (routeTypeIsBezier(resolved.type)) {
		resolved.pieceList.forEach((piece, gap) => {
			for (let step = 1; step < SAMPLE_COUNT; step += 1) {
				const t = step / SAMPLE_COUNT;
				const onLine = piecePointAt(piece, t);
				const distance = length(sub(point, onLine));
				if (distance < best.distance) best = { gap, t, point: onLine, distance };
			}
		});
		return best;
	}
	resolved.segmentList.forEach((pointList, gap) => {
		for (let index = 0; index < pointList.length - 1; index += 1) {
			const nearest = pointNearestOnSegment(point, pointList[index], pointList[index + 1]);
			if (nearest.distance < best.distance) best = { gap, point: nearest.point, distance: nearest.distance };
		}
	});
	return best;
}

export function routeAnchorIdNext(route) {
	const idSet = new Set((route?.anchorList ?? []).map((anchor) => anchor.id));
	let index = 1;
	while (idSet.has(`a${index}`)) index += 1;
	return `a${index}`;
}

function routeBase(route) {
	return { ...(route ?? {}), anchorList: [...(route?.anchorList ?? [])] };
}

function roundVector(vector) {
	return { x: roundOffset(vector.x), y: roundOffset(vector.y) };
}

// a right-angled line keeps its shape when an anchor is added on it. the segments it
// falls into are routed anew, each with a middle of its own, so where that would move a
// run, the corner next to the new anchor becomes an anchor too. the fewest that keep the shape
function rightAngleInsert(route, ends, resolved, nearest) {
	const pointListBefore = resolved.pointList;
	const isSame = (candidate) => {
		const after = routeResolve(resolved.type, candidate, ends).pointList;
		return after.length === pointListBefore.length && after.every((point, index) => isSamePoint(point, pointListBefore[index]));
	};
	const segment = pointListSimplify(resolved.segmentList[nearest.gap]);
	const runIndex = segment.findIndex((point, index) => index < segment.length - 1 && pointNearestOnSegment(nearest.point, point, segment[index + 1]).distance < EPSILON);
	const cornerBefore = runIndex > 0 ? segment[runIndex] : null;
	const cornerAfter = runIndex >= 0 && runIndex + 2 < segment.length ? segment[runIndex + 1] : null;
	const idMain = routeAnchorIdNext(route);
	const build = (isBefore, isAfter) => {
		const next = routeBase(route);
		const main = { id: idMain, ...routeAnchorPlaceOf(nearest.point, ends) };
		const anchorListNew = [];
		if (isBefore) anchorListNew.push({ point: cornerBefore });
		anchorListNew.push({ anchor: main });
		if (isAfter) anchorListNew.push({ point: cornerAfter });
		const list = anchorListNew.map((item) => item.anchor ?? { id: '', ...routeAnchorPlaceOf(item.point, ends) });
		next.anchorList.splice(nearest.gap, 0, ...list);
		// the corners take the next free ids
		for (const anchor of next.anchorList) if (anchor.id === '') anchor.id = routeAnchorIdNext({ anchorList: next.anchorList.filter((other) => other.id !== '') });
		return next;
	};
	const candidateList = [[false, false], ...(cornerBefore ? [[true, false]] : []), ...(cornerAfter ? [[false, true]] : []), ...(cornerBefore && cornerAfter ? [[true, true]] : [])];
	for (const [isBefore, isAfter] of candidateList) {
		const candidate = build(isBefore, isAfter);
		if (isSame(candidate)) return { route: candidate, anchorId: idMain };
	}
	return { route: build(false, false), anchorId: idMain };
}

// a new anchor where the line passes nearest to a point (the double-click on a line).
// the line keeps its shape: a curve is split there (the handles next to it shortened as
// the split asks; a default end keeps its default, which comes out the same at the
// middle); a right-angled line gains an anchor with auto handles on the run it was on.
// returns { route, anchorId }
export function routeAnchorInsertAt(type, route, ends, point) {
	const resolved = routeResolve(type, route, ends);
	const nearest = lineNearestGet(resolved, point);
	const next = routeBase(route);
	const id = routeAnchorIdNext(route);
	const place = routeAnchorPlaceOf(nearest.point, ends);
	if (!routeTypeIsBezier(type)) return rightAngleInsert(route, ends, resolved, nearest);
	const piece = resolved.pieceList[nearest.gap];
	const split = pieceSplit(piece, nearest.t);
	const before = next.anchorList[nearest.gap - 1];
	const after = next.anchorList[nearest.gap];
	if (before?.handleOut) next.anchorList[nearest.gap - 1] = { ...before, handleOut: roundVector(sub(split.controlBefore, piece.p0)) };
	if (nearest.gap === 0 && next.source?.handle) next.source = { handle: roundVector(sub(split.controlBefore, piece.p0)) };
	if (after?.handleIn) next.anchorList[nearest.gap] = { ...after, handleIn: roundVector(sub(split.controlAfter, piece.p1)) };
	if (nearest.gap === resolved.pieceList.length - 1 && next.target?.handle) next.target = { handle: roundVector(sub(split.controlAfter, piece.p1)) };
	next.anchorList.splice(nearest.gap, 0, { id, ...place, handleIn: roundVector(split.handleIn), handleOut: roundVector(split.handleOut) });
	return { route: next, anchorId: id };
}

// the place of an anchor changed: by a point of the canvas, or as { along, x, y }
export function routeAnchorMove(route, anchorId, placeNext) {
	const next = routeBase(route);
	const index = next.anchorList.findIndex((anchor) => anchor.id === anchorId);
	if (index < 0) throw new Error(`Unknown anchor "${anchorId}".`);
	next.anchorList[index] = { ...next.anchorList[index], ...placeNext };
	return next;
}

export function routeAnchorRemove(route, anchorId) {
	const next = routeBase(route);
	const index = next.anchorList.findIndex((anchor) => anchor.id === anchorId);
	if (index < 0) throw new Error(`Unknown anchor "${anchorId}".`);
	next.anchorList.splice(index, 1);
	return next;
}

// a handle of an anchor: a direction or auto (right-angled), a vector or none (curve,
// value null). on a curve the other handle of a coupled anchor turns to stay on one
// straight line, keeping its length; isDecouple breaks the coupling instead (Alt on a drag)
export function routeAnchorHandleSet(type, route, anchorId, side, value, { isDecouple = false } = {}) {
	if (!ROUTE_SIDE_LIST.includes(side)) throw new Error(`The side of a handle is in or out, not "${side}".`);
	const next = routeBase(route);
	const index = next.anchorList.findIndex((anchor) => anchor.id === anchorId);
	if (index < 0) throw new Error(`Unknown anchor "${anchorId}".`);
	const anchor = { ...next.anchorList[index] };
	const key = side === 'in' ? 'handleIn' : 'handleOut';
	const keyOther = side === 'in' ? 'handleOut' : 'handleIn';
	if (value === null || value === undefined || value === 'auto') delete anchor[key];
	else anchor[key] = routeTypeIsBezier(type) ? roundVector(value) : value;
	if (routeTypeIsBezier(type)) {
		if (isDecouple) anchor.isCoupled = false;
		else if (anchor.isCoupled !== false && anchor[key] && anchor[keyOther]) anchor[keyOther] = vectorOppositeOf(anchor[key], length(anchor[keyOther]));
	}
	next.anchorList[index] = anchor;
	return next;
}

function vectorOppositeOf(vector, size) {
	const own = length(vector);
	return own < 1e-6 ? { x: 0, y: 0 } : roundVector(scale(vector, -size / own));
}

// coupling on a curve: on one straight line (true, the in handle turns to the out
// handle, keeping its length; a side without a handle takes the length of the other),
// or free of each other (false). a right-angled anchor has no coupling
export function routeAnchorCoupleSet(type, route, anchorId, isCoupled) {
	if (!routeTypeIsBezier(type)) throw new Error('A right-angled line has no coupling: its handles are directions.');
	const next = routeBase(route);
	const index = next.anchorList.findIndex((anchor) => anchor.id === anchorId);
	if (index < 0) throw new Error(`Unknown anchor "${anchorId}".`);
	const anchor = { ...next.anchorList[index] };
	if (!isCoupled) anchor.isCoupled = false;
	else {
		delete anchor.isCoupled;
		if (anchor.handleOut) anchor.handleIn = vectorOppositeOf(anchor.handleOut, anchor.handleIn ? length(anchor.handleIn) : length(anchor.handleOut));
		else if (anchor.handleIn) anchor.handleOut = vectorOppositeOf(anchor.handleIn, length(anchor.handleIn));
	}
	next.anchorList[index] = anchor;
	return next;
}

// handles pulled out of an anchor of a curve: along the way the curve runs there,
// a third of the distance to each neighbour, coupled
export function routeAnchorHandlesPull(type, route, ends, anchorId) {
	if (!routeTypeIsBezier(type)) throw new Error('A right-angled anchor has its handles already: they are directions.');
	const resolved = routeResolve(type, route, ends);
	const index = (route?.anchorList ?? []).findIndex((anchor) => anchor.id === anchorId);
	if (index < 0) throw new Error(`Unknown anchor "${anchorId}".`);
	const piece = resolved.pieceList[index];
	const pieceNext = resolved.pieceList[index + 1];
	const { tangent } = resolved.anchorList[index];
	const next = routeBase(route);
	next.anchorList[index] = {
		...next.anchorList[index],
		handleIn: roundVector(scale(tangent, -length(sub(piece.p1, piece.p0)) / 3)),
		handleOut: roundVector(scale(tangent, length(sub(pieceNext.p1, pieceNext.p0)) / 3)),
	};
	delete next.anchorList[index].isCoupled;
	return next;
}

// the one-sided handle of an end: a direction or none (right-angled), a vector or none (curve)
export function routeEndHandleSet(type, route, role, value) {
	if (!ROUTE_ROLE_LIST.includes(role)) throw new Error(`An end is source or target, not "${role}".`);
	const next = routeBase(route);
	if (value === null || value === undefined || value === 'auto') delete next[role];
	else next[role] = { handle: routeTypeIsBezier(type) ? roundVector(value) : value };
	return next;
}

// the directions a dragged handle may take: the two facing its neighbour, the nearest
// to the pointer first. a neighbour straight along one axis has one facing direction;
// the perpendicular on the pointer's side stands in as the second
export function routeHandleDirectionListGet(from, neighbour, pointer) {
	const facing = routeDirectionFacingList(from, neighbour);
	const toward = pointer ? sub(pointer, from) : { x: 0, y: 0 };
	const list = facing.length === 2 ? facing : facing.length === 1
		? [facing[0], VECTOR_BY_DIRECTION[facing[0]].x !== 0 ? (toward.y >= 0 ? 'y+' : 'y-') : (toward.x >= 0 ? 'x+' : 'x-')]
		: ROUTE_DIRECTION_LIST;
	return [...list].sort((a, b) => dot(toward, VECTOR_BY_DIRECTION[b]) - dot(toward, VECTOR_BY_DIRECTION[a]));
}

export const routeDirectionVectorGet = (direction) => VECTOR_BY_DIRECTION[direction];

// the route, as it would be written: the empty parts dropped, null when nothing is left
export function routeCompact(route) {
	if (!route) return null;
	const { anchorList, source, target } = route;
	const result = {};
	if (anchorList?.length) result.anchorList = anchorList;
	if (source?.handle !== undefined) result.source = source;
	if (target?.handle !== undefined) result.target = target;
	return Object.keys(result).length ? result : null;
}

// ---------- overlap of lines ----------

// a path read for what lies on what: its straight axis-aligned runs, one run however many
// collinear pieces draw it (the helpers of React Flow draw a straight stretch in several),
// and where the path starts and ends. curves have no runs: the check leaves them to the
// eye. understands the commands the paths of this framework use (M, L, Q, C, with or
// without commas)
function pathRead(d) {
	const tokenList = String(d).match(/[MLQCmlqc]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
	const runList = [];
	let index = 0;
	let start = null;
	let current = null;
	let command = '';
	const numberNext = () => Number(tokenList[index++]);
	const runAdd = (from, to) => {
		const last = runList[runList.length - 1];
		if (last && isSamePoint(last.to, from) && runAxisOf(last) === runAxisOf({ from, to }) && (last.to.x - last.from.x) * (to.x - from.x) + (last.to.y - last.from.y) * (to.y - from.y) > 0) last.to = to;
		else runList.push({ from, to });
	};
	while (index < tokenList.length) {
		if (/^[A-Za-z]$/.test(tokenList[index])) command = tokenList[index++].toUpperCase();
		if (command === 'M') {
			current = { x: numberNext(), y: numberNext() };
			start ??= current;
		} else if (command === 'L') {
			const next = { x: numberNext(), y: numberNext() };
			if (current && (Math.abs(current.x - next.x) < EPSILON || Math.abs(current.y - next.y) < EPSILON) && !isSamePoint(current, next)) runAdd(current, next);
			current = next;
		} else if (command === 'Q') {
			index += 2;
			current = { x: numberNext(), y: numberNext() };
		} else if (command === 'C') {
			index += 4;
			current = { x: numberNext(), y: numberNext() };
		} else break;
	}
	return { runList, start, end: current };
}

const runAxisOf = (run) => (Math.abs(run.from.x - run.to.x) < EPSILON ? 'y' : 'x');

export const routePathRead = pathRead;

const CURVE_SAMPLE_QUADRATIC = 4;
const CURVE_SAMPLE_CUBIC = 16;

// the points of a path, curves sampled: for measuring along a line of any type without a browser
export function routePathPolylineGet(d) {
	const tokenList = String(d).match(/[MLQCmlqc]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
	const pointList = [];
	let index = 0;
	let command = '';
	const pointNext = () => ({ x: Number(tokenList[index++]), y: Number(tokenList[index++]) });
	while (index < tokenList.length) {
		if (/^[A-Za-z]$/.test(tokenList[index])) command = tokenList[index++].toUpperCase();
		const from = pointList[pointList.length - 1];
		if (command === 'M' || command === 'L') pointList.push(pointNext());
		else if (command === 'Q') {
			const [control, to] = [pointNext(), pointNext()];
			for (let step = 1; step <= CURVE_SAMPLE_QUADRATIC; step += 1) {
				const t = step / CURVE_SAMPLE_QUADRATIC;
				pointList.push({ x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x, y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y });
			}
		} else if (command === 'C') {
			const [a, b, to] = [pointNext(), pointNext(), pointNext()];
			for (let step = 1; step <= CURVE_SAMPLE_CUBIC; step += 1) {
				const t = step / CURVE_SAMPLE_CUBIC;
				const u = 1 - t;
				pointList.push({ x: u ** 3 * from.x + 3 * u ** 2 * t * a.x + 3 * u * t ** 2 * b.x + t ** 3 * to.x, y: u ** 3 * from.y + 3 * u ** 2 * t * a.y + 3 * u * t ** 2 * b.y + t ** 3 * to.y });
			}
		} else break;
	}
	return pointList;
}

export function routePolylineLengthGet(pointList) {
	return pointList.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - pointList[index].x, point.y - pointList[index].y), 0);
}

// the point at a part of a line's length, as a label stands on it (label.position)
export function routePolylinePointAt(pointList, part) {
	let rest = routePolylineLengthGet(pointList) * part;
	for (let index = 1; index < pointList.length; index += 1) {
		const [from, to] = [pointList[index - 1], pointList[index]];
		const length = Math.hypot(to.x - from.x, to.y - from.y);
		if (rest <= length && length > 0) return { x: from.x + ((to.x - from.x) * rest) / length, y: from.y + ((to.y - from.y) * rest) / length };
		rest -= length;
	}
	return pointList[pointList.length - 1];
}
export const routePathRunListGet = (d) => pathRead(d).runList;

// the range of a run along its axis
function runRangeOf(run) {
	const axis = runAxisOf(run);
	return [Math.min(run.from[axis], run.to[axis]), Math.max(run.from[axis], run.to[axis])];
}

// the range two runs share, on one line; null when they only cross or touch
function runOverlapGet(a, b, tolerance) {
	const axis = runAxisOf(a);
	if (axis !== runAxisOf(b)) return null;
	const across = axis === 'x' ? 'y' : 'x';
	if (Math.abs(a.from[across] - b.from[across]) > tolerance) return null;
	const [aFrom, aTo] = runRangeOf(a);
	const [bFrom, bTo] = runRangeOf(b);
	return Math.min(aTo, bTo) > Math.max(aFrom, bFrom) ? [Math.max(aFrom, bFrom), Math.min(aTo, bTo)] : null;
}

// the part of a line no run of another covers
function runLengthOwnGet(read, readOther, tolerance) {
	let length = 0;
	for (const run of read.runList) {
		const [from, to] = runRangeOf(run);
		const rangeList = readOther.runList.map((other) => runOverlapGet(run, other, tolerance)).filter(Boolean).sort((x, y) => x[0] - y[0]);
		let reached = from;
		for (const range of rangeList) {
			length += Math.max(0, range[0] - reached);
			reached = Math.max(reached, range[1]);
		}
		length += to - reached;
	}
	return length;
}

// the run of a line arriving at one of its ends, if the line arrives there straight
function runFinalOf(read, role) {
	const run = role === 'source' ? read.runList[0] : read.runList[read.runList.length - 1];
	if (!run) return null;
	return isSamePoint(role === 'source' ? run.from : run.to, role === 'source' ? read.start : read.end) ? run : null;
}

// whether two lines break the rule of card-diagram-usage.md#no-lines-on-top-of-each-other:
// lines at one place may share the final run leading to it, and only that; lines between
// the same two places must also keep some of their way apart, or one would hide the other.
// line: { id, d, sourceKey, targetKey, read? }, the keys naming what each end is attached
// to, read the path already read (routePathRead), which a caller checking one line against
// many keeps. answers { length, kind }, or null: kind 'stretch' for a shared length beyond
// the final runs, 'whole' for a line with nothing of its own
export function routeOverlapPairGet(a, b, { lengthMin = 8, tolerance = 2 } = {}) {
	const readA = a.read ?? pathRead(a.d);
	const readB = b.read ?? pathRead(b.d);
	if (!readA.runList.length || !readB.runList.length) return null;
	const finalPairList = [['source', 'source'], ['source', 'target'], ['target', 'source'], ['target', 'target']]
		.filter(([roleA, roleB]) => a[`${roleA}Key`] && a[`${roleA}Key`] === b[`${roleB}Key`])
		.map(([roleA, roleB]) => [runFinalOf(readA, roleA), runFinalOf(readB, roleB)]);
	let lengthStretch = 0;
	let lengthAll = 0;
	for (const runA of readA.runList) {
		for (const runB of readB.runList) {
			const range = runOverlapGet(runA, runB, tolerance);
			if (!range) continue;
			lengthAll += range[1] - range[0];
			if (!finalPairList.some(([finalA, finalB]) => finalA === runA && finalB === runB)) lengthStretch += range[1] - range[0];
		}
	}
	if (lengthStretch >= lengthMin) return { length: Math.round(lengthStretch), kind: 'stretch' };
	const isSamePlaces = (a.sourceKey && a.sourceKey === b.sourceKey && a.targetKey && a.targetKey === b.targetKey) || (a.sourceKey && a.sourceKey === b.targetKey && a.targetKey && a.targetKey === b.sourceKey);
	if (isSamePlaces && Math.min(runLengthOwnGet(readA, readB, tolerance), runLengthOwnGet(readB, readA, tolerance)) < lengthMin) return { length: Math.round(lengthAll), kind: 'whole' };
	return null;
}

// which lines of a diagram lie on top of each other: [{ a, b, length, kind }], the longest first
export function routeOverlapListGet(lineList, options) {
	const lineReadList = lineList.map((line) => ({ ...line, read: pathRead(line.d) }));
	const result = [];
	for (let i = 0; i < lineReadList.length; i += 1) {
		for (let j = i + 1; j < lineReadList.length; j += 1) {
			const overlap = routeOverlapPairGet(lineReadList[i], lineReadList[j], options);
			if (overlap) result.push({ a: lineReadList[i].id, b: lineReadList[j].id, ...overlap });
		}
	}
	return result.sort((x, y) => y.length - x.length);
}
