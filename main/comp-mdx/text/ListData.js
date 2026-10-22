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

// The space above every source line of a list, so that the source keeps the
// line rhythm of the rendered list while it is edited
// (doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule). The
// rendered list puts a gap between two items (the item margin) and a larger
// one where a nested list starts or ends; the source lines of a list are one
// line height apart. Each line gets the gap its rendered counterpart has:
//
//   ''       no gap: the first line, and the lines continuing an item
//   'item'   an item line after an item of the same depth
//   'list'   an item line deeper or shallower than the item before it
//   'blank'  a blank line: it stands for the paragraph gap of a loose list,
//            so it is as high as that gap, and the line after it gets none
//
// lines inside a fenced block are never item lines.
const REGEX_ITEM_LINE_ANY = /^(\s*)([-*+]|\d{1,9}[.)])(\s|$)/;
const REGEX_FENCE_LINE = /^\s*(`{3,}|~{3,})/;

export function listLineSpaceListGet(lineList) {
  const spaceList = [];
  let indentItemPrevious = -1;
  let fenceOpen = '';
  lineList.forEach((line, index) => {
    const fenceMatch = REGEX_FENCE_LINE.exec(line);
    if (fenceOpen !== '') {
      if (fenceMatch && fenceMatch[1][0] === fenceOpen[0] && fenceMatch[1].length >= fenceOpen.length) fenceOpen = '';
      spaceList.push('');
      return;
    }
    if (fenceMatch) fenceOpen = fenceMatch[1];
    if (line.trim() === '') {
      spaceList.push('blank');
      return;
    }
    const itemMatch = fenceMatch ? null : REGEX_ITEM_LINE_ANY.exec(line);
    const isAfterBlank = spaceList[index - 1] === 'blank';
    if (!itemMatch) {
      spaceList.push('');
      return;
    }
    const indent = itemMatch[1].length;
    if (index === 0 || isAfterBlank || indentItemPrevious === -1) spaceList.push('');
    else spaceList.push(indent === indentItemPrevious ? 'item' : 'list');
    indentItemPrevious = indent;
  });
  return spaceList;
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
