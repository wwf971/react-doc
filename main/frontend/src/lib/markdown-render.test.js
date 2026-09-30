import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { markdownFragmentRender, markdownParse, markdownTransformListGet } from './markdown-render.js';

// stubs show which component the shared transform chose and with what input
const componentsStub = {
  DocLink: ({ target, from, children }) => createElement('x-doc-link', { 'data-target': target, 'data-from': from }, children),
  SourceLink: ({ target, label, displayMode }) => createElement('x-source-link', {
    'data-target': target,
    'data-mode': displayMode,
  }, label),
};

function htmlRender(text, options = {}) {
  const tree = markdownParse(text);
  const nodeList = options.isInline ? tree.children[0].children : tree.children;
  const element = markdownFragmentRender({
    nodeList,
    transformList: markdownTransformListGet({ sourcePath: '/docs/guide/page.md', ...options }),
    components: componentsStub,
    isInline: options.isInline === true,
  });
  return renderToStaticMarkup(createElement('div', null, element));
}

test('local links become DocLink with the containing document as base', () => {
  const html = htmlRender('see [setup](./setup.md)', { isInline: true });
  assert.equal(html, '<div>see <x-doc-link data-target="./setup.md" data-from="/docs/guide/page.md">setup</x-doc-link></div>');
});

test('inline-link markers become SourceLink, keeping a nested-emphasis label', () => {
  const html = htmlRender('run [the **setup** script](/docs/setup.ps1 "inline-link:render")', { isInline: true });
  assert.equal(html, '<div>run <x-source-link data-target="/docs/setup.ps1" data-mode="render">the setup script</x-source-link></div>');
});

test('inline nodes are rendered without added whitespace between them', () => {
  assert.equal(htmlRender('a**b**c', { isInline: true }), '<div>a<strong>b</strong>c</div>');
});

test('external and fragment links stay native anchors', () => {
  const html = htmlRender('[site](https://example.com) and [here](#part)', { isInline: true });
  assert.equal(html, '<div><a href="https://example.com">site</a> and <a href="#part">here</a></div>');
});

test('inline math renders through KaTeX', () => {
  const html = htmlRender('mass $E = mc^2$', { isInline: true });
  assert.match(html, /class="katex"/);
});

test('sanitizing removes authored HTML but keeps generated links', () => {
  const html = htmlRender('<b>bold</b> and [a](a.md)\n\n<div>block</div>', { isContentSanitized: true });
  assert.equal(html.includes('<b>'), false);
  assert.equal(html.includes('<div>block'), false);
  assert.match(html, /<x-doc-link data-target="a.md"/);
});

test('restricted node types degrade to their content', () => {
  const html = htmlRender('# Title\n\ntext **bold**', { nodeTypeAllowedList: ['paragraph', 'text'] });
  assert.equal(html, '<div>Title\n<p>text bold</p></div>');
});
