import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  docIdOfFileNameGet,
  docManagedBlockContentRead,
  docManagedDocCreate,
  docManagedDocListRead,
  docManagedDocModeSet,
  docManagedDocMove,
  docManagedDocPathSet,
  docManagedRootCreate,
  docManagedRootListRead,
  docManagedRootSet,
  docManagedTextRead,
  docManagedTextWrite,
} from './doc-managed-store.ts';

const folderCreate = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doc-managed-'));
const text = '---\ntitle: Intro\n---\n\n# Intro\n\nSee [a](./a.md).\n\n- one\n- two\n';

test('a root is a folder with root.yaml; its documents lie flat in it, named by id', () => {
  const folder = folderCreate();
  const root = docManagedRootCreate(folder, { alias: 'notes', name: 'ノート' });
  assert.match(path.basename(root.dirAbs), /^[0-9a-z]+--notes$/);
  const doc = docManagedDocCreate(root, { path: 'guide/deep/intro.md', text });
  assert.deepEqual(fs.readdirSync(root.dirAbs).sort(), ['root.yaml', `${doc.base}.doc.yaml`, `${doc.base}.md`].sort());
  assert.match(doc.base, /--intro$/);
  assert.equal(docIdOfFileNameGet(`${doc.base}.doc.yaml`), doc.record.docId);
  assert.equal(docManagedTextRead(doc), text);
  assert.deepEqual(docManagedRootListRead(folder).map((one) => [one.alias, one.name]), [['notes', 'ノート']]);
  assert.throws(() => docManagedRootCreate(folder, { alias: 'notes' }), /exists already/);
  assert.throws(() => docManagedDocCreate(root, { path: 'guide/deep/intro.md', text: '' }), /already/);
  assert.throws(() => docManagedDocCreate(root, { path: 'a.png', text: '' }), /\.md or \.mdx/);
});

test('a document is written in its mode and form, and read back as the same text', () => {
  const folder = folderCreate();
  let root = docManagedRootCreate(folder, { alias: 'notes', mode: 'block' });
  let doc = docManagedDocCreate(root, { path: 'a.md', text });
  assert.equal(doc.record.mode, 'block');
  assert.ok(doc.fileMain.endsWith('.block.yaml'));
  assert.equal(docManagedTextRead(doc), text);
  const blockIdList = docManagedBlockContentRead(doc).blockList.map((block) => block.blockId);
  doc = docManagedTextWrite(root, doc, `${text}\nOne more.\n`);
  assert.deepEqual(docManagedBlockContentRead(doc).blockList.slice(0, blockIdList.length).map((block) => block.blockId), blockIdList);
  root = docManagedRootSet(root, { storage: 'pack' });
  [doc] = docManagedDocListRead(root);
  assert.equal(doc.storage, 'pack');
  assert.deepEqual(fs.readdirSync(root.dirAbs).filter((name) => !name.startsWith('root.yaml')), [`${doc.base}.rdoc`]);
  assert.equal(docManagedTextRead(doc), `${text}\nOne more.\n`);
  assert.deepEqual(docManagedBlockContentRead(doc).blockList.slice(0, blockIdList.length).map((block) => block.blockId), blockIdList, 'a change of form keeps the blocks');
  doc = docManagedDocModeSet(root, doc, 'text');
  assert.equal(docManagedTextRead(doc), `${text}\nOne more.\n`);
  root = docManagedRootSet(root, { storage: 'plain' });
  [doc] = docManagedDocListRead(root);
  assert.equal(fs.readFileSync(doc.fileMain, 'utf-8'), `${text}\nOne more.\n`, 'plain text mode is the text as it is');
});

test('a document renamed or moved keeps its id; its files follow its name', () => {
  const folder = folderCreate();
  const rootA = docManagedRootCreate(folder, { alias: 'a' });
  const rootB = docManagedRootCreate(folder, { alias: 'b', storage: 'pack' });
  let doc = docManagedDocCreate(rootA, { path: 'x/one.md', text: '# One\n' });
  const { docId } = doc.record;
  doc = docManagedDocPathSet(rootA, doc, 'y/two.md');
  assert.equal(doc.record.docId, docId);
  assert.match(doc.base, /--two$/);
  assert.equal(docManagedDocListRead(rootA).length, 1);
  doc = docManagedDocMove(rootA, doc, rootB, 'three.md');
  assert.equal(doc.record.docId, docId);
  assert.equal(doc.storage, 'pack');
  assert.equal(docManagedDocListRead(rootA).length, 0);
  assert.equal(docManagedTextRead(docManagedDocListRead(rootB)[0]), '# One\n');
});
