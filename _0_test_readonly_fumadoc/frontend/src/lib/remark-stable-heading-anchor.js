// Plain Markdown parses an authored `<span id="..."></span>` as raw HTML,
// which MDX intentionally omits when compiling with `format: 'md'`. Transfer
// that stable ID to the immediately following heading so fragment navigation
// has a rendered destination without enabling arbitrary MDX in `.md` files.

const anchorPattern = /^<span\s+id=(['"])([^'"<>\s]+)\1\s*><\/span>$/i;

export function remarkStableHeadingAnchor() {
  return (tree) => {
    if (!Array.isArray(tree?.children)) return;

    for (let index = 0; index < tree.children.length - 1; index += 1) {
      const nodeAnchor = tree.children[index];
      const nodeHeading = tree.children[index + 1];
      const anchorId = anchorIdGet(nodeAnchor);
      if (!anchorId || nodeHeading?.type !== 'heading') continue;

      nodeHeading.data = {
        ...nodeHeading.data,
        hProperties: {
          ...nodeHeading.data?.hProperties,
          id: anchorId,
        },
      };
      tree.children.splice(index, 1);
      index -= 1;
    }
  };
}

function anchorIdGet(node) {
  if (node?.type !== 'paragraph' || !Array.isArray(node.children)) return '';
  const raw = node.children
    .map((child) => child?.type === 'html' ? child.value : '')
    .join('')
    .trim();
  return anchorPattern.exec(raw)?.[2] ?? '';
}