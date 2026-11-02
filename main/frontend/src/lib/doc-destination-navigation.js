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

// a focus names a reference written in the document body, finer than a
// fragment (doc_page_impl_nav_backlink.md#going-to-a-backlink): the link
// controllers carry the target as written (data-doc-link-target) and, in
// the document's own Markdown, the line (data-doc-link-line). the one on
// the focus's line wins; else the first with that target, which is how a
// reference written in the data of a component (no line of its own) is
// found.
function focusElementFind(contentElement, focus) {
  if (!contentElement || !focus?.target) return null;
  const elementList = [
    ...contentElement.querySelectorAll(`[data-doc-link-target="${attributeValueEscape(focus.target)}"]`),
  ];
  if (elementList.length === 0) return null;
  if (focus.sourceLine) {
    const elementOnLine = elementList.find((element) => (
      Number(element.getAttribute('data-doc-link-line')) === focus.sourceLine
    ));
    if (elementOnLine) return elementOnLine;
  }
  return elementList[0];
}

function attributeValueEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// the block of text a focused reference sits in: what is aligned with the
// top of the viewport, so the reference is read in its sentence
function focusBlockGet(element) {
  return element.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, blockquote') ?? element;
}

function navigationFocusSet(pageElement, focusElement) {
  if (!pageElement) return;
  for (const element of pageElement.querySelectorAll('.doc-navigation-focus')) {
    if (element !== focusElement) element.classList.remove('doc-navigation-focus');
  }
  focusElement?.classList.add('doc-navigation-focus');
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

// offsetTop: the gap kept above the destination; a focused reference gets
// a larger one, so its ring and the line above it are in view
function pageScrollDestinationAlign(pageElement, targetElement, offsetTop = 8) {
  if (!pageElement || !targetElement) return;
  const pageRect = pageElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  pageElement.scrollTop = Math.max(
    0,
    pageElement.scrollTop + targetRect.top - pageRect.top - offsetTop,
  );
}

export {
  destinationElementFind,
  focusBlockGet,
  focusElementFind,
  navigationFocusSet,
  navigationHighlightSet,
  navigationHighlightTargetGet,
  pageScrollDestinationAlign,
  pageScrollDestinationIsAligned,
  pageScrollTopReset,
};
