import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compStateKeyBuild,
  compStateKeyParse,
  lineShiftApply,
  lineShiftListGet,
} from './doc-comp-state.js';
import { DocCompStateStore } from '../store/DocCompStateStore.ts';

// ---------- keys ----------

test('the key rule: asset object, then id prop, then place, then instance', () => {
  const assetInfo = { isFromAsset: true, store: 'local', objectId: 'w4r63zmeaor' };
  assert.equal(
    compStateKeyBuild({ assetInfo, docPath: '~example/a.md', id: 'x', sourceLine: 12, instanceId: 'i' }),
    'asset:local/w4r63zmeaor',
  );
  assert.equal(compStateKeyBuild({ docPath: '~example/a.md', id: ' x ', sourceLine: 12, instanceId: 'i' }), 'id:~example/a.md#x');
  assert.equal(compStateKeyBuild({ docPath: '~example/a.md', sourceLine: 12, instanceId: 'i' }), 'place:~example/a.md:12');
  assert.equal(compStateKeyBuild({ docPath: '~example/a.md', instanceId: 'Comp:33' }), 'instance:Comp:33');
  assert.equal(compStateKeyBuild({ assetInfo: { isFromAsset: false }, instanceId: 'i' }), 'instance:i');
  // an id without a document, and a line without a document, say nothing
  assert.equal(compStateKeyBuild({ id: 'x', sourceLine: 3, instanceId: 'i' }), 'instance:i');
});

test('a key parses back to what it was built from', () => {
  assert.deepEqual(compStateKeyParse('asset:local/w4r63zmeaor'), { kind: 'asset', store: 'local', objectId: 'w4r63zmeaor' });
  assert.deepEqual(compStateKeyParse('id:~example/a.md#tree'), { kind: 'id', docPath: '~example/a.md', id: 'tree' });
  assert.deepEqual(compStateKeyParse('place:~example/a.md:12'), { kind: 'place', docPath: '~example/a.md', sourceLine: 12 });
  assert.deepEqual(compStateKeyParse('instance:Comp:33'), { kind: 'instance', instanceId: 'Comp:33' });
});

// ---------- line shifts ----------

test('line shifts of the operations of a write, counted without the frontmatter', () => {
  // frontmatter on file lines 1..4: content line n is file line n + 4
  const shiftList = lineShiftListGet([
    { action: 'replaceLines', lineStart: 10, lineEnd: 12, text: 'a\nb\nc\nd\ne' },
    { action: 'insertLines', lineAt: 20, text: 'x\n' },
    { action: 'deleteLines', lineStart: 30, lineEnd: 31 },
    { action: 'replaceLines', lineStart: 1, lineEnd: 4, text: 'title: t\n' },
    { action: 'replaceAll', text: 'whole' },
  ], 4);
  assert.deepEqual(shiftList, [
    { action: 'replaceLines', lineStart: 6, lineEnd: 8, delta: 2 },
    { action: 'insertLines', lineStart: 16, lineEnd: 15, delta: 2 },
    { action: 'deleteLines', lineStart: 26, lineEnd: 27, delta: -2 },
  ]);
  // a block before every change stays; the block that was rewritten keeps
  // its marker line; a marker inside a rewritten range is gone; blocks after
  // move by the sum of what came before them
  assert.equal(lineShiftApply(3, shiftList), 3);
  assert.equal(lineShiftApply(6, shiftList), 6);
  assert.equal(lineShiftApply(7, shiftList), undefined);
  assert.equal(lineShiftApply(12, shiftList), 14);
  // at the insertion line: after the rewrite (+2) and pushed by the insertion (+2)
  assert.equal(lineShiftApply(16, shiftList), 20);
  assert.equal(lineShiftApply(26, shiftList), undefined);
  assert.equal(lineShiftApply(40, shiftList), 42);
});

// ---------- the store ----------

test('a state is created once, held by its mounts, and idle when none holds it', () => {
  const store = new DocCompStateStore();
  const stateA = store.stateHold('place:~example/a.md:12', { initial: { count: 0 }, compId: 'specific/DemoCounter' });
  const stateB = store.stateHold('place:~example/a.md:12', { initial: { count: 99 } });
  assert.equal(stateA, stateB);
  assert.equal(stateA.value.count, 0);
  assert.equal(stateA.holdCount, 2);
  assert.equal(stateA.kind, 'place');
  assert.equal(stateA.docPath, '~example/a.md');
  stateA.patch({ count: 5 });
  assert.equal(stateB.value.count, 5);
  store.stateRelease(stateA);
  store.stateRelease('place:~example/a.md:12');
  assert.equal(stateA.holdCount, 0);
  assert.equal(store.idleCount, 1);
  // an idle state is found again by a later mount
  assert.equal(store.stateHold('place:~example/a.md:12').value.count, 5);
});

test('idle states beyond the cap are collected, the ones touched longest ago first', () => {
  const store = new DocCompStateStore({ idleMax: 2 });
  const list = ['instance:a', 'instance:b', 'instance:c'].map((key) => store.stateHold(key));
  store.stateRelease(list[0]);
  store.stateRelease(list[1]);
  // two idle states are within the cap
  assert.equal(store.stateByKey.size, 3);
  // a release stamps the time; here the order is set by hand: a was touched
  // longest ago
  list[0].timeTouched = 1;
  list[1].timeTouched = 2;
  list[2].timeTouched = 3;
  list[2].holdCount = 0;
  store.idleCollect();
  assert.deepEqual([...store.stateByKey.keys()], ['instance:b', 'instance:c']);
});

test('place-keyed states follow the lines the edit layer moves, and swap with a block move', () => {
  const store = new DocCompStateStore();
  const stateA = store.stateHold('place:~example/a.md:5', { initial: { name: 'a' } });
  store.stateHold('place:~example/a.md:9', { initial: { name: 'b' } });
  store.stateHold('place:~example/b.md:9', { initial: { name: 'other document' } });
  store.stateHold('id:~example/a.md#x', { initial: { name: 'by id' } });
  // two lines inserted before content line 7
  store.docLineShift('~example/a.md', lineShiftListGet({ action: 'insertLines', lineAt: 7, text: 'x\n' }, 0));
  assert.equal(store.stateGet('place:~example/a.md:5'), stateA);
  assert.equal(store.stateGet('place:~example/a.md:11')?.value.name, 'b');
  assert.equal(store.stateGet('place:~example/a.md:9'), undefined);
  assert.equal(store.stateGet('place:~example/b.md:9')?.value.name, 'other document');
  assert.equal(store.stateGet('id:~example/a.md#x')?.value.name, 'by id');
  // the two blocks exchange lines: the states exchange keys, as the same objects
  store.docLineRemap('~example/a.md', [{ lineFrom: 5, lineTo: 11 }, { lineFrom: 11, lineTo: 5 }]);
  assert.equal(store.stateGet('place:~example/a.md:11'), stateA);
  assert.equal(stateA.key, 'place:~example/a.md:11');
  assert.equal(store.stateGet('place:~example/a.md:5')?.value.name, 'b');
  // the block at line 5 deleted: its state goes with it
  store.docLineShift('~example/a.md', lineShiftListGet({ action: 'deleteLines', lineStart: 5, lineEnd: 6 }, 0));
  assert.equal(store.stateGet('place:~example/a.md:5'), undefined);
  assert.equal(store.stateGet('place:~example/a.md:9'), stateA);
  // releasing by the object works after the moves
  store.stateRelease(stateA);
  assert.equal(stateA.holdCount, 0);
});

test('the idle states of a document that left the source are collected', () => {
  const sourceStore = { fileManifest: { '~example/a.md': {}, '~example/b.md': {} } };
  const store = new DocCompStateStore({ sourceStore });
  const stateHeld = store.stateHold('place:~example/a.md:1');
  store.stateRelease(store.stateHold('place:~example/a.md:2'));
  store.stateRelease(store.stateHold('place:~example/b.md:2'));
  store.docDrop('~example/a.md');
  assert.equal(store.stateGet('place:~example/a.md:1'), stateHeld);
  assert.equal(store.stateGet('place:~example/a.md:2'), undefined);
  assert.equal(store.stateGet('place:~example/b.md:2')?.kind, 'place');
});
