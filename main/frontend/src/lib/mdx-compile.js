import { compile, run } from '@mdx-js/mdx';
import { createElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { rehypeCode } from 'fumadocs-core/mdx-plugins/rehype-code';
import { rehypeToc } from 'fumadocs-core/mdx-plugins/rehype-toc';
import { remarkCodeTab } from 'fumadocs-core/mdx-plugins/remark-code-tab';
import { remarkHeading } from 'fumadocs-core/mdx-plugins/remark-heading';
import { remarkNpm } from 'fumadocs-core/mdx-plugins/remark-npm';
import { remarkStructure } from 'fumadocs-core/mdx-plugins/remark-structure';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { parse as parseYaml } from 'yaml';
import { remarkDocLink } from './remark-doc-link.js';
import { remarkCommentComp } from './remark-comment-comp.js';
import { remarkAnchor } from './remark-anchor.js';
import { rehypeCodeInline } from './rehype-code-inline.js';
import { assetRefLangIs } from './doc-asset-ref.js';
import {
  multiLangCompNameIs,
  multiLangLanguageListGet,
  multiLangStructuredDataGet,
} from '../../../comp-mdx/multi-lang/MultiLangData.js';
import {
  multiLangRemarkHeading,
  multiLangRemarkHeadingCollect,
} from '../../../comp-mdx/multi-lang/MultiLangRemarkHeading.js';
import { MultiLangHeadingText } from '../../../comp-mdx/multi-lang/MultiLangEntry.jsx';

// compiles one doc in the browser.
// mdxPreset() applies the fumadocs defaults (gfm, heading anchors + toc export,
// shiki code blocks with diff/highlight notations, structured data export),
// plus our own plugins for doc links and comment-marked components.
//
// format 'mdx' allows JSX; format 'md' is plain markdown, used for .md and
// synthesized files, so text like <foo> or {bar} never breaks compilation.

export async function compileDoc({ source, internalPath, format, config = {} }) {
  const { frontmatter, content } = splitFrontmatter(source);
  const componentList = [];
  const languageSet = new Set();
  const headingVariantsById = new Map();
  // languageList of an entry: languages of that one component, e.g. for the
  // language selector of a hosted part index. a block in the language
  // "asset" holds a reference into the asset service layer, not the data
  // (doc_page_impl_asset.md): the component-specific readers of the data
  // do not run on it (the plugin expands references before compiling when
  // the data is wanted at build time).
  const onCommentComponent = ({ compName, lang, props, raw, sourceOffset }) => {
    const languageListGet = config.languageListGetByComponent?.[compName]
      ?? (multiLangCompNameIs(compName) ? multiLangLanguageListGet : undefined);
    const languageList = assetRefLangIs(lang) ? [] : languageListGet?.(raw, { compName, props, lang }) ?? [];
    componentList.push({
      id: typeof props.id === 'string' ? props.id.trim() : '',
      compName,
      input: { lang, propsAuthored: props, raw },
      languageList,
      sourceOffset,
    });
    for (const language of languageList) languageSet.add(language);
  };
  const structuredDataGet = ({ compName, props, raw, lang }) => {
    if (assetRefLangIs(lang)) return undefined;
    const getter = config.structuredDataGetByComponent?.[compName]
      ?? (multiLangCompNameIs(compName) ? multiLangStructuredDataGet : undefined);
    return getter?.(raw, { compName, props });
  };

  const options = {
    format,
    outputFormat: 'function-body',
    remarkPlugins: [
      remarkGfm,
      // $...$ and $$...$$ become math nodes; markdown-render.js parses
      // nested Markdown with the same two extensions.
      remarkMath,
      // plugins that must see the parsed tree before any marker comment is
      // consumed, e.g. the edit layer grouping root-level blocks
      ...(config.remarkPluginsFirst ?? []),
      [remarkHeading, { generateToc: false }],
      [multiLangRemarkHeading, {
        onLanguage: (language) => languageSet.add(language),
      }],
      // Keep this after the multilingual marker is removed. That marker sits
      // between an Anchor comment and the heading, so the declared id can be
      // copied onto the heading only once the marker is gone. Keep it before
      // remarkCommentComp, which would otherwise see the Anchor comment.
      [remarkAnchor, { sourcePath: internalPath }],
      [multiLangRemarkHeadingCollect, {
        onHeading: ({ id, variantsJson }) => headingVariantsById.set(id, variantsJson),
      }],
      [remarkCodeTab],
      [remarkNpm],
      ...(config.isCommentComponentEnabled === false
        ? []
        : [[remarkCommentComp, { onComponent: onCommentComponent, structuredDataGet }]]),
      ...(config.isDefaultLinkRecognitionEnabled === false
        ? []
        : [[remarkDocLink, { fromPath: internalPath }]]),
      ...(config.remarkPlugins ?? []),
      [remarkStructure, { exportAs: 'structuredData' }],
    ],
    rehypePlugins: [
      // before rehypeCode: display math is a <pre><code class="language-math">,
      // which shiki would otherwise take as a code block in an unknown language.
      rehypeKatex,
      rehypeCodeInline,
      [rehypeCode, config.rehypeCodeOptions],
      ...(config.rehypePlugins ?? []),
      rehypeToc,
    ],
  };

  const compiled = await compile({ value: content }, options);
  const mod = await run(compiled, { ...jsxRuntime, baseUrl: import.meta.url });

  return {
    Body: mod.default,
    componentList,
    toc: multiLangTocTransform(mod.toc ?? [], headingVariantsById),
    titleFrontmatter: frontmatter?.title ?? '',
    description: frontmatter?.description ?? '',
    language: frontmatter?.language ?? '',
    languageList: [...languageSet],
  };
}

function multiLangTocTransform(itemList, headingVariantsById) {
  return itemList.map((item) => {
    const id = typeof item.url === 'string' && item.url.startsWith('#')
      ? item.url.slice(1)
      : '';
    const variantsJson = headingVariantsById.get(id);
    return {
      ...item,
      ...(variantsJson
        ? { title: createElement(MultiLangHeadingText, { key: id, variantsJson }) }
        : {}),
      ...(Array.isArray(item.children)
        ? { children: multiLangTocTransform(item.children, headingVariantsById) }
        : {}),
    };
  });
}

// the runtime preset has no frontmatter plugin, so strip and parse it here.
// exported for the edit layer, which maps positions of the parsed content
// back to lines of the complete file.
export function splitFrontmatter(source) {
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
