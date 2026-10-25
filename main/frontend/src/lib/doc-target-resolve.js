import {
  sourcePathDirGet,
  sourcePathDocPageAliasGet,
  sourcePathFullGet,
  sourcePathIsRooted,
  sourcePathLocalGet,
  sourcePathNormalize,
  sourcePathParse,
  sourcePathRelativeResolve,
} from './doc-source-path.js';

// Resolves an authored document target against the collected source.
// Shared by DocSourceStore (runtime), page-tree.js (side-panel items) and
// the build-time dependency discovery, so a target retained at build time
// is the target the page opens at runtime. Design: doc_page_impl_nav.md#link-recognition-and-target-resolution
//
// target forms (the path grammar is in doc-source-path.js):
//   ~page:root/a.md  full source path, exact
//   ~root/a.md       local source path: the root of the doc page the target
//                    is written in (docPageAlias, or the doc page of
//                    fromPath); failing that, that root in any doc page
//   ./a.md, ../a.md  relative to fromPath
//   xx/a.md          suffix match on the source path
//   a.md             lookup by file name (may give multiple candidates)
// a "#place" suffix is split off as hash.
//
// the local doc page is always preferred: when a suffix or a name matches
// files of the local doc page and of other doc pages, only the local ones
// are candidates. isLocalFirst: false keeps every match (the build-time
// scan retains them all).
//
// sourceIndex: { entryList, entryByInternalPath, entryListByLocalPath, entryListByName }
//   entries only need { internalPath, name } (docPageAlias is read from internalPath).
//
// options.docPageAlias: the doc page the target is written in, when fromPath
// does not say (a side-panel item, a config value); fromPath wins when given.

export function docTargetResolve(target, fromPath, sourceIndex, options = {}) {
  const value = String(target ?? '');
  const indexHash = value.indexOf('#');
  const hash = indexHash >= 0 ? value.slice(indexHash + 1) : '';
  const filePart = indexHash >= 0 ? value.slice(0, indexHash) : value;
  if (filePart === '') return { entryList: [], hash, docPageAlias: '' };
  const docPageAlias = sourcePathDocPageAliasGet(fromPath) || String(options.docPageAlias ?? '');
  const isLocalFirst = options.isLocalFirst !== false;

  let entryList;
  if (sourcePathIsRooted(filePart)) {
    entryList = sourceRootedResolve(sourcePathNormalize(filePart), docPageAlias, sourceIndex);
  } else if (filePart.startsWith('./') || filePart.startsWith('../')) {
    const pathResolved = sourcePathRelativeResolve(sourcePathDirGet(String(fromPath ?? '')), filePart);
    entryList = sourceRootedResolve(pathResolved, docPageAlias, sourceIndex);
  } else if (filePart.includes('/')) {
    const suffix = '/' + filePart.replace(/^\.\//, '');
    const matchList = sourceIndex.entryList.filter((entry) => entry.internalPath.endsWith(suffix));
    entryList = isLocalFirst ? entryListLocalFirst(matchList, docPageAlias) : matchList;
  } else {
    const matchList = sourceIndex.entryListByName.get(filePart) ?? [];
    entryList = isLocalFirst ? entryListLocalFirst(matchList, docPageAlias) : matchList;
  }
  return { entryList, hash, docPageAlias };
}

// a rooted path: the full form exactly; the local form in the doc page
// given, else in any doc page that has such a root (several: candidates)
function sourceRootedResolve(pathRooted, docPageAlias, sourceIndex) {
  const parsed = sourcePathParse(pathRooted);
  if (!parsed) return [];
  if (parsed.docPageAlias !== '') {
    const entry = sourceIndex.entryByInternalPath.get(pathRooted);
    return entry ? [entry] : [];
  }
  if (docPageAlias) {
    const entryLocal = sourceIndex.entryByInternalPath.get(sourcePathFullGet(pathRooted, docPageAlias));
    if (entryLocal) return [entryLocal];
  }
  return sourceIndex.entryListByLocalPath?.get(pathRooted) ?? [];
}

// the entries of the local doc page when there are any, else all of them
export function entryListLocalFirst(entryList, docPageAlias) {
  if (!docPageAlias || entryList.length < 2) return entryList;
  const entryListLocal = entryList.filter((entry) => sourcePathDocPageAliasGet(entry.internalPath) === docPageAlias);
  return entryListLocal.length > 0 ? entryListLocal : entryList;
}

export function sourceIndexBuild(entryList) {
  const entryByInternalPath = new Map();
  const entryListByLocalPath = new Map();
  const entryListByName = new Map();
  for (const entry of entryList) {
    entryByInternalPath.set(entry.internalPath, entry);
    const pathLocal = sourcePathLocalGet(entry.internalPath);
    const listByLocalPath = entryListByLocalPath.get(pathLocal) ?? [];
    listByLocalPath.push(entry);
    entryListByLocalPath.set(pathLocal, listByLocalPath);
    const listByName = entryListByName.get(entry.name) ?? [];
    listByName.push(entry);
    entryListByName.set(entry.name, listByName);
  }
  return { entryList, entryByInternalPath, entryListByLocalPath, entryListByName };
}
