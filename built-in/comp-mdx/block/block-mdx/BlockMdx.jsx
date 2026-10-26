import { useId, useMemo } from 'react';
import { RegisteredComp } from '../../../../main/comp-doc/registry/RegisteredComp.jsx';
import {
  blockMdxIsContentSanitizedGet,
  blockMdxStyleGet,
  blockMdxTitleComponentPropsGet,
} from './BlockMdxData.js';
import './BlockMdx.css';

const toneSet = new Set(['default', 'info', 'warning']);

// Panel that renders authored Markdown through the package MdxRenderer, so
// links inside it behave exactly as in the document body.
//   data.titleComponent       optional registry name shown before the title,
//                             placement blockTitle (the definition opts in)
//   data.titleComponentProps  authored props of that component
function BlockMdx({ data = {}, config = {}, onEvent }) {
  const titleId = useId();
  const MdxRenderer = config.MdxRenderer;
  const title = String(data.title ?? '関連資料').trim();
  const toneInput = String(data.tone ?? 'default');
  const tone = toneSet.has(toneInput) ? toneInput : 'default';
  const titleComponentName = String(data.titleComponent ?? '').trim();
  const titleComponentProps = useMemo(
    () => blockMdxTitleComponentPropsGet(data.titleComponentProps),
    [data.titleComponentProps],
  );

  if (!MdxRenderer) {
    return <div className="doc-mdx-block-mdx-error" role="alert">BlockMdx requires config.MdxRenderer.</div>;
  }

  return (
    <aside
      className={`doc-mdx-block-mdx is-${tone}`}
      style={blockMdxStyleGet(data)}
      aria-labelledby={title ? titleId : undefined}
    >
      {titleComponentName ? (
        <div className="doc-mdx-block-mdx-title">
          <span className="doc-mdx-block-mdx-title-comp">
            <RegisteredComp
              compName={titleComponentName}
              configRuntime={{
                instanceId: `${config.instanceId ?? 'block-mdx'}:title`,
                sourcePath: config.sourcePath,
              }}
              input={{ propsAuthored: titleComponentProps }}
              placement="blockTitle"
            />
          </span>
          {title ? <span id={titleId}>{title}</span> : null}
        </div>
      ) : title ? (
        <div id={titleId} className="doc-mdx-block-mdx-title">{title}</div>
      ) : null}
      <MdxRenderer
        data={{ source: data.raw ?? '' }}
        config={{
          className: 'doc-mdx-block-mdx-content',
          isContentSanitized: blockMdxIsContentSanitizedGet(data),
          isExpressionAllowed: false,
          sourcePath: config.sourcePath,
          textEmpty: '（内容なし）',
          textError: 'ブロック内の Markdown を表示できません。',
        }}
        onEvent={onEvent}
      />
    </aside>
  );
}

export { BlockMdx };
