// Where the things of a structural edit are on the page, and where a dragged
// thing would go (design: doc_page_impl_edit_structure.md#the-layer,
// #dragging). The rendered body is asked for positions only: which block or
// item an element is, and where a place is, are answered from the block
// model, never from the DOM.
//
// every rectangle here is relative to the edit body ({ top, left, right,
// bottom } in px from the top left of .doc-edit-body), so it stays true
// while the page scrolls.
//
//   blockElementGet / itemElementGet   the element of a block, of an item
//   elementLocate(bodyElement, target) the block and item an element lies in
//   itemRectsGet(bodyElement, element) the rows an item takes: its own text
//                                      (rectHead), with what is under it
//                                      (rectSubtree), where its text starts
//                                      and ends, whether it is one line
//   textEndGet(element)                where the text of an element ends
//   itemBlockElementGet(itemElement)   the code block an item is, when it is one
//   rowListMeasure, blockRectListMeasure   every item row / block of the body
//   dropTargetFind(...)                the place under the pointer (pure)

export const STRUCT_OWN_SELECTOR = '.doc-edit-struct-own';

// the edit body an element belongs to: the nearest one (a document drawn
// inside a block has a body of its own)
function bodyOfElement(element) {
  return element?.closest?.('.doc-edit-body') ?? null;
}

export function blockElementGet(bodyElement, blockIndex) {
  if (!bodyElement) return null;
  for (const element of bodyElement.querySelectorAll(`.doc-edit-block[data-block-index="${blockIndex}"]`)) {
    if (bodyOfElement(element) === bodyElement) return element;
  }
  return null;
}

export function itemElementGet(bodyElement, blockIndex, itemPath) {
  const blockElement = blockElementGet(bodyElement, blockIndex);
  if (!blockElement) return null;
  for (const element of blockElement.querySelectorAll(`li[data-edit-item="${itemPath}"]`)) {
    if (element.closest('.doc-edit-block') === blockElement) return element;
  }
  return null;
}

// the block of this body an element lies in, and the item of its list:
// { blockIndex, itemPath } (itemPath '' outside an item); undefined when the
// element is not in a block of this body
export function elementLocate(bodyElement, target) {
  if (!(target instanceof Element) || bodyOfElement(target) !== bodyElement) return undefined;
  const blockElement = target.closest('.doc-edit-block[data-block-index]');
  if (!blockElement || bodyOfElement(blockElement) !== bodyElement) return undefined;
  const itemElement = target.closest('li[data-edit-item]');
  const isItemOfBlock = itemElement && itemElement.closest('.doc-edit-block') === blockElement;
  return {
    blockIndex: Number(blockElement.dataset.blockIndex),
    itemPath: isItemOfBlock ? String(itemElement.dataset.editItem) : '',
    blockElement,
    itemElement: isItemOfBlock ? itemElement : null,
  };
}

// the item of a list block whose own text is at a height of the screen: a
// click beside the text (on a marker, in the gap between two items) still
// means an item
export function itemPathAtPoint(blockElement, clientY) {
  let pathNearest = '';
  let distanceNearest = Infinity;
  for (const element of blockElement.querySelectorAll('li[data-edit-item]')) {
    if (element.closest('.doc-edit-block') !== blockElement) continue;
    const rect = itemHeadClientRectGet(element);
    const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    if (distance < distanceNearest) {
      distanceNearest = distance;
      pathNearest = String(element.dataset.editItem);
    }
  }
  return pathNearest;
}

function relativeRectBuild(bodyElement, rect) {
  const rectBody = bodyElement.getBoundingClientRect();
  return {
    top: rect.top - rectBody.top,
    bottom: rect.bottom - rectBody.top,
    left: rect.left - rectBody.left,
    right: rect.right - rectBody.left,
  };
}

// the first nested list of an item: where its own text ends
function itemListFirstGet(itemElement) {
  for (const child of itemElement.children) {
    if (child.hasAttribute('data-edit-list')) return child;
  }
  return null;
}

// the rows the own text of an item takes, in viewport coordinates: from the
// top of its first line to the bottom of its last one, before its first
// nested list. the boxes of the text are lower than their lines, so they are
// grown to the line height.
function itemHeadClientRectGet(itemElement) {
  const rectItem = itemElement.getBoundingClientRect();
  const listFirst = itemListFirstGet(itemElement);
  const lineHeight = lineHeightGet(itemElement);
  const range = document.createRange();
  range.selectNodeContents(itemElement);
  if (listFirst) range.setEndBefore(listFirst);
  const rectList = [...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0);
  if (rectList.length === 0) {
    // no text of its own: one line at the top of the item
    return {
      top: rectItem.top, bottom: rectItem.top + lineHeight, left: rectItem.left, right: rectItem.right, textRight: rectItem.left, isSingleLine: true,
    };
  }
  let top = Infinity;
  let bottom = -Infinity;
  let textRight = rectItem.left;
  for (const rect of rectList) {
    const grow = rect.height < lineHeight - 1 ? (lineHeight - rect.height) / 2 : 0;
    top = Math.min(top, rect.top - grow);
    bottom = Math.max(bottom, rect.bottom + grow);
    textRight = Math.max(textRight, rect.right);
  }
  // the first line of an item usually starts at the top of the item: then
  // that edge is exact, where the grown box of the text is a fraction off
  if (Math.abs(top - rectItem.top) < 3) top = rectItem.top;
  if (!listFirst && Math.abs(bottom - rectItem.bottom) < 3) bottom = rectItem.bottom;
  if (listFirst) bottom = Math.min(bottom, listFirst.getBoundingClientRect().top);
  return {
    top, bottom, left: rectItem.left, right: rectItem.right, textRight, isSingleLine: bottom - top < lineHeight * 1.5,
  };
}

// where the text of an element ends, in viewport coordinates: the right edge
// of its text and whether the text is one line (an element without text ends
// where it starts). for the surface an item is typed in.
export function textEndGet(element) {
  const rectElement = element.getBoundingClientRect();
  const lineHeight = lineHeightGet(element);
  const range = document.createRange();
  range.selectNodeContents(element);
  const rectList = [...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0);
  if (rectList.length === 0) return { right: rectElement.left, isSingleLine: !element.textContent.includes('\n') };
  let top = Infinity;
  let bottom = -Infinity;
  let topLast = -Infinity;
  let right = rectElement.left;
  for (const rect of rectList) {
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
    topLast = Math.max(topLast, rect.top);
    right = Math.max(right, rect.right);
  }
  // a surface with chips (surface-atom.js): a chip is higher than a line of
  // text, so one line is told by where the boxes start, not where they end
  if (element.hasAttribute('data-atoms')) return { right, isSingleLine: topLast - top < lineHeight * 0.5 && !element.textContent.includes('\n') };
  return { right, isSingleLine: bottom - top < lineHeight * 1.5 && !element.textContent.includes('\n') };
}

// the code blocks of the own text of an item, in order: the elements that
// carry the key of their block (data-code-key: a tile, or the figure of a
// block of another view), not those of the items under it
export function itemCodeElementListGet(itemElement) {
  return [...itemElement.querySelectorAll('[data-code-key]')].filter((element) => element.closest('li') === itemElement);
}

// the <pre> of the lines of a part of an item (its code block at that index
// among the code blocks of its text), or null
export function itemPartBlockElementGet(itemElement, partIndex) {
  return itemCodeElementListGet(itemElement)[partIndex]?.querySelector('pre') ?? null;
}

// the code block the own text of an item is rendered as (an item that is a
// text block): its <pre>, or null
export function itemBlockElementGet(itemElement) {
  for (const element of itemElement.querySelectorAll('pre')) {
    if (element.closest('li') === itemElement) return element;
  }
  return null;
}

// The room an item takes while it is edited
// (doc_page_impl_edit_structure.md#the-room-of-an-item-being-edited). the
// source of the item lies over the rendered item, which shows the text the
// session started with; when the text being typed is higher or lower than
// that, the rendered item is given the height of the source, so that what
// follows moves down or up, as it will stand once the text is saved.
//
//   heightSet(height)   the height the source has now
//   close()             the rendered item as it was
//
// an item that is a text block follows exactly: its <pre> gets the height of
// the lines being typed, and what the lines had beyond it is cut. an item of
// text only grows: its text is no element that could be made lower, so the
// room it needs beyond the height it had (heightBase) is added below it, as
// margin above its first nested list or as padding of an item without one.
// nothing is added to the list: the styles set here are taken off again.
export function itemRoomOpen(itemElement, { isBlockFormat = false, heightBase = 0, blockElement: blockElementGiven } = {}) {
  const restoreList = [];
  const styleSet = (element, name, value) => {
    const valueBefore = element.style.getPropertyValue(name);
    if (!restoreList.some((entry) => entry.element === element && entry.name === name)) restoreList.push({ element, name, valueBefore });
    element.style.setProperty(name, value);
  };
  const close = () => {
    for (const { element, name, valueBefore } of restoreList) {
      if (valueBefore) element.style.setProperty(name, valueBefore);
      else element.style.removeProperty(name);
    }
    restoreList.length = 0;
  };
  const blockElement = isBlockFormat ? blockElementGiven ?? itemBlockElementGet(itemElement) : null;
  if (blockElement) {
    // a long block scrolls inside its viewport; while it is typed, it shows all its lines
    const viewport = blockElement.parentElement;
    if (viewport && viewport !== itemElement) styleSet(viewport, 'max-height', 'none');
    return {
      heightSet: (height) => {
        styleSet(blockElement, 'height', `${Math.max(0, height)}px`);
        styleSet(blockElement, 'overflow', 'hidden');
      },
      close,
    };
  }
  const listFirst = itemListFirstGet(itemElement);
  const target = listFirst ?? itemElement;
  const name = listFirst ? 'margin-top' : 'padding-bottom';
  const valueBase = parseFloat(getComputedStyle(target).getPropertyValue(name)) || 0;
  return {
    heightSet: (height) => {
      const extra = Math.max(0, Math.round(height - heightBase));
      if (extra > 0) styleSet(target, name, `${valueBase + extra}px`);
      else if (restoreList.length > 0) close();
    },
    close,
  };
}

function lineHeightGet(element) {
  const style = getComputedStyle(element);
  const lineHeight = parseFloat(style.lineHeight);
  return Number.isFinite(lineHeight) ? lineHeight : parseFloat(style.fontSize) * 1.5;
}

// the rectangles of an item, relative to the body:
//   rectHead      its own text
//   rectSubtree   the item with what is under it
//   textLeft      where its text starts (its marker hangs left of it)
//   markerLeft    where its marker starts: the left edge of its list
export function itemRectsGet(bodyElement, itemElement) {
  const rectItem = itemElement.getBoundingClientRect();
  const rectHeadClient = itemHeadClientRectGet(itemElement);
  const rectList = itemElement.parentElement?.getBoundingClientRect() ?? rectItem;
  const rectHead = relativeRectBuild(bodyElement, { ...rectHeadClient, left: rectList.left, right: rectItem.right });
  const rectSubtree = relativeRectBuild(bodyElement, {
    top: Math.min(rectItem.top, rectHeadClient.top),
    bottom: Math.max(rectItem.bottom, rectHeadClient.bottom),
    left: rectList.left,
    right: rectItem.right,
  });
  const rectBody = bodyElement.getBoundingClientRect();
  // the text of an item starts after the padding of the item, which is the
  // space between its marker and its text
  const paddingLeft = parseFloat(getComputedStyle(itemElement).paddingLeft) || 0;
  return {
    rectHead,
    rectSubtree,
    textLeft: rectItem.left + paddingLeft - rectBody.left,
    markerLeft: rectList.left - rectBody.left,
    // where the own text ends, and whether it is one line: a short item of
    // one line has its controls right after its text
    textRight: rectHeadClient.textRight - rectBody.left,
    isSingleLine: rectHeadClient.isSingleLine,
  };
}

export function blockRectGet(bodyElement, blockElement) {
  return relativeRectBuild(bodyElement, blockElement.getBoundingClientRect());
}

// every item row of the list blocks of the body, in document order:
// [{ blockIndex, itemPath, depth, top, bottom, markerLeft, textLeft, right }]
// (top / bottom: its own text). modelBlockList: the blocks of the model.
export function rowListMeasure(bodyElement, modelBlockList) {
  const rowList = [];
  for (const block of modelBlockList) {
    if (!block.list) continue;
    for (const item of block.list.rowList) {
      const element = itemElementGet(bodyElement, block.index, item.path);
      if (!element) continue;
      const { rectHead, textLeft, markerLeft } = itemRectsGet(bodyElement, element);
      rowList.push({
        blockIndex: block.index,
        itemPath: item.path,
        depth: item.depth,
        top: rectHead.top,
        bottom: rectHead.bottom,
        markerLeft,
        textLeft,
        right: rectHead.right,
      });
    }
  }
  return rowList;
}

// every root-level block of the body: [{ blockIndex, top, bottom, left, right }]
export function blockRectListMeasure(bodyElement, modelBlockList) {
  const rectList = [];
  for (const block of modelBlockList) {
    const element = blockElementGet(bodyElement, block.index);
    if (!element) continue;
    rectList.push({ blockIndex: block.index, ...blockRectGet(bodyElement, element) });
  }
  return rectList;
}

// ---------- the place under the pointer ----------

// how far outside a list block the pointer still means that list
const BLOCK_REACH = 28;

// the place a dragged thing would go to, with the line that shows it.
//   subject       { kind: 'block' | 'item', blockIndex, itemPath, depth }
//   pointer       { x, y } relative to the body
//   pointerStart  where the pointer was when the drag began
//   rowList       rowListMeasure (kind 'item')
//   blockRectList blockRectListMeasure
// answers { target, indicator: { top, left, right } }, or undefined when the
// pointer is at no place (on the dragged thing itself, at the place it
// already has, outside every list).
//
// a block goes to a border between two blocks: the nearest one.
//
// an item goes into a gap between two rows of a list block, and the gap alone
// does not say its level: below the last child of an item it may become one
// more child, or follow the item, or follow the item above that. the levels
// a gap takes are from the level of the row below it (a row cannot come
// under an item that is deeper than the one before it) to one deeper than
// the row above it (its first child). among them the item keeps the level it
// has, and the pointer moved sideways changes it: one level deeper for every
// indentation it moved to the right since the drag began, one level up for
// every one to the left. so a drag straight down reorders, and a drag that
// drifts right nests.
export function dropTargetFind({ subject, pointer, pointerStart = pointer, rowList = [], blockRectList = [] }) {
  if (subject.kind === 'block') return dropTargetBlockFind(subject, pointer, blockRectList);
  return dropTargetItemFind(subject, pointer, pointerStart, rowList);
}

// how far right a nested list stands of the list it is in: measured between
// an item and its parent, or the usual indentation of a list
const INDENT_DEFAULT = 24;
const LEVEL_STEP_MIN = 28;
function indentWidthGet(rowList) {
  for (const row of rowList) {
    if (row.depth === 0) continue;
    const pathParent = row.itemPath.split('.').slice(0, -1).join('.');
    const rowParent = rowList.find((rowOne) => rowOne.blockIndex === row.blockIndex && rowOne.itemPath === pathParent);
    const width = rowParent ? row.markerLeft - rowParent.markerLeft : 0;
    if (width > 4) return width;
  }
  return INDENT_DEFAULT;
}

function dropTargetBlockFind(subject, pointer, blockRectList) {
  if (blockRectList.length === 0) return undefined;
  const rectSubject = blockRectList.find((rect) => rect.blockIndex === subject.blockIndex);
  if (rectSubject && pointer.y >= rectSubject.top && pointer.y <= rectSubject.bottom) return undefined;
  let position = 0;
  while (position < blockRectList.length && (blockRectList[position].top + blockRectList[position].bottom) / 2 < pointer.y) position += 1;
  const rectAbove = blockRectList[position - 1];
  const rectBelow = blockRectList[position];
  const borderIndex = rectBelow ? rectBelow.blockIndex : rectAbove.blockIndex + 1;
  const top = rectAbove && rectBelow ? (rectAbove.bottom + rectBelow.top) / 2 : rectAbove ? rectAbove.bottom + 6 : rectBelow.top - 6;
  const rectSide = rectBelow ?? rectAbove;
  return { target: { kind: 'block', borderIndex }, indicator: { top, left: rectSide.left, right: rectSide.right } };
}

function dropTargetItemFind(subject, pointer, pointerStart, rowList) {
  if (rowList.length === 0) return undefined;
  const isSubjectRow = (row) => row.blockIndex === subject.blockIndex
    && (row.itemPath === subject.itemPath || row.itemPath.startsWith(`${subject.itemPath}.`));
  const rowListSubject = rowList.filter(isSubjectRow);
  const subjectTop = rowListSubject.length > 0 ? rowListSubject[0].top : undefined;
  const subjectBottom = rowListSubject.length > 0 ? rowListSubject[rowListSubject.length - 1].bottom : undefined;
  if (subjectTop !== undefined && pointer.y >= subjectTop && pointer.y <= subjectBottom) return undefined;

  // the list block the pointer is at: the one whose rows it is among, or just beside
  const extentByBlock = new Map();
  for (const row of rowList) {
    const extent = extentByBlock.get(row.blockIndex);
    if (!extent) extentByBlock.set(row.blockIndex, { top: row.top, bottom: row.bottom });
    else extent.bottom = row.bottom;
  }
  let blockIndex;
  let distanceNearest = Infinity;
  for (const [blockIndexOne, extent] of extentByBlock) {
    const distance = pointer.y < extent.top ? extent.top - pointer.y : pointer.y > extent.bottom ? pointer.y - extent.bottom : 0;
    if (distance < distanceNearest) {
      distanceNearest = distance;
      blockIndex = blockIndexOne;
    }
  }
  if (blockIndex === undefined || distanceNearest > BLOCK_REACH) return undefined;

  // the rows of that block without what is dragged
  const rowListBlock = rowList.filter((row) => row.blockIndex === blockIndex && !isSubjectRow(row));
  if (rowListBlock.length === 0) return undefined;
  let position = 0;
  while (position < rowListBlock.length && (rowListBlock[position].top + rowListBlock[position].bottom) / 2 < pointer.y) position += 1;
  const rowAbove = rowListBlock[position - 1];
  const rowBelow = rowListBlock[position];

  const depthMin = rowBelow ? rowBelow.depth : 0;
  const depthMax = rowAbove ? rowAbove.depth + 1 : 0;
  // the marker column of an item at a level in this gap
  const markerLeftGet = (depth) => {
    if (!rowAbove) return rowBelow.markerLeft;
    if (depth === rowAbove.depth + 1) return rowBelow && rowBelow.depth === depth ? rowBelow.markerLeft : rowAbove.textLeft;
    return rowAncestorGet(rowListBlock, rowAbove, depth)?.markerLeft ?? rowAbove.markerLeft;
  };
  // one level per indentation moved sideways, and no less than a hand needs
  // to mean it: a pointer that only wobbles keeps the level
  const levelStep = Math.max(LEVEL_STEP_MIN, indentWidthGet(rowList));
  const depthWanted = (subject.depth ?? 0) + Math.round((pointer.x - pointerStart.x) / levelStep);
  const depth = Math.max(depthMin, Math.min(depthMax, depthWanted));

  // the gap the dragged thing stands in, at the level it has: its own place
  let gapTop = rowAbove ? rowAbove.bottom : rowBelow.top - 6;
  let gapBottom = rowBelow ? rowBelow.top : rowAbove.bottom + 6;
  const isSubjectInGap = subjectTop !== undefined && subject.blockIndex === blockIndex
    && (!rowAbove || subjectTop >= rowAbove.bottom - 1) && (!rowBelow || subjectBottom <= rowBelow.top + 1);
  if (isSubjectInGap && depth === (subject.depth ?? 0)) return undefined;

  let target;
  if (!rowAbove) {
    target = { kind: 'item', blockIndex, itemPath: rowBelow.itemPath, position: 'before', depth: 0 };
  } else if (depth === rowAbove.depth + 1) {
    target = { kind: 'item', blockIndex, itemPath: rowAbove.itemPath, position: 'childFirst', depth };
  } else {
    const rowAncestor = rowAncestorGet(rowListBlock, rowAbove, depth) ?? rowAbove;
    target = { kind: 'item', blockIndex, itemPath: rowAncestor.itemPath, position: 'after', depth };
  }

  // the line stands in the gap, on the side of the dragged thing the pointer is on
  if (isSubjectInGap) {
    if (pointer.y < subjectTop) gapBottom = subjectTop;
    else gapTop = subjectBottom;
  }
  const rowSide = rowAbove ?? rowBelow;
  return { target, indicator: { top: (gapTop + gapBottom) / 2, left: markerLeftGet(depth), right: rowSide.right } };
}

// the row of the item at a level above a row (the row itself at its own level)
function rowAncestorGet(rowList, row, depth) {
  if (depth === row.depth) return row;
  const pathAncestor = row.itemPath.split('.').slice(0, depth + 1).join('.');
  return rowList.find((rowOne) => rowOne.blockIndex === row.blockIndex && rowOne.itemPath === pathAncestor);
}

// the nearest element that scrolls the body, or undefined when the window does
export function scrollParentGet(element) {
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return undefined;
}
