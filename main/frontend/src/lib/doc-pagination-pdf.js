// A PDF made of page images: the pure writer behind "Download PDF" of a paginated flow
// (doc_page_impl_pagination.md#downloading-a-pdf). Every page is one JPEG drawn over the
// whole page, so the file is the same in every browser, whatever its print dialog does;
// its text is an image, not text (print to PDF keeps the text).
//
//   pageList   [{ jpegBytes: Uint8Array, widthPx, heightPx }]   the images of the pages
//   widthMm, heightMm                                           the size of a page
// -> Uint8Array of a PDF 1.4 file

const PT_PER_MM = 72 / 25.4;

export function pdfFromJpegListBuild(pageList, { widthMm = 210, heightMm = 297 } = {}) {
  const encoder = new TextEncoder();
  const chunkList = [];
  const offsetList = [];
  let length = 0;
  const write = (part) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunkList.push(bytes);
    length += bytes.length;
  };
  const objectBegin = (number) => {
    offsetList[number] = length;
    write(`${number} 0 obj\n`);
  };
  const widthPt = (widthMm * PT_PER_MM).toFixed(2);
  const heightPt = (heightMm * PT_PER_MM).toFixed(2);
  // 1 catalog, 2 pages, then per page: page, image, content
  const pageObjectNumber = (index) => 3 + index * 3;
  write('%PDF-1.4\n%âãÏÓ\n');
  objectBegin(1);
  write('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objectBegin(2);
  write(`<< /Type /Pages /Kids [${pageList.map((one, index) => `${pageObjectNumber(index)} 0 R`).join(' ')}] /Count ${pageList.length} >>\nendobj\n`);
  pageList.forEach((page, index) => {
    const numberPage = pageObjectNumber(index);
    const numberImage = numberPage + 1;
    const numberContent = numberPage + 2;
    objectBegin(numberPage);
    write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] /Resources << /XObject << /Im0 ${numberImage} 0 R >> >> /Contents ${numberContent} 0 R >>\nendobj\n`);
    objectBegin(numberImage);
    write(`<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`);
    write(page.jpegBytes);
    write('\nendstream\nendobj\n');
    const content = `q ${widthPt} 0 0 ${heightPt} 0 0 cm /Im0 Do Q`;
    objectBegin(numberContent);
    write(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });
  const objectCount = 3 + pageList.length * 3;
  const xrefOffset = length;
  write(`xref\n0 ${objectCount}\n0000000000 65535 f \n`);
  for (let number = 1; number < objectCount; number += 1) write(`${String(offsetList[number]).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  const result = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunkList) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}

// the bytes of a data: url (data:image/jpeg;base64,...)
export function dataUrlBytesGet(dataUrl) {
  const base64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
  const binary = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
