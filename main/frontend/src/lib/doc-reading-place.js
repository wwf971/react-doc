// The reading place of a document: where the reader is in it, by its
// structure rather than by a number of pixels. Design:
// doc_page_impl_nav.md#reading-places
//
// A scroll offset alone goes wrong as soon as anything above it changes: a
// block grows (a component drew its data), one is deleted or inserted, an
// image loads at another size. So a place says what is at the top of the
// reading area (the line under the sticky head of the page), from the
// coarse to the fine, and is resolved again from the document as it is:
//
//   headingId            the section: the heading at or above the line, as the
//                        table of contents marks it ('' before the first heading)
//   blockIndexInSection  the root-level block at the line, counted from that
//                        heading (blockIndex: counted from the top of the body)
//   blockText            the start of its text, which the block must still have
//   offsetPx, blockHeight  how far into the block the line was; when the block
//                        changed height, the same fraction of it is kept; past
//                        its end (the margin before the next block), as far
//                        below its end
//   sectionOffsetPx      how far below the heading the line was, when the
//                        block is gone but its section is still there
//   scrollTop            the offset itself, the last resort
//   isTop                the reader was at the top of the document
//
// resolving (readingPlaceScrollTopResolve): the block at its index in the
// section when its text agrees; else the nearest block of the section with
// that text; else the nearest block of the document with that text; else the
// same distance below the heading, kept inside its section; else the offset.

const BLOCK_TEXT_LENGTH = 80;
// the gap kept between the sticky head and what is aligned below it, the same
// as for the destination of a fragment (doc-destination-navigation.js)
export const READING_LINE_GAP = 8;

// ---------- reading the document (DOM) ----------

// how far down from the top of the scroll container the reading area starts:
// below the sticky head of the page (toolbar and path bar, DocPageHead), which
// itself sticks below the sticky rows of fumadocs (--fd-docs-row-3)
export function pageStickyInsetGet(pageElement) {
  const head = pageElement?.querySelector?.('.doc-page-head');
  if (!head) return 0;
  const top = parseFloat(getComputedStyle(head).top);
  return (Number.isFinite(top) ? top : 0) + head.offsetHeight;
}

// the root-level blocks of the body shown, in order, each with its place in
// the scroll coordinates of the page: the children of the body in reading
// mode, the block wrappers of the edit body in edit mode
//   -> [{ top, height, text, headingId }]
export function readingPlaceBlockListRead(pageElement) {
  const contentElement = pageElement?.querySelector?.('[data-doc-content]');
  if (!contentElement) return [];
  const editBody = contentElement.querySelector(':scope > .doc-edit-body');
  const elementList = editBody
    ? [...editBody.querySelectorAll(':scope > .doc-edit-block')]
    : [...contentElement.children];
  const pageTop = pageElement.getBoundingClientRect().top - pageElement.scrollTop;
  const blockList = [];
  for (const element of elementList) {
    if (element.getClientRects().length === 0) continue;
    const rect = element.getBoundingClientRect();
    blockList.push({
      top: rect.top - pageTop,
      height: rect.height,
      text: blockTextGet(element),
      headingId: blockHeadingIdGet(element),
    });
  }
  return blockList;
}

// the text a block shows, without the controls of the edit layer around it
function blockTextGet(element) {
  const partList = element.classList.contains('doc-edit-block')
    ? [...element.children].filter((child) => !child.classList.contains('doc-edit-block-anchor')).map((child) => child.textContent)
    : [element.textContent];
  return blockTextNormalize(partList.join(' '));
}

// the id of the heading a block is (or, in edit mode, wraps); '' otherwise
function blockHeadingIdGet(element) {
  const heading = element.matches('h1, h2, h3, h4, h5, h6')
    ? element
    : element.classList.contains('doc-edit-block') ? element.querySelector(':scope > :is(h1, h2, h3, h4, h5, h6)') : null;
  return heading?.id ?? '';
}

export function blockTextNormalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, BLOCK_TEXT_LENGTH);
}

// the reading place of the document shown; undefined without a body
export function readingPlaceCapture(pageElement) {
  if (!pageElement) return undefined;
  const scrollTop = pageElement.scrollTop;
  const blockList = readingPlaceBlockListRead(pageElement);
  if (blockList.length === 0) return undefined;
  return readingPlaceBuild(blockList, scrollTop, pageStickyInsetGet(pageElement) + READING_LINE_GAP);
}

// the scroll offset that puts the place back at the reading line; undefined
// without a body
export function readingPlaceScrollTopGet(pageElement, place) {
  const blockList = readingPlaceBlockListRead(pageElement);
  if (blockList.length === 0) return undefined;
  const scrollMax = Math.max(0, pageElement.scrollHeight - pageElement.clientHeight);
  return readingPlaceScrollTopResolve(blockList, place, {
    readingOffset: pageStickyInsetGet(pageElement) + READING_LINE_GAP,
    scrollMax,
  });
}

// ---------- the place, from the blocks (pure) ----------

// blockList: [{ top, height, text, headingId }] in scroll coordinates;
// readingOffset: the reading line below the top of the scroll container
export function readingPlaceBuild(blockList, scrollTop, readingOffset) {
  if (scrollTop <= 1) return { isTop: true, scrollTop: 0 };
  const line = scrollTop + readingOffset;
  let index = 0;
  for (let indexBlock = 0; indexBlock < blockList.length; indexBlock += 1) {
    if (blockList[indexBlock].top <= line) index = indexBlock;
    else break;
  }
  const sectionStart = sectionStartGet(blockList, index);
  const block = blockList[index];
  const sectionTop = sectionStart >= 0 ? blockList[sectionStart].top : 0;
  return {
    isTop: false,
    scrollTop,
    headingId: sectionStart >= 0 ? blockList[sectionStart].headingId : '',
    blockIndex: index,
    blockIndexInSection: index - Math.max(sectionStart, 0),
    blockText: block.text,
    blockHeight: block.height,
    offsetPx: line - block.top,
    sectionOffsetPx: line - sectionTop,
  };
}

export function readingPlaceScrollTopResolve(blockList, place, { readingOffset, scrollMax }) {
  const clamp = (value) => Math.min(Math.max(0, value), Math.max(0, scrollMax));
  if (!place || place.isTop) return 0;
  if (blockList.length === 0) return clamp(place.scrollTop ?? 0);
  // the section: the heading by its id; '' is the part before the first heading
  let sectionStart = -1;
  if (place.headingId) sectionStart = blockList.findIndex((block) => block.headingId === place.headingId);
  else if (place.headingId === '') sectionStart = 0;
  const sectionEnd = sectionStart >= 0 ? sectionEndGet(blockList, sectionStart, place.headingId === '') : -1;
  const isTextSame = (index) => blockList[index]?.text === place.blockText;
  let index = -1;
  if (sectionStart >= 0) {
    const indexExpected = sectionStart + place.blockIndexInSection;
    if (indexExpected < sectionEnd && isTextSame(indexExpected)) index = indexExpected;
    else if (place.blockText) index = indexNearestGet(blockList, sectionStart, sectionEnd, indexExpected, isTextSame);
  }
  if (index < 0 && place.blockText) index = indexNearestGet(blockList, 0, blockList.length, place.blockIndex, isTextSame);
  if (index >= 0) {
    const block = blockList[index];
    let line;
    // the line was in the margin after the block: as far below its end
    if (place.offsetPx > place.blockHeight) line = block.top + block.height + (place.offsetPx - place.blockHeight);
    else if (block.height === place.blockHeight || !(place.blockHeight > 0)) line = block.top + place.offsetPx;
    else line = block.top + Math.min(Math.max(0, (place.offsetPx / place.blockHeight) * block.height), block.height);
    return clamp(line - readingOffset);
  }
  if (sectionStart >= 0 && place.headingId) {
    const sectionTop = blockList[sectionStart].top;
    const sectionBottom = sectionEnd < blockList.length
      ? blockList[sectionEnd].top
      : blockList.at(-1).top + blockList.at(-1).height;
    return clamp(sectionTop + Math.min(Math.max(0, place.sectionOffsetPx), sectionBottom - sectionTop) - readingOffset);
  }
  return clamp(place.scrollTop ?? 0);
}

// the heading block at or above a block, -1 when there is none
function sectionStartGet(blockList, index) {
  for (let indexBlock = index; indexBlock >= 0; indexBlock -= 1) {
    if (blockList[indexBlock].headingId) return indexBlock;
  }
  return -1;
}

// the end (exclusive) of the section starting at sectionStart: the next
// heading; the part before the first heading ends at the first heading
function sectionEndGet(blockList, sectionStart, isBeforeFirstHeading) {
  for (let indexBlock = isBeforeFirstHeading ? sectionStart : sectionStart + 1; indexBlock < blockList.length; indexBlock += 1) {
    if (blockList[indexBlock].headingId) return indexBlock;
  }
  return blockList.length;
}

// the index in [start, end) nearest to indexWanted that passes the test
function indexNearestGet(blockList, start, end, indexWanted, test) {
  let indexBest = -1;
  for (let index = start; index < end; index += 1) {
    if (!test(index)) continue;
    if (indexBest < 0 || Math.abs(index - indexWanted) < Math.abs(indexBest - indexWanted)) indexBest = index;
  }
  return indexBest;
}
