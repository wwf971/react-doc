// The typed text of a cell and its surface (doc_page_impl_edit_cell.md#a-token-marked-in-the-typed-text):
// offsets into the text as positions of the DOM of a plain EditSourceSurface, and back. The
// surface holds text nodes, and a <br> where a browser writes a line break so; both read as
// innerText reads them (a <br> one "\n"), as the surface reads its text. Words drawn in a style
// stand in an element of their own (cell-style-surface.js): the offsets count their text as any
// other, so a surface drawing styles is counted in its bare text.
//
// The mark of a token is drawn by the browser's highlight registry (::highlight(doc-cell-token-mark),
// Cell.css): nothing is added to the text, so the caret, the typing and the text read back stay
// those of plain text. One token is marked on the page at a time.

export const CELL_TOKEN_MARK_HIGHLIGHT = 'doc-cell-token-mark';

// the nodes of the text in their order: text nodes and line breaks
function surfaceNodeListGet(root) {
  const list = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR') list.push(node);
  }
  return list;
}

function nodeLengthGet(node) {
  return node.nodeType === Node.TEXT_NODE ? node.nodeValue.length : 1;
}

// the DOM position of an offset of the text: { node, offset }. where two nodes meet (the end
// of one is the start of the next: the edge of styled words), the end of the first, or with
// side 'after' the start of the second, so that what is typed there goes into it
function surfacePositionGet(element, offset, side = 'before') {
  let rest = Math.max(0, offset);
  const nodeList = surfaceNodeListGet(element);
  for (let index = 0; index < nodeList.length; index += 1) {
    const node = nodeList[index];
    if (node.nodeType === Node.TEXT_NODE) {
      if (rest <= node.nodeValue.length) {
        const next = nodeList[index + 1];
        if (side === 'after' && rest === node.nodeValue.length && next?.nodeType === Node.TEXT_NODE) return { node: next, offset: 0 };
        return { node, offset: rest };
      }
      rest -= node.nodeValue.length;
    } else {
      if (rest === 0) return { node: node.parentNode, offset: [...node.parentNode.childNodes].indexOf(node) };
      rest -= 1;
    }
  }
  return { node: element, offset: element.childNodes.length };
}

// the offset of the text at a DOM position inside the surface
function surfaceOffsetOf(element, node, offset) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(node, offset);
  return surfaceNodeListGet(range.cloneContents()).reduce((sum, one) => sum + nodeLengthGet(one), 0);
}

export function cellSurfaceRangeBuild(element, start, end) {
  const range = document.createRange();
  const from = surfacePositionGet(element, start);
  const to = surfacePositionGet(element, end);
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

// what is selected inside the surface, as offsets of its text; undefined when the selection is elsewhere
export function cellSurfaceSelectionGet(element) {
  const selection = window.getSelection?.();
  if (!element || !selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return undefined;
  const start = surfaceOffsetOf(element, range.startContainer, range.startOffset);
  const end = surfaceOffsetOf(element, range.endContainer, range.endOffset);
  return { start, end, isCollapsed: start === end };
}

export function cellSurfaceSelectionSet(element, start, end = start) {
  const selection = window.getSelection?.();
  if (!element || !selection) return;
  selection.removeAllRanges();
  selection.addRange(cellSurfaceRangeBuild(element, start, end));
}

// the caret at an offset, on a side of it where two nodes meet there ('before' | 'after')
export function cellSurfaceCaretSet(element, offset, side = 'before') {
  const selection = window.getSelection?.();
  if (!element || !selection) return;
  const position = surfacePositionGet(element, offset, side);
  selection.removeAllRanges();
  const range = document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  selection.addRange(range);
}

// whether a point (a click) lies on the words of a part of the text, a line at a time
export function cellSurfacePointIsOn(element, start, end, point, tolerance = 1) {
  if (!element || end <= start || !point) return false;
  const rectList = [...cellSurfaceRangeBuild(element, start, end).getClientRects()];
  return rectList.some((rect) => rect.width > 0 && point.clientX >= rect.left - tolerance && point.clientX <= rect.right + tolerance
    && point.clientY >= rect.top - tolerance && point.clientY <= rect.bottom + tolerance);
}

// the box of a part of the text: the first line's left, the last line's bottom (a card under it
// starts where the token starts and stands under all of it)
export function cellSurfaceRangeRectGet(element, start, end) {
  if (!element) return undefined;
  const rectList = [...cellSurfaceRangeBuild(element, start, end).getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0);
  if (rectList.length === 0) return element.getBoundingClientRect();
  const first = rectList[0];
  const last = rectList[rectList.length - 1];
  return { left: first.left, top: first.top, right: Math.max(...rectList.map((rect) => rect.right)), bottom: last.bottom };
}

// where a part of the text starts: the box of its first line (a label over the start of a value
// stands on it); an empty part, the box of the caret there (a line's height, no width)
export function cellSurfaceRangeStartRectGet(element, start, end) {
  if (!element) return undefined;
  const range = cellSurfaceRangeBuild(element, start, Math.max(start, end));
  const first = [...range.getClientRects()].find((rect) => rect.height > 0);
  if (first) return first;
  const rect = range.getBoundingClientRect();
  if (rect.height > 0) return rect;
  // a caret where two nodes meet may have no box: the end of the character before it
  if (start > 0) {
    const before = [...cellSurfaceRangeBuild(element, start - 1, start).getClientRects()].find((one) => one.height > 0);
    if (before) return { left: before.right, right: before.right, top: before.top, bottom: before.bottom, width: 0, height: before.height };
  }
  return element.getBoundingClientRect();
}

// the text of the surface as it reads it (innerText; one line break more is written after a text
// ending with one, so the caret can stand on the last line)
export function cellSurfaceTextRead(element) {
  return element ? element.innerText.replace(/\n$/, '') : '';
}

// a part of the text replaced where it is, outside the browser's typing: the surface is told
// nothing, so the owner of the draft reads it back (cellSurfaceTextRead)
export function cellSurfaceRangeReplace(element, start, end, text) {
  const range = cellSurfaceRangeBuild(element, start, end);
  range.deleteContents();
  if (text) range.insertNode(document.createTextNode(text));
  element.normalize();
}

// ---------- the mark ----------

let markOwnerClear = null;

// the words of a token marked: the mark of another surface is taken away first
export function cellTokenMarkDraw(element, start, end, ownerClear) {
  if (markOwnerClear && markOwnerClear !== ownerClear) markOwnerClear();
  markOwnerClear = ownerClear;
  const registry = globalThis.CSS?.highlights;
  if (!registry || typeof globalThis.Highlight !== 'function' || !element) return;
  registry.set(CELL_TOKEN_MARK_HIGHLIGHT, new globalThis.Highlight(cellSurfaceRangeBuild(element, start, end)));
}

export function cellTokenMarkErase(ownerClear) {
  if (ownerClear && markOwnerClear !== ownerClear) return;
  markOwnerClear = null;
  globalThis.CSS?.highlights?.delete(CELL_TOKEN_MARK_HIGHLIGHT);
}
