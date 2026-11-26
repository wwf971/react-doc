import { choiceRead, mappingRead, numberRead } from './ParametricData.js';
import { REFERENCE_POINT_DEFAULT, lineExtentOf, lineLabelOf } from './ParametricReferencePoint.js';

// The locator of the parametric canvas (card-diagram-parametric-canvas.md#locators): a member that
// provides places. It is a series of x coordinates (vertical lines), a series of y coordinates
// (horizontal lines), or both, each series of one line or more, counted from its origin. What is
// put under it stands on a line, at a crossing, or from one line to another, and follows when a
// line moves: a row of blocks of one height whose widths are the gaps between its vertical lines
// is a locator and nothing else. Pure.
//
// Two plugins, and the reference point format `line` (ParametricReferencePoint.js):
//
//   layoutTypeLocator      the member: a layout type that arranges nothing (isChildConstrained)
//     layout   { type: locator, xList?, yList?, display?, chevronX?, chevronY? }
//       xList, yList   the lines of each axis: a number (its place from the origin), or
//                      { id?, at, name? }. A line is named by its id: the one written, else its
//                      place in the list ("1", "2", …); the editor writes ids, so a line inserted
//                      before another changes no reference to it. One line at least in all
//       display        how it is drawn while it is not focused: hint (the default: only chevrons
//                      where its lines are), light (its lines, faint), full (its lines and their
//                      names, as when focused), hidden (nothing). Focused, it is drawn in full with
//                      its lines to grab. When the diagram is read: full and light as said, nothing else
//       chevronY       where the row of chevrons marking the vertical lines stands, a y from the
//                      origin (above the lines when absent); chevronX: the column of chevrons of the
//                      horizontal lines, an x. Where the chevrons stand moves nothing else
//
//   constraintTypeLocate   how a member stands on the lines of its parent, a locator
//     constraint   { type: locate, lineX?, lineY?, x?, y?, inset?, point? }
//       lineX        a vertical line: its id (the reference point of the member is on it), or
//                    [id, id] (its box runs from one to the other: they decide its width); absent:
//                    the origin of the locator on that axis
//       lineY        the same with the horizontal lines, for its height
//       x, y         an offset added
//       inset        a box between lines is this much smaller at each end (the gap between two
//                    blocks sharing a line is twice it)
//       point        its reference point, on an axis where it stands on a line; its default one when absent
export const LOCATOR_DISPLAY_LIST = ['hint', 'light', 'full', 'hidden'];
export const LOCATOR_DISPLAY_LABEL = { hint: 'Chevrons only', light: 'Faint lines', full: 'In full', hidden: 'Nothing' };
export const LOCATOR_LINE_MAX = 200;
// how far from a line a member dropped still takes that line, in units of the canvas
export const LOCATOR_SNAP = 8;
// how far from the lines their chevrons stand, when the locator says nothing
export const LOCATOR_CHEVRON_GAP = 14;
const AXIS_LIST = [{ axis: 'x', key: 'lineX', listKey: 'xList', sizeKey: 'width', label: 'Vertical line' }, { axis: 'y', key: 'lineY', listKey: 'yList', sizeKey: 'height', label: 'Horizontal line' }];
const round = value => Math.round(value * 100) / 100;

function lineListRead(value, field) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error(`${field} is a list of lines: a number, or { id?, at, name? }.`);
	if (value.length > LOCATOR_LINE_MAX) throw new Error(`${field} holds at most ${LOCATOR_LINE_MAX} lines.`);
	const idSet = new Set();
	return value.map((item, index) => {
		const line = typeof item === 'number' ? { at: item } : mappingRead(item, `${field}[${index}]`);
		const id = line.id === undefined || line.id === null ? String(index + 1) : String(line.id);
		if (!id.trim()) throw new Error(`${field}[${index}].id is empty.`);
		if (idSet.has(id)) throw new Error(`${field}: the line "${id}" is declared twice (a line without an id is named by its place in the list).`);
		idSet.add(id);
		return { id, at: numberRead(line.at, `${field}[${index}]${typeof item === 'number' ? '' : '.at'}`), name: typeof line.name === 'string' ? line.name : '' };
	});
}

// the lines of an axis as the editor writes them: every one with its id, so nothing naming a line
// changes when another is inserted or removed
export const locatorLineListWrite = lineList => lineList.map(line => ({ id: line.id, at: round(line.at), ...(line.name ? { name: line.name } : {}) }));

// where the chevrons of a locator stand, from its origin: { x: the column of the chevrons of the
// horizontal lines, y: the row of those of the vertical lines }
export function locatorChevronPlaceOf(layout) {
	return {
		x: layout.chevronX ?? Math.min(0, lineExtentOf(layout.xList).min) - LOCATOR_CHEVRON_GAP,
		y: layout.chevronY ?? Math.min(0, lineExtentOf(layout.yList).min) - LOCATOR_CHEVRON_GAP,
	};
}

// the place of a new line of an axis: after the last one, at the gap of the last two (80 with fewer)
export function locatorLineAtNext(lineList) {
	if (!lineList.length) return 0;
	const sorted = [...lineList].sort((a, b) => a.at - b.at);
	const last = sorted[sorted.length - 1].at;
	return last + (sorted.length > 1 ? Math.max(8, last - sorted[sorted.length - 2].at) : 80);
}

export const layoutTypeLocator = {
	type: 'locator',
	label: 'Locator',
	description: 'Vertical and horizontal lines at places you set. What is put under it stands on a line, at a crossing or from one line to another, and follows when a line moves.',
	isChildConstrained: true,
	isFramedWhenRead: false,
	paramDefault: { type: 'locator', xList: [0, 160, 320] },
	read(input, field) {
		const xList = lineListRead(input.xList, `${field}.xList`);
		const yList = lineListRead(input.yList, `${field}.yList`);
		if (!xList.length && !yList.length) throw new Error(`${field}: a locator has one line at least (xList: vertical lines, yList: horizontal ones).`);
		const layout = { type: 'locator', xList, yList, display: choiceRead(input.display ?? 'hint', `${field}.display`, LOCATOR_DISPLAY_LIST), chevronX: null, chevronY: null };
		for (const key of ['chevronX', 'chevronY']) if (input[key] !== undefined && input[key] !== null) layout[key] = numberRead(input[key], `${field}.${key}`);
		return layout;
	},
	outlineOf: layout => ({ kind: 'lines', xList: layout.xList, yList: layout.yList }),
	// as large as its lines reach; it places no child
	arrange(layout) {
		const x = lineExtentOf(layout.xList);
		const y = lineExtentOf(layout.yList);
		return { size: { width: x.max - x.min, height: y.max - y.min }, placeById: new Map() };
	},
	propertyList: [
		{ id: 'display', label: 'Shown when not focused', kind: 'enum', values: LOCATOR_DISPLAY_LIST, valueLabels: LOCATOR_DISPLAY_LABEL, valueDefault: 'hint' },
	],
	summaryOf: (layout) => {
		const wordsOf = (count, one) => (count ? `${count} ${one}${count === 1 ? '' : 's'}` : '');
		return [wordsOf(layout.xList.length, 'vertical line'), wordsOf(layout.yList.length, 'horizontal line')].filter(Boolean).join(', ');
	},
};

// ---------- standing on the lines ----------

const LINE_ORIGIN = Object.freeze({ format: 'line', lineX: null, lineY: null });
const lineListOf = (parentList, listKey) => (parentList[0]?.outline?.kind === 'lines' ? parentList[0].outline[listKey] : []);
const lineAtOf = (lineList, lineId) => lineList.find(line => line.id === lineId)?.at ?? 0;

// an axis of a locate constraint as written, read: null (the origin), { line } or { from, to }
function axisRead(value, field, lineList) {
	if (value === undefined || value === null || value === '') return null;
	const idOf = (item) => {
		if (typeof item !== 'string' && typeof item !== 'number') throw new Error(`${field} names a line by its id, or two as [from, to].`);
		const id = String(item);
		if (!lineList.some(line => line.id === id)) throw new Error(`${field}: its locator has no line "${id}" (${lineList.map(line => line.id).join(', ') || 'none on that axis'}).`);
		return id;
	};
	if (Array.isArray(value)) {
		if (value.length !== 2) throw new Error(`${field}: a box runs from one line to another: [from, to].`);
		return { from: idOf(value[0]), to: idOf(value[1]) };
	}
	return { line: idOf(value) };
}

const axisWrite = axis => (!axis ? undefined : axis.line !== undefined ? axis.line : [axis.from, axis.to]);

// the place of a line on the canvas along its axis, from the parent's box
function lineAbsOf(context, key, lineId) {
	const definition = { ...LINE_ORIGIN, [key]: lineId };
	return context.parentPointAt(0, definition)[key === 'lineX' ? 'x' : 'y'];
}

export const constraintTypeLocate = {
	type: 'locate',
	label: 'On lines',
	description: 'The member stands on the lines of its locator: its reference point on a line or at a crossing, or its box from one line to another, which then decide its size.',
	parentCount: 1,
	paramDefault: { type: 'locate' },
	parentReasonGet: parentList => (parentList[0]?.outline?.kind === 'lines' ? '' : 'Its parent is no locator: put it under a locator first.'),
	read(input, { field, referencePointRead, parentList }) {
		if (parentList[0]?.outline?.kind !== 'lines') throw new Error(`${field}: "locate" places a member on the lines of a locator, and its parent is none.`);
		return {
			type: 'locate',
			lineX: axisRead(input.lineX, `${field}.lineX`, lineListOf(parentList, 'xList')),
			lineY: axisRead(input.lineY, `${field}.lineY`, lineListOf(parentList, 'yList')),
			x: numberRead(input.x ?? 0, `${field}.x`),
			y: numberRead(input.y ?? 0, `${field}.y`),
			inset: numberRead(input.inset ?? 0, `${field}.inset`),
			point: referencePointRead(input.point, 'point') ?? REFERENCE_POINT_DEFAULT,
		};
	},
	// between two lines, as wide (as high) as they are apart, less the inset at each end
	sizeOf(constraint, { parentList }) {
		const size = {};
		for (const { key, listKey, sizeKey } of AXIS_LIST) {
			const axis = constraint[key];
			if (axis?.from === undefined) continue;
			const lineList = lineListOf(parentList, listKey);
			size[sizeKey] = Math.max(1, Math.abs(lineAtOf(lineList, axis.to) - lineAtOf(lineList, axis.from)) - constraint.inset * 2);
		}
		return size;
	},
	solve(constraint, context) {
		const ownPoint = context.pointOf('point');
		const position = {};
		for (const { axis: name, key } of AXIS_LIST) {
			const axis = constraint[key];
			if (axis?.from !== undefined) position[name] = Math.min(lineAbsOf(context, key, axis.from), lineAbsOf(context, key, axis.to)) + constraint.inset + constraint[name];
			else position[name] = lineAbsOf(context, key, axis?.line ?? null) + constraint[name] - ownPoint[name];
		}
		return position;
	},
	// a drop: a box between lines goes to the lines nearest to where it was dropped, as many
	// apart; a reference point takes the line it was dropped on (within LOCATOR_SNAP), else keeps
	// its line and writes how far from it it stands.
	// context.isExact: the constraint that puts the box exactly there (a structure changed under a
	// member that must not move): its lines kept, the distance written, nothing snapped.
	// context.isNew: a constraint being made (a member that was placed otherwise): on an axis
	// naming no line, the nearest one, at its distance
	fromPlace(input, constraint, context, position) {
		const ownPoint = context.pointOf('point');
		const result = { ...input, type: 'locate' };
		for (const { axis: name, key, listKey } of AXIS_LIST) {
			const lineList = lineListOf(context.parentList, listKey);
			const sorted = [...lineList].sort((a, b) => a.at - b.at);
			const absOf = lineId => lineAbsOf(context, key, lineId);
			const axis = constraint[key];
			let offset = 0;
			if (axis?.from !== undefined && context.isExact) {
				offset = Math.round(position[name] - Math.min(absOf(axis.from), absOf(axis.to)) - constraint.inset);
			} else if (axis?.from !== undefined) {
				const indexFrom = Math.min(sorted.findIndex(line => line.id === axis.from), sorted.findIndex(line => line.id === axis.to));
				const span = Math.abs(sorted.findIndex(line => line.id === axis.to) - sorted.findIndex(line => line.id === axis.from));
				let indexBest = indexFrom;
				for (let index = 0; index + span < sorted.length; index += 1) {
					if (Math.abs(absOf(sorted[index].id) + constraint.inset - position[name]) < Math.abs(absOf(sorted[indexBest].id) + constraint.inset - position[name])) indexBest = index;
				}
				result[key] = [sorted[indexBest].id, sorted[indexBest + span].id];
			} else {
				const at = position[name] + ownPoint[name];
				const nearest = sorted.reduce((best, line) => (best === null || Math.abs(absOf(line.id) - at) < Math.abs(absOf(best.id) - at) ? line : best), null);
				const isTaken = Boolean(nearest) && (context.isExact ? Boolean(context.isNew) && !axis : Math.abs(absOf(nearest.id) - at) <= LOCATOR_SNAP);
				const lineId = isTaken ? nearest.id : axis?.line ?? null;
				offset = isTaken && !context.isExact ? 0 : Math.round(at - absOf(lineId));
				if (lineId) result[key] = lineId; else delete result[key];
			}
			if (offset !== 0) result[name] = offset; else delete result[name];
		}
		return result;
	},
	propertyList: [
		{ id: 'x', label: 'X', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'y', label: 'Y', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'inset', label: 'Inset', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'point', label: 'Its reference point', kind: 'referencePoint', of: 'self', valueDefault: 'default' },
	],
	// the lines of each axis its locator has: a line (or none: the origin), and the line its box
	// runs to (or none: a point on the first)
	propertyListGet(constraint, { parentList }) {
		const definitionList = [];
		let isAnySpan = false;
		let isAnyPoint = false;
		for (const { axis: name, key, listKey, label } of AXIS_LIST) {
			const lineList = lineListOf(parentList, listKey);
			const axis = constraint[key];
			if (axis?.from !== undefined) isAnySpan = true; else isAnyPoint = true;
			if (!lineList.length) continue;
			const idList = lineList.map(line => line.id);
			const labels = Object.fromEntries(lineList.map(line => [line.id, `${lineLabelOf(lineList, line.id, name)} (${round(line.at)})`]));
			const first = axis?.from ?? axis?.line ?? '';
			definitionList.push({
				id: key, label, kind: 'enum', value: first, values: ['', ...idList], valueLabels: { '': 'None: the origin', ...labels }, isSearchable: idList.length > 8,
				apply: value => ({ [key]: !value ? undefined : axis?.from !== undefined ? [value, axis.to] : value }),
			});
			if (first) {
				definitionList.push({
					id: `${key}To`, label: 'To', kind: 'enum', value: axis?.to ?? '', values: ['', ...idList.filter(id => id !== first)], valueLabels: { '': 'No: a point on it', ...labels }, isSearchable: idList.length > 8,
					apply: value => ({ [key]: value ? [first, value] : first }),
				});
			}
		}
		const byId = Object.fromEntries(this.propertyList.map(definition => [definition.id, definition]));
		definitionList.push(byId.x, byId.y);
		if (isAnySpan) definitionList.push(byId.inset);
		if (isAnyPoint) definitionList.push(byId.point);
		return definitionList;
	},
	summaryOf(constraint, { parentList } = {}) {
		const wordsOf = ({ axis: name, key, listKey }) => {
			const axis = constraint[key];
			if (!axis) return '';
			const lineList = parentList ? lineListOf(parentList, listKey) : [];
			const labelOf = lineId => (lineList.length ? lineLabelOf(lineList, lineId, name) : lineId);
			return axis.from !== undefined ? `${labelOf(axis.from)}–${labelOf(axis.to)}` : labelOf(axis.line);
		};
		const words = AXIS_LIST.map(wordsOf).filter(Boolean).join(' × ');
		return words ? `on ${words}` : 'at the origin of its locator';
	},
};

// the keys of a locate constraint as written naming a line of an axis: for whoever removes a line
// (ParametricEditStore.locatorLineRemove)
export function locateLineIdListOf(constraintWritten, axisKey) {
	const value = constraintWritten?.[axisKey];
	return value === undefined || value === null ? [] : (Array.isArray(value) ? value : [value]).map(String);
}

export const LOCATOR_AXIS_LIST = AXIS_LIST;
export { axisWrite as locateAxisWrite };
