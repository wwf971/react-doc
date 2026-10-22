import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetConfigOfConfigDocGet, assetStoreCreate } from './doc-asset-store.ts';
import { docAssetMiddlewareCreate } from './doc-asset-server.ts';
import { docSourcePlugin } from './doc-source.ts';
import { DocAssetStore } from '../src/store/DocAssetStore.ts';

// how config.yaml names the local store of the asset service layer (doc_page_impl_asset.md#configuration):
// what each form of the asset section makes of the asset api the
// development server exports (docAssetEndpoint) and answers (/status).

function fixtureCreate(configAssetLines, assetYaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-asset-config-'));
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), '# A\n');
  fs.writeFileSync(path.join(dir, 'fixture-entry.yaml'), [
    'docEntry:',
    '  title: Fixture',
    'source:',
    '  - action: addFolder',
    '    rootId: docs',
    '    path: docs',
    '    collect: recursive',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), [
    'docEntry:',
    '  file: ./fixture-entry.yaml',
    ...configAssetLines,
    '',
  ].join('\n'));
  if (assetYaml !== undefined) fs.writeFileSync(path.join(dir, 'asset.yaml'), assetYaml);
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

test('no asset section: no store, no asset api', () => {
  const dir = fixtureCreate([]);
  assert.equal(assetConfigOfConfigDocGet({}, dir), undefined);
  assert.equal(exportGet(pluginCreate(dir), 'docAssetEndpoint'), '');
});

test('the former asset.folder stops the server with the migration', () => {
  const dir = fixtureCreate(['asset:', '  folder: ./asset']);
  assert.throws(() => pluginCreate(dir), (error) => {
    assert.match(error.message, /asset\.folder/);
    assert.match(error.message, /file: \.\/asset\.yaml/);
    assert.match(error.message, /- path: \.\/asset/);
    assert.match(error.message, /restart/);
    return true;
  });
});

test('an asset section without file is an error, not "no store"', () => {
  assert.throws(() => assetConfigOfConfigDocGet({ asset: {} }, os.tmpdir()), /needs "file"/);
  assert.throws(() => assetConfigOfConfigDocGet({ asset: './asset.yaml' }, os.tmpdir()), /must be a mapping/);
});

test('a store config file that cannot be read is an error', () => {
  const dirYaml = fixtureCreate(['asset:', '  file: ./asset.yaml'], 'folderList: [\n');
  assert.throws(() => pluginCreate(dirYaml), /not valid yaml/);
  const dirList = fixtureCreate(['asset:', '  file: ./asset.yaml'], 'folderList: ./asset\n');
  assert.throws(() => pluginCreate(dirList), /must be a list/);
});

test('asset.file with a default folder not created yet: the api answers writable', async () => {
  const dir = fixtureCreate(['asset:', '  file: ./asset.yaml'], 'folderList:\n  - path: ./asset\n    isDefault: true\n');
  const plugin = pluginCreate(dir);
  const endpoint = exportGet(plugin, 'docAssetEndpoint');
  assert.equal(endpoint, '/__doc-asset');

  const assetConfig = assetConfigOfConfigDocGet({ asset: { file: './asset.yaml' } }, dir);
  const middleware = docAssetMiddlewareCreate({ endpoint, storeGet: () => assetStoreCreate(assetConfig) });
  const result = await requestRun(middleware, `${endpoint}/status`);
  assert.equal(result.status, 200);
  assert.equal(result.body.code, 0);
  assert.equal(result.body.data.isWritable, true);
  assert.deepEqual(result.body.data.folderList.map((folder) => [folder.path, folder.isDefault, folder.isExists]), [['./asset', true, false]]);
  assert.equal(fs.existsSync(path.join(dir, 'asset')), false);
});

test('a build has no asset api: the store is bundled read-only', async () => {
  const dir = fixtureCreate(['asset:', '  file: ./asset.yaml'], 'folderList:\n  - path: ./asset\n    isDefault: true\n');
  const plugin = pluginCreate(dir, 'build');
  assert.equal(exportGet(plugin, 'docAssetEndpoint'), '');
  const snapshot = exportGet(plugin, 'assetSnapshot');
  assert.notEqual(snapshot, null);

  const assetStore = new DocAssetStore({ snapshot });
  await assetStore.statusLoad();
  assert.equal(assetStore.isAvailable, true);
  assert.equal(assetStore.unavailableReason, '');
  assert.match(assetStore.writeUnavailableReason, /read-only snapshot/);
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
