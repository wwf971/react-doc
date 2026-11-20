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
//
// Which one, in order:
//   1. the view its author wrote in the info of the fence:  ```text view=plain
//   2. the config of the document, by where the block stands: CodeBlockView,
//      and CodeBlockViewAsListItem for a block that is a list item (the
//      whole text of the item: an item whose line breaks are kept)
//
// This file is the compile side of it: the info string read (codeMetaParse,
// the parseMetaString of rehypeCode) and the place of a block marked
// (rehypeCodePlace). The component of a block decides with them
// (built-in/comp-mdx/text/CodeFence.jsx).
export const CODE_VIEW_LIST = ['card', 'plain'];
export const CODE_PLACE_LIST_ITEM = 'listItem';

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

// the attributes of the info string of a fence, as properties of its <pre>:
// those of the page's code blocks (title, lineNumbers, ...) and view. a view
// the page does not have is ignored: the block takes the view of its place
export function codeMetaParse(meta, ...rest) {
  let view;
  const metaRest = String(meta ?? '').replace(REGEX_META_VIEW, (match, valueDouble, valueSingle, valueBare) => {
    view = valueDouble ?? valueSingle ?? valueBare;
    return '';
  });
  const data = metaParseDefault ? metaParseDefault(metaRest, ...rest) : { __raw: metaRest };
  if (CODE_VIEW_LIST.includes(view)) data['data-view'] = view;
  return data;
}

// marks a code block that is a list item with data-place="listItem": the
// block is the whole text of the item, nothing stands before it in the item
// and nothing but the lists under the item after it. a block under the text
// of an item (the command of a step) is a block of its own and is not marked,
// nor is a block inside a component of an item. after rehypeCode, which
// replaces the <pre> it highlights (by a root that holds the new one).
export function rehypeCodePlace() {
  // the children of an element, with the children of the roots among them
  const childListGet = (node) => (node.children ?? []).flatMap((child) => (child.type === 'root' ? childListGet(child) : [child]));
  const isList = (node) => node.type === 'element' && (node.tagName === 'ul' || node.tagName === 'ol');
  const walk = (node) => {
    if (node.type === 'element' && node.tagName === 'li') {
      const [first, ...restList] = childListGet(node).filter((child) => !nodeIsNoText(child));
      if (first?.type === 'element' && first.tagName === 'pre' && restList.every(isList)) {
        first.properties = { ...first.properties, 'data-place': CODE_PLACE_LIST_ITEM };
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  return (tree) => walk(tree);
}
