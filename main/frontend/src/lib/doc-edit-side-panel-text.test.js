import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAutoObservable, runInAction } from 'mobx';
import { DocEditStore } from '../store/DocEditStore.ts';

// the label edit of a side-panel item (doc_page_impl_side_panel.md) when
// the item is rendered in several places at once: the edit belongs to the
// rendering it was started from (its instance id), and only that one shows
// the editor and finishes the edit.

const ITEM_ID = 'item-report-3';
const OWNER_SIDEBAR = 'side-panel-display:item-report-3:r1';
const OWNER_FOOTER = 'side-panel-display:item-report-3:r2';
const OWNER_MOBILE = 'side-panel-display:item-report-3:r3';

function deferredCreate() {
  let resolve;
  const promise = new Promise((resolveOne) => {
    resolve = resolveOne;
  });
  return { promise, resolve };
}

function storeCreate({ applyResult = { code: 0, message: '' } } = {}) {
  const outline = {
    textLocalized: 'Report 3',
    isTextAuthored: true,
    textSource: { file: 'side-panel.yaml', path: ['tree', 2] },
  };
  const sourceStore = makeAutoObservable({ configDoc: {} });
  const docStore = {
    treeModel: { itemOutlineById: new Map([[ITEM_ID, outline]]) },
    textDisplayGet: (textLocalized) => ({ text: textLocalized, language: '' }),
  };
  const store = new DocEditStore(sourceStore, docStore, {});
  const applyList = [];
  store.api = {
    async sidePanelTextApply(request) {
      applyList.push(request);
      return applyResult;
    },
  };
  runInAction(() => {
    store.isAvailable = true;
    store.isEditMode = true;
  });
  return { applyList, store };
}

function eventBuild(type, ownerId, data = {}) {
  return { type, data, source: { itemId: ITEM_ID, instanceId: ownerId } };
}

test('only the rendering an edit was started from shows the editor', async () => {
  const { store } = storeCreate();
  const result = await store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  assert.equal(result.code, 0);
  assert.deepEqual(store.sidePanelTextStateGet(ITEM_ID, OWNER_SIDEBAR, true), { status: 'editing', message: '' });
  assert.equal(store.sidePanelTextStateGet(ITEM_ID, OWNER_MOBILE, true).status, '');
  assert.equal(store.sidePanelTextStateGet(ITEM_ID, OWNER_FOOTER, false).status, '');
});

test('the blur of another rendering does not finish the edit', async () => {
  const { applyList, store } = storeCreate();
  await store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  const resultSubmit = await store.eventHandle(eventBuild('sidePanelTextSubmitRequest', OWNER_FOOTER, { text: 'Report 3' }));
  assert.equal(resultSubmit.code, -1);
  const resultCancel = await store.eventHandle(eventBuild('sidePanelTextCancelRequest', OWNER_FOOTER));
  assert.equal(resultCancel.code, -1);
  assert.equal(store.sidePanelText?.ownerId, OWNER_SIDEBAR);
  assert.equal(store.sidePanelText?.status, 'editing');
  assert.equal(applyList.length, 0);
});

test('entering and canceling an edit writes nothing', async () => {
  const { applyList, store } = storeCreate();
  await store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  const result = await store.eventHandle(eventBuild('sidePanelTextCancelRequest', OWNER_SIDEBAR));
  assert.equal(result.code, 0);
  assert.equal(store.sidePanelText, undefined);
  await store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  await store.eventHandle(eventBuild('sidePanelTextSubmitRequest', OWNER_SIDEBAR, { text: 'Report 3' }));
  assert.equal(store.sidePanelText, undefined);
  assert.equal(applyList.length, 0);
});

test('the owner submits the plain label', async () => {
  const { applyList, store } = storeCreate();
  await store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  const result = await store.eventHandle(eventBuild('sidePanelTextSubmitRequest', OWNER_SIDEBAR, { text: '  Report  three ' }));
  assert.equal(result.code, 0);
  assert.equal(applyList.length, 1);
  assert.equal(applyList[0].text, 'Report three');
  assert.equal(applyList[0].textBase, 'Report 3');
  assert.equal(store.sidePanelText, undefined);
  assert.equal(store.sidePanelTextPendingGet(ITEM_ID), 'Report three');
});

test('a failed save is shown on the editable renderings and can be retried from any', async () => {
  const { applyList, store } = storeCreate({ applyResult: { code: -1, message: 'conflict' } });
  await store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  await store.eventHandle(eventBuild('sidePanelTextSubmitRequest', OWNER_SIDEBAR, { text: 'Report three' }));
  assert.deepEqual(store.sidePanelTextStateGet(ITEM_ID, OWNER_SIDEBAR, true), { status: 'error', message: 'conflict' });
  assert.deepEqual(store.sidePanelTextStateGet(ITEM_ID, OWNER_MOBILE, true), { status: 'error', message: 'conflict' });
  assert.equal(store.sidePanelTextStateGet(ITEM_ID, OWNER_FOOTER, false).status, '');
  const result = await store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_MOBILE));
  assert.equal(result.code, 0);
  assert.equal(store.sidePanelTextStateGet(ITEM_ID, OWNER_MOBILE, true).status, 'editing');
  assert.equal(store.sidePanelTextStateGet(ITEM_ID, OWNER_SIDEBAR, true).status, '');
  assert.equal(applyList.length, 1);
});

test('a rendering that unmounts drops the edit it was showing', async () => {
  const { store } = storeCreate();
  await store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  store.sidePanelTextOwnerRelease(OWNER_MOBILE);
  assert.equal(store.sidePanelText?.ownerId, OWNER_SIDEBAR);
  store.sidePanelTextOwnerRelease(OWNER_SIDEBAR);
  assert.equal(store.sidePanelText, undefined);
});

test('of two edit requests waiting for the block session to be left, the later one opens', async () => {
  const { store } = storeCreate();
  const leave = deferredCreate();
  store.leavePromise = leave.promise;
  const startFirst = store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  const startSecond = store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_MOBILE));
  leave.resolve(true);
  const [resultFirst, resultSecond] = await Promise.all([startFirst, startSecond]);
  assert.equal(resultFirst.code, -1);
  assert.equal(resultSecond.code, 0);
  assert.equal(store.sidePanelText?.ownerId, OWNER_MOBILE);
});

test('a waiting edit request of a rendering that unmounts does not open', async () => {
  const { store } = storeCreate();
  const leave = deferredCreate();
  store.leavePromise = leave.promise;
  const start = store.eventHandle(eventBuild('sidePanelTextEditStartRequest', OWNER_SIDEBAR));
  store.sidePanelTextOwnerRelease(OWNER_SIDEBAR);
  leave.resolve(true);
  const result = await start;
  assert.equal(result.code, -1);
  assert.equal(store.sidePanelText, undefined);
});
