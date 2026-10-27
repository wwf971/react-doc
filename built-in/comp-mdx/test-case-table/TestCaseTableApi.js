import { isDeepStrictEqual } from 'node:util';
import { docTargetResolve, sourceIndexBuild } from '../../../main/frontend/src/lib/doc-target-resolve.js';
import { sourcePathDocPageAliasGet } from '../../../main/frontend/src/lib/doc-source-path.js';
import { testCaseResultAppend, testCaseTableParse } from './TestCaseTableData.js';

// The server side of the managed result history (comp_test_case_table.md),
// used by the asset api of the development server (plugin/doc-asset-server.ts):
// a result is recorded through POST /test-case/result/set, and the generic
// head write (POST /object/update) may not change the history. Node only
// (node:util); the browser never imports this module.

const typeMark = 'test-case-table';

// a cheap look before the yaml is parsed: a text that does not even name
// the type is not a test case table
function tableValueRead(text) {
  if (!text.includes(typeMark)) return undefined;
  try {
    return testCaseTableParse(text);
  } catch {
    return undefined;
  }
}

// the generic head write of textBefore (the head) to textAfter: refused
// when either is a test case table and the result history differs. a
// structural edit (rows, columns, testers) that keeps the history passes,
// and so does any text that is not a test case table
export function testCaseAssetWriteCheck(textBefore, textAfter) {
  const before = tableValueRead(String(textBefore ?? ''));
  const after = tableValueRead(String(textAfter ?? ''));
  if (!before && !after) return;
  if (!isDeepStrictEqual(before?.results ?? {}, after?.results ?? {})) {
    throw new Error('The result history of a TestCaseTable is managed: a result is recorded with an operator name through /test-case/result/set, never written into the text.');
  }
}

// one result recorded on the head of the object: { object, version }, what
// store.objectUpdate answers. the time and the id of the entry are made
// here; the evidence must name one md/mdx document of the doc page of
// docPath (the document the block is in), resolved like a link written
// there, and is kept as a source dependency of the version.
//   input   { objectId, hashBase, docPath, caseId, testerId, operator, result,
//             timeTimezone?, evidence?, versionId? ('head' when given) }
//   fileEntryList   the collected files, { internalPath, name } at least
export function testCaseAssetResultSet(store, input, fileEntryList) {
  if (input.versionId !== undefined && input.versionId !== 'head') {
    throw new Error('A result is recorded at the head of the object; a pinned version cannot record.');
  }
  const sourceIndex = sourceIndexBuild(fileEntryList);
  const docPath = String(input.docPath ?? '');
  const docEntry = sourceIndex.entryByInternalPath.get(docPath);
  if (!docEntry || !/\.mdx?$/i.test(docEntry.internalPath)) {
    throw new Error('docPath must name the collected md/mdx document the table is in.');
  }
  const object = store.objectFind({ objectId: input.objectId });
  const version = store.versionDataGetOf(object, 'head');
  if (!version.isText) throw new Error('TestCaseTable data must be a text version.');
  const docPageAlias = sourcePathDocPageAliasGet(docPath);
  const result = testCaseResultAppend(version.text, input, {
    evidenceResolve: (target) => {
      const resolved = docTargetResolve(target, docPath, sourceIndex);
      const entry = resolved.entryList.length === 1 ? resolved.entryList[0] : undefined;
      const isDocument = Boolean(entry) && !resolved.hash && /\.mdx?$/i.test(entry.internalPath)
        && sourcePathDocPageAliasGet(entry.internalPath) === docPageAlias;
      return isDocument ? entry.internalPath : undefined;
    },
  });
  const dependencyListHead = store.dependencyListGet(object.objectId, 'head').dependencyList;
  const evidence = result.entry.evidence;
  const isEvidenceListed = !evidence || dependencyListHead.some((item) => item.type === 'source' && item.path === evidence);
  const dependencyList = isEvidenceListed ? dependencyListHead : [...dependencyListHead, { type: 'source', path: evidence }];
  return store.objectUpdate({
    objectId: object.objectId,
    hashBase: input.hashBase,
    data: Buffer.from(result.text, 'utf8'),
    dependencyList,
  });
}
