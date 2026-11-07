import { apiDefine } from '../../../main/frontend/src/lib/doc-api.js';
import { compIdResolve } from '../../../main/comp-doc/registry/comp-registry.js';
import { blockDataGet, blockLocate, docModelEnsure } from '../../../main/comp-doc/api/api-doc.js';
import { testCaseCellGet, testCaseTableParse } from './TestCaseTableData.js';

// The apis TestCaseTable exposes to the unified api registry
// (doc_page_impl_api.md#the-apis-of-a-component), registered as
// common/TestCaseTable/tableGet and common/TestCaseTable/resultRecord while
// the component is in the registry. They are what an AI agent that checked
// a feature needs: read the cases of a table and record a result, through
// the page, so the record is made as a click on a cell would make it (the
// same event, assetTestCaseResultRequest, the same route of the asset
// domain, the same checks on the server).
//
// the table is located like any block (api-doc.js blockLocate): by its
// index, or by the id of its marker; without "block", the first table of
// the document. the browser side only; the server side of the history is
// TestCaseTableApi.js.

const blockParam = { name: 'block', type: 'any', description: 'the table: the index of its block, or the id of its component (id=...); the first test case table of the document when absent' };
const docParam = { name: 'doc', type: 'string', description: 'the document, as a link target; the current one when absent' };

// the table block an api works on: { path, index, block, parsed, asset } or { message }
async function tableLocate(context, { block, doc }) {
  const ensured = await docModelEnsure(context, doc);
  if (ensured.message) return { message: ensured.message };
  const { configDoc } = context.stores.sourceStore;
  const compId = context.comp.compId;
  const isTable = (blockItem) => Boolean(blockItem.component) && compIdResolve(configDoc, blockItem.component.compName) === compId;
  let located;
  if (block === undefined || block === null || block === '') {
    const index = ensured.model.blockList.findIndex(isTable);
    if (index === -1) return { message: `${ensured.path} has no test case table` };
    located = { block: ensured.model.blockList[index], index };
  } else {
    located = blockLocate(ensured.model, block);
    if (located.message) return { message: located.message };
    if (!isTable(located.block)) return { message: `block ${located.index} is not a test case table` };
  }
  const data = await blockDataGet(context, located.block);
  if (data.message) return { message: data.message };
  let parsed;
  try {
    parsed = testCaseTableParse(data.raw ?? '');
  } catch (error) {
    return { message: `the table does not parse: ${String(error?.message ?? error)}` };
  }
  return { path: ensured.path, index: located.index, block: located.block, parsed, asset: data.asset, compId };
}

// the cases of a table, flat, each with the labels of its groups and the
// current result of every tester
function caseListBuild(parsed) {
  const caseList = [];
  const visit = (rows, labelPathList) => {
    for (const row of rows) {
      if (row.children) {
        visit(row.children, [...labelPathList, row.label]);
        continue;
      }
      const resultByTester = {};
      for (const tester of parsed.value.testers) {
        const { history, result } = testCaseCellGet(parsed, row.id, tester.id);
        resultByTester[tester.id] = { result, recordCount: history.length, entryLast: history.at(-1) };
      }
      caseList.push({
        id: row.id,
        label: row.label,
        groupList: labelPathList,
        cells: Object.fromEntries(Object.entries(row.cells ?? {}).filter(([key]) => !key.startsWith('confirmation:'))),
        resultByTester,
      });
    }
  };
  visit(parsed.value.rows ?? [], []);
  return caseList;
}

export const testCaseTableApiList = [
  apiDefine({
    name: 'tableGet',
    label: 'Read a test case table',
    description: 'The cases, the testers and the current results of a test case table of a document.',
    paramList: [blockParam, docParam],
    run: async (context, params) => {
      const table = await tableLocate(context, params);
      if (table.message) return { code: -1, message: table.message };
      return {
        path: table.path,
        blockIndex: table.index,
        title: table.parsed.value.title ?? '',
        testerList: table.parsed.value.testers.map((tester) => ({ id: tester.id, name: tester.name })),
        caseList: caseListBuild(table.parsed),
        asset: table.asset,
        isRecordable: Boolean(table.asset?.isHead),
      };
    },
  }),
  apiDefine({
    name: 'resultRecord',
    label: 'Record a test result',
    description: 'Appends one result to the history of a cell of a test case table whose data is an asset item, with the name of who confirms it and an optional evidence document.',
    paramList: [
      { name: 'caseId', type: 'string', isRequired: true, description: 'the id of the test case (a row with cells)' },
      { name: 'testerId', type: 'string', isRequired: true, description: 'the id of the tester column' },
      { name: 'result', type: 'any', isRequired: true, valueList: ['OK', 'NG', null], description: 'OK, NG, or null to clear' },
      { name: 'operator', type: 'string', isRequired: true, description: 'who confirms: a name, or the model that checked' },
      { name: 'evidence', type: 'string', description: 'a document of the doc page, as a link would write it' },
      blockParam,
      docParam,
    ],
    isAvailable: ({ stores }) => stores.assetStore.isWritable || stores.assetStore.writeUnavailableReason,
    run: async (context, params) => {
      const table = await tableLocate(context, params);
      if (table.message) return { code: -1, message: table.message };
      if (!table.asset) return { code: -1, message: 'the data of the table is written inline: a result is recorded on an asset item ("to asset" in edit mode moves it there)' };
      if (!table.asset.isHead) return { code: -1, message: `the block reads version ${table.asset.versionIdRef} of its asset, not the head; a result is recorded at the head` };
      if (!table.parsed.caseIdSet.has(params.caseId)) return { code: -1, message: `no test case ${params.caseId} (cases: ${[...table.parsed.caseIdSet].join(', ')})` };
      if (!table.parsed.testerIdSet.has(params.testerId)) return { code: -1, message: `no tester ${params.testerId} (testers: ${[...table.parsed.testerIdSet].join(', ')})` };
      return context.eventDispatch(
        'assetTestCaseResultRequest',
        {
          caseId: params.caseId,
          testerId: params.testerId,
          result: params.result,
          operator: params.operator,
          ...(params.evidence ? { evidence: params.evidence } : {}),
          timeTimezone: -new Date().getTimezoneOffset(),
          hashBase: table.asset.hash,
        },
        { sourcePath: table.path, blockIndex: table.index, compId: table.compId, asset: { isFromAsset: true, ...table.asset } },
      );
    },
  }),
];
