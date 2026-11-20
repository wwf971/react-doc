import { createProcessor } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// The item model of a list block, and the structural edits of its items
// (design: doc_page_impl_edit_structure.md#the-list-model; how the source of
// an item is written: doc_page_impl_mdx_li.md#items-written-by-the-page).
//
// A list block of the edit layer is one root-level list. Its items are read
// from the positions the Markdown parser reports (never from a line parser of
// our own), kept as a tree, changed in that tree, and written back by
// serializing the whole list. What an item holds is kept relative to the
// item's text column, so an item can move to any depth, or get a wider marker
// ("9." -> "10."), and its lines are indented again by the serializer:
//
//   listModel = { format, linePrefixList, list, itemByPath, rowList }
//     linePrefixList   the lines of the block before the list (an Anchor marker)
//     list             { ordered, numberStart, numberStyle, itemList }
//     item             { path, depth, pathParent, markerText, spaceCount,
//                        indentExtra, gapBefore, isMarkerLineOwn, segmentList,
//                        lineStart, lineEnd }
//       markerText       "-", "*", "+", "3.", "3)"
//       spaceCount       the spaces between the marker and the text
//       indentExtra      0..3: how far the marker stands right of the text
//                        column of the item holding its list
//       gapBefore        blank lines between the item before it and this one
//       isMarkerLineOwn  nothing follows the marker on its line ("-" alone)
//       segmentList      what the item holds, in order:
//                        { type: 'content', gapBefore, lineList }   lines without the item's indentation
//                        { type: 'list', gapBefore, list }          a nested list
//     path             "1.0.2": the index of the item among the items of its
//                      parent, at every depth (the items of every nested list
//                      of one item count on, in order)
//
// the first content segment of an item is its own text (what the author edits
// as "the item"); the items of its nested lists are its children.
//
// an item without text is written as its marker alone. where Markdown reads
// no item in that (the first item of a nested list right under a line of
// text: "-" there underlines the line as a heading, any other marker is
// text), the marker is followed by an empty comment, which keeps the item an
// item and renders nothing (ITEM_EMPTY_MARK_BY_FORMAT); read back, such an
// item is an item without text again.
//
// every edit answers { code, message, data }: data.text is the new text of
// the whole block, data.itemPath where the item the edit was about is now.
// the new text is parsed again before it is answered: an edit whose result
// would not read back as the intended items is refused (code -1), so a write
// never turns items into something else.

const REGEX_MARKER = /^(?:[-*+]|\d{1,9}[.)])/;

// what stands for the text of an item without text where a marker alone is
// not read as an item: an empty comment, as the format of the document writes one
export const ITEM_EMPTY_MARK_BY_FORMAT = { md: '<!---->', mdx: '{/**/}' };
const itemEmptyMarkSet = new Set(Object.values(ITEM_EMPTY_MARK_BY_FORMAT));

export const LIST_SCOPE_ITEM = 'item';
export const LIST_SCOPE_SUBTREE = 'subtree';

class ListUnsupportedError extends Error {}

// ---------- compile time: the positions of a list ----------

// listNode: the mdast list. the answer is plain data (lines and columns are
// those of the parsed content, 1-based): { ordered, itemList: [{ line, column,
// lineEnd, partList: [{ type: 'content' | 'list', lineStart, lineEnd, list }] }] }
export function listDescribe(listNode) {
  return {
    ordered: listNode.ordered === true,
    itemList: (listNode.children ?? []).filter((node) => node.type === 'listItem').map(itemDescribe),
  };
}

function itemDescribe(itemNode) {
  const partList = [];
  for (const child of itemNode.children ?? []) {
    const lineStart = child.position?.start?.line ?? 0;
    const lineEnd = child.position?.end?.line ?? lineStart;
    if (child.type === 'list') {
      partList.push({ type: 'list', lineStart, lineEnd, list: listDescribe(child) });
      continue;
    }
    const partLast = partList[partList.length - 1];
    if (partLast?.type === 'content') partLast.lineEnd = lineEnd;
    else partList.push({ type: 'content', lineStart, lineEnd });
  }
  return {
    line: itemNode.position?.start?.line ?? 0,
    column: itemNode.position?.start?.column ?? 1,
    lineEnd: itemNode.position?.end?.line ?? 0,
    partList,
  };
}

// marks the list and its items for the rendered body: every <li> of the list
// gets data-edit-item (its path), every <ul> / <ol> data-edit-list, so the
// edit layer finds the element of an item (hProperties: the attributes of the
// element the node becomes)
export function listAnnotate(listNode) {
  propertySet(listNode, 'dataEditList', '');
  let index = 0;
  for (const itemNode of listNode.children ?? []) {
    if (itemNode.type !== 'listItem') continue;
    itemAnnotate(itemNode, String(index));
    index += 1;
  }
}

function itemAnnotate(itemNode, path) {
  propertySet(itemNode, 'dataEditItem', path);
  let indexChild = 0;
  for (const child of itemNode.children ?? []) {
    if (child.type !== 'list') continue;
    propertySet(child, 'dataEditList', path);
    for (const itemChild of child.children ?? []) {
      if (itemChild.type !== 'listItem') continue;
      itemAnnotate(itemChild, pathChildBuild(path, indexChild));
      indexChild += 1;
    }
  }
}

function propertySet(node, name, value) {
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, [name]: value } };
}

function pathChildBuild(pathParent, index) {
  return pathParent === '' ? String(index) : `${pathParent}.${index}`;
}

// ---------- the model ----------

// listDescribed: what listDescribe answered; lineList: the lines its
// positions count in; lineOffset: added to its lines to get lines of the
// file; linePrefixList: the lines of the block before the list.
//   -> { code: 0, data: listModel } | { code: -1, message } when the list is
//      written in a way the item model does not take (tabs as indentation)
export function listModelBuild({ listDescribed, lineList, lineOffset = 0, linePrefixList = [], format = 'md' }) {
  try {
    const list = listNodeBuild(listDescribed, lineList, 0, lineOffset);
    return { code: 0, message: '', data: modelIndex({ format, linePrefixList: [...linePrefixList], list }) };
  } catch (error) {
    if (error instanceof ListUnsupportedError) return { code: -1, message: error.message };
    throw error;
  }
}

function listNodeBuild(listDescribed, lineList, columnBase, lineOffset) {
  const itemList = listDescribed.itemList.map((itemDescribed, index) => {
    const line = lineList[itemDescribed.line - 1] ?? '';
    const columnMarker = itemDescribed.column - 1;
    if (line.slice(0, columnMarker).includes('\t')) throw new ListUnsupportedError('the list is indented with tabs');
    const markerText = REGEX_MARKER.exec(line.slice(columnMarker))?.[0];
    if (!markerText) throw new ListUnsupportedError(`no list marker at line ${itemDescribed.line + lineOffset}`);
    const rest = line.slice(columnMarker + markerText.length);
    const isMarkerLineOwn = rest.trim() === '';
    let spaceCount = 1;
    if (!isMarkerLineOwn) {
      const spaceCountAuthored = rest.length - rest.trimStart().length;
      if (rest.slice(0, spaceCountAuthored).includes('\t')) throw new ListUnsupportedError('the list is indented with tabs');
      if (spaceCountAuthored === 0) throw new ListUnsupportedError(`no space after the marker at line ${itemDescribed.line + lineOffset}`);
      // five or more spaces: the text column is one space after the marker,
      // and the rest is the indentation of an indented code block
      spaceCount = spaceCountAuthored >= 5 ? 1 : spaceCountAuthored;
    }
    const columnText = columnMarker + markerText.length + spaceCount;
    const partFirst = itemDescribed.partList[0];
    if (!isMarkerLineOwn && partFirst?.lineStart !== itemDescribed.line) {
      throw new ListUnsupportedError(`the item at line ${itemDescribed.line + lineOffset} is not read as written`);
    }
    const segmentList = [];
    let lineEndPrevious = itemDescribed.line;
    for (const part of itemDescribed.partList) {
      const gapBefore = Math.max(0, part.lineStart - lineEndPrevious - 1);
      if (part.type === 'list') {
        segmentList.push({ type: 'list', gapBefore, list: listNodeBuild(part.list, lineList, columnText, lineOffset) });
      } else {
        const lineListPart = [];
        for (let lineNumber = part.lineStart; lineNumber <= part.lineEnd; lineNumber += 1) {
          const lineRaw = lineList[lineNumber - 1] ?? '';
          lineListPart.push(lineNumber === itemDescribed.line ? lineRaw.slice(columnText) : lineDedent(lineRaw, columnText));
        }
        segmentList.push({ type: 'content', gapBefore, lineList: lineListPart });
      }
      lineEndPrevious = part.lineEnd;
    }
    // the empty comment that keeps an item without text an item
    const segmentFirst = segmentList[0];
    const isEmptyMarked = segmentFirst?.type === 'content' && segmentFirst.lineList.length === 1
      && itemEmptyMarkSet.has(segmentFirst.lineList[0].trim());
    if (isEmptyMarked) segmentList.shift();
    const itemPrevious = listDescribed.itemList[index - 1];
    return {
      markerText,
      spaceCount,
      indentExtra: Math.max(0, columnMarker - columnBase),
      gapBefore: itemPrevious ? Math.max(0, itemDescribed.line - itemPrevious.lineEnd - 1) : 0,
      isMarkerLineOwn: isMarkerLineOwn || isEmptyMarked,
      segmentList,
      lineStart: itemDescribed.line + lineOffset,
      lineEnd: itemDescribed.lineEnd + lineOffset,
    };
  });
  const numberList = itemList.map((item) => markerNumberGet(item.markerText));
  return {
    ordered: listDescribed.ordered === true,
    numberStart: listDescribed.ordered ? numberList[0] ?? 1 : 1,
    numberStyle: listDescribed.ordered && numberList.length > 1 && numberList.every((number) => number === numberList[0])
      ? 'same'
      : 'sequential',
    itemList,
  };
}

// a line of an item without the indentation of the item (a line indented
// less, a lazy continuation, loses what it has)
function lineDedent(lineRaw, columnText) {
  if (lineRaw.trim() === '') return '';
  const indentCount = lineRaw.length - lineRaw.trimStart().length;
  if (lineRaw.slice(0, indentCount).includes('\t')) throw new ListUnsupportedError('the list is indented with tabs');
  return lineRaw.slice(Math.min(indentCount, columnText));
}

function markerNumberGet(markerText) {
  const number = Number.parseInt(markerText, 10);
  return Number.isFinite(number) ? number : undefined;
}

function markerIsOrdered(markerText) {
  return /^\d/.test(markerText);
}

// gives every item its path, depth and parent, and the model its lookups
function modelIndex(model) {
  const itemByPath = new Map();
  const rowList = [];
  const itemIndex = (item, path, pathParent, depth) => {
    item.path = path;
    item.pathParent = pathParent;
    item.depth = depth;
    itemByPath.set(path, item);
    rowList.push(item);
    itemChildListGet(item).forEach((child, index) => itemIndex(child, pathChildBuild(path, index), path, depth + 1));
  };
  model.list.itemList.forEach((item, index) => itemIndex(item, String(index), '', 0));
  model.itemByPath = itemByPath;
  model.rowList = rowList;
  return model;
}

// ---------- reading the model ----------

// the items of every nested list of an item, in order: its children
export function itemChildListGet(item) {
  const childList = [];
  for (const segment of item.segmentList) {
    if (segment.type === 'list') childList.push(...segment.list.itemList);
  }
  return childList;
}

export function listItemGet(model, itemPath) {
  return model?.itemByPath?.get(String(itemPath));
}

// the number of items under an item, at every depth
export function itemDescendantCountGet(item) {
  let count = 0;
  for (const child of itemChildListGet(item)) count += 1 + itemDescendantCountGet(child);
  return count;
}

// the own text of an item: its first content segment, without the item's
// indentation and marker; '' for an item that starts with a nested list
export function listItemTextGet(model, itemPath) {
  const item = listItemGet(model, itemPath);
  if (!item) return '';
  const segmentFirst = item.segmentList[0];
  return segmentFirst?.type === 'content' ? segmentFirst.lineList.join('\n') : '';
}

// an item has text after a nested list: what is under it cannot be parted
// from it, so the edits that leave its children behind are not offered
export function itemHasContentAfterList(item) {
  const indexListFirst = item.segmentList.findIndex((segment) => segment.type === 'list');
  if (indexListFirst === -1) return false;
  return item.segmentList.slice(indexListFirst + 1).some((segment) => segment.type === 'content');
}

// what an api or a tree view shows of an item
export function listItemInfoBuild(item) {
  const childList = itemChildListGet(item);
  const segmentFirst = item.segmentList[0];
  return {
    path: item.path,
    pathParent: item.pathParent,
    depth: item.depth,
    markerText: item.markerText,
    isOrdered: markerIsOrdered(item.markerText),
    lineStart: item.lineStart,
    lineEnd: item.lineEnd,
    childCount: childList.length,
    descendantCount: itemDescendantCountGet(item),
    text: segmentFirst?.type === 'content' ? segmentFirst.lineList.join('\n') : '',
  };
}

// ---------- writing the model ----------

// the text of the block the model stands for
export function listTextBuild(model, list = model.list) {
  return [...model.linePrefixList, ...listLineListBuild(list, 0, model.format, false)].join('\n');
}

// isUnderText: the list stands right under a line of text of the item
// holding it, where its first item needs a text to be read as an item
function listLineListBuild(list, columnBase, format, isUnderText) {
  const lineList = [];
  list.itemList.forEach((item, index) => {
    if (index > 0) lineListPushBlank(lineList, item.gapBefore);
    const columnMarker = columnBase + item.indentExtra;
    const columnText = columnMarker + item.markerText.length + item.spaceCount;
    const lineListBody = [];
    item.segmentList.forEach((segment, indexSegment) => {
      // nothing blank between the marker and what follows it: a blank line
      // there would end the item
      if (indexSegment > 0) lineListPushBlank(lineListBody, segment.gapBefore);
      if (segment.type === 'list') {
        const segmentBefore = item.segmentList[indexSegment - 1];
        const isListUnderText = segmentBefore?.type === 'content' && segment.gapBefore === 0;
        lineListBody.push(...listLineListBuild(segment.list, columnText, format, isListUnderText));
        return;
      }
      for (const line of segment.lineList) lineListBody.push(line === '' ? '' : `${' '.repeat(columnText)}${line}`);
    });
    const indentMarker = ' '.repeat(columnMarker);
    const isTextless = item.segmentList[0]?.type !== 'content';
    if (isTextless && isUnderText && index === 0) {
      // an item without text right under a line of text: kept an item by an empty comment
      const mark = ITEM_EMPTY_MARK_BY_FORMAT[format === 'mdx' ? 'mdx' : 'md'];
      lineList.push(`${indentMarker}${item.markerText}${' '.repeat(item.spaceCount)}${mark}`, ...lineListBody);
      return;
    }
    if (item.isMarkerLineOwn || lineListBody.length === 0 || lineListBody[0] === '') {
      lineList.push(`${indentMarker}${item.markerText}`, ...lineListBody);
      return;
    }
    lineList.push(
      `${indentMarker}${item.markerText}${' '.repeat(item.spaceCount)}${lineListBody[0].slice(columnText)}`,
      ...lineListBody.slice(1),
    );
  });
  return lineList;
}

function lineListPushBlank(lineList, count) {
  for (let index = 0; index < count; index += 1) lineList.push('');
}

// ---------- the model of a text (a result read back, a test) ----------

// text: the source of one list (after linePrefixList, when there is one).
//   -> { code: 0, data: listModel } | { code: -1, message }
export function listTextModelBuild(text, { format = 'md', linePrefixList = [] } = {}) {
  let tree;
  try {
    tree = processorGet(format).parse(text);
  } catch (error) {
    return { code: -1, message: String(error?.message ?? error) };
  }
  const nodeList = tree.children ?? [];
  if (nodeList.length !== 1 || nodeList[0].type !== 'list') {
    return { code: -1, message: nodeList.length === 0 ? 'the text holds no list' : 'the text is not one list' };
  }
  return listModelBuild({ listDescribed: listDescribe(nodeList[0]), lineList: text.split('\n'), linePrefixList, format });
}

const processorByFormat = new Map();
function processorGet(format) {
  const formatKey = format === 'mdx' ? 'mdx' : 'md';
  if (!processorByFormat.has(formatKey)) {
    processorByFormat.set(formatKey, createProcessor({ format: formatKey, remarkPlugins: [remarkGfm, remarkMath] }));
  }
  return processorByFormat.get(formatKey);
}

// ---------- structural edits ----------
// each takes the model of the block and answers { code, message, data:
// { text, itemPath, isNoop, isListEmpty } }. itemPath: the path of the item
// the edit was about in the new text ('' when it is gone); isListEmpty: the
// list holds no item any more, so the block is to be removed.

// the own text of an item replaced. the item stays where it is and keeps
// what is under it; text that reads as list items at its end becomes the
// first children of the item.
export function listItemTextSet(model, itemPath, text) {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const { item } = located;
  itemTextApply(item, text);
  return editFinish(edit, { itemFocus: item, itemLenientList: [item] });
}

// an item split in two at a place of its own text: the item keeps the text
// before the place, and a new item right after it takes the text after it and
// everything that was under the item. no other line moves or changes level.
// data.itemPath: the new item, where the author goes on typing
export function listItemSplit(model, itemPath, textBefore, textAfter) {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const { item, list, index } = located;
  const segmentListRest = item.segmentList[0]?.type === 'content' ? item.segmentList.slice(1) : [...item.segmentList];
  const itemNew = itemCreate(item, textAfter);
  itemNew.segmentList.push(...segmentListRest);
  item.segmentList = [];
  itemTextApply(item, textBefore);
  itemPlace(list, index + 1, itemNew, edit);
  return editFinish(edit, { itemFocus: itemNew, itemLenientList: [item, itemNew] });
}

// an item joined to the row above it: its own text goes to the end of the
// text of that row (the item before it, the last item under that one, or the
// item it is under), and the item is gone. no other line moves or changes its
// level: what was under the item keeps its level, so it comes under whatever
// stands above it at that level, and takes the item's place when the row
// above is the item it was under.
//   textItem, textReceiver   the texts to join, when they are not the saved
//                            ones (a text being typed)
// data.itemPath: the row that took the text; data.offset: where the texts meet
export function listItemMergeUp(model, itemPath, { textItem, textReceiver } = {}) {
  const rowIndex = model.rowList.findIndex((itemOne) => itemOne.path === String(itemPath));
  if (rowIndex === -1) return editRefuse(`no item ${itemPath} in the list`);
  if (rowIndex === 0) return editRefuse('no item above it in the list');
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  const locatedReceiver = itemLocate(edit.list, model.rowList[rowIndex - 1].path);
  const { item, list, index, itemParent } = located;
  const receiver = locatedReceiver.item;
  // the two texts as they are typed: a text block is its lines (itemTextParse)
  const up = itemTextParse(textReceiver ?? itemTextOf(receiver));
  const own = itemTextParse(textItem ?? itemTextOf(item));
  // an item without text has nothing to join: it is simply gone
  const reason = own.text === '' ? '' : itemJoinReasonGet(up, own);
  if (reason) return editRefuse(reason);
  if (itemHasContentAfterList(item)) return editRefuse(messageContentAfterList);
  if (receiver === itemParent) {
    // the row above is the item it is under: what is under it takes its place
    const refusal = itemDetach(located, LIST_SCOPE_ITEM, edit);
    if (refusal) return editRefuse(refusal);
  } else {
    // the row above is the item before it, or under that one: what is under
    // the item keeps its level, as the last items under the item before it
    const childList = itemChildListGet(item);
    const itemBefore = list.itemList[index - 1];
    itemChildrenDrop(item);
    itemDetach(located, LIST_SCOPE_SUBTREE, edit);
    if (childList.length > 0) {
      const isListNewForced = itemBefore.segmentList[itemBefore.segmentList.length - 1]?.type === 'content' && itemChildListGet(itemBefore).length > 0;
      const listTarget = itemChildListTargetGet(itemBefore, markerIsOrdered(childList[0].markerText), 'last', edit, childList[0].gapBefore, isListNewForced);
      if (listTarget.itemList.length === 0) childList[0].gapBefore = 0;
      for (const child of childList) {
        if (listTarget.itemList.length > 0) itemMarkerAdapt(child, listTarget, undefined);
        listTarget.itemList.push(child);
      }
      edit.listTouchedSet.add(listTarget);
    }
  }
  // the joined text is written as its lines ask: a text block when it holds
  // a line break (with the info of the block that took part), else a line
  const isTextChanged = own.text !== '' || textReceiver !== undefined;
  if (isTextChanged) itemTextApply(receiver, itemTextWrite(`${up.text}${own.text}`, up.info ?? own.info));
  const result = editFinish(edit, { itemFocus: receiver, itemLenientList: isTextChanged ? [receiver] : [] });
  if (result.code !== 0) return result;
  return { ...result, data: { ...result.data, offset: up.text.length } };
}

// one edit after another, as one result: the second is computed on the list
// the first one wrote (read from its text). next(model, itemPath) gets the
// item of the first edit at its new path. what the first changed is kept
// when the second changes nothing.
export function listEditThen(model, result, next) {
  if (result.code !== 0 || result.data.isListEmpty) return result;
  const lineList = result.data.text.split('\n').slice(model.linePrefixList.length);
  const read = listTextModelBuild(lineList.join('\n'), { format: model.format, linePrefixList: model.linePrefixList });
  if (read.code !== 0) return editRefuse(read.message);
  const resultNext = next(read.data, result.data.itemPath);
  if (resultNext.code !== 0) return resultNext;
  return { ...resultNext, data: { ...resultNext.data, isNoop: resultNext.data.isNoop && result.data.isNoop } };
}

function itemTextOf(item) {
  const segmentFirst = item.segmentList[0];
  return segmentFirst?.type === 'content' ? segmentFirst.lineList.join('\n') : '';
}

// why two texts (itemTextParse) do not join into one, '' when they do. the
// lines of a text block of text join like lines of text. code is not a line
// to join to: a block of code, and a text that ends or starts with a fenced
// block (a component with its data).
const REGEX_FENCE_LINE = /^\s*(`{3,}|~{3,})/;
function itemJoinReasonGet(up, own) {
  const messageUp = 'the item above ends with a code block, which no text joins';
  const messageOwn = 'a code block does not join the text above it';
  if (up.info !== undefined && !itemBlockInfoIsText(up.info)) return messageUp;
  if (own.info !== undefined && !itemBlockInfoIsText(own.info)) return messageOwn;
  if (up.info === undefined && REGEX_FENCE_LINE.test(up.text.split('\n').pop() ?? '')) return messageUp;
  if (own.info === undefined && REGEX_FENCE_LINE.test(own.text.split('\n')[0] ?? '')) return messageOwn;
  return '';
}

// ---------- an item written as a text block ----------
// the own text of an item may be one fenced code block and nothing else: a
// text whose line breaks are kept (language "text"), or code. such an item is
// edited as the lines inside the fences.

// { info, textInner } when a text is exactly one fenced block, else undefined
export function itemBlockFormatGet(text) {
  const lineList = String(text ?? '').split('\n');
  if (lineList.length < 2) return undefined;
  const open = /^(`{3,}|~{3,})(.*)$/.exec(lineList[0]);
  if (!open || (open[1][0] === '`' && open[2].includes('`'))) return undefined;
  const fenceCloses = (line) => {
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    return Boolean(close) && close[1][0] === open[1][0] && close[1].length >= open[1].length;
  };
  if (!fenceCloses(lineList[lineList.length - 1])) return undefined;
  if (lineList.slice(1, -1).some(fenceCloses)) return undefined;
  return { info: open[2].trim(), textInner: lineList.slice(1, -1).join('\n') };
}

// the fenced block holding a text; the fence grows when a line of the text could close it
export function itemBlockTextBuild(textInner, info = 'text') {
  const text = String(textInner ?? '');
  let length = 3;
  for (const line of text.split('\n')) {
    const run = /^ {0,3}(`{3,})/.exec(line);
    if (run) length = Math.max(length, run[1].length + 1);
  }
  const fence = '`'.repeat(length);
  return `${fence}${info}\n${text}\n${fence}`;
}

// a block of text holds lines whose breaks are kept, and no code: the
// language of its info is "text" (or one of its other names), or none. its
// lines are text like the text of any item: Enter splits it, Backspace joins
// it. a block of another language is code, and is left a block.
const BLOCK_TEXT_LANGUAGE_LIST = ['', 'text', 'txt', 'plaintext', 'plain'];
export function itemBlockInfoIsText(info) {
  const language = String(info ?? '').trim().split(/\s+/)[0] ?? '';
  return BLOCK_TEXT_LANGUAGE_LIST.includes(language.toLowerCase());
}

// the own text of an item as it is typed, apart from how it is written:
//   { text, info }   info undefined: the text as written
//                    info a string: a fenced block of that info, text its lines
export function itemTextParse(textItem) {
  const text = String(textItem ?? '');
  const block = itemBlockFormatGet(text);
  return block ? { text: block.textInner, info: block.info } : { text, info: undefined };
}

// the reverse: how a typed text is written as the own text of an item.
//   info undefined      as it is
//   info of text        a text block when the text holds a line break (a
//                       list item keeps no line break otherwise), a plain
//                       line when it does not: a text block of one line is
//                       a line of text
//   info of code        a block of that info, always
export function itemTextWrite(text, info) {
  const textTyped = String(text ?? '');
  if (info === undefined) return textTyped;
  if (!itemBlockInfoIsText(info)) return itemBlockTextBuild(textTyped, info);
  return textTyped.includes('\n') ? itemBlockTextBuild(textTyped, info) : textTyped;
}

// the two texts a text typed in an item is split into at a place (the caret,
// or a selected part, which goes): what stands at the place is text of
// neither part. in a line: the spaces around it. in a text of lines (a text
// block): the line break, the blank lines around it, and what ends each part.
export function itemTextSplit(text, offsetStart, offsetEnd = offsetStart) {
  const textTyped = String(text ?? '');
  const rawBefore = textTyped.slice(0, offsetStart);
  const rawAfter = textTyped.slice(Math.max(offsetStart, offsetEnd));
  if (!textTyped.includes('\n')) return { textBefore: rawBefore.replace(/[ \t]+$/, ''), textAfter: rawAfter.replace(/^[ \t]+/, '') };
  const isInLine = rawBefore !== '' && !rawBefore.endsWith('\n') && rawAfter !== '' && !rawAfter.startsWith('\n');
  let textAfter = rawAfter.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
  // the indentation of a line that starts a text of lines is its own; of a
  // part cut out of a line, or of a part that is one line, it is none
  if (isInLine || !textAfter.includes('\n')) textAfter = textAfter.replace(/^[ \t]+/, '');
  return { textBefore: rawBefore.replace(/\s+$/, ''), textAfter };
}

// a new item beside an item, or as its last child.
//   position   'before' | 'after' (after the item and what is under it) | 'child'
export function listItemInsert(model, itemPath, position, text = '') {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const itemNew = itemCreate(located.item, text);
  if (position === 'child') {
    const listTarget = itemChildListTargetGet(located.item, located.list.ordered, 'last', edit);
    if (listTarget.itemList.length === 0) itemNew.indentExtra = 0;
    else itemMarkerAdapt(itemNew, listTarget, undefined);
    itemPlace(listTarget, listTarget.itemList.length, itemNew, edit);
  } else {
    itemPlace(located.list, located.index + (position === 'before' ? 0 : 1), itemNew, edit);
  }
  return editFinish(edit, { itemFocus: itemNew });
}

// an item removed.
//   scope   'subtree': with everything under it
//           'item': the item alone; its children take its place, one level up
export function listItemDelete(model, itemPath, scope = LIST_SCOPE_SUBTREE) {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const refusal = itemDetach(located, scope, edit);
  if (refusal) return editRefuse(refusal);
  return editFinish(edit, {});
}

// an item one level deeper: it becomes the last child of the item before it.
// no line moves up or down.
//   scope   'subtree': with everything under it
//           'item': the item alone; its children keep their level, so they
//           follow it as its siblings
export function listItemIndent(model, itemPath, scope = LIST_SCOPE_SUBTREE) {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const { item, list, index } = located;
  if (index === 0) return editRefuse('the first item of a list has no item before it to go under');
  const isAlone = scope === LIST_SCOPE_ITEM && itemChildListGet(item).length > 0;
  if (isAlone && itemHasContentAfterList(item)) return editRefuse(messageContentAfterList);
  const childList = isAlone ? itemChildListGet(item) : [];
  if (isAlone) itemChildrenDrop(item);
  const itemBefore = list.itemList[index - 1];
  list.itemList.splice(index, 1);
  edit.listTouchedSet.add(list);
  const listTarget = itemChildListTargetGet(itemBefore, list.ordered, 'last', edit, item.gapBefore);
  // the item stays on its lines: it keeps the blank lines above it
  if (listTarget.itemList.length === 0) {
    item.gapBefore = 0;
    item.indentExtra = 0;
  } else {
    itemMarkerAdapt(item, listTarget, undefined);
  }
  listTarget.itemList.push(item);
  for (const child of childList) {
    itemMarkerAdapt(child, listTarget, item);
    listTarget.itemList.push(child);
  }
  edit.listTouchedSet.add(listTarget);
  return editFinish(edit, { itemFocus: item });
}

// an item one level up: it becomes the item after its parent, and takes
// what is under it along (a list cannot skip a level). no line moves up or
// down, so the items after it in the list it leaves come under it.
export function listItemOutdent(model, itemPath) {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const { item, list, index, itemParent, segment } = located;
  if (!itemParent) return editRefuse('the item is at the first level of the list');
  const indexSegment = itemParent.segmentList.indexOf(segment);
  if (indexSegment !== itemParent.segmentList.length - 1) {
    return editRefuse('the item above holds more after this list; edit the list as source to change its levels');
  }
  const locatedParent = itemLocateByNode(edit.list, itemParent);
  const itemFollowList = list.itemList.splice(index + 1);
  list.itemList.splice(index, 1);
  edit.listTouchedSet.add(list);
  // the blank lines above the item stay above it
  if (index === 0) item.gapBefore = segment.gapBefore;
  if (list.itemList.length === 0) itemSegmentRemove(itemParent, segment);
  if (itemFollowList.length > 0) {
    const gapFirst = itemFollowList[0].gapBefore;
    // they stay below everything the item holds: a new list when it ends with text
    const isListNewForced = item.segmentList[item.segmentList.length - 1]?.type === 'content' && itemChildListGet(item).length > 0;
    const listTarget = itemChildListTargetGet(item, list.ordered, 'last', edit, gapFirst, isListNewForced);
    if (listTarget.itemList.length === 0) itemFollowList[0].gapBefore = 0;
    for (const itemFollow of itemFollowList) {
      if (listTarget.itemList.length > 0) itemMarkerAdapt(itemFollow, listTarget, undefined);
      listTarget.itemList.push(itemFollow);
    }
    edit.listTouchedSet.add(listTarget);
  }
  itemMarkerAdapt(item, locatedParent.list, undefined);
  locatedParent.list.itemList.splice(locatedParent.index + 1, 0, item);
  edit.listTouchedSet.add(locatedParent.list);
  return editFinish(edit, { itemFocus: item });
}

// an item moved to another place of the same list block.
//   scope    'subtree': with everything under it
//            'item': the item alone; its children take its place
//   target   { itemPath, position }: before / after an item (after: after it
//            and what is under it), or as its first / last child
//            ('childFirst' | 'childLast')
export function listItemMove(model, itemPath, scope, target) {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const targetPath = String(target?.itemPath ?? '');
  if (pathIsWithin(targetPath, itemPath)) return editRefuse('an item cannot move into itself');
  const locatedTarget = itemLocate(edit.list, targetPath);
  if (!locatedTarget) return editRefuse(`no item ${targetPath} in the list`);
  const { item } = located;
  const itemTarget = locatedTarget.item;
  const refusal = itemDetach(located, scope, edit);
  if (refusal) return editRefuse(refusal);
  itemAttach(edit, item, itemTarget, target.position);
  return editFinish(edit, { itemFocus: item });
}

// an item swapped with the item before or after it in its list, with
// everything under it
export function listItemMoveSibling(model, itemPath, direction) {
  const located = itemLocate(model.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const itemOther = located.list.itemList[located.index + (direction === 'up' ? -1 : 1)];
  if (!itemOther) return editRefuse(direction === 'up' ? 'it is the first item of its list' : 'it is the last item of its list');
  return listItemMove(model, itemPath, LIST_SCOPE_SUBTREE, { itemPath: itemOther.path, position: direction === 'up' ? 'before' : 'after' });
}

// an item taken out of its list block, to go into another one
// (listItemAttach). data.item is the item with what the scope takes along.
export function listItemDetach(model, itemPath, scope = LIST_SCOPE_SUBTREE) {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const { item } = located;
  const refusal = itemDetach(located, scope, edit);
  if (refusal) return editRefuse(refusal);
  const result = editFinish(edit, {});
  if (result.code !== 0) return result;
  return { ...result, data: { ...result.data, item: itemClone(item) } };
}

// an item of another list block put at a place of this one
export function listItemAttach(model, item, target) {
  const edit = editStart(model);
  const locatedTarget = itemLocate(edit.list, String(target?.itemPath ?? ''));
  if (!locatedTarget) return editRefuse(`no item ${target?.itemPath} in the list`);
  const itemNew = itemClone(item);
  itemAttach(edit, itemNew, locatedTarget.item, target.position);
  return editFinish(edit, { itemFocus: itemNew });
}

// the list an item is in turned into bullets or numbers
//   type   'unordered' | 'ordered'
export function listItemListTypeSet(model, itemPath, type) {
  const edit = editStart(model);
  const located = itemLocate(edit.list, itemPath);
  if (!located) return editRefuse(`no item ${itemPath} in the list`);
  const { list } = located;
  const isOrdered = type === 'ordered';
  if (list.ordered === isOrdered) return editFinish(edit, { itemFocus: located.item });
  list.ordered = isOrdered;
  list.numberStart = 1;
  list.numberStyle = 'sequential';
  for (const item of list.itemList) item.markerText = isOrdered ? '1.' : '-';
  edit.listTouchedSet.add(list);
  return editFinish(edit, { itemFocus: located.item });
}

// 'ordered' | 'unordered' of the list an item is in
export function listItemListTypeGet(model, itemPath) {
  const located = itemLocate(model.list, itemPath);
  if (!located) return '';
  return located.list.ordered ? 'ordered' : 'unordered';
}

// why an edit is not possible, '' when it is: what a control shows greyed
// out. it answers from the model alone, without building the result.
export function listItemEditReasonGet(model, itemPath, action, scope = LIST_SCOPE_SUBTREE) {
  const located = itemLocate(model.list, itemPath);
  if (!located) return 'the item is not in the list anymore';
  const { item, list, index, itemParent, segment } = located;
  const isAlone = scope === LIST_SCOPE_ITEM && itemChildListGet(item).length > 0;
  if (action === 'indent') {
    if (index === 0) return 'the first item of a list has no item before it to go under';
    if (isAlone && itemHasContentAfterList(item)) return messageContentAfterList;
    return '';
  }
  if (action === 'outdent') {
    if (!itemParent) return 'the item is at the first level of the list';
    if (itemParent.segmentList.indexOf(segment) !== itemParent.segmentList.length - 1) {
      return 'the item above holds more after this list; edit the list as source to change its levels';
    }
    return '';
  }
  if (action === 'moveUp') return index === 0 ? 'it is the first item of its list' : '';
  if (action === 'moveDown') return index === list.itemList.length - 1 ? 'it is the last item of its list' : '';
  if (action === 'delete' || action === 'move') return isAlone && itemHasContentAfterList(item) ? messageContentAfterList : '';
  return '';
}

const messageContentAfterList = 'the item holds text after its sub-items, so it cannot leave them behind; take it with its sub-items';

// ---------- the parts of an edit ----------

// an edit works on a copy of the tree
function editStart(model) {
  return {
    model,
    list: listClone(model.list),
    // the lists whose items changed: numbered again when they are numbered
    listTouchedSet: new Set(),
  };
}

function editRefuse(message) {
  return { code: -1, message, data: undefined };
}

//   itemFocus        the item the edit was about; its new path is answered
//   itemLenientList  the items whose own text the author wrote: what a text
//                    reads as is the author's, only what is under its item
//                    must be kept
function editFinish(edit, { itemFocus, itemLenientList = [] }) {
  const itemLenient = new Set(itemLenientList);
  for (const list of edit.listTouchedSet) listRenumber(list);
  treeNormalize(edit.list);
  if (edit.list.itemList.length === 0) {
    return { code: 0, message: '', data: { text: edit.model.linePrefixList.join('\n'), itemPath: '', isNoop: false, isListEmpty: true } };
  }
  // the paths of the items in the changed tree
  modelIndex({ format: edit.model.format, linePrefixList: edit.model.linePrefixList, list: edit.list });
  const textList = listLineListBuild(edit.list, 0, edit.model.format, false).join('\n');
  const text = [...edit.model.linePrefixList, textList].join('\n');
  const read = listTextModelBuild(textList, { format: edit.model.format });
  const difference = read.code !== 0 ? read.message : listDifferenceGet(read.data.list, edit.list, itemLenient);
  if (difference) return editRefuse(`${messageReadBack} (${difference})`);
  const itemPath = itemFocus ? itemFocus.path ?? '' : '';
  return {
    code: 0,
    message: '',
    data: { text, itemPath, isNoop: text === listTextBuild(edit.model), isListEmpty: false },
  };
}

const messageReadBack = 'The list would not read back as the same items after this change; edit the list as source instead';

function itemTextApply(item, text) {
  const lineList = textLineListGet(text);
  const segmentFirst = item.segmentList[0];
  if (lineList.length === 0) {
    if (segmentFirst?.type === 'content') item.segmentList.shift();
    item.isMarkerLineOwn = true;
    return;
  }
  if (segmentFirst?.type === 'content') segmentFirst.lineList = lineList;
  else item.segmentList.unshift({ type: 'content', gapBefore: 0, lineList });
  item.isMarkerLineOwn = false;
}

// the lines of a text an author typed as the own text of an item: no blank
// lines around it, a tab at the start of a line as four spaces
function textLineListGet(text) {
  const lineList = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => {
    if (line.trim() === '') return '';
    const indentText = /^[ \t]*/.exec(line)[0];
    return `${indentText.replace(/\t/g, '    ')}${line.slice(indentText.length)}`;
  });
  while (lineList.length > 0 && lineList[0] === '') lineList.shift();
  while (lineList.length > 0 && lineList[lineList.length - 1] === '') lineList.pop();
  return lineList;
}

// a new item written like the item it is created beside
function itemCreate(itemBeside, text) {
  const item = {
    markerText: itemBeside.markerText,
    spaceCount: itemBeside.spaceCount,
    indentExtra: itemBeside.indentExtra,
    gapBefore: 0,
    isMarkerLineOwn: true,
    segmentList: [],
  };
  itemTextApply(item, text);
  return item;
}

// where an item is: { item, list, index, itemParent, segment }; segment: the
// list segment of the parent the list is; undefined at the first level
function itemLocate(listRoot, itemPath) {
  const indexList = String(itemPath).split('.').map((part) => Number(part));
  if (indexList.length === 0 || indexList.some((index) => !Number.isInteger(index) || index < 0)) return undefined;
  let located = { item: listRoot.itemList[indexList[0]], list: listRoot, index: indexList[0], itemParent: undefined, segment: undefined };
  if (!located.item) return undefined;
  for (const indexChild of indexList.slice(1)) {
    const itemParent = located.item;
    let indexRest = indexChild;
    let locatedChild;
    for (const segment of itemParent.segmentList) {
      if (segment.type !== 'list') continue;
      if (indexRest < segment.list.itemList.length) {
        locatedChild = { item: segment.list.itemList[indexRest], list: segment.list, index: indexRest, itemParent, segment };
        break;
      }
      indexRest -= segment.list.itemList.length;
    }
    if (!locatedChild) return undefined;
    located = locatedChild;
  }
  return located;
}

function itemLocateByNode(listRoot, itemWanted) {
  const search = (list, itemParent, segment) => {
    for (let index = 0; index < list.itemList.length; index += 1) {
      const item = list.itemList[index];
      if (item === itemWanted) return { item, list, index, itemParent, segment };
      for (const segmentChild of item.segmentList) {
        if (segmentChild.type !== 'list') continue;
        const found = search(segmentChild.list, item, segmentChild);
        if (found) return found;
      }
    }
    return undefined;
  };
  return search(listRoot, undefined, undefined);
}

// takes an item out of its list; '' when done, else why not.
//   'item' scope with children: they take its place, written like it
function itemDetach(located, scope, edit) {
  const { item, list, index, itemParent, segment } = located;
  const isAlone = scope === LIST_SCOPE_ITEM && itemChildListGet(item).length > 0;
  if (isAlone && itemHasContentAfterList(item)) return messageContentAfterList;
  edit.listTouchedSet.add(list);
  if (isAlone) {
    const childList = itemChildListGet(item);
    childList.forEach((child, indexChild) => {
      child.markerText = item.markerText;
      child.spaceCount = item.spaceCount;
      child.indentExtra = item.indentExtra;
      if (indexChild === 0) child.gapBefore = item.gapBefore;
    });
    itemChildrenDrop(item);
    list.itemList.splice(index, 1, ...childList);
    item.gapBefore = 0;
    return '';
  }
  list.itemList.splice(index, 1);
  // the item after it is not parted from what is above by more blank lines
  // than the item was
  const itemNext = list.itemList[index];
  if (itemNext && index === 0) itemNext.gapBefore = 0;
  if (list.itemList.length === 0 && itemParent) itemSegmentRemove(itemParent, segment);
  item.gapBefore = 0;
  return '';
}

// an item (taken out before) put relative to another item
function itemAttach(edit, item, itemTarget, position) {
  if (position === 'childFirst' || position === 'childLast') {
    const side = position === 'childFirst' ? 'first' : 'last';
    const listTarget = itemChildListTargetGet(itemTarget, markerIsOrdered(item.markerText), side, edit);
    // the first item of a new list keeps its marker and stands at the text
    // column of the item it goes under
    if (listTarget.itemList.length === 0) item.indentExtra = 0;
    else itemMarkerAdapt(item, listTarget, undefined);
    itemPlace(listTarget, side === 'first' ? 0 : listTarget.itemList.length, item, edit);
    return;
  }
  const locatedTarget = itemLocateByNode(edit.list, itemTarget);
  itemMarkerAdapt(item, locatedTarget.list, undefined);
  itemPlace(locatedTarget.list, locatedTarget.index + (position === 'before' ? 0 : 1), item, edit);
}

// an item put into a list at an index, with the blank lines the list keeps
// between its items
function itemPlace(list, index, item, edit) {
  const gapTypical = listGapTypicalGet(list);
  const itemFirst = list.itemList[0];
  if (index === 0) {
    item.gapBefore = 0;
    if (itemFirst) itemFirst.gapBefore = gapTypical;
  } else {
    item.gapBefore = gapTypical;
  }
  list.itemList.splice(index, 0, item);
  edit.listTouchedSet.add(list);
}

// the blank lines a list keeps between two of its items
function listGapTypicalGet(list) {
  if (list.itemList.length < 2) return 0;
  return Math.min(...list.itemList.slice(1).map((item) => item.gapBefore));
}

// the list of an item its new child goes into: its last (or first) nested
// list, or a new one at its end. gapBefore: the blank lines above a new list
function itemChildListTargetGet(item, isOrdered, side, edit, gapBefore = 0, isListNewForced = false) {
  const segmentListOfLists = item.segmentList.filter((segment) => segment.type === 'list');
  const segment = side === 'first' ? segmentListOfLists[0] : segmentListOfLists[segmentListOfLists.length - 1];
  if (segment && !isListNewForced) return segment.list;
  const list = { ordered: isOrdered, numberStart: 1, numberStyle: 'sequential', itemList: [] };
  item.segmentList.push({ type: 'list', gapBefore, list });
  edit.listTouchedSet.add(list);
  return list;
}

// an item written like the items of the list it joins: their marker, the
// spaces after it, their indentation. itemLike: the item to follow when the
// list holds none yet
function itemMarkerAdapt(item, list, itemLike) {
  const itemOther = list.itemList.find((itemOne) => itemOne !== item) ?? itemLike;
  if (!itemOther) return;
  item.markerText = itemOther.markerText;
  item.spaceCount = itemOther.spaceCount;
  item.indentExtra = itemOther.indentExtra;
}

// an item without its nested lists
function itemChildrenDrop(item) {
  item.segmentList = item.segmentList.filter((segment) => segment.type !== 'list');
  if (item.segmentList.length === 0) item.isMarkerLineOwn = true;
}

function itemSegmentRemove(item, segment) {
  const index = item.segmentList.indexOf(segment);
  if (index === -1) return;
  item.segmentList.splice(index, 1);
  if (index === 0) item.isMarkerLineOwn = true;
}

// the numbers of a numbered list after its items changed: counted on from
// its first number, or all the same when the author numbered them so
function listRenumber(list) {
  if (!list.ordered) {
    for (const item of list.itemList) {
      if (markerIsOrdered(item.markerText)) item.markerText = '-';
    }
    return;
  }
  const itemNumbered = list.itemList.find((item) => markerIsOrdered(item.markerText));
  const delimiter = itemNumbered ? itemNumbered.markerText.slice(-1) : '.';
  list.itemList.forEach((item, index) => {
    const number = list.numberStyle === 'same' ? list.numberStart : list.numberStart + index;
    item.markerText = `${number}${delimiter}`;
  });
}

// the tree as it is written: content segments that came to stand side by
// side are one, the first segment of an item has nothing blank above it
function treeNormalize(list) {
  for (const item of list.itemList) {
    const segmentList = [];
    for (const segment of item.segmentList) {
      const segmentLast = segmentList[segmentList.length - 1];
      if (segment.type === 'content' && segmentLast?.type === 'content') {
        segmentLast.lineList = [...segmentLast.lineList, ...Array(segment.gapBefore).fill(''), ...segment.lineList];
        continue;
      }
      if (segment.type === 'list' && segment.list.itemList.length === 0) continue;
      segmentList.push(segment);
    }
    item.segmentList = segmentList;
    if (segmentList.length === 0) item.isMarkerLineOwn = true;
    if (segmentList[0]) segmentList[0].gapBefore = 0;
    for (const segment of segmentList) {
      if (segment.type === 'list') treeNormalize(segment.list);
    }
  }
  if (list.itemList[0]) list.itemList[0].gapBefore = 0;
}

// ---------- reading a result back ----------

// how the list read back from a written text differs from the list that was
// meant, '' when it does not. itemLenient: the item whose own text the author
// wrote; its segments before what was under it are not compared, and its
// first nested list may start with items the author typed.
function listDifferenceGet(listRead, listMeant, itemLenient, pathParent = '') {
  if (listRead.itemList.length !== listMeant.itemList.length) {
    return `${listRead.itemList.length} items instead of ${listMeant.itemList.length} ${pathParent === '' ? 'at the first level' : `under item ${pathParent}`}`;
  }
  if (listRead.ordered !== listMeant.ordered) return `a list ${pathParent === '' ? 'at the first level' : `under item ${pathParent}`} changed its kind`;
  for (let index = 0; index < listMeant.itemList.length; index += 1) {
    const difference = itemDifferenceGet(listRead.itemList[index], listMeant.itemList[index], itemLenient, pathChildBuild(pathParent, index));
    if (difference) return difference;
  }
  return '';
}

function itemDifferenceGet(itemRead, itemMeant, itemLenient, path) {
  if (itemRead.markerText !== itemMeant.markerText) return `item ${path} reads with the marker ${itemRead.markerText}`;
  if (itemLenient?.has(itemMeant)) return itemTailDifferenceGet(itemRead, itemMeant, itemLenient, path);
  if (itemRead.segmentList.length !== itemMeant.segmentList.length) return `item ${path} reads as ${itemRead.segmentList.length} parts instead of ${itemMeant.segmentList.length}`;
  for (let index = 0; index < itemMeant.segmentList.length; index += 1) {
    const difference = segmentDifferenceGet(itemRead.segmentList[index], itemMeant.segmentList[index], itemLenient, path);
    if (difference) return difference;
  }
  return '';
}

function segmentDifferenceGet(segmentRead, segmentMeant, itemLenient, path) {
  if (segmentRead.type !== segmentMeant.type) return `a part of item ${path} reads as ${segmentRead.type === 'list' ? 'a list' : 'text'}`;
  if (segmentRead.type === 'list') return listDifferenceGet(segmentRead.list, segmentMeant.list, itemLenient, path);
  if (segmentRead.lineList.join('\n') !== segmentMeant.lineList.join('\n')) return `the text of item ${path} reads differently`;
  return '';
}

// what was under the item before its own text is still under it, in order,
// at the end of what it holds
function itemTailDifferenceGet(itemRead, itemMeant, itemLenient, path) {
  const segmentListTail = itemMeant.segmentList[0]?.type === 'content' ? itemMeant.segmentList.slice(1) : itemMeant.segmentList;
  if (itemRead.segmentList.length < segmentListTail.length) return `what is under item ${path} would be lost in its text`;
  const offset = itemRead.segmentList.length - segmentListTail.length;
  for (let index = 0; index < segmentListTail.length; index += 1) {
    const segmentRead = itemRead.segmentList[offset + index];
    const segmentMeant = segmentListTail[index];
    if (index === 0 && segmentRead.type === 'list' && segmentMeant.type === 'list') {
      // the items the text ends with read as the first items of this list
      const countExtra = segmentRead.list.itemList.length - segmentMeant.list.itemList.length;
      if (countExtra < 0 || segmentRead.list.ordered !== segmentMeant.list.ordered) return `what is under item ${path} would be lost in its text`;
      const listReadTail = { ...segmentRead.list, itemList: segmentRead.list.itemList.slice(countExtra) };
      const difference = countExtra > 0
        ? listTailDifferenceGet(listReadTail, segmentMeant.list, path)
        : listDifferenceGet(listReadTail, segmentMeant.list, itemLenient, path);
      if (difference) return difference;
      continue;
    }
    const difference = segmentDifferenceGet(segmentRead, segmentMeant, itemLenient, path);
    if (difference) return difference;
  }
  return '';
}

// the items of a list the author's text grew at its start: compared without
// their markers' numbers, which count on from the typed items
function listTailDifferenceGet(listRead, listMeant, path) {
  for (let index = 0; index < listMeant.itemList.length; index += 1) {
    const itemRead = listRead.itemList[index];
    const itemMeant = listMeant.itemList[index];
    const difference = itemDifferenceGet({ ...itemRead, markerText: itemMeant.markerText }, itemMeant, undefined, `${path}.${index}`);
    if (difference) return difference;
  }
  return '';
}

// ---------- paths and copies ----------

// a path names the item at pathAncestor or an item under it
export function pathIsWithin(itemPath, pathAncestor) {
  return itemPath === pathAncestor || String(itemPath).startsWith(`${pathAncestor}.`);
}

export function pathParentGet(itemPath) {
  const index = String(itemPath).lastIndexOf('.');
  return index === -1 ? '' : String(itemPath).slice(0, index);
}

export function pathDepthGet(itemPath) {
  return String(itemPath).split('.').length - 1;
}

function listClone(list) {
  return {
    ordered: list.ordered,
    numberStart: list.numberStart,
    numberStyle: list.numberStyle,
    itemList: list.itemList.map(itemClone),
  };
}

function itemClone(item) {
  return {
    markerText: item.markerText,
    spaceCount: item.spaceCount,
    indentExtra: item.indentExtra,
    gapBefore: item.gapBefore,
    isMarkerLineOwn: item.isMarkerLineOwn,
    segmentList: item.segmentList.map((segment) => (segment.type === 'list'
      ? { type: 'list', gapBefore: segment.gapBefore, list: listClone(segment.list) }
      : { type: 'content', gapBefore: segment.gapBefore, lineList: [...segment.lineList] })),
  };
}
