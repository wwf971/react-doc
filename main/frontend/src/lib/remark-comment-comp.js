import { visit } from 'unist-util-visit';
import { anchorCompNameIs } from '../../../comp-mdx/anchor/AnchorData.js';

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
//
// an Anchor marker declares ids for the next node instead of replacing it.
// remarkAnchor handles it before this plugin; pipelines without remarkAnchor
// (search index, build-time dependency scan) must still keep the next node.

const REGEX_RENDER_COMP = /^<!--\s*renderComp=([\w\/-]+)([\s\S]*?)\s*-->$/;
// a whole html block: marker, complete inline code, remaining text of the line
const REGEX_MARKER_FIRST_INLINE = /^(<!--\s*renderComp=[\w\/-]+[\s\S]*?-->)(`+)(?!`)([\s\S]*?[^`]|[^`])\2(?!`)([\s\S]*)$/;

export function remarkCommentComp(options = {}) {
  const processor = this;
  return (tree, file) => {
    const sourceText = String(file.value);

    visit(tree, 'html', (node, index, parent) => {
      if (parent?.type === 'paragraph') return undefined;
      const paragraph = markerFirstInlineSplit(node, processor);
      if (!paragraph) return undefined;
      parent.children.splice(index, 1, paragraph);
      return index + 1;
    });

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
      const compName = match[1];
      if (anchorCompNameIs(compName)) return;

      const nodeMarked = parent.children[index + 1];
      if (!nodeMarked) return;
      const isInline = parent.type === 'paragraph';
      if (isInline && nodeMarked.type !== 'inlineCode') return;

      const props = commentPropsParse(match[2]);
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

// a line that starts with the marker, as in
//   - <!--renderComp=Tag-->`guide` description
// is parsed as one flow html block holding marker, code, and text together.
// it is split into the paragraph [html marker, inlineCode, ...rest] that the
// inline path expects, the shape it has when text comes first. any other html
// block is left alone.
function markerFirstInlineSplit(node, processor) {
  const match = REGEX_MARKER_FIRST_INLINE.exec(node.value.trim());
  if (!match || !REGEX_RENDER_COMP.test(match[1])) return undefined;
  const [, marker, , codeRaw, rest] = match;
  return {
    type: 'paragraph',
    children: [
      { type: 'html', value: marker, position: node.position },
      { type: 'inlineCode', value: inlineCodeValueGet(codeRaw) },
      ...inlineNodeListParse(rest, processor),
    ],
  };
}

// CommonMark: one space on each side is stripped when both are present
function inlineCodeValueGet(codeRaw) {
  const value = codeRaw.replace(/\r?\n/g, ' ');
  const isPadded = value.length > 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '';
  return isPadded ? value.slice(1, -1) : value;
}

// the rest of the line is Markdown text (links, emphasis, ...)
function inlineNodeListParse(text, processor) {
  if (!text) return [];
  const treeRest = typeof processor?.parse === 'function' ? processor.parse(text) : undefined;
  const paragraph = treeRest?.children?.length === 1 ? treeRest.children[0] : undefined;
  if (paragraph?.type !== 'paragraph') return [{ type: 'text', value: text }];
  const isLeadingSpace = /^\s/.test(text);
  const childList = paragraph.children;
  if (isLeadingSpace && childList[0]?.type === 'text') {
    childList[0] = { ...childList[0], value: ` ${childList[0].value}` };
  } else if (isLeadingSpace) {
    childList.unshift({ type: 'text', value: ' ' });
  }
  return childList;
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

// "<!--renderComp=Name,a=b-->" -> { compName: 'Name', props: { a: 'b' } }
// returns undefined for any other html value
export function commentMarkerParse(value) {
  const match = REGEX_RENDER_COMP.exec(String(value ?? '').trim());
  if (!match) return undefined;
  return { compName: match[1], props: commentPropsParse(match[2]) };
}

// ",a=b,c=d" -> { a: 'b', c: 'd' }
// commas inside [...] or {...} belong to the value, so list and inline YAML
// mapping values stay whole:
//   languages=[jp,en]
//   titleComponentProps={label: "Q&A", color: "#0f766e"}
// values are always strings; the component parses them.
export function commentPropsParse(text) {
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
  let depthCurly = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '[') depthSquare += 1;
    if (text[index] === ']') depthSquare = Math.max(0, depthSquare - 1);
    if (text[index] === '{') depthCurly += 1;
    if (text[index] === '}') depthCurly = Math.max(0, depthCurly - 1);
    if (text[index] === ',' && depthSquare === 0 && depthCurly === 0) {
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
