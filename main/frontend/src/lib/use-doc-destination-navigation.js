import { useLayoutEffect, useRef } from 'react';
import {
  navigationHighlightSet,
  navigationHighlightTargetGet,
  pageScrollDestinationAlign,
  pageScrollDestinationIsAligned,
  pageScrollTopReset,
} from './doc-destination-navigation.js';

const destinationFindAttemptMax = 12;

export function useDocDestinationNavigation({
  compiledStatus,
  hash,
  navigationRequestVersion,
  pageElementRef,
  pathContent,
}) {
  const pathContentPreviousRef = useRef('');

  useLayoutEffect(() => {
    if (!pathContent) return undefined;

    const pageElement = pageElementRef.current;
    const isDocumentChanged = pathContentPreviousRef.current !== pathContent;

    if (!pageElement) return undefined;
    if (isDocumentChanged) pageScrollTopReset(pageElement);
    if (compiledStatus !== 'done') return undefined;
    pathContentPreviousRef.current = pathContent;

    let elementTarget;
    let frameId;
    let attemptCount = 0;
    let imagePendingList = [];
    const destinationAlign = () => pageScrollDestinationAlign(pageElement, elementTarget);
    const destinationFindAndApply = () => {
      if (!hash) {
        navigationHighlightSet(pageElement, null);
        pageScrollTopReset(pageElement);
        return;
      }

      const idEscaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(hash) : hash;
  const contentElement = pageElement.querySelector('[data-doc-content]');
  const elementAnchor = contentElement?.querySelector(`#${idEscaped}`);
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

      imagePendingList = [...contentElement.querySelectorAll('img')].filter((image) => (
        !image.complete
        && Boolean(image.compareDocumentPosition(elementTarget) & Node.DOCUMENT_POSITION_FOLLOWING)
      ));
      for (const image of imagePendingList) {
        image.addEventListener('load', destinationAlign, { once: true });
        image.addEventListener('error', destinationAlign, { once: true });
      }
    };

    destinationFindAndApply();
    return () => {
      cancelAnimationFrame(frameId);
      for (const image of imagePendingList) {
        image.removeEventListener('load', destinationAlign);
        image.removeEventListener('error', destinationAlign);
      }
    };
  }, [compiledStatus, hash, navigationRequestVersion, pageElementRef, pathContent]);
}
