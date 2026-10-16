import { ChartBar, TableIcon, TextCursorInput } from '../../main/frontend/UICommon.js';
import { compIconDefine } from '../../main/comp-doc/registry/comp-icon.jsx';
import { BlockPopupSurface } from '../../main/comp-doc/popup/BlockPopupSurface.jsx';
import { StockTableEdit } from './StockTableEdit.jsx';
import { isStockText, parseMarkdownTable, stockTextList } from './StockTableData.js';

// project-specific demo component: renders a markdown table (received as raw
// text through the comment-marked block) with stock status badges.
//
// it demonstrates what a host component exposes to the page
// (doc_page_impl_mdx_comp.md#what-a-component-exposes): two view modes, the
// table and a summary of the stock states, chosen through config.viewMode
// (the mode menu of the block in edit mode); one edit mode of its own,
// 'cells' (StockTableEdit edits the cells in place; the markdown table as
// written is the built-in 'source' mode); an icon drawn with
// compIconDefine; the source of a new block (sourceDefaultCreate); and the
// block popup (doc_page_impl_popup.md): both modes render inside
// BlockPopupSurface, so the table can be opened in a dialog and edited
// there. the outer box of the surface carries the block's margins.
export function StockTable({ data = {}, config = {}, onEvent }) {
  return (
    <BlockPopupSurface config={config} title={data.title || 'Stock table'} className="not-prose my-2">
      {({ isInPopup }) => (
        <div className={isInPopup ? 'px-3 py-2' : undefined}>
          <StockTableBody data={data} config={config} onEvent={onEvent} />
        </div>
      )}
    </BlockPopupSurface>
  );
}

function StockTableBody({ data, config, onEvent }) {
  if (config.isEdit) return <StockTableEdit data={data} config={config} onEvent={onEvent} />;
  const { headers, rows } = parseMarkdownTable(data.raw ?? '');
  if (config.viewMode === 'summary') {
    return <StockTableSummary title={data.title} headers={headers} rows={rows} />;
  }
  return (
    <StockTableView title={data.title} headers={headers} rows={rows} />
  );
}

// the icon of the component: a table with one highlighted cell
const StockTableIcon = compIconDefine(
  <>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
    <rect x="15" y="15" width="6" height="5" fill="currentColor" stroke="none" />
  </>,
);

// registration options shared by the component registry and the host entry
export const stockTableDefineOptions = {
  expose: {
    meta: {
      label: 'Stock table',
      description: 'A markdown table of products with stock status badges.',
    },
    icon: StockTableIcon,
    viewModeList: [
      { id: 'table', label: 'Table', description: 'every product as a row', icon: TableIcon, isDefault: true },
      { id: 'summary', label: 'Summary', description: 'how many products are in each stock state', icon: ChartBar },
    ],
    editModeList: [
      { id: 'cells', label: 'Cells', description: 'the title and the cells edited in the table', icon: TextCursorInput, isDefault: true },
    ],
    sourceDefaultCreate: () => ({
      lang: 'md',
      raw: '| Product | Status |\n| --- | --- |\n| Widget | In Stock |',
      props: { title: 'Stock' },
    }),
  },
};

// the 'summary' view mode: one line per stock state with its count, over
// the status column of the table (the column whose header says "status")
export function StockTableSummary({ title, headers, rows }) {
  const indexStatus = headers.findIndex((header) => /status/i.test(header));
  const countByText = Object.fromEntries(stockTextList.map((text) => [text, 0]));
  for (const cells of rows) {
    const text = indexStatus === -1 ? undefined : cells[indexStatus];
    if (text in countByText) countByText[text] += 1;
  }
  return (
    <div className="not-prose text-sm">
      {title ? <p className="font-medium text-sm mb-1">{title}</p> : null}
      <div className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
        {stockTextList.map((text) => (
          <span key={text} className="inline-flex items-center gap-1">
            <StockBadge text={text} />
            <span className="font-mono text-xs">{countByText[text]}</span>
          </span>
        ))}
        <span className="text-xs text-fd-muted-foreground">{rows.length} products</span>
      </div>
    </div>
  );
}

// the table of both modes. the editor passes cellRender(cell, indexRow,
// indexCell) to put an editable value into each cell, headerRender for the
// header cells, titleRender(title) for the title line (shown even while the
// title is empty), and rowActionsRender(indexRow) for a trailing actions cell.
export function StockTableView({ title, headers, rows, cellRender, headerRender, titleRender, rowActionsRender }) {
  const isTitle = title !== undefined && title !== '';
  return (
    <div className="not-prose">
      {titleRender
        ? <p className="font-medium text-sm mb-1">{titleRender(title ?? '')}</p>
        : isTitle ? <p className="font-medium text-sm mb-1">{title}</p> : null}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-fd-border text-left">
            {headers.map((header, indexCell) => (
              <th key={indexCell} className="px-2 py-1 font-medium">
                {headerRender ? headerRender(header, indexCell) : header}
              </th>
            ))}
            {rowActionsRender ? <th className="px-2 py-1" aria-label="Row actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, indexRow) => (
            <tr key={indexRow} className="border-b border-fd-border">
              {cells.map((cell, indexCell) => (
                <td key={indexCell} className="px-2 py-1">
                  {cellRender
                    ? cellRender(cell, indexRow, indexCell)
                    : isStockText(cell) ? <StockBadge text={cell} /> : cell}
                </td>
              ))}
              {rowActionsRender ? <td className="px-2 py-1">{rowActionsRender(indexRow)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StockBadge({ text }) {
  const color =
    text === 'In Stock'
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : text === 'Low Stock'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  return <span className={`inline-block px-1.5 py-0.5 rounded-sm text-xs ${color}`}>{text}</span>;
}
