// The data of an ExcelUniver block and what its version metadata says about
// it (doc_page_impl_mdx_comp.md#exceluniver). The data is the workbook as
// Univer saves it (IWorkbookData),
// written as JSON; ExcelUniver is asset-only, so it is the text of an asset
// version, never a fenced block of the document. The metadata of that
// version ({versionId}.metadata.yaml, doc_page_impl_asset.md#version-metadata):
//
//   engine         univer
//   engineVersion  the Univer version that wrote the data
//   view           what view mode shows: { sheetId?, range? } (range in A1
//                  notation, e.g. A1:D8, on that sheet); no sheetId: the
//                  first sheet; no range: the sheet whole
//
// nothing here imports Univer: the engine is loaded by the host
// (config.univerLoad) when a sheet is shown.

export const EXCEL_UNIVER_ENGINE = 'univer';

// Univer's defaults for a worksheet that does not set them
const ROW_HEIGHT_DEFAULT = 24;
const COLUMN_HEADER_HEIGHT_DEFAULT = 20;
const ROW_COUNT_DEFAULT = 1000;
const COLUMN_COUNT_DEFAULT = 20;

// view mode is as tall as the rows it shows, up to this many; beyond, the
// sheet scrolls inside the block
const VIEW_ROW_COUNT_MAX = 30;
// rows shown for a sheet without a range, at least
const VIEW_ROW_COUNT_MIN = 5;
// the horizontal scrollbar Univer draws under the cells
const VIEW_SCROLLBAR_HEIGHT = 12;
// edit mode shows the toolbar, the formula bar and the sheet tabs too; it is
// at least this tall, extending over the next block when the view is shorter
export const EDIT_HEIGHT_MIN = 420;

// ---------- the workbook ----------

const SHEET_ID_DEFAULT = 'sheet-1';

// the data of a new block: one small sheet with a header row
export function excelUniverWorkbookDefaultCreate() {
  return {
    id: 'workbook',
    name: 'Workbook',
    sheetOrder: [SHEET_ID_DEFAULT],
    styles: {},
    sheets: {
      [SHEET_ID_DEFAULT]: {
        id: SHEET_ID_DEFAULT,
        name: 'Sheet1',
        rowCount: 100,
        columnCount: 12,
        cellData: {
          0: { 0: { v: 'Item' }, 1: { v: 'Value' } },
        },
      },
    },
  };
}

// { workbook } or { message } when the text is not a workbook
export function excelUniverWorkbookParse(raw) {
  let workbook;
  try {
    workbook = JSON.parse(String(raw ?? ''));
  } catch (error) {
    return { message: `the data is not valid JSON: ${String(error?.message ?? error)}` };
  }
  if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) {
    return { message: 'the data must be a workbook object' };
  }
  if (!workbook.sheets || typeof workbook.sheets !== 'object' || Object.keys(workbook.sheets).length === 0) {
    return { message: 'the workbook has no sheets' };
  }
  return { workbook };
}

export function excelUniverWorkbookTextBuild(workbook) {
  return `${JSON.stringify(workbook, null, 2)}\n`;
}

// the sheets in their tab order, as { sheetId, name }
export function excelUniverSheetListGet(workbook) {
  const sheetIdList = Array.isArray(workbook.sheetOrder) && workbook.sheetOrder.length > 0
    ? workbook.sheetOrder.filter((sheetId) => workbook.sheets[sheetId])
    : Object.keys(workbook.sheets);
  return sheetIdList.map((sheetId) => ({ sheetId, name: String(workbook.sheets[sheetId].name ?? sheetId) }));
}

// ---------- ranges in A1 notation ----------

const REGEX_RANGE_A1 = /^\s*([A-Za-z]+)(\d+)(?:\s*:\s*([A-Za-z]+)(\d+))?\s*$/;

function columnLabelToIndex(label) {
  let index = 0;
  for (const char of label.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function columnIndexToLabel(index) {
  let label = '';
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    label = String.fromCharCode(65 + digit) + label;
    rest = Math.floor((rest - 1) / 26);
  }
  return label;
}

// "B2:D8" or one cell "C3" -> { startRow, endRow, startColumn, endColumn }
// (0-based, start <= end); undefined when the text is not a range
export function excelUniverRangeParse(text) {
  const match = REGEX_RANGE_A1.exec(String(text ?? ''));
  if (!match) return undefined;
  const rowA = Number(match[2]) - 1;
  const columnA = columnLabelToIndex(match[1]);
  const rowB = match[4] !== undefined ? Number(match[4]) - 1 : rowA;
  const columnB = match[3] !== undefined ? columnLabelToIndex(match[3]) : columnA;
  if (rowA < 0 || rowB < 0) return undefined;
  return {
    startRow: Math.min(rowA, rowB),
    endRow: Math.max(rowA, rowB),
    startColumn: Math.min(columnA, columnB),
    endColumn: Math.max(columnA, columnB),
  };
}

export function excelUniverRangeTextBuild(range) {
  const start = `${columnIndexToLabel(range.startColumn)}${range.startRow + 1}`;
  const end = `${columnIndexToLabel(range.endColumn)}${range.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

// ---------- version metadata ----------

// the view the metadata names: { sheetId, range }, '' for what it does not name
//   sheetId                 the sheet view mode shows ('' : the first one)
//   range                   the range of it view mode shows ('' : all of it)
//   isReadOnlyWarningShown  view mode tells the reader that the sheet cannot
//                           be changed when they try to (a double click on a
//                           cell); default false: the attempt does nothing
export function excelUniverViewGet(versionMetadata) {
  const view = versionMetadata?.view;
  if (!view || typeof view !== 'object') return { sheetId: '', range: '', isReadOnlyWarningShown: false };
  return {
    sheetId: typeof view.sheetId === 'string' ? view.sheetId : '',
    range: typeof view.range === 'string' ? view.range.trim() : '',
    isReadOnlyWarningShown: view.isReadOnlyWarningShown === true,
  };
}

// the metadata a save writes: the keys the version had, the engine that
// wrote the data, and the view: the sheet and range set in the editor, plus
// every other key the view had (isReadOnlyWarningShown); removed when
// nothing is left in it
export function excelUniverMetadataBuild(versionMetadataBase, { engineVersion, view }) {
  const metadata = { ...(versionMetadataBase ?? {}), engine: EXCEL_UNIVER_ENGINE };
  if (engineVersion) metadata.engineVersion = engineVersion;
  const viewBase = metadata.view && typeof metadata.view === 'object' ? metadata.view : {};
  delete metadata.view;
  const viewNext = {};
  if (view.sheetId) viewNext.sheetId = view.sheetId;
  if (view.range) viewNext.range = view.range;
  for (const [key, value] of Object.entries(viewBase)) {
    if (key === 'sheetId' || key === 'range') continue;
    viewNext[key] = value;
  }
  if (Object.keys(viewNext).length > 0) metadata.view = viewNext;
  return metadata;
}

// ---------- the workbook as view mode shows it ----------

// the sheet the view names, else the first one
function viewSheetIdGet(workbook, view) {
  if (view.sheetId && workbook.sheets[view.sheetId]) return view.sheetId;
  return excelUniverSheetListGet(workbook)[0]?.sheetId;
}

// the last row and column holding a cell (-1 when the sheet is empty)
function sheetUsedEndGet(sheet) {
  let endRow = -1;
  let endColumn = -1;
  for (const [rowKey, row] of Object.entries(sheet.cellData ?? {})) {
    if (!row || typeof row !== 'object') continue;
    for (const columnKey of Object.keys(row)) {
      endRow = Math.max(endRow, Number(rowKey));
      endColumn = Math.max(endColumn, Number(columnKey));
    }
  }
  return { endRow, endColumn };
}

// a copy of the workbook in which view mode shows what the view names: its
// sheet is the first tab, and every row and column outside its range is
// hidden (the data is kept whole, so formulas still read every cell).
// -> { workbook, message }: message when the range cannot be read; the
// sheet is then shown whole
export function excelUniverViewWorkbookBuild(workbook, view) {
  const copy = JSON.parse(JSON.stringify(workbook));
  const sheetId = viewSheetIdGet(copy, view);
  if (!sheetId) return { workbook: copy, message: '' };
  copy.sheetOrder = [sheetId, ...excelUniverSheetListGet(copy).map((sheet) => sheet.sheetId).filter((id) => id !== sheetId)];
  const sheet = copy.sheets[sheetId];
  sheet.scrollTop = 0;
  sheet.scrollLeft = 0;
  if (!view.range) return { workbook: copy, message: '' };
  const range = excelUniverRangeParse(view.range);
  if (!range) return { workbook: copy, message: `the view range "${view.range}" is not a range in A1 notation; the whole sheet is shown` };

  sheet.rowCount = Math.max(sheet.rowCount ?? ROW_COUNT_DEFAULT, range.endRow + 1);
  sheet.columnCount = Math.max(sheet.columnCount ?? COLUMN_COUNT_DEFAULT, range.endColumn + 1);
  sheet.rowData = sheet.rowData ?? {};
  sheet.columnData = sheet.columnData ?? {};
  for (let row = 0; row < sheet.rowCount; row += 1) {
    if (row >= range.startRow && row <= range.endRow) continue;
    sheet.rowData[row] = { ...(sheet.rowData[row] ?? {}), hd: 1 };
  }
  for (let column = 0; column < sheet.columnCount; column += 1) {
    if (column >= range.startColumn && column <= range.endColumn) continue;
    sheet.columnData[column] = { ...(sheet.columnData[column] ?? {}), hd: 1 };
  }
  return { workbook: copy, message: '' };
}

// the height of the block in view mode, in px: the column header and the
// rows the view shows (the range, else the rows in use), so the block has
// the height of its table and the page does not move when the engine has
// drawn it
export function excelUniverViewHeightGet(workbook, view) {
  const sheetId = viewSheetIdGet(workbook, view);
  const sheet = sheetId ? workbook.sheets[sheetId] : undefined;
  if (!sheet) return COLUMN_HEADER_HEIGHT_DEFAULT + VIEW_ROW_COUNT_MIN * ROW_HEIGHT_DEFAULT;
  const range = view.range ? excelUniverRangeParse(view.range) : undefined;
  let startRow = 0;
  let endRow;
  if (range) {
    startRow = range.startRow;
    endRow = range.endRow;
  } else {
    endRow = Math.max(sheetUsedEndGet(sheet).endRow, VIEW_ROW_COUNT_MIN - 1);
  }
  endRow = Math.min(endRow, startRow + VIEW_ROW_COUNT_MAX - 1);

  const rowHeightDefault = sheet.defaultRowHeight ?? ROW_HEIGHT_DEFAULT;
  let height = sheet.columnHeader?.hidden === 1 ? 0 : (sheet.columnHeader?.height ?? COLUMN_HEADER_HEIGHT_DEFAULT);
  for (let row = startRow; row <= endRow; row += 1) {
    const rowData = sheet.rowData?.[row];
    if (rowData?.hd === 1) continue;
    height += rowData?.ah ?? rowData?.h ?? rowHeightDefault;
  }
  return height + VIEW_SCROLLBAR_HEIGHT;
}

// ---------- commands of the engine ----------

// whether a command the engine runs changes the data: a mutation, other than
// the formula engine's own (it records the values it computed, which the
// data already implies). selection, scrolling and switching sheets are
// operations and change nothing.
export function excelUniverCommandIsDataChange(command, CommandType) {
  if (command.type !== CommandType.MUTATION) return false;
  return !String(command.id ?? '').startsWith('formula.');
}
