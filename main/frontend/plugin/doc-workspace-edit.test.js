import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { workspaceEditBuild } from './doc-workspace-edit.ts';
import { yamlMapKeyRemoveBuild } from './doc-yaml-edit.ts';
import { lineOperationListApply } from './doc-edit-lines.ts';

// the workspace file edited from the Workspace tab
// (doc_page_impl_source.md#editing-the-workspace-file): line by line, the
// comments kept

const source = [
  '# the workspace',
  'docPageList:',
  '  # the main one',
  '  - alias: guide',
  '    dir: ./guide       # its folder',
  '',
  '  - alias: api',
  '    file: ./api/.doc-page/entry.yaml',
  '    sidePanel: main',
  '',
  '# title: Site',
  '',
].join('\n');

const edit = (request, text = source) => {
  const result = workspaceEditBuild(text, request);
  assert.equal(result.code, 0, result.message);
  return result.data.text;
};

test('a field is set in place, a new key goes into its item, an empty value removes the key', () => {
  assert.match(edit({ action: 'itemFieldSet', index: 0, field: 'alias', value: 'docs' }), /- alias: docs\n {4}dir: \.\/guide {7}# its folder/);
  assert.match(edit({ action: 'itemFieldSet', index: 0, field: 'sidePanel', value: 'compact' }), /dir: \.\/guide {7}# its folder\n {4}sidePanel: compact\n/);
  const textNoSidePanel = edit({ action: 'itemFieldSet', index: 1, field: 'sidePanel', value: '' });
  assert.doesNotMatch(textNoSidePanel, /sidePanel/);
  assert.match(textNoSidePanel, /file: \.\/api\/\.doc-page\/entry\.yaml\n\n# title/);
});

test('removing the key of the "- " line hands the dash to the next line', () => {
  const text = edit({ action: 'itemFieldSet', index: 0, field: 'alias', value: '' });
  assert.match(text, /# the main one\n {2}- dir: \.\/guide {7}# its folder\n\n {2}- alias: api/);
  assert.deepEqual(parseDocument(text).toJS().docPageList[0], { dir: './guide' });
});

test('the path switches between dir and file on its own line', () => {
  const text = edit({ action: 'itemPathSet', index: 0, kind: 'file', value: './guide/entry.yaml' });
  assert.match(text, / {4}file: \.\/guide\/entry\.yaml {7}# its folder/);
  assert.deepEqual(parseDocument(text).toJS().docPageList[0], { alias: 'guide', file: './guide/entry.yaml' });
  const textDir = edit({ action: 'itemPathSet', index: 1, kind: 'dir', value: './api' });
  assert.deepEqual(parseDocument(textDir).toJS().docPageList[1], { alias: 'api', dir: './api', sidePanel: 'main' });
  const only = 'docPageList:\n  - file: ./a/entry.yaml\n';
  assert.equal(edit({ action: 'itemPathSet', index: 0, kind: 'dir', value: './a' }, only), 'docPageList:\n  - dir: ./a\n');
});

test('items are added, removed and moved with their comments', () => {
  const textAdded = edit({ action: 'itemAdd', item: { alias: 'extra', dir: '../extra' } });
  assert.match(textAdded, / {4}sidePanel: main\n {2}- alias: extra\n {4}dir: \.\.\/extra\n/);
  const textRemoved = edit({ action: 'itemRemove', index: 0 });
  assert.equal(textRemoved, ['# the workspace', 'docPageList:', '', '  - alias: api', '    file: ./api/.doc-page/entry.yaml', '    sidePanel: main', '', '# title: Site', ''].join('\n'));
  const textMoved = edit({ action: 'itemMove', index: 1, indexTo: 0 });
  assert.deepEqual(parseDocument(textMoved).toJS().docPageList.map((item) => item.alias), ['api', 'guide']);
  assert.match(textMoved, /docPageList:\n {2}- alias: api\n[\s\S]*# the main one\n {2}- alias: guide/);
  const textMovedDown = edit({ action: 'itemMove', index: 0, indexTo: 1 });
  assert.deepEqual(parseDocument(textMovedDown).toJS().docPageList.map((item) => item.alias), ['api', 'guide']);
});

test('the title is set and removed; wrong requests are refused', () => {
  assert.match(edit({ action: 'titleSet', value: 'My Site' }), /\ntitle: My Site\n/);
  assert.equal(workspaceEditBuild('docPageList:\n  - dir: ./a\n', { action: 'itemRemove', index: 0 }).code, -1);
  assert.equal(workspaceEditBuild(source, { action: 'itemFieldSet', index: 5, field: 'alias', value: 'x' }).code, -1);
  assert.equal(workspaceEditBuild(source, { action: 'itemAdd', item: { alias: 'x' } }).code, -1);
  assert.equal(workspaceEditBuild('docPageList: [{ dir: ./a }]\n', { action: 'itemRemove', index: 0 }).code, -1);
});

test('yamlMapKeyRemoveBuild refuses the only key of a mapping', () => {
  const text = 'a:\n  b: 1\n';
  assert.equal(yamlMapKeyRemoveBuild(text, parseDocument(text), ['a', 'b']).code, -1);
  const textTwo = 'a:\n  # about b\n  b: 1\n  c: 2\n';
  const result = yamlMapKeyRemoveBuild(textTwo, parseDocument(textTwo), ['a', 'b']);
  assert.equal(lineOperationListApply(textTwo, result.data.operationList), 'a:\n  c: 2\n');
});

test('the root row of a doc page: false is written as a yaml boolean, true removes the key, comments stay', () => {
  const textHidden = edit({ action: 'itemRootVisibleSet', index: 0, isRootVisible: false });
  assert.match(textHidden, /- alias: guide\n {4}dir: \.\/guide {7}# its folder\n {4}isRootVisible: false\n\n {2}- alias: api/);
  assert.equal(parseDocument(textHidden).toJS().docPageList[0].isRootVisible, false);
  // true removes the key; already absent: nothing changes
  const textShown = edit({ action: 'itemRootVisibleSet', index: 0, isRootVisible: true }, textHidden);
  assert.equal(textShown, source);
  assert.equal(edit({ action: 'itemRootVisibleSet', index: 1, isRootVisible: true }), source);
  // the key stays with its item when the item moves
  const textMoved = edit({ action: 'itemMove', index: 0, indexTo: 1 }, textHidden);
  assert.deepEqual(parseDocument(textMoved).toJS().docPageList.map((item) => item.isRootVisible), [undefined, false]);
  // a new item may carry it
  assert.match(edit({ action: 'itemAdd', item: { dir: '../extra', isRootVisible: false } }), /- dir: \.\.\/extra\n {4}isRootVisible: false\n/);
  // never the text "false"
  assert.equal(workspaceEditBuild(source, { action: 'itemRootVisibleSet', index: 0, isRootVisible: 'false' }).code, -1);
  assert.equal(workspaceEditBuild(source, { action: 'itemRootVisibleSet', index: 7, isRootVisible: false }).code, -1);
});
