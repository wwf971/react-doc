// The pack form of a managed document (design: doc_page_impl_doc_managed.md#the-pack-form):
// one binary file holding the record of the document and its content, the
// form a deployment on a cloud keeps (one object per document, one read).
// Free of node and of the DOM: the development server and a page reading a
// cloud both use it, each with its own deflate (zlib on the server,
// CompressionStream in a browser), handed in.
//
//   offset  size  field
//   0       4     magic "RDOC"
//   4       1     format version (1)
//   5       1     flags: bit 0 the body is deflated (raw deflate, no header)
//   6       2     0
//   8       4     length R of the record (uint32, little endian)
//   12      R     the record: the json of the fields a plain record holds (utf-8)
//   12+R    4     length B of the body as stored
//   16+R    B     the body: the text (mode text) or the json of the blocks (mode block),
//                 utf-8, deflated when flag bit 0 is set
//
// the record is never deflated, so a listing reads it without the body.

export const DOC_MANAGED_PACK_MAGIC = 'RDOC';
export const DOC_MANAGED_PACK_VERSION = 1;
const FLAG_DEFLATED = 1;
const HEADER_LENGTH = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

export class DocManagedPackError extends Error {}

// record: a plain mapping (json); body: the bytes of the content (Uint8Array)
// or a string; deflate(bytes) -> bytes, or none to store the body as it is
export function docManagedPackEncode({ record, body }, deflate) {
  const recordBytes = textEncoder.encode(JSON.stringify(record ?? {}));
  const bodyRaw = typeof body === 'string' ? textEncoder.encode(body) : (body ?? new Uint8Array(0));
  const bodyStored = deflate ? deflate(bodyRaw) : bodyRaw;
  const bytes = new Uint8Array(HEADER_LENGTH + recordBytes.length + 4 + bodyStored.length);
  const view = new DataView(bytes.buffer);
  bytes.set(textEncoder.encode(DOC_MANAGED_PACK_MAGIC), 0);
  view.setUint8(4, DOC_MANAGED_PACK_VERSION);
  view.setUint8(5, deflate ? FLAG_DEFLATED : 0);
  view.setUint32(8, recordBytes.length, true);
  bytes.set(recordBytes, HEADER_LENGTH);
  view.setUint32(HEADER_LENGTH + recordBytes.length, bodyStored.length, true);
  bytes.set(bodyStored, HEADER_LENGTH + recordBytes.length + 4);
  return bytes;
}

// the parts of a pack file, the body as stored: { record, bodyStored, isDeflated }
function packSplit(bytesInput) {
  const bytes = bytesInput instanceof Uint8Array ? bytesInput : new Uint8Array(bytesInput);
  if (bytes.length < HEADER_LENGTH + 4) throw new DocManagedPackError('not a pack file: too short');
  if (textDecoder.decode(bytes.subarray(0, 4)) !== DOC_MANAGED_PACK_MAGIC) throw new DocManagedPackError('not a pack file: no RDOC mark');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(4);
  if (version !== DOC_MANAGED_PACK_VERSION) throw new DocManagedPackError(`a pack file of version ${version}; this page reads version ${DOC_MANAGED_PACK_VERSION}`);
  const flags = view.getUint8(5);
  const recordLength = view.getUint32(8, true);
  const bodyLengthAt = HEADER_LENGTH + recordLength;
  if (bodyLengthAt + 4 > bytes.length) throw new DocManagedPackError('a pack file cut short in its record');
  let record;
  try {
    record = JSON.parse(textDecoder.decode(bytes.subarray(HEADER_LENGTH, bodyLengthAt)));
  } catch (error) {
    throw new DocManagedPackError(`the record of a pack file is not json: ${error?.message ?? error}`);
  }
  const bodyLength = view.getUint32(bodyLengthAt, true);
  if (bodyLengthAt + 4 + bodyLength > bytes.length) throw new DocManagedPackError('a pack file cut short in its body');
  return { record, bodyStored: bytes.subarray(bodyLengthAt + 4, bodyLengthAt + 4 + bodyLength), isDeflated: (flags & FLAG_DEFLATED) !== 0 };
}

// the record alone, without inflating the body (a listing of a root)
export function docManagedPackRecordRead(bytes) {
  return packSplit(bytes).record;
}

// { record, body } with the body as utf-8 text; inflate(bytes) -> bytes
export function docManagedPackDecode(bytes, inflate) {
  const { record, bodyStored, isDeflated } = packSplit(bytes);
  if (isDeflated && !inflate) throw new DocManagedPackError('the body of the pack file is deflated, and no inflate was given');
  const body = isDeflated ? inflate(bodyStored) : bodyStored;
  return { record, body: textDecoder.decode(body) };
}

// a file name is a pack file by its extension
export const DOC_MANAGED_PACK_EXT = 'rdoc';
