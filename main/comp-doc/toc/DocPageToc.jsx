import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { PageToc } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { DocLanguageProvider } from '../../comp-mdx/multi-lang/MultiLangContext.jsx';
import './DocPageToc.css';

const DocPageToc = observer(function DocPageToc(props) {
  const { componentConfig, docStore } = useDocStores();
  const SegmentedControl = componentConfig.SegmentedControl;
  const part = docStore.partCurrent;
  const indexRef = part?.index;
  const isAvailable = Boolean(
    docStore.isPartIndexEnabled
    && SegmentedControl
    && indexRef?.docId
    && indexRef?.componentId
  );

  useEffect(() => {
    if (isAvailable) void docStore.partIndexLoadCurrent();
  }, [docStore, indexRef?.componentId, indexRef?.docId, isAvailable, part?.id]);

  if (!isAvailable) return <PageToc {...props} />;

  const language = docStore.languageSelected || 'en';
  const labels = labelSetGet(language);
  const control = (
    <div className="doc-part-index-source-control" role="group" aria-label={labels.navigationScope}>
      <SegmentedControl
        data={{
          valueSelected: docStore.partIndexContentModeCurrent,
          segList: [
            { value: 'page', labelText: labels.onThisPage },
            { value: 'part', labelText: labels.inThisPart },
          ],
        }}
        config={{
          classNameTrack: 'doc-part-index-source-segments',
          isInitialAnimationEnabled: true,
          widthModeSegment: 'auto',
        }}
        onEvent={(eventType, eventData) => {
          if (eventType === 'valueSelectedChange') {
            docStore.partIndexContentModeSet(eventData.valueSelected);
          }
        }}
      />
    </div>
  );

  const isPartMode = docStore.partIndexContentModeCurrent === 'part';
  const classNameContainer = [
    props.container?.className,
    'doc-page-toc',
    isPartMode ? 'is-part-mode' : '',
  ].filter(Boolean).join(' ');
  return (
    <PageToc
      {...props}
      container={{ ...props.container, className: classNameContainer }}
      header={(
        <>
          {props.header}
          {control}
          <PartIndexPanel
            isVisible={isPartMode}
            key={`${part.id}:${indexRef.docId}:${indexRef.componentId}`}
            labels={labels}
          />
        </>
      )}
    />
  );
});

const PartIndexPanel = observer(function PartIndexPanel({ isVisible, labels }) {
  const { componentConfig, configStore, docStore } = useDocStores();
  const part = docStore.partCurrent;
  const result = docStore.partIndexQueryCurrent;
  const displayMode = docStore.partIndexDisplayModeCurrent;
  const floatingLayout = docStore.partIndexFloatingLayoutCurrent;
  const refPanel = useRef(null);
  const refDrag = useRef(null);

  // the panel is the scroll owner of a tall index: its max height is the
  // space between its own top edge and the bottom of the window, docked or
  // floating (the floating top follows dragging). the docked width is also
  // bounded by the window; the floating width comes from its saved layout.
  useEffect(() => {
    const panel = refPanel.current;
    if (!isVisible || !panel) return undefined;
    // docked: the height is computed from the document scrollport and the
    // panel's fixed offset inside the sticky TOC column, never from where
    // the panel happens to be in the viewport. at the document bottom the
    // sticky column moves up to stay inside its containing block; measuring
    // the viewport position there would grant the panel more height, push
    // the column further up, and repeat until the index reaches its full
    // content height.
    const column = displayMode === 'floating' ? null : panel.closest('.doc-page-toc');
    const scrollContainer = column?.closest('.doc-page-mdx');

    let frameId = 0;
    const sizeUpdate = () => {
      frameId = 0;
      const rect = panel.getBoundingClientRect();
      const heightAvailable = column
        ? Math.max(
          96,
          (scrollContainer?.clientHeight ?? window.innerHeight)
            - (parseFloat(window.getComputedStyle(column).top) || 0)
            - (rect.top - column.getBoundingClientRect().top)
            - 16,
        )
        : Math.max(96, window.innerHeight - rect.top - 16);
      panel.style.setProperty('--doc-part-index-height-available', `${heightAvailable}px`);
      if (displayMode !== 'floating') {
        const widthAvailable = Math.max(0, window.innerWidth - rect.left - 16);
        panel.style.setProperty('--doc-part-index-width-available', `${widthAvailable}px`);
      }
    };
    const sizeUpdateSchedule = () => {
      if (!frameId) frameId = requestAnimationFrame(sizeUpdate);
    };
    const observer = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(sizeUpdateSchedule);
    sizeUpdate();
    window.addEventListener('resize', sizeUpdateSchedule);
    if (panel.parentElement) observer?.observe(panel.parentElement);
    if (scrollContainer) observer?.observe(scrollContainer);
    return () => {
      window.removeEventListener('resize', sizeUpdateSchedule);
      observer?.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [displayMode, floatingLayout?.top, isVisible, result?.status]);

  const floatingLayoutPrepare = () => {
    const panel = refPanel.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const width = Math.min(rect.width, Math.max(1, window.innerWidth - 32));
    const layoutPrevious = docStore.partIndexFloatingLayoutCurrent;
    docStore.partIndexFloatingLayoutSet({
      left: Math.min(
        Math.max(0, layoutPrevious?.left ?? window.innerWidth - width - 16),
        Math.max(0, window.innerWidth - width),
      ),
      top: Math.min(
        Math.max(0, layoutPrevious?.top ?? 16),
        Math.max(0, window.innerHeight - 32),
      ),
      width,
    });
  };

  const dragStart = (event) => {
    if (
      displayMode !== 'floating'
      || event.button !== 0
      || !event.currentTarget.contains(event.target)
      || event.target.closest(
        'a, button, input, select, textarea, [role="button"], [role="link"], .doc-index-title, .doc-index-subtopic-title',
      )
    ) return;
    const panel = event.currentTarget;
    const rect = panel.getBoundingClientRect();
    refDrag.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      panelLeft: rect.left,
      panelTop: rect.top,
      panelWidth: rect.width,
      panelHeight: rect.height,
    };
    panel.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const dragMove = (event) => {
    const drag = refDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const leftMax = Math.max(0, window.innerWidth - drag.panelWidth);
    const topMax = Math.max(0, window.innerHeight - Math.min(drag.panelHeight, 32));
    docStore.partIndexFloatingLayoutSet({
      left: Math.min(leftMax, Math.max(0, drag.panelLeft + event.clientX - drag.pointerX)),
      top: Math.min(topMax, Math.max(0, drag.panelTop + event.clientY - drag.pointerY)),
      width: drag.panelWidth,
    });
    event.preventDefault();
  };

  const dragEnd = (event) => {
    if (refDrag.current?.pointerId !== event.pointerId) return;
    refDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!result || result.status === 'loading') {
    return <div className="doc-part-index-status" hidden={!isVisible}>{labels.loading}</div>;
  }
  if (result.status === 'error') {
    return <div className="doc-part-index-status is-error" hidden={!isVisible} role="alert">{result.message}</div>;
  }
  if (result.componentType !== 'index') {
    return (
      <div className="doc-part-index-status is-error" hidden={!isVisible} role="alert">
        {labels.notIndex}: {result.component.compName}
      </div>
    );
  }

  const panel = (
    <div
      ref={refPanel}
      className={`doc-part-index-panel is-display-${displayMode}`}
      hidden={!isVisible}
      style={displayMode === 'floating' && floatingLayout
        ? {
          left: floatingLayout.left,
          right: 'auto',
          top: floatingLayout.top,
          width: floatingLayout.width,
        }
        : undefined}
      onPointerDown={dragStart}
      onPointerMove={dragMove}
      onPointerUp={dragEnd}
      onPointerCancel={dragEnd}
    >
      {/* the index keeps its own language and the config of its own document,
          whichever document is visible beside it */}
      <DocLanguageProvider language={docStore.partIndexLanguageCurrent}>
        <RegisteredComp
          compDefinition={result.definition}
          compId={result.compId}
          configRuntime={{
            configDocOverride: configStore.configPartIndexOverrideGet(part.id),
            displayMode,
            displayModeSegList: [
              { value: 'docked', labelText: labels.docked },
              { value: 'floating', labelText: labels.floating },
            ],
            instanceId: `part-index:${part.id}:${result.component.id}`,
            isDisplayModeControlEnabled: docStore.isPartIndexFloatingEnabled,
            isLanguageControlEnabled: true,
            isPartRootCurrent: docStore.itemCurrent?.id === part.id,
            languageSegList: docStore.partIndexLanguageListCurrent
              .map((language) => ({ value: language, labelText: language })),
            languageSelected: docStore.partIndexLanguageCurrent,
            navigation: docStore.navigationRuntime,
            SegmentedControl: componentConfig.SegmentedControl,
            sourcePath: result.docPath,
          }}
          input={result.component.input}
          onEventRuntime={(eventType, eventData) => {
            if (eventType === 'languageChange') {
              const isAccepted = docStore.partIndexLanguageSet(eventData.language);
              return isAccepted ? { code: 0 } : { code: -1, message: 'not accepted' };
            }
            if (eventType !== 'displayModeChange') return undefined;
            if (eventData.displayMode === 'floating') floatingLayoutPrepare();
            const isAccepted = docStore.partIndexDisplayModeSet(eventData.displayMode);
            return isAccepted ? { code: 0 } : { code: -1, message: 'not accepted' };
          }}
          placement="partIndex"
        />
      </DocLanguageProvider>
    </div>
  );
  return displayMode === 'floating' && typeof document !== 'undefined'
    ? createPortal(panel, document.body)
    : panel;
});

function labelSetGet(language) {
  if (language === 'jp' || language === 'ja') {
    return {
      docked: '固定',
      floating: 'フローティング',
      inThisPart: 'この章',
      loading: 'パート索引を読み込んでいます…',
      navigationScope: 'ナビゲーション範囲',
      notIndex: '参照されたコンポーネントは索引ではありません',
      onThisPage: 'この記事',
    };
  }
  return {
    docked: 'Docked',
    floating: 'Floating',
    inThisPart: 'In this part',
    loading: 'Loading part index…',
    navigationScope: 'Navigation scope',
    notIndex: 'The referenced component is not an index',
    onThisPage: 'On this page',
  };
}

export { DocPageToc };
