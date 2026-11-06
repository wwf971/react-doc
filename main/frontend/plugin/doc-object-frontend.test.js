import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as yamlParse } from 'yaml';
import { assetStoreCreate, objectDirNameBuild } from './doc-asset-store.ts';
import { docAssetMiddlewareCreate } from './doc-asset-server.ts';
import { docAssetConfigLoad, loadConfigDoc } from './doc-source.ts';
import { groupNameBuild, objectFrontendConfigOfDocPageListGet } from './doc-object-frontend.ts';
import {
  objectFrontendAssetIndexBuild, objectFrontendAssetPathBuild, objectFrontendAssetPathComplete, objectFrontendAssetPathNormalize,
  objectFrontendAssetRefResolve, objectFrontendAssetSearch,
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
  return objectFrontendConfigOfDocPageListGet(configDoc.docEntry.docPageList, dir, assetFolderByAlias);
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
  '',
].join('\n');

test('a doc page declares types with modes; reserved prefixes and foreign parents are reported', () => {
  const dir = fixtureCreate({ objectFrontendYaml: typeYaml });
  const config = configGet(dir);
  const docPage = config.docPageList[0];
  assert.equal(docPage.alias, 'page');
  assert.deepEqual(docPage.typeList.map((type) => type.id), ['demo.shelf', 'demo.shelf-special', 'demo.stray']);
  assert.deepEqual(docPage.typeList[0].extendList, ['frontend.object']);
  assert.deepEqual(docPage.typeList[1].extendList, ['demo.shelf']);
  // a parent that is no frontend object type is left out: the root instead
  assert.deepEqual(docPage.typeList[2].extendList, ['frontend.object']);
  assert.equal(docPage.typeList[0].modeList[1].category, 'edit');
  assert.ok(docPage.problemList.some((problem) => problem.includes('core.taken')));
  assert.ok(docPage.problemList.some((problem) => problem.includes('doc.document')));
  assert.equal(docPage.assetFolder, '~page:docs/.doc-page/asset');
});

test('modes are inherited: the nearest declaration of an id wins, the built-in overview comes last', () => {
  const dir = fixtureCreate({ objectFrontendYaml: typeYaml });
  const typeList = configGet(dir).docPageList[0].typeList;
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

test('create: the entry asset in the group folder {id}--{name}, the line in the yaml file (made when missing)', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'My shelf' });
  assert.equal(created.body.code, 0, created.body.message);
  const { id, objectList, config } = created.body.data;
  const entry = objectList[0];
  assert.equal(entry.groupPath, `${id}--My shelf`);
  assert.deepEqual(entry.owner, { ref: `frontend:${id}`, role: 'entry' });
  assert.ok(fs.existsSync(path.join(dir, 'page', '.doc-page', 'asset', `${id}--My shelf`, entry.objectId, 'object.yaml')));
  const yamlFile = path.join(dir, 'page', '.doc-page', 'object-frontend.yaml');
  assert.deepEqual(yamlParse(fs.readFileSync(yamlFile, 'utf-8')).objectList, [{ id, entry: entry.objectId }]);
  assert.deepEqual(config.docPageList[0].objectList.map((item) => item.id), [id]);

  // the store reads the objects inside groups like those at the top
  const store = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
  assert.equal(store.objectGet(entry.objectId).groupPath, `${id}--My shelf`);
  assert.equal(store.folderInfoList()[0].objectCount, 1);

  // an asset of the object: in its group, declaring it, listed in the entry
  const asset = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', text: 'title: Dune\n' });
  assert.equal(asset.body.code, 0, asset.body.message);
  assert.equal(asset.body.data.key, 'book-1');
  const assetMeta = store.objectGet(asset.body.data.objectId);
  assert.equal(assetMeta.groupPath, `${id}--My shelf`);
  assert.deepEqual(assetMeta.owner, { ref: `frontend:${id}` });
  const entryText = store.versionDataGet(entry.objectId).text;
  assert.deepEqual(objectFrontendEntryParse(entryText).entry.assetList, [{ key: 'book-1', kind: 'book', objectId: assetMeta.objectId }]);

  // a new name renames the group folder with everything in it
  const renamed = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/meta/set', { id, name: 'Shelf two' });
  assert.equal(renamed.body.code, 0, renamed.body.message);
  assert.equal(store.objectGet(asset.body.data.objectId).groupPath, `${id}--Shelf two`);
  assert.equal(objectFrontendEntryParse(store.versionDataGet(entry.objectId).text).entry.name, 'Shelf two');

  // removed with its asset kept: released to the top of the folder
  const removed = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/remove', { id, key: 'book-1', isAssetKept: true });
  assert.equal(removed.body.code, 0, removed.body.message);
  const released = store.objectGet(asset.body.data.objectId);
  assert.equal(released.groupPath, '');
  assert.equal(released.owner, undefined);

  // deleted: the line leaves the file, its assets are deleted softly
  const deleted = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/delete', { id });
  assert.equal(deleted.body.code, 0, deleted.body.message);
  assert.deepEqual(yamlParse(fs.readFileSync(yamlFile, 'utf-8')).objectList, []);
  assert.equal(store.objectGet(entry.objectId).isDeleted, true);
  assert.equal(store.objectGet(released.objectId).isDeleted, false);
  assert.ok(fs.existsSync(`${yamlFile}.bak`));
});

test('the yaml file keeps its comments and types when an object is added', async () => {
  const dir = fixtureCreate({ objectFrontendYaml: `# my objects\n${typeYaml}objectList:\n  # the first\n  - id: w5aaaaaaaaa\n    entry: w5aaaaaaaab\n` });
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'demo.shelf', name: '' });
  assert.equal(created.body.code, 0, created.body.message);
  const text = fs.readFileSync(path.join(dir, 'page', '.doc-page', 'object-frontend.yaml'), 'utf-8');
  assert.ok(text.startsWith('# my objects\ntypeList:'));
  assert.ok(text.includes('  # the first\n  - id: w5aaaaaaaaa\n    entry: w5aaaaaaaab\n  - id: '));
  // an unknown type is refused
  const refused = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'demo.nope', name: 'x' });
  assert.equal(refused.body.code, -1);
});

test('group folders: an object is found at any depth, moved between groups, and a group moved whole', () => {
  const dir = fixtureCreate();
  const store = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
  const { object } = store.objectCreate({ lang: 'yaml', data: Buffer.from('a: 1\n'), groupPath: 'one/two', name: 'deep' });
  assert.equal(object.dirName, `one/two/${object.objectId}--deep`);
  const storeAgain = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
  assert.equal(storeAgain.objectGetByName('deep').groupPath, 'one/two');
  storeAgain.objectMetaSet(object.objectId, { name: 'deeper' });
  assert.equal(storeAgain.objectGet(object.objectId).dirName, `one/two/${object.objectId}--deeper`);
  storeAgain.objectMove(object.objectId, { groupPath: '' });
  const folderAbs = path.join(dir, 'page', '.doc-page', 'asset');
  assert.equal(fs.existsSync(path.join(folderAbs, 'one')), false, 'the empty groups are removed');
  storeAgain.objectMove(object.objectId, { groupPath: 'g' });
  storeAgain.groupMove(storeAgain.folderList[0].path, 'g', 'h/i');
  assert.equal(storeAgain.objectGet(object.objectId).groupPath, 'h/i');
  assert.throws(() => storeAgain.objectMove(object.objectId, { groupPath: '../x' }), /not a group folder name/);
});

test('the paths of assets are read as os paths; the folders they imply complete a typed path, folder by folder', () => {
  assert.deepEqual(objectFrontendAssetPathNormalize('book//sci-fi/./x/../dune/'), { path: '/book/sci-fi/dune', message: '' });
  assert.match(objectFrontendAssetPathNormalize('/a/../..').message, /above the root/);
  assert.match(objectFrontendAssetPathNormalize('/').message, /names no asset/);
  assert.equal(objectFrontendAssetPathBuild('author', 'Ursula K. Le Guin', 'The Left Hand'), '/author/ursula-k-le-guin/the-left-hand');
  const assetList = [
    { key: 'book-1', kind: 'book', objectId: 'w1', name: 'Dune', pathList: ['/book/sci-fi/dune', '/author/frank-herbert/dune'], status: 'found' },
    { key: 'book-2', kind: 'book', objectId: 'w2', name: 'Solaris', pathList: ['/book/sci-fi/solaris', '/book/sci-fi/dune'], status: 'missing' },
    { key: 'note-1', kind: 'note', objectId: 'w3', name: 'Dune, again', pathList: ['/note/dune/1'], status: 'found' },
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

test('the names and paths of assets are written into the entry; a path another asset has is refused', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Shelf' });
  const { id, objectList } = created.body.data;
  const asset = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', name: 'Dune', pathList: ['book//sci-fi/dune', '/author/frank-herbert/dune'], text: 'a: 1\n' });
  assert.equal(asset.body.code, 0, asset.body.message);
  const taken = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/create', { id, kind: 'book', pathList: ['/book/sci-fi/dune'], text: 'b: 1\n' });
  assert.equal(taken.body.code, -1);
  assert.match(taken.body.message, /is the path of Dune/);
  const metaSet = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/meta/set', { id, key: 'book-1', name: null, pathList: ['/book/classic/dune'] });
  assert.equal(metaSet.body.code, 0, metaSet.body.message);
  const store = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
  const entry = objectFrontendEntryParse(store.versionDataGet(objectList[0].objectId).text).entry;
  assert.deepEqual(entry.assetList[0], { key: 'book-1', kind: 'book', objectId: asset.body.data.objectId, pathList: ['/book/classic/dune'] });
  const bad = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/asset/meta/set', { id, key: 'book-1', pathList: ['/..'] });
  assert.match(bad.body.message, /above the root/);
});

test('a folder name holds ASCII only, whatever the name is', () => {
  assert.equal(objectDirNameBuild('w5abc', 'My shelf'), 'w5abc--My shelf');
  assert.equal(objectDirNameBuild('w5abc', ''), 'w5abc');
  assert.equal(objectDirNameBuild('w5abc', '\u55b6\u696d'), 'w5abc');
  assert.equal(objectDirNameBuild('w5abc', '\u55b6\u696d report 2'), 'w5abc--report 2');
  assert.equal(objectDirNameBuild('w5abc', 'a\u55b6\u696db'), 'w5abc--a-b');
  // a group with no ASCII in its name is named after its type
  assert.equal(groupNameBuild('w5abc', '\u55b6\u696d', 'db-migration.project'), 'w5abc--db-migration.project');
  assert.equal(groupNameBuild('w5abc', 'Shelf', 'db-migration.project'), 'w5abc--Shelf');
});

test('an object named in any language keeps its name, and its folders are in ASCII', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const nameFirst = '\u30c7\u30fc\u30bf\u30d9\u30fc\u30b9\u79fb\u884c';
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: nameFirst });
  assert.equal(created.body.code, 0, created.body.message);
  const { id, objectList } = created.body.data;
  const entry = objectList[0];
  assert.equal(entry.groupPath, `${id}--frontend.object`);
  const store = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
  assert.equal(objectFrontendEntryParse(store.versionDataGet(entry.objectId).text).entry.name, nameFirst);

  // another name in the same script: the folder stays
  const renamed = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/meta/set', { id, name: '\u79fb\u884c' });
  assert.equal(renamed.body.code, 0, renamed.body.message);
  assert.equal(store.objectGet(entry.objectId).groupPath, `${id}--frontend.object`);
  assert.equal(objectFrontendEntryParse(store.versionDataGet(entry.objectId).text).entry.name, '\u79fb\u884c');

  // nothing on disk but ASCII
  const pathList = fs.readdirSync(path.join(dir, 'page', '.doc-page', 'asset'), { recursive: true });
  assert.ok(pathList.length > 0);
  assert.ok(pathList.every((item) => /^[\x20-\x7E]*$/.test(item)), pathList.join(', '));
});

test('an object in a folder named before the rule is still read', async () => {
  const dir = fixtureCreate();
  const middleware = middlewareCreate(dir);
  const created = await requestRun(middleware, 'POST', '/__doc-asset/object-frontend/create', { docPageAlias: 'page', typeId: 'frontend.object', name: 'Shelf' });
  const { id, objectList } = created.body.data;
  const dirAsset = path.join(dir, 'page', '.doc-page', 'asset');
  const groupOld = `${id}--\u79fb\u884c`;
  fs.renameSync(path.join(dirAsset, `${id}--Shelf`), path.join(dirAsset, groupOld));
  const store = assetStoreCreate(docAssetConfigLoad(path.join(dir, 'config.yaml')));
  assert.equal(store.objectGet(objectList[0].objectId).groupPath, groupOld);
});
