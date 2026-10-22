import assert from 'node:assert/strict';
import test from 'node:test';
import { sourcePathTreeBuild, sourceTreeSearch } from './doc-source-complete.js';

const manifests = {
  fileManifest: [
    { internalPath: '~example/doc.md', ext: 'md' },
    { internalPath: '~example/doc-config.md', ext: 'md' },
    { internalPath: '~example/mdx-usage/image.md', ext: 'md' },
    { internalPath: '~example/mdx-usage/comp-doc-link.mdx', ext: 'mdx' },
    { internalPath: '~example/service-instance.md', ext: 'md' },
  ],
  dirManifest: [
    { internalPath: '~example' },
    { internalPath: '~example/mdx-usage' },
  ],
};
const tree = sourcePathTreeBuild({ kind: 'file', extList: ['md', 'mdx'] }, manifests);

function labelListGet(nodeList) {
  return nodeList.flatMap((node) => [node.label, ...labelListGet(node.childList ?? [])]);
}

test('an empty text leaves the tree as it is', () => {
  const result = sourceTreeSearch(tree, '  ');
  assert.equal(result.nodeList, tree);
  assert.equal(result.matchCount, 0);
});

test('the tree is narrowed to the matches and the folders leading to them, opened', () => {
  const result = sourceTreeSearch(tree, 'doc');
  assert.deepEqual(labelListGet(result.nodeList), ['~example', 'mdx-usage', 'comp-doc-link.mdx', 'doc-config.md', 'doc.md']);
  assert.equal(result.matchCount, 3);
  assert.deepEqual(result.idExpandedList.sort(), ['~example', '~example/mdx-usage']);
  const folder = result.nodeList[0];
  assert.deepEqual(folder.labelMatchList, []);
});

test('every word must occur; the matched ranges are merged and in order', () => {
  const result = sourceTreeSearch(tree, 'Doc CONF');
  assert.deepEqual(labelListGet(result.nodeList), ['~example', 'doc-config.md']);
  const node = result.nodeList[0].childList[0];
  assert.deepEqual(node.labelMatchList, [[0, 3], [4, 8]]);
});

test('a word occurring twice in a label is marked twice', () => {
  const result = sourceTreeSearch([{ id: 'a', label: 'a-doc-doc.md', childList: [] }], 'doc');
  assert.deepEqual(result.nodeList[0].labelMatchList, [[2, 5], [6, 9]]);
});

test('nothing matching gives an empty tree', () => {
  const result = sourceTreeSearch(tree, 'zzz');
  assert.deepEqual(result.nodeList, []);
  assert.equal(result.matchCount, 0);
});
