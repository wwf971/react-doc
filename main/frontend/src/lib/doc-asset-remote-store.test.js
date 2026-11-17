import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observable, runInAction } from 'mobx';
import { DocAssetStore } from '../store/DocAssetStore.ts';
import { DocObjectFrontendStore } from '../store/DocObjectFrontendStore.ts';
import { DocAssetRemoteStore } from '../store/DocAssetRemoteStore.ts';
import { assetStorageCacheCreate } from './doc-asset-storage-cache.js';
import { clientInstanceIdGet } from './doc-client-instance.js';

// the page's half of the asset storage layer (doc_page_impl_asset_storage.md#points-of-the-page):
// a partition of a frontend object held by a storage point of the page, read and written through
// a page driver. the page here is a built one (its base backend is a read-only snapshot), which is
// the hard case: the remote partition is read, cached and written with no development server.
// the driver is a fake backend in memory answering what a driver answers.

const OBJECT_ID = 'w5k6testobj';
const OBJECT_REF = `frontend:${OBJECT_ID}`;
const ENTRY_ID = 'w5k6entry00';
const PROVIDER_REF = 'frontend:w5k6auth000';

const ok = (data) => ({ code: 0, message: '', data });
const fail = (code, message) => ({ code, message, data: null });

// a backend of one storage point: partitions with a revision, items, records. `isDown` makes every
// call throw, as a network that is gone does
function backendFakeCreate() {
  const state = { partitionList: [], sequence: 0, isDown: false, callList: [] };
  const idNext = (prefix) => `${prefix}${String(++state.sequence).padStart(4, '0')}`;
  const hashOf = (text) => `hash:${text}`;
  const metaOf = (partition) => ({
    partitionId: partition.partitionId, ownerRef: partition.ownerRef, ownerTypeId: partition.ownerTypeId, partition: partition.partition,
    revision: partition.revision, isDeleted: partition.isDeleted, itemCount: partition.itemList.length, size: 0,
  });
  const partitionOf = (partitionId) => state.partitionList.find((one) => one.partitionId === partitionId);
  const itemOf = (partition, itemId) => partition.itemList.find((one) => one.itemId === itemId);
  const itemPublic = (item) => {
    const { textByVersionId: _text, ...rest } = item;
    return JSON.parse(JSON.stringify(rest));
  };
  // every write of a partition: its revision grows, the item written carries it
  const write = (partition, item) => {
    partition.revision += 1;
    if (item) item.revision = partition.revision;
    return partition.revision;
  };
  const methodMap = {
    statusGet: () => ok({ service: 'fake', contractVersion: 1, limit: {} }),
    accountGet: () => ok({ userId: 'user-1', name: 'Person', groupList: [] }),
    partitionList: () => ok({ partitionList: state.partitionList.map(metaOf) }),
    partitionGet: ({ partitionId, revisionKnown }) => {
      const partition = partitionOf(partitionId);
      if (!partition) return fail(-3, 'no such partition');
      if (revisionKnown === partition.revision) return ok({ partition: metaOf(partition), isSame: true });
      return ok({ partition: metaOf(partition), isSame: false, recordList: JSON.parse(JSON.stringify(partition.recordList)), itemList: partition.itemList.map(itemPublic) });
    },
    partitionCreate: ({ ownerRef, ownerTypeId, partition }) => {
      const found = state.partitionList.find((one) => one.ownerRef === ownerRef && one.partition === partition && !one.isDeleted);
      if (found) return ok({ partition: metaOf(found), isCreated: false });
      const made = { partitionId: idNext('p'), ownerRef, ownerTypeId, partition, revision: 0, isDeleted: false, itemList: [], recordList: [] };
      state.partitionList.push(made);
      return ok({ partition: metaOf(made), isCreated: true });
    },
    partitionDelete: ({ partitionId, isPurged }) => {
      const partition = partitionOf(partitionId);
      if (!partition) return fail(-3, 'no such partition');
      if (isPurged) state.partitionList = state.partitionList.filter((one) => one !== partition);
      else partition.isDeleted = true;
      return ok({});
    },
    itemCreate: ({ partitionId, itemId, lang, text, groupPath, owner, record }) => {
      const partition = partitionOf(partitionId);
      if (!partition) return fail(-3, 'no such partition');
      if (record && partition.recordList.some((one) => one.key === record.key)) return fail(-1, `the key ${record.key} is taken`);
      const versionId = idNext('v');
      const item = {
        itemId: itemId ?? idNext('i'), name: '', lang, contentType: 'text/markdown', fileExt: lang, owner, versionIdHead: versionId, isDeleted: false, isLocked: false,
        timeCreated: '20261114_10000000+09', groupPath: groupPath ?? '', revision: 0,
        versionList: [{ versionId, versionIdPrevList: [], time: '20261114_10000000+09', note: '', size: text.length, hash: hashOf(text), isLocked: false, dependencyList: [] }],
        eventList: [{ eventType: 'create', time: '20261114_10000000+09' }],
        textByVersionId: { [versionId]: text },
      };
      partition.itemList.push(item);
      const recordMade = record ? { ...record, itemId: item.itemId } : undefined;
      if (recordMade) partition.recordList.push(recordMade);
      const revision = write(partition, item);
      return ok({ item: itemPublic(item), version: { versionId, size: text.length, hash: hashOf(text), isText: true, text, metadata: {} }, ...(recordMade ? { record: recordMade } : {}), revision });
    },
    itemUpdate: ({ partitionId, itemId, hashBase, text }) => {
      const partition = partitionOf(partitionId);
      const item = partition ? itemOf(partition, itemId) : undefined;
      if (!item) return fail(-3, 'no such item');
      const version = item.versionList.find((one) => one.versionId === item.versionIdHead);
      if (version.hash !== hashBase) return fail(-2, 'changed since it was read');
      item.textByVersionId[version.versionId] = text;
      version.size = text.length;
      version.hash = hashOf(text);
      const revision = write(partition, item);
      // answered without the data, as a backend may: the page reads the version when it needs it
      return ok({ item: itemPublic(item), version: { versionId: version.versionId, size: text.length, hash: version.hash, isText: true, metadata: {} }, revision });
    },
    itemDelete: ({ partitionId, itemId, isRecordRemoved }) => {
      const partition = partitionOf(partitionId);
      const item = partition ? itemOf(partition, itemId) : undefined;
      if (!item) return fail(-3, 'no such item');
      item.isDeleted = true;
      if (isRecordRemoved) partition.recordList = partition.recordList.filter((one) => one.itemId !== itemId);
      return ok({ item: itemPublic(item), revision: write(partition, item) });
    },
    recordSet: ({ partitionId, key, name, pathList }) => {
      const partition = partitionOf(partitionId);
      const record = partition?.recordList.find((one) => one.key === key);
      if (!record) return fail(-3, 'no such record');
      if (name !== undefined) { if (name === null) delete record.name; else record.name = name; }
      if (pathList !== undefined) record.pathList = pathList;
      return ok({ record: { ...record }, revision: write(partition) });
    },
    itemGetList: ({ partitionId, requestList }) => {
      const partition = partitionOf(partitionId);
      if (!partition) return fail(-3, 'no such partition');
      return ok({
        answerList: requestList.map(({ itemId, versionId }) => {
          const item = itemOf(partition, itemId);
          if (!item) return fail(-3, 'no such item');
          const versionIdResolved = versionId === 'head' ? item.versionIdHead : versionId;
          const version = item.versionList.find((one) => one.versionId === versionIdResolved);
          const text = item.textByVersionId[versionIdResolved];
          return ok({ item: itemPublic(item), version: { versionId: versionIdResolved, size: version.size, hash: version.hash, isText: true, text, metadata: {} } });
        }),
      });
    },
  };
  const driver = {};
  for (const [method, run] of Object.entries(methodMap)) {
    driver[method] = async (args = {}) => {
      state.callList.push(method);
      if (state.isDown) throw new Error('network is gone');
      return run(args);
    };
  }
  return { state, driver };
}

function assetEntryBuild(itemId, text, owner) {
  const versionId = `${itemId}v`;
  return {
    itemId, name: '', lang: 'yaml', contentType: 'text/yaml', fileExt: 'yaml', versionIdHead: versionId, isDeleted: false, isLocked: false,
    timeCreated: '20261106_00000000+09', owner, folder: '~page:obj/item', dirName: itemId, groupPath: '', folderOwner: { ref: OBJECT_REF },
    storage: { pointId: 'file-tree', typeId: 'file-tree' },
    versionList: [{ versionId, versionIdPrevList: [], time: '', note: '', size: text.length, hash: 'h', isLocked: false, dependencyList: [] }],
    eventList: [],
    versionDataById: { [versionId]: { size: text.length, hash: 'h', isText: true, text, metadata: {} } },
  };
}

const typeBase = { apiSetOptionalList: [], isContentSearchable: false, configKeyList: [] };
const STORAGE = {
  typeList: [
    { ...typeBase, id: 'storage', extends: '', label: 'Storage', apiSetList: ['item', 'partition'], driverPlace: 'server', place: 'local' },
    { ...typeBase, id: 'file-tree', extends: 'storage', label: 'File tree', apiSetList: [], driverPlace: 'server', place: 'local' },
    { ...typeBase, id: 'remote', extends: 'storage', label: 'Remote', apiSetList: ['cache', 'auth'], driverPlace: 'page', place: 'remote' },
    { ...typeBase, id: 'fake.remote', extends: 'remote', label: 'Fake backend', apiSetList: [], driverPlace: 'page', place: 'remote' },
  ],
  apiSetList: [],
  pointList: [
    { id: 'file-tree', typeId: 'file-tree', label: 'File tree', scope: 'builtIn', docPageAlias: '', status: 'ready', statusMessage: '', driverPlace: 'server', config: {}, apiSetList: ['item', 'partition'] },
    { id: 'cloud', typeId: 'fake.remote', label: 'Cloud', scope: 'workspace', docPageAlias: '', status: 'ready', statusMessage: '', driverPlace: 'page', config: { url: 'https://fake.invalid' }, auth: { provider: PROVIDER_REF }, apiSetList: ['item', 'partition', 'cache', 'auth'] },
  ],
  fileList: [],
};

// the auth layer as the remote store needs it: one provider, a session a test signs in and out
function authFakeCreate() {
  const session = observable.box({ status: 'signedOut', identity: undefined });
  const listenerList = [];
  return {
    session,
    providerGet: () => ({ ref: PROVIDER_REF, name: 'Account', status: 'ready', message: '', config: {} }),
    sessionGet: () => session.get(),
    credentialGet: async () => (session.get().status === 'signedIn' ? ok({ token: 'token', tokenType: 'Bearer' }) : fail(-7, 'not signed in')),
    sessionEndListen: (listener) => { listenerList.push(listener); return () => {}; },
    identitySet: () => {},
    signIn: (subject = 'subject-1') => runInAction(() => session.set({ status: 'signedIn', identity: { subject } })),
    signOut: () => {
      runInAction(() => session.set({ status: 'signedOut', identity: undefined }));
      for (const listener of listenerList) listener(PROVIDER_REF);
    },
  };
}

// a built page: its snapshot holds the object (its entry, one local asset) and the bind of its
// partition "cloud" to the point of the page; nothing of that partition is in the snapshot
async function pageCreate({ backend = backendFakeCreate(), cache = assetStorageCacheCreate({ indexedDB: undefined }), authStore = authFakeCreate(), storage = STORAGE } = {}) {
  const entryText = `name: Notebook\ntype: frontend.object\n`;
  const assetStore = new DocAssetStore({
    snapshot: {
      itemById: { [ENTRY_ID]: assetEntryBuild(ENTRY_ID, entryText, { ref: OBJECT_REF, role: 'entry' }) },
      storage,
      folderList: [{ path: '~page:obj/item', owner: { ref: OBJECT_REF }, partitionList: [] }],
      objectFrontend: {
        docPageList: [{
          alias: 'page',
          objectList: [{
            id: OBJECT_ID, entry: ENTRY_ID, docPageAlias: 'page', dir: 'obj', listList: [],
            partitionStorageList: [{ partition: 'cloud', pointId: 'cloud', typeId: 'fake.remote', unavailableReason: '', driverPlace: 'page', owner: { ref: OBJECT_REF, typeId: 'frontend.object' } }],
          }],
        }],
      },
    },
  });
  const objectFrontendStore = new DocObjectFrontendStore({ assetStore });
  const remoteStore = new DocAssetRemoteStore({ assetStore, authStore, objectFrontendStore }, {
    driverList: [{ typeId: 'fake.remote', driverCreate: () => backend.driver }], cache, notifyTiming: { readDelayMs: 1, selfCheckMs: 20 },
  });
  assetStore.remoteSet(remoteStore);
  objectFrontendStore.stores.remoteStore = remoteStore;
  assetStore.init();
  await assetStore.startPromise;
  await objectFrontendStore.configLoad();
  remoteStore.init();
  await settle();
  // the entry of the object is read on demand
  objectFrontendStore.objectGet(OBJECT_ID);
  await settle();
  return { assetStore, objectFrontendStore, remoteStore, backend, cache, authStore };
}

const settle = async () => { for (let index = 0; index < 30; index += 1) await new Promise((resolve) => setTimeout(resolve, 1)); };

const partitionOf = (page) => page.objectFrontendStore.objectGet(OBJECT_ID).partitionList.find((one) => one.id === 'cloud');

test('signed out, a remote partition shows nothing and says why; the object and the page are not broken', async () => {
  const page = await pageCreate();
  const state = page.objectFrontendStore.objectGet(OBJECT_ID);
  assert.equal(state.status, 'found');
  assert.equal(partitionOf(page).storage.driverPlace, 'page');
  assert.equal(partitionOf(page).storage.remote.status, 'authRequired');
  assert.deepEqual(state.assetList, []);
  assert.match(page.objectFrontendStore.partitionWriteUnavailableReasonGet(OBJECT_ID, 'cloud'), /sign in/);
  // the page is a built one: nothing of it is writable, the object neither
  assert.notEqual(page.objectFrontendStore.writeUnavailableReasonOf(OBJECT_ID), '');
  // nobody was asked for a partition: only the point's own status would be public
  assert.equal(page.backend.state.callList.includes('partitionList'), false);
  const refused = await page.objectFrontendStore.assetCreate(OBJECT_ID, { kind: 'note', lang: 'md', name: 'A', text: 'a', partition: 'cloud' });
  assert.equal(refused.code, -7);
  page.remoteStore.dispose();
});

test('signed in on a built page: the partition is made by its first write, read back, written, and its record changed', async () => {
  const page = await pageCreate();
  page.authStore.signIn();
  await settle();
  assert.equal(partitionOf(page).storage.remote.status, 'absent');
  // the object is writable now, in that partition, though the page has no development server
  assert.equal(page.objectFrontendStore.writeUnavailableReasonOf(OBJECT_ID), '');
  assert.equal(page.objectFrontendStore.partitionWriteUnavailableReasonGet(OBJECT_ID, 'cloud'), '');
  const made = await page.objectFrontendStore.assetCreate(OBJECT_ID, { kind: 'note', lang: 'md', name: 'First', pathList: ['/note/first'], text: 'hello', partition: 'cloud', groupPath: 'note' });
  assert.equal(made.code, 0, made.message);
  assert.deepEqual(Object.keys(made).sort(), ['code', 'data', 'message']);
  const { key, itemId } = made.data;
  const state = page.objectFrontendStore.objectGet(OBJECT_ID);
  const asset = state.assetList.find((one) => one.key === key);
  assert.deepEqual([asset.status, asset.partition, asset.name, asset.item.groupPath, asset.item.storage.pointId, asset.isInFolder, asset.isOwnerMatch], ['found', 'cloud', 'First', 'cloud/note', 'cloud', true, true]);
  assert.equal(partitionOf(page).storage.remote.status, 'ready');
  assert.equal(partitionOf(page).assetCount, 1);
  assert.deepEqual(state.problemList, []);
  // the item is an item of the one store: found in its index, its data read through the store
  assert.equal(page.assetStore.itemGet('local', itemId).folderOwner.ref, OBJECT_REF);
  page.objectFrontendStore.assetTextGet(OBJECT_ID, key);
  await settle();
  assert.equal(page.objectFrontendStore.assetTextGet(OBJECT_ID, key).text, 'hello');
  // the version came with the write: the point was not asked for it again
  assert.equal(page.backend.state.callList.includes('itemGetList'), false);
  // the head rewritten, with the hash the page read
  const written = await page.objectFrontendStore.assetWrite(OBJECT_ID, key, 'hello again');
  assert.equal(written.code, 0, written.message);
  assert.equal(page.backend.state.partitionList[0].itemList[0].textByVersionId[asset.item.versionIdHead], 'hello again');
  // the write was answered without the data: what the page held of that version is not shown any
  // more, and the version is read from the point when it is asked for
  assert.notEqual(page.objectFrontendStore.assetTextGet(OBJECT_ID, key).text, 'hello');
  await settle();
  assert.equal(page.objectFrontendStore.assetTextGet(OBJECT_ID, key).text, 'hello again');
  assert.equal(page.backend.state.callList.includes('itemGetList'), true);
  // how it is named and indexed: its record at the point; a path another asset has is refused by the page
  assert.equal((await page.objectFrontendStore.assetMetaSet(OBJECT_ID, key, { name: 'Renamed', pathList: ['/note/renamed'] })).code, 0);
  assert.deepEqual(page.backend.state.partitionList[0].recordList, [{ key, kind: 'note', itemId, name: 'Renamed', pathList: ['/note/renamed'] }]);
  const second = await page.objectFrontendStore.assetCreate(OBJECT_ID, { kind: 'note', lang: 'md', name: 'Second', pathList: ['/note/renamed'], text: 'b', partition: 'cloud' });
  assert.equal(second.code, -1);
  assert.match(second.message, /is the path of Renamed already/);
  // removed: off the records, marked deleted at the point
  assert.equal((await page.objectFrontendStore.assetRemove(OBJECT_ID, key)).code, 0);
  assert.deepEqual(page.objectFrontendStore.objectGet(OBJECT_ID).assetList, []);
  assert.equal(page.backend.state.partitionList[0].itemList[0].isDeleted, true);
  // a write the base holds is still refused on a built page
  const local = await page.objectFrontendStore.assetCreate(OBJECT_ID, { kind: 'note', lang: 'md', name: 'Local', text: 'c', partition: 'local' });
  assert.equal(local.code, -1);
  page.remoteStore.dispose();
});

test('the cache: shown at the next page start before the point answers, checked by revision, read again when it changed elsewhere', async () => {
  const backend = backendFakeCreate();
  const cache = assetStorageCacheCreate({ indexedDB: undefined });
  const first = await pageCreate({ backend, cache });
  first.authStore.signIn();
  await settle();
  const made = await first.objectFrontendStore.assetCreate(OBJECT_ID, { kind: 'note', lang: 'md', name: 'Kept', text: 'kept text', partition: 'cloud' });
  assert.equal(made.code, 0, made.message);
  first.remoteStore.dispose();

  // the next page start, the same person: the point is down
  backend.state.isDown = true;
  backend.state.callList.length = 0;
  const authStore = authFakeCreate();
  authStore.signIn();
  const second = await pageCreate({ backend, cache, authStore });
  const remote = partitionOf(second).storage.remote;
  assert.deepEqual([remote.status, remote.isFromCache], ['ready', true]);
  assert.match(remote.message, /shown from the cache/);
  const asset = second.objectFrontendStore.objectGet(OBJECT_ID).assetList[0];
  assert.equal(asset.name, 'Kept');
  second.objectFrontendStore.assetTextGet(OBJECT_ID, asset.key);
  await settle();
  assert.equal(second.objectFrontendStore.assetTextGet(OBJECT_ID, asset.key).text, 'kept text');
  // nothing is written while the point is out of reach
  assert.match(second.objectFrontendStore.partitionWriteUnavailableReasonGet(OBJECT_ID, 'cloud'), /shown from the cache/);

  // the point is back: a refresh costs one small answer while nothing changed
  backend.state.isDown = false;
  backend.state.callList.length = 0;
  await second.remoteStore.partitionRefresh(OBJECT_REF, 'cloud');
  assert.deepEqual(backend.state.callList, ['partitionGet']);
  assert.deepEqual([partitionOf(second).storage.remote.status, partitionOf(second).storage.remote.isFromCache], ['ready', false]);
  assert.equal(second.objectFrontendStore.partitionWriteUnavailableReasonGet(OBJECT_ID, 'cloud'), '');

  // somebody else writes at the point: a refresh brings it, and the cached version of the item is not trusted any more
  const partition = backend.state.partitionList[0];
  const item = partition.itemList[0];
  item.textByVersionId[item.versionIdHead] = 'changed elsewhere';
  item.versionList[0].hash = 'hash:changed elsewhere';
  partition.revision += 1;
  item.revision = partition.revision;
  await second.remoteStore.partitionRefresh(OBJECT_REF, 'cloud');
  await settle();
  second.objectFrontendStore.assetTextGet(OBJECT_ID, asset.key);
  await settle();
  assert.equal(second.objectFrontendStore.assetTextGet(OBJECT_ID, asset.key).text, 'changed elsewhere');

  // a write of the page made on a stale hash is a conflict, not an overwrite
  item.textByVersionId[item.versionIdHead] = 'changed again';
  item.versionList[0].hash = 'hash:changed again';
  partition.revision += 1;
  item.revision = partition.revision;
  const conflict = await second.objectFrontendStore.assetWrite(OBJECT_ID, asset.key, 'mine');
  assert.equal(conflict.code, -2);
  assert.equal(item.textByVersionId[item.versionIdHead], 'changed again');

  // signing out takes the partition off the page and drops the copy of that person
  second.authStore.signOut();
  await settle();
  assert.equal(partitionOf(second).storage.remote.status, 'authRequired');
  assert.deepEqual(second.objectFrontendStore.objectGet(OBJECT_ID).assetList, []);
  assert.equal(second.assetStore.itemGet('local', item.itemId), undefined);
  assert.equal((await cache.infoGet('cloud')).partitionCount, 0);
  second.remoteStore.dispose();
});

test('another person on the same browser never reads the copy of the one before', async () => {
  const backend = backendFakeCreate();
  const cache = assetStorageCacheCreate({ indexedDB: undefined });
  const first = await pageCreate({ backend, cache });
  first.authStore.signIn('subject-1');
  await settle();
  await first.objectFrontendStore.assetCreate(OBJECT_ID, { kind: 'note', lang: 'md', name: 'Private', text: 'private', partition: 'cloud' });
  first.remoteStore.dispose();
  // the backend of the other person holds nothing; the point is down, so only a cache could answer
  const backendOther = backendFakeCreate();
  backendOther.state.isDown = true;
  const authStore = authFakeCreate();
  authStore.signIn('subject-2');
  const second = await pageCreate({ backend: backendOther, cache, authStore });
  assert.equal(partitionOf(second).storage.remote.status, 'unreachable');
  assert.deepEqual(second.objectFrontendStore.objectGet(OBJECT_ID).assetList, []);
  second.remoteStore.dispose();
});

test('a role given after sign-in: a refusal is asked again once with a credential of now', async () => {
  // the provider knows the roles of the account; the session carries them as they were when its
  // credential was made, and the point refuses a credential without the role
  const roleAtProvider = { list: [] };
  const authStore = authFakeCreate();
  let freshCount = 0;
  authStore.credentialGet = async (_ref, options = {}) => {
    if (authStore.session.get().status !== 'signedIn') return fail(-7, 'not signed in');
    if (options.isFresh) {
      freshCount += 1;
      runInAction(() => authStore.session.set({ status: 'signedIn', identity: { subject: 'subject-1', roleList: [...roleAtProvider.list] } }));
    }
    return ok({ token: 'token', tokenType: 'Bearer' });
  };
  const backend = backendFakeCreate();
  for (const [method, inner] of Object.entries(backend.driver)) {
    if (typeof inner !== 'function') continue;
    backend.driver[method] = async (args) => ((authStore.session.get().identity?.roleList ?? []).includes('storage') ? inner(args) : fail(-8, 'the account does not hold the role storage'));
  }
  const page = await pageCreate({ backend, authStore });
  authStore.signIn();
  await settle();
  assert.equal(partitionOf(page).storage.remote.status, 'forbidden');
  const freshCountRefused = freshCount;
  assert.ok(freshCountRefused >= 1, 'a refusal asks for a credential of now');

  // the role is given elsewhere; nobody signs in again, the partition is refreshed
  roleAtProvider.list = ['storage'];
  await page.remoteStore.partitionRefresh(`frontend:${OBJECT_ID}`, 'cloud');
  await settle();
  assert.ok(['absent', 'ready'].includes(partitionOf(page).storage.remote.status), partitionOf(page).storage.remote.status);
  assert.equal(page.objectFrontendStore.partitionWriteUnavailableReasonGet(OBJECT_ID, 'cloud'), '');
  const created = await page.objectFrontendStore.assetCreate(OBJECT_ID, { kind: 'note', lang: 'md', name: 'After the role', text: 'written', partition: 'cloud' });
  assert.equal(created.code, 0, created.message);
  page.remoteStore.dispose();
});

// a point whose config asks for notifications, over a backend that keeps channels: the fake driver
// hands its channel to the test, which tells what the backend would
const STORAGE_NOTIFY = {
  ...STORAGE,
  pointList: STORAGE.pointList.map((point) => (point.id === 'cloud'
    ? { ...point, config: { ...point.config, isNotifyEnabled: true }, apiSetList: [...point.apiSetList, 'notify'] }
    : point)),
};

function channelFakeAdd(backend) {
  const channel = { openCount: 0, closeCount: 0, onNotification: undefined, onStateChange: undefined };
  backend.driver.notifyOpen = ({ onNotification, onStateChange }) => {
    channel.openCount += 1;
    channel.onNotification = onNotification;
    channel.onStateChange = onStateChange;
    onStateChange({ status: 'connecting', message: '' });
    return { close: () => { channel.closeCount += 1; } };
  };
  return channel;
}

const OTHER_INSTANCE = 'zzzzzzzzzzzzzzzz';
const callCountOf = (backend, method) => backend.state.callList.filter((one) => one === method).length;

test('notifications: a change made elsewhere is read at once, one made by this tab is not; the channel follows the session', async () => {
  const backend = backendFakeCreate();
  const channel = channelFakeAdd(backend);
  const page = await pageCreate({ backend, storage: STORAGE_NOTIFY });
  assert.equal(channel.openCount, 0, 'nobody signed in: no channel');
  assert.match(page.remoteStore.notifyStateGet('cloud').message, /sign in/);
  page.authStore.signIn();
  await settle();
  assert.equal(channel.openCount, 1, 'signed in, the point holding a partition of the page: one channel');
  channel.onStateChange({ status: 'open', message: '', timeOpened: Date.now() });
  await settle();
  assert.equal(page.remoteStore.notifyStateGet('cloud').status, 'open');
  assert.equal(partitionOf(page).storage.remote.notify.status, 'open');

  // this tab writes: the point tells it back with this tab as the actor, and nothing is read
  const made = await page.objectFrontendStore.assetCreate(OBJECT_ID, { kind: 'note', lang: 'md', name: 'Mine', text: 'mine', partition: 'cloud' });
  assert.equal(made.code, 0, made.message);
  const partitionId = backend.state.partitionList[0].partitionId;
  const getCountBefore = callCountOf(backend, 'partitionGet');
  channel.onNotification({ event: 'partitionChanged', partitionId, revision: 1, itemIdList: [made.data.itemId], actor: { userId: 'user-1', clientInstanceId: clientInstanceIdGet() }, time: '20261116_12000000+09' });
  await settle();
  assert.equal(callCountOf(backend, 'partitionGet'), getCountBefore, 'its own change is not read again');
  assert.equal(page.remoteStore.notifyStateGet('cloud').logList[0].handling, 'known', 'the answer of the write came first: the revision is held');

  // another tab writes at the backend: told, read, shown, and said to come from elsewhere
  const other = backend.driver;
  const written = await other.itemCreate({ partitionId, lang: 'md', text: 'theirs', record: { key: 'theirs', kind: 'note', name: 'Theirs' } });
  channel.onNotification({ event: 'partitionChanged', partitionId, revision: written.data.revision, itemIdList: [written.data.item.itemId], actor: { userId: 'user-1', clientInstanceId: OTHER_INSTANCE }, time: '20261116_12000100+09' });
  await settle();
  assert.equal(callCountOf(backend, 'partitionGet'), getCountBefore + 1, 'one read of the partition');
  const assetList = page.objectFrontendStore.objectGet(OBJECT_ID).assetList.map((one) => one.name).sort();
  assert.deepEqual(assetList, ['Mine', 'Theirs']);
  const changeElsewhere = partitionOf(page).storage.remote.changeElsewhere;
  assert.equal(changeElsewhere.actor.clientInstanceId, OTHER_INSTANCE);
  assert.deepEqual(changeElsewhere.itemIdList, [written.data.item.itemId]);
  const notify = page.objectFrontendStore.partitionNotifyGet(OBJECT_ID, 'cloud');
  assert.equal(notify.clientInstanceId, clientInstanceIdGet());
  assert.deepEqual(notify.logList.map((one) => [one.handling, one.isSelf]), [['read', false], ['known', true]]);

  // a change of this tab told before its answer (or with the answer lost): not read at once; checked a moment later
  const getCountSelf = callCountOf(backend, 'partitionGet');
  await other.recordSet({ partitionId, key: 'theirs', name: 'Theirs again' });
  channel.onNotification({ event: 'partitionChanged', partitionId, revision: backend.state.partitionList[0].revision, actor: { userId: 'user-1', clientInstanceId: clientInstanceIdGet() } });
  await settle();
  assert.equal(page.remoteStore.notifyStateGet('cloud').logList[0].handling, 'self');
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  assert.equal(callCountOf(backend, 'partitionGet'), getCountSelf + 1, 'the revision told never came with an answer: read');
  assert.ok(page.objectFrontendStore.objectGet(OBJECT_ID).assetList.some((one) => one.name === 'Theirs again'));

  // a burst of changes elsewhere: one read
  const getCountBurst = callCountOf(backend, 'partitionGet');
  for (let index = 0; index < 5; index += 1) {
    channel.onNotification({ event: 'partitionChanged', partitionId, revision: 100 + index, actor: { userId: 'user-1', clientInstanceId: OTHER_INSTANCE } });
  }
  await settle();
  assert.equal(callCountOf(backend, 'partitionGet'), getCountBurst + 1, 'five notifications in a row, one read');

  // the channel opened again after a gap: every partition of the point asked again
  channel.onStateChange({ status: 'waiting', message: 'closed' });
  const getCountReopen = callCountOf(backend, 'partitionGet');
  channel.onStateChange({ status: 'open', message: '', timeOpened: Date.now() + 1000 });
  await settle();
  assert.equal(callCountOf(backend, 'partitionGet'), getCountReopen + 1, 'opened again: the partition is checked (the notifications in between are lost)');
  assert.equal(page.remoteStore.notifyStateGet('cloud').countOpened, 2);

  // signed out: the channel is closed; another person: another channel
  page.authStore.signOut();
  await settle();
  assert.equal(channel.closeCount, 1);
  page.authStore.signIn('subject-2');
  await settle();
  assert.equal(channel.openCount, 2);
  page.remoteStore.dispose();
  assert.equal(channel.closeCount, 2, 'the page closed: its channel too');
});

test('notifications: a point that does not ask has no channel; a driver without one says so', async () => {
  const backend = backendFakeCreate();
  const channel = channelFakeAdd(backend);
  const page = await pageCreate({ backend });
  page.authStore.signIn();
  await settle();
  assert.equal(channel.openCount, 0, 'isNotifyEnabled absent: no channel');
  assert.equal(partitionOf(page).storage.remote.notify, undefined);
  page.remoteStore.dispose();

  const backendPlain = backendFakeCreate();
  const pagePlain = await pageCreate({ backend: backendPlain, storage: STORAGE_NOTIFY });
  pagePlain.authStore.signIn();
  await settle();
  assert.equal(pagePlain.remoteStore.notifyStateGet('cloud').status, 'unsupported');
  assert.equal(partitionOf(pagePlain).storage.remote.status, 'absent', 'the partition is read as before');
  pagePlain.remoteStore.dispose();
});
