import { ALargeSmall, Baseline, Bold, Highlighter, Italic, Strikethrough, Type, Underline } from '../../frontend/UICommon.js';
import { cellStyleDefine } from './cell-style-define.js';

// all style kinds the package registers for cells, by id (text/{name}), the counterpart of
// cellTokenById in cell-registry.js (doc_page_impl_edit_cell.md#style-kinds): what can be said
// of how words are drawn on any page. a host adds or replaces kinds through DocPageMdx
// config.cellStyleById, and a component brings its own to its cells (a look it names).

// a color as a spec may hold one (no comma, no bracket): #rgb, #rrggbb(aa), a name, a variable
const COLOR_REGEX = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24}|var\(--[A-Za-z0-9_-]+\))$/;
const colorCheck = (value) => (COLOR_REGEX.test(value) ? '' : 'a color is written #c0392b, or by its name (teal)');
// a size: of the text around it (120%, 1.2em) or of its own (10.5pt, 14px)
const SIZE_REGEX = /^\d*\.?\d+(%|em|rem|pt|px)$/;
const sizeCheck = (value) => (SIZE_REGEX.test(value) ? '' : 'a size is written 120%, 1.2em, 10.5pt or 14px');
// a font: one of the families below, or the name of one
const FONT_REGEX = /^[^;:{}()<>"'\\]{1,60}$/;
const fontCheck = (value) => (FONT_REGEX.test(value) ? '' : 'a font is written by its name (Noto Serif JP)');
const FONT_FAMILY_BY_VALUE = {
  sans: 'ui-sans-serif, system-ui, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif',
  serif: 'ui-serif, "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};

const TEXT_COLOR_LIST = [
  ['#111827', 'Black'], ['#6b7280', 'Grey'], ['#c0392b', 'Red'], ['#d35400', 'Orange'],
  ['#b7950b', 'Ochre'], ['#1e8449', 'Green'], ['#1f6fb2', 'Blue'], ['#7d3c98', 'Purple'],
];
const GROUND_COLOR_LIST = [
  ['#fff3bf', 'Yellow'], ['#ffd8a8', 'Orange'], ['#ffc9c9', 'Red'], ['#d3f9d8', 'Green'],
  ['#d0ebff', 'Blue'], ['#e5dbff', 'Purple'], ['#e9ecef', 'Grey'],
];

export const cellStyleBold = cellStyleDefine({ name: 'b', label: 'Bold', type: 'flag', css: { fontWeight: 700 }, Icon: Bold, shortcut: 'b' });
export const cellStyleItalic = cellStyleDefine({ name: 'i', label: 'Italic', type: 'flag', css: { fontStyle: 'italic' }, Icon: Italic, shortcut: 'i' });
export const cellStyleUnderline = cellStyleDefine({ name: 'u', label: 'Underline', type: 'flag', css: { textDecorationLine: 'underline' }, Icon: Underline, shortcut: 'u' });
export const cellStyleStrike = cellStyleDefine({ name: 's', label: 'Strikethrough', type: 'flag', css: { textDecorationLine: 'line-through' }, Icon: Strikethrough, shortcut: 'shift+x' });

export const cellStyleColor = cellStyleDefine({
  name: 'color',
  label: 'Text color',
  type: 'value',
  css: (value) => (colorCheck(value) === '' ? { color: value } : undefined),
  Icon: Baseline,
  optionList: TEXT_COLOR_LIST.map(([value, label]) => ({ value, label, swatch: value })),
  valueCheck: colorCheck,
  valuePlaceholder: '#c0392b',
});

export const cellStyleGround = cellStyleDefine({
  name: 'bg',
  label: 'Highlight',
  description: 'the color under the words',
  type: 'value',
  css: (value) => (colorCheck(value) === '' ? { backgroundColor: value } : undefined),
  Icon: Highlighter,
  optionList: GROUND_COLOR_LIST.map(([value, label]) => ({ value, label, swatch: value })),
  valueCheck: colorCheck,
  valuePlaceholder: '#fff3bf',
});

export const cellStyleSize = cellStyleDefine({
  name: 'size',
  label: 'Size',
  description: 'of the text around it (120%), or of its own (10.5pt)',
  type: 'value',
  css: (value) => (sizeCheck(value) === '' ? { fontSize: value } : undefined),
  Icon: ALargeSmall,
  optionList: ['75%', '85%', '115%', '130%', '150%', '200%'].map((value) => ({ value, label: value })),
  valueCheck: sizeCheck,
  valuePlaceholder: '10.5pt',
});

export const cellStyleFont = cellStyleDefine({
  name: 'font',
  label: 'Font',
  type: 'value',
  css: (value) => (fontCheck(value) === '' ? { fontFamily: FONT_FAMILY_BY_VALUE[value] ?? `"${value}", ${FONT_FAMILY_BY_VALUE.sans}` } : undefined),
  Icon: Type,
  optionList: [
    { value: 'sans', label: 'Sans serif (ゴシック)' },
    { value: 'serif', label: 'Serif (明朝)' },
    { value: 'mono', label: 'Monospace' },
  ],
  valueCheck: fontCheck,
  valuePlaceholder: 'Noto Serif JP',
});

export const cellStyleById = {
  'text/b': cellStyleBold,
  'text/i': cellStyleItalic,
  'text/u': cellStyleUnderline,
  'text/s': cellStyleStrike,
  'text/color': cellStyleColor,
  'text/bg': cellStyleGround,
  'text/size': cellStyleSize,
  'text/font': cellStyleFont,
};
