import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CELL_VALUE_KEY, cellStyleCaretInsertStyleGet, cellStyleCaretIsBetween, cellStyleCaretSideDefaultGet, cellStyleCaretStyleGet, cellStyleInsertRangeGet,
  cellStyleMerge, cellStyleOffsetMapGet, cellStyleRangeChange, cellStyleRangeSet, cellStyleRangeStateGet, cellStyleSegAtGet,
  cellStyleSegListNormalize, cellStyleSegListRead, cellStyleSegListSlice, cellStyleSegListSplice, cellStyleSpecRead, cellStyleSpecWrite,
  cellStyleTextBareGet, cellStyleTextIsStyled, cellStyleTextWrite, cellStyleValueKeyGet, cellStyleValueOffsetMapGet, cellStyleValueTextKeptGet,
} from './doc-cell-style.js';
import { cellLinkMatchList, cellRangeRead, cellTextConcat, cellTextParse, cellTextPlainGet, cellTextRangeReplace, cellTextSlice, cellTextStyledParse } from './doc-cell.js';
import { cellTokenDefine } from '../../../comp-doc/cell/cell-define.js';
import { cellStyleByIdBuild, cellStyleCssGet, cellStyleDefine, cellStyleListResolve, cellStyleShortcutKindGet } from '../../../comp-doc/cell/cell-style-define.js';

const kindQuery = cellTokenDefine({ name: 'query', brace: { sigil: '' }, read: (body) => ({ query: body }), textGet: (token) => `<${token.data.query}>` });
const kindLink = cellTokenDefine({ name: 'link', match: cellLinkMatchList, textGet: (token) => token.data.label });
const kindList = [kindQuery, kindLink];
const shapeOf = (segList) => segList.map((seg) => [seg.text, cellStyleSpecWrite(seg.style)]);
const tokenRangeListOf = (text) => cellTextParse(text, kindList).filter((part) => part.type === 'token');

test('a spec is written one way, and read back', () => {
  assert.equal(cellStyleSpecWrite({ color: '#c0392b', i: true, b: true, size: '120%' }), 'b,i,color=#c0392b,size=120%');
  assert.deepEqual(cellStyleSpecRead('i, b ,color = #c0392b'), { i: true, b: true, color: '#c0392b' });
  // what cannot be written is left out: no value, a value that would end the spec
  assert.equal(cellStyleSpecWrite({ b: false, color: null, bg: '', font: 'a,b]|c' }), 'font=abc');
  assert.deepEqual(cellStyleSpecRead(''), {});
  // a key that is no word: no spec, so the words stay text
  assert.equal(cellStyleSpecRead('Some Label'), undefined);
  assert.deepEqual(cellStyleMerge({ b: true, color: 'red' }, { color: null, i: true }), { b: true, i: true });
});

test('a text is read into segments, and written back as it was', () => {
  const text = '{{name/jp/first}} は [[強み|b,color=#c0392b]] です';
  const segList = cellStyleSegListRead(text);
  assert.deepEqual(shapeOf(segList), [['{{name/jp/first}} は ', ''], ['強み', 'b,color=#c0392b'], [' です', '']]);
  assert.equal(cellStyleTextBareGet(text), '{{name/jp/first}} は 強み です');
  assert.equal(cellStyleTextWrite(segList), text);
  assert.equal(cellStyleTextIsStyled(text), true);
  // a text without a segment is its own bare text
  assert.equal(cellStyleTextIsStyled('[a](b.md) [[x]] {{y}}'), false);
  assert.deepEqual(shapeOf(cellStyleSegListRead('[a](b.md) [[x]] {{y}}')), [['[a](b.md) [[x]] {{y}}', '']]);
  assert.deepEqual(cellStyleSegListRead(''), []);
});

test('the words of a segment hold any character, escaped where it would end them', () => {
  const segList = [{ text: 'a [b] c|d \\ e', style: { b: true } }];
  const text = cellStyleTextWrite(segList);
  assert.equal(text, '[[a \\[b\\] c\\|d \\\\ e|b]]');
  assert.deepEqual(shapeOf(cellStyleSegListRead(text)), [['a [b] c|d \\ e', 'b']]);
  // nothing is an escape outside a segment: a backslash before one stays a backslash
  assert.deepEqual(shapeOf(cellStyleSegListRead('C:\\[[x|i]]')), [['C:\\', ''], ['x', 'i']]);
});

test('plain words that would read as a segment are kept as words', () => {
  const segList = [{ text: 'see [[Page|label]] here', style: {} }, { text: 'bold', style: { b: true } }];
  const text = cellStyleTextWrite(segList);
  assert.equal(text, 'see [[\\[\\[Page\\|label\\]\\]|]] here[[bold|b]]');
  assert.deepEqual(shapeOf(cellStyleSegListRead(text)), [['see [[Page|label]] here', ''], ['bold', 'b']]);
  // what only looks like one (no spec) needs nothing
  assert.equal(cellStyleTextWrite([{ text: '[[Page|Some Label]] [[x]]', style: {} }]), '[[Page|Some Label]] [[x]]');
});

test('the segments as kept: neighbours joined, no style on a line break or a token', () => {
  assert.deepEqual(shapeOf(cellStyleSegListNormalize([{ text: 'a', style: { b: true } }, { text: '', style: { i: true } }, { text: 'b', style: { b: true } }, { text: 'c', style: {} }])), [['ab', 'b'], ['c', '']]);
  // a line break cuts a segment: each line reads alone
  const lines = cellStyleSegListNormalize([{ text: 'one\ntwo', style: { b: true } }]);
  assert.deepEqual(shapeOf(lines), [['one', 'b'], ['\n', ''], ['two', 'b']]);
  assert.equal(cellStyleTextWrite(lines), '[[one|b]]\n[[two|b]]');
  // a token inside styled words: a segment on each side of it
  const bare = 'a {{x}} b';
  const cut = cellStyleSegListNormalize([{ text: bare, style: { b: true } }], { rangePlainList: tokenRangeListOf(bare) });
  assert.deepEqual(shapeOf(cut), [['a ', 'b'], ['{{x}}', ''], [' b', 'b']]);
});

test('a style set over a range: the part of a segment reached has both styles', () => {
  // A over "bcd", then C from the middle of it to outside it
  const start = cellStyleRangeChange([{ text: 'abcdefg', style: {} }], 1, 4, { b: true });
  assert.deepEqual(shapeOf(start), [['a', ''], ['bcd', 'b'], ['efg', '']]);
  const both = cellStyleRangeChange(start, 2, 6, { color: 'red' });
  assert.deepEqual(shapeOf(both), [['a', ''], ['b', 'b'], ['cd', 'b,color=red'], ['ef', 'color=red'], ['g', '']]);
  // taken away again: the neighbours join
  assert.deepEqual(shapeOf(cellStyleRangeChange(both, 2, 6, { color: null })), [['a', ''], ['bcd', 'b'], ['efg', '']]);
  assert.deepEqual(shapeOf(cellStyleRangeSet(both, 0, 7, {})), [['abcdefg', '']]);
  // over tokens: the words between them get it, each on its own
  const bare = 'a{{x}}b{{y}}c';
  const styled = cellStyleSegListNormalize(cellStyleRangeChange([{ text: bare, style: {} }], 0, bare.length, { i: true }), { rangePlainList: tokenRangeListOf(bare) });
  assert.equal(cellStyleTextWrite(styled), '[[a|i]]{{x}}[[b|i]]{{y}}[[c|i]]');
});

test('what a range has of style: the keys its words share', () => {
  const bare = 'ab{{x}}cd\nef';
  const segList = cellStyleSegListNormalize(cellStyleRangeChange(cellStyleRangeChange([{ text: bare, style: {} }], 0, bare.length, { b: true }), 0, 2, { color: 'red' }), { rangePlainList: tokenRangeListOf(bare) });
  const rangeSkipList = tokenRangeListOf(bare);
  // the token and the line break do not count against bold
  assert.deepEqual(cellStyleRangeStateGet(segList, 0, bare.length, { rangeSkipList }), { styleCommon: { b: true }, keyAnyList: ['b', 'color'], isStylable: true });
  assert.deepEqual(cellStyleRangeStateGet(segList, 0, 2, { rangeSkipList }).styleCommon, { b: true, color: 'red' });
  assert.equal(cellStyleRangeStateGet(segList, 2, 7, { rangeSkipList }).isStylable, false);
  assert.deepEqual(cellStyleSegAtGet(segList, 1), { start: 0, end: 2, style: { b: true, color: 'red' } });
});

test('segments cut and replaced', () => {
  const segList = cellStyleSegListRead('ab[[cdef|b]]gh');
  assert.deepEqual(shapeOf(cellStyleSegListSlice(segList, 1, 4)), [['b', ''], ['cd', 'b']]);
  assert.deepEqual(shapeOf(cellStyleSegListSplice(segList, 3, 5, [{ text: '{{x}}', style: {} }])), [['ab', ''], ['c', 'b'], ['{{x}}', ''], ['f', 'b'], ['gh', '']]);
  assert.deepEqual(shapeOf(cellStyleSegListSplice(segList, 2, 6)), [['abgh', '']]);
});

test('the caret between two segments: its side says whose style is typed', () => {
  const segList = cellStyleSegListRead('abc[[DEF|b]]\n[[GH|i]]{{x}}');
  const bare = 'abcDEF\nGH{{x}}';
  const rangeSkipList = tokenRangeListOf(bare);
  const at = (offset) => cellStyleCaretStyleGet(segList, offset, { rangeSkipList });
  // abc|DEF: with the word before it by default, the other side an arrow away
  assert.deepEqual(at(3), { before: {}, after: { b: true } });
  assert.equal(cellStyleCaretSideDefaultGet(at(3)), 'before');
  assert.equal(cellStyleCaretIsBetween(at(3)), true);
  assert.deepEqual(cellStyleCaretInsertStyleGet(at(3), 'after'), { b: true });
  // inside a segment nothing differs
  assert.equal(cellStyleCaretIsBetween(at(5)), false);
  // DEF| at the end of its line: bold goes on; the other side is no style
  assert.deepEqual(at(6), { before: { b: true }, after: undefined });
  assert.deepEqual(cellStyleCaretInsertStyleGet(at(6), 'after'), {});
  // the start of a line: with the word after it
  assert.deepEqual(at(7), { before: undefined, after: { i: true } });
  assert.equal(cellStyleCaretSideDefaultGet(at(7)), 'after');
  // before a token: no word after it
  assert.deepEqual(at(9), { before: { i: true }, after: undefined });
  assert.deepEqual(at(bare.length), { before: undefined, after: undefined });
});

test('what was typed is found from the caret it left', () => {
  // a character typed between two equal ones is the one before the caret
  assert.deepEqual(cellStyleInsertRangeGet('aa', 'aaa', 2), { start: 1, end: 2, lengthOld: 0 });
  assert.deepEqual(cellStyleInsertRangeGet('abc', 'abXYc', 4), { start: 2, end: 4, lengthOld: 0 });
  // a selection typed over
  assert.deepEqual(cellStyleInsertRangeGet('abcdef', 'aXf', 2), { start: 1, end: 2, lengthOld: 4 });
  // a deletion inserts nothing
  assert.deepEqual(cellStyleInsertRangeGet('abc', 'ac', 1), { start: 1, end: 1, lengthOld: 1 });
  // the caret is not at the end of what changed
  assert.equal(cellStyleInsertRangeGet('abc', 'aXbc', 1), undefined);
});

test('offsets of the text as kept and of its bare text', () => {
  const text = 'ab[[c\\]d|b]]e';
  const map = cellStyleOffsetMapGet(text);
  assert.equal(map.lengthBare, 6);
  // inside the markup: the nearest word
  assert.deepEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13].map(map.bareOf), [0, 2, 2, 2, 3, 3, 4, 5, 5, 5, 6]);
  assert.equal(map.rawOf(2, 'before'), 2);
  assert.equal(map.rawOf(2), 4);
  assert.equal(map.rawOf(5, 'before'), 8);
  assert.equal(map.rawOf(6), 13);
  assert.equal(cellStyleOffsetMapGet('plain').rawOf(3), 3);
});

// ---------- with the tokens of a cell (doc-cell.js) ----------

test('a text as kept is parsed into words with their styles and tokens without any', () => {
  const text = '[[山田 {{name/jp/first}} さん|b]] · [Guide](a.md)';
  const partList = cellTextStyledParse(text, kindList);
  assert.deepEqual(partList.map((part) => (part.type === 'token' ? [part.name, part.raw, part.start] : [part.text, cellStyleSpecWrite(part.style), part.start])), [
    ['山田 ', 'b', 0], ['query', '{{name/jp/first}}', 3], [' さん', 'b', 20], [' · ', '', 23], ['link', '[Guide](a.md)', 26],
  ]);
  // plain words carry no style key, as a text without styles has none
  assert.equal('style' in partList[3], false);
  assert.equal(cellTextPlainGet(partList, (part) => part.kind.textGet?.(part)), '山田 <name/jp/first> さん · Guide');
  assert.deepEqual(cellTextStyledParse('{{a}} b', kindList), cellTextParse('{{a}} b', kindList));
});

test('a text as kept changed by bare offsets keeps its styles whole', () => {
  const text = 'ab[[cdef|b]]gh';
  // from inside the segment to outside it
  assert.equal(cellTextRangeReplace(text, 4, 7, '{{x}}'), 'ab[[cd|b]]{{x}}h');
  assert.equal(cellTextRangeReplace(text, 3, 5, ''), 'ab[[cf|b]]gh');
  assert.equal(cellTextRangeReplace('abc', 1, 2, 'X'), 'aXc');
  assert.equal(cellTextSlice(text, 1, 4), 'b[[cd|b]]');
  assert.equal(cellTextSlice(text, 6), 'gh');
  assert.equal(cellTextSlice('abc', 1), 'bc');
  assert.equal(cellTextConcat('a[[b|i]]', '[[c|i]]d'), 'a[[bc|i]]d');
  assert.equal(cellTextConcat('a', 'b'), 'ab');
  // a selection of words only, read in the bare text
  const bare = cellStyleTextBareGet(text);
  assert.deepEqual(cellRangeRead(cellTextParse(bare, kindList), 1, 4, bare), { text: 'bcd', isPlain: true });
});

// ---------- style kinds ----------

test('style kinds: defined, resolved for a cell, drawn as css', () => {
  const bold = cellStyleDefine({ name: 'b', type: 'flag', css: { fontWeight: 700 }, shortcut: 'B' });
  const under = cellStyleDefine({ name: 'u', type: 'flag', css: { textDecorationLine: 'underline' } });
  const strike = cellStyleDefine({ name: 's', type: 'flag', css: { textDecorationLine: 'line-through' }, shortcut: 'shift+x' });
  const color = cellStyleDefine({ name: 'color', type: 'value', css: (value) => (/^#/.test(value) ? { color: value } : undefined) });
  const note = cellStyleDefine({ name: 'note', label: 'Note', css: { color: '#6b7280', fontSize: '85%' } });
  const boldOwn = cellStyleDefine({ name: 'b', css: { fontWeight: 600 } });
  const styleById = cellStyleByIdBuild({ 'text/b': bold, 'text/u': under, 'text/s': strike, 'text/color': color }, { 'text/u': null });
  assert.deepEqual(Object.keys(styleById), ['text/b', 'text/s', 'text/color']);
  // an own kind takes the place of the page's of its name; the others follow
  assert.deepEqual(cellStyleListResolve({ styleOwnList: [note, boldOwn], styleById }), [boldOwn, strike, color, note]);
  assert.deepEqual(cellStyleListResolve({ styleOwnList: [note], styleById, styleIdList: ['text/color'] }), [color, note]);
  const styleList = [bold, under, strike, color, note];
  assert.deepEqual(cellStyleCssGet({ b: true, u: true, s: true, color: '#c0392b' }, styleList), { fontWeight: 700, color: '#c0392b', textDecorationLine: 'line-through underline' });
  // a key no kind knows, and a value that is none of its kind, draw nothing
  assert.deepEqual(cellStyleCssGet({ glow: true, color: 'javascript' }, styleList), {});
  assert.equal(cellStyleShortcutKindGet(styleList, { key: 'b', shiftKey: false }), bold);
  assert.equal(cellStyleShortcutKindGet(styleList, { key: 'X', shiftKey: true }), strike);
  assert.equal(cellStyleShortcutKindGet(styleList, { key: 'k', shiftKey: false }), undefined);
  assert.throws(() => cellStyleDefine({ name: 'two words', css: {} }));
  assert.throws(() => cellStyleDefine({ name: 'v', type: 'value', css: {} }));
});

test('the store: a cell reads the styles of its texts, or not', async () => {
  const { DocCellStore } = await import('../store/DocCellStore.js');
  const bold = cellStyleDefine({ name: 'b', type: 'flag', css: { fontWeight: 700 } });
  const store = new DocCellStore({ cellStyleById: { 'text/b': bold } });
  const cell = store.cellBuild({ tokenList: [kindQuery] });
  const text = '[[a|b]] {{x}}';
  assert.equal(cell.isStyled, true);
  assert.deepEqual(cell.parse(text).map((part) => part.start), [0, 1, 2]);
  assert.equal(cell.parse(text), cell.parse(text));
  assert.equal(cell.bareGet(text), 'a {{x}}');
  assert.equal(cell.textGet(text), 'a <x>');
  assert.deepEqual(cell.styleCssGet({ b: true }), { fontWeight: 700 });
  // what is typed in its surface is a bare text: nothing of it is a segment
  assert.equal(cell.tokenParse('[[a|b]]')[0].text, '[[a|b]]');
  // a cell of a value that is no prose: the text is what it is
  const cellPlain = store.cellBuild({ tokenList: [kindQuery], isStyled: false });
  assert.equal(cellPlain.textGet(text), '[[a|b]] <x>');
  assert.deepEqual(cellPlain.styleList, []);
  store.styleRawSet(true);
  assert.equal(store.isStyleRaw, true);
});

// ---------- a token typed as its value (doc_page_impl_edit_cell.md#a-token-typed-as-its-value) ----------

const valueOf = (key) => ({ [CELL_VALUE_KEY]: key });
const rawByKey = { v1: '{{address/jp/postal}}', v2: '{{name/jp/last}}' };
const rawOf = (key) => rawByKey[key];

test('the words of a value are a segment of their own: never cut, never joined to words, kept while empty', () => {
  assert.equal(cellStyleValueKeyGet(valueOf('v1')), 'v1');
  assert.equal(cellStyleValueKeyGet({ b: true }), '');
  const segList = cellStyleSegListNormalize([
    { text: '〒', style: {} }, { text: '100-0001', style: valueOf('v1') }, { text: '', style: valueOf('v2') }, { text: 'a\n{{x}}', style: valueOf('v1') },
  ], { rangePlainList: [{ start: 12, end: 17 }] });
  // a line break and words that read as a token stay in the value; the empty one stays where it stood
  assert.deepEqual(shapeOf(segList), [['〒', ''], ['100-0001', 'cell-value=v1'], ['', 'cell-value=v2'], ['a\n{{x}}', 'cell-value=v1']]);
  // a text put at the caret of an empty value comes before it; the empty value stays
  assert.deepEqual(shapeOf(cellStyleSegListSplice([{ text: 'ab', style: {} }, { text: '', style: valueOf('v2') }], 2, 2, [{ text: 'X', style: {} }])), [['abX', ''], ['', 'cell-value=v2']]);
  // its words take no style, and are no words of a style asked about
  assert.equal(cellStyleRangeStateGet([{ text: 'ab', style: { b: true } }, { text: 'cd', style: valueOf('v1') }], 0, 4).styleCommon.b, true);
  assert.equal(cellStyleRangeStateGet([{ text: 'cd', style: valueOf('v1') }], 0, 2).isStylable, false);
  // the caret at the end of a value goes on in it; at its start with what is before it
  const caretEnd = cellStyleCaretStyleGet([{ text: '山田', style: valueOf('v2') }, { text: ' 様', style: {} }], 2);
  assert.equal(cellStyleCaretIsBetween(caretEnd), true);
  assert.equal(cellStyleValueKeyGet(cellStyleCaretInsertStyleGet(caretEnd, cellStyleCaretSideDefaultGet(caretEnd))), 'v2');
});

test('a typed text with values is kept with its tokens, its offsets brought over both ways', () => {
  const segList = [{ text: '〒', style: {} }, { text: '100-0001', style: valueOf('v1') }, { text: ' 東京', style: { b: true } }];
  assert.equal(cellStyleValueTextKeptGet(segList, rawOf), '〒{{address/jp/postal}}[[ 東京|b]]');
  // a cell whose words take no style keeps words as they are
  assert.equal(cellStyleValueTextKeptGet([{ text: '[[a|b]] ', style: {} }, { text: '山田', style: valueOf('v2') }], rawOf, { isStyled: false }), '[[a|b]] {{name/jp/last}}');
  // a value whose words were cut apart is one token, where its words first stand; an empty value too
  assert.equal(cellStyleValueTextKeptGet([{ text: '山', style: valueOf('v2') }, { text: '\n', style: {} }, { text: '田', style: valueOf('v2') }], rawOf), '{{name/jp/last}}\n');
  assert.equal(cellStyleValueTextKeptGet([{ text: '', style: valueOf('v2') }], rawOf), '{{name/jp/last}}');
  const map = cellStyleValueOffsetMapGet(segList, rawOf);
  assert.deepEqual(map.valueRangeList, [{ key: 'v1', start: 1, end: 9, bareStart: 1, bareEnd: 22 }]);
  // in the words of a value: the start of its token; at their end: its end
  assert.deepEqual([map.bareOf(0), map.bareOf(1), map.bareOf(5), map.bareOf(9), map.bareOf(10)], [0, 1, 1, 22, 23]);
  assert.deepEqual([map.shownOf(1), map.shownOf(10), map.shownOf(22), map.shownOf(23)], [1, 1, 9, 10]);
});

