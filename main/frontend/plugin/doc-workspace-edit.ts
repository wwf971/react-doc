import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { lineOperationListApply, type LineOperation } from './doc-edit-lines.ts';
import {
  nodeReplaceBuild,
  yamlMapKeyRemoveBuild,
  yamlScalarTextBuild,
  yamlSeqItemInsertBuild,
  yamlSeqItemRemoveBuild,
  yamlValueSetOperationBuild,
  type YamlEditResult,
} from './doc-yaml-edit.ts';

// A change of the workspace file from the Workspace tab of the settings
// panel (design: doc_page_impl_source.md#editing-the-workspace-file), built
// as line operations with the yaml utilities (doc_page_impl_yaml_utils.md):
// the rest of the file, its comments included, stays as it was. pure: text
// in, text out; doc-edit-server.ts reads and writes the file.
//
//   { action: 'itemFieldSet', index, field: 'alias' | 'sidePanel', value }
//                                   value '' removes the key
//   { action: 'itemPathSet', index, kind: 'dir' | 'file', value }
//                                   the folder or the entry file of the item;
//                                   the other of the two keys is removed
//   { action: 'itemRootVisibleSet', index, isRootVisible }
//                                   a boolean: false writes "isRootVisible: false"
//                                   (doc-sidebar-effective.ts), true removes the key
//   { action: 'itemAdd', item: { alias?, dir | file, sidePanel?, isRootVisible? } }   at the end
//   { action: 'itemRemove', index } the last item is never removed
//   { action: 'itemMove', index, indexTo }   indexTo: its place afterwards
//   { action: 'titleSet', value }   the page title of the workspace; '' removes it

export type WorkspaceEditRequest =
  | { action: 'itemFieldSet'; index: number; field: 'alias' | 'sidePanel'; value: string }
  | { action: 'itemPathSet'; index: number; kind: 'dir' | 'file'; value: string }
  | { action: 'itemRootVisibleSet'; index: number; isRootVisible: boolean }
  | { action: 'itemAdd'; item: { alias?: string; dir?: string; file?: string; sidePanel?: string; isRootVisible?: boolean } }
  | { action: 'itemRemove'; index: number }
  | { action: 'itemMove'; index: number; indexTo: number }
  | { action: 'titleSet'; value: string };

const LIST_KEY = 'docPageList';

function fail(message: string): { code: -1; data: null; message: string } {
  return { code: -1, data: null, message };
}

export function workspaceEditBuild(source: string, request: WorkspaceEditRequest): YamlEditResult<{ text: string }> {
  const document = parseDocument(source);
  if (document.errors.length > 0) return fail(`the workspace file does not parse: ${document.errors[0].message}`);
  if (!isMap(document.contents)) return fail('the workspace file is not a mapping');
  const seq = document.getIn([LIST_KEY], true);
  if (!isSeq(seq) || seq.flow) return fail(`"${LIST_KEY}" must be a list written over several lines`);
  const count = seq.items.length;
  const indexCheck = (index: unknown) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < count;

  let result: YamlEditResult<{ operationList: LineOperation[] }>;
  if (request.action === 'itemFieldSet') {
    if (!indexCheck(request.index)) return fail(`the workspace has no doc page ${request.index}`);
    if (request.field !== 'alias' && request.field !== 'sidePanel') return fail(`"${String(request.field)}" is not a field of a doc page item`);
    result = keySetBuild(source, document, [LIST_KEY, request.index, request.field], String(request.value ?? '').trim());
  } else if (request.action === 'itemPathSet') {
    if (!indexCheck(request.index)) return fail(`the workspace has no doc page ${request.index}`);
    if (request.kind !== 'dir' && request.kind !== 'file') return fail('the path of a doc page is "dir" or "file"');
    const value = String(request.value ?? '').trim();
    if (value === '') return fail(`a doc page needs its ${request.kind === 'dir' ? 'folder' : 'entry file'}`);
    const keyOther = request.kind === 'dir' ? 'file' : 'dir';
    const valueText = yamlScalarTextBuild(value);
    if (document.hasIn([LIST_KEY, request.index, keyOther]) && !document.hasIn([LIST_KEY, request.index, request.kind])) {
      // "file: a" becomes "dir: b" on its own lines, its "- " and a trailing
      // comment kept
      const item = seq.items[request.index];
      const pair = isMap(item) ? item.items.find((pairOne: any) => isScalar(pairOne.key) && pairOne.key.value === keyOther) : undefined;
      if (!pair || !Array.isArray((pair.key as any)?.range) || !Array.isArray((pair.value as any)?.range)) {
        return fail(`"${keyOther}" of doc page ${request.index} has no position in the file`);
      }
      const range = [(pair.key as any).range[0], (pair.value as any).range[1], (pair.value as any).range[2]];
      result = { code: 0, data: { operationList: [nodeReplaceBuild(source, { range } as any, `${request.kind}: ${valueText}`)] }, message: '' };
    } else {
      const set = yamlValueSetOperationBuild(source, [LIST_KEY, request.index, request.kind], valueText);
      if (set.code !== 0) return fail(set.message);
      const operationList: LineOperation[] = [set.data.operation];
      if (document.hasIn([LIST_KEY, request.index, keyOther])) {
        const removal = yamlMapKeyRemoveBuild(source, document, [LIST_KEY, request.index, keyOther]);
        if (removal.code !== 0) return fail(removal.message);
        operationList.push(...removal.data.operationList);
      }
      result = { code: 0, data: { operationList }, message: '' };
    }
  } else if (request.action === 'itemRootVisibleSet') {
    if (!indexCheck(request.index)) return fail(`the workspace has no doc page ${request.index}`);
    // a yaml boolean is written, never the text "false": the loader refuses that
    if (typeof request.isRootVisible !== 'boolean') return fail('"isRootVisible" must be true or false');
    const keyPath = [LIST_KEY, request.index, 'isRootVisible'];
    if (request.isRootVisible) {
      result = document.hasIn(keyPath) ? yamlMapKeyRemoveBuild(source, document, keyPath) : { code: 0, data: { operationList: [] }, message: '' };
    } else {
      const set = yamlValueSetOperationBuild(source, keyPath, 'false');
      result = set.code === 0 ? { code: 0, data: { operationList: [set.data.operation] }, message: '' } : fail(set.message);
    }
  } else if (request.action === 'itemAdd') {
    const lineList = itemLineListBuild(request.item);
    if (typeof lineList === 'string') return fail(lineList);
    result = yamlSeqItemInsertBuild(source, document, [LIST_KEY], -1, lineList, 0);
  } else if (request.action === 'itemRemove') {
    if (!indexCheck(request.index)) return fail(`the workspace has no doc page ${request.index}`);
    if (count === 1) return fail('the workspace needs one doc page at least');
    result = yamlSeqItemRemoveBuild(source, document, [LIST_KEY], request.index);
  } else if (request.action === 'itemMove') {
    if (!indexCheck(request.index) || !indexCheck(request.indexTo)) return fail('the move names a place the list does not have');
    if (request.index === request.indexTo) return { code: 0, data: { text: source }, message: '' };
    const removal = yamlSeqItemRemoveBuild(source, document, [LIST_KEY], request.index);
    if (removal.code !== 0) return removal;
    // the place in the list as it is now: before the item that will follow it
    const indexBefore = request.indexTo > request.index ? request.indexTo + 1 : request.indexTo;
    const insertion = yamlSeqItemInsertBuild(
      source, document, [LIST_KEY], indexBefore >= count ? -1 : indexBefore,
      removal.data.lineList, removal.data.itemLines.column,
    );
    if (insertion.code !== 0) return insertion;
    result = { code: 0, data: { operationList: [...removal.data.operationList, ...insertion.data.operationList] }, message: '' };
  } else if (request.action === 'titleSet') {
    result = keySetBuild(source, document, ['title'], String(request.value ?? '').trim());
  } else {
    return fail(`unknown workspace edit: ${String((request as any)?.action)}`);
  }
  if (result.code !== 0) return fail(result.message);

  const text = lineOperationListApply(source, result.data.operationList);
  const documentAfter = parseDocument(text);
  const seqAfter = documentAfter.getIn([LIST_KEY], true);
  if (documentAfter.errors.length > 0 || !isSeq(seqAfter) || seqAfter.items.length === 0) {
    return fail('the workspace file would not keep its list of doc pages; nothing was written');
  }
  return { code: 0, data: { text }, message: '' };
}

// a key set to a value, or removed for ''
function keySetBuild(
  source: string,
  document: ReturnType<typeof parseDocument>,
  keyPath: (string | number)[],
  value: string,
): YamlEditResult<{ operationList: LineOperation[] }> {
  if (value === '') {
    if (!document.hasIn(keyPath)) return { code: 0, data: { operationList: [] }, message: '' };
    return yamlMapKeyRemoveBuild(source, document, keyPath);
  }
  const set = yamlValueSetOperationBuild(source, keyPath, yamlScalarTextBuild(value));
  if (set.code !== 0) return fail(set.message);
  return { code: 0, data: { operationList: [set.data.operation] }, message: '' };
}

// the lines of a new item, its "-" at column 0; a string says what is wrong
function itemLineListBuild(item: any): string[] | string {
  const dir = String(item?.dir ?? '').trim();
  const file = String(item?.file ?? '').trim();
  if ((dir === '') === (file === '')) return 'a doc page names either its folder ("dir") or its entry file ("file")';
  const lineList: string[] = [];
  const alias = String(item?.alias ?? '').trim();
  const sidePanel = String(item?.sidePanel ?? '').trim();
  if (alias) lineList.push(`alias: ${yamlScalarTextBuild(alias)}`);
  lineList.push(dir ? `dir: ${yamlScalarTextBuild(dir)}` : `file: ${yamlScalarTextBuild(file)}`);
  if (sidePanel) lineList.push(`sidePanel: ${yamlScalarTextBuild(sidePanel)}`);
  if (item?.isRootVisible === false) lineList.push('isRootVisible: false');
  return lineList.map((line, index) => (index === 0 ? `- ${line}` : `  ${line}`));
}
