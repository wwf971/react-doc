import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DocCliError, docBuildOneFileWrite, docCliRun, docInit, docLaunchBuild, docMountRead, docTargetRead } from './doc-cli.js';
import { docPackageRead } from '../plugin/doc-package.ts';
import { docSourcePlugin, loadConfigDoc } from '../plugin/doc-source.ts';
import { assetConfigOfDocPageListGet, assetStoreCreate } from '../plugin/doc-asset-store.ts';
import { docMigrate } from './doc-migrate.js';

// the command line of the package (doc_page_impl_cli.md): what `init`
// writes is loaded by the page itself, so a scaffold that drifts from the
// conventions fails here

function dirTempCreate() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doc-cli-'));
}

// the plugin serving a config.yaml written in dir
function pluginCreate(dir, configText) {
  fs.writeFileSync(path.join(dir, 'config.yaml'), configText);
  const plugin = docSourcePlugin({ configFile: path.join(dir, 'config.yaml') });
  plugin.configResolved({ command: 'serve', root: dir, base: '/' });
  return plugin;
}

test('init workspace: .doc-workspace/workspace.yaml and a first doc page, served by the folder alone', (context) => {
  const dir = dirTempCreate();
  const result = docInit('workspace', 'notes', { cwd: dir, title: 'Team: Notes' });
  assert.deepEqual(result.written.map((file) => file.split(path.sep).join('/')), [
    '.doc-workspace/.gitignore',
    '.doc-workspace/workspace.yaml',
    'guide/.doc-page/.gitignore',
    'guide/.doc-page/entry.yaml',
    'guide/.doc-page/side-panel.yaml',
    'guide/.doc-page/source.yaml',
    'guide/index.md',
  ]);
  // the root of the workspace shows the doc page only
  assert.deepEqual(fs.readdirSync(path.join(dir, 'notes')).sort(), ['.doc-workspace', 'guide']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'notes', 'guide')).sort(), ['.doc-page', 'index.md']);
  // no managed folder: the first item put in one makes it
  assert.deepEqual(fs.readdirSync(path.join(dir, 'notes', 'guide', '.doc-page')).sort(), ['.gitignore', 'entry.yaml', 'side-panel.yaml', 'source.yaml']);
  // a title that is not a plain yaml scalar is quoted
  assert.match(fs.readFileSync(path.join(dir, 'notes/.doc-workspace/workspace.yaml'), 'utf-8'), /^title: "Team: Notes"$/m);

  const warnList = [];
  context.mock.method(console, 'warn', (text) => warnList.push(String(text)));
  const plugin = pluginCreate(dir, 'workspace:\n  dir: ./notes\n');
  const code = plugin.load('\0virtual:doc-source');
  assert.ok(code.includes('~guide:guide/index.md'));
  assert.ok(!code.includes('comp.yaml'));
  assert.deepEqual(warnList, []);
});

test('init page: alias from the folder or --alias; a folder that is not empty is refused, --force adds the missing files', () => {
  const dir = dirTempCreate();
  const result = docInit('page', 'my-notes', { cwd: dir });
  assert.equal(result.valueByName.alias, 'my-notes');
  assert.equal(result.valueByName.title, 'My Notes');
  const entryText = fs.readFileSync(path.join(dir, 'my-notes/.doc-page/entry.yaml'), 'utf-8');
  assert.match(entryText, /^ {2}title: My Notes$/m);
  assert.match(entryText, /^ {2}homeDoc: ~my-notes\/index.md$/m);

  assert.throws(() => docInit('page', 'my-notes', { cwd: dir }), (error) => error instanceof DocCliError && /is not empty/.test(error.message));
  fs.rmSync(path.join(dir, 'my-notes/.doc-page/side-panel.yaml'));
  fs.writeFileSync(path.join(dir, 'my-notes/index.md'), '# mine\n');
  const resultForce = docInit('page', 'my-notes', { cwd: dir, force: true });
  assert.deepEqual(resultForce.written, [path.join('.doc-page', 'side-panel.yaml')]);
  assert.equal(fs.readFileSync(path.join(dir, 'my-notes/index.md'), 'utf-8'), '# mine\n');

  assert.throws(() => docInit('page', 'x', { cwd: dir, alias: 'two words' }), /must be one word/);
  assert.equal(docInit('page', 'other', { cwd: dir, alias: 'guide' }).valueByName.alias, 'guide');
});

test('--folder-empty writes the managed folders, with what the scaffold has in them; they load as they are', () => {
  const dir = dirTempCreate();
  const result = docInit('page', 'full', { cwd: dir, 'folder-empty': true });
  const writtenList = result.written.map((file) => file.split(path.sep).join('/'));
  assert.ok(writtenList.includes('.doc-page/comp-mdx/comp.yaml'));
  for (const name of ['asset', 'service-template-app', 'service-template-infra', 'service-app', 'service-infra']) {
    assert.ok(writtenList.includes(`.doc-page/${name}/`), name);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'full', '.doc-page', name)), []);
  }
  const plugin = pluginCreate(dir, 'docEntry:\n  dir: ./full\n');
  assert.ok(plugin.load('\0virtual:doc-source').includes('~full:full/index.md'));
  // the package: its content folders
  docInit('package', 'kit', { cwd: dir, 'folder-empty': true });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'kit')).sort(), ['.doc-page', 'comp-mdx', 'doc', 'doc-package.yaml', 'package.json', 'service-template-app', 'service-template-infra']);
});

test('init package: the fixed layout, read by the package loader', () => {
  const dir = dirTempCreate();
  docInit('package', 'chart-kit', { cwd: dir });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'chart-kit')).sort(), ['.doc-page', 'doc', 'doc-package.yaml', 'package.json']);
  const loaded = docPackageRead(path.join(dir, 'chart-kit'), 'test');
  assert.equal(loaded.name, 'chart-kit');
  assert.ok(fs.existsSync(path.join(dir, 'chart-kit/doc/README.md')));
  assert.throws(() => docInit('package', 'Chart_Kit', { cwd: dir }), /must be lowercase letters/);
});

test('the command line: help, an unknown command or kind, and the report of what was written', () => {
  const dir = dirTempCreate();
  const lineList = [];
  const out = (text) => lineList.push(text);
  assert.equal(docCliRun([], { out }), 0);
  assert.match(lineList[0], /^react-doc: create and serve/);
  assert.throws(() => docCliRun(['make', 'page', 'x'], { out }), /unknown command "make"/);
  assert.throws(() => docCliRun(['init', 'site', 'x'], { out }), /unknown kind "site"/);
  assert.throws(() => docCliRun(['init', 'page'], { out }), /the folder to create is missing/);
  lineList.length = 0;
  docCliRun(['init', 'workspace', 'ws', '--page', 'home'], { out, cwd: dir });
  assert.equal(lineList[0], `created a workspace in ${path.join(dir, 'ws')}`);
  assert.ok(lineList.includes(`  written  ${path.join('home', 'index.md')}`));
  assert.ok(lineList.includes(`  serve it: react-doc dev ${path.join(dir, "ws")}`));
});

// ---------- dev: what a path is, the launch layer, read-only ----------

function packageDocPageCreate(dir, name = 'kit') {
  docInit('package', name, { cwd: dir });
  const packageDir = path.join(dir, name);
  // an asset of the package, for the refusals below
  const objectDir = path.join(packageDir, '.doc-page', 'asset', 'w55rlprcjdy--shown');
  fs.mkdirSync(objectDir, { recursive: true });
  fs.writeFileSync(path.join(objectDir, 'w55rlpr1111.txt'), 'shown');
  fs.writeFileSync(path.join(objectDir, 'item.yaml'), `itemId: w55rlprcjdy
name: shown
lang: text
contentType: text/plain
fileExt: txt
versionIdHead: w55rlpr1111
isDeleted: false
isLocked: false
timeCreated: "2026-01-01"
versionList:
  - { versionId: w55rlpr1111, versionIdPrevList: [], time: "2026-01-01", note: "", size: 5, hash: x, isLocked: false, dependencyList: [] }
eventList: []
`);
  return packageDir;
}

test('dev: a path says what it is; a folder holding two kinds asks', () => {
  const dir = dirTempCreate();
  docInit('page', 'notes', { cwd: dir });
  docInit('workspace', 'team', { cwd: dir });
  const packageDir = packageDocPageCreate(dir);
  assert.equal(docTargetRead(path.join(dir, 'notes')).kind, 'page');
  assert.equal(docTargetRead(path.join(dir, 'team')).kind, 'workspace');
  assert.equal(docTargetRead(packageDir).kind, 'package');
  assert.equal(docTargetRead(path.join(dir, 'notes', '.doc-page', 'entry.yaml')).kind, 'page');
  assert.equal(docTargetRead(path.join(dir, 'team', '.doc-workspace', 'workspace.yaml')).kind, 'workspace');
  assert.throws(() => docTargetRead(path.join(dir, 'nothing')), /nothing at/);
  fs.mkdirSync(path.join(dir, 'plain'));
  assert.throws(() => docTargetRead(path.join(dir, 'plain')), /neither a doc page/);
  fs.mkdirSync(path.join(dir, 'notes', '.doc-workspace'));
  fs.writeFileSync(path.join(dir, 'notes', '.doc-workspace', 'workspace.yaml'), 'docPageList: [{ dir: .. }]\n');
  assert.throws(() => docTargetRead(path.join(dir, 'notes')), /say which with --kind/);
  assert.equal(docTargetRead(path.join(dir, 'notes'), 'page').kind, 'page');
  assert.throws(() => docTargetRead(path.join(dir, 'team'), 'package'), /holds no package/);
});

test('dev: the launch layer names the target and where to find packages and a backend', () => {
  const dir = dirTempCreate();
  docInit('page', 'notes', { cwd: dir });
  docInit('workspace', 'team', { cwd: dir });
  const packageDir = packageDocPageCreate(dir);
  const layout = { mode: 'source', dirPackage: path.join(dir, 'shipped') };
  const launchPage = docLaunchBuild('notes', { cwd: dir, package: [packageDir, 'other'], 'package-dir': ['more'] }, layout);
  assert.equal(launchPage.kind, 'page');
  assert.deepEqual(launchPage.docEntry, { dir: path.join(dir, 'notes') });
  assert.deepEqual(launchPage.packageList, [{ dir: packageDir }, { name: 'other' }]);
  assert.deepEqual(launchPage.packageSearchDirList, [path.join(dir, 'more'), path.join(dir, 'shipped')]);
  assert.equal(launchPage.backendConfigFile, undefined, 'no backend unless the doc page keeps a config for one');
  assert.deepEqual(docLaunchBuild('team', { cwd: dir }, layout).workspace, { dir: path.join(dir, 'team') });
  assert.throws(() => docLaunchBuild('team', { cwd: dir, package: [packageDir] }, layout), /--package is for a doc page/);
  assert.throws(() => docLaunchBuild('notes', { cwd: dir, package: ['/no/such'] }, layout), /no package there/);
  fs.writeFileSync(path.join(dir, 'notes', '.doc-page', 'service-backend.yaml'), 'host: 127.0.0.1\nport: 1\n');
  assert.equal(docLaunchBuild('notes', { cwd: dir }, layout).backendConfigFile, path.join(dir, 'notes', '.doc-page', 'service-backend.yaml'));
  assert.equal(docLaunchBuild('notes', { cwd: dir, 'no-backend': true }, layout).backendConfigFile, undefined);
  assert.throws(() => docLaunchBuild('notes', { cwd: dir, backend: 'x', 'no-backend': true }, layout), /exclude each other/);
});

test('the launch layer over config.yaml: a virtual workspace, the file\'s workspace and backend left out', () => {
  const dir = dirTempCreate();
  docInit('page', 'notes', { cwd: dir });
  const configFile = path.join(dir, 'config.yaml');
  fs.writeFileSync(configFile, 'workspace: { dir: ./elsewhere }\nservice: { backendConfigFile: ./none.yaml }\n');
  const launch = { kind: 'page', target: path.join(dir, 'notes'), mode: 'source', command: 'react-doc dev notes', docEntry: { dir: path.join(dir, 'notes') } };
  const configDoc = loadConfigDoc(configFile, { launch });
  assert.equal(configDoc.workspace.isVirtual, true);
  assert.deepEqual(configDoc.workspace.launch, { kind: 'page', target: path.join(dir, 'notes'), mode: 'source', command: 'react-doc dev notes' });
  assert.equal(configDoc.service, undefined);
});

test('dev --mount: what a value says, and what it refuses', () => {
  const dir = dirTempCreate();
  docInit('page', 'notes', { cwd: dir });
  docInit('workspace', 'team', { cwd: dir });
  const packageDir = packageDocPageCreate(dir);
  const entryFile = path.join(dir, 'notes', '.doc-page', 'entry.yaml');
  assert.deepEqual(docMountRead('notes', dir), { dir: path.join(dir, 'notes') });
  assert.deepEqual(docMountRead('notes/.doc-page/entry.yaml', dir), { file: entryFile });
  assert.deepEqual(docMountRead(packageDir, dir), { dir: packageDir });
  assert.deepEqual(docMountRead('notes,alias=n,side-panel=dev', dir), { dir: path.join(dir, 'notes'), alias: 'n', sidePanel: 'dev' });
  // a comma in a path that is there is part of the path
  fs.cpSync(path.join(dir, 'notes'), path.join(dir, 'a,b'), { recursive: true });
  assert.deepEqual(docMountRead('a,b', dir), { dir: path.join(dir, 'a,b') });
  assert.deepEqual(docMountRead('a,b,alias=n', dir), { dir: path.join(dir, 'a,b'), alias: 'n' });
  assert.throws(() => docMountRead('notes,alais=n', dir), /"alais=n" is not one of alias=<value>, side-panel=<value>/);
  assert.throws(() => docMountRead('notes,alias=', dir), /is not one of/);
  assert.throws(() => docMountRead('notes,alias=a,alias=b', dir), /alias is given twice/);
  assert.throws(() => docMountRead('notes,alias=two words', dir), /is not one word/);
  assert.throws(() => docMountRead('/no/such,alias=n', dir), /--mount .*nothing at \/no\/such/);
  assert.throws(() => docMountRead('team', dir), /holds no page \(it holds: workspace\)/);
  const layout = { mode: 'source', dirPackage: path.join(dir, 'shipped') };
  const launch = docLaunchBuild('team', { cwd: dir, mount: ['notes', `${packageDir},alias=kit`] }, layout);
  assert.deepEqual(launch.mountList, [{ dir: path.join(dir, 'notes') }, { dir: packageDir, alias: 'kit' }]);
  assert.match(launch.command, /^react-doc dev team --mount notes --mount /);
  assert.equal(docLaunchBuild('notes', { cwd: dir }, layout).mountList, undefined);
});

test('the mounts of the launch layer: temporary doc pages after those written, taken once', () => {
  const dir = dirTempCreate();
  docInit('workspace', 'team', { cwd: dir });
  docInit('page', 'notes', { cwd: dir });
  const packageDir = packageDocPageCreate(dir);
  const configFile = path.join(dir, 'config.yaml');
  fs.writeFileSync(configFile, '{}\n');
  const layerGet = (mountText) => docLaunchBuild('team', { cwd: dir, mount: mountText }, { mode: 'source', dirPackage: path.join(dir, 'shipped') });
  const launch = layerGet(['notes,alias=n', packageDir]);
  for (let index = 0; index < 2; index += 1) {
    const list = loadConfigDoc(configFile, { launch }).docEntry.docPageList;
    assert.deepEqual(list.map((docPage) => [docPage.alias, docPage.isTemporary]), [['guide', false], ['n', true], [path.basename(packageDir), true]]);
    assert.equal(list[2].isReadOnly, true, 'a package stays read-only when mounted');
  }
  // what it refuses is a reason to stop, naming the mount
  const refusedGet = (mountText) => {
    const configFileOther = path.join(fs.mkdtempSync(path.join(dir, 'config-')), 'config.yaml');
    fs.writeFileSync(configFileOther, '{}\n');
    return () => loadConfigDoc(configFileOther, { launch: layerGet(mountText) });
  };
  assert.throws(refusedGet(['team/guide']), /a temporary mount .*holds already/);
  assert.throws(refusedGet(['notes,alias=guide']), /a temporary mount .*the alias "guide" names the doc page/);
  assert.throws(refusedGet(['notes', 'notes,alias=other']), /a temporary mount .*holds already/);
});

test('a doc page names a package; it is found in the search folders, then in node_modules', () => {
  const dir = dirTempCreate();
  docInit('page', 'notes', { cwd: dir });
  const shelf = path.join(dir, 'shelf');
  fs.mkdirSync(shelf);
  packageDocPageCreate(shelf, 'kit');
  fs.appendFileSync(path.join(dir, 'notes', '.doc-page', 'entry.yaml'), '\npackageList:\n  - name: kit\n');
  const configFile = path.join(dir, 'config.yaml');
  fs.writeFileSync(configFile, 'docEntry: { dir: ./notes }\n');
  assert.throws(() => loadConfigDoc(configFile), /no package named "kit"/);
  fs.writeFileSync(configFile, 'docEntry: { dir: ./notes }\npackageSearchDirList: [./shelf]\n');
  assert.deepEqual(loadConfigDoc(configFile).packageList.map((item) => [item.name, item.isWorkspaceNamed]), [['kit', true]]);
  fs.writeFileSync(configFile, 'docEntry: { dir: ./notes }\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.renameSync(path.join(shelf, 'kit'), path.join(dir, 'node_modules', 'kit'));
  assert.deepEqual(loadConfigDoc(configFile).packageList.map((item) => item.name), ['kit']);
});

test('a package as a doc page: annotated, imported by being there, and read-only in its store', () => {
  const dir = dirTempCreate();
  const packageDir = packageDocPageCreate(dir);
  docInit('page', 'notes', { cwd: dir });
  const configFile = path.join(dir, 'config.yaml');
  fs.writeFileSync(configFile, `workspace:
  docPageList:
    - { dir: ./notes }
    - { dir: ./kit }
`);
  const configDoc = loadConfigDoc(configFile);
  const docPage = configDoc.workspace.docPageList.find((item) => item.alias === 'kit');
  assert.equal(docPage.packageName, 'kit', 'it goes by the name of the package');
  assert.equal(docPage.isReadOnly, true);
  assert.equal(configDoc.workspace.docPageList.find((item) => item.alias === 'notes').isReadOnly, false);
  assert.deepEqual(configDoc.packageList.map((item) => item.name), ['kit']);
  assert.equal(configDoc.sidePanel.tree.find((node) => node.docPageSection?.alias === 'kit').docPageSection.packageName, 'kit');
  // the store refuses every write into its folder, whichever way it comes
  const docPageList = configDoc.docEntry.docPageList;
  const rootAbsPathByPath = new Map(docPageList.flatMap((item) => item.rootList.map((root) => [`~${item.alias}:${root.alias}`, root.pathAbs ?? path.resolve(path.dirname(item.entryFile), root.path ?? '..')])));
  const store = assetStoreCreate(assetConfigOfDocPageListGet(docPageList, rootAbsPathByPath, dir));
  const refused = (write) => assert.throws(write, (error) => error.code === -4 && /read-only/.test(error.message));
  const folderOfPackage = store.folderList.find((folder) => folder.isReadOnly);
  assert.ok(folderOfPackage, 'its asset folder is in the store, marked');
  assert.equal(store.itemGet('w55rlprcjdy').name, 'shown', 'it is read');
  refused(() => store.itemCreate({ name: 'new', data: Buffer.from('x'), folder: folderOfPackage.path }));
  refused(() => store.itemUpdate({ itemId: 'w55rlprcjdy', hashBase: 'x', data: Buffer.from('y') }));
  refused(() => store.itemDelete('w55rlprcjdy'));
  refused(() => store.itemMetaSet('w55rlprcjdy', { name: 'other' }));
  refused(() => store.itemLockSet('w55rlprcjdy', true));
  refused(() => store.folderSet({ configFile: store.config.docPageList.find((item) => item.isReadOnly).configFileRelative, folderList: [folderOfPackage.path] }, rootAbsPathByPath));
  // the doc page of plain content writes as before
  assert.equal(store.itemCreate({ name: 'mine', data: Buffer.from('x'), docPath: '~notes:notes/index.md' }).isCreated, true);
  // a package's entry names no folders of its own for what it has at its top
  fs.appendFileSync(path.join(packageDir, '.doc-page', 'entry.yaml'), '\ncomp: false\n');
  assert.throws(() => loadConfigDoc(configFile), /"comp" is not for a package treated as a doc page/);
});

test('build: where it may put what it makes', async () => {
  const dir = dirTempCreate();
  docInit('page', 'notes', { cwd: dir });
  const run = (...argList) => docCliRun(['build', ...argList], { cwd: dir, out: () => {} });
  await assert.rejects(() => run('notes'), (error) => error instanceof DocCliError && /--out/.test(error.message));
  await assert.rejects(() => run('notes', '--out', 'notes/page.html'), /inside what is being built/);
  await assert.rejects(() => run('notes', '--out', 'notes/.doc-page/site'), /inside what is being built/);
  fs.mkdirSync(path.join(dir, 'other'));
  fs.writeFileSync(path.join(dir, 'other/keep.txt'), 'mine');
  await assert.rejects(() => run('notes', '--out', 'other'), /not a build/);
  assert.equal(fs.readFileSync(path.join(dir, 'other/keep.txt'), 'utf-8'), 'mine');
  fs.rmSync(dir, { recursive: true });
});

test('build: one file holds the scripts and styles of a build, and refuses to lose one', () => {
  const dir = dirTempCreate();
  fs.mkdirSync(path.join(dir, 'assets'));
  const htmlText = '<html><head><link rel="stylesheet" crossorigin href="./assets/a.css"><link rel="modulepreload" href="./assets/m.js"><script type="module" crossorigin src="./assets/a.js"></script></head><body><div id="root"></div></body></html>';
  fs.writeFileSync(path.join(dir, 'index.html'), htmlText);
  fs.writeFileSync(path.join(dir, 'assets/a.css'), '@font-face{src:url(data:font/woff2;base64,A)format("woff2"),url(data:font/ttf;base64,B)format("truetype")}');
  fs.writeFileSync(path.join(dir, 'assets/a.js'), 'const text = "</script>";');
  const outPath = path.join(dir, 'out/page.html');
  docBuildOneFileWrite(dir, outPath, { isFontSlim: true });
  const html = fs.readFileSync(outPath, 'utf-8');
  assert.ok(html.includes('<style>@font-face{src:url(data:font/woff2;base64,A)format("woff2")}</style>'));
  assert.ok(html.includes('<script type="module">const text = "<\\/script>";</script>'));
  assert.ok(html.indexOf('<script') > html.indexOf('id="root"'), 'the script after the content of the body');
  assert.ok(!html.includes('modulepreload'));
  assert.ok(!html.includes('./assets/'));
  fs.writeFileSync(path.join(dir, 'assets/extra.png'), 'x');
  assert.throws(() => docBuildOneFileWrite(dir, outPath), /not put into the html/);
  fs.rmSync(dir, { recursive: true });
});

test('migrate: item.yaml and itemId, the fences of documents, and frontend objects in folders of their own', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-migrate-'));
  const dirMeta = path.join(dir, '.doc-page');
  const dirGroup = path.join(dirMeta, 'asset', 'w5aaaaaaaaa--Shelf');
  const itemFormerWrite = (dirItem, itemId, owner, text) => {
    fs.mkdirSync(dirItem, { recursive: true });
    fs.writeFileSync(path.join(dirItem, 'object.yaml'), [
      `objectId: ${itemId}`, 'name: ""', 'lang: yaml', 'contentType: text/yaml', 'fileExt: yaml',
      ...(owner ? ['owner:', `  ref: ${owner.ref}`, ...(owner.role ? [`  role: ${owner.role}`] : [])] : []),
      `versionIdHead: v${itemId}`, 'isDeleted: false', 'isLocked: false', 'timeCreated: 20261105_13012598+09',
      'versionList:', `  - versionId: v${itemId}`, '    versionIdPrevList: []', '    time: 20261105_13012598+09', '    note: ""', '    size: 1', '    hash: x', '    isLocked: false',
      '    dependencyList:', '      - { type: asset, objectId: w5ccccccccc }', 'eventList: []', '',
    ].join('\n'));
    fs.writeFileSync(path.join(dirItem, `v${itemId}.yaml`), text);
  };
  itemFormerWrite(path.join(dirGroup, 'w5aaaaaaaab'), 'w5aaaaaaaab', { ref: 'frontend:w5aaaaaaaaa', role: 'entry' }, 'name: Shelf\ntype: frontend.object\nassetList:\n  - { key: book-1, kind: book, objectId: w5aaaaaaaac }\n');
  itemFormerWrite(path.join(dirGroup, 'w5aaaaaaaac'), 'w5aaaaaaaac', { ref: 'frontend:w5aaaaaaaaa' }, 'objectId: mine\n');
  itemFormerWrite(path.join(dirMeta, 'asset', 'w5ccccccccc--alone'), 'w5ccccccccc', null, 'a: 1\n');
  fs.writeFileSync(path.join(dirMeta, 'object-frontend.yaml'), '# my types\ntypeList:\n  - { id: demo.a, label: A }\nobjectList:\n  - id: w5aaaaaaaaa\n    entry: w5aaaaaaaab\n');
  fs.writeFileSync(path.join(dir, 'doc.md'), 'objectId: prose\n\n<!--renderComp=Image-->\n```asset\r\nstore: local\r\nobjectId: w5ccccccccc\r\n```\r\n');

  const dry = await docMigrate(dir, { isDryRun: true });
  assert.equal(dry.itemList.length, 3);
  assert.ok(fs.existsSync(path.join(dirMeta, 'asset', 'w5ccccccccc--alone', 'object.yaml')), 'a dry run changes nothing');

  const report = await docMigrate(dir);
  assert.deepEqual([report.itemList.length, report.documentList.length, report.objectList.length, report.problemList.length], [3, 1, 1, 0]);
  const alone = fs.readFileSync(path.join(dirMeta, 'asset', 'w5ccccccccc--alone', 'item.yaml'), 'utf-8');
  assert.match(alone, /^itemId: w5ccccccccc/);
  assert.match(alone, /itemId: w5ccccccccc\n/);
  assert.ok(!alone.includes('objectId'));
  const dirObject = path.join(dirMeta, 'object-frontend', 'w5aaaaaaaaa--Shelf');
  assert.match(fs.readFileSync(path.join(dirObject, 'object.yaml'), 'utf-8'), /id: w5aaaaaaaaa\nentry: w5aaaaaaaab\n/);
  assert.match(fs.readFileSync(path.join(dirObject, 'item', 'w5aaaaaaaab', 'vw5aaaaaaaab.yaml'), 'utf-8'), /itemId: w5aaaaaaaac/);
  assert.equal(fs.readFileSync(path.join(dirObject, 'item', 'w5aaaaaaaac', 'vw5aaaaaaaac.yaml'), 'utf-8'), 'objectId: mine\n', 'the data of an asset is not touched');
  assert.equal(fs.existsSync(dirGroup), false);
  assert.equal(fs.readFileSync(path.join(dirMeta, 'type.yaml'), 'utf-8'), '# types of this doc page (doc_page_impl_type.md#declaring-a-type)\ntypeList:\n  - { id: demo.a, label: A }\n');
  assert.equal(fs.existsSync(path.join(dirMeta, 'object-frontend.yaml')), false, 'it held nothing else');
  assert.equal(fs.readFileSync(path.join(dir, 'doc.md'), 'utf-8'), 'objectId: prose\n\n<!--renderComp=Image-->\n```asset\r\nstore: local\r\nitemId: w5ccccccccc\r\n```\r\n');

  const again = await docMigrate(dir);
  assert.deepEqual([again.itemList.length, again.documentList.length, again.objectList.length, again.typeFileList.length], [0, 0, 0, 0]);
});
