import { CODE_VIEW_LIST, codeInfoLangGet, codeInfoLangSet, codeInfoTitleGet, codeInfoViewGet, codeInfoViewSet } from './rehype-code-view.js';
import { markerTextBuild } from './doc-edit-block.js';
import { commentMarkerParse } from './remark-comment-comp.js';

// The text of a fenced code block, as the page changes it from edit mode
// (doc_page_impl_mdx_code.md#changing-the-view-from-the-page): its view
// written into the info string, and the block turned into a block of the
// component Code whose lines are an item of the asset service layer
// (doc_page_impl_mdx_code.md#the-lines-in-the-asset-service-layer).
//
// the text is that of a root-level block (lines before the fence, an Anchor
// marker of the block, are kept as they are) or the own text of a list item
// that is a code block (the fence alone, unindented: the item model indents
// it). every function answers { code, message, data }.

// the component a code block becomes when its lines go to the asset service layer
export const CODE_COMPONENT_NAME = 'Code';
// the language of a fence that names none, written when an attribute is added
// to its info string (the first word of the info is always the language)
const LANG_NONE = 'text';

// the parts of a text that ends with one fenced code block:
//   { linePrefixList, indent, fence, info, lang, view, title, value }
// undefined when it is not one
export function codeBlockTextParse(text) {
  const lineList = String(text ?? '').split('\n');
  const indexOpen = lineList.findIndex((line) => /^ {0,3}(`{3,}|~{3,})/.test(line));
  if (indexOpen < 0) return undefined;
  const open = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lineList[indexOpen]);
  if (!open || (open[2][0] === '`' && open[3].includes('`'))) return undefined;
  const fence = open[2];
  const closes = (line) => {
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    return Boolean(close) && close[1][0] === fence[0] && close[1].length >= fence.length;
  };
  const indexClose = lineList.length - 1;
  if (indexClose <= indexOpen || !closes(lineList[indexClose])) return undefined;
  if (lineList.slice(indexOpen + 1, indexClose).some(closes)) return undefined;
  const info = open[3].trim();
  return {
    linePrefixList: lineList.slice(0, indexOpen),
    indent: open[1],
    fence,
    info,
    lang: codeInfoLangGet(info),
    view: codeInfoViewGet(info),
    title: codeInfoTitleGet(info),
    value: lineList.slice(indexOpen + 1, indexClose).join('\n'),
    lineCloseText: lineList[indexClose],
  };
}

// the text with the view of its block written into the info string; view ''
// removes it, so the config of the document decides by the place of the block
export function codeBlockViewTextSet(text, view) {
  const parsed = codeBlockTextParse(text);
  if (!parsed) return { code: -1, message: 'the block is not one fenced code block' };
  // a view after no language would be read as the language
  const infoBase = parsed.lang || !view ? parsed.info : `${LANG_NONE} ${parsed.info}`.trim();
  const info = codeInfoViewSet(infoBase, view);
  const lineList = String(text).split('\n');
  const indexOpen = parsed.linePrefixList.length;
  lineList[indexOpen] = `${parsed.indent}${parsed.fence}${info}`;
  return { code: 0, message: '', data: lineList.join('\n') };
}

// the text of the block as a block of the component Code reading its lines
// from an item of the asset service layer: the lines before the fence kept,
// the marker carrying the view and the title of the info string, the fence
// holding the reference (referenceText, lang "asset")
export function codeBlockAssetTextBuild(text, referenceText) {
  const parsed = codeBlockTextParse(text);
  if (!parsed) return { code: -1, message: 'the block is not one fenced code block' };
  const props = {};
  if (parsed.view) props.view = parsed.view;
  // the marker has no quoting: a comma would end the value, "--" the comment
  const title = parsed.title.replace(/,/g, ' ').replace(/-{2,}/g, '-').trim();
  if (title) props.title = title;
  const reference = String(referenceText ?? '').replace(/\n$/, '');
  const textComponent = `${parsed.indent}${markerTextBuild(CODE_COMPONENT_NAME, props)}\n${parsed.indent}\`\`\`asset\n${reference}\n${parsed.indent}\`\`\``;
  return { code: 0, message: '', data: [...parsed.linePrefixList, textComponent].join('\n') };
}

// the language and the lines an item of the asset service layer takes from
// the block: a fence without a language holds text
export function codeBlockAssetDataGet(text) {
  const parsed = codeBlockTextParse(text);
  if (!parsed) return undefined;
  return { lang: parsed.lang || LANG_NONE, value: parsed.value };
}

// ---------- the view of either form ----------
// a code block is a fenced block (its view in the info string) or a block of
// the component Code (its view a prop of its marker, the line right before
// its fence): the page reads and writes the view of either the same way

// { view, form: 'fence' | 'component' } of a code block, view '' when it has
// none of its own; undefined for any other text (a fence of language asset
// that is not a block of Code is the reference of another component)
export function codeTextViewGet(text) {
  const parsed = codeBlockTextParse(text);
  if (!parsed) return undefined;
  const marker = codeMarkerGet(parsed);
  if (marker) return { view: CODE_VIEW_LIST.includes(marker.props.view) ? marker.props.view : '', form: 'component' };
  if (parsed.lang === 'asset' || parsed.linePrefixList.some((line) => commentMarkerParse(line.trim()))) {
    // the fence of another component, or one marked by one (not an Anchor alone)
    const isAnchorOnly = parsed.linePrefixList.every((line) => /^\s*$/.test(line) || /^\s*<!--\s*renderComp=Anchor\b/.test(line));
    if (parsed.lang === 'asset' || !isAnchorOnly) return undefined;
  }
  return { view: parsed.view, form: 'fence' };
}

// the text with the view of its code block set (or removed: '')
export function codeTextViewSet(text, view) {
  const parsed = codeBlockTextParse(text);
  if (!parsed) return { code: -1, message: 'the block is not one fenced code block' };
  const marker = codeMarkerGet(parsed);
  if (!marker) return codeBlockViewTextSet(text, view);
  const props = { ...marker.props, view: view || undefined };
  const lineList = String(text).split('\n');
  const indexMarker = parsed.linePrefixList.length - 1;
  lineList[indexMarker] = `${marker.indent}${markerTextBuild(marker.compName, props)}`;
  return { code: 0, message: '', data: lineList.join('\n') };
}

// the props of the comment marker right before the fence of a block changed,
// whatever its component (the title of an MDX block): a value '' or undefined
// removes the prop, the others are kept in their order
export function codeMarkerPropsSet(text, propsPatch = {}) {
  const parsed = codeBlockTextParse(text);
  if (!parsed) return { code: -1, message: 'the block is not one fenced code block' };
  const indexMarker = parsed.linePrefixList.length - 1;
  const line = parsed.linePrefixList[indexMarker];
  const marker = line === undefined ? undefined : commentMarkerParse(line.trim());
  if (!marker) return { code: -1, message: 'the block has no marker to write on' };
  const props = { ...marker.props };
  for (const [key, value] of Object.entries(propsPatch)) {
    if (value === undefined || value === null || String(value) === '') delete props[key];
    else props[key] = String(value);
  }
  const lineList = String(text).split('\n');
  lineList[indexMarker] = `${/^\s*/.exec(line)[0]}${markerTextBuild(marker.compName, props)}`;
  return { code: 0, message: '', data: lineList.join('\n') };
}

// the marker of the component Code right before the fence, with its props
function codeMarkerGet(parsed) {
  const line = parsed.linePrefixList[parsed.linePrefixList.length - 1];
  if (line === undefined) return undefined;
  const marker = commentMarkerParse(line.trim());
  if (marker?.compName !== CODE_COMPONENT_NAME) return undefined;
  return { ...marker, indent: /^\s*/.exec(line)[0] };
}

// ---------- the lines of a code block ----------
// (doc_page_impl_mdx_code.md#editing-the-lines) the lines inside the fence
// replaced; what stands before the fence, the fence and its info string stay
// (but for its language, when one is given: option lang), and the fence grows
// when a new line could close it

export function codeBlockValueTextSet(text, value, { lang } = {}) {
  const parsed = codeBlockTextParse(text);
  if (!parsed) return { code: -1, message: 'the block is not one fenced code block' };
  const valueText = String(value ?? '').replace(/\r\n?/g, '\n');
  let length = parsed.fence.length;
  for (const line of valueText.split('\n')) {
    const run = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (run && run[1][0] === parsed.fence[0]) length = Math.max(length, run[1].length + 1);
  }
  const fence = parsed.fence[0].repeat(length);
  const lineList = [
    ...parsed.linePrefixList,
    `${parsed.indent}${fence}${lang === undefined ? parsed.info : codeInfoLangSet(parsed.info, lang)}`,
    ...(valueText === '' ? [] : valueText.split('\n').map((line) => (line === '' ? '' : `${parsed.indent}${line}`))),
    `${parsed.indent}${fence}`,
  ];
  return { code: 0, message: '', data: lineList.join('\n') };
}

// ---------- a code block inside a text ----------
// a fenced block found by the line of its fence inside a longer text (the own
// text of a list item that holds text and blocks, or a root-level block with
// lines before its fence), and replaced by what transform makes of it. the
// marker comment on the line right before the fence (Code, Anchor) is part of
// the block. transform(blockText) -> { code, message, data: textNew } (or a
// promise of it). -> { code, message, data: { text, blockText, result } }
export async function codeBlockInTextReplace(text, lineIndexFence, transform) {
  const lineList = String(text ?? '').split('\n');
  const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lineList[lineIndexFence] ?? '');
  if (!open || (open[1][0] === '`' && open[2].includes('`'))) return { code: -1, message: 'no code fence starts at that line' };
  let indexClose = lineIndexFence + 1;
  for (; indexClose < lineList.length; indexClose += 1) {
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lineList[indexClose]);
    if (close && close[1][0] === open[1][0] && close[1].length >= open[1].length) break;
  }
  if (indexClose >= lineList.length) return { code: -1, message: 'the code fence at that line is not closed' };
  const indexFirst = lineIndexFence > 0 && commentMarkerParse(lineList[lineIndexFence - 1].trim()) ? lineIndexFence - 1 : lineIndexFence;
  const blockText = lineList.slice(indexFirst, indexClose + 1).join('\n');
  const result = await transform(blockText);
  if (!result || result.code !== 0) return result ?? { code: -1, message: 'the block was not changed' };
  const textNew = [...lineList.slice(0, indexFirst), result.data, ...lineList.slice(indexClose + 1)].join('\n');
  return { code: 0, message: '', data: { text: textNew, blockText, result } };
}

// ---------- the lines of a code block as text ----------
// (doc_page_impl_mdx_code.md#the-lines-as-text) the lines joined into one
// line of text, the line breaks removed: each line trimmed, the empty ones
// dropped, a space between two lines but between two CJK characters, where
// text has no space. the line is text of the document from then on: a start
// that Markdown would read as another block (a heading, a quote, a list
// marker, a fence, html) is escaped, the rest is left as it is.
const REGEX_CJK = /[⺀-⿟　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;
export function codeTextJoin(text) {
  let joined = '';
  for (const line of String(text ?? '').split('\n').map((one) => one.trim()).filter((one) => one !== '')) {
    if (joined === '') joined = line;
    else joined += (REGEX_CJK.test(joined.slice(-1)) && REGEX_CJK.test(line[0]) ? '' : ' ') + line;
  }
  return textLineEscape(joined);
}

function textLineEscape(line) {
  const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(line);
  if (ordered) return `${ordered[1]}\\${line.slice(ordered[1].length)}`;
  if (/^(#{1,6}(\s|$)|>|[-*+](\s|$)|`{3,}|~{3,}|={3,}\s*$|-{3,}\s*$|<)/.test(line)) return `\\${line}`;
  return line;
}

// whether a text joined to another needs a space between them (none between
// two CJK characters, none next to a space)
export function textJoinSpaceIs(before, after) {
  const charBefore = String(before ?? '').slice(-1);
  const charAfter = String(after ?? '')[0] ?? '';
  if (charBefore === '' || charAfter === '' || /\s/.test(charBefore) || /\s/.test(charAfter)) return false;
  return !(REGEX_CJK.test(charBefore) && REGEX_CJK.test(charAfter));
}
