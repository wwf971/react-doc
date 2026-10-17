import { useCallback, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Eye, LoaderCircle, Pencil } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import '../edit/DocEdit.css';
import './DocBlockPopup.css';

// The block popup of the page (design: doc_page_impl_popup.md): a dialog in
// the host's panel component (compConfigHost.panelComponent) that shows one
// component block, opened from the block's BlockPopupSurface. Open state,
// mode and transitions live in DocBlockPopupStore; this renders them.
//
// header, right of the title: the floating bar of the block's editor while
// the block is in Edit (EditFloatingPanel portals into it), the message of
// a failed change of mode, the View / Edit switch, then the panel's own
// maximize and close buttons. the content is the slot the active surface
// moves its element into.
//
// the dialog belongs to the edit session of its block (class
// doc-edit-popup): a pointer going down in it does not leave the session.
// Escape closes the dialog in View; in Edit the block's editor takes it
// (DocEditBlock: Escape cancels the session, an engine's cell editor keeps
// its own).
export const DocBlockPopup = observer(function DocBlockPopup() {
  const { blockPopupStore, compConfigHost } = useDocStores();
  const Panel = compConfigHost.panelComponent;
  const popup = blockPopupStore.popup;
  const isOpen = Boolean(Panel) && popup !== undefined;
  const slotRefSet = useCallback((element) => blockPopupStore.slotElementSet(element), [blockPopupStore]);
  const floatRefSet = useCallback((element) => blockPopupStore.floatElementSet(element), [blockPopupStore]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const keyDownHandle = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (blockPopupStore.mode === 'edit') return;
      blockPopupStore.close();
    };
    window.addEventListener('keydown', keyDownHandle);
    return () => window.removeEventListener('keydown', keyDownHandle);
  }, [isOpen, blockPopupStore]);

  if (!isOpen) return null;
  const mode = blockPopupStore.mode;
  const editState = blockPopupStore.editState;
  const isBusy = blockPopupStore.isBusy;
  const isSurfaceShown = blockPopupStore.surfaceActiveToken !== undefined;
  const isEditDisabled = isBusy || (mode !== 'edit' && !editState.isEnabled);

  const headerRightContent = (
    <span className="doc-block-popup-head not-prose">
      <span ref={floatRefSet} className="doc-block-popup-float" />
      {popup.message ? <span className="doc-block-popup-message" role="alert">{popup.message}</span> : null}
      {isBusy ? <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-edit-spin" /> : null}
      {editState.isOffered ? (
        <span className="doc-edit-segment" role="group" aria-label="Mode">
          <button
            type="button"
            className={mode === 'view' ? 'is-active' : undefined}
            aria-pressed={mode === 'view'}
            disabled={isBusy}
            title="View: save the edit and show the block"
            onClick={() => void blockPopupStore.viewEnter()}
          >
            <Eye aria-hidden="true" size={12} strokeWidth={2.2} />
            <span>View</span>
          </button>
          <button
            type="button"
            className={mode === 'edit' ? 'is-active' : undefined}
            aria-pressed={mode === 'edit'}
            disabled={isEditDisabled}
            title={editState.reason || 'Edit: edit the block here'}
            onClick={() => void blockPopupStore.editEnter()}
          >
            <Pencil aria-hidden="true" size={12} strokeWidth={2.2} />
            <span>Edit</span>
          </button>
        </span>
      ) : null}
    </span>
  );

  return (
    <Panel
      data={{ title: popup.title }}
      config={{
        isPopup: true,
        isCloseVisible: true,
        isExpandVisible: true,
        isExpanded: popup.isExpanded,
        className: `doc-block-popup ${EDIT_POPUP_CLASS}${popup.isExpanded ? ' is-expanded' : ''}`,
        bodyClassName: 'doc-block-popup-body',
      }}
      headerRightContent={headerRightContent}
      content={(
        <>
          {isSurfaceShown ? null : (
            <p className="doc-block-popup-placeholder">
              {popup.transition === 'entering' ? 'Opening the editor…' : 'The block is not shown on the page.'}
            </p>
          )}
          <div ref={slotRefSet} className="doc-block-popup-slot" />
        </>
      )}
      onEvent={(eventType, eventData) => {
        if (eventType === 'closeRequest') blockPopupStore.close();
        if (eventType === 'expandChangeRequest') blockPopupStore.expandedSet(eventData?.isExpanded === true);
      }}
    />
  );
});
