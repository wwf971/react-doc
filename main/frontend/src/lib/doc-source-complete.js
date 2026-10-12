import { sourcePathIsInside, sourcePathIsRooted, sourcePathNormalize, sourcePathParse } from './doc-source-path.js';

// Path completion of the source layer. Design: doc_page_impl_source.md#path-completion
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
//   rootIdList  only paths of these roots (['example']); absent: every root
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
  const rootIdList = Array.isArray(spec?.rootIdList) ? spec.rootIdList.map((rootId) => String(rootId)) : [];
  const dirPath = typeof spec?.dirPath === 'string' && spec.dirPath.trim() !== '' ? sourcePathNormalize(spec.dirPath) : '';
  const isMatch = typeof spec?.isMatch === 'function' ? spec.isMatch : undefined;
  return { kind, extList, rootIdList, dirPath, isMatch };
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
  if (spec.rootIdList.length > 0) {
    const rootId = sourcePathParse(candidate.path)?.rootId ?? '';
    if (!spec.rootIdList.includes(rootId)) return false;
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
