import assert from 'node:assert/strict';
import test from 'node:test';
import {
  navigationHighlightSet,
  pageScrollDestinationAlign,
  pageScrollDestinationIsAligned,
} from './doc-destination-navigation.js';

function classListBuild(classNameList = []) {
  const valueSet = new Set(classNameList);
  return {
    add: (value) => valueSet.add(value),
    contains: (value) => valueSet.has(value),
    remove: (value) => valueSet.delete(value),
  };
}

test('reselecting an aligned destination preserves its scroll position and highlight', () => {
  const targetElement = {
    classList: classListBuild(['doc-navigation-target']),
    getBoundingClientRect: () => ({ top: 108 }),
  };
  const pageElement = {
    classList: classListBuild(),
    scrollTop: 320,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => [targetElement],
  };

  assert.equal(pageScrollDestinationIsAligned(pageElement, targetElement), true);
  navigationHighlightSet(pageElement, targetElement);

  assert.equal(pageElement.scrollTop, 320);
  assert.equal(targetElement.classList.contains('doc-navigation-target'), true);
});

test('a displaced current destination is realigned without a document-top reset', () => {
  const targetElement = {
    getBoundingClientRect: () => ({ top: 208 }),
  };
  const pageElement = {
    scrollTop: 320,
    getBoundingClientRect: () => ({ top: 100 }),
  };

  assert.equal(pageScrollDestinationIsAligned(pageElement, targetElement), false);
  pageScrollDestinationAlign(pageElement, targetElement);

  assert.equal(pageElement.scrollTop, 420);
});

test('selecting a new destination removes only stale navigation highlights', () => {
  const targetPrevious = { classList: classListBuild(['doc-navigation-target']) };
  const targetCurrent = { classList: classListBuild() };
  const pageElement = {
    querySelectorAll: () => [targetPrevious],
  };

  navigationHighlightSet(pageElement, targetCurrent);

  assert.equal(targetPrevious.classList.contains('doc-navigation-target'), false);
  assert.equal(targetCurrent.classList.contains('doc-navigation-target'), true);
});

// ---------- the focus of a navigation ----------

import { focusBlockGet, focusElementFind, navigationFocusSet } from './doc-destination-navigation.js';

function linkElementBuild(target, line) {
  const attributeByName = { 'data-doc-link-target': target, ...(line ? { 'data-doc-link-line': String(line) } : {}) };
  return {
    attributeByName,
    classList: classListBuild(),
    getAttribute: (name) => attributeByName[name] ?? null,
    closest: () => null,
  };
}

function contentElementBuild(elementList) {
  return {
    querySelectorAll: (selector) => {
      const match = /^\[data-doc-link-target="((?:[^"\\]|\\.)*)"\]$/.exec(selector);
      if (!match) return [];
      const target = match[1].replace(/\\(.)/g, '$1');
      return elementList.filter((element) => element.getAttribute('data-doc-link-target') === target);
    },
  };
}

test('a focus finds the link on its line, else the first link with its target', () => {
  const linkA = linkElementBuild('a.md', 3);
  const linkB = linkElementBuild('a.md', 9);
  const linkNested = linkElementBuild('a.md');
  const contentElement = contentElementBuild([linkNested, linkA, linkB]);
  assert.equal(focusElementFind(contentElement, { kind: 'link', target: 'a.md', sourceLine: 9, blockLine: 9 }), linkB);
  assert.equal(focusElementFind(contentElement, { kind: 'link', target: 'a.md', blockLine: 20 }), linkNested);
  assert.equal(focusElementFind(contentElement, { kind: 'link', target: 'a.md', sourceLine: 99, blockLine: 99 }), linkNested);
  assert.equal(focusElementFind(contentElement, { kind: 'link', target: 'b.md', blockLine: 1 }), null);
  assert.equal(focusElementFind(null, { kind: 'link', target: 'a.md', blockLine: 1 }), null);
});

test('a target with quotes is looked up escaped', () => {
  const link = linkElementBuild('say "hi".md', 1);
  const contentElement = contentElementBuild([link]);
  assert.equal(focusElementFind(contentElement, { kind: 'link', target: 'say "hi".md', blockLine: 1 }), link);
});

test('the focus mark moves to the focused link, and the block is where the link sits', () => {
  const linkPrevious = linkElementBuild('x.md', 1);
  linkPrevious.classList.add('doc-navigation-focus');
  const paragraph = { tagName: 'P' };
  const link = linkElementBuild('a.md', 2);
  link.closest = () => paragraph;
  const pageElement = { querySelectorAll: () => [linkPrevious] };
  navigationFocusSet(pageElement, link);
  assert.equal(linkPrevious.classList.contains('doc-navigation-focus'), false);
  assert.equal(link.classList.contains('doc-navigation-focus'), true);
  assert.equal(focusBlockGet(link), paragraph);
  assert.equal(focusBlockGet(linkPrevious), linkPrevious);
});
