import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { excludeMatcherBuild, excludePatternTextListRead } from './doc-source-exclude.ts';
import { docWorkspaceLoad } from './doc-entry.ts';

// the "exclude" of an addFolder rule, written like a .gitignore
// (doc_page_impl_source.md#excluding-files-and-folders)

const isExcluded = (patternList, relPath, isDir = false) => excludeMatcherBuild(patternList).isExcluded(relPath, isDir);

test('a name without "/" matches at any depth, files and folders', () => {
  assert.equal(isExcluded(['*.pyc'], 'a.pyc'), true);
  assert.equal(isExcluded(['*.pyc'], 'x/y/a.pyc'), true);
  assert.equal(isExcluded(['*.pyc'], 'a.py'), false);
  assert.equal(isExcluded(['draft'], 'x/draft', true), true);
  assert.equal(isExcluded(['draft'], 'x/draft'), true);
  assert.equal(isExcluded(['draft'], 'x/drafts'), false);
});

test('a trailing "/" matches folders only', () => {
  assert.equal(isExcluded(['build/'], 'build', true), true);
  assert.equal(isExcluded(['build/'], 'x/build', true), true);
  assert.equal(isExcluded(['build/'], 'build'), false);
});

test('a "/" at the start or inside anchors at the rule folder', () => {
  assert.equal(isExcluded(['/draft.md'], 'draft.md'), true);
  assert.equal(isExcluded(['/draft.md'], 'x/draft.md'), false);
  assert.equal(isExcluded(['doc/a.md'], 'doc/a.md'), true);
  assert.equal(isExcluded(['doc/a.md'], 'x/doc/a.md'), false);
  assert.equal(isExcluded(['doc/*.md'], 'doc/sub/a.md'), false);
});

test('"**" stands for any folders', () => {
  assert.equal(isExcluded(['**/tmp'], 'tmp', true), true);
  assert.equal(isExcluded(['**/tmp'], 'a/b/tmp', true), true);
  assert.equal(isExcluded(['out/**'], 'out/a/b.js'), true);
  assert.equal(isExcluded(['out/**'], 'out', true), false);
  assert.equal(isExcluded(['a/**/b.md'], 'a/b.md'), true);
  assert.equal(isExcluded(['a/**/b.md'], 'a/x/y/b.md'), true);
});

test('"?", sets and escapes', () => {
  assert.equal(isExcluded(['a?.md'], 'ab.md'), true);
  assert.equal(isExcluded(['a?.md'], 'a/.md'), false);
  assert.equal(isExcluded(['[ab].md'], 'b.md'), true);
  assert.equal(isExcluded(['[!ab].md'], 'b.md'), false);
  assert.equal(isExcluded(['[!ab].md'], 'c.md'), true);
  assert.equal(isExcluded(['\\#notes.md'], '#notes.md'), true);
  assert.equal(isExcluded(['\\!a.md'], '!a.md'), true);
});

test('"!" collects again; the last pattern that matches decides', () => {
  assert.equal(isExcluded(['*.log', '!keep.log'], 'keep.log'), false);
  assert.equal(isExcluded(['*.log', '!keep.log'], 'other.log'), true);
  assert.equal(isExcluded(['!keep.log', '*.log'], 'keep.log'), true);
});

test('a block of lines reads like a .gitignore; wrong values are refused', () => {
  assert.deepEqual(excludePatternTextListRead('# comment\n*.pyc\n\nsub-doc/  \n', 'here'), ['*.pyc', 'sub-doc/']);
  assert.deepEqual(excludePatternTextListRead(['a', '# b', ''], 'here'), ['a']);
  assert.throws(() => excludePatternTextListRead({ a: 1 }, 'here'), /list of patterns/);
  assert.throws(() => excludePatternTextListRead([1], 'here'), /must be a string/);
  assert.throws(() => excludePatternTextListRead(['../x'], 'here'), /path segments/);
  assert.throws(() => excludePatternTextListRead(['[ab'], 'here'), /not closed/);
});

test('the loader keeps the patterns of an addFolder rule and refuses them on addFile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-source-exclude-'));
  fs.mkdirSync(path.join(dir, 'guide', '.doc-page'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'guide', 'a.md'), '# A\n');
  const entryWrite = (ruleLineList) => fs.writeFileSync(path.join(dir, 'guide', '.doc-page', 'entry.yaml'), [
    'docEntry:',
    '  title: Guide',
    'source:',
    ...ruleLineList,
  ].join('\n'));
  entryWrite([
    '  - action: addFolder',
    '    path: ..',
    '    collect: recursive',
    '    exclude: |',
    '      # like a .gitignore',
    '      *.tmp',
    '      draft/',
  ]);
  const loaded = docWorkspaceLoad({ isVirtual: true, docPageList: [{ dir: path.join(dir, 'guide') }] }, dir);
  assert.deepEqual(loaded.sourceRuleList[0].exclude, ['*.tmp', 'draft/']);

  entryWrite([
    '  - action: addFile',
    '    path: ../a.md',
    '    exclude: ["*.tmp"]',
  ]);
  assert.throws(
    () => docWorkspaceLoad({ isVirtual: true, docPageList: [{ dir: path.join(dir, 'guide') }] }, dir),
    /belongs to an addFolder rule/,
  );
});
