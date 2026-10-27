import test from 'node:test';
import assert from 'node:assert/strict';
import {
  testCaseAssetDependencyListGet,
  testCaseDependenciesCollect,
  testCaseResultAppend,
  testCaseSourceDefaultCreate,
  testCaseTableParse,
  testCaseTimeFormat,
} from './TestCaseTableData.js';
import { testCaseAssetWriteCheck } from './TestCaseTableApi.js';
import { tableHierarchyRowsBuild } from '../hierarchy/table-hierarchy/TableHierarchyData.js';

const raw = testCaseSourceDefaultCreate().raw;
const change = { caseId: 'case-1', testerId: 'reviewer', operator: 'Test operator', result: 'OK', timeTimezone: 540 };
const clock = { time: Date.UTC(2026, 4, 20, 14, 25, 5, 307), id: 'event-1' };

test('the test cases are a hierarchy table with one managed confirmation column per tester, after the authored ones', () => {
  const parsed = testCaseTableParse(raw);
  assert.deepEqual(parsed.hierarchy.columns.map((column) => column.id), ['description', 'confirmation:reviewer']);
  assert.equal(parsed.hierarchy.columns[1].label, 'Reviewer');
  assert.deepEqual(parsed.hierarchy.rows[0].children[0].cells['confirmation:reviewer'].data, { caseId: 'case-1', testerId: 'reviewer' });
  // the grouping of TableHierarchy is kept: a collapsed group hides its cases
  assert.equal(tableHierarchyRowsBuild(parsed.hierarchy.rows).rows.length, 2);
  assert.equal(tableHierarchyRowsBuild(parsed.hierarchy.rows, { 'rows[0]': false }).rows.length, 1);
  // no authored column at all is fine: the testers alone
  assert.doesNotThrow(() => testCaseTableParse(raw.replace('columns:\n  - { id: description, label: Description, width: 22rem }\n', '').replace('          description: Confirm the expected initial state.\n', '')));
  assert.throws(() => testCaseTableParse(raw.replace('id: case-1', 'id: basic')), /unique/);
  assert.throws(() => testCaseTableParse(raw.replace('id: case-1', 'id: __proto__')), /reserved/);
  assert.throws(() => testCaseTableParse(raw.replace('id: description', 'id: confirmation:x')), /reserved for the testers/);
  assert.throws(() => testCaseTableParse(raw.replace('version: 1', 'version: 2')), /version: 1/);
});

test('a result is appended with the operator and the time given; clearing keeps the history, the comments stay', () => {
  const first = testCaseResultAppend(`# Keep\n${raw}`, { ...change, time: 0 }, clock);
  assert.equal(first.entry.time, clock.time);
  assert.equal(first.entry.id, 'event-1');
  const second = testCaseResultAppend(first.text, { ...change, operator: 'Another operator', result: null }, { ...clock, id: 'event-2' });
  const history = testCaseTableParse(second.text).results['case-1'].reviewer;
  assert.deepEqual(history.map((entry) => entry.result), ['OK', null]);
  assert.deepEqual(history.map((entry) => entry.operator), ['Test operator', 'Another operator']);
  assert.match(second.text, /^# Keep/);
  assert.throws(() => testCaseResultAppend(raw, { ...change, operator: ' ' }, clock), /operator/);
  assert.throws(() => testCaseResultAppend(raw, { ...change, result: undefined }, clock), /result/);
  assert.throws(() => testCaseResultAppend(raw, { ...change, caseId: 'basic' }, clock), /Unknown/);
  assert.throws(() => testCaseResultAppend(raw, { ...change, timeTimezone: 900 }, clock), /minutes/);
  // a history written without a results key starts one
  const third = testCaseResultAppend(raw.replace('results: {}\n', ''), change, clock);
  assert.equal(testCaseTableParse(third.text).results['case-1'].reviewer.length, 1);
});

test('evidence is kept as the document identity the resolver answers, or refused', () => {
  assert.throws(() => testCaseResultAppend(raw, { ...change, evidence: 'missing.md' }, clock), /Evidence/);
  assert.throws(() => testCaseResultAppend(raw, { ...change, evidence: 'missing.md' }, { ...clock, evidenceResolve: () => undefined }), /Evidence/);
  const result = testCaseResultAppend(raw, { ...change, evidence: 'evidence.md' }, { ...clock, evidenceResolve: () => '~wiki:docs/evidence.md' });
  assert.equal(result.entry.evidence, '~wiki:docs/evidence.md');
  // an empty evidence is none
  assert.equal(testCaseResultAppend(raw, { ...change, evidence: '' }, clock).entry.evidence, undefined);
});

test('the time keeps its milliseconds; the text shows hundredths and a whole-hour zone, else UTC', () => {
  assert.equal(testCaseTimeFormat(clock.time, 540), '20260520_23250530+09');
  assert.equal(testCaseTimeFormat(clock.time, -300), '20260520_09250530-05');
  assert.equal(testCaseTimeFormat(clock.time, 330), '20260520_14250530+00');
  assert.throws(() => testCaseTimeFormat(clock.time, 5.5), /minutes/);
});

test('the evidence of every record is a dependency, of the build and of the asset object', () => {
  const first = testCaseResultAppend(raw, { ...change, evidence: 'evidence.md' }, { ...clock, evidenceResolve: () => '~wiki:docs/evidence.md' });
  const second = testCaseResultAppend(first.text, { ...change, result: null }, { ...clock, id: 'event-2' });
  const targetList = [];
  const componentList = [];
  testCaseDependenciesCollect({ raw: second.text }, {
    dependencyAdd: (target, kind) => targetList.push([target, kind]),
    componentCollect: (name, data) => componentList.push([name, data]),
  });
  assert.deepEqual(targetList, [['~wiki:docs/evidence.md', 'source']]);
  assert.deepEqual(componentList, []);
  assert.deepEqual(testCaseAssetDependencyListGet({ raw: second.text }), [{ type: 'source', path: '~wiki:docs/evidence.md' }]);
  assert.deepEqual(testCaseAssetDependencyListGet({ raw: 'not: a table' }), []);
  // a cell component of an authored column is collected
  const rawCell = raw.replace('- { id: description, label: Description, width: 22rem }', '- { id: description, label: Description, cellComponent: TextInfoCell }');
  const componentListCell = [];
  testCaseDependenciesCollect({ raw: rawCell }, { dependencyAdd: () => {}, componentCollect: (name) => componentListCell.push(name) });
  assert.deepEqual(componentListCell, ['TextInfoCell']);
});

test('the generic write check refuses a changed history and passes everything else', () => {
  const first = testCaseResultAppend(raw, change, clock);
  // a structural edit keeping the history
  assert.doesNotThrow(() => testCaseAssetWriteCheck(first.text, first.text.replace('label: Initial display', 'label: First display')));
  // the history rewritten, removed, or made up
  assert.throws(() => testCaseAssetWriteCheck(first.text, raw), /managed/);
  assert.throws(() => testCaseAssetWriteCheck(raw, first.text), /managed/);
  assert.throws(() => testCaseAssetWriteCheck(first.text, first.text.replace('Test operator', 'Someone else')), /managed/);
  // texts that are not test case tables, valid yaml or not
  assert.doesNotThrow(() => testCaseAssetWriteCheck('*not-a-yaml-alias', 'arbitrary: [unclosed'));
  assert.doesNotThrow(() => testCaseAssetWriteCheck('{"a":1}', '{"a":2}'));
  // a table replacing another kind of text, with an authored history, is a new table
  assert.throws(() => testCaseAssetWriteCheck('notes', first.text), /managed/);
  assert.doesNotThrow(() => testCaseAssetWriteCheck('notes', raw));
});
