import { visit } from 'unist-util-visit';

// recognizes doc links in three patterns and rewrites each into <DocLink/>:
//   [text](a.md)   normal markdown link (external/anchor urls are skipped)
//   `a.md`         inline code that looks like a doc file
//   [[a.md]]       obsidian style link in plain text
//
// the actual target resolution (by name / relative / exact path) happens at
// render time inside the DocLink component, against the store's doc index.

const REGEX_DOC_FILE = /^(?:\.{0,2}\/)?[\w@%+ .\/-]*\.(?:md|mdx)(?:#[^\s]*)?$/i;
const REGEX_WIKI_LINK = /\[\[([^\[\]]+)\]\]/g;

export function remarkDocLink(options = {}) {
  const fromPath = options.fromPath ?? '';

  return (tree) => {
    // [text](target): any relative url is treated as a doc link
    visit(tree, 'link', (node, index, parent) => {
      if (isExternalUrl(node.url) || node.url.startsWith('#')) return;
      parent.children[index] = makeDocLinkNode({
        target: node.url,
        fromPath,
        kind: 'link',
        children: node.children,
      });
    });

    // `a.md`
    visit(tree, 'inlineCode', (node, index, parent) => {
      if (isInsideDocLink(parent)) return;
      if (!REGEX_DOC_FILE.test(node.value)) return;
      parent.children[index] = makeDocLinkNode({
        target: node.value,
        fromPath,
        kind: 'code',
        children: [{ type: 'inlineCode', value: node.value }],
      });
    });

    // [[a.md]]
    visit(tree, 'text', (node, index, parent) => {
      if (isInsideDocLink(parent)) return;
      if (!node.value.includes('[[')) return;

      const partsNew = [];
      let indexLast = 0;
      REGEX_WIKI_LINK.lastIndex = 0;
      let match;
      while ((match = REGEX_WIKI_LINK.exec(node.value)) !== null) {
        if (match.index > indexLast) {
          partsNew.push({ type: 'text', value: node.value.slice(indexLast, match.index) });
        }
        partsNew.push(
          makeDocLinkNode({
            target: match[1],
            fromPath,
            kind: 'wiki',
            children: [{ type: 'text', value: match[1] }],
          }),
        );
        indexLast = match.index + match[0].length;
      }
      if (partsNew.length === 0) return;
      if (indexLast < node.value.length) {
        partsNew.push({ type: 'text', value: node.value.slice(indexLast) });
      }
      parent.children.splice(index, 1, ...partsNew);
      return index + partsNew.length;
    });
  };
}

function makeDocLinkNode({ target, fromPath, kind, children }) {
  return {
    type: 'mdxJsxTextElement',
    name: 'DocLink',
    attributes: [
      { type: 'mdxJsxAttribute', name: 'target', value: target },
      { type: 'mdxJsxAttribute', name: 'from', value: fromPath },
      { type: 'mdxJsxAttribute', name: 'kind', value: kind },
    ],
    children,
  };
}

function isInsideDocLink(parent) {
  return parent.type === 'mdxJsxTextElement' && parent.name === 'DocLink';
}

function isExternalUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}
