import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { toHast } from 'mdast-util-to-hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { VFile } from 'vfile';
import { remarkDocLink } from './remark-doc-link.js';
import {
  remarkContentSanitize,
  remarkInlineUnwrap,
  remarkNodeTypeRestrict,
} from './remark-content-restrict.js';

// The one Markdown pipeline for content rendered inside a component
// (BlockSimple, BlockMdx, MultiLang, ...). Components decide what is shown;
// this module decides what the Markdown means, the same way as the main
// document body:
//
//   parse          remark + gfm + math, the parser of a compiled .md document
//   transform      remarkDocLink (+ optional restriction / sanitizing)
//   components     buildMdxComps(), the mapping of the main document body
//
// two entries share the transform list:
//   text      MdxRenderer compiles it through compileDoc() (async)
//   fragment  markdownFragmentRender() renders already parsed mdast nodes,
//             e.g. the paragraph MultiLang picked for one language (sync)

const markdownParser = remark().use(remarkGfm).use(remarkMath);

export function markdownParse(text) {
  return markdownParser.parse(String(text ?? ''));
}

// options:
//   sourcePath           document the content belongs to; relative links resolve from it
//   isTextInline         text input of content mode 'inline': one paragraph loses its <p>
//   nodeTypeAllowedList  optional; other node types are degraded (remark-content-restrict.js)
//   isContentSanitized   remove authored JSX / HTML / expressions, keep generated links
//   remarkPluginsExtra   appended last
export function markdownTransformListGet(options = {}) {
  const nodeTypeAllowedList = options.nodeTypeAllowedList ?? [];
  return [
    ...(options.isTextInline === true ? [remarkInlineUnwrap] : []),
    ...(nodeTypeAllowedList.length > 0 ? [[remarkNodeTypeRestrict, { nodeTypeAllowedList }]] : []),
    [remarkDocLink, { fromPath: String(options.sourcePath ?? '') }],
    ...(options.isContentSanitized === true ? [remarkContentSanitize] : []),
    ...(options.remarkPluginsExtra ?? []),
  ];
}

// nodeList: mdast nodes. isInline means phrasing nodes such as the children
// of one paragraph; otherwise flow nodes. the caller places the result
// (inside its own <p>, <li>, ...). nodeList is not mutated.
//
// phrasing nodes are converted inside a paragraph and taken out again:
// converted as root children they would be joined with line breaks, which
// adds a space between e.g. "a**b**c".
export function markdownFragmentRender({ nodeList, transformList, components = {}, isInline = false }) {
  const nodeListCloned = structuredClone(nodeList ?? []);
  const tree = isInline
    ? { type: 'root', children: [{ type: 'paragraph', children: nodeListCloned }] }
    : { type: 'root', children: nodeListCloned };
  const file = new VFile();
  for (const transformEntry of transformList) {
    const [plugin, pluginOptions] = Array.isArray(transformEntry) ? transformEntry : [transformEntry];
    plugin(pluginOptions)?.(tree, file);
  }
  let treeHast = toHast(tree, { passThrough: ['mdxJsxFlowElement', 'mdxJsxTextElement'] });
  if (isInline) {
    const paragraph = treeHast.children.find((child) => child.type === 'element' && child.tagName === 'p');
    if (paragraph) treeHast = { type: 'root', children: paragraph.children };
  }
  rehypeKatex()(treeHast, file);
  return toJsxRuntime(treeHast, {
    Fragment,
    jsx,
    jsxs,
    components,
    createEvaluater: () => componentEvaluaterCreate(components),
  });
}

// JSX in a fragment only comes from the transforms (DocLink, SourceLink).
// element names are looked up in components; real expressions are refused.
function componentEvaluaterCreate(components) {
  return {
    evaluateExpression(expression) {
      if (expression.type === 'Identifier') {
        return components[expression.name] ?? ComponentMissing;
      }
      throw new Error('expressions are not supported in Markdown fragments');
    },
    evaluateProgram() {
      throw new Error('expressions are not supported in Markdown fragments');
    },
  };
}

function ComponentMissing({ children }) {
  return jsx(Fragment, { children });
}
