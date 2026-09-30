import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blockMdxIsContentSanitizedGet,
  blockMdxStyleGet,
  blockMdxTitleComponentPropsGet,
} from './BlockMdxData.js';

test('title component props accept an object or an inline YAML mapping', () => {
  assert.deepEqual(blockMdxTitleComponentPropsGet({ label: 'Q&A' }), { label: 'Q&A' });
  assert.deepEqual(
    blockMdxTitleComponentPropsGet('{label: "Q&A", color: "#0f766e"}'),
    { label: 'Q&A', color: '#0f766e' },
  );
  assert.deepEqual(blockMdxTitleComponentPropsGet('[a, b]'), {});
  assert.deepEqual(blockMdxTitleComponentPropsGet('{broken'), {});
  assert.deepEqual(blockMdxTitleComponentPropsGet(undefined), {});
});

test('block colors become css variables only when authored', () => {
  assert.equal(blockMdxStyleGet({}), undefined);
  assert.deepEqual(blockMdxStyleGet({ backgroundColorTitle: '#eee' }), {
    '--doc-block-title-background': '#eee',
  });
  assert.deepEqual(blockMdxStyleGet({ backgroundColorTitle: ' ', backgroundColorContent: 'white' }), {
    '--doc-block-content-background': 'white',
  });
});

test('content sanitizing is enabled only by the explicit boolean prop', () => {
  assert.equal(blockMdxIsContentSanitizedGet({}), false);
  assert.equal(blockMdxIsContentSanitizedGet({ isContentSanitized: 'true' }), true);
  assert.equal(blockMdxIsContentSanitizedGet({ isContentSanitized: true }), true);
});
