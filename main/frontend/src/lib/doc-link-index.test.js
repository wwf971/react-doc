import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backlinkGroupListBuild,
  linkIndexBuild,
  linkIndexResolve,
  referrerListGet,
} from './doc-link-index.js';
import { sourceIndexBuild } from './doc-target-resolve.js';

const entryList = [
  { internalPath: '~ex:docs/a.md', name: 'a.md' },
  { internalPath: '~ex:docs/guide/b.md', name: 'b.md' },
  { internalPath: '~ex:docs/notes.md', name: 'notes.md' },
  { internalPath: '~ex:docs/sub/notes.md', name: 'notes.md' },
  { internalPath: '~ex:docs/run.ps1', name: 'run.ps1' },
  { internalPath: '~other:docs/a.md', name: 'a.md' },
];
const sourceIndex = sourceIndexBuild(entryList);

function referenceBuild(target, extra = {}) {
  return { target, kind: 'document', construct: 'link', blockLine: 1, headingTrail: [], ...extra };
}

test('a backlink is a reference of another document resolving to the file, in order of its line', () => {
  const linkIndex = linkIndexBuild({
    '~ex:docs/guide/b.md': { contentHash: 'x', linkList: [
      referenceBuild('../a.md#Setup', { sourceLine: 9, blockLine: 9 }),
      referenceBuild('a.md', { sourceLine: 3, blockLine: 3 }),
      referenceBuild('./b.md', { sourceLine: 4, blockLine: 4 }),
    ] },
  });
  const backlinkList = linkIndexResolve(linkIndex, sourceIndex).backlinkListByTarget.get('~ex:docs/a.md');
  assert.deepEqual(backlinkList.map((backlink) => [backlink.reference.target, backlink.fragment, backlink.key]), [
    ['a.md', '', '~ex:docs/guide/b.md:1'],
    ['../a.md#Setup', 'Setup', '~ex:docs/guide/b.md:0'],
  ]);
  // the document's reference to itself is not a backlink
  assert.equal(linkIndexResolve(linkIndex, sourceIndex).backlinkListByTarget.has('~ex:docs/guide/b.md'), false);
});

test('an ambiguous name is a backlink of every file it may reach; a source target needs a rooted path', () => {
  const linkIndex = linkIndexBuild({
    '~ex:docs/a.md': { contentHash: 'x', linkList: [
      referenceBuild('notes.md'),
      { ...referenceBuild('~docs/run.ps1'), kind: 'source', construct: 'link "inline-link"' },
      { ...referenceBuild('run.ps1'), kind: 'source', construct: 'link "inline-link"' },
    ] },
  });
  const backlinkListByTarget = linkIndexResolve(linkIndex, sourceIndex).backlinkListByTarget;
  assert.equal(backlinkListByTarget.get('~ex:docs/notes.md').length, 1);
  assert.equal(backlinkListByTarget.get('~ex:docs/sub/notes.md').length, 1);
  assert.equal(backlinkListByTarget.get('~ex:docs/run.ps1').length, 1);
});

test('a document\'s links and the backlinks of their targets are the same entries', () => {
  const linkIndex = linkIndexBuild({
    '~ex:docs/a.md': { contentHash: 'x', linkList: [referenceBuild('notes.md'), referenceBuild('gone.md'), referenceBuild('a.md'), referenceBuild('guide/b.md#Run')] },
  });
  const { linkListByDoc, backlinkListByTarget } = linkIndexResolve(linkIndex, sourceIndex);
  // an ambiguous name is a link to each file, keyed by the file; one that
  // resolves to nothing is kept with no target; a link to itself is left out
  assert.deepEqual(linkListByDoc.get('~ex:docs/a.md').map((link) => [link.key, link.targetPath, link.fragment]), [
    ['~ex:docs/a.md:0:~ex:docs/notes.md', '~ex:docs/notes.md', ''],
    ['~ex:docs/a.md:0:~ex:docs/sub/notes.md', '~ex:docs/sub/notes.md', ''],
    ['~ex:docs/a.md:1', '', ''],
    ['~ex:docs/a.md:3', '~ex:docs/guide/b.md', 'Run'],
  ]);
  assert.equal(backlinkListByTarget.get('~ex:docs/sub/notes.md')[0], linkListByDoc.get('~ex:docs/a.md')[1]);
  assert.equal(backlinkListByTarget.has(''), false);
});

test('the local doc page answers first, as a link does', () => {
  const linkIndex = linkIndexBuild({
    '~other:docs/a.md': { contentHash: 'x', linkList: [referenceBuild('a.md')] },
    '~ex:docs/guide/b.md': { contentHash: 'y', linkList: [referenceBuild('a.md')] },
  });
  const backlinkListByTarget = linkIndexResolve(linkIndex, sourceIndex).backlinkListByTarget;
  // ~other's own a.md is itself: no backlink; ~ex's b.md reaches ~ex's a.md only
  assert.equal(backlinkListByTarget.has('~other:docs/a.md'), false);
  assert.deepEqual(backlinkListByTarget.get('~ex:docs/a.md').map((backlink) => backlink.docPath), ['~ex:docs/guide/b.md']);
});

test('groups follow the order given, then the path; referrers count per document', () => {
  const linkIndex = linkIndexBuild({
    '~ex:docs/notes.md': { contentHash: 'x', linkList: [referenceBuild('a.md'), referenceBuild('a.md#x')] },
    '~ex:docs/guide/b.md': { contentHash: 'y', linkList: [referenceBuild('../a.md')] },
    '~ex:docs/sub/notes.md': { contentHash: 'z', linkList: [referenceBuild('../a.md')] },
  });
  const backlinkListByTarget = linkIndexResolve(linkIndex, sourceIndex).backlinkListByTarget;
  const order = new Map([['~ex:docs/notes.md', 2], ['~ex:docs/guide/b.md', 5]]);
  const groupList = backlinkGroupListBuild(
    backlinkListByTarget.get('~ex:docs/a.md'),
    (docPath) => order.get(docPath) ?? Number.POSITIVE_INFINITY,
  );
  assert.deepEqual(groupList.map((group) => [group.docPath, group.backlinkList.length]), [
    ['~ex:docs/notes.md', 2],
    ['~ex:docs/guide/b.md', 1],
    ['~ex:docs/sub/notes.md', 1],
  ]);
  assert.deepEqual(referrerListGet(backlinkListByTarget, '~ex:docs/a.md'), [
    { docPath: '~ex:docs/guide/b.md', count: 1 },
    { docPath: '~ex:docs/notes.md', count: 2 },
    { docPath: '~ex:docs/sub/notes.md', count: 1 },
  ]);
  assert.deepEqual(referrerListGet(backlinkListByTarget, '~ex:docs/run.ps1'), []);
});

test('an index without documents, or none, gives no backlinks', () => {
  assert.equal(linkIndexResolve(undefined, sourceIndex).backlinkListByTarget.size, 0);
  assert.equal(linkIndexResolve(linkIndexBuild({}), sourceIndex).backlinkListByTarget.size, 0);
});
