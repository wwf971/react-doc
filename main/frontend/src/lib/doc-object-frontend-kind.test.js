import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  objectFrontendKindContentCheck, objectFrontendKindContentRead, objectFrontendKindItemCheck, objectFrontendKindListRead,
  objectFrontendKindProblemText, objectFrontendSchemaCheck, objectFrontendSchemaRead, objectFrontendSizeRead,
} from './doc-object-frontend-kind.js';
import { objectFrontendAssetAcceptCheck, objectFrontendKindListResolve } from './doc-object-frontend.js';
import { typeDeclaredConfigGet } from '../../plugin/doc-type-config.ts';

// kinds of data items (doc_page_impl_type.md#kinds-of-data-items)

function problemCollect(run) {
  const problemList = [];
  const value = run((message) => problemList.push(message));
  return { value, problemList };
}

test('the content of a kind: the short forms, a mapping, the form inferred, what cannot be read', () => {
  assert.deepEqual(objectFrontendKindContentRead(undefined, 'k', () => {}), { form: 'any' });
  assert.deepEqual(objectFrontendKindContentRead('data', 'k', () => {}), { form: 'data', langList: ['yaml', 'json'] });
  assert.deepEqual(objectFrontendKindContentRead('bytes', 'k', () => {}), { form: 'bytes' });
  assert.deepEqual(objectFrontendKindContentRead({ form: 'text', langList: ['md', 'mdx'] }, 'k', () => {}), { form: 'text', langList: ['md', 'mdx'] });
  assert.deepEqual(objectFrontendKindContentRead({ mediaTypeList: ['image/*', 'application/pdf'], extList: ['.PNG'], sizeMax: '2MB' }, 'k', () => {}), {
    form: 'bytes', mediaTypeList: ['image/*', 'application/pdf'], extList: ['png'], sizeMax: 2 * 1024 * 1024,
  });
  assert.deepEqual(objectFrontendKindContentRead({ schema: { type: 'object' } }, 'k', () => {}), { form: 'data', langList: ['yaml', 'json'], schema: { type: 'object' } });
  const bad = problemCollect((problem) => objectFrontendKindContentRead({ form: 'data', langList: ['md'], mediaTypeList: ['x'] }, 'k', problem));
  assert.deepEqual(bad.value, { form: 'data', langList: ['yaml', 'json'] });
  assert.equal(bad.problemList.length, 2);
  assert.match(bad.problemList[0], /mediaTypeList" means nothing for the form data/);
  assert.match(bad.problemList[1], /data is read from yaml or json, not md/);
  // a schema that cannot be read checks nothing: said, and left out
  const schemaBad = problemCollect((problem) => objectFrontendKindContentRead({ form: 'data', schema: { type: 'mapping' } }, 'k', problem));
  assert.equal(schemaBad.value.schema, undefined);
  assert.match(schemaBad.problemList[0], /"type" is one of string, number/);
  assert.equal(objectFrontendSizeRead('200KB'), 204800);
  assert.equal(objectFrontendSizeRead('lots'), undefined);
});

test('an item against the form of its kind: data in its languages, a text, bytes of a media type and size', () => {
  assert.equal(objectFrontendKindContentCheck({ form: 'any' }, { lang: 'md' }), '');
  assert.equal(objectFrontendKindContentCheck({ form: 'data', langList: ['yaml'] }, { lang: 'yaml' }), '');
  assert.equal(objectFrontendKindContentCheck({ form: 'data', langList: ['yaml'] }, { lang: 'json' }), 'it is data in yaml, not json');
  assert.equal(objectFrontendKindContentCheck({ form: 'data' }, { lang: '' }), 'it is data in yaml or json, not bytes');
  assert.equal(objectFrontendKindContentCheck({ form: 'text', langList: ['md'] }, { lang: 'mdx' }), 'it is a text in md, not mdx');
  assert.equal(objectFrontendKindContentCheck({ form: 'text' }, { lang: '' }), 'it is a text, not bytes');
  const image = { form: 'bytes', mediaTypeList: ['image/*'], extList: ['png', 'jpg'], sizeMax: 1000 };
  assert.equal(objectFrontendKindContentCheck(image, { lang: '', contentType: 'image/png', fileExt: 'png', size: 10 }), '');
  assert.equal(objectFrontendKindContentCheck(image, { lang: '', contentType: 'application/pdf' }), 'it is a file of image/*, not application/pdf');
  assert.equal(objectFrontendKindContentCheck(image, { lang: '', fileExt: '.gif' }), 'it is a file .png, .jpg, not .gif');
  assert.match(objectFrontendKindContentCheck(image, { lang: '', size: 5000 }), /at most 1000B, not 4.9KB/);
  assert.equal(objectFrontendKindContentCheck(image, { lang: 'yaml' }), 'it is a file (bytes), not a text in yaml');
});

const schemaTemplate = {
  type: 'object',
  required: ['sectionList'],
  properties: {
    name: { type: 'string' },
    sectionList: { type: 'array', items: { $ref: '#/$defs/section' }, minItems: 1 },
  },
  additionalProperties: false,
  $defs: {
    section: {
      type: 'object',
      properties: { id: { type: 'string', pattern: '^[a-z-]+$' }, type: { enum: ['basic', 'history', 'text'] } },
    },
  },
};

test('a schema: what does not fit, with its path', () => {
  assert.deepEqual(objectFrontendSchemaCheck(schemaTemplate, { name: 'a', sectionList: [{ id: 'basic', type: 'basic' }] }), []);
  assert.deepEqual(objectFrontendSchemaCheck(schemaTemplate, { name: 'a', sectionList: [{ id: 'basic', type: 'histroy' }, { id: 'X' }], extra: 1 }), [
    { path: '/sectionList/0/type', message: '"histroy" is none of basic, history, text' },
    { path: '/sectionList/1/id', message: '"X" does not match ^[a-z-]+$' },
    { path: '/extra', message: 'the key extra is not one of name, sectionList' },
  ]);
  assert.deepEqual(objectFrontendSchemaCheck(schemaTemplate, 'a string'), [{ path: '', message: '"a string" is a string, not a mapping' }]);
  assert.deepEqual(objectFrontendSchemaCheck(schemaTemplate, {}), [{ path: '', message: 'the key sectionList is missing' }]);
  // a value of a tree: recursive through $defs, a dated entry told apart by its year
  const value = {
    $defs: {
      value: { anyOf: [{ type: ['string', 'number', 'boolean'] }, { type: 'array', items: { $ref: '#/$defs/value' } }, { $ref: '#/$defs/entry' }, { type: 'object', not: { required: ['year'] }, additionalProperties: { $ref: '#/$defs/value' } }] },
      entry: { type: 'object', required: ['year'], properties: { year: { type: ['integer', 'string'] }, month: { type: 'integer', minimum: 1, maximum: 12 } }, additionalProperties: { $ref: '#/$defs/value' } },
    },
    $ref: '#/$defs/value',
  };
  assert.deepEqual(objectFrontendSchemaCheck(value, { jp: { last: { kanji: '山田' } }, edu: { start: { year: 2016, month: 4, jp: ['a', 'b'] } } }), []);
  const [problem] = objectFrontendSchemaCheck(value, { edu: { start: { year: 2016, month: 13 } } });
  assert.match(problem.message, /fits none of the 4 forms/);
  assert.match(problem.message, /13 is above 12/);
  // a schema read: unknown keys, a $ref to nothing, a pattern that is no expression
  const read = problemCollect((problem2) => objectFrontendSchemaRead({ type: 'object', propertys: {}, items: { $ref: '#/$defs/none' }, pattern: '(' }, 's', problem2));
  assert.equal(read.problemList.length, 3);
});

test('an item checked from its text: parsed in its language, then against the schema', () => {
  const content = { form: 'data', langList: ['yaml', 'json'], schema: schemaTemplate };
  assert.deepEqual(objectFrontendKindItemCheck(content, { lang: 'yaml', text: 'sectionList:\n  - { id: basic, type: basic }\n' }), []);
  assert.match(objectFrontendKindItemCheck(content, { lang: 'json', text: '{ bad' })[0].message, /it is not json/);
  assert.equal(objectFrontendKindProblemText(objectFrontendKindItemCheck(content, { lang: 'yaml', text: 'sectionList: []\nx: 1\n' })), '/sectionList: a list of 0, not at least 1 (and 1 more)');
});

test('the kinds of a type: declared here, held from elsewhere, offered without being held', () => {
  const { value, problemList } = problemCollect((problem) => objectFrontendKindListRead([
    { id: 'info', label: 'Information', content: 'data', groupPath: 'info' },
    { id: 'logo', kind: 'example.media.image', groupPath: 'logo', content: 'bytes' },
    { id: 'photo', content: { form: 'bytes', mediaTypeList: ['image/*'] }, isHeld: false },
    { id: 'info', content: 'text' },
    { id: 'Bad name' },
  ], { typeId: 'cv.profile', place: 'k', problem }));
  assert.deepEqual(value.holdList.map((one) => [one.id, one.kindId, one.isOwn]), [['info', 'cv.profile.info', true], ['logo', 'example.media.image', false]]);
  assert.deepEqual(value.kindDeclareList.map((one) => [one.id, one.declaredBy, one.content.form]), [['cv.profile.info', 'cv.profile', 'data'], ['cv.profile.photo', 'cv.profile', 'bytes']]);
  assert.equal(problemList.length, 3);
  assert.match(problemList[0], /content belong to the declaration of example.media.image/);
  assert.match(problemList[1], /the kind info is named twice/);
  assert.match(problemList[2], /"id" is its name in the object/);
});

function typeConfigOf(fileByPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-kind-'));
  for (const [rel, text] of Object.entries(fileByPath)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return typeDeclaredConfigGet(
    [{ alias: 'page', entryFile: path.join(dir, 'page/.doc-page/entry.yaml') }],
    [{ name: 'media', dir: path.join(dir, 'media') }],
    dir,
  );
}

test('in the registry: a kind a type declares is a type below frontend.item; the kinds a type holds are resolved', () => {
  const config = typeConfigOf({
    'media/type.yaml': [
      'typeList:',
      '  - id: media.library',
      '    label: Media library',
      '    kindList:',
      '      - { id: image, label: Image, content: { form: bytes, mediaTypeList: [image/*] }, isHeld: false }',
      '      - { id: photo, label: Photo, extendList: [media.library.image] }',
      '',
    ].join('\n'),
    'page/.doc-page/type.yaml': [
      'typeList:',
      '  - id: demo.shelf',
      '    kindList:',
      '      - id: book',
      '        content:',
      '          form: data',
      '          schema: { type: object, required: [title], properties: { title: { type: string } } }',
      '        groupPath: book',
      '      - { id: cover, kind: media.library.image, groupPath: cover, label: Cover }',
      '      - { id: lost, kind: media.library.nothing }',
      '      - { id: page, content: { form: data }, isDoc: true }',
      '  - id: demo.shelf-short',
      '    extendList: [demo.shelf]',
      '  - id: demo.former',
      '    assetKindList:',
      '      - { id: note, langList: [md], isDoc: true }',
      '',
    ].join('\n'),
  });
  const typeById = new Map(config.typeList.map((type) => [type.id, type]));
  // the kinds, types of their own, each declared by one type
  for (const kindId of ['demo.shelf.book', 'demo.shelf.page', 'media.library.image', 'media.library.photo', 'demo.former.note']) {
    assert.ok(typeById.has(kindId), kindId);
  }
  assert.deepEqual(typeById.get('media.library.image').extendList, ['frontend.item']);
  assert.equal(typeById.get('media.library.image').declaredBy, 'media.library');
  assert.deepEqual(typeById.get('media.library.photo').extendList, ['media.library.image']);
  // held: its own, one of another type (its content theirs, its label its own), one nobody declares
  const kindList = objectFrontendKindListResolve('demo.shelf-short', config.typeList);
  assert.deepEqual(kindList.map((one) => [one.id, one.kindId, one.isOwn, one.declaredBy, one.content.form]), [
    ['book', 'demo.shelf.book', true, 'demo.shelf', 'data'],
    ['cover', 'media.library.image', false, 'media.library', 'bytes'],
    ['lost', 'media.library.nothing', false, '', 'any'],
    ['page', 'demo.shelf.page', true, 'demo.shelf', 'data'],
  ]);
  assert.equal(kindList[1].label, 'Cover');
  assert.equal(kindList[2].isKindMissing, true);
  assert.equal(kindList[3].isDoc, undefined, 'data cannot be a document');
  // a type holds what it does not offer only: the image is offered, the photo held, with the content
  // of the image it extends (its declaration says none of its own)
  assert.deepEqual(objectFrontendKindListResolve('media.library', config.typeList).map((one) => [one.id, one.content]), [['photo', { form: 'bytes', mediaTypeList: ['image/*'] }]]);
  assert.deepEqual(typeById.get('media.library.photo').content, undefined);
  // the former grammar: read, its langList a content, and said
  assert.deepEqual(objectFrontendKindListResolve('demo.former', config.typeList)[0].content, { form: 'text', langList: ['md'] });
  const messageList = config.problemList.map((problem) => problem.message);
  assert.ok(messageList.some((message) => /media.library.nothing \(held as lost\) is declared by no type/.test(message)));
  assert.ok(messageList.some((message) => /demo.shelf.page \(held as page\) is data/.test(message)));
  assert.ok(messageList.some((message) => /"assetKindList" is the former name of "kindList"/.test(message)));
  // what a type holds decides, with the schema of its kind
  assert.equal(objectFrontendAssetAcceptCheck(kindList, { kind: 'book', lang: 'yaml', text: 'title: Dune\n' }).message, '');
  assert.match(objectFrontendAssetAcceptCheck(kindList, { kind: 'book', lang: 'yaml', text: 'author: x\n' }).message, /book \(demo.shelf.book\) does not fit it: the key title is missing/);
  assert.match(objectFrontendAssetAcceptCheck(kindList, { kind: 'cover', lang: '', contentType: 'application/pdf' }).message, /not application\/pdf/);
  assert.equal(objectFrontendAssetAcceptCheck(kindList, { kind: 'cover', lang: '', contentType: 'image/png' }).message, '');
  // a held kind of a content nobody checks: anything
  assert.equal(objectFrontendAssetAcceptCheck(kindList, { kind: 'lost', lang: 'md', text: '# a' }).message, '');
});

test('a kind a type keeps to itself: held by it and the types extending it, registered nowhere, refused to others', () => {
  const config = typeConfigOf({
    'media/type.yaml': 'typeList: []\n',
    'page/.doc-page/type.yaml': [
      'typeList:',
      '  - id: demo.shelf',
      '    kindList:',
      '      - { id: book, content: data }',
      '      - { id: note, content: { form: data, schema: { type: object, required: [text] } }, isInternal: true }',
      '  - id: demo.shelf-own',
      '    extendList: [demo.shelf]',
      '    kindList:',
      '      - { id: remark, kind: demo.shelf.note }',
      '      - { id: book, kind: demo.shelf.book }',
      '  - id: demo.other',
      '    kindList:',
      '      - { id: note, kind: demo.shelf.note }',
      '      - { id: draft, extendList: [demo.shelf.note] }',
      '',
    ].join('\n'),
  });
  const idList = config.typeList.map((type) => type.id);
  assert.ok(idList.includes('demo.shelf.book'));
  assert.ok(!idList.includes('demo.shelf.note'), 'an internal kind is no type of the registry');
  const shelf = objectFrontendKindListResolve('demo.shelf', config.typeList);
  assert.deepEqual(shelf.map((one) => [one.id, one.isInternal === true, one.content.form]), [['book', false, 'data'], ['note', true, 'data']]);
  // the type extending it may hold it under a name of its own, its schema checked the same way
  const own = objectFrontendKindListResolve('demo.shelf-own', config.typeList);
  assert.deepEqual(own.map((one) => [one.id, one.kindId, one.isKindMissing === true]), [['remark', 'demo.shelf.note', false], ['book', 'demo.shelf.book', false]]);
  assert.match(objectFrontendAssetAcceptCheck(own, { kind: 'remark', lang: 'yaml', text: 'x: 1\n' }).message, /the key text is missing/);
  // another type may neither hold it nor extend it
  const other = objectFrontendKindListResolve('demo.other', config.typeList);
  assert.equal(other[0].isKindMissing, true);
  const messageList = config.problemList.map((problem) => problem.message);
  assert.ok(messageList.some((message) => /demo.shelf.note \(held as note\) is internal to demo.shelf/.test(message)));
  assert.ok(messageList.some((message) => /demo.other.draft extends demo.shelf.note, which is no kind it may extend/.test(message)));
});
