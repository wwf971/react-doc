import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePathBuild, sourcePathFullGet, sourcePathLocalGet, sourcePathObjectGet, sourcePathParse, sourcePathRelativeResolve, sourcePathDirGet, sourceRootObjectBuild } from './doc-source-path.js';
import { docTargetResolve, sourceIndexBuild } from './doc-target-resolve.js';

// documents registered by an object (doc_page_impl_source.md#documents-registered-by-an-object)
const root = sourceRootObjectBuild('frontend', 'w5a');
const entryOf = (internalPath) => ({ internalPath, name: internalPath.split('/').pop() });
const entryList = [
  entryOf('~page:${frontend.id:w5a}/zettel/rag/rag-chunking.md'),
  entryOf('~page:${frontend.id:w5a}/question/q015.md'),
  entryOf('~page:${frontend.id:w5b}/zettel/rag-chunking.md'),
  entryOf('~page:doc/guide.md'),
];
const rootObjectList = [
  { namespace: 'frontend', id: 'w5a', name: 'Box', rootAlias: '${frontend.id:w5a}', docPageAlias: 'page' },
  { namespace: 'frontend', id: 'w5b', name: 'Box', rootAlias: '${frontend.id:w5b}', docPageAlias: 'page' },
  { namespace: 'frontend', id: 'w5c', name: 'w5a', rootAlias: '${frontend.id:w5c}', docPageAlias: 'page' },
];
const index = sourceIndexBuild(entryList, rootObjectList);

test('an object root is one segment, whatever its reference holds', () => {
  assert.deepEqual(sourcePathParse('~${frontend.id:w5a}/zettel/a.md'), { docPageAlias: '', rootAlias: '${frontend.id:w5a}', relPath: 'zettel/a.md' });
  assert.deepEqual(sourcePathParse('~page:${frontend.id:w5a}/zettel/a.md'), { docPageAlias: 'page', rootAlias: '${frontend.id:w5a}', relPath: 'zettel/a.md' });
  assert.deepEqual(sourcePathParse('~page:${frontend.id:w5a}'), { docPageAlias: 'page', rootAlias: '${frontend.id:w5a}', relPath: '' });
  assert.equal(sourcePathBuild(root, 'a.md', 'page'), '~page:${frontend.id:w5a}/a.md');
  assert.equal(sourcePathLocalGet('~page:${frontend.id:w5a}/a.md'), '~${frontend.id:w5a}/a.md');
  assert.equal(sourcePathFullGet('~${frontend.id:w5a}/a.md', 'page'), '~page:${frontend.id:w5a}/a.md');
  assert.deepEqual(sourcePathObjectGet('~page:${frontend.id:w5a}/a.md'), { namespace: 'frontend', by: 'id', ref: 'w5a' });
  assert.equal(sourcePathObjectGet('~page:doc/a.md'), undefined);
  assert.equal(sourcePathRelativeResolve(sourcePathDirGet('~page:${frontend.id:w5a}/zettel/rag/a.md'), '../../question/q015.md'), '~page:${frontend.id:w5a}/question/q015.md');
});

test('a document of an object is found by id, by name, relatively and by its file name', () => {
  const from = '~page:${frontend.id:w5a}/question/q015.md';
  assert.equal(docTargetResolve('~${frontend.id:w5a}/zettel/rag/rag-chunking.md', '~page:doc/guide.md', index).entryList[0].internalPath, entryList[0].internalPath);
  assert.equal(docTargetResolve('../zettel/rag/rag-chunking.md#semantic', from, index).entryList[0].internalPath, entryList[0].internalPath);
  // a name several objects have: its own object first
  assert.deepEqual(docTargetResolve('rag-chunking.md', from, index).entryList.map((entry) => entry.internalPath), [entryList[0].internalPath]);
  assert.equal(docTargetResolve('rag-chunking.md', '~page:doc/guide.md', index).entryList.length, 2);
});

test('an object named twice resolves to the first, with a warning; an unknown one to nothing', () => {
  const byName = docTargetResolve('~${frontend:Box}/question/q015.md', '', index);
  assert.equal(byName.entryList[0].internalPath, entryList[1].internalPath);
  assert.match(byName.warning, /2 objects answer/);
  // without .id or .name: an id first, though another object has it as its name
  assert.equal(docTargetResolve('~${frontend:w5a}/question/q015.md', '', index).entryList[0].internalPath, entryList[1].internalPath);
  assert.equal(docTargetResolve('~${frontend:w5a}/question/q015.md', '', index).warning, undefined);
  assert.equal(docTargetResolve('~${frontend.name:w5a}/question/q015.md', '', index).entryList.length, 0);
  assert.equal(docTargetResolve('~${frontend.name:Box}/question/q015.md', '', index).entryList.length, 1);
  assert.equal(docTargetResolve('~${frontend:Nothing}/question/q015.md', '', index).entryList.length, 0);
  assert.equal(docTargetResolve('~${frontend:w5zzz}/question/q015.md', '', index).entryList.length, 0);
});

test('the query of a target is what the link asks of the navigation', () => {
  const result = docTargetResolve('q015.md?nav=page#option-b', '~page:${frontend.id:w5a}/zettel/rag/rag-chunking.md', index);
  assert.equal(result.entryList[0].internalPath, entryList[1].internalPath);
  assert.deepEqual(result.param, { nav: 'page' });
  assert.equal(result.hash, 'option-b');
  assert.deepEqual(docTargetResolve('guide.md', '', index).param, {});
});
