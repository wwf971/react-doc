// Pagination: laying a flow of pieces out on pages of a fixed size (design:
// main/doc_page_impl_pagination.md). This file is the pure part, shared by the
// environment component (comp-doc/pagination/PageFlow.jsx) and tests: the page,
// the identity of a piece, and the planner. Nothing here touches the DOM: what a
// piece measures comes in, what is still to be measured goes out.
//
//   a page spec    { width, height, margin: { top, right, bottom, left } } in mm
//   a piece        { type, data, key }: one box of the flow, drawn by the Render of
//                  its type, measured alone at the width of the page content. pieces
//                  stack with nothing between them (each a flow-root box), so their
//                  heights add up exactly: what is measured alone is what the page holds
//   measured       { height, breakList: [{ key, top, bottom }], textList: [{ key,
//                  lineList: [{ offset, top, bottom }] }] }: px from the top of the piece;
//                  a break is a place the piece may be cut after (an element marked
//                  data-page-break), a text the lines of an element marked data-page-text
//   a piece type   { Render, split?(data, { space, measured, isPageTop }) -> { head, tail,
//                  breakKey } | null, isFilledOnSplit? }: split cuts the data in two at a
//                  place where the head is at most space px tall; null: no place does

export const PAGE_SPEC_A4 = Object.freeze({ width: 210, height: 297, margin: Object.freeze({ top: 10, right: 10, bottom: 10, left: 10 }) });

// css px per mm (96 px per inch, as every browser lays out)
export const PAGINATION_PX_PER_MM = 96 / 25.4;

// how far a measure may be off and still fit: subpixel rounding of borders
export const PAGINATION_EPSILON = 0.75;

// the most pages a plan makes, and the most times a split is retried smaller
const PAGE_COUNT_MAX = 200;
const SPLIT_TRY_MAX = 8;

export function pageSpecNormalize(spec = {}) {
  const margin = { ...PAGE_SPEC_A4.margin, ...(spec.margin ?? {}) };
  const width = Number(spec.width ?? PAGE_SPEC_A4.width);
  const height = Number(spec.height ?? PAGE_SPEC_A4.height);
  return {
    width,
    height,
    margin: { top: Number(margin.top), right: Number(margin.right), bottom: Number(margin.bottom), left: Number(margin.left) },
    contentWidth: width - Number(margin.left) - Number(margin.right),
    contentHeight: height - Number(margin.top) - Number(margin.bottom),
  };
}

// a short stable hash of a text (FNV-1a, 32 bits, base 36)
export function paginationHash(text) {
  let hash = 0x811c9dc5;
  const value = String(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// the key of a piece: what its measure is kept under. a piece of the flow is keyed by
// its type and data (a change of the data measures it again); a part of a split one by
// its parent's key and where it was cut, so the same cut is the same piece
export function pieceKeyOf(piece) {
  if (piece.key) return piece.key;
  return `${piece.type}:${paginationHash(JSON.stringify(piece.data ?? null))}`;
}

export function pieceListKeyed(pieceList) {
  const seen = new Map();
  return (pieceList ?? []).map((piece) => {
    const keyBase = pieceKeyOf(piece);
    const count = seen.get(keyBase) ?? 0;
    seen.set(keyBase, count + 1);
    return { ...piece, key: count === 0 ? keyBase : `${keyBase}#${count}` };
  });
}

// the plan of a flow: which piece goes on which page, at what height
//   pieceList      the flow, keyed (pieceListKeyed)
//   measuredGet    key -> measured, or undefined while it is not measured
//   typeGet        type -> its piece type
//   contentHeight  px a page holds
// -> { pageList: [{ pieceList: [{ ...piece, top, height, layout }] }], needList, problemList, isDone }
//   needList   pieces to measure before the plan can go on (the planner stops at the first
//              piece it cannot place without a measure; run it again once they are measured)
//   layout     { pageIndex, isPageTop, fillHeight }: fillHeight, the space left under a head
//              cut by a split when its type isFilledOnSplit (a table drawn to the page's bottom)
export function paginationPlan({ pieceList, measuredGet, typeGet, contentHeight }) {
  const queue = [...pieceList];
  const pageList = [];
  const problemList = [];
  const needList = [];
  let page = { pieceList: [], used: 0 };
  const pagePush = () => {
    pageList.push(page);
    page = { pieceList: [], used: 0 };
  };
  const place = (piece, height, fillHeight = 0) => {
    page.pieceList.push({ ...piece, top: page.used, height, layout: { pageIndex: pageList.length, isPageTop: page.pieceList.length === 0, fillHeight } });
    page.used += height + fillHeight;
  };
  while (queue.length > 0) {
    if (pageList.length >= PAGE_COUNT_MAX) {
      problemList.push(`the flow takes more than ${PAGE_COUNT_MAX} pages; the rest is left out`);
      break;
    }
    const piece = queue[0];
    const measured = measuredGet(piece.key);
    if (!measured) {
      needList.push(piece);
      break;
    }
    const space = contentHeight - page.used;
    const isPageTop = page.pieceList.length === 0;
    if (measured.height <= space + PAGINATION_EPSILON) {
      place(piece, measured.height);
      queue.shift();
      continue;
    }
    const type = typeGet(piece.type);
    const cut = splitFind(piece, measured, type, { space, isPageTop, measuredGet, needList });
    if (cut === 'need') break;
    if (cut) {
      place(cut.head, cut.headHeight, type?.isFilledOnSplit ? Math.max(0, space - cut.headHeight) : 0);
      queue.shift();
      queue.unshift(cut.tail);
      pagePush();
      continue;
    }
    if (isPageTop) {
      // taller than a page and nowhere to cut: it goes on a page of its own, cut off
      problemList.push(`${piece.type} is ${Math.round(measured.height)}px tall, more than a page (${Math.round(contentHeight)}px), and cannot be split`);
      place(piece, measured.height);
      queue.shift();
    }
    pagePush();
  }
  if (page.pieceList.length > 0 || pageList.length === 0) pageList.push(page);
  return { pageList, needList, problemList, isDone: needList.length === 0 };
}

// where a piece that does not fit is cut: { head, tail, headHeight } | null | 'need'. the head
// is measured before it is trusted (its own table border, a repeated heading): when it is
// taller than the space after all, the split is asked again for that much less
function splitFind(piece, measured, type, { space, isPageTop, measuredGet, needList }) {
  if (!type?.split) return null;
  let spaceTry = space;
  for (let attempt = 0; attempt < SPLIT_TRY_MAX && spaceTry > 0; attempt += 1) {
    let result;
    try {
      result = type.split(piece.data, { space: spaceTry, measured, isPageTop });
    } catch (error) {
      console.warn(`[pagination] ${piece.type}: split failed`, error);
      return null;
    }
    if (!result || result.head === undefined || result.tail === undefined) return null;
    const breakKey = String(result.breakKey ?? attempt);
    const head = { type: result.headType ?? piece.type, data: result.head, key: `${piece.key}/${breakKey}:head` };
    const tail = { type: result.tailType ?? piece.type, data: result.tail, key: `${piece.key}/${breakKey}:tail` };
    const headMeasured = measuredGet(head.key);
    if (!headMeasured) {
      needList.push(head, tail);
      return 'need';
    }
    if (headMeasured.height <= space + PAGINATION_EPSILON) return { head, tail, headHeight: headMeasured.height };
    spaceTry -= headMeasured.height - space + 1;
  }
  return null;
}

// ---------- helpers for the split of a piece type ----------

// the last break of a measured piece whose bottom is within space (keepBelow: px the head
// takes under its last kept element, its bottom border, its padding): the key, or undefined
export function paginationBreakLastFitting(measured, space, keepBelow = 0) {
  let found;
  for (const one of measured?.breakList ?? []) {
    if (one.bottom + keepBelow <= space + PAGINATION_EPSILON) found = one;
  }
  return found;
}

// the line of a measured text after which a text is cut so that the head is within space:
// { offset } of the first line left out (the head is text.slice(0, offset)), or undefined
// when not even one line fits, or when every line does
export function paginationTextCutGet(measured, textKey, space, keepBelow = 0) {
  const text = (measured?.textList ?? []).find((one) => one.key === textKey);
  const lineList = text?.lineList ?? [];
  let lineLast = -1;
  lineList.forEach((line, index) => {
    if (line.bottom + keepBelow <= space + PAGINATION_EPSILON) lineLast = index;
  });
  if (lineLast < 0 || lineLast >= lineList.length - 1) return undefined;
  return { offset: lineList[lineLast + 1].offset };
}

// ---------- printing ----------

// what a browser needs to print the pages as they are (doc_page_impl_pagination.md#printing):
// every page one sheet of the page's size, nothing else on it. measured differences:
//   blink (Chrome, Edge)   honors @page size and margin 0; a sheet exactly as tall as the
//                          paper prints on one page; with no margin it prints no header
//   gecko (Firefox)        honors @page size (since 95); rounds the sheet's height up and
//                          then breaks a blank page after a sheet exactly as tall as the
//                          paper: the sheet is made a little shorter. its headers and
//                          footers are an option of its dialog (off: Margins none)
//   webkit (Safari)        ignores @page size: the paper is the one chosen in the dialog;
//                          the same shorter sheet as gecko
export const PAGINATION_PRINT_PROFILE_BY_ENGINE = Object.freeze({
  blink: Object.freeze({ engine: 'blink', label: 'Chrome / Edge', sheetHeightLess: 0, isPageSizeHonored: true, hint: '' }),
  gecko: Object.freeze({ engine: 'gecko', label: 'Firefox', sheetHeightLess: 0.4, isPageSizeHonored: true, hint: 'In the print dialog: Margins None, and Print headers and footers off.' }),
  webkit: Object.freeze({ engine: 'webkit', label: 'Safari', sheetHeightLess: 0.4, isPageSizeHonored: false, hint: 'In the print dialog: the paper size of the pages (A4), and Print headers and footers off.' }),
});

export function paginationEngineGet(userAgent = '') {
  const text = String(userAgent);
  if (/Firefox\//.test(text)) return 'gecko';
  if (/(Chrome|Chromium|CriOS|Edg)\//.test(text)) return 'blink';
  if (/AppleWebKit\//.test(text)) return 'webkit';
  return 'blink';
}

// the stylesheet of a print document: a page of the spec per sheet, no margin
export function paginationPrintCssBuild(specInput, engine = 'blink') {
  const spec = pageSpecNormalize(specInput);
  const profile = PAGINATION_PRINT_PROFILE_BY_ENGINE[engine] ?? PAGINATION_PRINT_PROFILE_BY_ENGINE.blink;
  const sheetHeight = spec.height - profile.sheetHeightLess;
  return [
    `@page { size: ${spec.width}mm ${spec.height}mm; margin: 0; }`,
    'html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }',
    '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }',
    '.doc-page-flow-print { display: block; margin: 0; padding: 0; }',
    `.doc-page-flow-print .doc-page-sheet { width: ${spec.width}mm !important; height: ${sheetHeight}mm !important; margin: 0 !important; box-shadow: none !important; border: 0 !important; overflow: hidden; break-after: page; page-break-after: always; break-inside: avoid; }`,
    '.doc-page-flow-print .doc-page-sheet:last-child { break-after: auto; page-break-after: auto; }',
    '.doc-page-flow-print .doc-page-label { display: none !important; }',
    '@media screen { .doc-page-flow-print .doc-page-sheet { margin: 0 auto 8mm !important; } }',
  ].join('\n');
}
