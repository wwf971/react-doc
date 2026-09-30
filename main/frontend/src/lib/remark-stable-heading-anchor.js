// Plain Markdown parses authored `<span id="..." />` markers as raw HTML,
// which MDX intentionally omits when compiling with `format: 'md'`. Transfer
// the first stable ID to the immediately following heading and render any
// additional IDs as preceding safe aliases. Aliases must not be heading
// children because Fumadocs copies heading content into its TOC and breadcrumb,
// which would duplicate those IDs outside the document body.

//
// The marker and the heading must be separated by a blank line:
//
//   <span id="configuration" />
//
//   ## Configuration
//
// Without it, Markdown continues the raw HTML block onto the heading line, and
// the heading is omitted together with that block. That case is reported as
// a warning, because it is almost always a missing blank line.

const anchorPattern = /<span\s+id=(['"])([^'"<>\s]+)\1\s*(?:\/>|><\/span>)/gi;
const anchorStartPattern = /^\s*<span\s+id=(['"])[^'"<>\s]+\1/i;
const headingLinePattern = /^ {0,3}#{1,6}(?:\s|$)/;

export function remarkStableHeadingAnchor(options = {}) {
  return (tree) => {
    if (!Array.isArray(tree?.children)) return;

    for (const node of tree.children) anchorHeadingSwallowedWarn(node, options.sourcePath);

    for (let index = 0; index < tree.children.length - 1; index += 1) {
      const nodeAnchor = tree.children[index];
      const nodeHeading = tree.children[index + 1];
      const anchorIdList = anchorIdListGet(nodeAnchor);
      if (anchorIdList.length === 0 || nodeHeading?.type !== 'heading') continue;

      nodeHeading.data = {
        ...nodeHeading.data,
        hProperties: {
          ...nodeHeading.data?.hProperties,
          id: anchorIdList[0],
        },
      };
      const nodeAliasList = anchorIdList.slice(1).map(anchorAliasNodeBuild);
      tree.children.splice(index, 1, ...nodeAliasList);
      index += nodeAliasList.length - 1;
    }
  };
}

// returns the swallowed heading line, '' when there is none
export function anchorHeadingSwallowedGet(node) {
  if (node?.type !== 'html') return '';
  const lineList = String(node.value ?? '').split(/\r?\n/);
  if (!anchorStartPattern.test(lineList[0])) return '';
  return lineList.find((line) => headingLinePattern.test(line))?.trim() ?? '';
}

function anchorHeadingSwallowedWarn(node, sourcePath) {
  const lineHeading = anchorHeadingSwallowedGet(node);
  if (!lineHeading) return;
  console.warn(
    `[react-doc] ${sourcePath || 'document'}: heading "${lineHeading}" directly follows a`
    + ' <span id> anchor marker. Without a blank line between them, Markdown reads the'
    + ' heading as part of the raw HTML block and does not render it.',
  );
}

function anchorIdListGet(node) {
  const raw = anchorRawGet(node).trim();
  if (!raw) return [];
  const idList = [...raw.matchAll(anchorPattern)].map((match) => match[2]);
  anchorPattern.lastIndex = 0;
  if (idList.length === 0 || raw.replace(anchorPattern, '').trim()) {
    anchorPattern.lastIndex = 0;
    return [];
  }
  anchorPattern.lastIndex = 0;
  return [...new Set(idList)];
}

function anchorRawGet(node) {
  if (node?.type === 'html') return node.value ?? '';
  if (node?.type !== 'paragraph' || !Array.isArray(node.children)) return '';
  return node.children.map((child) => child?.type === 'html' ? child.value : '').join('');
}

function anchorAliasNodeBuild(id) {
  return {
    type: 'paragraph',
    children: [],
    data: {
      hName: 'span',
      hProperties: { id, 'aria-hidden': 'true' },
    },
  };
}