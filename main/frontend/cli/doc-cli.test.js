import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DocCliError, docCliRun, docInit } from './doc-cli.js';
import { docPackageRead } from '../plugin/doc-package.ts';
import { docSourcePlugin } from '../plugin/doc-source.ts';

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
  assert.deepEqual(fs.readdirSync(path.join(dir, 'kit')).sort(), ['comp-mdx', 'doc', 'doc-package.yaml', 'package.json', 'service-template-app', 'service-template-infra']);
});

test('init package: the fixed layout, read by the package loader', () => {
  const dir = dirTempCreate();
  docInit('package', 'chart-kit', { cwd: dir });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'chart-kit')).sort(), ['doc', 'doc-package.yaml', 'package.json']);
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
  assert.match(lineList[0], /^react-doc: scaffold/);
  assert.throws(() => docCliRun(['make', 'page', 'x'], { out }), /unknown command "make"/);
  assert.throws(() => docCliRun(['init', 'site', 'x'], { out }), /unknown kind "site"/);
  assert.throws(() => docCliRun(['init', 'page'], { out }), /the folder to create is missing/);
  lineList.length = 0;
  docCliRun(['init', 'workspace', 'ws', '--page', 'home'], { out, cwd: dir });
  assert.equal(lineList[0], `created a workspace in ${path.join(dir, 'ws')}`);
  assert.ok(lineList.includes(`  written  ${path.join('home', 'index.md')}`));
  assert.ok(lineList.includes(`    workspace: { dir: ${path.join(dir, 'ws')} }`));
});
