import {
  sourcePathDirGet,
  sourcePathDocPageAliasGet,
  sourcePathFullGet,
  sourcePathIsRooted,
  sourcePathLocalGet,
  sourcePathNormalize,
  sourcePathParse,
  sourcePathRelativeResolve,
  sourceRootObjectParse,
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
//   ~${frontend.id:x}/a.md, ~${frontend.name:x}/a.md, ~${frontend:x}/a.md
//                    a document an object registered: by the id of the object, by its
//                    name, or by either (an id first, then a name). of several objects
//                    answering, the first, said in the result's warning. none: no entry
// a "#place" suffix is split off as hash, and before it a "?key=value&..." query as
// param: what the link asks of whoever shows the target (nav=page | popup | owner,
// doc_page_impl_nav.md#routing-a-navigation).
//
// the local doc page is always preferred: when a suffix or a name matches
// files of the local doc page and of other doc pages, only the local ones
// are candidates. isLocalFirst: false keeps every match (the build-time
// scan retains them all).
//
// sourceIndex: { entryList, entryByInternalPath, entryListByLocalPath, entryListByName, rootObjectList }
//   rootObjectList: [{ namespace, id, name, rootAlias, docPageAlias }], the object roots (rootAlias: by id)
//   entries only need { internalPath, name } (docPageAlias is read from internalPath).
//
// options.docPageAlias: the doc page the target is written in, when fromPath
// does not say (a side-panel item, a config value); fromPath wins when given.

export function docTargetResolve(target, fromPath, sourceIndex, options = {}) {
  const value = String(target ?? '');
  const indexHash = value.indexOf('#');
  const hash = indexHash >= 0 ? value.slice(indexHash + 1) : '';
  const pathPart = indexHash >= 0 ? value.slice(0, indexHash) : value;
  const { filePart, param } = targetQuerySplit(pathPart);
  if (filePart === '') return { entryList: [], hash, docPageAlias: '', param };
  const docPageAlias = sourcePathDocPageAliasGet(fromPath) || String(options.docPageAlias ?? '');
  const isLocalFirst = options.isLocalFirst !== false;

  let entryList;
  let warning = '';
  if (sourcePathIsRooted(filePart)) {
    ({ entryList, warning } = sourceRootedResolve(sourcePathNormalize(filePart), docPageAlias, sourceIndex));
  } else if (filePart.startsWith('./') || filePart.startsWith('../')) {
    const pathResolved = sourcePathRelativeResolve(sourcePathDirGet(String(fromPath ?? '')), filePart);
    ({ entryList, warning } = sourceRootedResolve(pathResolved, docPageAlias, sourceIndex));
  } else if (filePart.includes('/')) {
    const suffix = '/' + filePart.replace(/^\.\//, '');
    const matchList = sourceIndex.entryList.filter((entry) => entry.internalPath.endsWith(suffix));
    entryList = isLocalFirst ? entryListSameRootFirst(entryListLocalFirst(matchList, docPageAlias), fromPath) : matchList;
  } else {
    const matchList = sourceIndex.entryListByName.get(filePart) ?? [];
    entryList = isLocalFirst ? entryListSameRootFirst(entryListLocalFirst(matchList, docPageAlias), fromPath) : matchList;
  }
  return { entryList, hash, docPageAlias, param, ...(warning ? { warning } : {}) };
}

// "a.md?nav=page" -> { filePart: "a.md", param: { nav: "page" } }
export function targetQuerySplit(pathPart) {
  const index = pathPart.indexOf('?');
  if (index < 0) return { filePart: pathPart, param: {} };
  const param = {};
  for (const pair of pathPart.slice(index + 1).split('&')) {
    if (!pair) continue;
    const indexEqual = pair.indexOf('=');
    const key = indexEqual < 0 ? pair : pair.slice(0, indexEqual);
    let valueText = indexEqual < 0 ? '' : pair.slice(indexEqual + 1);
    try { valueText = decodeURIComponent(valueText); } catch { /* kept as written */ }
    param[key] = valueText;
  }
  return { filePart: pathPart.slice(0, index), param };
}

// a document written in an object (fromPath in an object root) names its neighbours first: of
// several matches of a suffix or a name, those of the same root when there are any
function entryListSameRootFirst(entryList, fromPath) {
  if (entryList.length < 2) return entryList;
  const from = sourcePathParse(String(fromPath ?? ''));
  if (!from || !sourceRootObjectParse(from.rootAlias)) return entryList;
  const listSame = entryList.filter((entry) => {
    const parsed = sourcePathParse(entry.internalPath);
    return parsed && parsed.rootAlias === from.rootAlias && parsed.docPageAlias === from.docPageAlias;
  });
  return listSame.length > 0 ? listSame : entryList;
}

// the object roots a reference to an object stands for: by its id, by its name, or, when it
// says neither, by its id when an object has it, else by its name
export function sourceRootObjectListFind(rootObjectList, object, docPageAlias = '') {
  const list = (rootObjectList ?? []).filter((root) => root.namespace === object.namespace && (!docPageAlias || root.docPageAlias === docPageAlias));
  const listById = list.filter((root) => root.id === object.ref);
  const listByName = list.filter((root) => root.name === object.ref);
  if (object.by === 'id') return listById;
  if (object.by === 'name') return listByName;
  return listById.length > 0 ? listById : listByName;
}

// an object root as written, as the root of the object it names (by its id):
// { path, warning } (warning when several objects answer); the path as it is when none does
function sourceRootObjectNameResolve(pathRooted, parsed, sourceIndex) {
  const object = sourceRootObjectParse(parsed.rootAlias);
  if (!object) return { path: pathRooted, warning: '' };
  const rootList = sourceRootObjectListFind(sourceIndex.rootObjectList, object, parsed.docPageAlias);
  if (rootList.length === 0) return { path: pathRooted, warning: '' };
  const root = rootList[0];
  const path = sourcePathFullGet(`~${root.rootAlias}${parsed.relPath ? `/${parsed.relPath}` : ''}`, root.docPageAlias);
  return { path, warning: rootList.length > 1 ? `${rootList.length} objects answer to ${parsed.rootAlias}: it names the first, ${root.rootAlias}` : '' };
}

// a rooted path: the full form exactly; the local form in the doc page
// given, else in any doc page that has such a root (several: candidates)
function sourceRootedResolve(pathWritten, docPageAlias, sourceIndex) {
  const parsedWritten = sourcePathParse(pathWritten);
  if (!parsedWritten) return { entryList: [], warning: '' };
  const { path: pathRooted, warning } = sourceRootObjectNameResolve(pathWritten, parsedWritten, sourceIndex);
  const parsed = sourcePathParse(pathRooted);
  if (parsed.docPageAlias !== '') {
    const entry = sourceIndex.entryByInternalPath.get(pathRooted);
    return { entryList: entry ? [entry] : [], warning };
  }
  if (docPageAlias) {
    const entryLocal = sourceIndex.entryByInternalPath.get(sourcePathFullGet(pathRooted, docPageAlias));
    if (entryLocal) return { entryList: [entryLocal], warning };
  }
  return { entryList: sourceIndex.entryListByLocalPath?.get(pathRooted) ?? [], warning };
}

// the entries of the local doc page when there are any, else all of them
export function entryListLocalFirst(entryList, docPageAlias) {
  if (!docPageAlias || entryList.length < 2) return entryList;
  const entryListLocal = entryList.filter((entry) => sourcePathDocPageAliasGet(entry.internalPath) === docPageAlias);
  return entryListLocal.length > 0 ? entryListLocal : entryList;
}

// rootObjectList: [{ namespace, id, name, rootAlias, docPageAlias }], the object roots and what each answers to
export function sourceIndexBuild(entryList, rootObjectList = []) {
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
  return { entryList, entryByInternalPath, entryListByLocalPath, entryListByName, rootObjectList };
}
