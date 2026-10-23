import assert from 'node:assert/strict';
import test from 'node:test';
import { blockPlaceNodeListMark } from './doc-block-place.js';

const nodeList = [{
  id: 'doc',
  label: 'a.md',
  childList: [{ id: 'block-0', label: 'A' }, { id: 'block-1', label: 'B' }, { id: 'block-2', label: 'C' }],
}];

function markListGet(list) {
  return list.flatMap((node) => [...(node.insertMark ? [`${node.id}:${node.insertMark}`] : []), ...markListGet(node.childList ?? [])]);
}

test('before / after mark the chosen block', () => {
  assert.deepEqual(markListGet(blockPlaceNodeListMark(nodeList, { nodeId: 'block-1', position: 'before' })), ['block-1:before']);
  assert.deepEqual(markListGet(blockPlaceNodeListMark(nodeList, { nodeId: 'block-2', position: 'after' })), ['block-2:after']);
});

test('inside the document marks its first or its last block', () => {
  assert.deepEqual(markListGet(blockPlaceNodeListMark(nodeList, { nodeId: 'doc', position: 'insideFirst' })), ['block-0:before']);
  assert.deepEqual(markListGet(blockPlaceNodeListMark(nodeList, { nodeId: 'doc', position: 'insideLast' })), ['block-2:after']);
});

test('nothing is marked for a place that is not valid, or an empty document', () => {
  assert.equal(blockPlaceNodeListMark(nodeList, { nodeId: 'block-1', position: 'after' }, false), nodeList);
  const empty = [{ id: 'doc', label: 'a.md', childList: [] }];
  assert.equal(blockPlaceNodeListMark(empty, { nodeId: 'doc', position: 'insideLast' }), empty);
});

test('the input tree is not changed', () => {
  blockPlaceNodeListMark(nodeList, { nodeId: 'block-0', position: 'after' });
  assert.deepEqual(markListGet(nodeList), []);
});
