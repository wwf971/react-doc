// project-specific demo component: renders a markdown table (received as raw
// text through the comment-marked block) with stock status badges.
export function StockTable({ raw, title }) {
  const { headers, rows } = parseMarkdownTable(raw ?? '');

  return (
    <div className="not-prose my-2">
      {title ? <p className="font-medium text-sm mb-1">{title}</p> : null}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-fd-border text-left">
            {headers.map((header) => (
              <th key={header} className="px-2 py-1 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, indexRow) => (
            <tr key={indexRow} className="border-b border-fd-border">
              {cells.map((cell, indexCell) => (
                <td key={indexCell} className="px-2 py-1">
                  {isStockText(cell) ? <StockBadge text={cell} /> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockBadge({ text }) {
  const color =
    text === 'In Stock'
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : text === 'Low Stock'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  return <span className={`inline-block px-1.5 py-0.5 rounded-sm text-xs ${color}`}>{text}</span>;
}

function isStockText(text) {
  return text === 'In Stock' || text === 'Low Stock' || text === 'Out of Stock';
}

function parseMarkdownTable(raw) {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));
  const parseRow = (line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  const isSeparator = (line) => /^\|[\s:|-]+\|$/.test(line);

  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).filter((line) => !isSeparator(line)).map(parseRow);
  return { headers, rows };
}
