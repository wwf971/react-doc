import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { buildMdxComps } from '../../frontend/src/lib/mdx-comps.js';
import { markdownFragmentRender, markdownTransformListGet } from '../../frontend/src/lib/markdown-render.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { MdxRendererStore } from './MdxRendererStore.js';

// Renders authored Markdown inside a component. Components that display
// Markdown (BlockSimple, BlockMdx, MultiLang) receive it through
// config.MdxRenderer and decide only what is shown and where; link parsing,
// target resolution, inline-link popups, tags and navigation are the same as
// in the main document body (lib/markdown-render.js).
//
//   data.source                   Markdown text, compiled in the browser
//   data.nodeList                 or: parsed mdast nodes (markdownParse()), rendered at once
//   config.sourcePath             document the content belongs to (relative links, components)
//   config.contentMode            'blocks' (default) | 'inline': phrasing content, no <div>/<p>
//   config.nodeTypeAllowedList    optional restricted mode; other nodes are degraded
//   config.isContentSanitized     remove authored JSX / HTML / expressions, keep generated links
//   config.isExpressionAllowed    true compiles text as mdx; otherwise plain md
//   config.className              class of the content wrapper
//   config.components             extra MDX components, merged over the document mapping
//   config.remarkPlugins          extra remark plugins (keep the array stable)
//   config.textEmpty / textError  messages for empty source / render failure
export const MdxRenderer = observer(function MdxRenderer({ data = {}, config = {} }) {
  const { compById, sourceStore } = useDocStores();
  const configDoc = sourceStore.configDoc;
  const isNodeListInput = data.nodeList !== undefined;
  const isInline = config.contentMode === 'inline';
  const nodeTypeAllowedKey = (config.nodeTypeAllowedList ?? []).join(',');
  const transformList = useMemo(() => markdownTransformListGet({
    isContentSanitized: config.isContentSanitized === true,
    isTextInline: isInline && !isNodeListInput,
    nodeTypeAllowedList: nodeTypeAllowedKey ? nodeTypeAllowedKey.split(',') : [],
    remarkPluginsExtra: config.remarkPlugins,
    sourcePath: config.sourcePath,
  }), [config.isContentSanitized, config.remarkPlugins, config.sourcePath, isInline, isNodeListInput, nodeTypeAllowedKey]);
  const components = useMemo(() => ({
    ...buildMdxComps(configDoc, compById, { sourcePath: config.sourcePath }),
    ...(config.components ?? {}),
  }), [compById, config.components, config.sourcePath, configDoc]);

  const content = isNodeListInput
    ? <MdxRendererFragment data={data} config={config} components={components} transformList={transformList} />
    : <MdxRendererText data={data} config={config} components={components} transformList={transformList} />;
  if (isInline) return config.className ? <span className={config.className}>{content}</span> : content;
  return <div className={config.className}>{content}</div>;
});

function MdxRendererFragment({ data, config, components, transformList }) {
  const result = useMemo(() => {
    try {
      return {
        content: markdownFragmentRender({
          nodeList: data.nodeList,
          transformList,
          components,
          isInline: config.contentMode === 'inline',
        }),
      };
    } catch (error) {
      return { message: String(error?.message ?? error) };
    }
  }, [components, config.contentMode, data.nodeList, transformList]);
  if (result.message !== undefined) {
    return <span role="alert">{config.textError ?? 'Failed to render Markdown.'} {result.message}</span>;
  }
  return result.content;
}

const MdxRendererText = observer(function MdxRendererText({ data, config, components, transformList }) {
  const [store] = useState(() => new MdxRendererStore());
  const source = String(data.source ?? '');
  const format = config.isExpressionAllowed === true ? 'mdx' : 'md';

  useEffect(() => {
    void store.compile({ source, format, remarkPlugins: transformList });
  }, [format, source, store, transformList]);

  if (store.status === 'empty') return config.textEmpty ?? '';
  if (store.status === 'error') {
    return <span role="alert">{config.textError ?? 'Failed to render Markdown.'} {store.message}</span>;
  }
  if (store.status !== 'done' || !store.Body) return null;
  const Body = store.Body;
  return <Body components={components} />;
});
