import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockSimpleIsCopyEnabledGet,
  blockSimpleIsTitleHiddenGet,
  blockSimpleSourceGet,
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

test('simple block copy action is enabled only by the explicit boolean prop', () => {
  assert.equal(blockSimpleIsCopyEnabledGet({}), false);
  assert.equal(blockSimpleIsCopyEnabledGet({ isCopyEnabled: 'false' }), false);
  assert.equal(blockSimpleIsCopyEnabledGet({ isCopyEnabled: true }), true);
  assert.equal(blockSimpleIsCopyEnabledGet({ isCopyEnabled: 'True' }), true);
});

test('simple block source drops quote and alert markers and keeps Markdown', () => {
  const raw = ['> [!INFO]', '> Run `npm install`.', '>', '> Then [read](a.md).'].join('\n');
  assert.equal(blockSimpleSourceGet({ raw }), 'Run `npm install`.\n\nThen [read](a.md).');
  assert.equal(blockSimpleSourceGet({}), '');
});
