import assert from 'node:assert/strict';
import test from 'node:test';
import { linkDirParamGet, linkItemListGet, linkMarkdownBuild } from './doc-link-complete.js';
import { sourcePathReferenceGet } from './doc-source-path.js';

const candidateList = [
  { path: '~main:example', kind: 'dir', entry: {} },
  { path: '~main:example/guide', kind: 'dir', entry: {} },
  { path: '~main:example/doc.md', kind: 'file', entry: { title: 'Doc page' } },
  { path: '~main:example/guide/setup.md', kind: 'file', entry: { title: 'Setup [beta]' } },
  { path: '~main:example/guide/usage.mdx', kind: 'file', entry: { title: '' } },
  { path: '~main:notes/setup.md', kind: 'file', entry: { title: 'Notes setup' } },
  { path: '~sub:sub-doc', kind: 'dir', entry: {} },
  { path: '~sub:sub-doc/setup.md', kind: 'file', entry: { title: 'Sub setup' } },
];
const fromPath = '~main:example/guide/usage.mdx';

test('the shortest exact reference', () => {
  assert.equal(sourcePathReferenceGet('~main:example/guide/setup.md', fromPath), './setup.md');
  assert.equal(sourcePathReferenceGet('~main:example/doc.md', fromPath), '../doc.md');
  assert.equal(sourcePathReferenceGet('~main:example/a/b.md', '~main:example/doc.md'), './a/b.md');
  assert.equal(sourcePathReferenceGet('~main:notes/setup.md', fromPath), '~notes/setup.md');
  assert.equal(sourcePathReferenceGet('~sub:sub-doc/setup.md', fromPath), '~sub:sub-doc/setup.md');
});

test('words find documents, the local doc page first', () => {
  const list = linkItemListGet('setup', { candidateList, fromPath });
  assert.deepEqual(list.map((item) => item.path), [
    '~main:example/guide/setup.md',
    '~main:notes/setup.md',
    '~sub:sub-doc/setup.md',
  ]);
  assert.equal(list[0].detail, '~example/guide/setup.md');
  assert.equal(list[2].detail, '~sub:sub-doc/setup.md');
  // every word must match; folders are not listed for words
  assert.deepEqual(linkItemListGet('notes set', { candidateList, fromPath }).map((item) => item.path), ['~main:notes/setup.md']);
  assert.equal(linkItemListGet('', { candidateList, fromPath }).every((item) => item.kind === 'file'), true);
  // a file without a title is named by its file name
  assert.equal(linkItemListGet('usage', { candidateList, fromPath })[0].label, 'usage');
});

test('a path walks one folder at a time, folders first', () => {
  assert.deepEqual(linkItemListGet('~example/', { candidateList, fromPath }).map((item) => item.path), [
    '~main:example/guide',
    '~main:example/doc.md',
  ]);
  assert.deepEqual(linkItemListGet('~example/guide/se', { candidateList, fromPath }).map((item) => item.path), ['~main:example/guide/setup.md']);
  assert.deepEqual(linkItemListGet('~sub:sub-doc/', { candidateList, fromPath }).map((item) => item.path), ['~sub:sub-doc/setup.md']);
  assert.deepEqual(linkItemListGet('./', { candidateList, fromPath }).map((item) => item.path), [
    '~main:example/guide/setup.md',
    '~main:example/guide/usage.mdx',
  ]);
  assert.deepEqual(linkItemListGet('../', { candidateList, fromPath }).map((item) => item.path), [
    '~main:example/guide',
    '~main:example/doc.md',
  ]);
  assert.deepEqual(linkItemListGet('~su', { candidateList, fromPath }).map((item) => item.path), ['~sub:sub-doc']);
});

test('a folder goes on inside it; a document becomes a Markdown link', () => {
  const [itemGuide] = linkItemListGet('~example/', { candidateList, fromPath });
  assert.equal(linkDirParamGet(itemGuide, '~example/'), '~example/guide/');
  const [itemSetup] = linkItemListGet('setup', { candidateList, fromPath });
  assert.equal(linkMarkdownBuild(itemSetup, 'setup', fromPath), '[Setup \\[beta\\]](./setup.md)');
  assert.equal(linkMarkdownBuild(itemSetup, 'setup#Install now', fromPath), '[Setup \\[beta\\]](<./setup.md#Install now>)');
  const itemSub = linkItemListGet('sub setup', { candidateList, fromPath })[0];
  assert.equal(linkMarkdownBuild(itemSub, 'sub setup', fromPath), '[Sub setup](~sub:sub-doc/setup.md)');
});
