import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageTreeModel } from './page-tree.js';

// the root row hidden (plugin/doc-sidebar-effective.ts): the loader marks
// the sole wrapper item of a doc page mounted with isRootVisible: false;
// page-tree.js keeps the mark on the folder it builds and counts it in the
// render key of the tree, so the side panel is rendered again when only the
// visibility of the row changes

const fileManifest = [
  { internalPath: '~example:example/a.md', docPageAlias: 'example', rootAlias: 'example', relPath: 'a.md', name: 'a.md', title: 'A', ext: 'md' },
  { internalPath: '~example:example/b.md', docPageAlias: 'example', rootAlias: 'example', relPath: 'b.md', name: 'b.md', title: 'B', ext: 'md' },
];

function configDocBuild(isSidebarRootHidden) {
  return {
    siteTitle: 'Docs',
    sidePanel: {
      tree: [{
        id: 'wrap',
        text: 'All',
        part: true,
        docPageAlias: 'example',
        ...(isSidebarRootHidden ? { isSidebarRootHidden: true } : {}),
        children: [
          { doc: '~example:example/a.md', docPageAlias: 'example' },
          { id: 'inner', text: 'Inner', docPageAlias: 'example', children: [{ doc: '~example:example/b.md', docPageAlias: 'example' }] },
        ],
      }],
    },
  };
}

test('a hidden root keeps its item, part and children; only the folder is marked, and the render key differs', () => {
  const shown = buildPageTreeModel(configDocBuild(false), fileManifest);
  const hidden = buildPageTreeModel(configDocBuild(true), fileManifest);
  const folderHidden = hidden.treePage.children[0];
  assert.equal(folderHidden.$id, 'wrap');
  assert.equal(folderHidden.isSidebarRootHidden, true);
  assert.equal(shown.treePage.children[0].isSidebarRootHidden, undefined);
  // the child folder is an ordinary folder
  assert.equal(folderHidden.children[1].isSidebarRootHidden, undefined);
  assert.equal(folderHidden.children[1].$id, 'inner');
  // the semantic model is the same: items, part, outline
  assert.deepEqual([...hidden.itemById.keys()], [...shown.itemById.keys()]);
  assert.ok(hidden.partById.has('wrap'));
  assert.deepEqual(hidden.itemOutlineById.get('wrap').kind, 'folder');
  // another tree for fumadocs, the same item ids
  assert.notEqual(hidden.treePage.$id, shown.treePage.$id);
  assert.equal(buildPageTreeModel(configDocBuild(true), fileManifest).treePage.$id, hidden.treePage.$id);
});
