import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreContext } from '../../../main/frontend/src/store/context.js';
import { sourceIndexBuild, docTargetResolve } from '../../../main/frontend/src/lib/doc-target-resolve.js';
import { SourceLink } from './SourceLink.jsx';
import { SourceLinkRenderPopup } from './SourceLinkRenderPopup.jsx';
import { DocLink } from '../../../main/comp-doc/link/DocLink.jsx';

// SourceLink resolves the authored reference as the page resolves every
// reference (DocSourceStore.fileResolve with the owning document as
// context), then reads, loads, tags and opens the canonical source entry.
// a literal lookup of the authored spelling in the manifest would not find
// a local path written in a document of a doc page of a workspace, whose
// manifest key is the full form; these tests fail on that regression.

const manifest = [
  { internalPath: '~codeapp-development:codeapp-dev/doc/codeapp-doc.md', name: 'codeapp-doc.md', ext: 'md' },
  { internalPath: '~codeapp-development:codeapp-dev/script/codeapp-build.ps1', name: 'codeapp-build.ps1', ext: 'ps1' },
  { internalPath: '~other:codeapp-dev/script/codeapp-build.ps1', name: 'codeapp-build.ps1', ext: 'ps1' },
  { internalPath: '~wiki:docs/readme.md', name: 'readme.md', ext: 'md' },
];
const docPath = '~codeapp-development:codeapp-dev/doc/codeapp-doc.md';
const scriptPath = '~codeapp-development:codeapp-dev/script/codeapp-build.ps1';

function storesCreate({ docCurrentPath = '~wiki:docs/readme.md', rawByPath = {}, compiledByPath = {} } = {}) {
  const sourceIndex = sourceIndexBuild(manifest);
  const keyReadList = [];
  const tagKeyList = [];
  const stateRecord = (byPath) => new Proxy(byPath, { get(target, key) { keyReadList.push(String(key)); return target[key]; } });
  const sourceStore = {
    configDoc: { fileDisplay: {}, compRegistry: {} },
    entryByInternalPath: sourceIndex.entryByInternalPath,
    fileResolve(reference, fromPath = '') {
      const { entryList } = docTargetResolve(reference, fromPath, sourceIndex);
      return entryList.length === 1 ? entryList[0] : undefined;
    },
    rawByPath: stateRecord(rawByPath),
    compiledByPath: stateRecord(compiledByPath),
    loadRaw: async () => {},
    loadDoc: async () => {},
  };
  const stores = {
    compById: {},
    sourceStore,
    docStore: { docCurrentPath },
    configStore: { configDocGet: () => ({}) },
    tagStore: { tagService: { assetKeyGet: (kind, path) => { tagKeyList.push(`${kind}:${path}`); return `${kind}:${path}`; } }, tagDisplayListGet: () => [] },
  };
  return { stores, keyReadList, tagKeyList };
}

function htmlRender(stores, data, config = {}) {
  return renderToStaticMarkup(createElement(StoreContext.Provider, { value: stores },
    createElement(SourceLink, { data, config: { panelComponent: () => null, ...config } })));
}

test('a local target of the owning document resolves to that doc page, not the literal manifest key', () => {
  const { stores, keyReadList, tagKeyList } = storesCreate({ rawByPath: { [scriptPath]: { status: 'done', text: 'Write-Host' } } });
  const html = htmlRender(stores, { target: '~codeapp-dev/script/codeapp-build.ps1', tagsDisplay: 'after' }, { sourcePath: docPath });
  assert.equal(html.includes('is-broken'), false, html);
  assert.match(html, /codeapp-build\.ps1/);
  // the authored spelling stays the label; the canonical path is what is read
  assert.match(html, />~codeapp-dev\/script\/codeapp-build\.ps1</);
  assert.ok(keyReadList.includes(scriptPath), keyReadList.join(','));
  assert.equal(keyReadList.includes('~codeapp-dev/script/codeapp-build.ps1'), false);
  assert.deepEqual(tagKeyList, [`doc:${scriptPath}`]);
});

test('full and relative spellings resolve to the same entry, with the owning document before the current one', () => {
  const { stores, keyReadList } = storesCreate({ docCurrentPath: '~other:codeapp-dev/doc/x.md' });
  for (const target of [scriptPath, '../script/codeapp-build.ps1']) {
    keyReadList.length = 0;
    const html = htmlRender(stores, { target }, { sourcePath: docPath });
    assert.equal(html.includes('is-broken'), false, `${target}: ${html}`);
    assert.ok(keyReadList.includes(scriptPath), `${target}: ${keyReadList.join(',')}`);
  }
});

test('without an owning document the current document decides, and an ambiguous or missing target stays broken', () => {
  const { stores } = storesCreate({ docCurrentPath: docPath });
  assert.equal(htmlRender(stores, { target: '~codeapp-dev/script/codeapp-build.ps1' }).includes('is-broken'), false);
  // the same local path exists in two doc pages: no owning context chooses neither
  const ambiguous = storesCreate({ docCurrentPath: '~wiki:docs/readme.md' });
  assert.match(htmlRender(ambiguous.stores, { target: 'codeapp-dev/script/codeapp-build.ps1' }), /is-broken/);
  assert.match(htmlRender(stores, { target: '~codeapp-dev/script/missing.ps1' }), /is-broken/);
  assert.match(htmlRender(stores, { target: '' }), /is-broken/);
});

test('an explicit label is kept, and render mode reads the compiled state of the canonical path', () => {
  const { stores, keyReadList } = storesCreate({ compiledByPath: { [scriptPath]: { status: 'done' } } });
  const html = htmlRender(stores, { target: '~codeapp-dev/script/codeapp-build.ps1', label: 'build script', displayMode: 'render' }, { sourcePath: docPath });
  assert.match(html, />build script</);
  assert.ok(keyReadList.includes(scriptPath));
});

test('render popup titles pass literal filenames to the host panel', () => {
  const pathPopup = '~wiki:docs/mdx_T05_submitted.md';
  const { stores } = storesCreate({ compiledByPath: { [pathPopup]: {
    status: 'done', Body: () => createElement('p', null, 'Evidence'),
  } } });
  stores.sourceStore.entryByInternalPath.set(pathPopup, { name: 'mdx_T05_submitted.md' });
  const Panel = ({ data, content }) => {
    assert.ok(isValidElement(data.title));
    return createElement('section', null, data.title, content);
  };
  const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: stores },
    createElement(SourceLinkRenderPopup, { Panel, store: { pathPopup, isPopupOpen: true } })));
  assert.match(html, /<span>mdx_T05_submitted\.md<\/span>/);
});

test('off-sidebar Markdown and configured source links open a popup; sidebar links still navigate', async () => {
  for (const { ext, isNavigable } of [
    { ext: 'md', isNavigable: false },
    { ext: 'md', isNavigable: true },
    { ext: 'json', isNavigable: false },
    { ext: 'json', isNavigable: true },
    { ext: 'yaml', isNavigable: false },
  ]) {
    const pathEvidence = `~wiki:docs/test_results.${ext}`;
    const { stores } = storesCreate();
    stores.sourceStore.entryByInternalPath.set(pathEvidence, { ext, name: `test_results.${ext}` });
    stores.sourceStore.configDoc.fileDisplay = { json: 'json', yaml: 'yaml' };
    const loaded = [];
    const navigated = [];
    let rendered;
    stores.compConfigHost = { panelComponent: () => null };
    stores.linkConfig = { CompRender: props => { rendered = props; return null; } };
    Object.assign(stores.docStore, {
      docTargetResolve: () => ({ targetList: [{ internalPath: pathEvidence }], hash: '' }),
      isDocNavigable: () => isNavigable,
      toBrowserHref: path => path,
      navigate: path => { navigated.push(path); return true; },
    });
    stores.sourceStore.loadDoc = async path => {
      loaded.push(path);
      stores.sourceStore.compiledByPath[path] = { status: 'done' };
    };
    renderToStaticMarkup(createElement(StoreContext.Provider, { value: stores },
      createElement(DocLink, { target: pathEvidence })));
    assert.equal(rendered.config.isNavigationUnavailable, false);
    assert.equal(rendered.config.activationElement, isNavigable ? 'anchor' : 'button');
    await rendered.onEvent('activateRequest');
    assert.deepEqual(loaded, isNavigable ? [] : [pathEvidence]);
    assert.deepEqual(navigated, isNavigable ? [pathEvidence] : []);
  }
});
