import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { docManagedBlockContentBuild, docManagedBlockOutlineGet, docManagedBlockTextBuild } from './doc-managed-block.js';
import { docManagedPackDecode, docManagedPackEncode, docManagedPackRecordRead } from './doc-managed-pack.js';

const textList = [
  '',
  '# Title\n',
  '---\ntitle: x\n---\n\n# A\n\nText [b](./b.md).\n\n- one\n- two\n  - two.a\n\n1. first\n2. second\n',
  '<!--renderComp=Anchor,id=x-->\n- item\n\n  more of the item\n\n```js\nconst a = 1;\n```\n',
  'a paragraph\nover two lines\n\n\n\n> quote\n   \n',
  'no final line break',
];

test('a text read into blocks writes the same text again', () => {
  for (const text of textList) {
    const content = docManagedBlockContentBuild(text, { format: 'md' });
    assert.equal(docManagedBlockTextBuild(content), text, JSON.stringify(text));
  }
});

test('a list is kept as items when they write its text, else as its text', () => {
  const content = docManagedBlockContentBuild('- one\n- two\n  - two.a\n', { format: 'md' });
  const list = content.blockList[0];
  assert.equal(list.kind, 'list');
  assert.deepEqual(list.list.itemList.map((item) => item.text), ['one', 'two']);
  assert.equal(list.list.itemList[1].itemList[0].text, 'two.a');
});

test('a text that is not read as blocks is kept raw', () => {
  const textMdxBroken = '# A\n\n<Comp prop={\n';
  const content = docManagedBlockContentBuild(textMdxBroken, { format: 'mdx' });
  assert.equal(content.raw, textMdxBroken);
  assert.deepEqual(docManagedBlockOutlineGet(content), []);
  assert.equal(docManagedBlockContentBuild('a\r\nb\r\n', { format: 'md' }).raw, 'a\r\nb\r\n');
});

test('a write keeps the ids of the blocks and items that stayed or were edited in place', () => {
  const before = docManagedBlockContentBuild('# T\n\nOne.\n\n- a\n- b\n\nEnd.\n', { format: 'md' });
  const after = docManagedBlockContentBuild('# T\n\nOne, edited.\n\nNew.\n\n- a\n- b changed\n- c\n\nEnd.\n', { format: 'md', contentPrev: before });
  const idOf = (content) => content.blockList.map((block) => block.blockId);
  const [heading, paragraph, list, end] = idOf(before);
  const idAfter = idOf(after);
  assert.equal(idAfter[0], heading);
  assert.equal(idAfter[1], paragraph);
  assert.ok(![heading, paragraph, list, end].includes(idAfter[2]), 'a new block gets a new id');
  assert.equal(idAfter[3], list);
  assert.equal(idAfter[4], end);
  const itemIdBefore = before.blockList[2].list.itemList.map((item) => item.itemId);
  const itemIdAfter = after.blockList[3].list.itemList.map((item) => item.itemId);
  assert.deepEqual(itemIdAfter.slice(0, 2), itemIdBefore);
  assert.equal(new Set([...idAfter, ...itemIdAfter]).size, idAfter.length + itemIdAfter.length, 'ids are unique in a document');
});

test('a pack file holds a record readable alone and a deflated body', () => {
  const record = { docId: 'w6abc', path: 'guide/a.md', mode: 'text' };
  const body = '# A\n\nこんにちは\n'.repeat(20);
  const bytes = docManagedPackEncode({ record, body }, (one) => zlib.deflateRawSync(one));
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RDOC');
  assert.deepEqual(docManagedPackRecordRead(bytes), record);
  const decoded = docManagedPackDecode(bytes, (one) => zlib.inflateRawSync(one));
  assert.equal(decoded.body, body);
  assert.ok(bytes.length < Buffer.byteLength(body), 'the body is smaller deflated');
  assert.throws(() => docManagedPackDecode(new Uint8Array([1, 2, 3])), /not a pack file/);
});
