import { diagramGeometryEstimateBuild } from './DiagramArrangeOutline.js';

// The scatter arranger (card-diagram-arrange.md#the-scatter-arranger): the nodes spread so that
// what a line joins stands near, for a graph with no order of its own (what looks up what, among
// hundreds or thousands of tables). Lines are short on the whole; a node joined to many (a hub)
// stands among them; what is joined to nothing stands apart, in a grid below.
//
//   1. each group of nodes joined by lines (a component) apart, the largest first
//   2. a first place for each: along a spiral, in the order a walk from its most joined node
//      meets them, so neighbours start near
//   3. forces, a bounded number of steps: a line pulls its two ends together, nodes near each other
//      push apart (only those in the cells around, so a step costs as many nodes as there are), a
//      pull towards the middle keeps the group whole; each step moves less than the one before
//   4. no two nodes on one place, by `placement`:
//      grid  the group scaled to the room its nodes need, then each node, the most joined first,
//            takes the free cell of a grid nearest to where it stands (an editor's cards line up)
//      free  the group made as dense everywhere (scatterEqualize: each keeps its direction from the
//            middle and its rank by distance), in a disk `spread` times the room its nodes take;
//            then each node, the most joined first, moves the least it must not to overlap one
//            placed before, at its own size (a graph to be read: no rows, no columns)
//   5. the groups packed in rows, the largest first, what stands alone last
//
// It is deterministic (no randomness): the same graph is placed the same way. What it computed is
// kept in memory for the graphs met last (SCATTER_CACHE_MAX), so a scene drawn again costs nothing.
const SCATTER_CACHE_MAX = 16;
const SCATTER_SPREAD_DEFAULT = 2.5;
const scatterCache = new Map();
// a graph of more items than this has hubs: those joined to more than a tenth of it, and to more than SCATTER_HUB_DEGREE_MIN
export const SCATTER_HUB_FROM = 400;
export const SCATTER_HUB_DEGREE_MIN = 40;

// the items a scattered graph of these lines counts as hubs (scatterComponent): what a caller may draw
// the lines of lighter, as they are the lines that tell least
export function diagramScatterHubSetOf(itemCount, linkList) {
	if (itemCount <= SCATTER_HUB_FROM) return new Set();
	const neighbourById = new Map();
	for (const link of linkList) {
		if (link.from === link.to) continue;
		if (!neighbourById.has(link.from)) neighbourById.set(link.from, new Set());
		if (!neighbourById.has(link.to)) neighbourById.set(link.to, new Set());
		neighbourById.get(link.from).add(link.to);
		neighbourById.get(link.to).add(link.from);
	}
	const threshold = Math.max(SCATTER_HUB_DEGREE_MIN, itemCount * 0.1);
	return new Set([...neighbourById].filter(([, set]) => set.size > threshold).map(([id]) => id));
}

const round = (value) => Math.round(value * 10) / 10;

// items [{ id, width, height }], links [{ from, to, weight? }] (by id; a link to no item is left
// out) → Map id → { x, y }, the top left corner of each item, from (0, 0).
// options:
//   gap        between two items (default 24)
//   stepCount  of the forces (default by the size of the graph)
//   placement  grid: each item on a cell of one grid, as large as the largest item (rows and
//              columns line up: what an editor arranges); free: each item where the forces left it,
//              moved only as far as it must not to overlap another, at its own size (a graph to be
//              read, not edited)
//   spread     free: the room of a group, as many times the room its items take with their gaps
//              (default 2.5); the larger, the more air between them and the longer the lines
export function diagramScatterLayout(itemList, linkList, { gap = 24, stepCount, placement = 'grid', spread = SCATTER_SPREAD_DEFAULT } = {}) {
	const option = { gap, stepCount, placement: placement === 'free' ? 'free' : 'grid', spread: Math.max(1, Number(spread) || SCATTER_SPREAD_DEFAULT) };
	const key = scatterKeyOf(itemList, linkList, option);
	const cached = scatterCache.get(key);
	if (cached) {
		scatterCache.delete(key);
		scatterCache.set(key, cached);
		return new Map(cached);
	}
	const result = scatterCompute(itemList, linkList, option);
	scatterCache.set(key, result);
	if (scatterCache.size > SCATTER_CACHE_MAX) scatterCache.delete(scatterCache.keys().next().value);
	return new Map(result);
}

function scatterKeyOf(itemList, linkList, { gap, stepCount, placement, spread }) {
	return `${gap}|${stepCount ?? ''}|${placement}|${spread}|${itemList.map((item) => `${item.id}:${Math.round(item.width)}:${Math.round(item.height)}`).join(',')}|${linkList.map((link) => `${link.from}>${link.to}:${link.weight ?? 1}`).join(',')}`;
}

function scatterCompute(itemList, linkList, { gap, stepCount: stepCountAsked, placement, spread }) {
	const count = itemList.length;
	const indexById = new Map(itemList.map((item, index) => [item.id, index]));
	const width = itemList.map((item) => Math.max(1, item.width));
	const height = itemList.map((item) => Math.max(1, item.height));
	// the links between two items, one per pair whatever their direction, weighed by how many
	const weightByPair = new Map();
	for (const link of linkList) {
		const a = indexById.get(link.from);
		const b = indexById.get(link.to);
		if (a === undefined || b === undefined || a === b) continue;
		const pairKey = a < b ? a * count + b : b * count + a;
		weightByPair.set(pairKey, (weightByPair.get(pairKey) ?? 0) + (link.weight ?? 1));
	}
	const edgeA = new Int32Array(weightByPair.size);
	const edgeB = new Int32Array(weightByPair.size);
	const edgeWeight = new Float64Array(weightByPair.size);
	const neighbourList = Array.from({ length: count }, () => []);
	let edgeIndex = 0;
	for (const [pairKey, weight] of weightByPair) {
		const a = Math.floor(pairKey / count);
		const b = pairKey % count;
		edgeA[edgeIndex] = a;
		edgeB[edgeIndex] = b;
		edgeWeight[edgeIndex] = Math.sqrt(weight);
		neighbourList[a].push(b);
		neighbourList[b].push(a);
		edgeIndex += 1;
	}
	const degree = neighbourList.map((list) => list.length);
	// the components, each in the order a walk from its most joined item meets them
	const componentOf = new Int32Array(count).fill(-1);
	const componentList = [];
	const byDegree = [...Array(count).keys()].sort((a, b) => degree[b] - degree[a] || String(itemList[a].id).localeCompare(String(itemList[b].id)));
	for (const start of byDegree) {
		if (componentOf[start] !== -1) continue;
		const order = [start];
		componentOf[start] = componentList.length;
		for (let head = 0; head < order.length; head += 1) {
			const next = [...neighbourList[order[head]]].sort((a, b) => degree[b] - degree[a] || a - b);
			for (const other of next) {
				if (componentOf[other] !== -1) continue;
				componentOf[other] = componentList.length;
				order.push(other);
			}
		}
		componentList.push(order);
	}
	// the cell of the grid every item takes at the end: as large as the largest item and the gap
	const cellWidth = Math.max(...width) + gap;
	const cellHeight = Math.max(...height) + gap;
	const x = new Float64Array(count);
	const y = new Float64Array(count);
	const dx = new Float64Array(count);
	const dy = new Float64Array(count);
	const blockList = [];
	const aloneList = [];
	for (const order of componentList) {
		if (order.length === 1) { aloneList.push(order[0]); continue; }
		blockList.push(scatterComponent(order, { x, y, dx, dy, width, height, gap, placement, spread, edgeA, edgeB, edgeWeight, componentOf, componentId: componentOf[order[0]], degree, cellWidth, cellHeight, stepCountAsked, neighbourList }));
	}
	// what stands alone: one block, by name: in a grid, or free in rows, each at its own width
	if (aloneList.length) {
		aloneList.sort((a, b) => String(itemList[a].id).localeCompare(String(itemList[b].id)));
		blockList.push(placement === 'free' ? scatterAloneFlow(aloneList, { x, y, width, height, gap }) : scatterAloneGrid(aloneList, { x, y, width, height, gap, cellWidth, cellHeight }));
	}
	// the blocks in rows, the largest first, a row as wide as the largest block (or the square of all)
	const areaAll = blockList.reduce((sum, block) => sum + block.width * block.height, 0);
	const rowWidthMax = Math.max(...blockList.map((block) => block.width), Math.sqrt(areaAll) * 1.3);
	const blockGapX = placement === 'free' ? gap * 3 : cellWidth;
	const blockGapY = placement === 'free' ? gap * 3 : cellHeight;
	const result = new Map();
	let xRow = 0;
	let yRow = 0;
	let rowHeight = 0;
	for (const block of blockList) {
		if (xRow > 0 && xRow + block.width > rowWidthMax) { xRow = 0; yRow += rowHeight + blockGapY; rowHeight = 0; }
		for (const index of block.indexList) result.set(itemList[index].id, { x: round(xRow + x[index]), y: round(yRow + y[index]) });
		xRow += block.width + blockGapX;
		rowHeight = Math.max(rowHeight, block.height);
	}
	return result;
}

// the items joined to nothing, in a grid of cells as large as the largest item, each in the middle of its cell
function scatterAloneGrid(aloneList, { x, y, width, height, gap, cellWidth, cellHeight }) {
	const columnCount = Math.max(1, Math.ceil(Math.sqrt(aloneList.length * cellHeight / cellWidth)));
	aloneList.forEach((index, order) => {
		x[index] = (order % columnCount) * cellWidth + (cellWidth - gap - width[index]) / 2;
		y[index] = Math.floor(order / columnCount) * cellHeight + (cellHeight - gap - height[index]) / 2;
	});
	return { indexList: aloneList, width: Math.min(aloneList.length, columnCount) * cellWidth, height: Math.ceil(aloneList.length / columnCount) * cellHeight };
}

// the items joined to nothing, free: in rows about as wide as they are tall, each at its own width
function scatterAloneFlow(aloneList, { x, y, width, height, gap }) {
	const area = aloneList.reduce((sum, index) => sum + (width[index] + gap) * (height[index] + gap), 0);
	const rowWidthMax = Math.max(...aloneList.map((index) => width[index] + gap), Math.sqrt(area * 1.6));
	let xNow = 0;
	let yNow = 0;
	let rowHeight = 0;
	let widthAll = 0;
	for (const index of aloneList) {
		if (xNow > 0 && xNow + width[index] > rowWidthMax) { xNow = 0; yNow += rowHeight + gap; rowHeight = 0; }
		x[index] = xNow;
		y[index] = yNow;
		xNow += width[index] + gap;
		rowHeight = Math.max(rowHeight, height[index]);
		widthAll = Math.max(widthAll, xNow - gap);
	}
	return { indexList: aloneList, width: widthAll, height: yNow + rowHeight };
}

// one component: placed by forces, then on the free cells of a grid. Leaves in x, y the top left of
// the cell of each of its items, from (0, 0); answers { indexList, width, height }. An item joined
// to one other alone (a leaf: a local option set of one table) is not moved by the forces: it goes
// beside the one it is joined to, which costs nothing and keeps it there
const cellKeyOf = (column, row) => (column + 1048576) * 2097152 + (row + 1048576);

function scatterComponent(order, { x, y, dx, dy, width, height, gap, placement, spread, edgeA, edgeB, edgeWeight, componentOf, componentId, degree, cellWidth, cellHeight, stepCountAsked, neighbourList }) {
	const n = order.length;
	const unit = Math.max(cellWidth, cellHeight);
	// the leaves of a component of more than two: placed by the one they hang on. In a large graph,
	// a hub (joined to more than a tenth of it: the table every table looks up) pulls everything into
	// one heap: it is left out of the forces, so what else joins them places them, and stands at the
	// middle of what it joins after
	const hubDegree = n > SCATTER_HUB_FROM ? Math.max(SCATTER_HUB_DEGREE_MIN, n * 0.1) : Infinity;
	const isHub = (index) => degree[index] > hubDegree;
	const isLeaf = (index) => n > 2 && degree[index] === 1;
	const moving = order.filter((index) => !isLeaf(index) && !isHub(index));
	const leafList = order.filter((index) => isLeaf(index) && !isHub(index));
	const hubList = order.filter(isHub);
	// a spiral, in the order of the walk: neighbours start near
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	moving.forEach((index, position) => {
		const radius = unit * Math.sqrt(position) * 0.9;
		x[index] = radius * Math.cos(position * goldenAngle);
		y[index] = radius * Math.sin(position * goldenAngle);
	});
	const m = moving.length;
	const stepCount = stepCountAsked ?? Math.max(40, Math.min(160, Math.round(2400 / Math.sqrt(m))));
	const k = unit * 1.1;
	const k2 = k * k;
	const edgeOfComponent = [];
	for (let edge = 0; edge < edgeA.length; edge += 1) if (componentOf[edgeA[edge]] === componentId && !isLeaf(edgeA[edge]) && !isLeaf(edgeB[edge]) && !isHub(edgeA[edge]) && !isHub(edgeB[edge])) edgeOfComponent.push(edge);
	let temperature = unit * Math.sqrt(m) * 0.25;
	const cooling = temperature / (stepCount + 1);
	for (let step = 0; step < stepCount; step += 1) {
		for (const index of moving) { dx[index] = 0; dy[index] = 0; }
		// every node pushes every other away, the far ones by groups (a quadtree: Barnes and Hut), so
		// a crowd around a hub costs no more than a spread graph and groups far apart stay apart
		scatterRepulse(moving, x, y, dx, dy, k2);
		// a line pulls its ends together, the more the longer it is; a hub is pulled by each of its
		// lines less, so it stays among them rather than dragging them all
		for (const edge of edgeOfComponent) {
			const a = edgeA[edge];
			const b = edgeB[edge];
			const ddx = x[a] - x[b];
			const ddy = y[a] - y[b];
			const distance = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
			const force = (distance / k) * edgeWeight[edge];
			const fa = force / Math.sqrt(degree[a]);
			const fb = force / Math.sqrt(degree[b]);
			dx[a] -= ddx * fa; dy[a] -= ddy * fa;
			dx[b] += ddx * fb; dy[b] += ddy * fb;
		}
		// towards the middle, a little: the group stays whole
		for (const index of moving) {
			dx[index] -= x[index] * 0.02;
			dy[index] -= y[index] * 0.02;
			const length = Math.sqrt(dx[index] * dx[index] + dy[index] * dy[index]);
			if (length > temperature) { dx[index] *= temperature / length; dy[index] *= temperature / length; }
			x[index] += dx[index];
			y[index] += dy[index];
		}
		temperature = Math.max(unit * 0.05, temperature - cooling);
	}
	// free: the group as dense everywhere, in pixels, before the hubs and the leaves join it
	const isFree = placement === 'free';
	if (isFree) {
		let room = 0;
		for (const index of order) room += (width[index] + gap) * (height[index] + gap);
		scatterEqualize(moving, x, y, Math.sqrt((room * spread) / Math.PI));
	}
	// a hub at the middle of what it joins (of those placed); a leaf beside what it hangs on, away from the middle
	for (const index of hubList) {
		const placedList = neighbourList[index].filter((other) => !isHub(other) && !isLeaf(other));
		x[index] = placedList.length ? placedList.reduce((sum, other) => sum + x[other], 0) / placedList.length : 0;
		y[index] = placedList.length ? placedList.reduce((sum, other) => sum + y[other], 0) / placedList.length : 0;
	}
	// a leaf beside what it hangs on: the leaves of one item fanned around it, away from the middle,
	// in rings when they are many (the local option sets of one table)
	const leafListByParent = new Map();
	for (const index of leafList) {
		const parent = neighbourList[index][0];
		if (!leafListByParent.has(parent)) leafListByParent.set(parent, []);
		leafListByParent.get(parent).push(index);
	}
	for (const [parent, list] of leafListByParent) {
		const base = Math.atan2(y[parent], x[parent]);
		const perRing = 10;
		list.forEach((index, position) => {
			const ring = Math.floor(position / perRing);
			const inRing = Math.min(perRing, list.length - ring * perRing);
			const turn = inRing === 1 ? 0 : ((position % perRing) - (inRing - 1) / 2) * Math.min(0.55, (2 * Math.PI) / inRing);
			const angle = base + turn + ring * 0.3;
			// free: in pixels, an ellipse as wide as the two side by side and as tall as two rows
			const reachX = isFree ? (width[parent] + width[index]) / 2 + gap : k * 0.6;
			const reachY = isFree ? (height[parent] + height[index]) / 2 + gap * 1.5 : k * 0.6;
			x[index] = x[parent] + Math.cos(angle) * reachX * (1 + ring * 0.8);
			y[index] = y[parent] + Math.sin(angle) * reachY * (1 + ring * 0.8);
		});
	}
	if (isFree) return scatterPlaceFree(order, { x, y, width, height, gap, degree });
	// the room the items need: the group scaled so that it holds about one cell and a half per item
	let xMin = Infinity; let yMin = Infinity; let xMax = -Infinity; let yMax = -Infinity;
	for (const index of order) { xMin = Math.min(xMin, x[index]); yMin = Math.min(yMin, y[index]); xMax = Math.max(xMax, x[index]); yMax = Math.max(yMax, y[index]); }
	const area = Math.max(1, (xMax - xMin + unit) * (yMax - yMin + unit));
	const scale = Math.sqrt((n * cellWidth * cellHeight * 1.5) / area);
	// each item, the most joined first, takes the free cell nearest to where it stands
	const taken = new Set();
	// cells are only ever taken: a ring found full from a cell stays full, the next item wanting the
	// same cell starts past it (hundreds of leaves around one table cost no more than spread ones)
	const ringFromByCell = new Map();
	const byDegree = [...order].sort((a, b) => degree[b] - degree[a] || a - b);
	let columnMin = Infinity; let rowMin = Infinity; let columnMax = -Infinity; let rowMax = -Infinity;
	for (const index of byDegree) {
		const column0 = Math.round(((x[index] - xMin) * scale) / cellWidth);
		const row0 = Math.round(((y[index] - yMin) * scale) / cellHeight);
		let found = null;
		// ring by ring, only the cells on the edge of each
		const cell0 = cellKeyOf(column0, row0);
		let ring = ringFromByCell.get(cell0) ?? 0;
		for (; !found; ring += 1) {
			let best = null;
			const consider = (column, row) => {
				if (taken.has(cellKeyOf(column, row))) return;
				const distance = (column - column0) ** 2 + (row - row0) ** 2;
				if (!best || distance < best.distance) best = { column, row, distance };
			};
			if (ring === 0) consider(column0, row0);
			for (let column = column0 - ring; ring > 0 && column <= column0 + ring; column += 1) { consider(column, row0 - ring); consider(column, row0 + ring); }
			for (let row = row0 - ring + 1; ring > 0 && row <= row0 + ring - 1; row += 1) { consider(column0 - ring, row); consider(column0 + ring, row); }
			found = best;
		}
		ringFromByCell.set(cell0, ring - 1);
		taken.add(cellKeyOf(found.column, found.row));
		x[index] = found.column;
		y[index] = found.row;
		columnMin = Math.min(columnMin, found.column); rowMin = Math.min(rowMin, found.row);
		columnMax = Math.max(columnMax, found.column); rowMax = Math.max(rowMax, found.row);
	}
	// the top left of each item, in the middle of its cell
	for (const index of order) {
		x[index] = (x[index] - columnMin) * cellWidth + (cellWidth - gap - width[index]) / 2;
		y[index] = (y[index] - rowMin) * cellHeight + (cellHeight - gap - height[index]) / 2;
	}
	return { indexList: order, width: (columnMax - columnMin + 1) * cellWidth, height: (rowMax - rowMin + 1) * cellHeight };
}

// free placement: each item, the most joined first, at the nearest place to where it stands (in
// pixels: scatterEqualize) that overlaps nothing placed before: rings of places around it, so it
// moves little and to no grid. What is placed is found by the buckets of a hash: a place costs the
// few items near it
function scatterPlaceFree(order, { x, y, width, height, gap, degree }) {
	const halfWidth = (index) => (width[index] + gap) / 2;
	const halfHeight = (index) => (height[index] + gap) / 2;
	let bucket = 0;
	for (const index of order) bucket = Math.max(bucket, halfHeight(index) * 4);
	const bucketMap = new Map();
	const left = new Float64Array(x.length);
	const top = new Float64Array(x.length);
	const right = new Float64Array(x.length);
	const bottom = new Float64Array(x.length);
	const isFree = (index, cx, cy) => {
		const x0 = cx - halfWidth(index); const x1 = cx + halfWidth(index);
		const y0 = cy - halfHeight(index); const y1 = cy + halfHeight(index);
		const column1 = Math.floor(x1 / bucket); const row1 = Math.floor(y1 / bucket);
		for (let column = Math.floor(x0 / bucket); column <= column1; column += 1) {
			for (let row = Math.floor(y0 / bucket); row <= row1; row += 1) {
				const list = bucketMap.get(cellKeyOf(column, row));
				if (!list) continue;
				for (const other of list) if (x0 < right[other] && left[other] < x1 && y0 < bottom[other] && top[other] < y1) return false;
			}
		}
		return true;
	};
	const take = (index, cx, cy) => {
		left[index] = cx - halfWidth(index); right[index] = cx + halfWidth(index);
		top[index] = cy - halfHeight(index); bottom[index] = cy + halfHeight(index);
		for (let column = Math.floor(left[index] / bucket); column <= Math.floor(right[index] / bucket); column += 1) {
			for (let row = Math.floor(top[index] / bucket); row <= Math.floor(bottom[index] / bucket); row += 1) {
				const key = cellKeyOf(column, row);
				const list = bucketMap.get(key);
				if (list) list.push(index); else bucketMap.set(key, [index]);
			}
		}
	};
	const byDegree = [...order].sort((a, b) => degree[b] - degree[a] || a - b);
	for (const index of byDegree) {
		const cx0 = x[index];
		const cy0 = y[index];
		// a step half its height down or up, a quarter of its width aside (a wide label is freed by
		// little else); the nearest place in pixels, the rings searched until none can be nearer
		const stepY = Math.max(2, halfHeight(index));
		const stepX = Math.max(stepY, halfWidth(index) / 2);
		const stepMin = Math.min(stepX, stepY);
		let best = null;
		for (let ring = 0; !best || (ring * stepMin) ** 2 < best.distance; ring += 1) {
			const consider = (column, row) => {
				const distance = (column * stepX) ** 2 + (row * stepY) ** 2;
				if (best && distance >= best.distance) return;
				if (isFree(index, cx0 + column * stepX, cy0 + row * stepY)) best = { column, row, distance };
			};
			if (ring === 0) consider(0, 0);
			for (let column = -ring; ring > 0 && column <= ring; column += 1) { consider(column, -ring); consider(column, ring); }
			for (let row = -ring + 1; ring > 0 && row <= ring - 1; row += 1) { consider(-ring, row); consider(ring, row); }
		}
		take(index, cx0 + best.column * stepX, cy0 + best.row * stepY);
	}
	let left0 = Infinity; let top0 = Infinity; let right0 = -Infinity; let bottom0 = -Infinity;
	for (const index of order) { left0 = Math.min(left0, left[index]); top0 = Math.min(top0, top[index]); right0 = Math.max(right0, right[index]); bottom0 = Math.max(bottom0, bottom[index]); }
	for (const index of order) { x[index] = left[index] - left0 + gap / 2; y[index] = top[index] - top0 + gap / 2; }
	return { indexList: order, width: right0 - left0, height: bottom0 - top0 };
}

// a group as dense everywhere, in a disk of the radius asked around (0, 0): each item keeps its
// direction from the middle and its rank by distance from it, at the radius where as many items
// stand nearer as in the forces' layout. The forces leave a crowded core (what is joined to much)
// and a sparse rim (what is joined to little), and a scale making room in one leaves the other far
// off; this keeps what stands near together and gives each its share of the room
function scatterEqualize(indexList, x, y, radius) {
	const count = indexList.length;
	if (count === 0) return;
	let xMid = 0;
	let yMid = 0;
	for (const index of indexList) { xMid += x[index]; yMid += y[index]; }
	xMid /= count;
	yMid /= count;
	const byDistance = indexList.map((index) => ({ index, distance: Math.hypot(x[index] - xMid, y[index] - yMid) }))
		.sort((a, b) => a.distance - b.distance || a.index - b.index);
	byDistance.forEach(({ index, distance }, rank) => {
		const radiusNew = radius * Math.sqrt((rank + 0.5) / count);
		if (distance < 1e-9) { x[index] = rank === 0 ? 0 : radiusNew; y[index] = 0; return; }
		x[index] = ((x[index] - xMid) / distance) * radiusNew;
		y[index] = ((y[index] - yMid) / distance) * radiusNew;
	});
}

// the push of every node on every other (k2 / distance), the far ones by the groups of a quadtree
// whose cell is seen small from where a node stands (THETA): about n log n a step, not n squared
const THETA = 0.9;
const QUAD_DEPTH_MAX = 32;

function scatterRepulse(indexList, x, y, dx, dy, k2) {
	let xMin = Infinity; let yMin = Infinity; let xMax = -Infinity; let yMax = -Infinity;
	for (const index of indexList) { xMin = Math.min(xMin, x[index]); yMin = Math.min(yMin, y[index]); xMax = Math.max(xMax, x[index]); yMax = Math.max(yMax, y[index]); }
	// a cell: [x0, y0, size, mass, cx, cy, body, child0..child3] in flat arrays
	const capacity = indexList.length * 4 + 8;
	const cellX = new Float64Array(capacity); const cellY = new Float64Array(capacity); const cellSize = new Float64Array(capacity);
	const mass = new Float64Array(capacity); const cx = new Float64Array(capacity); const cy = new Float64Array(capacity);
	const body = new Int32Array(capacity).fill(-1); const child = new Int32Array(capacity * 4).fill(-1);
	let cellCount = 1;
	cellX[0] = xMin; cellY[0] = yMin; cellSize[0] = Math.max(xMax - xMin, yMax - yMin, 1);
	const childOf = (cell, px, py) => {
		const half = cellSize[cell] / 2;
		const quadrant = (px >= cellX[cell] + half ? 1 : 0) + (py >= cellY[cell] + half ? 2 : 0);
		if (child[cell * 4 + quadrant] === -1) {
			if (cellCount >= capacity) return -1;
			const made = cellCount; cellCount += 1;
			cellX[made] = cellX[cell] + (quadrant & 1 ? half : 0); cellY[made] = cellY[cell] + (quadrant & 2 ? half : 0); cellSize[made] = half;
			child[cell * 4 + quadrant] = made;
		}
		return child[cell * 4 + quadrant];
	};
	for (const index of indexList) {
		let cell = 0;
		for (let depth = 0; ; depth += 1) {
			cx[cell] = (cx[cell] * mass[cell] + x[index]) / (mass[cell] + 1);
			cy[cell] = (cy[cell] * mass[cell] + y[index]) / (mass[cell] + 1);
			mass[cell] += 1;
			if (mass[cell] === 1) { body[cell] = index; break; }
			if (depth >= QUAD_DEPTH_MAX) break;
			// a cell holding one body splits: that body goes a level down first
			if (body[cell] !== -1) {
				const held = body[cell];
				body[cell] = -1;
				const down = childOf(cell, x[held], y[held]);
				if (down === -1) break;
				cx[down] = x[held]; cy[down] = y[held]; mass[down] = 1; body[down] = held;
			}
			const next = childOf(cell, x[index], y[index]);
			if (next === -1) break;
			cell = next;
		}
	}
	const stack = new Int32Array(QUAD_DEPTH_MAX * 4 + 8);
	for (const index of indexList) {
		let top = 0;
		stack[top++] = 0;
		let fx = 0; let fy = 0;
		while (top > 0) {
			const cell = stack[--top];
			if (mass[cell] === 0 || body[cell] === index) continue;
			let ddx = x[index] - cx[cell];
			let ddy = y[index] - cy[cell];
			let distance2 = ddx * ddx + ddy * ddy;
			const isLeaf = body[cell] !== -1 || (child[cell * 4] === -1 && child[cell * 4 + 1] === -1 && child[cell * 4 + 2] === -1 && child[cell * 4 + 3] === -1);
			if (isLeaf || cellSize[cell] * cellSize[cell] < THETA * THETA * distance2) {
				if (distance2 < 0.01) { ddx = (index % 7) + 0.5; ddy = (index % 5) - 2; distance2 = ddx * ddx + ddy * ddy; }
				const force = (k2 * mass[cell]) / distance2;
				fx += ddx * force; fy += ddy * force;
				continue;
			}
			for (let quadrant = 0; quadrant < 4; quadrant += 1) {
				const down = child[cell * 4 + quadrant];
				if (down !== -1 && top < stack.length) stack[top++] = down;
			}
		}
		dx[index] += fx; dy[index] += fy;
	}
}

// the side of a node facing a point: where a straight line to it leaves the node
export function diagramScatterSideOf(rect, point) {
	const dx = point.x - (rect.x + rect.width / 2);
	const dy = point.y - (rect.y + rect.height / 2);
	if (Math.abs(dx) * rect.height >= Math.abs(dy) * rect.width) return dx >= 0 ? 'right' : 'left';
	return dy >= 0 ? 'bottom' : 'top';
}

// the arranger: every node (not a background) scattered by the lines between them; a handle on
// the left or the right of its card turned to the side most of its lines go to. Routes are
// removed: the lines of a scattered graph are straight, or as their renderer draws them.
// options: origin, gap, stepCount, placement (grid by default: an editor's cards line up), spread
export const diagramArrangerScatter = {
	id: 'scatter',
	label: 'Scatter by the lines',
	description: 'Spreads the cards so that what a line joins stands near: short lines on the whole, a card joined to many among them, what is joined to nothing apart. For a graph with no order of its own.',
	geometryEstimate: (diagram, options) => diagramGeometryEstimateBuild(diagram, options),
	arrange(diagram, geometry, { origin = { x: 0, y: 0 }, gap = 28, stepCount, placement = 'grid', spread } = {}) {
		const nodeList = (diagram.nodes ?? []).filter((node) => {
			const rect = geometry.rectOf(node.id);
			return rect && !rect.isBackground;
		});
		const rectById = new Map(nodeList.map((node) => [node.id, geometry.rectOf(node.id)]));
		const connectionList = (diagram.connections ?? []).filter((line) => rectById.has(line.source?.nodeId) && rectById.has(line.target?.nodeId));
		const placed = diagramScatterLayout(nodeList.map((node) => ({ id: node.id, width: rectById.get(node.id).width, height: rectById.get(node.id).height })),
			connectionList.map((line) => ({ from: line.source.nodeId, to: line.target.nodeId })), { gap, stepCount, placement, spread });
		const positionById = Object.fromEntries([...placed].map(([id, point]) => [id, { x: round(origin.x + point.x), y: round(origin.y + point.y) }]));
		// a handle on the left or the right turns to the side most of its lines go to; one on the top
		// or the bottom stays (the anchor it stands on may have no other side)
		const nodeById = new Map((diagram.nodes ?? []).map((node) => [node.id, node]));
		const handleOf = (endpoint) => nodeById.get(endpoint.nodeId)?.handles?.find((handle) => handle.id === endpoint.handleId);
		const voteByKey = new Map();
		const rectAt = (id) => ({ ...rectById.get(id), ...positionById[id] });
		for (const line of connectionList) {
			for (const [role, other] of [['source', 'target'], ['target', 'source']]) {
				const sideNow = handleOf(line[role])?.anchor?.side ?? 'right';
				if (sideNow !== 'left' && sideNow !== 'right') continue;
				const rectOther = rectAt(line[other].nodeId);
				const rectOwn = rectAt(line[role].nodeId);
				const side = rectOther.x + rectOther.width / 2 >= rectOwn.x + rectOwn.width / 2 ? 'right' : 'left';
				const handleKey = `${line[role].nodeId}/${line[role].handleId}`;
				const vote = voteByKey.get(handleKey) ?? { nodeId: line[role].nodeId, handleId: line[role].handleId, sideNow, countBySide: {} };
				vote.countBySide[side] = (vote.countBySide[side] ?? 0) + 1;
				voteByKey.set(handleKey, vote);
			}
		}
		const handleSideList = [...voteByKey.values()].map((vote) => ({ nodeId: vote.nodeId, handleId: vote.handleId, side: (vote.countBySide.left ?? 0) > (vote.countBySide.right ?? 0) ? 'left' : 'right', sideNow: vote.sideNow }))
			.filter((item) => item.side !== item.sideNow).map(({ sideNow: _sideNow, ...item }) => item);
		const routeById = Object.fromEntries(connectionList.map((line) => [line.id, null]));
		return { positionById, handleSideList, routeById };
	},
};
