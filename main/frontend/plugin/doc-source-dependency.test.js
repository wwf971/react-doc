import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { docSourceDependenciesCollect } from './doc-source-dependency.ts';
import { pruneSourceToSidePanel } from './doc-source.ts';

const F = '```';
const configDoc = {
  compRegistry: {
    BlockMdx: 'common/BlockMdx',
    FileTree: 'common/FileTree',
    Index: 'common/Index',
    SourceLink: 'specific/SourceLink',
  },
};

function targetListGet(text, ext = 'md') {
  return docSourceDependenciesCollect(text, { internalPath: '~docs/page.md', ext }, configDoc)
    .dependencyList
    .map((dependency) => [dependency.kind, dependency.target]);
}

test('collects links, inline-links, images, inline code, and wiki links', () => {
  assert.deepEqual(targetListGet([
    '[a](./a.md) [s](~docs/run.ps1 "inline-link") [r](~docs/b.mdx "inline-link:render")',
    '![i](./i.png) `c.md` [[d.md]]',
  ].join('\n')), [
    ['document', './a.md'],
    ['source', '~docs/run.ps1'],
    ['source', '~docs/b.mdx'],
    ['asset', './i.png'],
    ['document', 'c.md'],
    ['document', 'd.md'],
  ]);
});

test('external urls, fragments, and side-panel item targets are ignored', () => {
  assert.deepEqual(targetListGet('[x](https://example.com/a.md) [y](#part) [z](@first/item-id)'), []);
});

test('collects nested BlockMdx Markdown, SourceLink, Index, and dataRef targets', () => {
  assert.deepEqual(targetListGet([
    '<!--renderComp=BlockMdx,title=Note-->',
    `${F}md`,
    'run [setup](~docs/setup.ps1 "inline-link")',
    F,
    '',
    '<!--renderComp=SourceLink-->',
    F,
    '~docs/config.yaml',
    F,
    '',
    '<!--renderComp=FileTree,dataRef=tree.md#project-->',
    `${F}yaml`,
    'tree: []',
    F,
    '',
    '<!--renderComp=Index-->',
    `${F}yaml`,
    'type: title-subtopics-items',
    'title: Guide',
    'subtopics:',
    '  - title: Start',
    '    items:',
    '      - { title: Install, target: install.md }',
    '      - { title: Script, kind: inline-link, target: ~docs/install.sh }',
    F,
  ].join('\n')), [
    ['source', '~docs/setup.ps1'],
    ['source', '~docs/config.yaml'],
    ['document', 'tree.md'],
    ['document', 'install.md'],
    ['source', '~docs/install.sh'],
  ]);
});

test('mdx: static attributes reach extractors, expressions are reported', () => {
  const result = docSourceDependenciesCollect(
    '<SourceLink target="~docs/a.ps1" />\n\n<SourceLink target={path} />\n\n<Callout>see [b](b.md)</Callout>\n',
    { internalPath: '~docs/page.mdx', ext: 'mdx' },
    configDoc,
  );
  assert.deepEqual(
    result.dependencyList.map((dependency) => [dependency.kind, dependency.target]),
    [['source', '~docs/a.ps1'], ['document', 'b.md']],
  );
  assert.equal(result.warningList.length, 1);
  assert.match(result.warningList[0], /<SourceLink> attribute target is an expression/);
});

test('a consumer extractor retains its static target', () => {
  const result = docSourceDependenciesCollect(
    `<!--renderComp=Chart,file=~docs/data.csv-->\n${F}\n${F}\n`,
    { internalPath: '~docs/page.md', ext: 'md' },
    { compRegistry: { Chart: 'app/Chart' } },
    { 'app/Chart': (data, context) => context.dependencyAdd(data.file, 'source') },
  );
  assert.deepEqual(result.dependencyList.map((dependency) => dependency.target), ['~docs/data.csv']);
});

test('a block whose asset reference was not expanded does not reach its extractor', () => {
  const dataList = [];
  const extractor = { 'app/Table': (data, context) => { dataList.push(data); context.dependencyAdd('~docs/evidence.md', 'source'); } };
  const collect = (text) => docSourceDependenciesCollect(text, { internalPath: '~docs/page.md', ext: 'md' }, { compRegistry: { Table: 'app/Table' } }, extractor);
  // the item is missing: the fence is still the reference, which is no data of the component
  const missing = collect(`<!--renderComp=Table-->\n${F}asset\nstore: local\nname: login test cases\n${F}\n`);
  assert.equal(dataList.length, 0);
  assert.deepEqual(missing.dependencyList, []);
  assert.equal(missing.warningList.length, 1);
  assert.match(missing.warningList[0], /Table: the asset login test cases is not in the store/);
  // expanded (the store had it): the data reaches the extractor, and what it names is retained
  const expanded = collect(`<!--renderComp=Table-->\n${F}yaml\ntype: table\n${F}\n`);
  assert.equal(dataList.length, 1);
  assert.equal(dataList[0].lang, 'yaml');
  assert.deepEqual(expanded.dependencyList.map((dependency) => dependency.target), ['~docs/evidence.md']);
  assert.deepEqual(expanded.warningList, []);
});

test('an attachment url is written once, every key of its file naming it', async () => {
  const { fileUrlByPathCodeBuild } = await import('./doc-source.ts');
  const lineList = fileUrlByPathCodeBuild([
    { absPath: '/d/a.png', referenceList: ['./img/a.png', 'img/a.png', '~docs/img/a.png'] },
    { absPath: '/d/b.png', referenceList: ['~docs/b.png', 'img/a.png'] },
  ], (absPath) => `data:image/png;base64,${absPath}`);
  const code = lineList.join('\n');
  assert.equal(code.split('data:image/png;base64,/d/a.png').length - 1, 1);
  const fileUrlByPath = new Function(`${code.replace('export const', 'const')}\nreturn fileUrlByPath;`)();
  assert.deepEqual(fileUrlByPath, {
    'img/a.png': 'data:image/png;base64,/d/b.png', // a key two files claim: the later one, as before
    '~docs/img/a.png': 'data:image/png;base64,/d/a.png',
    '~docs/b.png': 'data:image/png;base64,/d/b.png',
  });
  assert.equal(fileUrlByPathCodeBuild([], () => '').join('\n'), 'export const fileUrlByPath = {};');
});

// ---------- pruning ----------

function sourceBuild(fileByRelPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-source-prune-'));
  return Object.entries(fileByRelPath).map(([relPath, text]) => {
    const absPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, text);
    const name = path.basename(relPath);
    return {
      docPageAlias: '',
      rootAlias: 'docs',
      relPath,
      name,
      ext: path.extname(name).slice(1),
      absPath,
      internalPath: `~docs/${relPath}`,
    };
  });
}

function prunedPathListGet(entryList, tree) {
  return pruneSourceToSidePanel({ ...configDoc, sidePanel: { tree } }, entryList)
    .map((entry) => entry.internalPath);
}

test('pruning keeps side-panel documents and what they reach, recursively, in source order', (context) => {
  context.mock.method(console, 'warn', () => {});
  const entryList = sourceBuild({
    'unused.md': '# Unused',
    'guide/c.md': 'back to [start](../start.md)',
    'guide/b.md': '[next](./c.md) and [render](~docs/guide/d.mdx "inline-link:render")',
    'guide/d.mdx': 'rendered',
    'scripts/run.ps1': 'Write-Host hi',
    'start.md': '[b](guide/b.md) [run](~docs/scripts/run.ps1 "inline-link:source")',
  });
  assert.deepEqual(prunedPathListGet(entryList, [{ doc: 'start.md' }]), [
    '~docs/guide/c.md',
    '~docs/guide/b.md',
    '~docs/guide/d.mdx',
    '~docs/scripts/run.ps1',
    '~docs/start.md',
  ]);
});

test('pruning keeps a nested BlockMdx source link without sourceDependencies', () => {
  const entryList = sourceBuild({
    'page.md': `<!--renderComp=BlockMdx-->\n${F}md\n[cfg](~docs/cfg.yaml "inline-link")\n${F}\n`,
    'cfg.yaml': 'a: 1',
    'other.yaml': 'b: 2',
  });
  assert.deepEqual(prunedPathListGet(entryList, [{ doc: 'page.md' }]), ['~docs/page.md', '~docs/cfg.yaml']);
});

test('a file reached by a retained document survives even if its own item was excluded', () => {
  const entryList = sourceBuild({
    'a.md': '[b](b.md)',
    'b.md': '# B',
  });
  // the excluded item for b.md is already gone from the tree
  assert.deepEqual(prunedPathListGet(entryList, [{ doc: 'a.md' }]), ['~docs/a.md', '~docs/b.md']);
});

test('an unresolved local target is reported', (context) => {
  const warn = context.mock.method(console, 'warn', () => {});
  const entryList = sourceBuild({
    'a.md': '[gone](./gone.md) [script](scripts/run.ps1 "inline-link")',
  });
  assert.deepEqual(prunedPathListGet(entryList, [{ doc: 'a.md' }]), ['~docs/a.md']);
  const messageList = warn.mock.calls.map((call) => call.arguments[0]);
  assert.ok(messageList.some((message) => /~docs\/a\.md: link "\.\/gone\.md" is not in the collected source/.test(message)));
  assert.ok(messageList.some((message) => /"scripts\/run\.ps1" is not a source path/.test(message)));
});

test('legacy sourceDependencies are still retained, with a deprecation warning', (context) => {
  const warn = context.mock.method(console, 'warn', () => {});
  const entryList = sourceBuild({
    'a.md': '# A',
    'extra.txt': 'x',
  });
  assert.deepEqual(
    prunedPathListGet(entryList, [{ id: 'a', doc: 'a.md', sourceDependencies: ['~docs/extra.txt'] }]),
    ['~docs/a.md', '~docs/extra.txt'],
  );
  assert.match(warn.mock.calls[0].arguments[0], /sourceDependencies is deprecated/);
});

// ---------- where a reference is written ----------

test('a reference records its line, its block, the headings above it and the text around it', () => {
  const { dependencyList } = docSourceDependenciesCollect([
    '---',
    'title: Page',
    '---',
    '# Guide',
    '',
    'Intro text.',
    '',
    '## Setup',
    '',
    '### Install',
    '',
    'First read [the model](a.md#Model) carefully, then continue with the rest of this sentence.',
    '',
    '## Usage',
    '',
    '- a list item mentioning `b.md` inline',
    '- and [[c.md]] as a wiki link',
    '',
    '![diagram](./d.png)',
  ].join('\n'), { internalPath: '~docs/page.md', ext: 'md' }, configDoc);
  assert.deepEqual(dependencyList.map((dependency) => ({
    target: dependency.target,
    sourceLine: dependency.sourceLine,
    blockLine: dependency.blockLine,
    headingTrail: dependency.headingTrail,
    context: dependency.context,
  })), [
    {
      target: 'a.md#Model',
      sourceLine: 9,
      blockLine: 9,
      headingTrail: ['Guide', 'Setup', 'Install'],
      context: { before: 'First read ', label: 'the model', after: ' carefully, then continue with the rest of this sentence.' },
    },
    {
      target: 'b.md',
      sourceLine: 13,
      blockLine: 13,
      headingTrail: ['Guide', 'Usage'],
      context: { before: 'a list item mentioning ', label: 'b.md', after: ' inline' },
    },
    {
      target: 'c.md',
      sourceLine: 14,
      blockLine: 13,
      headingTrail: ['Guide', 'Usage'],
      context: { before: 'and ', label: '[[c.md]]', after: ' as a wiki link' },
    },
    {
      target: './d.png',
      sourceLine: 16,
      blockLine: 16,
      headingTrail: ['Guide', 'Usage'],
      context: { before: '', label: 'diagram', after: '' },
    },
  ]);
});

test('a long sentence is clipped around the reference at word boundaries', () => {
  const before = 'word '.repeat(30).trim();
  const after = 'tail '.repeat(30).trim();
  const { dependencyList } = docSourceDependenciesCollect(
    `${before} [link](a.md) ${after}`,
    { internalPath: '~docs/page.md', ext: 'md' },
    configDoc,
  );
  const { context } = dependencyList[0];
  assert.ok(context.before.startsWith('…word '), context.before);
  assert.ok(context.before.length <= 50, String(context.before.length));
  assert.ok(context.after.endsWith(' tail…'), context.after);
  assert.ok(context.after.length <= 74, String(context.after.length));
});

test('a reference of component data is written at the block, without a line, under the block\'s headings', () => {
  const { dependencyList } = docSourceDependenciesCollect([
    '# Top',
    '',
    '## Notes',
    '',
    '<!--renderComp=BlockMdx,title=Note-->',
    `${F}md`,
    'see [the setup](setup.md) here',
    F,
    '',
    '<!--renderComp=FileTree,dataRef=tree.md#project-->',
    `${F}yaml`,
    'tree: []',
    F,
  ].join('\n'), { internalPath: '~docs/page.md', ext: 'md' }, configDoc);
  assert.deepEqual(dependencyList.map((dependency) => ({
    target: dependency.target,
    construct: dependency.construct,
    sourceLine: dependency.sourceLine,
    blockLine: dependency.blockLine,
    headingTrail: dependency.headingTrail,
    context: dependency.context,
  })), [
    {
      target: 'setup.md',
      construct: 'BlockMdx',
      sourceLine: undefined,
      blockLine: 5,
      headingTrail: ['Top', 'Notes'],
      context: { before: 'see ', label: 'the setup', after: ' here' },
    },
    {
      target: 'tree.md',
      construct: 'dataRef of FileTree',
      sourceLine: undefined,
      blockLine: 10,
      headingTrail: ['Top', 'Notes'],
      context: undefined,
    },
  ]);
});

test('an mdx element at the root is its own block; a link in a heading is under that heading', () => {
  const { dependencyList } = docSourceDependenciesCollect(
    '# A [link](a.md)\n\n<SourceLink target="~docs/a.ps1" />\n',
    { internalPath: '~docs/page.mdx', ext: 'mdx' },
    configDoc,
  );
  assert.deepEqual(dependencyList.map((dependency) => [dependency.target, dependency.sourceLine, dependency.blockLine, dependency.headingTrail]), [
    ['a.md', 1, 1, ['A link']],
    ['~docs/a.ps1', undefined, 3, ['A link']],
  ]);
});
