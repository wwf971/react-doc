import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  COMP_FOLDER_DEFAULT_LIST,
  compConfigOfDocPageListGet,
  compDocPageRead,
  compManifestPathIs,
  compPathIs,
} from './doc-comp-config.ts';
import { docSourcePlugin } from './doc-source.ts';

// the components of a doc page (doc_page_impl_mdx_comp.md#components-of-a-doc-page):
// found in the component folders of the doc page (comp-mdx/ by convention,
// or the folders .doc-page/comp.yaml names), described by comp.yaml
// manifests, mounted by the plugin into the registry of the page

// a doc page folder "page" (root "docs") including the doc page folder
// "page/sub" (root "sub"); each has a comp-mdx/ folder with modules and
// manifests. manifestByPage: the text of comp-mdx/comp.yaml of "page" /
// "sub"; compYamlByPage: the text of .doc-page/comp.yaml; entryLineListByPage:
// lines added to the entry
function fixtureCreate({ manifestByPage = {}, compYamlByPage = {}, entryLineListByPage = {}, subManifestText } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-comp-config-'));
  const pageDir = path.join(dir, 'page');
  const subDir = path.join(pageDir, 'sub');
  const fileWrite = (relPath, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, relPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, relPath), text);
  };
  fileWrite('page/a.md', '# A\n');
  fileWrite('page/sub/b.md', '# B\n');
  fileWrite('page/comp-mdx/Stock.jsx', 'export function Stock() { return null; }\nexport const stockDefineOptions = {};\n');
  fileWrite('page/comp-mdx/Counter.jsx', 'export function Counter() { return null; }\n');
  fileWrite('page/comp-mdx/readme.md', '# code, not a document\n');
  fileWrite('page/sub/comp-mdx/Sub.jsx', 'export function Sub() { return null; }\n');
  if (subManifestText !== undefined) fileWrite('page/comp-mdx/badge/comp.yaml', subManifestText);
  if (subManifestText !== undefined) fileWrite('page/comp-mdx/badge/Badge.jsx', 'export function Badge() { return null; }\n');
  fileWrite('page/.doc-page/entry.yaml', [
    'docEntry:',
    '  title: Fixture',
    ...(entryLineListByPage.page ?? []),
    'source:',
    '  - action: addFolder',
    '    alias: docs',
    '    path: ..',
    '    collect: recursive',
    '    exclude: [sub/]',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~docs/a.md',
    '      - id: sub',
    '        include: { dir: ../sub, alias: sub }',
    '',
  ].join('\n'));
  fileWrite('page/sub/.doc-page/entry.yaml', [
    'docEntry: true',
    ...(entryLineListByPage.sub ?? []),
    'source:',
    '  - action: addFolder',
    '    alias: sub',
    '    path: ..',
    '    collect: recursive',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~sub/b.md',
    '',
  ].join('\n'));
  if (manifestByPage.page !== undefined) fileWrite('page/comp-mdx/comp.yaml', manifestByPage.page);
  if (manifestByPage.sub !== undefined) fileWrite('page/sub/comp-mdx/comp.yaml', manifestByPage.sub);
  if (compYamlByPage.page !== undefined) fileWrite('page/.doc-page/comp.yaml', compYamlByPage.page);
  fileWrite('config.yaml', ['docEntry:', '  dir: ./page', 'compRegistry:', '  Stock: host/Stock', '  Other: host/Other', ''].join('\n'));
  return dir;
}

function pluginCreate(dir, command = 'serve') {
  const plugin = docSourcePlugin({ configFile: path.join(dir, 'config.yaml') });
  plugin.configResolved({ command, root: dir, base: '/' });
  return plugin;
}

function docPageInputList(dir, { compPage, compSub } = {}) {
  return [
    { alias: 'page', entryFile: path.join(dir, 'page/.doc-page/entry.yaml'), dirPage: path.join(dir, 'page'), comp: compPage },
    { alias: 'sub', entryFile: path.join(dir, 'page/sub/.doc-page/entry.yaml'), dirPage: path.join(dir, 'page/sub'), comp: compSub },
  ];
}

const MANIFEST_PAGE = [
  'compList:',
  '  - tagName: Stock',
  '    id: specific/Stock',
  '    entry: ./Stock.jsx',
  '    defineOptionsExport: stockDefineOptions',
  '  - tagName: Counter',
  '    entry: ./Counter.jsx',
  '  - tagName: SidePanelItem            # a built-in name, replaced',
  '    entry: ./Counter.jsx',
  '    export: Counter',
  '',
].join('\n');

test('without comp.yaml the component folder is comp-mdx/; the manifest describes the mounts', () => {
  const dir = fixtureCreate({ manifestByPage: { page: MANIFEST_PAGE } });
  const docPage = compDocPageRead(docPageInputList(dir)[0], dir);
  assert.equal(docPage.isConfigFileExists, false);
  assert.deepEqual(COMP_FOLDER_DEFAULT_LIST, ['comp-mdx']);
  assert.deepEqual(docPage.folderList, [path.join(dir, 'page/comp-mdx')]);
  assert.deepEqual(docPage.manifestFileList, [path.join(dir, 'page/comp-mdx/comp.yaml')]);
  assert.deepEqual(docPage.problemList, []);
  assert.deepEqual(docPage.mountList.map(({ tagName, id, export: exportName, defineOptionsExport, entryFile }) => (
    [tagName, id, exportName, defineOptionsExport, path.relative(dir, entryFile)]
  )), [
    ['Stock', 'specific/Stock', 'Stock', 'stockDefineOptions', 'page/comp-mdx/Stock.jsx'],
    ['Counter', 'page/Counter', 'Counter', '', 'page/comp-mdx/Counter.jsx'],
    ['SidePanelItem', 'page/SidePanelItem', 'Counter', '', 'page/comp-mdx/Counter.jsx'],
  ]);
});

test('manifests in groups at any depth, a folder before the folders inside it; a single mapping is one entry', () => {
  const dir = fixtureCreate({
    manifestByPage: { page: MANIFEST_PAGE },
    subManifestText: 'tagName: Badge\nentry: ./Badge.jsx\n',
  });
  // a group in a group, beside a manifest; a group without a manifest of its own
  fs.mkdirSync(path.join(dir, 'page/comp-mdx/badge/deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page/comp-mdx/badge/deep/comp.yaml'), 'tagName: Deep\nentry: ../Badge.jsx\n');
  fs.mkdirSync(path.join(dir, 'page/comp-mdx/chart/line'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page/comp-mdx/chart/line/Line.jsx'), 'export function Line() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'page/comp-mdx/chart/line/comp.yaml'), 'tagName: Line\nentry: ./Line.jsx\n');
  // never read: what a component's project brings along, dot folders
  fs.mkdirSync(path.join(dir, 'page/comp-mdx/chart/node_modules/x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page/comp-mdx/chart/node_modules/x/comp.yaml'), 'tagName: Nope\nentry: ./x.jsx\n');
  const docPage = compDocPageRead(docPageInputList(dir)[0], dir);
  assert.deepEqual(docPage.manifestFileList.map((file) => path.relative(dir, file)), [
    'page/comp-mdx/comp.yaml', 'page/comp-mdx/badge/comp.yaml', 'page/comp-mdx/badge/deep/comp.yaml', 'page/comp-mdx/chart/line/comp.yaml',
  ]);
  assert.deepEqual(docPage.mountList.map((mount) => mount.tagName), ['Stock', 'Counter', 'SidePanelItem', 'Badge', 'Deep', 'Line']);
  assert.equal(docPage.mountList[3].id, 'page/Badge');
  assert.deepEqual(docPage.problemList, []);
});

test('.doc-page/comp.yaml names other folders; comp: false has none; the entry may name another file', () => {
  const dir = fixtureCreate({ manifestByPage: { page: MANIFEST_PAGE }, compYamlByPage: { page: 'folderList:\n  - ../widgets\n  - ../comp-mdx\n' } });
  fs.mkdirSync(path.join(dir, 'page/widgets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page/widgets/W.jsx'), 'export function W() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'page/widgets/comp.yaml'), 'compList:\n  - { tagName: W, entry: ./W.jsx }\n');
  const docPage = compDocPageRead(docPageInputList(dir)[0], dir);
  assert.equal(docPage.isConfigFileExists, true);
  assert.deepEqual(docPage.folderList.map((folder) => path.relative(dir, folder)), ['page/widgets', 'page/comp-mdx']);
  assert.deepEqual(docPage.mountList.map((mount) => mount.tagName), ['W', 'Stock', 'Counter', 'SidePanelItem']);

  const configNone = compConfigOfDocPageListGet(docPageInputList(dir, { compPage: false, compSub: false }), dir);
  assert.deepEqual(configNone.mountList, []);
  assert.deepEqual(configNone.docPageList, []);

  fs.writeFileSync(path.join(dir, 'page/.doc-page/my-comp.yaml'), 'folderList: [../widgets]\n');
  const docPageNamed = compDocPageRead({ ...docPageInputList(dir)[0], comp: { file: './my-comp.yaml' } }, dir);
  assert.deepEqual(docPageNamed.mountList.map((mount) => mount.tagName), ['W']);
});

test('a bad entry is reported with its place and skipped, never the page', () => {
  const dir = fixtureCreate({
    manifestByPage: {
      page: [
        'compList:',
        '  - tagName: Stock',
        '    entry: ./Stock.jsx',
        '  - tagName: 9lives',
        '    entry: ./Stock.jsx',
        '  - tagName: Missing',
        '    entry: ./Nope.jsx',
        '  - tagName: NoEntry',
        '  - tagName: Stock',
        '    entry: ./Counter.jsx',
        '  - tagName: Counter',
        '    entry: ./Counter.jsx',
        '    color: red',
        '  - just a string',
        '',
      ].join('\n'),
    },
  });
  const docPage = compDocPageRead(docPageInputList(dir)[0], dir);
  assert.deepEqual(docPage.mountList.map((mount) => mount.tagName), ['Stock', 'Counter']);
  assert.equal(docPage.problemList.length, 6);
  assert.match(docPage.problemList[0], /comp\.yaml compList\[1\]: tagName must be a component tag name/);
  assert.match(docPage.problemList[1], /compList\[2\]: entry of Missing not found: \.\/Nope\.jsx/);
  assert.match(docPage.problemList[2], /compList\[3\]: entry names the module file of NoEntry/);
  assert.match(docPage.problemList[3], /compList\[4\]: the tag name Stock is declared in .*comp\.yaml already/);
  assert.match(docPage.problemList[4], /compList\[5\]: unknown key "color"/);
  assert.match(docPage.problemList[5], /compList\[6\]: an entry is a mapping/);

  // a manifest that is not a mapping: reported, nothing mounted
  fs.writeFileSync(path.join(dir, 'page/comp-mdx/comp.yaml'), '- a\n- b\n');
  const docPageList = compDocPageRead(docPageInputList(dir)[0], dir);
  assert.deepEqual(docPageList.mountList, []);
  assert.match(docPageList.problemList[0], /must be a mapping/);
});

test('two doc pages declaring one tag name: the first loaded wins, with a warning; ids likewise', () => {
  const dir = fixtureCreate({
    manifestByPage: {
      page: MANIFEST_PAGE,
      sub: 'compList:\n  - { tagName: Stock, entry: ./Sub.jsx, export: Sub }\n  - { tagName: Sub, entry: ./Sub.jsx }\n  - { tagName: SubAgain, id: page/Counter, entry: ./Sub.jsx, export: Sub }\n',
    },
  });
  const warnList = [];
  const warnOriginal = console.warn;
  console.warn = (text) => warnList.push(String(text));
  let config;
  try {
    config = compConfigOfDocPageListGet(docPageInputList(dir), dir);
  } finally {
    console.warn = warnOriginal;
  }
  assert.deepEqual(config.mountList.map((mount) => [mount.docPageAlias, mount.tagName, mount.id]), [
    ['page', 'Stock', 'specific/Stock'],
    ['page', 'Counter', 'page/Counter'],
    ['page', 'SidePanelItem', 'page/SidePanelItem'],
    ['sub', 'Sub', 'sub/Sub'],
  ]);
  assert.equal(warnList.length, 2);
  assert.match(warnList[0], /^\[doc-comp\] .*the tag name Stock is declared by doc page "page" already/);
  assert.match(warnList[1], /^\[doc-comp\] .*the id page\/Counter is declared for the tag Counter of doc page "page" already/);
});

test('the plugin imports every entry module, exports the mounts, and writes the tag names over compRegistry', () => {
  const dir = fixtureCreate({ manifestByPage: { page: MANIFEST_PAGE, sub: 'tagName: Sub\nentry: ./Sub.jsx\n' } });
  const plugin = pluginCreate(dir);
  const code = plugin.load('\0virtual:doc-source');
  const importList = code.split('\n').filter((line) => line.startsWith('import '));
  assert.deepEqual(importList, [
    `import * as docCompModule0 from ${JSON.stringify(path.join(dir, 'page/comp-mdx/Stock.jsx'))};`,
    `import * as docCompModule1 from ${JSON.stringify(path.join(dir, 'page/comp-mdx/Counter.jsx'))};`,
    `import * as docCompModule2 from ${JSON.stringify(path.join(dir, 'page/sub/comp-mdx/Sub.jsx'))};`,
  ]);
  assert.ok(code.includes('export const docCompMountList = ['));
  assert.ok(code.includes('"tagName":"SidePanelItem","id":"page/SidePanelItem","export":"Counter","defineOptionsExport":""'));
  assert.ok(code.includes('module: docCompModule1 }'));
  const configDoc = JSON.parse(/^export let configDoc = (.*);$/m.exec(code)[1]);
  // the doc page's tag name wins over config.yaml for that name; the other entries stay
  assert.deepEqual(configDoc.compRegistry, {
    Stock: 'specific/Stock',
    Other: 'host/Other',
    Counter: 'page/Counter',
    SidePanelItem: 'page/SidePanelItem',
    Sub: 'sub/Sub',
  });
  // the component folders are never documents nor folders of the source
  assert.ok(!code.includes('comp-mdx/readme.md'));
  assert.ok(!/dirManifest = .*comp-mdx/.test(code));
  assert.ok(code.includes('~page:docs/a.md'));
  // a build imports them the same way
  const codeBuild = pluginCreate(dir, 'build').load('\0virtual:doc-source');
  assert.equal(codeBuild.split('\n').filter((line) => line.startsWith('import ')).length, 3);
});

test('a file of a component folder is code (never a reload); a manifest or the comp config file is configuration', () => {
  const dir = fixtureCreate({ manifestByPage: { page: MANIFEST_PAGE } });
  const compConfig = compConfigOfDocPageListGet(docPageInputList(dir), dir);
  assert.equal(compPathIs(compConfig, path.join(dir, 'page/comp-mdx/Stock.jsx')), true);
  assert.equal(compPathIs(compConfig, path.join(dir, 'page/sub/comp-mdx/Sub.jsx')), true);
  assert.equal(compPathIs(compConfig, path.join(dir, 'page/a.md')), false);
  assert.equal(compManifestPathIs(compConfig, path.join(dir, 'page/comp-mdx/comp.yaml')), true);
  assert.equal(compManifestPathIs(compConfig, path.join(dir, 'page/comp-mdx/new/comp.yaml')), true);
  assert.equal(compManifestPathIs(compConfig, path.join(dir, 'page/comp-mdx/a/b/comp.yaml')), true);
  assert.equal(compManifestPathIs(compConfig, path.join(dir, 'page/comp-mdx/a/node_modules/comp.yaml')), false);
  assert.equal(compManifestPathIs(compConfig, path.join(dir, 'page/.doc-page/comp.yaml')), true);
  assert.equal(compManifestPathIs(compConfig, path.join(dir, 'page/comp-mdx/Stock.jsx')), false);
});
