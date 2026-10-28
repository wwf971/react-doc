import { createElement, useEffect, useId } from 'react';
import { slashLineRead, slashTriggerIs } from '../../frontend/src/lib/doc-slash.js';
import { caretRectGet } from '../edit/caret-place.js';
import { EditSlashMenu } from './EditSlashMenu.jsx';

// The binding of an editing surface to the slash mode
// (doc_page_impl_edit_slash.md#the-surface-binding). The surface owns the
// DOM and the caret; the store (DocSlashStore) owns the state. This hook
// is the one place between them:
//
//   surface -> store   what the author does: the line of the caret after
//                      every input, a caret moved (selectionchange), the
//                      keys of the menu, the surface left (blur)
//   store -> surface   what a choice answers: the slash text replaced by
//                      the text of the effect, through the browser's own
//                      editing (execCommand), so the surface reports the
//                      new text as typed and undo takes it back
//
//   slash                config.edit.slash of the editor, or undefined (the
//                        block does not offer the slash mode):
//                        { store: DocSlashStore, context } (slash-define.js)
//   textBeforeCaretGet   (element) => the text from the start of the
//                        surface to the caret, as the surface reads it
//
// answers { inputAfter(event), keyDown(event) -> isConsumed, menu }: the
// surface calls inputAfter after it reported an input, offers every key
// to keyDown before its own keys, and renders menu (a portal, nothing in
// the flow).
export function useEditSlash(elementRef, slash, { textBeforeCaretGet }) {
  const surfaceId = useId();
  const slashStore = slash?.store;

  const lineStateRead = () => {
    const element = elementRef.current;
    const textBefore = element ? textBeforeCaretGet(element) : undefined;
    return textBefore === undefined ? undefined : slashLineRead(textBefore);
  };
  const rectRead = () => {
    const rect = elementRef.current ? caretRectGet(elementRef.current) : undefined;
    return rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : undefined;
  };
  const isOpen = () => Boolean(slashStore?.slashIsOpenFor(surfaceId));

  const caretCheck = () => {
    if (!isOpen()) return;
    const element = elementRef.current;
    const lineState = element && document.activeElement === element ? lineStateRead() : undefined;
    if (!lineState) slashStore.slashEnd();
    else slashStore.slashUpdate(surfaceId, lineState, rectRead());
  };

  // the caret moved by a click or a key the menu does not take, the page
  // scrolled under the menu, the surface was left
  useEffect(() => {
    const element = elementRef.current;
    if (!slashStore || !element) return undefined;
    const blurHandle = () => {
      if (isOpen()) slashStore.slashEnd();
    };
    document.addEventListener('selectionchange', caretCheck);
    window.addEventListener('scroll', caretCheck, { capture: true, passive: true });
    element.addEventListener('blur', blurHandle);
    return () => {
      document.removeEventListener('selectionchange', caretCheck);
      window.removeEventListener('scroll', caretCheck, { capture: true });
      element.removeEventListener('blur', blurHandle);
      if (isOpen()) slashStore.slashEnd();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashStore, surfaceId]);

  const apply = (result) => {
    if (!result || result.textNew === undefined || !elementRef.current) return;
    slashTextReplace(elementRef.current, result.lengthOld, result.textNew);
  };

  const inputAfter = (event) => {
    if (!slashStore?.isOn || event.nativeEvent?.isComposing) return;
    const lineState = lineStateRead();
    if (isOpen()) {
      if (lineState) slashStore.slashUpdate(surfaceId, lineState, rectRead());
      else slashStore.slashEnd();
      return;
    }
    const inputEvent = event.nativeEvent;
    if (!lineState || inputEvent?.inputType !== 'insertText' || inputEvent.data !== '/') return;
    if (!slashTriggerIs(lineState.lineBefore)) return;
    slashStore.slashStart(surfaceId, {
      anchor: { lineIndex: lineState.lineIndex, column: lineState.lineBefore.length - 1 },
      context: slash.context,
      rect: rectRead(),
    });
  };

  const keyDown = (event) => {
    if (!isOpen() || event.nativeEvent?.isComposing) return false;
    const resultOffered = slashStore.keyOffer(event);
    if (resultOffered) {
      event.preventDefault();
      apply(resultOffered);
      return true;
    }
    const isModified = event.shiftKey || event.altKey || event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      // the slash mode only: the session of the block stays open
      event.preventDefault();
      event.stopPropagation();
      slashStore.slashEnd();
      return true;
    }
    if (isModified || slashStore.itemList.length === 0) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      slashStore.itemActiveMove(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      apply(slashStore.itemChoose());
      return true;
    }
    return false;
  };

  const menu = slashStore
    ? createElement(EditSlashMenu, {
        slashStore,
        surfaceId,
        onChoose: (index) => apply(slashStore.itemChoose(index)),
      })
    : null;

  return { inputAfter, keyDown, menu };
}

// the slash text, the lengthOld characters before the caret, replaced by
// text as if typed: the surface reports it through its input event, and
// the browser's undo takes it back. the slash text is on one line, so it
// is usually in the text node of the caret; otherwise the selection is
// extended character by character
function slashTextReplace(element, lengthOld, text) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return;
  const rangeCaret = selection.getRangeAt(0);
  if (!element.contains(rangeCaret.endContainer)) return;
  const node = rangeCaret.endContainer;
  const offset = rangeCaret.endOffset;
  if (node.nodeType === Node.TEXT_NODE && offset >= lengthOld) {
    const range = document.createRange();
    range.setStart(node, offset - lengthOld);
    range.setEnd(node, offset);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    selection.collapse(node, offset);
    for (let index = 0; index < lengthOld; index += 1) selection.modify('extend', 'backward', 'character');
  }
  if (text === '') document.execCommand('delete');
  else document.execCommand('insertText', false, text);
}
