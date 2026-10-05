import { useEffect, useRef } from 'react';

// Calls onOutside when a pointer goes down outside the element while
// isActive. A pointer going down somewhere else is how an author leaves an
// editor (the draft is saved) or closes a menu, so this is the "click
// outside" of the edit layer. Focus inside the element is blurred first, so
// an inline value still being typed commits before the leave.
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
      editFocusRelease(element);
      onOutsideRef.current();
    };
    document.addEventListener('pointerdown', pointerDownHandle, true);
    return () => document.removeEventListener('pointerdown', pointerDownHandle, true);
  }, [elementRef, isActive]);
}

// blurs the focused element inside `element`, so that an inline value or a
// field commits its text before the session is left
export function editFocusRelease(element) {
  const elementActive = document.activeElement;
  if (element && elementActive && element.contains(elementActive) && typeof elementActive.blur === 'function') {
    elementActive.blur();
  }
}
