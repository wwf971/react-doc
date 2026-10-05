import { createElement, useEffect, useLayoutEffect, useRef } from 'react';
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
//   isSelectAll         the whole text is selected when the surface opens
//                       (a block created from a template: typing replaces it)
//   isLocked            no editing while a change request is pending
//   onTextChange(text)  typed text
//   onSubmitRequest()   Ctrl/Cmd + Enter
//   onCancelRequest()   Escape
export function EditSourceSurface({
  tag = 'div',
  kind,
  text,
  textVersion = 0,
  isSelectAll = false,
  isLocked = false,
  className = '',
  onTextChange,
  onSubmitRequest,
  onCancelRequest,
  ariaLabel = 'Block source',
}) {
  const elementRef = useRef(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.textContent = text;
    // text set by code happens when the author is already working here
    if (textVersion > 0 && document.activeElement !== element) element.focus();
    caretMoveToEnd(element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textVersion, tag]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || isLocked) return;
    element.focus({ preventScroll: true });
    if (isSelectAll) selectionSetAll(element);
    else caretMoveToEnd(element);
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

function caretMoveToEnd(element) {
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectionSetAll(element) {
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
