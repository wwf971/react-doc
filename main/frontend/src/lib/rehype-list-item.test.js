import assert from 'node:assert/strict';
import test from 'node:test';
import { LIST_ITEM_TEXTLESS_CLASS, listItemIsTextless, rehypeListItemTextless } from './rehype-list-item.js';

const element = (tagName, children = [], properties = {}) => ({ type: 'element', tagName, properties, children });
const text = (value) => ({ type: 'text', value });

test('an item without a text of its own is textless: nothing in it, or a list first', () => {
  assert.equal(listItemIsTextless(element('li')), true);
  assert.equal(listItemIsTextless(element('li', [text('\n'), element('ul', [element('li', [text('rye')])]), text('\n')])), true);
  assert.equal(listItemIsTextless(element('li', [text('bread'), element('ul', [element('li', [text('rye')])])])), false);
  assert.equal(listItemIsTextless(element('li', [element('p', [text('a loose item')])])), false);
  assert.equal(listItemIsTextless(element('li', [element('input', [], { type: 'checkbox' }), text(' a task')])), false);
});

test('the empty comment the page writes for an item without text is no text', () => {
  assert.equal(listItemIsTextless(element('li', [{ type: 'comment', value: '' }])), true);
  assert.equal(listItemIsTextless(element('li', [{ type: 'raw', value: '<!---->' }, text('\n'), element('ul')])), true);
  assert.equal(listItemIsTextless(element('li', [{ type: 'mdxTextExpression', value: '/**/' }])), true);
  assert.equal(listItemIsTextless(element('li', [element('p', [{ type: 'mdxTextExpression', value: '/**/' }])])), true);
  assert.equal(listItemIsTextless(element('li', [{ type: 'mdxTextExpression', value: 'props.name' }])), false);
  assert.equal(listItemIsTextless(element('li', [{ type: 'raw', value: '<b>bold</b>' }])), false);
});

test('the plugin marks the textless items of a tree and no other', () => {
  const itemHolder = element('li', [element('ul', [element('li', [text('rye')], { className: ['x'] }), element('li')])], { className: ['holder'] });
  const tree = { type: 'root', children: [element('ul', [itemHolder, element('li', [text('bread')])])] };
  rehypeListItemTextless()(tree);
  const [list] = tree.children;
  assert.deepEqual(list.children[0].properties.className, ['holder', LIST_ITEM_TEXTLESS_CLASS]);
  assert.equal(list.children[1].properties.className, undefined);
  const listInner = list.children[0].children[0];
  assert.deepEqual(listInner.children[0].properties.className, ['x']);
  assert.deepEqual(listInner.children[1].properties.className, [LIST_ITEM_TEXTLESS_CLASS]);
});
