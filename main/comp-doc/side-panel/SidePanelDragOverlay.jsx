import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, TriangleAlert } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import './SidePanelItem.css';

// What a drag of a side-panel item shows above the page
// (doc_page_impl_side_panel.md#moving-an-item), from DocSidePanelStore:
//   - the drop indicator: a line where the item would be inserted, starting
//     at the depth it would have, or a box around the row it would go into;
//     grey when the drop is not allowed
//   - the label of the item following the pointer, with the reason when the
//     drop is not allowed
//   - after a drop, the move being saved, then why it failed (until the
//     next pointer down or Escape). a move from the picker shows its state
//     in the picker instead.
// fixed and rendered into document.body, so the scrolling and clipping of
// the side panel never cut it.
export const SidePanelDragOverlay = observer(function SidePanelDragOverlay() {
  const { sidePanelStore } = useDocStores();
  const drag = sidePanelStore.drag;
  const move = sidePanelStore.picker ? undefined : sidePanelStore.move;
  const isMoveFailed = move?.status === 'error';

  useEffect(() => {
    if (!isMoveFailed) return undefined;
    const clear = () => sidePanelStore.moveClear();
    const keyDownHandle = (event) => {
      if (event.key === 'Escape') clear();
    };
    window.addEventListener('pointerdown', clear, true);
    window.addEventListener('keydown', keyDownHandle);
    return () => {
      window.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('keydown', keyDownHandle);
    };
  }, [isMoveFailed, sidePanelStore]);

  if (typeof document === 'undefined') return null;
  if (!drag && !move) return null;

  return createPortal(
    <>
      {drag ? <SidePanelDragView drag={drag} /> : null}
      {!drag && move ? <SidePanelMoveNotice move={move} /> : null}
    </>,
    document.body,
  );
});

// observers themselves: they read the drag and the move as these change
const SidePanelDragView = observer(function SidePanelDragView({ drag }) {
  const drop = drag.drop;
  const isBlocked = drop !== undefined && !drop.isAllowed;
  const indicator = drop?.indicator;
  const isIndicatorShown = indicator !== undefined && !drop.isNoop;
  return (
    <>
      {isIndicatorShown ? (
        <div
          className={indicator.kind === 'box' ? 'doc-side-panel-drop-box' : 'doc-side-panel-drop-line'}
          data-blocked={isBlocked || undefined}
          style={{
            left: `${indicator.left}px`,
            top: `${indicator.top}px`,
            width: `${indicator.width}px`,
            height: `${indicator.height}px`,
          }}
        />
      ) : null}
      <div
        className="doc-popover doc-side-panel-drag-ghost"
        style={{ left: `${drag.point.clientX + 12}px`, top: `${drag.point.clientY + 10}px` }}
      >
        <span className="doc-side-panel-drag-ghost-label">{drag.label}</span>
        {isBlocked ? <span className="doc-side-panel-drag-ghost-reason">{drop.message}</span> : null}
      </div>
    </>
  );
});

const SidePanelMoveNotice = observer(function SidePanelMoveNotice({ move }) {
  const point = move.point ?? { clientX: 16, clientY: 64 };
  const style = {
    left: `${Math.min(point.clientX + 8, window.innerWidth - 330)}px`,
    top: `${Math.min(point.clientY + 8, window.innerHeight - 60)}px`,
  };
  return (
    <div
      className="doc-popover doc-side-panel-move-notice"
      data-status={move.status}
      role={move.status === 'error' ? 'alert' : 'status'}
      style={style}
    >
      {move.status === 'submitting' ? (
        <>
          <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-spin" />
          <span>Moving the item…</span>
        </>
      ) : (
        <>
          <TriangleAlert aria-hidden="true" size={12} strokeWidth={2} />
          <span>{move.message}</span>
        </>
      )}
    </div>
  );
});
