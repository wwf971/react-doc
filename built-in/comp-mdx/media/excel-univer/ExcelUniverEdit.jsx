import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import { Expand, Scan } from '../../../../main/frontend/UICommon.js';
import { EditActions } from '../../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { EditValueInline } from '../../../../main/comp-doc/edit/EditValueInline.jsx';
import { EDIT_POPUP_CLASS } from '../../../../main/comp-doc/edit/use-edit-outside-pointer.js';
import { ExcelUniverSheet } from './ExcelUniverSheet.jsx';
import { EDIT_HEIGHT_MIN, excelUniverViewHeightGet, excelUniverWorkbookParse, excelUniverWorkbookTextBuild } from './ExcelUniverData.js';
import { ExcelUniverEditStore } from './ExcelUniverEditStore.js';

// Edit mode 'sheet' of ExcelUniver: the whole spreadsheet editor of Univer
// (toolbar, formula bar, sheet tabs, context menu) in the block's place, at
// least as tall as the block was in view mode and extending over the next
// block when it needs more (doc_page_impl_edit.md#no-jitter-rule). The
// floating panel sets what view mode shows: a range on one sheet, typed in
// A1 notation or taken from the selection, or one sheet whole.
//
// the block's data is an asset (ExcelUniver is asset-only): every change is
// reported as the workbook text and the version metadata, and leaving the
// block saves both into the asset object in its save mode (in place, as
// ExcelUniver declares), the document is not written
// (doc_page_impl_edit.md#asset-only-components).
//
// before every save the cell being typed in is completed: the engine keeps
// the text of an open cell editor out of the workbook until it is closed, so
// the editor registers a step that closes it and reports the saved workbook
// (config.edit.submitPrepareSet). a cell that cannot be completed (the
// engine refuses its value) stops the save, and the session shows why.
//
// in the block popup (isInPopup) the sheet fills the dialog and the floating
// panel is in the dialog's header (doc_page_impl_popup.md).
//
// the draft (ExcelUniverEditStore) is kept in the block's state object of
// the component state service layer while the session lasts (state.value.draft,
// doc_page_impl_mdx_comp_state.md): another mount of the same object (a
// second block reading it) renders the draft as it is edited. the draft is
// taken out when the editor unmounts, which is when the session has ended
// (saved or canceled); an editor mounted while a draft is there (a session
// open elsewhere on the object) continues that draft.
//
//   data.raw                  the workbook (JSON) of the asset's head
//   config.assetInfo          versionMetadata: the view, the engine version
//   config.edit.session       status / message of the pending save
//   state                     the block's state object (ExcelUniver holds it)
//   selection, onSelectionChange   the active sheet and selected cells kept
//                             in the state, restored by the engine
//
// events (handled by the edit layer):
//   editDraftChange { raw, versionMetadata }
//   editSubmitRequest
//   editCancelRequest
export const ExcelUniverEdit = observer(function ExcelUniverEdit({
  data = {}, config = {}, state, selection, onSelectionChange, isInPopup = false, onEvent,
}) {
  const [store] = useState(() => state?.value.draft
    ?? new ExcelUniverEditStore({ raw: data.raw, versionMetadata: config.assetInfo?.versionMetadata }));
  useEffect(() => {
    if (!state) return undefined;
    state.patch({ draft: store });
    return () => {
      if (state.value.draft === store) state.patch({ draft: undefined });
    };
  }, [state, store]);
  const univerApiRef = useRef(null);
  const workbookRef = useRef(null);
  const session = config.edit?.session ?? {};
  const isLocked = session.status === 'submitting';
  useEnginePopupMark();

  const parsed = useMemo(() => excelUniverWorkbookParse(store.workbookTextInitial), [store]);
  const height = parsed.workbook
    ? Math.max(excelUniverViewHeightGet(parsed.workbook, store.viewInitial), EDIT_HEIGHT_MIN)
    : undefined;

  const draftReport = () => onEvent?.('editDraftChange', { raw: store.rawDraft, versionMetadata: toJS(store.versionMetadata) });

  const submitPrepareSet = config.edit?.submitPrepareSet;
  useEffect(() => {
    if (typeof submitPrepareSet !== 'function') return undefined;
    return submitPrepareSet(async () => {
      const workbook = workbookRef.current;
      if (!workbook) return { code: 0, message: '' };
      if (workbook.isCellEditing()) {
        const isEnded = await workbook.endEditingAsync(true);
        if (!isEnded) return { code: -1, message: 'The cell being edited was not completed: its value was refused.' };
      }
      store.rawSet(excelUniverWorkbookTextBuild(workbook.save()));
      await draftReport();
      return { code: 0, message: '' };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitPrepareSet]);
  const submitRequest = () => {
    if (isLocked) return;
    void onEvent?.('editSubmitRequest');
  };
  const cancelRequest = () => {
    if (isLocked) return;
    void onEvent?.('editCancelRequest');
  };

  const workbookActiveGet = () => univerApiRef.current?.getActiveWorkbook() ?? undefined;
  const sheetNameGet = (sheetId) => {
    const sheet = sheetId ? workbookActiveGet()?.getSheetBySheetId(sheetId) : undefined;
    return sheet ? sheet.getSheetName() : 'the first sheet';
  };
  const rangeCommit = (text) => {
    const sheetId = workbookActiveGet()?.getActiveSheet()?.getSheetId() ?? store.view.sheetId;
    if (store.rangeSet(text, sheetId)) void draftReport();
  };
  const selectionUse = () => {
    const range = workbookActiveGet()?.getActiveRange();
    if (!range) {
      store.messageSet('select the cells view mode shows first');
      return;
    }
    if (store.rangeSet(range.getA1Notation(), range.getSheetId())) void draftReport();
  };
  const sheetWholeUse = () => {
    store.sheetWholeSet(workbookActiveGet()?.getActiveSheet()?.getSheetId() ?? '');
    void draftReport();
  };

  // Escape and Ctrl/⌘ + Enter belong to the cell editor of the sheet
  // (leave the cell, fill the selection), not to the block
  const sheetKeyDownHandle = (event) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) event.stopPropagation();
  };

  const head = (
    <span className="doc-mdx-excel-univer-edit-view" role="group" aria-label="What view mode shows">
      <span className="doc-mdx-excel-univer-edit-name">view</span>
      <EditValueInline
        value={store.view.range}
        placeholder="whole sheet"
        className="doc-mdx-excel-univer-edit-range"
        isLocked={isLocked}
        aria-label="Range view mode shows (A1 notation)"
        onCommit={rangeCommit}
      />
      <span className="doc-mdx-excel-univer-edit-muted">on {sheetNameGet(store.view.sheetId)}</span>
      <button type="button" className="doc-button" disabled={isLocked} title="the selected cells become the range view mode shows" onClick={selectionUse}>
        <Scan aria-hidden="true" size={11} /> Use selection
      </button>
      <button type="button" className="doc-button" disabled={isLocked} title="view mode shows the active sheet whole" onClick={sheetWholeUse}>
        <Expand aria-hidden="true" size={11} /> Whole sheet
      </button>
      {store.message ? <span className="doc-error doc-edit-message" role="alert">{store.message}</span> : null}
    </span>
  );

  return (
    <>
      <div className={`doc-mdx-excel-univer is-edit not-prose${isInPopup ? ' is-popup' : ''}`} onKeyDown={sheetKeyDownHandle}>
        {parsed.workbook ? (
          <ExcelUniverSheet
            workbookText={store.workbookTextInitial}
            isEditable
            height={isInPopup ? '100%' : height}
            univerLoad={config.univerLoad}
            selectionInitial={selection}
            onSelectionChange={onSelectionChange}
            onReady={({ univerAPI, workbook, engineVersion }) => {
              univerApiRef.current = univerAPI;
              workbookRef.current = workbook;
              store.engineVersionSet(engineVersion);
            }}
            onDataChange={(workbookData) => {
              store.rawSet(excelUniverWorkbookTextBuild(workbookData));
              void draftReport();
            }}
          />
        ) : (
          <p className="doc-mdx-excel-univer-message" role="alert">{parsed.message}</p>
        )}
      </div>
      <EditFloatingPanel
        label="Spreadsheet"
        head={head}
        actions={<EditActions status={session.status} message={session.message} onSubmit={submitRequest} onCancel={cancelRequest} />}
      />
    </>
  );
});

// the engine portals its menus, pickers and dialogs to the body. while the
// sheet is edited, what is added to the body is the engine's, and a pointer
// going down in it is not outside the block (which would leave the session)
function useEnginePopupMark() {
  useEffect(() => {
    const observer = new MutationObserver((recordList) => {
      for (const record of recordList) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) node.classList.add(EDIT_POPUP_CLASS);
        }
      }
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);
}
