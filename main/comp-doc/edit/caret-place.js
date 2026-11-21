// Placing the caret in an editable element (design:
// doc_page_impl_edit.md#where-the-caret-goes). Every point here is a point
// of the viewport ({ clientX, clientY }, the coordinates a pointer event
// reports as clientX / clientY and getBoundingClientRect() measures in), so
// a pointer position, a caret rectangle, and an element rectangle compare
// directly; nothing is converted to page or element coordinates.
//
//   caretPlaceAtEdge(element, 'start' | 'end')    the caret at the start or the end of the text
//   caretPlaceByPoint(element, point)             the caret at the text position nearest to the point
//   caretPlaceOnLine(element, 'first' | 'last', clientX)
//                                                 the caret on the first / last visual line, at that x
//   caretPlaceInitial(element, selectionInitial)  the one entry the editors use; selectionInitial is
//                                                 'all' | 'start' | 'end' | { type: 'point', clientX, clientY }
//                                                 | { type: 'line', line: 'first' | 'last', clientX }
//                                                 | { type: 'offset', offset }
//   caretPlaceAtOffset(element, offset)           the caret after that many characters of the text
//   caretRectGet(element)                         the rectangle of the collapsed caret, or undefined
//   selectionSetAll(element)                      the whole text selected

export function caretPlaceInitial(element, selectionInitial) {
  if (!element) return;
  if (selectionInitial === 'all') {
    selectionSetAll(element);
    return;
  }
  if (selectionInitial === 'start' || selectionInitial === 'end') {
    caretPlaceAtEdge(element, selectionInitial);
    return;
  }
  if (selectionInitial?.type === 'point') {
    if (!caretPlaceByPoint(element, selectionInitial)) caretPlaceAtEdge(element, 'end');
    return;
  }
  if (selectionInitial?.type === 'line') {
    caretPlaceOnLine(element, selectionInitial.line, selectionInitial.clientX);
    return;
  }
  if (selectionInitial?.type === 'offset') {
    caretPlaceAtOffset(element, selectionInitial.offset);
    return;
  }
  caretPlaceAtEdge(element, 'end');
}

// the caret after `offset` characters of the text of the element (the end
// when the text is shorter): an editor opened again on the text it was
// editing puts the caret back where it was
export function caretPlaceAtOffset(element, offset) {
  const selection = window.getSelection?.();
  if (!selection) return;
  let offsetRest = Math.max(0, Number(offset) || 0);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (offsetRest <= node.length) {
      const range = document.createRange();
      range.setStart(node, offsetRest);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    offsetRest -= node.length;
  }
  caretPlaceAtEdge(element, 'end');
}

// the caret inside the text of the element (not at the element boundary,
// where the browser has no caret rectangle and arrow keys do not move it).
// the text may be one text node or the text of line elements (a surface in
// line mode); an empty line element holds a <br>, and the caret goes in front of it.
export function caretPlaceAtEdge(element, edge) {
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  const node = edgeNodeGet(element, edge);
  if (node.nodeType === Node.TEXT_NODE) range.setStart(node, edge === 'end' ? node.length : 0);
  else range.setStart(node, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// the first or last text node of the element, or the deepest element at
// that edge when it holds no text (an empty element, a line with a <br>)
function edgeNodeGet(element, edge) {
  let node = element;
  while (node.nodeType === Node.ELEMENT_NODE && node.firstChild) {
    const child = edge === 'end' ? node.lastChild : node.firstChild;
    if (child.nodeName === 'BR') break;
    node = child;
  }
  return node;
}

// the caret at the text position nearest to the point, which is first
// clamped into the element (a click on its margin still lands in it) and
// into the viewport (the browser answers for visible points only). false
// when the browser gives no position inside the element.
export function caretPlaceByPoint(element, point) {
  const selection = window.getSelection?.();
  if (!selection || !Number.isFinite(point?.clientX) || !Number.isFinite(point?.clientY)) return false;
  const rect = element.getBoundingClientRect();
  const x = clamp(point.clientX, Math.max(0, rect.left + 1), Math.min(window.innerWidth - 1, rect.right - 1));
  const y = clamp(point.clientY, Math.max(0, rect.top + 1), Math.min(window.innerHeight - 1, rect.bottom - 1));
  const position = caretPositionFromPointGet(x, y);
  if (!position || !element.contains(position.node)) return false;
  const range = document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// the caret on the first or the last visual line of the text, at clientX:
// an author arriving from the block above or below keeps the column of the
// caret. the start / end of the text when the line cannot be found.
export function caretPlaceOnLine(element, line, clientX) {
  const edge = line === 'first' ? 'start' : 'end';
  const rectList = textRectListGet(element);
  if (rectList.length === 0 || !Number.isFinite(clientX)) {
    caretPlaceAtEdge(element, edge);
    return;
  }
  const rectLine = line === 'first' ? rectList[0] : rectList[rectList.length - 1];
  const isPlaced = caretPlaceByPoint(element, { clientX, clientY: rectLine.top + rectLine.height / 2 });
  if (!isPlaced) caretPlaceAtEdge(element, edge);
}

export function selectionSetAll(element) {
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

// the rectangle of the collapsed caret inside the element; the browser gives
// none for an empty element or right after a line break, then the character
// before the caret (or after it, at the start) stands in
export function caretRectGet(element) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return undefined;
  const container = range.startContainer;
  // right after a line break the browser may give the box at the end of the
  // line above: the character after the caret, on its own line, says where it is
  if (container.nodeType === Node.TEXT_NODE && range.startOffset > 0 && container.data[range.startOffset - 1] === '\n'
    && range.startOffset < container.data.length && container.data[range.startOffset] !== '\n') {
    const rangeAfter = document.createRange();
    rangeAfter.setStart(container, range.startOffset);
    rangeAfter.setEnd(container, range.startOffset + 1);
    const rect = rangeAfter.getBoundingClientRect();
    if (rect.height > 0) return new DOMRect(rect.left, rect.top, 0, rect.height);
  }
  const rectCaret = range.getClientRects()[0];
  if (rectCaret && rectCaret.height > 0) return rectCaret;
  if (container.nodeType !== Node.TEXT_NODE) return undefined;
  const offset = range.startOffset;
  const textContainer = container.data;
  const rangeChar = document.createRange();
  // the character before the caret, unless it is the line break the caret
  // follows (its rectangle is on the line above)
  if (offset > 0 && textContainer[offset - 1] !== '\n') {
    rangeChar.setStart(container, offset - 1);
    rangeChar.setEnd(container, offset);
    const rect = rangeChar.getBoundingClientRect();
    if (rect.height > 0) return new DOMRect(rect.right, rect.top, 0, rect.height);
  }
  // else the character after the caret, when it is not a line break itself
  if (offset < textContainer.length && textContainer[offset] !== '\n') {
    rangeChar.setStart(container, offset);
    rangeChar.setEnd(container, offset + 1);
    const rect = rangeChar.getBoundingClientRect();
    if (rect.height > 0) return new DOMRect(rect.left, rect.top, 0, rect.height);
  }
  return undefined;
}

// the line boxes of the element's text, top to bottom. only text counts: a
// range over line elements would also report the boxes of the elements
function textRectListGet(element) {
  const rectList = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    rectList.push(...[...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0));
  }
  return rectList;
}

// the standard caretPositionFromPoint, or the WebKit caretRangeFromPoint
function caretPositionFromPointGet(x, y) {
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : undefined;
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : undefined;
  }
  return undefined;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
