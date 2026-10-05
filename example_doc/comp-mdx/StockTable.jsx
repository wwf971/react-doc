import { StockTableEdit } from './StockTableEdit.jsx';
import { isStockText, parseMarkdownTable } from './StockTableData.js';

// project-specific demo component: renders a markdown table (received as raw
// text through the comment-marked block) with stock status badges.
//
// it also demonstrates component edit mode (doc_page_impl_edit.md): when the
// edit layer renders the block with config.isEdit, StockTableEdit takes over
// and edits the cells in place; the table itself is shared by both modes.
export function StockTable({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <StockTableEdit data={data} config={config} onEvent={onEvent} />;
  const { headers, rows } = parseMarkdownTable(data.raw ?? '');
  return (
    <StockTableView title={data.title} headers={headers} rows={rows} />
  );
}

// registration options shared by the component registry and the host entry
export const stockTableDefineOptions = {
  isEditSupported: true,
  editTemplate: {
    lang: 'md',
    raw: '| Product | Status |\n| --- | --- |\n| Widget | In Stock |',
    props: { title: 'Stock' },
  },
};

// the table of both modes. the editor passes cellRender(cell, indexRow,
// indexCell) to put an editable value into each cell, headerRender for the
// header cells, titleRender(title) for the title line (shown even while the
// title is empty), and rowActionsRender(indexRow) for a trailing actions cell.
export function StockTableView({ title, headers, rows, cellRender, headerRender, titleRender, rowActionsRender }) {
  const isTitle = title !== undefined && title !== '';
  return (
    <div className="not-prose my-2">
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
