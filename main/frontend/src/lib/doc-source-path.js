// The path grammar of the doc page source. Design: doc_page_impl_source.md#source-paths
//
// every collected file has one source path, which names it everywhere (the
// manifest, links, side-panel items, tag and config rules, image sources,
// asset dependencies, the edit and source apis, the browser url). a source
// path has two forms:
//
//   ~root/dir/file.md          local form: a root of the doc page the
//                              reference is written in
//   ~page:root/dir/file.md     full form: a root of the doc page aliased
//                              "page" in the workspace; unique in the
//                              workspace, the internal identity of a file
//
// the first segment is the root: "~", optionally a doc page alias and ":",
// then the alias of the root (the add rule that collected the file names
// it, or the folder name stands in). a root is a mount point, not a
// directory of the file system, so its segment carries the mark and never
// looks like a folder name. the rest is the path inside that root, with "/"
// as the separator. a folder of the source is written the same way:
// ~root/dir; the root itself is ~root (or ~page:root).
//
// an alias (of a root or of a doc page) is one word: letters, digits, "_",
// "-" and "."; never "/", ":", "~", "#" or whitespace (sourceAliasIsValid).
//
// other spellings a reference may use are relative:
//   ./a.md, ../a.md   relative to the directory of the referencing document
//   dir/a.md          a suffix of a source path (one match expected)
//   a.md              a file name (several matches possible)
// how each kind resolves, and how the local form finds its doc page, is in
// doc-target-resolve.js; this module only knows the shape of a source path.
//
// shared by the vite plugin (node) and the page (browser): no imports.

export const SOURCE_ROOT_MARK = '~';
export const SOURCE_DOC_PAGE_SEPARATOR = ':';

const aliasRegex = /^[A-Za-z0-9_.-]+$/;

// an alias of a root or of a doc page is one word
export function sourceAliasIsValid(value) {
  return aliasRegex.test(String(value ?? ''));
}

// '~root/relPath', or '~root' for a root itself (relPath ''); with a doc
// page alias, the full form '~page:root/relPath'
export function sourcePathBuild(rootAlias, relPath = '', docPageAlias = '') {
  const relSlash = String(relPath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const segRoot = docPageAlias ? `${docPageAlias}${SOURCE_DOC_PAGE_SEPARATOR}${rootAlias}` : String(rootAlias);
  return relSlash ? `${SOURCE_ROOT_MARK}${segRoot}/${relSlash}` : `${SOURCE_ROOT_MARK}${segRoot}`;
}

// a path that names a root: starts with the mark and a non-empty root segment
export function sourcePathIsRooted(value) {
  const text = String(value ?? '');
  return text.length > 1 && text.startsWith(SOURCE_ROOT_MARK) && text[1] !== '/';
}

// a rooted path in the full form: its root segment names a doc page
export function sourcePathIsFull(value) {
  const parsed = sourcePathParse(value);
  return parsed !== undefined && parsed.docPageAlias !== '';
}

// { docPageAlias, rootAlias, relPath } of a rooted path, undefined for
// anything else; docPageAlias is '' for the local form
export function sourcePathParse(value) {
  if (!sourcePathIsRooted(value)) return undefined;
  const text = sourcePathNormalize(value);
  const indexSlash = text.indexOf('/');
  const segRoot = indexSlash < 0 ? text.slice(1) : text.slice(1, indexSlash);
  const relPath = indexSlash < 0 ? '' : text.slice(indexSlash + 1);
  const indexSeparator = segRoot.indexOf(SOURCE_DOC_PAGE_SEPARATOR);
  if (indexSeparator < 0) return { docPageAlias: '', rootAlias: segRoot, relPath };
  return { docPageAlias: segRoot.slice(0, indexSeparator), rootAlias: segRoot.slice(indexSeparator + 1), relPath };
}

// backslashes become slashes, repeated and trailing slashes go
export function sourcePathNormalize(value) {
  const text = String(value ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return text.length > 1 ? text.replace(/\/$/, '') : text;
}

// the doc page alias of a full path, '' for a local path or anything else
export function sourcePathDocPageAliasGet(value) {
  return sourcePathParse(value)?.docPageAlias ?? '';
}

// the local form of a rooted path: '~root/rel' for '~page:root/rel'; a
// local path and any other text are returned as they are
export function sourcePathLocalGet(value) {
  const parsed = sourcePathParse(value);
  if (!parsed) return String(value ?? '');
  return sourcePathBuild(parsed.rootAlias, parsed.relPath);
}

// a local path written in the full form of a doc page: '~root/rel' with
// docPageAlias 'page' -> '~page:root/rel'. a full path keeps its own doc
// page; a text that is not rooted is returned as it is
export function sourcePathFullGet(value, docPageAlias) {
  const parsed = sourcePathParse(value);
  if (!parsed) return String(value ?? '');
  return sourcePathBuild(parsed.rootAlias, parsed.relPath, parsed.docPageAlias || docPageAlias || '');
}

// the root segment of a path as a path: '~page:root' for '~page:root/a/b'
export function sourcePathRootGet(value) {
  const parsed = sourcePathParse(value);
  return parsed ? sourcePathBuild(parsed.rootAlias, '', parsed.docPageAlias) : '';
}

// a glob over source paths written in a doc page, in the full form of that
// doc page: '~root/sub/**' -> '~page:root/sub/**'. a pattern that already
// names a doc page, or does not start with the mark, is returned as it is
export function sourcePathPatternFullGet(pattern, docPageAlias) {
  const text = String(pattern ?? '');
  if (!text.startsWith(SOURCE_ROOT_MARK) || !docPageAlias) return text;
  const indexSlash = text.indexOf('/');
  const segRoot = indexSlash < 0 ? text.slice(1) : text.slice(1, indexSlash);
  if (segRoot === '' || segRoot.includes(SOURCE_DOC_PAGE_SEPARATOR)) return text;
  return `${SOURCE_ROOT_MARK}${docPageAlias}${SOURCE_DOC_PAGE_SEPARATOR}${text.slice(1)}`;
}

// the directory of a source path: '~root/dir' for '~root/dir/a.md', '~root'
// for '~root/a.md', and '' when the path has no directory
export function sourcePathDirGet(value) {
  const text = sourcePathNormalize(value);
  const index = text.lastIndexOf('/');
  return index < 0 ? '' : text.slice(0, index);
}

export function sourcePathNameGet(value) {
  const text = sourcePathNormalize(value);
  const index = text.lastIndexOf('/');
  return index < 0 ? text : text.slice(index + 1);
}

// './b.md' or '../x/b.md' resolved against the directory of a source path.
// ".." never leaves the root: '~root' (or '~page:root') stays the first segment.
export function sourcePathRelativeResolve(dirPath, relPath) {
  const segList = sourcePathNormalize(dirPath).split('/').filter(Boolean);
  const segRoot = segList.length > 0 && segList[0].startsWith(SOURCE_ROOT_MARK) ? segList.shift() : undefined;
  for (const seg of String(relPath ?? '').replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segList.pop();
    else segList.push(seg);
  }
  const rest = segList.join('/');
  if (segRoot === undefined) return rest;
  return rest ? `${segRoot}/${rest}` : segRoot;
}

// the folders a path is inside, outermost first: '~a', '~a/b' for '~a/b/c'
export function sourcePathAncestorListGet(value) {
  const segList = sourcePathNormalize(value).split('/').filter(Boolean);
  return segList.slice(0, -1).map((_, index) => segList.slice(0, index + 1).join('/'));
}

// the path is the folder, or lies inside it; both are compared as written
// (a local folder and a full path never match: name the folder in the form
// the paths have)
export function sourcePathIsInside(value, folderPath) {
  const text = sourcePathNormalize(value);
  const folder = sourcePathNormalize(folderPath);
  return text === folder || text.startsWith(`${folder}/`);
}

// a relative spelling relative to a document, written as the source path of
// that file: './x.png' from '~root/doc/a.md' -> '~root/doc/x.png'. a rooted
// path is returned normalized, in the full form when the document's path
// gives a doc page; a spelling that is neither (a suffix, a name) is
// returned as is, since it needs the collected source to resolve.
export function sourcePathFromRelative(value, fromPath) {
  const text = String(value ?? '').trim().replace(/\\/g, '/');
  if (sourcePathIsRooted(text)) return sourcePathFullGet(sourcePathNormalize(text), sourcePathDocPageAliasGet(fromPath));
  if (text.startsWith('./') || text.startsWith('../')) {
    return sourcePathRelativeResolve(sourcePathDirGet(fromPath), text);
  }
  return text;
}
