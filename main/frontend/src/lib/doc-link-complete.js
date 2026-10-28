import {
  sourcePathDirGet,
  sourcePathDocPageAliasGet,
  sourcePathFullGet,
  sourcePathIsFull,
  sourcePathIsRooted,
  sourcePathLocalGet,
  sourcePathNameGet,
  sourcePathNormalize,
  sourcePathParse,
  sourcePathReferenceGet,
  sourcePathRelativeResolve,
} from './doc-source-path.js';

// Completion of a link target being typed: the documents of the workspace
// a text names, and the Markdown link that points to the one chosen.
// Used by the /link action of the slash mode (comp-doc/link/link-slash.js).
// Design: doc_page_impl_nav.md#writing-a-link, doc_page_impl_edit_slash.md
//
// it reads the same internal representation as link resolution: the
// candidates of the source (DocSourceStore.pathComplete, every document and
// folder by its full source path, with its manifest entry) and the
// document being edited (fromPath, which says the local doc page).
//
//   a word, or words     the documents whose name, title or path hold
//   (guide setup)        every word; the local doc page first, then names
//                        that start with the first word, then the rest
//   a path               ~root/..., ~page:root/..., ./..., ../...: the
//   (~example/mdx-)      documents and folders in the folder it names whose
//                        name starts with the rest, folders first, so the
//                        author walks the tree by choosing folders
//   ...#place            the part after "#" is kept and added to the
//                        target of the chosen document (a heading title or
//                        an Anchor id: doc_page_impl_nav.md#fragment-targets-titles-and-declared-ids)
//
// an item: { id, kind: 'file' | 'dir', path, label, detail, isLocal }
//   path      full source path
//   label     a document: its title (else the file name); a folder: its name
//   detail    the path as it is written from the document: the local form
//             in the local doc page, the full form in another one

export const LINK_DOC_EXT_LIST = ['md', 'mdx'];
const ITEM_COUNT_MAX = 50;

export function linkItemListGet(query, { candidateList = [], fromPath = '' }) {
  const { pathPart } = linkQuerySplit(query);
  const docPageAliasLocal = sourcePathDocPageAliasGet(fromPath);
  const itemBuild = (candidate) => linkItemBuild(candidate, docPageAliasLocal);

  if (linkQueryIsPath(pathPart)) {
    const matchIs = linkPathMatcherBuild(pathPart, fromPath);
    const matchList = candidateList.filter((candidate) => matchIs(candidate.path));
    return matchList
      .map(itemBuild)
      .sort((a, b) => kindOrder(a) - kindOrder(b) || localOrder(a) - localOrder(b) || a.path.localeCompare(b.path))
      .slice(0, ITEM_COUNT_MAX);
  }

  const wordList = pathPart.toLowerCase().split(/\s+/).filter(Boolean);
  const scoreGet = (item) => {
    if (wordList.length === 0) return 0;
    const name = sourcePathNameGet(item.path).toLowerCase();
    const title = item.label.toLowerCase();
    const haystack = `${name}\n${title}\n${sourcePathLocalGet(item.path).toLowerCase()}`;
    if (!wordList.every((word) => haystack.includes(word))) return -1;
    if (name.startsWith(wordList[0]) || title.startsWith(wordList[0])) return 0;
    if (name.includes(wordList[0]) || title.includes(wordList[0])) return 1;
    return 2;
  };
  return candidateList
    .filter((candidate) => candidate.kind === 'file')
    .map((candidate, index) => ({ item: itemBuild(candidate), index }))
    .map((entry) => ({ ...entry, score: scoreGet(entry.item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => localOrder(a.item) - localOrder(b.item) || a.score - b.score || a.index - b.index)
    .slice(0, ITEM_COUNT_MAX)
    .map((entry) => entry.item);
}

// the parameter a chosen folder leaves, so the author goes on below it:
// the folder as written from the document, with a trailing "/"
export function linkDirParamGet(item, query) {
  const { fragment } = linkQuerySplit(query);
  return `${item.detail}/${fragment !== undefined ? `#${fragment}` : ''}`;
}

// the Markdown link to a chosen document, written in the document fromPath:
// [title](target) with the shortest exact target (sourcePathReferenceGet),
// the "#place" of the query kept
export function linkMarkdownBuild(item, query, fromPath) {
  const { fragment } = linkQuerySplit(query);
  const target = `${sourcePathReferenceGet(item.path, fromPath)}${fragment ? `#${fragment}` : ''}`;
  const destination = /[\s()<>]/.test(target) ? `<${target.replace(/[<>]/g, '')}>` : target;
  const text = item.label.replace(/([\\[\]])/g, '\\$1');
  return `[${text}](${destination})`;
}

// the query split at its first "#": the path or the words, and the place
export function linkQuerySplit(query) {
  const text = String(query ?? '');
  const indexHash = text.indexOf('#');
  if (indexHash < 0) return { pathPart: text.trim(), fragment: undefined };
  return { pathPart: text.slice(0, indexHash).trim(), fragment: text.slice(indexHash + 1) };
}

function linkQueryIsPath(text) {
  return sourcePathIsRooted(text) || text.startsWith('./') || text.startsWith('../');
}

// a typed path as a test of full source paths, one folder level at a time
// as in a file picker: the part up to the last "/" names a folder, the
// rest is the start of a name in it ('~example/mdx-' lists what is in
// ~example and starts with "mdx-"). a rooted text without "/" lists roots
function linkPathMatcherBuild(text, fromPath) {
  const indexSlash = text.lastIndexOf('/');
  const tail = text.slice(indexSlash + 1).toLowerCase();
  if (indexSlash < 0) {
    return (path) => {
      const parsed = sourcePathParse(path);
      if (!parsed || parsed.relPath !== '') return false;
      return path.toLowerCase().startsWith(tail) || sourcePathLocalGet(path).toLowerCase().startsWith(tail);
    };
  }
  const dirText = text.slice(0, indexSlash);
  const isRelative = !sourcePathIsRooted(text);
  // a local path is compared in the local form, so it finds that root in
  // every doc page (the local one is listed first)
  const isLocalForm = !isRelative && !sourcePathIsFull(text);
  const dir = isRelative
    ? sourcePathRelativeResolve(sourcePathDirGet(fromPath), dirText || '.')
    : sourcePathNormalize(dirText);
  return (path) => {
    const pathCompared = isLocalForm ? sourcePathLocalGet(path) : path;
    if (!pathCompared.startsWith(`${dir}/`)) return false;
    const rest = pathCompared.slice(dir.length + 1);
    return !rest.includes('/') && rest.toLowerCase().startsWith(tail);
  };
}

function linkItemBuild(candidate, docPageAliasLocal) {
  const docPageAlias = sourcePathDocPageAliasGet(candidate.path);
  const isLocal = docPageAlias === docPageAliasLocal;
  const name = sourcePathNameGet(candidate.path);
  const label = candidate.kind === 'file'
    ? String(candidate.entry?.title || name.replace(/\.(md|mdx)$/i, ''))
    : name || candidate.path;
  return {
    id: candidate.path,
    kind: candidate.kind,
    path: candidate.path,
    label,
    detail: isLocal ? sourcePathLocalGet(candidate.path) : sourcePathFullGet(candidate.path, docPageAlias),
    isLocal,
  };
}

function kindOrder(item) {
  return item.kind === 'dir' ? 0 : 1;
}

function localOrder(item) {
  return item.isLocal ? 0 : 1;
}
