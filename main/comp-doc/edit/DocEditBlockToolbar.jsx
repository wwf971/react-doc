import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, History, LoaderCircle, Pencil, Plus, Trash2, X,
} from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { assetRefLangIs, assetRefParse } from '../../frontend/src/lib/doc-asset-ref.js';
import { useAssetPanelIsAvailable } from '../asset/AssetPanelPopup.jsx';
import { useDocEditDoc } from './DocEditDocContext.js';
import { DocEditInsertMenu } from './DocEditInsertMenu.jsx';
import { useEditOutsidePointer } from './use-edit-outside-pointer.js';
import './DocEdit.css';

// The toolbar of one block: its only hover controls. It lives in the
// block's sticky anchor (DocEditBlock), so it floats over the gap above the
// block, and stays at the top of the visible range while the block's own
// top is scrolled out of view. It takes no height and is shown only while
// the block is hovered or while its insert menu, delete confirmation or a
// move failure is open (DocEdit.css), so the document looks exactly as in
// reading mode until the pointer reaches a block.
//
//   [Label]  [edit] [asset] [insert above] [insert below] [move up] [move down] [delete]
//
// every action first leaves the open session (saving it). the insert
// buttons open a floating menu of starting texts (DocEditInsertMenu) under
// the toolbar; a deletion is confirmed in the toolbar itself. a pointer
// going down outside the toolbar closes the menu, the confirmation or the
// move failure. the asset button exists for a component block whose data is
// a reference into the asset store (doc_page_impl_asset.md): it opens the
// asset panel of that object, the one place the panel is reached from.
//
// moving a block is an operation of the document, so it is reported as an
// event (editBlockMoveRequest { direction }, source: this document and this
// block) and travels through the event layer to DocEditStore like a report
// of a component (doc_page_impl_event.md); the up / down button is greyed
// out for the first / last block.
//
//   blockIndex   the block the toolbar belongs to
//   label        what the block is, e.g. "Paragraph"
export const DocEditBlockToolbar = observer(function DocEditBlockToolbar({ blockIndex, label }) {
  const { assetStore, editStore, eventRouter, onEvent: onEventPage } = useDocStores();
  const { path, model } = useDocEditDoc();
  const toolbarRef = useRef(null);
  const isAssetPanelAvailable = useAssetPanelIsAvailable();
  const component = model?.blockList?.[blockIndex]?.component;
  const assetReference = component && assetRefLangIs(component.lang) ? assetRefParse(component.raw) : undefined;
  const isSubmitting = editStore.isSubmitting;
  const menu = editStore.insertMenu;
  const isMenuHere = editStore.insertMenuIs(path, blockIndex);
  const confirm = editStore.deleteConfirm;
  const isConfirmHere = editStore.deleteConfirmIs(path, blockIndex);
  const move = editStore.blockMove;
  const isMoveHere = editStore.blockMoveIs(path, blockIndex);
  useEditOutsidePointer(toolbarRef, isMenuHere || isConfirmHere || isMoveHere, () => {
    if (isMenuHere) editStore.insertMenuClose();
    if (isConfirmHere) editStore.deleteConfirmClear();
    if (isMoveHere) editStore.blockMoveClear();
  });

  const moveRequest = (direction) => {
    const event = eventRouter.eventBuild({
      type: 'editBlockMoveRequest',
      data: { direction },
      source: { placement: 'editToolbar', sourcePath: path, blockIndex },
    });
    void eventRouter.dispatch(event, { onEventHost: onEventPage });
  };

  // the insert button of a border toggles its menu
  const insertMenuToggle = (borderIndex) => {
    if (isMenuHere && menu.borderIndex === borderIndex) {
      editStore.insertMenuClose();
      return;
    }
    void editStore.insertMenuOpen(path, blockIndex, borderIndex);
  };
  const isMenuBefore = isMenuHere && menu.borderIndex === blockIndex;
  const isMenuAfter = isMenuHere && menu.borderIndex === blockIndex + 1;

  return (
    <div ref={toolbarRef} className="doc-edit-toolbar not-prose" role="toolbar" aria-label={`${label} block`}>
      <span className="doc-edit-toolbar-label">{label}</span>
      <div className="doc-edit-toolbar-actions" role="group" aria-label="Block actions">
        <button type="button" disabled={isSubmitting} title="Edit this block" aria-label="Edit this block"
          onClick={() => void editStore.sessionBlockStart(path, blockIndex)}>
          <Pencil aria-hidden="true" size={11} strokeWidth={2} />
        </button>
        {assetReference && isAssetPanelAvailable ? (
          <button type="button" disabled={isSubmitting || Boolean(assetReference.message)}
            title="Asset: versions and history" aria-label="Asset: versions and history"
            onClick={() => assetStore.panelOpen(assetReference.objectId, assetReference.versionId)}>
            <History aria-hidden="true" size={11} strokeWidth={2} />
          </button>
        ) : null}
        <button type="button" disabled={isSubmitting} aria-pressed={isMenuBefore}
          title="Insert a block above" aria-label="Insert a block above"
          onClick={() => insertMenuToggle(blockIndex)}>
          <Plus aria-hidden="true" size={11} strokeWidth={2.2} />
          <ArrowUp aria-hidden="true" size={11} strokeWidth={2.2} />
        </button>
        <button type="button" disabled={isSubmitting} aria-pressed={isMenuAfter}
          title="Insert a block below" aria-label="Insert a block below"
          onClick={() => insertMenuToggle(blockIndex + 1)}>
          <Plus aria-hidden="true" size={11} strokeWidth={2.2} />
          <ArrowDown aria-hidden="true" size={11} strokeWidth={2.2} />
        </button>
        <button type="button" disabled={isSubmitting || !editStore.blockMoveIsAvailable(path, blockIndex, 'up')}
          title="Move this block up" aria-label="Move this block up"
          onClick={() => moveRequest('up')}>
          {isMoveHere && move.status === 'submitting' && move.direction === 'up'
            ? <LoaderCircle aria-hidden="true" size={11} strokeWidth={2.2} className="doc-edit-spin" />
            : <ChevronUp aria-hidden="true" size={11} strokeWidth={2.2} />}
        </button>
        <button type="button" disabled={isSubmitting || !editStore.blockMoveIsAvailable(path, blockIndex, 'down')}
          title="Move this block down" aria-label="Move this block down"
          onClick={() => moveRequest('down')}>
          {isMoveHere && move.status === 'submitting' && move.direction === 'down'
            ? <LoaderCircle aria-hidden="true" size={11} strokeWidth={2.2} className="doc-edit-spin" />
            : <ChevronDown aria-hidden="true" size={11} strokeWidth={2.2} />}
        </button>
        <button type="button" disabled={isSubmitting} aria-pressed={isConfirmHere}
          title="Delete this block" aria-label="Delete this block"
          onClick={() => void editStore.deleteConfirmSet(path, blockIndex)}>
          <Trash2 aria-hidden="true" size={11} strokeWidth={2} />
        </button>
      </div>
      {isConfirmHere ? (
        <DeleteConfirm
          confirm={confirm}
          onConfirm={() => void editStore.blockDelete(path, blockIndex)}
          onCancel={() => editStore.deleteConfirmClear()}
        />
      ) : null}
      {isMoveHere && move.status === 'error' ? (
        <span className="doc-edit-message doc-edit-toolbar-message" role="alert">{move.message}</span>
      ) : null}
      {isMenuHere ? <DocEditInsertMenu /> : null}
    </div>
  );
});

function DeleteConfirm({ confirm, onConfirm, onCancel }) {
  const isSubmitting = confirm.status === 'submitting';
  return (
    <div className="doc-edit-confirm" role="alertdialog" aria-label="Confirm deletion">
      <span>Delete this block?</span>
      <button type="button" className="is-danger" disabled={isSubmitting} onClick={onConfirm}>
        {isSubmitting
          ? <LoaderCircle aria-hidden="true" size={11} strokeWidth={2.2} className="doc-edit-spin" />
          : <Check aria-hidden="true" size={11} strokeWidth={2.2} />}
        <span>Delete</span>
      </button>
      <button type="button" disabled={isSubmitting} onClick={onCancel}>
        <X aria-hidden="true" size={11} strokeWidth={2.2} />
        <span>Keep</span>
      </button>
      {confirm.status === 'error' && confirm.message ? (
        <span className="doc-edit-message" role="alert">{confirm.message}</span>
      ) : null}
    </div>
  );
}
