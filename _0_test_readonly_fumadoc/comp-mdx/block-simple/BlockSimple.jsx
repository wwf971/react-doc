import './BlockSimple.css';

const toneSet = new Set(['info', 'note', 'warning', 'caution']);

function BlockSimple({ data = {}, config = {}, onEvent }) {
  const MdxRenderer = config.MdxRenderer;
  if (!MdxRenderer) {
    return <div className="doc-mdx-block-simple-error" role="alert">BlockSimple requires config.MdxRenderer.</div>;
  }

  const source = String(data.raw ?? '')
    .split('\n')
    .map((line) => line.replace(/^> ?/, ''))
    .filter((line) => !/^\[!(?:CAUTION|WARNING|INFO|NOTE)\]$/i.test(line.trim()))
    .join('\n')
    .trim();
  const toneInput = String(data.type ?? data.tone ?? 'info').trim().toLowerCase();
  const tone = toneSet.has(toneInput) ? toneInput : 'info';

  return (
    <aside className={`doc-mdx-block-simple is-${tone}`} role={tone === 'warning' ? 'alert' : 'note'}>
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
