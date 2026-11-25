// The styles of a cell text: pure functions of the cell editing kit
// (design: doc_page_impl_edit_cell.md#styles), shared by its grammar
// (doc-cell.js), its store, its components and tests. No store, no React.
//
// words of a cell text may be drawn in a style of their own: bold, a color,
// a size. the text stays one string, and a stretch of styled words is
// written where it stands:
//
//   {{name/jp/first}} は [[強み|b,color=#c0392b]] です
//   └─── a token ────┘    └── a styled segment ──┘
//
//   [[words|spec]]   words: what is read; a backslash before one of \ [ ] | writes that character
//                    spec: how the words are drawn, written as the parameters of a brace token
//                    are: "key=value" separated by commas, a key alone being true (b, i)
//   [[words|]]       no style: the words as they are. how words that would otherwise read as a
//                    segment are kept (the writer does it, nobody types it)
//
// what a key means (b: bold) is not decided here: a style kind says it
// (cellStyleDefine, comp-doc/cell/cell-style-define.js), and a key no kind
// knows is kept as written.
//
// the string is how a text is kept. what is worked on is its model, a list
// of segments covering the text in order:
//
//   segList: [{ text: 'は ', style: {} }, { text: '強み', style: { b: true, color: '#c0392b' } }, …]
//
//   style {}         plain: words, tokens (written out), line breaks
//   bare text        the texts of the segments joined: the text without its style markup. every
//                    offset of the kit counts in it (a token's start, a selection), so nothing
//                    else ever sees the markup
//
// a styled segment holds no line break and no token: the writer cuts it
// there (cellStyleSegListNormalize), so a text cut into lines is lines that
// each read alone, and a token is never drawn in a style.

export const CELL_STYLE_OPEN = '[[';
export const CELL_STYLE_CLOSE = ']]';
// what parts the words of a segment from how they are drawn
export const CELL_STYLE_MARK = '|';

// a segment as written: its words (no bare \ [ ] | and no line break), then its spec
const SEG_REGEX = /\[\[((?:\\[^\n]|[^\\[\]|\n])+)\|([^[\]{}|\n]*)\]\]/g;
const KEY_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;
const WORDS_ESCAPE_REGEX = /[\\[\]|]/g;
const VALUE_STRIP_REGEX = /[,|[\]{}\n]/g;

// ---------- a style ----------

// a style as an object of its keys, what cannot be written left out: a key that is no word, a
// value that is null, undefined, false or ''. a value is true (a key alone) or a text
export function cellStyleClean(styleInput) {
  const style = {};
  for (const key of Object.keys(styleInput ?? {})) {
    if (!KEY_REGEX.test(key)) continue;
    const value = styleInput[key];
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      style[key] = true;
      continue;
    }
    const text = String(value).replace(VALUE_STRIP_REGEX, '').trim();
    if (text !== '') style[key] = text;
  }
  return style;
}

// how a style is written: its keys alone first, then its values, each in the order of the
// alphabet, so that one style is written one way. '' for no style. two styles are the same when
// they are written the same, so this is also what compares them
export function cellStyleSpecWrite(styleInput) {
  const style = cellStyleClean(styleInput);
  const keyList = Object.keys(style).sort();
  return [
    ...keyList.filter((key) => style[key] === true),
    ...keyList.filter((key) => style[key] !== true).map((key) => `${key}=${style[key]}`),
  ].join(',');
}

// a spec read: { b: true, color: '#c0392b' }; undefined when it is no spec (a key that is no
// word), so that words in double brackets that only look like a segment stay text
export function cellStyleSpecRead(specInput) {
  const style = {};
  for (const pieceInput of String(specInput ?? '').split(',')) {
    const piece = pieceInput.trim();
    if (piece === '') continue;
    const indexEqual = piece.indexOf('=');
    const key = (indexEqual < 0 ? piece : piece.slice(0, indexEqual)).trim();
    if (!KEY_REGEX.test(key)) return undefined;
    const value = indexEqual < 0 ? true : piece.slice(indexEqual + 1).trim();
    if (value !== '') style[key] = value;
  }
  return style;
}

export function cellStyleIsEmpty(style) {
  return cellStyleSpecWrite(style) === '';
}

export function cellStyleIsSame(styleA, styleB) {
  return cellStyleSpecWrite(styleA) === cellStyleSpecWrite(styleB);
}

// a style with a change over it, a key at a time: a value sets the key, null (or false, '') takes it away
export function cellStyleMerge(style, change) {
  const merged = { ...cellStyleClean(style) };
  for (const [key, value] of Object.entries(change ?? {})) {
    if (value === null || value === undefined || value === false || value === '') delete merged[key];
    else merged[key] = value;
  }
  return cellStyleClean(merged);
}

// ---------- a text and its segments ----------

// the segments of a text as it is kept: every segment written in it, and plain ones between
// them. nothing is cut here (a token written inside a segment is still inside it): the kinds of
// the cell are not known (cellStyleSegListNormalize, with the places of its tokens)
export function cellStyleSegListRead(textInput) {
  const text = String(textInput ?? '');
  const segList = [];
  let indexLast = 0;
  for (const found of segFoundListGet(text)) {
    if (found.start > indexLast) segPush(segList, text.slice(indexLast, found.start), {});
    segPush(segList, found.words, found.style);
    indexLast = found.end;
  }
  if (indexLast < text.length) segPush(segList, text.slice(indexLast), {});
  return segList;
}

// the text without its style markup: its words and its tokens as written
export function cellStyleTextBareGet(textInput) {
  const text = String(textInput ?? '');
  if (!text.includes(CELL_STYLE_OPEN)) return text;
  return cellStyleSegListTextGet(cellStyleSegListRead(text));
}

// whether a text holds a segment as written (a text without one is its own bare text)
export function cellStyleTextIsStyled(textInput) {
  const text = String(textInput ?? '');
  return text.includes(CELL_STYLE_OPEN) && segFoundListGet(text).length > 0;
}

// segments written as one text: a styled one as [[words|spec]], a plain one as it is, what
// would read as a segment in it kept as words ([[…|]]). a segment is cut at a line break, which
// is written plain; neighbours of one style are written as one
export function cellStyleTextWrite(segList) {
  return cellStyleSegListNormalize(segList).map((seg) => {
    const spec = cellStyleSpecWrite(seg.style);
    return spec === '' ? plainWrite(seg.text) : `${CELL_STYLE_OPEN}${wordsEscape(seg.text)}${CELL_STYLE_MARK}${spec}${CELL_STYLE_CLOSE}`;
  }).join('');
}

// the segments written in a text, in order: { start, end, wordsStart, wordsEnd, words, style }
// (offsets of the text as kept; words: as read, unescaped)
function segFoundListGet(text) {
  if (!text.includes(CELL_STYLE_OPEN)) return [];
  const foundList = [];
  for (const match of text.matchAll(SEG_REGEX)) {
    const style = cellStyleSpecRead(match[2]);
    if (style === undefined) continue;
    const wordsStart = match.index + CELL_STYLE_OPEN.length;
    foundList.push({ start: match.index, end: match.index + match[0].length, wordsStart, wordsEnd: wordsStart + match[1].length, words: wordsUnescape(match[1]), style });
  }
  return foundList;
}

function wordsEscape(text) {
  return text.replace(WORDS_ESCAPE_REGEX, '\\$&');
}

function wordsUnescape(text) {
  return text.replace(/\\([^\n])/g, '$1');
}

// plain words as they are, but for what would read as a segment: kept as the words of a
// segment without a style
function plainWrite(text) {
  if (!text.includes(CELL_STYLE_OPEN)) return text;
  let written = '';
  let indexLast = 0;
  for (const found of segFoundListGet(text)) {
    written += `${text.slice(indexLast, found.start)}${CELL_STYLE_OPEN}${wordsEscape(text.slice(found.start, found.end))}${CELL_STYLE_MARK}${CELL_STYLE_CLOSE}`;
    indexLast = found.end;
  }
  return written + text.slice(indexLast);
}

// a segment added to a list being built: an empty one is left out, one of the style of the
// last is joined to it
function segPush(segList, text, style) {
  if (text === '') return;
  const last = segList[segList.length - 1];
  if (last && cellStyleIsSame(last.style, style)) last.text += text;
  else segList.push({ text, style: cellStyleClean(style) });
}

// ---------- the model: segments worked on ----------

export function cellStyleSegListTextGet(segList) {
  return (segList ?? []).map((seg) => seg.text).join('');
}

export function cellStyleSegListLengthGet(segList) {
  return (segList ?? []).reduce((sum, seg) => sum + seg.text.length, 0);
}

// the segments as the kit keeps them: no empty one, neighbours of one style joined, and no
// style where none may be: on a line break, and inside the ranges given (the tokens of the
// text, [{ start, end }] in bare offsets: a token is never drawn in a style, so words styled
// around one are a segment on each side of it)
export function cellStyleSegListNormalize(segListInput, { rangePlainList = [] } = {}) {
  const segList = [];
  let offset = 0;
  for (const seg of segListInput ?? []) {
    const text = String(seg?.text ?? '');
    const start = offset;
    offset += text.length;
    if (text === '') continue;
    if (cellStyleIsEmpty(seg.style)) {
      segPush(segList, text, {});
      continue;
    }
    // cut where a style may not be: the pieces between keep it
    let indexLast = 0;
    for (const cut of cutListGet(text, start, rangePlainList)) {
      if (cut.start > indexLast) segPush(segList, text.slice(indexLast, cut.start), seg.style);
      segPush(segList, text.slice(cut.start, cut.end), {});
      indexLast = cut.end;
    }
    if (indexLast < text.length) segPush(segList, text.slice(indexLast), seg.style);
  }
  return segList;
}

// where a text (standing at start in the whole) may hold no style: its line breaks, and what
// of it lies in the ranges. in order, not overlapping, as offsets of the text
function cutListGet(text, start, rangePlainList) {
  const cutList = [];
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) cutList.push({ start: index, end: index + 1 });
  for (const range of rangePlainList) {
    const from = Math.max(0, range.start - start);
    const to = Math.min(text.length, range.end - start);
    if (to > from) cutList.push({ start: from, end: to });
  }
  cutList.sort((a, b) => a.start - b.start || a.end - b.end);
  const mergedList = [];
  for (const cut of cutList) {
    const last = mergedList[mergedList.length - 1];
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end);
    else mergedList.push({ ...cut });
  }
  return mergedList;
}

// the segments of a part of the text (bare offsets), cut at its ends
export function cellStyleSegListSlice(segList, start, end = Infinity) {
  const sliceList = [];
  let offset = 0;
  for (const seg of segList ?? []) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + seg.text.length);
    if (to > from) segPush(sliceList, seg.text.slice(from - offset, to - offset), seg.style);
    offset += seg.text.length;
  }
  return sliceList;
}

// the segments with a part of the text replaced by other segments (none: taken out)
export function cellStyleSegListSplice(segList, start, end, segListInserted = []) {
  const splicedList = cellStyleSegListSlice(segList, 0, start);
  for (const seg of [...segListInserted, ...cellStyleSegListSlice(segList, end)]) segPush(splicedList, seg.text, seg.style);
  return splicedList;
}

// the segments with the style of a part of the text changed: styleOf(style) answers the style
// of every piece of it, from the style the piece has. the pieces are cut out of the segments
// they lie in, so a segment reached in part keeps its own style outside the part
function segListRangeMap(segList, start, end, styleOf) {
  const mappedList = [];
  let offset = 0;
  for (const seg of segList ?? []) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + seg.text.length);
    if (to <= from) segPush(mappedList, seg.text, seg.style);
    else {
      segPush(mappedList, seg.text.slice(0, from - offset), seg.style);
      segPush(mappedList, seg.text.slice(from - offset, to - offset), styleOf(seg.style));
      segPush(mappedList, seg.text.slice(to - offset), seg.style);
    }
    offset += seg.text.length;
  }
  return mappedList;
}

// a change of style over a part of the text, a key at a time ({ b: true } adds bold to what
// each piece has, { color: null } takes its color away): the part of a segment of style A given
// C becomes a segment of A and C. normalize after it, with the tokens of the text
export function cellStyleRangeChange(segList, start, end, change) {
  return segListRangeMap(segList, start, end, (style) => cellStyleMerge(style, change));
}

// the style of a part of the text set, whatever it had ({}: none)
export function cellStyleRangeSet(segList, start, end, style) {
  return segListRangeMap(segList, start, end, () => cellStyleClean(style));
}

// whether an offset of the text lies in one of the ranges, not at their edges
function rangeListHolds(rangeList, index) {
  return rangeList.some((range) => range.start <= index && index < range.end);
}

// what the words of a part of the text have of style (bare offsets):
//   styleCommon   the keys every word of it has, with the value they share ({ b: true })
//   keyAnyList    the keys some word of it has
//   isStylable    it holds a word a style can be given to
// a token (rangeSkipList: the tokens of the text) and a line break are no words: they never
// have a style, and do not count against one the words around them share
export function cellStyleRangeStateGet(segList, start, end, { rangeSkipList = [] } = {}) {
  let styleCommon;
  const keyAnySet = new Set();
  let offset = 0;
  for (const seg of segList ?? []) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + seg.text.length);
    const segStart = offset;
    offset += seg.text.length;
    if (to <= from) continue;
    let isWord = false;
    for (let index = from; index < to && !isWord; index += 1) isWord = seg.text[index - segStart] !== '\n' && !rangeListHolds(rangeSkipList, index);
    if (!isWord) continue;
    const style = cellStyleClean(seg.style);
    for (const key of Object.keys(style)) keyAnySet.add(key);
    if (styleCommon === undefined) styleCommon = { ...style };
    else for (const key of Object.keys(styleCommon)) if (styleCommon[key] !== style[key]) delete styleCommon[key];
  }
  return { styleCommon: styleCommon ?? {}, keyAnyList: [...keyAnySet].sort(), isStylable: styleCommon !== undefined };
}

// the segment a word of the text lies in: { start, end, style } (bare offsets), or undefined
// past the end
export function cellStyleSegAtGet(segList, index) {
  let offset = 0;
  for (const seg of segList ?? []) {
    if (index >= offset && index < offset + seg.text.length) return { start: offset, end: offset + seg.text.length, style: seg.style };
    offset += seg.text.length;
  }
  return undefined;
}

// ---------- the caret between two segments ----------
//
// a caret stands between two characters, and where two segments meet it belongs to one of
// them: what is typed there takes that segment's style. which one is its side:
//
//   abc|DEF      'before': with abc (plain)      'after': with DEF (styled)
//
// the style of the word before the caret and of the word after it; undefined where there is
// no word on that side of it on its line: the start or the end of the text, a line break, a
// token (rangeSkipList)
export function cellStyleCaretStyleGet(segList, offset, { rangeSkipList = [] } = {}) {
  const styleOfWordAt = (index) => {
    if (index < 0) return undefined;
    let segOffset = 0;
    for (const seg of segList ?? []) {
      if (index < segOffset + seg.text.length) {
        if (seg.text[index - segOffset] === '\n' || rangeListHolds(rangeSkipList, index)) return undefined;
        return cellStyleClean(seg.style);
      }
      segOffset += seg.text.length;
    }
    return undefined;
  };
  return { before: styleOfWordAt(offset - 1), after: styleOfWordAt(offset) };
}

// the side a caret takes where nothing says another: with the word before it, as a typed text
// goes on in the style it was typed in; with the word after it where no word is before it (the
// start of a line, after a token)
export function cellStyleCaretSideDefaultGet(caretStyle) {
  return caretStyle.before !== undefined ? 'before' : 'after';
}

// the style of what is typed at a caret of a side: the word's on that side, none where no word is
export function cellStyleCaretInsertStyleGet(caretStyle, side) {
  return (side === 'after' ? caretStyle.after : caretStyle.before) ?? {};
}

// whether the two sides of a caret differ: typing there depends on its side, and an arrow
// first changes the side, then moves
export function cellStyleCaretIsBetween(caretStyle) {
  return !cellStyleIsSame(caretStyle.before ?? {}, caretStyle.after ?? {});
}

// ---------- what was typed ----------

// the part of a text that is new after a change that left the caret at its end (a character
// typed, a text pasted, a composition ended): { start, end } in the new text, start also being
// where the change began in the old one; lengthOld: how many characters of the old text it
// replaced. undefined when the text after the caret is not how the old text ended (the caret
// is not at the end of what changed)
export function cellStyleInsertRangeGet(textOld, textNew, caretNew) {
  const tail = textNew.slice(caretNew);
  if (tail.length > textOld.length || !textOld.endsWith(tail)) return undefined;
  const headOld = textOld.slice(0, textOld.length - tail.length);
  const headNew = textNew.slice(0, caretNew);
  let start = 0;
  const limit = Math.min(headOld.length, headNew.length);
  while (start < limit && headOld[start] === headNew[start]) start += 1;
  return { start, end: caretNew, lengthOld: headOld.length - start };
}

// ---------- offsets of the text as kept ----------
//
// a text typed raw (its markup shown) counts its offsets in the text as kept; everything
// else counts in the bare text. the two meet here:
//   bareOf(offsetRaw)            the bare offset of an offset of the text as kept; one inside
//                                the markup of a segment: of the nearest word
//   rawOf(offsetBare, side)      an offset of the text as kept for a bare one. where several
//                                stand for it (the edges of a segment): 'before' the first,
//                                'after' (the default) the last, which is inside the words of
//                                the segment starting there
export function cellStyleOffsetMapGet(textInput) {
  const text = String(textInput ?? '');
  // bareByRaw[r]: how many characters of the bare text stand before the offset r
  const bareByRaw = new Array(text.length + 1);
  let bare = 0;
  let raw = 0;
  const plainFill = (to) => {
    for (; raw < to; raw += 1, bare += 1) bareByRaw[raw] = bare;
  };
  for (const found of segFoundListGet(text)) {
    plainFill(found.start);
    for (; raw < found.wordsStart; raw += 1) bareByRaw[raw] = bare;
    while (raw < found.wordsEnd) {
      bareByRaw[raw] = bare;
      // an escaped character: two written, one read
      if (text[raw] === '\\' && raw + 1 < found.wordsEnd) {
        bareByRaw[raw + 1] = bare;
        raw += 2;
      } else raw += 1;
      bare += 1;
    }
    for (; raw < found.end; raw += 1) bareByRaw[raw] = bare;
  }
  plainFill(text.length);
  bareByRaw[text.length] = bare;
  const lengthBare = bare;
  return {
    lengthBare,
    bareOf: (offsetRaw) => bareByRaw[Math.max(0, Math.min(text.length, offsetRaw))],
    rawOf: (offsetBare, side = 'after') => {
      const wanted = Math.max(0, Math.min(lengthBare, offsetBare));
      const first = bareByRaw.indexOf(wanted);
      return side === 'before' ? first : bareByRaw.lastIndexOf(wanted);
    },
  };
}
