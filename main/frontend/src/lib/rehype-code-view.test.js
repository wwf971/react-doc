import assert from 'node:assert/strict';
import test from 'node:test';
import { codeMetaParse, codeTransformerList, rehypeCodePlace } from './rehype-code-view.js';

const element = (tagName, children = [], properties = {}) => ({ type: 'element', tagName, properties, children });

test('the info string of a fence names the view of the block, beside the attributes of the page', () => {
  assert.equal(codeMetaParse('view=plain')['data-view'], 'plain');
  assert.equal(codeMetaParse('view="card"')['data-view'], 'card');
  assert.equal(codeMetaParse("title=\"a file\" view='plain' lineNumbers")['data-view'], 'plain');
  const parsed = codeMetaParse('title="a file" view=plain lineNumbers=3');
  assert.equal(parsed.title, 'a file');
  assert.equal(parsed['data-line-numbers-start'], 3);
  // the view is taken out of what the other readers of the info string get
  assert.equal(parsed.__raw.includes('view'), false);
});

test('the language of a block is written on its <pre>, beside the transformers of the page', () => {
  assert.equal(codeTransformerList.length > 1, true);
  const transformer = codeTransformerList[codeTransformerList.length - 1];
  const node = { type: 'element', tagName: 'pre', properties: {}, children: [] };
  transformer.pre.call({ options: { lang: 'text' } }, node);
  assert.equal(node.properties['data-language'], 'text');
});

test('no view, a view the page does not have, a word that only ends with view: the place decides', () => {
  assert.equal('data-view' in codeMetaParse(''), false);
  assert.equal('data-view' in codeMetaParse('view=fancy'), false);
  assert.equal('data-view' in codeMetaParse('preview=plain'), false);
  assert.equal('data-view' in codeMetaParse(undefined), false);
});

test('the place of a code block of a list item: the whole text of the item (sub-items allowed), or among its text', () => {
  const text = (value) => ({ type: 'text', value });
  const preItem = element('pre');
  // rehypeCode replaces a <pre> by a root holding the highlighted one
  const preHighlighted = element('pre');
  const preWithSubItems = element('pre');
  const preUnderText = element('pre');
  const preBeforeText = element('pre');
  const preInComponent = element('pre');
  const preOfDocument = element('pre');
  const tree = {
    type: 'root',
    children: [
      element('ul', [
        element('li', [text('\n'), preItem, text('\n')]),
        element('li', [{ type: 'root', children: [preHighlighted] }]),
        element('li', [preWithSubItems, element('ul', [element('li', [text('a sub-item')])])]),
        element('li', [text('run this:'), preUnderText]),
        element('li', [preBeforeText, element('p', [text('and a paragraph after it')])]),
        element('li', [element('div', [preInComponent])]),
      ]),
      preOfDocument,
    ],
  };
  rehypeCodePlace()(tree);
  assert.equal(preItem.properties['data-place'], 'listItem');
  assert.equal(preHighlighted.properties['data-place'], 'listItem');
  assert.equal(preWithSubItems.properties['data-place'], 'listItem');
  assert.equal(preUnderText.properties['data-place'], 'inListItem');
  assert.equal(preBeforeText.properties['data-place'], 'inListItem');
  assert.equal(preInComponent.properties['data-place'], undefined);
  assert.equal(preOfDocument.properties['data-place'], undefined);
});
