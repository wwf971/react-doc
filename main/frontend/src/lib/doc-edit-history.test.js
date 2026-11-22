import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAutoObservable, runInAction } from 'mobx';
import { docEditApiCreate } from './doc-edit-api.js';
import { embedHistoryHashGet, embedPathBuild } from './doc-edit-embed.js';
import { historyChangeBlockListGet } from './doc-history-reveal.js';
import { DocEditStore } from '../store/DocEditStore.ts';
import { DocHistoryStore } from '../store/DocHistoryStore.ts';

// The page side of the edit history (doc_page_impl_edit_history.md): which entry
// an undo takes in a scope, how a step answered by the server is taken in, and
// where it is shown. The server side is plugin/doc-edit-history.test.js.

const PATH_DOC = '~docs/page.md';

function entryBuild(entryId, extra = {}) {
  return { entryId, seq: 1, kind: 'write', label: 'Edit paragraph', time: 0, state: 'done', undoSeq: 0, docPath: PATH_DOC, pathList: [PATH_DOC], ...extra };
}

test('historyChangeBlockListGet marks the blocks a step changed, and the border of lines taken away', () => {
  const model = {
    blockList: [
      { index: 0, lineStart: 1, lineEnd: 1 },
      { index: 1, lineStart: 3, lineEnd: 4 },
      { index: 2, lineStart: 6, lineEnd: 6 },
    ],
  };
  assert.deepEqual(historyChangeBlockListGet(model, '# A\n\np\nq\n\nr\n', '# A\n\np\nQ\n\nr\n'), [{ blockIndex: 1, mark: 'change' }]);
  // a block taken away before the last one: the bar is at the top of the block after the place
  assert.deepEqual(historyChangeBlockListGet(model, '# A\n\nx\n\np\nq\n\nr\n', '# A\n\np\nq\n\nr\n'), [{ blockIndex: 1, mark: 'border-top' }]);
  // taken away at the end: the bar is under the last block
  assert.deepEqual(historyChangeBlockListGet(model, '# A\n\np\nq\n\nr\n\ns', '# A\n\np\nq\n\nr\n'), [{ blockIndex: 2, mark: 'border-bottom' }]);
  assert.deepEqual(historyChangeBlockListGet(model, 'same', 'same'), []);
});

test('the scope of a document takes the entries the server names; an MDX block those made in it', () => {
  const pathEmbed = embedPathBuild(PATH_DOC, 4);
  const textEmbed = 'notes, more';
  const editStore = {
    historySummaryByPath: {
      [PATH_DOC]: {
        path: PATH_DOC,
        undoEntryId: 'h3',
        redoEntryId: '',
        entryList: [
          entryBuild('h1', { seq: 1, docPath: pathEmbed, embed: { line: 4, hashBefore: embedHistoryHashGet('notes'), hashAfter: embedHistoryHashGet('notes, more\n') } }),
          entryBuild('h2', { seq: 2, label: 'Edit heading' }),
          entryBuild('h3', { seq: 3, label: 'Edit list' }),
        ],
      },
    },
    sourceByPath: { [pathEmbed]: { status: 'done', text: textEmbed } },
  };
  const store = new DocHistoryStore({ editStore, docStore: { docCurrentPath: PATH_DOC } });
  assert.equal(store.scopeStateGet(PATH_DOC).undo.entryId, 'h3');
  // the block's own entry, though the host has later ones; its trailing newline does not matter
  assert.equal(store.scopeStateGet(pathEmbed).undo.entryId, 'h1');
  assert.equal(store.scopeStateGet(pathEmbed).redo, undefined);
  assert.equal(store.entryLabelGet(PATH_DOC, editStore.historySummaryByPath[PATH_DOC].entryList[0]), 'Edit paragraph (in an MDX block)');
  // undone, its text before is the block's: the redo of the block takes it
  editStore.historySummaryByPath[PATH_DOC].entryList[0] = { ...editStore.historySummaryByPath[PATH_DOC].entryList[0], state: 'undone', undoSeq: 1 };
  editStore.sourceByPath[pathEmbed] = { status: 'done', text: 'notes' };
  assert.equal(store.scopeStateGet(pathEmbed).undo, undefined);
  assert.equal(store.scopeStateGet(pathEmbed).redo.entryId, 'h1');
});

test('an undo asked where the author is goes to the component there first, then to the document', async () => {
  const stepList = [];
  const editStore = { isAvailable: true, historySummaryByPath: {}, sourceByPath: {}, docEditGet: () => undefined };
  const store = new DocHistoryStore({ editStore, docStore: { docCurrentPath: PATH_DOC } });
  store.step = async (direction, path) => { stepList.push([direction, path]); return { code: 0, message: '' }; };
  store.placeCurrentGet = () => ({ path: PATH_DOC, blockIndex: 2, blockLine: 7 });
  let isTaken = true;
  const publishList = [];
  store.eventRouter = {
    publish: async (request) => {
      publishList.push(request);
      return { code: 0, data: { resultList: isTaken ? [{ code: 0, message: 'taken' }] : [], isAccepted: isTaken } };
    },
  };
  const resultComponent = await store.eventHandle({ type: 'historyUndoRequest', data: { isPlaceUsed: true }, source: {} });
  assert.equal(resultComponent.data.scope, 'component');
  assert.deepEqual(publishList[0].subject, { sourcePath: PATH_DOC, blockLine: 7 });
  assert.equal(publishList[0].type, 'historyUndo');
  assert.equal(publishList[0].isAcceptedFirst, true);
  assert.deepEqual(stepList, []);
  isTaken = false;
  await store.eventHandle({ type: 'historyRedoRequest', data: { isPlaceUsed: true }, source: {} });
  assert.deepEqual(stepList, [['redo', PATH_DOC]]);
  // a document named: its history, no component asked
  await store.eventHandle({ type: 'historyUndoRequest', data: { path: '~docs/other.md' }, source: {} });
  assert.deepEqual(stepList[1], ['undo', '~docs/other.md']);
  assert.equal(publishList.length, 2);
});

test('a step answered by the server is taken in as a write: the text accepted, the summary kept', async () => {
  const textBefore = '# A\n\nfirst, edited\n';
  const textAfter = '# A\n\nfirst\n';
  const summaryAfter = { path: PATH_DOC, undoEntryId: '', redoEntryId: 'h1', entryList: [entryBuild('h1', { state: 'undone', undoSeq: 1 })] };
  const requestList = [];
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requestList.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return {
      status: 200,
      json: async () => ({
        code: 0,
        message: '',
        data: {
          entry: summaryAfter.entryList[0],
          fileList: [{ internalPath: PATH_DOC, textBefore, text: textAfter, hash: 'hash-after' }],
          historyByPath: { [PATH_DOC]: summaryAfter },
        },
      }),
    };
  };
  try {
    const sourceStore = makeAutoObservable({ configDoc: {}, entryByInternalPath: new Map(), fileResolve: () => undefined });
    const envStore = { isCapable: () => true, endpointGet: () => '' };
    const store = new DocEditStore(sourceStore, { docCurrentPath: PATH_DOC }, {}, { envStore });
    store.api = docEditApiCreate('/__doc-edit');
    runInAction(() => {
      store.sourceByPath[PATH_DOC] = { status: 'done', text: textBefore, hash: 'hash-before' };
    });
    const result = await store.historyStepApply(PATH_DOC, 'undo', 'h1');
    assert.equal(result.code, 0);
    assert.deepEqual(requestList[0], { url: '/__doc-edit/history/step', body: { path: PATH_DOC, direction: 'undo', entryId: 'h1' } });
    assert.equal(store.sourceByPath[PATH_DOC].text, textAfter);
    assert.equal(store.sourceByPath[PATH_DOC].hash, 'hash-after');
    assert.equal(store.historySummaryByPath[PATH_DOC].redoEntryId, 'h1');
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
