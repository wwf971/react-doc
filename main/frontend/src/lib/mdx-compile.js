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
import { parse as parseYaml } from 'yaml';
import { remarkDocLink } from './remark-doc-link.js';
import { remarkCommentComp } from './remark-comment-comp.js';
import { remarkStableHeadingAnchor } from './remark-stable-heading-anchor.js';
import { multiLangLanguageListGet, multiLangStructuredDataGet } from '../../../comp-mdx/multi-lang/MultiLangData.js';
import { multiLangRemarkHeading } from '../../../comp-mdx/multi-lang/MultiLangRemarkHeading.js';
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
  const onCommentComponent = ({ compName, lang, props, raw, sourceOffset }) => {
    componentList.push({
      id: typeof props.id === 'string' ? props.id.trim() : '',
      compName,
      input: { lang, propsAuthored: props, raw },
      sourceOffset,
    });
    const languageListGet = config.languageListGetByComponent?.[compName]
      ?? (compName === 'DocMultiLang' ? multiLangLanguageListGet : undefined);
    for (const language of languageListGet?.(raw, { compName, props, lang }) ?? []) {
      languageSet.add(language);
    }
  };
  const structuredDataGet = ({ compName, props, raw }) => {
    const getter = config.structuredDataGetByComponent?.[compName]
      ?? (compName === 'DocMultiLang' ? multiLangStructuredDataGet : undefined);
    return getter?.(raw, { compName, props });
  };

  const options = {
    format,
    outputFormat: 'function-body',
    remarkPlugins: [
      remarkGfm,
      [remarkHeading, { generateToc: false }],
      [multiLangRemarkHeading, {
        onHeading: ({ id, variantsJson }) => headingVariantsById.set(id, variantsJson),
        onLanguage: (language) => languageSet.add(language),
      }],
      // Keep this after heading ID generation: plain `.md` compilation drops
      // raw span markers, so this transfers their stable IDs to the headings.
      remarkStableHeadingAnchor,
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
