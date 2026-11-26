// Documents embedded in a block of another document
// (doc_page_impl_mdx_embed.md): the text of an MDX block (the component Mdx)
// is a document of its own, written in the fence of its block. The edit layer
// edits it as any document, under a path of its own that names its host and
// the line of its block; it is read from that fence and written into it.
//
//   ~root/dir/guide.md::embed@14     the block whose marker is at line 14 of
//                                    ~root/dir/guide.md (lines counted without
//                                    the frontmatter, as the line of a block is)
//
// the path keeps the folder of its host, so the relative links and images of
// the embedded text resolve from where the host is.

export const EMBED_PATH_SEPARATOR = '::embed@';

export function embedPathBuild(hostPath, line) {
  return `${hostPath}${EMBED_PATH_SEPARATOR}${line}`;
}

// { hostPath, line } of an embedded document's path, undefined for any other path
export function embedPathParse(path) {
  const text = String(path ?? '');
  const index = text.lastIndexOf(EMBED_PATH_SEPARATOR);
  if (index <= 0) return undefined;
  const line = Number(text.slice(index + EMBED_PATH_SEPARATOR.length));
  if (!Number.isInteger(line) || line < 1) return undefined;
  return { hostPath: text.slice(0, index), line };
}

// A document held by a component rather than written in a fence of a file (the text of an MDX block
// a card of a card diagram holds): its holder registers how it is read and written
// (DocEditStore.heldDocSet), and the edit layer edits it as any document under a path of its own,
// which keeps the folder of the document the holder is drawn in:
//
//   ~root/dir/guide.md::held@card-comp:notes     held by the component whose key is card-comp:notes
export const HELD_PATH_SEPARATOR = '::held@';

export function heldPathBuild(hostPath, key) {
  return `${hostPath}${HELD_PATH_SEPARATOR}${key}`;
}

// { hostPath, key } of a held document's path, undefined for any other path
export function heldPathParse(path) {
  const text = String(path ?? '');
  const index = text.lastIndexOf(HELD_PATH_SEPARATOR);
  if (index <= 0) return undefined;
  const key = text.slice(index + HELD_PATH_SEPARATOR.length);
  return key ? { hostPath: text.slice(0, index), key } : undefined;
}

// the document an embedded or a held document stands in, else the path itself
export function docHostPathGet(path) {
  return embedPathParse(path)?.hostPath ?? heldPathParse(path)?.hostPath ?? path;
}

// the identity of a version of an embedded text (it has no file and no hash
// of the server): FNV-1a of the text, enough to tell two versions apart
// the identity of the text of an embedded document in its history
// (doc_page_impl_edit_history.md#the-popup-of-an-mdx-block): the hash of the text
// without its trailing newlines, which a fence written and read again may add or drop
export function embedHistoryHashGet(text) {
  return embedTextHashGet(String(text ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, ''));
}

export function embedTextHashGet(text) {
  let hash = 0x811c9dc5;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `embed-${hash.toString(16)}-${value.length}`;
}
