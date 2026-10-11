// The path grammar of the doc page source. Design: doc_page_impl_source.md
//
// every collected file has one source path, which names it everywhere (the
// manifest, links, side-panel items, tag and config rules, image sources,
// asset dependencies, the edit and source apis, the browser url):
//
//   ~rootId/dir/file.md
//
// the first segment is the root: "~" followed by the rootId of the source
// rule that collected the file (addFolder / addFile). a root is a mount
// point, not a directory of the file system, so its segment carries the
// mark and never looks like a folder name. the rest is the path inside
// that root, with "/" as the separator. a folder of the source is written
// the same way: ~rootId/dir; the root itself is ~rootId.
//
// other spellings a reference may use are relative:
//   ./a.md, ../a.md   relative to the directory of the referencing document
//   dir/a.md          a suffix of a source path (one match expected)
//   a.md              a file name (several matches possible)
// how each kind resolves is in doc-target-resolve.js; this module only
// knows the shape of a source path.
//
// shared by the vite plugin (node) and the page (browser): no imports.

export const SOURCE_ROOT_MARK = '~';

// '~rootId/relPath', or '~rootId' for a root itself (relPath '')
export function sourcePathBuild(rootId, relPath = '') {
  const relSlash = String(relPath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return relSlash ? `${SOURCE_ROOT_MARK}${rootId}/${relSlash}` : `${SOURCE_ROOT_MARK}${rootId}`;
}

// a path that names a root: starts with the mark and a non-empty rootId
export function sourcePathIsRooted(value) {
  const text = String(value ?? '');
  return text.length > 1 && text.startsWith(SOURCE_ROOT_MARK) && text[1] !== '/';
}

// { rootId, relPath } of a rooted path, undefined for anything else
export function sourcePathParse(value) {
  if (!sourcePathIsRooted(value)) return undefined;
  const text = sourcePathNormalize(value);
  const indexSlash = text.indexOf('/');
  if (indexSlash < 0) return { rootId: text.slice(1), relPath: '' };
  return { rootId: text.slice(1, indexSlash), relPath: text.slice(indexSlash + 1) };
}

// backslashes become slashes, repeated and trailing slashes go
export function sourcePathNormalize(value) {
  const text = String(value ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  return text.length > 1 ? text.replace(/\/$/, '') : text;
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
// ".." never leaves the root: '~root' stays the first segment.
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

// the path is the folder, or lies inside it
export function sourcePathIsInside(value, folderPath) {
  const text = sourcePathNormalize(value);
  const folder = sourcePathNormalize(folderPath);
  return text === folder || text.startsWith(`${folder}/`);
}

// a relative spelling relative to a document, written as the source path of
// that file: './x.png' from '~root/doc/a.md' -> '~root/doc/x.png'. a rooted
// path is returned normalized; a spelling that is neither (a suffix, a
// name) is returned as is, since it needs the collected source to resolve.
export function sourcePathFromRelative(value, fromPath) {
  const text = String(value ?? '').trim().replace(/\\/g, '/');
  if (sourcePathIsRooted(text)) return sourcePathNormalize(text);
  if (text.startsWith('./') || text.startsWith('../')) {
    return sourcePathRelativeResolve(sourcePathDirGet(fromPath), text);
  }
  return text;
}
