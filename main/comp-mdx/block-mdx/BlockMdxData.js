import { yamlParse } from '../../frontend/src/lib/yaml.js';

// Authored input of BlockMdx, normalized outside the JSX.

// titleComponentProps: an object from MDX, or an inline YAML mapping string
// from a comment marker such as {color: "#0f766e"}. anything else is {}.
function blockMdxTitleComponentPropsGet(value) {
  if (typeof value === 'string') {
    if (!value.trim()) return {};
    try {
      return mappingOrEmptyGet(yamlParse(value));
    } catch {
      return {};
    }
  }
  return mappingOrEmptyGet(value);
}

// css custom properties on the panel, only for authored colors, so the tone
// styles stay the fallback.
function blockMdxStyleGet(data = {}) {
  const style = {};
  const backgroundTitle = String(data.backgroundColorTitle ?? '').trim();
  const backgroundContent = String(data.backgroundColorContent ?? '').trim();
  if (backgroundTitle) style['--doc-block-title-background'] = backgroundTitle;
  if (backgroundContent) style['--doc-block-content-background'] = backgroundContent;
  return Object.keys(style).length > 0 ? style : undefined;
}

function blockMdxIsContentSanitizedGet(data = {}) {
  return data.isContentSanitized === true
    || String(data.isContentSanitized ?? '').trim().toLowerCase() === 'true';
}

function mappingOrEmptyGet(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export { blockMdxIsContentSanitizedGet, blockMdxStyleGet, blockMdxTitleComponentPropsGet };
