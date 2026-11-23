// The style of a node (card-diagram-impl.md#the-style-of-a-node): colors an author gives a node
// beside its data, the way a line has `style.stroke`. Pure: read, validated, and turned into the
// CSS variables its card reads.
//
//   node.style     { fill?: color, stroke?: color }
//                  fill    the background of the node (a card's body, a block's tint, a shape)
//                  stroke  its edge (a block's frame, a shape's outline)
//   color          a tone of the palette (slate, blue, teal, green, amber, red, violet), none, or
//                  a color of the author's own (#rgb, #rrggbb, #rrggbbaa)
//
// A kind draws the keys its contract lists (`contract.styleList`); a kind with a schema is drawn by
// the generic table card, which draws a fill, so it draws one unless it says otherwise. A key a kind
// does not draw is refused when the diagram is read, naming the node.
//
// The engine sets the variables on the box of the node's content (nodeStyleVarsOf), the same in
// every renderer (the canvas, a diagram without a canvas, a scene embedded in a card); a card uses
// them in its own css, falling back to its own look: background: var(--doc-node-fill, <its own>).
// The box resets them (DiagramER.css), so a node inside another (an embedded scene) never takes the
// fill of the card it is drawn in. A tone follows the theme of the page (light and dark tints,
// --doc-vis-fill-{tone}); a color of the author's own is the same in both, and the words on it take
// the ink that reads on it (colorInkOf).

export const NODE_TONE_LIST = ['slate', 'blue', 'teal', 'green', 'amber', 'red', 'violet'];
export const NODE_STYLE_KEY_LIST = ['fill', 'stroke'];
const NODE_STYLE_LABEL = { fill: 'Fill', stroke: 'Edge' };

const COLOR_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const toneLabelOf = tone => tone[0].toUpperCase() + tone.slice(1);

// a color as written: a tone, none, or a hex color. Throws naming the field
export function colorRead(value, field) {
	if (typeof value !== 'string' || !(NODE_TONE_LIST.includes(value) || value === 'none' || COLOR_HEX_RE.test(value))) {
		throw new Error(`${field} is a tone (${NODE_TONE_LIST.join(', ')}), none, or a color like #fde68a.`);
	}
	return value;
}

export const colorIsHex = value => typeof value === 'string' && COLOR_HEX_RE.test(value);

// the keys of node.style a kind draws: what its contract lists; a kind with a schema (drawn by the
// table card) a fill
export function nodeStyleKeyListOf(kind) {
	if (!kind) return [];
	return kind.contract?.styleList ?? (kind.schema ? ['fill'] : []);
}

export const nodeStyleLabelOf = key => NODE_STYLE_LABEL[key] ?? key;

// node.style read for a node of a kind (kind undefined: a node drawn by a registered component,
// which draws none). Answers the style as written, or undefined when there is none
export function nodeStyleRead(style, id, kind, type) {
	if (style === undefined) return undefined;
	if (!style || typeof style !== 'object' || Array.isArray(style)) throw new Error(`${id}.style must be a mapping.`);
	const keyList = nodeStyleKeyListOf(kind);
	for (const [key, value] of Object.entries(style)) {
		if (!NODE_STYLE_KEY_LIST.includes(key)) throw new Error(`${id}.style: unknown key "${key}" (${NODE_STYLE_KEY_LIST.join(', ')}).`);
		if (!keyList.includes(key)) throw new Error(`${id}: a ${type ?? 'component'} node draws no ${key}${keyList.length ? ` (it draws ${keyList.join(', ')})` : ''}.`);
		colorRead(value, `${id}.style.${key}`);
	}
	return Object.keys(style).length ? style : undefined;
}

// the CSS value of a color of a style key
export function colorCssOf(value, key = 'fill') {
	if (value === 'none') return 'transparent';
	if (NODE_TONE_LIST.includes(value)) return `var(--doc-vis-${key === 'stroke' ? 'stroke' : 'fill'}-${value})`;
	return value;
}

// [red, green, blue, alpha] of a hex color, 0..1
export function colorHexRgbaOf(value) {
	if (!colorIsHex(value)) return null;
	let hex = value.slice(1);
	if (hex.length === 3) hex = hex.split('').map(char => char + char).join('');
	const channel = index => parseInt(hex.slice(index, index + 2), 16) / 255;
	return [channel(0), channel(2), channel(4), hex.length === 8 ? channel(6) : 1];
}

// the ink that reads on a color of the author's own: light words on a dark fill, dark on a light
// one; none for a tone (the theme's words read on it) or a fill one sees through
export function colorInkOf(value) {
	const rgba = colorHexRgbaOf(value);
	if (!rgba || rgba[3] < 0.5) return null;
	const linear = channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
	const luminance = 0.2126 * linear(rgba[0]) + 0.7152 * linear(rgba[1]) + 0.0722 * linear(rgba[2]);
	return luminance < 0.36 ? { ink: '#f8fafc', inkMuted: '#cbd5e1' } : { ink: '#0f172a', inkMuted: '#475569' };
}

// the CSS variables of a node's style, for the box of its content; undefined when it has none
export function nodeStyleVarsOf(node) {
	const style = node?.style;
	if (!style || (style.fill === undefined && style.stroke === undefined)) return undefined;
	const vars = {};
	if (style.fill !== undefined) {
		vars['--doc-node-fill'] = colorCssOf(style.fill, 'fill');
		const ink = colorInkOf(style.fill);
		if (ink) Object.assign(vars, { color: ink.ink, '--color-fd-foreground': ink.ink, '--color-fd-muted-foreground': ink.inkMuted, '--doc-node-ink': ink.ink });
	}
	if (style.stroke !== undefined) vars['--doc-node-stroke'] = colorCssOf(style.stroke, 'stroke');
	return vars;
}

// the tones as colors of a light page (the fill, the stroke), where a picker starts from a tone
const TONE_HEX = {
	fill: { slate: '#f1f5f9', blue: '#dbeafe', teal: '#ccfbf1', green: '#dcfce7', amber: '#fef3c7', red: '#ffe4e6', violet: '#ede9fe' },
	stroke: { slate: '#64748b', blue: '#2563eb', teal: '#0d9488', green: '#16a34a', amber: '#d97706', red: '#dc2626', violet: '#7c3aed' },
};

// the swatches the edit card offers for a key of a node's style: the tones, drawn as they will look
export const nodeStyleSwatchListOf = key => NODE_TONE_LIST.map(tone => ({ value: tone, label: toneLabelOf(tone), css: colorCssOf(tone, key), edgeCss: `var(--doc-vis-stroke-${tone})`, hex: TONE_HEX[key === 'stroke' ? 'stroke' : 'fill'][tone] }));

// the swatches of a line's color: the strokes of the tones, as colors (a line's stroke is a color
// of SVG, written as it is)
export const LINE_STROKE_SWATCH_LIST = [
	{ value: '#64748b', label: 'Slate' }, { value: '#2563eb', label: 'Blue' }, { value: '#0d9488', label: 'Teal' }, { value: '#16a34a', label: 'Green' },
	{ value: '#d97706', label: 'Amber' }, { value: '#dc2626', label: 'Red' }, { value: '#7c3aed', label: 'Violet' },
].map(swatch => ({ ...swatch, css: swatch.value, hex: swatch.value }));

// a color from a picker (#RRGGBBAA) as it is written: lower case, the alpha left out when full
export function colorHexNormalize(value) {
	const text = String(value ?? '').trim().toLowerCase();
	if (/^#[0-9a-f]{6}ff$/.test(text)) return text.slice(0, 7);
	return text;
}
