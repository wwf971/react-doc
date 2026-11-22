import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAutoObservable } from 'mobx';
import { docEditApiCreate } from './doc-edit-api.js';
import { atomKindDefine, atomKindRegistryBuild } from './doc-edit-atom-kind.js';
import { ITEM_ATOM_CHAR_FIRST, itemAtomKindTextRemove } from './doc-edit-item-atom.js';
import { lineOperationApply, lineOperationListApply, textHashGet } from '../../plugin/doc-edit-lines.ts';
import { DocEditStore } from '../store/DocEditStore.ts';
import { DocEditStructStore } from '../store/DocEditStructStore.ts';
import { mathSourceBuild, mathSpanListGet } from '../../../../built-in/comp-mdx/math/MathData.js';

// Atoms of a kind over the edit store: a thing a component writes inside a
// text, typed as one character (a formula of the component math), added by a
// slash action, its value typed in its field, written back when the text is
// saved: in a paragraph, in the text of a list item, and a block of math
// taken out by its editor.
// Design: doc_page_impl_edit_structure.md#atoms-of-a-kind, built-in/comp-mdx/math/comp_math.md

const PATH_DOC = '~docs/math.md';

const sourceDoc = [
  '# Math',
  '',
  'Energy is $E = mc^2$ here.',
  '',
  '- apple',
  '- pear',
  '',
  '$$',
  'a + b',
  '$$',
  '',
  'The end.',
  '',
].join('\n');

// the kind math as the page registers it, drawn by nothing (no DOM here)
const mathKind = atomKindDefine({ name: 'math', label: 'formula', spanListGet: mathSpanListGet, sourceBuild: mathSourceBuild, draw: () => '' });

async function storesCreate(source = sourceDoc) {
  const file = { text: source };
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const answer = (payload) => ({ status: 200, json: async () => payload });
    if (String(url).includes('/source?')) return answer({ code: 0, data: { text: file.text, hash: textHashGet(file.text) }, message: '' });
    const body = JSON.parse(init.body);
    if (body.hashBase !== textHashGet(file.text)) return answer({ code: -2, data: { text: file.text }, message: 'changed' });
    file.text = body.operationList ? lineOperationListApply(file.text, body.operationList) : lineOperationApply(file.text, body.operation);
    return answer({ code: 0, data: { text: file.text, hash: textHashGet(file.text) }, message: '' });
  };
  const sourceStore = makeAutoObservable({
    configDoc: { compRegistry: {} },
    compileConfig: { isDefaultLinkRecognitionEnabled: false },
    fileManifest: [],
    entryByInternalPath: new Map([[PATH_DOC, { internalPath: PATH_DOC, ext: 'md' }]]),
    pathReadOnlyReasonGet: () => '',
    fileResolve: () => undefined,
  });
  const docStore = { compById: {}, docCurrentPath: PATH_DOC };
  const envStore = { isCapable: () => true, endpointGet: () => '' };
  const { byName } = atomKindRegistryBuild({ 'text/math': mathKind });
  const editStore = new DocEditStore(sourceStore, docStore, { valueGlobalGet: () => 'click' }, { envStore, atomKindByName: byName });
  editStore.api = docEditApiCreate('/__doc-edit');
  editStore.isEditMode = true;
  await editStore.docEditEnsure(PATH_DOC);
  const structStore = new DocEditStructStore({ editStore });
  const lineList = () => file.text.split('\n');
  return { editStore, structStore, file, lineList, restore: () => { globalThis.fetch = fetchBefore; } };
}

const eventFromEditor = (type, data = {}, blockIndex = 1) => ({ type, data, source: { sourcePath: PATH_DOC, blockIndex } });
const charOf = (index) => String.fromCodePoint(ITEM_ATOM_CHAR_FIRST + index);

test('the registry of the kinds: the host over the package, null removes one, what is no kind is left out', () => {
  const kindOther = atomKindDefine({ name: 'chem', spanListGet: () => [], sourceBuild: (value) => value, draw: () => '' });
  const warnBefore = console.warn;
  const warnList = [];
  console.warn = (message) => warnList.push(message);
  try {
    const registry = atomKindRegistryBuild({ 'text/math': mathKind, 'text/chem': kindOther }, { 'text/chem': null, 'host/bad': { name: 'bad' } });
    assert.deepEqual(Object.keys(registry.byId), ['text/math']);
    assert.equal(registry.byName.math, mathKind);
    assert.equal(warnList.length, 1);
  } finally {
    console.warn = warnBefore;
  }
  assert.throws(() => atomKindDefine({ name: 'two words', spanListGet: () => [], sourceBuild: () => '', draw: () => '' }), /one word/);
  assert.throws(() => atomKindDefine({ name: 'math' }), /needs spanListGet/);
});

test('a paragraph is typed with its formulas as chips; a formula changed and one added are written back in place', async () => {
  const { editStore, lineList, restore } = await storesCreate();
  try {
    assert.equal(await editStore.sessionBlockStart(PATH_DOC, 1), true);
    const session = editStore.session;
    // the formula is one character of the text typed
    assert.equal(session.textInitial, `Energy is ${charOf(0)} here.`);
    assert.equal(session.blockAtom.atomList[0].value, 'E = mc^2');
    // its value typed in its field
    let result = await editStore.eventHandle(eventFromEditor('editAtomValueChange', { char: charOf(0), value: 'E = mc^3', source: '$E = mc^3$' }));
    assert.equal(result.code, 0, result.message);
    // a new one at the end, by a slash action: its field opens
    result = await editStore.eventHandle(eventFromEditor('editAtomAdd', { atomKind: 'math', isRow: false, offset: session.textDraft.length - 1, text: session.textDraft }));
    assert.equal(result.code, 0, result.message);
    assert.equal(session.textDraft, `Energy is ${charOf(0)} here${charOf(1)}.`);
    assert.deepEqual({ ...session.atomOpenRequest }, { char: charOf(1), version: 1 });
    await editStore.eventHandle(eventFromEditor('editAtomValueChange', { char: charOf(1), value: 'x', source: '$x$' }));
    assert.equal(await editStore.sessionLeave(), true);
    assert.equal(lineList()[2], 'Energy is $E = mc^3$ here$x$.');
  } finally {
    restore();
  }
});

test('a formula of its own lines in a paragraph is a block of its own when the paragraph is saved', async () => {
  const { editStore, lineList, restore } = await storesCreate();
  try {
    await editStore.sessionBlockStart(PATH_DOC, 4);
    const session = editStore.session;
    assert.equal(session.textInitial, 'The end.');
    await editStore.eventHandle(eventFromEditor('editAtomAdd', { atomKind: 'math', isRow: true, offset: 4, text: 'The end.' }, 4));
    await editStore.eventHandle(eventFromEditor('editAtomValueChange', { char: charOf(0), value: 'y = 1', source: '$$\ny = 1\n$$' }, 4));
    assert.equal(await editStore.sessionLeave(), true);
    assert.deepEqual(lineList().slice(11), ['The', '', '$$', 'y = 1', '$$', '', 'end.', '']);
  } finally {
    restore();
  }
});

test('in the text of a list item a formula of its own lines is written on lines of the item; one left empty is not written', async () => {
  const { editStore, lineList, file, restore } = await storesCreate();
  try {
    await editStore.sessionItemStart(PATH_DOC, 2, '0');
    const session = editStore.session;
    await editStore.eventHandle(eventFromEditor('editAtomAdd', { atomKind: 'math', isRow: true, offset: 5, text: 'apple' }, 2));
    await editStore.eventHandle(eventFromEditor('editAtomValueChange', { char: charOf(0), value: 'n^2', source: '$$\nn^2\n$$' }, 2));
    assert.equal(await editStore.sessionLeave(), true);
    assert.deepEqual(lineList().slice(4, 9), ['- apple', '  $$', '  n^2', '  $$', '- pear']);
    // an atom added and left empty: the text is as it was
    const textBefore = file.text;
    await editStore.sessionItemStart(PATH_DOC, 2, '1');
    await editStore.eventHandle(eventFromEditor('editAtomAdd', { atomKind: 'math', isRow: false, offset: 4, text: 'pear' }, 2));
    assert.equal(editStore.session.textDraft.length, 5);
    assert.equal(await editStore.sessionLeave(), true);
    assert.equal(file.text, textBefore);
    assert.notEqual(session, editStore.session);
  } finally {
    restore();
  }
});

test('an atom goes into a text only, and of a kind the page has', async () => {
  const { editStore, restore } = await storesCreate();
  try {
    await editStore.sessionBlockStart(PATH_DOC, 0);
    const heading = await editStore.eventHandle(eventFromEditor('editAtomAdd', { atomKind: 'math', offset: 0, text: '# Math' }, 0));
    assert.equal(heading.code, -1);
    await editStore.sessionCancel();
    await editStore.sessionBlockStart(PATH_DOC, 1);
    const unknown = await editStore.eventHandle(eventFromEditor('editAtomAdd', { atomKind: 'chem', offset: 0 }));
    assert.equal(unknown.code, -1);
    assert.match(unknown.message, /no atom kind chem/);
    const charMissing = await editStore.eventHandle(eventFromEditor('editAtomValueChange', { char: charOf(5), value: 'x', source: '$x$' }));
    assert.equal(charMissing.code, -1);
  } finally {
    restore();
  }
});

test('a block of math is taken out by its editor, and the session ends', async () => {
  const { editStore, lineList, restore } = await storesCreate();
  try {
    const block = editStore.docEditGet(PATH_DOC).model.blockList[3];
    assert.equal(block.kind, 'math');
    await editStore.sessionBlockStart(PATH_DOC, 3);
    const result = await editStore.eventHandle(eventFromEditor('editBlockRemoveRequest', {}, 3));
    assert.equal(result.code, 0, result.message);
    assert.equal(editStore.session, undefined);
    assert.deepEqual(lineList().slice(4), ['- apple', '- pear', '', 'The end.', '']);
    // only a block of the document is taken out so
    await editStore.sessionItemStart(PATH_DOC, 2, '0');
    const refused = await editStore.eventHandle(eventFromEditor('editBlockRemoveRequest', {}, 2));
    assert.equal(refused.code, -1);
  } finally {
    restore();
  }
});

test('a formula taken out of a text by its menu: with a space next to it; one of its own lines with its line break', () => {
  assert.equal(itemAtomKindTextRemove('Energy is $E = mc^2$ here.', mathKind, 0), 'Energy is here.');
  assert.equal(itemAtomKindTextRemove('a $x$ and $y$.', mathKind, 1), 'a $x$ and.');
  assert.equal(itemAtomKindTextRemove('$x$ first', mathKind, 0), 'first');
  assert.equal(itemAtomKindTextRemove('text\n$$\nn^2\n$$\nafter', mathKind, 0), 'text\nafter');
  // a dollar in code is no formula; a formula that is not there
  assert.equal(itemAtomKindTextRemove('`$a$` and $b$', mathKind, 0), '`$a$` and');
  assert.equal(itemAtomKindTextRemove('no formula', mathKind, 0), undefined);
});

test('the menu of a block not being edited deletes a formula of a paragraph, and a formula or a code block of an item', async () => {
  const source = [
    '# Things',
    '',
    'Energy is $E = mc^2$ here.',
    '',
    '- apple $a$ end',
    '- ```sh view=icon',
    '  ls',
    '  ```',
    '- pear',
    '  <!--renderComp=Mdx,view=icon,title=Notes-->',
    '  ```md',
    '  notes',
    '  ```',
    '  then',
    '',
    '$x$',
    '',
  ].join('\n');
  const { editStore, structStore, lineList, restore } = await storesCreate(source);
  try {
    let result = await editStore.blockAtomRemove(PATH_DOC, 1, 'math', 0);
    assert.equal(result.code, 0, result.message);
    assert.equal(lineList()[2], 'Energy is here.');
    result = await structStore.itemPartRemove({ path: PATH_DOC, blockIndex: 2, itemPath: '0' }, { kind: 'atom', atomKind: 'math', index: 0 });
    assert.equal(result.code, 0, result.message);
    // an item that was its code block alone goes with it
    result = await structStore.itemPartRemove({ path: PATH_DOC, blockIndex: 2, itemPath: '1' }, { kind: 'code', index: 0 });
    assert.equal(result.code, 0, result.message);
    // an MDX block is a code block of the item: its marker goes with it
    result = await structStore.itemPartRemove({ path: PATH_DOC, blockIndex: 2, itemPath: '1' }, { kind: 'code', index: 0 });
    assert.equal(result.code, 0, result.message);
    assert.deepEqual(lineList().slice(4, 7), ['- apple end', '- pear', '  then']);
    // a paragraph that was its formula alone goes with it
    result = await editStore.blockAtomRemove(PATH_DOC, 3, 'math', 0);
    assert.equal(result.code, 0, result.message);
    assert.deepEqual(lineList().slice(6), ['  then', '']);
    // nothing of the sort there
    result = await editStore.blockAtomRemove(PATH_DOC, 1, 'math', 0);
    assert.equal(result.code, -1);
  } finally {
    restore();
  }
});
