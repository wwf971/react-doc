import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { lineTokenReplace, relocateApply, relocatePlanBuild } from './doc-relocate.ts';
import { DocLinkIndexBuilder, documentReferenceListGet } from './doc-link-index.ts';
import { docManagedDocListRead, docManagedRootCreate, docManagedTextRead } from './doc-managed-store.ts';

// a doc page "demo" with a folder root "demo" and a virtual root "notes", its side panel naming b.md
function pageCreate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-relocate-'));
  const fileByPath = {
    'a.md': '# A\n\nLinks: [to b](./b.md), [to c](sub/c.md), and `b.md`.\n\n- [b again](b.md#Section)\n',
    'b.md': '# B\n\n## Section\n\nBack to [a](./a.md).\n',
    'sub/c.md': '# C\n\nUp: [a](../a.md), see ![x](../img.png).\n',
    'img.png': 'png',
    '.doc-page/side-panel.yaml': 'sidePanelById:\n  main:\n    tree:\n      - doc: ~demo/a.md\n      - doc: ~demo/b.md   # B\n',
  };
  for (const [file, text] of Object.entries(fileByPath)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  const root = docManagedRootCreate(path.join(dir, '.doc-page', 'doc-managed'), { alias: 'notes' });
  return { dir, root };
}

// the context the development server builds (doc-source.ts relocateRun), read from disk now
function contextBuild({ dir, root }) {
  const entryList = [];
  const walk = (folder, rel = '') => {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) walk(path.join(folder, item.name), relPath);
      else entryList.push({ docPageAlias: 'demo', rootAlias: 'demo', relPath, name: item.name, ext: path.extname(item.name).slice(1), absPath: path.join(folder, item.name), internalPath: `~demo:demo/${relPath}`, collect: 'recursive' });
    }
  };
  walk(dir);
  for (const doc of docManagedDocListRead(root)) {
    const name = doc.record.path.split('/').at(-1);
    entryList.push({ docPageAlias: 'demo', rootAlias: 'notes', relPath: doc.record.path, name, ext: path.extname(name).slice(1), absPath: doc.fileMain, internalPath: `~demo:notes/${doc.record.path}`, collect: 'recursive', managed: { rootDir: root.dirAbs, doc } });
  }
  return {
    configDir: dir,
    entryList,
    rootList: [
      { docPageAlias: 'demo', rootAlias: 'demo', absPath: dir, rootAbsPath: dir, kind: 'folder', collect: 'recursive' },
      { docPageAlias: 'demo', rootAlias: 'notes', absPath: root.dirAbs, rootAbsPath: root.dirAbs, kind: 'managed', collect: 'recursive' },
    ],
    linkIndex: new DocLinkIndexBuilder().build(entryList, {}),
    referenceListOfText: (text, entry) => documentReferenceListGet(text, entry, {}),
    yamlFileList: [{ file: path.join(dir, '.doc-page', 'side-panel.yaml'), docPageAlias: 'demo', dirPage: dir, kind: 'sidePanel' }],
    readOnlyReasonGet: () => '',
  };
}

const hooksNone = { pathListMark() {}, configFileListWritten: () => '', dataReport() {}, historyPathMove() {} };

test('a reference is spelled anew only when it would no longer reach its file, in the style it was written in', () => {
  const page = pageCreate();
  const result = relocatePlanBuild([{ from: '~demo:demo/b.md', to: '~demo:notes/b.md' }], contextBuild(page));
  assert.equal(result.code, 0, result.message);
  const rewriteByDoc = Object.fromEntries(result.data.docList.map((doc) => [doc.docPath, doc.rewriteList.map((one) => [one.before, one.after])]));
  // a relative path into another root becomes a source path; a bare name still names one file
  assert.deepEqual(rewriteByDoc['~demo:demo/a.md'], [['./b.md', '~notes/b.md']]);
  // the moved document's own relative link
  assert.deepEqual(rewriteByDoc['~demo:demo/b.md'], [['./a.md', '~demo/a.md']]);
  assert.deepEqual(result.data.configList[0].rewriteList.map((one) => [one.before, one.after]), [['~demo/b.md', '~notes/b.md']]);
  assert.equal(result.data.moveList[0].kindTo, 'managed');
});

test('a move into a virtual root is written: the document, the references, the side panel', () => {
  const page = pageCreate();
  const context = contextBuild(page);
  const plan = relocatePlanBuild([{ from: '~demo:demo/b.md', to: '~demo:notes/guide/b.md' }], context);
  const result = relocateApply({ moveList: [{ from: '~demo:demo/b.md', to: '~demo:notes/guide/b.md' }], planKey: plan.data.planKey }, context, hooksNone);
  assert.equal(result.code, 0, result.message);
  assert.ok(!fs.existsSync(path.join(page.dir, 'b.md')));
  const [doc] = docManagedDocListRead(page.root);
  assert.equal(doc.record.path, 'guide/b.md');
  assert.equal(docManagedTextRead(doc), '# B\n\n## Section\n\nBack to [a](~demo/a.md).\n');
  assert.match(fs.readFileSync(path.join(page.dir, 'a.md'), 'utf-8'), /\[to b\]\(~notes\/guide\/b\.md\)/);
  assert.equal(fs.readFileSync(path.join(page.dir, '.doc-page', 'side-panel.yaml'), 'utf-8').split('\n')[4], '      - doc: ~notes/guide/b.md   # B', 'the line keeps its comment');
});

test('a plan made on another state of the source is refused with the plan as it is now', () => {
  const page = pageCreate();
  const context = contextBuild(page);
  const result = relocateApply({ moveList: [{ from: '~demo:demo/sub/c.md', to: '~demo:demo/c.md' }], planKey: 'stale' }, context, hooksNone);
  assert.equal(result.code, -2);
  assert.ok(result.data.planKey);
  assert.ok(fs.existsSync(path.join(page.dir, 'sub', 'c.md')), 'nothing was moved');
});

test('a moved document has its relative paths spelled from its new place', () => {
  const page = pageCreate();
  const context = contextBuild(page);
  const plan = relocatePlanBuild([{ from: '~demo:demo/sub/c.md', to: '~demo:demo/c.md' }], context);
  const rewrite = plan.data.docList.find((doc) => doc.docPath === '~demo:demo/sub/c.md');
  assert.deepEqual(rewrite.rewriteList.map((one) => [one.before, one.after]), [['../a.md', './a.md'], ['../img.png', './img.png']]);
});

test('moves that cannot be made are refused before anything is planned', () => {
  const context = contextBuild(pageCreate());
  assert.equal(relocatePlanBuild([{ from: '~demo:demo/img.png', to: '~demo:notes/img.png' }], context).code, -1);
  assert.equal(relocatePlanBuild([{ from: '~demo:demo/a.md', to: '~demo:demo/sub/c.md' }], context).code, -2);
  assert.equal(relocatePlanBuild([{ from: '~demo:demo/x.md', to: '~demo:demo/y.md' }], context).code, -3);
  assert.equal(relocatePlanBuild([{ from: '~demo:demo/a.md', to: '~demo:demo/a.mdx' }], context).code, -1);
});

test('a path is replaced where a reference can stand, never inside another word', () => {
  assert.deepEqual(lineTokenReplace('see [x](./b.md) and ./b.md.bak', './b.md', '~n/b.md'), { text: 'see [x](~n/b.md) and ./b.md.bak', count: 1 });
  assert.deepEqual(lineTokenReplace('`b.md`, [[b.md|B]], [y](b.md#s)', 'b.md', 'c.md'), { text: '`c.md`, [[c.md|B]], [y](c.md#s)', count: 3 });
  assert.deepEqual(lineTokenReplace('  src: ./img.png', './img.png', '../img.png').count, 1);
  assert.deepEqual(lineTokenReplace('prose b.md here', 'b.md', 'c.md').count, 0);
  assert.equal(lineTokenReplace('[x](a.md)', 'a.md', 'my notes/a.md').text, '[x](<my notes/a.md>)');
});
