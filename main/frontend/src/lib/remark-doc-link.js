import { visit } from 'unist-util-visit';
import {
  inlineCodeIsDocTarget,
  inlineLinkDisplayModeGet,
  linkTagsDisplayGet,
  linkUrlIsLocal,
  wikiTextSplit,
} from './doc-link-classify.js';

// recognizes doc links in three patterns and rewrites each into <DocLink/>:
//   [text](a.md)   normal markdown link (external/anchor urls are skipped)
//   `a.md`         inline code that looks like a doc file
//   [[a.md]]       obsidian style link in plain text
//
// a local link whose markdown title is an exact inline-link marker becomes an
// inline <SourceLink/> instead: it stays in the paragraph and opens the target
// in the compact source popup without navigating.
//   [label](/guide/setup.ps1 "inline-link")          source popup (compatible form)
//   [label](/guide/setup.ps1 "inline-link:source")   source popup, explicit
//   [label](/guide/details.mdx "inline-link:render") compiled-document popup
//
// a document link whose title is an exact tag-display marker decides inline
// whether the tags of the target are shown beside it (TagsDisplayAtLink...
// config in doc_page_impl_config.md):
//   [label](a.md "tags:before")   show, before the link text
//   [label](a.md "tags:after")    show, after the link text
//   [label](a.md "tags:on")       show, at the configured position
//   [label](a.md "tags:off")      do not show
//
// how a link is classified lives in doc-link-classify.js, shared with the
// build-time dependency discovery. the actual target resolution (by name /
// relative / exact path) happens at render time inside the DocLink component.
//
// this is the one link transform of the package: the main document body and
// every component that renders nested Markdown (MdxRenderer) run it.
//
// generated elements carry node.data.isDocLinkGenerated, so a later sanitizer
// can tell them from authored JSX of the same name.

export function remarkDocLink(options = {}) {
  const fromPath = options.fromPath ?? '';

  return (tree) => {
    // [text](target): any relative url is treated as a doc link
    visit(tree, 'link', (node, index, parent) => {
      if (!linkUrlIsLocal(node.url)) return;
      const displayMode = inlineLinkDisplayModeGet(node.title);
      if (displayMode) {
        parent.children[index] = makeSourceLinkNode({
          target: node.url,
          label: textContentGet(node.children),
          displayMode,
        });
        return;
      }
      parent.children[index] = makeDocLinkNode({
        target: node.url,
        fromPath,
        kind: 'link',
        tagsDisplay: linkTagsDisplayGet(node.title),
        children: node.children,
      });
    });

    // `a.md`
    visit(tree, 'inlineCode', (node, index, parent) => {
      if (isInsideDocLink(parent)) return;
      if (!inlineCodeIsDocTarget(node.value)) return;
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
      const partList = wikiTextSplit(node.value);
      if (partList.length === 0) return;
      const nodeListNew = partList.map((part) => (
        part.target === undefined
          ? { type: 'text', value: part.text }
          : makeDocLinkNode({
            target: part.target,
            fromPath,
            kind: 'wiki',
            children: [{ type: 'text', value: part.target }],
          })
      ));
      parent.children.splice(index, 1, ...nodeListNew);
      return index + nodeListNew.length;
    });
  };
}

function makeDocLinkNode({ target, fromPath, kind, tagsDisplay = '', children }) {
  const attributes = [
    { type: 'mdxJsxAttribute', name: 'target', value: target },
    { type: 'mdxJsxAttribute', name: 'from', value: fromPath },
    { type: 'mdxJsxAttribute', name: 'kind', value: kind },
  ];
  if (tagsDisplay) attributes.push({ type: 'mdxJsxAttribute', name: 'tagsDisplay', value: tagsDisplay });
  return {
    type: 'mdxJsxTextElement',
    name: 'DocLink',
    attributes,
    children,
    data: { isDocLinkGenerated: true },
  };
}

// the emitted tag stays inside the paragraph (mdxJsxTextElement) and resolves
// through configDoc.compRegistry, so this transformer does not import the
// concrete SourceLink component.
function makeSourceLinkNode({ target, label, displayMode }) {
  return {
    type: 'mdxJsxTextElement',
    name: 'SourceLink',
    attributes: [
      { type: 'mdxJsxAttribute', name: 'target', value: target },
      { type: 'mdxJsxAttribute', name: 'label', value: label },
      { type: 'mdxJsxAttribute', name: 'displayMode', value: displayMode },
    ],
    children: [],
    data: { isDocLinkGenerated: true },
  };
}

// keeps the visible label when the authored link text contains nested
// emphasis or other text-bearing inline nodes.
function textContentGet(children = []) {
  return children.map((child) => {
    if (typeof child.value === 'string') return child.value;
    return textContentGet(child.children);
  }).join('');
}

function isInsideDocLink(parent) {
  return parent.type === 'mdxJsxTextElement' && parent.name === 'DocLink';
}
