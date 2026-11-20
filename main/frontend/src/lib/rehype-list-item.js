import { visit } from 'unist-util-visit';

// Marks a list item that has no text of its own with the class
// doc-li-textless: an item written as its marker alone, or with nothing but
// a nested list under it.
//
//   -            <li class="doc-li-textless">
//     - rye        <ul><li>rye</li></ul>
//                </li>
//
// A browser gives such an item no line: its marker stands on the line of the
// first item under it ("• • rye"), so two items share a row, and an item
// without anything has whatever height the browser gives an empty element.
// With the class the item gets an empty first line of its own (DocPageMdx.css,
// the lists of a document), like every other item: an outline in which every
// item is a row, which is what the editor of an item is laid over
// (doc_page_impl_edit_structure.md#the-keys-of-an-item).
//
// Not text: white space, a comment (the empty comment the page writes for an
// item without text, doc_page_impl_mdx_li.md#items-written-by-the-page), an
// MDX expression that is only a comment.
export const LIST_ITEM_TEXTLESS_CLASS = 'doc-li-textless';

const REGEX_COMMENT_HTML = /^\s*(<!--[\s\S]*?-->\s*)*$/;
const REGEX_COMMENT_SCRIPT = /^\s*(\/\*[\s\S]*?\*\/\s*)*$/;

export function nodeIsNoText(node) {
  if (node.type === 'comment') return true;
  if (node.type === 'text') return String(node.value ?? '').trim() === '';
  if (node.type === 'raw') return REGEX_COMMENT_HTML.test(String(node.value ?? ''));
  if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') return REGEX_COMMENT_SCRIPT.test(String(node.value ?? ''));
  // a paragraph that holds nothing but such nodes (an item of a loose list)
  if (node.type === 'element' && node.tagName === 'p') return (node.children ?? []).every(nodeIsNoText);
  return false;
}

export function listItemIsTextless(node) {
  const childFirst = (node.children ?? []).find((child) => !nodeIsNoText(child));
  return !childFirst || (childFirst.type === 'element' && (childFirst.tagName === 'ul' || childFirst.tagName === 'ol'));
}

export function rehypeListItemTextless() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'li' || !listItemIsTextless(node)) return;
      const classList = Array.isArray(node.properties?.className) ? node.properties.className : [];
      node.properties = { ...node.properties, className: [...classList, LIST_ITEM_TEXTLESS_CLASS] };
    });
  };
}
