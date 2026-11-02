import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sidePanelNodeBuild, sidePanelNodeRequestIsValid } from './doc-side-panel-node.ts';
import {
  sourceFileBackupMove,
  sourceFileBackupNameIs,
  sourceFileBackupRestore,
  sourceFileDeleteListResolve,
  SourceFileDeleteRequestError,
} from './doc-source-file.ts';

// structure changes of a side-panel file (doc_page_impl_side_panel.md
// #changing-the-structure): one node inserted, removed or bound, in place,
// the comments and every other line kept

const source = [
  'sidePanelById:',
  '  main:',
  '    tree:',
  '      # the first document',
  '      - doc: ~ex/a.md',
  '      - id: f',
  '        text: Folder',
  '        children:',
  '          - doc: ~ex/b.md',
  '      - id: c',
  '        doc: ~ex/c.md',
  '        children: []',
  '      - text: Src',
  '        sourceFolder: ~ex/dir   # mirrored',
  '',
].join('\n');

const tree = ['sidePanelById', 'main', 'tree'];

const build = (request, text = source) => {
  assert.ok(sidePanelNodeRequestIsValid(request), `valid request: ${JSON.stringify(request)}`);
  const result = sidePanelNodeBuild(text, request);
  assert.equal(result.code, 0, result.message);
  return result.data.text;
};

const refuse = (request, pattern) => {
  const result = sidePanelNodeBuild(source, request);
  assert.equal(result.code, -1);
  assert.match(result.message, pattern);
};

test('a folder is inserted before an item, with an empty children list', () => {
  const text = build({ action: 'insert', listPath: tree, index: 1, node: { kind: 'folder', text: 'New: folder' } });
  assert.equal(text, source.replace('      - id: f\n', '      - text: "New: folder"\n        children: []\n      - id: f\n'));
});

test('a document goes into an empty children list, which becomes a block list', () => {
  const text = build({ action: 'insert', listPath: [...tree, 2, 'children'], index: -1, node: { kind: 'doc', doc: '~ex/new.mdx' } });
  assert.match(text, /- id: c\n {8}doc: ~ex\/c\.md\n {8}children:\n {10}- doc: ~ex\/new\.mdx\n/);
});

test('an item is removed with the comment above it; an item holding items is refused', () => {
  const text = build({ action: 'remove', path: [...tree, 0] });
  assert.ok(!text.includes('the first document') && !text.includes('~ex/a.md'));
  assert.ok(text.includes('text: Folder'));
  refuse({ action: 'remove', path: [...tree, 1] }, /holds items/);
});

test('a document folder detached keeps its label as text and its children', () => {
  const text = build({ action: 'bind', path: [...tree, 2], binding: { kind: 'none' }, text: 'C title' });
  assert.match(text, /- id: c\n {8}text: C title\n {8}children: \[\]\n/);
  assert.ok(!text.includes('~ex/c.md'));
});

test('a source folder becomes a document folder, then a virtual folder', () => {
  const textDoc = build({ action: 'bind', path: [...tree, 3], binding: { kind: 'doc', path: '~ex/z.md' } });
  assert.match(textDoc, /- text: Src\n {8}doc: ~ex\/z\.md\n {8}children: \[\]\n/);
  const textNone = build({ action: 'bind', path: [...tree, 3], binding: { kind: 'none' } });
  assert.match(textNone, /- text: Src\n {8}children: \[\]\n/);
});

test('an empty folder takes a source folder; its label is kept and "children" goes', () => {
  const text = build({ action: 'bind', path: [...tree, 2], binding: { kind: 'folder', path: '~ex/d2' }, text: 'C title' });
  const node = text.slice(text.indexOf('- id: c'), text.indexOf('- text: Src'));
  assert.match(node, /sourceFolder: ~ex\/d2/);
  assert.match(node, /text: C title/);
  assert.ok(!node.includes('children') && !node.includes('doc:'));
});

test('a leaf changes its document only; a folder holding items takes no source folder', () => {
  const text = build({ action: 'bind', path: [...tree, 0], binding: { kind: 'doc', path: '~ex/a2.md' } });
  assert.ok(text.includes('      - doc: ~ex/a2.md\n'));
  refuse({ action: 'bind', path: [...tree, 0], binding: { kind: 'folder', path: '~ex/x' } }, /bound to a document only/);
  refuse({ action: 'bind', path: [...tree, 1], binding: { kind: 'folder', path: '~ex/x' } }, /holds items/);
});

test('a label is required where the node would lose it', () => {
  const sourceNoText = source.replace('        text: Folder\n', '');
  const result = sidePanelNodeBuild(sourceNoText, { action: 'bind', path: [...tree, 1], binding: { kind: 'none' } });
  assert.equal(result.code, -1);
  assert.match(result.message, /label/);
});

test('requests are checked before the file is read', () => {
  assert.equal(sidePanelNodeRequestIsValid({ action: 'insert', listPath: tree, index: 0, node: { kind: 'folder', text: '' } }), false);
  assert.equal(sidePanelNodeRequestIsValid({ action: 'remove', path: [...tree, 'x'] }), false);
  assert.equal(sidePanelNodeRequestIsValid({ action: 'bind', path: [...tree, 0], binding: { kind: 'doc' } }), false);
  assert.equal(sidePanelNodeRequestIsValid({ action: 'rename', path: [...tree, 0] }), false);
});

// the file operations of the source layer a removal uses (doc-source-file.ts)

test('a deleted file goes into a hidden backup beside it, which is recognized and restored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-source-file-'));
  try {
    const absPath = path.join(dir, 'a.md');
    fs.writeFileSync(absPath, '# A\n');
    const entryList = [{ absPath, internalPath: '~ex/a.md' }];
    const fileList = sourceFileDeleteListResolve(['~ex/a.md', '~ex/a.md'], entryList);
    assert.equal(fileList.length, 1);
    const movedList = sourceFileBackupMove(fileList);
    assert.equal(fs.existsSync(absPath), false);
    assert.ok(sourceFileBackupNameIs(path.basename(movedList[0].backup)));
    assert.equal(sourceFileBackupNameIs('a.md'), false);
    assert.equal(sourceFileBackupNameIs('.a.md.deleted'), false);
    sourceFileBackupRestore(movedList);
    assert.equal(fs.readFileSync(absPath, 'utf-8'), '# A\n');
    assert.throws(() => sourceFileDeleteListResolve(['~ex/b.md'], entryList), SourceFileDeleteRequestError);
    assert.throws(() => sourceFileDeleteListResolve(['~ex/a.md'], entryList, [absPath]), SourceFileDeleteRequestError);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
