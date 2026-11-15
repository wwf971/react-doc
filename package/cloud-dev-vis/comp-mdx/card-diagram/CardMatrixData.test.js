import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CARD_MATRIX_TONE_LIST, cardMatrixCellOf, cardMatrixNormalize, cardMatrixWidthGet } from './CardMatrixData.js';

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
