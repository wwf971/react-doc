function pageScrollTopReset(pageElement) {
  if (!pageElement) return;
  const documentElement = pageElement.ownerDocument?.documentElement;
  let elementCurrent = pageElement.querySelector('#nd-page') ?? pageElement;
  while (elementCurrent) {
    elementCurrent.scrollTop = 0;
    if (elementCurrent === documentElement) break;
    elementCurrent = elementCurrent.parentElement;
  }
  const scrollingElement = pageElement.ownerDocument?.scrollingElement;
  if (scrollingElement) scrollingElement.scrollTop = 0;
}

// a fragment names a place in the document body:
//   1. an element id: a heading id (generated from the title, or declared
//      with an Anchor comment), or an Anchor alias
//   2. otherwise the title text of a heading, compared without case and with
//      whitespace collapsed; the first matching heading wins
// a fragment written in a link may be percent-encoded (%20 for a space).
function destinationElementFind(contentElement, hash) {
  if (!contentElement || !hash) return null;
  const hashDecoded = fragmentDecode(hash);
  const elementById = elementByIdFind(contentElement, hash) ?? elementByIdFind(contentElement, hashDecoded);
  if (elementById) return elementById;

  const titleWanted = headingTitleNormalize(hashDecoded);
  for (const heading of contentElement.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (headingTitleNormalize(heading.textContent) === titleWanted) return heading;
  }
  return null;
}

function elementByIdFind(contentElement, id) {
  const idEscaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  return contentElement.querySelector(`#${idEscaped}`);
}

function fragmentDecode(hash) {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function headingTitleNormalize(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function navigationHighlightTargetGet(element) {
  const isEmpty = !element.textContent?.trim() && element.children.length === 0;
  const heading = isEmpty ? element.closest('h1, h2, h3, h4, h5, h6') : null;
  if (heading) return heading;

  let elementTarget = element;
  while (
    !elementTarget.textContent?.trim()
    && elementTarget.children.length === 0
    && elementTarget.nextElementSibling
  ) {
    elementTarget = elementTarget.nextElementSibling;
  }
  return elementTarget;
}

function navigationHighlightSet(pageElement, targetElement) {
  if (!pageElement) return;
  for (const element of pageElement.querySelectorAll('.doc-navigation-target')) {
    if (element !== targetElement) element.classList.remove('doc-navigation-target');
  }
  targetElement?.classList.add('doc-navigation-target');
}

function pageScrollDestinationIsAligned(pageElement, targetElement, tolerance = 1) {
  if (!pageElement || !targetElement) return false;
  const pageRect = pageElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  return Math.abs(targetRect.top - pageRect.top - 8) <= tolerance;
}

function pageScrollDestinationAlign(pageElement, targetElement) {
  if (!pageElement || !targetElement) return;
  const pageRect = pageElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  pageElement.scrollTop = Math.max(
    0,
    pageElement.scrollTop + targetRect.top - pageRect.top - 8,
  );
}

export {
  destinationElementFind,
  navigationHighlightSet,
  navigationHighlightTargetGet,
  pageScrollDestinationAlign,
  pageScrollDestinationIsAligned,
  pageScrollTopReset,
};
