import { SIDE_LIST, pointAt, pointNameOf, choiceRead, numberRead } from './ParametricData.js';

// The constraint types of the parametric canvas (card-diagram-parametric-canvas.md#constraints): how
// the place of a member follows from its parent(s). Pure. A type is a plugin: a feature is built
// with a list of them (ParametricFeature.jsx), and nothing else knows a type by name.
//
//   constraint type
//     type, label, description
//     parentCount                 how many parents it reads (1, or 2 for between)
//     paramDefault                what a new constraint of the type starts with
//     read(input, { field, pointRead(value, key) })   validated and resolved; throws naming the field.
//                                 pointRead reads a point of a box (of the member, or of a parent: the
//                                 property says which, `of`), as fractions of the box (ParametricData.js)
//     solve(constraint, { size, parentBoxList })   -> { x, y }: the top left corner of the member's box
//     fromPlace(input, constraint, { size, parentBoxList }, position)
//                                 -> the constraint as written whose solve answers `position`, the other
//                                 parameters kept: what a drop on the canvas writes
//     propertyList                the parameters, for the edit card: { id, label, kind: number | enum |
//                                 point, of?, values?, valueLabels?, valueDefault, step?, min?, max? }
//
// A point is of the box of a member (`point`, `pointParent`, `pointA`, `pointB`), never a connection
// handle. The keys written before (anchor, anchorParent, anchorA, anchorB) are refused, with the key
// to write instead
//     summaryOf(constraint)       a few words, for a tree
const round = value => Math.round(value * 100) / 100;
const pointText = point => pointNameOf(point) ?? `${round(point.x)}, ${round(point.y)}`;
const KEY_RENAMED = { anchor: 'point', anchorParent: 'pointParent', anchorA: 'pointA', anchorB: 'pointB' };
function keyOldRefuse(input, field) {
	for (const [keyOld, keyNew] of Object.entries(KEY_RENAMED)) {
		if (input[keyOld] !== undefined) throw new Error(`${field}: write ${keyNew} (a point of the box) for ${keyOld}.`);
	}
}

// a point of the member at an offset from a point of its parent. With the top left corners (the
// default) the offset is the place of the member relative to its parent
export const constraintTypeOffset = {
	type: 'offset',
	label: 'Offset',
	description: 'A point of the member stands at an offset from a point of its parent.',
	parentCount: 1,
	paramDefault: { type: 'offset', x: 0, y: 0 },
	read(input, { field, pointRead }) {
		keyOldRefuse(input, field);
		return {
			type: 'offset',
			x: numberRead(input.x ?? 0, `${field}.x`),
			y: numberRead(input.y ?? 0, `${field}.y`),
			point: pointRead(input.point, 'point') ?? { x: 0, y: 0 },
			pointParent: pointRead(input.pointParent, 'pointParent') ?? { x: 0, y: 0 },
		};
	},
	solve(constraint, { size, parentBoxList }) {
		const at = pointAt(parentBoxList[0], constraint.pointParent);
		return { x: at.x + constraint.x - size.width * constraint.point.x, y: at.y + constraint.y - size.height * constraint.point.y };
	},
	fromPlace(input, constraint, { size, parentBoxList }, position) {
		const at = pointAt(parentBoxList[0], constraint.pointParent);
		return { ...input, type: 'offset', x: Math.round(position.x + size.width * constraint.point.x - at.x), y: Math.round(position.y + size.height * constraint.point.y - at.y) };
	},
	propertyList: [
		{ id: 'x', label: 'X', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'y', label: 'Y', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'point', label: 'Its point', kind: 'point', of: 'self', valueDefault: 'top-left' },
		{ id: 'pointParent', label: 'Point of the parent', kind: 'point', of: 0, valueDefault: 'top-left' },
	],
	summaryOf: constraint => `offset ${round(constraint.x)}, ${round(constraint.y)}${pointText(constraint.point) === 'top-left' && pointText(constraint.pointParent) === 'top-left' ? '' : ` (${pointText(constraint.point)} from ${pointText(constraint.pointParent)})`}`,
};

// an edge of the member at a distance from the facing edge of its parent: beside it on a side.
// side top, gap 20: the bottom edge of the member 20 above the top edge of its parent. align is
// where the two meet across (0: the starts of the edges in line, 0.5: their middles, 1: their ends)
export const constraintTypeBeside = {
	type: 'beside',
	label: 'Beside',
	description: 'The member stands on a side of its parent, an edge of it at a gap from the facing edge of the parent.',
	parentCount: 1,
	paramDefault: { type: 'beside', side: 'right', gap: 40, align: 0.5 },
	read(input, { field }) {
		return {
			type: 'beside',
			side: choiceRead(input.side ?? 'right', `${field}.side`, SIDE_LIST),
			gap: numberRead(input.gap ?? 40, `${field}.gap`),
			align: numberRead(input.align ?? 0.5, `${field}.align`),
			shift: numberRead(input.shift ?? 0, `${field}.shift`),
		};
	},
	solve(constraint, { size, parentBoxList }) {
		const parent = parentBoxList[0];
		const { side, gap, align, shift } = constraint;
		if (side === 'left' || side === 'right') {
			return { x: side === 'right' ? parent.x + parent.width + gap : parent.x - gap - size.width, y: parent.y + (parent.height - size.height) * align + shift };
		}
		return { x: parent.x + (parent.width - size.width) * align + shift, y: side === 'bottom' ? parent.y + parent.height + gap : parent.y - gap - size.height };
	},
	// the gap along the side, the shift across it
	fromPlace(input, constraint, { size, parentBoxList }, position) {
		const parent = parentBoxList[0];
		const { side, align } = constraint;
		const isAcross = side === 'left' || side === 'right';
		const gap = side === 'right' ? position.x - parent.x - parent.width : side === 'left' ? parent.x - position.x - size.width : side === 'bottom' ? position.y - parent.y - parent.height : parent.y - position.y - size.height;
		const shift = isAcross ? position.y - parent.y - (parent.height - size.height) * align : position.x - parent.x - (parent.width - size.width) * align;
		const result = { ...input, type: 'beside', side, gap: Math.round(gap) };
		if (Math.round(shift) !== 0) result.shift = Math.round(shift); else delete result.shift;
		return result;
	},
	propertyList: [
		{ id: 'side', label: 'Side', kind: 'enum', values: SIDE_LIST, valueLabels: { top: 'Above', right: 'Right', bottom: 'Below', left: 'Left' }, valueDefault: 'right' },
		{ id: 'gap', label: 'Gap', kind: 'number', valueDefault: 40, step: 1 },
		{ id: 'align', label: 'Align', kind: 'enum', values: [0, 0.5, 1], valueLabels: { 0: 'Start', 0.5: 'Middle', 1: 'End' }, valueDefault: 0.5 },
		{ id: 'shift', label: 'Shift', kind: 'number', valueDefault: 0, step: 1 },
	],
	summaryOf: constraint => `${constraint.side === 'top' ? 'above' : constraint.side === 'bottom' ? 'below' : constraint.side}, gap ${round(constraint.gap)}`,
};

// a point of the member between a point of each of two parents: at t of the way from the first
// to the second, plus an offset
export const constraintTypeBetween = {
	type: 'between',
	label: 'Between',
	description: 'The member stands between two parents, at a part of the way from the first to the second.',
	parentCount: 2,
	paramDefault: { type: 'between', t: 0.5 },
	read(input, { field, pointRead }) {
		keyOldRefuse(input, field);
		return {
			type: 'between',
			t: numberRead(input.t ?? 0.5, `${field}.t`),
			x: numberRead(input.x ?? 0, `${field}.x`),
			y: numberRead(input.y ?? 0, `${field}.y`),
			point: pointRead(input.point, 'point') ?? { x: 0.5, y: 0.5 },
			pointA: pointRead(input.pointA, 'pointA') ?? { x: 0.5, y: 0.5 },
			pointB: pointRead(input.pointB, 'pointB') ?? { x: 0.5, y: 0.5 },
		};
	},
	solve(constraint, { size, parentBoxList }) {
		const at = betweenPointOf(constraint, parentBoxList);
		return { x: at.x + constraint.x - size.width * constraint.point.x, y: at.y + constraint.y - size.height * constraint.point.y };
	},
	fromPlace(input, constraint, { size, parentBoxList }, position) {
		const at = betweenPointOf(constraint, parentBoxList);
		const result = { ...input, type: 'between' };
		for (const [axis, extent] of [['x', size.width], ['y', size.height]]) {
			const value = Math.round(position[axis] + extent * constraint.point[axis] - at[axis]);
			if (value !== 0) result[axis] = value; else delete result[axis];
		}
		return result;
	},
	propertyList: [
		{ id: 't', label: 'Part of the way', kind: 'number', valueDefault: 0.5, step: 0.05 },
		{ id: 'x', label: 'X', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'y', label: 'Y', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'point', label: 'Its point', kind: 'point', of: 'self', valueDefault: 'center' },
		{ id: 'pointA', label: 'Point of the first parent', kind: 'point', of: 0, valueDefault: 'center' },
		{ id: 'pointB', label: 'Point of the second parent', kind: 'point', of: 1, valueDefault: 'center' },
	],
	summaryOf: constraint => `between, at ${round(constraint.t)}`,
};

function betweenPointOf(constraint, parentBoxList) {
	const a = pointAt(parentBoxList[0], constraint.pointA);
	const b = pointAt(parentBoxList[1], constraint.pointB);
	return { x: a.x + (b.x - a.x) * constraint.t, y: a.y + (b.y - a.y) * constraint.t };
}

export const constraintTypeListDefault = [constraintTypeOffset, constraintTypeBeside, constraintTypeBetween];
