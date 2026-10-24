import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetStoreCreate } from './doc-asset-store.ts';
import { yamlStringListSetBuild } from './doc-yaml-edit.ts';
import { lineOperationListApply } from './doc-edit-lines.ts';
import { docAssetMiddlewareCreate } from './doc-asset-server.ts';
import { docAssetConfigLoad, docSourcePlugin } from './doc-source.ts';
import { DocAssetStore } from '../src/store/DocAssetStore.ts';

// where the folders of the asset service layer come from
// (doc_page_impl_asset.md#the-local-store-folders-fully-reflected): every
// doc page the page loads, by its asset store config (.doc-page/asset.yaml),
// or its default folder; included doc pages bring theirs.

// a doc page folder "page" (root "docs") including the doc page folder
// "page/sub" (root "sub") by its folder. assetYamlByPage: the text of
// .doc-page/asset.yaml of "page" / "sub", absent for none
function fixtureCreate({ assetYamlByPage = {}, configLineList = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-asset-config-'));
  const pageDir = path.join(dir, 'page');
  const subDir = path.join(pageDir, 'sub');
  fs.mkdirSync(path.join(pageDir, '.doc-page'), { recursive: true });
  fs.mkdirSync(path.join(subDir, '.doc-page'), { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'a.md'), '# A\n');
  fs.writeFileSync(path.join(subDir, 'b.md'), '# B\n');
  fs.writeFileSync(path.join(pageDir, '.doc-page', 'entry.yaml'), [
    'docEntry:',
    '  title: Fixture',
    'source:',
    '  - action: addFolder',
    '    rootId: docs',
    '    path: ..',
    '    collect: recursive',
    '  - action: removeByPath',
    '    pattern: "~docs/sub/**"',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~docs/a.md',
    '      - id: sub',
    '        include: ../sub',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(subDir, '.doc-page', 'entry.yaml'), [
    'docEntry: true',
    'source:',
    '  - action: addFolder',
    '    rootId: sub',
    '    path: ..',
    '    collect: recursive',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~sub/b.md',
    '',
  ].join('\n'));
  if (assetYamlByPage.page !== undefined) fs.writeFileSync(path.join(pageDir, '.doc-page', 'asset.yaml'), assetYamlByPage.page);
  if (assetYamlByPage.sub !== undefined) fs.writeFileSync(path.join(subDir, '.doc-page', 'asset.yaml'), assetYamlByPage.sub);
  fs.writeFileSync(path.join(dir, 'config.yaml'), ['docEntry:', '  dir: ./page', ...configLineList, ''].join('\n'));
  return dir;
}

function pluginCreate(dir, command = 'serve') {
  const plugin = docSourcePlugin({ configFile: path.join(dir, 'config.yaml') });
  plugin.configResolved({ command, root: dir, base: '/' });
  return plugin;
}

function exportGet(plugin, name) {
  const code = plugin.load('\0virtual:doc-source');
  const match = new RegExp(`export const ${name} = (.*);\\n`).exec(code);
  return match ? JSON.parse(match[1]) : undefined;
}

function requestRun(middleware, url) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = 'GET';
    req.url = url;
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (text) => resolve({ status: res.statusCode, body: JSON.parse(String(text)) }),
    };
    middleware(req, res, () => resolve({ status: -1, body: undefined }));
  });
}

// the asset api middleware as the plugin mounts it, against the files now
function middlewareCreate(plugin, dir) {
  const endpoint = exportGet(plugin, 'docAssetEndpoint');
  return docAssetMiddlewareCreate({
    endpoint,
    storeGet: () => assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml'))),
    rootAbsPathByIdGet: () => new Map([['docs', path.join(dir, 'page')], ['sub', path.join(dir, 'page', 'sub')]]),
    usageScan: () => [],
  });
}

function requestPost(middleware, url, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = url;
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (text) => resolve({ status: res.statusCode, body: JSON.parse(String(text)) }),
    };
    middleware(req, res, () => resolve({ status: -1, body: undefined }));
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  });
}

test('without asset.yaml every doc page has its default folder, the included one too', async () => {
  const dir = fixtureCreate();
  const plugin = pluginCreate(dir);
  assert.equal(exportGet(plugin, 'docAssetEndpoint'), '/__doc-asset');
  const result = await requestRun(middlewareCreate(plugin, dir), '/__doc-asset/status');
  assert.equal(result.body.code, 0);
  assert.deepEqual(
    result.body.data.folderList.map((folder) => [folder.path, folder.isDefault, folder.isExists, folder.docEntryFile]),
    [['~docs/asset', true, false, 'page/.doc-page/entry.yaml'], ['~sub/asset', false, false, 'page/sub/.doc-page/entry.yaml']],
  );
  assert.deepEqual(result.body.data.docPageList.map((docPage) => [docPage.configFileRelative, docPage.isConfigFileExists]), [
    ['page/.doc-page/asset.yaml', false], ['page/sub/.doc-page/asset.yaml', false],
  ]);
  // nothing is created by reading
  assert.equal(fs.existsSync(path.join(dir, 'page', 'asset')), false);
});

test('asset.yaml names folders by source path; a folder not named so is left out and reported', async () => {
  const dir = fixtureCreate({
    assetYamlByPage: {
      page: 'folderList:\n  - ~docs/store/a\n  - ../relative\n  - ~nope/x\n  - ~docs/store/b\nfolderDefault: ~docs/store/b\n',
    },
  });
  const plugin = pluginCreate(dir);
  const result = await requestRun(middlewareCreate(plugin, dir), '/__doc-asset/status');
  assert.deepEqual(result.body.data.folderList.map((folder) => [folder.path, folder.isDefault]), [
    ['~docs/store/a', false], ['~docs/store/b', true], ['~sub/asset', false],
  ]);
  const problemList = result.body.data.docPageList[0].problemList;
  assert.equal(problemList.length, 2);
  assert.match(problemList[0], /not a source path/);
  assert.match(problemList[1], /no source rule declares the root "nope"/);
  // the folders of the store are never documents
  fs.mkdirSync(path.join(dir, 'page', 'store', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page', 'store', 'a', 'x.md'), '# X\n');
  assert.ok(!plugin.load('\0virtual:doc-source').includes('~docs/store/a/x.md'));
});

test('config.yaml "asset" is refused with the doc page form', () => {
  const dir = fixtureCreate({ configLineList: ['asset:', '  file: ./asset.yaml'] });
  assert.throws(() => pluginCreate(dir), (error) => {
    assert.match(error.message, /config\.yaml "asset" is no longer read/);
    assert.match(error.message, /~rootId\/asset/);
    return true;
  });
});

test('folder/set writes one doc page\'s file in place, or creates it', async () => {
  const pageYaml = '# my folders\nfolderList:\n  - ~docs/asset   # main\n  - ~docs/old\nfolderDefault: ~docs/asset\n';
  const dir = fixtureCreate({ assetYamlByPage: { page: pageYaml } });
  const plugin = pluginCreate(dir);
  const middleware = middlewareCreate(plugin, dir);
  const written = await requestPost(middleware, '/__doc-asset/folder/set', {
    configFile: 'page/.doc-page/asset.yaml', folderList: ['~docs/asset', '~docs/new'], folderDefault: '~docs/new',
  });
  assert.equal(written.body.code, 0);
  assert.equal(
    fs.readFileSync(path.join(dir, 'page', '.doc-page', 'asset.yaml'), 'utf-8'),
    '# my folders\nfolderList:\n  - ~docs/asset   # main\n  - ~docs/new\nfolderDefault: ~docs/new\n',
  );
  assert.equal(fs.existsSync(path.join(dir, 'page', 'new')), true);
  assert.equal(fs.readFileSync(path.join(dir, 'page', '.doc-page', 'asset.yaml.bak'), 'utf-8'), pageYaml);

  // the included doc page has no file yet: it is created
  const created = await requestPost(middleware, '/__doc-asset/folder/set', {
    configFile: 'page/sub/.doc-page/asset.yaml', folderList: ['~sub/asset', '~sub/more'],
  });
  assert.equal(created.body.code, 0);
  const textCreated = fs.readFileSync(path.join(dir, 'page', 'sub', '.doc-page', 'asset.yaml'), 'utf-8');
  assert.match(textCreated, /folderList:\n {2}- ~sub\/asset\n {2}- ~sub\/more\nfolderDefault: ~sub\/asset\n/);

  // refused: an unknown root, a file that is no doc page's
  const refused = await requestPost(middleware, '/__doc-asset/folder/set', { configFile: 'page/.doc-page/asset.yaml', folderList: ['~nope/a'] });
  assert.equal(refused.body.code, -1);
  const unknown = await requestPost(middleware, '/__doc-asset/folder/set', { configFile: 'other.yaml', folderList: ['~docs/a'] });
  assert.equal(unknown.body.code, -3);
});

test('a new object goes to the default folder of the doc page of its document', async () => {
  const dir = fixtureCreate();
  const plugin = pluginCreate(dir);
  const middleware = middlewareCreate(plugin, dir);
  const inSub = await requestPost(middleware, '/__doc-asset/object/create', { store: 'local', text: 'x', lang: 'json', docPath: '~sub/b.md' });
  assert.equal(inSub.body.code, 0);
  assert.equal(inSub.body.data.object.folder, '~sub/asset');
  const inPage = await requestPost(middleware, '/__doc-asset/object/create', { store: 'local', text: 'y', lang: 'json' });
  assert.equal(inPage.body.data.object.folder, '~docs/asset');
});

test('a build has no asset api: the store is bundled read-only', async () => {
  const plugin = pluginCreate(fixtureCreate(), 'build');
  assert.equal(exportGet(plugin, 'docAssetEndpoint'), '');
  const snapshot = exportGet(plugin, 'assetSnapshot');
  assert.notEqual(snapshot, null);

  const assetStore = new DocAssetStore({ snapshot });
  await assetStore.statusLoad();
  assert.equal(assetStore.isAvailable, true);
  assert.match(assetStore.writeUnavailableReason, /read-only snapshot/);
});

test('yamlStringListSetBuild keeps the comments of the entries it keeps', () => {
  const source = 'a:\n  # first\n  - x   # x\n  - y\n  # about z\n  - z\nb: 1\n';
  const apply = (list) => {
    const result = yamlStringListSetBuild(source, ['a'], list);
    assert.equal(result.code, 0, result.message);
    return lineOperationListApply(source, result.data.operationList);
  };
  assert.equal(apply(['x', 'Y', 'z']), 'a:\n  # first\n  - x   # x\n  - Y\n  # about z\n  - z\nb: 1\n');
  assert.equal(apply(['x', 'y']), 'a:\n  # first\n  - x   # x\n  - y\nb: 1\n');
  assert.equal(apply(['x', 'y', 'z', 'w']), 'a:\n  # first\n  - x   # x\n  - y\n  # about z\n  - z\n  - w\nb: 1\n');
  assert.equal(yamlStringListSetBuild(source, ['a'], []).code, -1);
  // a flow list stays one value
  const flow = yamlStringListSetBuild('a: [x, y]\n', ['a'], ['x']);
  assert.equal(lineOperationListApply('a: [x, y]\n', flow.data.operationList), 'a: [x]\n');
});

test('the page tells no store from a failed status request', async () => {
  const assetStoreNone = new DocAssetStore({});
  assert.match(assetStoreNone.writeUnavailableReason, /no asset service layer/);
  assert.match(assetStoreNone.writeUnavailableReason, /restart/);

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('connection refused'));
  try {
    const assetStore = new DocAssetStore({ endpoint: '/__doc-asset' });
    await assetStore.statusLoad();
    assert.equal(assetStore.isAvailable, false);
    assert.match(assetStore.writeUnavailableReason, /did not answer: .*connection refused/);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
