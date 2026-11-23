import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageTreeModel } from './page-tree.js';
import { sidePanelItemPathParse, sidePanelItemPathRouteGet } from './side-panel-item-path.js';

// an item of the side panel named by its path (doc_page_impl_side_panel.md#naming-an-item-by-its-path):
// labels or ids from the top down; a section and a sole root unfolded may be named or left out.

const entryOf = (alias, name, title) => ({
  internalPath: `~${alias}:${alias}/${name}`, docPageAlias: alias, rootAlias: alias,
  relPath: name, name: name.split('/').at(-1), title, ext: 'md',
});

const fileManifest = [
  entryOf('maps', 'readme.md', 'map-styles'),
  entryOf('maps', 'block.md', 'Block maps'),
  entryOf('maps', 'block-format.md', 'Block maps: the format'),
  entryOf('maps', 'area.md', 'Japanese areas'),
  entryOf('maps', 'area-design.md', 'Japanese areas: design'),
  entryOf('maps', 'a-b.md', 'In/out'),
  entryOf('second', 'second.md', 'Second overview'),
];

// the side panel of one doc page: a sole root bound to a document, unfolded
const treeMaps = [{
  id: 'map-styles', text: 'map-styles', doc: '~maps:maps/readme.md', docPageAlias: 'maps', isSidebarRootUnfolded: true,
  children: [
    { id: 'map-block', text: 'Block maps', doc: '~maps:maps/block.md', docPageAlias: 'maps', children: [
      { doc: '~maps:maps/block-format.md', docPageAlias: 'maps' },
    ] },
    { separator: 'Areas', docPageAlias: 'maps' },
    { id: 'shikuchoson', text: { en: 'Japanese areas', jp: '市区町村' }, doc: '~maps:maps/area.md', docPageAlias: 'maps', children: [
      { doc: '~maps:maps/area-design.md', docPageAlias: 'maps' },
    ] },
    { id: 'more', text: 'More', docPageAlias: 'maps', children: [
      { doc: '~maps:maps/a-b.md', docPageAlias: 'maps' },
    ] },
  ],
}];

const modelAlone = buildPageTreeModel({ siteTitle: 'Docs', sidePanel: { tree: treeMaps } }, fileManifest);

// the same doc page as a section of a workspace of several
const modelWorkspace = buildPageTreeModel({
  siteTitle: 'Docs',
  sidePanel: {
    tree: [
      { id: 'doc-page-second', text: 'second', docPageAlias: 'second', docPageSection: { alias: 'second', isFirst: true },
        children: [{ doc: '~second:second/second.md', docPageAlias: 'second' }] },
      { id: 'doc-page-maps', text: 'maps', docPageAlias: 'maps', docPageSection: { alias: 'maps', isFirst: false },
        children: treeMaps },
    ],
  },
}, fileManifest);

const docOf = (model, path) => {
  const { route, message } = sidePanelItemPathRouteGet(model, path);
  return route ? model.itemByRoute.get(route)?.docPath : `(none: ${message})`;
};

test('a path is segments split by "/", spaces around them left out, "\\/" a slash inside one', () => {
  assert.deepEqual(sidePanelItemPathParse('map-styles / Japanese areas'), ['map-styles', 'Japanese areas']);
  assert.deepEqual(sidePanelItemPathParse('/More/In\\/out/'), ['More', 'In/out']);
  assert.deepEqual(sidePanelItemPathParse('  Block   maps  '), ['Block maps']);
  assert.deepEqual(sidePanelItemPathParse(''), []);
  assert.deepEqual(sidePanelItemPathParse(undefined), []);
});

test('served alone: labels or ids from the top; the unfolded root named or left out', () => {
  assert.equal(docOf(modelAlone, 'Japanese areas'), '~maps:maps/area.md');
  assert.equal(docOf(modelAlone, 'map-styles / Japanese areas'), '~maps:maps/area.md');
  assert.equal(docOf(modelAlone, 'map-styles/shikuchoson'), '~maps:maps/area.md');
  assert.equal(docOf(modelAlone, 'japanese   AREAS'), '~maps:maps/area.md', 'case and spaces do not count');
  assert.equal(docOf(modelAlone, '市区町村'), '~maps:maps/area.md', 'any language of a label');
  assert.equal(docOf(modelAlone, 'Japanese areas / Japanese areas: design'), '~maps:maps/area-design.md', 'a document item is named by its title');
  assert.equal(docOf(modelAlone, 'More / In\\/out'), '~maps:maps/a-b.md');
  assert.equal(docOf(modelAlone, 'map-styles'), '~maps:maps/readme.md', 'the root itself, its document');
});

test('a folder without a document opens the first document below it', () => {
  assert.equal(docOf(modelAlone, 'More'), '~maps:maps/a-b.md');
});

test('in a workspace of several: the section named by its alias, or left out', () => {
  assert.equal(docOf(modelWorkspace, 'maps / Japanese areas'), '~maps:maps/area.md');
  assert.equal(docOf(modelWorkspace, 'maps / map-styles / Japanese areas'), '~maps:maps/area.md');
  assert.equal(docOf(modelWorkspace, 'Japanese areas'), '~maps:maps/area.md');
  assert.equal(docOf(modelWorkspace, 'maps'), '~maps:maps/readme.md', 'a section opens its first document');
  assert.equal(docOf(modelWorkspace, 'second / Second overview'), '~second:second/second.md');
});

test('one segment naming nothing at the top is an id anywhere; anything else unknown names nothing', () => {
  const modelDeep = buildPageTreeModel({ siteTitle: 'Docs', sidePanel: { tree: [
    { id: 'top', text: 'Top', docPageAlias: 'maps', children: [
      { id: 'deep', text: 'Deep', doc: '~maps:maps/area.md', docPageAlias: 'maps' },
    ] },
  ] } }, fileManifest);
  assert.equal(docOf(modelDeep, 'deep'), '~maps:maps/area.md');
  assert.equal(docOf(modelDeep, 'Deep'), '(none: "Deep" names no item at the top of the side panel)', 'a label is looked up only at its level');
  assert.equal(docOf(modelAlone, 'Japanese areas / Nowhere'), '(none: "Nowhere" names no item in "Japanese areas")');
  assert.equal(docOf(modelAlone, 'Areas'), '(none: "Areas" names no item at the top of the side panel)', 'a separator is never named');
  assert.equal(docOf(modelAlone, ' / '), '(none: the path names no item)');
});
