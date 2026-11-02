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

const destinationFindAttemptMax = 12;
// a focused reference may be inside a component that reveals it on request
// (a tab, a folded answer): its mount is waited for longer than a heading's
const focusFindAttemptMax = 60;

// Applies the destination of a navigation to the rendered document
// (doc_page_impl_nav.md#fragment-scrolling-and-highlighting): the top of a
// new document, the fragment's place, and the focus a navigation asked for
// beyond the fragment (doc_page_impl_nav_backlink.md#going-to-a-backlink):
//
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
    const destinationAlign = () => pageScrollDestinationAlign(pageElement, elementTarget);
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
    const destinationFindAndApply = () => {
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
        return;
      }
      elementTarget = focusBlockGet(elementFocus);
      navigationFocusSet(pageElement, elementFocus);
      const focusAlign = () => pageScrollDestinationAlign(pageElement, elementTarget, 24);
      focusAlign();
      frameId = requestAnimationFrame(focusAlign);
      imagePendingWatch(contentElement);
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
      for (const image of imagePendingList) {
        image.removeEventListener('load', destinationAlign);
        image.removeEventListener('error', destinationAlign);
      }
    };
  }, [compiledStatus, eventRouter, focus, hash, navigationRequestVersion, pageElementRef, pathContent]);
}

function elementIsLaidOut(element) {
  return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
}
