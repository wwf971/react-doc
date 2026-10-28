import { createElement, Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import { caretPlaceAtEdge, caretPlaceInitial, caretRectGet } from './caret-place.js';
import { useEditSlash } from '../slash/use-edit-slash.js';
import './DocEdit.css';

// The editing surface of a block's source: the block's own element made
// editable, in the place of the block, never an <input> or a <textarea>. A
// paragraph edits as a <p>, a heading as its <h2>, so the text keeps the
// typography of the page and the block keeps its place while it is edited
// (doc_page_impl_edit.md#in-place-editing). The element is uncontrolled while
// typing: the browser owns the DOM, the typed text is reported through
// onTextChange, and the DOM is rewritten only when textVersion changes (text
// set by code).
//
//   tag                 element to render: 'p', 'h1'..'h6', 'div' (default)
//   kind                block kind, for the typography of the surface
//   text, textVersion   content to show; rewritten when textVersion changes
//   selectionInitial    where the caret is when the surface opens
//                       (doc_page_impl_edit.md#where-the-caret-goes):
//                       'end' (default), 'start', 'all' (a block created
//                       from a template: typing replaces it),
//                       { type: 'point', clientX, clientY } (the block was
//                       clicked there: the caret goes to the text nearest
//                       that point), { type: 'line', line: 'first' | 'last',
//                       clientX } (entered from the neighbor block by a
//                       focus shift: the caret keeps its x on the near line)
//   lineSpaceListGet    optional: (lineList) => the space above every line
//                       ('' none, or a name the stylesheet gives a gap,
//                       e.g. ListData.js listLineSpaceListGet). with it the
//                       surface is in line mode: every source line is an
//                       element of its own, spaced like the line it stands
//                       for in the rendered block, so entering the block does
//                       not change its line rhythm (a list: the gaps between
//                       its items)
//   slash               optional: config.edit.slash of the editor. with it
//                       the surface offers the slash mode: "/" typed at the
//                       start of a word opens the menu of actions
//                       (doc_page_impl_edit_slash.md); the keys of the menu
//                       come before the keys below while it is open
//   isLocked            no editing while a change request is pending
//   onTextChange(text)  typed text
//   onSubmitRequest()   Ctrl/Cmd + Enter
//   onCancelRequest()   Escape
//   onFocusShiftRequest(direction, { point })
//                       ArrowDown on the last line ('next') / ArrowUp on the
//                       first line ('previous'): the author wants to go on
//                       to the neighbor block. point is where the caret is
//                       (viewport coordinates), so the neighbor can keep its x.
export function EditSourceSurface({
  tag = 'div',
  kind,
  text,
  textVersion = 0,
  selectionInitial = 'end',
  lineSpaceListGet,
  slash,
  isLocked = false,
  className = '',
  onTextChange,
  onSubmitRequest,
  onCancelRequest,
  onFocusShiftRequest,
  ariaLabel = 'Block source',
}) {
  const elementRef = useRef(null);
  const slashBinding = useEditSlash(elementRef, slash, { textBeforeCaretGet });

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    surfaceContentWrite(element, text, lineSpaceListGet);
    // text set by code happens when the author is already working here
    if (textVersion > 0 && document.activeElement !== element) element.focus();
    caretPlaceAtEdge(element, 'end');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textVersion, tag]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || isLocked) return;
    element.focus({ preventScroll: true });
    caretPlaceInitial(element, selectionInitial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (slashBinding.keyDown(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancelRequest?.();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmitRequest?.();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      document.execCommand('insertText', false, '  ');
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && onFocusShiftRequest) {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      const direction = event.key === 'ArrowDown' ? 'next' : 'previous';
      const rectCaret = caretRectGet(event.currentTarget);
      if (!caretIsAtEdgeLine(event.currentTarget, direction, rectCaret)) return;
      event.preventDefault();
      const point = rectCaret ? { clientX: rectCaret.left, clientY: rectCaret.top + rectCaret.height / 2 } : undefined;
      onFocusShiftRequest(direction, { point });
    }
  };

  const pasteHandle = (event) => {
    // keep the surface plain text in browsers without plaintext-only
    event.preventDefault();
    const textPasted = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, textPasted);
  };

  // in line mode the lines are checked after every change: their spaces
  // follow the new text, and a shape typing broke is built again. never
  // during an IME composition, which owns the DOM until it ends
  const textReport = (element, isComposing) => {
    if (lineSpaceListGet && !isComposing) surfaceLineShapeKeep(element, lineSpaceListGet);
    onTextChange?.(surfaceTextGet(element));
  };

  const surface = createElement(tag, {
    ref: elementRef,
    className: `doc-edit-surface${className ? ` ${className}` : ''}`,
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': ariaLabel,
    'aria-readonly': isLocked ? 'true' : undefined,
    contentEditable: isLocked ? 'false' : contentEditableValueGet(),
    suppressContentEditableWarning: true,
    spellCheck: false,
    'data-kind': kind,
    'data-lines': lineSpaceListGet ? '' : undefined,
    'data-locked': isLocked ? '' : undefined,
    onInput: (event) => {
      textReport(event.currentTarget, event.nativeEvent?.isComposing === true);
      slashBinding.inputAfter(event);
    },
    onCompositionEnd: (event) => textReport(event.currentTarget, false),
    onKeyDown: keyDownHandle,
    onPaste: pasteHandle,
  });
  // the menu of the slash mode is a portal: nothing is added to the flow
  return slashBinding.menu ? createElement(Fragment, null, surface, slashBinding.menu) : surface;
}

// innerText turns line breaks of the editable element into "\n" (the surface
// is white-space: pre-wrap). an element whose content ends with a line break
// reports one more "\n" than lines exist. a surface in line mode is read
// line by line instead (innerText would count an empty line twice).
function surfaceTextGet(element) {
  if (element.hasAttribute('data-lines')) return surfaceLineListRead(element).join('\n');
  return element.innerText.replace(/\n$/, '');
}

// ---------- line mode ----------
//
// one <div class="doc-edit-surface-line" data-space> per source line; an
// empty line holds a <br> so that it has a height. the browser keeps this
// shape while the author types: Enter (or a pasted line break) splits the
// line element, copying its attributes, and Backspace at its start joins it
// to the line before. only when the shape is lost (a line break inside a
// line element, text right in the surface after everything was deleted)
// are the lines built again, with the caret put back at the same place of
// the text.

function surfaceContentWrite(element, text, lineSpaceListGet) {
  if (!lineSpaceListGet) {
    element.textContent = text;
    return;
  }
  const lineList = text.split('\n');
  const spaceList = lineSpaceListGet(lineList);
  element.replaceChildren(...lineList.map((line, index) => surfaceLineBuild(line, spaceList[index])));
}

function surfaceLineBuild(line, space) {
  const lineElement = document.createElement('div');
  lineElement.className = 'doc-edit-surface-line';
  if (space) lineElement.dataset.space = space;
  if (line === '') lineElement.appendChild(document.createElement('br'));
  else lineElement.textContent = line;
  return lineElement;
}

// the lines of a surface in line mode, or of a part of it (a fragment cloned
// from a range). text that is not inside a line element is read as lines too.
function surfaceLineListRead(container) {
  const lineList = [];
  let textLoose;
  for (const node of container.childNodes) {
    if (node.nodeName === 'DIV') {
      if (textLoose !== undefined) lineList.push(...textLoose.split('\n'));
      textLoose = undefined;
      lineList.push(...node.textContent.split('\n'));
    } else if (node.nodeName === 'BR') {
      lineList.push(textLoose ?? '');
      textLoose = undefined;
    } else {
      textLoose = (textLoose ?? '') + node.textContent;
    }
  }
  if (textLoose !== undefined) lineList.push(...textLoose.split('\n'));
  return lineList.length > 0 ? lineList : [''];
}

function surfaceLineShapeKeep(element, lineSpaceListGet) {
  const lineList = surfaceLineListRead(element);
  const spaceList = lineSpaceListGet(lineList);
  const childList = [...element.childNodes];
  const isShapeKept = childList.length === lineList.length
    && childList.every((node) => node.nodeName === 'DIV' && !node.textContent.includes('\n'));
  if (isShapeKept) {
    childList.forEach((lineElement, index) => {
      const space = spaceList[index] ?? '';
      if ((lineElement.dataset.space ?? '') !== space) {
        if (space) lineElement.dataset.space = space;
        else delete lineElement.dataset.space;
      }
      if (lineElement.className !== 'doc-edit-surface-line') lineElement.className = 'doc-edit-surface-line';
      if (lineElement.textContent === '' && !lineElement.querySelector('br')) {
        lineElement.appendChild(document.createElement('br'));
      }
    });
    return;
  }
  const offset = caretOffsetGet(element);
  element.replaceChildren(...lineList.map((line, index) => surfaceLineBuild(line, spaceList[index])));
  if (offset !== undefined) caretPlaceAtLineOffset(element, offset);
}

// where the caret is, as an offset into the text of the surface
function caretOffsetGet(element) {
  const textBefore = textBeforeCaretGet(element);
  return textBefore === undefined ? undefined : textBefore.length;
}

// the text from the start of the surface to the caret
function textBeforeCaretGet(element) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.endContainer)) return undefined;
  const rangeBefore = document.createRange();
  rangeBefore.selectNodeContents(element);
  rangeBefore.setEnd(range.endContainer, range.endOffset);
  if (!element.hasAttribute('data-lines')) return rangeBefore.toString();
  return surfaceLineListRead(rangeBefore.cloneContents()).join('\n');
}

function caretPlaceAtLineOffset(element, offset) {
  let offsetRest = offset;
  for (const lineElement of element.children) {
    const length = lineElement.textContent.length;
    if (offsetRest <= length) {
      const range = document.createRange();
      const textNode = lineElement.firstChild;
      if (textNode?.nodeType === Node.TEXT_NODE) range.setStart(textNode, offsetRest);
      else range.setStart(lineElement, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    offsetRest -= length + 1;
  }
  caretPlaceAtEdge(element, 'end');
}

// 'plaintext-only' where the browser knows it; 'true' otherwise (the paste
// handler keeps the content plain text either way)
let contentEditableValue;
function contentEditableValueGet() {
  if (contentEditableValue) return contentEditableValue;
  const element = document.createElement('div');
  element.contentEditable = 'plaintext-only';
  contentEditableValue = element.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  return contentEditableValue;
}

// true when the collapsed caret is on the last visual line of the surface
// (direction 'next') or on its first one ('previous'): an arrow key in that
// direction has nowhere to go inside the surface. the caret rectangle
// (rectCaret, from caretRectGet) is compared with the content box; when the
// browser gives none, the text lines decide.
function caretIsAtEdgeLine(element, direction, rectCaret) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  if (!element.contains(selection.anchorNode)) return false;
  const range = selection.getRangeAt(0);
  if (rectCaret && rectCaret.height > 0) {
    const rectElement = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const halfLine = rectCaret.height / 2;
    if (direction === 'previous') {
      return rectCaret.top < rectElement.top + parseFloat(style.paddingTop) + halfLine;
    }
    return rectCaret.bottom > rectElement.bottom - parseFloat(style.paddingBottom) - halfLine;
  }
  const textBefore = textBeforeCaretGet(element) ?? '';
  if (direction === 'previous') return !textBefore.includes('\n');
  const textAfter = surfaceTextGet(element).slice(textBefore.length);
  return !textAfter.includes('\n');
}
