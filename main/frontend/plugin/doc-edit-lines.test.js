import assert from 'node:assert/strict';
import test from 'node:test';
import { lineOperationApply, lineOperationIsValid, operationLineListGet, textLineListGet } from './doc-edit-lines.ts';

const text = 'line 1\nline 2\n\nline 4\n';

test('textLineListGet treats a trailing newline as the end of the last line', () => {
  assert.deepEqual(textLineListGet(''), []);
  assert.deepEqual(textLineListGet('a'), ['a']);
  assert.deepEqual(textLineListGet('a\nb\n'), ['a', 'b']);
  assert.deepEqual(textLineListGet('a\r\n\r\nb'), ['a', '', 'b']);
});

test('operationLineListGet keeps a trailing empty line', () => {
  assert.deepEqual(operationLineListGet(''), []);
  assert.deepEqual(operationLineListGet('a'), ['a']);
  assert.deepEqual(operationLineListGet('a\n'), ['a', '']);
  assert.deepEqual(operationLineListGet('\na\r\n'), ['', 'a', '']);
});

test('replaceLines replaces an inclusive 1-based range', () => {
  const result = lineOperationApply(text, { action: 'replaceLines', lineStart: 1, lineEnd: 2, text: 'one\ntwo\nthree' });
  assert.equal(result, 'one\ntwo\nthree\n\nline 4\n');
});

test('replaceLines with empty text removes the range', () => {
  const result = lineOperationApply(text, { action: 'replaceLines', lineStart: 4, lineEnd: 4, text: '' });
  assert.equal(result, 'line 1\nline 2\n\n');
});

test('insertLines inserts before the named line and appends at lineCount + 1', () => {
  assert.equal(
    lineOperationApply(text, { action: 'insertLines', lineAt: 3, text: '\ninserted' }),
    'line 1\nline 2\n\ninserted\n\nline 4\n',
  );
  assert.equal(
    lineOperationApply(text, { action: 'insertLines', lineAt: 5, text: '\nlast' }),
    'line 1\nline 2\n\nline 4\n\nlast\n',
  );
  assert.equal(lineOperationApply('', { action: 'insertLines', lineAt: 1, text: 'first' }), 'first\n');
  // a block inserted at the top keeps a blank line between itself and the next block
  assert.equal(
    lineOperationApply(text, { action: 'insertLines', lineAt: 1, text: 'top\n' }),
    'top\n\nline 1\nline 2\n\nline 4\n',
  );
});

test('deleteLines removes the range and the file can become empty', () => {
  assert.equal(lineOperationApply(text, { action: 'deleteLines', lineStart: 3, lineEnd: 4 }), 'line 1\nline 2\n');
  assert.equal(lineOperationApply('only\n', { action: 'deleteLines', lineStart: 1, lineEnd: 1 }), '');
});

test('line ending and missing trailing newline are kept', () => {
  assert.equal(
    lineOperationApply('a\r\nb\r\n', { action: 'replaceLines', lineStart: 2, lineEnd: 2, text: 'B\nC' }),
    'a\r\nB\r\nC\r\n',
  );
  assert.equal(
    lineOperationApply('a\nb', { action: 'replaceLines', lineStart: 2, lineEnd: 2, text: 'B' }),
    'a\nB',
  );
});

test('replaceAll replaces the whole file', () => {
  assert.equal(lineOperationApply(text, { action: 'replaceAll', text: 'x\ny' }), 'x\ny\n');
});

test('ranges outside the file are refused', () => {
  assert.throws(() => lineOperationApply(text, { action: 'replaceLines', lineStart: 3, lineEnd: 9, text: '' }));
  assert.throws(() => lineOperationApply(text, { action: 'deleteLines', lineStart: 2, lineEnd: 1 }));
  assert.throws(() => lineOperationApply(text, { action: 'insertLines', lineAt: 6, text: '' }));
  assert.throws(() => lineOperationApply(text, { action: 'insertLines', lineAt: 0, text: '' }));
});

test('lineOperationIsValid checks the shape of each action', () => {
  assert.equal(lineOperationIsValid({ action: 'replaceLines', lineStart: 1, lineEnd: 1, text: '' }), true);
  assert.equal(lineOperationIsValid({ action: 'replaceLines', lineStart: 1, lineEnd: 1 }), false);
  assert.equal(lineOperationIsValid({ action: 'insertLines', lineAt: 1, text: 'a' }), true);
  assert.equal(lineOperationIsValid({ action: 'deleteLines', lineStart: 1, lineEnd: 2 }), true);
  assert.equal(lineOperationIsValid({ action: 'replaceAll', text: 'a' }), true);
  assert.equal(lineOperationIsValid({ action: 'other' }), false);
  assert.equal(lineOperationIsValid(null), false);
});
