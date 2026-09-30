// How an authored link is read. Shared by the runtime transform
// (remark-doc-link.js) and the build-time dependency discovery
// (plugin/doc-source-dependency.ts), so both classify a link the same way.
// The rules are pure string checks: no store, no React, no file system.
//
//   [text](https://x.com)       external   -> native anchor
//   [text](#place)              fragment   -> native anchor
//   [text](a.md)                local      -> DocLink
//   [text](a.ps1 "inline-link") local      -> SourceLink, source popup
//   `a.md`                      doc file in inline code -> DocLink
//   [[a.md]]                    wiki link in text       -> DocLink

const REGEX_DOC_FILE = /^(?:\.{0,2}\/)?[\w@%+ .\/-]*\.(?:md|mdx)(?:#[^\s]*)?$/i;
const REGEX_WIKI_LINK = /\[\[([^\[\]]+)\]\]/g;

export function linkUrlIsExternal(url) {
  const value = String(url ?? '');
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

export function linkUrlIsFragment(url) {
  return String(url ?? '').startsWith('#');
}

// a local link points into the collected source
export function linkUrlIsLocal(url) {
  const value = String(url ?? '');
  return value !== '' && !linkUrlIsExternal(value) && !linkUrlIsFragment(value);
}

// exact, case-sensitive markers only; any other title keeps DocLink behavior.
//   'inline-link' | 'inline-link:source' -> 'source'
//   'inline-link:render'                 -> 'render'
export function inlineLinkDisplayModeGet(title) {
  if (title === 'inline-link' || title === 'inline-link:source') return 'source';
  if (title === 'inline-link:render') return 'render';
  return '';
}

// exact, case-sensitive markers only; any other title is ignored.
export function linkTagsDisplayGet(title) {
  if (title === 'tags:before') return 'before';
  if (title === 'tags:after') return 'after';
  if (title === 'tags:on') return 'on';
  if (title === 'tags:off') return 'off';
  return '';
}

export function inlineCodeIsDocTarget(value) {
  return REGEX_DOC_FILE.test(String(value ?? ''));
}

// "see [[a.md]] and [[b.md]]" ->
//   [{ text: 'see ' }, { target: 'a.md' }, { text: ' and ' }, { target: 'b.md' }]
// returns [] when the text contains no wiki link.
export function wikiTextSplit(value) {
  const text = String(value ?? '');
  const partList = [];
  let indexLast = 0;
  REGEX_WIKI_LINK.lastIndex = 0;
  let match;
  while ((match = REGEX_WIKI_LINK.exec(text)) !== null) {
    if (match.index > indexLast) partList.push({ text: text.slice(indexLast, match.index) });
    partList.push({ target: match[1] });
    indexLast = match.index + match[0].length;
  }
  if (partList.length === 0) return [];
  if (indexLast < text.length) partList.push({ text: text.slice(indexLast) });
  return partList;
}
