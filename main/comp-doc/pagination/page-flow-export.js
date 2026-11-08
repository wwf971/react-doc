import { toJpeg } from 'html-to-image';
import { pageSpecNormalize, paginationEngineGet, paginationPrintCssBuild, PAGINATION_PRINT_PROFILE_BY_ENGINE } from '../../frontend/src/lib/doc-pagination.js';
import { dataUrlBytesGet, pdfFromJpegListBuild } from '../../frontend/src/lib/doc-pagination-pdf.js';

// Printing and downloading the pages of a PageFlow (doc_page_impl_pagination.md#printing).
//
// Printing goes through a document of its own: a hidden iframe holding copies of the sheets
// and of the page's stylesheets, and a stylesheet for the browser's engine. Nothing of the
// page around (side panel, toolbars, the editor) is there, so nothing has to be hidden, and
// the sheets print exactly as previewed: one sheet per page of the spec, no margin.

// the print profile of the browser running this page
export function pageFlowPrintProfileGet() {
  return PAGINATION_PRINT_PROFILE_BY_ENGINE[paginationEngineGet(typeof navigator === 'undefined' ? '' : navigator.userAgent)];
}

export async function pageFlowPrint(rootElement, { title = 'pages', pageSpec } = {}) {
  const sheetList = rootElement ? [...rootElement.querySelectorAll('.doc-page-sheet')] : [];
  if (sheetList.length === 0) return { code: -1, message: 'no page to print' };
  const spec = pageSpecNormalize(pageSpec);
  const engine = paginationEngineGet(navigator.userAgent);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
  doc.close();
  doc.title = title;
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.appendChild(doc.importNode(node, true));
  const style = doc.createElement('style');
  style.textContent = paginationPrintCssBuild(spec, engine);
  doc.head.appendChild(style);
  const wrapper = doc.createElement('div');
  wrapper.className = 'doc-page-flow-print';
  for (const sheet of sheetList) wrapper.appendChild(doc.importNode(sheet, true));
  doc.body.appendChild(wrapper);
  await stylesheetLoadWait(doc);
  try {
    await doc.fonts?.ready;
  } catch {
    // printed as the fonts are
  }
  await Promise.all([...doc.images].map((image) => image.decode?.().catch(() => undefined)));
  // the file a "Save as PDF" proposes is named after the title of the top document in some
  // browsers, of the printed frame in others: both say it while printing
  const titleBefore = document.title;
  document.title = title;
  const win = iframe.contentWindow;
  let isDone = false;
  const finish = () => {
    if (isDone) return;
    isDone = true;
    document.title = titleBefore;
    iframe.remove();
  };
  win.addEventListener('afterprint', () => setTimeout(finish, 100), { once: true });
  // a browser telling nothing after printing (some do not) loses the frame later, unseen
  setTimeout(finish, 10 * 60 * 1000);
  win.focus();
  win.print();
  return { code: 0, message: '', engine };
}

function stylesheetLoadWait(doc) {
  const linkList = [...doc.querySelectorAll('link[rel="stylesheet"]')].filter((link) => !link.sheet);
  return Promise.all(linkList.map((link) => new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 3000);
  })));
}

// a PDF of the pages as images, downloaded: the same in every browser, its text an image.
//   pixelRatio   how many image pixels per css pixel (2: about 192 dpi)
//   isFontEmbedded   fetch the page's web fonts into the images (off: the system's fonts)
export async function pageFlowPdfDownload(rootElement, { fileName = 'pages.pdf', pageSpec, pixelRatio = 2, quality = 0.92, isFontEmbedded = false } = {}) {
  const sheetList = rootElement ? [...rootElement.querySelectorAll('.doc-page-sheet')] : [];
  if (sheetList.length === 0) return { code: -1, message: 'no page to download' };
  const spec = pageSpecNormalize(pageSpec);
  const pageList = [];
  for (const sheet of sheetList) {
    const width = sheet.offsetWidth;
    const height = sheet.offsetHeight;
    // eslint-disable-next-line no-await-in-loop
    const dataUrl = await toJpeg(sheet, {
      pixelRatio, quality, backgroundColor: '#ffffff', width, height, skipFonts: !isFontEmbedded,
      style: { margin: '0', boxShadow: 'none', transform: 'none' },
    });
    pageList.push({ jpegBytes: dataUrlBytesGet(dataUrl), widthPx: Math.round(width * pixelRatio), heightPx: Math.round(height * pixelRatio) });
  }
  const bytes = pdfFromJpegListBuild(pageList, { widthMm: spec.width, heightMm: spec.height });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  return { code: 0, message: '', pageCount: pageList.length };
}
