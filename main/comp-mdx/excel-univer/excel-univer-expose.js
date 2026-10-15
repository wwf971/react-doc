import { SheetIcon, Table2 } from '../../frontend/UICommon.js';
import { excelUniverWorkbookDefaultCreate, excelUniverWorkbookTextBuild } from './ExcelUniverData.js';

// What ExcelUniver exposes through its registry definition (compDefine
// expose, doc_page_impl_mdx_comp.md#what-a-component-exposes). It is
// asset-only: its data is never written inline, a new block's starting
// data becomes an asset object and the block a reference to it. It saves
// in place: a workbook is edited cell by cell, and each save becoming a
// version would bury the history in versions nobody asked for. Its data is
// edited with the spreadsheet only, never as text (no source mode). A click
// on the sheet selects cells, so it never opens the editor: only the Edit
// button does.
export const excelUniverExpose = {
  meta: {
    label: 'Spreadsheet',
    description: 'An Excel-style spreadsheet drawn by Univer; its data lives in the asset store.',
    isAssetOnly: true,
    isEditSourceAccepted: false,
    isEditEnterButtonOnly: true,
    assetSaveMode: 'inPlace',
  },
  icon: SheetIcon,
  editModeList: [
    {
      id: 'sheet',
      label: 'Sheet',
      description: 'the spreadsheet editor, with the range view mode shows in a floating panel',
      icon: Table2,
      isDefault: true,
    },
  ],
  sourceDefaultCreate: () => ({ lang: 'json', raw: excelUniverWorkbookTextBuild(excelUniverWorkbookDefaultCreate()) }),
};
