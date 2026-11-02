import { useEffect, useId, useState } from 'react';
import { ChevronDown } from '../../../../main/frontend/UICommon.js';
import { useDocEventSubscribe } from '../../../../main/comp-doc/registry/use-doc-event.js';
import { blockQADataParse } from './BlockQAData.js';
import './BlockQA.css';

function BlockQA({ data = {}, config = {}, onEvent }) {
  const titleId = useId();
  const MdxRenderer = config.MdxRenderer;
  const sourcePath = String(config.sourcePath ?? '');
  // the item asked to show its answer: a navigation to a reference written
  // in a folded answer (a backlink followed here,
  // doc_page_impl_event.md#events-delivered-to-components) unfolds it
  const [reveal, revealSet] = useState({ index: -1, seq: 0 });
  useDocEventSubscribe(config, 'placeReveal', (eventData) => {
    const target = String(eventData.target ?? '');
    if (!target) return undefined;
    let items;
    try {
      items = blockQADataParse(data).items;
    } catch {
      return undefined;
    }
    const index = items.findIndex((item) => (
      String(item.answer?.content ?? '').includes(target) || String(item.question?.content ?? '').includes(target)
    ));
    if (index < 0) return undefined;
    revealSet((previous) => ({ index, seq: previous.seq + 1 }));
    return { code: 0 };
  });

  if (!MdxRenderer) {
    return <div className="block-qa-error" role="alert">BlockQA requires config.MdxRenderer.</div>;
  }

  let value;
  try {
    value = blockQADataParse(data);
  } catch (error) {
    return <div className="block-qa-error" role="alert">{String(error.message ?? error)}</div>;
  }

  return (
    <section className="block-qa" aria-labelledby={value.title ? titleId : undefined}>
      {value.title ? <div id={titleId} className="block-qa-title">{value.title}</div> : null}
      <div className="block-qa-items">
        {value.items.map((item, index) => (
          <BlockQAItem
            isCollapsible={value.isCollapsible}
            item={item}
            key={index}
            MdxRenderer={MdxRenderer}
            onEvent={onEvent}
            revealSeq={reveal.index === index ? reveal.seq : 0}
            sourcePath={sourcePath}
          />
        ))}
      </div>
    </section>
  );
}

function BlockQAItem({ isCollapsible, item, MdxRenderer, onEvent, revealSeq = 0, sourcePath }) {
  const answerId = useId();
  const [isExpandedState, setIsExpandedState] = useState(item.isExpanded);
  // every reveal request opens the answer, also one already answered
  useEffect(() => {
    if (revealSeq > 0) setIsExpandedState(true);
  }, [revealSeq]);
  const isExpanded = !isCollapsible || isExpandedState;
  const classNameItem = `block-qa-item${isExpanded ? ' is-expanded' : ' is-collapsed'}`;
  const classNameQuestion = `block-qa-row is-question${isCollapsible ? ' is-collapsible' : ''}`;

  return (
    <article className={classNameItem}>
      <div className={classNameQuestion}>
        <span className="block-qa-label" aria-hidden="true">Q</span>
        <ContentRender
          className="block-qa-question"
          contentData={item.question}
          MdxRenderer={MdxRenderer}
          onEvent={onEvent}
          sourcePath={sourcePath}
        />
        {isCollapsible ? (
          <button
            aria-controls={answerId}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? '回答を折りたたむ' : '回答を展開する'}
            className="block-qa-toggle"
            onClick={() => setIsExpandedState((isExpandedPrevious) => !isExpandedPrevious)}
            title={isExpanded ? '回答を折りたたむ' : '回答を展開する'}
            type="button"
          >
            <ChevronDown aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <div className="block-qa-row is-answer" hidden={!isExpanded} id={answerId}>
        <span className="block-qa-label" aria-hidden="true">A</span>
        <ContentRender
          className="block-qa-answer"
          contentData={item.answer}
          MdxRenderer={MdxRenderer}
          onEvent={onEvent}
          sourcePath={sourcePath}
        />
      </div>
    </article>
  );
}

function ContentRender({ className, contentData, MdxRenderer, onEvent, sourcePath }) {
  if (contentData.type === 'text') {
    return <p className={`${className} block-qa-text`}>{contentData.content}</p>;
  }
  return (
    <MdxRenderer
      data={{ source: contentData.content }}
      config={{
        className,
        isExpressionAllowed: false,
        sourcePath,
        textEmpty: '（内容なし）',
        textError: 'Q&A の Markdown を表示できません。',
      }}
      onEvent={onEvent}
    />
  );
}

export { BlockQA };
