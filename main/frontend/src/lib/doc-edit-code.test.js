import assert from 'node:assert/strict';
import test from 'node:test';
import { codeBlockAssetDataGet, codeBlockInTextReplace, codeTextJoin, textJoinSpaceIs, codeBlockAssetTextBuild, codeBlockTextParse, codeBlockValueTextSet, codeBlockViewTextSet, codeTextViewGet, codeTextViewSet } from './doc-edit-code.js';
import { commentMarkerParse } from './remark-comment-comp.js';

// a fenced code block changed from edit mode
// (doc_page_impl_mdx_code.md#changing-the-view-from-the-page): its view
// written in the info string, its lines moved to an item of the asset service
// layer as a block of the component Code.

const blockAnchored = [
  '<!--renderComp=Anchor,id=setup-->',
  '```python title="setup.py" view=plain',
  'print("a")',
  '```',
].join('\n');

test('a code block is read with what stands before its fence', () => {
  const parsed = codeBlockTextParse(blockAnchored);
  assert.deepEqual(parsed.linePrefixList, ['<!--renderComp=Anchor,id=setup-->']);
  assert.equal(parsed.lang, 'python');
  assert.equal(parsed.view, 'plain');
  assert.equal(parsed.title, 'setup.py');
  assert.equal(parsed.value, 'print("a")');
  assert.equal(codeBlockTextParse('just text'), undefined);
  assert.equal(codeBlockTextParse('```js\nunclosed'), undefined);
  assert.equal(codeBlockTextParse('```js\n```\nmore\n```'), undefined, 'a fence closed before the end is not one block');
});

test('the view is written into the info string, and removed', () => {
  assert.equal(codeBlockViewTextSet(blockAnchored, 'icon').data, blockAnchored.replace('view=plain', 'view=icon'));
  assert.equal(codeBlockViewTextSet(blockAnchored, '').data.split('\n')[1], '```python title="setup.py"');
  assert.equal(codeBlockViewTextSet('```\nlines\n```', 'icon').data, '```text view=icon\nlines\n```', 'a fence without a language gets one first');
  assert.equal(codeBlockViewTextSet('````text\nlines\n````', 'plain').data, '````text view=plain\nlines\n````', 'the fence is kept');
  assert.equal(codeBlockViewTextSet('no fence', 'icon').code, -1);
});

test('to the asset service layer: a Code block reading the item, the view and the title on its marker', () => {
  const result = codeBlockAssetTextBuild(blockAnchored, 'store: local\nitemId: abc\n');
  assert.equal(result.data, [
    '<!--renderComp=Anchor,id=setup-->',
    '<!--renderComp=Code,view=plain,title=setup.py-->',
    '```asset',
    'store: local',
    'itemId: abc',
    '```',
  ].join('\n'));
  assert.deepEqual(codeBlockAssetDataGet(blockAnchored), { lang: 'python', value: 'print("a")' });
  assert.deepEqual(codeBlockAssetDataGet('```\nplain lines\n```'), { lang: 'text', value: 'plain lines' });
});

test('a title the marker cannot hold is made safe for it', () => {
  const result = codeBlockAssetTextBuild('```js title="a, b -- c"\nx\n```', 'store: local\nitemId: abc');
  const marker = commentMarkerParse(result.data.split('\n')[0]);
  assert.deepEqual(marker, { compName: 'Code', props: { title: 'a  b - c' } });
});

test('the view of either form: the info string of a fence, the marker of a Code block', () => {
  assert.deepEqual(codeTextViewGet(blockAnchored), { view: 'plain', form: 'fence' });
  const blockCode = '<!--renderComp=Code,title=setup.py-->\n```asset\nstore: local\nitemId: abc\n```';
  assert.deepEqual(codeTextViewGet(blockCode), { view: '', form: 'component' });
  assert.equal(codeTextViewSet(blockCode, 'icon').data.split('\n')[0], '<!--renderComp=Code,title=setup.py,view=icon-->');
  assert.equal(codeTextViewSet(codeTextViewSet(blockCode, 'icon').data, '').data, blockCode);
  // the reference of another component, or a fence another component reads, has no view
  assert.equal(codeTextViewGet('<!--renderComp=Image-->\n```asset\nstore: local\nitemId: x\n```'), undefined);
  assert.equal(codeTextViewGet('<!--renderComp=DiagramText-->\n```text\na\n```'), undefined);
  assert.equal(codeTextViewGet('Paragraph text.'), undefined);
});

test('the lines of a code block replaced, its fence and what stands before it kept', () => {
  assert.equal(codeBlockValueTextSet(blockAnchored, 'print("b")\nprint("c")').data, [
    '<!--renderComp=Anchor,id=setup-->',
    '```python title="setup.py" view=plain',
    'print("b")',
    'print("c")',
    '```',
  ].join('\n'));
  assert.equal(codeBlockValueTextSet('```text\nold\n```', 'a\n```\nb').data, '````text\na\n```\nb\n````', 'the fence grows past a line that would close it');
  assert.equal(codeBlockValueTextSet('```text\nold\n```', '').data, '```text\n```');
});

test('the language of a code block changed, its attributes kept', () => {
  assert.equal(codeBlockValueTextSet(blockAnchored, 'x = 2', { lang: 'py' }).data.split('\n')[1], '```py title="setup.py" view=plain');
  assert.equal(codeBlockValueTextSet('```\nold\n```', 'select 1', { lang: 'sql' }).data, '```sql\nselect 1\n```');
  assert.equal(codeBlockValueTextSet('```sql view=icon\nold\n```', 'old', { lang: '' }).data, '```text view=icon\nold\n```', 'attributes need a language before them');
  assert.equal(codeBlockValueTextSet('```sql\nold\n```', 'old', { lang: ' c++ ` x' }).data.split('\n')[0], '```c++', 'one word, no backtick');
});

test('a code block inside a text, found by the line of its fence', async () => {
  const text = ['see the query', '```sql view=icon', 'select 1', '```', 'then the script', '<!--renderComp=Code,view=icon-->', '```sh', 'ls', '```'].join('\n');
  const lines = await codeBlockInTextReplace(text, 1, (blockText) => codeBlockValueTextSet(blockText, 'select 2\nfrom t', { lang: 'tsql' }));
  assert.equal(lines.code, 0);
  assert.equal(lines.data.text, ['see the query', '```tsql view=icon', 'select 2', 'from t', '```', 'then the script', '<!--renderComp=Code,view=icon-->', '```sh', 'ls', '```'].join('\n'));
  // the marker of Code is part of its block
  const code = await codeBlockInTextReplace(text, 6, (blockText) => ({ code: 0, message: '', data: `[${blockText}]` }));
  assert.equal(code.data.blockText, '<!--renderComp=Code,view=icon-->\n```sh\nls\n```');
  assert.equal(code.data.text.endsWith('then the script\n[<!--renderComp=Code,view=icon-->\n```sh\nls\n```]'), true);
  assert.equal((await codeBlockInTextReplace(text, 0, () => ({ code: 0, data: '' }))).code, -1);
});

test('the lines of a code block joined into a line of text', () => {
  assert.equal(codeTextJoin('Example Trading Co.\n  1 Harbor Street\n\nSpringfield'), 'Example Trading Co. 1 Harbor Street Springfield');
  assert.equal(codeTextJoin('東京都\n千代田区'), '東京都千代田区');
  assert.equal(codeTextJoin('Tokyo\n千代田区'), 'Tokyo 千代田区');
  // a start Markdown would read as another block is escaped
  assert.equal(codeTextJoin('# not a heading'), '\\# not a heading');
  assert.equal(codeTextJoin('- not\nan item'), '\\- not an item');
  assert.equal(codeTextJoin('1. not a list'), '1\\. not a list');
  assert.equal(codeTextJoin('  \n\n'), '');
  assert.equal(textJoinSpaceIs('abc', 'def'), true);
  assert.equal(textJoinSpaceIs('abc ', 'def'), false);
  assert.equal(textJoinSpaceIs('東京', '都'), false);
});
