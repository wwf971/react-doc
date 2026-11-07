import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autorun } from 'mobx';
import { DocAssetStore } from '../store/DocAssetStore.ts';
import { DocObjectFrontendStore } from '../store/DocObjectFrontendStore.ts';

// the frontend object layer of the page reading its assets (doc_page_impl_obj_frontend.md#reading-many-assets):
// what a render asks for together is read together, in steps, and the object and the data of an
// asset are worked out once, however many times a mode reads them

const OBJECT_ID = 'w5k6testobj';
const ENTRY_ID = 'entry-1';
const ASSET_COUNT = 40;

function assetEntryBuild(itemId, text, role) {
  const versionId = `${itemId}-v1`;
  return {
    itemId, name: '', lang: 'yaml', contentType: 'text/yaml', fileExt: 'yaml', versionIdHead: versionId,
    isDeleted: false, isLocked: false, timeCreated: '20261106_00000000+09',
    owner: { ref: `frontend:${OBJECT_ID}`, ...(role ? { role } : {}) },
    versionList: [{ versionId, versionIdPrevList: [], time: '', note: '', size: text.length, hash: 'h', isLocked: false, dependencyList: [] }],
    eventList: [],
    versionDataById: { [versionId]: { size: text.length, hash: 'h', isText: true, text, metadata: {} } },
  };
}

function entryTextBuild(count) {
  const lineList = Array.from({ length: count }, (_, index) => `  - { key: item-${index}, kind: item, itemId: asset-${index} }`);
  return `name: Sample\ntype: frontend.object\nassetList:\n${lineList.join('\n')}\n`;
}

async function fixtureCreate() {
  const itemById = { [ENTRY_ID]: assetEntryBuild(ENTRY_ID, entryTextBuild(ASSET_COUNT), 'entry') };
  for (let index = 0; index < ASSET_COUNT; index += 1) itemById[`asset-${index}`] = assetEntryBuild(`asset-${index}`, `value: ${index}\n`);
  const assetStore = new DocAssetStore({
    snapshot: {
      itemById,
      objectFrontend: { docPageList: [{ alias: 'page', typeList: [], objectList: [{ id: OBJECT_ID, entry: ENTRY_ID, docPageAlias: 'page' }] }] },
    },
  });
  const count = { list: 0, single: 0 };
  const { itemGetList, itemGet } = assetStore.backend;
  assetStore.backend.itemGetList = (...args) => { count.list += 1; return itemGetList(...args); };
  assetStore.backend.itemGet = (...args) => { count.single += 1; return itemGet(...args); };
  assetStore.init();
  await assetStore.startPromise;
  const store = new DocObjectFrontendStore({ assetStore });
  await store.configLoad();
  return { assetStore, store, count };
}

const tickWait = async () => { for (let index = 0; index < 40; index += 1) await new Promise((resolve) => setTimeout(resolve, 1)); };

// what a mode does in a render: every asset, through the object
function readAll(store) {
  return store.objectGet(OBJECT_ID).assetList.map((asset) => store.assetDataGet(OBJECT_ID, asset.key));
}

test('the assets a render asks for are read a few at a time, and what is read so far can be counted', async () => {
  const { store, count } = await fixtureCreate();
  let drawCount = 0;
  let resultList = [];
  const countDoneList = [];
  const dispose = autorun(() => {
    drawCount += 1;
    resultList = readAll(store);
    countDoneList.push(resultList.filter((result) => result.status === 'done').length);
  });
  await tickWait();
  dispose();
  // the count moves in steps up to all of them
  assert.ok(new Set(countDoneList).size >= 4, `counts ${countDoneList}`);
  assert.equal(countDoneList.at(-1), ASSET_COUNT);
  const assetRequestCount = count.list;
  assert.equal(resultList.length, ASSET_COUNT);
  assert.ok(resultList.every((result) => result.status === 'done'));
  assert.equal(resultList[7].data.value, 7);
  // one read for the entry, then the assets a few at a time
  assert.equal(assetRequestCount, 1 + Math.ceil(ASSET_COUNT / 8));
  assert.equal(count.single, 0);
  // a few times per step, not once per asset
  assert.ok(drawCount < ASSET_COUNT / 2, `drawn ${drawCount} times`);
});

test('the object is worked out once: the data of an asset arriving does not change it', async () => {
  const { store } = await fixtureCreate();
  const dispose = autorun(() => { readAll(store); });
  await tickWait();
  const stateBefore = store.objectGet(OBJECT_ID);
  assert.equal(stateBefore.status, 'found');
  assert.equal(store.objectGet(`frontend:${OBJECT_ID}`), stateBefore);
  const dataBefore = store.assetDataGet(OBJECT_ID, 'item-3').data;
  assert.equal(store.assetDataGet(OBJECT_ID, 'item-3').data, dataBefore);
  assert.equal(store.objectGet(OBJECT_ID), stateBefore);
  dispose();
});

test('a change of the entry or of an asset is seen at the next read', async () => {
  const { assetStore, store } = await fixtureCreate();
  const dispose = autorun(() => { readAll(store); });
  await tickWait();
  const stateBefore = store.objectGet(OBJECT_ID);
  const dataBefore = store.assetDataGet(OBJECT_ID, 'item-3').data;
  const { itemGet } = assetStore.backend;
  const answerWithText = async (itemId, text) => {
    const answer = await itemGet('local', itemId, 'head');
    return { ...answer, data: { ...answer.data, version: { ...answer.data.version, text } } };
  };
  assetStore.backend.itemGet = () => answerWithText('asset-3', 'value: changed\n');
  await assetStore.itemReload('local', 'asset-3');
  assert.equal(store.assetDataGet(OBJECT_ID, 'item-3').data.value, 'changed');
  assert.notEqual(store.assetDataGet(OBJECT_ID, 'item-3').data, dataBefore);
  assert.equal(store.objectGet(OBJECT_ID), stateBefore);

  assetStore.backend.itemGet = () => answerWithText(ENTRY_ID, entryTextBuild(ASSET_COUNT - 1));
  await assetStore.itemReload('local', ENTRY_ID);
  assert.notEqual(store.objectGet(OBJECT_ID), stateBefore);
  assert.equal(store.objectGet(OBJECT_ID).assetList.length, ASSET_COUNT - 1);
  dispose();
});

test('an asset that cannot be read or parsed fails alone', async () => {
  const { assetStore, store } = await fixtureCreate();
  const { itemGetList } = assetStore.backend;
  assetStore.backend.itemGetList = async (storeId, requestList) => {
    const result = await itemGetList(storeId, requestList);
    return {
      ...result,
      data: {
        answerList: result.data.answerList.map((answer, index) => {
          if (requestList[index].itemId === 'asset-1') return { code: -3, data: null, message: 'gone' };
          if (requestList[index].itemId !== 'asset-2') return answer;
          return { ...answer, data: { ...answer.data, version: { ...answer.data.version, text: 'a: [' } } };
        }),
      },
    };
  };
  const dispose = autorun(() => { readAll(store); });
  await tickWait();
  assert.equal(store.assetDataGet(OBJECT_ID, 'item-0').status, 'done');
  const resultGone = store.assetDataGet(OBJECT_ID, 'item-1');
  assert.equal(resultGone.status, 'error');
  assert.equal(resultGone.message, 'gone');
  const resultBroken = store.assetDataGet(OBJECT_ID, 'item-2');
  assert.equal(resultBroken.status, 'error');
  assert.match(resultBroken.message, /not yaml/);
  dispose();
});

test('what disagrees: an item of unknown source in the folder, an asset lying outside, a stray', async () => {
  const ref = `frontend:${OBJECT_ID}`;
  const entryText = `name: Sample\ntype: frontend.object\nassetList:\n  - { key: in, kind: k, itemId: asset-in }\n  - { key: out, kind: k, itemId: asset-out }\n`;
  const entry = { ...assetEntryBuild(ENTRY_ID, entryText, 'entry'), folderOwner: { ref } };
  const itemById = {
    [ENTRY_ID]: entry,
    'asset-in': { ...assetEntryBuild('asset-in', 'a: 1\n'), folderOwner: { ref }, groupPath: 'deep/er' },
    'asset-out': assetEntryBuild('asset-out', 'a: 1\n'),
    'asset-stray': { ...assetEntryBuild('asset-stray', 'a: 1\n'), folderOwner: { ref } },
    'asset-dropped': { ...assetEntryBuild('asset-dropped', 'a: 1\n'), owner: undefined, folderOwner: { ref } },
    'asset-other': { ...assetEntryBuild('asset-other', 'a: 1\n'), owner: { ref: 'frontend:elsewhere' }, folderOwner: { ref } },
  };
  const assetStore = new DocAssetStore({
    snapshot: { itemById, objectFrontend: { docPageList: [{ alias: 'page', typeList: [], objectList: [{ id: OBJECT_ID, entry: ENTRY_ID, docPageAlias: 'page', dir: 'page/x' }] }] } },
  });
  assetStore.init();
  await assetStore.startPromise;
  const store = new DocObjectFrontendStore({ assetStore });
  await store.configLoad();
  await assetStore.refLoad({ store: 'local', itemId: ENTRY_ID, versionId: 'head' });
  const state = store.objectGet(OBJECT_ID);
  assert.deepEqual(state.assetList.map((asset) => [asset.key, asset.isInFolder]), [['in', true], ['out', false]]);
  assert.deepEqual(state.outsideList.map((asset) => asset.key), ['out']);
  assert.deepEqual(state.strayList.map((item) => item.itemId), ['asset-stray']);
  assert.deepEqual(state.unknownList.map((item) => item.itemId).sort(), ['asset-dropped', 'asset-other']);
  assert.deepEqual(state.groupList.find((group) => group.groupPath === 'deep/er'), { groupPath: 'deep/er', count: 1 });
  // what lies in the folder and is not listed is no asset of the object: its modes do not see it
  assert.equal(store.assetResolve(OBJECT_ID, 'id:asset-dropped').status, 'unknown');
});

