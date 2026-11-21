import assert from 'node:assert/strict';
import test from 'node:test';
import { configDefineByKeyBuild, configValueMerge, configValueNormalize } from './doc-config-define.js';
import { configDeclaredListMerge, configModelBuild } from './doc-config-model.js';

// a key of type stringMap (doc_page_impl_config.md#adding-keys) is merged
// entry by entry at every level, an entry written null removing the one
// below; EditInsertRankByEntry is one, its values ranks (valuePattern).

const configDefineByKey = configDefineByKeyBuild();
const define = configDefineByKey.get('EditInsertRankByEntry');
const KEY = 'EditInsertRankByEntry';

const layerBuild = (id, config, isAboveDocLevels = false) => ({ id, config, compConfig: {}, isCompKeyedById: false, isAboveDocLevels });

test('a stringMap value is a mapping of strings matching the pattern, an entry may be null', () => {
  assert.equal(define.type, 'stringMap');
  assert.equal(configValueNormalize(define, { 'text:paragraph': 'c', 'text:comment': null }).isValid, true);
  assert.equal(configValueNormalize(define, { 'text:paragraph': 'C' }).isValid, false, 'not a rank');
  assert.equal(configValueNormalize(define, { 'text:paragraph': 'c0' }).isValid, false, 'a rank never ends with 0');
  assert.equal(configValueNormalize(define, { 'text:paragraph': 3 }).isValid, false);
  assert.equal(configValueNormalize(define, ['c']).isValid, false);
  assert.equal(configValueNormalize(define, null).isValid, false, 'the key itself is never "not set"');
});

test('a later value adds and replaces entries; null removes one', () => {
  assert.deepEqual(configValueMerge(define, { a: 'c', b: 'e' }, { b: 'f', c: 'g', a: null }), { b: 'f', c: 'g' });
  assert.deepEqual(configValueMerge(define, { a: 'c' }, { a: null }, true), { a: null }, 'kept for a merge within a layer');
  const defineString = configDefineByKey.get('FontMonoFamily');
  assert.equal(configValueMerge(defineString, 'a', 'b'), 'b', 'any other type is replaced');
});

test('the layers and the document levels merge the ranks entry by entry', () => {
  const model = configModelBuild({
    configDefineByKey,
    configDoc: {},
    layerList: [
      layerBuild('default', { [KEY]: { 'text:paragraph': 'c', 'text:list': 'g', 'text:comment': 'o' } }),
      layerBuild('docPage:cv', { [KEY]: { 'component:CvSheet': 'd', 'text:comment': null } }),
      layerBuild('client', { [KEY]: { 'text:list': 'b' } }, true),
    ],
    fileManifest: [
      { internalPath: '~cv/a.md', configFrontmatter: { [KEY]: { 'component:Zettel': '1' } } },
      { internalPath: '~cv/b.md' },
    ],
  });
  assert.deepEqual(model.configGlobal[KEY], { 'text:paragraph': 'c', 'text:list': 'b', 'component:CvSheet': 'd' });
  assert.equal(model.levelGlobalByKey[KEY], 'client');
  assert.deepEqual(model.configByDocPath.get('~cv/a.md').valueByKey[KEY], {
    'text:paragraph': 'c', 'text:list': 'b', 'component:CvSheet': 'd', 'component:Zettel': '1',
  });
  assert.deepEqual(model.configByDocPath.get('~cv/b.md').valueByKey[KEY], { 'text:paragraph': 'c', 'text:list': 'b', 'component:CvSheet': 'd' });
});

test('the declarations of one layer merge the same way; an invalid one is passed over', () => {
  const merged = configDeclaredListMerge([
    { [KEY]: { 'text:paragraph': 'c', 'text:comment': 'o' }, FontMonoFamily: 'a' },
    { [KEY]: { 'component:CvSheet': 'd', 'text:comment': null }, FontMonoFamily: 'b' },
    { [KEY]: { 'component:CvSheet': 'D' }, FontMonoFamily: 3 },
  ], { defineByKey: configDefineByKey });
  assert.deepEqual(merged[KEY], { 'text:paragraph': 'c', 'text:comment': null, 'component:CvSheet': 'd' });
  assert.equal(merged.FontMonoFamily, 'b', 'the last valid one');
  const unknownKept = configDeclaredListMerge([{ NotAKey: 1 }, { FontMonoFamily: 3 }], { defineByKey: configDefineByKey });
  assert.deepEqual(unknownKept, { NotAKey: 1, FontMonoFamily: 3 }, 'passed on for the model to report');
});
