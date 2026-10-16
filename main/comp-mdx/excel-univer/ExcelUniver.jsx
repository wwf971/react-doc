import { useMemo } from 'react';
import { BlockPopupSurface } from '../../comp-doc/popup/BlockPopupSurface.jsx';
import { ExcelUniverEdit } from './ExcelUniverEdit.jsx';
import { ExcelUniverSheet } from './ExcelUniverSheet.jsx';
import {
  excelUniverViewGet,
  excelUniverViewHeightGet,
  excelUniverViewWorkbookBuild,
  excelUniverWorkbookParse,
} from './ExcelUniverData.js';
import './ExcelUniver.css';

// A spreadsheet in the document, drawn by the Univer engine
// (doc_page_impl_mdx_comp.md#exceluniver). ExcelUniver is asset-only: its
// data, the workbook, is the text of an asset version, and the block in the
// document is a reference to it:
//
//   <!--renderComp=ExcelUniver-->
//   ```asset
//   store: local
//   objectId: m2x1k9q4z0a1b
//   ```
//
// view mode shows what the version's metadata names (view: a range on one
// sheet), without the toolbar, the formula bar or the sheet tabs: cells can
// be selected and the sheet scrolled, the data cannot change, and an attempt
// to change it is silent unless view.isReadOnlyWarningShown. in edit mode
// (config.isEdit, set by the edit layer) ExcelUniverEdit edits the workbook
// and the view. the engine is loaded by the host (config.univerLoad).
//
// both modes render inside BlockPopupSurface (doc_page_impl_popup.md): the
// sheet can be opened in the block popup, where it fills the dialog and can
// be switched between View and Edit. the outer box of the surface carries
// the block's margins; the sheet's own box has none.
//
//   data.raw             the workbook as JSON (IWorkbookData)
//   config.assetInfo     versionMetadata: { engine, engineVersion, view }
export function ExcelUniver({ data = {}, config = {}, onEvent }) {
  return (
    <BlockPopupSurface config={config} title={config.assetInfo?.name || 'Spreadsheet'} className="doc-mdx-excel-univer-shell">
      {({ isInPopup }) => (config.isEdit
        ? <ExcelUniverEdit data={data} config={config} isInPopup={isInPopup} onEvent={onEvent} />
        : (
          <ExcelUniverView
            raw={data.raw}
            versionMetadata={config.assetInfo?.versionMetadata}
            univerLoad={config.univerLoad}
            isInPopup={isInPopup}
          />
        ))}
    </BlockPopupSurface>
  );
}

function ExcelUniverView({ raw, versionMetadata, univerLoad, isInPopup }) {
  const view = excelUniverViewGet(versionMetadata);
  const shown = useMemo(() => {
    const parsed = excelUniverWorkbookParse(raw);
    if (parsed.message) return { workbookText: '', height: 0, message: parsed.message };
    const viewWorkbook = excelUniverViewWorkbookBuild(parsed.workbook, view);
    return {
      workbookText: JSON.stringify(viewWorkbook.workbook),
      height: excelUniverViewHeightGet(parsed.workbook, view),
      message: viewWorkbook.message,
    };
  }, [raw, view.sheetId, view.range]);

  return (
    <div className={`doc-mdx-excel-univer not-prose${isInPopup ? ' is-popup' : ''}`}>
      {shown.workbookText ? (
        <ExcelUniverSheet
          workbookText={shown.workbookText}
          isEditable={false}
          isReadOnlyWarningShown={view.isReadOnlyWarningShown}
          height={isInPopup ? '100%' : shown.height}
          univerLoad={univerLoad}
        />
      ) : null}
      {shown.message ? <p className="doc-mdx-excel-univer-message" role="alert">{shown.message}</p> : null}
    </div>
  );
}
