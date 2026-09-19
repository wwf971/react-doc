import { useId } from 'react';
import {
  blockSimpleIsTitleHiddenGet,
  blockSimpleTitleGet,
  blockSimpleToneGet,
} from './BlockSimpleState.js';
import './BlockSimple.css';

const alertMarkerPattern = /^\[!(?:CAUTION|WARNING|INFO|NOTE|ERROR|TIP|IMPORTANT|SUCCESS)\]$/i;
const toneAlertSet = new Set(['warning', 'caution', 'error']);

function BlockSimple({ data = {}, config = {}, onEvent }) {
  const titleId = useId();
  const MdxRenderer = config.MdxRenderer;
  if (!MdxRenderer) {
    return <div className="doc-mdx-block-simple-error" role="alert">BlockSimple requires config.MdxRenderer.</div>;
  }

  const source = String(data.raw ?? '')
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''))
    .filter((line) => !alertMarkerPattern.test(line.trim()))
    .join('\n')
    .trim();
  const tone = blockSimpleToneGet(data);
  const title = blockSimpleTitleGet(data, tone);
  const isTitleHidden = blockSimpleIsTitleHiddenGet(data);

  return (
    <aside
      className={`doc-mdx-block-simple is-${tone}`}
      role={toneAlertSet.has(tone) ? 'alert' : 'note'}
      aria-labelledby={isTitleHidden ? undefined : titleId}
    >
      {isTitleHidden ? null : <div id={titleId} className="doc-mdx-block-simple-title">{title}</div>}
      <MdxRenderer
        data={{ source }}
        config={{
          className: 'doc-mdx-block-simple-content',
          isExpressionAllowed: false,
          textEmpty: '（内容なし）',
        }}
        onEvent={onEvent}
      />
    </aside>
  );
}

export { BlockSimple };
