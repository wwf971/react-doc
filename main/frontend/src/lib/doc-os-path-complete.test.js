import assert from 'node:assert/strict';
import test from 'node:test';
import { OsPathCompleter, osPathEntryIsOffered, osPathTextSplit } from './doc-os-path-complete.js';

// completion of a path of the file system (doc_page_impl_source.md#os-path-completion)

const listingByDir = {
  '~/': [{ name: 'project', kind: 'dir' }, { name: '.ssh', kind: 'dir' }, { name: 'notes.txt', kind: 'file' }],
  '~/project/': [{ name: 'react-doc', kind: 'dir', isDocPage: true }, { name: 'workspace.yaml', kind: 'file' }],
};

function completerCreate(options = {}) {
  const fetchLog = [];
  const resolveByDir = new Map();
  const completer = new OsPathCompleter({
    fetchList: (dirText) => {
      fetchLog.push(dirText);
      return new Promise((resolve) => resolveByDir.set(dirText, () => resolve({
        code: listingByDir[dirText] ? 0 : -3,
        data: listingByDir[dirText] ? { dirPath: `/home/u/${dirText.slice(2)}`, entryList: listingByDir[dirText] } : null,
        message: listingByDir[dirText] ? '' : 'not a folder',
      })));
    },
    ...options,
  });
  const settle = async (dirText) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveByDir.get(dirText)();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { completer, fetchLog, settle };
}

test('a text splits into its folder and the name typed after it', () => {
  assert.deepEqual(osPathTextSplit('~/proj'), { dirText: '~/', namePrefix: 'proj' });
  assert.deepEqual(osPathTextSplit('~'), { dirText: '~/', namePrefix: '' });
  assert.deepEqual(osPathTextSplit('rel'), { dirText: '', namePrefix: 'rel' });
  assert.deepEqual(osPathTextSplit('/a/b/'), { dirText: '/a/b/', namePrefix: '' });
});

test('the listing of the folder typed gives the candidates, folders ending with "/"', async () => {
  const { completer, settle } = completerCreate();
  completer.request('~/pro');
  assert.equal(completer.completeGet('~/pro').status, 'loading');
  await settle('~/');
  assert.deepEqual(completer.completeGet('~/pro').candidateList.map((item) => item.path), ['~/project/']);
  assert.deepEqual(completer.completeGet('~/').candidateList.map((item) => item.path), ['~/project/', '~/notes.txt']);
  assert.deepEqual(completer.completeGet('~/.').candidateList.map((item) => item.path), ['~/.ssh/']);
});

test('the answer for an earlier text never shows for the text of another folder', async () => {
  const { completer, settle } = completerCreate();
  completer.request('~/pro');
  completer.request('~/project/re');
  await settle('~/');
  // the text is in ~/project/ now: the listing of ~/ only fills the cache
  assert.equal(completer.completeGet('~/project/re').status, 'loading');
  assert.deepEqual(completer.completeGet('~/project/re').candidateList, []);
  await settle('~/project/');
  assert.deepEqual(completer.completeGet('~/project/re').candidateList.map((item) => [item.path, item.isDocPage]), [['~/project/react-doc/', true]]);
});

test('a listing is fetched once while cached, and again after its time', async () => {
  let time = 0;
  const { completer, fetchLog, settle } = completerCreate({ now: () => time, ttlMs: 1000 });
  completer.request('~/p');
  completer.request('~/pr');
  await settle('~/');
  completer.request('~/pro');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(fetchLog, ['~/']);
  time = 2000;
  completer.request('~/pro');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(fetchLog, ['~/', '~/']);
});

test('a failed listing is an error; the specification filters files', async () => {
  const { completer, settle } = completerCreate();
  completer.request('/nowhere/x');
  await settle('/nowhere/');
  assert.equal(completer.completeGet('/nowhere/x').status, 'error');
  assert.equal(osPathEntryIsOffered({ name: 'a.yaml', kind: 'file' }, { kind: 'file', extList: ['.yaml'] }), true);
  assert.equal(osPathEntryIsOffered({ name: 'a.md', kind: 'file' }, { kind: 'file', extList: ['yaml'] }), false);
  assert.equal(osPathEntryIsOffered({ name: 'a.md', kind: 'file' }, { kind: 'dir' }), false);
  assert.equal(osPathEntryIsOffered({ name: 'd', kind: 'dir' }, { kind: 'file' }), true);
});
