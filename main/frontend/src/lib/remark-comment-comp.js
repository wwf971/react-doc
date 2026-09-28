import { visit } from 'unist-util-visit';

// graceful-degradation stipulation from the requirement:
//
//   <!--renderComp=StockTable,variant=compact-->
//   ```
//   | Product | Stock |
//   | ...     | ...   |
//   ```
//
// an html comment of form `renderComp=Name,k=v,...` marks its next sibling
// node (code block, table, ...). here that sibling is replaced by
// <DocComp comp="Name" raw="..." propsJson="..."/>, and DocComp looks the
// component up in the registry at render time.
//
// the marker comment may also end a line of text. markdown then parses it as
// the last inline node of that paragraph, and the marked block is the node
// after the paragraph. this is how a component sits inside a list item next
// to its text (doc_page_impl_mdx_li.md):
//
//   - as shown in this image<!--renderComp=Image-->
//     ```yaml
//     src: dog.png
//     ```
//     there is a dog.
//
// inside text, a marker comment directly followed by inline code marks that
// inline code, and becomes an inline component:
//
//   the <!--renderComp=Tag-->`guide` tag
//
// a plain markdown renderer ignores the comment and shows the block or code
// as-is, which is exactly the intended degradation.
//
// note: html comments only exist in md-format parsing. in .mdx, authors write
// <Comp .../> directly.

const REGEX_RENDER_COMP = /^<!--\s*renderComp=([\w\/-]+)([\s\S]*?)\s*-->$/;

export function remarkCommentComp(options = {}) {
  return (tree, file) => {
    const sourceText = String(file.value);

    visit(tree, 'paragraph', (node, index, parent) => {
      const isLifted = markerAtParagraphEndLift(node, index, parent);
      if (!isLifted) return undefined;
      // the paragraph may be gone; continue with the lifted comment
      return node.children.length === 0 ? index : index + 1;
    });

    visit(tree, 'html', (node, index, parent) => {
      const match = REGEX_RENDER_COMP.exec(node.value.trim());
      if (!match) return;
      if (node.data?.isMultiLangHeadingMarker) return;

      const nodeMarked = parent.children[index + 1];
      if (!nodeMarked) return;
      const isInline = parent.type === 'paragraph';
      if (isInline && nodeMarked.type !== 'inlineCode') return;

      const compName = match[1];
      const props = parseProps(match[2]);
      const raw =
        nodeMarked.type === 'code' || nodeMarked.type === 'inlineCode'
          ? nodeMarked.value
          : sliceBySourcePosition(sourceText, nodeMarked);
      options.onComponent?.({
        compName,
        lang: nodeMarked.lang ?? '',
        props,
        raw,
        sourceOffset: node.position?.start?.offset,
      });

      if (isInline) {
        // the search index keeps the inline code as plain text
        const nodeReplacement = options.isSearchIndex
          ? { type: 'text', value: raw }
          : {
              type: 'mdxJsxTextElement',
              name: 'DocComp',
              attributes: [
                { type: 'mdxJsxAttribute', name: 'comp', value: compName },
                { type: 'mdxJsxAttribute', name: 'raw', value: raw },
                { type: 'mdxJsxAttribute', name: 'propsJson', value: JSON.stringify(props) },
                { type: 'mdxJsxAttribute', name: 'sourceOffset', value: String(node.position?.start?.offset ?? '') },
                { type: 'mdxJsxAttribute', name: 'isInline', value: 'true' },
              ],
              children: [],
            };
        parent.children.splice(index, 2, nodeReplacement);
        return index + 1;
      }

      let structuredData;
      try {
        structuredData = options.structuredDataGet?.({ compName, props, raw });
      } catch (error) {
        console.warn(`[remark-comment-comp] failed to index component "${compName}":`, error);
      }

      const nodeReplacement = options.isSearchIndex
        ? { type: 'paragraph', children: [] }
        : {
            type: 'mdxJsxFlowElement',
            name: 'DocComp',
            attributes: [
              { type: 'mdxJsxAttribute', name: 'comp', value: compName },
              { type: 'mdxJsxAttribute', name: 'raw', value: raw },
              { type: 'mdxJsxAttribute', name: 'lang', value: nodeMarked.lang ?? '' },
              { type: 'mdxJsxAttribute', name: 'propsJson', value: JSON.stringify(props) },
              { type: 'mdxJsxAttribute', name: 'sourceOffset', value: String(node.position?.start?.offset ?? '') },
            ],
            children: [],
          };
      if (Array.isArray(structuredData?.contents) && structuredData.contents.length > 0) {
        nodeReplacement.data = { structuredData };
      }
      parent.children.splice(index, 2, nodeReplacement);
      return index + 1;
    });
  };
}

// "text<!--renderComp=X-->" followed by a block on the next lines: moves the
// comment out of the paragraph, so it stands directly before that block like
// a comment on its own line. the paragraph is removed when nothing is left.
function markerAtParagraphEndLift(paragraph, index, parent) {
  if (!parent || !parent.children[index + 1]) return false;
  const childList = paragraph.children;
  let indexLast = childList.length - 1;
  while (indexLast >= 0 && childList[indexLast].type === 'text' && childList[indexLast].value.trim() === '') {
    indexLast -= 1;
  }
  const nodeLast = childList[indexLast];
  if (!nodeLast || nodeLast.type !== 'html' || !REGEX_RENDER_COMP.test(nodeLast.value.trim())) return false;

  childList.splice(indexLast);
  const nodeTextLast = childList[childList.length - 1];
  if (nodeTextLast?.type === 'text') nodeTextLast.value = nodeTextLast.value.trimEnd();
  if (childList.length === 0) {
    parent.children.splice(index, 1, nodeLast);
  } else {
    parent.children.splice(index + 1, 0, nodeLast);
  }
  return true;
}

// ",a=b,c=d" -> { a: 'b', c: 'd' }
function parseProps(text) {
  const result = {};
  for (const part of propPartListGet(text)) {
    const partTrimmed = part.trim();
    if (partTrimmed === '') continue;
    const indexEq = partTrimmed.indexOf('=');
    if (indexEq < 0) continue;
    result[partTrimmed.slice(0, indexEq).trim()] = partTrimmed.slice(indexEq + 1).trim();
  }
  return result;
}

function propPartListGet(text) {
  const partList = [];
  let depthSquare = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '[') depthSquare += 1;
    if (text[index] === ']') depthSquare = Math.max(0, depthSquare - 1);
    if (text[index] === ',' && depthSquare === 0) {
      partList.push(text.slice(start, index));
      start = index + 1;
    }
  }
  partList.push(text.slice(start));
  return partList;
}

// a marked node inside a list item (e.g. a table) is indented to the item's
// text column on every line after the first; that indentation is removed so
// the component sees the same raw text as at the top level.
function sliceBySourcePosition(sourceText, node) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined) return '';
  const text = sourceText.slice(start, end);
  const indent = (node.position.start.column ?? 1) - 1;
  if (indent === 0) return text;
  const lineList = text.split('\n');
  const lineListDeindented = lineList.map((line, index) => {
    if (index === 0) return line;
    const spaceCount = line.length - line.trimStart().length;
    return line.slice(Math.min(spaceCount, indent));
  });
  return lineListDeindented.join('\n');
}
