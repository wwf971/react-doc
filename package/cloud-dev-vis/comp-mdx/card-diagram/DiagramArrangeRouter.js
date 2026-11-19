import { routePathRead, routeOverlapPairGet, routeResolve, routeTypeIsRightAngle } from './DiagramRoute.js';
import { lineTypeOfConnection } from './DiagramArrange.js';
import { labelPositionListPlace } from './DiagramLabelPlace.js';
import { endpointKeyOf } from './DiagramERData.js';
import { nodeIsSimple } from './DiagramArrangeOutline.js';

// The routes of the right-angled lines of a diagram of cards standing in columns, from where
// the cards and the ends of the lines are (card-diagram-arrange.md#the-lane-router). It knows
// rectangles and points, nothing of tables: the arrangers of ER diagrams route with it, and the
// arrangers of layers read downward route with it turned a quarter (DiagramArrangeLayers.js).
//
//   column   the cards whose widths overlap; the columns are read off the rectangles, so
//            cards placed by hand work as well as generated ones
//   gap      the free space beside a column; gap i stands left of column i
//   lane     a vertical track in a gap, kept for one line
//   track    a horizontal stretch across columns, between their cards
//   level    a horizontal stretch just above or below a card with a handle on top or bottom
//
// Lines are placed one after the other, each checked against those placed: the preferred
// place first, then others, so what a simple order cannot foresee (two rows at one height
// in different columns) is found and avoided rather than assumed away.
export const LANE_SPACING_MIN = 12;
const LANE_SPACING_OUTER = 18;
const TRACK_STEP = 10;
const CARD_MARGIN = 8;
export const LEVEL_FIRST = 14;
export const LEVEL_STEP = 9;
const CANDIDATE_MAX = 150;
const isVertical = (end) => end.side === 'top' || end.side === 'bottom';

export function diagramColumnListGet(rectList) {
	const sorted = rectList.filter((rect) => !rect.isBackground).sort((a, b) => a.x - b.x);
	const columnList = [];
	for (const rect of sorted) {
		const last = columnList[columnList.length - 1];
		if (last && rect.x < last.right) {
			last.right = Math.max(last.right, rect.x + rect.width);
			last.idList.push(rect.id);
		} else columnList.push({ left: rect.x, right: rect.x + rect.width, idList: [rect.id] });
	}
	return columnList;
}

// how a line goes, and which gaps it needs a lane in. null: it is left as it is
function planOf(line, columnOf) {
	const gapOf = (end, nodeId) => columnOf.get(nodeId) + (end.side === 'right' ? 1 : 0);
	const sourceVertical = isVertical(line.source);
	const targetVertical = isVertical(line.target);
	if (sourceVertical && targetVertical) return null;
	if (targetVertical) return { line, kind: 'level-target', gapSource: gapOf(line.source, line.sourceNodeId) };
	if (sourceVertical) return { line, kind: 'level-source', gapTarget: gapOf(line.target, line.targetNodeId) };
	const gapSource = gapOf(line.source, line.sourceNodeId);
	const gapTarget = gapOf(line.target, line.targetNodeId);
	return gapSource === gapTarget ? { line, kind: 'single', gapSource, gapTarget } : { line, kind: 'double', gapSource, gapTarget };
}

// the lanes each gap needs, in the order they stand from left to right: what arrives at the
// column at its left, what leaves that column, what arrives at the column at its right, what
// leaves that column. of lines going to one card, the farther a row from where it arrives,
// the nearer the card it turns; of lines leaving, the lower a row, the nearer its column. so
// lines of one kind do not cross each other
function laneDemandListGet(planList, columnOf) {
	const demandByGap = new Map();
	const targetRank = new Map();
	const add = (gap, plan, role) => {
		const nodeId = role === 'target' ? plan.line.targetNodeId : plan.line.sourceNodeId;
		const isLeft = columnOf.get(nodeId) < gap;
		const rank = role === 'target' ? (isLeft ? 0 : 2) : (isLeft ? 1 : 3);
		const { source, target, targetKey } = plan.line;
		if (!targetRank.has(targetKey)) targetRank.set(targetKey, targetRank.size);
		const list = demandByGap.get(gap) ?? [];
		list.push({ plan, role, rank, targetRank: targetRank.get(targetKey), distance: Math.abs(source.y - target.y), rowY: source.y });
		demandByGap.set(gap, list);
	};
	for (const plan of planList) {
		if (plan.kind === 'single') add(plan.gapSource, plan, 'target');
		if (plan.kind === 'double' || plan.kind === 'level-target') add(plan.gapSource, plan, 'source');
		if (plan.kind === 'double' || plan.kind === 'level-source') add(plan.gapTarget, plan, 'target');
	}
	for (const list of demandByGap.values()) {
		list.sort((a, b) => a.rank - b.rank
			|| (a.rank === 0 ? a.targetRank - b.targetRank || b.distance - a.distance : 0)
			|| (a.rank === 2 ? a.targetRank - b.targetRank || a.distance - b.distance : 0)
			|| (a.rank === 1 ? b.rowY - a.rowY : 0)
			|| (a.rank === 3 ? a.rowY - b.rowY : 0));
	}
	return demandByGap;
}

// how many lanes each gap needs: what an arranger placing the columns makes room for
export function diagramLaneCountByGapGet(lineList, columnOf) {
	const planList = lineList.map((line) => planOf(line, columnOf)).filter(Boolean);
	return new Map([...laneDemandListGet(planList, columnOf)].map(([gap, list]) => [gap, list.length]));
}

function endsOf(line) {
	const { source, target } = line;
	return { sourceX: source.x, sourceY: source.y, sourcePosition: source.side, targetX: target.x, targetY: target.y, targetPosition: target.side };
}

// a route through points: both anchors follow the target, so a track stays straight
function routeThrough(line, pointList) {
	const round = (value) => Math.round(value * 10) / 10;
	return { anchorList: pointList.map((point, index) => ({ id: `a${index + 1}`, along: 1, x: round(point.x - line.target.x), y: round(point.y - line.target.y) })) };
}

// measureType: the line type candidates are measured with against the lines placed: their own by
// default; 'step' measures with sharp corners, since a rounded corner shortens the runs it joins and
// hides a stretch two lines share by the length of its radius, a junction a reader still sees.
// laneMargin: no lane of a gap stands nearer its sides than that, so a line turns that far from a
// card or a block at least, and from where any line leaves into the gap (an end past its card: after
// the words of an icon node filling it). The lanes stand evenly between the two margins, a place
// kept at each margin for a line that must turn before or after all the others (two rows at one
// height: the outer places below). Without it the lanes share the gap evenly with its two edges,
// the outer places halfway to the cards. A gap too narrow for the margins and its places
// LANE_SPACING_MIN apart shares it evenly
export function diagramLaneWidthOf(laneCount, laneMargin) {
	return laneCount > 0 ? 2 * laneMargin + LANE_SPACING_MIN * (laneCount + 1) : 0;
}

export function diagramLinesRoute({ rectList, lineList, placedList = [], measureType, laneMargin }) {
	const columnList = diagramColumnListGet(rectList);
	const columnOf = new Map();
	columnList.forEach((column, index) => column.idList.forEach((id) => columnOf.set(id, index)));
	const obstacleList = rectList.filter((rect) => !rect.isBackground);
	const reportList = [];
	const routeById = {};
	const planList = [];
	for (const line of lineList) {
		const plan = columnOf.has(line.sourceNodeId) && columnOf.has(line.targetNodeId) ? planOf(line, columnOf) : null;
		if (plan) planList.push(plan);
		else {
			reportList.push({ kind: 'skipped', connectionId: line.id, message: `${line.id}: both of its ends leave a card through its top or bottom, which these rules do not route` });
			placedList = [...placedList, lineFinished(line, routeResolve(measureType ?? line.type, null, endsOf(line)).d)];
		}
	}
	// the lanes of each gap, evenly spaced. with a margin, a side of a gap is the farther of its column
	// and of the ends of lines leaving that column into it
	const demandByGap = laneDemandListGet(planList, columnOf);
	const edgeByGap = new Map();
	if (laneMargin > 0) {
		for (const { line } of planList) {
			for (const [end, nodeId] of [[line.source, line.sourceNodeId], [line.target, line.targetNodeId]]) {
				if (isVertical(end)) continue;
				const gap = columnOf.get(nodeId) + (end.side === 'right' ? 1 : 0);
				const edge = edgeByGap.get(gap) ?? { from: -Infinity, to: Infinity };
				if (end.side === 'right') edge.from = Math.max(edge.from, end.x);
				else edge.to = Math.min(edge.to, end.x);
				edgeByGap.set(gap, edge);
			}
		}
	}
	const slotListByGap = new Map();
	const outerByGap = new Map();
	const preferredOf = new Map();
	for (const [gap, list] of demandByGap) {
		const count = list.length;
		const isOuterLeft = gap === 0;
		const isOuterRight = gap === columnList.length;
		let slotList;
		if (isOuterLeft) slotList = list.map((_, index) => columnList[0].left - LANE_SPACING_OUTER * (count - index));
		else if (isOuterRight) slotList = list.map((_, index) => columnList[columnList.length - 1].right + LANE_SPACING_OUTER * (index + 1));
		else {
			const edge = edgeByGap.get(gap);
			const from = Math.max(columnList[gap - 1].right, edge?.from ?? -Infinity);
			const width = Math.min(columnList[gap].left, edge?.to ?? Infinity) - from;
			const spacing = width / (count + 1);
			// with a margin: count + 2 places evenly from one margin to the other, the first and the last outer
			const step = laneMargin > 0 ? (width - 2 * laneMargin) / (count + 1) : 0;
			if (step >= LANE_SPACING_MIN) {
				slotList = list.map((_, index) => from + laneMargin + step * (index + 1));
				outerByGap.set(gap, [from + laneMargin, from + width - laneMargin]);
			} else slotList = list.map((_, index) => from + spacing * (index + 1));
			if (spacing < LANE_SPACING_MIN) reportList.push({ kind: 'narrow', message: `${count} lines cross a gap of ${Math.round(columnList[gap].left - from)} px: their lanes are ${Math.round(spacing)} px apart` });
		}
		slotListByGap.set(gap, { slotList, usedSet: new Set() });
		list.forEach((demand, index) => preferredOf.set(`${demand.plan.line.id}/${demand.role}`, { gap, index }));
	}
	// the places to try for a lane: its own, then the free ones nearest it, then between them
	const laneCandidateListOf = (lineId, role) => {
		const { gap, index } = preferredOf.get(`${lineId}/${role}`);
		const { slotList, usedSet } = slotListByGap.get(gap);
		const free = slotList.map((x, i) => ({ x, distance: Math.abs(i - index) })).filter((item) => !usedSet.has(item.x)).sort((a, b) => a.distance - b.distance).map((item) => item.x);
		const between = slotList.slice(1).map((x, i) => (x + slotList[i]) / 2).filter((x) => !usedSet.has(x));
		// beyond the outermost lanes: what a row at one height with this line's end needs, its lane
		// on the far side of the other's. in a gap between two columns, halfway to the card
		const outer = gap === columnList.length ? [slotList[slotList.length - 1] + LANE_SPACING_OUTER / 2]
			: gap === 0 ? [slotList[0] - LANE_SPACING_OUTER / 2]
			: outerByGap.get(gap) ?? [(columnList[gap - 1].right + slotList[0]) / 2, (slotList[slotList.length - 1] + columnList[gap].left) / 2];
		return [...free.slice(0, 4), ...outer.filter((x) => !usedSet.has(x)), ...free.slice(4), ...between].map((x) => ({ gap, x }));
	};
	const placedReadList = placedList.map((line) => ({ ...line, read: routePathRead(line.d) }));
	const conflictOf = (candidate) => {
		let length = 0;
		for (const placed of placedReadList) {
			const overlap = routeOverlapPairGet(candidate, placed);
			if (overlap) length += overlap.length || 1;
		}
		return length;
	};
	const horizontalIsFree = (y, xA, xB, idList) => obstacleList.every((rect) => idList.includes(rect.id)
		|| Math.max(xA, xB) <= rect.x - CARD_MARGIN || Math.min(xA, xB) >= rect.x + rect.width + CARD_MARGIN
		|| y <= rect.y - CARD_MARGIN || y >= rect.y + rect.height + CARD_MARGIN);
	const tryPlace = (line, pointList) => {
		const route = routeThrough(line, pointList);
		const d = routeResolve(measureType ?? line.type, route, endsOf(line)).d;
		const candidate = { ...lineFinished(line, d), read: routePathRead(d) };
		return { route, candidate, conflict: conflictOf(candidate) };
	};
	const commit = (line, best, laneList) => {
		routeById[line.id] = best.route;
		placedReadList.push(best.candidate);
		for (const lane of laneList) slotListByGap.get(lane.gap).usedSet.add(lane.x);
		if (best.conflict > 0) reportList.push({ kind: 'overlap', connectionId: line.id, message: `${line.id}: no way found free of other lines` });
	};
	const pickBest = (generator) => {
		let best = null;
		let count = 0;
		for (const attempt of generator) {
			count += 1;
			if (!best || attempt.result.conflict < best.result.conflict) best = attempt;
			if (best.result.conflict === 0 || count >= CANDIDATE_MAX) break;
		}
		return best;
	};
	// lines into one gap first: they have one lane to choose
	for (const plan of planList.filter((item) => item.kind === 'single')) {
		const { line } = plan;
		const best = pickBest((function* () {
			for (const lane of laneCandidateListOf(line.id, 'target')) yield { lane, result: tryPlace(line, [{ x: lane.x, y: line.target.y }]) };
		})());
		commit(line, best.result, [best.lane]);
	}
	// levels above or below a card: the lane nearest the card has the level farthest from it,
	// so a line coming back from farther passes under the end of a nearer one, not through it
	const levelPlanList = planList.filter((item) => item.kind === 'level-target' || item.kind === 'level-source');
	const laneOfPlan = (plan) => {
		const role = plan.kind === 'level-target' ? 'source' : 'target';
		const { gap, index } = preferredOf.get(`${plan.line.id}/${role}`);
		return slotListByGap.get(gap).slotList[index];
	};
	const levelOrder = [...levelPlanList].sort((a, b) => laneOfPlan(a) - laneOfPlan(b));
	// levels are counted per card: lines going to another card have nothing to do with these
	const levelNodeOf = (plan) => (plan.kind === 'level-target' ? plan.line.targetNodeId : plan.line.sourceNodeId);
	const levelGroupByNode = new Map();
	for (const plan of levelOrder) levelGroupByNode.set(levelNodeOf(plan), [...(levelGroupByNode.get(levelNodeOf(plan)) ?? []), plan]);
	levelOrder.forEach((plan) => {
		const { line } = plan;
		const role = plan.kind === 'level-target' ? 'source' : 'target';
		const end = plan.kind === 'level-target' ? line.target : line.source;
		const sign = end.side === 'top' ? -1 : 1;
		const group = levelGroupByNode.get(levelNodeOf(plan));
		const levelPreferred = group.length - 1 - group.indexOf(plan);
		const levelList = Array.from({ length: levelOrder.length + 4 }, (_, index) => index).sort((a, b) => Math.abs(a - levelPreferred) - Math.abs(b - levelPreferred));
		const owner = plan.kind === 'level-target' ? [line.sourceNodeId, line.targetNodeId] : [line.sourceNodeId, line.targetNodeId];
		const best = pickBest((function* () {
			for (const lane of laneCandidateListOf(line.id, role)) {
				for (const level of levelList) {
					const y = end.y + sign * (LEVEL_FIRST + LEVEL_STEP * level);
					if (!horizontalIsFree(y, lane.x, end.x, owner)) continue;
					yield { lane, result: tryPlace(line, [{ x: lane.x, y }]) };
				}
			}
		})());
		if (best) commit(line, best.result, [best.lane]);
		else {
			const lane = laneCandidateListOf(line.id, role)[0];
			commit(line, tryPlace(line, [{ x: lane.x, y: end.y + sign * LEVEL_FIRST }]), [lane]);
		}
	});
	// lines across columns: a lane beside each end, a track between them clear of the cards
	const yAll = obstacleList.flatMap((rect) => [rect.y, rect.y + rect.height]);
	const yExtent = yAll.length ? Math.max(...yAll) - Math.min(...yAll) : 0;
	const trackListOf = (line, xA, xB) => {
		const stepMax = Math.ceil((yExtent + 200) / TRACK_STEP);
		const list = [];
		for (let step = 0; step <= stepMax; step += 1) {
			for (const y of step === 0 ? [line.source.y] : [line.source.y + step * TRACK_STEP, line.source.y - step * TRACK_STEP]) {
				if (horizontalIsFree(y, xA, xB, [])) list.push(y);
			}
		}
		return list;
	};
	for (const plan of planList.filter((item) => item.kind === 'double')) {
		const { line } = plan;
		const best = pickBest((function* () {
			for (const laneSource of laneCandidateListOf(line.id, 'source').slice(0, 6)) {
				for (const laneTarget of laneCandidateListOf(line.id, 'target').slice(0, 6)) {
					for (const y of trackListOf(line, laneSource.x, laneTarget.x).slice(0, 12)) {
						yield { laneSource, laneTarget, result: tryPlace(line, [{ x: laneSource.x, y }, { x: laneTarget.x, y }]) };
					}
				}
			}
		})());
		commit(line, best.result, [best.laneSource, best.laneTarget]);
	}
	return { routeById, reportList };
}

function lineFinished(line, d) {
	return { id: line.id, d, sourceKey: line.sourceKey, targetKey: line.targetKey };
}

// what the line router needs of a diagram: its cards and its right-angled, attached lines.
// a line out of scope stays as it is and counts as something to keep off. registry: of the
// component, to know a node drawn simple, whose handles on one place of its mark are one end
export function diagramLineSceneGet(diagram, geometry, { connectionIdList, registry } = {}) {
	const idSet = connectionIdList ? new Set(connectionIdList) : null;
	const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
	const keyOf = (endpoint) => {
		const node = nodeById.get(endpoint.nodeId);
		return endpointKeyOf(endpoint, node, Boolean(node) && nodeIsSimple(diagram, node, registry?.kindByType?.[node.renderer?.type]?.contract));
	};
	const rectList = (diagram.nodes ?? []).flatMap((node) => {
		const rect = geometry.rectOf(node.id);
		return rect ? [{ ...rect, id: node.id }] : [];
	});
	const lineList = [];
	const placedList = [];
	const reportList = [];
	for (const connection of diagram.connections ?? []) {
		const type = lineTypeOfConnection(diagram, connection);
		if (!routeTypeIsRightAngle(type)) continue;
		const source = connection.source?.nodeId ? geometry.endOf(connection, 'source') : null;
		const target = connection.target?.nodeId ? geometry.endOf(connection, 'target') : null;
		if (!source || !target) {
			reportList.push({ kind: 'skipped', connectionId: connection.id, message: `${connection.id}: it has a free end, or is not drawn` });
			continue;
		}
		const line = { id: connection.id, type, source, target, sourceNodeId: connection.source.nodeId, targetNodeId: connection.target.nodeId, sourceKey: keyOf(connection.source), targetKey: keyOf(connection.target) };
		if (idSet && !idSet.has(connection.id)) {
			const ends = { sourceX: source.x, sourceY: source.y, sourcePosition: source.side, targetX: target.x, targetY: target.y, targetPosition: target.side };
			placedList.push({ id: line.id, d: routeResolve(type, connection.route ?? null, ends).d, sourceKey: line.sourceKey, targetKey: line.targetKey });
		} else lineList.push(line);
	}
	return { rectList, lineList, placedList, reportList };
}

// where the labels of a diagram's lines go, once the lines are routed: lines of any type, the
// labels of lines out of scope staying as they are but counted as lines to keep off
export function diagramLabelsPlace(diagram, geometry, routeById, { connectionIdList } = {}) {
	const idSet = connectionIdList ? new Set(connectionIdList) : null;
	const rectList = (diagram.nodes ?? []).flatMap((node) => {
		const rect = geometry.rectOf(node.id);
		return rect && !rect.isBackground ? [{ ...rect, id: node.id }] : [];
	});
	const lineList = (diagram.connections ?? []).flatMap((connection) => {
		const source = connection.source?.nodeId ? geometry.endOf(connection, 'source') : null;
		const target = connection.target?.nodeId ? geometry.endOf(connection, 'target') : null;
		if (!source || !target) return [];
		const ends = { sourceX: source.x, sourceY: source.y, sourcePosition: source.side, targetX: target.x, targetY: target.y, targetPosition: target.side };
		const route = connection.id in routeById ? routeById[connection.id] : connection.route;
		const isPlaced = !idSet || idSet.has(connection.id);
		return [{ id: connection.id, d: routeResolve(lineTypeOfConnection(diagram, connection), route ?? null, ends).d, text: isPlaced ? connection.label?.text : '', position: connection.label?.position }];
	});
	return labelPositionListPlace({ rectList, lineList });
}
