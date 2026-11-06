import assert from 'node:assert/strict';
import test from 'node:test';
import { docBuildFontSlim, docBuildShikiListFilter, docBuildUsageRead } from './doc-build-slim.js';

// what a build of one file leaves out (doc_page_impl_cli.md#one-file)

test('the text of a build says what it needs', () => {
  const usage = docBuildUsageRead(['# a\n\n```yaml\na: 1\n```\n\n> ~~~ts\n'], {});
  assert.equal(usage.isMermaidUsed, false);
  assert.equal(usage.isUniverUsed, false);
  assert.deepEqual([...usage.langSet].sort(), ['ts', 'yaml']);
});

test('a library is kept by its name anywhere, or by a name of its own in the registry', () => {
  assert.equal(docBuildUsageRead(['<!--renderComp=DiagramMermaid-->'], {}).isMermaidUsed, true);
  assert.equal(docBuildUsageRead(['```mermaid\nflowchart LR\n```'], {}).isMermaidUsed, true);
  assert.equal(docBuildUsageRead(['<!--renderComp=DocDiagramMermaid-->'], {}).isMermaidUsed, true);
  assert.equal(docBuildUsageRead(['{"component":{"name":"ExcelUniver"}}'], {}).isUniverUsed, true);
  assert.equal(docBuildUsageRead(['<!--renderComp=Flow-->'], { Flow: 'common/DiagramMermaid' }).isMermaidUsed, true);
  assert.equal(docBuildUsageRead(['<!--renderComp=Book-->'], { Book: 'common/ExcelUniver' }).isUniverUsed, true);
  assert.equal(docBuildUsageRead(['universal'], {}).isUniverUsed, true, 'on the safe side: a word starting like it keeps it');
  assert.equal(docBuildUsageRead(['nothing here'], { Flow: 'common/DiagramMermaid' }).isMermaidUsed, false);
});

const LIST = `const list = [
\t{
\t\t"id": "abap",
\t\t"name": "ABAP",
\t\t"import": (() => import("@shikijs/langs/abap"))
\t},
\t{
\t\t"id": "shellscript",
\t\t"name": "Shell",
\t\t"aliases": ["bash", "sh"],
\t\t"import": (() => import("@shikijs/langs/shellscript"))
\t},
\t{
\t\t"id": "yaml",
\t\t"name": "YAML",
\t\t"import": (() => import("@shikijs/langs/yaml"))
\t}
];
`;

test('a list of shiki keeps what is named by its id or an alias', () => {
  const keep = new Set(['sh', 'yaml']);
  const result = docBuildShikiListFilter(LIST, (id, aliasList) => keep.has(id) || aliasList.some((alias) => keep.has(alias)));
  assert.equal(result.countAll, 3);
  assert.equal(result.countKept, 2);
  assert.ok(!result.code.includes('abap'));
  assert.ok(result.code.includes('@shikijs/langs/shellscript'));
  assert.ok(result.code.includes('@shikijs/langs/yaml'));
  // still a list a program can read
  const list = new Function(`${result.code.replace(/import\("[^"]+"\)/g, 'null')}; return list;`)();
  assert.deepEqual(list.map((item) => item.id), ['shellscript', 'yaml']);
});

test('a source of another shape stays as it is', () => {
  const result = docBuildShikiListFilter('export const a = 1;\n', () => false);
  assert.equal(result.code, 'export const a = 1;\n');
  assert.equal(result.countAll, 0);
});

test('a font keeps its woff2 only', () => {
  const css = '@font-face{font-family:K;src:url(data:font/woff2;base64,AAA)format("woff2"),url(data:font/woff;base64,BBB)format("woff"),url(data:font/ttf;base64,CCC)format("truetype")}';
  assert.equal(docBuildFontSlim(css), '@font-face{font-family:K;src:url(data:font/woff2;base64,AAA)format("woff2")}');
  const cssOther = '@font-face{src:url(data:font/ttf;base64,CCC)format("truetype")}';
  assert.equal(docBuildFontSlim(cssOther), cssOther);
});
