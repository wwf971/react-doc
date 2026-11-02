import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { PageToc } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { DocLanguageProvider } from '../../../built-in/comp-mdx/multi-lang/MultiLangContext.jsx';
import { BacklinkPanel } from './BacklinkPanel.jsx';
import { usePanelHeightAvailable } from './use-panel-height-available.js';
import './DocPageToc.css';

// The right column beside the document (doc_page_impl.md#semantic-parts-and-hosted-indexes):
// the headings of the page (the native TOC), the hosted index of the part
// the document is in, or the backlinks of the document
// (doc_page_impl_nav_backlink.md#the-backlinks-panel), chosen with one
// segmented control. without the host's segmented control, or with neither
// a part index nor a link index, the native TOC stands alone.
const DocPageToc = observer(function DocPageToc(props) {
  const { componentConfig, docStore, linkStore } = useDocStores();
  const SegmentedControl = componentConfig.SegmentedControl;
  const part = docStore.partCurrent;
  const indexRef = part?.index;
  const isPartAvailable = Boolean(
    docStore.isPartIndexEnabled
    && indexRef?.docId
    && indexRef?.componentId
  );
  const isBacklinkAvailable = linkStore.isEnabled && linkStore.isIndexAvailable;
  const isControlAvailable = Boolean(SegmentedControl) && (isPartAvailable || isBacklinkAvailable);

  useEffect(() => {
    if (isPartAvailable) void docStore.partIndexLoadCurrent();
  }, [docStore, indexRef?.componentId, indexRef?.docId, isPartAvailable, part?.id]);

  if (!isControlAvailable) return <PageToc {...props} />;

  const language = docStore.languageSelected || 'en';
  const labels = labelSetGet(language);
  // the mode chosen is kept across documents; one not available beside
  // this document shows the page headings meanwhile
  const modeChosen = docStore.tocContentModeCurrent;
  const mode = (modeChosen === 'part' && !isPartAvailable) || (modeChosen === 'backlink' && !isBacklinkAvailable)
    ? 'page'
    : modeChosen;
  const control = (
    <div className="doc-part-index-source-control" role="group" aria-label={labels.navigationScope}>
      <SegmentedControl
        data={{
          valueSelected: mode,
          segList: [
            { value: 'page', labelText: labels.onThisPage },
            ...(isPartAvailable ? [{ value: 'part', labelText: labels.inThisPart }] : []),
            ...(isBacklinkAvailable ? [{ value: 'backlink', labelText: labels.backlinks }] : []),
          ],
        }}
        config={{
          classNameTrack: 'doc-part-index-source-segments',
          isInitialAnimationEnabled: true,
          widthModeSegment: 'auto',
        }}
        onEvent={(eventType, eventData) => {
          if (eventType === 'valueSelectedChange') {
            docStore.tocContentModeSet(eventData.valueSelected);
          }
        }}
      />
    </div>
  );

  const classNameContainer = [
    props.container?.className,
    'doc-page-toc',
    `is-mode-${mode}`,
  ].filter(Boolean).join(' ');
  return (
    <PageToc
      {...props}
      container={{ ...props.container, className: classNameContainer }}
      header={(
        <>
          {props.header}
          {control}
          {isPartAvailable ? (
            <PartIndexPanel
              isVisible={mode === 'part'}
              key={`${part.id}:${indexRef.docId}:${indexRef.componentId}`}
              labels={labels}
            />
          ) : null}
          {isBacklinkAvailable ? <BacklinkPanel isVisible={mode === 'backlink'} labels={labels} /> : null}
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
  usePanelHeightAvailable(refPanel, {
    isVisible,
    isFloating: displayMode === 'floating',
    dependencyList: [floatingLayout?.top, result?.status],
  });

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
      className={`doc-toc-panel doc-part-index-panel is-display-${displayMode}`}
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
      backlinks: 'バックリンク',
      backlinkNone: 'バックリンクはありません',
      backlinkNoneHint: '他の文書からこの文書へのリンクはありません。',
      backlinkNotNavigable: 'この文書はサイドパネルにありません',
      backlinkOpen: 'リンクが書かれている箇所を開く',
      backlinkSummaryGet: (count, docCount) => `${docCount} 件の文書から ${count} 件のリンク`,
      backlinkToPlace: 'このリンクが指す箇所へ移動',
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
    backlinks: 'Backlinks',
    backlinkNone: 'No backlinks',
    backlinkNoneHint: 'No other document links to this one yet.',
    backlinkNotNavigable: 'This document is not in the side panel',
    backlinkOpen: 'Open the document where this link is written',
    backlinkSummaryGet: (count, docCount) => (
      `${count} backlink${count === 1 ? '' : 's'} from ${docCount} document${docCount === 1 ? '' : 's'}`
    ),
    backlinkToPlace: 'Go to the place this link points to',
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
