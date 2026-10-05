import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { buildMdxComps } from '../../frontend/src/lib/mdx-comps.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { BlockRenderStore } from './BlockRenderStore.js';
import './text-block.css';

// Renders the source text of one or more root-level blocks exactly as the
// document body renders them: same compile configuration (comment components,
// links, math), same component mapping. The non-edit side of the default
// text components uses it, and the edit layer shows a just-saved block with
// it until the document is compiled again.
//
//   data.text          source text of the blocks
//   config.sourcePath  document the text belongs to (relative links, components)
//   config.format      'md' (default) | 'mdx'
//   config.textEmpty   shown when the text is blank
//   children           shown until the first compile is done (the block as it
//                      is already rendered), so nothing collapses meanwhile
export const BlockRender = observer(function BlockRender({ data = {}, config = {}, children }) {
  const { compById, sourceStore } = useDocStores();
  const [store] = useState(() => new BlockRenderStore());
  const text = String(data.text ?? '');
  const format = config.format === 'mdx' ? 'mdx' : 'md';
  const sourcePath = config.sourcePath ?? '';
  const components = useMemo(
    () => buildMdxComps(sourceStore.configDoc, compById, { sourcePath }),
    [compById, sourceStore.configDoc, sourcePath],
  );

  useEffect(() => {
    void store.compile({ text, format, internalPath: sourcePath, compileConfig: sourceStore.compileConfig });
  }, [format, sourcePath, sourceStore.compileConfig, store, text]);

  const Body = store.Body;
  if (!Body && store.status !== 'error') {
    if (store.status === 'empty' && text.trim() === '') {
      return config.textEmpty ? <p className="doc-block-render-empty">{config.textEmpty}</p> : null;
    }
    return children ?? null;
  }
  return (
    <>
      {store.status === 'error' ? (
        <p className="doc-block-render-error" role="alert">{store.message}</p>
      ) : null}
      {Body ? <Body components={components} /> : null}
    </>
  );
});
