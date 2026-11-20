import assert from 'node:assert/strict';
import test from 'node:test';
import { makeAutoObservable } from 'mobx';
import { docEditApiCreate } from './doc-edit-api.js';
import { lineOperationApply, lineOperationListApply, textHashGet } from '../../plugin/doc-edit-lines.ts';
import { DocEditStore } from '../store/DocEditStore.ts';
import { DocEditStructStore } from '../store/DocEditStructStore.ts';
import { dropTargetFind } from '../../../comp-doc/edit-structure/struct-geometry.js';

// Structural edit over the stores: the selection of edit mode, the edits of
// list items written through the edit layer, an item edited as its own text,
// and the place a dragged thing goes to.
// Design: doc_page_impl_edit_structure.md

const PATH_DOC = '~docs/list.md';

const sourceDoc = [
  '# Lists',
  '',
  '- fruit',
  '  - apple',
  '    - fuji',
  '  - pear',
  '- bread',
  '',
  'A paragraph.',
  '',
  '1. first',
  '2. second',
  '',
].join('\n');

// the two stores over a document kept in memory: the real api client over a
// fetch that reads the text and applies line operations as the development
// server does, with the hash check
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
  const editStore = new DocEditStore(sourceStore, docStore, { valueGlobalGet: () => 'click' }, { envStore });
  editStore.api = docEditApiCreate('/__doc-edit');
  editStore.isEditMode = true;
  await editStore.docEditEnsure(PATH_DOC);
  const structStore = new DocEditStructStore({ editStore });
  const lineList = () => file.text.split('\n');
  return { editStore, structStore, file, lineList, restore: () => { globalThis.fetch = fetchBefore; } };
}

const itemRef = (itemPath, blockIndex = 1) => ({ path: PATH_DOC, blockIndex, itemPath });

test('a list block carries the model of its items, and its elements are marked', async () => {
  const { editStore, restore } = await storesCreate();
  try {
    const blockList = editStore.docEditGet(PATH_DOC).model.blockList;
    assert.deepEqual(blockList.map((block) => [block.kind, Boolean(block.list)]), [['heading', false], ['list', true], ['paragraph', false], ['list', true]]);
    assert.deepEqual(blockList[1].list.rowList.map((item) => item.path), ['0', '0.0', '0.0.0', '0.1', '1']);
    assert.deepEqual([blockList[1].list.itemByPath.get('0.1').lineStart, blockList[3].list.rowList[0].lineStart], [6, 11]);
  } finally {
    restore();
  }
});

test('Shift + click selects the item, then grows the selection up to the block and starts over', async () => {
  const { structStore, restore } = await storesCreate();
  try {
    const scopeList = [];
    for (let step = 0; step < 6; step += 1) {
      await structStore.selectClick(PATH_DOC, 1, '0.0.0');
      scopeList.push(`${structStore.selection.scope}:${structStore.selection.itemPath}`);
    }
    // fuji has nothing under it: from the item alone to the item above with what is under it
    assert.deepEqual(scopeList, ['item:0.0.0', 'subtree:0.0', 'subtree:0', 'block:', 'item:0.0.0', 'subtree:0.0']);
    // an item with sub-items: alone, then with them
    structStore.selectionClear();
    await structStore.selectClick(PATH_DOC, 1, '0');
    assert.equal(`${structStore.selection.scope}:${structStore.selection.itemPath}`, 'item:0');
    await structStore.selectClick(PATH_DOC, 1, '0');
    assert.equal(`${structStore.selection.scope}:${structStore.selection.itemPath}`, 'subtree:0');
    // a click somewhere else starts anew; a block without items is selected as a block
    await structStore.selectClick(PATH_DOC, 1, '1');
    assert.equal(`${structStore.selection.scope}:${structStore.selection.itemPath}`, 'item:1');
    await structStore.selectClick(PATH_DOC, 2);
    assert.equal(structStore.selection.scope, 'block');
    assert.equal(structStore.selectionIsBlock(PATH_DOC, 2), true);
  } finally {
    restore();
  }
});

test('the toolbar of an item: the one under the pointer, and only the selected one while something is selected', async () => {
  const { structStore, restore } = await storesCreate();
  try {
    structStore.itemHoverSet(itemRef('0.1'));
    assert.deepEqual(structStore.itemToolbarRefGet(PATH_DOC), { ...itemRef('0.1'), isPinned: false });
    await structStore.selectionSet(PATH_DOC, 1, '1');
    assert.deepEqual(structStore.itemToolbarRefGet(PATH_DOC), { ...itemRef('1'), isPinned: true });
    // a selected block pins the toolbar of the block: no item toolbar
    await structStore.selectionSet(PATH_DOC, 2);
    assert.equal(structStore.itemToolbarRefGet(PATH_DOC), undefined);
  } finally {
    restore();
  }
});

test('an edit of an item is written as the new text of its list block, and the selection follows the item', async () => {
  const { structStore, lineList, restore } = await storesCreate();
  try {
    await structStore.selectionSet(PATH_DOC, 1, '0.1');
    const indented = await structStore.itemLevelChange(itemRef('0.1'), 'in');
    assert.equal(indented.code, 0, indented.message);
    assert.deepEqual(lineList().slice(2, 7), ['- fruit', '  - apple', '    - fuji', '    - pear', '- bread']);
    assert.equal(structStore.selectionGet(PATH_DOC).itemPath, '0.0.1');
    const moved = await structStore.selectionMove('up');
    assert.equal(moved.code, 0, moved.message);
    assert.deepEqual(lineList().slice(2, 7), ['- fruit', '  - apple', '    - pear', '    - fuji', '- bread']);
    assert.equal(structStore.selectionGet(PATH_DOC).itemPath, '0.0.0');
    // an edit that is not possible says why, and writes nothing
    const refused = await structStore.itemLevelChange(itemRef('0.0.0'), 'in');
    assert.equal(refused.code, -1);
    assert.match(structStore.itemWrite.message, /first item/);
  } finally {
    restore();
  }
});

test('an item moves into another list block in one write; a list left empty is removed', async () => {
  const { editStore, structStore, lineList, restore } = await storesCreate(['- only', '', '1. first', '2. second', ''].join('\n'));
  try {
    await structStore.selectionSet(PATH_DOC, 0, '0');
    const result = await structStore.itemMoveTo(itemRef('0', 0), 'subtree', { blockIndex: 1, itemPath: '0', position: 'after' });
    assert.equal(result.code, 0, result.message);
    assert.deepEqual(lineList(), ['1. first', '2. only', '3. second', '']);
    // the list block the item went into is block 0 now, and the selection is on the item there
    assert.deepEqual(result.data, { blockIndex: 0, itemPath: '1' });
    assert.equal(editStore.docEditGet(PATH_DOC).model.blockList.length, 1);
    assert.deepEqual([structStore.selection.blockIndex, structStore.selection.itemPath], [0, '1']);
  } finally {
    restore();
  }
});

test('an item is edited as its own text; a new item left as it was created is removed again', async () => {
  const { editStore, structStore, lineList, restore } = await storesCreate();
  try {
    assert.equal(await editStore.sessionItemStart(PATH_DOC, 1, '0.0'), true);
    assert.equal(editStore.session.textInitial, 'apple');
    editStore.sessionDraftSet('apple\nand more');
    assert.equal(await editStore.sessionLeave(), true);
    assert.deepEqual(lineList().slice(2, 8), ['- fruit', '  - apple', '    and more', '    - fuji', '  - pear', '- bread']);
    // a text that would take what is under the item is refused, and the session stays
    await editStore.sessionItemStart(PATH_DOC, 1, '0.0');
    editStore.sessionDraftSet('apple\n```');
    assert.equal(await editStore.sessionLeave(), false);
    assert.match(editStore.session.message, /would not read back/);
    await editStore.sessionCancel();
    // a new item opens without a text; left without one, it is taken out again
    const inserted = await structStore.itemInsert(itemRef('1'), 'after');
    assert.equal(inserted.code, 0, inserted.message);
    assert.equal(editStore.session.itemPath, '2');
    assert.equal(lineList()[8], '-');
    assert.equal(await editStore.sessionLeave(), true);
    assert.deepEqual(lineList().slice(6, 9), ['  - pear', '- bread', '']);
  } finally {
    restore();
  }
});

// the keys of an item being typed: each takes the draft along in one write
const eventFromEditor = (type, data = {}) => ({ type, data, source: { sourcePath: PATH_DOC, blockIndex: 1 } });

test('Enter splits the item being typed at the caret, and the editor goes on in the new item', async () => {
  const { editStore, structStore, lineList, file, restore } = await storesCreate();
  try {
    await editStore.sessionItemStart(PATH_DOC, 1, '0.0');
    editStore.sessionDraftSet('apples and pears');
    const textBefore = file.text;
    const split = await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 7, offsetEnd: 7 }));
    assert.equal(split.code, 0, split.message);
    // one write: the typed text and the split together
    assert.notEqual(file.text, textBefore);
    // the space at the place of the split is text of neither item
    assert.deepEqual(lineList().slice(2, 8), ['- fruit', '  - apples', '  - and pears', '    - fuji', '  - pear', '- bread']);
    assert.deepEqual([editStore.session.itemPath, editStore.session.textInitial, editStore.session.selectionInitial], ['0.1', 'and pears', 'start']);
    // at the end of an item: a new item without text, not kept when it is left so
    await editStore.sessionLeave();
    await editStore.sessionItemStart(PATH_DOC, 1, '1');
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 5, offsetEnd: 5 }));
    assert.deepEqual([editStore.session.itemPath, editStore.session.textInitial, editStore.session.isCreated], ['2', '', true]);
    assert.deepEqual(lineList().slice(7, 10), ['- bread', '-', '']);
    // Enter in an item without text at the first level takes it out: the list ends there
    const ended = await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 0, offsetEnd: 0 }));
    assert.equal(ended.code, 0, ended.message);
    assert.equal(editStore.session, undefined);
    assert.deepEqual(lineList().slice(7, 9), ['- bread', '']);
  } finally {
    restore();
  }
});

test('the keys typed while an edit of the editor is written are kept for the editor that opens', async () => {
  const { editStore, structStore, restore } = await storesCreate();
  try {
    await editStore.sessionItemStart(PATH_DOC, 1, '0.0');
    assert.equal(structStore.isTypeAheadOpen, false);
    assert.equal(structStore.typeAheadKey('x'), false);
    const split = structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 3, offsetEnd: 3 }));
    // the editor is closed, the write runs: what is typed now is kept
    assert.equal(editStore.session, undefined);
    assert.equal(structStore.isTypeAheadOpen, true);
    for (const key of ['r', 'y', 'x', 'Backspace', 'e', 'Enter', 'o', 'a', 't']) assert.equal(structStore.typeAheadKey(key), true);
    assert.equal(structStore.typeAheadKey('Tab', true), true);
    assert.equal((await split).code, 0);
    assert.equal(editStore.session.itemPath, '0.1');
    // the editor that has the focus takes the text up to the first key and
    // presses that key; the rest stays for the editor the key opens
    assert.deepEqual(structStore.typeAheadTake(), { text: 'rye', key: 'Enter' });
    assert.equal(structStore.isTypeAheadOpen, true);
    assert.deepEqual(structStore.typeAheadTake(), { text: 'oat', key: 'Shift+Tab' });
    // nothing more: the moment is over
    assert.deepEqual(structStore.typeAheadTake(), { text: '', key: undefined });
    assert.equal(structStore.isTypeAheadOpen, false);
    // an edit after which no editor opens keeps no key
    await editStore.sessionLeave();
    await editStore.sessionItemStart(PATH_DOC, 1, '1');
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 5, offsetEnd: 5 }));
    const ended = structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 0, offsetEnd: 0 }));
    assert.equal(structStore.isTypeAheadOpen, false);
    assert.equal((await ended).code, 0);
  } finally {
    structStore.typeAheadClose();
    restore();
  }
});

test('Enter at the end of an item with sub-items makes the first of them; a new item never keeps what it took', async () => {
  const { editStore, structStore, lineList, restore } = await storesCreate();
  try {
    const lineListBefore = lineList();
    await editStore.sessionItemStart(PATH_DOC, 1, '0');
    editStore.sessionDraftSet('fruits');
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 6, offsetEnd: 6 }));
    // right below the caret, beside the items that are there; under a line of
    // text an item without text is written with the empty comment
    assert.deepEqual([editStore.session.itemPath, editStore.session.textInitial, editStore.session.isCreated], ['0.0', '', true]);
    assert.deepEqual(lineList().slice(2, 5), ['- fruits', '  - <!---->', '  - apple']);
    // Enter in it: one level up, and the items after it come under it
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 0, offsetEnd: 0 }));
    assert.deepEqual([editStore.session.itemPath, editStore.session.isCreated], ['1', true]);
    assert.deepEqual(lineList().slice(2, 5), ['- fruits', '-', '  - apple']);
    // Enter again is no way out of the list here: the items under it would lose their item
    const refused = await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 0, offsetEnd: 0 }));
    assert.equal(refused.code, -1);
    assert.equal(editStore.session.itemPath, '1');
    assert.match(editStore.session.message, /holds the items under it/);
    // left without a text: it is gone, and what it took is back under the item above
    assert.equal(await editStore.sessionLeave(), true);
    assert.equal(editStore.session, undefined);
    assert.deepEqual(lineList(), lineListBefore.map((line) => (line === '- fruit' ? '- fruits' : line)));
    // Escape takes a new item out the same way
    await editStore.sessionItemStart(PATH_DOC, 1, '0');
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 6, offsetEnd: 6 }));
    assert.equal(editStore.session.itemPath, '0.0');
    const lineListWithItem = lineList();
    assert.equal(await editStore.sessionCancel(), true);
    assert.equal(lineListWithItem.length, lineList().length + 1);
    assert.deepEqual(lineList().slice(2, 4), ['- fruits', '  - apple']);
  } finally {
    structStore.typeAheadClose();
    restore();
  }
});

test('Enter in an item without text under another item takes it one level up', async () => {
  const { editStore, structStore, lineList, restore } = await storesCreate();
  try {
    await editStore.sessionItemStart(PATH_DOC, 1, '0.1');
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 4, offsetEnd: 4 }));
    assert.deepEqual([editStore.session.itemPath, lineList()[6]], ['0.2', '  -']);
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 0, offsetEnd: 0 }));
    assert.deepEqual([editStore.session.itemPath, editStore.session.isCreated], ['1', true]);
    assert.deepEqual(lineList().slice(5, 8), ['  - pear', '-', '- bread']);
  } finally {
    restore();
  }
});

test('Backspace at the start joins the item to the row above, Delete at the end the row below to it', async () => {
  const { editStore, structStore, lineList, restore } = await storesCreate();
  try {
    await editStore.sessionItemStart(PATH_DOC, 1, '0.1');
    editStore.sessionDraftSet('pears');
    const joined = await structStore.eventHandle(eventFromEditor('editItemMergeRequest', { direction: 'previous' }));
    assert.equal(joined.code, 0, joined.message);
    assert.deepEqual(lineList().slice(2, 6), ['- fruit', '  - apple', '    - fujipears', '- bread']);
    assert.deepEqual([editStore.session.itemPath, editStore.session.selectionInitial], ['0.0.0', { type: 'offset', offset: 4 }]);
    await editStore.sessionLeave();
    await editStore.sessionItemStart(PATH_DOC, 1, '0');
    const joinedNext = await structStore.eventHandle(eventFromEditor('editItemMergeRequest', { direction: 'next' }));
    assert.equal(joinedNext.code, 0, joinedNext.message);
    assert.deepEqual(lineList().slice(2, 5), ['- fruitapple', '  - fujipears', '- bread']);
    assert.deepEqual([editStore.session.itemPath, editStore.session.selectionInitial], ['0', { type: 'offset', offset: 5 }]);
    // the first row of a list has no row above: refused, and the item stays open
    const refused = await structStore.eventHandle(eventFromEditor('editItemMergeRequest', { direction: 'previous' }));
    assert.equal(refused.code, -1);
    assert.match(editStore.session.message, /no item above/);
  } finally {
    restore();
  }
});

test('Shift + Enter turns the item into a text block, edited as its lines', async () => {
  const { editStore, structStore, lineList, restore } = await storesCreate();
  try {
    await editStore.sessionItemStart(PATH_DOC, 1, '0.0.0');
    const F = '```';
    const result = await structStore.eventHandle(eventFromEditor('editItemFormatRequest', { offsetStart: 2, offsetEnd: 2 }));
    assert.equal(result.code, 0, result.message);
    assert.deepEqual(lineList().slice(4, 8), [`    - ${F}text`, '      fu', '      ji', `      ${F}`]);
    // the session is on the lines inside the fences, the caret after the break
    assert.deepEqual(
      [editStore.session.itemFormat, editStore.session.itemBlockInfo, editStore.session.textInitial, editStore.session.selectionInitial],
      ['block', 'text', 'fu\nji', { type: 'offset', offset: 3 }],
    );
    editStore.sessionDraftSet('fu\nji\nthree lines');
    assert.equal(await editStore.sessionLeave(), true);
    assert.deepEqual(lineList().slice(4, 9), [`    - ${F}text`, '      fu', '      ji', '      three lines', `      ${F}`]);
  } finally {
    restore();
  }
});

test('Enter in a text block splits it: the lines after the caret go into a new item, and the fences are kept', async () => {
  const { editStore, structStore, lineList, restore } = await storesCreate();
  const F = '```';
  try {
    await editStore.sessionItemStart(PATH_DOC, 1, '0.1');
    await structStore.eventHandle(eventFromEditor('editItemFormatRequest', { offsetStart: 4, offsetEnd: 4 }));
    editStore.sessionDraftSet('pear\nsecond\nthird');
    // the new-item button of the bar (a split at the end): the block stays a block
    await structStore.eventHandle(eventFromEditor('editItemInsertRequest', { position: 'after' }));
    assert.deepEqual(lineList().slice(5, 12), [`  - ${F}text`, '    pear', '    second', '    third', `    ${F}`, '  -', '- bread']);
    assert.deepEqual([editStore.session.itemPath, editStore.session.itemFormat, editStore.session.isCreated], ['0.2', undefined, true]);
    await editStore.sessionLeave();
    assert.deepEqual(lineList().slice(5, 11), [`  - ${F}text`, '    pear', '    second', '    third', `    ${F}`, '- bread']);
    // Enter at the end of the first line: the first line is a plain line, the rest a block, the caret at its start
    await editStore.sessionItemStart(PATH_DOC, 1, '0.1');
    assert.equal(editStore.session.itemFormat, 'block');
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 4, offsetEnd: 4 }));
    assert.deepEqual(lineList().slice(5, 11), ['  - pear', `  - ${F}text`, '    second', '    third', `    ${F}`, '- bread']);
    assert.deepEqual([editStore.session.itemPath, editStore.session.itemFormat, editStore.session.textInitial, editStore.session.selectionInitial], ['0.2', 'block', 'second\nthird', 'start']);
    // Enter in the middle of its last line: both parts are one line, both plain
    await structStore.eventHandle(eventFromEditor('editItemSplitRequest', { offsetStart: 'second\nth'.length, offsetEnd: 'second\nth'.length }));
    assert.deepEqual(lineList().slice(5, 11), ['  - pear', `  - ${F}text`, '    second', '    th', `    ${F}`, '  - ird']);
    assert.deepEqual([editStore.session.itemPath, editStore.session.itemFormat, editStore.session.textInitial], ['0.3', undefined, 'ird']);
    // Backspace at its start joins it back into the block, the caret where the texts meet
    await structStore.eventHandle(eventFromEditor('editItemMergeRequest', { direction: 'previous' }));
    assert.deepEqual(lineList().slice(5, 11), ['  - pear', `  - ${F}text`, '    second', '    third', `    ${F}`, '- bread']);
    assert.deepEqual([editStore.session.itemPath, editStore.session.itemFormat, editStore.session.selectionInitial], ['0.2', 'block', { type: 'offset', offset: 'second\nth'.length }]);
    // a text block typed down to one line is saved as a plain line
    editStore.sessionDraftSet('second third');
    await editStore.sessionLeave();
    assert.deepEqual(lineList().slice(5, 8), ['  - pear', '  - second third', '- bread']);
  } finally {
    structStore.typeAheadClose();
    restore();
  }
});

test('Tab changes the level of the item being typed with its text, in one write', async () => {
  const { editStore, structStore, lineList, restore } = await storesCreate();
  try {
    await editStore.sessionItemStart(PATH_DOC, 1, '1');
    editStore.sessionDraftSet('bread and butter');
    const result = await structStore.eventHandle(eventFromEditor('editItemLevelRequest', { direction: 'in', offset: 5 }));
    assert.equal(result.code, 0, result.message);
    assert.deepEqual(lineList().slice(5, 7), ['  - pear', '  - bread and butter']);
    assert.deepEqual([editStore.session.itemPath, editStore.session.selectionInitial], ['0.2', { type: 'offset', offset: 5 }]);
  } finally {
    restore();
  }
});

test('the arrows shift the focus from item to item, and between a list and the blocks around it', async () => {
  const { editStore, restore } = await storesCreate();
  try {
    await editStore.sessionItemStart(PATH_DOC, 1, '0.1');
    await editStore.sessionFocusShift('next');
    assert.deepEqual([editStore.session.type, editStore.session.itemPath], ['item', '1']);
    await editStore.sessionFocusShift('next');
    assert.deepEqual([editStore.session.type, editStore.session.blockIndex], ['block', 2]);
    await editStore.sessionFocusShift('next');
    assert.deepEqual([editStore.session.type, editStore.session.blockIndex, editStore.session.itemPath], ['item', 3, '0']);
    await editStore.sessionFocusShift('previous');
    await editStore.sessionFocusShift('previous');
    assert.deepEqual([editStore.session.type, editStore.session.blockIndex, editStore.session.itemPath], ['item', 1, '1']);
    await editStore.sessionCancel();
  } finally {
    restore();
  }
});

// ---------- the place a dragged thing goes to ----------

// the rows of "- a / - b (child) / - c (child) / - d", 28 px each, levels 24 px apart
const rowList = [
  { blockIndex: 1, itemPath: '0', depth: 0, top: 0, bottom: 28, markerLeft: 0, textLeft: 24, right: 600 },
  { blockIndex: 1, itemPath: '0.0', depth: 1, top: 36, bottom: 64, markerLeft: 24, textLeft: 48, right: 600 },
  { blockIndex: 1, itemPath: '0.1', depth: 1, top: 72, bottom: 100, markerLeft: 24, textLeft: 48, right: 600 },
  { blockIndex: 1, itemPath: '1', depth: 0, top: 108, bottom: 136, markerLeft: 0, textLeft: 24, right: 600 },
];

test('a dragged item keeps its level in a gap, and the pointer moved sideways changes it', () => {
  const subject = { kind: 'item', blockIndex: 1, itemPath: '1', depth: 0 };
  const pointerStart = { x: 100, y: 120 };
  // the gap below the last child (0.1): at its own level, the item follows "0"
  const straight = dropTargetFind({ subject, pointer: { x: 100, y: 102 }, pointerStart, rowList });
  assert.equal(straight, undefined, 'the place it already has is no place: the pointer is still beside it');
  const above = dropTargetFind({ subject, pointer: { x: 100, y: 68 }, pointerStart, rowList });
  // between two children the only level is theirs
  assert.deepEqual(above.target, { kind: 'item', blockIndex: 1, itemPath: '0.0', position: 'after', depth: 1 });
  assert.equal(above.indicator.left, 24);
  // dragged down and to the right: one level deeper, under "0" as its last child... the gap is the same lines
  const subjectChild = { kind: 'item', blockIndex: 1, itemPath: '0.0', depth: 1 };
  const below = dropTargetFind({ subject: subjectChild, pointer: { x: 100, y: 104 }, pointerStart: { x: 100, y: 50 }, rowList });
  assert.deepEqual(below.target, { kind: 'item', blockIndex: 1, itemPath: '0.1', position: 'after', depth: 1 });
  const deeper = dropTargetFind({ subject: subjectChild, pointer: { x: 130, y: 104 }, pointerStart: { x: 100, y: 50 }, rowList });
  assert.deepEqual(deeper.target, { kind: 'item', blockIndex: 1, itemPath: '0.1', position: 'childFirst', depth: 2 });
  const shallower = dropTargetFind({ subject: subjectChild, pointer: { x: 70, y: 104 }, pointerStart: { x: 100, y: 50 }, rowList });
  assert.deepEqual(shallower.target, { kind: 'item', blockIndex: 1, itemPath: '0', position: 'after', depth: 0 });
  assert.equal(shallower.indicator.left, 0);
  // above the first row: before it
  const top = dropTargetFind({ subject: subjectChild, pointer: { x: 100, y: -4 }, pointerStart: { x: 100, y: 50 }, rowList });
  assert.deepEqual(top.target, { kind: 'item', blockIndex: 1, itemPath: '0', position: 'before', depth: 0 });
  // far from every list: no place
  assert.equal(dropTargetFind({ subject: subjectChild, pointer: { x: 100, y: 400 }, pointerStart: { x: 100, y: 50 }, rowList }), undefined);
});

test('a dragged block goes to the nearest border, and its own place is no place', () => {
  const blockRectList = [
    { blockIndex: 0, top: 0, bottom: 40, left: 0, right: 600 },
    { blockIndex: 1, top: 60, bottom: 200, left: 0, right: 600 },
    { blockIndex: 2, top: 220, bottom: 260, left: 0, right: 600 },
  ];
  const subject = { kind: 'block', blockIndex: 2, itemPath: '' };
  assert.equal(dropTargetFind({ subject, pointer: { x: 10, y: 240 }, blockRectList }), undefined);
  const middle = dropTargetFind({ subject, pointer: { x: 10, y: 70 }, blockRectList });
  assert.deepEqual(middle.target, { kind: 'block', borderIndex: 1 });
  assert.equal(middle.indicator.top, 50);
  assert.deepEqual(dropTargetFind({ subject, pointer: { x: 10, y: -20 }, blockRectList }).target, { kind: 'block', borderIndex: 0 });
});
