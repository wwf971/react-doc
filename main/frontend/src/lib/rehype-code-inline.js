import { visit } from 'unist-util-visit';

// Marks inline code (a <code> that is not inside a <pre>) with the class
// doc-code-inline. Inline code is set in a smaller monospace font; with the
// line height of the text around it, its box reaches out of the line and the
// line gets taller than the other lines of its paragraph. The class gives it
// a line height that stays inside the line (DocPageMdx.css), so every line
// of a paragraph is equally tall, also in the source surface of edit mode,
// which has no inline elements
// (doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule).
export function rehypeCodeInline() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'code' || parent?.tagName === 'pre') return;
      const classList = Array.isArray(node.properties?.className) ? node.properties.className : [];
      node.properties = { ...node.properties, className: [...classList, 'doc-code-inline'] };
    });
  };
}
