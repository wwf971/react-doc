import { useEffect } from 'react';

// The bound of a panel docked in the right column, or floating over the
// page: its maximum height is the space between its own top edge and the
// bottom of the window, written as --doc-part-index-height-available on the
// panel (and its available width, docked), measured on resize and layout
// changes. Shared by the part index panel and the backlinks panel.
//
// docked: the height is computed from the document scrollport and the
// panel's fixed offset inside the sticky TOC column, never from where the
// panel happens to be in the viewport. at the document bottom the sticky
// column moves up to stay inside its containing block; measuring the
// viewport position there would grant the panel more height, push the
// column further up, and repeat until the index reaches its full content
// height.
//
//   refPanel         the panel element
//   isVisible        measured while shown only
//   isFloating       the panel floats (its top follows dragging)
//   dependencyList   values whose change asks for a new measure (a floating
//                    top, a loading status, a count of items)
export function usePanelHeightAvailable(refPanel, { isVisible, isFloating = false, dependencyList = [] }) {
  useEffect(() => {
    const panel = refPanel.current;
    if (!isVisible || !panel) return undefined;
    const column = isFloating ? null : panel.closest('.doc-page-toc');
    const scrollContainer = column?.closest('.doc-page-mdx');

    let frameId = 0;
    const sizeUpdate = () => {
      frameId = 0;
      const rect = panel.getBoundingClientRect();
      const heightAvailable = column
        ? Math.max(
          96,
          (scrollContainer?.clientHeight ?? window.innerHeight)
            - (parseFloat(window.getComputedStyle(column).top) || 0)
            - (rect.top - column.getBoundingClientRect().top)
            - 16,
        )
        : Math.max(96, window.innerHeight - rect.top - 16);
      panel.style.setProperty('--doc-part-index-height-available', `${heightAvailable}px`);
      if (!isFloating) {
        const widthAvailable = Math.max(0, window.innerWidth - rect.left - 16);
        panel.style.setProperty('--doc-part-index-width-available', `${widthAvailable}px`);
      }
    };
    const sizeUpdateSchedule = () => {
      if (!frameId) frameId = requestAnimationFrame(sizeUpdate);
    };
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(sizeUpdateSchedule);
    sizeUpdate();
    window.addEventListener('resize', sizeUpdateSchedule);
    if (panel.parentElement) observer?.observe(panel.parentElement);
    if (scrollContainer) observer?.observe(scrollContainer);
    return () => {
      window.removeEventListener('resize', sizeUpdateSchedule);
      observer?.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFloating, isVisible, refPanel, ...dependencyList]);
}
