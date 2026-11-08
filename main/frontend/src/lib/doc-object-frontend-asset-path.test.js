import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetPathChoice, assetPathCompile, assetPathConcat, assetPathExpand, assetPathIndexBelowList, assetPathIndexBuild, assetPathIndexComplete,
  assetPathIndexGet, assetPathIndexPathOfEntryGet, assetPathListSplit, assetPathMatch, assetPathNormalize, assetPathParse, assetPathPrefixStrip,
  assetPathSplit, assetPathText,
} from './doc-object-frontend-asset-path.js';

const expand = (text) => assetPathExpand(assetPathParse(text).node).pathList.map((one) => one.join('/'));
const canonical = (text) => assetPathNormalize(text).path;

test('a sequence is read as an os path: "/" ends every segment but the last', () => {
  assert.equal(canonical('book//sci-fi/./x/../dune/'), 'book/sci-fi/dune');
  assert.equal(canonical('/book/sci-fi'), '/book/sci-fi');
  assert.equal(assetPathNormalize('book/sci-fi', { isAbsolute: true }).path, '/book/sci-fi');
  assert.match(assetPathNormalize('/a/../..').message, /above the root/);
  assert.equal(canonical('a/b/..'), 'a');
  assert.equal(canonical(' a b / c '), 'a b/c');
  assert.deepEqual(assetPathSplit('/a/b'), ['a', 'b']);
  assert.equal(assetPathSplit('/a/{b, c}'), undefined);
});

test('an unordered group: its members in any order, nothing else moves', () => {
  // members ending with "/": the path goes on after the group
  assert.deepEqual(expand('a/b/{c/d/}x'), ['a/b/c/d/x', 'a/b/d/c/x']);
  assert.deepEqual(expand('a/b/{c/, d/}x'), expand('a/b/{c/d/}x'));
  // members without it: the group ends the path, its members separated by ","
  assert.deepEqual(expand('a/b/{c, d}'), ['a/b/c/d', 'a/b/d/c']);
  assert.deepEqual(expand('a/b/{c/d/}{e,f}'), ['a/b/c/d/e/f', 'a/b/c/d/f/e', 'a/b/d/c/e/f', 'a/b/d/c/f/e']);
  assert.equal(expand('{a, b, c}').length, 6);
  assert.equal(expand('{a, b, c}')[0], 'a/b/c');
  // a member of several segments keeps its own order: a choice of one
  assert.deepEqual(expand('{[a/b/]c/}x'), ['a/b/c/x', 'c/a/b/x']);
  assert.deepEqual(expand('{[a/b], c}'), ['a/b/c', 'c/a/b']);
  // nested groups
  assert.deepEqual(expand('{a, {b, c}}'), ['a/b/c', 'a/c/b', 'b/c/a', 'c/b/a']);
  assert.deepEqual(expand('{a/{b/c/}}x'), ['a/b/c/x', 'a/c/b/x', 'b/c/a/x', 'c/b/a/x']);
  // a group of one is its member
  assert.equal(canonical('x/{a}'), 'x/a');
  assert.equal(canonical('x/{a/}y'), 'x/a/y');
});

test('a choice: one of its alternatives; an empty one makes what goes on optional', () => {
  assert.deepEqual(expand('a/b/[{c, d}, e]'), ['a/b/c/d', 'a/b/d/c', 'a/b/e']);
  assert.deepEqual(expand('a/b/[{c/d/}, e/]x'), ['a/b/c/d/x', 'a/b/d/c/x', 'a/b/e/x']);
  assert.deepEqual(expand('a/[b/, ]c'), ['a/b/c', 'a/c']);
  assert.deepEqual(expand('[a/b/, c/]d'), ['a/b/d', 'c/d']);
  assert.deepEqual(expand('[a, a]'), ['a']);
  assert.equal(canonical('x/[a/b/]c'), 'x/a/b/c');
});

test('what is not a pattern says why and where', () => {
  // "/" only ends a segment that something follows
  assert.match(assetPathParse('a/b/{c/d}/{e/f}').message, /all end with "\/".*or none does/);
  assert.match(assetPathParse('a/b[c, d]').message, /"b" does not end with "\/", so it ends the path/);
  assert.match(assetPathParse('{e, f}x').message, /"\{e, f\}" does not end with "\/"/);
  assert.match(assetPathParse('{c/d/}/x').message, /a "\/" after a group: the "\/" goes after each member/);
  assert.match(assetPathParse('[b/, c/]/x').message, /a "\/" after a choice/);
  assert.match(assetPathParse('a/{c/d/}').message, /ends with a group whose members end with "\/"/);
  assert.match(assetPathParse('a/[b/, c/]').message, /ends with a choice whose alternatives end with "\/"/);
  assert.match(assetPathParse('[b/, c]').message, /alternatives of a choice all end with "\/"/);
  assert.match(assetPathParse('a/[b, ]').message, /an empty alternative leaves nothing/);
  assert.match(assetPathParse('{e f, g}').message, /^$/);
  assert.match(assetPathParse('{e g}').message, /^$/);
  assert.match(assetPathParse('{e, , f}').message, /empty member/);
  assert.match(assetPathParse('{c//d/}x').message, /a "\/" between the members/);
  assert.match(assetPathParse('a/{b, c').message, /group "\{" is not closed \(at character 3\)/);
  assert.match(assetPathParse('a/[b, c').message, /choice "\[" is not closed/);
  assert.match(assetPathParse('a/{b]').message, /inside an unordered group/);
  assert.match(assetPathParse('a/}').message, /closes nothing/);
  assert.match(assetPathParse('a/{}').message, /at least one member/);
  assert.match(assetPathParse('a/[, ]').message, /not empty/);
  assert.match(assetPathParse('{a, b, c, d, e, f, g}').message, /at most 6 members/);
  assert.match(assetPathParse('[../a]').message, /no segment before it/);
  assert.match(assetPathNormalize(`a/${'x'.repeat(81)}`).message, /at most 80/);
  // escaped, a special character is ordinary
  assert.deepEqual(assetPathSplit('a\\,b/c\\{d'), ['a,b', 'c{d']);
  assert.equal(assetPathText(assetPathParse('a\\,b').node), 'a\\,b');
});

test('the canonical text reads back as the same pattern', () => {
  for (const text of ['a/b/{c/d/}{e, f}', 'a/[b/, c/d/, ]e', '{[a/b/]c/}{d, [e, f]}', '/x/y', 'name/{jp/last/}kanji', '{a, {b, c}}']) {
    const { path } = assetPathNormalize(text);
    assert.equal(path, text);
    assert.equal(assetPathNormalize(path).path, path);
    assert.deepEqual(expand(path), expand(text));
  }
  assert.equal(canonical('{c/, d/}x'), '{c/d/}x');
  assert.equal(canonical('{c,d}'), '{c, d}');
});

test('matching without expanding: a path, or the start of one', () => {
  const node = assetPathParse('name/{jp/last/}[kanji, hiragana]').node;
  assert.equal(assetPathMatch(node, ['name', 'last', 'jp', 'kanji']), true);
  assert.equal(assetPathMatch(node, ['name', 'last', 'jp']), false);
  assert.equal(assetPathMatch(node, ['name', 'last', 'jp'], { isPrefix: true }), true);
  assert.equal(assetPathMatch(node, ['name', 'jp'], { isPrefix: true }), true);
  assert.equal(assetPathMatch(node, ['name', 'kanji'], { isPrefix: true }), false);
  assert.equal(assetPathMatch(node, ['NAME', 'JA', 'Last', 'Hiragana'], { segmentNormalize: (one) => ({ ja: 'jp' }[one.toLowerCase()] ?? one.toLowerCase()) }), true);
  for (const text of ['a/{b/c/}{d, e}', '[a/{b/c/}, d/]e', '{a, [b, c/d]}']) {
    const parsed = assetPathParse(text).node;
    for (const path of expand(text)) assert.equal(assetPathMatch(parsed, path.split('/')), true, `${text} ${path}`);
  }
});

test('composing: concatenated, chosen among, a prefix taken off; the "/" follows the place', () => {
  const name = assetPathParse('name').node;
  // a key written alone ends its own path: {jp, last}; placed before more, its members go on
  const key = assetPathParse('{jp, last}').node;
  assert.equal(assetPathText(assetPathConcat(name, key, assetPathParse('kanji').node)), 'name/{jp/last/}kanji');
  assert.equal(assetPathText(assetPathConcat(name, key)), 'name/{jp, last}');
  // a fragment, more following it, may say so itself
  assert.equal(assetPathText(assetPathConcat(name, assetPathParse('{jp/last/}', { isFragment: true }).node, assetPathParse('kanji').node)), 'name/{jp/last/}kanji');
  assert.match(assetPathParse('{jp/last/}').message, /ends with a group/);
  assert.equal(assetPathText(assetPathChoice([assetPathParse('a/b').node, assetPathParse('c').node])), '[a/b, c]');
  assert.equal(assetPathText(assetPathConcat(assetPathChoice([assetPathParse('a/b').node, assetPathParse('c').node]), name)), '[a/b/, c/]name');
  assert.equal(assetPathText(assetPathPrefixStrip(assetPathParse('/example/info/{a, b}').node, ['example', 'info'])), '{a, b}');
  assert.equal(assetPathPrefixStrip(assetPathParse('/{example, info}').node, ['example']), undefined);
  assert.equal(assetPathText(assetPathPrefixStrip(assetPathParse('[x/a, x/b, y/c]').node, ['x'])), '[a, b]');
});

test('a list of patterns splits at the commas outside brackets', () => {
  assert.deepEqual(assetPathListSplit('/a, /b/[c, d], /e/{f, g}, /e\\,f'), ['/a', '/b/[c, d]', '/e/{f, g}', '/e\\,f']);
});

test('a pattern standing for too many paths is refused', () => {
  const { message } = assetPathExpand(assetPathParse('{a/b/c/d/e/f/}{g, h, i}').node);
  assert.match(message, /more than 1024/);
  assert.equal(assetPathCompile('{a, b}').pathList.length, 2);
  assert.equal(assetPathCompile('{a, b}'), assetPathCompile('{a, b}'));
});

test('the index: an entry by any of its paths, the entries below a folder, completion', () => {
  const book = { key: 'book-1', name: 'Dune' };
  const other = { key: 'book-2', name: 'Solaris' };
  const index = assetPathIndexBuild([
    { entry: book, pathList: ['/book/{sci-fi/frank-herbert/}dune'] },
    { entry: other, pathList: ['/book/sci-fi/solaris', '/book/sci-fi/frank-herbert/dune'] },
  ], { labelOf: (one) => one.key, isAbsolute: true });
  assert.equal(assetPathIndexGet(index, '/book/frank-herbert/sci-fi/dune'), book);
  assert.equal(assetPathIndexGet(index, ['book', 'sci-fi', 'frank-herbert', 'dune']), book);
  // a path claimed twice names the first, and is reported
  assert.equal(index.problemList.length, 1);
  assert.match(index.problemList[0], /claimed by book-1 and book-2/);
  assert.deepEqual(assetPathIndexBelowList(index, '/book/sci-fi'), [book, other]);
  assert.deepEqual(assetPathIndexBelowList(index, '/book/frank-herbert'), [book]);
  assert.deepEqual(assetPathIndexComplete(index, '/book/').map((one) => `${one.kind}:${one.path}:${one.entryCount}`), ['folder:/book/frank-herbert:1', 'folder:/book/sci-fi:2']);
  assert.deepEqual(assetPathIndexComplete(index, '/book/sci-fi/so').map((one) => one.path), ['/book/sci-fi/solaris']);
  assert.deepEqual(assetPathIndexComplete(index, 'sci-fi/', { base: '/book' }).map((one) => one.path), ['/book/sci-fi/frank-herbert', '/book/sci-fi/solaris']);
  assert.deepEqual(assetPathIndexPathOfEntryGet(index, book, ['book', 'frank-herbert']), ['book', 'frank-herbert', 'sci-fi', 'dune']);
});
