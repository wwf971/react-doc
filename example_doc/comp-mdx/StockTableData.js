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
