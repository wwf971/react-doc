// The create modes of the parametric canvas (card-diagram-parametric-canvas.md#creating): how a
// pointer gesture on the canvas says where a new thing goes and how large it is. Pure, and a
// plugin like a constraint type: a feature is built with a list of them.
//
// A mode knows geometry and nothing of what is created. It answers a **placement**, in a small
// vocabulary that the creators read (ParametricCreator.js), so any mode serves any thing whose
// creator takes that placement:
//
//   placement
//     { kind: point, point, hold? }                 the thing held at a point by a point of its box
//                                                   (hold: fractions of the box; its top left when absent)
//                                                   (fractions of the box; its top left when absent)
//     { kind: box, rect: { x, y, width, height } }  the box the thing takes
//     { kind: segment, from, to }                   from one point to another
//     { kind: beside, target, side, gap }           on a side of a thing that is there, at a gap.
//                                                   target: { box, nodeId?, groupId?, memberId? }
//
//   create mode
//     id, label, description, icon     icon: a word of the icons of the tool bar
//     hint                             what the gesture is, said in the line under the tool bar
//     cue                              a few words beside the pointer before the gesture starts
//     placementKindList                the kinds it may answer: the first is its own, the others
//                                      what a gesture cut short falls back to (a press without a drag)
//     paramList                        its own parameters, as properties: { id, label, kind: bool |
//                                      number | enum, valueDefault, values?, valueLabels?, step?, min? }
//     placementOf(gesture, param, context)   the placement the gesture stands for now, or null (the
//                                      pointer is away, nothing is under it). Called while the gesture
//                                      lasts, for the ghost, and once more when the pointer goes up
//
//   gesture   { pointNow, pointDown, isDragged, isEnd, isShift, isAlt }: where the pointer is, where it
//             went down (null: not pressed), whether it moved since, whether the pointer is going up
//             now (the last time it is asked), and the keys held. Every gesture ends when the pointer
//             goes up. A mode of a drag answers nothing before the drag starts (nothing is drawn: the
//             cue says what to do), and a press without a drag only as it ends
//   context   { targetList: [{ box, nodeId?, groupId?, memberId? }] }: what stands on the canvas
const HOLD_CENTER = { x: 0.5, y: 0.5 };
const HOLD_CORNER = { x: 0, y: 0 };
const pointRound = point => ({ x: Math.round(point.x), y: Math.round(point.y) });

// one click: the thing at the pointer
export const createModeClick = {
	id: 'click',
	label: 'Click',
	description: 'One click puts it at the pointer, at the size it has by itself.',
	icon: 'pointer',
	hint: 'Click where it goes',
	cue: 'Click to place it',
	placementKindList: ['point'],
	paramList: [{ id: 'hold', label: 'Held by', kind: 'enum', values: ['center', 'corner'], valueLabels: { center: 'Its center', corner: 'Its top left corner' }, valueDefault: 'center' }],
	placementOf(gesture, param) {
		if (!gesture.pointNow) return null;
		return { kind: 'point', point: pointRound(gesture.pointNow), hold: param.hold === 'corner' ? HOLD_CORNER : HOLD_CENTER };
	},
};

// a box dragged out: the thing takes it. Shift keeps it square, Alt grows it from its center; a
// press without a drag is a click
export const createModeDragBox = {
	id: 'drag-box',
	label: 'Drag a box',
	description: 'Press, drag to the size it should have, release. A click alone puts it at its own size.',
	icon: 'box',
	hint: 'Drag out its box · Shift: square · Alt: from its center',
	cue: 'Press and drag out its box',
	placementKindList: ['box', 'point'],
	paramList: [
		{ id: 'isSquare', label: 'Square', kind: 'bool', valueDefault: false },
		{ id: 'isFromCenter', label: 'From its center', kind: 'bool', valueDefault: false },
	],
	placementOf(gesture, param) {
		if (!gesture.pointNow || !gesture.pointDown) return null;
		if (!gesture.isDragged) return gesture.isEnd ? { kind: 'point', point: pointRound(gesture.pointNow), hold: HOLD_CENTER } : null;
		let dx = gesture.pointNow.x - gesture.pointDown.x;
		let dy = gesture.pointNow.y - gesture.pointDown.y;
		if (param.isSquare || gesture.isShift) {
			const side = Math.max(Math.abs(dx), Math.abs(dy));
			dx = (dx < 0 ? -1 : 1) * side;
			dy = (dy < 0 ? -1 : 1) * side;
		}
		const isFromCenter = param.isFromCenter || gesture.isAlt;
		const width = Math.abs(dx) * (isFromCenter ? 2 : 1);
		const height = Math.abs(dy) * (isFromCenter ? 2 : 1);
		const x = isFromCenter ? gesture.pointDown.x - Math.abs(dx) : Math.min(gesture.pointDown.x, gesture.pointDown.x + dx);
		const y = isFromCenter ? gesture.pointDown.y - Math.abs(dy) : Math.min(gesture.pointDown.y, gesture.pointDown.y + dy);
		return { kind: 'box', rect: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) } };
	},
};

// a line dragged from one point to another. Shift keeps it level or upright
export const createModeDragLine = {
	id: 'drag-line',
	label: 'Drag a line',
	description: 'Press where it starts, drag, release where it ends. A click alone puts it at the pointer.',
	icon: 'route',
	hint: 'Drag from where it starts to where it ends · Shift: level or upright',
	cue: 'Press where it starts, drag to where it ends',
	placementKindList: ['segment', 'point'],
	paramList: [{ id: 'isAxisKept', label: 'Level or upright', kind: 'bool', valueDefault: false }],
	placementOf(gesture, param) {
		if (!gesture.pointNow || !gesture.pointDown) return null;
		if (!gesture.isDragged) return gesture.isEnd ? { kind: 'point', point: pointRound(gesture.pointNow), hold: HOLD_CORNER } : null;
		const to = { ...gesture.pointNow };
		if (param.isAxisKept || gesture.isShift) {
			if (Math.abs(to.x - gesture.pointDown.x) >= Math.abs(to.y - gesture.pointDown.y)) to.y = gesture.pointDown.y; else to.x = gesture.pointDown.x;
		}
		return { kind: 'segment', from: pointRound(gesture.pointDown), to: pointRound(to) };
	},
};

// a click beside a thing that is there: the new thing stands on the side of it the pointer is at
export const CREATE_BESIDE_REACH = 120;
export const createModeNextTo = {
	id: 'next-to',
	label: 'Next to',
	description: 'Point at a side of something that is there and click: it stands on that side, and follows it when that is a member of a group.',
	icon: 'beside',
	hint: 'Point at a side of something, then click',
	cue: 'Point at a side of something',
	placementKindList: ['beside'],
	paramList: [
		{ id: 'gap', label: 'Gap', kind: 'number', valueDefault: 40, step: 1, min: 0 },
		{ id: 'isGapFromPointer', label: 'Gap from the pointer', kind: 'bool', valueDefault: false },
	],
	placementOf(gesture, param, context) {
		if (!gesture.pointNow) return null;
		const point = gesture.pointNow;
		let found = null;
		for (const target of context.targetList ?? []) {
			const { box } = target;
			// how far the pointer is outside the box on each axis (0 inside)
			const outX = Math.max(box.x - point.x, 0, point.x - box.x - box.width);
			const outY = Math.max(box.y - point.y, 0, point.y - box.y - box.height);
			const distance = Math.hypot(outX, outY);
			if (distance > CREATE_BESIDE_REACH || (found && distance >= found.distance)) continue;
			found = { target, distance, outX, outY };
		}
		if (!found) return null;
		const { box } = found.target;
		let side;
		if (found.distance > 0) side = found.outX >= found.outY ? (point.x < box.x ? 'left' : 'right') : (point.y < box.y ? 'top' : 'bottom');
		else {
			// inside the box: the side nearest to the pointer
			const toSide = { left: point.x - box.x, right: box.x + box.width - point.x, top: point.y - box.y, bottom: box.y + box.height - point.y };
			side = Object.keys(toSide).reduce((best, key) => (toSide[key] < toSide[best] ? key : best), 'left');
		}
		const gap = param.isGapFromPointer && found.distance > 0 ? Math.round(side === 'left' || side === 'right' ? found.outX : found.outY) : param.gap;
		return { kind: 'beside', target: found.target, side, gap };
	},
};

export const createModeListDefault = [createModeClick, createModeDragBox, createModeDragLine, createModeNextTo];

// the parameters of a mode with the values a tool keeps for it over its defaults
export function createModeParamOf(mode, paramWritten = {}) {
	return Object.fromEntries(mode.paramList.map(definition => [definition.id, paramWritten?.[definition.id] ?? definition.valueDefault]));
}
