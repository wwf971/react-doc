import assert from 'node:assert/strict';
import test from 'node:test';
import { objectCompleteChoose, objectCompleteHintGet, objectCompleteItemListGet, objectCompleteParamParse } from './doc-object-complete.js';
import { objectRefInnerBuild, objectRefInnerSplit, objectRefParse } from './doc-object-ref.js';
import {
  objectFrontendAssetIndexBuild, objectFrontendInnerCompleteDefault, objectFrontendInnerModeGet, objectFrontendInnerRefBuild, objectFrontendInnerResolveDefault, objectFrontendRefSplit,
} from './doc-object-frontend.js';

// a registry as /object reads it: two providers, one listing what is inside its objects
const typeById = {
  'example.reading-list': { id: 'example.reading-list', label: 'Reading list', kind: 'object', icon: 'book', definedBy: { kind: 'docPage', alias: 'example' } },
  'doc.document': { id: 'doc.document', label: 'Markdown document', kind: 'object' },
  'doc.link': { id: 'doc.link', label: 'Link', kind: 'relation' },
};
const objectList = [
  { ref: 'frontend:w5j7', typeList: ['example.reading-list'], label: 'Reading list', description: 'books', capabilityList: ['read', 'innerComplete'], status: 'found' },
  { ref: 'frontend:w5k8', typeList: ['example.reading-list'], label: 'Short list', description: '', capabilityList: ['read', 'innerComplete'], status: 'found' },
  { ref: 'doc:~example:root/guide.md', typeList: ['doc.document'], label: 'Guide', description: '~example:root/guide.md', capabilityList: ['read'], status: 'found' },
];
const registry = {
  providerList: [
    { id: 'doc-source', namespaceList: ['doc'], capabilityList: ['query'], typeList: ['doc.document'] },
    { id: 'frontend', namespaceList: ['frontend'], capabilityList: ['query', 'innerComplete'], typeList: ['example.reading-list'] },
    { id: 'doc-link', namespaceList: [], capabilityList: ['relationQuery'], typeList: [] },
  ],
  providerStatusGet: () => ({ status: 'ready' }),
  providerOfRefGet: (ref) => registry.providerList.find((provider) => provider.namespaceList.includes(objectRefParse(ref)?.namespace)),
  typeGet: (typeId) => typeById[typeId],
  typeLabelGet: (typeId) => typeById[typeId]?.label ?? typeId,
  queryStateGet: ({ typeList }) => ({ status: 'done', result: { objectList: objectList.filter((one) => one.typeList[0] === typeList[0]) } }),
  resolveStateGet: (ref) => ({ status: 'done', descriptor: objectList.find((one) => one.ref === ref) ?? { ref, typeList: [], label: ref, status: 'missing', message: `no object ${ref}` } }),
  innerCompleteGet: (ref, text) => {
    if (!ref.startsWith('frontend:')) return { status: 'none', itemList: [], message: 'lists nothing inside its objects' };
    const all = [
      { kind: 'dir', text: '/book/', label: 'book/', detail: '2 items' },
      { kind: 'item', ref: `${ref}#/book/sci-fi/dune`, label: 'Dune', detail: 'Book' },
    ];
    return { status: 'done', itemList: text.startsWith('/book/') ? [all[1]] : [all[0]], message: '' };
  },
};

test('the parameter says how far the walk is: a type, an object, inside it', () => {
  assert.deepEqual(objectCompleteParamParse('', registry), { stage: 'type', wordList: [] });
  assert.deepEqual(objectCompleteParamParse('read list', registry), { stage: 'type', wordList: ['read', 'list'] });
  assert.deepEqual(objectCompleteParamParse('example.reading-list/sho', registry), { stage: 'object', typeId: 'example.reading-list', wordList: ['sho'] });
  assert.deepEqual(objectCompleteParamParse('frontend:w5j7', registry), { stage: 'inner', ref: 'frontend:w5j7', inner: '', isInner: false });
  assert.deepEqual(objectCompleteParamParse('frontend:w5j7#/book/sci-', registry), { stage: 'inner', ref: 'frontend:w5j7', inner: '/book/sci-', isInner: true });
  // a reference with slashes of its own is a reference, not a type and words
  assert.equal(objectCompleteParamParse('doc:~example:root/guide.md', registry).stage, 'inner');
  // a namespace nobody provides is words
  assert.equal(objectCompleteParamParse('nobody:x', registry).stage, 'type');
});

test('a type, then an object, then what is inside it', () => {
  // the types of the providers that list objects (relations and providers without a query left
  // out), those somebody declares before the built-in ones
  const typeList = objectCompleteItemListGet('', registry);
  assert.deepEqual(typeList.map((item) => [item.kind, item.typeId]), [['type', 'example.reading-list'], ['type', 'doc.document']]);
  assert.deepEqual(objectCompleteItemListGet('markdown', registry).map((item) => item.typeId), ['doc.document']);
  assert.deepEqual(objectCompleteChoose(typeList[0]), { paramNext: 'example.reading-list/' });

  const listOfType = objectCompleteItemListGet('example.reading-list/', registry);
  assert.deepEqual(listOfType.map((item) => [item.label, item.isInner]), [['Reading list', true], ['Short list', true]]);
  assert.deepEqual(objectCompleteItemListGet('example.reading-list/short', registry).map((item) => item.ref), ['frontend:w5k8']);
  // an object whose provider lists what is inside it is walked into; another is written at once
  assert.deepEqual(objectCompleteChoose(listOfType[0]), { paramNext: 'frontend:w5j7' });
  assert.deepEqual(objectCompleteChoose(objectCompleteItemListGet('doc.document/', registry)[0]), { ref: 'doc:~example:root/guide.md' });

  const listOfObject = objectCompleteItemListGet('frontend:w5j7', registry);
  assert.deepEqual(listOfObject.map((item) => item.kind), ['self', 'dir']);
  assert.deepEqual(objectCompleteChoose(listOfObject[0]), { ref: 'frontend:w5j7' });
  assert.deepEqual(objectCompleteChoose(listOfObject[1]), { paramNext: 'frontend:w5j7#/book/' });
  const listInside = objectCompleteItemListGet('frontend:w5j7#/book/', registry);
  assert.deepEqual(listInside.map((item) => [item.kind, item.ref]), [['item', 'frontend:w5j7#/book/sci-fi/dune']]);
  assert.deepEqual(objectCompleteChoose(listInside[0]), { ref: 'frontend:w5j7#/book/sci-fi/dune' });
});

test('what cannot be listed says why, and is not chosen', () => {
  const none = objectCompleteItemListGet('nothing-like-this', registry);
  assert.deepEqual(none.map((item) => item.kind), ['note']);
  assert.equal(objectCompleteChoose(none[0]), undefined);
  assert.equal(objectCompleteItemListGet('frontend:gone', registry)[0].kind, 'note');
  // an object with nothing listed inside is still written as itself
  assert.deepEqual(objectCompleteItemListGet('doc:~example:root/guide.md', registry).map((item) => item.kind), ['self']);
});

test('the hint names what the parameter has reached', () => {
  assert.equal(objectCompleteHintGet('', registry), '');
  assert.equal(objectCompleteHintGet('example.reading-list/', registry), 'Reading list: choose one');
  assert.equal(objectCompleteHintGet('frontend:w5j7#/book/', registry), 'Reading list › Reading list › inside: /book/');
});

test('an inner reference is the reference of the object, "#", and what names the thing inside', () => {
  assert.deepEqual(objectRefInnerSplit('frontend:w5j7#/book/a#b'), { ref: 'frontend:w5j7', inner: '/book/a#b', isInner: true });
  assert.deepEqual(objectRefInnerSplit('frontend:w5j7'), { ref: 'frontend:w5j7', inner: '', isInner: false });
  assert.equal(objectRefInnerBuild('frontend:w5j7', '/book/'), 'frontend:w5j7#/book/');
  assert.deepEqual(objectFrontendRefSplit('frontend:w5j7#/book/dune'), { id: 'w5j7', ref: 'frontend:w5j7', innerPath: '/book/dune', isInner: true });
  assert.deepEqual(objectFrontendRefSplit('w5j7'), { id: 'w5j7', ref: 'frontend:w5j7', innerPath: '', isInner: false });
  assert.equal(objectFrontendRefSplit('doc:x#y').id, '');
  assert.equal(objectFrontendInnerRefBuild('frontend:w5j7', '/book/dune'), 'frontend:w5j7#/book/dune');
});

test('by default an inner path is an asset reference, completed along the asset paths', () => {
  const index = objectFrontendAssetIndexBuild([
    { key: 'book-1', kind: 'book', itemId: 'i1', name: 'Dune', pathList: ['/book/{sci-fi/frank-herbert/}dune'], status: 'found' },
    { key: 'book-2', kind: 'book', itemId: 'i2', name: 'Emma', pathList: ['/book/classic/emma'], status: 'missing' },
    { key: 'progress', kind: 'progress', itemId: 'i3', status: 'found' },
  ]);
  const kindLabelOf = (kind) => ({ book: 'Book' }[kind] ?? kind);
  const dune = objectFrontendInnerResolveDefault(index, '/book/frank-herbert/sci-fi/dune', kindLabelOf);
  assert.deepEqual([dune.status, dune.path, dune.label, dune.kind, dune.detail], ['found', '/book/frank-herbert/sci-fi/dune', 'Dune', 'book', 'Book · /book/sci-fi/frank-herbert/dune']);
  // by its key: the path kept is its first path; one without a path keeps its key
  assert.equal(objectFrontendInnerResolveDefault(index, 'book-1').path, '/book/sci-fi/frank-herbert/dune');
  assert.deepEqual([objectFrontendInnerResolveDefault(index, 'progress').path, objectFrontendInnerResolveDefault(index, 'progress').label], ['progress', 'progress']);
  assert.equal(objectFrontendInnerResolveDefault(index, '/book/classic/emma').status, 'missing');
  assert.equal(objectFrontendInnerResolveDefault(index, '/book/none').status, 'unknown');

  // the top: the folders, and the assets no path indexes
  assert.deepEqual(objectFrontendInnerCompleteDefault(index, '', kindLabelOf).map((item) => [item.kind, item.path]), [['dir', '/book/'], ['item', 'progress']]);
  assert.deepEqual(objectFrontendInnerCompleteDefault(index, '/book/', kindLabelOf).map((item) => item.path), ['/book/classic/', '/book/frank-herbert/', '/book/sci-fi/']);
  assert.deepEqual(objectFrontendInnerCompleteDefault(index, '/book/sci-fi/frank-herbert/', kindLabelOf).map((item) => [item.kind, item.path, item.label]), [['item', '/book/sci-fi/frank-herbert/dune', 'Dune']]);
  // words that are no path: the assets whose name or key holds them, by their first path
  assert.deepEqual(objectFrontendInnerCompleteDefault(index, 'dun', kindLabelOf).map((item) => [item.kind, item.path, item.label]), [['item', '/book/sci-fi/frank-herbert/dune', 'Dune']]);
  assert.deepEqual(objectFrontendInnerCompleteDefault(index, 'book-', kindLabelOf).map((item) => item.label), ['Dune', 'Emma']);
  assert.deepEqual(objectFrontendInnerCompleteDefault(index, 'bo', kindLabelOf).map((item) => item.path), ['/book/', '/book/sci-fi/frank-herbert/dune', '/book/classic/emma']);
});

test('the mode showing one thing of an object is the one declaring pathParam', () => {
  assert.equal(objectFrontendInnerModeGet([{ id: 'shelf' }, { id: 'book', pathParam: 'book' }, { id: 'note', pathParam: 'note' }]).id, 'book');
  assert.equal(objectFrontendInnerModeGet([{ id: 'shelf' }]), undefined);
});
