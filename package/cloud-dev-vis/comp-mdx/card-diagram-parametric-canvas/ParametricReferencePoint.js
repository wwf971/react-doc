// The reference points of the parametric canvas (card-diagram-parametric-canvas.md#reference-points):
// a **reference point** is a point of a thing that a constraint places or measures from. It is
// defined by parameters, never by a place picked with the pointer, in a **format**; which formats
// a thing offers follows from its **outline** (the shape of its boundary), so every round thing
// shares the formats of round things and nothing is written per kind. Pure.
//
// Words kept apart (card-diagram-impl.md#the-words-of-a-node): a reference point belongs to placing
// by rules; a **node handle** and its **anchor** belong to the lines; a **resize handle** to the
// size of the node selected. None of them is ever another.
//
//   outline   { kind: rect | ellipse | polygon | point | lines, ... }
//     rect      a box (the default of every node, of a layout member)
//     ellipse   the ellipse inscribed in the box (a round shape)
//     polygon   pointList [[x, y]]: its corners as fractions of the box, clockwise from the top
//     point     one point, with no extent (the origin of a group)
//     lines     xList, yList [{ id, at, name }]: the lines of a locator (ParametricLocator.js)
//
//   reference point, as written                                           format
//     center | top-left | top | …            one of nine names of the bounding box       box
//     { x: 0.2, y: 0.9 }                     fractions of the bounding box               box
//     { side: top, offset: 0.667 }           along an edge, by a fraction                edge
//     { side: left, index: 2, count: 3 }     the 2nd of the points dividing the left     edge
//                                            edge in 3, from the top (from the left on a
//                                            top or bottom edge)
//     { direction: north }                   on the outline: north, east, south, west    angle
//     { angle: 45 }                          on the outline, 45° clockwise from north    angle
//     { vertex: 2 }                          its 2nd corner, clockwise from the top      vertex
//     { lineX: a, lineY: b }                 a locator: where two of its lines cross;    line
//                                            one axis alone: that line, at its origin on
//                                            the other axis; none: its origin
//     p1                                     a reference point the thing declares itself own
//                                            (referencePointList of its member), by its id
//     (absent)                               its default reference point                 default
//
// A definition read is plain data, { format, ... }. `own` and `default` are resolved against the
// thing they are of (referencePointResolve): its own list, its default, else the default of its
// outline. Every format resolves on every outline (on the bounding box where the outline has no
// such thing), so changing the shape of a thing never makes its drawing unreadable; what an editor
// **offers** for a thing is the formats listing its outline.
//
//   format (a plugin: a feature is built with a list of them, ParametricCatalog.js)
//     id, label
//     outlineKindList                 the outlines an editor offers it for
//     isOf(input)                     whether a definition as written is of this format
//     read(input, field)              validated: { format: id, ... }; throws naming the field
//     write(definition)               as written again, in its shortest form
//     resolve(definition, { size, outline })   -> { x, y }: where it is in the box of the thing,
//                                     from its top left corner, in units of the canvas
//     choiceListGet(outline)          [{ key, label, definition }]: what a menu offers of it
//     keyOf(definition)               the key of the choice a definition is
//     paramListGet(definition, outline)   the parameters of a definition, for an edit card:
//                                     [{ id, label, kind: number | enum, value, values?, valueLabels?,
//                                     min?, max?, step?, next(value) -> definition }]
//     labelOf(definition, outline)    a few words
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const round = value => Math.round(value * 1000) / 1000;

function numberRead(value, field, min = -Infinity, max = Infinity) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field} must be a number${min > -Infinity ? ` >= ${min}` : ''}${max < Infinity ? ` <= ${max}` : ''}.`);
	return value;
}

export const SIDE_LIST = ['top', 'right', 'bottom', 'left'];
const sideLabels = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

// ---------- outlines ----------

export const OUTLINE_RECT = Object.freeze({ kind: 'rect' });
export const OUTLINE_ELLIPSE = Object.freeze({ kind: 'ellipse' });
export const OUTLINE_POINT = Object.freeze({ kind: 'point' });
export const OUTLINE_LABEL = { rect: 'a box', ellipse: 'a round thing', polygon: 'a polygon', point: 'a point', lines: 'a locator' };

// the outline a kind answers for a node (contract.outlineOf), read: a rectangle when it says nothing
export function outlineRead(value) {
	if (!value || typeof value !== 'object') return OUTLINE_RECT;
	if (value.kind === 'polygon' && Array.isArray(value.pointList) && value.pointList.length >= 3) return { kind: 'polygon', pointList: value.pointList.map(point => [point[0], point[1]]) };
	if (value.kind === 'lines') return { kind: 'lines', xList: value.xList ?? [], yList: value.yList ?? [] };
	return value.kind === 'ellipse' ? OUTLINE_ELLIPSE : value.kind === 'point' ? OUTLINE_POINT : OUTLINE_RECT;
}

// the extent of the lines of a locator on an axis: { min, max } of their places (0, 0 with none)
export function lineExtentOf(lineList) {
	if (!lineList?.length) return { min: 0, max: 0 };
	return { min: Math.min(...lineList.map(line => line.at)), max: Math.max(...lineList.map(line => line.at)) };
}

// where a ray from the middle of a box, at an angle clockwise from north, leaves an outline
function outlineRayPointOf(outline, size, angle) {
	const a = size.width / 2;
	const b = size.height / 2;
	const radian = (angle * Math.PI) / 180;
	const dx = Math.sin(radian);
	const dy = -Math.cos(radian);
	if (outline.kind === 'point' || (!a && !b)) return { x: a, y: b };
	if (outline.kind === 'ellipse') {
		if (!a || !b) return { x: a + dx * a, y: b + dy * b };
		const t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
		return { x: a + dx * t, y: b + dy * t };
	}
	if (outline.kind === 'polygon') {
		// the farthest crossing of the ray with an edge of the polygon
		const pointList = outline.pointList.map(point => ({ x: point[0] * size.width, y: point[1] * size.height }));
		let tBest = null;
		pointList.forEach((from, index) => {
			const to = pointList[(index + 1) % pointList.length];
			const ex = to.x - from.x;
			const ey = to.y - from.y;
			const cross = dx * ey - dy * ex;
			if (Math.abs(cross) < 1e-9) return;
			const t = ((from.x - a) * ey - (from.y - b) * ex) / cross;
			const u = ((from.x - a) * dy - (from.y - b) * dx) / cross;
			if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && (tBest === null || t > tBest)) tBest = t;
		});
		if (tBest !== null) return { x: a + dx * tBest, y: b + dy * tBest };
	}
	// a box: where the ray leaves it
	const t = Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity);
	return { x: a + dx * t, y: b + dy * t };
}

// ---------- the formats ----------

export const REFERENCE_POINT_BY_NAME = {
	'top-left': { x: 0, y: 0 }, top: { x: 0.5, y: 0 }, 'top-right': { x: 1, y: 0 },
	left: { x: 0, y: 0.5 }, center: { x: 0.5, y: 0.5 }, right: { x: 1, y: 0.5 },
	'bottom-left': { x: 0, y: 1 }, bottom: { x: 0.5, y: 1 }, 'bottom-right': { x: 1, y: 1 },
};
const nameLabels = { 'top-left': 'Top left', top: 'Top', 'top-right': 'Top right', left: 'Left', center: 'Center', right: 'Right', 'bottom-left': 'Bottom left', bottom: 'Bottom', 'bottom-right': 'Bottom right' };

// the name of fractions of a box, when they have one
export function referencePointNameOf(point) {
	return Object.keys(REFERENCE_POINT_BY_NAME).find(name => REFERENCE_POINT_BY_NAME[name].x === point.x && REFERENCE_POINT_BY_NAME[name].y === point.y) ?? null;
}

// a point of the bounding box: one of nine names, or fractions of the box
export const referenceFormatBox = {
	id: 'box',
	label: 'Bounding box',
	outlineKindList: ['rect', 'ellipse', 'polygon'],
	isOf: input => (typeof input === 'string' ? Boolean(REFERENCE_POINT_BY_NAME[input]) : own(input, 'x') || own(input, 'y')),
	read(input, field) {
		if (typeof input === 'string') return { format: 'box', ...REFERENCE_POINT_BY_NAME[input] };
		return { format: 'box', x: numberRead(input.x, `${field}.x`), y: numberRead(input.y, `${field}.y`) };
	},
	write: definition => referencePointNameOf(definition) ?? { x: round(definition.x), y: round(definition.y) },
	resolve: (definition, { size }) => ({ x: size.width * definition.x, y: size.height * definition.y }),
	choiceListGet: () => [
		...Object.keys(REFERENCE_POINT_BY_NAME).map(name => ({ key: `box:${name}`, label: nameLabels[name], definition: { format: 'box', ...REFERENCE_POINT_BY_NAME[name] } })),
		{ key: 'box:fraction', label: 'Fractions of the box…', definition: { format: 'box', x: 0.25, y: 0.25 } },
	],
	keyOf: definition => `box:${referencePointNameOf(definition) ?? 'fraction'}`,
	paramListGet: definition => (referencePointNameOf(definition) ? [] : ['x', 'y'].map(axis => ({ id: axis, label: axis === 'x' ? 'Across (0 to 1)' : 'Down (0 to 1)', kind: 'number', value: round(definition[axis]), step: 0.05, next: value => ({ ...definition, [axis]: value }) }))),
	labelOf: definition => nameLabels[referencePointNameOf(definition)] ?? `${round(definition.x)}, ${round(definition.y)} of the box`,
};

const sidePointOf = (side, offset) => (side === 'top' ? { x: offset, y: 0 } : side === 'bottom' ? { x: offset, y: 1 } : side === 'left' ? { x: 0, y: offset } : { x: 1, y: offset });
export const EDGE_COUNT_MAX = 100;

// a point of an edge of a box: at a fraction along it, or a dividing point (the index-th of the
// points dividing it in count parts). Left and right edges run from the top, top and bottom edges
// from the left
export const referenceFormatEdge = {
	id: 'edge',
	label: 'Edge',
	outlineKindList: ['rect'],
	isOf: input => typeof input === 'object' && own(input, 'side'),
	read(input, field) {
		if (!SIDE_LIST.includes(input.side)) throw new Error(`${field}.side is one of ${SIDE_LIST.join(', ')}.`);
		if (own(input, 'count') || own(input, 'index')) {
			const count = numberRead(input.count, `${field}.count`, 1, EDGE_COUNT_MAX);
			const index = numberRead(input.index, `${field}.index`, 0, count);
			if (!Number.isInteger(count) || !Number.isInteger(index)) throw new Error(`${field}: index and count are whole numbers (the index-th of the points dividing the edge in count parts).`);
			return { format: 'edge', side: input.side, index, count };
		}
		return { format: 'edge', side: input.side, offset: numberRead(input.offset ?? 0.5, `${field}.offset`) };
	},
	write: definition => (definition.count !== undefined ? { side: definition.side, index: definition.index, count: definition.count } : { side: definition.side, offset: round(definition.offset) }),
	resolve(definition, { size }) {
		const fraction = sidePointOf(definition.side, definition.count !== undefined ? definition.index / definition.count : definition.offset);
		return { x: size.width * fraction.x, y: size.height * fraction.y };
	},
	choiceListGet: () => [
		{ key: 'edge:divide', label: 'A dividing point of an edge…', definition: { format: 'edge', side: 'left', index: 1, count: 3 } },
		{ key: 'edge:offset', label: 'A fraction along an edge…', definition: { format: 'edge', side: 'top', offset: 0.25 } },
	],
	keyOf: definition => (definition.count !== undefined ? 'edge:divide' : 'edge:offset'),
	paramListGet(definition) {
		const side = { id: 'side', label: 'Edge', kind: 'enum', value: definition.side, values: SIDE_LIST, valueLabels: sideLabels, next: value => ({ ...definition, side: value }) };
		if (definition.count === undefined) return [side, { id: 'offset', label: 'Along it (0 to 1)', kind: 'number', value: round(definition.offset), step: 0.05, next: value => ({ ...definition, offset: value }) }];
		return [
			side,
			{ id: 'count', label: 'Divided in', kind: 'number', value: definition.count, min: 1, max: EDGE_COUNT_MAX, step: 1, next: value => ({ ...definition, count: Math.round(value), index: Math.min(definition.index, Math.round(value)) }) },
			{ id: 'index', label: definition.side === 'left' || definition.side === 'right' ? 'Point, from the top' : 'Point, from the left', kind: 'number', value: definition.index, min: 0, max: definition.count, step: 1, next: value => ({ ...definition, index: Math.round(value) }) },
		];
	},
	labelOf: definition => (definition.count !== undefined ? `${sideLabels[definition.side].toLowerCase()} edge, point ${definition.index} of ${definition.count}` : `${sideLabels[definition.side].toLowerCase()} edge at ${round(definition.offset)}`),
};

const DIRECTION_ANGLE = { north: 0, east: 90, south: 180, west: 270 };
const directionLabels = { north: 'North', east: 'East', south: 'South', west: 'West' };
const directionOfAngle = angle => Object.keys(DIRECTION_ANGLE).find(direction => DIRECTION_ANGLE[direction] === angle) ?? null;
const angleNormalize = angle => ((angle % 360) + 360) % 360;

// a point of the outline itself, by a direction from its middle: north, east, south, west, or an
// angle clockwise from north. What every round thing shares; on a polygon and on a box, where the
// ray leaves them
export const referenceFormatAngle = {
	id: 'angle',
	label: 'Direction',
	outlineKindList: ['ellipse', 'polygon'],
	isOf: input => typeof input === 'object' && (own(input, 'direction') || own(input, 'angle')),
	read(input, field) {
		if (own(input, 'direction')) {
			if (DIRECTION_ANGLE[input.direction] === undefined) throw new Error(`${field}.direction is one of ${Object.keys(DIRECTION_ANGLE).join(', ')}.`);
			return { format: 'angle', angle: DIRECTION_ANGLE[input.direction] };
		}
		return { format: 'angle', angle: angleNormalize(numberRead(input.angle, `${field}.angle`)) };
	},
	write: definition => (directionOfAngle(definition.angle) ? { direction: directionOfAngle(definition.angle) } : { angle: round(definition.angle) }),
	resolve: (definition, { size, outline }) => outlineRayPointOf(outline, size, definition.angle),
	choiceListGet: () => [
		...Object.keys(DIRECTION_ANGLE).map(direction => ({ key: `angle:${direction}`, label: directionLabels[direction], definition: { format: 'angle', angle: DIRECTION_ANGLE[direction] } })),
		{ key: 'angle:custom', label: 'An angle from north…', definition: { format: 'angle', angle: 45 } },
	],
	keyOf: definition => `angle:${directionOfAngle(definition.angle) ?? 'custom'}`,
	paramListGet: definition => (directionOfAngle(definition.angle) ? [] : [{ id: 'angle', label: 'Degrees from north', kind: 'number', value: round(definition.angle), min: 0, max: 360, step: 5, next: value => ({ ...definition, angle: angleNormalize(value) }) }]),
	labelOf: definition => directionLabels[directionOfAngle(definition.angle)] ?? `${round(definition.angle)}° from north`,
};

const BOX_CORNER_LIST = [[0, 0], [1, 0], [1, 1], [0, 1]];
const vertexListOf = outline => (outline.kind === 'polygon' ? outline.pointList : BOX_CORNER_LIST);

// a corner of a polygon, counted clockwise from the top (of a box: from its top left corner)
export const referenceFormatVertex = {
	id: 'vertex',
	label: 'Corner',
	outlineKindList: ['polygon'],
	isOf: input => typeof input === 'object' && own(input, 'vertex'),
	read(input, field) {
		const vertex = numberRead(input.vertex, `${field}.vertex`, 1);
		if (!Number.isInteger(vertex)) throw new Error(`${field}.vertex is a whole number, 1 the first corner.`);
		return { format: 'vertex', vertex };
	},
	write: definition => ({ vertex: definition.vertex }),
	resolve(definition, { size, outline }) {
		if (outline.kind === 'ellipse') return outlineRayPointOf(outline, size, ((definition.vertex - 1) % 4) * 90);
		const list = vertexListOf(outline);
		const point = list[(definition.vertex - 1) % list.length];
		return { x: size.width * point[0], y: size.height * point[1] };
	},
	choiceListGet: outline => vertexListOf(outline).map((_point, index) => ({ key: `vertex:${index + 1}`, label: `Corner ${index + 1}`, definition: { format: 'vertex', vertex: index + 1 } })),
	keyOf: definition => `vertex:${definition.vertex}`,
	paramListGet: () => [],
	labelOf: definition => `corner ${definition.vertex}`,
};

// the words of a line of a locator: its name, else its place in its list
export const lineLabelOf = (lineList, lineId, axis) => {
	const index = lineList.findIndex(line => line.id === lineId);
	if (index < 0) return String(lineId);
	return lineList[index].name || `${axis}${index + 1}`;
};

// a point of a locator: where one of its vertical lines and one of its horizontal lines cross; with
// one of them alone, that line where the other axis has its origin; with none, the origin
export const referenceFormatLine = {
	id: 'line',
	label: 'Lines',
	outlineKindList: ['lines'],
	isOf: input => typeof input === 'object' && (own(input, 'lineX') || own(input, 'lineY')),
	read(input, field) {
		const idOf = (key) => {
			if (input[key] === undefined || input[key] === null) return null;
			if (typeof input[key] !== 'string' && typeof input[key] !== 'number') throw new Error(`${field}.${key} is the id of a line of the locator.`);
			return String(input[key]);
		};
		return { format: 'line', lineX: idOf('lineX'), lineY: idOf('lineY') };
	},
	// its origin is written with a key all the same, so it reads as of this format
	write: definition => (definition.lineX || definition.lineY ? { ...(definition.lineX ? { lineX: definition.lineX } : {}), ...(definition.lineY ? { lineY: definition.lineY } : {}) } : { lineX: null }),
	resolve(definition, { outline }) {
		if (outline.kind !== 'lines') return { x: 0, y: 0 };
		const atOf = (lineList, lineId) => {
			const extent = lineExtentOf(lineList);
			const line = lineId ? lineList.find(item => item.id === lineId) : null;
			return (line ? line.at : 0) - extent.min;
		};
		return { x: atOf(outline.xList, definition.lineX), y: atOf(outline.yList, definition.lineY) };
	},
	choiceListGet: () => [{ key: 'line', label: 'On its lines…', definition: { format: 'line', lineX: null, lineY: null } }],
	keyOf: () => 'line',
	paramListGet(definition, outline) {
		if (outline.kind !== 'lines') return [];
		const paramOf = (key, label, lineList, axis) => (lineList.length ? [{
			id: key, label, kind: 'enum', value: definition[key] ?? '', values: ['', ...lineList.map(line => line.id)],
			valueLabels: { '': 'Its origin', ...Object.fromEntries(lineList.map(line => [line.id, `${lineLabelOf(lineList, line.id, axis)} (${round(line.at)})`])) },
			next: value => ({ ...definition, [key]: value || null }),
		}] : []);
		return [...paramOf('lineX', 'Vertical line', outline.xList, 'x'), ...paramOf('lineY', 'Horizontal line', outline.yList, 'y')];
	},
	labelOf(definition, outline) {
		if (!definition.lineX && !definition.lineY) return 'its origin';
		const wordsOf = (lineId, lineList, axis) => (lineId ? lineLabelOf(lineList ?? [], lineId, axis) : null);
		return [wordsOf(definition.lineX, outline?.xList, 'x'), wordsOf(definition.lineY, outline?.yList, 'y')].filter(Boolean).join(' × ');
	},
};

export const referenceFormatListDefault = [referenceFormatBox, referenceFormatEdge, referenceFormatAngle, referenceFormatVertex, referenceFormatLine];

// ---------- reading ----------

export const REFERENCE_POINT_DEFAULT = Object.freeze({ format: 'default' });
// an id of a reference point a thing declares: not one of the nine names, which are of the box
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const referencePointIdIsValid = id => typeof id === 'string' && ID_PATTERN.test(id) && !REFERENCE_POINT_BY_NAME[id] && id !== 'default';

// a reference point as written, read: a definition { format, ... }, or null when nothing is
// written (the caller says what that means: usually the default reference point).
// formatList: the formats of the feature. isOwnAllowed: false for a definition that may not name
// another declared point (a declared point itself)
export function referencePointRead(value, field, formatList = referenceFormatListDefault, { isOwnAllowed = true } = {}) {
	if (value === undefined || value === null) return null;
	if (value === 'default') return REFERENCE_POINT_DEFAULT;
	if (typeof value === 'object' && !Array.isArray(value) && own(value, 'handle')) throw new Error(`${field}: a reference point is of the box of a thing, not a connection handle: write the side it stands on, { side: right, offset: 0.5 }.`);
	if (typeof value !== 'string' && (typeof value !== 'object' || Array.isArray(value))) throw new Error(`${field} is a reference point: a name (${Object.keys(REFERENCE_POINT_BY_NAME).join(', ')}), a definition ({ side, offset }, { angle }, …) or the id of a declared one.`);
	const format = formatList.find(item => item.isOf(value));
	if (format) return format.read(value, field);
	if (typeof value === 'string') {
		if (!referencePointIdIsValid(value)) throw new Error(`${field}: unknown reference point "${value}" (${Object.keys(REFERENCE_POINT_BY_NAME).join(', ')}, or the id of one the thing declares).`);
		if (!isOwnAllowed) throw new Error(`${field}: a declared reference point is a definition, not the id of another one ("${value}").`);
		return { format: 'own', id: value };
	}
	throw new Error(`${field}: not a reference point any format reads (${formatList.map(item => item.label.toLowerCase()).join(', ')}).`);
}

// a definition as written again; undefined for the default (the key is left out)
export function referencePointWrite(definition, formatList = referenceFormatListDefault) {
	if (!definition || definition.format === 'default') return undefined;
	if (definition.format === 'own') return definition.id;
	const format = formatList.find(item => item.id === definition.format);
	return format ? format.write(definition) : undefined;
}

// the reference points a member declares, as written: [{ id, name?, point }]
export function referencePointListRead(value, field, formatList = referenceFormatListDefault) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new Error(`${field} is a list of reference points: { id, name?, point }.`);
	const idSet = new Set();
	return value.map((item, index) => {
		if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${field}[${index}] is a mapping: { id, name?, point }.`);
		if (!referencePointIdIsValid(item.id)) throw new Error(`${field}[${index}].id is letters, digits, "_" and "-", and none of the names of the box (${Object.keys(REFERENCE_POINT_BY_NAME).join(', ')}).`);
		if (idSet.has(item.id)) throw new Error(`${field}: the reference point "${item.id}" is declared twice.`);
		idSet.add(item.id);
		const point = referencePointRead(item.point, `${field} ${item.id}.point`, formatList, { isOwnAllowed: false });
		if (!point || point.format === 'default') throw new Error(`${field} ${item.id}.point says where it is: a name, or a definition ({ side, index, count }, { angle }, …).`);
		return { id: item.id, name: typeof item.name === 'string' ? item.name : '', point };
	});
}

// ---------- resolving ----------

// the default reference point of an outline, when the thing names none: the top left corner of
// its bounding box (the one point that stays where it is when the thing is resized by its right
// or bottom edge, so an offset from it is the place of the thing); a locator: its origin
export function outlineReferenceDefaultOf(outline) {
	return outline?.kind === 'lines' ? { format: 'line', lineX: null, lineY: null } : { format: 'box', x: 0, y: 0 };
}

// what a thing gives to resolve its reference points: { outline, referencePointList, referencePointDefault }
export const REFERENCE_SUBJECT_ORIGIN = Object.freeze({ outline: OUTLINE_POINT, referencePointList: [], referencePointDefault: null });

// a definition of a thing made concrete: `own` and `default` followed to a definition of a format.
// A declared point that is gone reads as the default (the draft is validated before: this is for
// a thing changed under a definition, never a silent repair of data)
export function referencePointConcreteOf(definition, subject) {
	const outline = subject?.outline ?? OUTLINE_RECT;
	let current = definition ?? REFERENCE_POINT_DEFAULT;
	if (current.format === 'own') current = subject?.referencePointList?.find(item => item.id === current.id)?.point ?? REFERENCE_POINT_DEFAULT;
	if (current.format === 'default') {
		current = subject?.referencePointDefault ?? null;
		if (current?.format === 'own') current = subject?.referencePointList?.find(item => item.id === current.id)?.point ?? null;
		if (!current || current.format === 'default') current = outlineReferenceDefaultOf(outline);
	}
	return current;
}

// where a reference point of a thing is in its box, from its top left corner ({ x, y }, in units
// of the canvas). size: of the box; subject: the thing (its outline, its declared points, its default)
export function referencePointResolve(definition, subject, size, formatList = referenceFormatListDefault) {
	const outline = subject?.outline ?? OUTLINE_RECT;
	const concrete = referencePointConcreteOf(definition, subject);
	const format = formatList.find(item => item.id === concrete.format);
	return format ? format.resolve(concrete, { size, outline }) : { x: 0, y: 0 };
}

// a few words for a reference point of a thing: the name of a declared one, "default (…)", else
// what its format says
export function referencePointLabelOf(definition, subject, formatList = referenceFormatListDefault) {
	const outline = subject?.outline ?? OUTLINE_RECT;
	const wordsOf = (concrete) => {
		const format = formatList.find(item => item.id === concrete.format);
		return format ? format.labelOf(concrete, outline) : concrete.format;
	};
	const current = definition ?? REFERENCE_POINT_DEFAULT;
	if (current.format === 'own') {
		const declared = subject?.referencePointList?.find(item => item.id === current.id);
		return declared ? declared.name || wordsOf(declared.point) : current.id;
	}
	if (current.format === 'default') return `default (${wordsOf(referencePointConcreteOf(current, subject)).toLowerCase()})`;
	return wordsOf(current);
}

// the formats an editor offers for an outline
export const referenceFormatListOf = (outline, formatList = referenceFormatListDefault) => formatList.filter(format => format.outlineKindList.includes(outline?.kind ?? 'rect'));

// the fractions of a box where a point of it is: what keeps a place when the definition it was
// measured by goes (a declared point removed)
export function referencePointOfOffset(offset, size) {
	return { format: 'box', x: size.width ? round(offset.x / size.width) : 0, y: size.height ? round(offset.y / size.height) : 0 };
}
