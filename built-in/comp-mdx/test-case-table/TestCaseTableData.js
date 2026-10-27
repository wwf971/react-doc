import { yamlDocumentParse } from '../../../main/frontend/src/lib/yaml.js';
import { tableHierarchyDataParse } from '../hierarchy/table-hierarchy/TableHierarchyData.js';

// The data of a TestCaseTable (comp_test_case_table.md): a hierarchy table
// of test cases, with one confirmation column per tester and a managed
// result history. Pure: parsing, the append of one result, the time text,
// the default source, the build-time dependencies. Shared by the component
// (browser), the asset api of the development server (TestCaseTableApi.js)
// and the vite plugin (the dependency collector), so it imports nothing of
// React or of the browser.
//
//   type: test-case-table        version: 1
//   columns   the authored columns (TableHierarchy columns; may be empty)
//   testers   [{ id, name, width? }]: one confirmation column each, after
//             the authored ones, with the column id confirmation:{testerId}
//   rows      TableHierarchy rows, every row with a stable id; a leaf is a
//             test case, a row with children a group
//   results   { [caseId]: { [testerId]: [entry, ...] } }: the history of a
//             cell, oldest first; its last entry is the current result.
//             entry: { id, result: 'OK' | 'NG' | null, operator, time
//             (epoch ms), timeTimezone (minutes east of UTC), evidence? }
//
// the history is managed: a result is appended (testCaseResultAppend) and
// never edited or removed by the page; clearing appends a null result. the
// asset api refuses a generic head write that changes it
// (TestCaseTableApi.js testCaseAssetWriteCheck).

export const TEST_CASE_COLUMN_PREFIX = 'confirmation:';
const keyReservedList = ['__proto__', 'constructor', 'prototype'];

function textRequired(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`TestCaseTable ${field} must be a non-empty string.`);
  return value.trim();
}

function mappingCheck(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`TestCaseTable ${field} must be a mapping.`);
}

function idCheck(value, field, idSet) {
  const id = textRequired(value, field);
  if (id !== value || idSet.has(id) || keyReservedList.includes(id)) {
    throw new Error(`TestCaseTable ${field} must be unique, without surrounding spaces, and not a reserved key: ${id}.`);
  }
  idSet.add(id);
  return id;
}

function resultCheck(result) {
  if (result !== null && result !== 'OK' && result !== 'NG') throw new Error('TestCaseTable result must be OK, NG, or null.');
}

function timezoneCheck(value) {
  if (!Number.isInteger(value) || value < -840 || value > 840) {
    throw new Error('TestCaseTable timeTimezone must be an integer UTC offset in minutes (-840 to 840).');
  }
}

// the text parsed and checked: { document (the yaml Document, for a write
// back with the comments kept), raw, value, hierarchy (the TableHierarchy
// data with the confirmation columns), caseIdSet, testerIdSet, results }
export function testCaseTableParse(raw) {
  const text = String(raw ?? '');
  const document = yamlDocumentParse(text);
  if (document.errors.length) throw new Error(document.errors[0].message);
  const value = document.toJS();
  mappingCheck(value, 'data');
  if (value.type !== 'test-case-table' || value.version !== 1) {
    throw new Error('TestCaseTable requires type: test-case-table and version: 1.');
  }
  if (!Array.isArray(value.testers) || !value.testers.length) throw new Error('TestCaseTable testers must be a non-empty list.');
  const testerIdSet = new Set();
  for (const tester of value.testers) {
    mappingCheck(tester, 'tester');
    idCheck(tester.id, 'tester.id', testerIdSet);
    textRequired(tester.name, 'tester.name');
  }
  const columns = value.columns ?? [];
  if (!Array.isArray(columns)) throw new Error('TestCaseTable columns must be a list.');
  if (columns.some((column) => String(column?.id ?? '').startsWith(TEST_CASE_COLUMN_PREFIX))) {
    throw new Error(`TestCaseTable column ids starting with ${TEST_CASE_COLUMN_PREFIX} are reserved for the testers.`);
  }
  const caseIdSet = new Set();
  const rowIdSet = new Set();
  const rowsVisit = (rows) => {
    if (!Array.isArray(rows)) throw new Error('TestCaseTable rows must be a list.');
    return rows.map((row) => {
      mappingCheck(row, 'row');
      const id = idCheck(row.id, 'row.id', rowIdSet);
      if (row.children) return { ...row, children: rowsVisit(row.children) };
      caseIdSet.add(id);
      // the confirmation cells carry their place, read by the cell renderer
      const cellsConfirmation = Object.fromEntries(value.testers.map((tester) => [
        `${TEST_CASE_COLUMN_PREFIX}${tester.id}`,
        { data: { caseId: id, testerId: tester.id }, value: null },
      ]));
      return { ...row, cells: { ...(row.cells ?? {}), ...cellsConfirmation } };
    });
  };
  const hierarchy = tableHierarchyDataParse({
    ...value,
    columns: [
      ...columns,
      ...value.testers.map((tester) => ({ id: `${TEST_CASE_COLUMN_PREFIX}${tester.id}`, label: tester.name, width: tester.width ?? '9rem' })),
    ],
    rows: rowsVisit(value.rows),
  });
  const results = value.results ?? {};
  mappingCheck(results, 'results');
  const entryIdSet = new Set();
  for (const [caseId, cells] of Object.entries(results)) {
    if (!caseIdSet.has(caseId)) throw new Error(`TestCaseTable results name an unknown test case: ${caseId}.`);
    mappingCheck(cells, `results.${caseId}`);
    for (const [testerId, history] of Object.entries(cells)) {
      if (!testerIdSet.has(testerId)) throw new Error(`TestCaseTable results.${caseId} name an unknown tester: ${testerId}.`);
      if (!Array.isArray(history)) throw new Error(`TestCaseTable results.${caseId}.${testerId} must be a list.`);
      for (const entry of history) {
        mappingCheck(entry, 'history entry');
        const id = textRequired(entry.id, 'history entry id');
        if (entryIdSet.has(id)) throw new Error(`TestCaseTable history entry ids must be unique: ${id}.`);
        entryIdSet.add(id);
        resultCheck(entry.result);
        textRequired(entry.operator, 'operator');
        if (!Number.isSafeInteger(entry.time) || entry.time < 0) throw new Error('TestCaseTable time must be epoch milliseconds, a safe integer.');
        timezoneCheck(entry.timeTimezone);
        if (entry.evidence !== undefined) textRequired(entry.evidence, 'evidence');
      }
    }
  }
  return { document, raw: text, value, hierarchy, caseIdSet, testerIdSet, results };
}

// the current result of a cell and its history
export function testCaseCellGet(parsed, caseId, testerId) {
  const history = parsed.results[caseId]?.[testerId] ?? [];
  return { history, entryLast: history.at(-1), result: history.at(-1)?.result ?? null };
}

// one result appended to the history of a cell, the text written back with
// the comments and the order of the data kept: { text, entry }.
//   change    { caseId, testerId, result, operator, timeTimezone?, evidence? }
//   options   time (epoch ms) and id of the entry: made by the caller (the
//             server), so a record says when it was recorded there;
//             evidenceResolve(reference): the source path of the document
//             the evidence names, or undefined when it names none (the
//             entry is then refused)
export function testCaseResultAppend(raw, change, { time = Date.now(), id = globalThis.crypto.randomUUID(), evidenceResolve } = {}) {
  const parsed = testCaseTableParse(raw);
  const { caseId, testerId, result } = change;
  if (!parsed.caseIdSet.has(caseId) || !parsed.testerIdSet.has(testerId)) throw new Error('TestCaseTable: Unknown test case or tester.');
  resultCheck(result);
  const operator = textRequired(change.operator, 'operator');
  const timeTimezone = change.timeTimezone ?? 0;
  timezoneCheck(timeTimezone);
  const entry = { id, result, operator, time, timeTimezone };
  if (change.evidence !== undefined && change.evidence !== '') {
    const evidence = textRequired(change.evidence, 'evidence');
    const resolved = evidenceResolve?.(evidence);
    if (!resolved) throw new Error('Evidence must name one md/mdx document of the doc page the table is in.');
    entry.evidence = resolved;
  }
  const history = parsed.results[caseId]?.[testerId] ?? [];
  parsed.document.setIn(['results', caseId, testerId], parsed.document.createNode([...history, entry]));
  const text = String(parsed.document);
  testCaseTableParse(text);
  return { text, entry };
}

// the time of an entry as the page writes times (time-format.md):
// YYYYMMDD_HHmmssff+HH, the instant in the zone of the record, to 10 ms.
// an offset that is not whole hours cannot be written in that form: the
// instant is shown in UTC (+00) and the offset stays to be shown beside it
export function testCaseTimeFormat(time, timeTimezone = 0) {
  timezoneCheck(timeTimezone);
  const offset = timeTimezone % 60 === 0 ? timeTimezone : 0;
  const date = new Date(time + offset * 60000);
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}${pad(Math.floor(date.getUTCMilliseconds() / 10))}`
    + `${offset < 0 ? '-' : '+'}${pad(Math.abs(offset / 60))}`;
}

export function testCaseSourceDefaultCreate() {
  return {
    lang: 'yaml',
    raw: `type: test-case-table
version: 1
title: Test cases
rowHeader: Test case
groupDisplay: row
columns:
  - { id: description, label: Description, width: 22rem }
testers:
  - { id: reviewer, name: Reviewer }
rows:
  - id: basic
    label: Basic checks
    children:
      - id: case-1
        label: Initial display
        cells:
          description: Confirm the expected initial state.
results: {}
`,
  };
}

// the evidence documents of every recorded result, each once
export function testCaseEvidenceListGet(parsed) {
  const evidenceSet = new Set();
  for (const cells of Object.values(parsed.results)) {
    for (const history of Object.values(cells)) {
      for (const entry of history) if (entry.evidence) evidenceSet.add(entry.evidence);
    }
  }
  return [...evidenceSet];
}

// compDefine assetDependencyListGet: what an asset object made from the
// data depends on (doc_page_impl_asset.md#dependencies): the evidence
// documents, which the page resolves against the document
export function testCaseAssetDependencyListGet(data) {
  let parsed;
  try {
    parsed = testCaseTableParse(data.raw ?? '');
  } catch {
    return [];
  }
  return testCaseEvidenceListGet(parsed).map((path) => ({ type: 'source', path }));
}

// the build-time collector (registry-source-dependency.js): the evidence of
// every result of the history, so a document an old record refers to stays
// in a build, and the registered components of the cells
export function testCaseDependenciesCollect(data, context) {
  let parsed;
  try {
    parsed = testCaseTableParse(data.raw ?? '');
  } catch (error) {
    context.warn?.(`TestCaseTable data is invalid, its evidence is not discovered: ${String(error?.message ?? error)}`);
    return;
  }
  for (const evidence of testCaseEvidenceListGet(parsed)) context.dependencyAdd(evidence, 'source');
  const collect = (cell, component) => {
    const name = cell?.component || component;
    if (name) context.componentCollect(name, { value: cell?.value, ...cell?.data });
  };
  if (parsed.hierarchy.headerRight) collect(parsed.hierarchy.headerRight);
  const visit = (rows) => rows.forEach((row) => {
    collect(row.labelCell);
    if (row.children) visit(row.children);
    else for (const column of parsed.hierarchy.columns) collect(row.cells[column.id], column.cellComponent);
  });
  visit(parsed.hierarchy.rows);
}
