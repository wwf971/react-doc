// Plain Markdown parses authored `<span id="..." />` markers as raw HTML,
// which MDX intentionally omits when compiling with `format: 'md'`. Transfer
// the first stable ID to the immediately following heading and render any
// additional IDs as preceding safe aliases. Aliases must not be heading
// children because Fumadocs copies heading content into its TOC and breadcrumb,
// which would duplicate those IDs outside the document body.

const anchorPattern = /<span\s+id=(['"])([^'"<>\s]+)\1\s*(?:\/>|><\/span>)/gi;

export function remarkStableHeadingAnchor() {
  return (tree) => {
    if (!Array.isArray(tree?.children)) return;

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