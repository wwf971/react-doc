import { compile, run } from '@mdx-js/mdx';
import * as jsxRuntime from 'react/jsx-runtime';
import { rehypeCode } from 'fumadocs-core/mdx-plugins/rehype-code';
import { rehypeToc } from 'fumadocs-core/mdx-plugins/rehype-toc';
import { remarkCodeTab } from 'fumadocs-core/mdx-plugins/remark-code-tab';
import { remarkHeading } from 'fumadocs-core/mdx-plugins/remark-heading';
import { remarkNpm } from 'fumadocs-core/mdx-plugins/remark-npm';
import { remarkStructure } from 'fumadocs-core/mdx-plugins/remark-structure';
import remarkGfm from 'remark-gfm';
import { parse as parseYaml } from 'yaml';
import { remarkDocLink } from './remark-doc-link.js';
import { remarkCommentComp } from './remark-comment-comp.js';

// compiles one doc in the browser.
// mdxPreset() applies the fumadocs defaults (gfm, heading anchors + toc export,
// shiki code blocks with diff/highlight notations, structured data export),
// plus our own plugins for doc links and comment-marked components.
//
// format 'mdx' allows JSX; format 'md' is plain markdown, used for .md and
// synthesized files, so text like <foo> or {bar} never breaks compilation.

export async function compileDoc({ source, internalPath, format, config = {} }) {
  const { frontmatter, content } = splitFrontmatter(source);

  const options = {
    format,
    outputFormat: 'function-body',
    remarkPlugins: [
      remarkGfm,
      [remarkHeading, { generateToc: false }],
      [remarkCodeTab],
      [remarkNpm],
      ...(config.isCommentComponentEnabled === false ? [] : [[remarkCommentComp]]),
      ...(config.isDefaultLinkRecognitionEnabled === false
        ? []
        : [[remarkDocLink, { fromPath: internalPath }]]),
      ...(config.remarkPlugins ?? []),
      [remarkStructure, { exportAs: 'structuredData' }],
    ],
    rehypePlugins: [
      [rehypeCode, config.rehypeCodeOptions],
      ...(config.rehypePlugins ?? []),
      rehypeToc,
    ],
  };

  const compiled = await compile({ value: content }, options);
  const mod = await run(compiled, { ...jsxRuntime, baseUrl: import.meta.url });

  return {
    Body: mod.default,
    toc: mod.toc ?? [],
    titleFrontmatter: frontmatter?.title ?? '',
    description: frontmatter?.description ?? '',
  };
}

// the runtime preset has no frontmatter plugin, so strip and parse it here
function splitFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!match) return { frontmatter: null, content: source };
  let frontmatter = null;
  try {
    frontmatter = parseYaml(match[1]);
  } catch {
    // malformed frontmatter: keep it out of the rendered body anyway
  }
  return { frontmatter, content: source.slice(match[0].length) };
}
