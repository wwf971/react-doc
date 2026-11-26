import { cardIconTextStrip } from '../card-diagram/CardIconTokenData.js';

// The kinds the parametric canvas draws with (card-diagram-parametric-canvas.md#drawing-kinds): a
// shape and a text. Pure: their data read, the outline of a shape, what a search finds.
//
//   shape   { shape: rect | rounded | ellipse | diamond | triangle | hexagon | parallelogram,
//             text?, textSize?: s | m | l, strokeWidth?, isDashed? }
//           drawn to the size of its node; filled and edged by the style of the node (style.fill,
//           style.stroke: DiagramNodeStyle.js), the words in its middle
//   text    { text, textSize?: s | m | l | xl, weight?: normal | bold, align?: left | center | right, tone? }
//           words standing by themselves; their box by the size mode of the node (fit: as wide as
//           they are; wrap: a width they wrap at; DiagramNodeResize.js); style.fill puts a color behind them
//
// The words of both are a text of the cell editing kit: an icon is a token among them ({{icon:NAME}}).
export const SHAPE_LIST = ['rect', 'rounded', 'ellipse', 'diamond', 'triangle', 'hexagon', 'parallelogram'];
export const SHAPE_LABEL = { rect: 'Rectangle', rounded: 'Rounded rectangle', ellipse: 'Ellipse', diamond: 'Diamond', triangle: 'Triangle', hexagon: 'Hexagon', parallelogram: 'Parallelogram' };
export const TEXT_SIZE_LIST = ['s', 'm', 'l', 'xl'];
export const TEXT_SIZE_LABEL = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Title' };
const TEXT_TONE_LIST = ['', 'slate', 'blue', 'teal', 'green', 'amber', 'red', 'violet'];
export const STROKE_WIDTH_MAX = 12;

export function shapeNormalize(data) {
	if (!SHAPE_LIST.includes(data.shape)) throw new Error(`A shape is one of ${SHAPE_LIST.join(', ')} (shape).`);
	if (data.text !== undefined && typeof data.text !== 'string') throw new Error('The words of a shape are a text.');
	if (data.textSize !== undefined && !TEXT_SIZE_LIST.includes(data.textSize)) throw new Error(`The size of the words of a shape is one of ${TEXT_SIZE_LIST.join(', ')}.`);
	if (data.strokeWidth !== undefined && !(Number.isFinite(data.strokeWidth) && data.strokeWidth >= 0 && data.strokeWidth <= STROKE_WIDTH_MAX)) throw new Error(`The edge of a shape is 0 to ${STROKE_WIDTH_MAX} wide (strokeWidth).`);
	if (data.isDashed !== undefined && typeof data.isDashed !== 'boolean') throw new Error('isDashed of a shape is true or false.');
	return data;
}

export function textNodeNormalize(data) {
	if (typeof data.text !== 'string') throw new Error('A text node needs its words (text).');
	if (data.textSize !== undefined && !TEXT_SIZE_LIST.includes(data.textSize)) throw new Error(`The size of a text is one of ${TEXT_SIZE_LIST.join(', ')}.`);
	if (data.weight !== undefined && !['normal', 'bold'].includes(data.weight)) throw new Error('The weight of a text is normal or bold.');
	if (data.align !== undefined && !['left', 'center', 'right'].includes(data.align)) throw new Error('A text is aligned left, center or right.');
	if (data.tone !== undefined && !TEXT_TONE_LIST.includes(data.tone)) throw new Error(`The tone of a text is one of ${TEXT_TONE_LIST.filter(Boolean).join(', ')}.`);
	return data;
}

// the outline of a shape in a box of 100 × 100 (an SVG drawn without keeping its aspect): the points
// of a polygon, or null for a shape drawn otherwise (a rectangle, an ellipse)
export function shapePointListOf(shape) {
	switch (shape) {
		case 'diamond': return [[50, 0], [100, 50], [50, 100], [0, 50]];
		case 'triangle': return [[50, 0], [100, 100], [0, 100]];
		case 'hexagon': return [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]];
		case 'parallelogram': return [[20, 0], [100, 0], [80, 100], [0, 100]];
		default: return null;
	}
}

// the outline of a shape node, for whoever needs the shape of its boundary (the reference points of
// the parametric canvas: an ellipse offers directions, a polygon its corners): a round shape, a
// polygon with its corners as fractions of its box, else a box
export function shapeOutlineOf(node) {
	const shape = node?.data?.shape;
	if (shape === 'ellipse') return { kind: 'ellipse' };
	const pointList = shapePointListOf(shape);
	return pointList ? { kind: 'polygon', pointList: pointList.map(point => [point[0] / 100, point[1] / 100]) } : { kind: 'rect' };
}

// what a search finds in a shape or a text: its words, never its icons
export function shapeTextSearchMatch(node, helper) {
	return helper.test(cardIconTextStrip(node.data?.text ?? '')) ? { partList: [], childList: [], isWhole: true } : null;
}

export const shapePropertyList = [
	{ id: 'shape', label: 'Shape', kind: 'enum', values: SHAPE_LIST, valueLabels: SHAPE_LABEL },
	{ id: 'textSize', label: 'Words', kind: 'enum', valueDefault: 'm', values: TEXT_SIZE_LIST.slice(0, 3), valueLabels: TEXT_SIZE_LABEL },
	{ id: 'strokeWidth', label: 'Edge width', kind: 'number', valueDefault: 1.5, min: 0, max: STROKE_WIDTH_MAX, step: 0.5 },
	{ id: 'isDashed', label: 'Dashed edge', kind: 'bool' },
];

export const textNodePropertyList = [
	{ id: 'textSize', label: 'Size', kind: 'enum', valueDefault: 'm', values: TEXT_SIZE_LIST, valueLabels: TEXT_SIZE_LABEL },
	{ id: 'weight', label: 'Weight', kind: 'enum', valueDefault: 'normal', values: ['normal', 'bold'], valueLabels: { normal: 'Normal', bold: 'Bold' } },
	{ id: 'align', label: 'Align', kind: 'enum', valueDefault: 'left', values: ['left', 'center', 'right'], valueLabels: { left: 'Left', center: 'Center', right: 'Right' } },
	{ id: 'tone', label: 'Color', kind: 'enum', valueDefault: '', values: TEXT_TONE_LIST, valueLabels: { '': 'Of the page', slate: 'Slate', blue: 'Blue', teal: 'Teal', green: 'Green', amber: 'Amber', red: 'Red', violet: 'Violet' } },
];
