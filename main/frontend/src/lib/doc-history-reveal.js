import { textChangeRangeListGet } from './doc-text-merge';
import { pageStickyInsetGet } from './doc-reading-place.js';

// Where an undo or a redo took place, shown (doc_page_impl_edit_history.md#where-it-took-place):
// the blocks it changed are brought into view in the body that shows the
// document, when they are not in view already, and marked for a moment. The
// caret and the selection are not part of the history, so nothing is focused
// and nothing is selected: the page only shows the place.
//
//   historyChangeBlockListGet(model, textBefore, textAfter)
//     -> [{ blockIndex, mark }]   the blocks of the text after that changed;
//        mark 'change', or 'border-top' / 'border-bottom' for the block beside
//        lines only taken away
//   historyChangeReveal({ body, pageElement, blockList })
//     the first block scrolled into view when it is not, every block marked

const BLOCK_MARK_COUNT_MAX = 12;
const MARK_DURATION_MS = 1600;
const markTimerByElement = new WeakMap();

export function historyChangeBlockListGet(model, textBefore, textAfter) {
  const blockList = model?.blockList ?? [];
  if (blockList.length === 0 || textBefore === undefined || textAfter === undefined || textBefore === textAfter) return [];
  const markByIndex = new Map();
  for (const range of textChangeRangeListGet(textBefore, textAfter)) {
    if (range.lineEnd >= range.lineStart) {
      for (const block of blockList) {
        if (block.lineStart <= range.lineEnd && block.lineEnd >= range.lineStart) markByIndex.set(block.index, 'change');
      }
      continue;
    }
    // lines taken away: the block after the place they were, else the last one
    const blockAfter = blockList.find((block) => block.lineStart >= range.lineStart);
    if (blockAfter) {
      if (!markByIndex.has(blockAfter.index)) markByIndex.set(blockAfter.index, 'border-top');
    } else {
      const blockLast = blockList[blockList.length - 1];
      if (!markByIndex.has(blockLast.index)) markByIndex.set(blockLast.index, 'border-bottom');
    }
  }
  return [...markByIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, BLOCK_MARK_COUNT_MAX)
    .map(([blockIndex, mark]) => ({ blockIndex, mark }));
}

// the wrapper of a block of this body, not of a body inside one of its blocks
function blockElementGet(body, blockIndex) {
  for (const element of body.querySelectorAll(`.doc-edit-block[data-block-index="${blockIndex}"]`)) {
    if (element.closest('.doc-edit-body') === body) return element;
  }
  return undefined;
}

// the nearest element that scrolls the element, or the scrolling element of the document
function scrollContainerGet(element) {
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return document.scrollingElement ?? document.documentElement;
}

// the element brought into view when it is not: its top a third down the
// visible part of what scrolls it, below the sticky head of the page
function elementRevealIfHidden(element, pageElement) {
  const container = scrollContainerGet(element);
  const isDocument = container === document.scrollingElement || container === document.documentElement;
  const viewRect = isDocument ? { top: 0, bottom: window.innerHeight } : container.getBoundingClientRect();
  const insetTop = container === pageElement ? pageStickyInsetGet(pageElement) : 0;
  const top = viewRect.top + insetTop;
  const rect = element.getBoundingClientRect();
  const height = viewRect.bottom - top;
  // in view when its top is, and either its bottom or a good part of it
  const isTopInView = rect.top >= top && rect.top <= viewRect.bottom - Math.min(48, height / 4);
  if (isTopInView) return;
  const delta = rect.top - (top + Math.max(8, height / 3));
  const isMotionReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior: isMotionReduced ? 'auto' : 'smooth' });
}

export function historyChangeReveal({ body, pageElement, blockList }) {
  if (!body || blockList.length === 0) return;
  const elementList = blockList
    .map((one) => ({ ...one, element: blockElementGet(body, one.blockIndex) }))
    .filter((one) => one.element);
  if (elementList.length === 0) return;
  elementRevealIfHidden(elementList[0].element, pageElement);
  for (const { element, mark } of elementList) {
    // the mark is an attribute React does not draw, so a block drawn again keeps it;
    // set again, the animation starts again
    element.removeAttribute('data-history-mark');
    void element.offsetWidth;
    element.setAttribute('data-history-mark', mark);
    clearTimeout(markTimerByElement.get(element));
    markTimerByElement.set(element, setTimeout(() => {
      element.removeAttribute('data-history-mark');
      markTimerByElement.delete(element);
    }, MARK_DURATION_MS));
  }
}
