import { sourcePathBuild, sourcePathIsInside, sourcePathIsRooted, sourcePathNormalize, sourcePathParse } from './doc-source-path.js';

// Path completion of the doc page source service layer. Design: doc_page_impl_source.md#path-completion
//
// A source path specification says what a path may name, so completion
// lists the right candidates. It is data: a config key of type sourcePath
// carries one (pathSpec), the location prompt builds one, a component may
// hand one to config.source.pathComplete.
//
//   kind        'dir'   the folders of the source (dirManifest)
//               'file'  the files of the source (fileManifest)
//               'any'   both
//   extList     files only: extensions a file must have, without the dot,
//               case-insensitive (['png', 'svg']); absent: any file
//   rootList    only paths of these roots, each a root alias (['example']: that
//               root of any doc page) or the full path of a root ('~example:example');
//               absent: every root
//   dirPath     only paths inside this folder (a source path); absent: anywhere
//   isMatch     a further rule, for callers in code: (candidate) => boolean
//
// a candidate is { path, kind, entry }: the source path, 'dir' | 'file', and
// the manifest entry it comes from. the list is in manifest order (folders
// before files for 'any').
//
// shared by the store (DocSourceStore.pathComplete) and anything that wants
// to filter the source by a spec without a store; no imports but the grammar.

export const sourcePathKindList = ['dir', 'file', 'any'];

export function sourcePathSpecNormalize(spec) {
  const kind = sourcePathKindList.includes(spec?.kind) ? spec.kind : 'dir';
  const extList = Array.isArray(spec?.extList)
    ? spec.extList.map((ext) => String(ext).toLowerCase().replace(/^\./, '')).filter((ext) => ext !== '')
    : [];
  const rootList = Array.isArray(spec?.rootList) ? spec.rootList.map((root) => String(root)) : [];
  const dirPath = typeof spec?.dirPath === 'string' && spec.dirPath.trim() !== '' ? sourcePathNormalize(spec.dirPath) : '';
  const isMatch = typeof spec?.isMatch === 'function' ? spec.isMatch : undefined;
  return { kind, extList, rootList, dirPath, isMatch };
}

// every candidate the spec allows, before any text is typed
export function sourcePathCandidateListBuild(spec, { fileManifest = [], dirManifest = [] }) {
  const specNormalized = sourcePathSpecNormalize(spec);
  const candidateList = [];
  if (specNormalized.kind === 'dir' || specNormalized.kind === 'any') {
    for (const dir of dirManifest) {
      candidateList.push({ path: dir.internalPath, kind: 'dir', entry: dir });
    }
  }
  if (specNormalized.kind === 'file' || specNormalized.kind === 'any') {
    for (const entry of fileManifest) {
      candidateList.push({ path: entry.internalPath, kind: 'file', entry });
    }
  }
  return candidateList.filter((candidate) => candidateIsAllowed(candidate, specNormalized));
}

function candidateIsAllowed(candidate, spec) {
  if (candidate.kind === 'file' && spec.extList.length > 0) {
    const ext = String(candidate.entry.ext ?? '').toLowerCase();
    if (!spec.extList.includes(ext)) return false;
  }
  if (spec.rootList.length > 0) {
    const parsed = sourcePathParse(candidate.path);
    const rootAlias = parsed?.rootAlias ?? '';
    const rootPath = parsed ? sourcePathBuild(parsed.rootAlias, '', parsed.docPageAlias) : '';
    if (!spec.rootList.includes(rootAlias) && !spec.rootList.includes(rootPath)) return false;
  }
  if (spec.dirPath !== '' && !sourcePathIsInside(candidate.path, spec.dirPath)) return false;
  if (spec.isMatch && !spec.isMatch(candidate)) return false;
  return true;
}

// the candidates that complete what is typed:
//   ''              every candidate
//   a rooted text   the candidates it is a prefix of (~example/mdx finds ~example/mdx-usage)
//   another text    the candidates containing it anywhere, case-insensitive
//                   (image finds ~example/mdx-usage/image)
export function sourcePathCompleteList(text, spec, manifests) {
  const candidateList = sourcePathCandidateListBuild(spec, manifests);
  const typed = sourcePathNormalize(text);
  if (typed === '') return candidateList;
  if (sourcePathIsRooted(typed)) {
    return candidateList.filter((candidate) => candidate.path.startsWith(typed));
  }
  const typedLower = typed.toLowerCase();
  return candidateList.filter((candidate) => candidate.path.toLowerCase().includes(typedLower));
}

// the candidates of a spec as a tree, for browsing instead of typing: one
// node per root (~page:root), the folders below it, the files in them. a folder
// that only leads to candidates (the spec asks for files, or for paths
// inside another folder) is a node too, but cannot be chosen (isDisabled).
// the nodes are the ones of the tree view (comp-doc/source/SourceTreeSelect.jsx):
//   { id: source path, label: last segment, kind: 'dir' | 'file',
//     isDisabled, childList }
// folders before files, each sorted by name.
export function sourcePathTreeBuild(spec, manifests) {
  const candidateList = sourcePathCandidateListBuild(spec, manifests);
  const nodeByPath = new Map();
  const nodeRootList = [];

  const nodeDirEnsure = (path) => {
    const nodeExisting = nodeByPath.get(path);
    if (nodeExisting) return nodeExisting;
    const parsed = sourcePathParse(path);
    const node = {
      id: path,
      label: parsed && parsed.relPath === '' ? path : path.slice(path.lastIndexOf('/') + 1),
      kind: 'dir',
      isDisabled: true,
      childList: [],
    };
    nodeByPath.set(path, node);
    if (!parsed || parsed.relPath === '') {
      nodeRootList.push(node);
    } else {
      const relPathParent = parsed.relPath.includes('/') ? parsed.relPath.slice(0, parsed.relPath.lastIndexOf('/')) : '';
      nodeDirEnsure(sourcePathBuild(parsed.rootAlias, relPathParent, parsed.docPageAlias)).childList.push(node);
    }
    return node;
  };

  for (const candidate of candidateList) {
    if (candidate.kind === 'dir') {
      nodeDirEnsure(candidate.path).isDisabled = false;
      continue;
    }
    const indexSlash = candidate.path.lastIndexOf('/');
    if (indexSlash < 0) continue;
    nodeDirEnsure(candidate.path.slice(0, indexSlash)).childList.push({
      id: candidate.path,
      label: candidate.path.slice(indexSlash + 1),
      kind: 'file',
      isDisabled: false,
      childList: [],
    });
  }

  const nodeListSort = (nodeList) => {
    nodeList.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    for (const node of nodeList) nodeListSort(node.childList);
    return nodeList;
  };
  return nodeListSort(nodeRootList);
}

// Searching a tree for a text (doc_page_impl_source.md#browsing-as-a-tree):
// the nodes whose label holds every word of the text (case-insensitive),
// with the folders that lead to them, so a document can be found by a part
// of its name without opening the folders by hand. any tree of the node
// shape of sourcePathTreeBuild can be searched, not only the source.
//
//   -> { nodeList, idExpandedList, matchCount }
//      nodeList        the tree narrowed to the matches and their ancestors;
//                      every node kept carries labelMatchList, the [start,
//                      end) ranges of its label that a word matched (empty
//                      for an ancestor that only leads to a match)
//      idExpandedList  the ancestors of the matches, to be shown open
//      matchCount      the nodes that match
//
// an empty text matches nothing and returns the tree as it is.
export function sourceTreeSearch(nodeList, text) {
  const wordList = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (wordList.length === 0) return { nodeList, idExpandedList: [], matchCount: 0 };
  const idExpandedList = [];
  let matchCount = 0;
  const visit = (node) => {
    const childList = (node.childList ?? []).map(visit).filter(Boolean);
    const labelMatchList = labelMatchListGet(String(node.label ?? ''), wordList);
    if (labelMatchList.length > 0) matchCount += 1;
    if (labelMatchList.length === 0 && childList.length === 0) return undefined;
    if (childList.length > 0) idExpandedList.push(node.id);
    return { ...node, childList, labelMatchList };
  };
  return { nodeList: nodeList.map(visit).filter(Boolean), idExpandedList, matchCount };
}

// the ranges of a label that the words match, merged and in order; empty
// unless every word occurs in the label
function labelMatchListGet(label, wordList) {
  const labelLower = label.toLowerCase();
  const rangeList = [];
  for (const word of wordList) {
    let index = labelLower.indexOf(word);
    if (index < 0) return [];
    while (index >= 0) {
      rangeList.push([index, index + word.length]);
      index = labelLower.indexOf(word, index + word.length);
    }
  }
  rangeList.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of rangeList) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}
