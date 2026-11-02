import assert from 'node:assert/strict';
import test from 'node:test';
import { DocEventRouter } from './doc-event.js';

test('a published event reaches the subscribers of its block, and those of the whole document', async () => {
  const router = new DocEventRouter();
  const received = [];
  router.subscribe({ type: 'placeReveal', sourcePath: '~ex/a.md', sourceLine: 12 }, (data) => {
    received.push(['block 12', data.target, data.subject.blockLine]);
    return { code: 0 };
  });
  router.subscribe({ type: 'placeReveal', sourcePath: '~ex/a.md', sourceLine: 30 }, () => {
    received.push(['block 30']);
  });
  router.subscribe({ type: 'placeReveal', sourcePath: '~ex/a.md' }, () => {
    received.push(['document']);
    return undefined;
  });
  router.subscribe({ type: 'placeReveal', sourcePath: '~ex/b.md', sourceLine: 12 }, () => {
    received.push(['other document']);
  });
  router.subscribe({ type: 'otherEvent', sourcePath: '~ex/a.md', sourceLine: 12 }, () => {
    received.push(['other type']);
  });

  const result = await router.publish({
    type: 'placeReveal',
    subject: { sourcePath: '~ex/a.md', blockLine: 12 },
    data: { target: 'b.md' },
  });
  assert.deepEqual(received, [['block 12', 'b.md', 12], ['document']]);
  assert.equal(result.isAccepted, true);
  assert.deepEqual(result.resultList, [{ code: 0, data: undefined, message: '' }]);
});

test('an ended subscription receives nothing; a failing listener is passed over', async () => {
  const router = new DocEventRouter();
  const received = [];
  const unsubscribe = router.subscribe({ type: 'placeReveal', sourcePath: '~ex/a.md', sourceLine: 1 }, () => {
    received.push('gone');
  });
  router.subscribe({ type: 'placeReveal', sourcePath: '~ex/a.md', sourceLine: 1 }, () => {
    throw new Error('boom');
  });
  router.subscribe({ type: 'placeReveal', sourcePath: '~ex/a.md', sourceLine: 1 }, () => {
    received.push('after');
    return { code: -1, message: 'not here' };
  });
  unsubscribe();
  unsubscribe();
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const result = await router.publish({ type: 'placeReveal', subject: { sourcePath: '~ex/a.md', blockLine: 1 } });
    assert.deepEqual(received, ['after']);
    assert.equal(result.isAccepted, false);
    assert.equal(result.resultList.length, 1);
  } finally {
    console.error = errorOriginal;
  }
});

test('an event of a type nobody subscribed to is accepted by nobody', async () => {
  const router = new DocEventRouter();
  const result = await router.publish({ type: 'placeReveal', subject: { sourcePath: '~ex/a.md', blockLine: 1 } });
  assert.deepEqual(result, { resultList: [], isAccepted: false });
});
