import assert from 'node:assert/strict';
import test from 'node:test';
import { textLocalizedGet, textLocalizedParse } from './text-localized.js';
import { buildPageTreeModel } from './page-tree.js';

// multilingual side-panel labels: authoring forms, selection, fallback, and
// the tree models every navigation surface reads

test('a plain string label is kept as it is, with no language', () => {
  assert.deepEqual(textLocalizedParse('  Guide '), { textLocalized: 'Guide', message: '' });
  assert.deepEqual(textLocalizedGet('Guide', 'jp'), { language: '', text: 'Guide' });
});

test('a mapping selects the preferred language and falls back to the first authored translation', () => {
  const { textLocalized, message } = textLocalizedParse({ jp: ' 手引き ', en: 'Guide', de: '' });
  assert.equal(message, '');
  assert.deepEqual(textLocalized, { jp: '手引き', en: 'Guide' });
  assert.deepEqual(textLocalizedGet(textLocalized, 'jp'), { language: 'jp', text: '手引き' });
  assert.deepEqual(textLocalizedGet(textLocalized, 'en'), { language: 'en', text: 'Guide' });
  assert.deepEqual(textLocalizedGet(textLocalized, 'fr'), { language: 'jp', text: '手引き' });
});

test('invalid label values are reported instead of accepted', () => {
  assert.equal(textLocalizedParse('').message, 'must be non-empty text.');
  assert.equal(textLocalizedParse(['a']).message, 'must be text or a language mapping.');
  assert.equal(textLocalizedParse(12).message, 'must be text or a language mapping.');
  assert.equal(textLocalizedParse({ jp: '', en: '  ' }).message, 'requires at least one translation.');
  assert.deepEqual(textLocalizedGet(['a'], 'en'), { language: '', text: '' });
});

const fileManifest = [
  { internalPath: '/example/a.md', rootId: 'example', relPath: 'a.md', name: 'a.md', ext: 'md', title: 'A' },
  { internalPath: '/example/b.md', rootId: 'example', relPath: 'b.md', name: 'b.md', ext: 'md', title: 'B' },
];

const configDoc = {
  siteTitle: 'Test',
  sidePanel: {
    tree: [
      { separator: { jp: '例', en: 'Examples' } },
      { doc: '/example/a.md', text: { jp: '文書A', en: 'Document A' } },
      {
        id: 'part',
        text: { en: 'Part', jp: '部' },
        children: [
          { doc: '/example/b.md', text: 'Plain B' },
          { id: 'folder', text: { jp: 'フォルダ' }, children: [] },
        ],
      },
      { id: 'broken', doc: '/example/b.md', text: ['not', 'a', 'label'] },
    ],
  },
};

test('item models keep the authored mapping and a display-safe text at every depth', () => {
  const warnOriginal = console.warn;
  const warningList = [];
  console.warn = (message) => warningList.push(String(message));
  let model;
  try {
    model = buildPageTreeModel(configDoc, fileManifest);
  } finally {
    console.warn = warnOriginal;
  }
  const itemA = [...model.itemById.values()].find((item) => item.docPath === '/example/a.md');
  assert.deepEqual(itemA.textLocalized, { jp: '文書A', en: 'Document A' });
  assert.equal(itemA.text, '文書A');

  const part = model.itemOutlineById.get('part');
  assert.deepEqual(part.textLocalized, { en: 'Part', jp: '部' });
  assert.equal(part.text, 'Part');

  const folder = model.itemOutlineById.get('folder');
  assert.deepEqual(folder.textLocalized, { jp: 'フォルダ' });

  // an invalid label is reported and replaced by the document title
  const broken = model.itemById.get('broken');
  assert.equal(broken.text, 'B');
  assert.equal(broken.textLocalized, 'B');
  assert.ok(warningList.some((message) => message.includes('side panel item "broken": "text" must be text or a language mapping.')));

  for (const outline of model.itemOutlineById.values()) {
    assert.notEqual(outline.text, '[object Object]');
    assert.equal(typeof outline.text, 'string');
  }
});
