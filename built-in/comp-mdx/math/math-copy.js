// Copying a formula drawn on the page, or saving it as a file
// (comp_math.md#copying-a-formula), in one of three forms:
//
//   latex   the source, as typed (without its $$); copied only
//   png     an image of the formula as the page draws it (KaTeX), in black on
//           a transparent ground, at twice the pixels of the screen at least;
//           copied, or downloaded as formula.png
//   svg     an SVG of paths drawn from the same source by MathJax
//           (math-svg.js, loaded then); copied as text, or downloaded as
//           formula.svg
//
// a formula drawn by KaTeX keeps its source in its MathML, so the copy reads
// it from the page: nothing of the document is asked for. every write of the
// clipboard is made inside the click that asks for it, its content a promise
// (a browser keeps the clipboard to the gesture). both answer { code, message }.

export const MATH_COPY_MODE_LIST = Object.freeze([
  { id: 'latex', label: 'LaTeX', description: 'the source, as typed' },
  { id: 'png', label: 'Image', description: 'PNG, as drawn here' },
  { id: 'svg', label: 'SVG', description: 'paths, drawn by MathJax' },
]);

export const MATH_DOWNLOAD_MODE_LIST = Object.freeze([
  { id: 'png', label: 'Image', description: 'formula.png' },
  { id: 'svg', label: 'SVG', description: 'formula.svg' },
]);

// the source of a formula drawn by KaTeX (its .katex-display or its .katex)
export function mathSourceOf(element) {
  return element?.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent ?? '';
}

export function mathCopy(mode, element) {
  const source = mathSourceOf(element);
  if (!source.trim()) return Promise.resolve({ code: -1, message: 'This formula has no source to copy.' });
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  if (!clipboard) return Promise.resolve({ code: -1, message: 'The clipboard is not available on this page.' });
  const isItem = typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function';
  let write;
  if (mode === 'png') {
    if (!isItem) return Promise.resolve({ code: -1, message: 'This browser cannot copy images.' });
    write = clipboard.write([new ClipboardItem({ 'image/png': mathPngBlobGet(element) })]);
  } else {
    const textPromise = mode === 'svg' ? mathSvgTextGet(source) : Promise.resolve(source);
    write = isItem
      ? clipboard.write([new ClipboardItem({ 'text/plain': textPromise.then((text) => new Blob([text], { type: 'text/plain' })) })])
      : textPromise.then((text) => clipboard.writeText(text));
  }
  return write.then(
    () => ({ code: 0, message: '' }),
    (error) => ({ code: -1, message: String(error?.message ?? error) }),
  );
}

// the formula as a file the browser saves (formula.png, formula.svg): the
// image as copied; the SVG as copied, with the declaration of an XML file
export async function mathDownload(mode, element) {
  const source = mathSourceOf(element);
  if (!source.trim()) return { code: -1, message: 'This formula has no source to save.' };
  try {
    const blob = mode === 'svg'
      ? new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${await mathSvgTextGet(source)}\n`], { type: 'image/svg+xml' })
      : await mathPngBlobGet(element);
    fileSave(blob, mode === 'svg' ? 'formula.svg' : 'formula.png');
    return { code: 0, message: '' };
  } catch (error) {
    return { code: -1, message: String(error?.message ?? error) };
  }
}

function mathSvgTextGet(source) {
  return import('./math-svg.js').then((module) => module.mathSvgGet(source, { isDisplay: true }));
}

// a file saved by the browser, as a link to it clicked
function fileSave(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

// the formula as drawn, as a PNG: a copy of its KaTeX (without the row of a
// display, which is as wide as the text) in a box of its own, as wide as the
// formula, a little room around it for the glyphs that reach out of their
// boxes; the fonts of the page go into the image (html-to-image). the copy is
// temporary rendering DOM, in a host of its own (doc_page_impl.md#isolate-
// temporary-rendering-dom): fixed, of no size, clipped, out of the pointer's
// way, so the page around it never changes
async function mathPngBlobGet(element) {
  const { toBlob } = await import('html-to-image');
  const katexElement = element.matches?.('.katex') ? element : element.querySelector('.katex');
  if (!katexElement) throw new Error('This formula is not drawn by KaTeX.');
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: hidden; pointer-events: none; contain: strict;';
  const holder = document.createElement('div');
  holder.style.cssText = [
    'position: absolute',
    'left: 0',
    'top: 0',
    'display: inline-block',
    'padding: 0.3em 0.4em',
    'color: #000',
    'background: transparent',
    'white-space: nowrap',
    `font-size: ${getComputedStyle(element).fontSize}`,
  ].join(';');
  const copy = katexElement.cloneNode(true);
  copy.querySelector('.katex-mathml')?.remove();
  holder.appendChild(copy);
  host.appendChild(holder);
  document.body.appendChild(host);
  try {
    const blob = await toBlob(holder, {
      pixelRatio: Math.max(2, window.devicePixelRatio || 1),
      skipAutoScale: true,
      // the copy drawn into the image stands at its top left
      style: { position: 'static' },
    });
    if (!blob) throw new Error('The image could not be drawn.');
    return blob;
  } finally {
    host.remove();
  }
}
