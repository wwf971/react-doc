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
