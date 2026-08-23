import { compile, run } from '@mdx-js/mdx';
import * as jsxRuntime from 'react/jsx-runtime';
import { mdxPreset } from 'fumadocs-core/content/mdx/preset-runtime';
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

export async function compileDoc({ source, internalPath, format }) {
  const { frontmatter, content } = splitFrontmatter(source);

  const options = await mdxPreset({
    format,
    // no bundler-time image processing available at runtime
    remarkImageOptions: false,
    remarkPlugins: [
      [remarkCommentComp],
      [remarkDocLink, { fromPath: internalPath }],
    ],
  });

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
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) return { frontmatter: null, content: source };
  let frontmatter = null;
  try {
    frontmatter = parseYaml(match[1]);
  } catch {
    // malformed frontmatter: keep it out of the rendered body anyway
  }
  return { frontmatter, content: source.slice(match[0].length) };
}
