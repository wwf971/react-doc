import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectSearchMatch, objectSearchParse, objectSearchPlanBuild, objectSearchProviderFieldsBuild, objectSearchFieldsBuild } from './doc-object-search.js';
import { typeBuiltinList, typeRegistryBuild } from './doc-object-type.js';
import { DocObjectStore } from '../store/DocObjectStore.ts';
import { objectProviderBackendCreate } from './doc-object-provider-backend.js';

// the search of the object service layer (doc_page_impl_obj_search.md)

const typeRegistry = typeRegistryBuild(typeBuiltinList);

test('the grammar: words in any order, keys, quoted words, references', () => {
  const { tokenList, refList } = objectSearchParse('in:todos  "buy milk" type:task doc:~example:example/a.md#setup');
  assert.deepEqual(tokenList.map((token) => [token.key, token.value]), [
    ['in', 'todos'], ['', 'buy milk'], ['type', 'task'], ['', 'doc:~example:example/a.md#setup'],
  ]);
  assert.deepEqual(refList, ['doc:~example:example/a.md#setup']);
  assert.deepEqual(objectSearchParse('   ').tokenList, []);
});

test('the plan: a word the host matches is met by all its objects; in: and type: exclude a provider at once', () => {
  const provider = { id: 'service:w55j3ztn3rq', label: 'example todos', serviceId: 'w55j3ztn3rq', templateName: 'todo-list', namespaceList: ['service.w55j3ztn3rq'], typeList: ['core.task'] };
  const fields = objectSearchProviderFieldsBuild(provider, typeRegistry);
  const plan = objectSearchPlanBuild(objectSearchParse('todos milk').tokenList, fields);
  assert.equal(plan.isCandidate, true);
  assert.deepEqual(plan.tokenListObject.map((token) => token.value), ['milk']);
  assert.equal(plan.textPush, 'milk');
  assert.equal(objectSearchPlanBuild(objectSearchParse('in:notes milk').tokenList, fields).isCandidate, false);
  assert.equal(objectSearchPlanBuild(objectSearchParse('type:document').tokenList, fields).isCandidate, false);
  assert.equal(objectSearchPlanBuild(objectSearchParse('type:task').tokenList, fields).isCandidate, true);
  assert.equal(objectSearchPlanBuild(objectSearchParse('w55j3').tokenList, fields).tokenListObject.length, 0);
});

test('a match: every token, in some field; the name first', () => {
  const descriptor = { ref: 'service.w55j3ztn3rq:todo/3', typeList: ['core.task'], label: 'Buy milk', description: 'a todo', summary: {}, provider: { label: 'example todos' } };
  const fields = objectSearchFieldsBuild(descriptor, ['example todos'], typeRegistry);
  assert.ok(objectSearchMatch(fields, objectSearchParse('buy todo/3').tokenList));
  assert.ok(objectSearchMatch(fields, objectSearchParse('task').tokenList));
  assert.equal(objectSearchMatch(fields, objectSearchParse('buy bread').tokenList), undefined);
  const prefix = objectSearchMatch(fields, objectSearchParse('buy').tokenList).score;
  const inside = objectSearchMatch(fields, objectSearchParse('milk').tokenList).score;
  assert.ok(prefix > inside);
});

// a backend of one large provider (3000 objects) and one small (2): the
// search counts first and fetches only the small one, unless narrowed
function storeBuild() {
  const requestList = [];
  const objectListLarge = Array.from({ length: 3000 }, (_, index) => ({ ref: `service.big:item/${index}`, typeList: ['core.task'], label: index === 7 ? 'buy milk' : `item ${index}`, status: 'found' }));
  const objectListSmall = [
    { ref: 'service.small:note/1', typeList: ['core.document'], label: 'milk prices', status: 'found' },
    { ref: 'service.small:note/2', typeList: ['core.document'], label: 'bread', status: 'found' },
  ];
  const providerByIdList = { 'service:big': objectListLarge, 'service:small': objectListSmall };
  const backend = {
    objectCount: async (spec) => {
      requestList.push(['count', spec.text, spec.providerIdList.join(',')]);
      return { code: 0, data: { providerList: spec.providerIdList.map((providerId) => ({ providerId, status: 'answered', countKind: 'exact', count: providerByIdList[providerId].filter((item) => item.label.includes(spec.text)).length })) } };
    },
    objectQuery: async (spec) => {
      requestList.push(['query', spec.text, spec.providerIdList.join(',')]);
      const list = providerByIdList[spec.providerIdList[0]].filter((item) => item.label.includes(spec.text));
      return { code: 0, data: { objectList: list.slice(0, spec.limit) } };
    },
  };
  const serviceStore = {
    backendStatus: 'up',
    objectTypeList: null,
    objectProviderList: [
      { id: 'service:big', label: 'big list', serviceId: 'big', templateName: 'todo-list', namespaceList: ['service.big'], typeList: ['core.task'], capabilityList: ['query', 'count'], status: 'ready' },
      { id: 'service:small', label: 'small notes', serviceId: 'small', templateName: 'note-db', namespaceList: ['service.small'], typeList: ['core.document'], capabilityList: ['query', 'count'], status: 'ready' },
    ],
    objectCall: (call) => call(backend),
    backendUrlGet: (path) => path,
    instanceListOfTemplateName: () => [],
  };
  // the backend reached as the page reaches it: through its peer provider
  const store = new DocObjectStore();
  store.providerAdd(objectProviderBackendCreate({ serviceStore }));
  return { store, requestList };
}

test('a host name alone counts, and fetches nothing of a host too large', async () => {
  const { store, requestList } = storeBuild();
  const result = await store.searchStore.search({ text: 'big', fetchMax: 50 });
  assert.equal(result.objectList.length, 0);
  const summary = result.providerList.find((item) => item.providerId === 'service:big');
  assert.equal(summary.status, 'counted');
  assert.equal(summary.count, 3000);
  assert.equal(summary.isExpandable, true);
  assert.ok(!requestList.some(([kind, , providerId]) => kind === 'query' && providerId === 'service:big'));
});

test('a word narrows a large host at the provider; a small host is listed and matched here', async () => {
  const { store, requestList } = storeBuild();
  const result = await store.searchStore.search({ text: 'milk', fetchMax: 50 });
  assert.deepEqual(result.objectList.map((hit) => hit.descriptor.ref).sort(), ['service.big:item/7', 'service.small:note/1']);
  assert.ok(requestList.some(([kind, text, providerId]) => kind === 'query' && text === 'milk' && providerId === 'service:big'));
  assert.ok(requestList.some(([kind, text, providerId]) => kind === 'query' && text === '' && providerId === 'service:small'));
});

test('a host loaded on purpose: its first fetchMax, marked truncated', async () => {
  const { store } = storeBuild();
  const result = await store.searchStore.search({ text: 'big', fetchMax: 20, providerIdExpandList: ['service:big'] });
  assert.equal(result.objectList.length, 20);
  const summary = result.providerList.find((item) => item.providerId === 'service:big');
  assert.equal(summary.isTruncated, true);
  assert.equal(result.isComplete, false);
});

test('in: and type: filters: providers excluded before anything is asked', async () => {
  const { store, requestList } = storeBuild();
  const result = await store.searchStore.search({ text: 'type:document milk' });
  assert.deepEqual(result.objectList.map((hit) => hit.descriptor.ref), ['service.small:note/1']);
  assert.ok(requestList.every(([, , providerId]) => providerId === 'service:small'));
  const resultTyped = await store.searchStore.search({ text: '', typeList: ['core.document'] });
  assert.deepEqual(resultTyped.objectList.map((hit) => hit.descriptor.ref).sort(), ['service.small:note/1', 'service.small:note/2']);
});
