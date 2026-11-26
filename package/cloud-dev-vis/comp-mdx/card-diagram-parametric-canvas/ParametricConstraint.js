import { SIDE_LIST, choiceRead, numberRead } from './ParametricData.js';
import { REFERENCE_POINT_DEFAULT } from './ParametricReferencePoint.js';

// The constraint types of the parametric canvas (card-diagram-parametric-canvas.md#constraints): how
// the place of a member follows from its parent(s). Pure. A type is a plugin: a feature is built
// with a list of them (ParametricFeature.jsx), and nothing else knows a type by name.
//
//   constraint type
//     type, label, description
//     parentCount                 how many parents it reads (1, or 2 for between)
//     paramDefault                what a new constraint of the type starts with
//     read(input, { field, referencePointRead(value, key), parentList })
//                                 validated and resolved; throws naming the field. referencePointRead
//                                 reads a reference point as written (a definition, or null when
//                                 nothing is written: ParametricReferencePoint.js); parentList: the
//                                 parents as read (what each is: a locator has lines)
//     solve(constraint, context)  -> { x, y }: the top left corner of the member's box
//     fromPlace(input, constraint, context, position)
//                                 -> the constraint as written whose solve answers `position`, the other
//                                 parameters kept: what a drop on the canvas writes
//     sizeOf?(constraint, { parentList })   -> { width?, height? }: a size it dictates (a member
//                                 between two lines of a locator is as wide as they are apart)
//     parentReasonGet?(parentList)   why it cannot place a member under those parents ('' when it can)
//     propertyList                the parameters, for the edit card: { id, label, kind: number | enum |
//                                 referencePoint, of?, values?, valueLabels?, valueDefault, step?, min?, max? }
//     propertyListGet?(constraint, { parentList })   the same, where they depend on the parents (the
//                                 lines of a locator): a definition may say apply(value, written) ->
//                                 the keys of the constraint it writes ({ key: value | undefined })
//     summaryOf(constraint, { pointLabelOf(key) })   a few words, for a tree
//
//   context   { size, parentBoxList, parentList,
//               pointOf(key),                    a reference point parameter resolved: of the member
//                                                (of: self), where it is in its own box, from its top
//                                                left corner; of a parent (of: 0, 1), where it is on
//                                                the canvas
//               parentPointAt(index, definition) any reference point of a parent, on the canvas }
//
// A reference point is of a member or of a parent (`point`, `pointParent`, `pointA`, `pointB`:
// the property says which, `of`), never a connection handle; a constraint type knows none of the
// formats they are written in. The keys written before (anchor, anchorParent, anchorA, anchorB) are
// refused, with the key to write instead
const round = value => Math.round(value * 100) / 100;
const KEY_RENAMED = { anchor: 'point', anchorParent: 'pointParent', anchorA: 'pointA', anchorB: 'pointB' };
function keyOldRefuse(input, field) {
	for (const [keyOld, keyNew] of Object.entries(KEY_RENAMED)) {
		if (input[keyOld] !== undefined) throw new Error(`${field}: write ${keyNew} (a reference point) for ${keyOld}.`);
	}
}
const CENTER = Object.freeze({ format: 'box', x: 0.5, y: 0.5 });

// a reference point of the member at an offset from a reference point of its parent: the default
// constraint, with the default reference point of each when none is named (the top left corner of
// a box: the offset is then the place of the member relative to its parent)
export const constraintTypeOffset = {
	type: 'offset',
	label: 'Offset',
	description: 'A reference point of the member stands at an offset (X, Y) from a reference point of its parent: their default ones unless others are chosen.',
	parentCount: 1,
	paramDefault: { type: 'offset', x: 0, y: 0 },
	read(input, { field, referencePointRead }) {
		keyOldRefuse(input, field);
		return {
			type: 'offset',
			x: numberRead(input.x ?? 0, `${field}.x`),
			y: numberRead(input.y ?? 0, `${field}.y`),
			point: referencePointRead(input.point, 'point') ?? REFERENCE_POINT_DEFAULT,
			pointParent: referencePointRead(input.pointParent, 'pointParent') ?? REFERENCE_POINT_DEFAULT,
		};
	},
	solve(constraint, { pointOf }) {
		const at = pointOf('pointParent');
		const own = pointOf('point');
		return { x: at.x + constraint.x - own.x, y: at.y + constraint.y - own.y };
	},
	fromPlace(input, constraint, { pointOf }, position) {
		const at = pointOf('pointParent');
		const own = pointOf('point');
		return { ...input, type: 'offset', x: Math.round(position.x + own.x - at.x), y: Math.round(position.y + own.y - at.y) };
	},
	propertyList: [
		{ id: 'x', label: 'X', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'y', label: 'Y', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'point', label: 'Its reference point', kind: 'referencePoint', of: 'self', valueDefault: 'default' },
		{ id: 'pointParent', label: 'Reference point of the parent', kind: 'referencePoint', of: 0, valueDefault: 'default' },
	],
	summaryOf(constraint, { pointLabelOf } = {}) {
		const isDefault = constraint.point.format === 'default' && constraint.pointParent.format === 'default';
		return `offset ${round(constraint.x)}, ${round(constraint.y)}${isDefault || !pointLabelOf ? '' : ` (${pointLabelOf('point')} from ${pointLabelOf('pointParent')})`}`;
	},
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

// a reference point of the member between a reference point of each of two parents: at t of the
// way from the first to the second, plus an offset. The middles of their boxes unless others are chosen
export const constraintTypeBetween = {
	type: 'between',
	label: 'Between',
	description: 'The member stands between two parents, at a part of the way from the first to the second.',
	parentCount: 2,
	paramDefault: { type: 'between', t: 0.5 },
	read(input, { field, referencePointRead }) {
		keyOldRefuse(input, field);
		return {
			type: 'between',
			t: numberRead(input.t ?? 0.5, `${field}.t`),
			x: numberRead(input.x ?? 0, `${field}.x`),
			y: numberRead(input.y ?? 0, `${field}.y`),
			point: referencePointRead(input.point, 'point') ?? CENTER,
			pointA: referencePointRead(input.pointA, 'pointA') ?? CENTER,
			pointB: referencePointRead(input.pointB, 'pointB') ?? CENTER,
		};
	},
	solve(constraint, { pointOf }) {
		const at = betweenPointOf(constraint, pointOf);
		const own = pointOf('point');
		return { x: at.x + constraint.x - own.x, y: at.y + constraint.y - own.y };
	},
	fromPlace(input, constraint, { pointOf }, position) {
		const at = betweenPointOf(constraint, pointOf);
		const own = pointOf('point');
		const result = { ...input, type: 'between' };
		for (const axis of ['x', 'y']) {
			const value = Math.round(position[axis] + own[axis] - at[axis]);
			if (value !== 0) result[axis] = value; else delete result[axis];
		}
		return result;
	},
	propertyList: [
		{ id: 't', label: 'Part of the way', kind: 'number', valueDefault: 0.5, step: 0.05 },
		{ id: 'x', label: 'X', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'y', label: 'Y', kind: 'number', valueDefault: 0, step: 1 },
		{ id: 'point', label: 'Its reference point', kind: 'referencePoint', of: 'self', valueDefault: 'center' },
		{ id: 'pointA', label: 'Reference point of the first parent', kind: 'referencePoint', of: 0, valueDefault: 'center' },
		{ id: 'pointB', label: 'Reference point of the second parent', kind: 'referencePoint', of: 1, valueDefault: 'center' },
	],
	summaryOf: constraint => `between, at ${round(constraint.t)}`,
};

function betweenPointOf(constraint, pointOf) {
	const a = pointOf('pointA');
	const b = pointOf('pointB');
	return { x: a.x + (b.x - a.x) * constraint.t, y: a.y + (b.y - a.y) * constraint.t };
}

export const constraintTypeListDefault = [constraintTypeOffset, constraintTypeBeside, constraintTypeBetween];
