import { lineTypeOfConnection } from './DiagramArrange.js';
import { routeTypeIsRightAngle } from './DiagramRoute.js';
import { diagramGeometryEstimateBuild } from './DiagramArrangeOutline.js';

// The rows arranger (card-diagram-arrange.md#the-rows-arranger): a graph read downward whose
// nodes stand each on a row of its own, in the column its caller gives, as the steps of a plan
// do: a step under the one whose rows it takes, what is computed for it a column to the right.
// A line runs down the column of the node it leaves where nothing stands in its way, and else in
// the channel between two columns, on a track of its own; a column stands as far from the one at
// its left as the tracks of the channel between them need, so no line runs along a node.
//
//   ◯ a ┄┄┄┄┄┄┄┄┄┄┄┐              a line from the side of a node to the top of one in another
//   │              ▼              column, and one from the bottom of a node to the side of one in
//   ◯ b            ◯ c            another column, turn once when the way down is free (a ┄ c, d ─ e)
//   ├───────┐      │
//   ◯ f     │      ◯ d            a line that would run through nodes goes out into a channel on a
//   │       │      │              level of the gap under the node it leaves, down a track of that
//   ◯ e ────│──────┘              channel, and in: the tracks of a channel stand a lane apart, the
//   │       │                     shortest line nearest the column it goes to (b to g)
//   ◯ h     └──◯ g
//
//   channel   the room left of a column (channel 0: the margin left of the first; one more right
//             of the last). A track in it stands next to the column the line goes to
//   level     a horizontal stretch in the gap between two rows, where a line turns towards its
//             channel (under the node it leaves) or towards its node (over the node it reaches).
//             A gap that holds several is as much higher
//
// Lines sharing a handle share only the stretch at that handle (card-diagram-usage.md#no-lines-on-top-of-each-other):
// each has a level and a track of its own, the nearer its other end the higher its level and the
// nearer its track, so they do not cross each other.
//
// It knows no kind of card: which column a node is of, in which order the rows stand and on
// which side of a node a line ends are the caller's to say.
//
//   options   origin?: { x, y }                 the top left of the first row of the first column
//             columnById?: { nodeId: 0, 1, .. } the column of a node; 0 when absent
//             gapBeforeById?: { nodeId: px }    room over a row, to set groups apart
//             rowGap?, columnGap?               px between two rows (10), between two columns at least (24)
//             laneGap?, levelStep?              px between two tracks of a channel (12), two levels of a gap (6)
//             isPlaced?: false                  keeps the nodes where they are (their columns are read
//                                               off their rectangles, their rows off their heights), routes only
//             registry?                         for geometryEstimate
const ROW_GAP = 10;
const COLUMN_GAP = 24;
const LANE_GAP = 12;
const LEVEL_STEP = 6;
const round = (value) => Math.round(value * 100) / 100;
const isVertical = (side) => side === 'top' || side === 'bottom';

// how a line goes: straight, with one corner, or by a channel; skip says why it is left as it is.
//   corner    'target-row': down the column it leaves, into the side of its target
//             'source-row': along the row it leaves, down into the top of its target
//             'arrive': down the column it leaves to the level over its target, and in from above
//   channel, edge   the channel of its track, and which edge of the channel the track stands at
//   isDepart, isArrive   it turns on a level under its source, over its target
function planOf(source, target, sourceRow, targetRow, isBlocked) {
	if (source.side === 'top' || target.side === 'bottom') return { skip: 'it leaves a node upward, or reaches one from below' };
	const isDown = targetRow.index > sourceRow.index;
	const sourceColumn = sourceRow.column;
	const targetColumn = targetRow.column;
	if (isVertical(source.side) && isVertical(target.side)) {
		if (!isDown) return { skip: 'its target stands above its source' };
		const isFree = !isBlocked(sourceColumn, sourceRow.index, targetRow.index);
		if (sourceColumn === targetColumn) return isFree ? { isStraight: true } : { channel: sourceColumn, edge: 'right', isDepart: true, isArrive: true };
		if (isFree) return { corner: 'arrive', isArrive: true };
		return targetColumn > sourceColumn ? { channel: targetColumn, edge: 'right', isDepart: true, isArrive: true } : { channel: targetColumn + 1, edge: 'left', isDepart: true, isArrive: true };
	}
	if (isVertical(source.side)) {
		if (!isDown) return { skip: 'its target stands above its source' };
		const isOnWay = target.side === 'right' ? sourceColumn > targetColumn : sourceColumn < targetColumn;
		if (isOnWay && !isBlocked(sourceColumn, sourceRow.index, targetRow.index)) return { corner: 'target-row' };
		return target.side === 'left' ? { channel: targetColumn, edge: 'right', isDepart: true } : { channel: targetColumn + 1, edge: 'left', isDepart: true };
	}
	if (isVertical(target.side)) {
		if (!isDown) return { skip: 'its target stands above its source' };
		const isOnWay = source.side === 'right' ? targetColumn > sourceColumn : targetColumn < sourceColumn;
		if (isOnWay && !isBlocked(targetColumn, sourceRow.index, targetRow.index)) return { corner: 'source-row' };
		if (source.side === 'right') return targetColumn > sourceColumn ? { channel: targetColumn, edge: 'right', isArrive: true } : { channel: sourceColumn + 1, edge: 'left', isArrive: true };
		return targetColumn < sourceColumn ? { channel: targetColumn + 1, edge: 'left', isArrive: true } : { channel: sourceColumn, edge: 'right', isArrive: true };
	}
	if (sourceRow.index === targetRow.index) return { skip: 'its two ends stand on one row' };
	const channel = target.side === 'left' ? targetColumn : targetColumn + 1;
	const isFacing = source.side === 'right' ? channel > sourceColumn : channel <= sourceColumn;
	return isFacing ? { channel, edge: target.side === 'left' ? 'right' : 'left' } : { skip: `the ${source.side} of its source faces away from the ${target.side} of its target` };
}

export const diagramArrangerRows = {
	id: 'rows',
	label: 'Rows in columns',
	description: 'Stands the nodes one under another, each in its column, the columns as far apart as the lines between them need. A right-angled line runs down a column where nothing stands in its way, else on a track of its own in the channel between two columns.',
	geometryEstimate: (diagram, options) => diagramGeometryEstimateBuild(diagram, options),
	arrange(diagram, geometry, { origin = { x: 0, y: 0 }, columnById = {}, gapBeforeById = {}, rowGap = ROW_GAP, columnGap = COLUMN_GAP, laneGap = LANE_GAP, levelStep = LEVEL_STEP, isPlaced = true } = {}) {
		const reportList = [];
		// ---------- the rows, and the column of each
		const rowList = [];
		for (const node of diagram.nodes ?? []) {
			const rect = geometry.rectOf(node.id);
			if (rect && !rect.isBackground) rowList.push({ id: node.id, rect, column: Math.max(0, Math.round(columnById[node.id] ?? 0)) });
		}
		if (!isPlaced) {
			// as they stand: nodes whose widths overlap are one column, and the rows go by height
			let right = -Infinity;
			let column = -1;
			for (const row of [...rowList].sort((a, b) => a.rect.x - b.rect.x)) {
				if (row.rect.x >= right - 0.5) column += 1;
				row.column = column;
				right = Math.max(right, row.rect.x + row.rect.width);
			}
			rowList.sort((a, b) => a.rect.y - b.rect.y);
		}
		rowList.forEach((row, index) => { row.index = index; });
		const rowById = new Map(rowList.map((row) => [row.id, row]));
		const columnCount = Math.max(-1, ...rowList.map((row) => row.column)) + 1;
		const isBlocked = (column, indexFrom, indexTo) => rowList.some((row) => row.column === column && row.index > indexFrom && row.index < indexTo);

		// ---------- how each line goes
		const lineList = [];
		for (const connection of diagram.connections ?? []) {
			if (!routeTypeIsRightAngle(lineTypeOfConnection(diagram, connection))) continue;
			const sourceRow = rowById.get(connection.source?.nodeId);
			const targetRow = rowById.get(connection.target?.nodeId);
			const source = sourceRow ? geometry.endOf(connection, 'source') : null;
			const target = targetRow ? geometry.endOf(connection, 'target') : null;
			if (!source || !target) {
				reportList.push({ kind: 'skipped', connectionId: connection.id, message: `${connection.id}: it has a free end, or is not drawn` });
				continue;
			}
			const plan = planOf(source, target, sourceRow, targetRow, isBlocked);
			if (plan.skip) {
				reportList.push({ kind: 'skipped', connectionId: connection.id, message: `${connection.id}: ${plan.skip}` });
				continue;
			}
			lineList.push({ id: connection.id, connection, plan, source, target, sourceRow, targetRow, distance: Math.abs(targetRow.index - sourceRow.index) });
		}

		// ---------- the levels of each gap: gap i is under row i (-1: over the first row). What leaves
		// turns first, the nearer its target the higher, then what arrives
		const levelListByGap = new Map();
		const levelAdd = (gap, line, role) => levelListByGap.set(gap, [...(levelListByGap.get(gap) ?? []), { line, role }]);
		for (const line of lineList) {
			if (line.plan.isDepart) levelAdd(line.sourceRow.index, line, 'depart');
			if (line.plan.isArrive) levelAdd(line.targetRow.index - 1, line, 'arrive');
		}
		for (const levelList of levelListByGap.values()) {
			levelList.sort((a, b) => (a.role === b.role ? (a.role === 'depart' ? a.line.distance - b.line.distance : b.line.distance - a.line.distance) : a.role === 'depart' ? -1 : 1));
		}

		// ---------- the rows placed: a gap is as high as its levels need
		const topById = new Map();
		const levelYOf = new Map();
		let y = origin.y;
		rowList.forEach((row, index) => {
			const levelList = levelListByGap.get(index) ?? [];
			const next = rowList[index + 1];
			if (isPlaced) {
				y += gapBeforeById[row.id] ?? 0;
				topById.set(row.id, round(y));
				const bottom = y + row.rect.height;
				levelList.forEach((level, at) => levelYOf.set(`${level.line.id}/${level.role}`, round(bottom + rowGap / 2 + at * levelStep)));
				y = bottom + rowGap + Math.max(0, levelList.length - 1) * levelStep;
			} else {
				topById.set(row.id, row.rect.y);
				const bottom = row.rect.y + row.rect.height;
				const room = next ? Math.max(0, next.rect.y - bottom) : rowGap;
				if (levelList.length && room / (levelList.length + 1) < 2.5) reportList.push({ kind: 'narrow', message: `the gap under ${row.id} is ${Math.round(room)} px high for ${levelList.length} lines turning in it` });
				levelList.forEach((level, at) => levelYOf.set(`${level.line.id}/${level.role}`, round(bottom + (room * (at + 1)) / (levelList.length + 1))));
			}
		});
		const first = rowList[0];
		(levelListByGap.get(-1) ?? []).forEach((level, at) => levelYOf.set(`${level.line.id}/${level.role}`, round(topById.get(first.id) - rowGap / 2 - at * levelStep)));
		// an end moves with its row (its column is placed after the tracks are counted: x is added then)
		const endYOf = (line, role) => line[role].y + topById.get(line[`${role}Row`].id) - line[`${role}Row`].rect.y;

		// ---------- the tracks of each channel: the shortest line nearest the edge it stands at; a
		// track is shared only by lines that do not run side by side
		const trackCountOf = new Map();
		const runList = lineList.filter((line) => line.plan.channel !== undefined).map((line) => {
			const from = line.plan.isDepart ? levelYOf.get(`${line.id}/depart`) : endYOf(line, 'source');
			const to = line.plan.isArrive ? levelYOf.get(`${line.id}/arrive`) : endYOf(line, 'target');
			return { line, key: `${line.plan.channel}/${line.plan.edge}`, yMin: Math.min(from, to), yMax: Math.max(from, to) };
		});
		const placedList = [];
		for (const run of [...runList].sort((a, b) => (a.yMax - a.yMin) - (b.yMax - b.yMin))) {
			let track = 0;
			while (placedList.some((other) => other.key === run.key && other.track === track && other.yMin <= run.yMax + 1 && run.yMin <= other.yMax + 1)) track += 1;
			run.track = track;
			run.line.track = track;
			placedList.push(run);
			trackCountOf.set(run.key, Math.max(trackCountOf.get(run.key) ?? 0, track + 1));
		}
		const trackCount = (channel, edge) => trackCountOf.get(`${channel}/${edge}`) ?? 0;

		// ---------- the columns placed: a channel is as wide as its tracks need
		const leftOf = [];
		const rightOf = [];
		for (let column = 0; column < columnCount; column += 1) {
			const rectList = rowList.filter((row) => row.column === column).map((row) => row.rect);
			if (!isPlaced) {
				leftOf.push(rectList.length ? Math.min(...rectList.map((rect) => rect.x)) : (rightOf[column - 1] ?? origin.x));
				rightOf.push(rectList.length ? Math.max(...rectList.map((rect) => rect.x + rect.width)) : leftOf[column]);
				const lanes = trackCount(column, 'left') + trackCount(column, 'right');
				const room = column > 0 ? leftOf[column] - rightOf[column - 1] : Infinity;
				if (lanes && room < (lanes + 1) * laneGap - 0.5) reportList.push({ kind: 'narrow', message: `the gap left of column ${column + 1} is ${Math.round(room)} px wide for ${lanes} lines running in it` });
				continue;
			}
			const lanes = trackCount(column, 'left') + trackCount(column, 'right');
			const left = column === 0 ? origin.x + lanes * laneGap : rightOf[column - 1] + Math.max(columnGap, lanes ? (lanes + 1) * laneGap : 0);
			leftOf.push(left);
			rightOf.push(left + Math.max(0, ...rectList.map((rect) => rect.width)));
		}
		const positionById = {};
		const shiftXOf = new Map();
		for (const row of rowList) {
			const x = isPlaced ? round(leftOf[row.column]) : row.rect.x;
			shiftXOf.set(row.id, x - row.rect.x);
			if (isPlaced) positionById[row.id] = { x, y: topById.get(row.id) };
		}
		const endOf = (line, role) => ({ ...line[role], x: line[role].x + shiftXOf.get(line[`${role}Row`].id), y: endYOf(line, role) });
		const trackXOf = (line) => {
			const { channel, edge } = line.plan;
			if (edge === 'right') return leftOf[channel] - laneGap * (line.track + 1);
			return rightOf[channel - 1] + laneGap * (line.track + 1);
		};

		// ---------- the routes. An end on the right of a node may be the end of its words, known for sure
		// only when drawn: the corners are kept by the other end then, which is where the line turns
		const routeById = {};
		for (const line of lineList) {
			const { plan } = line;
			// straight down: kept so by an anchor half way, since a line left to itself between two
			// rows close to each other is drawn going down, back up and down again
			if (plan.isStraight) { routeById[line.id] = { anchorList: [{ id: 'a1', along: 0.5, x: 0, y: 0 }] }; continue; }
			const source = endOf(line, 'source');
			const target = endOf(line, 'target');
			const pointList = [];
			if (plan.corner === 'target-row') pointList.push({ x: source.x, y: target.y });
			else if (plan.corner === 'source-row') pointList.push({ x: target.x, y: source.y });
			else if (plan.corner === 'arrive') {
				const level = levelYOf.get(`${line.id}/arrive`);
				pointList.push({ x: source.x, y: level }, { x: target.x, y: level });
			} else {
				const x = trackXOf(line);
				if (plan.isDepart) pointList.push({ x: source.x, y: levelYOf.get(`${line.id}/depart`) }, { x, y: levelYOf.get(`${line.id}/depart`) });
				else pointList.push({ x, y: source.y });
				if (plan.isArrive) pointList.push({ x, y: levelYOf.get(`${line.id}/arrive`) }, { x: target.x, y: levelYOf.get(`${line.id}/arrive`) });
				else pointList.push({ x, y: target.y });
			}
			const isBySource = target.side === 'right' && source.side !== 'right';
			const end = isBySource ? source : target;
			routeById[line.id] = { anchorList: pointList.map((point, index) => ({ id: `a${index + 1}`, along: isBySource ? 0 : 1, x: round(point.x - end.x), y: round(point.y - end.y) })) };
		}
		return { positionById, routeById, reportList };
	},
};
