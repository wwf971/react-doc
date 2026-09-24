import assert from 'node:assert/strict';
import test from 'node:test';
import { remark } from 'remark';
import { remarkDocLink } from './remark-doc-link.js';

test('local link with title "inline-link" becomes an inline SourceLink in source mode', () => {
  const paragraph = paragraphTransform('See the [setup script](/guide/setup.ps1 "inline-link") first.');

  assert.equal(paragraph.children.length, 3);
  assert.equal(paragraph.children[0].value, 'See the ');
  assert.equal(paragraph.children[2].value, ' first.');
  const node = paragraph.children[1];
  assert.equal(node.type, 'mdxJsxTextElement');
  assert.equal(node.name, 'SourceLink');
  assert.deepEqual(attributesGet(node), {
    target: '/guide/setup.ps1',
    label: 'setup script',
    displayMode: 'source',
  });
  assert.deepEqual(node.children, []);
});

test('"inline-link:source" selects source mode and "inline-link:render" selects render mode', () => {
  const paragraphSource = paragraphTransform('[a](/guide/setup.ps1 "inline-link:source")');
  assert.equal(attributesGet(paragraphSource.children[0]).displayMode, 'source');

  const paragraphRender = paragraphTransform('[a](/guide/details.mdx "inline-link:render")');
  assert.equal(attributesGet(paragraphRender.children[0]).displayMode, 'render');
});

test('titles that are not exact markers keep DocLink behavior', () => {
  for (const title of ['Inline-Link', 'inline-link:other', 'inline-link ', 'a plain title']) {
    const paragraph = paragraphTransform(`[a](/guide/setup.md "${title}")`);
    assert.equal(paragraph.children[0].name, 'DocLink', `title: "${title}"`);
  }
});

test('ordinary local link still becomes DocLink with the authoring path', () => {
  const paragraph = paragraphTransform('[the guide](./guide/setup.md)');

  const node = paragraph.children[0];
  assert.equal(node.type, 'mdxJsxTextElement');
  assert.equal(node.name, 'DocLink');
  assert.deepEqual(attributesGet(node), {
    target: './guide/setup.md',
    from: '/root/doc.md',
    kind: 'link',
  });
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].type, 'text');
  assert.equal(node.children[0].value, 'the guide');
});

test('external urls remain ordinary links even with an inline-link marker title', () => {
  const paragraph = paragraphTransform('[site](https://example.com "inline-link")');

  const node = paragraph.children[0];
  assert.equal(node.type, 'link');
  assert.equal(node.url, 'https://example.com');
  assert.equal(node.title, 'inline-link');
});

test('same-page anchors remain ordinary links even with an inline-link marker title', () => {
  const paragraph = paragraphTransform('[section](#setup "inline-link")');

  const node = paragraph.children[0];
  assert.equal(node.type, 'link');
  assert.equal(node.url, '#setup');
});

test('the authored label is retained for nested inline text nodes', () => {
  const paragraph = paragraphTransform('[the *setup* `script`](/guide/setup.ps1 "inline-link")');

  assert.equal(attributesGet(paragraph.children[0]).label, 'the setup script');
});

function paragraphTransform(markdown) {
  const tree = remark().parse(markdown);
  remarkDocLink({ fromPath: '/root/doc.md' })(tree);
  return tree.children[0];
}

function attributesGet(node) {
  const result = {};
  for (const attribute of node.attributes) result[attribute.name] = attribute.value;
  return result;
}
