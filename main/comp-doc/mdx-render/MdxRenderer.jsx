import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { defaultMdxComponents } from '../../frontend/UICommon.js';
import { MdxRendererStore } from './MdxRendererStore.js';

// Renders one authored Markdown string compiled in the browser. Components
// that display Markdown inside themselves (BlockSimple, BlockMdx) receive it
// through config.MdxRenderer, so they do not depend on the compile pipeline.
//
//   data.source                   Markdown text
//   config.className              class of the content wrapper
//   config.components             extra MDX components, e.g. { DocLink }
//   config.isExpressionAllowed    true compiles as mdx; otherwise plain md
//   config.remarkPlugins          extra remark plugins (keep the array stable)
//   config.textEmpty / textError  messages for empty source / compile failure
export const MdxRenderer = observer(function MdxRenderer({ data = {}, config = {} }) {
  const [store] = useState(() => new MdxRendererStore());
  const source = String(data.source ?? '');
  const format = config.isExpressionAllowed === true ? 'mdx' : 'md';
  const remarkPlugins = config.remarkPlugins;
  const components = useMemo(
    () => ({ ...defaultMdxComponents, ...(config.components ?? {}) }),
    [config.components],
  );

  useEffect(() => {
    void store.compile({ source, format, remarkPlugins });
  }, [format, remarkPlugins, source, store]);

  if (store.status === 'empty') {
    return <div className={config.className}>{config.textEmpty ?? ''}</div>;
  }
  if (store.status === 'error') {
    return (
      <div className={config.className} role="alert">
        {config.textError ?? 'Failed to render Markdown.'} {store.message}
      </div>
    );
  }
  if (store.status !== 'done' || !store.Body) {
    return <div className={config.className} />;
  }
  const Body = store.Body;
  return (
    <div className={config.className}>
      <Body components={components} />
    </div>
  );
});
