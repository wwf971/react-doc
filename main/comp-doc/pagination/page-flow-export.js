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
  return { code: 0, message: '', data: { engine } };
}

function stylesheetLoadWait(doc) {
  const linkList = [...doc.querySelectorAll('link[rel="stylesheet"]')].filter((link) => !link.sheet);
  return Promise.all(linkList.map((link) => new Promise((resolve) => {
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 3000);
  })));
}

// the pages as a document of their own, as text: the same parts the frame of pageFlowPrint is
// built from (the page's stylesheets, the sheets, the print stylesheet), for a browser that is
// not this one. what it names by a relative url is read from where the page is (base).
export function pageFlowPrintHtmlBuild(sheetList, { title = 'pages', pageSpec, engine = 'blink' } = {}) {
  const spec = pageSpecNormalize(pageSpec);
  const headList = [];
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    if (node.tagName === 'LINK') {
      headList.push(`<link rel="stylesheet" href="${attrEscape(node.href)}">`);
      continue;
    }
    // a stylesheet filled by rules (not by text) has no text: its rules are written out
    let text = node.textContent ?? '';
    if (text.trim() === '') {
      try {
        text = [...(node.sheet?.cssRules ?? [])].map((rule) => rule.cssText).join('\n');
      } catch {
        text = '';
      }
    }
    if (text.trim() !== '') headList.push(`<style>${text.replace(/<\/style/gi, '<\\/style')}</style>`);
  }
  headList.push(`<style>${paginationPrintCssBuild(spec, engine)}</style>`);
  return [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><base href="${attrEscape(document.baseURI)}"><title>${textEscape(title)}</title>`,
    headList.join('\n'),
    '</head><body>',
    `<div class="doc-page-flow-print">${sheetList.map((sheet) => sheet.outerHTML).join('')}</div>`,
    '</body></html>',
  ].join('\n');
}

function attrEscape(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function textEscape(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// the pages printed to a PDF by a browser of the development server's machine (endpoint: the
// pdf api of the environment, plugin/doc-pdf-server.ts): what "Save as PDF" of a print dialog
// makes, without the dialog. answers { code, message, bytes }
async function pdfByServerGet(sheetList, { endpoint, title, pageSpec }) {
  try {
    const response = await fetch(`${endpoint}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, html: pageFlowPrintHtmlBuild(sheetList, { title, pageSpec, engine: 'blink' }) }),
    });
    if ((response.headers.get('Content-Type') ?? '').includes('application/pdf')) {
      return { code: 0, message: '', bytes: new Uint8Array(await response.arrayBuffer()) };
    }
    const result = await response.json().catch(() => undefined);
    return { code: -1, message: String(result?.message ?? `the development server answered ${response.status}`) };
  } catch (error) {
    return { code: -1, message: `the development server did not answer: ${String(error?.message ?? error)}` };
  }
}

function fileDownload(bytes, fileName) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

// a PDF of the pages, downloaded without a dialog (doc_page_impl_pagination.md#downloading-a-pdf).
// It is made the best way the environment has:
//   text    printed by a browser of the development server's machine (endpoint): text is
//           text, rules are lines, as "Save as PDF" of a print dialog makes it
//   image   every sheet drawn to an image in the page: the same in every browser and without
//           a server, its text a picture. the fallback
// answers { code, message, data: { pageCount, kind: 'text' | 'image', reason } }; reason: why
// the PDF is one of images, when one of text was possible to ask for
//   endpoint     the pdf api of the environment; '' or absent: images
//   isImage      images are wanted, whatever the environment offers
//   pixelRatio   images: how many image pixels per css pixel (2: about 192 dpi)
//   isFontEmbedded   images: fetch the page's web fonts into them (off: the system's fonts)
export async function pageFlowPdfDownload(rootElement, { fileName = 'pages.pdf', pageSpec, endpoint = '', isImage = false, pixelRatio = 2, quality = 0.92, isFontEmbedded = false } = {}) {
  const sheetList = rootElement ? [...rootElement.querySelectorAll('.doc-page-sheet')] : [];
  if (sheetList.length === 0) return { code: -1, message: 'no page to download' };
  const spec = pageSpecNormalize(pageSpec);
  let reason = '';
  if (endpoint && !isImage) {
    const printed = await pdfByServerGet(sheetList, { endpoint, title: fileName.replace(/\.pdf$/i, ''), pageSpec: spec });
    if (printed.code === 0) {
      fileDownload(printed.bytes, fileName);
      return { code: 0, message: '', data: { pageCount: sheetList.length, kind: 'text', reason: '' } };
    }
    reason = printed.message;
  }
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
  fileDownload(pdfFromJpegListBuild(pageList, { widthMm: spec.width, heightMm: spec.height }), fileName);
  return { code: 0, message: '', data: { pageCount: pageList.length, kind: 'image', reason } };
}
