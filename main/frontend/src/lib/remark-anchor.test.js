import assert from 'node:assert/strict';
import test from 'node:test';
import { remark } from 'remark';
import {
  anchorHeadingSwallowedGet,
  remarkAnchor,
} from './remark-anchor.js';

test('renders every consecutive stable heading anchor', () => {
  const tree = treeBuild([
    '<span id="component-a" />',
    '<span id="component-b" />',
    '<span id="component-c"></span>',
  ].join('\n'));
  remarkAnchor()(tree);

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
  remarkAnchor()(tree);

  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[1].data, undefined);
});

test('authored anchor with a blank line before the heading gives the heading its id', () => {
  const tree = remark().parse('<span id="configuration" />\n\n## Configuration\n');
  assert.equal(anchorHeadingSwallowedGet(tree.children[0]), '');
  remarkAnchor()(tree);
  assert.equal(tree.children.at(-1).type, 'heading');
  assert.equal(tree.children.at(-1).data.hProperties.id, 'configuration');
});

test('authored anchor directly followed by a heading line is reported', (context) => {
  const tree = remark().parse('<span id="configuration" />\n## Configuration\n');
  // Markdown continues the html block onto the heading line
  assert.equal(tree.children.length, 1);
  assert.equal(anchorHeadingSwallowedGet(tree.children[0]), '## Configuration');

  const warn = context.mock.method(console, 'warn', () => {});
  remarkAnchor({ sourcePath: '/docs/page.md' })(tree);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /\/docs\/page\.md: heading "## Configuration"/);
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