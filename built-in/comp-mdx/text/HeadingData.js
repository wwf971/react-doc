// Source helpers of a heading block. The block may carry marker comments
// before the heading line (Anchor, MultiLang); only the heading line changes.

const REGEX_HEADING_LINE = /^( {0,3})(#{1,6})(\s+|$)(.*)$/;

// 1..6, or 0 when the block has no ATX heading line
export function headingLevelGet(text) {
  const line = headingLineGet(text);
  return line ? REGEX_HEADING_LINE.exec(line.value)[2].length : 0;
}

export function headingLevelSet(text, level) {
  const levelClamped = Math.min(6, Math.max(1, Math.trunc(level)));
  const line = headingLineGet(text);
  if (!line) return text;
  const [, indent, , , rest] = REGEX_HEADING_LINE.exec(line.value);
  const lineList = text.split('\n');
  lineList[line.index] = `${indent}${'#'.repeat(levelClamped)} ${rest}`.trimEnd();
  return lineList.join('\n');
}

// the first line that is an ATX heading
function headingLineGet(text) {
  const lineList = String(text ?? '').split('\n');
  const index = lineList.findIndex((line) => REGEX_HEADING_LINE.test(line));
  return index < 0 ? undefined : { index, value: lineList[index] };
}
