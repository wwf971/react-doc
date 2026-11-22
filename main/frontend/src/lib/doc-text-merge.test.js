import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lineHunkListGet, textChangeOperationListGet, textChangeRangeListGet, textLineSplit, textMerge3,
} from './doc-text-merge.ts';
import { lineOperationListApply } from './doc-line-operation.ts';

// applies the hunks of a into b to a, to check that they say what changed
function hunkListApply(aList, bList, hunkList) {
  const lineList = [];
  let cursor = 0;
  for (const hunk of hunkList) {
    lineList.push(...aList.slice(cursor, hunk.aStart), ...bList.slice(hunk.bStart, hunk.bEnd));
    cursor = hunk.aEnd;
  }
  lineList.push(...aList.slice(cursor));
  return lineList;
}

test('lineHunkListGet finds the lines that differ, and only those', () => {
  assert.deepEqual(lineHunkListGet(['a', 'b', 'c'], ['a', 'b', 'c']), []);
  assert.deepEqual(lineHunkListGet(['a', 'b', 'c'], ['a', 'x', 'c']), [{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }]);
  assert.deepEqual(lineHunkListGet(['a', 'c'], ['a', 'b', 'c']), [{ aStart: 1, aEnd: 1, bStart: 1, bEnd: 2 }]);
  assert.deepEqual(lineHunkListGet(['a', 'b', 'c'], ['a', 'c']), [{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 1 }]);
  assert.deepEqual(lineHunkListGet([], ['a']), [{ aStart: 0, aEnd: 0, bStart: 0, bEnd: 1 }]);
  // two changes apart are two hunks
  assert.deepEqual(lineHunkListGet(['a', 'b', 'c', 'd', 'e'], ['A', 'b', 'c', 'd', 'E']), [
    { aStart: 0, aEnd: 1, bStart: 0, bEnd: 1 },
    { aStart: 4, aEnd: 5, bStart: 4, bEnd: 5 },
  ]);
});

test('lineHunkListGet hunks rebuild the second text from the first', () => {
  const caseList = [
    [['a', 'b', 'c', 'a', 'b', 'b', 'a'], ['c', 'b', 'a', 'b', 'a', 'c']],
    [['x'], ['y']],
    [['1', '2', '3', '4', '5', '6'], ['0', '1', '3', '4', 'x', '6', '7']],
    [['', 'p', '', 'q', ''], ['', 'q', '', 'p', '']],
  ];
  for (const [a, b] of caseList) assert.deepEqual(hunkListApply(a, b, lineHunkListGet(a, b)), b);
});

test('lineHunkListGet rebuilds random texts', () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 200; round += 1) {
    const a = Array.from({ length: Math.floor(random() * 12) }, () => 'abcd'[Math.floor(random() * 4)]);
    const b = Array.from({ length: Math.floor(random() * 12) }, () => 'abcd'[Math.floor(random() * 4)]);
    assert.deepEqual(hunkListApply(a, b, lineHunkListGet(a, b)), b, `${a.join('')} -> ${b.join('')}`);
  }
});

test('textMerge3 applies two changes of different lines', () => {
  const base = '# Title\n\nfirst\n\nsecond\n\nthird\n';
  const ours = '# Title\n\nfirst, changed elsewhere\n\nsecond\n\nthird\n';
  const theirs = '# Title\n\nfirst\n\nsecond\n\nthird, undone\n';
  const result = textMerge3({ base, ours, theirs });
  assert.equal(result.code, 0);
  assert.equal(result.data.text, '# Title\n\nfirst, changed elsewhere\n\nsecond\n\nthird, undone\n');
});

test('textMerge3 takes a side when the other did not change, and a change made on both sides once', () => {
  assert.equal(textMerge3({ base: 'a\nb', ours: 'a\nb', theirs: 'a\nc' }).data.text, 'a\nc');
  assert.equal(textMerge3({ base: 'a\nb', ours: 'a\nc', theirs: 'a\nb' }).data.text, 'a\nc');
  assert.equal(textMerge3({ base: 'a\nb\nc', ours: 'a\nB\nc', theirs: 'a\nB\nc' }).data.text, 'a\nB\nc');
});

test('textMerge3 refuses two different changes of the same lines', () => {
  const result = textMerge3({ base: 'a\nb\nc\n', ours: 'a\nB1\nc\n', theirs: 'a\nB2\nc\n' });
  assert.equal(result.code, -1);
  assert.deepEqual(result.data, { lineStart: 2, lineEnd: 2 });
  // an insertion inside lines the other side rewrote
  assert.equal(textMerge3({ base: 'a\nb\nc\nd', ours: 'a\nB\nC\nd', theirs: 'a\nb\nx\nc\nd' }).code, -1);
  // two insertions at one place
  assert.equal(textMerge3({ base: 'a\nb', ours: 'a\nx\nb', theirs: 'a\ny\nb' }).code, -1);
});

test('textMerge3 keeps insertions and removals that do not meet', () => {
  const base = 'p1\n\np2\n\np3\n';
  // a block inserted at the top on one side, the last one removed on the other
  const result = textMerge3({ base, ours: 'new\n\np1\n\np2\n\np3\n', theirs: 'p1\n\np2\n' });
  assert.equal(result.code, 0);
  assert.equal(result.data.text, 'new\n\np1\n\np2\n');
});

test('textMerge3 keeps a carriage return as part of its line', () => {
  const result = textMerge3({ base: 'a\r\nb\r\nc\r\n', ours: 'A\r\nb\r\nc\r\n', theirs: 'a\r\nb\r\nC\r\n' });
  assert.equal(result.data.text, 'A\r\nb\r\nC\r\n');
});

test('textChangeRangeListGet names the changed lines of the text after', () => {
  assert.deepEqual(textChangeRangeListGet('a\nb\nc\n', 'a\nB\nc\n'), [{ lineStart: 2, lineEnd: 2 }]);
  // lines added
  assert.deepEqual(textChangeRangeListGet('a\nc\n', 'a\nb1\nb2\nc\n'), [{ lineStart: 2, lineEnd: 3 }]);
  // lines removed: no line, at the place they were
  assert.deepEqual(textChangeRangeListGet('a\nb\nc\n', 'a\nc\n'), [{ lineStart: 2, lineEnd: 1 }]);
  assert.deepEqual(textChangeRangeListGet('same', 'same'), []);
});

test('textChangeOperationListGet turns a change into line operations that make it', () => {
  const caseList = [
    ['a\nb\nc\n', 'a\nB\nc\n'],
    ['a\nc\n', 'a\nb\nc\n'],
    ['a\nb\nc\n', 'c\n'],
    ['p1\n\np2\n\np3\n', 'p0\n\np1\n\np3\nend\n'],
  ];
  for (const [before, after] of caseList) {
    const operationList = textChangeOperationListGet(before, after);
    // the operations name lines of before; applied together they give after
    // (lines as the edit layer counts them: the trailing newline is no line)
    const lineCount = textLineSplit(before).length;
    const result = lineOperationListApply(before, operationList.filter((operation) => (operation.lineStart ?? operation.lineAt) <= lineCount));
    assert.equal(result.replace(/\n+$/, ''), after.replace(/\n+$/, ''));
  }
});
