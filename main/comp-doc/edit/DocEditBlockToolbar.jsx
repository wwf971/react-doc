import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, History, LoaderCircle, Pencil, Plus, Trash2, Upload, X,
} from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { assetRefLangIs, assetRefParse } from '../../frontend/src/lib/doc-asset-ref.js';
import { useAssetPanelIsAvailable } from '../asset/AssetPanelPopup.jsx';
import { useDocEditDoc } from './DocEditDocContext.js';
import { DocEditBlockModeButton } from './DocEditBlockModeButton.jsx';
import { DocEditInsertMenu } from './DocEditInsertMenu.jsx';
import { clickAfterPointerDownSuppress, useEditOutsidePointer } from './use-edit-outside-pointer.js';
import './DocEdit.css';

// The toolbar of one block: its only hover controls. It lives in the
// block's sticky anchor (DocEditBlock), so it floats over the gap above the
// block, and stays at the top of the visible range while the block's own
// top is scrolled out of view. It takes no height and is shown only while
// the block is hovered or while its insert menu, delete confirmation or a
// move failure is open (DocEdit.css), so the document looks exactly as in
// reading mode until the pointer reaches a block.
//
//   [Label]  [modes] [edit] [asset | to asset] [insert above] [insert below] [move up] [move down] [delete]
//
// the modes button (DocEditBlockModeButton, next to the label it belongs
// to) exists for a component block with more than one view mode or edit
// mode; the Edit button opens the block in its default edit mode and is
// greyed out for a read-only component.
//
// every action first leaves the open session (saving it). the insert
// buttons open a floating menu of starting texts (DocEditInsertMenu) under
// the toolbar; a deletion is confirmed in the toolbar itself. a pointer
// going down outside the toolbar closes the menu, the confirmation or a
// failure message. the asset button exists for a component block whose data
// is a reference into the asset service layer (doc_page_impl_asset.md): it opens
// the asset panel of that object, the one place the panel is reached from.
// a component block whose data is written inline in a fenced block has the
// "to asset" button instead: confirmed in the toolbar like a deletion, the
// data becomes an object of the local store (in its default folder) and the
// block is rewritten as the reference, the last step of the move.
// deleting a block whose data is an asset object asks whether the object
// goes too ("Delete block only" / "Delete block and asset"); kept, it is
// listed as an orphan in the settings panel (doc_page_impl_asset.md#usage).
// deleting a block of a component that offers files with its deletion
// (compDefine deleteFileListGet: an Image offers its image) lists them in
// the confirmation (FileDeleteChoices), every file unchecked; the checked
// ones go with the block, moved to a backup beside them by the server
// (doc_page_impl_block_ops.md#deleting-blocks). the toolbar knows no
// component: it shows what the store listed (deleteConfirm.fileList).
//
// entering the block, moving it and moving its data are operations of the
// document, so they are reported as events (editBlockEnterRequest,
// editBlockMoveRequest { direction }, editBlockAssetMoveRequest; source:
// this document and this block) and travel through the event layer to
// DocEditStore like a report of a component (doc_page_impl_event.md). the
// Edit button reports no point: the caret opens at the end of the text. the
// up / down button is greyed out for the first / last block.
//
// the asset button carries the block (component name, marker props, this
// document) to the panel, so its preview pane can render the data the way
// the block does. a reference by name resolves through the asset service layer
// index; until then the button is disabled.
//
//   blockIndex   the block the toolbar belongs to
//   label        what the block is, e.g. "Paragraph"

// the icons of the toolbar buttons (DocEdit.css sets the button height to match)
const ICON_SIZE = 14;

export const DocEditBlockToolbar = observer(function DocEditBlockToolbar({ blockIndex, label }) {
  const { assetStore, editStore, eventRouter, onEvent: onEventPage } = useDocStores();
  const { path, model } = useDocEditDoc();
  const toolbarRef = useRef(null);
  const isAssetPanelAvailable = useAssetPanelIsAvailable();
  const component = model?.blockList?.[blockIndex]?.component;
  const assetReference = component && assetRefLangIs(component.lang) ? assetRefParse(component.raw) : undefined;
  // a reference by name opens the panel once the name is resolved to an object
  const assetObjectId = assetReference && !assetReference.message ? assetStore.refObjectIdGet(assetReference) : '';
  const isSubmitting = editStore.isSubmitting;
  const menu = editStore.insertMenu;
  const isMenuHere = editStore.insertMenuIs(path, blockIndex);
  const confirm = editStore.deleteConfirm;
  const isConfirmHere = editStore.deleteConfirmIs(path, blockIndex);
  const move = editStore.blockMove;
  const isMoveHere = editStore.blockMoveIs(path, blockIndex);
  const assetMove = editStore.blockAssetMove;
  const isAssetMoveHere = editStore.blockAssetMoveIs(path, blockIndex);
  const isAssetMoveConfirmHere = editStore.blockAssetMoveConfirmIs(path, blockIndex);
  const isAssetMoveAvailable = editStore.blockAssetMoveIsAvailable(path, blockIndex);
  const isReadOnly = editStore.blockIsReadOnly(path, blockIndex);
  // the asset object the block's data is: its deletion asks about it too
  const assetObject = isConfirmHere ? editStore.blockAssetObjectGet(path, blockIndex) : undefined;
  // the pointer down that closes what is open only closes it: the click
  // that follows does not also enter the block it lands on; a click on a
  // control still works. entering takes another click.
  useEditOutsidePointer(toolbarRef, isMenuHere || isConfirmHere || isMoveHere || isAssetMoveHere, () => {
    clickAfterPointerDownSuppress({ isControlClickKept: true });
    if (isMenuHere) editStore.insertMenuClose();
    if (isConfirmHere) editStore.deleteConfirmClear();
    if (isMoveHere) editStore.blockMoveClear();
    if (isAssetMoveHere) editStore.blockAssetMoveClear();
  });

  // a block operation reported as an event of this document and this block
  const blockEventDispatch = (type, data = {}) => {
    const event = eventRouter.eventBuild({
      type,
      data,
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
        <DocEditBlockModeButton blockIndex={blockIndex} size="toolbar" />
        <button type="button" disabled={isSubmitting || isReadOnly}
          title={isReadOnly ? 'This component is read-only' : 'Edit this block'} aria-label="Edit this block"
          onClick={() => blockEventDispatch('editBlockEnterRequest')}>
          <Pencil aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
        </button>
        {assetReference && isAssetPanelAvailable ? (
          <button type="button" disabled={isSubmitting || !assetObjectId}
            title={assetReference.message || (assetObjectId ? 'Asset: versions and history' : 'Asset: the object is not resolved yet')}
            aria-label="Asset: versions and history"
            onClick={() => assetStore.panelOpen(assetReference.store, assetObjectId, assetReference.versionId, {
              compName: component.compName,
              propsAuthored: component.props ?? {},
              sourcePath: path,
              sourceLine: component.markerLine,
            })}>
            <History aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
          </button>
        ) : null}
        {isAssetMoveAvailable ? (
          <button type="button" disabled={isSubmitting} aria-pressed={isAssetMoveConfirmHere}
            title="Move the inline data into the asset service layer" aria-label="Move the inline data into the asset service layer"
            onClick={() => void editStore.blockAssetMoveConfirmSet(path, blockIndex)}>
            <Upload aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
          </button>
        ) : null}
        <button type="button" disabled={isSubmitting} aria-pressed={isMenuBefore}
          title="Insert a block above" aria-label="Insert a block above"
          onClick={() => insertMenuToggle(blockIndex)}>
          <Plus aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
          <ArrowUp aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
        </button>
        <button type="button" disabled={isSubmitting} aria-pressed={isMenuAfter}
          title="Insert a block below" aria-label="Insert a block below"
          onClick={() => insertMenuToggle(blockIndex + 1)}>
          <Plus aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
          <ArrowDown aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
        </button>
        <button type="button" disabled={isSubmitting || !editStore.blockMoveIsAvailable(path, blockIndex, 'up')}
          title="Move this block up" aria-label="Move this block up"
          onClick={() => blockEventDispatch('editBlockMoveRequest', { direction: 'up' })}>
          {isMoveHere && move.status === 'submitting' && move.direction === 'up'
            ? <LoaderCircle aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} className="doc-spin" />
            : <ChevronUp aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />}
        </button>
        <button type="button" disabled={isSubmitting || !editStore.blockMoveIsAvailable(path, blockIndex, 'down')}
          title="Move this block down" aria-label="Move this block down"
          onClick={() => blockEventDispatch('editBlockMoveRequest', { direction: 'down' })}>
          {isMoveHere && move.status === 'submitting' && move.direction === 'down'
            ? <LoaderCircle aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} className="doc-spin" />
            : <ChevronDown aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />}
        </button>
        <button type="button" disabled={isSubmitting} aria-pressed={isConfirmHere}
          title="Delete this block" aria-label="Delete this block"
          onClick={() => void editStore.deleteConfirmSet(path, blockIndex)}>
          <Trash2 aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
        </button>
      </div>
      {isConfirmHere ? (
        <ToolbarConfirm
          question={deleteQuestionGet(assetObject, confirm)}
          actionLabel={deleteActionLabelGet(assetObject, confirm, false)}
          isDanger
          confirm={confirm}
          isActionLocked={Boolean(confirm.isFileLoading)}
          onConfirm={() => void editStore.blockDelete(path, blockIndex)}
          onCancel={() => editStore.deleteConfirmClear()}
          actionExtra={assetObject ? {
            label: deleteActionLabelGet(assetObject, confirm, true),
            title: assetDeleteReasonGet(assetObject) || 'the asset object is marked deleted with the block; it can be restored in the asset panel',
            isDisabled: Boolean(assetDeleteReasonGet(assetObject)),
            onConfirm: () => void editStore.blockDelete(path, blockIndex, { isAssetDeleted: true }),
          } : undefined}
        >
          {confirm.fileList ? <FileDeleteChoices /> : null}
        </ToolbarConfirm>
      ) : null}
      {isAssetMoveConfirmHere ? (
        <ToolbarConfirm
          question="Move the data of this block into the asset service layer?"
          actionLabel="Move"
          isDanger={false}
          confirm={assetMove}
          onConfirm={() => blockEventDispatch('editBlockAssetMoveRequest')}
          onCancel={() => editStore.blockAssetMoveClear()}
        />
      ) : null}
      {isMoveHere && move.status === 'error' ? (
        <span className="doc-error doc-edit-message doc-edit-toolbar-message" role="alert">{move.message}</span>
      ) : null}
      {isAssetMoveHere && assetMove.status === 'error' ? (
        <span className="doc-error doc-edit-message doc-edit-toolbar-message" role="alert">{assetMove.message}</span>
      ) : null}
      {isMenuHere ? <DocEditInsertMenu /> : null}
    </div>
  );
});

// the question of a deletion: for a block whose data is an asset object,
// what the object is and who else reads it; for a block whose component
// offers files, whether they go too
function deleteQuestionGet(assetObject, confirm) {
  const questionFile = confirm?.fileList ? ' Also delete any referenced files?' : '';
  if (!assetObject) return `Delete this block?${questionFile}`;
  const objectText = assetObject.name ? `"${assetObject.name}"` : assetObject.objectId;
  if (assetObject.usageCountOther === 0) return `Delete this block? Its data is the asset object ${objectText}.${questionFile}`;
  const blockText = assetObject.usageCountOther === 1 ? '1 other block' : `${assetObject.usageCountOther} other blocks`;
  return `Delete this block? Its data is the asset object ${objectText}, also used by ${blockText}.${questionFile}`;
}

// the label of the two delete actions says what goes: the block alone,
// with its asset object, with the chosen files, or both
function deleteActionLabelGet(assetObject, confirm, isAssetDeleted) {
  const fileCount = confirm?.filePathDeleteList?.length ?? 0;
  if (isAssetDeleted) return fileCount > 0 ? 'Delete block, data asset and selected files' : 'Delete block and asset';
  if (fileCount > 0) return 'Delete block and selected files';
  return assetObject || confirm?.fileList ? 'Delete block only' : 'Delete';
}

// the files a component offered with the deletion of its block, as
// checkbox rows (buttons, so Space / Enter work without a form field):
// read from deleteConfirm.fileList, chosen into deleteConfirm.filePathDeleteList.
// a file that cannot be chosen says why; "Uncheck all" keeps every file;
// the warning about shared use and backups shows once something is chosen
const FileDeleteChoices = observer(function FileDeleteChoices() {
  const { editStore } = useDocStores();
  const confirm = editStore.deleteConfirm;
  if (!confirm?.fileList) return null;
  const isBusy = confirm.status === 'submitting' || Boolean(confirm.isFileLoading);
  const pathSelectedSet = new Set(confirm.filePathDeleteList ?? []);
  return (
    <div className="doc-edit-file-delete" role="group" aria-label="Files to delete">
      {confirm.isFileLoading ? (
        <span className="doc-status" role="status">
          <LoaderCircle aria-hidden="true" size={11} strokeWidth={2.2} className="doc-spin" />
          <span>Listing the files of the block…</span>
        </span>
      ) : confirm.fileMessage ? (
        <span className="doc-error doc-edit-file-delete-note" role="alert">{confirm.fileMessage} The files are kept.</span>
      ) : confirm.fileList.length === 0 ? (
        <span className="doc-edit-file-delete-note">The block names no file to delete.</span>
      ) : (
        <div className="doc-edit-file-delete-list">
          {confirm.fileList.map((file) => {
            const isChecked = pathSelectedSet.has(file.path);
            return (
              <button
                key={file.path}
                type="button"
                role="checkbox"
                className="doc-edit-file-option"
                aria-checked={isChecked}
                aria-label={file.path}
                title={file.reason || file.path}
                disabled={isBusy || !file.isDeletable}
                onClick={() => editStore.deleteFileSelectedSet(file.path, !isChecked)}
              >
                <span className="doc-edit-file-check" aria-hidden="true">
                  {isChecked ? <Check size={11} strokeWidth={2.4} /> : null}
                </span>
                <span className="doc-edit-file-option-text">
                  <span className="doc-edit-file-option-path">{file.path}</span>
                  {file.reason ? <small className="doc-edit-file-option-reason">{file.reason}</small> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {confirm.fileList.length > 0 ? (
        <div className="doc-edit-file-delete-foot">
          <button
            type="button"
            disabled={isBusy || pathSelectedSet.size === 0}
            title="Keep every file; the block is still deleted"
            onClick={() => editStore.deleteFileSelectionClear()}
          >
            <span>Uncheck all</span>
          </button>
          {pathSelectedSet.size > 0 ? (
            <span className="doc-edit-file-delete-note">
              Other blocks or documents may still use a chosen file; it is moved to a hidden backup beside it, not erased.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

// why the asset object cannot go with the block ('' when it can)
function assetDeleteReasonGet(assetObject) {
  if (assetObject.isDeleted) return 'the asset object is already marked deleted';
  if (assetObject.isLocked) return 'the asset object is locked';
  if (assetObject.usageCountOther > 0) return 'other blocks use the asset object; delete it from its asset panel if that is meant';
  return '';
}

// the confirmation of a block action, in the toolbar itself
//   confirm        { status: 'confirming' | 'submitting' | 'error', message }
//   actionExtra    a second way to confirm, after the first:
//                  { label, title, isDisabled, onConfirm } (undefined: none)
//   isActionLocked the actions wait (the files of the block are being
//                  listed); cancel stays possible
//   children       what the question is followed by (the file choices)
function ToolbarConfirm({ question, actionLabel, isDanger, confirm, onConfirm, onCancel, actionExtra, isActionLocked = false, children }) {
  const isSubmitting = confirm.status === 'submitting';
  const isActionDisabled = isSubmitting || isActionLocked;
  return (
    <div className={isDanger ? 'doc-edit-confirm' : 'doc-edit-confirm is-neutral'} role="alertdialog" aria-label={question}>
      <span>{question}</span>
      {children}
      <button type="button" className={isDanger ? 'is-danger' : 'is-primary'} disabled={isActionDisabled} onClick={onConfirm}>
        {isSubmitting
          ? <LoaderCircle aria-hidden="true" size={11} strokeWidth={2.2} className="doc-spin" />
          : <Check aria-hidden="true" size={11} strokeWidth={2.2} />}
        <span>{actionLabel}</span>
      </button>
      {actionExtra ? (
        <button
          type="button"
          className={isDanger ? 'is-danger' : 'is-primary'}
          disabled={isActionDisabled || actionExtra.isDisabled}
          title={actionExtra.title}
          onClick={actionExtra.onConfirm}
        >
          <Trash2 aria-hidden="true" size={11} strokeWidth={2.2} />
          <span>{actionExtra.label}</span>
        </button>
      ) : null}
      <button type="button" disabled={isSubmitting} onClick={onCancel}>
        <X aria-hidden="true" size={11} strokeWidth={2.2} />
        <span>Keep</span>
      </button>
      {confirm.status === 'error' && confirm.message ? (
        <span className="doc-error doc-edit-message" role="alert">{confirm.message}</span>
      ) : null}
    </div>
  );
}
