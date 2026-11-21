import { useLayoutEffect, useRef } from 'react';
import {
  destinationElementFind,
  focusBlockGet,
  focusElementFind,
  navigationFocusSet,
  navigationHighlightSet,
  navigationHighlightTargetGet,
  pageScrollDestinationAlign,
  pageScrollDestinationIsAligned,
  pageScrollTopReset,
} from './doc-destination-navigation.js';
import { readingPlaceScrollTopGet } from './doc-reading-place.js';

const destinationFindAttemptMax = 12;
// a focused reference may be inside a component that reveals it on request
// (a tab, a folded answer): its mount is waited for longer than a heading's
const focusFindAttemptMax = 60;
// how long a destination is kept in place while the body above it settles
const destinationHoldDuration = 5000;

// Applies the destination of a navigation to the rendered document
// (doc_page_impl_nav.md#fragment-scrolling-and-highlighting): the top of a
// new document, the fragment's place, and the focus a navigation asked for
// beyond the fragment (doc_page_impl_nav_backlink.md#going-to-a-backlink):
//
//   place          a reading place to bring back (doc_page_impl_nav.md#reading-places):
//                  the place a history entry was left at, or the latest place
//                  of a document opened again by a link. it wins over the
//                  fragment (which keeps its mark) and is resolved again from
//                  the blocks whenever the body changes size while it settles
//   focus          { kind: 'link', target, sourceLine?, blockLine, heading? }
//   eventRouter    the event layer: the components at the focused block are
//                  told first (placeReveal), so one that holds the reference
//                  out of sight can show it before it is looked for
//   pathContent    the document the body renders (the subject of that event)
export function useDocDestinationNavigation({
  compiledStatus,
  eventRouter,
  focus,
  hash,
  navigationRequestVersion,
  pageElementRef,
  pathContent,
  place,
}) {
  const pathContentPreviousRef = useRef('');
  // the request version whose destination was applied to the current document.
  // a recompile of the same document (source reload) does not change it, so
  // the reader keeps the current position instead of jumping to the top.
  const requestVersionAppliedRef = useRef(-1);

  useLayoutEffect(() => {
    if (!pathContent) return undefined;

    const pageElement = pageElementRef.current;
    const isDocumentChanged = pathContentPreviousRef.current !== pathContent;

    if (!pageElement) return undefined;
    if (isDocumentChanged) pageScrollTopReset(pageElement);
    if (compiledStatus !== 'done') return undefined;
    if (!isDocumentChanged && requestVersionAppliedRef.current === navigationRequestVersion) return undefined;
    pathContentPreviousRef.current = pathContent;
    requestVersionAppliedRef.current = navigationRequestVersion;

    let elementTarget;
    let frameId;
    let attemptCount = 0;
    let imagePendingList = [];
    let isCanceled = false;
    let destinationHoldStop = () => {};
    // the offset the last alignment left the page at: a scroll to another one
    // is the reader's, which ends the hold (alignTracked)
    let scrollTopAligned = null;
    const alignTracked = (align) => () => {
      align();
      scrollTopAligned = pageElement.scrollTop;
    };
    const destinationAlign = alignTracked(() => pageScrollDestinationAlign(pageElement, elementTarget));
    // the images above the destination that are still loading move it when
    // they get their size: the destination is aligned again after each
    const imagePendingWatch = (contentElement) => {
      imagePendingList = [...contentElement.querySelectorAll('img')].filter((image) => (
        !image.complete
        && Boolean(image.compareDocumentPosition(elementTarget) & Node.DOCUMENT_POSITION_FOLLOWING)
      ));
      for (const image of imagePendingList) {
        image.addEventListener('load', destinationAlign, { once: true });
        image.addEventListener('error', destinationAlign, { once: true });
      }
    };
    // blocks drawn later (a component reading its data, one waiting for its turn) grow above
    // the destination and move it: it is aligned again whenever the body changes size, until
    // the reader takes over the scrolling (an input, or a scroll the alignment did not make:
    // the scrollbar dragged, a script) or the body has had time to settle
    const destinationHold = (contentElement, align) => {
      destinationHoldStop();
      const observer = new ResizeObserver(() => align());
      const eventTypeList = ['wheel', 'touchmove', 'pointerdown', 'keydown'];
      const scrollHandle = () => {
        if (scrollTopAligned !== null && Math.abs(pageElement.scrollTop - scrollTopAligned) > 2) stop();
      };
      const stop = () => {
        observer.disconnect();
        clearTimeout(timer);
        for (const eventType of eventTypeList) pageElement.removeEventListener(eventType, stop);
        pageElement.removeEventListener('scroll', scrollHandle);
      };
      const timer = setTimeout(stop, destinationHoldDuration);
      for (const eventType of eventTypeList) pageElement.addEventListener(eventType, stop, { passive: true });
      pageElement.addEventListener('scroll', scrollHandle, { passive: true });
      observer.observe(contentElement);
      destinationHoldStop = stop;
    };
    // the place the reader left the document at: resolved from its section and
    // block (lib/doc-reading-place.js), again whenever the body grows or
    // shrinks while it settles, until the reader scrolls
    const placeApply = () => {
      const contentElement = pageElement.querySelector('[data-doc-content]');
      const elementAnchor = hash ? destinationElementFind(contentElement, hash) : null;
      navigationHighlightSet(pageElement, elementAnchor ? navigationHighlightTargetGet(elementAnchor) : null);
      const placeAlign = alignTracked(() => {
        const scrollTop = readingPlaceScrollTopGet(pageElement, place);
        if (scrollTop !== undefined && Math.abs(pageElement.scrollTop - scrollTop) > 0.5) pageElement.scrollTop = scrollTop;
      });
      placeAlign();
      frameId = requestAnimationFrame(placeAlign);
      if (contentElement) destinationHold(contentElement, placeAlign);
    };
    const destinationFindAndApply = () => {
      if (place && !focus) {
        placeApply();
        return;
      }
      if (!hash) {
        navigationHighlightSet(pageElement, null);
        if (!focus) pageScrollTopReset(pageElement);
        return;
      }

      const contentElement = pageElement.querySelector('[data-doc-content]');
      const elementAnchor = destinationElementFind(contentElement, hash);
      if (!elementAnchor) {
        if (attemptCount === 0) navigationHighlightSet(pageElement, null);
        attemptCount += 1;
        if (attemptCount < destinationFindAttemptMax) {
          frameId = requestAnimationFrame(destinationFindAndApply);
        }
        return;
      }

      elementTarget = navigationHighlightTargetGet(elementAnchor);
      const isDestinationUnchanged = elementTarget.classList.contains('doc-navigation-target')
        && pageScrollDestinationIsAligned(pageElement, elementTarget);
      navigationHighlightSet(pageElement, elementTarget);
      if (!isDestinationUnchanged) {
        destinationAlign();
        frameId = requestAnimationFrame(destinationAlign);
      }
      imagePendingWatch(contentElement);
      destinationHold(contentElement, destinationAlign);
    };

    // the focus: the components at its block are told first and may reveal
    // it; then the reference is looked for while the body mounts, aligned
    // by its block and marked. a reference no longer in the body (the
    // document changed since the index was read) falls back to the nearest
    // heading the index knew, as a fragment would.
    let attemptCountFocus = 0;
    const focusFindAndApply = () => {
      if (isCanceled) return;
      const contentElement = pageElement.querySelector('[data-doc-content]');
      const elementFocus = focusElementFind(contentElement, focus);
      // a reference inside a folded part is in the body but not laid out:
      // waited for, since the component was asked to reveal it
      if (!elementFocus || !elementIsLaidOut(elementFocus)) {
        attemptCountFocus += 1;
        if (attemptCountFocus < focusFindAttemptMax) {
          frameId = requestAnimationFrame(focusFindAndApply);
          return;
        }
        const elementHeading = focus.heading ? destinationElementFind(contentElement, focus.heading) : null;
        if (!elementHeading) return;
        elementTarget = navigationHighlightTargetGet(elementHeading);
        navigationHighlightSet(pageElement, elementTarget);
        destinationAlign();
        frameId = requestAnimationFrame(destinationAlign);
        imagePendingWatch(contentElement);
        destinationHold(contentElement, destinationAlign);
        return;
      }
      elementTarget = focusBlockGet(elementFocus);
      navigationFocusSet(pageElement, elementFocus);
      const focusAlign = alignTracked(() => pageScrollDestinationAlign(pageElement, elementTarget, 24));
      focusAlign();
      frameId = requestAnimationFrame(focusAlign);
      imagePendingWatch(contentElement);
      destinationHold(contentElement, focusAlign);
    };
    // published a frame later: this is a layout effect, and the components
    // of a newly rendered body subscribe in their own effects, after it
    const focusApply = () => {
      frameId = requestAnimationFrame(() => {
        if (isCanceled) return;
        const published = eventRouter?.publish({
          type: 'placeReveal',
          subject: { sourcePath: pathContent, blockLine: focus.blockLine },
          data: { kind: focus.kind, target: focus.target, sourceLine: focus.sourceLine, blockLine: focus.blockLine },
        });
        Promise.resolve(published).then(focusFindAndApply, focusFindAndApply);
      });
    };

    navigationFocusSet(pageElement, null);
    destinationFindAndApply();
    if (focus) focusApply();
    return () => {
      isCanceled = true;
      cancelAnimationFrame(frameId);
      destinationHoldStop();
      for (const image of imagePendingList) {
        image.removeEventListener('load', destinationAlign);
        image.removeEventListener('error', destinationAlign);
      }
    };
  }, [compiledStatus, eventRouter, focus, hash, navigationRequestVersion, pageElementRef, pathContent, place]);
}

function elementIsLaidOut(element) {
  return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
}
