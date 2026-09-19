import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockSimpleIsTitleHiddenGet,
  blockSimpleTitleGet,
  blockSimpleToneGet,
} from './BlockSimpleState.js';

test('simple block normalizes supported tones', () => {
  assert.equal(blockSimpleToneGet({ type: 'WARNING' }), 'warning');
  assert.equal(blockSimpleToneGet({ type: 'error' }), 'error');
  assert.equal(blockSimpleToneGet({ tone: 'important' }), 'important');
  assert.equal(blockSimpleToneGet({ type: 'unknown' }), 'info');
});

test('simple block title defaults to the uppercase tone', () => {
  assert.equal(blockSimpleTitleGet({ type: 'warning' }), 'WARNING');
  assert.equal(blockSimpleTitleGet({ type: 'caution' }), 'CAUTION');
  assert.equal(blockSimpleTitleGet({ type: 'error' }), 'ERROR');
});

test('simple block title can be customized but not hidden with an empty title', () => {
  assert.equal(blockSimpleTitleGet({ type: 'warning', title: 'Important operation' }), 'Important operation');
  assert.equal(blockSimpleTitleGet({ type: 'warning', title: '   ' }), 'WARNING');
});

test('simple block title is hidden only by the explicit boolean prop', () => {
  assert.equal(blockSimpleIsTitleHiddenGet({}), false);
  assert.equal(blockSimpleIsTitleHiddenGet({ isTitleHidden: false }), false);
  assert.equal(blockSimpleIsTitleHiddenGet({ isTitleHidden: 'false' }), false);
  assert.equal(blockSimpleIsTitleHiddenGet({ isTitleHidden: true }), true);
  assert.equal(blockSimpleIsTitleHiddenGet({ isTitleHidden: 'TRUE' }), true);
});
