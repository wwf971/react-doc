import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createElement } from 'react';
import { transformSync } from 'esbuild';
import { docSourcePlugin, docSourceMiddlewareCreate, generateModuleCode } from '../../plugin/doc-source.ts';
import { docEditMiddlewareCreate } from '../../plugin/doc-edit-server.ts';
import { lineOperationApply } from '../../plugin/doc-edit-lines.ts';
import { sidePanelTextOperationBuild } from '../../plugin/doc-side-panel-text.ts';
import { DocSourceStore } from '../store/DocSourceStore.ts';
import { MdxBody } from './MdxBody.jsx';

// development transport of document content (doc_page_impl_edit.md,
// "saving without a reload"): the text of a document is read over http and
// a change is announced as the custom event "doc-source-change". these
// tests run the real plugin, middleware and emitted client code without a
// listening server.

// ---------- fixture ----------

function fixtureCreate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-source-hmr-'));
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), '# A\n\nfirst\n');
  fs.writeFileSync(path.join(dir, 'docs', 'b.md'), '# B\n\nsecond\n');
  fs.writeFileSync(path.join(dir, 'docs', 'c.md'), '# C\n\nthird\n');
  // the entry of the fixture document: its source rules inline, its side
  // panel in a resource file next to it
  fs.writeFileSync(path.join(dir, 'fixture-entry.yaml'), [
    'docEntry:',
    '  title: Fixture',
    'source:',
    '  - action: addFolder',
    '    rootId: docs',
    '    path: docs',
    '    collect: recursive',
    '  # a yaml file of the document is configuration, never a document,',
    '  # whatever the rules say',
    '  - action: addFile',
    '    rootId: cfg',
    '    path: ./side-panel.yaml',
    'sidePanelById:',
    '  main:',
    '    file: ./side-panel.yaml',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'side-panel.yaml'), [
    '# the side panel of the fixture',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - separator: Docs   # keep this comment',
    '      - doc: ~docs/a.md',
    '        text: Label A',
    '      - doc: ~docs/b.md',
    '      - id: group',
    '        text:',
    '          en: Group',
    '          jp: グループ',
    '        children:',
    '          - doc: ~docs/c.md',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), [
    'docEntry:',
    '  file: ./fixture-entry.yaml',
    '',
  ].join('\n'));
  return dir;
}

// yaml address of the fixture's tree nodes inside side-panel.yaml
const TREE_PATH = ['sidePanelById', 'main', 'tree'];

function pluginCreate(dir, { base = '/', command = 'serve' } = {}) {
  const plugin = docSourcePlugin({ configFile: path.join(dir, 'config.yaml') });
  plugin.configResolved({ command, root: dir, base });
  return plugin;
}

// runs one connect-style middleware against a request without a server
function requestRun(middleware, { method = 'GET', url, body }) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
      end: (text) => resolve({ status: res.statusCode, headers, text: String(text ?? '') }),
    };
    middleware(req, res, () => resolve({ status: -1, headers, text: 'next' }));
    if (body !== undefined) {
      process.nextTick(() => {
        req.emit('data', Buffer.from(JSON.stringify(body)));
        req.emit('end');
      });
    }
  });
}

// the middlewares a development server would mount, and a `fetch` that
// reaches them. the edit middleware reports a side-panel write like the
// plugin's configureServer does, so the "page" learns of the new config.
function serverCreate(dir, plugin, { base = '/' } = {}) {
  const configDocGet = () => {
    const code = plugin.load('\0virtual:doc-source');
    return JSON.parse(/export let configDoc = (.*);\n/.exec(code)[1]);
  };
  const entriesGet = () => {
    const code = plugin.load('\0virtual:doc-source');
    const manifest = /export let fileManifest = \[\n([\s\S]*?)\n\];/.exec(code)[1];
    return [...manifest.matchAll(/\{ \.\.\.(\{.*?\}), load: /g)].map((match) => {
      const metadata = JSON.parse(match[1]);
      return { ...metadata, absPath: path.join(dir, metadata.rootId, metadata.relPath) };
    });
  };
  const baseEndpoint = base.replace(/\/+$/, '');
  const sidePanelWrittenList = [];
  const middlewareList = [
    docSourceMiddlewareCreate({ endpoint: `${baseEndpoint}/__doc-source`, fileEntryListGet: entriesGet }),
    docEditMiddlewareCreate({
      endpoint: `${baseEndpoint}/__doc-edit`,
      fileEntryListGet: entriesGet,
      sidePanel: {
        configDir: dir,
        fileListGet: () => [path.join(dir, 'side-panel.yaml')],
        onFileWritten: (filePath, text) => sidePanelWrittenList.push({ filePath, text }),
      },
    }),
  ];
  const request = async (options) => {
    for (const middleware of middlewareList) {
      const result = await requestRun(middleware, options);
      if (result.status !== -1) return result;
    }
    return { status: 404, headers: {}, text: '<html>spa fallback</html>' };
  };
  const fetch = async (url, init = {}) => {
    const result = await request({
      method: init.method ?? 'GET',
      url,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      headers: { get: (name) => result.headers[name.toLowerCase()] },
      text: async () => result.text,
      json: async () => JSON.parse(result.text),
    };
  };
  return { configDocGet, entriesGet, request, fetch, sidePanelWrittenList };
}

// executes the emitted development module in a vm with a fake hot context
function clientModuleRun(code, { fetch, hot }) {
  const codeHot = code.replaceAll('import.meta.hot', '__hot');
  const { code: codeCjs } = transformSync(codeHot, { format: 'cjs', loader: 'js' });
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, fetch, __hot: hot, Error, Promise });
  vm.runInContext(codeCjs, context);
  return module.exports;
}

function hotCreate() {
  const handlerByEvent = new Map();
  return {
    data: {},
    on: (event, handler) => handlerByEvent.set(event, handler),
    dispose: () => {},
    accept: () => {},
    emit: (event, data) => handlerByEvent.get(event)?.(data),
  };
}

// ---------- the source endpoint ----------

test('source endpoint serves the current text of collected files as plain text, never cached', async () => {
  const dir = fixtureCreate();
  const plugin = pluginCreate(dir, { base: '/docs-site/' });
  const server = serverCreate(dir, plugin, { base: '/docs-site/' });

  const first = await server.request({ url: '/docs-site/__doc-source/file?path=~docs%2Fa.md' });
  assert.equal(first.status, 200);
  assert.equal(first.text, '# A\n\nfirst\n');
  assert.equal(first.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(first.headers['cache-control'], 'no-store');

  fs.writeFileSync(path.join(dir, 'docs', 'a.md'), '# A\n\nchanged\n');
  const second = await server.request({ url: '/docs-site/__doc-source/file?path=~docs%2Fa.md' });
  assert.equal(second.text, '# A\n\nchanged\n');

  const unknown = await server.request({ url: '/docs-site/__doc-source/file?path=~docs%2Fnone.md' });
  assert.equal(unknown.status, 404);
  const traversal = await server.request({ url: '/docs-site/__doc-source/file?path=..%2Fconfig.yaml' });
  assert.equal(traversal.status, 404);
  const method = await server.request({ method: 'POST', url: '/docs-site/__doc-source/file?path=~docs%2Fa.md' });
  assert.equal(method.status, 405);
  assert.equal(method.headers.allow, 'GET');
  // below the base path only
  const outsideBase = await server.request({ url: '/__doc-source/file?path=~docs%2Fa.md' });
  assert.equal(outsideBase.status, 404);
  assert.match(outsideBase.text, /spa fallback/);
});

test('development module reads text over http; a build imports ?raw', () => {
  const dir = fixtureCreate();
  const codeDev = pluginCreate(dir).load('\0virtual:doc-source');
  assert.ok(codeDev.includes('sourceTextLoad'));
  assert.ok(codeDev.includes("'doc-source-change'"));
  assert.ok(!/import\([^)]*\?raw/.test(codeDev));
  assert.ok(codeDev.includes('"contentHash":'));
  assert.ok(codeDev.includes('"textSource":{"file":"side-panel.yaml","path":["sidePanelById","main","tree",1]}'));
  // the entry supplies the page title; its yaml files are not documents
  assert.ok(codeDev.includes('"siteTitle":"Fixture"'));
  assert.ok(!codeDev.includes('"internalPath":"/cfg/side-panel.yaml"'));

  const codeBuild = pluginCreate(dir, { command: 'build' }).load('\0virtual:doc-source');
  assert.ok(/import\("[^"]+a\.md\?raw"\)/.test(codeBuild));
  assert.ok(!codeBuild.includes('sourceTextLoad'));
  assert.ok(!codeBuild.includes('doc-source-change'));
});

// ---------- the emitted client code ----------

test('emitted client replays the latest data, ignores other module ids, and loads through the endpoint', async () => {
  const dir = fixtureCreate();
  const plugin = pluginCreate(dir);
  const server = serverCreate(dir, plugin);
  const hot = hotCreate();
  const client = clientModuleRun(plugin.load('\0virtual:doc-source'), { fetch: server.fetch, hot });

  assert.equal(client.fileManifest.length, 3);
  assert.equal(await client.fileManifest[0].load(), '# A\n\nfirst\n');

  const received = [];
  const unsubscribe = client.subscribeDocSource((data) => received.push(data));
  assert.equal(received.length, 0, 'no data before the first change');

  const entriesNext = server.entriesGet();
  hot.emit('doc-source-change', { moduleId: 'virtual:other', configDoc: {}, fileManifest: [] });
  assert.equal(received.length, 0, 'another module id is not ours');

  fs.writeFileSync(path.join(dir, 'docs', 'b.md'), '# B\n\nsecond edited\n');
  hot.emit('doc-source-change', {
    moduleId: 'virtual:doc-source',
    configDoc: server.configDocGet(),
    fileManifest: server.entriesGet().map(({ absPath: _absPath, ...metadata }) => metadata),
  });
  assert.equal(received.length, 1);
  assert.notEqual(received[0].fileManifest[1].contentHash, entriesNext[1].contentHash);
  assert.equal(await received[0].fileManifest[1].load(), '# B\n\nsecond edited\n');
  assert.equal(client.fileManifest, received[0].fileManifest, 'the exports follow the event');

  unsubscribe();
  hot.emit('doc-source-change', { moduleId: 'virtual:doc-source', configDoc: {}, fileManifest: [] });
  assert.equal(received.length, 1, 'a removed listener is not called');

  const late = [];
  client.subscribeDocSource((data) => late.push(data));
  assert.equal(late.length, 1, 'a late subscriber gets the latest data at once');
  assert.deepEqual(late[0].fileManifest, []);
});

// ---------- the source store ----------

function manifestBuild(textByPath) {
  return Object.entries(textByPath).map(([internalPath, text]) => ({
    rootId: 'docs',
    relPath: internalPath.slice('~docs/'.length),
    name: path.basename(internalPath),
    ext: 'md',
    title: internalPath,
    internalPath,
    contentHash: `hash:${text}`,
    load: async () => text,
  }));
}

test('source store refreshes only the changed paths and keeps the caches of the others', async () => {
  const store = new DocSourceStore({
    configDoc: {},
    fileManifest: manifestBuild({ '~docs/a.md': '# A\n\none', '~docs/b.md': '# B\n\ntwo', '~docs/c.md': '# C' }),
  });
  await Promise.all([store.loadDoc('~docs/a.md'), store.loadDoc('~docs/b.md'), store.loadRaw('~docs/c.md')]);
  const compiledA = store.compiledByPath['~docs/a.md'];
  const compiledB = store.compiledByPath['~docs/b.md'];
  assert.equal(compiledA.status, 'done');

  const versionB = store.versionGet('~docs/b.md');
  await store.replaceSourceData({
    configDoc: {},
    fileManifest: manifestBuild({ '~docs/a.md': '# A\n\none', '~docs/b.md': '# B\n\ntwo changed' }),
  });
  assert.equal(store.compiledByPath['~docs/a.md'], compiledA, 'unchanged path keeps its compiled object');
  assert.notEqual(store.compiledByPath['~docs/b.md'], compiledB, 'changed path is compiled again');
  assert.equal(store.compiledByPath['~docs/b.md'].status, 'done');
  assert.equal(store.versionGet('~docs/b.md'), versionB + 1);
  assert.equal(store.rawByPath['~docs/c.md'], undefined, 'removed path loses its cache');
});

test('a read of an older version never overwrites the newer one', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const entrySlow = manifestBuild({ '~docs/a.md': '# A\n\nold' })[0];
  entrySlow.load = () => gate.then(() => '# A\n\nold');
  const store = new DocSourceStore({ configDoc: {}, fileManifest: [entrySlow] });
  const loadOld = store.loadRaw('~docs/a.md');
  // the source changes while the old read is still pending; the pending
  // read is not refreshed (nothing is loaded yet), only its version moves
  const replace = store.replaceSourceData({ configDoc: {}, fileManifest: manifestBuild({ '~docs/a.md': '# A\n\nnew' }) });
  release();
  await Promise.all([loadOld, replace]);
  assert.notEqual(store.rawByPath['~docs/a.md']?.content, '# A\n\nold', 'the stale read was dropped');
  await store.loadRaw('~docs/a.md');
  assert.equal(store.rawByPath['~docs/a.md'].content, '# A\n\nnew');
});

// ---------- the stable body adapter ----------

test('MdxBody keeps one element type for every compiled body of the same path', () => {
  const BodyFirst = () => null;
  const BodySecond = () => null;
  const elementFirst = createElement(MdxBody, { key: '~docs/a.md', Body: BodyFirst, components: {} });
  const elementSecond = createElement(MdxBody, { key: '~docs/a.md', Body: BodySecond, components: {} });
  assert.equal(elementFirst.type, elementSecond.type);
  assert.equal(elementFirst.key, elementSecond.key);
  assert.notEqual(elementFirst.props.Body, elementSecond.props.Body);
});

// ---------- side-panel labels ----------

test('side-panel label route rewrites one value in place and reports the write', async () => {
  const dir = fixtureCreate();
  const plugin = pluginCreate(dir);
  const server = serverCreate(dir, plugin);
  const fileBefore = fs.readFileSync(path.join(dir, 'side-panel.yaml'), 'utf-8');

  const replaced = await server.request({
    method: 'POST',
    url: '/__doc-edit/side-panel/text',
    body: { file: 'side-panel.yaml', nodePath: [...TREE_PATH, 1], language: '', text: 'Label A: renamed', textBase: 'Label A' },
  });
  assert.equal(replaced.status, 200);
  assert.deepEqual(JSON.parse(replaced.text).data, { file: 'side-panel.yaml', fieldName: 'text', text: 'Label A: renamed' });
  const fileAfter = fs.readFileSync(path.join(dir, 'side-panel.yaml'), 'utf-8');
  assert.equal(fileAfter, fileBefore.replace('        text: Label A\n', '        text: "Label A: renamed"\n'));
  assert.equal(server.sidePanelWrittenList.length, 1);
  assert.equal(server.sidePanelWrittenList[0].text, fileAfter);
  assert.equal(server.configDocGet().sidePanel.tree[1].text, 'Label A: renamed');

  // a translation of a language mapping
  const translated = await server.request({
    method: 'POST',
    url: '/__doc-edit/side-panel/text',
    body: { file: 'side-panel.yaml', nodePath: [...TREE_PATH, 3], language: 'jp', text: '組', textBase: 'グループ' },
  });
  assert.equal(translated.status, 200);
  assert.ok(fs.readFileSync(path.join(dir, 'side-panel.yaml'), 'utf-8').includes('          jp: 組\n'));

  // a document labeled by its title gets a "text" line after its first key
  const inserted = await server.request({
    method: 'POST',
    url: '/__doc-edit/side-panel/text',
    body: { file: 'side-panel.yaml', nodePath: [...TREE_PATH, 2], language: '', text: 'Second' },
  });
  assert.equal(inserted.status, 200);
  assert.ok(fs.readFileSync(path.join(dir, 'side-panel.yaml'), 'utf-8').includes('      - doc: ~docs/b.md\n        text: Second\n      - id: group\n'));

  // the separator keeps its trailing comment
  const separator = await server.request({
    method: 'POST',
    url: '/__doc-edit/side-panel/text',
    body: { file: 'side-panel.yaml', nodePath: [...TREE_PATH, 0], language: '', text: 'Documents', textBase: 'Docs' },
  });
  assert.equal(separator.status, 200);
  const fileFinal = fs.readFileSync(path.join(dir, 'side-panel.yaml'), 'utf-8');
  assert.ok(fileFinal.includes('      - separator: Documents   # keep this comment\n'));
  assert.ok(fileFinal.startsWith('# the side panel of the fixture\n'));

  // refused: a stale base, a file outside the configuration, an empty text
  const stale = await server.request({
    method: 'POST',
    url: '/__doc-edit/side-panel/text',
    body: { file: 'side-panel.yaml', nodePath: [...TREE_PATH, 1], language: '', text: 'X', textBase: 'Label A' },
  });
  assert.equal(stale.status, 409);
  assert.equal(JSON.parse(stale.text).code, -2);
  const outside = await server.request({
    method: 'POST',
    url: '/__doc-edit/side-panel/text',
    body: { file: 'config.yaml', nodePath: ['siteTitle'], language: '', text: 'X' },
  });
  assert.equal(JSON.parse(outside.text).code, -3);
  const empty = await server.request({
    method: 'POST',
    url: '/__doc-edit/side-panel/text',
    body: { file: 'side-panel.yaml', nodePath: [...TREE_PATH, 1], language: '', text: '  ' },
  });
  assert.equal(empty.status, 400);
  assert.equal(fs.readFileSync(path.join(dir, 'side-panel.yaml'), 'utf-8'), fileFinal, 'refused edits leave the file as it is');
});

test('side-panel label operation quotes what yaml needs quoted and collapses a block scalar', () => {
  const source = 'tree:\n  - doc: a.md\n    text: |\n      two\n      lines\n  - doc: b.md\n    text: plain\n';
  const collapsed = sidePanelTextOperationBuild(source, { nodePath: ['tree', 0], language: '', text: 'one line' });
  assert.equal(collapsed.code, 0);
  assert.deepEqual(collapsed.data.operation, { action: 'replaceLines', lineStart: 3, lineEnd: 5, text: '    text: one line' });
  const quoted = sidePanelTextOperationBuild(source, { nodePath: ['tree', 1], language: '', text: '- 12 # not a comment' });
  assert.equal(lineOperationApply(source, quoted.data.operation), 'tree:\n  - doc: a.md\n    text: |\n      two\n      lines\n  - doc: b.md\n    text: "- 12 # not a comment"\n');
  const flow = sidePanelTextOperationBuild('tree:\n  - { doc: a.md }\n', { nodePath: ['tree', 0], language: '', text: 'x' });
  assert.equal(flow.code, -1);
});

test('production module generation keeps raw imports and no-op subscriptions', () => {
  const entry = {
    rootId: 'docs', relPath: 'a.md', name: 'a.md', ext: 'md', internalPath: '~docs/a.md', collect: 'recursive',
    absPath: path.join(fixtureCreate(), 'docs', 'a.md'),
  };
  const code = generateModuleCode({}, [entry], [], [], true, {
    docSourceEndpoint: '', docEditEndpoint: '', docAssetEndpoint: '', assetSnapshot: null, moduleId: 'virtual:doc-source',
  });
  assert.ok(code.includes('?raw'));
  assert.ok(code.includes('export function subscribeDocSource() { return () => {}; }'));
  assert.ok(!code.includes('fetch('));
});
