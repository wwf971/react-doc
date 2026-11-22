import { test } from 'node:test';
import { codeTextJoin, textJoinSpaceIs } from './doc-edit-code.js';
import assert from 'node:assert/strict';
import {
  itemAtomCharStrip, itemAtomModelBuild, itemAtomOffsetDisplayGet, itemAtomTextBuild, itemAtomTextSourceGet, itemCodeBlockListGet,
  itemBlockSplitOut, itemPartGet, itemPartOffsetGet, itemPartTextWrite,
} from './doc-edit-item-atom.js';

const A0 = '';
const A1 = '';
// the view each place is given by the config of the test: a block that is the
// whole item is an icon, any other block a card unless it says otherwise
const viewResolve = ({ viewAuthored, place }) => viewAuthored || (place === 'listItem' ? 'icon' : 'card');

const textTwo = [
  'see the query',
  '```sql view=icon title="weekly"',
  'select 1',
  '```',
  'then the script',
  '```sh view=icon',
  'ls -la',
  '```',
].join('\n');

test('the code blocks of a text', () => {
  const blockList = itemCodeBlockListGet(textTwo);
  assert.equal(blockList.length, 2);
  assert.deepEqual(blockList.map((block) => [block.form, block.lang, block.title, block.viewAuthored, block.lineCount]), [
    ['fence', 'sql', 'weekly', 'icon', 1],
    ['fence', 'sh', '', 'icon', 1],
  ]);
  assert.equal(textTwo.slice(blockList[0].start, blockList[0].end), '```sql view=icon title="weekly"\nselect 1\n```');
  // an unclosed fence takes the rest; a fence of another component is its data
  assert.equal(itemCodeBlockListGet('a\n```js\nb').length, 0);
  assert.equal(itemCodeBlockListGet('<!--renderComp=Image-->\n```yaml\nsrc: a.png\n```').length, 0);
  assert.equal(itemCodeBlockListGet('```asset\nstore: local\n```').length, 0);
});

test('a block of Code: its marker is part of it', () => {
  const text = 'run\n<!--renderComp=Code,view=icon,title=setup.py-->\n```asset\nstore: local\nitemId: abc\n```';
  const [block] = itemCodeBlockListGet(text);
  assert.equal(block.form, 'component');
  assert.equal(block.viewAuthored, 'icon');
  assert.equal(block.title, 'setup.py');
  assert.equal(block.isReference, true);
  assert.equal(block.source, text.slice(4));
  const model = itemAtomModelBuild(text, { viewResolve });
  assert.equal(model.display, `run${A0}`);
  assert.equal(model.atomList[0].label, 'setup.py');
});

test('the typed text of an item with icons', () => {
  const model = itemAtomModelBuild(textTwo, { viewResolve });
  assert.equal(model.display, `see the query${A0}then the script${A1}`);
  assert.deepEqual(model.atomList.map((atom) => atom.label), ['weekly', 'sh']);
  // unchanged: the text as it was
  assert.equal(itemAtomTextBuild(model.display, model), textTwo);
  // a word typed: every block on lines of its own again
  assert.equal(itemAtomTextBuild(`see the query${A0}then the script${A1} done`, model), `${textTwo}\ndone`);
  // spaces and line breaks next to a block are not text
  assert.equal(
    itemAtomTextBuild(`see the query ${A0}  then the script \n${A1}`, model),
    textTwo,
  );
  // an icon deleted, two icons next to each other
  assert.equal(itemAtomTextBuild(`see the query${A1}`, model), 'see the query\n```sh view=icon\nls -la\n```');
  assert.equal(itemAtomTextBuild(`${A1}${A0}`, model).split('\n').filter((line) => line === '').length, 0);
  // a character of no atom is dropped
  assert.equal(itemAtomTextBuild(`xy${A0}`, model).startsWith('xy\n```sql'), true);
  assert.equal(itemAtomCharStrip(`a${A0}b`), 'ab');
});

test('a block drawn as an icon by its place keeps its view when the place changes', () => {
  const text = '```text\naaaa\nbbbb\n```';
  const model = itemAtomModelBuild(text, { viewResolve });
  assert.equal(model.display, A0);
  assert.equal(model.atomList[0].place, 'listItem');
  // text beside it: the block is no longer the whole item, its icon is written
  assert.equal(itemAtomTextBuild(`note${A0}`, model), 'note\n```text view=icon\naaaa\nbbbb\n```');
  // a block of another view among text is an atom of a line of its own; the
  // whole text of an item, it is no atom (its item is edited as its lines)
  const card = itemAtomModelBuild('a\n```js\nx\n```\nb', { viewResolve });
  assert.deepEqual([card.display, card.atomList[0].kind, card.atomList[0].view], [`a${A0}b`, 'block', 'card']);
  assert.equal(itemAtomModelBuild('```js\nx\n```', { viewResolve: () => 'card' }), undefined);
  assert.equal(itemAtomModelBuild('```js\nx\n```', { viewResolve: () => 'icon' }).atomList[0].kind, 'icon');
  // a block of a line of its own that becomes the whole item keeps its view
  assert.equal(itemAtomTextBuild(A0, card), '```js view=card\nx\n```');
});

test('offsets of the own text in the typed text', () => {
  const model = itemAtomModelBuild(textTwo, { viewResolve });
  const indexQuery = 'see the query'.length;
  assert.equal(itemAtomOffsetDisplayGet(model, 3), 3);
  assert.equal(itemAtomOffsetDisplayGet(model, indexQuery), indexQuery);
  assert.equal(itemAtomOffsetDisplayGet(model, indexQuery + 4), indexQuery + 1);
  const indexThen = textTwo.indexOf('then');
  assert.equal(itemAtomOffsetDisplayGet(model, indexThen), indexQuery + 1);
  assert.equal(itemAtomOffsetDisplayGet(model, textTwo.length), model.display.length);
});

test('the typed text copied out with its blocks', () => {
  const model = itemAtomModelBuild(textTwo, { viewResolve });
  assert.equal(itemAtomTextSourceGet(`query${A0}then`, model), 'query\n```sql view=icon title="weekly"\nselect 1\n```\nthen');
});

test('a part of an item: the lines of a code block among its text, edited and written back', () => {
  const text = ['see', '```text', 'one', 'two', '```', 'then', '```sh view=icon', 'ls', '```'].join('\n');
  const part = itemPartGet(text, 0);
  assert.deepEqual([part.info, part.textInner], ['text', 'one\ntwo']);
  // the whole text of an item, and a block of Code reading an item, are no parts
  assert.equal(itemPartGet('```text\na\n```', 0), undefined);
  assert.equal(itemPartGet('a\n<!--renderComp=Code-->\n```asset\nitemId: x\n```', 0), undefined);
  const written = itemPartTextWrite(text, 0, 'one\ntwo\nthree');
  assert.equal(written.text, ['see', '```text', 'one', 'two', 'three', '```', 'then', '```sh view=icon', 'ls', '```'].join('\n'));
  // a block among text stays a block, whatever its lines
  assert.equal(itemPartTextWrite(text, 0, 'one two').text, ['see', '```text', 'one two', '```', 'then', '```sh view=icon', 'ls', '```'].join('\n'));
  // taken out with a line break
  const removed = itemPartTextWrite(text, 0, '', { isRemoved: true });
  assert.equal(removed.text, ['see', 'then', '```sh view=icon', 'ls', '```'].join('\n'));
  // the place before and after it, read as places of the typed text
  const model = itemAtomModelBuild(text, { viewResolve });
  assert.equal(model.display, `see${A0}then${A1}`);
  assert.equal(itemAtomOffsetDisplayGet(model, itemPartOffsetGet(text, written.start, 'before')), 3);
  assert.equal(itemAtomOffsetDisplayGet(model, itemPartOffsetGet(text, model.atomList[0].end, 'after')), 4);
});

test('Enter in the lines of a block: the lines after the caret become text after it, joined to that text', () => {
  const options = { textJoin: codeTextJoin, spaceIs: textJoinSpaceIs };
  const text = ['see', '```text', 'bbaaaa', 'cc', '```', 'then more'].join('\n');
  const split = itemBlockSplitOut(text, 0, 'bbaaaa\ncc', 2, 2, options);
  assert.equal(split.text, ['see', '```text', 'bb', '```', 'aaaa cc then more'].join('\n'));
  assert.equal(split.text.slice(split.offset), 'aaaa cc then more');
  // at the end of the lines: nothing moves, the caret goes after the block
  const end = itemBlockSplitOut(text, 0, 'bbaaaa\ncc', 9, 9, options);
  assert.equal(end.text, text);
  assert.equal(end.text.slice(end.offset), 'then more');
  // at the start: every line leaves, the block is gone
  const start = itemBlockSplitOut(text, 0, 'bbaaaa\ncc', 0, 0, options);
  assert.equal(start.text, ['see', 'bbaaaa cc then more'].join('\n'));
  // a block that is the whole item, nothing after it
  const whole = itemBlockSplitOut('```js\nconst a = 1;\nb();\n```', 0, 'const a = 1;\nb();', 12, 12, options);
  assert.equal(whole.text, '```js\nconst a = 1;\n```\nb();');
  assert.equal(whole.text.slice(whole.offset), 'b();');
});

test('an MDX block of an item is a chip, icon by default, never a part', () => {
  const text = ['see', '<!--renderComp=Mdx,view=icon,title=Notes-->', '```md', '# Notes', 'a line', '```', 'then', '<!--renderComp=Mdx,view=card-->', '```md', 'b', '```'].join('\n');
  const model = itemAtomModelBuild(text, { viewResolve: () => 'card' });
  assert.deepEqual(model.atomList.map((atom) => [atom.compName, atom.kind, atom.label, atom.isEmbed]), [['Mdx', 'icon', 'Notes', true], ['Mdx', 'block', 'mdx', true]]);
  assert.equal(model.display, `see${A0}then${A1}`);
  assert.equal(itemAtomTextBuild(model.display, model), text);
  assert.equal(itemPartGet(text, 0), undefined);
  // the whole item, without a view written: an icon
  const whole = itemAtomModelBuild('<!--renderComp=Mdx-->\n```md\nx\n```', { viewResolve: () => 'card' });
  assert.equal(whole.atomList[0].kind, 'icon');
});

test('atoms of a kind (the formulas of the component math): a chip in the line, or a chip of its own lines', async () => {
  const { itemAtomValueSet, itemAtomKindAdd } = await import('./doc-edit-item-atom.js');
  const { atomKindDefine } = await import('./doc-edit-atom-kind.js');
  const { mathSpanListGet, mathSourceBuild } = await import('../../../../built-in/comp-mdx/math/MathData.js');
  const math = atomKindDefine({ name: 'math', label: 'formula', spanListGet: mathSpanListGet, sourceBuild: mathSourceBuild, draw: () => '' });
  const build = (text) => itemAtomModelBuild(text, { atomKindList: [math] });
  const set = (model, char, value) => itemAtomValueSet(model, char, value, mathSourceBuild(value, itemAtomModelGetKind(model, char) === 'row'));
  const itemAtomModelGetKind = (model, char) => model.atomList.find((atom) => atom.char === char)?.kind;
  assert.deepEqual(mathSpanListGet('a $x$ b `$y$` \\$z$'), [{ start: 2, end: 5, value: 'x', isRow: false }]);
  assert.equal(mathSourceBuild(' a\nb '), '$a b$');
  assert.equal(mathSourceBuild('a\n', true), '$$\na\n$$');
  // no kind given: the text has no atom
  assert.equal(itemAtomModelBuild('see $x$'), undefined);
  // in the line: the chip stands where the formula is, nothing around it changes
  const inline = build('see $x^2$ here');
  const char0 = String.fromCodePoint(0xe000);
  assert.equal(inline.display, `see ${char0} here`);
  assert.equal(inline.atomList[0].kind, 'inline');
  assert.equal(inline.atomList[0].atomKind, 'math');
  assert.equal(itemAtomTextBuild(inline.display, inline), 'see $x^2$ here');
  assert.ok(set(inline, char0, 'y_1'));
  assert.equal(itemAtomTextBuild(inline.display, inline), 'see $y_1$ here');
  assert.equal(itemAtomTextBuild('see  here', inline), 'see  here');
  // on lines of its own: the lines around it stay lines
  const block = build('a\n$$\nx\n$$\nb');
  assert.equal(block.display, `a${char0}b`);
  assert.equal(block.atomList[0].kind, 'row');
  set(block, char0, 'y');
  assert.equal(itemAtomTextBuild(block.display, block), 'a\n$$\ny\n$$\nb');
  set(block, char0, '');
  assert.equal(itemAtomTextBuild(block.display, block), 'a\nb');
  // with code: the code block keeps atom 0, the formula comes after it in the numbering
  const mixed = build('$a$ and\n```js view=icon\nx\n```');
  assert.equal(mixed.atomList[0].kind, 'icon');
  assert.equal(mixed.atomList[1].kind, 'inline');
  assert.equal(mixed.display, `${String.fromCodePoint(0xe001)} and${String.fromCodePoint(0xe000)}`);
  assert.equal(itemAtomTextBuild(mixed.display, mixed), '$a$ and\n```js view=icon\nx\n```');
  // an offset after the formula in the text is after its chip
  assert.equal(itemAtomOffsetDisplayGet(inline, 'see $x^2$'.length), 'see '.length + 1);
  // a new one, typed in its field; an empty one is not written
  const { model: added, atom } = itemAtomKindAdd(undefined, 'math', { display: 'ab', label: 'formula' });
  assert.equal(itemAtomTextBuild(`a${atom.char}b`, added), 'ab');
  itemAtomValueSet(added, atom.char, 'z', mathSourceBuild('z'));
  assert.equal(itemAtomTextBuild(`a${atom.char}b`, added), 'a$z$b');
  // copied out: the formula in its place
  assert.equal(itemAtomTextSourceGet(`a${atom.char}b`, added), 'a$z$b');
});
