import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ArrowLeft, LoaderCircle } from '../../frontend/UICommon.js';
import { blockNodeIdGet, blockPlaceNodeListBuild, blockPlaceTextGet } from '../../frontend/src/lib/doc-block-place.js';
import { BlockListReview } from '../block-list/BlockListReview.jsx';
import { BlockPlacePicker } from '../block-list/BlockPlacePicker.jsx';
import { blockLabelGet } from '../edit/DocEditBlockEditor.jsx';
import { usePanelLayout } from '../popup/use-panel-layout.js';
import { SourcePathPicker } from '../source/SourcePathPicker.jsx';
import '../paste/DocPaste.css';
import './DocBlockSelect.css';

// the dialog moves by its header and resizes by its edges; a resized size
// is kept for its next opening (DocPanelLayoutStore)
const panelLayoutOption = { isMovable: true, isResizable: true, isSizeRemembered: true };

// The dialog that copies or moves the selected blocks
// (doc_page_impl_copy_paste.md#copying-and-moving-blocks), open while
// DocBlockSelectStore.transfer is set. The frame is the host's text panel
// component (config.compConfigHost.panelComponent), with the two columns of
// the paste review.
//
//   ┌ Copy blocks ─────────────────────────────────────────────────── × ┐
//   │ Blocks (2 of 3)   [Lines|Sources] [All blocks] │ To               │
//   │ [☑] [Paragraph] First of three short …         │ document step:   │
//   │ [☐] [List] - one - two                         │  [~example/a.md] │
//   │ [☑] [Image] <!--renderComp=Image--> …          │  ▾ 📁 ~example   │
//   │                                                │     🗎 a.md       │
//   │                                                │       [Choose]   │
//   │                                                │ place step:      │
//   │                                                │  [←] ~example/a.md │
//   │                                                │  ▾ 🗎 a.md        │
//   │                                                │    [Paragraph] … │
//   │                                                │  [Before] [After]│
//   │ ──────────────────────────────────────────────────────────────── │
//   │ why not / message          [Cancel] [Move here] [Copy here]      │
//   └───────────────────────────────────────────────────────────────────┘
//
// the left column lists the blocks the dialog was opened with, each
// checked; "All blocks" lists every block of the document instead, the
// others unchecked. what is checked is what goes. the right column first
// chooses the document (typed with completion, or in the tree; a double
// click chooses and goes on), then the place in it; the arrow goes back to
// another document. Copy and Move are both always offered; the one of the
// menu entry is the primary button. Escape or Cancel closes, nothing is
// written.
export const DocBlockTransferPopup = observer(function DocBlockTransferPopup() {
  const { blockSelectStore, sourceStore, compConfigHost } = useDocStores();
  const Panel = compConfigHost.panelComponent;
  const transfer = blockSelectStore?.transfer;
  const isOpen = Boolean(Panel) && blockSelectStore?.isTransferOpen === true;

  useEffect(() => {
    if (!isOpen) return undefined;
    // a control that takes Escape itself (the document path restores its
    // text) prevents the default; the dialog stays open then
    const keyDownHandle = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) blockSelectStore.transferClose();
    };
    window.addEventListener('keydown', keyDownHandle);
    return () => window.removeEventListener('keydown', keyDownHandle);
  }, [isOpen, blockSelectStore]);

  const panelLayout = usePanelLayout('blockTransfer', isOpen, panelLayoutOption);

  if (!isOpen) return null;
  const isSubmitting = transfer.status === 'submitting';
  const sourceEntry = sourceStore.entryByInternalPath.get(transfer.sourcePath);
  const format = sourceEntry?.ext === 'mdx' ? 'mdx' : 'md';
  const blockListShown = blockSelectStore.transferBlockListShown.map((block) => ({
    ...block,
    id: blockNodeIdGet(block.index),
    label: blockLabelGet(block),
  }));
  const isCheckedById = Object.fromEntries(
    transfer.blockIndexCheckedList.map((index) => [blockNodeIdGet(index), true]),
  );
  const blockIndexFromId = (blockId) => Number(String(blockId).replace(/^block-/, ''));
  const countText = transfer.isSourceAllShown
    ? `${transfer.blockIndexCheckedList.length} of ${blockListShown.length}`
    : `${transfer.blockIndexCheckedList.length} of ${transfer.blockIndexOfferedList.length}`;

  const actionList = transfer.actionInitial === 'move' ? ['copy', 'move'] : ['move', 'copy'];
  const reasonByAction = {
    copy: blockSelectStore.transferApplyDisabledReasonGet('copy'),
    move: blockSelectStore.transferApplyDisabledReasonGet('move'),
  };
  const statusText = transfer.message || reasonByAction[transfer.actionInitial];

  return (
    <Panel
      data={{ title: transfer.actionInitial === 'move' ? 'Move blocks' : 'Copy blocks' }}
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
            <section className="doc-paste-popup-blocks" aria-label="The blocks to copy or move">
              <div className="doc-paste-popup-section-head">
                <span className="doc-paste-popup-section-title">Blocks ({countText})</span>
                <span className="doc-block-transfer-head-actions">
                  <button
                    type="button"
                    className="doc-block-transfer-chip"
                    aria-pressed={transfer.listDisplay === 'compact'}
                    title="One line per block"
                    onClick={() => blockSelectStore.transferListDisplaySet('compact')}
                  >
                    Lines
                  </button>
                  <button
                    type="button"
                    className="doc-block-transfer-chip"
                    aria-pressed={transfer.listDisplay === 'full'}
                    title="Every block with its source, or rendered"
                    onClick={() => blockSelectStore.transferListDisplaySet('full')}
                  >
                    Sources
                  </button>
                  <button
                    type="button"
                    className="doc-block-transfer-chip"
                    aria-pressed={transfer.isSourceAllShown}
                    disabled={isSubmitting}
                    title={transfer.isSourceAllShown ? 'List only the selected blocks' : 'List every block of the document'}
                    onClick={() => blockSelectStore.transferSourceAllShownToggle()}
                  >
                    All blocks
                  </button>
                </span>
              </div>
              {blockSelectStore.transferSourceBlockList ? (
                <BlockListReview
                  blockList={blockListShown}
                  display={transfer.listDisplay}
                  isRenderedById={transfer.isRenderedById}
                  format={format}
                  sourcePath={transfer.sourcePath}
                  isCheckable
                  isCheckedById={isCheckedById}
                  isLocked={isSubmitting}
                  onRenderToggle={(blockId) => blockSelectStore.transferRenderedToggle(blockId)}
                  onCheckToggle={(blockId) => blockSelectStore.transferBlockCheckToggle(blockIndexFromId(blockId))}
                />
              ) : (
                <p className="doc-paste-popup-note" data-error="" role="alert">
                  The document changed since the blocks were chosen. Close this and choose them again.
                </p>
              )}
            </section>
            <section className="doc-paste-popup-place" aria-label="Where the blocks go">
              <div className="doc-paste-popup-section-head">
                <span className="doc-paste-popup-section-title">To</span>
              </div>
              {transfer.targetStep === 'doc'
                ? <TransferTargetDoc isLocked={isSubmitting} />
                : <TransferTargetPlace isLocked={isSubmitting} />}
            </section>
          </div>
          <div className="doc-paste-popup-footer">
            <p className="doc-paste-popup-status" role={transfer.status === 'error' ? 'alert' : 'status'} data-error={transfer.status === 'error' ? '' : undefined}>
              {isSubmitting ? (
                <>
                  <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-edit-spin" />
                  <span>Writing…</span>
                </>
              ) : statusText}
            </p>
            <button type="button" className="doc-paste-popup-button" disabled={isSubmitting} onClick={() => blockSelectStore.transferClose()}>
              Cancel
            </button>
            {actionList.map((action) => (
              <button
                key={action}
                type="button"
                className="doc-paste-popup-button"
                data-primary={action === transfer.actionInitial ? '' : undefined}
                disabled={reasonByAction[action] !== ''}
                title={reasonByAction[action] || undefined}
                onClick={() => void blockSelectStore.transferApply(action)}
              >
                {action === 'move' ? 'Move here' : 'Copy here'}
              </button>
            ))}
          </div>
        </div>
      )}
      onEvent={(eventType, eventData) => {
        if (panelLayout.eventHandle(eventType, eventData)) return;
        if (eventType === 'closeRequest') blockSelectStore.transferClose();
      }}
    />
  );
});

// the first step of the right column: the document the blocks go to
const TransferTargetDoc = observer(function TransferTargetDoc({ isLocked }) {
  const { blockSelectStore } = useDocStores();
  const transfer = blockSelectStore.transfer;
  const isChoosable = transfer.targetDocPath !== '' && transfer.targetDocMessage === '';
  return (
    <>
      <SourcePathPicker
        value={transfer.targetDocPath}
        spec={{ kind: 'file', extList: ['md', 'mdx'] }}
        placeholder="~root/path/to/doc.md"
        message={transfer.targetDocMessage}
        isDisabled={isLocked}
        onSelect={(path) => blockSelectStore.transferTargetDocSelect(path)}
        onActivate={(path) => void blockSelectStore.transferTargetDocConfirm(path)}
      />
      <div className="doc-block-transfer-doc-actions">
        <button
          type="button"
          className="doc-paste-popup-button"
          data-primary=""
          disabled={isLocked || !isChoosable}
          title={isChoosable ? 'Choose the place in this document' : 'choose an md / mdx document'}
          onClick={() => void blockSelectStore.transferTargetDocConfirm()}
        >
          Choose
        </button>
      </div>
    </>
  );
});

// the second step: the place in the chosen document; the blocks being moved
// or copied are marked in its tree when it is their own document
const TransferTargetPlace = observer(function TransferTargetPlace({ isLocked }) {
  const { blockSelectStore, sourceStore } = useDocStores();
  const transfer = blockSelectStore.transfer;
  const docPath = transfer.place.docPath;
  const blockList = blockSelectStore.transferTargetBlockList;
  const docEntry = sourceStore.entryByInternalPath.get(docPath);
  const isSourceDoc = docPath === transfer.sourcePath;
  const nodeList = blockList
    ? blockPlaceNodeListBuild({
      docLabel: docEntry?.name ?? docPath,
      blockList,
      labelGet: blockLabelGet,
      detailGet: (block) => (isSourceDoc && transfer.blockIndexCheckedList.includes(block.index) ? 'chosen' : ''),
    })
    : undefined;
  return (
    <>
      <div className="doc-block-transfer-doc">
        <button
          type="button"
          className="doc-block-transfer-chip"
          title="Choose another document"
          aria-label="Choose another document"
          disabled={isLocked}
          onClick={() => blockSelectStore.transferTargetDocBack()}
        >
          <ArrowLeft aria-hidden="true" size={12} strokeWidth={2} />
        </button>
        <span className="doc-block-transfer-doc-path" title={docPath}>{docPath}</span>
      </div>
      <BlockPlacePicker
        docPath={docPath}
        isDocFieldShown={false}
        nodeList={nodeList}
        place={transfer.place}
        placeText={blockList ? blockPlaceTextGet(transfer.place, blockList) : ''}
        positionReasonGet={(position) => blockSelectStore.transferPlacePositionReasonGet(position)}
        isLocked={isLocked}
        onNodeSelect={(nodeId) => blockSelectStore.transferPlaceNodeSet(nodeId)}
        onPositionSelect={(position) => blockSelectStore.transferPlacePositionSet(position)}
      />
    </>
  );
});
