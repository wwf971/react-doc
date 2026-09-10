import { useId, useMemo } from 'react';
import { remarkBlockMdxDocLink } from './remarkBlockMdxDocLink.js';
import './BlockMdx.css';

const toneSet = new Set(['default', 'info', 'warning']);

function BlockMdx({ data = {}, config = {}, onEvent }) {
  const titleId = useId();
  const DocLink = config.DocLink;
  const MdxRenderer = config.MdxRenderer;
  const sourcePath = String(config.sourcePath ?? '');
  const remarkPlugins = useMemo(
    () => [[remarkBlockMdxDocLink, { sourcePath }]],
    [sourcePath],
  );
  const components = useMemo(() => (DocLink ? { DocLink } : {}), [DocLink]);
  const title = String(data.title ?? '関連資料').trim();
  const toneInput = String(data.tone ?? 'default');
  const tone = toneSet.has(toneInput) ? toneInput : 'default';

  if (!DocLink || !MdxRenderer) {
    return <div className="doc-mdx-block-mdx-error" role="alert">BlockMdx requires config.DocLink and config.MdxRenderer.</div>;
  }

  return (
    <aside className={`doc-mdx-block-mdx is-${tone}`} aria-labelledby={title ? titleId : undefined}>
      {title ? <div id={titleId} className="doc-mdx-block-mdx-title">{title}</div> : null}
      <MdxRenderer
        data={{ source: data.raw ?? '' }}
        config={{
          className: 'doc-mdx-block-mdx-content',
          components,
          isExpressionAllowed: false,
          remarkPlugins,
          textEmpty: '（内容なし）',
          textError: 'ブロック内の Markdown を表示できません。',
        }}
        onEvent={onEvent}
      />
    </aside>
  );
}

export { BlockMdx };
