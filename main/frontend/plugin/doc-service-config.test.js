import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SERVICE_BACKEND_PORT_DEFAULT,
  SERVICE_FOLDER_DEFAULT_LIST,
  docServiceMiddlewareCreate,
  serviceConfigGet,
  serviceConfigOfDocPageListGet,
  serviceDocPageRead,
  serviceFolderSetGet,
  servicePathIs,
  serviceSyncDocPageListBuild,
} from './doc-service-server.ts';
import { docSourcePlugin } from './doc-source.ts';

// the service folders of a doc page (doc_page_impl_service.md, the doc page
// folder convention of doc_page_impl_dir.md): the four convention folders
// of the doc page folder, or those .doc-page/service.yaml names; never
// documents. and the sync route of the development server, which tells
// the backend which doc pages the page loaded.

// a doc page folder "page" (root "docs") including the doc page folder
// "page/sub" (root "sub") by its folder; the service folders of "page" hold
// a file each. serviceYamlByPage: the text of .doc-page/service.yaml of
// "page" / "sub", absent for none; entryLineListByPage: lines added to the entry
function fixtureCreate({ serviceYamlByPage = {}, entryLineListByPage = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-service-config-'));
  const pageDir = path.join(dir, 'page');
  const subDir = path.join(pageDir, 'sub');
  fs.mkdirSync(path.join(pageDir, '.doc-page'), { recursive: true });
  fs.mkdirSync(path.join(subDir, '.doc-page'), { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'a.md'), '# A\n');
  fs.writeFileSync(path.join(subDir, 'b.md'), '# B\n');
  for (const folderName of ['service-template-app', 'service-template-infra', 'service-app', 'service-infra']) {
    fs.mkdirSync(path.join(pageDir, folderName, 'x'), { recursive: true });
    fs.writeFileSync(path.join(pageDir, folderName, 'x', 'readme.md'), '# not a document\n');
  }
  fs.writeFileSync(path.join(pageDir, '.doc-page', 'entry.yaml'), [
    'docEntry:',
    '  title: Fixture',
    ...(entryLineListByPage.page ?? []),
    'source:',
    '  - action: addFolder',
    '    alias: docs',
    '    path: ..',
    '    collect: recursive',
    '    exclude: [sub/]',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~docs/a.md',
    '      - id: sub',
    '        include: { dir: ../sub, alias: sub }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(subDir, '.doc-page', 'entry.yaml'), [
    'docEntry: true',
    ...(entryLineListByPage.sub ?? []),
    'source:',
    '  - action: addFolder',
    '    alias: sub',
    '    path: ..',
    '    collect: recursive',
    'sidePanelById:',
    '  main:',
    '    tree:',
    '      - doc: ~sub/b.md',
    '',
  ].join('\n'));
  if (serviceYamlByPage.page !== undefined) fs.writeFileSync(path.join(pageDir, '.doc-page', 'service.yaml'), serviceYamlByPage.page);
  if (serviceYamlByPage.sub !== undefined) fs.writeFileSync(path.join(subDir, '.doc-page', 'service.yaml'), serviceYamlByPage.sub);
  fs.writeFileSync(path.join(dir, 'config.yaml'), ['docEntry:', '  dir: ./page', 'service:', '  backend: http://127.0.0.1:1', ''].join('\n'));
  return dir;
}

function pluginCreate(dir, command = 'serve') {
  const plugin = docSourcePlugin({ configFile: path.join(dir, 'config.yaml') });
  plugin.configResolved({ command, root: dir, base: '/' });
  return plugin;
}

function docPageInputList(dir, { servicePage, serviceSub } = {}) {
  return [
    { alias: 'page', entryFile: path.join(dir, 'page/.doc-page/entry.yaml'), dirPage: path.join(dir, 'page'), service: servicePage },
    { alias: 'sub', entryFile: path.join(dir, 'page/sub/.doc-page/entry.yaml'), dirPage: path.join(dir, 'page/sub'), service: serviceSub },
  ];
}

test('without service.yaml a doc page has the four convention folders; service: false has none', () => {
  const dir = fixtureCreate();
  const docPage = serviceDocPageRead(docPageInputList(dir)[0]);
  assert.equal(docPage.isConfigFileExists, false);
  assert.equal(docPage.configFile, path.join(dir, 'page/.doc-page/service.yaml'));
  assert.deepEqual(docPage.folderList.map((folder) => [path.relative(dir, folder.pathAbs), folder.role, folder.kind, folder.isDefault]), [
    ['page/service-template-app', 'template', 'app', false],
    ['page/service-template-infra', 'template', 'infra', false],
    ['page/service-app', 'instance', 'app', true],
    ['page/service-infra', 'instance', 'infra', true],
  ]);
  assert.equal(SERVICE_FOLDER_DEFAULT_LIST.length, 4);
  const config = serviceConfigOfDocPageListGet(docPageInputList(dir, { serviceSub: false }));
  assert.deepEqual(config.docPageList.map((item) => item.alias), ['page']);
});

test('service.yaml names the folders relative to the file; a bad entry is skipped and reported', () => {
  const dir = fixtureCreate({
    serviceYamlByPage: {
      page: [
        'templateFolderList:',
        '  - ../templates            # a bare string: an app template folder',
        '  - { path: ../infra-templates, kind: infra }',
        '  - { path: ../wrong, kind: database }',
        'instanceFolderList:',
        '  - { path: ../instances, kind: app, isDefault: true }',
        '  - 42',
        '',
      ].join('\n'),
    },
  });
  const docPage = serviceDocPageRead(docPageInputList(dir)[0]);
  assert.equal(docPage.isConfigFileExists, true);
  assert.deepEqual(docPage.folderList.map((folder) => [path.relative(dir, folder.pathAbs), folder.role, folder.kind, folder.isDefault]), [
    ['page/templates', 'template', 'app', false],
    ['page/infra-templates', 'template', 'infra', false],
    ['page/instances', 'instance', 'app', true],
  ]);
  assert.equal(docPage.problemList.length, 2);
  assert.match(docPage.problemList[0], /templateFolderList\[2\]: kind is app or infra/);
  assert.match(docPage.problemList[1], /instanceFolderList\[1\]: every entry is a path/);

  // the entry names another file
  fs.writeFileSync(path.join(dir, 'page/.doc-page/my-service.yaml'), 'instanceFolderList: [../run]\n');
  const docPageNamed = serviceDocPageRead({ ...docPageInputList(dir)[0], service: { file: './my-service.yaml' } });
  assert.deepEqual(docPageNamed.folderList.map((folder) => path.relative(dir, folder.pathAbs)), ['page/run']);
});

test('the service folders are never documents nor folders of the source, the backend config folders neither', () => {
  const dir = fixtureCreate();
  const plugin = pluginCreate(dir);
  const code = plugin.load('\0virtual:doc-source');
  assert.ok(code.includes('~page:docs/a.md'));
  assert.ok(!code.includes('service-app/x/readme.md'));
  assert.ok(!code.includes('service-template-app/x/readme.md'));
  assert.ok(!/dirManifest = .*service-infra/.test(code));

  // the union with the folders of the backend config named by config.yaml
  fs.writeFileSync(path.join(dir, 'backend.yaml'), 'templateFolderList:\n  - ./plain-templates\n');
  const folderSet = serviceFolderSetGet(
    { backendUrl: 'http://127.0.0.1:1', backendConfigFile: path.join(dir, 'backend.yaml'), folderPathAbsList: [path.join(dir, 'plain-templates')], isLaunch: false, python: 'python3' },
    docPageInputList(dir, { serviceSub: false }),
  );
  assert.equal(servicePathIs(folderSet, path.join(dir, 'plain-templates/t/service.py')), true);
  assert.equal(servicePathIs(folderSet, path.join(dir, 'page/service-infra/i/data.sqlite')), true);
  assert.equal(servicePathIs(folderSet, path.join(dir, 'page/.doc-page/service.yaml')), true);
  assert.equal(servicePathIs(folderSet, path.join(dir, 'backend.yaml')), true);
  assert.equal(servicePathIs(folderSet, path.join(dir, 'page/a.md')), false);
  assert.equal(servicePathIs(folderSet, path.join(dir, 'page/sub/service-app/i/x.md')), false);
});

test('the sync body lists every loaded doc page with its service file when it exists or is named', () => {
  const dir = fixtureCreate({ serviceYamlByPage: { sub: 'instanceFolderList: [../run]\n' } });
  const list = serviceSyncDocPageListBuild(docPageInputList(dir));
  assert.deepEqual(list, [
    { alias: 'page', dir: path.join(dir, 'page'), serviceFile: '' },
    { alias: 'sub', dir: path.join(dir, 'page/sub'), serviceFile: path.join(dir, 'page/sub/.doc-page/service.yaml') },
  ]);
  // named by the entry: sent even when the file does not exist yet
  const listNamed = serviceSyncDocPageListBuild(docPageInputList(dir, { servicePage: { file: './svc.yaml' }, serviceSub: false }));
  assert.deepEqual(listNamed, [{ alias: 'page', dir: path.join(dir, 'page'), serviceFile: path.join(dir, 'page/.doc-page/svc.yaml') }]);
});

// the sync route against a backend stub: the request body is ignored, the
// body sent is built from the getter at request time
test('POST /registry/docpage/sync forwards the loaded doc pages, reads the list at request time, and answers -5 when down', async () => {
  const received = [];
  const backend = http.createServer((req, res) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(text) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 0, data: { count: (JSON.parse(text).docPageList ?? []).length } }));
    });
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const port = backend.address().port;
  let docPageList = [{ alias: 'a', dir: '/x/a', serviceFile: '' }];
  const middleware = docServiceMiddlewareCreate({
    endpoint: '/__doc-service',
    backendUrlGet: () => `http://127.0.0.1:${port}`,
    docPageListGet: () => docPageList,
  });
  const request = (url, body) => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = url;
    req.headers = { 'content-type': 'application/json' };
    req.resume = () => {};
    req.pipe = (target) => { target.end(body); };
    const res = new EventEmitter();
    let status = 0;
    let text = '';
    res.writeHead = (statusCode) => { status = statusCode; };
    res.write = (chunk) => { text += chunk; return true; };
    res.end = (chunk) => { if (chunk) text += chunk; resolve({ status, body: JSON.parse(text) }); };
    res.headersSent = false;
    middleware(req, res, () => resolve({ status: -1 }));
  });
  try {
    const first = await request('/__doc-service/registry/docpage/sync', '{"ignored": true}');
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { code: 0, data: { count: 1 } });
    assert.deepEqual(received[0], { url: '/registry/docpage/sync', body: { docPageList: [{ alias: 'a', dir: '/x/a', serviceFile: '' }] } });
    // the workspace changed: the next sync carries the current list
    docPageList = [...docPageList, { alias: 'b', dir: '/x/b', serviceFile: '/x/b/.doc-page/service.yaml' }];
    const second = await request('/__doc-service/registry/docpage/sync', '');
    assert.equal(second.body.data.count, 2);
    assert.equal(received[1].body.docPageList[1].alias, 'b');
    // any other route is forwarded as it is
    const other = await request('/__doc-service/instance/list', '{}');
    assert.equal(received[2].url, '/instance/list');
    assert.equal(other.status, 200);
  } finally {
    await new Promise((resolve) => backend.close(resolve));
  }
  const down = await request('/__doc-service/registry/docpage/sync', '');
  assert.equal(down.status, 503);
  assert.equal(down.body.code, -5);
});

test('the backend address is the host and port of the backend config file, unless config service.backend names one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-service-address-'));
  fs.writeFileSync(path.join(dir, 'backend.yaml'), 'host: 0.0.0.0\nport: 45999\n');
  assert.equal(serviceConfigGet({ service: { backendConfigFile: 'backend.yaml' } }, dir).backendUrl, 'http://127.0.0.1:45999');
  assert.equal(
    serviceConfigGet({ service: { backendConfigFile: 'backend.yaml', backend: 'http://10.0.0.2:1/' } }, dir).backendUrl,
    'http://10.0.0.2:1',
  );
  // no file yet: the backend's own defaults
  assert.equal(serviceConfigGet({ service: { backendConfigFile: 'none.yaml' } }, dir).backendUrl, `http://127.0.0.1:${SERVICE_BACKEND_PORT_DEFAULT}`);
  assert.equal(serviceConfigGet({ service: { backend: 'http://127.0.0.1:2' } }, dir).isLaunch, false);
  assert.throws(() => serviceConfigGet({ service: { backend: 'http://127.0.0.1:2', launch: true } }, dir), /launch needs/);
  assert.throws(() => serviceConfigGet({ service: {} }, dir), /must be/);
});
