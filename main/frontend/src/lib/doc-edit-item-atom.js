import { CODE_PLACE_IN_LIST_ITEM, CODE_PLACE_LIST_ITEM, CODE_VIEW_LIST, codeInfoLangGet, codeInfoTitleGet, codeInfoViewGet } from './rehype-code-view.js';
import { commentMarkerParse } from './remark-comment-comp.js';
import { CODE_COMPONENT_NAME, codeBlockTextParse, codeBlockValueTextSet, codeTextViewSet } from './doc-edit-code.js';

// The atoms of a list item (doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item):
// the code blocks of its own text that are drawn as icons. The editor of the
// item shows each of them as one thing, a chip in the line, and never its
// source; the author types the text around the chips, moves the caret over
// them, selects and deletes them, and splits or joins the item between them.
// No kind of block has to be the whole text of an item: text and code blocks
// stand in any order.
//
//   the own text of the item            what the editor of the item types
//
//   see the query                       see the query￼then the script￼
//   ```sql view=icon title="weekly"                  ▲                ▲
//   select 1                                 U+E000: atom 0   U+E001: atom 1
//   ```
//   then the script
//   ```sh view=icon
//   ls -la
//   ```
//
// The typed text holds one character of the Unicode private use area per atom
// (atom n is U+E000 + n). An atom stands for its block and for the line
// breaks around it, which Markdown needs and the line of the item does not
// show (the rendered item draws its icons in the line of its text, a space
// apart). Written back (itemAtomTextBuild), every atom is a block on lines of
// its own again, the text around it on the lines before and after it.
//
// What a block is: a fenced block, closed, at the start of a line, with the
// marker comment of the component Code on the line before it when it is a
// block of Code (its lines in the asset service layer, or written inline).
// Every code block of an item is an atom, of the kind its view says (the view
// written in it, else the view the config of the document gives its place,
// viewResolve):
//
//   icon    drawn as an icon: a chip in the line of the text, a space apart
//   block   drawn in another view (card, plain): a chip as wide as the item,
//           on a line of its own; the text before it ends a line, the text
//           after it starts one. it is a line of the item, not the item: text
//           and other blocks stand around it
//
// A code block of another view that is the whole text of the item is no atom:
// its item is edited as the lines of the block (an item that is a text block).

export const ITEM_ATOM_CHAR_FIRST = 0xe000;

// the component blocks the editor of an item types as chips, beside the
// fenced code blocks: the component Code (lines of code, its views those of a
// code block, by the config of their place), and the component Mdx (a
// document embedded in this one, doc_page_impl_mdx_embed.md: views of its own,
// icon by default; its text is not lines to edit in place, it opens in a popup)
const ITEM_BLOCK_COMPONENT_BY_NAME = {
  [CODE_COMPONENT_NAME]: { viewList: CODE_VIEW_LIST },
  Mdx: { viewList: ['icon', 'card'], viewDefault: 'icon', isEmbed: true, labelDefault: 'mdx' },
};
const ITEM_ATOM_CHAR_LAST = 0xf8ff;
const LANG_TEXT_LIST = ['', 'text', 'txt', 'plaintext', 'plain'];

export function itemAtomCharIs(char) {
  const code = String(char ?? '').codePointAt(0);
  return code !== undefined && code >= ITEM_ATOM_CHAR_FIRST && code <= ITEM_ATOM_CHAR_LAST;
}

// a text without the characters atoms are typed as (text pasted, or copied out)
export function itemAtomCharStrip(text) {
  return String(text ?? '').replace(/[-]/g, '');
}

// the code blocks of a text (the own text of an item, without its
// indentation), in order:
//   { start, end, source, form: 'fence' | 'component', lang, title,
//     viewAuthored, lineCount, raw, isWhole }
// start / end: the block in the text, from the start of its first line (the
// marker of Code, else the fence) to the end of its closing fence. a fence
// that is never closed takes the rest of the text, and nothing after it is a
// block. the fence of another component, and a fence of the language asset
// without the marker of Code, are not code blocks.
export function itemCodeBlockListGet(text) {
  const source = String(text ?? '');
  const lineList = source.split('\n');
  const lineStartList = [];
  let offset = 0;
  for (const line of lineList) {
    lineStartList.push(offset);
    offset += line.length + 1;
  }
  const blockList = [];
  let lineIndexFree = 0;
  for (let index = 0; index < lineList.length; index += 1) {
    const open = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lineList[index]);
    if (!open || (open[2][0] === '`' && open[3].includes('`'))) continue;
    const fence = open[2];
    let indexClose = index + 1;
    for (; indexClose < lineList.length; indexClose += 1) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lineList[indexClose]);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break;
    }
    if (indexClose >= lineList.length) break;
    const marker = index > lineIndexFree ? commentMarkerParse(lineList[index - 1].trim()) : undefined;
    const info = open[3].trim();
    const lang = codeInfoLangGet(info);
    const indexFirst = marker ? index - 1 : index;
    const start = lineStartList[indexFirst];
    const end = lineStartList[indexClose] + lineList[indexClose].length;
    const raw = lineList.slice(index + 1, indexClose).join('\n');
    lineIndexFree = indexClose + 1;
    const componentKind = marker ? ITEM_BLOCK_COMPONENT_BY_NAME[marker.compName] : undefined;
    const isComponent = Boolean(componentKind);
    // an Anchor of the block stays text before it; the marker of another
    // component makes the fence its data
    const isCode = isComponent || ((!marker || marker.compName === 'Anchor') && lang !== 'asset');
    if (!isCode) {
      index = indexClose;
      continue;
    }
    const viewMarker = isComponent && componentKind.viewList.includes(marker.props.view) ? marker.props.view : '';
    const startBlock = isComponent ? start : lineStartList[index];
    blockList.push({
      start: startBlock,
      end,
      source: source.slice(startBlock, end),
      form: isComponent ? 'component' : 'fence',
      compName: isComponent ? marker.compName : '',
      lang: isComponent && lang === 'asset' ? '' : lang,
      title: isComponent ? String(marker.props.title ?? '') : codeInfoTitleGet(info),
      viewAuthored: isComponent ? viewMarker : codeInfoViewGet(info),
      // a component with views of its own decides without the config
      viewDefault: componentKind?.viewDefault ?? '',
      lineCount: isComponent && lang === 'asset' ? undefined : indexClose - index - 1,
      // the lines of the block; for a block of Code reading an item, the reference
      raw,
      isReference: isComponent && lang === 'asset',
      // a document of its own (an MDX block): opened in its popup, not edited as lines
      isEmbed: componentKind?.isEmbed === true,
      labelDefault: componentKind?.labelDefault ?? '',
      lineIndex: index,
    });
    index = indexClose;
  }
  const textTrimmed = source.trim();
  for (const block of blockList) block.isWhole = block.source === textTrimmed;
  return blockList;
}

// the atoms of the own text of an item and the text the editor types:
//   { text, display, atomList: [{ char, kind, source, form, lang, title, label,
//     viewAuthored, view, place, align, lineCount, cutStart, cutEnd, displayIndex }] }
// undefined when the text has no atom.
//   viewResolve({ viewAuthored, place, form }) -> the view the block is drawn in;
//                 place 'listItem' when the block is the whole text of the item,
//                 'inListItem' when it stands among other things
//   labelResolve(block) -> what its chip says, when the block does not say it
//                 (the language of the item a block of Code reads)
//   iconAlign     'bottom' | 'top': where an icon stands in its line (CodeBlockIconAlign)
/**
 * @param {string} text
 * @param {{ viewResolve?: (block: { viewAuthored: string, place: string, form: string }) => string,
 *   labelResolve?: (block: any) => string, iconAlign?: string }} [options]
 */
export function itemAtomModelBuild(text, { viewResolve, labelResolve, iconAlign = 'bottom' } = {}) {
  const source = String(text ?? '');
  const blockList = itemCodeBlockListGet(source);
  if (blockList.length === 0) return undefined;
  const atomList = [];
  for (const block of blockList) {
    const place = block.isWhole ? CODE_PLACE_LIST_ITEM : CODE_PLACE_IN_LIST_ITEM;
    const view = block.viewDefault
      ? (block.viewAuthored || block.viewDefault)
      : ((viewResolve ? viewResolve({ viewAuthored: block.viewAuthored, place, form: block.form }) : block.viewAuthored) || CODE_VIEW_LIST[0]);
    // a block of another view that is the whole item is edited as its lines;
    // a document of its own never is
    if (view !== 'icon' && block.isWhole && !block.isEmbed) continue;
    const isText = !block.isReference && LANG_TEXT_LIST.includes(block.lang.toLowerCase());
    const label = block.title || block.labelDefault
      || (block.isReference ? (labelResolve?.(block) || 'code') : (isText ? 'text' : block.lang));
    atomList.push({
      ...block,
      char: String.fromCodePoint(ITEM_ATOM_CHAR_FIRST + atomList.length),
      kind: view === 'icon' ? 'icon' : 'block',
      label,
      view,
      place,
      align: iconAlign === 'top' ? 'top' : 'bottom',
    });
  }
  if (atomList.length === 0) return undefined;
  // each atom takes the line break before it and the one after it, which
  // only Markdown needs: the text runs on around the chip
  let display = '';
  let cursor = 0;
  for (const atom of atomList) {
    let cutStart = atom.start;
    if (cutStart > cursor && source[cutStart - 1] === '\n') cutStart -= 1;
    let cutEnd = atom.end;
    if (source[cutEnd] === '\n') cutEnd += 1;
    display += source.slice(cursor, cutStart);
    atom.displayIndex = display.length;
    display += atom.char;
    atom.cutStart = cutStart;
    atom.cutEnd = cutEnd;
    cursor = cutEnd;
  }
  display += source.slice(cursor);
  return { text: source, display, atomList };
}

// the atom a character of the typed text is, or undefined
export function itemAtomOf(model, char) {
  if (!model || !itemAtomCharIs(char)) return undefined;
  const atom = model.atomList[String(char).codePointAt(0) - ITEM_ATOM_CHAR_FIRST];
  return atom?.char === char ? atom : undefined;
}

// the own text of the item for a typed text: the text unchanged when nothing
// was typed, else every atom written as its block on lines of its own, the
// text around it on the lines before and after it (the spaces and line breaks
// next to a block are not text of the item: Markdown would read a blank line
// as a loose list, an indented line as code). a block whose view the config
// gave it by its place keeps that view where its place changes (a block that
// was the whole item gets text beside it, or the other way round): the view is
// written into it. a character of no atom of the item is dropped.
export function itemAtomTextBuild(display, model) {
  const typed = String(display ?? '');
  if (!model) return typed;
  if (typed === model.display) return model.text;
  const partList = [];
  let run = '';
  for (const char of typed) {
    const atom = itemAtomOf(model, char);
    if (atom) {
      partList.push({ text: run }, { atom });
      run = '';
    } else if (!itemAtomCharIs(char)) {
      run += char;
    }
  }
  partList.push({ text: run });
  const pieceList = [];
  partList.forEach((part, index) => {
    if (part.atom) {
      pieceList.push(part);
      return;
    }
    let text = part.text;
    if (partList[index - 1]?.atom) text = text.replace(/^\s+/, '');
    if (partList[index + 1]?.atom) text = text.replace(/\s+$/, '');
    if (text !== '') pieceList.push({ text });
  });
  const placeNew = pieceList.length === 1 && pieceList[0].atom ? CODE_PLACE_LIST_ITEM : CODE_PLACE_IN_LIST_ITEM;
  return pieceList.map((piece) => (piece.atom ? atomSourceGet(piece.atom, placeNew) : piece.text)).join('\n');
}

function atomSourceGet(atom, place) {
  if (atom.viewAuthored || place === atom.place) return atom.source;
  const built = codeTextViewSet(atom.source, atom.view);
  return built.code === 0 ? built.data : atom.source;
}

// an offset into the own text of the item as an offset into the typed text:
// an offset inside an atom (its block, the line breaks around it) is the
// place after it, one at the line break before it the place before it
export function itemAtomOffsetDisplayGet(model, offset) {
  const offsetSource = Math.max(0, Number(offset) || 0);
  if (!model) return offsetSource;
  let shift = 0;
  for (const atom of model.atomList) {
    if (offsetSource <= atom.cutStart) break;
    if (offsetSource < atom.cutEnd) return atom.displayIndex + 1;
    shift += atom.cutEnd - atom.cutStart - 1;
  }
  return Math.min(model.display.length, offsetSource - shift);
}

// a typed text, with each atom written as its block (copied out of the editor)
export function itemAtomTextSourceGet(display, model) {
  let text = '';
  for (const char of String(display ?? '')) {
    const atom = itemAtomOf(model, char);
    if (atom) text += `${text === '' || text.endsWith('\n') ? '' : '\n'}${atom.source}\n`;
    else if (!itemAtomCharIs(char)) text += char;
  }
  return text.replace(/\n$/, '');
}

// ---------- a part of an item: one code block among its text ----------
// (doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item) the
// lines of a code block standing in the text of an item among other things
// are edited where they are drawn, as the lines of an item that is one block
// are: the session of the item edits that part, and writes it back into the
// own text of the item. a part is named by its index among the code blocks of
// the text (itemCodeBlockListGet), which is also the order of the chips.

// the part as its lines are edited: { index, info, textInner, block }; undefined
// when it is no part to edit so: no block at that index, the whole text of the
// item (that item is edited as the lines of its block), a block of Code reading
// an item of the asset store (its lines are not in the document)
export function itemPartGet(text, index) {
  const block = itemCodeBlockListGet(text)[index];
  if (!block || block.isWhole || block.isReference || block.isEmbed) return undefined;
  const parsed = codeBlockTextParse(block.source);
  if (!parsed) return undefined;
  return { index, info: parsed.info, textInner: parsed.value, block };
}

// the own text of the item with the lines of a part written inside its fence
// (its info kept): a block among text stays a block, whatever its lines (To
// text turns it into text). isRemoved: the part taken out, with a line break
// around it.
// -> { text, start, end }: the text and where the part stands in it now
// (start = end where it was taken out); undefined when there is no such part
export function itemPartTextWrite(textOwn, index, textInner, { isRemoved = false } = {}) {
  const source = String(textOwn ?? '');
  const block = itemCodeBlockListGet(source)[index];
  if (!block) return undefined;
  let replacement = '';
  if (!isRemoved) {
    const built = codeBlockValueTextSet(block.source, String(textInner ?? ''));
    if (built.code !== 0) return undefined;
    replacement = built.data;
  }
  if (replacement !== '') {
    return { text: source.slice(0, block.start) + replacement + source.slice(block.end), start: block.start, end: block.start + replacement.length };
  }
  if (source[block.end] === '\n') return { text: source.slice(0, block.start) + source.slice(block.end + 1), start: block.start, end: block.start };
  if (block.start > 0 && source[block.start - 1] === '\n') {
    return { text: source.slice(0, block.start - 1) + source.slice(block.end), start: block.start - 1, end: block.start - 1 };
  }
  return { text: source.slice(0, block.start) + source.slice(block.end), start: block.start, end: block.start };
}

// an offset into the own text right before a part (start) or right after it
// (end), as itemAtomOffsetDisplayGet reads it: the line break before a block
// is the place before its chip
export function itemPartOffsetGet(text, start, side) {
  if (side === 'before') return start > 0 && String(text)[start - 1] === '\n' ? start - 1 : start;
  return start;
}

// Enter in the lines of a block of an item (a part, or a code block that is
// the whole item): the lines after the caret leave the block and become text
// of the item right after it, joined into one line (codeTextJoin) and joined
// to the line of text that follows the block, when there is one. the block
// keeps the lines before the caret; it is taken out when none are left.
//   textOwn   the own text of the item; index: the block among its code blocks
//   textInner the lines of the block as typed; offsetStart / offsetEnd: the
//             caret or the selection in them (a selection goes)
// -> { text, offset }: the own text, and where the text after the block starts
//    in it (an offset into the text as written); undefined when no such block
export function itemBlockSplitOut(textOwn, index, textInner, offsetStart, offsetEnd = offsetStart, { textJoin, spaceIs }) {
  const source = String(textOwn ?? '');
  const block = itemCodeBlockListGet(source)[index];
  if (!block) return undefined;
  const typed = String(textInner ?? '');
  const linesBefore = typed.slice(0, Math.min(offsetStart, offsetEnd)).replace(/\s+$/, '');
  const rest = textJoin(typed.slice(Math.max(offsetStart, offsetEnd)));
  let head = source.slice(0, block.start);
  let tail = source.slice(block.end);
  if (linesBefore !== '') {
    const built = codeBlockValueTextSet(block.source, linesBefore);
    if (built.code !== 0) return undefined;
    head += built.data;
  } else {
    head = head.replace(/\n$/, '');
  }
  // the line of text after the block takes the rest at its start
  const lineAfter = tail.startsWith('\n') ? tail.slice(1).split('\n')[0] : undefined;
  const isLineAfterText = lineAfter !== undefined && lineAfter.trim() !== '' && !/^\s*(`{3,}|~{3,}|<!--)/.test(lineAfter);
  if (rest !== '') {
    if (isLineAfterText) tail = `\n${rest}${spaceIs(rest, lineAfter) ? ' ' : ''}${tail.slice(1)}`;
    else tail = `\n${rest}${tail}`;
  }
  const separator = head === '' ? '' : '\n';
  const tailText = tail.startsWith('\n') ? tail.slice(1) : tail;
  const text = head === '' ? tailText : `${head}${tailText === '' ? '' : separator}${tailText}`;
  const offset = head === '' ? 0 : head.length + (tailText === '' ? 0 : 1);
  return { text, offset };
}
