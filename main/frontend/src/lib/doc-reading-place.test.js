import assert from 'node:assert/strict';
import test from 'node:test';
import { readingPlaceBuild, readingPlaceScrollTopResolve } from './doc-reading-place.js';

// a reading place (doc_page_impl_nav.md#reading-places) says where the reader
// is by the structure of the document: the section, the block at the reading
// line, how far into it; it is resolved again from the blocks as they are, so
// blocks that grew, shrank, came or went above it do not move the reader.

// blocks laid out one after another: [text, height, headingId?]
function blockListBuild(specList, top = 0) {
  const blockList = [];
  let position = top;
  for (const [text, height, headingId = ''] of specList) {
    blockList.push({ top: position, height, text, headingId });
    position += height;
  }
  return blockList;
}

const READING_OFFSET = 100;
const options = { readingOffset: READING_OFFSET, scrollMax: 100000 };

const documentSpec = [
  ['Intro paragraph', 100],
  ['Setup', 40, 'setup'],
  ['Install the package', 120],
  ['Run the server', 200],
  ['Usage', 40, 'usage'],
  ['Open a document', 300],
  ['Edit a block', 150],
];

test('a place names the section, the block at the reading line and the offset into it', () => {
  const blockList = blockListBuild(documentSpec);
  // the reading line at 260 + 100 = 360: 100 px into "Run the server" (top 260)
  const place = readingPlaceBuild(blockList, 260, READING_OFFSET);
  assert.equal(place.headingId, 'setup');
  assert.equal(place.blockText, 'Run the server');
  assert.equal(place.blockIndexInSection, 2);
  assert.equal(place.offsetPx, 100);
  assert.equal(place.sectionOffsetPx, 360 - 100);
  assert.deepEqual(readingPlaceBuild(blockList, 0, READING_OFFSET), { isTop: true, scrollTop: 0 });
  // before the first heading: the section is '' and counts from the top
  const placeIntro = readingPlaceBuild(blockList, 10, 20);
  assert.equal(placeIntro.headingId, '');
  assert.equal(placeIntro.blockText, 'Intro paragraph');
});

test('resolved on the same document, the place gives the same offset', () => {
  const blockList = blockListBuild(documentSpec);
  for (const scrollTop of [10, 200, 360, 555, 800]) {
    const place = readingPlaceBuild(blockList, scrollTop, READING_OFFSET);
    assert.equal(readingPlaceScrollTopResolve(blockList, place, options), scrollTop, `scrollTop ${scrollTop}`);
  }
});

test('blocks above that grew or went away do not move the reader off the block', () => {
  const place = readingPlaceBuild(blockListBuild(documentSpec), 260, READING_OFFSET);
  // the intro grew by 500 px (a component drew its data), "Install" was deleted
  const blockListChanged = blockListBuild([
    ['Intro paragraph', 600],
    ['Setup', 40, 'setup'],
    ['Run the server', 200],
    ['Usage', 40, 'usage'],
    ['Open a document', 300],
  ]);
  // "Run the server" now at 640: the line 100 px into it
  assert.equal(readingPlaceScrollTopResolve(blockListChanged, place, options), 640 + 100 - READING_OFFSET);
});

test('a block of another height keeps the same fraction of it', () => {
  const place = readingPlaceBuild(blockListBuild(documentSpec), 260, READING_OFFSET);
  const blockListTaller = blockListBuild(documentSpec.map(([text, height, id]) => [text, text === 'Run the server' ? 400 : height, id]));
  // 100 of 200 px -> 200 of 400 px
  assert.equal(readingPlaceScrollTopResolve(blockListTaller, place, options), 260 + 200 - READING_OFFSET);
});

test('a block whose text changed: the section keeps the reader, at the same distance below its heading', () => {
  const place = readingPlaceBuild(blockListBuild(documentSpec), 260, READING_OFFSET);
  const blockListRewritten = blockListBuild([
    ['Intro paragraph', 100],
    ['Setup', 40, 'setup'],
    ['Install the package', 120],
    ['Start the development server', 200],
    ['Usage', 40, 'usage'],
  ]);
  assert.equal(readingPlaceScrollTopResolve(blockListRewritten, place, options), 100 + place.sectionOffsetPx - READING_OFFSET);
});

test('a section that moved: its block is found by its text in another section', () => {
  const place = readingPlaceBuild(blockListBuild(documentSpec), 260, READING_OFFSET);
  const blockListMoved = blockListBuild([
    ['Intro paragraph', 100],
    ['Running', 40, 'running'],
    ['Run the server', 200],
    ['Usage', 40, 'usage'],
  ]);
  assert.equal(readingPlaceScrollTopResolve(blockListMoved, place, options), 140 + 100 - READING_OFFSET);
});

test('nothing left of the place: the offset, kept inside the document', () => {
  const place = readingPlaceBuild(blockListBuild(documentSpec), 800, READING_OFFSET);
  const blockListOther = blockListBuild([['Another text', 300]]);
  assert.equal(readingPlaceScrollTopResolve(blockListOther, place, { readingOffset: READING_OFFSET, scrollMax: 250 }), 250);
  assert.equal(readingPlaceScrollTopResolve(blockListOther, { isTop: true, scrollTop: 0 }, options), 0);
  assert.equal(readingPlaceScrollTopResolve(blockListOther, undefined, options), 0);
});

test('blocks without text (an image) are found by their index in the section', () => {
  const spec = [['Gallery', 40, 'gallery'], ['', 300], ['', 300], ['Caption', 40]];
  const place = readingPlaceBuild(blockListBuild(spec), 500, READING_OFFSET);
  assert.equal(place.blockIndexInSection, 2);
  const blockListShifted = blockListBuild([['New intro', 200], ...spec]);
  assert.equal(readingPlaceScrollTopResolve(blockListShifted, place, options), 200 + 500);
});

test('a line in the margin after a block stays as far below its end', () => {
  // blocks with a 24 px margin between them: the line falls in a margin
  const blockList = [
    { top: 0, height: 100, text: 'First', headingId: '' },
    { top: 124, height: 100, text: 'Second', headingId: '' },
  ];
  const place = readingPlaceBuild(blockList, 15, READING_OFFSET);
  assert.equal(place.blockText, 'First');
  assert.equal(place.offsetPx, 115);
  const blockListGrown = [
    { top: 0, height: 300, text: 'First', headingId: '' },
    { top: 324, height: 100, text: 'Second', headingId: '' },
  ];
  assert.equal(readingPlaceScrollTopResolve(blockListGrown, place, options), 300 + 15 - READING_OFFSET);
});
