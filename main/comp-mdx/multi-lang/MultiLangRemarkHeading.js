import { parse as parseYaml } from 'yaml';
import { multiLangCompNameIs, valueIsText } from './MultiLangData.js';

const REGEX_RENDER_COMP_MARKER = /^<!--\s*renderComp=(\w+)\s*-->$/;

// Keeps the native heading node (depth, anchor properties, TOC participation),
// replacing only its text with a language-aware inline renderer.
export function multiLangRemarkHeading(options = {}) {
  return (tree) => transformChildren(tree, options);
}

function transformChildren(parent, options) {
  if (!Array.isArray(parent.children)) return;
  for (let index = 0; index < parent.children.length; index += 1) {
    const marker = parent.children[index];
    const heading = parent.children[index + 1];
    if (
      marker?.type === 'html'
      && multiLangCompNameIs(REGEX_RENDER_COMP_MARKER.exec(marker.value.trim())?.[1])
      && heading?.type === 'heading'
    ) {
      marker.data = { ...(marker.data ?? {}), isMultiLangHeadingMarker: true };
      const translationByLanguage = headingTranslationParse(heading);
      if (translationByLanguage) {
        for (const language of Object.keys(translationByLanguage)) options.onLanguage?.(language);
        const variantsJson = JSON.stringify(translationByLanguage);
        heading.data = {
          ...(heading.data ?? {}),
          hProperties: {
            ...(heading.data?.hProperties ?? {}),
            'data-multi-lang-heading': variantsJson,
          },
        };
        // This id can still be replaced, for example by a stable heading anchor.
        // Callers that need the final id should read data-multi-lang-heading later.
        options.onHeading?.({
          id: heading.data.hProperties.id,
          variantsJson,
        });
        parent.children.splice(index, 1);
        index -= 1;
        continue;
      }
    }
    transformChildren(marker, options);
  }
}

// Records translations under the heading id after every plugin that can
// replace that id has run. The value was stored on the heading earlier.
export function multiLangRemarkHeadingCollect(options = {}) {
  return (tree) => headingVariantCollect(tree, options);
}

function headingVariantCollect(node, options) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'heading') {
    const id = node.data?.hProperties?.id;
    const variantsJson = node.data?.hProperties?.['data-multi-lang-heading'];
    if (typeof id === 'string' && id && typeof variantsJson === 'string' && variantsJson) {
      options.onHeading?.({ id, variantsJson });
    }
  }
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) headingVariantCollect(child, options);
}

function headingTranslationParse(heading) {
  if (heading.children.length !== 1 || heading.children[0].type !== 'text') return null;
  const source = heading.children[0].value;
  try {
    const value = parseYaml(source);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([, text]) => valueIsText(text))) {
      return Object.fromEntries(entries);
    }
  } catch {
    // Also accept the compact authoring form `{jp:xxx, en:xxx}`.
  }
  const match = /^\{([\s\S]*)\}$/.exec(source.trim());
  if (!match) return null;
  const entries = match[1].split(',').map((part) => {
    const indexColon = part.indexOf(':');
    if (indexColon < 1) return null;
    const language = part.slice(0, indexColon).trim();
    const textSource = part.slice(indexColon + 1).trim();
    if (!language || !textSource) return null;
    let text = textSource;
    try {
      const parsed = parseYaml(textSource);
      if (valueIsText(parsed)) text = parsed;
    } catch {
      // Keep the unquoted compact text.
    }
    return [language, text];
  });
  return entries.length > 0 && entries.every(Boolean) ? Object.fromEntries(entries) : null;
}