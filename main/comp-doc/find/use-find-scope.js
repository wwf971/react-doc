import { useEffect, useId, useRef } from 'react';
import { useDocStores } from '../../frontend/src/store/context.js';

// A part of the page that finds in what it draws (a diagram canvas) registers itself as a find
// scope (doc_page_impl_api.md#finding-in-a-part-of-the-page) for as long as it is mounted, and
// is the active one while the pointer is over its element or the focus is in it: the key of
// find/open (mod+f in the default map) then opens its search instead of the browser's.
//
//   useFindScope(hostRef, { label, open, close, isOpenGet })
//
// the functions are read when they are called, so they may change between renders.
export function useFindScope(hostRef, scope) {
  const { findStore } = useDocStores();
  const id = `find:${useId()}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    const element = hostRef.current;
    if (!findStore || !element) return undefined;
    const unregister = findStore.scopeRegister({
      id,
      get label() { return scopeRef.current.label; },
      open: () => scopeRef.current.open(),
      close: () => scopeRef.current.close(),
      isOpenGet: () => scopeRef.current.isOpenGet(),
    });
    let isPointerIn = false;
    const update = () => findStore.scopeActiveSet(id, isPointerIn || element.contains(document.activeElement));
    const pointerEnter = () => { isPointerIn = true; update(); };
    const pointerLeave = () => { isPointerIn = false; update(); };
    // the focus leaving: where it goes is known after the event
    const focusOut = () => setTimeout(update, 0);
    element.addEventListener('pointerenter', pointerEnter);
    element.addEventListener('pointerleave', pointerLeave);
    element.addEventListener('focusin', update);
    element.addEventListener('focusout', focusOut);
    return () => {
      element.removeEventListener('pointerenter', pointerEnter);
      element.removeEventListener('pointerleave', pointerLeave);
      element.removeEventListener('focusin', update);
      element.removeEventListener('focusout', focusOut);
      unregister();
    };
  }, [findStore, id, hostRef]);
}
