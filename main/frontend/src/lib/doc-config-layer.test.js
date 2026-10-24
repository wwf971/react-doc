import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAutoObservable } from 'mobx';
import { configLayerCreate } from '../store/doc-config-layer.ts';
import { DocEnvStore } from '../store/DocEnvStore.ts';
import { configDefineByKeyBuild, configLayerDefineList, configLevelListBuild } from './doc-config-define.js';
import { configDeclaredCheck, configModelBuild } from './doc-config-model.js';

// the config layers (doc_page_impl_config.md#config-layers): a layer is a
// stack of declarations, shown as what it declares; the doc page layer
// writes a value into the declaration that holds it.

function sourceStoreCreate(configDoc) {
  return makeAutoObservable({ configDoc });
}

// a static build: no api
const envStatic = new DocEnvStore({ env: { kind: 'staticBuild' } });

// a development server whose edit api answered that it writes
function envDevCreate() {
  const envStore = new DocEnvStore({ env: { kind: 'viteDevServer' }, endpointByApi: { edit: '/__doc-edit' } });
  envStore.editStatus = 'ok';
  return envStore;
}

const configDocExample = {
  configDefault: { TagsDisplayAtLinkIsOn: false, compConfig: { Image: { PasteReplaceConfirmIsOn: true } } },
  variable: { dirImage: '~guide/image' },
  compRegistry: { Image: 'common/Image' },
  docEntry: {
    file: 'guide/.doc-page/entry.yaml',
    configDeclarationList: [
      {
        id: 'guide/.doc-page/config.yaml#config',
        file: 'guide/.doc-page/config.yaml',
        path: ['config'],
        config: { TagsDisplayAtLinkPosition: 'before', compConfig: { Image: { FileStoreDir: '${dirImage}' } } },
      },
      {
        id: 'guide/.doc-page/entry.yaml#config.1',
        file: 'guide/.doc-page/entry.yaml',
        path: ['config', 1],
        config: { TagsDisplayAtLinkPosition: 'after' },
      },
    ],
  },
};

test('the layer stack: default, doc page, the document levels, client', () => {
  assert.deepEqual(configLayerDefineList.map((define) => define.id), ['default', 'docPage', 'client']);
  assert.deepEqual(configLevelListBuild(), ['default', 'docPage', 'source', 'sidePanel', 'doc', 'client']);
  // another layer is one more definition, at its place in the stack
  const layerDefineList = [...configLayerDefineList];
  layerDefineList.splice(2, 0, { id: 'team', storage: 'browser', isAboveDocLevels: false });
  assert.deepEqual(configLevelListBuild(layerDefineList), ['default', 'docPage', 'team', 'source', 'sidePanel', 'doc', 'client']);
});

test('the default layer is read only; the doc page layer merges its declarations, later wins', () => {
  const sourceStore = sourceStoreCreate(configDocExample);
  const [layerDefault, layerDocPage] = configLayerDefineList.map((define) => configLayerCreate(define, { sourceStore, envStore: envStatic }));
  assert.equal(layerDefault.isWritable, false);
  assert.deepEqual(layerDefault.config, { TagsDisplayAtLinkIsOn: false });
  assert.deepEqual(layerDefault.compConfig, { Image: { PasteReplaceConfirmIsOn: true } });
  assert.equal(layerDocPage.declarationList.length, 2);
  assert.deepEqual(layerDocPage.config, { TagsDisplayAtLinkPosition: 'after' });
  assert.deepEqual(layerDocPage.compConfig, { Image: { FileStoreDir: '${dirImage}' } });
  // a built page has no edit api: the doc page layer is shown, not written
  assert.equal(layerDocPage.isWritable, false);
  assert.match(layerDocPage.disabledReason, /static build/);

  const configDefineByKey = configDefineByKeyBuild();
  const model = configModelBuild({
    configDefineByKey,
    configDoc: configDocExample,
    layerList: [layerDefault, layerDocPage].map((layer) => ({
      id: layer.id, config: layer.config, compConfig: layer.compConfig, isCompKeyedById: false, isAboveDocLevels: false,
    })),
  });
  assert.equal(model.configGlobal.TagsDisplayAtLinkPosition, 'after');
  assert.equal(model.levelGlobalByKey.TagsDisplayAtLinkPosition, 'docPage');
  assert.equal(model.levelGlobalByKey.TagsDisplayAtLinkIsOn, 'default');
});

test('configDeclaredCheck lists what a declaration declares, each key checked', () => {
  const configDefineByKey = configDefineByKeyBuild();
  const itemList = configDeclaredCheck(
    { TagsDisplayAtLinkPosition: 'middle', TagsDisplayAtLinkIsOn: true, KeyUnknown: 1, compConfig: {} },
    { defineByKey: configDefineByKey },
  );
  assert.deepEqual(itemList.map((item) => [item.key, item.isValid, item.message]), [
    ['TagsDisplayAtLinkPosition', false, 'invalid value'],
    ['TagsDisplayAtLinkIsOn', true, ''],
    ['KeyUnknown', false, 'unknown key'],
  ]);
});

test('the doc page layer writes into the declaration chosen, and shows it until the configuration comes back', async () => {
  const sourceStore = sourceStoreCreate(configDocExample);
  const define = configLayerDefineList.find((one) => one.id === 'docPage');
  const requestList = [];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requestList.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ code: 0, data: {}, message: '' }) };
  };
  try {
    const layer = configLayerCreate(define, { sourceStore, envStore: envDevCreate() });
    assert.equal(layer.isWritable, true);
    // the merged layer does not guess which declaration to write
    assert.equal((await layer.valueSet('TagsDisplayAtLinkPosition', 'before')).code, -1);
    assert.equal(requestList.length, 0);
    assert.equal((await layer.declarationValueSet('guide/.doc-page/entry.yaml#config.1', 'TagsDisplayAtLinkPosition', 'before')).code, 0);
    assert.deepEqual(requestList[0].body, {
      file: 'guide/.doc-page/entry.yaml',
      keyPath: ['config', 1, 'TagsDisplayAtLinkPosition'],
      value: 'before',
      valueBase: 'after',
    });
    assert.equal(layer.config.TagsDisplayAtLinkPosition, 'before');

    const result = await layer.declarationCompValueSet('guide/.doc-page/config.yaml#config', 'Image', 'FileStoreDir', '~guide/png');
    assert.equal(result.code, 0);
    assert.deepEqual(requestList[1].body.keyPath, ['config', 'compConfig', 'Image', 'FileStoreDir']);
    assert.equal(requestList[1].body.valueBase, '${dirImage}');

    // the earlier declaration of the same key is written as well; the later one still wins
    assert.equal((await layer.declarationValueSet('guide/.doc-page/config.yaml#config', 'TagsDisplayAtLinkPosition', 'after')).code, 0);
    assert.deepEqual(requestList[2].body.keyPath, ['config', 'TagsDisplayAtLinkPosition']);
    assert.equal(layer.config.TagsDisplayAtLinkPosition, 'before');
    // a key the declaration does not hold is not added from the page
    assert.equal((await layer.declarationValueSet('guide/.doc-page/config.yaml#config', 'TagsDisplayAtLinkIsOn', true)).code, -1);
    assert.equal(requestList.length, 3);
  } finally {
    globalThis.fetch = fetchBefore;
  }
});

test('the client layer takes keys, removes them, and clears its storage', async () => {
  const storageByKey = new Map();
  const windowBefore = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => storageByKey.get(key) ?? null,
      setItem: (key, value) => storageByKey.set(key, value),
      removeItem: (key) => storageByKey.delete(key),
    },
  };
  try {
    const sourceStore = sourceStoreCreate(configDocExample);
    const define = configLayerDefineList.find((one) => one.id === 'client');
    const layer = configLayerCreate(define, { sourceStore, envStore: envStatic });
    await layer.valueSet('TagsDisplayAtLinkIsOn', true);
    await layer.compValueSet('common/Image', 'PasteReplaceConfirmIsOn', false);
    assert.deepEqual([...storageByKey.keys()], ['doc-config:client:guide/.doc-page/entry.yaml']);
    await layer.valueRemove('TagsDisplayAtLinkIsOn');
    assert.deepEqual(layer.config, {});
    await layer.compValueRemove('common/Image', 'PasteReplaceConfirmIsOn');
    assert.deepEqual(layer.compConfig, {});
    assert.equal(storageByKey.size, 0);
    await layer.valueSet('TagsDisplayAtLinkIsOn', true);
    await layer.clear();
    assert.equal(storageByKey.size, 0);
  } finally {
    globalThis.window = windowBefore;
  }
});

test('the environment: one answer for what the page may do, whatever asks', () => {
  const envStatic2 = new DocEnvStore({ env: { kind: 'staticBuild' }, endpointByApi: { edit: '/__doc-edit' } });
  // a static build offers no api, even one handed to it
  assert.equal(envStatic2.endpointGet('edit'), '');
  assert.equal(envStatic2.isCapable('edit'), false);
  assert.match(envStatic2.reasonGet('sourceWrite'), /static build/);

  const envDev = new DocEnvStore({ env: { kind: 'viteDevServer' }, endpointByApi: { source: '/__doc-source', edit: '/__doc-edit' } });
  assert.equal(envDev.isCapable('sourceWrite'), true);
  assert.equal(envDev.isCapable('devWarning'), true);
  // editing waits for the edit api to answer
  assert.equal(envDev.isCapable('edit'), false);
  envDev.editStatus = 'ok';
  assert.equal(envDev.isCapable('edit'), true);
  assert.equal(envDev.isCapable('asset'), false);
  assert.match(envDev.reasonGet('asset'), /asset api/);
  assert.equal(envDev.envService.kindGet(), 'viteDevServer');

  // without a kind, it is inferred from the endpoints
  assert.equal(new DocEnvStore({ endpointByApi: { source: '/x' } }).kind, 'viteDevServer');
  assert.equal(new DocEnvStore({}).kind, 'staticBuild');
});

test('the edit mode grid: one column per declaration, one row per key, the last valid value decides', async () => {
  const { DocConfigStore } = await import('../store/DocConfigStore.ts');
  const configDoc = {
    ...configDocExample,
    docEntry: {
      ...configDocExample.docEntry,
      configDeclarationList: [
        ...configDocExample.docEntry.configDeclarationList,
        { id: 'c', file: 'guide/.doc-page/c.yaml', path: ['config'], config: { TagsDisplayAtLinkPosition: 'middle', TagsDisplayAtLinkIsOn: true } },
      ],
    },
  };
  const sourceStore = makeAutoObservable({ configDoc, fileManifest: [], envStore: envStatic });
  const docStore = { compById: {}, compByIdVersion: 0, treeModel: { configDeclarationList: [], partById: new Map() } };
  const configStore = new DocConfigStore(sourceStore, docStore, { envStore: envStatic });
  assert.deepEqual(configStore.layerGridColumnListGet('docPage').map((column) => column.label), [
    '.doc-page/config.yaml › config', '.doc-page/entry.yaml › config.1', '.doc-page/c.yaml › config',
  ]);
  const rowList = configStore.layerGridRowListGet('docPage');
  assert.deepEqual(rowList.map((row) => row.key), ['TagsDisplayAtLinkPosition', 'TagsDisplayAtLinkIsOn']);
  // "middle" is not a valid value: entry.yaml's "after" is the one the layer takes
  assert.deepEqual(rowList[0].cellList.map((cell) => cell.item?.valueDeclared), ['before', 'after', 'middle']);
  assert.equal(rowList[0].declarationIdDeciding, 'guide/.doc-page/entry.yaml#config.1');
  assert.deepEqual(rowList[1].cellList.map((cell) => cell.item === undefined), [true, true, false]);
  assert.equal(rowList[1].declarationIdDeciding, 'c');
});
