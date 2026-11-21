import { useEffect } from 'react';

// Keeps the wheel over a floating element (a dropdown of results, a menu) to
// that element: it scrolls the element while the element has more to scroll
// in that direction, and is stopped there when it has none (no overflow at
// all, or its end reached), so the document under it never scrolls instead.
// CSS overscroll-behavior: contain does not do this alone: it only applies to
// an element that overflows, and a short list of results does not.
//
// React's onWheel is passive and cannot prevent the default; the listener is
// added to the element itself, not passive, while isActive.
//
//   elementRef   the floating element (its scroll container)
//   isActive     whether it is shown
export function useWheelContain(elementRef, isActive = true) {
  useEffect(() => {
    const element = elementRef.current;
    if (!isActive || !element) return undefined;
    const wheelHandle = (event) => {
      if (event.ctrlKey) return; // a pinch zooms the page
      const scrollMax = element.scrollHeight - element.clientHeight;
      const isUp = event.deltaY < 0;
      const isAtEnd = scrollMax <= 1
        || (isUp && element.scrollTop <= 0)
        || (!isUp && element.scrollTop >= scrollMax - 1);
      if (isAtEnd) event.preventDefault();
    };
    element.addEventListener('wheel', wheelHandle, { passive: false });
    return () => element.removeEventListener('wheel', wheelHandle);
  }, [elementRef, isActive]);
}
