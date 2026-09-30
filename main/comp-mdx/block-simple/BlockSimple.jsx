import { useEffect, useId, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Copy } from '#react-doc/frontend/UICommon.js';
import {
  blockSimpleIsCopyEnabledGet,
  blockSimpleIsTitleHiddenGet,
  blockSimpleSourceGet,
  blockSimpleTitleGet,
  blockSimpleToneGet,
} from './BlockSimpleState.js';
import { BlockSimpleStore } from './BlockSimpleStore.js';
import './BlockSimple.css';

const toneAlertSet = new Set(['warning', 'caution', 'error']);
const copyLabelByStatus = {
  idle: '内容をコピー',
  copied: 'コピーしました',
  failed: 'コピーできませんでした',
};

// Events emitted:
//   copyRequest { text }   copy of the normalized body; a result with
//                          isHandled: true skips the browser clipboard
const BlockSimple = observer(function BlockSimple({ data = {}, config = {}, onEvent }) {
  const titleId = useId();
  const [store] = useState(() => new BlockSimpleStore());
  useEffect(() => () => store.dispose(), [store]);

  const MdxRenderer = config.MdxRenderer;
  if (!MdxRenderer) {
    return <div className="doc-mdx-block-simple-error" role="alert">BlockSimple requires config.MdxRenderer.</div>;
  }

  const source = blockSimpleSourceGet(data);
  const tone = blockSimpleToneGet(data);
  const title = blockSimpleTitleGet(data, tone);
  const isTitleHidden = blockSimpleIsTitleHiddenGet(data);
  const isCopyEnabled = blockSimpleIsCopyEnabledGet(data);
  const copyLabel = copyLabelByStatus[store.copyStatus] ?? copyLabelByStatus.idle;

  const sourceCopy = async () => {
    const result = await onEvent?.('copyRequest', { text: source });
    if (result?.isHandled) return;
    try {
      await navigator.clipboard.writeText(source);
      store.copyStatusSet('copied');
    } catch {
      store.copyStatusSet('failed');
    }
  };

  return (
    <aside
      className={`doc-mdx-block-simple is-${tone}`}
      role={toneAlertSet.has(tone) ? 'alert' : 'note'}
      aria-labelledby={isTitleHidden ? undefined : titleId}
    >
      {isTitleHidden ? null : (
        <div className="doc-mdx-block-simple-title">
          <span id={titleId} className="doc-mdx-block-simple-title-text">{title}</span>
          {isCopyEnabled ? (
            <button
              type="button"
              className={`doc-mdx-block-simple-copy is-${store.copyStatus}`}
              title={copyLabel}
              aria-label={copyLabel}
              onClick={() => void sourceCopy()}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}
      <MdxRenderer
        data={{ source }}
        config={{
          className: 'doc-mdx-block-simple-content',
          isExpressionAllowed: false,
          sourcePath: config.sourcePath,
          textEmpty: '（内容なし）',
        }}
        onEvent={onEvent}
      />
    </aside>
  );
});

export { BlockSimple };
