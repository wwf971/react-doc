import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARD_MATRIX_TONE_LIST, cardMatrixBandOf, cardMatrixCellOf, cardMatrixNormalize, cardMatrixWidthGet } from './CardMatrixData.js';

const matrix = (cellList) => ({ rowList: [{ id: 'a', label: 'A' }], columnList: [{ id: '1', label: '1' }, { id: '2', label: '2' }], cellList });

test('a cell may be toned, a heatmap of the cells; an unknown tone is refused', () => {
  const data = cardMatrixNormalize(matrix([{ row: 'a', column: '1', tone: 'green' }, { row: 'a', column: '2', tone: 'red', mark: '3' }]));
  assert.equal(cardMatrixCellOf(data)('a', '2').tone, 'red');
  assert.ok(CARD_MATRIX_TONE_LIST.includes('slate'));
  assert.throws(() => cardMatrixNormalize(matrix([{ row: 'a', column: '1', tone: 'pink' }])), /tone of a cell/);
});

test('a cell names a row and a column the matrix has; the width follows the columns', () => {
  assert.throws(() => cardMatrixNormalize(matrix([{ row: 'b', column: '1' }])), /does not have/);
  assert.equal(cardMatrixWidthGet({ ...matrix([]), rowHeadWidth: 100, cellSize: 20 }), 140);
});

test('a band shades its row or its column, lighter where a row and a column of one band cross; a band is { id, tone }', () => {
  const band = { id: 'g', tone: 'amber' };
  const [row, column, other] = [{ id: 'a', band }, { id: 'a', band }, { id: 'b' }];
  assert.deepEqual(cardMatrixBandOf(row, column), { tone: 'amber', isCross: true });
  assert.deepEqual(cardMatrixBandOf(row, other), { tone: 'amber', isCross: false });
  assert.deepEqual(cardMatrixBandOf(other, { id: 'c', band: { id: 'h', tone: 'blue' } }), { tone: 'blue', isCross: false });
  assert.equal(cardMatrixBandOf(other, other), null);
  assert.doesNotThrow(() => cardMatrixNormalize({ rowList: [row, { id: 'b', isGroupStart: true }], columnList: [column], cellList: [] }));
  assert.throws(() => cardMatrixNormalize({ rowList: [{ id: 'a', band: { id: 'g', tone: 'pink' } }], columnList: [], cellList: [] }), /band of a row/);
});
