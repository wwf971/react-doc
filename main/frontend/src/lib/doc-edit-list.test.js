import assert from 'node:assert/strict';
import test from 'node:test';
import {
  itemBlockFormatGet,
  itemBlockTextBuild,
  itemChildListGet,
  listItemAttach,
  listItemDelete,
  listItemDetach,
  listItemEditReasonGet,
  listItemGet,
  listItemIndent,
  listItemInfoBuild,
  listItemInsert,
  listItemListTypeSet,
  listItemMergeUp,
  listItemMove,
  listItemMoveSibling,
  listItemOutdent,
  listItemSplit,
  listItemTextGet,
  listItemTextSet,
  listTextBuild,
  listTextModelBuild,
  itemBlockInfoIsText,
  itemTextParse,
  itemTextSplit,
  itemTextWrite,
} from './doc-edit-list.js';

// The item model of a list block and its structural edits.
// Design: doc_page_impl_edit_structure.md#the-list-model

const F = '```';

function modelOf(lineList, format = 'md') {
  const result = listTextModelBuild(lineList.join('\n'), { format });
  assert.equal(result.code, 0, result.message);
  return result.data;
}

// the edit applied, its text as lines
function linesAfter(result) {
  assert.equal(result.code, 0, result.message);
  return result.data.text.split('\n');
}

const listNested = [
  '- fruit',
  '  - apple',
  '    - fuji',
  '    - gala',
  '  - pear',
  '- bread',
];

// ---------- reading ----------

test('reads the items of a list with their paths, depths and own text', () => {
  const model = modelOf(listNested);
  assert.deepEqual(
    model.rowList.map((item) => [item.path, item.depth, listItemTextGet(model, item.path)]),
    [['0', 0, 'fruit'], ['0.0', 1, 'apple'], ['0.0.0', 2, 'fuji'], ['0.0.1', 2, 'gala'], ['0.1', 1, 'pear'], ['1', 0, 'bread']],
  );
  const info = listItemInfoBuild(listItemGet(model, '0'));
  assert.equal(info.childCount, 2);
  assert.equal(info.descendantCount, 4);
  assert.equal(info.lineStart, 1);
  assert.equal(info.lineEnd, 5);
});

test('writes a list back as it was read', () => {
  const sampleList = [
    listNested,
    ['1. one', '2. two', '   - a', '   - b', '3. three'],
    ['9. nine', '10. ten', '    more ten', '    - child'],
    ['- a', '', '  second paragraph', '', '- b', '', '  - c'],
    ['- text<!--renderComp=Image-->', `  ${F}yaml`, '  src: dog.png', `  ${F}`, '  after', '- next'],
    ['- - a', '  - b', '- c'],
    ['-', '  - child', '- x', '-'],
    ['-', '  foo', '- bar'],
    ['- a', '    - b', '    - c', '- d'],
    ['- [ ] todo', '- [x] done', '  - [ ] sub'],
    ['- a', '  - x', '  1. y', '- b'],
    ['- a', '  - x', '', '  tail', '- b'],
    ['-     code', '- x'],
    [' * a', ' * b', '   * c'],
  ];
  for (const lineList of sampleList) {
    assert.equal(listTextBuild(modelOf(lineList)), lineList.join('\n'));
  }
});

test('a lazily indented line is written at the text column of its item', () => {
  const model = modelOf(['- a', '  - child', 'lazy text', '- b']);
  assert.equal(listItemTextGet(model, '0.0'), 'child\nlazy text');
  assert.equal(listTextBuild(model), ['- a', '  - child', '    lazy text', '- b'].join('\n'));
});

test('a list indented with tabs has no item model', () => {
  const result = listTextModelBuild('- a\n\t- b');
  assert.equal(result.code, -1);
  assert.match(result.message, /tabs/);
});

test('the lines of the block before the list are kept', () => {
  const result = listTextModelBuild('- a\n- b', { linePrefixList: ['<!--renderComp=Anchor,id=todo-->'] });
  const edited = listItemTextSet(result.data, '1', 'bee');
  assert.deepEqual(linesAfter(edited), ['<!--renderComp=Anchor,id=todo-->', '- a', '- bee']);
});

// ---------- the own text of an item ----------

test('replaces the own text of an item and keeps what is under it', () => {
  const model = modelOf(listNested);
  const result = listItemTextSet(model, '0.0', 'apples of **two** kinds');
  assert.deepEqual(linesAfter(result), [
    '- fruit',
    '  - apples of **two** kinds',
    '    - fuji',
    '    - gala',
    '  - pear',
    '- bread',
  ]);
  assert.equal(result.data.itemPath, '0.0');
});

test('indents every line of a text of several lines to the text column of the item', () => {
  const model = modelOf(['1. one', '2. two', '   - a']);
  const result = listItemTextSet(model, '1', ['see the block:', `${F}js`, 'const a = 1;', '  indented();', F, 'and after'].join('\n'));
  assert.deepEqual(linesAfter(result), [
    '1. one',
    '2. see the block:',
    `   ${F}js`,
    '   const a = 1;',
    '     indented();',
    `   ${F}`,
    '   and after',
    '   - a',
  ]);
});

test('an item whose text is emptied keeps its marker and its children', () => {
  const model = modelOf(listNested);
  assert.deepEqual(linesAfter(listItemTextSet(model, '0.1', '   \n')), [
    '- fruit',
    '  - apple',
    '    - fuji',
    '    - gala',
    '  -',
    '- bread',
  ]);
  assert.deepEqual(linesAfter(listItemTextSet(model, '0', '')), ['-', '  - apple', '    - fuji', '    - gala', '  - pear', '- bread']);
});

test('an item without text right under a line of text is kept an item by an empty comment', () => {
  // "-" alone under "fruit" would underline it as a heading, and no marker alone reads as an item there
  const model = modelOf(listNested);
  const emptied = listItemTextSet(model, '0.0', '');
  assert.deepEqual(linesAfter(emptied), ['- fruit', '  - <!---->', '    - fuji', '    - gala', '  - pear', '- bread']);
  // read back, it is an item without text, and a text takes the place of the comment
  const modelEmptied = modelOf(linesAfter(emptied));
  assert.equal(listItemTextGet(modelEmptied, '0.0'), '');
  assert.deepEqual(linesAfter(listItemTextSet(modelEmptied, '0.0', 'apple')), listNested);
  assert.deepEqual(linesAfter(listItemInsert(modelOf(['- a', '- b']), '0', 'child', '')), ['- a', '  - <!---->', '- b']);
  // an mdx document has no html comments: an empty expression comment
  const resultMdx = listItemInsert(modelOf(['- a', '- b'], 'mdx'), '0', 'child', '');
  assert.deepEqual(linesAfter(resultMdx), ['- a', '  - {/**/}', '- b']);
  // anywhere else an item without text is its marker alone
  assert.deepEqual(linesAfter(listItemInsert(modelOf(['- a', '  - x', '- b']), '0.0', 'after', '')), ['- a', '  - x', '  -', '- b']);
});

test('refuses a text that would swallow what is under the item', () => {
  const model = modelOf(listNested);
  // a fence that is never closed takes the nested list as code
  const result = listItemTextSet(model, '0.0', `apple\n${F}`);
  assert.equal(result.code, -1);
  assert.match(result.message, /would not read back/);
});

test('list items typed at the end of a text become the first children of the item', () => {
  const model = modelOf(listNested);
  const result = listItemTextSet(model, '0.0', 'apple\n- braeburn');
  assert.deepEqual(linesAfter(result), [
    '- fruit',
    '  - apple',
    '    - braeburn',
    '    - fuji',
    '    - gala',
    '  - pear',
    '- bread',
  ]);
});

// ---------- inserting ----------

test('inserts an item before, after and under an item', () => {
  const model = modelOf(listNested);
  const before = listItemInsert(model, '0.0', 'before', 'new');
  assert.deepEqual(linesAfter(before), ['- fruit', '  - new', '  - apple', '    - fuji', '    - gala', '  - pear', '- bread']);
  assert.equal(before.data.itemPath, '0.0');
  // after an item: after everything under it
  const after = listItemInsert(model, '0.0', 'after', 'new');
  assert.deepEqual(linesAfter(after), ['- fruit', '  - apple', '    - fuji', '    - gala', '  - new', '  - pear', '- bread']);
  assert.equal(after.data.itemPath, '0.1');
  const child = listItemInsert(model, '1', 'child', 'rye');
  assert.deepEqual(linesAfter(child), [...listNested, '  - rye']);
  assert.equal(child.data.itemPath, '1.0');
});

test('a new item without text is a marker alone', () => {
  const model = modelOf(['- a', '- b']);
  const result = listItemInsert(model, '0', 'after');
  assert.deepEqual(linesAfter(result), ['- a', '-', '- b']);
  assert.equal(result.data.itemPath, '1');
});

test('numbers a numbered list again when an item is inserted, with the wider marker indented for', () => {
  const lineList = ['8. eight', '9. nine', '   - under nine', '10. ten'];
  const result = listItemInsert(modelOf(lineList), '0', 'after', 'new');
  assert.deepEqual(linesAfter(result), ['8. eight', '9. new', '10. nine', '    - under nine', '11. ten']);
});

test('keeps the numbers of a list its author numbered all the same', () => {
  const result = listItemInsert(modelOf(['1. a', '1. b']), '1', 'after', 'c');
  assert.deepEqual(linesAfter(result), ['1. a', '1. b', '1. c']);
});

test('a new item of a loose list is parted by a blank line like the others', () => {
  const lineList = ['- a', '', '- b'];
  assert.deepEqual(linesAfter(listItemInsert(modelOf(lineList), '0', 'after', 'new')), ['- a', '', '- new', '', '- b']);
  assert.deepEqual(linesAfter(listItemInsert(modelOf(lineList), '0', 'before', 'new')), ['- new', '', '- a', '', '- b']);
});

// ---------- deleting ----------

test('deletes an item with what is under it, or alone', () => {
  const model = modelOf(listNested);
  assert.deepEqual(linesAfter(listItemDelete(model, '0.0', 'subtree')), ['- fruit', '  - pear', '- bread']);
  // alone: its children take its place, one level up
  assert.deepEqual(linesAfter(listItemDelete(model, '0.0', 'item')), ['- fruit', '  - fuji', '  - gala', '  - pear', '- bread']);
});

test('the last child deleted leaves an item without a list', () => {
  const model = modelOf(['- a', '  - only', '- b']);
  assert.deepEqual(linesAfter(listItemDelete(model, '0.0')), ['- a', '- b']);
});

test('the last item deleted leaves no list', () => {
  const result = listItemDelete(modelOf(['- only']), '0');
  assert.equal(result.code, 0);
  assert.equal(result.data.isListEmpty, true);
});

// ---------- levels ----------

test('indents an item with what is under it: the last child of the item before it', () => {
  const model = modelOf(['- a', '- b', '  - c', '- d']);
  const result = listItemIndent(model, '1', 'subtree');
  assert.deepEqual(linesAfter(result), ['- a', '  - b', '    - c', '- d']);
  assert.equal(result.data.itemPath, '0.0');
});

test('indents an item alone: its children keep their level and follow it', () => {
  const model = modelOf(['- a', '- b', '  - c', '- d']);
  const result = listItemIndent(model, '1', 'item');
  assert.deepEqual(linesAfter(result), ['- a', '  - b', '  - c', '- d']);
  assert.equal(result.data.itemPath, '0.0');
});

test('an indented item joins the list the item before it already has, written like it', () => {
  const model = modelOf(['1. a', '   1. x', '   2. y', '2. b', '3. c']);
  assert.deepEqual(linesAfter(listItemIndent(model, '1')), ['1. a', '   1. x', '   2. y', '   3. b', '2. c']);
  const modelMixed = modelOf(['- a', '  * x', '- b']);
  assert.deepEqual(linesAfter(listItemIndent(modelMixed, '1')), ['- a', '  * x', '  * b']);
});

test('refuses to indent the first item of a list', () => {
  const model = modelOf(listNested);
  assert.equal(listItemIndent(model, '0').code, -1);
  assert.match(listItemEditReasonGet(model, '0.0', 'indent'), /first item/);
  assert.equal(listItemEditReasonGet(model, '0.1', 'indent'), '');
});

test('outdents an item with what is under it; the items after it come under it', () => {
  const model = modelOf(listNested);
  const result = listItemOutdent(model, '0.0');
  assert.deepEqual(linesAfter(result), ['- fruit', '- apple', '  - fuji', '  - gala', '  - pear', '- bread']);
  assert.equal(result.data.itemPath, '1');
});

test('an outdent moves no line up or down', () => {
  const model = modelOf(['1. a', '   - x', '   - y', '   - z', '2. b']);
  assert.deepEqual(linesAfter(listItemOutdent(model, '0.1')), ['1. a', '   - x', '2. y', '   - z', '3. b']);
});

test('refuses to outdent an item of the first level', () => {
  const model = modelOf(listNested);
  assert.equal(listItemOutdent(model, '1').code, -1);
  assert.match(listItemEditReasonGet(model, '1', 'outdent'), /first level/);
});

test('indent and outdent keep the blank lines of a loose list where they are', () => {
  const lineList = ['- a', '', '- b', '', '- c'];
  const indented = listItemIndent(modelOf(lineList), '1');
  assert.deepEqual(linesAfter(indented), ['- a', '', '  - b', '', '- c']);
  const outdented = listItemOutdent(modelOf(linesAfter(indented)), '0.0');
  assert.deepEqual(linesAfter(outdented), lineList);
});

// ---------- moving ----------

test('moves an item with what is under it', () => {
  const model = modelOf(listNested);
  const result = listItemMove(model, '0.0', 'subtree', { itemPath: '1', position: 'after' });
  assert.deepEqual(linesAfter(result), ['- fruit', '  - pear', '- bread', '- apple', '  - fuji', '  - gala']);
  assert.equal(result.data.itemPath, '2');
});

test('moves an item alone: its children take its place', () => {
  const model = modelOf(listNested);
  const result = listItemMove(model, '0.0', 'item', { itemPath: '1', position: 'before' });
  assert.deepEqual(linesAfter(result), ['- fruit', '  - fuji', '  - gala', '  - pear', '- apple', '- bread']);
  assert.equal(result.data.itemPath, '1');
});

test('moves an item under another as its first or last child', () => {
  const model = modelOf(listNested);
  assert.deepEqual(
    linesAfter(listItemMove(model, '1', 'subtree', { itemPath: '0', position: 'childFirst' })),
    ['- fruit', '  - bread', '  - apple', '    - fuji', '    - gala', '  - pear'],
  );
  assert.deepEqual(
    linesAfter(listItemMove(model, '0.1', 'subtree', { itemPath: '1', position: 'childLast' })),
    ['- fruit', '  - apple', '    - fuji', '    - gala', '- bread', '  - pear'],
  );
});

test('a moved item is written like the list it joins', () => {
  const model = modelOf(['1. a', '2. b', '   - x', '   - y', '3. c']);
  const result = listItemMove(model, '1.1', 'subtree', { itemPath: '0', position: 'after' });
  assert.deepEqual(linesAfter(result), ['1. a', '2. y', '3. b', '   - x', '4. c']);
});

test('refuses to move an item into itself, and tells a move to the same place', () => {
  const model = modelOf(listNested);
  assert.equal(listItemMove(model, '0', 'subtree', { itemPath: '0.0', position: 'after' }).code, -1);
  const same = listItemMove(model, '0.1', 'subtree', { itemPath: '0.0', position: 'after' });
  assert.equal(same.code, 0);
  assert.equal(same.data.isNoop, true);
});

test('swaps an item with the one before or after it in its list', () => {
  const model = modelOf(listNested);
  assert.deepEqual(linesAfter(listItemMoveSibling(model, '0.1', 'up')), ['- fruit', '  - pear', '  - apple', '    - fuji', '    - gala', '- bread']);
  assert.deepEqual(linesAfter(listItemMoveSibling(model, '0', 'down')), ['- bread', '- fruit', '  - apple', '    - fuji', '    - gala', '  - pear']);
  assert.equal(listItemMoveSibling(model, '0', 'up').code, -1);
  assert.match(listItemEditReasonGet(model, '1', 'moveDown'), /last item/);
});

test('takes an item out of one list and puts it into another', () => {
  const modelFrom = modelOf(listNested);
  const modelTo = modelOf(['1. first', '2. second']);
  const detached = listItemDetach(modelFrom, '0.0', 'subtree');
  assert.deepEqual(linesAfter(detached), ['- fruit', '  - pear', '- bread']);
  const attached = listItemAttach(modelTo, detached.data.item, { itemPath: '0', position: 'after' });
  assert.deepEqual(linesAfter(attached), ['1. first', '2. apple', '   - fuji', '   - gala', '3. second']);
  assert.equal(attached.data.itemPath, '1');
});

// ---------- the kind of a list ----------

test('turns the list of an item into numbers or bullets, its nested lists untouched', () => {
  const model = modelOf(listNested);
  const numbered = listItemListTypeSet(model, '0', 'ordered');
  assert.deepEqual(linesAfter(numbered), ['1. fruit', '   - apple', '     - fuji', '     - gala', '   - pear', '2. bread']);
  const bullets = listItemListTypeSet(modelOf(linesAfter(numbered)), '1', 'unordered');
  assert.deepEqual(linesAfter(bullets), listNested);
  // only the nested list the item is in
  assert.deepEqual(linesAfter(listItemListTypeSet(model, '0.0.1', 'ordered')), ['- fruit', '  - apple', '    1. fuji', '    2. gala', '  - pear', '- bread']);
});

// ---------- components in items ----------

test('a component block of an item moves with the item and is indented again', () => {
  const lineList = ['- first<!--renderComp=Image-->', `  ${F}yaml`, '  src: dog.png', `  ${F}`, '- second', '  - inner'];
  const model = modelOf(lineList);
  const result = listItemMove(model, '0', 'subtree', { itemPath: '1.0', position: 'after' });
  assert.deepEqual(linesAfter(result), [
    '- second',
    '  - inner',
    '  - first<!--renderComp=Image-->',
    `    ${F}yaml`,
    '    src: dog.png',
    `    ${F}`,
  ]);
});

test('an item with text after its sub-items cannot leave them behind', () => {
  const model = modelOf(['- a', '- b', '  - x', '', '  tail', '- c']);
  assert.equal(listItemIndent(model, '1', 'item').code, -1);
  assert.match(listItemEditReasonGet(model, '1', 'delete', 'item'), /text after its sub-items/);
  // with them, it moves as it is
  assert.deepEqual(linesAfter(listItemIndent(model, '1', 'subtree')), ['- a', '  - b', '    - x', '', '    tail', '- c']);
});

test('the children of an item are the items of all its nested lists', () => {
  const model = modelOf(['- a', '  - x', '  1. y', '- b']);
  assert.deepEqual(itemChildListGet(listItemGet(model, '0')).map((item) => item.path), ['0.0', '0.1']);
  assert.equal(listItemTextGet(model, '0.1'), 'y');
});

// ---------- splitting and joining ----------

test('splits an item at a place of its text; the new item takes what was under it', () => {
  const model = modelOf(listNested);
  const middle = listItemSplit(model, '0.0', 'ap', 'ple');
  assert.deepEqual(linesAfter(middle), ['- fruit', '  - ap', '  - ple', '    - fuji', '    - gala', '  - pear', '- bread']);
  assert.equal(middle.data.itemPath, '0.1');
  // at the end: a new item without text, which takes the sub-items
  assert.deepEqual(linesAfter(listItemSplit(model, '1', 'bread', '')), [...listNested, '-']);
  assert.deepEqual(linesAfter(listItemSplit(model, '0.0', 'apple', '')), ['- fruit', '  - apple', '  -', '    - fuji', '    - gala', '  - pear', '- bread']);
  // at the start: an item without text above (kept an item under the line of text)
  assert.deepEqual(linesAfter(listItemSplit(model, '0.0', '', 'apple')), ['- fruit', '  - <!---->', '  - apple', '    - fuji', '    - gala', '  - pear', '- bread']);
});

test('a split numbers a numbered list on', () => {
  const result = listItemSplit(modelOf(['1. one two', '2. three']), '0', 'one ', 'two');
  assert.deepEqual(linesAfter(result), ['1. one ', '2. two', '3. three']);
});

test('joins an item to the row above it; no other line changes its level', () => {
  const model = modelOf(listNested);
  // to the item before it: what was under it stays under the joined item
  const sibling = listItemMergeUp(modelOf(['- shopping', '- list', '  - milk', '- end']), '1');
  assert.deepEqual(linesAfter(sibling), ['- shoppinglist', '  - milk', '- end']);
  assert.deepEqual([sibling.data.itemPath, sibling.data.offset], ['0', 8]);
  // to the last item under the item before it: its sub-items keep their level
  const deeper = listItemMergeUp(modelOf(['- a', '  - a1', '- b', '  - b1']), '1');
  assert.deepEqual(linesAfter(deeper), ['- a', '  - a1b', '  - b1']);
  assert.equal(deeper.data.itemPath, '0.0');
  // to the item it is under: its sub-items take its place
  const parent = listItemMergeUp(model, '0.0');
  assert.deepEqual(linesAfter(parent), ['- fruitapple', '  - fuji', '  - gala', '  - pear', '- bread']);
  assert.equal(parent.data.offset, 5);
  // with texts being typed
  const typed = listItemMergeUp(model, '1', { textItem: 'rolls' });
  assert.deepEqual(linesAfter(typed).slice(-1), ['  - pearrolls']);
  // an item without text joined up is simply gone
  assert.deepEqual(linesAfter(listItemMergeUp(modelOf(['- a', '-', '- b']), '1')), ['- a', '- b']);
});

test('refuses to join where there is nothing to join to; a text meeting a code block joins as written', () => {
  assert.equal(listItemMergeUp(modelOf(listNested), '0').code, -1);
  // the row above ends with a block: the text follows it, a line apart
  const withBlock = modelOf(['- a', `  ${F}text`, '  one', `  ${F}`, '- b']);
  const result = listItemMergeUp(withBlock, '1');
  assert.equal(result.code, 0);
  assert.deepEqual(linesAfter(result), ['- a', `  ${F}text`, '  one', `  ${F}`, '  b']);
  assert.deepEqual([result.data.offset, result.data.isOffsetSource], [`a\n${F}text\none\n${F}`.length, true]);
});

test('a split and a join undo each other', () => {
  const model = modelOf(listNested);
  const split = listItemSplit(model, '0.0', 'ap', 'ple');
  const joined = listItemMergeUp(modelOf(linesAfter(split)), split.data.itemPath);
  assert.deepEqual(linesAfter(joined), listNested);
});

// ---------- an item as a text block ----------

test('tells an item that is one fenced block, and builds the block of a text', () => {
  assert.deepEqual(itemBlockFormatGet(`${F}text\nline one\nline two\n${F}`), { info: 'text', textInner: 'line one\nline two' });
  assert.equal(itemBlockFormatGet('plain text'), undefined);
  assert.equal(itemBlockFormatGet(`text<!--renderComp=Image-->\n${F}yaml\nsrc: a.png\n${F}`), undefined);
  assert.equal(itemBlockFormatGet(`${F}js\na\n${F}\n${F}js\nb\n${F}`), undefined);
  assert.equal(itemBlockTextBuild('one\ntwo'), `${F}text\none\ntwo\n${F}`);
  // a line that could close the fence makes the fence longer
  assert.equal(itemBlockTextBuild(`a\n${F}\nb`), `${F}\`text\na\n${F}\nb\n${F}\``);
  assert.deepEqual(itemBlockFormatGet(itemBlockTextBuild(`a\n${F}\nb`)), { info: 'text', textInner: `a\n${F}\nb` });
});

test('an item turned into a text block keeps its place and what is under it', () => {
  const model = modelOf(listNested);
  const result = listItemTextSet(model, '0.0', itemBlockTextBuild('apple\nof two kinds'));
  assert.deepEqual(linesAfter(result), [
    '- fruit',
    `  - ${F}text`,
    '    apple',
    '    of two kinds',
    `    ${F}`,
    '    - fuji',
    '    - gala',
    '  - pear',
    '- bread',
  ]);
  assert.deepEqual(itemBlockFormatGet(listItemTextGet(modelOf(linesAfter(result)), '0.0')), { info: 'text', textInner: 'apple\nof two kinds' });
});

// ---------- a text block split and joined ----------

test('a block of text is text, a block of another language is code', () => {
  assert.equal(itemBlockInfoIsText('text'), true);
  assert.equal(itemBlockInfoIsText('text view=card'), true);
  assert.equal(itemBlockInfoIsText(''), true);
  assert.equal(itemBlockInfoIsText('plaintext'), true);
  assert.equal(itemBlockInfoIsText('js'), false);
  assert.equal(itemBlockInfoIsText('yaml title="a"'), false);
});

test('a typed text is written as its lines ask: a block while it holds a line break', () => {
  assert.equal(itemTextWrite('one line', 'text'), 'one line');
  assert.equal(itemTextWrite('one\ntwo', 'text'), `${F}text\none\ntwo\n${F}`);
  assert.equal(itemTextWrite('one\ntwo', 'text view=card'), `${F}text view=card\none\ntwo\n${F}`);
  // code stays a block, also when it is one line; a text that is no block is left as it is
  assert.equal(itemTextWrite('const a = 1;', 'js'), `${F}js\nconst a = 1;\n${F}`);
  assert.equal(itemTextWrite('two\n\nparagraphs', undefined), 'two\n\nparagraphs');
  assert.deepEqual(itemTextParse(`${F}text\none\ntwo\n${F}`), { text: 'one\ntwo', info: 'text' });
  assert.deepEqual(itemTextParse('one line'), { text: 'one line', info: undefined });
});

test('a text is split at a place: what stands at the place is text of neither part', () => {
  // in a line: the spaces
  assert.deepEqual(itemTextSplit('apples and pears', 7), { textBefore: 'apples', textAfter: 'and pears' });
  // in a text of lines: the line break, and blank lines around it
  assert.deepEqual(itemTextSplit('one\ntwo\nthree', 3), { textBefore: 'one', textAfter: 'two\nthree' });
  assert.deepEqual(itemTextSplit('one\ntwo\nthree', 4), { textBefore: 'one', textAfter: 'two\nthree' });
  assert.deepEqual(itemTextSplit('one\n\n\ntwo\n', 3), { textBefore: 'one', textAfter: 'two' });
  // in the middle of a line of several
  assert.deepEqual(itemTextSplit('one\ntwo words\nthree', 7), { textBefore: 'one\ntwo', textAfter: 'words\nthree' });
  // the indentation of a line that starts a text of lines is its own
  assert.deepEqual(itemTextSplit('one\n  two\n  three', 4), { textBefore: 'one', textAfter: '  two\n  three' });
  assert.deepEqual(itemTextSplit('one\n  two', 4), { textBefore: 'one', textAfter: 'two' });
  // a selected part goes
  assert.deepEqual(itemTextSplit('one\ntwo\nthree', 3, 7), { textBefore: 'one', textAfter: 'three' });
});

const listWithBlock = [
  '- fruit',
  `  - ${F}text`,
  '    one',
  '    two',
  '    three',
  `    ${F}`,
  '    - fuji',
  '  - pear',
  '- bread',
];

test('the parts of a split text block: a block while it has lines, a plain line when it is one', () => {
  const model = modelOf(listWithBlock);
  const { textBefore, textAfter } = itemTextSplit('one\ntwo\nthree', 3);
  const result = listItemSplit(model, '0.0', itemTextWrite(textBefore, 'text'), itemTextWrite(textAfter, 'text'));
  assert.deepEqual(linesAfter(result), [
    '- fruit',
    '  - one',
    `  - ${F}text`,
    '    two',
    '    three',
    `    ${F}`,
    '    - fuji',
    '  - pear',
    '- bread',
  ]);
  assert.equal(result.data.itemPath, '0.1');
});

test('a plain line joins the text block above it, and a text block the line above it', () => {
  // "pear" joins the block: the last row above it is "fuji", so join "fuji" away first
  const model = modelOf(['- fruit', `  - ${F}text`, '    one', '    two', `    ${F}`, '  - pear', '- bread']);
  const joined = listItemMergeUp(model, '0.1');
  assert.deepEqual(linesAfter(joined), ['- fruit', `  - ${F}text`, '    one', '    twopear', `    ${F}`, '- bread']);
  // the caret goes where the texts meet, counted in the lines of the block
  assert.deepEqual([joined.data.itemPath, joined.data.offset], ['0.0', 'one\ntwo'.length]);
  // a text block joins the plain line above it: the joined text has lines, so it is a block
  const up = listItemMergeUp(model, '0.0');
  assert.deepEqual(linesAfter(up), [`- ${F}text`, '  fruitone', '  two', `  ${F}`, '  - pear', '- bread']);
  assert.equal(up.data.offset, 'fruit'.length);
  // a text being typed in the block (as the editor hands it over) joins the same way
  const typed = listItemMergeUp(model, '0.1', { textReceiver: `${F}text\none\ntwo more\n${F}` });
  assert.deepEqual(linesAfter(typed), ['- fruit', `  - ${F}text`, '    one', '    two morepear', `    ${F}`, '- bread']);
});

test('two lines joined out of a text block are a plain line; code joins as written', () => {
  const split = modelOf(['- one', `- ${F}js`, '  const a = 1;', `  ${F}`, '- after']);
  // a block of code under the text of the row above, and a text after a block of code
  assert.deepEqual(linesAfter(listItemMergeUp(split, '1')), ['- one', `  ${F}js`, '  const a = 1;', `  ${F}`, '- after']);
  assert.deepEqual(linesAfter(listItemMergeUp(split, '2')), ['- one', `- ${F}js`, '  const a = 1;', `  ${F}`, '  after']);
  // a block of text does not take a text holding a fence into its lines
  const textAndIcon = modelOf(['- ```text', '  one', '  ```', '- see', `  ${F}sh view=icon`, '  ls', `  ${F}`]);
  assert.deepEqual(linesAfter(listItemMergeUp(textAndIcon, '1')), ['- ```text', '  one', '  ```', '  see', `  ${F}sh view=icon`, '  ls', `  ${F}`]);
  // a block of one line (as typed) joined to a line is a line
  const model = modelOf(['- one', '- two']);
  const joined = listItemMergeUp(model, '1', { textItem: `${F}text\ntwo\n${F}` });
  assert.deepEqual(linesAfter(joined), ['- onetwo']);
  // an item without text is simply gone, whatever stands above it
  const gone = listItemMergeUp(modelOf(['- one', `- ${F}js`, '  const a = 1;', `  ${F}`, '-']), '2');
  assert.deepEqual(linesAfter(gone), ['- one', `- ${F}js`, '  const a = 1;', `  ${F}`]);
});
