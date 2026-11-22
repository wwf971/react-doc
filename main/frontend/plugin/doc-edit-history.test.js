import assert from 'node:assert/strict';
import test from 'node:test';
import { DocEditHistory, historyMetaNormalize } from './doc-edit-history.ts';
import { textHashGet } from './doc-edit-lines.ts';

// a small file system of texts and the history of its writes, as the edit
// api keeps them: a write is recorded with its text before and after
function fileSystemCreate(textByPath) {
  const history = new DocEditHistory();
  const files = { ...textByPath };
  const write = (path, textAfter, meta = {}) => {
    const textBefore = files[path];
    files[path] = textAfter;
    return history.record({ path, textBefore, textAfter, hashBefore: textHashGet(textBefore), hashAfter: textHashGet(textAfter) }, meta);
  };
  const step = (path, direction, entryId) => {
    const prepared = history.stepPrepare({ path, direction, entryId }, (one) => files[one]);
    if (prepared.code !== 0) return prepared;
    for (const one of prepared.data.writeList) files[one.path] = one.textNext;
    history.stepCommit(prepared.data.entry, direction);
    return prepared;
  };
  return { history, files, write, step };
}

test('an undo writes the text before back, a redo the text after', () => {
  const fs = fileSystemCreate({ '~d/a.md': 'one\n' });
  fs.write('~d/a.md', 'one\ntwo\n', { label: 'Insert block' });
  fs.write('~d/a.md', 'one\ntwo\nthree\n', { label: 'Insert block' });
  assert.equal(fs.history.summaryGet('~d/a.md').entryList.length, 2);
  assert.equal(fs.step('~d/a.md', 'undo').code, 0);
  assert.equal(fs.files['~d/a.md'], 'one\ntwo\n');
  assert.equal(fs.step('~d/a.md', 'undo').code, 0);
  assert.equal(fs.files['~d/a.md'], 'one\n');
  assert.equal(fs.step('~d/a.md', 'undo').code, -1, 'nothing left to undo');
  assert.equal(fs.step('~d/a.md', 'redo').code, 0);
  assert.equal(fs.files['~d/a.md'], 'one\ntwo\n');
  const summary = fs.history.summaryGet('~d/a.md');
  assert.equal(summary.entryList.find((one) => one.entryId === summary.redoEntryId).state, 'undone');
});

test('a new write drops what was undone', () => {
  const fs = fileSystemCreate({ 'a.md': 'a\n' });
  fs.write('a.md', 'a\nb\n');
  fs.step('a.md', 'undo');
  fs.write('a.md', 'a\nc\n');
  const summary = fs.history.summaryGet('a.md');
  assert.equal(summary.entryList.length, 1);
  assert.equal(summary.redoEntryId, '');
});

test('an undo is merged with what changed since elsewhere in the file', () => {
  const fs = fileSystemCreate({ 'a.md': '# A\n\nfirst\n\nsecond\n' });
  fs.write('a.md', '# A\n\nfirst, edited\n\nsecond\n', { label: 'Edit Paragraph' });
  // another editor changed the last paragraph on disk: not through the api
  fs.files['a.md'] = '# A\n\nfirst, edited\n\nsecond, outside\n';
  assert.equal(fs.step('a.md', 'undo').code, 0);
  assert.equal(fs.files['a.md'], '# A\n\nfirst\n\nsecond, outside\n');
  assert.equal(fs.step('a.md', 'redo').code, 0);
  assert.equal(fs.files['a.md'], '# A\n\nfirst, edited\n\nsecond, outside\n');
});

test('an undo is refused where the lines it would write changed since', () => {
  const fs = fileSystemCreate({ 'a.md': 'x\n' });
  fs.write('a.md', 'y\n');
  fs.files['a.md'] = 'z\n';
  const result = fs.step('a.md', 'undo');
  assert.equal(result.code, -2);
  assert.equal(fs.files['a.md'], 'z\n', 'nothing written');
  assert.equal(fs.history.summaryGet('a.md').undoEntryId !== '', true, 'the entry stays');
});

test('the writes of one action are one entry of both documents', () => {
  const fs = fileSystemCreate({ 'a.md': 'p\n\nq\n', 'b.md': 'r\n' });
  fs.write('b.md', 'r\n\nq\n', { actionId: 'move-1', label: 'Move blocks' });
  fs.write('a.md', 'p\n', { actionId: 'move-1', label: 'Move blocks' });
  const summaryA = fs.history.summaryGet('a.md');
  const summaryB = fs.history.summaryGet('b.md');
  assert.equal(summaryA.entryList.length, 1);
  assert.equal(summaryA.undoEntryId, summaryB.undoEntryId);
  assert.deepEqual(summaryA.entryList[0].pathList, ['b.md', 'a.md']);
  // undone from either document, both files go back
  assert.equal(fs.step('a.md', 'undo').code, 0);
  assert.equal(fs.files['a.md'], 'p\n\nq\n');
  assert.equal(fs.files['b.md'], 'r\n');
  assert.equal(fs.history.summaryGet('b.md').redoEntryId, summaryA.undoEntryId);
});

test('a retract takes back the last entry instead of recording one', () => {
  const fs = fileSystemCreate({ 'a.md': 'a\n' });
  fs.write('a.md', 'a\nb\n', { label: 'Edit' });
  fs.write('a.md', 'a\nb\n\nnew\n', { label: 'Insert block' });
  // the created block canceled
  const entry = fs.write('a.md', 'a\nb\n', { isRetract: true });
  assert.equal(entry, undefined);
  const summary = fs.history.summaryGet('a.md');
  assert.equal(summary.entryList.length, 1);
  assert.equal(summary.entryList[0].label, 'Edit');
  // a retract that does not take the last entry back is recorded as a write
  fs.write('a.md', 'other\n', { isRetract: true });
  assert.equal(fs.history.summaryGet('a.md').entryList.length, 2);
});

test('the entries of an embedded document carry its hashes; any entry can be undone by id', () => {
  const host = 'p\n\n```md\nnotes\n```\n\nq\n';
  const fs = fileSystemCreate({ 'a.md': host });
  fs.write('a.md', 'p\n\n```md\nnotes, more\n```\n\nq\n', { docPath: 'a.md::embed@3', embed: { line: 3, hashBefore: 'h1', hashAfter: 'h2' } });
  fs.write('a.md', 'p\n\n```md\nnotes, more\n```\n\nq, later\n', { label: 'Edit Paragraph' });
  const summary = fs.history.summaryGet('a.md');
  const entryEmbed = summary.entryList.find((one) => one.embed);
  assert.deepEqual(entryEmbed.embed, { line: 3, hashBefore: 'h1', hashAfter: 'h2' });
  // the popup of the block undoes its own entry, though it is not the last of the host
  assert.equal(fs.step('a.md', 'undo', entryEmbed.entryId).code, 0);
  assert.equal(fs.files['a.md'], 'p\n\n```md\nnotes\n```\n\nq, later\n');
});

test('the oldest entries go past the count of a document', () => {
  const history = new DocEditHistory({ entryCountMaxPerPath: 3 });
  let text = '';
  for (let index = 0; index < 5; index += 1) {
    const textAfter = `${text}${index}\n`;
    history.record({ path: 'a.md', textBefore: text, textAfter, hashBefore: textHashGet(text), hashAfter: textHashGet(textAfter) });
    text = textAfter;
  }
  assert.equal(history.summaryGet('a.md').entryList.length, 3);
  history.pathClear('a.md');
  assert.equal(history.summaryGet('a.md').entryList.length, 0);
  assert.equal(history.byteCount, 0);
});

test('historyMetaNormalize keeps the known fields only', () => {
  assert.deepEqual(historyMetaNormalize({ label: 'Move', other: 1, isRetract: 'yes' }), { label: 'Move' });
  assert.deepEqual(historyMetaNormalize(null), {});
});
