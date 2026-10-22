import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ChevronDown, ChevronRight, LoaderCircle } from '../../frontend/UICommon.js';
import { blockPlaceNodeListBuild, blockPlaceTextGet } from '../../frontend/src/lib/doc-block-place.js';
import { BlockListReview } from '../block-list/BlockListReview.jsx';
import { BlockPlacePicker } from '../block-list/BlockPlacePicker.jsx';
import { blockLabelGet } from '../edit/DocEditBlockEditor.jsx';
import { usePanelLayout } from '../popup/use-panel-layout.js';
import { EditSourceSurface } from '../edit/EditSourceSurface.jsx';
import './DocPaste.css';

// the dialog moves by its header and resizes by its edges; a resized size
// is kept for its next opening (DocPanelLayoutStore)
const panelLayoutOption = { isMovable: true, isResizable: true, isSizeRemembered: true };

// The review of a paste (doc_page_impl_copy_paste.md#the-review-dialog),
// open while DocPasteStore.review is set. The frame is the host's text panel
// component (config.compConfigHost.panelComponent), as for the asset panel.
//
//   ┌ Paste as blocks ─────────────────────────────────────────── × ┐
//   │ Blocks (3)  ▸ Pasted text          │ Insert into              │
//   │ [Paragraph] [👁]                   │ Document [~example/a.md] │
//   │ A paragraph with **bold**.         │ ▾ 🗎 a.md                │
//   │ [List] [👁]                        │     ¶ Title     Heading  │
//   │ - one                              │ [Before] [After] …       │
//   │ - two                              │ The blocks go after “…”. │
//   │ ───────────────────────────────────────────────────────────── │
//   │ message                                     [Cancel] [Insert] │
//   └───────────────────────────────────────────────────────────────┘
//
// "Pasted text" opens the text itself, editable (an empty review opens with
// it, for the author to paste into). Escape or Cancel closes the dialog
// and nothing is written; Insert (or Ctrl/Cmd + Enter in the text) writes
// the blocks at the chosen place.
export const DocPastePopup = observer(function DocPastePopup() {
  const { pasteStore, sourceStore, compConfigHost } = useDocStores();
  const Panel = compConfigHost.panelComponent;
  const review = pasteStore?.review;
  const isOpen = Boolean(Panel) && pasteStore?.isOpen === true;

  useEffect(() => {
    if (!isOpen) return undefined;
    // a control that takes Escape itself (the document path restores its
    // text) prevents the default; the dialog stays open then
    const keyDownHandle = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) pasteStore.close();
    };
    window.addEventListener('keydown', keyDownHandle);
    return () => window.removeEventListener('keydown', keyDownHandle);
  }, [isOpen, pasteStore]);

  const panelLayout = usePanelLayout('paste', isOpen, panelLayoutOption);

  if (!isOpen) return null;
  const result = pasteStore.result;
  const isSubmitting = review.status === 'submitting';
  const blockListShown = result.blockList.map((block) => ({ ...block, label: blockLabelGet(block) }));
  const placeBlockList = pasteStore.placeBlockList;
  const docPath = review.place.docPath;
  const docEntry = sourceStore.entryByInternalPath.get(docPath);
  const nodeList = placeBlockList
    ? blockPlaceNodeListBuild({ docLabel: docEntry?.name ?? docPath, blockList: placeBlockList, labelGet: blockLabelGet })
    : undefined;
  const transformLabelList = result.transformAppliedIdList.map((id) => {
    const transform = pasteStore.transformList.find((item) => item.id === id);
    return transform?.label || id;
  });
  const insertDisabledReason = pasteStore.insertDisabledReason;

  return (
    <Panel
      data={{ title: 'Paste as blocks' }}
      config={{
        isPopup: true,
        isCloseVisible: true,
        ...panelLayout.config,
        className: 'doc-paste-popup',
        bodyClassName: 'doc-paste-popup-body',
      }}
      content={(
        <div className="doc-paste-popup-content">
          <div className="doc-paste-popup-main">
            <section className="doc-paste-popup-blocks" aria-label="The blocks to insert">
              <div className="doc-paste-popup-section-head">
                <span className="doc-paste-popup-section-title">Blocks ({result.blockList.length})</span>
                <button
                  type="button"
                  className="doc-paste-popup-source-toggle"
                  aria-expanded={review.isSourceOpen}
                  onClick={() => pasteStore.sourceToggle()}
                >
                  {review.isSourceOpen
                    ? <ChevronDown aria-hidden="true" size={12} strokeWidth={2} />
                    : <ChevronRight aria-hidden="true" size={12} strokeWidth={2} />}
                  <span>Pasted text</span>
                </button>
              </div>
              {review.isSourceOpen ? (
                <EditSourceSurface
                  className="doc-paste-popup-source"
                  text={review.text}
                  textVersion={review.textVersion}
                  isLocked={isSubmitting}
                  ariaLabel="Pasted text"
                  onTextChange={(text) => pasteStore.textSet(text)}
                  onSubmitRequest={() => void pasteStore.insertApply()}
                  onCancelRequest={() => pasteStore.close()}
                />
              ) : null}
              {transformLabelList.length > 0 ? (
                <p className="doc-paste-popup-note">Changed by: {transformLabelList.join(', ')}</p>
              ) : null}
              {result.messageList.map((message) => (
                <p key={message} className="doc-paste-popup-note" data-error={result.isError ? '' : undefined} role={result.isError ? 'alert' : undefined}>
                  {message}
                </p>
              ))}
              {blockListShown.length > 0 ? (
                <BlockListReview
                  blockList={blockListShown}
                  isRenderedById={review.isRenderedById}
                  format={pasteStore.placeFormat}
                  sourcePath={docPath}
                  onRenderToggle={(blockId) => pasteStore.blockRenderedToggle(blockId)}
                />
              ) : result.isError ? null : (
                <p className="doc-paste-popup-note">Paste Markdown or MDX into the pasted text to see its blocks.</p>
              )}
            </section>
            <section className="doc-paste-popup-place" aria-label="Where the blocks go">
              <div className="doc-paste-popup-section-head">
                <span className="doc-paste-popup-section-title">Insert into</span>
              </div>
              <BlockPlacePicker
                docPath={docPath}
                docMessage={review.placeMessage}
                nodeList={nodeList}
                place={review.place}
                placeText={placeBlockList ? blockPlaceTextGet(review.place, placeBlockList) : ''}
                positionReasonGet={(position) => pasteStore.placePositionReasonGet(position)}
                isLocked={isSubmitting}
                onDocCommit={(path) => void pasteStore.placeDocSet(path)}
                onNodeSelect={(nodeId) => pasteStore.placeNodeSet(nodeId)}
                onPositionSelect={(position) => pasteStore.placePositionSet(position)}
              />
            </section>
          </div>
          <div className="doc-paste-popup-footer">
            <p className="doc-paste-popup-status" role={review.status === 'error' ? 'alert' : 'status'} data-error={review.status === 'error' ? '' : undefined}>
              {isSubmitting ? (
                <>
                  <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-edit-spin" />
                  <span>Inserting…</span>
                </>
              ) : (review.message || insertDisabledReason)}
            </p>
            <button type="button" className="doc-paste-popup-button" disabled={isSubmitting} onClick={() => pasteStore.close()}>
              Cancel
            </button>
            <button
              type="button"
              className="doc-paste-popup-button"
              data-primary=""
              disabled={insertDisabledReason !== ''}
              title={insertDisabledReason || undefined}
              onClick={() => void pasteStore.insertApply()}
            >
              Insert
            </button>
          </div>
        </div>
      )}
      onEvent={(eventType, eventData) => {
        if (panelLayout.eventHandle(eventType, eventData)) return;
        if (eventType === 'closeRequest') pasteStore.close();
      }}
    />
  );
});
