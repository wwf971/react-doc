import assert from 'node:assert/strict';
import test from 'node:test';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import { commentPropsParse, remarkCommentComp } from './remark-comment-comp.js';

test('comment props keep commas inside lists and inline YAML mappings', () => {
  assert.deepEqual(
    commentPropsParse(',title=Q&A,titleComponentProps={label: "Q&A", color: "#0f766e"},languages=[jp,en]'),
    {
      title: 'Q&A',
      titleComponentProps: '{label: "Q&A", color: "#0f766e"}',
      languages: '[jp,en]',
    },
  );
});

test('comment props keep nested braces whole', () => {
  assert.deepEqual(
    commentPropsParse(',a={x: {y: 1, z: 2}},b=c'),
    { a: '{x: {y: 1, z: 2}}', b: 'c' },
  );
});

function treeTransform(lineList) {
  const componentList = [];
  const processor = remark().use(remarkGfm).use(remarkCommentComp, {
    onComponent: (component) => componentList.push(component),
  });
  const text = lineList.join('\n');
  const tree = processor.runSync(processor.parse(text), text);
  return { tree, componentList };
}

function listItemParagraphGet(tree) {
  return tree.children[0].children[0].children[0];
}

test('marker at the start of a list item marks the inline code after it', () => {
  const { tree, componentList } = treeTransform([
    '- <!--renderComp=Tag-->`guide` documents with [a link](a.md)',
  ]);
  assert.deepEqual(componentList.map((component) => [component.compName, component.raw]), [['Tag', 'guide']]);
  const paragraph = listItemParagraphGet(tree);
  assert.equal(paragraph.type, 'paragraph');
  assert.equal(paragraph.children[0].name, 'DocComp');
  assert.equal(paragraph.children[0].attributes.find((item) => item.name === 'isInline').value, 'true');
  assert.equal(paragraph.children[1].value, ' documents with ');
  assert.equal(paragraph.children[2].type, 'link');
});

test('marker after text in a list item gives the same component', () => {
  const { tree, componentList } = treeTransform([
    '- tagged <!--renderComp=Tag-->`guide` here',
  ]);
  assert.deepEqual(componentList.map((component) => [component.compName, component.raw]), [['Tag', 'guide']]);
  const paragraph = listItemParagraphGet(tree);
  assert.equal(paragraph.children[1].name, 'DocComp');
});

test('an html block without marker and inline code is left alone', () => {
  const { tree, componentList } = treeTransform([
    '- <!-- a note -->`code` text',
  ]);
  assert.equal(componentList.length, 0);
  assert.equal(tree.children[0].children[0].children[0].type, 'html');
});
