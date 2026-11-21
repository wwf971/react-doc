import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins/rehype-code';
import { nodeIsNoText } from './rehype-list-item.js';

// The views of a fenced code block
// (doc_page_impl_mdx_code.md#the-views-of-a-code-block).
//
// A fenced block is drawn in one of several views, ways of display of the
// same lines:
//
//   card    the block as a card: its own background, rounded corners, room
//           around its lines, lines as tight as code
//   plain   the lines where plain text would stand: a thin frame, no
//           background, lines as high as the text around them
//   icon    the block as a small chip (its title or language, its number of
//           lines): the lines are shown in a dialog when the chip is clicked
//
// Which one, in order:
//   1. the view its author wrote in the info of the fence:  ```text view=plain
//   2. the config of the document, by where the block stands (its place,
//      codeViewConfigKeyGet): CodeBlockView for a block of the document,
//      CodeBlockViewAsListItem for a block that is a list item (the whole
//      text of the item: an item whose line breaks are kept), and
//      CodeBlockViewInListItem for a block in the text of a list item among
//      other things
//
// This file is the compile side of it: the info string read (codeMetaParse,
// the parseMetaString of rehypeCode) and the place of a block marked
// (rehypeCodePlace). The component of a block decides with them
// (built-in/comp-mdx/text/CodeFence.jsx).
export const CODE_VIEW_LIST = ['card', 'plain', 'icon'];
// the places of a block, as far as how it is drawn depends on them (a block
// of the document has none): the whole text of a list item, or in the text of
// a list item among other things (text, other blocks)
export const CODE_PLACE_LIST_ITEM = 'listItem';
export const CODE_PLACE_IN_LIST_ITEM = 'inListItem';

// the config key giving the view of a block that names none, by its place
export function codeViewConfigKeyGet(place) {
  if (place === CODE_PLACE_LIST_ITEM) return 'CodeBlockViewAsListItem';
  if (place === CODE_PLACE_IN_LIST_ITEM) return 'CodeBlockViewInListItem';
  return 'CodeBlockView';
}

const metaParseDefault = rehypeCodeDefaultOptions.parseMetaString;

// the language of a block as data-language of its <pre>: a view draws a
// block of text (language text) in the type of the text around it, and
// code in the code font
const codeLanguageTransformer = {
  name: 'doc-page:code-language',
  pre(node) {
    node.properties['data-language'] = String(this.options.lang ?? '');
  },
};

// the transformers of rehypeCode: those of the page's code blocks, and the language
export const codeTransformerList = [...(rehypeCodeDefaultOptions.transformers ?? []), codeLanguageTransformer];

// view=plain, view="plain", view='plain' as a word of its own in the info string
const REGEX_META_VIEW = /(?<=^|\s)view=(?:"([^"]*)"|'([^']*)'|([\w-]+))(?=\s|$)/g;

// ---------- the info string, read and written ----------
// the info string of a fence: its language, then attributes (title="…",
// view=…). the page reads the view of a block from it and writes it there
// when the view is changed from the page (doc_page_impl_mdx_code.md#changing-the-view-from-the-page)

// the view written in an info string, '' when none (or one the page does not have)
export function codeInfoViewGet(info) {
  let view = '';
  String(info ?? '').replace(REGEX_META_VIEW, (match, valueDouble, valueSingle, valueBare) => {
    view = valueDouble ?? valueSingle ?? valueBare;
    return match;
  });
  return CODE_VIEW_LIST.includes(view) ? view : '';
}

// the info string with its view replaced; view '' removes it (the place decides)
export function codeInfoViewSet(info, view) {
  const infoRest = String(info ?? '').replace(REGEX_META_VIEW, '').replace(/\s+/g, ' ').trim();
  if (!view) return infoRest;
  return infoRest ? `${infoRest} view=${view}` : `view=${view}`;
}

// the language of an info string: its first word ('' for none)
export function codeInfoLangGet(info) {
  const word = String(info ?? '').trim().split(/\s+/)[0] ?? '';
  return word.includes('=') ? '' : word;
}

// the info string with its language replaced (the first word), its attributes
// kept. a language is one word without backticks; none is written as text when
// attributes follow, since the first word of an info string is the language
export function codeInfoLangSet(info, lang) {
  const text = String(info ?? '').trim();
  const langOld = codeInfoLangGet(text);
  const rest = (langOld ? text.slice(langOld.length) : text).trim();
  const langNew = codeLangNormalize(lang) || (rest ? 'text' : '');
  return [langNew, rest].filter(Boolean).join(' ');
}

// a language as an info string can hold it: its first word, without backticks
// or tildes, which would end a fence
export function codeLangNormalize(lang) {
  return (String(lang ?? '').trim().split(/\s+/)[0] ?? '').replace(/[`~]/g, '');
}

// title="…" (or title='…', title=word) of an info string, '' when none
export function codeInfoTitleGet(info) {
  const match = /(?<=^|\s)title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(String(info ?? ''));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

// the line of a fence in the document, put into its info string by
// rehypeCodeLine (never written by an author): a word of its own
const REGEX_META_LINE = /(?<=^|\s)__line=(\d+)(?=\s|$)/g;

// the attributes of the info string of a fence, as properties of its <pre>:
// those of the page's code blocks (title, lineNumbers, ...) and view. a view
// the page does not have is ignored: the block takes the view of its place.
// the line of the fence (rehypeCodeLine) becomes data-source-line
export function codeMetaParse(meta, ...rest) {
  let view;
  let line;
  const metaRest = String(meta ?? '')
    .replace(REGEX_META_LINE, (match, value) => {
      line = value;
      return '';
    })
    .replace(REGEX_META_VIEW, (match, valueDouble, valueSingle, valueBare) => {
      view = valueDouble ?? valueSingle ?? valueBare;
      return '';
    })
    .trim();
  const data = metaParseDefault ? metaParseDefault(metaRest, ...rest) : { __raw: metaRest };
  if (CODE_VIEW_LIST.includes(view)) data['data-view'] = view;
  if (line) data['data-source-line'] = line;
  return data;
}

// before rehypeCode: the line where each fence starts (counted in the content
// without the frontmatter, as the line of a component block is) goes into its
// info string, which rehypeCode hands to codeMetaParse; the block can then be
// found in the source, from reading mode as well (its lines edited in the
// dialog of the icon view, doc_page_impl_mdx_code.md#editing-the-lines)
export function rehypeCodeLine() {
  const walk = (node) => {
    if (node.type === 'element' && node.tagName === 'pre') {
      const code = (node.children ?? []).find((child) => child.type === 'element' && child.tagName === 'code');
      const line = node.position?.start?.line;
      if (code && Number.isInteger(line)) {
        const meta = String(code.data?.meta ?? '').trim();
        code.data = { ...(code.data ?? {}), meta: meta ? `${meta} __line=${line}` : `__line=${line}` };
      }
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  return (tree) => walk(tree);
}

// marks the place of a code block of a list item: data-place="listItem" when
// the block is the whole text of the item (nothing stands before it in the
// item and nothing but the lists under the item after it),
// data-place="inListItem" when it stands in the text of the item among other
// things (the command of a step, under its text). a block inside a component
// of an item is not marked. after rehypeCode, which replaces the <pre> it
// highlights (by a root that holds the new one).
export function rehypeCodePlace() {
  // the children of an element, with the children of the roots among them
  const childListGet = (node) => (node.children ?? []).flatMap((child) => (child.type === 'root' ? childListGet(child) : [child]));
  const isList = (node) => node.type === 'element' && (node.tagName === 'ul' || node.tagName === 'ol');
  const walk = (node) => {
    if (node.type === 'element' && node.tagName === 'li') {
      const childList = childListGet(node).filter((child) => !nodeIsNoText(child));
      const [first, ...restList] = childList;
      if (first?.type === 'element' && first.tagName === 'pre' && restList.every(isList)) {
        first.properties = { ...first.properties, 'data-place': CODE_PLACE_LIST_ITEM };
      } else {
        for (const child of childList) {
          if (child.type === 'element' && child.tagName === 'pre') child.properties = { ...child.properties, 'data-place': CODE_PLACE_IN_LIST_ITEM };
        }
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  return (tree) => walk(tree);
}
