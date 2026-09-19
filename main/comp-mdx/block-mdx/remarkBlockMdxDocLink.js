const regexDocFile = /^(?:\.{0,2}\/)?[\w@%+ .\/-]*\.(?:md|mdx)(?:#[^\s]*)?$/i;
const regexWikiLink = /\[\[([^\[\]]+)\]\]/g;

function remarkBlockMdxDocLink(options = {}) {
  const sourcePath = String(options.sourcePath ?? '');

  return (tree) => {
    childrenTransform(tree, sourcePath);
  };
}

function childrenTransform(parent, sourcePath) {
  if (!Array.isArray(parent?.children)) return;

  for (let index = 0; index < parent.children.length; index += 1) {
    const node = parent.children[index];
    if (!node || typeof node !== 'object') continue;

    if (node.type === 'link' && !isExternalTarget(node.url) && !String(node.url || '').startsWith('#')) {
      parent.children[index] = docLinkNodeCreate(node.url, sourcePath, 'link', node.children);
      continue;
    }

    if (node.type === 'inlineCode' && regexDocFile.test(String(node.value || ''))) {
      parent.children[index] = docLinkNodeCreate(
        node.value,
        sourcePath,
        'code',
        [{ type: 'inlineCode', value: node.value }],
      );
      continue;
    }

    if (node.type === 'text' && String(node.value || '').includes('[[')) {
      const nodeList = wikiNodeListCreate(node.value, sourcePath);
      if (nodeList) {
        parent.children.splice(index, 1, ...nodeList);
        index += nodeList.length - 1;
        continue;
      }
    }

    childrenTransform(node, sourcePath);
  }
}

function wikiNodeListCreate(value, sourcePath) {
  const nodeList = [];
  let indexLast = 0;
  regexWikiLink.lastIndex = 0;
  let match;

  while ((match = regexWikiLink.exec(value)) !== null) {
    if (match.index > indexLast) {
      nodeList.push({ type: 'text', value: value.slice(indexLast, match.index) });
    }
    nodeList.push(docLinkNodeCreate(
      match[1],
      sourcePath,
      'wiki',
      [{ type: 'text', value: match[1] }],
    ));
    indexLast = match.index + match[0].length;
  }

  if (nodeList.length === 0) return null;
  if (indexLast < value.length) nodeList.push({ type: 'text', value: value.slice(indexLast) });
  return nodeList;
}

function docLinkNodeCreate(target, sourcePath, kind, children) {
  return {
    type: 'mdxJsxTextElement',
    name: 'DocLink',
    attributes: [
      { type: 'mdxJsxAttribute', name: 'target', value: String(target || '') },
      { type: 'mdxJsxAttribute', name: 'from', value: sourcePath },
      { type: 'mdxJsxAttribute', name: 'kind', value: kind },
    ],
    children: Array.isArray(children) ? children : [],
  };
}

function isExternalTarget(target) {
  const value = String(target || '');
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

export { remarkBlockMdxDocLink };
