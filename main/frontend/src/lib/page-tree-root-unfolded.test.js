import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageTreeModel } from './page-tree.js';

// the sole root unfolded (plugin/doc-sidebar-effective.ts): the loader marks
// the sole wrapper item of a doc page mount (unless isRootUnfolded: false);
// page-tree.js keeps the mark on the folder it builds and counts it in the
// render key of the tree, so the side panel is rendered again when only the
// unfolding changes

const fileManifest = [
  { internalPath: '~example:example/a.md', docPageAlias: 'example', rootAlias: 'example', relPath: 'a.md', name: 'a.md', title: 'A', ext: 'md' },
  { internalPath: '~example:example/b.md', docPageAlias: 'example', rootAlias: 'example', relPath: 'b.md', name: 'b.md', title: 'B', ext: 'md' },
];

function configDocBuild(isSidebarRootUnfolded) {
  return {
    siteTitle: 'Docs',
    sidePanel: {
      tree: [{
        id: 'wrap',
        text: 'All',
        part: true,
        docPageAlias: 'example',
        ...(isSidebarRootUnfolded ? { isSidebarRootUnfolded: true } : {}),
        children: [
          { doc: '~example:example/a.md', docPageAlias: 'example' },
          { id: 'inner', text: 'Inner', docPageAlias: 'example', children: [{ doc: '~example:example/b.md', docPageAlias: 'example' }] },
        ],
      }],
    },
  };
}

test('an unfolded root keeps its item, part and children; only the folder is marked, and the render key differs', () => {
  const folded = buildPageTreeModel(configDocBuild(false), fileManifest);
  const unfolded = buildPageTreeModel(configDocBuild(true), fileManifest);
  const folderUnfolded = unfolded.treePage.children[0];
  assert.equal(folderUnfolded.$id, 'wrap');
  assert.equal(folderUnfolded.isSidebarRootUnfolded, true);
  assert.equal(folded.treePage.children[0].isSidebarRootUnfolded, undefined);
  // the child folder is an ordinary folder
  assert.equal(folderUnfolded.children[1].isSidebarRootUnfolded, undefined);
  assert.equal(folderUnfolded.children[1].$id, 'inner');
  // the semantic model is the same: items, part, outline
  assert.deepEqual([...unfolded.itemById.keys()], [...folded.itemById.keys()]);
  assert.ok(unfolded.partById.has('wrap'));
  assert.deepEqual(unfolded.itemOutlineById.get('wrap').kind, 'folder');
  // another tree for fumadocs, the same item ids
  assert.notEqual(unfolded.treePage.$id, folded.treePage.$id);
  assert.equal(buildPageTreeModel(configDocBuild(true), fileManifest).treePage.$id, unfolded.treePage.$id);
});
