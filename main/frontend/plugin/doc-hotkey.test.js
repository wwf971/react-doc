import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hotkeyConfigGet, hotkeyConfigOfDocPageListGet } from './doc-hotkey.ts';
import { apiDeclaredConfigOfDocPageListGet } from './doc-api-config.ts';

function docPageMake(fileByPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-hotkey-'));
  for (const [file, text] of Object.entries(fileByPath)) {
    const filePath = path.join(dir, file);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  }
  return dir;
}

test('the maps of a doc page: the folder by convention, main.yaml active, includes expanded lowest first', () => {
  const dir = docPageMake({
    '.doc-page/entry.yaml': 'docEntry: true\n',
    '.doc-page/hotkey/main.yaml': 'hotkeyMap:\n  include: [./base.yaml]\n  bindingList:\n    - { key: ctrl+1, api: nav/back }\n',
    '.doc-page/hotkey/base.yaml': 'hotkeyMap:\n  description: shared\n  bindingList:\n    - { key: ctrl+2, api: nav/forward, when: editMode }\n    - { key: ctrl+3, api: null }\n',
    '.doc-page/hotkey/other.yaml': 'hotkeyMap:\n  id: alt\n  bindingList: []\n',
  });
  const config = hotkeyConfigOfDocPageListGet([{ alias: 'a', entryFile: path.join(dir, '.doc-page/entry.yaml'), dirPage: dir, hotkey: undefined }], dir);
  assert.deepEqual(config.problemList, []);
  assert.equal(config.docPageList.length, 1);
  const docPage = config.docPageList[0];
  assert.equal(docPage.alias, 'a');
  assert.equal(docPage.mapIdActive, 'main');
  assert.deepEqual(docPage.mapList.map((map) => map.id).sort(), ['alt', 'base', 'main']);
  const main = docPage.mapList.find((map) => map.id === 'main');
  assert.deepEqual(main.includeList, ['.doc-page/hotkey/base.yaml']);
  assert.deepEqual(main.bindingList.map((binding) => [binding.key, binding.api]), [['ctrl+2', 'nav/forward'], ['ctrl+3', null], ['ctrl+1', 'nav/back']]);
  assert.equal(main.bindingList[0].when, 'editMode');
  assert.equal(main.bindingList[0].place, '.doc-page/hotkey/base.yaml bindingList[0]');
  assert.equal(main.bindingList[2].place, '.doc-page/hotkey/main.yaml bindingList[0]');
  assert.ok(config.pathList.includes(path.join(dir, '.doc-page/hotkey')));
});

test('the maps of a doc page: the entry names the active map, false means none, problems are reported', () => {
  const dir = docPageMake({
    '.doc-page/entry.yaml': 'docEntry: true\n',
    '.doc-page/hotkey/main.yaml': 'hotkeyMap:\n  bindingList:\n    - { key: ctrl+1, api: nav/back }\n',
    '.doc-page/hotkey/vim.yaml': 'hotkeyMap:\n  bindingList:\n    - { key: ctrl+1 }\n    - { key: ctrl+2, api: nav/up, extra: 1 }\n    - { key: ctrl+3, api: nav/up }\n',
    '.doc-page/hotkey/loop-a.yaml': 'hotkeyMap:\n  include: [./loop-b.yaml]\n  bindingList: []\n',
    '.doc-page/hotkey/loop-b.yaml': 'hotkeyMap:\n  include: [./loop-a.yaml]\n  bindingList: []\n',
    '.doc-page/hotkey/bad.yaml': 'bindingList: []\n',
  });
  const entryFile = path.join(dir, '.doc-page/entry.yaml');
  const config = hotkeyConfigOfDocPageListGet([{ alias: 'a', entryFile, dirPage: dir, hotkey: { file: './hotkey/vim.yaml' } }], dir);
  const docPage = config.docPageList[0];
  assert.equal(docPage.mapIdActive, 'vim');
  const vim = docPage.mapList.find((map) => map.id === 'vim');
  // a binding with an unknown key is kept, with the problem reported
  assert.deepEqual(vim.bindingList.map((binding) => binding.key), ['ctrl+2', 'ctrl+3']);
  const messageList = config.problemList.map((problem) => `${problem.file}: ${problem.message}`);
  assert.ok(messageList.some((message) => message.includes('vim.yaml: bindingList[0]: "api" names an api')));
  assert.ok(messageList.some((message) => message.includes('vim.yaml: bindingList[1]: unknown key "extra"')));
  assert.ok(messageList.some((message) => message.includes('includes itself')));
  assert.ok(messageList.some((message) => message.includes('bad.yaml: a map file holds one mapping')));
  assert.equal(docPage.mapList.some((map) => map.id === 'bad'), false);

  const configNone = hotkeyConfigOfDocPageListGet([{ alias: 'a', entryFile, dirPage: dir, hotkey: false }], dir);
  assert.deepEqual(configNone.docPageList, []);
});

test('the doc pages are stacked with the including one last, so it decides', () => {
  const dir = docPageMake({
    'root/.doc-page/entry.yaml': 'docEntry: true\n',
    'root/.doc-page/hotkey/main.yaml': 'hotkeyMap:\n  bindingList: []\n',
    'root/sub/.doc-page/entry.yaml': 'docEntry: true\n',
    'root/sub/.doc-page/hotkey/main.yaml': 'hotkeyMap:\n  bindingList: []\n',
  });
  const config = hotkeyConfigOfDocPageListGet([
    { alias: 'root', entryFile: path.join(dir, 'root/.doc-page/entry.yaml'), dirPage: path.join(dir, 'root'), hotkey: undefined },
    { alias: 'sub', entryFile: path.join(dir, 'root/sub/.doc-page/entry.yaml'), dirPage: path.join(dir, 'root/sub'), hotkey: undefined },
  ], dir);
  assert.deepEqual(config.docPageList.map((docPage) => docPage.alias), ['sub', 'root']);
});

test('the package map and the workspace map: one file each, under fixed ids, missing files reported', () => {
  const dir = docPageMake({
    'hotkey/default.yaml': 'hotkeyMap:\n  id: whatever\n  description: the package keys\n  include: [./shared.yaml]\n  bindingList:\n    - { key: f1, api: palette/toggle }\n',
    'hotkey/shared.yaml': 'hotkeyMap:\n  bindingList:\n    - { key: alt+home, api: nav/home }\n',
    'workspace-hotkey.yaml': 'hotkeyMap:\n  bindingList:\n    - { key: alt+home, api: null }\n',
  });
  const config = hotkeyConfigGet({
    filePackage: { id: 'package', file: path.join(dir, 'hotkey/default.yaml'), alias: 'package' },
    fileWorkspace: { id: 'workspace', file: path.join(dir, 'workspace-hotkey.yaml'), alias: 'workspace' },
    docPageInputList: [],
  }, dir);
  assert.deepEqual(config.problemList, []);
  assert.equal(config.mapPackage.id, 'package');
  assert.equal(config.mapPackage.description, 'the package keys');
  assert.deepEqual(config.mapPackage.bindingList.map((binding) => [binding.key, binding.api]), [['alt+home', 'nav/home'], ['f1', 'palette/toggle']]);
  assert.equal(config.mapWorkspace.id, 'workspace');
  assert.deepEqual(config.mapWorkspace.bindingList.map((binding) => [binding.key, binding.api]), [['alt+home', null]]);
  assert.ok(config.pathList.includes(path.join(dir, 'hotkey/default.yaml')));
  assert.ok(config.pathList.includes(path.join(dir, 'workspace-hotkey.yaml')));

  const configMissing = hotkeyConfigGet({ filePackage: { id: 'package', file: path.join(dir, 'none.yaml'), alias: 'package' }, docPageInputList: [] }, dir);
  assert.equal(configMissing.mapPackage, undefined);
  assert.match(configMissing.problemList[0].message, /not found/);
  assert.equal(configMissing.mapWorkspace, undefined);
});

test('the declared apis of a doc page: aliases and sequences, problems reported', () => {
  const dir = docPageMake({
    '.doc-page/entry.yaml': 'docEntry: true\n',
    '.doc-page/api.yaml': [
      'apiList:',
      '  - id: a/open',
      '    label: Open',
      '    run: { api: nav/goTo, params: { target: x.md } }',
      '  - id: a/two',
      '    run:',
      '      - { api: nav/goTo, params: { target: x.md } }',
      '      - { api: edit/modeSet, params: { isOn: true } }',
      '    palette: false',
      '  - id: bad',
      '    run: { api: nav/back }',
      '  - id: a/norun',
      '  - id: a/open',
      '    run: { api: nav/back }',
      '',
    ].join('\n'),
  });
  const entryFile = path.join(dir, '.doc-page/entry.yaml');
  const config = apiDeclaredConfigOfDocPageListGet([{ alias: 'a', entryFile, api: undefined }], dir);
  assert.deepEqual(config.list.map((item) => item.id), ['a/open', 'a/two']);
  assert.equal(config.list[0].label, 'Open');
  assert.deepEqual(config.list[0].runList, [{ api: 'nav/goTo', params: { target: 'x.md' } }]);
  assert.equal(config.list[1].runList.length, 2);
  assert.equal(config.list[1].palette, false);
  assert.equal(config.list[0].docPageAlias, 'a');
  const messageList = config.problemList.map((problem) => problem.message);
  assert.ok(messageList.some((message) => message.includes('apiList[2]: "id" is {layer}/{name}')));
  assert.ok(messageList.some((message) => message.includes('apiList[3]: "run" names the api')));
  assert.ok(messageList.some((message) => message.includes('apiList[4]: the id a/open is declared already')));
  assert.ok(config.pathList.includes(path.join(dir, '.doc-page/api.yaml')));

  const configNone = apiDeclaredConfigOfDocPageListGet([{ alias: 'a', entryFile, api: false }], dir);
  assert.deepEqual(configNone.list, []);
  const configMissing = apiDeclaredConfigOfDocPageListGet([{ alias: 'a', entryFile, api: { file: './none.yaml' } }], dir);
  assert.match(configMissing.problemList[0].message, /not found/);
});
