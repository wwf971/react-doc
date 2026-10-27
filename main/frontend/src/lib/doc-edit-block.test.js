import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAutoObservable, runInAction, toJS } from 'mobx';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import {
  blockDeleteOperationBuild,
  blockInsertOperationBuild,
  blockSwapOperationBuild,
  componentBlockTextBuild,
  componentTemplateTextBuild,
  editDocModelBuild,
  markerTextBuild,
  remarkEditBlock,
} from './doc-edit-block.js';
import { splitFrontmatter } from './mdx-compile.js';
import { docEditApiCreate } from './doc-edit-api.js';
import { compDefine } from '../../../comp-doc/registry/comp-registry.js';
import { DocEditStore } from '../store/DocEditStore.ts';

const sourceDemo = [
  '---',
  'title: Demo',
  '---',
  '',
  '<!-- authored note -->',
  '',
  '# Title',
  '',
  'A paragraph',
  'on two lines.',
  '',
  '<!--renderComp=Anchor,id=pic-->',
  '<!--renderComp=Image-->',
  '```yaml',
  'src: dog.png',
  '```',
  '',
  '- item a',
  '- item b',
  '',
  '<!--renderComp=MultiLang-->',
  '## {en: "Section", jp: "節"}',
  '',
  'Stock:<!--renderComp=StockTable,title=A-->',
  '| id | name |',
  '| --- | --- |',
  '| 1 | mouse |',
  '',
].join('\n');

test('groups root nodes into blocks with file line ranges', () => {
  const model = modelBuild(sourceDemo);
  assert.deepEqual(model.frontmatter, { lineStart: 1, lineEnd: 3, text: '---\ntitle: Demo\n---' });
  assert.deepEqual(
    model.blockList.map((block) => [block.kind, block.lineStart, block.lineEnd]),
    [
      ['html', 5, 5],
      ['heading', 7, 7],
      ['paragraph', 9, 10],
      ['component', 12, 16],
      ['list', 18, 19],
      ['heading', 21, 22],
      ['component', 24, 27],
    ],
  );
  assert.equal(model.blockList[2].text, 'A paragraph\non two lines.');
  assert.equal(model.blockList[5].text, '<!--renderComp=MultiLang-->\n## {en: "Section", jp: "節"}');
});

test('the wrapper elements carry the block index and keep the grouped nodes', () => {
  const { content } = splitFrontmatter(sourceDemo);
  const tree = remark().use(remarkGfm).parse(content);
  remarkEditBlock()(tree);
  assert.equal(tree.children.length, 7);
  assert.ok(tree.children.every((node) => node.type === 'mdxJsxFlowElement' && node.name === 'DocEditBlock'));
  assert.deepEqual(tree.children[3].attributes, [{ type: 'mdxJsxAttribute', name: 'blockIndex', value: '3' }]);
  assert.deepEqual(tree.children[3].children.map((node) => node.type), ['html', 'html', 'code']);
  assert.deepEqual(tree.children[6].children.map((node) => node.type), ['paragraph', 'table']);
});

test('component details split the block into marker, gap and node text', () => {
  const model = modelBuild(sourceDemo);
  const component = model.blockList[3].component;
  assert.equal(component.compName, 'Image');
  assert.deepEqual(component.props, {});
  assert.equal(component.lang, 'yaml');
  assert.equal(component.raw, 'src: dog.png');
  assert.equal(component.textBefore, '<!--renderComp=Anchor,id=pic-->\n');
  assert.equal(component.markerText, '<!--renderComp=Image-->');
  assert.equal(component.textBetween, '\n');
  assert.equal(component.nodeText, '```yaml\nsrc: dog.png\n```');

  const table = model.blockList[6].component;
  assert.equal(table.compName, 'StockTable');
  assert.deepEqual(table.props, { title: 'A' });
  assert.equal(table.textBefore, 'Stock:');
  assert.equal(table.raw, '| id | name |\n| --- | --- |\n| 1 | mouse |');
});

test('componentBlockTextBuild rebuilds the block around new raw text or props', () => {
  const model = modelBuild(sourceDemo);
  const blockImage = model.blockList[3];
  assert.equal(componentBlockTextBuild(blockImage), blockImage.text);
  assert.equal(
    componentBlockTextBuild(blockImage, { raw: 'src: cat.png\nalt: a cat' }),
    '<!--renderComp=Anchor,id=pic-->\n<!--renderComp=Image-->\n```yaml\nsrc: cat.png\nalt: a cat\n```',
  );
  assert.equal(
    componentBlockTextBuild(blockImage, { raw: '```\ninner\n```' }),
    '<!--renderComp=Anchor,id=pic-->\n<!--renderComp=Image-->\n````yaml\n```\ninner\n```\n````',
  );
  const blockTable = model.blockList[6];
  assert.equal(
    componentBlockTextBuild(blockTable, { props: { title: 'B' }, raw: '| id |\n| --- |' }),
    'Stock:<!--renderComp=StockTable,title=B-->\n| id |\n| --- |',
  );
});

test('marker and template text', () => {
  assert.equal(markerTextBuild('Image'), '<!--renderComp=Image-->');
  assert.equal(markerTextBuild('Index', { id: 'x', languages: '[en,jp]' }), '<!--renderComp=Index,id=x,languages=[en,jp]-->');
  assert.equal(
    componentTemplateTextBuild('Image', { lang: 'yaml', raw: 'src: a.png' }),
    '<!--renderComp=Image-->\n```yaml\nsrc: a.png\n```',
  );
});

test('insert operations add the blank lines a block needs', () => {
  const model = modelBuild(sourceDemo);
  assert.deepEqual(blockInsertOperationBuild(model, 0, 'new'), { action: 'insertLines', lineAt: 5, text: 'new\n' });
  assert.deepEqual(blockInsertOperationBuild(model, 2, 'new'), { action: 'insertLines', lineAt: 8, text: '\nnew' });
  assert.deepEqual(blockInsertOperationBuild(model, 7, 'new'), { action: 'insertLines', lineAt: 28, text: '\nnew' });

  const modelTight = modelBuild('# a\nparagraph\n');
  assert.deepEqual(blockInsertOperationBuild(modelTight, 1, 'new'), { action: 'insertLines', lineAt: 2, text: '\nnew\n' });

  const modelEmpty = modelBuild('');
  assert.deepEqual(blockInsertOperationBuild(modelEmpty, 0, 'new'), { action: 'insertLines', lineAt: 1, text: 'new' });
  const modelFrontmatterOnly = modelBuild('---\ntitle: x\n---\n');
  assert.deepEqual(blockInsertOperationBuild(modelFrontmatterOnly, 0, 'new'), { action: 'insertLines', lineAt: 4, text: '\nnew' });
});

test('delete operations take the separating blank lines with the block', () => {
  const model = modelBuild(sourceDemo);
  assert.deepEqual(blockDeleteOperationBuild(model, 2), { action: 'deleteLines', lineStart: 9, lineEnd: 11 });
  assert.deepEqual(blockDeleteOperationBuild(model, 6), { action: 'deleteLines', lineStart: 23, lineEnd: 27 });
  const modelSingle = modelBuild('---\ntitle: x\n---\n\nonly\n');
  assert.deepEqual(blockDeleteOperationBuild(modelSingle, 0), { action: 'deleteLines', lineStart: 4, lineEnd: 5 });
});

test('swap operations exchange two neighbor blocks and keep the lines between them', () => {
  const model = modelBuild(sourceDemo);
  // the paragraph (lines 9-10) and the component block (lines 12-16)
  assert.deepEqual(blockSwapOperationBuild(model, 2), {
    action: 'replaceLines',
    lineStart: 9,
    lineEnd: 16,
    text: [
      '<!--renderComp=Anchor,id=pic-->',
      '<!--renderComp=Image-->',
      '```yaml',
      'src: dog.png',
      '```',
      '',
      'A paragraph',
      'on two lines.',
    ].join('\n'),
  });
  assert.throws(() => blockSwapOperationBuild(model, 6), /no two blocks/);
});

test('trailing markers without a node form a marker block', () => {
  const model = modelBuild('text\n\n<!--renderComp=Image-->\n');
  assert.deepEqual(model.blockList.map((block) => block.kind), ['paragraph', 'marker']);
});

function modelBuild(source) {
  const { content } = splitFrontmatter(source);
  const tree = remark().use(remarkGfm).parse(content);
  let blockListCompiled = [];
  remarkEditBlock({ onBlockList: (blockList) => { blockListCompiled = blockList; } })(tree);
  return editDocModelBuild({ source, blockListCompiled });
}

// ---------- deleting a block with the files its component offers ----------
// (doc_page_impl_block_ops.md#deleting-blocks): the capability is a compDefine
// option, the store lists and checks the choice, the api client sends it

const PATH_DOC = '~docs/page.md';
const HASH_DOC = 'hash-1';

const sourceFiles = [
  '# Files',
  '',
  '<!--renderComp=PhotoSet-->',
  '```yaml',
  'files: [dog.png, remote.png, dog.png, notes.pdf, locked.gif]',
  '```',
  '',
  '<!--renderComp=Image-->',
  '```yaml',
  'src: dog.png',
  '```',
  '',
  '<!--renderComp=PhotoSet-->',
  '```asset',
  'store: local',
  'objectId: w1',
  '```',
  '',
].join('\n');

// a component of a third party that offers files with its block: every
// file its data names, a reason of its own for one of them
function photoSetDefinitionCreate(receivedList = []) {
  return compDefine(function PhotoSet() { return null; }, {
    placementList: ['commentBlock'],
    assetDependencyListGet: () => [],
    deleteFileListGet: (data) => {
      receivedList.push(data);
      const fileList = /files: \[(.*)\]/.exec(String(data.raw ?? ''))?.[1].split(',').map((item) => item.trim()) ?? [];
      return fileList.map((path) => ({ path, reason: path.endsWith('.gif') ? 'kept by the component' : '' }));
    },
  });
}

// the store over a fake source (fileResolve knows two files), a fake
// registry, and the real api client over a captured fetch
function deleteStoreCreate({ compById, assetStore, apply = { code: 0, data: { text: '# Files\n', hash: HASH_DOC }, message: '' } } = {}) {
  const requestList = [];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requestList.push({ url, body: JSON.parse(init.body) });
    return { status: 200, json: async () => apply };
  };
  const entryByReference = new Map([
    ['dog.png', { internalPath: '~docs/dog.png' }],
    ['notes.pdf', { internalPath: '~docs/notes.pdf' }],
    ['locked.gif', { internalPath: '~docs/locked.gif' }],
  ]);
  const sourceStore = makeAutoObservable({
    configDoc: { compRegistry: { PhotoSet: 'custom/PhotoSet', Image: 'common/Image' } },
    entryByInternalPath: new Map(),
    fileResolve: (reference) => entryByReference.get(reference),
  });
  const docStore = { compById, docCurrentPath: PATH_DOC };
  const envStore = { isCapable: () => true, endpointGet: () => '' };
  const store = new DocEditStore(sourceStore, docStore, {}, { envStore, assetStore });
  store.api = docEditApiCreate('/__doc-edit');
  runInAction(() => {
    store.isEditMode = true;
    store.sourceByPath[PATH_DOC] = { status: 'done', text: sourceFiles, hash: HASH_DOC };
    store.docEditByPath[PATH_DOC] = { status: 'done', hash: HASH_DOC, model: modelBuild(sourceFiles) };
  });
  const restore = () => { globalThis.fetch = fetchBefore; };
  // the files are listed after the confirmation opens; one turn is enough
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { store, requestList, restore, settle };
}

test('compDefine keeps deleteFileListGet, and dependencies alone do not offer files', () => {
  const definition = photoSetDefinitionCreate();
  assert.equal(typeof definition.deleteFileListGet, 'function');
  const withDependencies = compDefine(function Plain() { return null; }, { assetDependencyListGet: () => [{ type: 'source', path: 'a.png' }] });
  assert.equal(withDependencies.deleteFileListGet, undefined);
});

test('a component with the capability lists its files once, resolved, nothing chosen', async () => {
  const receivedList = [];
  const { store, restore, settle } = deleteStoreCreate({ compById: { 'custom/PhotoSet': photoSetDefinitionCreate(receivedList) } });
  try {
    assert.equal(await store.deleteConfirmSet(PATH_DOC, 1), true);
    await settle();
    assert.equal(store.deleteConfirm.isFileLoading, false);
    assert.equal(receivedList[0].lang, 'yaml', 'the inline language reaches the component');
    assert.deepEqual(toJS(store.deleteConfirm.fileList), [
      { path: '~docs/dog.png', isDeletable: true, reason: '' },
      { path: 'remote.png', isDeletable: false, reason: 'not a file of the collected source' },
      { path: '~docs/notes.pdf', isDeletable: true, reason: '' },
      { path: '~docs/locked.gif', isDeletable: false, reason: 'kept by the component' },
    ]);
    assert.deepEqual(store.deleteConfirm.filePathDeleteList, []);
  } finally {
    restore();
  }
});

test('only listed deletable files can be chosen; the chosen subset reaches the request body', async () => {
  const { store, requestList, restore, settle } = deleteStoreCreate({ compById: { 'custom/PhotoSet': photoSetDefinitionCreate() } });
  try {
    await store.deleteConfirmSet(PATH_DOC, 1);
    await settle();
    store.deleteFileSelectedSet('remote.png', true);
    store.deleteFileSelectedSet('~docs/locked.gif', true);
    store.deleteFileSelectedSet('~docs/unlisted.png', true);
    assert.deepEqual(store.deleteConfirm.filePathDeleteList, []);
    store.deleteFileSelectedSet('~docs/notes.pdf', true);
    store.deleteFileSelectedSet('~docs/dog.png', true);
    store.deleteFileSelectedSet('~docs/notes.pdf', false);
    assert.deepEqual(store.deleteConfirm.filePathDeleteList, ['~docs/dog.png']);
    assert.equal(await store.blockDelete(PATH_DOC, 1), true);
    assert.equal(requestList.length, 1);
    assert.equal(requestList[0].url, '/__doc-edit/source/apply');
    assert.deepEqual(requestList[0].body, {
      internalPath: PATH_DOC,
      hashBase: HASH_DOC,
      operation: { action: 'deleteLines', lineStart: 3, lineEnd: 7 },
      filePathDeleteList: ['~docs/dog.png'],
    });
    assert.equal(store.deleteConfirm, undefined);
  } finally {
    restore();
  }
});

test('an emptied choice sends no file list, and a block without the capability never does', async () => {
  const compById = { 'custom/PhotoSet': photoSetDefinitionCreate(), 'common/Image': compDefine(function Image() { return null; }, { assetDependencyListGet: () => [{ type: 'source', path: 'dog.png' }] }) };
  const { store, requestList, restore, settle } = deleteStoreCreate({ compById });
  try {
    await store.deleteConfirmSet(PATH_DOC, 1);
    await settle();
    store.deleteFileSelectedSet('~docs/dog.png', true);
    store.deleteFileSelectionClear();
    assert.deepEqual(store.deleteConfirm.filePathDeleteList, []);
    await store.blockDelete(PATH_DOC, 1);
    assert.equal('filePathDeleteList' in requestList[0].body, false);

    await store.deleteConfirmSet(PATH_DOC, 2);
    await settle();
    assert.equal(store.deleteConfirm.fileList, undefined, 'dependencies alone offer nothing');
    await store.blockDelete(PATH_DOC, 2);
    assert.equal('filePathDeleteList' in requestList[1].body, false);
  } finally {
    restore();
  }
});

test('a failed deletion keeps the confirmation, its files and its choice', async () => {
  const { store, restore, settle } = deleteStoreCreate({
    compById: { 'custom/PhotoSet': photoSetDefinitionCreate() },
    apply: { code: -1, data: null, message: 'disk full' },
  });
  try {
    await store.deleteConfirmSet(PATH_DOC, 1);
    await settle();
    store.deleteFileSelectedSet('~docs/dog.png', true);
    assert.equal(await store.blockDelete(PATH_DOC, 1), false);
    assert.equal(store.deleteConfirm.status, 'error');
    assert.equal(store.deleteConfirm.message, 'disk full');
    assert.equal(store.deleteConfirm.fileList.length, 4);
    assert.deepEqual(store.deleteConfirm.filePathDeleteList, ['~docs/dog.png']);
    store.deleteFileSelectedSet('~docs/notes.pdf', true);
    assert.deepEqual(store.deleteConfirm.filePathDeleteList, ['~docs/dog.png', '~docs/notes.pdf']);
  } finally {
    restore();
  }
});

// a reference block: the files come from the text of the asset version,
// read through the asset service layer, which takes time
function assetStoreCreate() {
  let resolveLoad;
  const loadPromise = new Promise((resolve) => { resolveLoad = resolve; });
  const assetStore = {
    isWritable: true,
    writeUnavailableReason: '',
    refObjectIdGet: (ref) => ref.objectId,
    objectGet: () => ({ name: 'photos', isDeleted: false, isLocked: false, versionIdHead: 'v1' }),
    usageListGet: () => [],
    refLoad: () => loadPromise,
    refQuery: () => ({ status: 'done', message: '', versionId: 'v1', version: { text: 'files: [dog.png, notes.pdf]' } }),
    loadSettle: () => resolveLoad(),
  };
  return assetStore;
}

test('the files of a reference block come from its asset version', async () => {
  const receivedList = [];
  const assetStore = assetStoreCreate();
  const { store, restore, settle } = deleteStoreCreate({ compById: { 'custom/PhotoSet': photoSetDefinitionCreate(receivedList) }, assetStore });
  try {
    await store.deleteConfirmSet(PATH_DOC, 3);
    assert.equal(store.deleteConfirm.isFileLoading, true);
    assert.deepEqual(toJS(store.deleteConfirm.fileList), []);
    assetStore.loadSettle();
    await settle();
    assert.equal(store.deleteConfirm.isFileLoading, false);
    assert.equal(receivedList[0].raw, 'files: [dog.png, notes.pdf]');
    assert.deepEqual(toJS(store.deleteConfirm.fileList).map((file) => file.path), ['~docs/dog.png', '~docs/notes.pdf']);
  } finally {
    restore();
  }
});

test('a confirmation closed while its files are listed is never filled', async () => {
  const assetStore = assetStoreCreate();
  const { store, restore, settle } = deleteStoreCreate({ compById: { 'custom/PhotoSet': photoSetDefinitionCreate() }, assetStore });
  try {
    await store.deleteConfirmSet(PATH_DOC, 3);
    const confirmFirst = store.deleteConfirm;
    store.deleteConfirmClear();
    assetStore.loadSettle();
    await settle();
    assert.deepEqual(toJS(confirmFirst.fileList), []);
    assert.equal(confirmFirst.isFileLoading, true, 'a closed confirmation is left as it was');
    assert.equal(store.deleteConfirm, undefined);
  } finally {
    restore();
  }
});

