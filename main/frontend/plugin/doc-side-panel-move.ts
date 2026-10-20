import path from 'node:path';
import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair, type YAMLMap } from 'yaml';
import { lineOperationListApply, textLineListGet } from './doc-edit-lines.ts';
import {
  lineOffsetGet,
  nodeEndOffsetGet,
  yamlScalarTextBuild,
  yamlSeqItemInsertBuild,
  yamlSeqItemRemoveBuild,
  type YamlSeqItemLines,
} from './doc-yaml-edit.ts';

// Moving one side-panel item, with everything below it, to another place of
// the side panel, as line operations of its yaml files (doc-edit-lines.ts).
// design: doc_page_impl_side_panel.md#moving-an-item
//
// The item is a node of a block list ("tree" of a side panel, "children" of
// a node). Its lines, with the comments that belong to it, are taken out of
// that list and inserted into the target list, moved to the target list's
// indentation (doc-yaml-edit.ts, an item of a block sequence); the list it
// leaves and the list it joins are written in place, every other line of
// both files stays as it was. The two lists may be in one file or in two.
//
//   item.file, item.path        the item's nodeSource, as the plugin annotated
//                               it: ["sidePanelById", "main", "tree", 3]
//   target.file, target.listPath  the list the item joins: a "tree" or a
//                               "children" list; a "children" list that does
//                               not exist yet is created on its node
//   target.index                the item the moved item goes before, in the
//                               target list as it is now (before the move);
//                               -1: at the end
//
// an item moved into another file takes its "include" references along: a
// path is relative to the file holding it, so it is rewritten relative to
// the new file, and an include of a side panel of the same file
// ({ sidePanel: x }) gets the file it named implicitly.
//
// refused: an item into itself or below itself, an item that is not a node
// (a mapping) of a block list, lists or nodes written in flow form, a result
// that does not parse.

export type SidePanelMoveRequest = {
  item: { file: string; path: (string | number)[] };
  target: { file: string; listPath: (string | number)[]; index: number };
};

export type SidePanelMoveResult =
  | { code: 0; data: { textAfterByFile: Record<string, string>; isChanged: boolean }; message: '' }
  | { code: -1; data: null; message: string };

export function sidePanelMoveRequestIsValid(request: any): request is SidePanelMoveRequest {
  if (!request || typeof request !== 'object') return false;
  const { item, target } = request;
  if (!item || typeof item.file !== 'string' || item.file === '' || !yamlPathIsValid(item.path)) return false;
  if (typeof item.path[item.path.length - 1] !== 'number') return false;
  if (!target || typeof target.file !== 'string' || target.file === '' || !yamlPathIsValid(target.listPath)) return false;
  return Number.isInteger(target.index) && target.index >= -1;
}

// textByFile: the current text of the item's file and of the target's file
export function sidePanelMoveBuild(textByFile: Record<string, string>, request: SidePanelMoveRequest): SidePanelMoveResult {
  const { item, target } = request;
  const isSameFile = item.file === target.file;
  const sourceItem = textByFile[item.file];
  const sourceTarget = textByFile[target.file];
  if (sourceItem === undefined || sourceTarget === undefined) return resultFail('the text of a file of the move is missing');

  const documentItem = parseDocument(sourceItem);
  if (documentItem.errors.length > 0) return resultFail(`${item.file} does not parse: ${documentItem.errors[0].message}`);
  const documentTarget = isSameFile ? documentItem : parseDocument(sourceTarget);
  if (documentTarget.errors.length > 0) return resultFail(`${target.file} does not parse: ${documentTarget.errors[0].message}`);

  const itemListPath = item.path.slice(0, -1);
  const itemIndex = item.path[item.path.length - 1] as number;
  const itemList = documentItem.getIn(itemListPath, true);
  if (!isSeq(itemList)) return resultFail(`no side panel list at ${JSON.stringify(itemListPath)} in ${item.file}`);
  const itemNode = itemList.items[itemIndex];
  if (!isMap(itemNode)) return resultFail(`no side panel node at ${JSON.stringify(item.path)} in ${item.file}`);
  if (isSameFile && pathStartsWith(target.listPath, item.path)) {
    return resultFail('an item cannot be moved into itself or below itself');
  }

  // the item would land where it is
  if (isSameFile && pathIsEqual(target.listPath, itemListPath)) {
    const indexAt = target.index < 0 ? itemList.items.length : target.index;
    if (indexAt === itemIndex || indexAt === itemIndex + 1) {
      return { code: 0, data: { textAfterByFile: {}, isChanged: false }, message: '' };
    }
  }

  const removal = yamlSeqItemRemoveBuild(sourceItem, documentItem, itemListPath, itemIndex);
  if (removal.code !== 0) return resultFail(`${item.file}: ${removal.message}`);
  const lineListItem = isSameFile
    ? removal.data.lineList
    : itemLineListRebase(sourceItem, itemNode, removal.data.itemLines, item.file, target.file);

  const insertion = yamlSeqItemInsertBuild(
    sourceTarget,
    documentTarget,
    target.listPath,
    target.index,
    lineListItem,
    removal.data.itemLines.column,
  );
  if (insertion.code !== 0) return resultFail(`${target.file}: ${insertion.message}`);

  const textAfterByFile: Record<string, string> = {};
  if (isSameFile) {
    textAfterByFile[item.file] = lineOperationListApply(sourceItem, [...removal.data.operationList, ...insertion.data.operationList]);
  } else {
    textAfterByFile[item.file] = lineOperationListApply(sourceItem, removal.data.operationList);
    textAfterByFile[target.file] = lineOperationListApply(sourceTarget, insertion.data.operationList);
  }
  for (const [file, text] of Object.entries(textAfterByFile)) {
    const documentAfter = parseDocument(text);
    if (documentAfter.errors.length > 0) {
      return resultFail(`the move would leave ${file} unparsable (${documentAfter.errors[0].message}); nothing was written`);
    }
  }
  return { code: 0, data: { textAfterByFile, isChanged: true }, message: '' };
}

// ---------- include references of an item moved into another file ----------

// the item's lines, as they are in the file, with every "include" of the
// item and of the nodes below it written relative to the new file
function itemLineListRebase(
  source: string,
  itemNode: YAMLMap,
  itemLines: YamlSeqItemLines,
  fileFrom: string,
  fileTo: string,
): string[] {
  const lineCount = textLineListGet(source).length;
  const offsetStart = lineOffsetGet(source, itemLines.lineStart - 1);
  const offsetEnd = itemLines.lineEnd < lineCount ? lineOffsetGet(source, itemLines.lineEnd) : source.length;
  const replacementList: { offsetStart: number; offsetEnd: number; text: string }[] = [];
  const replacementAdd = (node: Node, text: string) => {
    const [nodeStart] = node.range as [number, number, number];
    replacementList.push({ offsetStart: nodeStart, offsetEnd: nodeEndOffsetGet(source, node), text });
  };

  const nodeVisit = (node: YAMLMap) => {
    for (const pair of node.items as Pair<Node, Node | null>[]) {
      if (!isScalar(pair.key) || !pair.value || !Array.isArray(pair.value.range)) continue;
      const key = String(pair.key.value);
      if (key === 'include') includeRebase(pair.value, fileFrom, fileTo, replacementAdd);
      if (key === 'children' && isSeq(pair.value)) {
        for (const child of pair.value.items) if (isMap(child)) nodeVisit(child);
      }
    }
  };
  nodeVisit(itemNode);

  let block = source.slice(offsetStart, offsetEnd);
  for (const replacement of [...replacementList].sort((a, b) => b.offsetStart - a.offsetStart)) {
    block = block.slice(0, replacement.offsetStart - offsetStart) + replacement.text + block.slice(replacement.offsetEnd - offsetStart);
  }
  return textLineListGet(block);
}

// an include is a path (a string), or { file?, sidePanel? }
function includeRebase(
  value: Node,
  fileFrom: string,
  fileTo: string,
  replacementAdd: (node: Node, text: string) => void,
) {
  if (isScalar(value) && typeof value.value === 'string') {
    replacementAdd(value, yamlScalarTextBuild(includePathRebase(value.value, fileFrom, fileTo)));
    return;
  }
  if (!isMap(value)) return;
  const fileNode = value.get('file', true);
  if (isScalar(fileNode) && typeof fileNode.value === 'string' && Array.isArray(fileNode.range)) {
    replacementAdd(fileNode, yamlScalarTextBuild(includePathRebase(fileNode.value, fileFrom, fileTo)));
    return;
  }
  // { sidePanel: x } names a side panel of the file holding it: after the
  // move, that file must be named
  const sidePanel = value.get('sidePanel');
  if (fileNode === undefined && typeof sidePanel === 'string') {
    const fileText = includePathRebase(`./${path.posix.basename(fileFrom)}`, fileFrom, fileTo);
    replacementAdd(value, `{ file: ${yamlScalarTextBuild(fileText)}, sidePanel: ${yamlScalarTextBuild(sidePanel)} }`);
  }
}

// files are named relative to the config directory, with "/"
function includePathRebase(value: string, fileFrom: string, fileTo: string): string {
  if (value.startsWith('/')) return value;
  const dirFrom = path.posix.dirname(fileFrom);
  const dirTo = path.posix.dirname(fileTo);
  if (dirFrom === dirTo) return value;
  const pathTarget = path.posix.normalize(path.posix.join(dirFrom, value));
  const pathRelative = path.posix.relative(dirTo, pathTarget);
  return pathRelative.startsWith('.') ? pathRelative : `./${pathRelative}`;
}

// ---------- helpers ----------

function yamlPathIsValid(value: unknown): value is (string | number)[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((step) => (typeof step === 'string' && step !== '') || (Number.isInteger(step) && (step as number) >= 0));
}

function pathIsEqual(pathA: (string | number)[], pathB: (string | number)[]): boolean {
  return pathA.length === pathB.length && pathA.every((step, index) => step === pathB[index]);
}

function pathStartsWith(pathLong: (string | number)[], pathPrefix: (string | number)[]): boolean {
  return pathLong.length >= pathPrefix.length && pathPrefix.every((step, index) => step === pathLong[index]);
}

function resultFail(message: string): { code: -1; data: null; message: string } {
  return { code: -1, data: null, message };
}
