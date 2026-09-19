import assert from 'node:assert/strict';
import test from 'node:test';
import { remarkStableHeadingAnchor } from './remark-stable-heading-anchor.js';

test('renders every consecutive stable heading anchor', () => {
  const tree = treeBuild([
    '<span id="component-a" />',
    '<span id="component-b" />',
    '<span id="component-c"></span>',
  ].join('\n'));
  remarkStableHeadingAnchor()(tree);

  assert.equal(tree.children.length, 3);
  assert.equal(tree.children[2].data.hProperties.id, 'component-a');
  assert.deepEqual(
    tree.children.slice(0, 2).map((child) => child.data.hProperties),
    [
      { id: 'component-b', 'aria-hidden': 'true' },
      { id: 'component-c', 'aria-hidden': 'true' },
    ],
  );
  assert.deepEqual(tree.children[2].children, [{ type: 'text', value: 'Shared section' }]);
});

test('does not convert an anchor block containing arbitrary HTML', () => {
  const tree = treeBuild([
    '<span id="component-a" />',
    '<div>Other content</div>',
  ].join('\n'));
  remarkStableHeadingAnchor()(tree);

  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[1].data, undefined);
});

function treeBuild(anchorHtml) {
  return {
    type: 'root',
    children: [
      { type: 'html', value: anchorHtml },
      { type: 'heading', depth: 2, children: [{ type: 'text', value: 'Shared section' }] },
    ],
  };
}