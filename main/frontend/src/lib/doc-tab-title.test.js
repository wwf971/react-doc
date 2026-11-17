import test from 'node:test';
import assert from 'node:assert/strict';
import { TAB_TITLE_DEFAULT, docTabTitleGet } from './doc-tab-title.js';
import { docEnvKindDefineList } from './doc-env.js';

test('the site and the document, in the order asked', () => {
  assert.equal(docTabTitleGet({ siteTitle: 'cv', documentTitle: 'README', order: 'siteFirst' }), 'cv · README');
  assert.equal(docTabTitleGet({ siteTitle: 'cv', documentTitle: 'README', order: 'documentFirst' }), 'README · cv');
  assert.equal(docTabTitleGet({ siteTitle: 'cv', documentTitle: 'README' }), 'README · cv');
});

test('a document named as the site, or none, gives the site alone', () => {
  assert.equal(docTabTitleGet({ siteTitle: 'Zene', documentTitle: 'Zene', order: 'siteFirst' }), 'Zene');
  assert.equal(docTabTitleGet({ siteTitle: 'Zene', documentTitle: '  ', order: 'siteFirst' }), 'Zene');
  assert.equal(docTabTitleGet({ siteTitle: 'Zene' }), 'Zene');
});

test('no site gives the document alone; nothing gives the default', () => {
  assert.equal(docTabTitleGet({ documentTitle: 'README', order: 'siteFirst' }), 'README');
  assert.equal(docTabTitleGet({}), TAB_TITLE_DEFAULT);
  assert.equal(docTabTitleGet(), TAB_TITLE_DEFAULT);
});

test('every environment kind says its order', () => {
  for (const define of docEnvKindDefineList) assert.ok(['siteFirst', 'documentFirst'].includes(define.tabTitleOrder), define.kind);
});
