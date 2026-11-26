import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAutoObservable } from 'mobx';
import { docEditApiCreate } from './doc-edit-api.js';
import { docHostPathGet, embedHistoryHashGet, embedPathBuild, heldPathBuild, heldPathParse } from './doc-edit-embed.js';
import { DocEditStore } from '../store/DocEditStore.ts';
import { DocHistoryStore } from '../store/DocHistoryStore.ts';

// A document held by a component (doc_page_impl_mdx_embed.md#held-by-another-component): the text of
// an MDX block a card of a card diagram holds, read and written by its holder, edited as any document

const PATH_DOC = '~docs/page.md';

test('the path of a held document names the document it stands in and its holder', () => {
  const path = heldPathBuild(PATH_DOC, 'card-comp:notes');
  assert.equal(path, '~docs/page.md::held@card-comp:notes');
  assert.deepEqual(heldPathParse(path), { hostPath: PATH_DOC, key: 'card-comp:notes' });
  assert.equal(heldPathParse(PATH_DOC), undefined);
  assert.equal(heldPathParse(embedPathBuild(PATH_DOC, 4)), undefined);
  assert.equal(docHostPathGet(path), PATH_DOC);
  assert.equal(docHostPathGet(embedPathBuild(PATH_DOC, 4)), PATH_DOC);
  assert.equal(docHostPathGet(PATH_DOC), PATH_DOC);
});

test('a held document is written by its holder, while it can be; what changed there is read again', async () => {
  const sourceStore = makeAutoObservable({ configDoc: {}, entryByInternalPath: new Map(), fileResolve: () => undefined, pathReadOnlyReasonGet: () => '' });
  const envStore = { isCapable: () => true, endpointGet: () => '' };
  const store = new DocEditStore(sourceStore, { docCurrentPath: PATH_DOC }, {}, { envStore });
  store.api = docEditApiCreate('/__doc-edit');
  const path = heldPathBuild(PATH_DOC, 'card-comp:notes');
  // no holder: not editable, and said why
  assert.equal(store.docIsEditable(path), false);
  assert.match(store.heldDocReasonGet(path), /not shown/);
  let held = '# Notes\n\nDone once.\n';
  const writeList = [];
  const holder = { textGet: () => held, textWrite: (text) => { writeList.push(text); held = `${text}\n`; return { code: 0, message: '' }; }, writeReason: '' };
  store.heldDocSet(path, holder);
  assert.equal(store.docIsEditable(path), true);
  await store.docEditEnsure(path);
  assert.equal(store.sourceByPath[path].text, '# Notes\n\nDone once.\n');
  // an operation: applied here, handed to the holder, accepted as the new text
  const result = await store.operationApply(path, { action: 'replaceLines', lineStart: 3, lineEnd: 3, text: 'Done twice.' }, { messageFailure: 'not written' });
  assert.equal(result.code, 0);
  assert.deepEqual(writeList, ['# Notes\n\nDone twice.']);
  assert.equal(store.sourceByPath[path].text, '# Notes\n\nDone twice.\n');
  // its text changed where it is held (an undo of the diagram): read again; the same text again is nothing
  held = '# Notes\n\nDone once.';
  store.heldDocTextChanged(path, held);
  assert.equal(store.sourceByPath[path].text, '# Notes\n\nDone once.');
  // changed there since it was read: a conflict, nothing handed over
  held = 'elsewhere';
  const conflict = await store.operationApply(path, { action: 'replaceLines', lineStart: 1, lineEnd: 1, text: '# N' }, { messageFailure: 'not written' });
  assert.equal(conflict.code, -2);
  assert.equal(writeList.length, 1);
  // what holds it cannot be written now: not editable, and it says why; an operation is refused
  const holderRead = { ...holder, writeReason: 'a card of a diagram is changed in the editor of its diagram' };
  store.heldDocSet(path, holderRead);
  assert.equal(store.docIsEditable(path), false);
  assert.equal(store.heldDocReasonGet(path), holderRead.writeReason);
  // the holder gone: only the one registered is removed
  store.heldDocRemove(path, holder);
  assert.equal(store.heldDocByPath[path], holderRead);
  store.heldDocRemove(path, holderRead);
  assert.equal(store.heldDocByPath[path], undefined);
  // its undo: the entries of the page made in it, found by the text they leave, as an MDX block's
  const historyStore = new DocHistoryStore({ editStore: store, docStore: { docCurrentPath: PATH_DOC } });
  const undoNone = await historyStore.step('undo', path);
  assert.equal(undoNone.code, -1);
  assert.match(undoNone.message, /Nothing to undo in this MDX block here/);
  store.sourceByPath[path] = { status: 'done', text: 'Done twice.\n', hash: 'h' };
  const entry = (entryId, docPath, before, after, state = 'done') => ({ entryId, seq: 1, kind: 'write', label: 'Edit paragraph', time: 0, state, undoSeq: 0, docPath, pathList: [PATH_DOC], embed: { line: 0, hashBefore: embedHistoryHashGet(before), hashAfter: embedHistoryHashGet(after) } });
  store.historySummaryByPath[PATH_DOC] = { entryList: [
    entry('a', path, 'Done once.', 'Done twice.'),
    entry('b', heldPathBuild(PATH_DOC, 'card-comp:other'), 'x', 'Done twice.'),
    entry('c', embedPathBuild(PATH_DOC, 4), 'y', 'Done twice.'),
  ], undoEntryId: 'c', redoEntryId: '' };
  assert.equal(historyStore.scopeStateGet(path).undo?.entryId, 'a');
  // an MDX block written in the page does not take the entries of a held one
  store.sourceByPath[embedPathBuild(PATH_DOC, 4)] = { status: 'done', text: 'Done twice.', hash: 'h2' };
  assert.equal(historyStore.scopeStateGet(embedPathBuild(PATH_DOC, 4)).undo?.entryId, 'c');
});
