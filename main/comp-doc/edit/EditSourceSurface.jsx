import { createElement, useEffect, useLayoutEffect, useRef } from 'react';
import { caretPlaceAtEdge, caretPlaceInitial, caretRectGet } from './caret-place.js';
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
  isLocked = false,
  className = '',
  onTextChange,
  onSubmitRequest,
  onCancelRequest,
  onFocusShiftRequest,
  ariaLabel = 'Block source',
}) {
  const elementRef = useRef(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.textContent = text;
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

  return createElement(tag, {
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
    'data-locked': isLocked ? '' : undefined,
    onInput: (event) => onTextChange?.(surfaceTextGet(event.currentTarget)),
    onKeyDown: keyDownHandle,
    onPaste: pasteHandle,
  });
}

// innerText turns line breaks of the editable element into "\n" (the surface
// is white-space: pre-wrap). an element whose content ends with a line break
// reports one more "\n" than lines exist.
function surfaceTextGet(element) {
  return element.innerText.replace(/\n$/, '');
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
  const rangeBefore = document.createRange();
  rangeBefore.selectNodeContents(element);
  rangeBefore.setEnd(range.startContainer, range.startOffset);
  const textBefore = rangeBefore.toString();
  if (direction === 'previous') return !textBefore.includes('\n');
  const textAfter = surfaceTextGet(element).slice(textBefore.length);
  return !textAfter.includes('\n');
}
