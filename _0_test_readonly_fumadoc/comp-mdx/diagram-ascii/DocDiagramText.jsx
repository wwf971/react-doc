import './DocDiagramText.css';

const graphemeSegmenter = typeof Intl?.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

function DocDiagramText({ data = {} }) {
  const text = String(data.raw ?? '').replace(/\r\n?/g, '\n');
  const lineList = diagramLineListNormalize(text.split('\n'));
  return (
    <pre className="doc-mdx-diagram-text">
      <code aria-label={text}>
        {lineList.map((line, lineIndex) => (
          <span className="doc-mdx-diagram-line" aria-hidden="true" key={lineIndex}>
            {diagramCellListBuild(line).map((cell, cellIndex) => (
              <span
                className="doc-mdx-diagram-cell"
                key={cellIndex}
                style={{ '--doc-diagram-cell-count': cell.width }}
              >
                {cell.text}
              </span>
            ))}
          </span>
        ))}
      </code>
    </pre>
  );
}

// Older diagrams were commonly padded by JavaScript character count. Before
// rendering, use horizontal box rules as structural guides and move neighboring
// vertical borders onto those terminal-cell columns. Only adjacent whitespace
// is changed; labels are never truncated or reflowed.
function diagramLineListNormalize(lineList) {
  const guideList = lineList
    .filter((line) => /^[\s┌┐└┘├┤┬┴┼─]+$/u.test(line) && line.includes('─'))
    .map((line) => ({
      positionList: diagramBorderPositionListGet(line),
      width: diagramTextWidthGet(line),
    }));
  if (!guideList.length) return lineList;

  const widthTarget = Math.max(...guideList.map((guide) => guide.width));
  const positionListByCount = new Map();
  for (const guide of guideList) {
    const positionList = guide.positionList.slice(1, -1);
    if (positionList.length && !positionListByCount.has(positionList.length)) {
      positionListByCount.set(positionList.length, positionList);
    }
  }

  return lineList.map((line) => {
    if (!line.startsWith('│') || !line.endsWith('│')) return line;
    const positionList = diagramBorderPositionListGet(line).slice(1, -1);
    const positionTargetList = positionListByCount.get(positionList.length) ?? [];
    let lineNormalized = line;
    for (let index = 0; index < positionTargetList.length; index += 1) {
      lineNormalized = diagramBorderPositionSet(lineNormalized, index + 1, positionTargetList[index]);
    }
    return diagramBorderPositionSet(
      lineNormalized,
      diagramBorderPositionListGet(lineNormalized).length - 1,
      widthTarget - 1,
    );
  });
}

function diagramBorderPositionSet(line, borderIndex, positionTarget) {
  const graphemeList = diagramGraphemeListGet(line);
  const borderIndexList = graphemeList
    .map((text, index) => text === '│' ? index : -1)
    .filter((index) => index >= 0);
  let graphemeIndex = borderIndexList[borderIndex];
  if (graphemeIndex === undefined) return line;
  const position = diagramTextWidthGet(graphemeList.slice(0, graphemeIndex).join(''));
  const difference = positionTarget - position;
  if (difference > 0) graphemeList.splice(graphemeIndex, 0, ' '.repeat(difference));
  if (difference < 0) {
    let countRemove = -difference;
    while (countRemove > 0 && graphemeList[graphemeIndex - 1] === ' ') {
      graphemeList.splice(graphemeIndex - 1, 1);
      graphemeIndex -= 1;
      countRemove -= 1;
    }
  }
  return graphemeList.join('');
}

function diagramBorderPositionListGet(line) {
  const positionList = [];
  let position = 0;
  for (const text of diagramGraphemeListGet(line)) {
    if ('│┌┐└┘├┤┬┴┼'.includes(text)) positionList.push(position);
    position += graphemeCellWidthGet(text);
  }
  return positionList;
}

function diagramTextWidthGet(text) {
  return diagramGraphemeListGet(text)
    .reduce((width, grapheme) => width + graphemeCellWidthGet(grapheme), 0);
}

// Do not replace this with ordinary <pre> text. A browser may use a CJK font
// fallback whose Japanese glyph advance is not exactly twice the Latin font's
// advance, which breaks borders even when source columns are correct. Explicit
// terminal-style cells make layout independent of fallback-font metrics.
function diagramCellListBuild(line) {
  const graphemeList = diagramGraphemeListGet(line);
  const cellList = [];
  let column = 0;

  for (const text of graphemeList) {
    if (text === '\t') {
      const width = 2 - (column % 2);
      cellList.push({ text: ' '.repeat(width), width });
      column += width;
      continue;
    }
    const width = graphemeCellWidthGet(text);
    cellList.push({ text, width });
    column += width;
  }
  return cellList;
}

function diagramGraphemeListGet(text) {
  return graphemeSegmenter
    ? [...graphemeSegmenter.segment(text)]
      .map((part) => part.segment)
    : [...text];
}

function graphemeCellWidthGet(text) {
  const codePoint = text.codePointAt(0) ?? 0;
  return isCodePointWide(codePoint) ? 2 : 1;
}

// Unicode East Asian wide/full-width ranges plus emoji used by terminal width
// implementations. Box-drawing characters intentionally remain one cell.
function isCodePointWide(codePoint) {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0x303e)
    || (codePoint >= 0x3040 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff01 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1b000 && codePoint <= 0x1b2ff)
    || (codePoint >= 0x1f000 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

export { DocDiagramText };
