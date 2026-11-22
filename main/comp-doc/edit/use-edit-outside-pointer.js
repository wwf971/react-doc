import { useEffect, useRef } from 'react';

export const EDIT_POPUP_CLASS = 'doc-edit-popup';
export const EDIT_POPUP_SELECTOR = `.${EDIT_POPUP_CLASS}`;

// what a click on a block does not enter the block through
// (EditBlockEnterMode 'click'): the block's own controls (buttons, editable
// values, form fields), the floating area of the block with everything in
// it (the toolbar, the insert menu and its search results, a confirmation),
// and a popup of the edit layer portaled to the body (the mode menu)
export const EDIT_CLICK_OWN_SELECTOR = [
  'button',
  '[role="button"]',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '.doc-edit-block-anchor',
  EDIT_POPUP_SELECTOR,
].join(', ');

// what keeps the browser's own menu on a right click inside a block that is
// not being edited (spelling, paste): a field, an editor, the floating area of
// the block, a popup of the edit layer. not a button: a tile, a card that
// opens its document, are the thing the right click is about, and open its
// menu (doc_page_impl_edit_structure.md#deleting-a-thing)
export const EDIT_CONTEXT_OWN_SELECTOR = [
  'input',
  'select',
  'textarea',
  '[contenteditable]:not([contenteditable="false"])',
  '.doc-edit-block-anchor',
  EDIT_POPUP_SELECTOR,
].join(', ');

// the nearest element of the target matching the selector, when it lies
// inside the container; null otherwise. a control or a popup of the edit
// layer around a whole body (a document edited in a popup: the popup holds
// its body) is not a control of what is inside that body, so what decides
// on its own clicks asks only within itself.
export function targetClosestWithin(target, selector, container) {
  const match = target?.closest?.(selector);
  return match && container?.contains(match) ? match : null;
}

// Calls onOutside when a pointer goes down outside the element while
// isActive. A pointer going down somewhere else is how an author leaves an
// editor (the draft is saved) or closes a menu, so this is the "click
// outside" of the edit layer. Focus inside the element is blurred first, so
// an inline value still being typed commits before the leave.
//
// a popup of the edit layer that is portaled to the body (the mode menu of
// a block, marked with the class doc-edit-popup) belongs to the element
// that opened it: a pointer going down in it is not outside. a popup the
// element itself lies in (a field in the header of a dialog, a block of a
// document edited in a popup) is not one it opened: a pointer going down
// elsewhere in that popup is outside.
export function useEditOutsidePointer(elementRef, isActive, onOutside) {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!isActive) return undefined;
    const pointerDownHandle = (event) => {
      // only the primary button: a context menu opened elsewhere is not a leave
      if (event.button !== 0) return;
      const element = elementRef.current;
      if (!element || element.contains(event.target)) return;
      const popup = event.target instanceof Element ? event.target.closest(EDIT_POPUP_SELECTOR) : null;
      if (popup && !popup.contains(element)) return;
      editFocusRelease(element);
      onOutsideRef.current();
    };
    document.addEventListener('pointerdown', pointerDownHandle, true);
    return () => document.removeEventListener('pointerdown', pointerDownHandle, true);
  }, [elementRef, isActive]);
}

// the click that completes a pointer down which closed or left something
// must not also enter a block. called from the pointer down; the guard
// covers the one click of that gesture. a gesture that produces no click
// (cancelled, or released without one) drops the guard, so a later click is
// not swallowed.
//
//   isControlClickKept   false: the whole click is swallowed (the pointer
//                        went down on bare space of the block being edited).
//                        true: only a click that would enter a block is
//                        swallowed; a click on a control (EDIT_CLICK_OWN_SELECTOR)
//                        still does what the control does
export function clickAfterPointerDownSuppress({ isControlClickKept = false } = {}) {
  let isRemoved = false;
  const remove = () => {
    if (isRemoved) return;
    isRemoved = true;
    document.removeEventListener('click', clickGuard, true);
    document.removeEventListener('pointercancel', remove, true);
    document.removeEventListener('pointerup', pointerUpHandle, true);
  };
  const clickGuard = (clickEvent) => {
    remove();
    const target = clickEvent.target;
    if (isControlClickKept && target instanceof Element && target.closest(EDIT_CLICK_OWN_SELECTOR)) return;
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
  };
  // click is dispatched after pointerup, in the same turn. if none comes,
  // the timer drops the guard before the next thing the author clicks.
  const pointerUpHandle = () => {
    document.removeEventListener('pointerup', pointerUpHandle, true);
    setTimeout(remove, 0);
  };
  document.addEventListener('click', clickGuard, true);
  document.addEventListener('pointercancel', remove, true);
  document.addEventListener('pointerup', pointerUpHandle, true);
}

// blurs the focused element inside `element`, so that an inline value or a
// field commits its text before the session is left
export function editFocusRelease(element) {
  const elementActive = document.activeElement;
  if (element && elementActive && element.contains(elementActive) && typeof elementActive.blur === 'function') {
    elementActive.blur();
  }
}
