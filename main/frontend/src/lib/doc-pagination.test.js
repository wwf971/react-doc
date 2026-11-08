import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pageSpecNormalize, paginationBreakLastFitting, paginationEngineGet, paginationPlan, paginationPrintCssBuild, paginationTextCutGet, pieceListKeyed,
} from './doc-pagination.js';
import { dataUrlBytesGet, pdfFromJpegListBuild } from './doc-pagination-pdf.js';

// a table of rows of 10px under a head of 5px: its measure, and a split by rows
const tableMeasure = (data) => ({
  height: 5 + data.rowList.length * 10 + 1,
  breakList: data.rowList.map((row, index) => ({ key: row, top: 5 + index * 10, bottom: 5 + (index + 1) * 10 })),
});
const tableType = {
  isFilledOnSplit: true,
  split: (data, { space, measured }) => {
    const found = paginationBreakLastFitting(measured, space, 1);
    if (!found) return null;
    const at = data.rowList.indexOf(found.key) + 1;
    return { head: { rowList: data.rowList.slice(0, at) }, tail: { rowList: data.rowList.slice(at) }, breakKey: found.key };
  },
};
const typeGet = (type) => (type === 'table' ? tableType : {});

// runs the planner as the environment does: measure what it asks for, plan again
function planRun(pieceList, contentHeight, measure) {
  const measuredByKey = new Map();
  let plan;
  for (let round = 0; round < 20; round += 1) {
    plan = paginationPlan({ pieceList, measuredGet: (key) => measuredByKey.get(key), typeGet, contentHeight });
    if (plan.isDone) return { plan, round };
    for (const piece of plan.needList) measuredByKey.set(piece.key, measure(piece));
  }
  throw new Error('the plan never settles');
}

test('pieces stack on a page until one does not fit; a split one goes on in the next page', () => {
  const measure = (piece) => (piece.type === 'table' ? tableMeasure(piece.data) : { height: piece.data.height });
  const pieceList = pieceListKeyed([
    { type: 'block', data: { height: 40 } },
    { type: 'table', data: { rowList: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] } },
    { type: 'block', data: { height: 30 } },
  ]);
  // every piece measured once first, as the environment does
  const measuredByKey = new Map(pieceList.map((piece) => [piece.key, measure(piece)]));
  let plan;
  for (let round = 0; round < 10; round += 1) {
    plan = paginationPlan({ pieceList, measuredGet: (key) => measuredByKey.get(key), typeGet, contentHeight: 100 });
    if (plan.isDone) break;
    for (const piece of plan.needList) measuredByKey.set(piece.key, measure(piece));
  }
  assert.equal(plan.isDone, true);
  assert.deepEqual(plan.pageList.map((page) => page.pieceList.map((piece) => piece.type === 'table' ? piece.data.rowList.join('') : piece.data.height)), [[40, 'abcde'], ['fgh', 30]]);
  // the head is drawn to the bottom of the page: 100 - 40 - its 56px
  assert.equal(plan.pageList[0].pieceList[1].layout.fillHeight, 4);
  assert.equal(plan.pageList[1].pieceList[0].layout.isPageTop, true);
  assert.equal(plan.pageList[1].pieceList[0].top, 0);
});

test('a head measured taller than the split thought is cut again, smaller', () => {
  // the head carries 12px more than its rows (a repeated heading): the first cut overflows
  const measure = (piece) => (piece.key.endsWith(':head') ? { ...tableMeasure(piece.data), height: tableMeasure(piece.data).height + 12 } : tableMeasure(piece.data));
  const pieceList = pieceListKeyed([{ type: 'table', data: { rowList: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] } }]);
  const { plan } = planRun(pieceList, 60, measure);
  for (const page of plan.pageList) for (const piece of page.pieceList) assert.ok(piece.height <= 60.75, `${piece.key} ${piece.height}`);
  assert.deepEqual(plan.pageList.flatMap((page) => page.pieceList.map((piece) => piece.data.rowList.join(''))).join(''), 'abcdefghij');
});

test('what cannot be split goes to the next page; taller than a page, it is placed and reported', () => {
  const measure = (piece) => ({ height: piece.data.height });
  const { plan } = planRun(pieceListKeyed([{ type: 'block', data: { height: 60 } }, { type: 'block', data: { height: 50 } }, { type: 'block', data: { height: 150 } }]), 100, measure);
  assert.deepEqual(plan.pageList.map((page) => page.pieceList.map((piece) => piece.data.height)), [[60], [50], [150]]);
  assert.match(plan.problemList[0], /more than a page/);
});

test('keys: by type and data, repeated data numbered; a page spec in mm', () => {
  const [a, b, c] = pieceListKeyed([{ type: 't', data: { x: 1 } }, { type: 't', data: { x: 1 } }, { type: 't', data: { x: 2 } }]);
  assert.notEqual(a.key, b.key);
  assert.equal(b.key, `${a.key}#1`);
  assert.notEqual(a.key, c.key);
  assert.deepEqual(pageSpecNormalize({ margin: { top: 20 } }).contentHeight, 297 - 20 - 10);
});

test('a text is cut after the last line that fits', () => {
  const measured = { height: 80, textList: [{ key: 'text', lineList: [{ offset: 0, top: 10, bottom: 30 }, { offset: 12, top: 30, bottom: 50 }, { offset: 25, top: 50, bottom: 70 }] }] };
  assert.deepEqual(paginationTextCutGet(measured, 'text', 55, 4), { offset: 25 });
  assert.equal(paginationTextCutGet(measured, 'text', 20, 4), undefined);
  assert.equal(paginationTextCutGet(measured, 'text', 90, 4), undefined);
});

test('printing: the engine of a browser, a stylesheet of its own', () => {
  assert.equal(paginationEngineGet('Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/120.0'), 'gecko');
  assert.equal(paginationEngineGet('Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0 Safari/537.36'), 'blink');
  assert.equal(paginationEngineGet('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'), 'webkit');
  assert.match(paginationPrintCssBuild({}, 'blink'), /@page \{ size: 210mm 297mm; margin: 0; \}/);
  assert.match(paginationPrintCssBuild({}, 'blink'), /height: 297mm/);
  assert.match(paginationPrintCssBuild({}, 'gecko'), /height: 296.6mm/);
});

test('a pdf of page images: its objects where the cross-reference says', () => {
  const jpeg = dataUrlBytesGet('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==');
  const bytes = pdfFromJpegListBuild([{ jpegBytes: jpeg, widthPx: 10, heightPx: 14 }, { jpegBytes: jpeg, widthPx: 10, heightPx: 14 }]);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Count 2/);
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(xrefAt).startsWith('xref'));
  const offsetList = text.slice(xrefAt).split('\n').slice(3, 11).map((line) => Number(line.slice(0, 10)));
  offsetList.forEach((offset, index) => assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj`), `object ${index + 1}`));
});
