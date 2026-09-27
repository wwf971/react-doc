import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocLanguageProvider } from '../../../comp-mdx/multi-lang/MultiLangContext.jsx';
import { MultiLangHeadingText } from '../../../comp-mdx/multi-lang/MultiLangEntry.jsx';
import { compileDoc } from './mdx-compile.js';

const headingTagList = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

const componentsHeading = Object.fromEntries(headingTagList.map((tag) => {
  function Heading({ children, ...props }) {
    const variantsJson = props['data-multi-lang-heading'];
    if (!variantsJson) return createElement(tag, props, children);
    const propsHeading = { ...props };
    delete propsHeading['data-multi-lang-heading'];
    return createElement(tag, propsHeading, createElement(MultiLangHeadingText, { variantsJson }));
  }
  return [tag, Heading];
}));

test('localizes a multilingual heading without an explicit anchor in the body and TOC', async () => {
  const result = await compileMarkdown([
    '<!--renderComp=DocMultiLang-->',
    '# {en: "PAC Reinstall", jp: "PAC の再インストール"}',
  ].join('\n'));
  const item = tocItemByText(result.toc, 'PAC の再インストール');

  assert.equal(item.title.type, MultiLangHeadingText);
  assert.match(item.url, /^#/);
  assert.equal(item.url.includes('PAC'), false);
  assert.match(htmlBodyRender(result.Body, 'jp'), /<h1[^>]*>[\s\S]*PAC の再インストール[\s\S]*<\/h1>/);
  assert.equal(htmlBodyRender(result.Body, 'jp').includes('{en:'), false);
  assert.match(htmlNodeRender(item.title, 'jp'), /PAC の再インストール/);
});

test('localizes a multilingual heading with a stable anchor and keeps that anchor as the TOC url', async () => {
  const result = await compileMarkdown([
    '<span id="pac-reinstall" />',
    '',
    '<!--renderComp=DocMultiLang-->',
    '',
    '# {en: "PAC Reinstall", jp: "PAC の再インストール"}',
  ].join('\n'));
  const item = tocItemByUrl(result.toc, '#pac-reinstall');

  assert.ok(item);
  assert.equal(item.title.type, MultiLangHeadingText);
  assert.match(item.title.props.variantsJson, /PAC の再インストール/);
  assert.match(htmlBodyRender(result.Body, 'jp'), /<h1[^>]*id="pac-reinstall"[\s\S]*PAC の再インストール/);
});

test('localizes every multilingual heading under its own stable id', async () => {
  const result = await compileMarkdown([
    '<span id="pac-reinstall" />',
    '',
    '<!--renderComp=DocMultiLang-->',
    '',
    '# {en: "PAC Reinstall", jp: "PAC の再インストール"}',
    '',
    '<span id="install-or-update" />',
    '',
    '<!--renderComp=DocMultiLang-->',
    '',
    '## {en: "Install Or Update", jp: "インストールまたは更新"}',
  ].join('\n'));

  const itemReinstall = tocItemByUrl(result.toc, '#pac-reinstall');
  const itemInstall = tocItemByUrl(result.toc, '#install-or-update');
  assert.equal(itemReinstall.title.type, MultiLangHeadingText);
  assert.equal(itemInstall.title.type, MultiLangHeadingText);
  assert.match(itemReinstall.title.props.variantsJson, /PAC の再インストール/);
  assert.match(itemInstall.title.props.variantsJson, /インストールまたは更新/);
  assert.equal(itemReinstall.title.props.variantsJson.includes('インストールまたは更新'), false);
  assert.equal(itemInstall.title.props.variantsJson.includes('PAC の再インストール'), false);
});

test('selected language updates document headings and TOC titles together', async () => {
  const result = await compileMarkdown([
    '---',
    'language: jp',
    '---',
    '',
    '<span id="pac-reinstall" />',
    '',
    '<!--renderComp=DocMultiLang-->',
    '',
    '# {en: "PAC Reinstall", jp: "PAC の再インストール"}',
    '',
    '<span id="install-or-update" />',
    '',
    '<!--renderComp=DocMultiLang-->',
    '',
    '## {en: "Install Or Update", jp: "インストールまたは更新"}',
  ].join('\n'));
  const itemList = [
    tocItemByUrl(result.toc, '#pac-reinstall'),
    tocItemByUrl(result.toc, '#install-or-update'),
  ];

  const htmlJp = htmlBodyRender(result.Body, 'jp');
  const htmlEn = htmlBodyRender(result.Body, 'en');
  assert.match(htmlJp, /PAC の再インストール/);
  assert.match(htmlJp, /インストールまたは更新/);
  assert.equal(htmlJp.includes('PAC Reinstall'), false);
  assert.match(htmlEn, /PAC Reinstall/);
  assert.match(htmlEn, /Install Or Update/);
  assert.equal(htmlEn.includes('PAC の再インストール'), false);

  for (const item of itemList) {
    assert.match(htmlNodeRender(item.title, 'jp'), /lang="jp"/);
    assert.match(htmlNodeRender(item.title, 'en'), /lang="en"/);
  }
  assert.match(htmlNodeRender(itemList[0].title, 'jp'), /PAC の再インストール/);
  assert.match(htmlNodeRender(itemList[0].title, 'en'), /PAC Reinstall/);
  assert.match(htmlNodeRender(itemList[1].title, 'jp'), /インストールまたは更新/);
  assert.match(htmlNodeRender(itemList[1].title, 'en'), /Install Or Update/);
});

test('TOC uses the same first-available-language fallback as the document heading', async () => {
  const result = await compileMarkdown([
    '<!--renderComp=DocMultiLang-->',
    '# {jp: "最初の言語", en: "English heading"}',
  ].join('\n'));
  const item = tocItemByText(result.toc, '最初の言語');
  const htmlBody = htmlBodyRender(result.Body, 'fr');
  const htmlToc = htmlNodeRender(item.title, 'fr');

  assert.match(htmlBody, /lang="jp"/);
  assert.match(htmlBody, /最初の言語/);
  assert.equal(htmlBody.includes('English heading'), false);
  assert.match(htmlToc, /lang="jp"/);
  assert.match(htmlToc, /最初の言語/);
  assert.equal(htmlToc.includes('English heading'), false);
});

test('leaves a plain heading and its TOC entry unchanged', async () => {
  const result = await compileMarkdown('# Plain Title\n');
  const item = result.toc[0];

  assert.notEqual(item.title?.type, MultiLangHeadingText);
  assert.match(htmlNodeRender(item.title, 'jp'), /Plain Title/);
  assert.equal(String(item.title?.type?.name ?? '').includes('MultiLang'), false);
  assert.match(htmlBodyRender(result.Body, 'jp'), /<h1[^>]*>Plain Title<\/h1>/);
  assert.equal(result.languageList.includes('en'), false);
  assert.equal(result.languageList.includes('jp'), false);
});

test('keeps stable aliases as separate fragment targets without duplicate ids', async () => {
  const result = await compileMarkdown([
    '<span id="component-a" />',
    '<span id="component-b" />',
    '',
    '<!--renderComp=DocMultiLang-->',
    '',
    '## {en: "Shared section", jp: "共有セクション"}',
  ].join('\n'));
  const html = htmlBodyRender(result.Body, 'en');

  assert.equal(tocUrlList(result.toc).includes('#component-a'), true);
  assert.equal(tocUrlList(result.toc).includes('#component-b'), false);
  assert.equal(html.split('id="component-a"').length - 1, 1);
  assert.equal(html.split('id="component-b"').length - 1, 1);
  assert.match(html, /<h2[^>]*id="component-a"/);
  assert.match(html, /<span[^>]*id="component-b"/);
  assert.match(tocItemByUrl(result.toc, '#component-a').title.props.variantsJson, /共有セクション/);
});

async function compileMarkdown(source) {
  return compileDoc({
    source,
    internalPath: '/example/heading.md',
    format: 'md',
  });
}

function tocItemByUrl(itemList, url) {
  for (const item of itemList ?? []) {
    if (item.url === url) return item;
    const nested = tocItemByUrl(item.children, url);
    if (nested) return nested;
  }
  return null;
}

function tocItemByText(itemList, text) {
  for (const item of itemList ?? []) {
    if (item.title?.type === MultiLangHeadingText && item.title.props.variantsJson.includes(text)) {
      return item;
    }
    const nested = tocItemByText(item.children, text);
    if (nested) return nested;
  }
  return null;
}

function tocUrlList(itemList) {
  const urlList = [];
  for (const item of itemList ?? []) {
    urlList.push(item.url);
    urlList.push(...tocUrlList(item.children));
  }
  return urlList;
}

function htmlBodyRender(Body, language) {
  return renderToStaticMarkup(createElement(
    DocLanguageProvider,
    { language },
    createElement(Body, { components: componentsHeading }),
  ));
}

function htmlNodeRender(node, language) {
  return renderToStaticMarkup(createElement(DocLanguageProvider, { language }, node));
}
