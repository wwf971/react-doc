import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inlineCodeIsDocTarget,
  inlineLinkDisplayModeGet,
  linkTagsDisplayGet,
  linkUrlIsLocal,
  wikiTextSplit,
} from './doc-link-classify.js';
import { docTargetResolve, sourceIndexBuild } from './doc-target-resolve.js';

test('external and fragment links are not local', () => {
  assert.equal(linkUrlIsLocal('https://example.com/a.md'), false);
  assert.equal(linkUrlIsLocal('mailto:a@example.com'), false);
  assert.equal(linkUrlIsLocal('//cdn.example.com/a.png'), false);
  assert.equal(linkUrlIsLocal('#section'), false);
  assert.equal(linkUrlIsLocal(''), false);
  assert.equal(linkUrlIsLocal('./a.md'), true);
  assert.equal(linkUrlIsLocal('/guide/setup.ps1'), true);
  assert.equal(linkUrlIsLocal('a.md#part'), true);
});

test('inline-link and tag markers are exact', () => {
  assert.equal(inlineLinkDisplayModeGet('inline-link'), 'source');
  assert.equal(inlineLinkDisplayModeGet('inline-link:source'), 'source');
  assert.equal(inlineLinkDisplayModeGet('inline-link:render'), 'render');
  assert.equal(inlineLinkDisplayModeGet('Inline-Link'), '');
  assert.equal(inlineLinkDisplayModeGet('inline-link '), '');
  assert.equal(inlineLinkDisplayModeGet(null), '');
  assert.equal(linkTagsDisplayGet('tags:after'), 'after');
  assert.equal(linkTagsDisplayGet('tags'), '');
});

test('inline code is a document target only for md/mdx file names', () => {
  assert.equal(inlineCodeIsDocTarget('guide/setup.md'), true);
  assert.equal(inlineCodeIsDocTarget('../a.mdx#part'), true);
  assert.equal(inlineCodeIsDocTarget('npm install'), false);
  assert.equal(inlineCodeIsDocTarget('setup.ps1'), false);
});

test('wiki text splits into text and targets', () => {
  assert.deepEqual(wikiTextSplit('see [[a.md]] and [[b.md]].'), [
    { text: 'see ' },
    { target: 'a.md' },
    { text: ' and ' },
    { target: 'b.md' },
    { text: '.' },
  ]);
  assert.deepEqual(wikiTextSplit('no link here'), []);
});

test('targets resolve by exact path, relative path, suffix, and name', () => {
  const sourceIndex = sourceIndexBuild([
    { internalPath: '/docs/guide/a.md', name: 'a.md' },
    { internalPath: '/docs/guide/b.md', name: 'b.md' },
    { internalPath: '/docs/ref/a.md', name: 'a.md' },
  ]);
  const pathListGet = (target, fromPath = '/docs/guide/b.md') => (
    docTargetResolve(target, fromPath, sourceIndex).entryList.map((entry) => entry.internalPath)
  );
  assert.deepEqual(pathListGet('/docs/ref/a.md'), ['/docs/ref/a.md']);
  assert.deepEqual(pathListGet('./a.md'), ['/docs/guide/a.md']);
  assert.deepEqual(pathListGet('../ref/a.md'), ['/docs/ref/a.md']);
  assert.deepEqual(pathListGet('ref/a.md'), ['/docs/ref/a.md']);
  assert.deepEqual(pathListGet('a.md'), ['/docs/guide/a.md', '/docs/ref/a.md']);
  assert.deepEqual(pathListGet('/docs/missing.md'), []);
  assert.equal(docTargetResolve('./a.md#setup', '/docs/guide/b.md', sourceIndex).hash, 'setup');
});
