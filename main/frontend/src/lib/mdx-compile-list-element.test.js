import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileDoc } from './mdx-compile.js';

// Components as list elements. Stipulation: doc_page_impl_mdx_li.md
// Each comment-marked component renders as <x-comp> (block) or <x-comp-inline>,
// so the tests can check where it lands in the list structure.

const F = '```';

function DocCompStub({ comp, raw, lang, isInline }) {
  return createElement(isInline === 'true' ? 'x-comp-inline' : 'x-comp', { 'data-comp': comp, 'data-lang': lang }, raw);
}

function JsxStub(name) {
  return function Stub({ children }) {
    return createElement('x-jsx', { 'data-name': name }, children);
  };
}

const componentsStub = {
  DocComp: DocCompStub,
  DocLink: ({ children }) => createElement('a', null, children),
  Image: JsxStub('Image'),
  FileTree: JsxStub('FileTree'),
  Callout: JsxStub('Callout'),
  Tag: JsxStub('Tag'),
};

async function htmlRender(lineList, format = 'md') {
  const result = await compileDoc({
    source: lineList.join('\n'),
    internalPath: '/test/list.md',
    format,
    config: { isDefaultLinkRecognitionEnabled: false },
  });
  const html = renderToStaticMarkup(createElement(result.Body, { components: componentsStub }));
  // drops the line breaks between elements, keeps those inside raw text
  return html.replace(/>\n+/g, '>').replace(/\n+</g, '<');
}

test('comment at the start of a list item marks the block below it', async () => {
  const html = await htmlRender([
    '- parent',
    '  - <!--renderComp=Image-->',
    `    ${F}yaml`,
    '    src: dog.png',
    '    caption: A dog',
    `    ${F}`,
    '  - next',
  ]);
  assert.match(html, /<ul><li>parent<ul><li><x-comp data-comp="Image" data-lang="yaml">src: dog.png\ncaption: A dog<\/x-comp><\/li><li>next<\/li><\/ul><\/li><\/ul>/);
});

test('comment at the end of a text line marks the block below; following text stays in the item', async () => {
  const html = await htmlRender([
    '- parent',
    '  - as shown in this image<!--renderComp=Image-->',
    `    ${F}yaml`,
    '    src: dog.png',
    `    ${F}`,
    '    there is a dog.',
    '  - next',
  ]);
  assert.match(html, /<li>as shown in this image<x-comp data-comp="Image" data-lang="yaml">src: dog.png<\/x-comp>there is a dog\.<\/li><li>next<\/li>/);
  assert.equal(html.includes('renderComp'), false);
});

test('comment on its own line after the text marks the block below', async () => {
  const html = await htmlRender([
    '- as shown in this image',
    '  <!--renderComp=Image-->',
    `  ${F}yaml`,
    '  src: dog.png',
    `  ${F}`,
    '  there is a dog.',
  ]);
  assert.match(html, /<li>as shown in this image<x-comp data-comp="Image"[^>]*>src: dog.png<\/x-comp>there is a dog\.<\/li>/);
});

test('ordered list item: content column is after "1. ", blank lines inside the block are kept', async () => {
  const html = await htmlRender([
    '1. first',
    '   1. <!--renderComp=FileTree-->',
    `      ${F}yaml`,
    '      tree:',
    '        - name: src/',
    '',
    '          children: []',
    `      ${F}`,
    '   2. second',
  ]);
  assert.match(html, /<ol><li>first<ol><li><x-comp data-comp="FileTree" data-lang="yaml">tree:\n  - name: src\/\n\n    children: \[\]<\/x-comp><\/li><li>second<\/li><\/ol><\/li><\/ol>/);
});

test('third level, several components in one item', async () => {
  const html = await htmlRender([
    '- level 1',
    '  - level 2',
    '    - sequence:<!--renderComp=DiagramMermaid-->',
    `      ${F}mermaid`,
    '      sequenceDiagram',
    '        A->>B: hello',
    `      ${F}`,
    '      and stock:<!--renderComp=StockTable,title=A-->',
    `      ${F}`,
    '      | id | name |',
    '      | --- | --- |',
    `      ${F}`,
    '      done.',
  ]);
  assert.match(html, /<li>sequence:<x-comp data-comp="DiagramMermaid" data-lang="mermaid">sequenceDiagram\n  A-&gt;&gt;B: hello<\/x-comp>and stock:<x-comp data-comp="StockTable" data-lang="">\| id \| name \|\n\| --- \| --- \|<\/x-comp>done.<\/li>/);
});

test('markdown table as the marked block: indentation removed, text needs a blank line after it', async () => {
  const htmlAbsorbed = await htmlRender([
    '- stock:<!--renderComp=StockTable-->',
    '  | id | name |',
    '  | --- | --- |',
    '  | 1 | mouse |',
    '  done.',
  ]);
  // GFM: a table ends only at a blank line, so "done." became a table row
  assert.match(htmlAbsorbed, /<x-comp data-comp="StockTable" data-lang="">\| id \| name \|\n\| --- \| --- \|\n\| 1 \| mouse \|\ndone.<\/x-comp><\/li>/);

  const html = await htmlRender([
    '- stock:<!--renderComp=StockTable-->',
    '  | id | name |',
    '  | --- | --- |',
    '  | 1 | mouse |',
    '',
    '  done.',
  ]);
  assert.match(html, /<li><p>stock:<\/p><x-comp data-comp="StockTable" data-lang="">\| id \| name \|\n\| --- \| --- \|\n\| 1 \| mouse \|<\/x-comp><p>done.<\/p><\/li>/);
});

test('quote block and markdown code block as list elements', async () => {
  const html = await htmlRender([
    '- note:<!--renderComp=BlockSimple,title=Note-->',
    '  > keep the fence at the text column',
    '- both languages:<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->',
    `  ${F}markdown`,
    '  English.',
    '',
    '  日本語。',
    `  ${F}`,
  ]);
  assert.match(html, /<li>note:<x-comp data-comp="BlockSimple"[^>]*>&gt; keep the fence at the text column<\/x-comp><\/li>/);
  assert.match(html, /<li>both languages:<x-comp data-comp="MultiLang" data-lang="markdown">English.\n\n日本語。<\/x-comp><\/li>/);
});

test('loose list (blank lines between blocks) keeps every block in the item', async () => {
  const html = await htmlRender([
    '- as shown in this image<!--renderComp=Image-->',
    '',
    `  ${F}yaml`,
    '  src: dog.png',
    `  ${F}`,
    '',
    '  there is a dog.',
    '',
    '- next',
  ]);
  assert.match(html, /<li><p>as shown in this image<\/p><x-comp data-comp="Image"[^>]*>src: dog.png<\/x-comp><p>there is a dog.<\/p><\/li><li><p>next<\/p><\/li>/);
});

test('ordinary fenced code block as a list element', async () => {
  const html = await htmlRender([
    '- run:',
    `  ${F}bash`,
    '  pnpm dev',
    `  ${F}`,
    '- next',
  ]);
  assert.match(html, /<li>run:<pre[^>]*><code>[\s\S]*pnpm[\s\S]*dev[\s\S]*<\/code><\/pre><\/li><li>next<\/li>/);
});

test('inline tag mention inside a list item', async () => {
  const html = await htmlRender([
    '- documents tagged <!--renderComp=Tag-->`guide` are listed here',
  ]);
  assert.match(html, /<li>documents tagged <x-comp-inline data-comp="Tag">guide<\/x-comp-inline> are listed here<\/li>/);
});

test('fence indented less than the item text leaves the list (wrong style)', async () => {
  const html = await htmlRender([
    '- parent',
    '  - child<!--renderComp=Image-->',
    `  ${F}yaml`,
    '  src: dog.png',
    `  ${F}`,
  ]);
  // the block falls into the parent item, and the marker no longer reaches it
  assert.match(html, /<ul><li>parent<ul><li>child<\/li><\/ul><pre[^>]*><code>/);
  assert.equal(html.includes('x-comp'), false);
});

test('text right after the closing fence is not a closing fence (wrong style)', async () => {
  const html = await htmlRender([
    '- as shown<!--renderComp=Image-->',
    `  ${F}yaml`,
    '  src: dog.png',
    `  ${F}there is a dog.`,
    '- next',
  ]);
  assert.match(html, /<x-comp data-comp="Image" data-lang="yaml">src: dog.png\n```there is a dog.<\/x-comp>/);
});

test('mdx: JSX components as list elements, including multi-line and children', async () => {
  const html = await htmlRender([
    '- parent',
    '  - as shown in this image',
    '    <Image src="dog.png" />',
    '    there is a dog.',
    '  - the tree',
    '    <FileTree',
    "      tree={[{ name: 'src/' }]}",
    '    />',
    '  - <Callout>',
    '      inner **markdown**',
    '    </Callout>',
    '  - tagged <Tag tagId="guide" /> inline',
  ], 'mdx');
  assert.match(html, /<li>as shown in this image<x-jsx data-name="Image"><\/x-jsx>there is a dog\.<\/li>/);
  assert.match(html, /<li>the tree<x-jsx data-name="FileTree"><\/x-jsx><\/li>/);
  assert.match(html, /<li><x-jsx data-name="Callout"><p>inner <strong>markdown<\/strong><\/p><\/x-jsx><\/li>/);
  assert.match(html, /<li>tagged <x-jsx data-name="Tag"><\/x-jsx> inline<\/li>/);
});
