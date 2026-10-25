import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { docEntryFileFind, docEntryLoad, docWorkspaceLoad } from './doc-entry.ts';
import { docEditMiddlewareCreate } from './doc-edit-server.ts';
import { lineOperationApply } from './doc-edit-lines.ts';
import { yamlValueSetOperationBuild } from './doc-yaml-edit.ts';

// the doc page folder convention (doc_page_impl_dir.md) and the doc page
// config layer (doc_page_impl_config.md#the-doc-page-layer): an entry found
// from a folder, config declarations stacked in order, a value of one
// declaration written in place.

// a doc page folder "guide" with its metadata in .doc-page/, including the
// doc page folder "sub" by its folder
function fixtureCreate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-entry-config-'));
  const fileWrite = (relPath, lineList) => {
    fs.mkdirSync(path.dirname(path.join(dir, relPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, relPath), lineList.join('\n'));
  };
  fileWrite('guide/a.md', ['# A', '']);
  fileWrite('guide/.doc-page/entry.yaml', [
    'docEntry:',
    '  title: Guide',
    'source:',
    '  - action: addFolder',
    '    alias: guide',
    '    path: ..',
    '    collect: recursive',
    'config:',
    '  - file: ./config.yaml',
    '  # written in place, after the file',
    '  - TagsDisplayAtLinkPosition: after   # keep this comment',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~guide/a.md',
    '      - id: sub',
    '        include: ../../sub',
    '',
  ]);
  fileWrite('guide/.doc-page/config.yaml', [
    'variable:',
    '  dirImage: ~guide/image',
    'config:',
    '  TagsDisplayAtLinkPosition: before',
    '  compConfig:',
    '    Image:',
    '      FileStoreDir: ${dirImage}',
    '',
  ]);
  fileWrite('sub/b.md', ['# B', '']);
  fileWrite('sub/.doc-page/entry.yaml', [
    'docEntry: true',
    'source:',
    '  - action: addFolder',
    '    alias: sub',
    '    path: ..',
    '    collect: recursive',
    'config:',
    '  TagsDisplayAtLinkPosition: before',
    '  TagsDisplayAtLinkIsOn: true',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~sub/b.md',
    '',
  ]);
  return dir;
}

test('a doc page folder: the entry is found in .doc-page/, then in the folder itself', () => {
  const dir = fixtureCreate();
  assert.equal(docEntryFileFind(path.join(dir, 'guide')), path.join(dir, 'guide/.doc-page/entry.yaml'));
  fs.writeFileSync(path.join(dir, 'flat-entry.yaml'), 'docEntry: true\n');
  assert.equal(docEntryFileFind(dir), path.join(dir, 'flat-entry.yaml'));
  fs.writeFileSync(path.join(dir, 'other-entry.yaml'), 'docEntry: true\n');
  assert.throws(() => docEntryFileFind(dir), /several entry files/);
  assert.throws(() => docEntryFileFind(path.join(dir, 'guide/a.md')), /doc page folder not found/);
});

test('config declarations: an included doc page first, then the entry and its config file in the order read', () => {
  const dir = fixtureCreate();
  const loaded = docEntryLoad(path.join(dir, 'guide'), dir);
  assert.deepEqual(
    loaded.configDeclarationList.map((declaration) => [declaration.file, declaration.path, declaration.entryFile]),
    [
      ['sub/.doc-page/entry.yaml', ['config'], 'sub/.doc-page/entry.yaml'],
      ['guide/.doc-page/config.yaml', ['config'], 'guide/.doc-page/entry.yaml'],
      ['guide/.doc-page/entry.yaml', ['config', 1], 'guide/.doc-page/entry.yaml'],
    ],
  );
  assert.equal(loaded.configDeclarationList[1].config.compConfig.Image.FileStoreDir, '${dirImage}');
  assert.deepEqual(loaded.variableByName, { dirImage: '~guide/image' });
  assert.ok(loaded.fileListLoaded.includes(path.join(dir, 'guide/.doc-page/config.yaml')));
  // the included doc page was given by its folder; its paths are made full
  assert.equal(loaded.sidePanel.tree[1].children[0].doc, '~sub:sub/b.md');
  assert.equal(loaded.sidePanel.tree[1].children[0].docPageAlias, 'sub');
  assert.equal(loaded.sidePanel.tree[1].includeSource.docPageAlias, 'sub');
  assert.deepEqual(loaded.configDeclarationList.map((declaration) => declaration.docPageAlias), ['sub', 'guide', 'guide']);
});

test('a config file reference holds "file" only, and config files do not cycle', () => {
  const dir = fixtureCreate();
  const entryFile = path.join(dir, 'guide/.doc-page/entry.yaml');
  const text = fs.readFileSync(entryFile, 'utf-8');
  fs.writeFileSync(entryFile, text.replace('  - file: ./config.yaml', '  - file: ./config.yaml\n    TagsDisplayAtLinkIsOn: true'));
  assert.throws(() => docEntryLoad(entryFile, dir), /holds "file" only/);
  fs.writeFileSync(entryFile, text);
  fs.writeFileSync(path.join(dir, 'guide/.doc-page/config.yaml'), 'config:\n  file: ./config.yaml\n');
  assert.throws(() => docEntryLoad(entryFile, dir), /config file cycle/);
});

test('yamlValueSetOperationBuild steps into an item of a block list by its index', () => {
  const source = 'config:\n  - file: ./a.yaml\n  - Key: 1   # note\n    Other: x\n';
  const result = yamlValueSetOperationBuild(source, ['config', 1, 'Key'], '2');
  assert.equal(result.code, 0);
  assert.equal(lineOperationApply(source, result.data.operation), 'config:\n  - file: ./a.yaml\n  - Key: 2   # note\n    Other: x\n');
  assert.equal(yamlValueSetOperationBuild(source, ['config', 3, 'Key'], '2').code, -1);
  assert.equal(yamlValueSetOperationBuild('config: [{ Key: 1 }]\n', ['config', 0, 'Key'], '2').code, -1);
  assert.equal(yamlValueSetOperationBuild(source, ['config', 1], '2').code, -1);
});

// one request to the edit middleware, without a server
function requestRun(middleware, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = '/__doc-edit/config/value';
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (text) => resolve(JSON.parse(String(text))),
    };
    middleware(req, res, () => resolve({ code: 404 }));
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  });
}

test('config/value writes one declared value of a declaration in place, and nothing else', async () => {
  const dir = fixtureCreate();
  const declarationListGet = () => docEntryLoad(path.join(dir, 'guide'), dir).configDeclarationList;
  const writtenList = [];
  const middleware = docEditMiddlewareCreate({
    endpoint: '/__doc-edit',
    fileEntryListGet: () => [],
    config: {
      configDir: dir,
      declarationListGet,
      onFileListWritten: (fileList) => {
        writtenList.push(...fileList);
        return '';
      },
    },
  });
  const entryFile = path.join(dir, 'guide/.doc-page/entry.yaml');
  const configFile = path.join(dir, 'guide/.doc-page/config.yaml');

  const written = await requestRun(middleware, {
    file: 'guide/.doc-page/entry.yaml', keyPath: ['config', 1, 'TagsDisplayAtLinkPosition'], value: 'before', valueBase: 'after',
  });
  assert.equal(written.code, 0);
  assert.ok(fs.readFileSync(entryFile, 'utf-8').includes('  - TagsDisplayAtLinkPosition: before   # keep this comment\n'));
  assert.ok(fs.existsSync(`${entryFile}.bak`));
  assert.equal(writtenList.length, 1);

  const writtenComp = await requestRun(middleware, {
    file: 'guide/.doc-page/config.yaml', keyPath: ['config', 'compConfig', 'Image', 'FileStoreDir'], value: '~guide/png', valueBase: '${dirImage}',
  });
  assert.equal(writtenComp.code, 0);
  assert.ok(fs.readFileSync(configFile, 'utf-8').includes('      FileStoreDir: ~guide/png\n'));

  // a changed base, a key not declared, a path outside a declaration
  const textBefore = fs.readFileSync(configFile, 'utf-8');
  assert.equal((await requestRun(middleware, {
    file: 'guide/.doc-page/config.yaml', keyPath: ['config', 'TagsDisplayAtLinkPosition'], value: 'after', valueBase: 'after',
  })).code, -2);
  assert.equal((await requestRun(middleware, {
    file: 'guide/.doc-page/config.yaml', keyPath: ['config', 'TagsDisplayAtLinkIsOn'], value: true,
  })).code, -3);
  assert.equal((await requestRun(middleware, {
    file: 'guide/.doc-page/config.yaml', keyPath: ['variable', 'dirImage'], value: '~x',
  })).code, -3);
  assert.equal((await requestRun(middleware, {
    file: 'guide/.doc-page/entry.yaml', keyPath: ['docEntry', 'title'], value: 'X',
  })).code, -3);
  assert.equal(fs.readFileSync(configFile, 'utf-8'), textBefore, 'refused writes leave the file as it is');
});

// ---------- the workspace (doc_page_impl_source.md#the-workspace) ----------

// a workspace file naming the two doc pages of the fixture at root level,
// with the guide including sub as well
function workspaceSpecGet(dir, docPageList) {
  return { isVirtual: false, docPageList: docPageList.map((item) => ({ ...item, dir: path.join(dir, item.dir) })) };
}

test('a doc page is one thing however often it is reached: the root-level alias wins, another alias is a warning', (context) => {
  const warn = context.mock.method(console, 'warn', () => {});
  const dir = fixtureCreate();
  const loaded = docWorkspaceLoad(workspaceSpecGet(dir, [{ alias: 'guide', dir: 'guide' }, { alias: 'extra', dir: 'sub' }]), dir);
  assert.deepEqual(loaded.docPageList.map((docPage) => [docPage.alias, docPage.isRoot, docPage.mentionList.length]), [
    ['guide', true, 1], ['extra', true, 2],
  ]);
  // the include in guide named no alias: the folder name "sub" differs from "extra"
  assert.equal(loaded.workspace.warningList.length, 1);
  assert.match(loaded.workspace.warningList[0], /mentioned as "sub" at guide\/.doc-page\/entry.yaml "include" at sidePanelById.main.tree\[1\], but is "extra" already/);
  assert.ok(warn.mock.calls.some((call) => /is "extra" already/.test(call.arguments[0])));
  // every mention is an edge of the workspace graph
  assert.deepEqual(loaded.workspace.includeList.map((include) => [include.fromAlias, include.toAlias, include.alias]), [
    ['', 'guide', 'guide'], ['', 'extra', 'extra'], ['guide', 'extra', 'sub'],
  ]);
  // several root doc pages: one section each, under its alias, holding its side panel; paths in the full form
  assert.deepEqual(loaded.sidePanel.tree.map((node) => [node.id, node.text, node.docPageAlias, node.children.length]), [
    ['doc-page-guide', 'guide', 'guide', 2], ['doc-page-extra', 'extra', 'extra', 1],
  ]);
  assert.deepEqual(loaded.sidePanel.tree.map((node) => node.docPageSection), [
    { alias: 'guide', title: 'Guide', isTemporary: false, isFirst: true },
    { alias: 'extra', title: loaded.workspace.docPageList[1].title, isTemporary: false, isFirst: false },
  ]);
  assert.equal(loaded.sidePanel.tree[0].children[0].doc, '~guide:guide/a.md');
  assert.equal(loaded.sidePanel.tree[1].children[0].doc, '~extra:sub/b.md');
  assert.equal(loaded.sourceRuleList[0].docPageAlias, 'guide');
  assert.equal(loaded.sourceRuleList[0].alias, 'guide');
  assert.equal(loaded.entry.title, 'Guide');
});

test('an include gives the doc page its alias; two doc pages with one alias, or two roots with one alias, are errors', () => {
  const dir = fixtureCreate();
  const entryFile = path.join(dir, 'guide/.doc-page/entry.yaml');
  const text = fs.readFileSync(entryFile, 'utf-8');
  fs.writeFileSync(entryFile, text.replace('        include: ../../sub', '        include: { dir: ../../sub, alias: second }'));
  const loaded = docEntryLoad(path.join(dir, 'guide'), dir);
  assert.deepEqual(loaded.docPageList.map((docPage) => docPage.alias), ['guide', 'second']);
  assert.equal(loaded.sidePanel.tree[1].children[0].doc, '~second:sub/b.md');
  assert.equal(loaded.workspace.isVirtual, true);
  assert.equal(loaded.workspace.docPageList[1].mentionList[0].isAliasGiven, true);
  // the same alias as the including doc page
  fs.writeFileSync(entryFile, text.replace('        include: ../../sub', '        include: { dir: ../../sub, alias: guide }'));
  assert.throws(() => docEntryLoad(path.join(dir, 'guide'), dir), /the alias "guide" names the doc page guide\/.doc-page\/entry.yaml already/);
  // "alias" on a reference that is not a doc page
  fs.writeFileSync(entryFile, text.replace('        include: ../../sub', '        include: { sidePanel: main, alias: x }'));
  assert.throws(() => docEntryLoad(path.join(dir, 'guide'), dir), /"alias" goes with "file" \/ "dir"/);
  // two folders of one doc page under one root alias
  fs.writeFileSync(entryFile, text.replace('    collect: recursive\n', '    collect: recursive\n  - action: addFolder\n    alias: guide\n    path: ../../sub\n    collect: direct\n'));
  assert.throws(() => docEntryLoad(path.join(dir, 'guide'), dir), /two roots of the doc page "guide" share the alias "guide"/);
  // the alias of a root defaults to its folder name
  fs.writeFileSync(entryFile, text.replace('    alias: guide\n', ''));
  const loadedDefault = docEntryLoad(path.join(dir, 'guide'), dir);
  assert.equal(loadedDefault.sourceRuleList[0].alias, 'guide');
  assert.deepEqual(loadedDefault.docPageList[0].rootList.map((root) => root.alias), ['guide']);
});
