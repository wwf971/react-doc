import { useEffect, useRef } from 'react';
import { selectionHolds } from '../../frontend/src/store/DocEditStructStore.js';
import { EDIT_CLICK_OWN_SELECTOR, EDIT_POPUP_SELECTOR } from '../edit/use-edit-outside-pointer.js';
import {
  STRUCT_OWN_SELECTOR,
  blockRectListMeasure,
  dropTargetFind,
  elementLocate,
  itemPathAtPoint,
  rowListMeasure,
  scrollParentGet,
} from './struct-geometry.js';

// The pointer of structural edit, for one edit body (design:
// doc_page_impl_edit_structure.md#the-gestures). Content is edited with the
// plain pointer; structure is addressed with Shift, or by the grip of a
// toolbar, which needs no key:
//
//   Shift + click        selects the block or the list item under the
//                        pointer; on the selection, makes it one step larger
//   Shift + drag         moves the selection (or, started outside it, what is
//                        under the pointer: an item with what is under it, a block)
//   grip (data-struct-grip on a toolbar button, with data-block-index and
//   data-item-path)      click: selects its block or item, and on the pinned
//                        toolbar makes the selection one step larger; drag: moves it
//   a pointer going down anywhere else ends the selection
//   Escape               cancels a drag
//
// the hover of an item (its toolbar) is tracked here too, from the element
// under the pointer.
//
// the gestures are native listeners of the document in the capture phase:
// they come before the click handling of the block wrappers, so a Shift +
// click never enters a block. a structural press prevents the default of the
// pointer and the mouse event, so it neither selects text nor moves the focus.
//
//   bodyRef   the edit body
//   path      its document
//   stores    { editStore, structStore }
//   model     the block model of the document (read when a gesture needs it)

const DRAG_THRESHOLD = 4;
const SCROLL_EDGE = 56;
const SCROLL_SPEED_MAX = 18;

export function useStructPointer(bodyRef, { path, stores, model }) {
  const modelRef = useRef(model);
  modelRef.current = model;
  const { editStore, structStore } = stores;

  useEffect(() => {
    if (!structStore) return undefined;
    // the press of a structural gesture, while the button is down
    let press;
    // the click that ends a drag is no click
    let isClickSwallowed = false;
    let rowList = [];
    let blockRectList = [];
    let pointerLast;
    // where the pointer was, relative to the body, when the drag began: how
    // far it moved sideways since says the level an item is dropped at
    let pointerStart;
    let frameId = 0;

    const bodyGet = () => bodyRef.current;

    // what a structural gesture at an element is about: { blockIndex,
    // itemPath, isGrip }, or undefined when the event is no such gesture
    const gestureGet = (event) => {
      const body = bodyGet();
      const target = event.target;
      if (!body || !(target instanceof Element)) return undefined;
      const grip = target.closest('[data-struct-grip]');
      if (grip && grip.closest('.doc-edit-body') === body) {
        return { blockIndex: Number(grip.dataset.blockIndex), itemPath: String(grip.dataset.itemPath ?? ''), isGrip: true };
      }
      if (!event.shiftKey) return undefined;
      if (target.closest(STRUCT_OWN_SELECTOR) || target.closest(EDIT_CLICK_OWN_SELECTOR)) return undefined;
      const located = elementLocate(body, target);
      if (!located || located.blockElement.hasAttribute('data-editing')) return undefined;
      // a component that works by its own clicks keeps them
      if (editStore.blockIsEditEnterButtonOnly(path, located.blockIndex)) return undefined;
      let itemPath = located.itemPath;
      if (!itemPath && structStore.listGet(path, located.blockIndex)) itemPath = itemPathAtPoint(located.blockElement, event.clientY);
      return { blockIndex: located.blockIndex, itemPath, isGrip: false };
    };

    // a pointer going down outside what belongs to the selection ends it
    const selectionEndByPointer = (event) => {
      if (!structStore.selectionGet(path)) return;
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest(STRUCT_OWN_SELECTOR) || target.closest(EDIT_POPUP_SELECTOR)) return;
        if (target.closest('.doc-edit-block[data-struct-selected] > .doc-edit-block-anchor')) return;
      }
      structStore.selectionClear();
    };

    const pressListenerRemove = () => {
      document.removeEventListener('pointermove', pressMoveHandle, true);
      document.removeEventListener('pointerup', pressUpHandle, true);
      document.removeEventListener('pointercancel', pressCancelHandle, true);
      document.removeEventListener('keydown', pressKeyHandle, true);
    };

    const pointerDownHandle = (event) => {
      if (event.button !== 0 || !structStore.isActive(path) || structStore.isDragging || press) return;
      const gesture = gestureGet(event);
      if (!gesture) {
        selectionEndByPointer(event);
        return;
      }
      event.preventDefault();
      press = { ...gesture, clientX: event.clientX, clientY: event.clientY, isDragStarting: false, isDragging: false };
      document.addEventListener('pointermove', pressMoveHandle, true);
      document.addEventListener('pointerup', pressUpHandle, true);
      document.addEventListener('pointercancel', pressCancelHandle, true);
      document.addEventListener('keydown', pressKeyHandle, true);
    };

    // the mouse event of a structural press starts no text selection
    const mouseDownHandle = (event) => {
      if (press) event.preventDefault();
    };

    const dragUpdate = (clientX, clientY) => {
      const body = bodyGet();
      const drag = structStore.drag;
      if (!body || !drag) return;
      const rectBody = body.getBoundingClientRect();
      const found = dropTargetFind({
        subject: drag.subject,
        pointer: { x: clientX - rectBody.left, y: clientY - rectBody.top },
        pointerStart,
        rowList,
        blockRectList,
      });
      structStore.dragMove({ clientX, clientY }, found?.target, found?.indicator);
    };

    // near the top or the bottom of what scrolls the body, the page scrolls
    // under the dragged thing
    const scrollTick = () => {
      frameId = 0;
      const body = bodyGet();
      if (!press?.isDragging || !body || !pointerLast) return;
      const scrollParent = scrollParentGet(body);
      const rect = scrollParent ? scrollParent.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const overTop = rect.top + SCROLL_EDGE - pointerLast.clientY;
      const overBottom = pointerLast.clientY - (rect.bottom - SCROLL_EDGE);
      const delta = overTop > 0 ? -Math.min(SCROLL_SPEED_MAX, overTop / 3) : overBottom > 0 ? Math.min(SCROLL_SPEED_MAX, overBottom / 3) : 0;
      if (delta !== 0) {
        (scrollParent ?? window).scrollBy(0, delta);
        dragUpdate(pointerLast.clientX, pointerLast.clientY);
      }
      frameId = requestAnimationFrame(scrollTick);
    };

    // the pointer left the place it went down at: the drag begins. started
    // outside the selection, what is under the pointer is selected first
    const dragBegin = async () => {
      const pressCurrent = press;
      const selection = structStore.selectionGet(path);
      const isOnSelection = Boolean(selection) && selection.blockIndex === pressCurrent.blockIndex
        && (selection.scope === 'block' || selectionHolds(selection, pressCurrent.itemPath));
      if (!isOnSelection) {
        const isSet = await structStore.selectionSet(
          path, pressCurrent.blockIndex, pressCurrent.itemPath, pressCurrent.itemPath ? 'subtree' : 'block',
        );
        if (!isSet || press !== pressCurrent) return;
      }
      const body = bodyGet();
      const blockList = modelRef.current?.blockList ?? [];
      if (!body) return;
      rowList = rowListMeasure(body, blockList);
      blockRectList = blockRectListMeasure(body, blockList);
      const rectBody = body.getBoundingClientRect();
      pointerStart = { x: pressCurrent.clientX - rectBody.left, y: pressCurrent.clientY - rectBody.top };
      if (!structStore.dragStart(path, { clientX: pointerLast.clientX, clientY: pointerLast.clientY })) return;
      pressCurrent.isDragging = true;
      dragUpdate(pointerLast.clientX, pointerLast.clientY);
      if (!frameId) frameId = requestAnimationFrame(scrollTick);
    };

    function pressMoveHandle(event) {
      if (!press) return;
      pointerLast = { clientX: event.clientX, clientY: event.clientY };
      if (press.isDragging) {
        dragUpdate(event.clientX, event.clientY);
        return;
      }
      if (press.isDragStarting) return;
      if (Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) < DRAG_THRESHOLD) return;
      press.isDragStarting = true;
      void dragBegin();
    }

    const pressEnd = () => {
      pressListenerRemove();
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      const pressDone = press;
      press = undefined;
      return pressDone;
    };

    function pressUpHandle() {
      const pressDone = pressEnd();
      if (!pressDone?.isDragStarting) return;
      // a drag, not a click: the click of this gesture selects nothing
      isClickSwallowed = true;
      setTimeout(() => { isClickSwallowed = false; }, 0);
      if (pressDone.isDragging) void structStore.dragDrop();
      else structStore.dragCancel();
    }

    function pressCancelHandle() {
      pressEnd();
      structStore.dragCancel();
    }

    function pressKeyHandle(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const pressDone = pressEnd();
      if (pressDone?.isDragStarting) {
        isClickSwallowed = true;
        setTimeout(() => { isClickSwallowed = false; }, 400);
      }
      structStore.dragCancel();
    }

    const clickHandle = (event) => {
      if (isClickSwallowed) {
        isClickSwallowed = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.button !== 0 || !structStore.isActive(path)) return;
      const gesture = gestureGet(event);
      if (!gesture) return;
      event.preventDefault();
      event.stopPropagation();
      if (!gesture.isGrip) {
        void structStore.selectClick(path, gesture.blockIndex, gesture.itemPath);
        return;
      }
      // the grip of the selected thing makes the selection one step larger;
      // the grip of anything else selects it
      const selection = structStore.selectionGet(path);
      const isPinned = Boolean(selection) && selection.blockIndex === gesture.blockIndex
        && (selection.scope === 'block' ? gesture.itemPath === '' : selection.itemPath === gesture.itemPath);
      if (isPinned) structStore.selectionGrowStep();
      else void structStore.selectionSet(path, gesture.blockIndex, gesture.itemPath);
    };

    // a key typed in the moment an edit asked from the editor of an item is
    // written (the editor is closed, the next one not open yet): kept for
    // the editor that opens (DocEditStructStore, typing on through an edit),
    // and held from the page, whose keys it would be without an editor. a
    // key of an input method cannot be kept: its text is not known at the key
    const typeAheadKeyHandle = (event) => {
      if (!structStore.isTypeAheadOpen || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1 && event.key !== 'Backspace' && event.key !== 'Enter' && event.key !== 'Tab') return;
      // the editor is open already: the key is its own
      if (event.target instanceof Element && event.target.closest('.doc-edit-surface')) return;
      event.preventDefault();
      event.stopPropagation();
      structStore.typeAheadKey(event.key, event.shiftKey);
    };

    // the pointer at rest while the author types (typingKeyHandle below):
    // where it was left, until it moves from there
    let pointerRest;
    let pointerHover;

    // the item under the pointer; on its toolbar, the item stays
    const pointerOverHandle = (event) => {
      pointerHover = { clientX: event.clientX, clientY: event.clientY };
      // a list drawn again under a pointer at rest is no pointer coming to an item
      if (pointerRest) return;
      const body = bodyGet();
      if (!body || press || !structStore.isActive(path)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(STRUCT_OWN_SELECTOR)?.closest('.doc-edit-body') === body) return;
      const located = elementLocate(body, target);
      if (located?.itemPath && structStore.listGet(path, located.blockIndex)) {
        structStore.itemHoverSet({ path, blockIndex: located.blockIndex, itemPath: located.itemPath });
      } else if (structStore.itemHover?.path === path) {
        structStore.itemHoverSet(undefined);
      }
    };

    document.addEventListener('pointerdown', pointerDownHandle, true);
    document.addEventListener('mousedown', mouseDownHandle, true);
    document.addEventListener('click', clickHandle, true);
    // while the author types, the pointer rests where it was left, and the
    // toolbar of the item under it would stand beside the text being typed:
    // it goes with the first key typed in an editor of the body, and comes
    // back when the pointer moves again (the list is written and drawn again
    // under the pointer meanwhile, which a browser reports as the pointer
    // coming over the new elements: only a pointer that moved wakes it)
    const POINTER_WAKE_DISTANCE = 3;
    const pointerWakeHandle = (event) => {
      if (!pointerRest) return;
      if (Math.hypot(event.clientX - pointerRest.clientX, event.clientY - pointerRest.clientY) < POINTER_WAKE_DISTANCE) return;
      pointerRestEnd();
      pointerOverHandle(event);
    };
    const pointerRestEnd = () => {
      pointerRest = undefined;
      document.removeEventListener('pointermove', pointerWakeHandle, true);
    };
    const typingKeyHandle = (event) => {
      if (pointerRest || structStore.itemHover?.path !== path) return;
      const body = bodyGet();
      const surface = event.target instanceof Element ? event.target.closest('.doc-edit-surface') : null;
      if (!body || !surface || !body.contains(surface)) return;
      pointerRest = pointerHover ?? { clientX: -1000, clientY: -1000 };
      structStore.itemHoverSet(undefined);
      document.addEventListener('pointermove', pointerWakeHandle, true);
    };

    document.addEventListener('pointerover', pointerOverHandle, true);
    document.addEventListener('keydown', typeAheadKeyHandle, true);
    document.addEventListener('keydown', typingKeyHandle, true);
    return () => {
      document.removeEventListener('keydown', typeAheadKeyHandle, true);
      document.removeEventListener('keydown', typingKeyHandle, true);
      pointerRestEnd();
      document.removeEventListener('pointerdown', pointerDownHandle, true);
      document.removeEventListener('mousedown', mouseDownHandle, true);
      document.removeEventListener('click', clickHandle, true);
      document.removeEventListener('pointerover', pointerOverHandle, true);
      pressEnd();
      if (structStore.drag?.path === path) structStore.dragCancel();
      if (structStore.itemHover?.path === path) structStore.itemHoverSet(undefined);
    };
  }, [bodyRef, path, editStore, structStore]);
}
