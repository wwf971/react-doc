import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { PageToc } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
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
  const { componentConfig, docStore } = useDocStores();
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

    let frameId = 0;
    const sizeUpdate = () => {
      frameId = 0;
      const rect = panel.getBoundingClientRect();
      const heightAvailable = Math.max(96, window.innerHeight - rect.top - 16);
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
    // the docked panel moves until its sticky TOC column settles
    window.addEventListener('scroll', sizeUpdateSchedule, true);
    if (panel.parentElement) observer?.observe(panel.parentElement);
    return () => {
      window.removeEventListener('resize', sizeUpdateSchedule);
      window.removeEventListener('scroll', sizeUpdateSchedule, true);
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
      <RegisteredComp
        compDefinition={result.definition}
        compId={result.compId}
        configRuntime={{
          displayMode,
          displayModeSegList: [
            { value: 'docked', labelText: labels.docked },
            { value: 'floating', labelText: labels.floating },
          ],
          instanceId: `part-index:${part.id}:${result.component.id}`,
          isDisplayModeControlEnabled: docStore.isPartIndexFloatingEnabled,
          isPartRootCurrent: docStore.itemCurrent?.id === part.id,
          navigation: docStore.navigationRuntime,
          SegmentedControl: componentConfig.SegmentedControl,
        }}
        input={result.component.input}
        onEventRuntime={(eventType, eventData) => {
          if (eventType !== 'displayModeChange') return undefined;
          if (eventData.displayMode === 'floating') floatingLayoutPrepare();
          const isAccepted = docStore.partIndexDisplayModeSet(eventData.displayMode);
          return { isHandled: true, isAccepted };
        }}
        placement="partIndex"
      />
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
