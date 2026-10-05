import assert from 'node:assert/strict';
import test from 'node:test';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import {
  blockDeleteOperationBuild,
  blockInsertOperationBuild,
  componentBlockTextBuild,
  componentTemplateTextBuild,
  editDocModelBuild,
  markerTextBuild,
  remarkEditBlock,
} from './doc-edit-block.js';
import { splitFrontmatter } from './mdx-compile.js';

const sourceDemo = [
  '---',
  'title: Demo',
  '---',
  '',
  '<!-- authored note -->',
  '',
  '# Title',
  '',
  'A paragraph',
  'on two lines.',
  '',
  '<!--renderComp=Anchor,id=pic-->',
  '<!--renderComp=Image-->',
  '```yaml',
  'src: dog.png',
  '```',
  '',
  '- item a',
  '- item b',
  '',
  '<!--renderComp=MultiLang-->',
  '## {en: "Section", jp: "節"}',
  '',
  'Stock:<!--renderComp=StockTable,title=A-->',
  '| id | name |',
  '| --- | --- |',
  '| 1 | mouse |',
  '',
].join('\n');

test('groups root nodes into blocks with file line ranges', () => {
  const model = modelBuild(sourceDemo);
  assert.deepEqual(model.frontmatter, { lineStart: 1, lineEnd: 3, text: '---\ntitle: Demo\n---' });
  assert.deepEqual(
    model.blockList.map((block) => [block.kind, block.lineStart, block.lineEnd]),
    [
      ['html', 5, 5],
      ['heading', 7, 7],
      ['paragraph', 9, 10],
      ['component', 12, 16],
      ['list', 18, 19],
      ['heading', 21, 22],
      ['component', 24, 27],
    ],
  );
  assert.equal(model.blockList[2].text, 'A paragraph\non two lines.');
  assert.equal(model.blockList[5].text, '<!--renderComp=MultiLang-->\n## {en: "Section", jp: "節"}');
});

test('the wrapper elements carry the block index and keep the grouped nodes', () => {
  const { content } = splitFrontmatter(sourceDemo);
  const tree = remark().use(remarkGfm).parse(content);
  remarkEditBlock()(tree);
  assert.equal(tree.children.length, 7);
  assert.ok(tree.children.every((node) => node.type === 'mdxJsxFlowElement' && node.name === 'DocEditBlock'));
  assert.deepEqual(tree.children[3].attributes, [{ type: 'mdxJsxAttribute', name: 'blockIndex', value: '3' }]);
  assert.deepEqual(tree.children[3].children.map((node) => node.type), ['html', 'html', 'code']);
  assert.deepEqual(tree.children[6].children.map((node) => node.type), ['paragraph', 'table']);
});

test('component details split the block into marker, gap and node text', () => {
  const model = modelBuild(sourceDemo);
  const component = model.blockList[3].component;
  assert.equal(component.compName, 'Image');
  assert.deepEqual(component.props, {});
  assert.equal(component.lang, 'yaml');
  assert.equal(component.raw, 'src: dog.png');
  assert.equal(component.textBefore, '<!--renderComp=Anchor,id=pic-->\n');
  assert.equal(component.markerText, '<!--renderComp=Image-->');
  assert.equal(component.textBetween, '\n');
  assert.equal(component.nodeText, '```yaml\nsrc: dog.png\n```');

  const table = model.blockList[6].component;
  assert.equal(table.compName, 'StockTable');
  assert.deepEqual(table.props, { title: 'A' });
  assert.equal(table.textBefore, 'Stock:');
  assert.equal(table.raw, '| id | name |\n| --- | --- |\n| 1 | mouse |');
});

test('componentBlockTextBuild rebuilds the block around new raw text or props', () => {
  const model = modelBuild(sourceDemo);
  const blockImage = model.blockList[3];
  assert.equal(componentBlockTextBuild(blockImage), blockImage.text);
  assert.equal(
    componentBlockTextBuild(blockImage, { raw: 'src: cat.png\nalt: a cat' }),
    '<!--renderComp=Anchor,id=pic-->\n<!--renderComp=Image-->\n```yaml\nsrc: cat.png\nalt: a cat\n```',
  );
  assert.equal(
    componentBlockTextBuild(blockImage, { raw: '```\ninner\n```' }),
    '<!--renderComp=Anchor,id=pic-->\n<!--renderComp=Image-->\n````yaml\n```\ninner\n```\n````',
  );
  const blockTable = model.blockList[6];
  assert.equal(
    componentBlockTextBuild(blockTable, { props: { title: 'B' }, raw: '| id |\n| --- |' }),
    'Stock:<!--renderComp=StockTable,title=B-->\n| id |\n| --- |',
  );
});

test('marker and template text', () => {
  assert.equal(markerTextBuild('Image'), '<!--renderComp=Image-->');
  assert.equal(markerTextBuild('Index', { id: 'x', languages: '[en,jp]' }), '<!--renderComp=Index,id=x,languages=[en,jp]-->');
  assert.equal(
    componentTemplateTextBuild('Image', { lang: 'yaml', raw: 'src: a.png' }),
    '<!--renderComp=Image-->\n```yaml\nsrc: a.png\n```',
  );
});

test('insert operations add the blank lines a block needs', () => {
  const model = modelBuild(sourceDemo);
  assert.deepEqual(blockInsertOperationBuild(model, 0, 'new'), { action: 'insertLines', lineAt: 5, text: 'new\n' });
  assert.deepEqual(blockInsertOperationBuild(model, 2, 'new'), { action: 'insertLines', lineAt: 8, text: '\nnew' });
  assert.deepEqual(blockInsertOperationBuild(model, 7, 'new'), { action: 'insertLines', lineAt: 28, text: '\nnew' });

  const modelTight = modelBuild('# a\nparagraph\n');
  assert.deepEqual(blockInsertOperationBuild(modelTight, 1, 'new'), { action: 'insertLines', lineAt: 2, text: '\nnew\n' });

  const modelEmpty = modelBuild('');
  assert.deepEqual(blockInsertOperationBuild(modelEmpty, 0, 'new'), { action: 'insertLines', lineAt: 1, text: 'new' });
  const modelFrontmatterOnly = modelBuild('---\ntitle: x\n---\n');
  assert.deepEqual(blockInsertOperationBuild(modelFrontmatterOnly, 0, 'new'), { action: 'insertLines', lineAt: 4, text: '\nnew' });
});

test('delete operations take the separating blank lines with the block', () => {
  const model = modelBuild(sourceDemo);
  assert.deepEqual(blockDeleteOperationBuild(model, 2), { action: 'deleteLines', lineStart: 9, lineEnd: 11 });
  assert.deepEqual(blockDeleteOperationBuild(model, 6), { action: 'deleteLines', lineStart: 23, lineEnd: 27 });
  const modelSingle = modelBuild('---\ntitle: x\n---\n\nonly\n');
  assert.deepEqual(blockDeleteOperationBuild(modelSingle, 0), { action: 'deleteLines', lineStart: 4, lineEnd: 5 });
});

test('trailing markers without a node form a marker block', () => {
  const model = modelBuild('text\n\n<!--renderComp=Image-->\n');
  assert.deepEqual(model.blockList.map((block) => block.kind), ['paragraph', 'marker']);
});

function modelBuild(source) {
  const { content } = splitFrontmatter(source);
  const tree = remark().use(remarkGfm).parse(content);
  let blockListCompiled = [];
  remarkEditBlock({ onBlockList: (blockList) => { blockListCompiled = blockList; } })(tree);
  return editDocModelBuild({ source, blockListCompiled });
}
