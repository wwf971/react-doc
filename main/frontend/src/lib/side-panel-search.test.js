import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPageTreeModel } from './page-tree.js';
import { textLocalizedGet } from './text-localized.js';
import { sidePanelSearchEntryListBuild, sidePanelSearchMatch } from './side-panel-search.js';

// the search of the side panel (doc_page_impl_side_panel.md#searching-the-items):
// the items the reader sees, by their names as displayed, with the path of
// sections and folders above them; the search stops at an item mirroring a
// source folder, and an item generated below one is never found.

const entryOf = (name, extra = {}) => ({
  internalPath: `~example:example/${name}`, docPageAlias: 'example', rootAlias: 'example',
  relPath: name, name: name.split('/').at(-1), title: extra.title ?? name, ext: 'md', ...extra,
});

const fileManifest = [
  entryOf('overview.md', { title: 'Overview' }),
  entryOf('image.md', { title: 'Image component' }),
  entryOf('topics/install.md', { title: 'Install guide' }),
  entryOf('topics/advanced/tuning.md', { title: 'Tuning' }),
  { ...entryOf('second.md', { title: 'Second overview' }), internalPath: '~second:second/second.md', docPageAlias: 'second', rootAlias: 'second' },
];

const configDoc = {
  siteTitle: 'Docs',
  sidePanel: {
    tree: [
      {
        id: 'doc-page-example', text: 'example', docPageAlias: 'example',
        docPageSection: { alias: 'example', isFirst: true },
        children: [{
          // the sole root, unfolded and bound: its root row is an entry, no level of the path
          id: 'root', doc: '~example:example/overview.md', docPageAlias: 'example', isSidebarRootUnfolded: true,
          children: [
            { separator: 'Components', docPageAlias: 'example' },
            { id: 'comp', text: { en: 'MDX Components', jp: 'MDX部品' }, docPageAlias: 'example', children: [
              { doc: '~example:example/image.md', docPageAlias: 'example' },
              { id: 'grid-panel', text: 'Image grid panel', panel: { component: 'GridPanel' }, docPageAlias: 'example' },
            ] },
            { id: 'topics', text: 'Topics', sourceFolder: '~example:example/topics', docPageAlias: 'example' },
          ],
        }],
      },
      {
        id: 'doc-page-second', text: 'second', docPageAlias: 'second',
        docPageSection: { alias: 'second', isFirst: false },
        children: [{ doc: '~second:second/second.md', docPageAlias: 'second' }],
      },
    ],
  },
};

const model = buildPageTreeModel(configDoc, fileManifest);
const entryListBuild = (language = 'en') => sidePanelSearchEntryListBuild(model.treePage, {
  outlineGet: (itemId) => model.itemOutlineById.get(itemId),
  textGet: (outline) => (outline ? textLocalizedGet(outline.textLocalized, language).text : ''),
});

test('the entries are the items shown, in tree order, with where each stands', () => {
  const entryList = entryListBuild();
  assert.deepEqual(entryList.map((entry) => [entry.text, entry.kind, entry.pathList.join(' › ')]), [
    ['Overview', 'folderDoc', 'example'],
    ['Components', 'separator', 'example'],
    ['MDX Components', 'folder', 'example'],
    ['Image component', 'doc', 'example › MDX Components'],
    ['Image grid panel', 'panel', 'example › MDX Components'],
    ['Topics', 'sourceFolder', 'example'],
    ['Second overview', 'doc', 'second'],
  ]);
  const image = entryList.find((entry) => entry.text === 'Image component');
  assert.deepEqual(image.ancestorIdList, ['doc-page-example', 'comp'], 'the section and the folder, to open; the unfolded root is no level');
  assert.match(image.route, /^\/__doc-item\//);
  assert.equal(entryList.find((entry) => entry.text === 'Components').route, '', 'a separator has no route');
});

test('the search stops at a source folder: its generated files and folders are not entries', () => {
  const textList = entryListBuild().map((entry) => entry.text);
  assert.ok(textList.includes('Topics'));
  for (const text of ['Install guide', 'advanced', 'Tuning']) assert.ok(!textList.includes(text), text);
  assert.ok([...model.itemOutlineById.values()].some((outline) => outline.text === 'Install guide'), 'it is in the tree, generated');
});

test('labels are searched as displayed, in the page language', () => {
  const textList = entryListBuild('jp').map((entry) => entry.text);
  assert.ok(textList.includes('MDX部品'));
  assert.equal(entryListBuild('jp').find((entry) => entry.text === 'Image component').pathList.at(-1), 'MDX部品');
});

test('every word, in any order; the name starting with the query first, then holding it, then its words apart', () => {
  const entryList = entryListBuild();
  const textList = (query) => sidePanelSearchMatch(entryList, query).resultList.map((result) => result.entry.text);
  assert.deepEqual(textList('image'), ['Image component', 'Image grid panel']);
  assert.deepEqual(textList('overview'), ['Overview', 'Second overview']);
  assert.deepEqual(textList('panel image'), ['Image grid panel']);
  assert.deepEqual(textList('COMP'), ['Components', 'MDX Components', 'Image component']);
  assert.deepEqual(textList('install'), [], 'a generated file is not found');
  assert.deepEqual(sidePanelSearchMatch(entryList, '  grid   image ').wordList, ['grid', 'image']);
  assert.deepEqual(sidePanelSearchMatch(entryList, '   ').resultList, []);
  const bounded = sidePanelSearchMatch(entryList, 'o', { countMax: 2 });
  assert.equal(bounded.resultList.length, 2);
  assert.ok(bounded.countMatched > 2);
});
