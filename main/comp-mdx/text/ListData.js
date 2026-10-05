// Source helpers of a list block. The top-level item markers change; lines
// below an item (nested items, continuation text, fenced blocks) move with
// the item's text column, so they stay inside the item.

const REGEX_ITEM_LINE = /^( {0,1})([-*+]|\d{1,9}[.)])( +)(.*)$/;

// 'ordered' | 'unordered' | '' when no top-level item line exists
export function listTypeGet(text) {
  const line = String(text ?? '').split('\n').find((lineItem) => REGEX_ITEM_LINE.test(lineItem));
  if (!line) return '';
  return /^\d/.test(REGEX_ITEM_LINE.exec(line)[2]) ? 'ordered' : 'unordered';
}

export function listTypeSet(text, type) {
  let number = 0;
  // change of the text column of the current item, applied to its lines
  let widthDelta = 0;
  return String(text ?? '').split('\n').map((line) => {
    const match = REGEX_ITEM_LINE.exec(line);
    if (match) {
      const [, indent, markerOld, spaces, rest] = match;
      number += 1;
      const marker = type === 'ordered' ? `${number}.` : '-';
      widthDelta = (marker.length + 1) - (markerOld.length + spaces.length);
      return `${indent}${marker} ${rest}`;
    }
    if (line.trim() === '' || widthDelta === 0) return line;
    const indentCount = line.length - line.trimStart().length;
    return ' '.repeat(Math.max(0, indentCount + widthDelta)) + line.trimStart();
  }).join('\n');
}
