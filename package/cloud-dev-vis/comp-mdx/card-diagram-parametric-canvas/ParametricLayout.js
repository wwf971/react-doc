import { choiceRead, numberRead } from './ParametricData.js';

// The layout types of the parametric canvas (card-diagram-parametric-canvas.md#layout-members): a
// layout member places nothing itself and arranges its children. Pure. A type is a plugin, like a
// constraint type. A **pattern** is a layout type with slots: its children fill named slots and the
// relations between them are its code, so only its parameters can change.
//
//   layout type
//     type, label, description
//     childMax?                   how many children it takes; any number when absent
//     slotList?                   [{ id, label, create? }]: a pattern, a child fills one slot each.
//                                 create { kind, data?, style?, size? }: what fills the slot when the
//                                 pattern is made whole by a tool (ParametricEditStore.layoutCreate)
//     isFramedWhenRead?           false: a member of the type is not framed when the diagram is read
//                                 unless it says so (a pattern: a frame would box a caption with its
//                                 subject); framed otherwise (ParametricData.js: memberIsFramedWhenRead)
//     paramDefault                what a new layout of the type starts with
//     read(input, field)          validated; throws naming the field
//     arrange(layout, childList)  childList: [{ id, slot, size }] in order -> { size, placeById,
//                                 copyList? }: its own size, where each child stands in its box (from
//                                 its top left corner), and for a repeat where each further copy of
//                                 its child stands, from the child: [{ index, x, y }]
//     copyCountGet?(layout)       how many further copies of its child it spawns (a repeat)
//     indexFromPlace?(layout, boxList, box)   the index a child dropped with `box` takes among the
//                                 boxes of the others, in order: a drop on the canvas orders an array
//     propertyList, summaryOf(layout)         as for a constraint type
const DIRECTION_LIST = ['row', 'column'];
const directionLabels = { row: 'Row', column: 'Column' };
const alignProperty = { id: 'align', label: 'Align', kind: 'enum', values: [0, 0.5, 1], valueLabels: { 0: 'Start', 0.5: 'Middle', 1: 'End' }, valueDefault: 0.5 };
// the extent of a size along and across a direction
const axesOf = direction => (direction === 'row' ? { main: 'width', cross: 'height', mainAt: 'x', crossAt: 'y' } : { main: 'height', cross: 'width', mainAt: 'y', crossAt: 'x' });

// its children one after another in a row or a column, a gap between their boxes, aligned across
export const layoutTypeArray = {
	type: 'array',
	label: 'Array',
	description: 'Its children one after another in a row or a column, at one gap.',
	paramDefault: { type: 'array', direction: 'row', gap: 40, align: 0.5 },
	read(input, field) {
		return {
			type: 'array',
			direction: choiceRead(input.direction ?? 'row', `${field}.direction`, DIRECTION_LIST),
			gap: numberRead(input.gap ?? 40, `${field}.gap`),
			align: numberRead(input.align ?? 0.5, `${field}.align`),
		};
	},
	arrange(layout, childList) {
		const { main, cross, mainAt, crossAt } = axesOf(layout.direction);
		const crossMax = Math.max(0, ...childList.map(child => child.size[cross]));
		const placeById = new Map();
		let cursor = 0;
		for (const child of childList) {
			placeById.set(child.id, { [mainAt]: cursor, [crossAt]: (crossMax - child.size[cross]) * layout.align });
			cursor += child.size[main] + layout.gap;
		}
		return { size: { [main]: Math.max(0, cursor - (childList.length ? layout.gap : 0)), [cross]: crossMax }, placeById };
	},
	indexFromPlace(layout, boxList, box) {
		const { main, mainAt } = axesOf(layout.direction);
		const center = box[mainAt] + box[main] / 2;
		const index = boxList.findIndex(other => center < other[mainAt] + other[main] / 2);
		return index < 0 ? boxList.length : index;
	},
	propertyList: [
		{ id: 'direction', label: 'Direction', kind: 'enum', values: DIRECTION_LIST, valueLabels: directionLabels, valueDefault: 'row' },
		{ id: 'gap', label: 'Gap', kind: 'number', valueDefault: 40, step: 1 },
		alignProperty,
	],
	summaryOf: layout => `${layout.direction}, gap ${layout.gap}`,
};

// its one child, and what is under it, spawned a number of times along a row or a column
export const REPEAT_COUNT_MAX = 200;
export const layoutTypeRepeat = {
	type: 'repeat',
	label: 'Repeat',
	description: 'Its one child spawned a number of times in a row or a column.',
	childMax: 1,
	paramDefault: { type: 'repeat', count: 3, direction: 'row', gap: 40 },
	read(input, field) {
		const count = numberRead(input.count ?? 3, `${field}.count`, 1, REPEAT_COUNT_MAX);
		if (!Number.isInteger(count)) throw new Error(`${field}.count must be an integer.`);
		return { type: 'repeat', count, direction: choiceRead(input.direction ?? 'row', `${field}.direction`, DIRECTION_LIST), gap: numberRead(input.gap ?? 40, `${field}.gap`) };
	},
	arrange(layout, childList) {
		const child = childList[0];
		const { main, cross, mainAt, crossAt } = axesOf(layout.direction);
		if (!child) return { size: { width: 0, height: 0 }, placeById: new Map(), copyList: [] };
		const step = child.size[main] + layout.gap;
		const copyList = [];
		for (let index = 1; index < layout.count; index += 1) copyList.push({ index, [mainAt]: step * index, [crossAt]: 0 });
		return { size: { [main]: step * layout.count - layout.gap, [cross]: child.size[cross] }, placeById: new Map([[child.id, { x: 0, y: 0 }]]), copyList };
	},
	copyCountGet: layout => layout.count - 1,
	propertyList: [
		{ id: 'count', label: 'Count', kind: 'number', valueDefault: 3, step: 1, min: 1, max: REPEAT_COUNT_MAX },
		{ id: 'direction', label: 'Direction', kind: 'enum', values: DIRECTION_LIST, valueLabels: directionLabels, valueDefault: 'row' },
		{ id: 'gap', label: 'Gap', kind: 'number', valueDefault: 40, step: 1 },
	],
	summaryOf: layout => `${layout.count} × in a ${layout.direction}, gap ${layout.gap}`,
};

// its children in rows of a number of columns, in the order written: a column as wide as its widest
// child, a row as high as its highest, each child at the top left of its cell
export const GRID_COLUMN_MAX = 50;
export const layoutTypeGrid = {
	type: 'grid',
	label: 'Grid',
	description: 'Its children in rows of a number of columns, each column as wide as its widest.',
	paramDefault: { type: 'grid', columns: 3, gapX: 24, gapY: 24 },
	read(input, field) {
		const columns = numberRead(input.columns ?? 3, `${field}.columns`, 1, GRID_COLUMN_MAX);
		if (!Number.isInteger(columns)) throw new Error(`${field}.columns must be an integer.`);
		return { type: 'grid', columns, gapX: numberRead(input.gapX ?? 24, `${field}.gapX`), gapY: numberRead(input.gapY ?? 24, `${field}.gapY`) };
	},
	arrange(layout, childList) {
		const widthList = [];
		const heightList = [];
		childList.forEach((child, index) => {
			const column = index % layout.columns;
			const row = Math.floor(index / layout.columns);
			widthList[column] = Math.max(widthList[column] ?? 0, child.size.width);
			heightList[row] = Math.max(heightList[row] ?? 0, child.size.height);
		});
		const offsetOf = (list, gap, index) => list.slice(0, index).reduce((sum, extent) => sum + extent + gap, 0);
		const placeById = new Map(childList.map((child, index) => [child.id, { x: offsetOf(widthList, layout.gapX, index % layout.columns), y: offsetOf(heightList, layout.gapY, Math.floor(index / layout.columns)) }]));
		const extentOf = (list, gap) => (list.length ? offsetOf(list, gap, list.length) - gap : 0);
		return { size: { width: extentOf(widthList, layout.gapX), height: extentOf(heightList, layout.gapY) }, placeById };
	},
	// in the order of reading: the others before the middle of the box dropped (a row above it, or
	// on its row and left of it)
	indexFromPlace(layout, boxList, box) {
		const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		return boxList.filter(other => other.y + other.height <= center.y || (other.y <= center.y && other.x + other.width / 2 <= center.x)).length;
	},
	propertyList: [
		{ id: 'columns', label: 'Columns', kind: 'number', valueDefault: 3, step: 1, min: 1, max: GRID_COLUMN_MAX },
		{ id: 'gapX', label: 'Gap across', kind: 'number', valueDefault: 24, step: 1 },
		{ id: 'gapY', label: 'Gap down', kind: 'number', valueDefault: 24, step: 1 },
	],
	summaryOf: layout => `${layout.columns} columns, gaps ${layout.gapX} × ${layout.gapY}`,
};

// ---------- patterns: layouts with slots, made whole by a tool ----------

const SIDE_LIST = ['top', 'bottom', 'left', 'right'];
const sideLabels = { top: 'Above', bottom: 'Below', left: 'Left', right: 'Right' };

// a thing and its caption on a side of it, at a gap, aligned along that side
export const layoutTypeCaption = {
	type: 'caption',
	label: 'Captioned',
	isFramedWhenRead: false,
	description: 'A thing and its caption on a side of it: the caption follows it wherever it goes.',
	slotList: [
		{ id: 'subject', label: 'Subject', create: { kind: 'shape', data: { shape: 'rounded' }, size: { width: 160, height: 100 } } },
		{ id: 'caption', label: 'Caption', create: { kind: 'text', data: { text: 'Caption', textSize: 's' } } },
	],
	paramDefault: { type: 'caption', side: 'bottom', gap: 8, align: 0.5 },
	read(input, field) {
		return { type: 'caption', side: choiceRead(input.side ?? 'bottom', `${field}.side`, SIDE_LIST), gap: numberRead(input.gap ?? 8, `${field}.gap`), align: numberRead(input.align ?? 0.5, `${field}.align`) };
	},
	arrange(layout, childList) {
		const subject = childList.find(child => child.slot === 'subject');
		const caption = childList.find(child => child.slot === 'caption');
		const sizeOf = child => child?.size ?? { width: 0, height: 0 };
		const a = sizeOf(subject);
		const b = sizeOf(caption);
		const isAcross = layout.side === 'left' || layout.side === 'right';
		const gap = subject && caption ? layout.gap : 0;
		// along the side the two are aligned; across it they follow one another
		const crossMax = isAcross ? Math.max(a.height, b.height) : Math.max(a.width, b.width);
		const alongOf = size => (crossMax - (isAcross ? size.height : size.width)) * layout.align;
		const isCaptionFirst = layout.side === 'top' || layout.side === 'left';
		const mainOf = size => (isAcross ? size.width : size.height);
		const first = isCaptionFirst ? b : a;
		const placeOf = (size, isFirst) => (isAcross ? { x: isFirst ? 0 : mainOf(first) + gap, y: alongOf(size) } : { x: alongOf(size), y: isFirst ? 0 : mainOf(first) + gap });
		const placeById = new Map();
		if (subject) placeById.set(subject.id, placeOf(a, !isCaptionFirst));
		if (caption) placeById.set(caption.id, placeOf(b, isCaptionFirst));
		const main = mainOf(a) + mainOf(b) + gap;
		return { size: isAcross ? { width: main, height: crossMax } : { width: crossMax, height: main }, placeById };
	},
	propertyList: [
		{ id: 'side', label: 'Caption', kind: 'enum', values: SIDE_LIST, valueLabels: sideLabels, valueDefault: 'bottom' },
		{ id: 'gap', label: 'Gap', kind: 'number', valueDefault: 8, step: 1 },
		alignProperty,
	],
	summaryOf: layout => `caption ${sideLabels[layout.side].toLowerCase()}, gap ${layout.gap}`,
};

// a thing and a badge on one of its corners, its middle at the corner moved inward by an inset
const CORNER_LIST = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const cornerLabels = { 'top-left': 'Top left', 'top-right': 'Top right', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right' };
export const layoutTypeBadge = {
	type: 'badge',
	label: 'Badged',
	isFramedWhenRead: false,
	description: 'A thing and a badge on one of its corners.',
	slotList: [
		{ id: 'subject', label: 'Subject', create: { kind: 'shape', data: { shape: 'rounded' }, size: { width: 160, height: 100 } } },
		{ id: 'badge', label: 'Badge', create: { kind: 'text', data: { text: 'New', textSize: 's', weight: 'bold' }, style: { fill: 'amber' } } },
	],
	paramDefault: { type: 'badge', corner: 'top-right', inset: 0 },
	read(input, field) {
		return { type: 'badge', corner: choiceRead(input.corner ?? 'top-right', `${field}.corner`, CORNER_LIST), inset: numberRead(input.inset ?? 0, `${field}.inset`) };
	},
	arrange(layout, childList) {
		const subject = childList.find(child => child.slot === 'subject');
		const badge = childList.find(child => child.slot === 'badge');
		const a = subject?.size ?? { width: 0, height: 0 };
		const b = badge?.size ?? { width: 0, height: 0 };
		const isRight = layout.corner.endsWith('right');
		const isBottom = layout.corner.startsWith('bottom');
		// the middle of the badge in the box of the subject
		const center = { x: isRight ? a.width - layout.inset : layout.inset, y: isBottom ? a.height - layout.inset : layout.inset };
		const badgeAt = { x: center.x - b.width / 2, y: center.y - b.height / 2 };
		const left = Math.min(0, badgeAt.x);
		const top = Math.min(0, badgeAt.y);
		const placeById = new Map();
		if (subject) placeById.set(subject.id, { x: 0 - left, y: 0 - top });
		if (badge) placeById.set(badge.id, { x: badgeAt.x - left, y: badgeAt.y - top });
		return { size: { width: Math.max(a.width, badgeAt.x + b.width) - left, height: Math.max(a.height, badgeAt.y + b.height) - top }, placeById };
	},
	propertyList: [
		{ id: 'corner', label: 'Corner', kind: 'enum', values: CORNER_LIST, valueLabels: cornerLabels, valueDefault: 'top-right' },
		{ id: 'inset', label: 'Inset', kind: 'number', valueDefault: 0, step: 1 },
	],
	summaryOf: layout => `badge ${cornerLabels[layout.corner].toLowerCase()}`,
};

export const layoutTypeListDefault = [layoutTypeArray, layoutTypeRepeat, layoutTypeGrid, layoutTypeCaption, layoutTypeBadge];
