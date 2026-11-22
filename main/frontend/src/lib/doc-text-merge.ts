// Lines of two texts compared, and three texts merged: the pure part of the
// edit history (doc_page_impl_edit_history.md), used by the development
// server to undo and redo a change on a file that changed since
// (plugin/doc-edit-history.ts) and by the page to find where a change took
// place and how it moved the lines (lib/doc-comp-state.js).
//
//   lineHunkListGet(aList, bList)        where two lists of lines differ: hunks
//                                        { aStart, aEnd, bStart, bEnd }, 0-based,
//                                        end exclusive: a[aStart, aEnd) became
//                                        b[bStart, bEnd)
//   textMerge3({ base, ours, theirs })   the changes from base to ours and from
//                                        base to theirs, both applied; refused
//                                        where both changed the same lines
//   textChangeRangeListGet(before, after) the places of after that changed, as
//                                        lines (1-based, inclusive)
//   textChangeOperationListGet(before, after) the change as line operations on
//                                        before (lib/doc-line-operation.ts)
//
// a text is its lines split at "\n" and nothing else: a "\r" stays in its line
// and a trailing newline is an empty last line, so a text is put back exactly
// by joining its lines with "\n".

export type LineHunk = { aStart: number; aEnd: number; bStart: number; bEnd: number };

export type TextMergeResult =
  | { code: 0; message: string; data: { text: string } }
  | { code: -1; message: string; data: { lineStart: number; lineEnd: number } };

export type TextChangeRange = { lineStart: number; lineEnd: number };

// past this number of differences in the part two texts do not share, the
// part is taken as one hunk: a merge is then refused where it would succeed
// with a finer comparison, never wrong
const DIFFERENCE_COUNT_MAX = 2000;

export function textLineSplit(text: string): string[] {
  return String(text ?? '').split('\n');
}

export function lineHunkListGet(aList: string[], bList: string[]): LineHunk[] {
  const lengthMin = Math.min(aList.length, bList.length);
  let prefix = 0;
  while (prefix < lengthMin && aList[prefix] === bList[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < lengthMin - prefix && aList[aList.length - 1 - suffix] === bList[bList.length - 1 - suffix]) suffix += 1;
  const a = aList.slice(prefix, aList.length - suffix);
  const b = bList.slice(prefix, bList.length - suffix);
  if (a.length === 0 && b.length === 0) return [];
  const hunkWhole = [{ aStart: prefix, aEnd: prefix + a.length, bStart: prefix, bEnd: prefix + b.length }];
  if (a.length === 0 || b.length === 0) return hunkWhole;
  const stepList = editStepListGet(a, b);
  if (!stepList) return hunkWhole;
  const hunkList: LineHunk[] = [];
  let aIndex = 0;
  let bIndex = 0;
  let index = 0;
  while (index < stepList.length) {
    if (stepList[index] === STEP_EQUAL) {
      aIndex += 1;
      bIndex += 1;
      index += 1;
      continue;
    }
    const hunk = { aStart: prefix + aIndex, aEnd: 0, bStart: prefix + bIndex, bEnd: 0 };
    while (index < stepList.length && stepList[index] !== STEP_EQUAL) {
      if (stepList[index] === STEP_DELETE) aIndex += 1;
      else bIndex += 1;
      index += 1;
    }
    hunk.aEnd = prefix + aIndex;
    hunk.bEnd = prefix + bIndex;
    hunkList.push(hunk);
  }
  return hunkList;
}

const STEP_EQUAL = 0;
const STEP_DELETE = 1;
const STEP_INSERT = 2;

// the shortest edit of a into b (Myers, "An O(ND) difference algorithm"):
// a list of steps, each an equal line, a line of a deleted, or a line of b
// inserted. undefined past DIFFERENCE_COUNT_MAX differences
function editStepListGet(a: string[], b: string[]): number[] | undefined {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // the furthest x of every diagonal after each round, for the way back
  const trace: Int32Array[] = [];
  let dFound = -1;
  for (let d = 0; d <= Math.min(max, DIFFERENCE_COUNT_MAX); d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      // a path is never followed past the ends: only the corner ends the search
      if (x === n && y === m) {
        dFound = d;
        break;
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
    if (dFound >= 0) break;
  }
  if (dFound < 0) return undefined;
  const stepListReversed: number[] = [];
  let x = n;
  let y = m;
  for (let d = dFound; d > 0; d -= 1) {
    const previous = trace[d - 1];
    const previousGet = (k: number) => previous[k + d - 1];
    const k = x - y;
    const isDown = k === -d || (k !== d && previousGet(k - 1) < previousGet(k + 1));
    const kPrevious = isDown ? k + 1 : k - 1;
    const xPrevious = previousGet(kPrevious);
    const yPrevious = xPrevious - kPrevious;
    const xSnake = isDown ? xPrevious : xPrevious + 1;
    while (x > xSnake) {
      stepListReversed.push(STEP_EQUAL);
      x -= 1;
      y -= 1;
    }
    stepListReversed.push(isDown ? STEP_INSERT : STEP_DELETE);
    x = xPrevious;
    y = yPrevious;
  }
  while (x > 0) {
    stepListReversed.push(STEP_EQUAL);
    x -= 1;
  }
  return stepListReversed.reverse();
}

type HunkSided = LineHunk & { side: 'ours' | 'theirs' };

// the changes from base to ours and from base to theirs in one text. two
// changes of the same lines are one change when they write the same, and a
// conflict otherwise: then nothing is merged and the lines of base the two
// changed are answered (1-based, inclusive)
export function textMerge3({ base, ours, theirs }: { base: string; ours: string; theirs: string }): TextMergeResult {
  if (ours === theirs || theirs === base) return { code: 0, message: '', data: { text: ours } };
  if (ours === base) return { code: 0, message: '', data: { text: theirs } };
  const baseList = textLineSplit(base);
  const listBySide = { ours: textLineSplit(ours), theirs: textLineSplit(theirs) };
  const hunkList: HunkSided[] = [
    ...lineHunkListGet(baseList, listBySide.ours).map((hunk) => ({ ...hunk, side: 'ours' as const })),
    ...lineHunkListGet(baseList, listBySide.theirs).map((hunk) => ({ ...hunk, side: 'theirs' as const })),
  ].sort((x, y) => x.aStart - y.aStart || x.aEnd - y.aEnd);
  const lineList: string[] = [];
  let cursor = 0;
  let index = 0;
  while (index < hunkList.length) {
    const group = [hunkList[index]];
    let aStart = hunkList[index].aStart;
    let aEnd = hunkList[index].aEnd;
    index += 1;
    // a hunk belongs to the group when it starts inside it, or where it starts
    // (two insertions at one place, an insertion at the start of a change)
    while (index < hunkList.length && (hunkList[index].aStart < aEnd || hunkList[index].aStart === aStart)) {
      aEnd = Math.max(aEnd, hunkList[index].aEnd);
      group.push(hunkList[index]);
      index += 1;
    }
    for (let line = cursor; line < aStart; line += 1) lineList.push(baseList[line]);
    const sideSet = new Set(group.map((hunk) => hunk.side));
    if (sideSet.size === 1) {
      const hunk = group[0];
      lineList.push(...listBySide[hunk.side].slice(hunk.bStart, hunk.bEnd));
    } else {
      const linesOurs = groupSideLinesGet(baseList, listBySide.ours, group.filter((hunk) => hunk.side === 'ours'), aStart, aEnd);
      const linesTheirs = groupSideLinesGet(baseList, listBySide.theirs, group.filter((hunk) => hunk.side === 'theirs'), aStart, aEnd);
      if (linesOurs.join('\n') !== linesTheirs.join('\n')) {
        const lineEnd = Math.max(aStart + 1, aEnd);
        return {
          code: -1,
          message: lineEnd === aStart + 1 ? `line ${aStart + 1} was changed on both sides` : `lines ${aStart + 1}–${lineEnd} were changed on both sides`,
          data: { lineStart: aStart + 1, lineEnd },
        };
      }
      lineList.push(...linesOurs);
    }
    cursor = aEnd;
  }
  for (let line = cursor; line < baseList.length; line += 1) lineList.push(baseList[line]);
  return { code: 0, message: '', data: { text: lineList.join('\n') } };
}

// the lines base[aStart, aEnd) become on one side, its hunks applied
function groupSideLinesGet(baseList: string[], sideList: string[], hunkList: LineHunk[], aStart: number, aEnd: number): string[] {
  const lineList: string[] = [];
  let cursor = aStart;
  for (const hunk of hunkList) {
    for (let line = cursor; line < hunk.aStart; line += 1) lineList.push(baseList[line]);
    lineList.push(...sideList.slice(hunk.bStart, hunk.bEnd));
    cursor = hunk.aEnd;
  }
  for (let line = cursor; line < aEnd; line += 1) lineList.push(baseList[line]);
  return lineList;
}

// where after differs from before, in the lines of after (1-based, inclusive).
// lines only removed are a range of no line at the place they were:
// lineEnd = lineStart - 1
export function textChangeRangeListGet(before: string, after: string): TextChangeRange[] {
  return lineHunkListGet(textLineSplit(before), textLineSplit(after)).map((hunk) => ({ lineStart: hunk.bStart + 1, lineEnd: hunk.bEnd }));
}

// the change from before to after as line operations built on before
// (lib/doc-line-operation.ts), each on lines of its own, so that what follows
// the lines of a document (the states of its blocks, lib/doc-comp-state.js
// lineShiftListGet) follows a whole text written back as it follows an edit
export function textChangeOperationListGet(before: string, after: string): any[] {
  const afterList = textLineSplit(after);
  return lineHunkListGet(textLineSplit(before), afterList).map((hunk) => {
    const text = afterList.slice(hunk.bStart, hunk.bEnd).join('\n');
    if (hunk.aStart === hunk.aEnd) return { action: 'insertLines', lineAt: hunk.aStart + 1, text };
    if (hunk.bStart === hunk.bEnd) return { action: 'deleteLines', lineStart: hunk.aStart + 1, lineEnd: hunk.aEnd };
    return { action: 'replaceLines', lineStart: hunk.aStart + 1, lineEnd: hunk.aEnd, text };
  });
}
