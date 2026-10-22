import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { SourceTreeSelect } from '../source/SourceTreeSelect.jsx';
import './SidePanelItem.css';

const actionList = [
  { position: 'before', label: 'Before' },
  { position: 'after', label: 'After' },
  { position: 'insideFirst', label: 'Into, first' },
  { position: 'insideLast', label: 'Into, last' },
];

// The move picker of a side-panel item (doc_page_impl_side_panel.md
// #moving-an-item), opened by the move button of the item in edit mode.
// Open state lives in DocSidePanelStore.picker. It floats where the pointer
// was, like the location prompt of the doc page source service layer, and shows the side
// panel as a tree (the tree view of that layer, SourceTreeSelect):
// choosing an item there only selects it. what to do with it is one of the
// action buttons: put the moved item before or after the chosen item, or
// into it as its first or last child. a button the move is not allowed for
// is disabled and tells why on hover (the same rules as a drag,
// DocSidePanelStore.moveResolve). the item being moved and everything below
// it cannot be chosen.
//
// the move is reported as sidePanelItemMoveRequest, the event a drop
// reports; while it is saved the picker stays, and shows the failure if
// there is one. the header, aside from the close button, drags the picker.
// the close button, Escape, or a pointer going down outside closes it
// (not while the move is being written).
export const SidePanelMovePicker = observer(function SidePanelMovePicker() {
  const { sidePanelStore, eventRouter, onEvent: onEventPage } = useDocStores();
  const elementRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [dragOffset, dragOffsetSet] = useState(dragOffsetRef.current);
  const [isDragging, isDraggingSet] = useState(false);
  const picker = sidePanelStore.picker;
  const isOpen = picker !== undefined;
  // a newly opened picker starts where the pointer was, not where the
  // previous one was dragged
  const openKey = picker
    ? `${picker.itemId}:${picker.point?.clientX ?? ''}:${picker.point?.clientY ?? ''}`
    : '';
  const [dragOpenKey, dragOpenKeySet] = useState(openKey);
  if (dragOpenKey !== openKey) {
    dragOpenKeySet(openKey);
    dragOffsetRef.current = { x: 0, y: 0 };
    dragOffsetSet({ x: 0, y: 0 });
    isDraggingSet(false);
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    // the tree takes the keys at once
    elementRef.current?.querySelector('.doc-source-tree')?.focus();
    const keyDownHandle = (event) => {
      if (event.key === 'Escape') sidePanelStore.pickerClose();
    };
    const pointerDownHandle = (event) => {
      if (elementRef.current && !elementRef.current.contains(event.target)) sidePanelStore.pickerClose();
    };
    window.addEventListener('keydown', keyDownHandle);
    window.addEventListener('pointerdown', pointerDownHandle, true);
    return () => {
      window.removeEventListener('keydown', keyDownHandle);
      window.removeEventListener('pointerdown', pointerDownHandle, true);
    };
  }, [isOpen, sidePanelStore]);

  if (!isOpen) return null;
  const move = sidePanelStore.move?.itemId === picker.itemId ? sidePanelStore.move : undefined;
  const isSubmitting = move?.status === 'submitting';
  const placeById = sidePanelStore.placeById;
  const nodeList = pickerNodeListBuild(placeById, picker.itemId, (itemId) => sidePanelStore.itemTextGet(itemId));
  const style = picker.point
    ? {
        left: `${Math.max(8, Math.min(picker.point.clientX, window.innerWidth - 336))}px`,
        top: `${Math.max(8, Math.min(picker.point.clientY, window.innerHeight - 360))}px`,
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
      }
    : { left: '50%', top: '4rem', transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)` };

  // the header moves the picker. the close button is not a drag handle, so
  // a click there stays a click. the panel stays inside the window.
  const headPointerDownHandle = (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const panel = elementRef.current;
    const head = event.currentTarget;
    if (!panel) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = panel.getBoundingClientRect();
    const origin = dragOffsetRef.current;
    head.setPointerCapture(event.pointerId);
    isDraggingSet(true);
    const moveHandle = (moveEvent) => {
      const margin = 8;
      let left = startRect.left + moveEvent.clientX - startX;
      let top = startRect.top + moveEvent.clientY - startY;
      const maxLeft = Math.max(margin, window.innerWidth - startRect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - startRect.height - margin);
      left = Math.min(Math.max(margin, left), maxLeft);
      top = Math.min(Math.max(margin, top), maxTop);
      const next = {
        x: origin.x + (left - startRect.left),
        y: origin.y + (top - startRect.top),
      };
      dragOffsetRef.current = next;
      dragOffsetSet(next);
    };
    const upHandle = () => {
      head.removeEventListener('pointermove', moveHandle);
      head.removeEventListener('pointerup', upHandle);
      head.removeEventListener('pointercancel', upHandle);
      isDraggingSet(false);
    };
    head.addEventListener('pointermove', moveHandle);
    head.addEventListener('pointerup', upHandle);
    head.addEventListener('pointercancel', upHandle);
  };

  const moveRequest = (position) => {
    const event = eventRouter.eventBuild({
      type: 'sidePanelItemMoveRequest',
      data: { position, targetItemId: picker.targetItemId },
      source: { placement: 'sidePanelMovePicker', itemId: picker.itemId },
    });
    void eventRouter.dispatch(event, { onEventHost: onEventPage });
  };

  return (
    <div
      ref={elementRef}
      className="doc-side-panel-move-picker not-prose"
      role="dialog"
      aria-label="Move a side panel item"
      data-dragging={isDragging ? '' : undefined}
      style={style}
    >
      <div className="doc-side-panel-move-picker-head" onPointerDown={headPointerDownHandle}>
        <p className="doc-side-panel-move-picker-title">
          <span className="doc-side-panel-move-picker-title-text">Move</span>
          <span className="doc-side-panel-move-picker-item">{sidePanelStore.itemTextGet(picker.itemId)}</span>
        </p>
        <button
          type="button"
          className="doc-side-panel-move-picker-close"
          title={isSubmitting ? 'the move is being written' : 'Close'}
          aria-label="Close"
          disabled={isSubmitting}
          onClick={() => sidePanelStore.pickerClose()}
        >
          <X aria-hidden="true" size={13} strokeWidth={2} />
        </button>
      </div>
      <SourceTreeSelect
        key={picker.itemId}
        className="doc-side-panel-move-picker-tree"
        nodeList={nodeList}
        valueId={picker.targetItemId}
        idExpandedInitialList={ancestorIdListGet(placeById, picker.itemId)}
        onSelect={(itemId) => sidePanelStore.pickerTargetSet(itemId)}
      />
      {picker.targetItemId ? (
        <div className="doc-side-panel-move-picker-actions">
          {actionList.map((action) => {
            const resolved = sidePanelStore.moveResolve(picker.itemId, action.position, picker.targetItemId);
            const isNoop = resolved.code === 0 && resolved.data.isNoop;
            const reason = resolved.code !== 0 ? resolved.message : (isNoop ? 'the item already is there' : '');
            return (
              <button
                key={action.position}
                type="button"
                className="doc-side-panel-move-picker-button"
                disabled={isSubmitting || reason !== ''}
                title={reason || undefined}
                onClick={() => moveRequest(action.position)}
              >
                {action.label}
              </button>
            );
          })}
          {isSubmitting ? (
            <span className="doc-side-panel-move-picker-status" role="status">
              <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-edit-spin" />
              <span>Moving…</span>
            </span>
          ) : null}
        </div>
      ) : (
        <p className="doc-side-panel-move-picker-hint">Choose an item, then where to put the moved item next to it.</p>
      )}
      {move?.status === 'error' ? (
        <p className="doc-side-panel-move-picker-message" role="alert">{move.message}</p>
      ) : null}
    </div>
  );
});

// the side panel as the nodes of the tree view: every item, with its
// children. the moved item and its subtree are disabled; a part or a sub
// document says so next to its label
function pickerNodeListBuild(placeById, itemIdMoved, textGet) {
  const nodeBuild = (itemId, isInsideMoved) => {
    const place = placeById.get(itemId);
    const isDisabled = isInsideMoved || itemId === itemIdMoved;
    const childList = place.childIdList.map((childId) => nodeBuild(childId, isDisabled));
    return {
      id: itemId,
      label: textGet(itemId),
      detail: nodeDetailGet(place),
      kind: nodeKindGet(place),
      isDisabled,
      title: isDisabled ? 'the item being moved, or below it' : undefined,
      childList,
    };
  };
  return placeById.get('').childIdList.map((itemId) => nodeBuild(itemId, false));
}

function nodeKindGet(place) {
  if (place.nodeForm === 'separator') return 'separator';
  if (place.childIdList.length > 0 || place.nodeForm === 'folder' || place.nodeForm === 'sourceFolder') return 'folder';
  return 'file';
}

function nodeDetailGet(place) {
  if (place.scopeIdChildren.startsWith('part:') && place.scopeIdChildren !== place.scopeId) return 'part';
  if (place.scopeIdChildren.startsWith('doc:') && place.scopeIdChildren !== place.scopeId) return 'sub document';
  if (place.nodeForm === 'generated') return 'generated';
  return '';
}

function ancestorIdListGet(placeById, itemId) {
  const idList = [];
  let place = placeById.get(placeById.get(itemId)?.parentId ?? '');
  while (place && place.itemId !== '') {
    idList.push(place.itemId);
    place = placeById.get(place.parentId);
  }
  return idList;
}
