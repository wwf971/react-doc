import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageTreeModel } from './page-tree.js';
import {
  sidePanelBindActionListGet,
  sidePanelBindResolve,
  sidePanelInsertResolve,
  sidePanelPathWrittenGet,
  sidePanelRemoveResolve,
} from './side-panel-node.js';

// what a structure change of the side panel is allowed to do and what it
// writes (doc_page_impl_side_panel.md#changing-the-structure), on a tree
// built the way the page builds it

const file = '.doc-page/side-panel.yaml';
const nodeAt = (...index) => {
  const path = ['sidePanelById', 'main', 'tree'];
  index.forEach((step, depth) => {
    if (depth > 0) path.push('children');
    path.push(step);
  });
  return { file, path };
};

const entry = (relPath) => ({
  docPageAlias: 'ex',
  rootAlias: 'ex',
  relPath,
  name: relPath.split('/').at(-1),
  ext: relPath.split('.').at(-1),
  internalPath: `~ex:ex/${relPath}`,
  collect: 'recursive',
  title: relPath,
});

const fileManifest = [entry('a.md'), entry('b.md'), entry('c.md'), entry('dir/x.md'), entry('dir/sub/y.md')];

const configDoc = {
  sidePanel: {
    tree: [
      { id: 'a', doc: '~ex:ex/a.md', docPageAlias: 'ex', nodeSource: nodeAt(0), textSource: nodeAt(0) },
      {
        id: 'f',
        text: 'Folder',
        docPageAlias: 'ex',
        nodeSource: nodeAt(1),
        textSource: nodeAt(1),
        children: [{ id: 'b', doc: '~ex:ex/b.md', docPageAlias: 'ex', nodeSource: nodeAt(1, 0), textSource: nodeAt(1, 0) }],
      },
      { id: 'c', doc: '~ex:ex/c.md', docPageAlias: 'ex', children: [], nodeSource: nodeAt(2), textSource: nodeAt(2) },
      { id: 's', text: 'Src', sourceFolder: '~ex:ex/dir', docPageAlias: 'ex', nodeSource: nodeAt(3), textSource: nodeAt(3) },
      { id: 'e', text: 'Empty', children: [], docPageAlias: 'ex', nodeSource: nodeAt(4), textSource: nodeAt(4) },
    ],
  },
};

const model = buildPageTreeModel(configDoc, fileManifest);
const placeById = model.itemPlaceById;

test('generated items have ids from their source path and know the folder they mirror', () => {
  const place = placeById.get('src-ex-ex-dir-x.md');
  assert.ok(place, `ids: ${[...placeById.keys()].join(', ')}`);
  assert.equal(place.nodeForm, 'generated');
  assert.equal(place.generatedFrom.itemId, 's');
  assert.ok(placeById.get('src-ex-ex-dir-sub'));
});

test('a new item goes next to a node, or into a document item or a folder', () => {
  const after = sidePanelInsertResolve(placeById, 'b', 'after');
  assert.deepEqual(after.data, { file, listPath: [...nodeAt(1).path, 'children'], index: 1, docPageAlias: 'ex', parentItemId: 'f' });
  const inside = sidePanelInsertResolve(placeById, 'e', 'insideLast');
  assert.deepEqual([inside.data.listPath.at(-1), inside.data.index], ['children', -1]);
  assert.equal(sidePanelInsertResolve(placeById, 's', 'insideLast').code, -1);
  assert.match(sidePanelInsertResolve(placeById, 'src-ex-ex-dir-x.md', 'before').message, /mirrors a file or folder of "s"/);
});

test('only an item holding no items is removed; a source folder goes with its generated items', () => {
  assert.match(sidePanelRemoveResolve(placeById, 'f').message, /holds 1 item/);
  assert.equal(sidePanelRemoveResolve(placeById, 'a').data.filePath, '~ex:ex/a.md');
  assert.equal(sidePanelRemoveResolve(placeById, 'e').data.filePath, '');
  const source = sidePanelRemoveResolve(placeById, 's');
  assert.equal(source.data.isSourceFolder, true);
  assert.equal(source.data.generatedCount, 3);
  assert.equal(sidePanelRemoveResolve(placeById, 'src-ex-ex-dir-x.md').code, -1);
});

test('the binding changes of each kind of item', () => {
  const actions = (itemId) => sidePanelBindActionListGet(placeById, itemId).map((entry) => `${entry.action}${entry.reason ? '!' : ''}`);
  assert.deepEqual(actions('a'), ['docChange']);
  assert.deepEqual(actions('c'), ['docChange', 'folderBind', 'detach']);
  assert.deepEqual(actions('f'), ['docBind', 'folderBind!']);
  assert.deepEqual(actions('s'), ['folderChange', 'docBind', 'detach']);
  assert.deepEqual(actions('src-ex-ex-dir-x.md'), []);
});

test('a binding writes a path of the own doc page in the local form', () => {
  const resolved = sidePanelBindResolve(placeById, 'e', { kind: 'folder', path: '~ex:ex/dir/sub' }, 'Empty');
  assert.deepEqual(resolved.data.request, { action: 'bind', path: nodeAt(4).path, binding: { kind: 'folder', path: '~ex/dir/sub' }, text: 'Empty' });
  assert.equal(sidePanelBindResolve(placeById, 'a', { kind: 'doc', path: '~ex:ex/a.md' }).data.isNoop, true);
  assert.equal(sidePanelBindResolve(placeById, 'a', { kind: 'none' }).code, -1);
  assert.equal(sidePanelPathWrittenGet('~other:r/a.md', 'ex'), '~other:r/a.md');
});
