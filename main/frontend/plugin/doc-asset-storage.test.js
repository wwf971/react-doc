import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as yamlParse } from 'yaml';
import { assetStoreCreate } from './doc-asset-store.ts';
import { docAssetMiddlewareCreate } from './doc-asset-server.ts';
import { docAssetConfigLoad, loadConfigDoc } from './doc-source.ts';
import { objectFrontendConfigOfDocPageListGet } from './doc-object-frontend.ts';
import {
  assetStorageConfigRead, assetStoragePartitionBindResolve, assetStorageTypeApiSetListGet, assetStorageTypeIs,
} from './doc-asset-storage.ts';
import { assetStorageFilePackDriverCreate } from './doc-asset-storage-file-pack.ts';

// the asset storage service layer (doc_page_impl_asset_storage.md): the storage types, the points a
// workspace and a doc page declare, the driver of file-pack, and a partition of a frontend object
// bound to a point, read and written through the same asset api as any other

const ITEM_A = 'w5j7aaaaaaa';
const ITEM_B = 'w5j7bbbbbbb';

function dirTempCreate() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doc-asset-storage-'));
}

test('storage types: a type promises the api sets of its ancestors and its own', () => {
  assert.deepEqual(assetStorageTypeApiSetListGet('file-tree'), ['item', 'partition']);
  assert.deepEqual(assetStorageTypeApiSetListGet('file-pack'), ['item', 'partition', 'pack']);
  assert.deepEqual(assetStorageTypeApiSetListGet('remote-notify'), ['item', 'partition', 'cache', 'auth', 'notify']);
  assert.equal(assetStorageTypeIs('remote-notify', 'remote'), true);
  assert.equal(assetStorageTypeIs('file-pack', 'remote'), false);
});

test('file-pack driver: items, versions and metadata in pack files, the last chunk holding', () => {
  const dir = dirTempCreate();
  const driver = assetStorageFilePackDriverCreate({});
  assert.deepEqual(driver.itemPlaceList(dir), []);
  driver.versionWrite(dir, `book/${ITEM_A}--Dune`, 'v1', 'yaml', Buffer.from('title: Dune\n'));
  driver.versionMetadataWrite(dir, `book/${ITEM_A}--Dune`, 'v1', { engine: 'x' });
  driver.itemMetaWrite(dir, `book/${ITEM_A}--Dune`, { itemId: ITEM_A, name: 'Dune' });
  driver.versionWrite(dir, ITEM_B, 'v1', 'bin', Buffer.from([0, 1, 2, 255]));
  driver.itemMetaWrite(dir, ITEM_B, { itemId: ITEM_B, name: '' });
  assert.deepEqual(fs.readdirSync(dir), ['item-0001.pack']);
  // nothing of the content is plain text in the file
  assert.equal(fs.readFileSync(path.join(dir, 'item-0001.pack')).includes('Dune'), false);
  assert.deepEqual(driver.itemPlaceList(dir), [
    { dirName: `book/${ITEM_A}--Dune`, itemId: ITEM_A, groupPath: 'book' },
    { dirName: ITEM_B, itemId: ITEM_B, groupPath: '' },
  ]);
  assert.equal(driver.versionRead(dir, `book/${ITEM_A}--Dune`, 'v1', 'yaml').toString(), 'title: Dune\n');
  assert.deepEqual([...driver.versionRead(dir, ITEM_B, 'v1', 'bin')], [0, 1, 2, 255]);
  assert.deepEqual(driver.versionMetadataRead(dir, `book/${ITEM_A}--Dune`, 'v1'), { engine: 'x' });
  assert.deepEqual(driver.versionMetadataRead(dir, ITEM_B, 'v1'), {});
  // rewritten in place: the chunk before is dead, the new one is read
  driver.versionWrite(dir, `book/${ITEM_A}--Dune`, 'v1', 'yaml', Buffer.from('title: Dune Messiah\n'));
  assert.equal(driver.versionRead(dir, `book/${ITEM_A}--Dune`, 'v1', 'yaml').toString(), 'title: Dune Messiah\n');
  assert.ok(driver.infoGet(dir).sizeDead > 0);
  // a place changed, a group moved, a version and an item removed
  driver.itemPlaceSet(dir, `book/${ITEM_A}--Dune`, `book/${ITEM_A}--Messiah`);
  driver.groupMove(dir, 'book', 'shelf/sci-fi');
  assert.equal(driver.itemPlaceList(dir).find((one) => one.itemId === ITEM_A).dirName, `shelf/sci-fi/${ITEM_A}--Messiah`);
  driver.versionWrite(dir, `shelf/sci-fi/${ITEM_A}--Messiah`, 'v2', 'yaml', Buffer.from('b: 2\n'));
  driver.versionRemove(dir, `shelf/sci-fi/${ITEM_A}--Messiah`, 'v1', 'yaml');
  assert.equal(driver.versionRead(dir, `shelf/sci-fi/${ITEM_A}--Messiah`, 'v1', 'yaml'), undefined);
  assert.deepEqual(driver.versionMetadataRead(dir, `shelf/sci-fi/${ITEM_A}--Messiah`, 'v1'), {});
  driver.itemRemove(dir, ITEM_B);
  assert.equal(driver.itemMetaRead(dir, ITEM_B), undefined);
  // read again from the files alone (another driver has no index of them)
  const info = driver.compact(dir);
  assert.equal(info.sizeDead, 0);
  assert.equal(info.itemCount, 1);
  assert.equal(driver.versionRead(dir, `shelf/sci-fi/${ITEM_A}--Messiah`, 'v2', 'yaml').toString(), 'b: 2\n');
  assert.deepEqual(driver.itemMetaRead(dir, `shelf/sci-fi/${ITEM_A}--Messiah`), { itemId: ITEM_A, name: 'Dune' });
});

test('file-pack driver: a new pack file when one is full, a torn tail ignored and cut off, changes told by item', () => {
  const dir = dirTempCreate();
  const driver = assetStorageFilePackDriverCreate({ packSizeMax: 200, isCompressed: false });
  driver.versionWrite(dir, ITEM_A, 'v1', 'txt', Buffer.alloc(150, 'a'));
  driver.itemMetaWrite(dir, ITEM_A, { itemId: ITEM_A });
  driver.versionWrite(dir, ITEM_B, 'v1', 'txt', Buffer.alloc(150, 'b'));
  driver.itemMetaWrite(dir, ITEM_B, { itemId: ITEM_B });
  assert.ok(fs.readdirSync(dir).length >= 2);
  assert.deepEqual(driver.changeItemIdListGet(dir).sort(), [ITEM_A, ITEM_B]);
  assert.deepEqual(driver.changeItemIdListGet(dir), []);
  // a write interrupted in the middle of a chunk: what is whole is still read, and the next write goes after it
  const fileLast = path.join(dir, fs.readdirSync(dir).sort().at(-1));
  fs.appendFileSync(fileLast, Buffer.from([0, 0, 0, 9, 0, 0, 9, 9, 1, 2, 3]));
  assert.equal(driver.versionRead(dir, ITEM_B, 'v1', 'txt').length, 150);
  driver.versionWrite(dir, ITEM_B, 'v2', 'txt', Buffer.from('after'));
  assert.equal(driver.versionRead(dir, ITEM_B, 'v2', 'txt').toString(), 'after');
  assert.deepEqual(driver.changeItemIdListGet(dir), [ITEM_B]);
});

// ---------- a doc page with a frontend object ----------

function fixtureCreate() {
  const dir = dirTempCreate();
  const pageDir = path.join(dir, 'page');
  fs.mkdirSync(path.join(pageDir, '.doc-page'), { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'a.md'), '# A\n');
  fs.writeFileSync(path.join(pageDir, '.doc-page', 'entry.yaml'), [
    'docEntry:', '  title: Fixture', 'source:', '  - action: addFolder', '    alias: docs', '    path: ..', '    collect: recursive',
    'sidePanelById:', '  main:', '    tree:', '      - doc: ~docs/a.md', '',
  ].join('\n'));
  fs.writeFileSync(path.join(pageDir, '.doc-page', 'type.yaml'), [
    'typeList:',
    '  - id: demo.profile',
    '    assetKindList:',
    '      - { id: info, langList: [yaml], groupPath: info }',
    '    partitionList:',
    '      - { id: example }',
    '      - { id: real, storagePoint: file-pack }',
    '      - { id: other }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), ['docEntry:', '  dir: ./page', ''].join('\n'));
  return dir;
}

function middlewareCreate(dir) {
  const configFile = path.join(dir, 'config.yaml');
  return docAssetMiddlewareCreate({
    endpoint: '/__doc-asset',
    storeGet: () => assetStoreCreate(docAssetConfigLoad(configFile)),
    rootAbsPathByPathGet: () => new Map([['~page:docs', path.join(dir, 'page')]]),
    usageScan: () => [],
    objectFrontendConfigGet: () => {
      const configDoc = loadConfigDoc(configFile);
      const assetConfig = docAssetConfigLoad(configFile);
      const assetFolderByAlias = new Map(assetConfig.docPageList.map((docPage) => [docPage.alias, docPage.folderDefault]));
      return objectFrontendConfigOfDocPageListGet(configDoc.docEntry.docPageList, dir, assetFolderByAlias, configDoc.typeDeclared.typeList, assetConfig.storage);
    },
  });
}

function requestRun(middleware, method, url, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    const res = { statusCode: 200, setHeader: () => {}, end: (text) => resolve({ status: res.statusCode, body: JSON.parse(String(text)) }) };
    middleware(req, res, () => resolve({ status: -1, body: undefined }));
    if (method === 'POST') {
      process.nextTick(() => {
        req.emit('data', Buffer.from(JSON.stringify(body ?? {})));
        req.emit('end');
      });
    }
  });
}

async function objectCreate(dir) {
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'demo.profile', name: 'Me' });
  assert.equal(created.body.code, 0, created.body.message);
  const id = created.body.data.id;
  const itemDir = path.join(dir, 'page', '.doc-page', 'object-frontend', `${id}--Me`, 'item');
  const post = (route, body) => requestRun(middleware, 'POST', `/__doc-asset/${route}`, body);
  const get = (route) => requestRun(middleware, 'GET', `/__doc-asset/${route}`);
  return { id, itemDir, post, get, objectPost: (route, body) => post(`object-frontend/${route}`, { id, ...body }) };
}

test('a partition bound to file-pack by its type: its items in pack files, the same asset api', async () => {
  const dir = fixtureCreate();
  const { id, itemDir, post, get, objectPost } = await objectCreate(dir);
  const madeExample = await objectPost('asset/create', { kind: 'info', partition: 'example', text: 'a: 1\n' });
  const made = await objectPost('asset/create', { kind: 'info', partition: 'real', name: 'secret', pathList: ['/real/info/secret'], text: 'salary: 1\n' });
  assert.equal(made.body.code, 0, made.body.message);
  const { itemId } = made.body.data;
  // the partition says its point, and holds its list and pack files: no folder per item
  assert.deepEqual(fs.readdirSync(path.join(itemDir, 'real')).sort(), ['item-0001.pack', 'item-list.yaml', 'partition.yaml']);
  assert.deepEqual(yamlParse(fs.readFileSync(path.join(itemDir, 'real', 'partition.yaml'), 'utf-8')), {
    storagePoint: 'file-pack', storageType: 'file-pack', owner: { ref: `frontend:${id}`, typeId: 'demo.profile' }, partition: 'real',
  });
  assert.equal(fs.readFileSync(path.join(itemDir, 'real', 'item-0001.pack')).includes('salary'), false);
  // the other partition stays file-tree, with no file saying so
  assert.equal(fs.existsSync(path.join(itemDir, 'example', 'partition.yaml')), false);
  assert.equal(fs.existsSync(path.join(itemDir, 'example', 'info', madeExample.body.data.itemId, 'item.yaml')), true);
  // read like any item, with where it is held
  const read = await get(`item/get?store=local&itemId=${itemId}`);
  assert.equal(read.body.data.version.text, 'salary: 1\n');
  assert.deepEqual(read.body.data.item.storage, { pointId: 'file-pack', typeId: 'file-pack' });
  assert.equal(read.body.data.item.groupPath, 'real/info');
  assert.equal(read.body.data.item.folderOwner.ref, `frontend:${id}`);
  const itemList = (await get('item/list?store=local')).body.data.itemList;
  assert.equal(itemList.find((one) => one.itemId === madeExample.body.data.itemId).storage.typeId, 'file-tree');
  // written in place and as a new version, renamed, locked: the store's own writes
  const hash = read.body.data.version.hash;
  const updated = await post('item/update', { store: 'local', itemId, hashBase: hash, text: 'salary: 2\n', mode: 'newVersion' });
  assert.equal(updated.body.code, 0, updated.body.message);
  assert.equal(updated.body.data.item.versionList.length, 2);
  assert.equal((await post('item/meta/set', { store: 'local', itemId, name: 'salary' })).body.data.item.dirName, `real/info/${itemId}--salary`);
  const versionIdFirst = updated.body.data.item.versionList[0].versionId;
  assert.equal((await get(`item/get?store=local&itemId=${itemId}&versionId=${versionIdFirst}`)).body.data.version.text, 'salary: 1\n');
  assert.equal((await post('version/metadata/set', { store: 'local', itemId, versionId: 'head', versionMetadata: { by: 'test' } })).body.data.version.metadata.by, 'test');
  assert.equal((await post('version/delete', { store: 'local', itemId, versionId: versionIdFirst })).body.data.item.versionList.length, 1);
  // the status says what the storage of the partition holds
  const status = (await get('status')).body.data;
  assert.deepEqual(status.storage.pointList.map((one) => one.id), ['file-tree', 'file-pack']);
  const folder = status.folderList.find((one) => one.owner?.ref === `frontend:${id}`);
  assert.equal(folder.partitionList.length, 1);
  assert.equal(folder.partitionList[0].partition, 'real');
  assert.equal(folder.partitionList[0].itemCount, 1);
  assert.deepEqual(folder.partitionList[0].typeIdFoundList, ['file-pack']);
  // the declarations carry the bind, for the page
  const decl = (await get('object-frontend/config')).body.data.docPageList[0].objectList[0];
  assert.deepEqual(decl.partitionStorageList, [{ partition: 'real', pointId: 'file-pack', typeId: 'file-pack', unavailableReason: '' }]);
  // a build bundles it like the rest
  const snapshot = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml'))).snapshotBuild();
  assert.equal(Object.values(snapshot.itemById[itemId].versionDataById)[0].text, 'salary: 2\n');
});

test('the storage of a partition changed whole, an item moved between partitions of two storage types', async () => {
  const dir = fixtureCreate();
  const { id, itemDir, get, post, objectPost } = await objectCreate(dir);
  const made = await objectPost('asset/create', { kind: 'info', partition: 'example', name: 'one', text: 'a: 1\n' });
  const { itemId, key } = made.body.data;
  const head = (await get(`item/get?store=local&itemId=${itemId}`)).body.data.version;
  await post('item/update', { store: 'local', itemId, hashBase: head.hash, text: 'a: 2\n', mode: 'newVersion' });
  await objectPost('asset/create', { kind: 'info', partition: 'example', groupPath: 'deep/er', text: 'b: 1\n' });
  // file-tree -> file-pack: every item and version kept, the folders of the items gone
  const set = await objectPost('partition/storage/set', { partition: 'example', storagePoint: 'file-pack' });
  assert.equal(set.body.code, 0, set.body.message);
  assert.deepEqual(fs.readdirSync(path.join(itemDir, 'example')).filter((name) => !name.endsWith('.bak')).sort(), ['item-0001.pack', 'item-list.yaml', 'partition.yaml']);
  assert.equal(set.body.data.itemList.length, 2);
  assert.ok(set.body.data.itemList.every((one) => one.storage.typeId === 'file-pack'));
  const item = (await get(`item/get?store=local&itemId=${itemId}`)).body.data;
  assert.equal(item.version.text, 'a: 2\n');
  assert.equal(item.item.versionList.length, 2);
  assert.equal(item.item.groupPath, 'example/info');
  assert.equal((await get(`item/get?store=local&itemId=${itemId}&versionId=${item.item.versionList[0].versionId}`)).body.data.version.text, 'a: 1\n');
  // the records of the object did not move
  const decl = (await get('object-frontend/config')).body.data.docPageList[0].objectList[0];
  assert.deepEqual(decl.listList.map((list) => [list.groupPath, list.assetList.length]), [['example', 2]]);
  // an item moved into a partition of file-tree is written there as folders and files
  const moved = await objectPost('asset/move', { key, groupPath: 'other/info' });
  assert.equal(moved.body.code, 0, moved.body.message);
  assert.equal(fs.existsSync(path.join(itemDir, 'other', 'info', itemId, 'item.yaml')), true);
  assert.equal((await get(`item/get?store=local&itemId=${itemId}`)).body.data.item.storage.typeId, 'file-tree');
  assert.equal((await get(`item/get?store=local&itemId=${itemId}`)).body.data.item.versionList.length, 2);
  // and back into the pack
  assert.equal((await objectPost('asset/move', { key, groupPath: 'example/info' })).body.code, 0);
  assert.equal(fs.existsSync(path.join(itemDir, 'other', 'info')), false);
  // a group crossing two storage points is refused; a partition is renamed with its storage
  assert.match((await objectPost('asset/group/move', { groupFrom: 'example/info', groupTo: 'other/info' })).body.message, /different storage points/);
  // file-pack -> file-tree: the pack files gone, the folders back
  const back = await objectPost('partition/storage/set', { partition: 'example', storagePoint: 'file-tree' });
  assert.equal(back.body.code, 0, back.body.message);
  assert.equal(fs.readdirSync(path.join(itemDir, 'example')).some((name) => name.endsWith('.pack')), false);
  assert.equal(fs.existsSync(path.join(itemDir, 'example', 'info', itemId, 'item.yaml')), true);
  assert.equal((await get(`item/get?store=local&itemId=${itemId}`)).body.data.version.text, 'a: 2\n');
  assert.equal((await get('item/list?store=local')).body.data.itemList.filter((one) => one.folderOwner?.ref === `frontend:${id}` && one.groupPath.startsWith('example')).length, 2);
});

test('storage points declared by a doc page: used by its objects, and a partition claimed back when its point is gone', async () => {
  const dir = fixtureCreate();
  const file = path.join(dir, 'page', '.doc-page', 'asset-storage.yaml');
  fs.writeFileSync(file, [
    'storagePointList:',
    '  - { id: pack-small, type: file-pack, label: Small packs, config: { packSizeMax: 4096 } }',
    '  - { id: team, type: remote, config: { url: "https://example.invalid" } }',
    '  - { id: off, type: file-pack, isEnabled: false }',
    '  - { id: file-pack, type: file-tree }',
    '',
  ].join('\n'));
  const { itemDir, get, objectPost } = await objectCreate(dir);
  const storage = (await get('status')).body.data.storage;
  assert.deepEqual(storage.pointList.map((one) => [one.id, one.scope, one.status]), [
    ['file-tree', 'builtIn', 'ready'], ['file-pack', 'builtIn', 'ready'], ['pack-small', 'docPage', 'ready'], ['team', 'docPage', 'typeNotImplemented'], ['off', 'docPage', 'disabled'],
  ]);
  assert.ok(storage.fileList[0].problemList.some((one) => /declared already/.test(one)));
  // a point that cannot be used is refused before anything is written
  assert.equal((await objectPost('partition/create', { partition: 'other', storagePoint: 'team' })).body.code, -6);
  assert.equal((await objectPost('partition/create', { partition: 'other', storagePoint: 'nope' })).body.code, -3);
  assert.equal((await objectPost('partition/create', { partition: 'other', storagePoint: 'pack-small' })).body.code, 0);
  const made = await objectPost('asset/create', { kind: 'info', partition: 'other', text: 'a: 1\n' });
  assert.equal(made.body.code, 0, made.body.message);
  assert.equal((await get(`item/get?store=local&itemId=${made.body.data.itemId}`)).body.data.item.storage.pointId, 'pack-small');
  // another point of the same type takes the partition as it is: only its file changes
  assert.equal((await objectPost('partition/storage/set', { partition: 'other', storagePoint: 'file-pack' })).body.code, 0);
  assert.equal((await objectPost('partition/storage/set', { partition: 'other', storagePoint: 'pack-small' })).body.code, 0);
  // its point is no longer declared: the data is read through another point of the type it was written by
  fs.rmSync(file);
  const read = await get(`item/get?store=local&itemId=${made.body.data.itemId}`);
  assert.equal(read.body.data.version.text, 'a: 1\n');
  const decl = (await get('object-frontend/config')).body.data.docPageList[0].objectList[0];
  assert.equal(decl.partitionStorageList[0].pointIdClaimed, 'file-pack');
  // the object claims it for the point there is
  assert.equal((await objectPost('partition/storage/set', { partition: 'other', storagePoint: 'file-pack' })).body.code, 0);
  assert.equal(yamlParse(fs.readFileSync(path.join(itemDir, 'other', 'partition.yaml'), 'utf-8')).storagePoint, 'file-pack');
  // a partition whose data no point can read is not read, and nothing is written into it
  fs.writeFileSync(path.join(itemDir, 'other', 'partition.yaml'), 'storagePoint: gone\nstorageType: remote\n');
  assert.equal((await get(`item/get?store=local&itemId=${made.body.data.itemId}`)).body.code, -3);
  assert.equal((await objectPost('asset/create', { kind: 'info', partition: 'other', text: 'b: 1\n' })).body.code, -6);
});

test('storage points of a workspace file are seen by every doc page; a bind resolves by the type the data was written by', () => {
  const dir = dirTempCreate();
  const workspaceFile = path.join(dir, 'asset-storage.yaml');
  fs.writeFileSync(workspaceFile, 'storagePointList:\n  - { id: shared, type: file-pack }\n');
  const config = assetStorageConfigRead({ docPageInputList: [{ alias: 'a', entryFile: path.join(dir, 'a', '.doc-page', 'entry.yaml') }], workspaceFile, configDir: dir });
  assert.deepEqual(config.pointList.map((one) => [one.id, one.scope]), [['file-tree', 'builtIn'], ['file-pack', 'builtIn'], ['shared', 'workspace']]);
  assert.equal(assetStoragePartitionBindResolve('real', { storagePoint: 'shared', storageType: 'file-pack' }, config, 'a').pointIdClaimed, undefined);
  assert.match(assetStoragePartitionBindResolve('real', { storagePoint: 'x', storageType: 'remote' }, config, 'a').unavailableReason, /not declared/);
});
