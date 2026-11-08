import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as yamlParse } from 'yaml';
import { assetStoreCreate, itemDirNameBuild } from './doc-asset-store.ts';
import { docAssetMiddlewareCreate } from './doc-asset-server.ts';
import { docAssetConfigLoad, loadConfigDoc } from './doc-source.ts';
import { objectFrontendConfigOfDocPageListGet, objectFrontendDirNameBuild } from './doc-object-frontend.ts';
import { objectFrontendAssetListMerge, objectFrontendListGroupPathGet } from '../src/lib/doc-object-frontend.js';
import {
  objectFrontendAssetIndexBuild, objectFrontendAssetPathBuild, objectFrontendAssetPathComplete, objectFrontendAssetPathNormalize,
  objectFrontendAssetAcceptCheck, objectFrontendAssetPathListParse, objectFrontendAssetRefResolve, objectFrontendAssetSearch,
  objectFrontendBlockRead, objectFrontendBlockTextBuild, objectFrontendEntryParse, objectFrontendModeChoose,
  objectFrontendModeListResolve,
} from '../src/lib/doc-object-frontend.js';

// the frontend object service layer (doc_page_impl_obj_frontend.md): the
// declarations of a doc page (object-frontend.yaml), the structural writes
// of the asset api, and the group folders of the asset store they rely on

function fixtureCreate({ objectFrontendYaml } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-object-frontend-'));
  const pageDir = path.join(dir, 'page');
  fs.mkdirSync(path.join(pageDir, '.doc-page'), { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'a.md'), '# A\n');
  fs.writeFileSync(path.join(pageDir, '.doc-page', 'entry.yaml'), [
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
  if (objectFrontendYaml !== undefined) fs.writeFileSync(path.join(pageDir, '.doc-page', 'object-frontend.yaml'), objectFrontendYaml);
  fs.writeFileSync(path.join(dir, 'config.yaml'), ['docEntry:', '  dir: ./page', ''].join('\n'));
  return dir;
}

function configGet(dir) {
  const configFile = path.join(dir, 'config.yaml');
  const configDoc = loadConfigDoc(configFile);
  const assetFolderByAlias = new Map(docAssetConfigLoad(configFile).docPageList.map((docPage) => [docPage.alias, docPage.folderDefault]));
  return objectFrontendConfigOfDocPageListGet(configDoc.docEntry.docPageList, dir, assetFolderByAlias, configDoc.typeDeclared.typeList);
}

// what the type config answers for a fixture
const typeDeclaredOf = (dir) => loadConfigDoc(path.join(dir, 'config.yaml')).typeDeclared;
const typeYamlWrite = (dir, text) => fs.writeFileSync(path.join(dir, 'page', '.doc-page', 'type.yaml'), text);

// the records of an object's item lists as the files say now, each with the folder of its list
function recordListOf(dir, id) {
  const decl = configGet(dir).docPageList.flatMap((docPage) => docPage.objectList).find((one) => one.id === id);
  return objectFrontendAssetListMerge([], decl.listList).assetList;
}
function middlewareCreate(dir) {
  return docAssetMiddlewareCreate({
    endpoint: '/__doc-asset',
    storeGet: () => assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml'))),
    rootAbsPathByPathGet: () => new Map([['~page:docs', path.join(dir, 'page')]]),
    usageScan: () => [],
    objectFrontendConfigGet: () => configGet(dir),
  });
}

function requestRun(middleware, method, url, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (text) => resolve({ status: res.statusCode, body: JSON.parse(String(text)) }),
    };
    middleware(req, res, () => resolve({ status: -1, body: undefined }));
    if (method === 'POST') {
      process.nextTick(() => {
        req.emit('data', Buffer.from(JSON.stringify(body ?? {})));
        req.emit('end');
      });
    }
  });
}

const typeYaml = [
  'typeList:',
  '  - id: demo.shelf',
  '    label: Shelf',
  '    modeList:',
  '      - { id: list, comp: ShelfList, param: { layout: table }, isDefault: true }',
  '      - { id: add, comp: ShelfAdd, category: edit }',
  '  - id: demo.shelf-special',
  '    extendList: [demo.shelf]',
  '    modeList:',
  '      - { id: list, comp: ShelfSpecialList }',
  '  - id: core.taken',
  '  - id: demo.stray',
  '    extendList: [doc.document]',
  '    modeList:',
  '      - { id: list, comp: Nope }',
  '  - id: demo.task',
  '    extendList: [core.task]',
  '  - id: demo.linked',
  '    kind: relation',
  '',
].join('\n');

test('a doc page declares types in type.yaml: modes, kinds, what is left out is reported', () => {
  const dir = fixtureCreate();
  typeYamlWrite(dir, typeYaml);
  const { typeList, problemList } = typeDeclaredOf(dir);
  assert.deepEqual(typeList.map((type) => type.id), ['demo.shelf', 'demo.shelf-special', 'demo.stray', 'demo.task', 'demo.linked']);
  assert.deepEqual(typeList[0].extendList, ['frontend.object'], 'modes: below frontend.object by default');
  assert.deepEqual(typeList[1].extendList, ['demo.shelf']);
  assert.equal(typeList[0].modeList[1].category, 'edit');
  assert.deepEqual(typeList[0].definedBy, { kind: 'docPage', alias: 'page', file: 'page/.doc-page/type.yaml' });
  // any kind of type, not only those of a frontend object
  assert.deepEqual(typeList[3].extendList, ['core.task']);
  assert.deepEqual([typeList[4].kind, typeList[4].extendList], ['relation', ['core.relation']]);
  assert.deepEqual(typeList[2].extendList, ['doc.document'], 'a parent of any tree');
  assert.equal(typeList[2].modeList, undefined, 'modes mean nothing there');
  assert.match(problemList.map((one) => one.message).join(), /the prefix "core" of core.taken is the page's own/);
  assert.match(problemList.map((one) => one.message).join(), /demo.stray has modes or kinds/);
});

test('the entry names the type files: { file }, a list, in place, or none', () => {
  const dir = fixtureCreate();
  const entryFile = path.join(dir, 'page', '.doc-page', 'entry.yaml');
  const entry = fs.readFileSync(entryFile, 'utf-8');
  fs.writeFileSync(path.join(dir, 'page', '.doc-page', 'type-a.yaml'), 'typeList:\n  - id: demo.a\n');
  fs.writeFileSync(path.join(dir, 'page', '.doc-page', 'type-b.yaml'), 'typeList:\n  - id: demo.b\n');
  typeYamlWrite(dir, 'typeList:\n  - id: demo.convention\n');
  assert.deepEqual(typeDeclaredOf(dir).typeList.map((type) => type.id), ['demo.convention']);
  fs.writeFileSync(entryFile, `${entry}type:\n  - file: ./type-a.yaml\n  - file: ./type-b.yaml\n  - typeList:\n      - id: demo.inline\n`);
  assert.deepEqual(typeDeclaredOf(dir).typeList.map((type) => type.id), ['demo.a', 'demo.b', 'demo.inline']);
  fs.writeFileSync(entryFile, `${entry}type: false\n`);
  assert.deepEqual(typeDeclaredOf(dir).typeList, []);
  fs.writeFileSync(entryFile, `${entry}type: { file: ./nowhere.yaml }\n`);
  assert.match(typeDeclaredOf(dir).problemList[0].message, /not found/);
  fs.writeFileSync(entryFile, `${entry}type: 3\n`);
  assert.throws(() => typeDeclaredOf(dir), /"type" of an entry is/);
});

test('a package declares types in type.yaml at its top; the former places are reported, not read', () => {
  const dir = fixtureCreate({ objectFrontendYaml: 'typeList:\n  - id: demo.former\n' });
  const dirPackage = path.join(dir, 'pack');
  fs.mkdirSync(path.join(dirPackage, 'doc'), { recursive: true });
  fs.writeFileSync(path.join(dirPackage, 'doc-package.yaml'), 'name: pack\ndescription: a package\npackageDependList: []\n');
  fs.writeFileSync(path.join(dirPackage, 'doc', 'README.md'), '# pack\n');
  fs.writeFileSync(path.join(dirPackage, 'type.yaml'), 'typeList:\n  - id: pack.thing\n    modeList:\n      - { id: one, comp: PackThing }\n');
  const entryFile = path.join(dir, 'page', '.doc-page', 'entry.yaml');
  fs.appendFileSync(entryFile, 'packageList:\n  - dir: ../../pack\n');
  const { typeList } = typeDeclaredOf(dir);
  assert.deepEqual(typeList.map((type) => [type.id, type.definedBy.kind, type.definedBy.name]), [['pack.thing', 'package', 'pack']]);
  assert.match(configGet(dir).docPageList[0].problemList.join(), /type\.yaml now/);
});

test('modes are inherited: the nearest declaration of an id wins, the built-in overview comes last', () => {
  const dir = fixtureCreate();
  typeYamlWrite(dir, typeYaml);
  const { typeList } = typeDeclaredOf(dir);
  const modeListByType = Object.fromEntries(typeList.map((type) => [type.id, type.modeList]));
  const modeList = objectFrontendModeListResolve('demo.shelf-special', ['demo.shelf', 'frontend.object', 'core.collection'], modeListByType);
  assert.deepEqual(modeList.map((mode) => `${mode.id}:${mode.comp}`), [
    'list:ShelfSpecialList', 'add:ShelfAdd', 'overview:common/ObjectFrontendOverview',
  ]);
  // the default: the nearest marked isDefault (list of demo.shelf is hidden), else the first
  assert.equal(objectFrontendModeChoose(modeList, '').id, 'list');
  assert.equal(objectFrontendModeChoose(modeList, 'add').comp, 'ShelfAdd');
  assert.equal(objectFrontendModeChoose(modeList, 'nope'), undefined);
});

test('the block of the entry component reads and writes object, mode and param', () => {
  const read = objectFrontendBlockRead('object: frontend:w5a\nmode: list\nparam:\n  status: read\n');
  assert.deepEqual(read, { object: 'frontend:w5a', mode: 'list', param: { status: 'read' }, message: '' });
  assert.equal(objectFrontendBlockTextBuild({ object: 'frontend:w5a', mode: '', param: {} }), 'object: frontend:w5a\n');
  assert.match(objectFrontendBlockRead('param: 3').message, /param is a mapping/);
});

const storeOf = (dir) => assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
const objectFolderOf = (dir, dirName) => path.join(dir, 'page', '.doc-page', 'object-frontend', dirName);

test('create: a folder of its own, the entry asset in item/, and object.yaml beside it', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'My shelf' });
  assert.equal(created.body.code, 0, created.body.message);
  const { id, itemList, config } = created.body.data;
  const entry = itemList[0];
  assert.equal(entry.groupPath, '');
  assert.deepEqual(entry.owner, { ref: `frontend:${id}`, role: 'entry' });
  const dirObject = objectFolderOf(dir, `${id}--My shelf`);
  assert.ok(fs.existsSync(path.join(dirObject, 'item', entry.itemId, 'item.yaml')));
  assert.deepEqual(yamlParse(fs.readFileSync(path.join(dirObject, 'object.yaml'), 'utf-8')), { id, entry: entry.itemId });
  assert.equal(fs.existsSync(path.join(dir, 'page', '.doc-page', 'object-frontend.yaml')), false, 'no line is written for it');
  assert.deepEqual(config.docPageList[0].objectList.map((one) => [one.id, one.dir]), [[id, `page/.doc-page/object-frontend/${id}--My shelf`]]);

  // the store reads the item folder of the object like its other folders
  const folderOwned = storeOf(dir).folderInfoList().find((folder) => folder.owner);
  assert.deepEqual(folderOwned.owner, { ref: `frontend:${id}` });
  assert.equal(folderOwned.path, `~page:docs/.doc-page/object-frontend/${id}--My shelf/item`);
  assert.equal(folderOwned.itemCount, 1);
  assert.equal(folderOwned.isDefault, false);

  // an asset of the object: in its item folder, declaring it, recorded in an item list
  const asset = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', text: 'title: Dune\n' });
  assert.equal(asset.body.code, 0, asset.body.message);
  assert.equal(asset.body.data.key, 'book-1');
  const assetMeta = storeOf(dir).itemGet(asset.body.data.itemId);
  assert.equal(assetMeta.folder, folderOwned.path);
  assert.deepEqual(assetMeta.owner, { ref: `frontend:${id}` });
  assert.deepEqual(recordListOf(dir, id), [{ key: 'book-1', kind: 'book', itemId: assetMeta.itemId, listGroupPath: '' }]);
  assert.ok(fs.existsSync(path.join(dirObject, 'item', 'item-list.yaml')), 'an asset at the top is recorded in the list at the top');
  assert.equal(objectFrontendEntryParse(storeOf(dir).versionDataGet(entry.itemId).text).entry.assetList.length, 0, 'the entry lists nothing');

  // a new name renames the folder of the object with everything in it, and the answer says where the items are now
  const renamed = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/meta/set', { id, name: 'Shelf two' });
  assert.equal(renamed.body.code, 0, renamed.body.message);
  assert.equal(fs.existsSync(dirObject), false);
  const folderRenamed = `~page:docs/.doc-page/object-frontend/${id}--Shelf two/item`;
  assert.equal(storeOf(dir).itemGet(asset.body.data.itemId).folder, folderRenamed);
  assert.ok(renamed.body.data.itemList.every((one) => one.folder === folderRenamed));
  assert.equal(objectFrontendEntryParse(storeOf(dir).versionDataGet(entry.itemId).text).entry.name, 'Shelf two');

  // removed with its asset kept: released to the default asset folder of the doc page
  const removed = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/remove', { id, key: 'book-1', isAssetKept: true });
  assert.equal(removed.body.code, 0, removed.body.message);
  const released = storeOf(dir).itemGet(asset.body.data.itemId);
  assert.equal(released.folder, '~page:docs/.doc-page/asset');
  assert.equal(released.owner, undefined);

  // attached again: its owner set, moved back into the item folder of the object
  const attached = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/attach', { id, itemId: released.itemId, kind: 'book' });
  assert.equal(attached.body.code, 0, attached.body.message);
  assert.equal(storeOf(dir).itemGet(released.itemId).folder, folderRenamed);

  // deleted: the folder stays and says so, its assets are deleted softly and stay findable
  const deleted = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/delete', { id });
  assert.equal(deleted.body.code, 0, deleted.body.message);
  assert.deepEqual(deleted.body.data.config.docPageList[0].objectList, []);
  assert.deepEqual(deleted.body.data.config.docPageList[0].objectIdDeletedList, [id]);
  assert.equal(yamlParse(fs.readFileSync(path.join(objectFolderOf(dir, `${id}--Shelf two`), 'object.yaml'), 'utf-8')).isDeleted, true);
  assert.equal(storeOf(dir).itemGet(entry.itemId).isDeleted, true);
});

test('an object deleted with its assets kept is an orphan entry, and listed again', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Kept' });
  const { id, itemList } = created.body.data;
  const deleted = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/delete', { id, isAssetKept: true });
  assert.equal(deleted.body.code, 0, deleted.body.message);
  assert.equal(storeOf(dir).itemGet(itemList[0].itemId).isDeleted, false);
  const registered = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/register', { docPageAlias: 'page', entry: itemList[0].itemId });
  assert.equal(registered.body.code, 0, registered.body.message);
  assert.deepEqual(registered.body.data.config.docPageList[0].objectList.map((one) => one.id), [id]);
  assert.equal(yamlParse(fs.readFileSync(path.join(objectFolderOf(dir, `${id}--Kept`), 'object.yaml'), 'utf-8')).isDeleted, undefined);
});

test('a folder copied into another doc page is the object there: nothing else names it', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Portable' });
  const { id, itemList } = created.body.data;
  await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', text: 'title: Dune\n' });
  const dirOther = fixtureCreate();
  const dirTarget = objectFolderOf(dirOther, `${id}--Portable`);
  fs.mkdirSync(path.dirname(dirTarget), { recursive: true });
  fs.cpSync(objectFolderOf(dir, `${id}--Portable`), dirTarget, { recursive: true });
  const store = storeOf(dirOther);
  assert.equal(store.itemGet(itemList[0].itemId).owner.ref, `frontend:${id}`);
  assert.equal(store.itemList().length, 2);
  assert.deepEqual(configGet(dirOther).docPageList[0].objectList.map((one) => one.id), [id]);
});

test('type.yaml beside object.yaml travels with the object; a bad folder is reported, not fatal', () => {
  const dir = fixtureCreate();
  const dirObject = objectFolderOf(dir, 'w5aaaaaaaaa--Typed');
  fs.mkdirSync(path.join(dirObject, 'item'), { recursive: true });
  fs.writeFileSync(path.join(dirObject, 'object.yaml'), 'id: w5aaaaaaaaa\nentry: w5aaaaaaaab\n');
  fs.writeFileSync(path.join(dirObject, 'type.yaml'), 'typeList:\n  - id: demo.carried\n    modeList:\n      - { id: list, comp: CarriedList }\n');
  fs.mkdirSync(objectFolderOf(dir, 'notes'), { recursive: true });
  const dirWrong = objectFolderOf(dir, 'w5aaaaaaaac--Wrong');
  fs.mkdirSync(dirWrong, { recursive: true });
  fs.writeFileSync(path.join(dirWrong, 'object.yaml'), 'id: w5aaaaaaaad\nentry: w5aaaaaaaae\n');
  assert.deepEqual(typeDeclaredOf(dir).typeList.map((type) => [type.id, type.definedBy.file]), [['demo.carried', 'page/.doc-page/object-frontend/w5aaaaaaaaa--Typed/type.yaml']]);
  const docPage = configGet(dir).docPageList[0];
  assert.deepEqual(docPage.objectList.map((one) => one.id), ['w5aaaaaaaaa']);
  assert.ok(docPage.problemList.some((text) => text.includes('notes') && text.includes('object.yaml')));
  assert.ok(docPage.problemList.some((text) => text.includes('another id')));
});

test('folderList of the doc page\'s file names where its object folders are', async () => {
  const dir = fixtureCreate({ objectFrontendYaml: 'folderList:\n  - ../object-kept\n' });
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Elsewhere' });
  assert.equal(created.body.code, 0, created.body.message);
  const { id, itemList } = created.body.data;
  assert.ok(fs.existsSync(path.join(dir, 'page', 'object-kept', `${id}--Elsewhere`, 'object.yaml')));
  assert.equal(itemList[0].folder, `~page:docs/object-kept/${id}--Elsewhere/item`);
});

test('an object listed in objectList keeps its assets in a group of the asset folder', async () => {
  const dir = fixtureCreate();
  const store = storeOf(dir);
  const id = 'w5aaaaaaaaa';
  const { item: entry } = store.itemCreate({
    lang: 'yaml', data: Buffer.from('name: Listed\ntype: frontend.object\nassetList: []\n'), groupPath: `${id}--Listed`, owner: { ref: `frontend:${id}`, role: 'entry' },
  });
  fs.writeFileSync(path.join(dir, 'page', '.doc-page', 'object-frontend.yaml'), `objectList:\n  - id: ${id}\n    entry: ${entry.itemId}\n`);
  const middleware = middlewareCreate(dir);
  const asset = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', text: 'title: Dune\n' });
  assert.equal(asset.body.code, 0, asset.body.message);
  assert.equal(storeOf(dir).itemGet(asset.body.data.itemId).groupPath, `${id}--Listed`);
  const renamed = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/meta/set', { id, name: 'Renamed' });
  assert.equal(renamed.body.code, 0, renamed.body.message);
  assert.equal(storeOf(dir).itemGet(asset.body.data.itemId).groupPath, `${id}--Renamed`);
  const deleted = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/delete', { id });
  assert.equal(deleted.body.code, 0, deleted.body.message);
  assert.deepEqual(yamlParse(fs.readFileSync(path.join(dir, 'page', '.doc-page', 'object-frontend.yaml'), 'utf-8')).objectList, []);
});

test('the yaml file keeps its comments when an orphan entry gets its line', async () => {
  const dir = fixtureCreate({ objectFrontendYaml: `# my objects\nobjectList:\n  # the first\n  - id: w5aaaaaaaaa\n    entry: w5aaaaaaaab\n` });
  const middleware = middlewareCreate(dir);
  const { item: entry } = storeOf(dir).itemCreate({ lang: 'yaml', data: Buffer.from('name: Lost\n'), owner: { ref: 'frontend:w5aaaaaaaac', role: 'entry' } });
  const registered = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/register', { docPageAlias: 'page', entry: entry.itemId });
  assert.equal(registered.body.code, 0, registered.body.message);
  const text = fs.readFileSync(path.join(dir, 'page', '.doc-page', 'object-frontend.yaml'), 'utf-8');
  assert.ok(text.startsWith('# my objects\nobjectList:'));
  assert.ok(text.includes('  # the first\n  - id: w5aaaaaaaaa\n    entry: w5aaaaaaaab\n  - id: w5aaaaaaaac'));
  // an unknown type is refused
  const refused = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'demo.nope', name: 'x' });
  assert.equal(refused.body.code, -1);
});

test('group folders: an item is found at any depth, moved between groups, and a group moved whole', () => {
  const dir = fixtureCreate();
  const store = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
  const { item: object } = store.itemCreate({ lang: 'yaml', data: Buffer.from('a: 1\n'), groupPath: 'one/two', name: 'deep' });
  assert.equal(object.dirName, `one/two/${object.itemId}--deep`);
  const storeAgain = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
  assert.equal(storeAgain.itemGetByName('deep').groupPath, 'one/two');
  storeAgain.itemMetaSet(object.itemId, { name: 'deeper' });
  assert.equal(storeAgain.itemGet(object.itemId).dirName, `one/two/${object.itemId}--deeper`);
  storeAgain.itemMove(object.itemId, { groupPath: '' });
  const folderAbs = path.join(dir, 'page', '.doc-page', 'asset');
  assert.equal(fs.existsSync(path.join(folderAbs, 'one')), false, 'the empty groups are removed');
  storeAgain.itemMove(object.itemId, { groupPath: 'g' });
  storeAgain.groupMove(storeAgain.folderList[0].path, 'g', 'h/i');
  assert.equal(storeAgain.itemGet(object.itemId).groupPath, 'h/i');
  assert.throws(() => storeAgain.itemMove(object.itemId, { groupPath: '../x' }), /not a group folder name/);
});

test('the paths of assets are read as os paths; the folders they imply complete a typed path, folder by folder', () => {
  assert.deepEqual(objectFrontendAssetPathNormalize('book//sci-fi/./x/../dune/'), { path: '/book/sci-fi/dune', message: '' });
  assert.match(objectFrontendAssetPathNormalize('/a/../..').message, /above the root/);
  assert.match(objectFrontendAssetPathNormalize('/').message, /names no asset/);
  assert.equal(objectFrontendAssetPathBuild('author', 'Ursula K. Le Guin', 'The Left Hand'), '/author/ursula-k-le-guin/the-left-hand');
  const assetList = [
    { key: 'book-1', kind: 'book', itemId: 'w1', name: 'Dune', pathList: ['/book/sci-fi/dune', '/author/frank-herbert/dune'], status: 'found' },
    { key: 'book-2', kind: 'book', itemId: 'w2', name: 'Solaris', pathList: ['/book/sci-fi/solaris', '/book/sci-fi/dune'], status: 'missing' },
    { key: 'note-1', kind: 'note', itemId: 'w3', name: 'Dune, again', pathList: ['/note/dune/1'], status: 'found' },
  ];
  const index = objectFrontendAssetIndexBuild(assetList);
  // a path claimed twice names the first, and is reported
  assert.equal(index.byPath.get('/book/sci-fi/dune').key, 'book-1');
  assert.equal(index.problemList.length, 1);
  assert.deepEqual(objectFrontendAssetPathComplete(index, '/').map((item) => `${item.kind}:${item.path}:${item.assetCount}`), ['folder:/author:1', 'folder:/book:2', 'folder:/note:1']);
  assert.deepEqual(objectFrontendAssetPathComplete(index, '/book/sci-fi/so').map((item) => item.path), ['/book/sci-fi/solaris']);
  assert.deepEqual(objectFrontendAssetPathComplete(index, 'sci-fi/', { base: '/book' }).map((item) => item.path), ['/book/sci-fi/dune', '/book/sci-fi/solaris']);
  assert.deepEqual(objectFrontendAssetPathComplete(index, '/', { kindList: ['note'] }).map((item) => item.path), ['/note']);
  // every form of a reference; an asset the store lacks says so, a folder is no asset
  assert.equal(objectFrontendAssetRefResolve(index, '/author/frank-herbert/dune').asset.key, 'book-1');
  assert.equal(objectFrontendAssetRefResolve(index, 'key:note-1').asset.key, 'note-1');
  assert.equal(objectFrontendAssetRefResolve(index, 'id:w3').asset.key, 'note-1');
  assert.equal(objectFrontendAssetRefResolve(index, 'name:Dune').asset.key, 'book-1');
  const missing = objectFrontendAssetRefResolve(index, '/book/sci-fi/solaris');
  assert.equal(missing.status, 'missing');
  assert.equal(missing.asset.key, 'book-2');
  assert.match(objectFrontendAssetRefResolve(index, '/book/sci-fi').message, /a folder of the object/);
  assert.equal(objectFrontendAssetRefResolve(index, '/book/nope').status, 'unknown');
  // words in any order, narrowed by a key; the best first, the path the words matched
  assert.deepEqual(objectFrontendAssetSearch(assetList, 'herbert').hitList.map((hit) => [hit.asset.key, hit.pathMatched]), [['book-1', '/author/frank-herbert/dune']]);
  assert.deepEqual(objectFrontendAssetSearch(assetList, 'dune').hitList.map((hit) => hit.asset.key), ['book-1', 'note-1', 'book-2']);
  assert.deepEqual(objectFrontendAssetSearch(assetList, 'kind:note dune').hitList.map((hit) => hit.asset.key), ['note-1']);
  assert.deepEqual(objectFrontendAssetSearch(assetList, 'path:/book sol').hitList.map((hit) => hit.asset.key), ['book-2']);
});

test('the names and paths of assets are written into their records; a path another asset has is refused', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Shelf' });
  const { id, itemList } = created.body.data;
  const asset = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', name: 'Dune', pathList: ['book//sci-fi/dune', '/author/frank-herbert/dune'], text: 'a: 1\n' });
  assert.equal(asset.body.code, 0, asset.body.message);
  const taken = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', pathList: ['/book/sci-fi/dune'], text: 'b: 1\n' });
  assert.equal(taken.body.code, -1);
  assert.match(taken.body.message, /is the path of Dune/);
  const metaSet = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/meta/set', { id, key: 'book-1', name: null, pathList: ['/book/classic/dune'] });
  assert.equal(metaSet.body.code, 0, metaSet.body.message);
  assert.deepEqual(recordListOf(dir, id)[0], { key: 'book-1', kind: 'book', itemId: asset.body.data.itemId, pathList: ['/book/classic/dune'], listGroupPath: '' });
  const bad = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/meta/set', { id, key: 'book-1', pathList: ['/..'] });
  assert.match(bad.body.message, /above the root/);
  // a pattern is kept as written, canonical; a path it stands for that another asset has is refused
  const pattern = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/meta/set', { id, key: 'book-1', pathList: ['book/{classic/frank-herbert/}dune'] });
  assert.equal(pattern.body.code, 0, pattern.body.message);
  assert.deepEqual(recordListOf(dir, id)[0].pathList, ['/book/{classic/frank-herbert/}dune']);
  const crossing = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', pathList: ['/book/[frank-herbert/classic/, new/]dune'], text: 'c: 1\n' });
  assert.equal(crossing.body.code, -1);
  assert.match(crossing.body.message, /the path \/book\/frank-herbert\/classic\/dune \(one of those .* stands for\) is the path of book-1/);
  const unclosed = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/meta/set', { id, key: 'book-1', pathList: ['/book/{a, b'] });
  assert.match(unclosed.body.message, /not closed/);
});

test('a path pattern indexes an asset under every path it stands for', () => {
  const assetList = [
    { key: 'book-1', kind: 'book', itemId: 'w1', name: 'Dune', pathList: ['/book/{sci-fi/frank-herbert/}dune'], status: 'found' },
    { key: 'book-2', kind: 'book', itemId: 'w2', name: 'Solaris', pathList: ['/book/sci-fi/[solaris, lem]'], status: 'found' },
  ];
  const index = objectFrontendAssetIndexBuild(assetList);
  assert.equal(index.problemList.length, 0);
  assert.equal(objectFrontendAssetRefResolve(index, '/book/frank-herbert/sci-fi/dune').asset.key, 'book-1');
  assert.equal(objectFrontendAssetRefResolve(index, '/book/sci-fi/lem').asset.key, 'book-2');
  // a reference written as a pattern names the asset all its paths name
  assert.equal(objectFrontendAssetRefResolve(index, '/book/{sci-fi/frank-herbert/}dune').asset.key, 'book-1');
  assert.match(objectFrontendAssetRefResolve(index, '/book/sci-fi/[lem, dune]').message, /several assets/);
  assert.deepEqual(objectFrontendAssetPathComplete(index, '/book/').map((item) => `${item.kind}:${item.path}:${item.assetCount}`), ['folder:/book/frank-herbert:1', 'folder:/book/sci-fi:2']);
  assert.deepEqual(objectFrontendAssetSearch(assetList, 'path:/book/frank').hitList.map((hit) => [hit.asset.key, hit.pathMatched]), [['book-1', '/book/frank-herbert/sci-fi/dune']]);
  assert.deepEqual(objectFrontendAssetPathListParse('/a/[b, c], /d').pathList, ['/a/[b, c]', '/d']);
  assert.equal(objectFrontendAssetAcceptCheck([{ id: 'book', pathPrefix: '/book/' }], { kind: 'book', pathList: ['/[book/, shelf/]x'] }).message, '');
});

test('a folder name holds ASCII only, whatever the name is', () => {
  assert.equal(itemDirNameBuild('w5abc', 'My shelf'), 'w5abc--My shelf');
  assert.equal(itemDirNameBuild('w5abc', ''), 'w5abc');
  assert.equal(itemDirNameBuild('w5abc', '\u55b6\u696d'), 'w5abc');
  assert.equal(itemDirNameBuild('w5abc', '\u55b6\u696d report 2'), 'w5abc--report 2');
  assert.equal(itemDirNameBuild('w5abc', 'a\u55b6\u696db'), 'w5abc--a-b');
  // a group with no ASCII in its name is named after its type
  assert.equal(objectFrontendDirNameBuild('w5abc', '\u55b6\u696d', 'db-migration.project'), 'w5abc--db-migration.project');
  assert.equal(objectFrontendDirNameBuild('w5abc', 'Shelf', 'db-migration.project'), 'w5abc--Shelf');
});

test('an object named in any language keeps its name, and its folders are in ASCII', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const nameFirst = 'データベース移行';
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: nameFirst });
  assert.equal(created.body.code, 0, created.body.message);
  const { id, itemList } = created.body.data;
  const entry = itemList[0];
  assert.ok(fs.existsSync(objectFolderOf(dir, `${id}--frontend.object`)));
  assert.equal(objectFrontendEntryParse(storeOf(dir).versionDataGet(entry.itemId).text).entry.name, nameFirst);

  // another name in the same script: the folder stays
  const renamed = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/meta/set', { id, name: '移行' });
  assert.equal(renamed.body.code, 0, renamed.body.message);
  assert.ok(fs.existsSync(objectFolderOf(dir, `${id}--frontend.object`)));
  assert.equal(objectFrontendEntryParse(storeOf(dir).versionDataGet(entry.itemId).text).entry.name, '移行');

  // nothing on disk but ASCII
  const pathList = fs.readdirSync(path.join(dir, 'page', '.doc-page', 'object-frontend'), { recursive: true });
  assert.ok(pathList.length > 0);
  assert.ok(pathList.every((one) => /^[\x20-\x7E]*$/.test(one)), pathList.join(', '));
});

test('an object in a folder named before the rule is still read', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Shelf' });
  const { id, itemList } = created.body.data;
  const dirOld = objectFolderOf(dir, `${id}--移行`);
  fs.renameSync(objectFolderOf(dir, `${id}--Shelf`), dirOld);
  assert.equal(storeOf(dir).itemGet(itemList[0].itemId).folder, `~page:docs/.doc-page/object-frontend/${id}--移行/item`);
});

const statusOf = (dir) => assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));

test('an item says where it was found: folderOwner, read from the folder, not written', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Shelf' });
  const { id, itemList } = created.body.data;
  const ref = `frontend:${id}`;
  assert.deepEqual(itemList[0].folderOwner, { ref });
  assert.deepEqual(statusOf(dir).itemGet(itemList[0].itemId).folderOwner, { ref });
  const itemFile = path.join(objectFolderOf(dir, `${id}--Shelf`), 'item', itemList[0].itemId, 'item.yaml');
  assert.equal(yamlParse(fs.readFileSync(itemFile, 'utf-8')).folderOwner, undefined);
  const plain = statusOf(dir).itemCreate({ lang: 'yaml', data: Buffer.from('a: 1\n') }).item;
  assert.equal(plain.folderOwner, undefined);
});

test('the place of an item in a folder an object owns is its layer\'s: -5 for anyone else', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Shelf' });
  const { id } = created.body.data;
  const asset = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', text: 'a: 1\n' });
  const folderOwned = statusOf(dir).folderList.find((one) => one.owner).path;
  const plain = statusOf(dir).itemCreate({ lang: 'yaml', data: Buffer.from('b: 1\n') }).item;
  const moveIn = await requestRun(middleware, 'POST', '/__doc-asset/item/move', { store: 'local', itemId: plain.itemId, folder: folderOwned, groupPath: '' });
  assert.equal(moveIn.body.code, -5);
  assert.equal(moveIn.status, 409);
  assert.equal(statusOf(dir).itemGet(plain.itemId).folderOwner, undefined, 'nothing moved');
  const moveOut = await requestRun(middleware, 'POST', '/__doc-asset/item/move', { store: 'local', itemId: asset.body.data.itemId, folder: '~page:docs/.doc-page/asset', groupPath: '' });
  assert.equal(moveOut.body.code, -5);
  const moveInside = await requestRun(middleware, 'POST', '/__doc-asset/item/move', { store: 'local', itemId: asset.body.data.itemId, groupPath: 'a' });
  assert.equal(moveInside.body.code, -5);
  const create = await requestRun(middleware, 'POST', '/__doc-asset/item/create', { store: 'local', lang: 'yaml', text: 'c: 1\n', folder: folderOwned });
  assert.equal(create.body.code, -5);
  // the data of an item is not a place: an ordinary write
  const store = statusOf(dir);
  const head = store.versionDataGet(asset.body.data.itemId);
  const write = await requestRun(middleware, 'POST', '/__doc-asset/item/update', { store: 'local', itemId: asset.body.data.itemId, hashBase: head.hash, text: 'a: 2\n' });
  assert.equal(write.body.code, 0, write.body.message);
});

test('an item moves between folders of the store through the asset api, and the move is recorded', async () => {
  const dir = fixtureCreate();
  const dirPage = path.join(dir, 'page', '.doc-page');
  fs.writeFileSync(path.join(dirPage, 'asset.yaml'), 'folderList:\n  - ~docs/.doc-page/asset\n  - ~docs/archive\nfolderDefault: ~docs/.doc-page/asset\n');
  const middleware = middlewareCreate(dir);
  const { item } = statusOf(dir).itemCreate({ lang: 'yaml', name: 'moved', data: Buffer.from('a: 1\n'), groupPath: 'one' });
  const moved = await requestRun(middleware, 'POST', '/__doc-asset/item/move', { store: 'local', itemId: item.itemId, folder: '~page:docs/archive', groupPath: 'two/three' });
  assert.equal(moved.body.code, 0, moved.body.message);
  assert.equal(moved.body.data.item.folder, '~page:docs/archive');
  assert.equal(moved.body.data.item.dirName, `two/three/${item.itemId}--moved`);
  const store = statusOf(dir);
  assert.equal(store.itemGetByName('moved').groupPath, 'two/three');
  assert.equal(store.versionDataGet(item.itemId).text, 'a: 1\n');
  const eventLast = store.itemGet(item.itemId).eventList.at(-1);
  assert.deepEqual([eventLast.eventType, eventLast.placeFrom, eventLast.placeTo], ['move', '~page:docs/.doc-page/asset/one', '~page:docs/archive/two/three']);
  assert.equal(fs.existsSync(path.join(dirPage, 'asset', 'one')), false, 'the group it left is gone');
  const notThere = await requestRun(middleware, 'POST', '/__doc-asset/item/move', { store: 'local', itemId: item.itemId, folder: '~page:docs/nowhere', groupPath: '' });
  assert.equal(notThere.body.code, -3);
  store.itemLockSet(item.itemId, true);
  const locked = await requestRun(middleware, 'POST', '/__doc-asset/item/move', { store: 'local', itemId: item.itemId, folder: '~page:docs/.doc-page/asset', groupPath: '' });
  assert.notEqual(locked.body.code, 0);
});

const typeKindYaml = [
  'typeList:',
  '  - id: demo.shelf',
  '    assetKindList:',
  '      - { id: book, langList: [yaml], pathPrefix: /book/, groupPath: book }',
  '      - { id: cover, langList: [png], isIncomingRefused: true }',
  '  - id: demo.shelf-special',
  '    extendList: [demo.shelf]',
  '  - id: demo.one',
  '    assetKindList:',
  '      - { id: only }',
  '',
].join('\n');

test('a type says what it accepts; the write stops before anything is written', async () => {
  const dir = fixtureCreate();
  typeYamlWrite(dir, typeKindYaml);
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'demo.shelf-special', name: 'Shelf' });
  assert.equal(created.body.code, 0, created.body.message);
  const { id } = created.body.data;
  const post = (route, body) => requestRun(middleware, 'POST', `/__doc-asset/object-frontend/${route}`, { id, ...body });
  // inherited from demo.shelf
  assert.match((await post('asset/create', { kind: 'magazine', text: 'a: 1\n' })).body.message, /holds no asset of the kind magazine/);
  assert.match((await post('asset/create', { text: 'a: 1\n' })).body.message, /say the kind/);
  assert.match((await post('asset/create', { kind: 'book', lang: 'md', text: '# a\n' })).body.message, /is in yaml/);
  assert.match((await post('asset/create', { kind: 'book', pathList: ['/note/a'], text: 'a: 1\n' })).body.message, /starts with \/book\//);
  const made = await post('asset/create', { kind: 'book', pathList: ['/book/a'], text: 'a: 1\n' });
  assert.equal(made.body.code, 0, made.body.message);
  // the folder of its kind, unless the write names one
  assert.equal(statusOf(dir).itemGet(made.body.data.itemId).groupPath, 'book');
  const named = await post('asset/create', { kind: 'book', groupPath: 'sci-fi/old', text: 'a: 1\n' });
  assert.equal(statusOf(dir).itemGet(named.body.data.itemId).groupPath, 'sci-fi/old');
  // what comes in
  const store = statusOf(dir);
  const plain = store.itemCreate({ lang: 'yaml', data: Buffer.from('a: 1\n') }).item;
  assert.match((await post('asset/attach', { itemId: plain.itemId, kind: 'magazine' })).body.message, /holds no asset/);
  const cover = store.itemCreate({ lang: 'png', data: Buffer.from('x') }).item;
  assert.match((await post('asset/attach', { itemId: cover.itemId, kind: 'cover' })).body.message, /made by the modes/);
  assert.equal(statusOf(dir).itemGet(plain.itemId).owner, undefined, 'nothing was written');
  const attached = await post('asset/attach', { itemId: plain.itemId, kind: 'book' });
  assert.equal(attached.body.code, 0, attached.body.message);
  const inside = statusOf(dir).itemGet(plain.itemId);
  assert.deepEqual([inside.folderOwner.ref, inside.owner.ref, inside.groupPath], [`frontend:${id}`, `frontend:${id}`, 'book']);
  // one kind only: it need not be said
  const one = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'demo.one', name: 'One' });
  const madeOne = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id: one.body.data.id, text: 'a: 1\n' });
  assert.equal(madeOne.body.data.key, 'only-1');
});

test('an item dropped into the folder by hand is no asset until adopted, and can be sent away', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Shelf' });
  const { id, itemList } = created.body.data;
  const ref = `frontend:${id}`;
  // made elsewhere, then moved by hand, deep inside: the store finds it, nothing lists it
  const dropped = statusOf(dir).itemCreate({ lang: 'yaml', data: Buffer.from('a: 1\n') }).item;
  const dirItem = path.join(objectFolderOf(dir, `${id}--Shelf`), 'item');
  fs.mkdirSync(path.join(dirItem, 'deep', 'er'), { recursive: true });
  fs.renameSync(path.join(dir, 'page', '.doc-page', 'asset', dropped.itemId), path.join(dirItem, 'deep', 'er', dropped.itemId));
  const found = statusOf(dir).itemGet(dropped.itemId);
  assert.deepEqual([found.folderOwner.ref, found.owner, found.groupPath], [ref, undefined, 'deep/er']);
  assert.deepEqual(recordListOf(dir, id), []);
  // adopted: it keeps its place, declares the object, is listed
  const adopted = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/attach', { id, itemId: dropped.itemId, kind: 'book' });
  assert.equal(adopted.body.code, 0, adopted.body.message);
  const inFolder = statusOf(dir).itemGet(dropped.itemId);
  assert.deepEqual([inFolder.owner.ref, inFolder.groupPath], [ref, 'deep/er']);
  // another one sent away: it leaves the folder, nothing else changes
  const second = statusOf(dir).itemCreate({ lang: 'yaml', data: Buffer.from('b: 1\n') }).item;
  fs.renameSync(path.join(dir, 'page', '.doc-page', 'asset', second.itemId), path.join(dirItem, second.itemId));
  const sent = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/remove', { id, itemId: second.itemId, isAssetKept: true });
  assert.equal(sent.body.code, 0, sent.body.message);
  const away = statusOf(dir).itemGet(second.itemId);
  assert.deepEqual([away.folder, away.folderOwner, away.owner], ['~page:docs/.doc-page/asset', undefined, undefined]);
  // the entry does not leave
  const refused = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/remove', { id, itemId: itemList[0].itemId, isAssetKept: true });
  assert.equal(refused.body.code, -1);
});

test('the folders inside an object are a place on disk: its keys and paths do not depend on them', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Shelf' });
  const { id, itemList } = created.body.data;
  const post = (route, body) => requestRun(middleware, 'POST', `/__doc-asset/object-frontend/${route}`, { id, ...body });
  const made = await post('asset/create', { kind: 'book', key: 'dune', pathList: ['/book/dune'], text: 'a: 1\n' });
  const itemId = made.body.data.itemId;
  const moved = await post('asset/move', { key: 'dune', groupPath: 'a/b' });
  assert.equal(moved.body.code, 0, moved.body.message);
  assert.equal(statusOf(dir).itemGet(itemId).groupPath, 'a/b');
  const entryOf = () => recordListOf(dir, id)[0];
  assert.deepEqual(entryOf().pathList, ['/book/dune']);
  const grouped = await post('asset/group/move', { groupFrom: 'a', groupTo: 'c/d' });
  assert.equal(grouped.body.code, 0, grouped.body.message);
  assert.equal(statusOf(dir).itemGet(itemId).groupPath, 'c/d/b');
  assert.ok(grouped.body.data.itemList.some((one) => one.itemId === itemId && one.groupPath === 'c/d/b'));
  assert.equal(fs.existsSync(path.join(objectFolderOf(dir, `${id}--Shelf`), 'item', 'a')), false);
  assert.deepEqual(entryOf().pathList, ['/book/dune']);
  // the other way: another path moves nothing on disk
  await post('asset/meta/set', { key: 'dune', pathList: ['/novel/dune'] });
  assert.equal(statusOf(dir).itemGet(itemId).groupPath, 'c/d/b');
  assert.match((await post('asset/move', { key: 'dune', groupPath: '営業' })).body.message, /ASCII/);
  // a listed asset lying elsewhere comes home
  const store = statusOf(dir);
  const plain = store.itemCreate({ lang: 'yaml', data: Buffer.from('b: 1\n') }).item;
  const attached = await post('asset/attach', { itemId: plain.itemId, kind: 'book', key: 'two' });
  statusOf(dir).itemMove(plain.itemId, { folder: '~page:docs/.doc-page/asset', groupPath: '', asLayer: 'frontend' });
  assert.equal(attached.body.code, 0);
  assert.equal(statusOf(dir).itemGet(plain.itemId).folderOwner, undefined);
  await post('asset/move', { key: 'two' });
  assert.equal(statusOf(dir).itemGet(plain.itemId).folderOwner.ref, `frontend:${id}`);
});

test('an item goes from one object to another only when asked, off the first list', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const first = (await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'First' })).body.data;
  const second = (await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Second' })).body.data;
  const made = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id: first.id, kind: 'book', text: 'a: 1\n' });
  const itemId = made.body.data.itemId;
  const refused = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/attach', { id: second.id, itemId, kind: 'book' });
  assert.match(refused.body.message, /belongs to/);
  const taken = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/attach', { id: second.id, itemId, kind: 'book', isOwnerReplaced: true });
  assert.equal(taken.body.code, 0, taken.body.message);
  const moved = statusOf(dir).itemGet(itemId);
  assert.deepEqual([moved.owner.ref, moved.folderOwner.ref], [`frontend:${second.id}`, `frontend:${second.id}`]);
  assert.deepEqual(recordListOf(dir, first.id), []);
  const entryRefused = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/attach', { id: second.id, itemId: first.itemList[0].itemId, isOwnerReplaced: true });
  assert.match(entryRefused.body.message, /the entry of/);
});

test('the same type carried by two objects is one type; a different one is a problem', () => {
  const dir = fixtureCreate();
  const write = (id, label) => {
    fs.mkdirSync(objectFolderOf(dir, id), { recursive: true });
    fs.writeFileSync(path.join(objectFolderOf(dir, id), 'object.yaml'), `id: ${id}\nentry: ${id.slice(0, -1)}z\n`);
    fs.writeFileSync(path.join(objectFolderOf(dir, id), 'type.yaml'), `typeList:\n  - id: demo.carried\n    label: ${label}\n`);
  };
  write('w5aaaaaaaaa', 'Same');
  write('w5aaaaaaaab', 'Same');
  assert.deepEqual(typeDeclaredOf(dir).problemList, []);
  write('w5aaaaaaaac', 'Other');
  const { problemList, typeList } = typeDeclaredOf(dir);
  assert.equal(typeList.length, 1);
  assert.match(problemList.map((one) => one.message).join(), /declared already, otherwise/);
});

test('item lists: a record goes to the list nearest to its item, a folder without one gets its own, and a folder removed takes its records along', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const { id } = (await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Profile' })).body.data;
  const post = (route, body) => requestRun(middleware, 'POST', `/__doc-asset/object-frontend/${route}`, { id, ...body });
  const dirItem = path.join(objectFolderOf(dir, `${id}--Profile`), 'item');
  const listOf = (groupPath) => recordListOf(dir, id).filter((one) => one.listGroupPath === groupPath).map((one) => one.key);
  // two partitions, as an object keeps an example and real data: each folder gets a list of its own
  assert.equal((await post('asset/create', { key: 'ex-name', groupPath: 'example/info', pathList: ['/example/info/name'], text: 'a: 1\n' })).body.code, 0);
  assert.equal((await post('asset/create', { key: 'real-name', groupPath: 'real/info', pathList: ['/real/info/name'], text: 'b: 1\n' })).body.code, 0);
  assert.deepEqual([listOf('example'), listOf('real')], [['ex-name'], ['real-name']]);
  assert.equal(fs.existsSync(path.join(dirItem, 'item-list.yaml')), false, 'nothing is recorded at the top');
  // inside a set, the nearest list above: a folder below with a list of its own takes its items
  fs.writeFileSync(path.join(dirItem, 'example', 'info', 'item-list.yaml'), 'assetList: []\n');
  assert.equal((await post('asset/create', { key: 'ex-birth', groupPath: 'example/info', text: 'c: 1\n' })).body.code, 0);
  assert.deepEqual(listOf('example/info'), ['ex-birth']);
  // moved to the other set, a record follows its item; a list left empty is removed
  assert.equal((await post('asset/move', { key: 'ex-birth', groupPath: 'real' })).body.code, 0);
  assert.deepEqual([listOf('real'), listOf('example/info')], [['real-name', 'ex-birth'], []]);
  assert.equal(fs.existsSync(path.join(dirItem, 'example', 'info', 'item-list.yaml')), false, 'a list left empty is removed');
  // a folder moved whole carries its list; records kept above follow their items
  assert.equal((await post('asset/group/move', { groupFrom: 'real', groupTo: 'private' })).body.code, 0);
  assert.deepEqual(listOf('private'), ['real-name', 'ex-birth']);
  // a folder left empty by its list goes with it
  assert.equal((await post('asset/move', { key: 'ex-name', groupPath: 'example' })).body.code, 0);
  assert.equal(fs.existsSync(path.join(dirItem, 'example', 'info')), false, 'its last item gone, the folder goes');
  fs.mkdirSync(path.join(dirItem, 'example', 'info'));
  fs.writeFileSync(path.join(dirItem, 'example', 'info', 'item-list.yaml'), 'assetList: []\n');
  assert.equal((await post('asset/create', { key: 'ex-tmp', groupPath: 'example/info', text: 'x: 1\n' })).body.code, 0);
  assert.equal((await post('asset/move', { key: 'ex-tmp', groupPath: 'example' })).body.code, 0);
  assert.equal(fs.existsSync(path.join(dirItem, 'example', 'info')), false);
  // the folder of a partition removed (as git does for an ignored one in a clone): its items and their records are gone, nothing dangles
  fs.rmSync(path.join(dirItem, 'private'), { recursive: true });
  assert.deepEqual(recordListOf(dir, id).map((one) => one.key), ['ex-name', 'ex-tmp']);
  assert.deepEqual(statusOf(dir).itemList().filter((one) => one.folderOwner?.ref === `frontend:${id}`).length, 3, 'the entry and the two of the example');
  // keys stay unique across the lists
  assert.match((await post('asset/create', { key: 'ex-name', groupPath: 'example', text: 'd: 1\n' })).body.message, /key ex-name already/);
});

test('the list of an asset: the nearest above its folder, else the first folder of its path', () => {
  assert.equal(objectFrontendListGroupPathGet([], ''), '');
  assert.equal(objectFrontendListGroupPathGet([], 'real/info/x'), 'real');
  assert.equal(objectFrontendListGroupPathGet(['real'], 'real/info/x'), 'real');
  assert.equal(objectFrontendListGroupPathGet(['real', 'real/info'], 'real/info/x'), 'real/info');
  assert.equal(objectFrontendListGroupPathGet([''], 'real/info'), '', 'a list at the top covers every folder without one');
  const merged = objectFrontendAssetListMerge([{ key: 'a', kind: '', itemId: 'w1' }], [{ groupPath: 'x', assetList: [{ key: 'a', kind: '', itemId: 'w2' }, { key: 'b', kind: '', itemId: 'w1' }], problemList: [] }]);
  assert.deepEqual(merged.assetList.map((one) => [one.key, one.listGroupPath]), [['a', null]]);
  assert.equal(merged.problemList.length, 2);
});

test('partitions: declared by the type, a write names one, and one kept out of git must be ignored by git first', async () => {
  const dir = fixtureCreate();
  typeYamlWrite(dir, [
    'typeList:',
    '  - id: demo.profile',
    '    assetKindList:',
    '      - { id: info, groupPath: info }',
    '    partitionList:',
    '      - { id: example, label: Example }',
    '      - { id: real, label: My data, isGitIgnored: true }',
    '      - { id: Bad name! }',
    '',
  ].join('\n'));
  const { typeList, problemList } = typeDeclaredOf(dir);
  assert.deepEqual(typeList.find((one) => one.id === 'demo.profile').partitionList.map((one) => [one.id, one.isGitIgnored]), [['example', false], ['real', true]]);
  assert.ok(problemList.some((one) => /a partition is a mapping whose "id" is its folder/.test(one.message)));
  const middleware = middlewareCreate(dir);
  const { id } = (await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'demo.profile', name: 'Me' })).body.data;
  const post = (route, body) => requestRun(middleware, 'POST', `/__doc-asset/object-frontend/${route}`, { id, ...body });
  // the folder of its kind, inside the partition named
  const made = await post('asset/create', { kind: 'info', partition: 'example', pathList: ['/example/info/name'], text: 'a: 1\n' });
  assert.equal(made.body.code, 0, made.body.message);
  assert.equal(statusOf(dir).itemGet(made.body.data.itemId).groupPath, 'example/info');
  assert.match((await post('asset/create', { kind: 'info', partition: 'other', text: 'b: 1\n' })).body.message, /declares no partition other/);
  // outside a repository there is no git to ask
  assert.equal((await post('asset/create', { kind: 'info', partition: 'real', text: 'c: 1\n' })).body.code, 0);
  // in a repository, a partition kept out of git is written only once git ignores it
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const refused = await post('asset/create', { kind: 'info', partition: 'real', text: 'd: 1\n' });
  assert.match(refused.body.message, /kept out of git .* but git does not ignore/);
  fs.writeFileSync(path.join(dir, '.gitignore'), '**/.doc-page/object-frontend/*/item/real/\n');
  assert.equal((await post('asset/create', { kind: 'info', partition: 'real', text: 'e: 1\n' })).body.code, 0);
});

test('the apis of partitions: a default one for a write naming none, made, renamed, deleted', async () => {
  const dir = fixtureCreate();
  typeYamlWrite(dir, [
    'typeList:',
    '  - id: demo.notes',
    '    assetKindList:',
    '      - { id: note, groupPath: note }',
    '    partitionList:',
    '      - { id: example }',
    '      - { id: mine, isDefault: true }',
    '      - { id: old }',
    '',
  ].join('\n'));
  const middleware = middlewareCreate(dir);
  const { id } = (await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'demo.notes', name: 'Notes' })).body.data;
  const post = (route, body) => requestRun(middleware, 'POST', `/__doc-asset/object-frontend/${route}`, { id, ...body });
  const dirItem = path.join(objectFolderOf(dir, `${id}--Notes`), 'item');
  // naming no partition: the default one, the folder of the kind inside it
  const made = await post('asset/create', { kind: 'note', key: 'n1', text: 'a: 1\n' });
  assert.equal(statusOf(dir).itemGet(made.body.data.itemId).groupPath, 'mine/note');
  // a place already in a partition is taken as it is
  const placed = await post('asset/create', { kind: 'note', key: 'n2', groupPath: 'example/note', text: 'b: 1\n' });
  assert.equal(statusOf(dir).itemGet(placed.body.data.itemId).groupPath, 'example/note');
  // made: its folder and an empty list; once only; a partition the type does not declare is refused
  assert.equal((await post('partition/create', { partition: 'old' })).body.code, 0);
  assert.equal(fs.readFileSync(path.join(dirItem, 'old', 'item-list.yaml'), 'utf-8').includes('assetList: []'), true);
  assert.match((await post('partition/create', { partition: 'old' })).body.message, /exists already/);
  assert.match((await post('partition/create', { partition: 'other' })).body.message, /declares no partition other/);
  // renamed: an empty one by its folder; one holding assets with them, their records following
  assert.match((await post('partition/rename', { partitionFrom: 'mine', partitionTo: 'example' })).body.message, /exists already/);
  assert.equal((await post('partition/delete', { partition: 'old' })).body.code, 0);
  assert.equal(fs.existsSync(path.join(dirItem, 'old')), false);
  assert.equal((await post('partition/rename', { partitionFrom: 'mine', partitionTo: 'old' })).body.code, 0);
  assert.equal(statusOf(dir).itemGet(made.body.data.itemId).groupPath, 'old/note');
  assert.deepEqual(recordListOf(dir, id).map((one) => [one.key, one.listGroupPath]), [['n2', 'example'], ['n1', 'old']]);
  // deleted: its assets off the lists and deleted softly; the files stay
  assert.equal((await post('partition/delete', { partition: 'old' })).body.code, 0);
  assert.deepEqual(recordListOf(dir, id).map((one) => one.key), ['n2']);
  assert.equal(statusOf(dir).itemGet(made.body.data.itemId).isDeleted, true);
});

