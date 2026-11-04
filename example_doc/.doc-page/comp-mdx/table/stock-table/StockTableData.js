// the markdown table of a StockTable block, in both directions: parsed for
// rendering, serialized again by the editor
export function parseMarkdownTable(raw) {
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

export function markdownTableBuild({ headers, rows }) {
  const cellEscape = (cell) => String(cell ?? '').replace(/\|/g, '\\|').trim();
  const rowBuild = (cells) => `| ${cells.map(cellEscape).join(' | ')} |`;
  return [
    rowBuild(headers),
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((cells) => rowBuild(headers.map((_, index) => cells[index] ?? ''))),
  ].join('\n');
}

export const stockTextList = ['In Stock', 'Low Stock', 'Out of Stock'];

export function isStockText(text) {
  return stockTextList.includes(text);
}

// the rows of a text pasted into the table being edited: one row per line,
// its cells separated by tabs (copied from a spreadsheet) or written as a
// markdown table row (| a | b |; a separator row is skipped). a row with
// fewer cells is filled with empty ones; a row with more than columnCount
// cells, or a text without any row, is refused with the reason.
//   -> { code: 0, data: { rows } } | { code: -1, message }
export function pasteRowListParse(text, columnCount) {
  const lineList = String(text ?? '').replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() !== '');
  const rows = [];
  for (const line of lineList) {
    const lineTrimmed = line.trim();
    if (/^\|[\s:|-]+\|$/.test(lineTrimmed)) continue;
    let cells;
    if (lineTrimmed.startsWith('|')) cells = lineTrimmed.split('|').slice(1, -1).map((cell) => cell.trim());
    else if (line.includes('\t')) cells = line.split('\t').map((cell) => cell.trim());
    else return { code: -1, message: `“${lineTrimmed.slice(0, 40)}” is not a table row: separate its cells with tabs or write it as | a | b |.` };
    if (cells.length > columnCount) {
      return { code: -1, message: `Row ${rows.length + 1} has ${cells.length} cells; the table has ${columnCount} columns.` };
    }
    rows.push([...cells, ...Array(columnCount - cells.length).fill('')]);
  }
  if (rows.length === 0) return { code: -1, message: 'The text has no table row.' };
  return { code: 0, data: { rows }, message: '' };
}
