import assert from 'node:assert/strict';
import test from 'node:test';
import { blockVariantGet } from './BlockVariant.js';

test('Block defaults quote and untyped content to BlockSimple', () => {
  assert.equal(blockVariantGet({}), 'simple');
  assert.equal(blockVariantGet({ lang: '' }), 'simple');
});

test('Block selects BlockMdx for Markdown fenced content', () => {
  assert.equal(blockVariantGet({ lang: 'markdown' }), 'mdx');
  assert.equal(blockVariantGet({ lang: 'MDX' }), 'mdx');
});

test('an explicit variant overrides automatic selection', () => {
  assert.equal(blockVariantGet({ variant: 'simple', lang: 'markdown' }), 'simple');
  assert.equal(blockVariantGet({ variant: 'mdx' }), 'mdx');
});
