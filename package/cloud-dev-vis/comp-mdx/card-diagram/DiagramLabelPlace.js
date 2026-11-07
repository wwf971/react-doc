import { routePathPolylineGet, routePolylineLengthGet, routePolylinePointAt } from './DiagramRoute.js';

// Where the label of a line goes along it, from rectangles and paths alone, so a label can be
// read (card-diagram-arrange.md#labels). It knows no kind of card. Any arranger may use it.
//
// Each label tries places along its line, and a place costs what it would cover: a card most,
// then another label, then other lines and the bends of its own line; a little for standing
// close to a card, or leaving the place the author asked for. The labels are placed one after another, the shortest line first,
// having the fewest places, then each is placed again knowing where the others went, until
// nothing moves. It is a heuristic: it finds a good place, not the best one.
//
//   rectList   [{ id, x, y, width, height }]   what a label should not cover
//   lineList   [{ id, d, text?, position? }]   a line with text has a label to place; every
//                                              line counts as something a label covers
//   answers    { positionById, reportList }    a report for a label left over a card
const COST_CARD = 1000;
const COST_CARD_NEAR = 20;
const COST_LABEL = 300;
const COST_LINE = 6;
const COST_BEND = 3;
const COST_LEAVE = 2;
const LABEL_HEIGHT = 20;
const LABEL_PADDING = 18;
const LABEL_MARGIN = 3;
const WIDTH_WIDE = 11;
const WIDTH_NARROW = 6.2;
const STEP_PIXEL = 16;
const PLACE_COUNT_MIN = 9;
const PLACE_COUNT_MAX = 64;
const SWEEP_MAX = 4;

// the size of a label as the canvas draws it, before anything is drawn
export function labelSizeEstimate(text) {
	const width = [...String(text ?? '')].reduce((sum, letter) => sum + (letter.charCodeAt(0) > 0x2e7f ? WIDTH_WIDE : WIDTH_NARROW), 0);
	return { width: width + LABEL_PADDING, height: LABEL_HEIGHT };
}

const rectOfLabel = (point, size, margin = 0) => ({ x: point.x - size.width / 2 - margin, y: point.y - size.height / 2 - margin, width: size.width + 2 * margin, height: size.height + 2 * margin });

function overlapPartOf(a, b) {
	const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return width > 0 && height > 0 ? (width * height) / (a.width * a.height) : 0;
}

// a segment against a rectangle (Liang-Barsky)
function segmentMeetsRect(from, to, rect) {
	let enter = 0;
	let leave = 1;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	for (const [delta, near, far] of [[dx, rect.x - from.x, rect.x + rect.width - from.x], [dy, rect.y - from.y, rect.y + rect.height - from.y]]) {
		if (delta === 0) {
			if (near > 0 || far < 0) return false;
			continue;
		}
		const a = near / delta;
		const b = far / delta;
		enter = Math.max(enter, Math.min(a, b));
		leave = Math.min(leave, Math.max(a, b));
		if (enter > leave) return false;
	}
	return true;
}

const polylineMeetsRect = (polyline, rect) => polyline.slice(1).some((point, index) => segmentMeetsRect(polyline[index], point, rect));

// a corner of a line under its label: the label does not read as lying on the line
function bendIsUnder(polyline, rect) {
	for (let index = 1; index < polyline.length - 1; index += 1) {
		const [before, point, after] = [polyline[index - 1], polyline[index], polyline[index + 1]];
		const isInside = point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
		if (!isInside) continue;
		const cross = (point.x - before.x) * (after.y - point.y) - (point.y - before.y) * (after.x - point.x);
		if (Math.abs(cross) > 1) return true;
	}
	return false;
}

export function labelPositionListPlace({ rectList = [], lineList = [] }) {
	const allList = lineList.map((line) => {
		const polyline = routePathPolylineGet(line.d);
		return { ...line, polyline, length: routePolylineLengthGet(polyline) };
	});
	const labelList = allList.filter((line) => line.text && line.polyline.length > 1 && line.length > 0).map((line) => {
		const size = labelSizeEstimate(line.text);
		const count = Math.max(PLACE_COUNT_MIN, Math.min(PLACE_COUNT_MAX, Math.round(line.length / STEP_PIXEL)));
		const wanted = line.position ?? 0.5;
		const partList = Array.from({ length: count }, (_, index) => (index + 0.5) / count);
		return { line, size, wanted, placeList: [wanted, ...partList].map((part) => {
			const point = routePolylinePointAt(line.polyline, part);
			return { part, rect: rectOfLabel(point, size, LABEL_MARGIN), rectBare: rectOfLabel(point, size) };
		}) };
	}).sort((a, b) => a.line.length - b.line.length);
	const placedById = new Map();
	const costOf = (label, place) => {
		let cost = COST_LEAVE * Math.abs(place.part - label.wanted);
		for (const rect of rectList) {
			const part = overlapPartOf(place.rectBare, rect);
			if (part > 0) cost += COST_CARD * (1 + part);
			else if (overlapPartOf(place.rect, rect) > 0) cost += COST_CARD_NEAR;
		}
		for (const [id, placed] of placedById) {
			if (id === label.line.id) continue;
			const part = overlapPartOf(place.rect, placed.rect);
			if (part > 0) cost += COST_LABEL * (1 + part);
		}
		for (const other of allList) {
			if (other.id !== label.line.id && polylineMeetsRect(other.polyline, place.rect)) cost += COST_LINE;
		}
		if (bendIsUnder(label.line.polyline, place.rect)) cost += COST_BEND;
		return cost;
	};
	const placeBest = (label) => {
		let best = null;
		let costBest = Infinity;
		for (const place of label.placeList) {
			const cost = costOf(label, place);
			if (cost < costBest - 1e-6) {
				best = place;
				costBest = cost;
			}
		}
		return { place: best, cost: costBest };
	};
	const costById = new Map();
	for (let sweep = 0; sweep < SWEEP_MAX; sweep += 1) {
		let isMoved = false;
		for (const label of labelList) {
			const { place, cost } = placeBest(label);
			if (placedById.get(label.line.id) !== place) isMoved = true;
			placedById.set(label.line.id, place);
			costById.set(label.line.id, cost);
		}
		if (!isMoved) break;
	}
	const round = (value) => Math.round(value * 1000) / 1000;
	return {
		positionById: Object.fromEntries(labelList.map((label) => [label.line.id, round(placedById.get(label.line.id).part)])),
		reportList: labelList.filter((label) => costById.get(label.line.id) >= COST_CARD).map((label) => ({ kind: 'label', connectionId: label.line.id, message: `${label.line.id}: no place found for its label clear of the cards` })),
	};
}
