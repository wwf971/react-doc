// Resolves an authored document target against the collected source.
// Shared by DocSourceStore (runtime) and the build-time dependency discovery,
// so a target retained at build time is the target the page opens at runtime.
//
// target forms:
//   /rootId/xx/a.md  exact internal path
//   ./a.md, ../a.md  relative to fromPath
//   xx/a.md          suffix match on internal path
//   a.md             lookup by file name (may give multiple candidates)
// a "#place" suffix is split off as hash.
//
// sourceIndex: { entryList, entryByInternalPath, entryListByName }
//   entries only need { internalPath, name }.

export function docTargetResolve(target, fromPath, sourceIndex) {
  const value = String(target ?? '');
  const indexHash = value.indexOf('#');
  const hash = indexHash >= 0 ? value.slice(indexHash + 1) : '';
  const filePart = indexHash >= 0 ? value.slice(0, indexHash) : value;
  if (filePart === '') return { entryList: [], hash };

  let entryList;
  if (filePart.startsWith('/')) {
    const entry = sourceIndex.entryByInternalPath.get(filePart);
    entryList = entry ? [entry] : [];
  } else if (filePart.startsWith('./') || filePart.startsWith('../')) {
    const pathResolved = pathRelativeResolve(pathDirGet(String(fromPath ?? '')), filePart);
    const entry = sourceIndex.entryByInternalPath.get(pathResolved);
    entryList = entry ? [entry] : [];
  } else if (filePart.includes('/')) {
    entryList = sourceIndex.entryList.filter((entry) => entry.internalPath.endsWith('/' + filePart));
  } else {
    entryList = sourceIndex.entryListByName.get(filePart) ?? [];
  }
  return { entryList, hash };
}

export function sourceIndexBuild(entryList) {
  const entryByInternalPath = new Map();
  const entryListByName = new Map();
  for (const entry of entryList) {
    entryByInternalPath.set(entry.internalPath, entry);
    const listByName = entryListByName.get(entry.name) ?? [];
    listByName.push(entry);
    entryListByName.set(entry.name, listByName);
  }
  return { entryList, entryByInternalPath, entryListByName };
}

function pathDirGet(internalPath) {
  const index = internalPath.lastIndexOf('/');
  return index <= 0 ? '/' : internalPath.slice(0, index);
}

function pathRelativeResolve(baseDir, relPath) {
  const segList = baseDir.split('/').filter(Boolean);
  for (const seg of relPath.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segList.pop();
    else segList.push(seg);
  }
  return '/' + segList.join('/');
}
