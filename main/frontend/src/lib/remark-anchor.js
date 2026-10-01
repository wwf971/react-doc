import { visit } from 'unist-util-visit';
import { anchorAliasListParse, anchorCompNameIs } from '../../../comp-mdx/anchor/AnchorData.js';
import { commentMarkerParse } from './remark-comment-comp.js';

// Gives a place in a document stable fragment ids, so links such as
// `guide.md#configuration` keep working when the title text changes:
//
//   <!--renderComp=Anchor,id=configuration,aliases=[config-old]-->
//   ## Configuration
//
// - followed by a heading: the heading itself receives `id`, so the TOC url
//   uses it too. Each alias becomes an empty Anchor marker before the heading.
//   Aliases must not be heading children: Fumadocs copies heading content
//   into its TOC and breadcrumb, which would duplicate those ids outside the
//   document body.
// - followed by any other node: every id becomes an empty Anchor marker
//   before that node. Navigation highlights the content element after it.
//
// The markers are rendered by the registered Anchor component through DocComp.
// A multilingual heading marker may stand between the Anchor comment and the
// heading; multiLangRemarkHeading removes it first, so this plugin runs after it.
//
// Deprecated form: `<span id="..." />` raw HTML markers before a heading,
// separated from it by a blank line. They are still converted the same way,
// with a deprecation warning.

export function remarkAnchor(options = {}) {
  return (tree) => {
    if (!Array.isArray(tree?.children)) return;
    anchorCommentTransform(tree, options.sourcePath);
    anchorSpanTransform(tree, options.sourcePath);
  };
}

function anchorCommentTransform(tree, sourcePath) {
  visit(tree, 'html', (node, index, parent) => {
    if (!parent || index === undefined) return undefined;
    const marker = commentMarkerParse(node.value);
    if (!marker || !anchorCompNameIs(marker.compName)) return undefined;

    const id = String(marker.props.id ?? '').trim();
    const aliasList = anchorAliasListParse(marker.props.aliases);
    const isInline = parent.type === 'paragraph';
    if (id === '') {
      console.warn(`[react-doc] ${sourcePath || 'document'}: Anchor marker "${node.value.trim()}" has no id.`);
      parent.children.splice(index, 1);
      return index;
    }

    const nodeNext = parent.children[index + 1];
    if (nodeNext?.type === 'heading') {
      headingIdSet(nodeNext, id);
      const nodeAliasList = aliasList.length > 0
        ? [anchorElementBuild(marker.compName, { aliases: aliasList }, isInline)]
        : [];
      parent.children.splice(index, 1, ...nodeAliasList);
      // continue after the heading
      return index + nodeAliasList.length + 1;
    }

    parent.children.splice(index, 1, anchorElementBuild(marker.compName, { id, aliases: aliasList }, isInline));
    return index + 1;
  });
}

function anchorElementBuild(compName, props, isInline) {
  return {
    type: isInline ? 'mdxJsxTextElement' : 'mdxJsxFlowElement',
    name: 'DocComp',
    attributes: [
      { type: 'mdxJsxAttribute', name: 'comp', value: compName },
      { type: 'mdxJsxAttribute', name: 'propsJson', value: JSON.stringify(props) },
      ...(isInline ? [{ type: 'mdxJsxAttribute', name: 'isInline', value: 'true' }] : []),
    ],
    children: [],
  };
}

function headingIdSet(nodeHeading, id) {
  nodeHeading.data = {
    ...nodeHeading.data,
    hProperties: {
      ...nodeHeading.data?.hProperties,
      id,
    },
  };
}

// ---- deprecated <span id> markers ----
//
// Plain Markdown parses `<span id="..." />` as raw HTML, which MDX omits when
// compiling with `format: 'md'`. The marker and the heading must be separated
// by a blank line:
//
//   <span id="configuration" />
//
//   ## Configuration
//
// Without it, Markdown continues the raw HTML block onto the heading line, and
// the heading is omitted together with that block. That case is reported as
// a warning, because it is almost always a missing blank line.

const anchorSpanPattern = /<span\s+id=(['"])([^'"<>\s]+)\1\s*(?:\/>|><\/span>)/gi;
const anchorSpanStartPattern = /^\s*<span\s+id=(['"])[^'"<>\s]+\1/i;
const headingLinePattern = /^ {0,3}#{1,6}(?:\s|$)/;

function anchorSpanTransform(tree, sourcePath) {
  for (const node of tree.children) anchorHeadingSwallowedWarn(node, sourcePath);

  let isSpanFound = false;
  for (let index = 0; index < tree.children.length - 1; index += 1) {
    const nodeAnchor = tree.children[index];
    const nodeHeading = tree.children[index + 1];
    const anchorIdList = anchorSpanIdListGet(nodeAnchor);
    if (anchorIdList.length === 0 || nodeHeading?.type !== 'heading') continue;

    isSpanFound = true;
    headingIdSet(nodeHeading, anchorIdList[0]);
    const nodeAliasList = anchorIdList.slice(1).map(anchorSpanAliasNodeBuild);
    tree.children.splice(index, 1, ...nodeAliasList);
    index += nodeAliasList.length - 1;
  }

  if (isSpanFound) {
    console.warn(
      `[react-doc] ${sourcePath || 'document'}: <span id="..."> heading anchors are deprecated.`
      + ' Put <!--renderComp=Anchor,id=...--> directly before the heading instead.',
    );
  }
}

// returns the swallowed heading line, '' when there is none
export function anchorHeadingSwallowedGet(node) {
  if (node?.type !== 'html') return '';
  const lineList = String(node.value ?? '').split(/\r?\n/);
  if (!anchorSpanStartPattern.test(lineList[0])) return '';
  return lineList.find((line) => headingLinePattern.test(line))?.trim() ?? '';
}

function anchorHeadingSwallowedWarn(node, sourcePath) {
  const lineHeading = anchorHeadingSwallowedGet(node);
  if (!lineHeading) return;
  console.warn(
    `[react-doc] ${sourcePath || 'document'}: heading "${lineHeading}" directly follows a`
    + ' <span id> anchor marker. Without a blank line between them, Markdown reads the'
    + ' heading as part of the raw HTML block and does not render it.'
    + ' <span id> markers are deprecated; use <!--renderComp=Anchor,id=...--> instead.',
  );
}

function anchorSpanIdListGet(node) {
  const raw = anchorSpanRawGet(node).trim();
  if (!raw) return [];
  const idList = [...raw.matchAll(anchorSpanPattern)].map((match) => match[2]);
  anchorSpanPattern.lastIndex = 0;
  if (idList.length === 0 || raw.replace(anchorSpanPattern, '').trim()) {
    anchorSpanPattern.lastIndex = 0;
    return [];
  }
  anchorSpanPattern.lastIndex = 0;
  return [...new Set(idList)];
}

function anchorSpanRawGet(node) {
  if (node?.type === 'html') return node.value ?? '';
  if (node?.type !== 'paragraph' || !Array.isArray(node.children)) return '';
  return node.children.map((child) => child?.type === 'html' ? child.value : '').join('');
}

function anchorSpanAliasNodeBuild(id) {
  return {
    type: 'paragraph',
    children: [],
    data: {
      hName: 'span',
      hProperties: { id, 'aria-hidden': 'true' },
    },
  };
}
