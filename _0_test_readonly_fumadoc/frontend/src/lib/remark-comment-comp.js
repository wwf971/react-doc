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
// a plain markdown renderer ignores the comment and shows the block as-is,
// which is exactly the intended degradation.
//
// note: html comments only exist in md-format parsing. in .mdx, authors write
// <Comp .../> directly.

const REGEX_RENDER_COMP = /^<!--\s*renderComp=([\w\/-]+)((?:\s*,\s*[\w-]+=[^,]*)*)\s*-->$/;

export function remarkCommentComp(options = {}) {
  return (tree, file) => {
    const sourceText = String(file.value);

    visit(tree, 'html', (node, index, parent) => {
      const match = REGEX_RENDER_COMP.exec(node.value.trim());
      if (!match) return;
      if (node.data?.isMultiLangHeadingMarker) return;

      const nodeMarked = parent.children[index + 1];
      if (!nodeMarked) return;

      const compName = match[1];
      const props = parseProps(match[2]);
      const raw =
        nodeMarked.type === 'code'
          ? nodeMarked.value
          : sliceBySourcePosition(sourceText, nodeMarked);
      options.onComponent?.({ compName, props, raw });
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

// ",a=b,c=d" -> { a: 'b', c: 'd' }
function parseProps(text) {
  const result = {};
  for (const part of text.split(',')) {
    const partTrimmed = part.trim();
    if (partTrimmed === '') continue;
    const indexEq = partTrimmed.indexOf('=');
    if (indexEq < 0) continue;
    result[partTrimmed.slice(0, indexEq).trim()] = partTrimmed.slice(indexEq + 1).trim();
  }
  return result;
}

function sliceBySourcePosition(sourceText, node) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined) return '';
  return sourceText.slice(start, end);
}
