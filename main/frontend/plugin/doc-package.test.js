import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { docPackageListLoad, docPackageSpecListRead } from './doc-package.ts';
import { compConfigOfDocPageListGet } from './doc-comp-config.ts';
import { docSourcePlugin } from './doc-source.ts';

// the packages a workspace imports (doc_page_impl_dir.md#the-package-folder):
// a folder with doc-package.yaml (name, description, packageDependList, all
// required), doc/README.md, and components in comp-mdx/ described by the
// manifests of a doc page

// a doc page "page" and the packages "vis" (needing "base") and "base";
// configLines: what config.yaml says beside docEntry
function fixtureCreate({ configLines = ['packageList:', '  - dir: ./package/vis'], packageYamlByName = {}, isBaseReadmeMissing = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-package-'));
  const fileWrite = (relPath, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, relPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, relPath), text);
  };
  fileWrite('page/a.md', '# A\n');
  fileWrite('page/.doc-page/entry.yaml', [
    'docEntry:',
    '  title: Fixture',
    'source:',
    '  - action: addFolder',
    '    alias: docs',
    '    path: ..',
    '    collect: recursive',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~docs/a.md',
    '',
  ].join('\n'));
  fileWrite('page/.doc-page/comp-mdx/comp.yaml', 'tagName: Chart\nentry: ./Chart.jsx\n');
  fileWrite('page/.doc-page/comp-mdx/Chart.jsx', 'export function Chart() { return null; }\n');
  fileWrite('package/vis/doc-package.yaml', packageYamlByName.vis ?? 'name: vis\ndescription: Diagrams\npackageDependList:\n  - dir: ../base\n');
  fileWrite('package/vis/doc/README.md', '# vis\n');
  fileWrite('package/vis/comp-mdx/flow/comp.yaml', [
    'compList:',
    '  - tagName: Flow',
    '    entry: ./Flow.jsx',
    '    dependencyCollect: { entry: ./FlowSource.js, export: flowCollect }',
    '  - tagName: Chart                 # the doc page declares it too',
    '    entry: ./Flow.jsx',
    '    export: Flow',
    '',
  ].join('\n'));
  fileWrite('package/vis/comp-mdx/flow/Flow.jsx', 'export function Flow() { return null; }\n');
  fileWrite('package/vis/comp-mdx/flow/FlowSource.js', 'export function flowCollect() {}\n');
  fileWrite('package/base/doc-package.yaml', packageYamlByName.base ?? 'name: base\ndescription: The base\npackageDependList: []\n');
  if (!isBaseReadmeMissing) fileWrite('package/base/doc/README.md', '# base\n');
  fileWrite('package/base/comp-mdx/comp.yaml', 'tagName: Card\nid: specific/Card\nentry: ./Card.jsx\n');
  fileWrite('package/base/comp-mdx/Card.jsx', 'export function Card() { return null; }\n');
  fileWrite('config.yaml', ['docEntry:', '  dir: ./page', ...configLines, ''].join('\n'));
  return dir;
}

function packageListLoad(dir) {
  return docPackageListLoad(docPackageSpecListRead([{ dir: './package/vis' }], dir, 'test'), 'test');
}

test('a package comes after the packages it needs, each once', () => {
  const dir = fixtureCreate();
  const packageList = docPackageListLoad(docPackageSpecListRead([{ dir: './package/vis' }, { dir: './package/base' }], dir, 'test'), 'test');
  assert.deepEqual(packageList.map((item) => [item.name, item.description, item.dir]), [
    ['base', 'The base', path.join(dir, 'package/base')],
    ['vis', 'Diagrams', path.join(dir, 'package/vis')],
  ]);
});

test('every key of doc-package.yaml and doc/README.md are required; a cycle and two packages of one name are errors', () => {
  assert.throws(() => packageListLoad(fixtureCreate({ packageYamlByName: { base: 'name: base\ndescription: x\n' } })), /"packageDependList" is required/);
  assert.throws(() => packageListLoad(fixtureCreate({ packageYamlByName: { base: 'name: base\ndescription: x\npackageDependList: []\ncomp: false\n' } })), /unknown key "comp"/);
  assert.throws(() => packageListLoad(fixtureCreate({ packageYamlByName: { base: 'name: Base\ndescription: x\npackageDependList: []\n' } })), /lower-case/);
  assert.throws(() => packageListLoad(fixtureCreate({ isBaseReadmeMissing: true })), /doc\/README\.md is required/);
  assert.throws(() => packageListLoad(fixtureCreate({ packageYamlByName: { base: 'name: base\ndescription: x\npackageDependList:\n  - dir: ../vis\n' } })), /cycle: vis -> base -> vis/);
  assert.throws(() => packageListLoad(fixtureCreate({ packageYamlByName: { base: 'name: vis\ndescription: x\npackageDependList: []\n' } })), /two packages are named "vis"/);
  assert.throws(() => docPackageSpecListRead([{ dir: './x', alias: 'y' }], '/', 'test'), /a package is \{ dir \}/);
});

test('the components of a package are mounted after those of the doc pages, under {packageName}/{tagName}', () => {
  const dir = fixtureCreate();
  const compConfig = compConfigOfDocPageListGet(
    [{ alias: 'page', entryFile: path.join(dir, 'page/.doc-page/entry.yaml'), dirPage: path.join(dir, 'page'), comp: undefined }],
    dir,
    packageListLoad(dir),
  );
  assert.deepEqual(compConfig.mountList.map((mount) => [mount.tagName, mount.id, mount.docPageAlias, mount.packageName]), [
    ['Chart', 'page/Chart', 'page', ''],
    ['Card', 'specific/Card', '', 'base'],
    ['Flow', 'vis/Flow', '', 'vis'],
  ]);
  // the doc page's own tag name wins, reported on the package
  const visPage = compConfig.docPageList.find((item) => item.alias === 'vis');
  assert.equal(visPage.kind, 'package');
  assert.match(visPage.problemList[0], /the tag name Chart is declared by doc page "page" already/);
  assert.deepEqual(compConfig.mountList[2].dependencyCollect, { entryFile: path.join(dir, 'package/vis/comp-mdx/flow/FlowSource.js'), export: 'flowCollect' });
});

test('the plugin mounts the components of the packages config names beside docEntry, and their config file is configuration', async () => {
  const dir = fixtureCreate();
  const plugin = docSourcePlugin({ configFile: path.join(dir, 'config.yaml') });
  plugin.configResolved({ command: 'serve', root: dir, base: '/' });
  await plugin.buildStart();
  const code = plugin.load('\0virtual:doc-source');
  assert.ok(code.includes(`import * as docCompModule1 from ${JSON.stringify(path.join(dir, 'package/base/comp-mdx/Card.jsx'))};`));
  const configDoc = JSON.parse(/^export let configDoc = (.*);$/m.exec(code)[1]);
  assert.deepEqual(configDoc.compRegistry, { Chart: 'page/Chart', Card: 'specific/Card', Flow: 'vis/Flow' });
  assert.deepEqual(configDoc.packageList, [
    { name: 'base', description: 'The base', dir: 'package/base', dependNameList: [], isWorkspaceNamed: false },
    { name: 'vis', description: 'Diagrams', dir: 'package/vis', dependNameList: ['base'], isWorkspaceNamed: true },
  ]);
  // the dependency extractor never reaches the page
  assert.ok(!code.includes('FlowSource.js'));
  assert.ok(!code.includes('README.md'));
});

test('a workspace names its packages itself: config packageList goes with docEntry only', () => {
  const dir = fixtureCreate({ configLines: [] });
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'workspace: { file: ./workspace.yaml }\npackageList: []\n');
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), 'docPageList:\n  - dir: ./page\npackageList:\n  - dir: ./package/vis\n');
  const plugin = docSourcePlugin({ configFile: path.join(dir, 'config.yaml') });
  assert.throws(() => plugin.configResolved({ command: 'serve', root: dir, base: '/' }), /"packageList" goes with "docEntry"/);
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'workspace: { file: ./workspace.yaml }\n');
  const pluginWorkspace = docSourcePlugin({ configFile: path.join(dir, 'config.yaml') });
  pluginWorkspace.configResolved({ command: 'serve', root: dir, base: '/' });
  const configDoc = JSON.parse(/^export let configDoc = (.*);$/m.exec(pluginWorkspace.load('\0virtual:doc-source'))[1]);
  assert.deepEqual(configDoc.packageList.map((item) => item.name), ['base', 'vis']);
});
