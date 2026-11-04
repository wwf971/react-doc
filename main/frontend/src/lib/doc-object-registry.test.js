import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeBuiltinList, typeDefineNormalize, typeRegistryBuild } from './doc-object-type.js';
import { objectRefParse, objectRequestKeyBuild } from './doc-object-ref.js';
import { DocObjectStore } from '../store/DocObjectStore.ts';

// the object registry of the page (doc_page_impl_obj.md): the types, and the
// registry over providers that answer, fail, answer partly, or are away

test('the built-in types: one DAG, multiple inheritance, roots for unknown types', () => {
  const registry = typeRegistryBuild(typeBuiltinList);
  assert.deepEqual(registry.problemList, []);
  assert.ok(registry.isAssignable('doc.group', 'core.group'));
  assert.ok(registry.isAssignable('doc.group', 'doc.block'));
  assert.ok(registry.isAssignable('doc.group', 'core.place'));
  assert.ok(registry.isAssignable('doc.document', 'core.collection'));
  assert.ok(!registry.isAssignable('core.collection', 'doc.document'));
  assert.ok(registry.isAssignable('doc.link', 'core.reference'));
  assert.ok(!registry.isAssignable('doc.link', 'core.object'));
  // a type nobody defines is an object (and a relation): drawn at least by the fallback
  assert.ok(registry.isAssignable('nobody.knows', 'core.object'));
  assert.equal(registry.distanceGet(['doc.group'], 'core.group'), 1);
  assert.equal(registry.distanceGet(['doc.group'], 'core.object'), 3);
  assert.equal(registry.distanceGet(['doc.group'], 'core.task'), undefined);
  // of two parents at one distance, the one a type lists first ranks first
  assert.ok(registry.rankGet(['doc.document'], 'core.document') < registry.rankGet(['doc.document'], 'core.collection'));
  assert.ok(registry.rankGet(['doc.section'], 'core.place') < registry.rankGet(['doc.section'], 'core.collection'));
  assert.ok(registry.rankGet(['doc.group'], 'core.collection') < registry.rankGet(['doc.group'], 'core.place'));
  assert.equal(registry.rankGet(['doc.group'], 'core.task'), undefined);
});

test('a type registry reports parents nobody defines and breaks cycles', () => {
  const registry = typeRegistryBuild([
    ...typeBuiltinList,
    typeDefineNormalize({ id: 'x.a', extendList: ['x.b'] }, { kind: 'test' }),
    typeDefineNormalize({ id: 'x.b', extendList: ['x.a'] }, { kind: 'test' }),
    typeDefineNormalize({ id: 'x.c', extendList: ['x.gone'] }, { kind: 'test' }),
  ]);
  assert.ok(registry.problemList.some((problem) => problem.includes('cycle')));
  assert.ok(registry.problemList.some((problem) => problem.includes('x.gone')));
  assert.ok(registry.isAssignable('x.c', 'core.object'));
  // the edge that closed the cycle is dropped: one direction remains
  assert.notEqual(registry.isAssignable('x.a', 'x.b'), registry.isAssignable('x.b', 'x.a'));
});

test('references and request keys', () => {
  assert.deepEqual(objectRefParse('doc:~example:root/a.md#Setup'), { namespace: 'doc', local: '~example:root/a.md#Setup' });
  assert.deepEqual(objectRefParse('service.w55j3ztn3rq:todo/1'), { namespace: 'service.w55j3ztn3rq', local: 'todo/1' });
  assert.equal(objectRefParse('nope'), undefined);
  assert.equal(objectRequestKeyBuild({ b: 1, a: { d: 2, c: 3 } }), objectRequestKeyBuild({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(objectRequestKeyBuild({ filter: { isDone: true } }), objectRequestKeyBuild({ filter: {} }));
});

function providerBuild(overrides) {
  return {
    id: 'test',
    label: 'test provider',
    registry: 'page',
    namespaceList: ['t'],
    typeList: ['core.task'],
    relationTypeList: [],
    capabilityList: ['query', 'resolve'],
    cacheSecond: 60,
    query: () => [],
    resolve: (refList) => refList.map(() => null),
    ...overrides,
  };
}

test('a query is federated, filtered by type, and says how complete it is', async () => {
  const store = new DocObjectStore();
  store.providerAdd(providerBuild({
    id: 'tasks',
    query: () => [
      { ref: 't:1', typeList: ['core.task'], label: 'one' },
      { ref: 't:doc', typeList: ['core.document'], label: 'not a task, dropped' },
    ],
  }));
  store.providerAdd(providerBuild({ id: 'docs', namespaceList: ['d'], typeList: ['core.document'], query: () => [{ ref: 'd:1', typeList: ['core.document'], label: 'a document' }] }));
  store.providerAdd(providerBuild({ id: 'broken', namespaceList: ['b'], query: () => { throw new Error('the disk is gone'); } }));
  store.providerAdd(providerBuild({ id: 'partial', namespaceList: ['p'], query: () => ({ objectList: [{ ref: 'p:1', typeList: ['core.task'], label: 'some' }], isComplete: false, message: 'loaded ones only' }) }));
  store.providerAdd(providerBuild({ id: 'away', namespaceList: ['a'], statusGet: () => ({ status: 'unavailable', message: 'down' }) }));

  const result = await store.query({ typeList: ['core.task'] });
  assert.deepEqual(result.objectList.map((item) => item.ref), ['t:1', 'p:1']);
  assert.equal(result.completeness.isComplete, false);
  const statusById = Object.fromEntries(result.completeness.providerList.map((item) => [item.providerId, item.status]));
  // the provider of documents is not asked for tasks
  assert.deepEqual(statusById, { tasks: 'answered', broken: 'failed', partial: 'partial', away: 'unavailable' });
  // what a query answered is what the registry knows of the reference
  assert.equal(store.resolveByRef.get('t:1').descriptor.label, 'one');

  const resultObject = await store.query({ typeList: ['core.object'], text: 'document' });
  assert.deepEqual(resultObject.objectList.map((item) => item.ref), ['d:1']);
});

test('a reference resolves to its provider; what is known is kept when it cannot answer', async () => {
  let isUp = true;
  let isThere = true;
  const store = new DocObjectStore();
  store.providerAdd(providerBuild({
    statusGet: () => (isUp ? { status: 'ready', message: '' } : { status: 'unavailable', message: 'the provider is away' }),
    resolve: (refList) => refList.map((ref) => (isThere ? { ref, typeList: ['core.task'], label: `task ${ref}` } : null)),
  }));
  assert.equal((await store.resolve('t:1')).status, 'found');
  isUp = false;
  const unavailable = await store.resolve('t:1', { isVerify: true });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.label, 'task t:1');
  isUp = true;
  isThere = false;
  const missing = await store.resolve('t:1', { isVerify: true });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.label, 'task t:1');
  assert.equal((await store.resolve('nobody:1')).status, 'unknown');
  assert.equal((await store.resolve('not a reference')).status, 'unknown');
});

test('a registration is known, not verified; a provider\'s namespace is its own', async () => {
  const store = new DocObjectStore();
  store.providerAdd(providerBuild({}));
  assert.equal(store.register([{ ref: 't:9', typeList: ['core.task'] }], { kind: 'component', id: 'x' }).code, -2);
  assert.equal(store.register([{ ref: 'web:https://example.org', typeList: ['core.document'], label: 'a page' }], { kind: 'component', id: 'x' }).code, 0);
  assert.equal((await store.resolve('web:https://example.org')).status, 'registered');
  const result = await store.query({ typeList: ['core.document'] });
  assert.deepEqual(result.objectList.map((item) => [item.ref, item.status]), [['web:https://example.org', 'registered']]);
});

test('the view of an object: the nearest type, then the priority; the fallback otherwise', () => {
  const compById = {
    'common/ObjectViewFallback': { CompRender: () => null, expose: { objectView: { typeList: ['core.object'], contextList: ['icon', 'inline', 'card', 'block'], priority: -100 } } },
    'x/CollectionView': { CompRender: () => null, expose: { objectView: { typeList: ['core.collection'], contextList: ['card'], priority: 0 } } },
    'x/GroupView': { CompRender: () => null, expose: { objectView: { typeList: ['core.group'], contextList: ['card'], priority: 0 } } },
    'x/GroupViewLow': { CompRender: () => null, expose: { objectView: { typeList: ['core.group'], contextList: ['card'], priority: -1 } } },
  };
  const store = new DocObjectStore({ docStore: { compById } });
  const descriptor = { ref: 'doc:a#g', typeList: ['doc.group'] };
  assert.equal(store.viewResolve(descriptor, 'card').compId, 'x/GroupView');
  assert.equal(store.viewResolve(descriptor, 'card', 'x/CollectionView').compId, 'x/CollectionView');
  assert.equal(store.viewResolve(descriptor, 'icon').compId, 'common/ObjectViewFallback');
  assert.equal(store.viewResolve({ ref: 't:1', typeList: ['core.task'] }, 'card').compId, 'common/ObjectViewFallback');
});

test('a provider brings types, components and the opening of its objects; the registry knows no layer', async () => {
  let isServing = false;
  const openedList = [];
  const store = new DocObjectStore({ docStore: { compById: {} } });
  store.providerAdd(providerBuild({
    id: 'services',
    namespaceList: ['s'],
    typeList: ['x.todo'],
    typeDefineGet: () => ({ typeList: [typeDefineNormalize({ id: 'x.todo', extendList: ['core.task'] }, { kind: 'serviceTemplate', name: 'x' })], problemList: ['a problem of the backend'] }),
    compListGet: () => [
      { compId: 'service/x/comp/card', label: 'card', sourceLabel: 'template x', objectView: { typeList: ['core.task'], contextList: ['card'], priority: 0 }, isAvailable: isServing, unavailableReason: 'no ready instance' },
      { compId: 'service/x/comp/chart', label: 'chart', sourceLabel: 'template x', isAvailable: isServing, unavailableReason: 'no ready instance' },
    ],
    resolve: (refList) => refList.map((ref) => ({ ref, typeList: ['x.todo'], label: 'a todo', open: { kind: 'serviceInstance', serviceId: 'w1' } })),
    open: (descriptor) => {
      openedList.push(descriptor.ref);
      return true;
    },
  }));
  // the types it defines join the built-in ones
  assert.ok(store.typeRegistry.isAssignable('x.todo', 'core.task'));
  assert.ok(store.typeProblemList.includes('a problem of the backend'));
  // its view is drawn only while it serves it; its other components are requirements too
  assert.equal(store.viewResolve({ ref: 's:1', typeList: ['x.todo'] }, 'card').compId, 'common/ObjectViewFallback');
  assert.equal(store.requireStatusGet({ kind: 'objectView', value: 'core.task', context: 'card' }).status, 'unavailable');
  assert.equal(store.requireStatusGet({ kind: 'comp', value: 'service/x/comp/chart' }).status, 'unavailable');
  assert.equal(store.requireStatusGet({ kind: 'comp', value: 'service/y/comp/gone' }).status, 'missing');
  isServing = true;
  assert.equal(store.viewResolve({ ref: 's:1', typeList: ['x.todo'] }, 'card').compId, 'service/x/comp/card');
  assert.equal(store.requireStatusGet({ kind: 'comp', value: 'service/x/comp/chart' }).status, 'satisfied');
  // its objects open where its own layer shows them
  assert.equal(await store.open('s:1'), true);
  assert.deepEqual(openedList, ['s:1']);
});
