import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowDown, ArrowUp, Check, LoaderCircle, Pencil, Plus, Trash2, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { useDocEditDoc } from './DocEditDocContext.js';
import { DocEditInsertMenu } from './DocEditInsertMenu.jsx';
import { useEditOutsidePointer } from './use-edit-outside-pointer.js';
import './DocEdit.css';

// The border between two blocks, and above the first / below the last one.
// indexBefore is the index a block inserted here would get, so the block
// above is indexBefore - 1 and the block below is indexBefore.
//
// the border takes no height: its row floats over the gap between the two
// blocks and is shown only while the block above, the block below, or the
// row itself is hovered, or while its insert menu or a confirmation is open
// (DocEdit.css), so the document looks exactly as in reading mode until the
// pointer reaches a block.
//
// left-aligned button group:  [edit above] [delete above]  [insert]  [edit below] [delete below]
// the buttons of a missing neighbour (top / end of the page) are left out.
// every action first leaves the open session (saving it). the insert button
// opens a floating menu of starting texts (DocEditInsertMenu); a deletion is
// confirmed in place, in this same row. a pointer going down outside the row
// closes the menu or the confirmation.
export const DocEditBorder = observer(function DocEditBorder({ indexBefore }) {
  const { editStore } = useDocStores();
  const { path, model } = useDocEditDoc();
  const rowRef = useRef(null);
  const blockCount = model.blockList.length;
  const indexAbove = indexBefore - 1;
  const indexBelow = indexBefore;
  const isAbove = indexAbove >= 0;
  const isBelow = indexBelow < blockCount;
  const isSubmitting = editStore.isSubmitting;
  const isMenuHere = editStore.insertMenuIs(path, indexBefore);
  const confirm = editStore.deleteConfirm;
  const isConfirmHere = Boolean(confirm && confirm.path === path && confirm.borderIndex === indexBefore);
  const position = !isAbove ? 'top' : !isBelow ? 'end' : 'between';
  useEditOutsidePointer(rowRef, isMenuHere || isConfirmHere, () => {
    if (isMenuHere) editStore.insertMenuClose();
    if (isConfirmHere) editStore.deleteConfirmClear();
  });

  const deleteRequest = (blockIndex) => void editStore.deleteConfirmSet(path, blockIndex, indexBefore);

  return (
    <div
      className="doc-edit-border"
      data-position={position}
      data-open={isMenuHere || isConfirmHere ? '' : undefined}
    >
      <div ref={rowRef} className="doc-edit-border-row not-prose">
        <div className="doc-edit-border-actions" role="group" aria-label="Block actions">
          {isAbove ? (
            <>
              <button type="button" disabled={isSubmitting} title="Edit the block above" aria-label="Edit the block above"
                onClick={() => void editStore.sessionBlockStart(path, indexAbove)}>
                <ArrowUp aria-hidden="true" size={11} strokeWidth={2.2} />
                <Pencil aria-hidden="true" size={11} strokeWidth={2} />
              </button>
              <button type="button" disabled={isSubmitting} title="Delete the block above" aria-label="Delete the block above"
                onClick={() => deleteRequest(indexAbove)}>
                <ArrowUp aria-hidden="true" size={11} strokeWidth={2.2} />
                <Trash2 aria-hidden="true" size={11} strokeWidth={2} />
              </button>
            </>
          ) : null}
          <button type="button" className="is-insert" disabled={isSubmitting} aria-pressed={isMenuHere}
            title="Insert a block here" aria-label="Insert a block here"
            onClick={() => void (isMenuHere ? editStore.insertMenuClose() : editStore.insertMenuOpen(path, indexBefore))}>
            <Plus aria-hidden="true" size={12} strokeWidth={2.2} />
          </button>
          {isBelow ? (
            <>
              <button type="button" disabled={isSubmitting} title="Edit the block below" aria-label="Edit the block below"
                onClick={() => void editStore.sessionBlockStart(path, indexBelow)}>
                <ArrowDown aria-hidden="true" size={11} strokeWidth={2.2} />
                <Pencil aria-hidden="true" size={11} strokeWidth={2} />
              </button>
              <button type="button" disabled={isSubmitting} title="Delete the block below" aria-label="Delete the block below"
                onClick={() => deleteRequest(indexBelow)}>
                <ArrowDown aria-hidden="true" size={11} strokeWidth={2.2} />
                <Trash2 aria-hidden="true" size={11} strokeWidth={2} />
              </button>
            </>
          ) : null}
        </div>
        {isConfirmHere ? (
          <DeleteConfirm
            confirm={confirm}
            isAboveBlock={confirm.blockIndex === indexAbove}
            onConfirm={() => void editStore.blockDelete(path, confirm.blockIndex)}
            onCancel={() => editStore.deleteConfirmClear()}
          />
        ) : null}
        <span className="doc-edit-border-line" aria-hidden="true" />
        {isMenuHere ? <DocEditInsertMenu borderIndex={indexBefore} /> : null}
      </div>
    </div>
  );
});

function DeleteConfirm({ confirm, isAboveBlock, onConfirm, onCancel }) {
  const isSubmitting = confirm.status === 'submitting';
  return (
    <div className="doc-edit-confirm" role="alertdialog" aria-label="Confirm deletion">
      <span>Delete the block {isAboveBlock ? 'above' : 'below'}?</span>
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
