import { editTextModelBuild } from './doc-edit-block.js';
import { listTextBuild } from './doc-edit-list.js';
import { splitFrontmatter } from './doc-frontmatter.js';

// The block mode of a managed document (design: doc_page_impl_doc_managed.md#the-block-mode):
// the document kept as its structure, the root-level blocks of the edit layer
// and the items of its lists, each with an id of its own, instead of its text.
// The text is a view of the structure: every reader of the page (the source
// api, the compile, the edit layer, the link index) gets the text built from
// it, and every write of a text is read back into blocks, the ids of what
// stayed kept. Nothing is lost: a block whose structure would not write its
// text again is kept as its text, and a document that cannot be read as
// blocks at all (invalid MDX, \r line endings) is kept as one raw text.
//
//   content    { format, frontmatter, blockList, gapAfter }
//              | { format, raw }                         the text as it is
//     format         md | mdx: how the text is read (the extension of its path)
//     frontmatter    the lines of the frontmatter with its fences, '' for none
//     gapAfter       the lines after the last block: a count of empty lines,
//                    or the lines themselves when one holds spaces
//   block      { blockId, kind, gapBefore?, text }        any block, by its text
//              { blockId, kind: 'list', gapBefore?, prefix?, list: { itemList } }
//     gapBefore      the lines before the block (after the frontmatter, or the
//                    block before): a count of empty lines, or the lines
//     kind           the kind the edit layer reads (heading, paragraph, list,
//                    code, component, ...)
//     prefix         lines of the block before its list (an Anchor marker)
//   item       { itemId, marker, text?, itemList?, partList?, spaceCount?,
//                indentExtra?, gapBefore?, isMarkerLineOwn? }
//     marker         "-", "*", "+", "3.", "3)"
//     text           the item's own text (its first content), lines joined
//     itemList       its nested items, when the item is its text and one list
//                    right under it; any other shape is partList:
//                    [{ text, gapBefore? } | { itemList, gapBefore? }]
//     spaceCount, indentExtra, gapBefore, isMarkerLineOwn: the layout of the
//                    list model (doc-edit-list.js), written when not the default
//
// ids are six characters of 0-9 a-z, unique in one document (blocks and items
// share the space). A write keeps the id of a block whose text stayed, and of a
// block edited in place (the same kind between the same unchanged neighbors);
// the items of a list block keep theirs the same way.

const ID_LENGTH = 6;

// the content of a text; contentPrev: the content it replaces, whose ids are kept
/** @param {string} text @param {{ format?: string, contentPrev?: any }} [option] */
export function docManagedBlockContentBuild(text, { format = 'md', contentPrev = undefined } = {}) {
  const formatNormalized = format === 'mdx' ? 'mdx' : 'md';
  const contentRead = contentReadOrRaw(text, formatNormalized);
  if (contentRead.raw !== undefined) return contentRead;
  idListAssign(contentRead, contentPrev);
  return contentRead;
}

// the text a content stands for
export function docManagedBlockTextBuild(content) {
  if (typeof content?.raw === 'string') return content.raw;
  const lineList = [];
  const frontmatter = String(content?.frontmatter ?? '');
  if (frontmatter !== '') lineList.push(...frontmatter.replace(/\n$/, '').split('\n'));
  for (const block of content?.blockList ?? []) {
    lineList.push(...gapLineListGet(block.gapBefore));
    lineList.push(...blockTextGet(block, content.format).split('\n'));
  }
  lineList.push(...gapLineListGet(content?.gapAfter));
  return lineList.join('\n');
}

// what a reader is shown of the structure: one row per block and per item,
// in order, { id, kind, depth, label }
export function docManagedBlockOutlineGet(content) {
  const rowList = [];
  if (typeof content?.raw === 'string') return rowList;
  for (const block of content?.blockList ?? []) {
    rowList.push({ id: block.blockId, kind: block.kind, depth: 0, label: labelOfText(block.list ? '' : block.text) });
    if (block.list) itemListWalk(block.list.itemList, 1, (item, depth) => rowList.push({ id: item.itemId, kind: 'item', depth, label: labelOfText(itemTextOwnGet(item)) }));
  }
  return rowList;
}

// ---------- reading a text ----------

function contentReadOrRaw(text, format) {
  const raw = { format, raw: text };
  if (text.includes('\r')) return raw;
  let model;
  try {
    model = editTextModelBuild({ text, format });
  } catch {
    return raw;
  }
  const lineList = text.split('\n');
  const { content: body } = splitFrontmatter(text);
  const frontmatter = text.slice(0, text.length - body.length);
  const frontmatterLineCount = frontmatter === '' ? 0 : frontmatter.replace(/\n$/, '').split('\n').length;
  const blockList = [];
  let lineNext = frontmatterLineCount + 1;
  for (const blockModel of model.blockList) {
    const block = { blockId: '', kind: blockModel.kind };
    const gap = gapOfLineList(lineList.slice(lineNext - 1, blockModel.lineStart - 1));
    if (gap !== 0) block.gapBefore = gap;
    const listStored = blockModel.list ? listStoredBuild(blockModel, format) : undefined;
    if (listStored) Object.assign(block, listStored);
    else block.text = blockModel.text;
    blockList.push(block);
    lineNext = blockModel.lineEnd + 1;
  }
  const content = { format, frontmatter, blockList, gapAfter: gapOfLineList(lineList.slice(lineNext - 1)) };
  // the structure must write the text again, else the text is kept
  return docManagedBlockTextBuild(content) === text ? content : raw;
}

// a list block as items, when its items write its text again; undefined otherwise
function listStoredBuild(blockModel, format) {
  const model = blockModel.list;
  const stored = { list: { itemList: model.list.itemList.map(itemStoredBuild) } };
  if (model.linePrefixList.length > 0) stored.prefix = model.linePrefixList.join('\n');
  const isSame = listTextOfStoredGet(stored, format) === blockModel.text;
  return isSame ? stored : undefined;
}

function itemStoredBuild(itemModel) {
  const item = { itemId: '', marker: itemModel.markerText };
  const partList = itemModel.segmentList.map((segment) => {
    const part = segment.type === 'list'
      ? { itemList: segment.list.itemList.map(itemStoredBuild) }
      : { text: segment.lineList.join('\n') };
    if (segment.gapBefore) part.gapBefore = segment.gapBefore;
    return part;
  });
  const [partFirst, partSecond] = partList;
  const isTextOnly = partList.length === 1 && partFirst.text !== undefined;
  const isTextAndList = partList.length === 2 && partFirst.text !== undefined && partSecond.itemList !== undefined && !partSecond.gapBefore;
  if (isTextOnly) item.text = partFirst.text;
  else if (isTextAndList) {
    item.text = partFirst.text;
    item.itemList = partSecond.itemList;
  } else if (partList.length > 0) item.partList = partList;
  if (itemModel.spaceCount !== 1) item.spaceCount = itemModel.spaceCount;
  if (itemModel.indentExtra) item.indentExtra = itemModel.indentExtra;
  if (itemModel.gapBefore) item.gapBefore = itemModel.gapBefore;
  if (itemModel.isMarkerLineOwn) item.isMarkerLineOwn = true;
  return item;
}

// ---------- writing a text ----------

function blockTextGet(block, format) {
  if (block.list) return listTextOfStoredGet(block, format);
  return String(block.text ?? '');
}

function listTextOfStoredGet(block, format) {
  const model = {
    format,
    linePrefixList: block.prefix !== undefined ? String(block.prefix).split('\n') : [],
    list: { itemList: block.list.itemList.map(itemModelBuild) },
  };
  return listTextBuild(model);
}

// the list model item (doc-edit-list.js) of a stored item
function itemModelBuild(item) {
  const partList = itemPartListGet(item);
  return {
    markerText: item.marker,
    spaceCount: item.spaceCount ?? 1,
    indentExtra: item.indentExtra ?? 0,
    gapBefore: item.gapBefore ?? 0,
    isMarkerLineOwn: item.isMarkerLineOwn === true,
    segmentList: partList.map((part) => (part.itemList !== undefined
      ? { type: 'list', gapBefore: part.gapBefore ?? 0, list: { itemList: part.itemList.map(itemModelBuild) } }
      : { type: 'content', gapBefore: part.gapBefore ?? 0, lineList: String(part.text).split('\n') })),
  };
}

function itemPartListGet(item) {
  if (Array.isArray(item.partList)) return item.partList;
  const partList = [];
  if (item.text !== undefined) partList.push({ text: item.text });
  if (item.itemList !== undefined) partList.push({ itemList: item.itemList });
  return partList;
}

function itemTextOwnGet(item) {
  const partFirst = itemPartListGet(item)[0];
  return partFirst?.text ?? '';
}

function itemChildListGet(item) {
  return itemPartListGet(item).flatMap((part) => part.itemList ?? []);
}

function itemListWalk(itemList, depth, visit) {
  for (const item of itemList ?? []) {
    visit(item, depth);
    itemListWalk(itemChildListGet(item), depth + 1, visit);
  }
}

// ---------- gaps ----------

// the lines between two blocks: their count when all are empty, else the lines
function gapOfLineList(lineList) {
  return lineList.every((line) => line === '') ? lineList.length : lineList;
}

function gapLineListGet(gap) {
  if (Array.isArray(gap)) return gap.map(String);
  return new Array(Number(gap) || 0).fill('');
}

// ---------- ids ----------

// every block and item of content gets an id: the one of what it continues in
// contentPrev, else a new one, unique in the document
function idListAssign(content, contentPrev) {
  const blockListPrev = typeof contentPrev?.raw === 'string' ? [] : (contentPrev?.blockList ?? []);
  const idUsedSet = new Set();
  const pairList = sequencePair(blockListPrev, content.blockList, (block) => blockSignatureGet(block, content.format), (block) => block.kind);
  pairList.forEach((blockPrev, index) => {
    const block = content.blockList[index];
    if (blockPrev?.blockId && !idUsedSet.has(blockPrev.blockId)) {
      block.blockId = blockPrev.blockId;
      idUsedSet.add(block.blockId);
    }
  });
  for (const [index, block] of content.blockList.entries()) {
    if (!block.list) continue;
    const blockPrev = pairList[index];
    itemIdListAssign(block.list.itemList, blockPrev?.list?.itemList ?? [], idUsedSet);
  }
  for (const block of content.blockList) {
    if (!block.blockId) block.blockId = idNewGet(idUsedSet);
    if (block.list) itemListWalk(block.list.itemList, 0, (item) => { if (!item.itemId) item.itemId = idNewGet(idUsedSet); });
  }
}

// the items of a list keep the ids of the items they continue: the items of
// both lists in order, paired by their own text, the rest by place
function itemIdListAssign(itemList, itemListPrev, idUsedSet) {
  const rowList = [];
  const rowListPrev = [];
  itemListWalk(itemList, 0, (item) => rowList.push(item));
  itemListWalk(itemListPrev, 0, (item) => rowListPrev.push(item));
  const pairList = sequencePair(rowListPrev, rowList, (item) => itemTextOwnGet(item), () => 'item');
  pairList.forEach((itemPrev, index) => {
    if (itemPrev?.itemId && !idUsedSet.has(itemPrev.itemId)) {
      rowList[index].itemId = itemPrev.itemId;
      idUsedSet.add(itemPrev.itemId);
    }
  });
}

// for every element of listNew, the element of listPrev it continues, or
// undefined: first the longest common subsequence of equal signatures, then,
// between two of those pairs, the elements left of the same kind in order
// (one edited in place)
function sequencePair(listPrev, listNew, signatureGet, kindGet) {
  const signaturePrev = listPrev.map(signatureGet);
  const signatureNew = listNew.map(signatureGet);
  const lengthPrev = listPrev.length;
  const lengthNew = listNew.length;
  // table[i][j]: the longest common subsequence of listPrev[i..] and listNew[j..]
  const table = Array.from({ length: lengthPrev + 1 }, () => new Uint32Array(lengthNew + 1));
  for (let i = lengthPrev - 1; i >= 0; i -= 1) {
    for (let j = lengthNew - 1; j >= 0; j -= 1) {
      table[i][j] = signaturePrev[i] === signatureNew[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairList = new Array(lengthNew).fill(undefined);
  const anchorList = [];
  for (let i = 0, j = 0; i < lengthPrev && j < lengthNew;) {
    if (signaturePrev[i] === signatureNew[j]) {
      anchorList.push([i, j]);
      pairList[j] = listPrev[i];
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  // the gaps between anchors: pair by kind, in order
  const boundList = [[-1, -1], ...anchorList, [lengthPrev, lengthNew]];
  for (let index = 0; index + 1 < boundList.length; index += 1) {
    const [iStart, jStart] = boundList[index];
    const [iEnd, jEnd] = boundList[index + 1];
    let iNext = iStart + 1;
    for (let j = jStart + 1; j < jEnd; j += 1) {
      for (let i = iNext; i < iEnd; i += 1) {
        if (kindGet(listPrev[i]) !== kindGet(listNew[j])) continue;
        pairList[j] = listPrev[i];
        iNext = i + 1;
        break;
      }
    }
  }
  return pairList;
}

function blockSignatureGet(block, format) {
  return `${block.kind}\u0000${blockTextGet(block, format)}`;
}

function idNewGet(idUsedSet) {
  for (;;) {
    let id = '';
    for (let index = 0; index < ID_LENGTH; index += 1) id += Math.floor(Math.random() * 36).toString(36);
    if (!idUsedSet.has(id)) {
      idUsedSet.add(id);
      return id;
    }
  }
}

function labelOfText(text) {
  const line = String(text ?? '').split('\n').find((one) => one.trim() !== '') ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
