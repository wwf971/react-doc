import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair, type YAMLMap } from 'yaml';
import { lineOperationApply, lineOperationListApply, type LineOperation } from './doc-edit-lines.ts';
import {
  lineAtAfterNodeGet,
  linesInsertBuild,
  nodeColumnGet,
  yamlMapKeyRemoveBuild,
  yamlScalarTextBuild,
  yamlSeqItemInsertBuild,
  yamlSeqItemRemoveBuild,
  yamlValueSetOperationBuild,
} from './doc-yaml-edit.ts';

// Changing the structure of a side panel: a node inserted, removed, or bound
// to another document or source folder, written in place into its yaml file
// with the yaml utilities (doc-yaml-edit.ts). The page decides what is
// allowed (lib/side-panel-node.js) and names the node by its nodeSource;
// this module only checks that the file still says what the request
// assumes, and builds the new text.
// design: doc_page_impl_side_panel.md#changing-the-structure
//
//   insert   { action, listPath, index, node }
//            node { kind: 'folder', text }          - text: ...
//                                                     children: []
//                 { kind: 'doc', doc }              - doc: ~root/a.mdx
//            index: before that item of the list as it is now; -1 the end;
//            an empty or missing "children" list is created on its node
//   remove   { action, path }
//            refused when the node holds items of its own ("children" with
//            items): only an empty item is removed
//   bind     { action, path, binding, text? }
//            binding { kind: 'doc', path }       the node shows that document
//                    { kind: 'folder', path }    the node mirrors that source
//                                                folder (sourceFolder)
//                    { kind: 'none' }            neither: a virtual folder
//            text: the label the reader sees now, written as "text" when the
//            node has none and would lose it (a document labeled by its
//            title becoming a folder, a node becoming a source folder)
//
// a leaf document item ("doc" without "children") only changes its
// document. a node that holds items or mirrors a folder is a non-leaf item:
// it keeps "children" while it is bound to a document or to nothing, and it
// takes a folder only while it holds no items. every result is parsed
// before it is answered.

export type SidePanelNodeRequest =
  | { action: 'insert'; listPath: (string | number)[]; index: number; node: { kind: 'folder'; text: string } | { kind: 'doc'; doc: string } }
  | { action: 'remove'; path: (string | number)[] }
  | { action: 'bind'; path: (string | number)[]; binding: { kind: 'doc' | 'folder'; path: string } | { kind: 'none' }; text?: string };

export type SidePanelNodeResult =
  | { code: 0; data: { text: string }; message: '' }
  | { code: -1; data: null; message: string };

export function sidePanelNodeRequestIsValid(request: any): request is SidePanelNodeRequest {
  if (!request || typeof request !== 'object') return false;
  if (request.action === 'insert') {
    if (!yamlPathIsValid(request.listPath) || !Number.isInteger(request.index) || request.index < -1) return false;
    const node = request.node;
    if (node?.kind === 'folder') return textIsLine(node.text);
    if (node?.kind === 'doc') return textIsLine(node.doc);
    return false;
  }
  if (request.action === 'remove') return yamlPathIsValid(request.path) && typeof request.path.at(-1) === 'number';
  if (request.action === 'bind') {
    if (!yamlPathIsValid(request.path) || typeof request.path.at(-1) !== 'number') return false;
    if (request.text !== undefined && !textIsLine(request.text)) return false;
    const binding = request.binding;
    if (binding?.kind === 'none') return true;
    return (binding?.kind === 'doc' || binding?.kind === 'folder') && textIsLine(binding.path);
  }
  return false;
}

// the request applied to the text of its file
export function sidePanelNodeBuild(source: string, request: SidePanelNodeRequest): SidePanelNodeResult {
  const document = parseDocument(source);
  if (document.errors.length > 0) return resultFail(`the file does not parse: ${document.errors[0].message}`);
  let result: SidePanelNodeResult;
  if (request.action === 'insert') result = insertBuild(source, request);
  else if (request.action === 'remove') result = removeBuild(source, request);
  else result = bindBuild(source, request);
  if (result.code !== 0) return result;
  const documentAfter = parseDocument(result.data.text);
  if (documentAfter.errors.length > 0) {
    return resultFail(`the change would leave the file unparsable (${documentAfter.errors[0].message}); nothing was written`);
  }
  return result;
}

// ---------- insert ----------

function insertBuild(source: string, request: Extract<SidePanelNodeRequest, { action: 'insert' }>): SidePanelNodeResult {
  const document = parseDocument(source);
  const lineList = request.node.kind === 'folder'
    ? [`- text: ${yamlScalarTextBuild(request.node.text.trim())}`, '  children: []']
    : [`- doc: ${yamlScalarTextBuild(request.node.doc.trim())}`];
  const insertion = yamlSeqItemInsertBuild(source, document, request.listPath, request.index, lineList, 0);
  if (insertion.code !== 0) return resultFail(insertion.message);
  return resultText(lineOperationListApply(source, insertion.data.operationList));
}

// ---------- remove ----------

function removeBuild(source: string, request: Extract<SidePanelNodeRequest, { action: 'remove' }>): SidePanelNodeResult {
  const document = parseDocument(source);
  const node = document.getIn(request.path, true);
  if (!isMap(node)) return resultFail(`no side panel node at ${JSON.stringify(request.path)}`);
  const children = node.get('children', true);
  if (isSeq(children) && children.items.length > 0) {
    return resultFail('the item holds items of its own; move or remove them first');
  }
  const removal = yamlSeqItemRemoveBuild(source, document, request.path.slice(0, -1), request.path.at(-1) as number);
  if (removal.code !== 0) return resultFail(removal.message);
  return resultText(lineOperationListApply(source, removal.data.operationList));
}

// ---------- bind ----------

// one step at a time, each built on the text the previous one left, so the
// steps never disagree about line numbers: keys are added before keys are
// removed, so the node never becomes an empty mapping on the way
function bindBuild(source: string, request: Extract<SidePanelNodeRequest, { action: 'bind' }>): SidePanelNodeResult {
  const node = nodeGet(source, request.path);
  if (!node) return resultFail(`no side panel node at ${JSON.stringify(request.path)}`);
  if (node.flow) return resultFail('the node is written as a flow mapping ({ a: 1 }); write it over several lines first');
  if (node.has('include')) return resultFail('the item includes another side panel; its binding is written in the root of that side panel');
  if (node.has('separator') || node.has('panel') || node.has('inline')) return resultFail('only a document item or a folder is bound to a document or a folder');

  const children = node.get('children', true);
  const isChildrenDeclared = node.has('children');
  const isChildrenEmpty = !isSeq(children) || children.items.length === 0;
  const isSourceFolder = node.has('sourceFolder') || node.has('sourceRoot');
  const isLeaf = node.has('doc') && !isChildrenDeclared;
  const { binding } = request;
  if (isLeaf && binding.kind !== 'doc') return resultFail('a document item without children is bound to a document only');
  if (binding.kind === 'folder' && !isChildrenEmpty) return resultFail('the item holds items of its own; a folder replaces them, so move or remove them first');

  const isTextNeeded = !node.has('text') && !node.has('display') && (binding.kind === 'folder' || binding.kind === 'none');
  if (isTextNeeded && !request.text) return resultFail('the item has no label of its own; the label shown is needed to keep it');

  let text = source;
  const step = (build: (textNow: string) => LineOperation[] | string) => {
    const result = build(text);
    if (typeof result === 'string') throw new SidePanelNodeError(result);
    text = result.length === 1 ? lineOperationApply(text, result[0]) : lineOperationListApply(text, result);
  };
  try {
    if (isTextNeeded) step((textNow) => [pairFirstAfterInsertBuild(textNow, request.path, 'text', yamlScalarTextBuild(request.text!.trim()))]);
    if (binding.kind === 'doc') {
      step((textNow) => keySetBuild(textNow, request.path, 'doc', binding.path));
      if (!isLeaf && !isChildrenDeclared) step((textNow) => valueSetBuild(textNow, [...request.path, 'children'], '[]'));
      for (const key of ['sourceFolder', 'sourceRoot']) {
        if (isSourceFolder) step((textNow) => keyRemoveBuild(textNow, request.path, key));
      }
    } else if (binding.kind === 'folder') {
      step((textNow) => keySetBuild(textNow, request.path, 'sourceFolder', binding.path));
      step((textNow) => keyRemoveBuild(textNow, request.path, 'sourceRoot'));
      step((textNow) => keyRemoveBuild(textNow, request.path, 'doc'));
      step((textNow) => keyRemoveBuild(textNow, request.path, 'children'));
    } else {
      if (!isChildrenDeclared) step((textNow) => valueSetBuild(textNow, [...request.path, 'children'], '[]'));
      for (const key of ['doc', 'sourceFolder', 'sourceRoot']) step((textNow) => keyRemoveBuild(textNow, request.path, key));
    }
  } catch (error) {
    if (error instanceof SidePanelNodeError) return resultFail(error.message);
    throw error;
  }
  return resultText(text);
}

class SidePanelNodeError extends Error {}

// the key gets the value: rewritten in place when it exists, else a line
// after the node's first pair (next to its label), indented like its keys
function keySetBuild(source: string, nodePath: (string | number)[], key: string, value: string): LineOperation[] | string {
  const node = nodeGet(source, nodePath);
  if (!node) return `no side panel node at ${JSON.stringify(nodePath)}`;
  if (node.has(key)) return valueSetBuild(source, [...nodePath, key], yamlScalarTextBuild(value.trim()));
  return [pairFirstAfterInsertBuild(source, nodePath, key, yamlScalarTextBuild(value.trim()))];
}

function valueSetBuild(source: string, keyPath: (string | number)[], valueText: string): LineOperation[] | string {
  const result = yamlValueSetOperationBuild(source, keyPath, valueText);
  return result.code === 0 ? [result.data.operation] : result.message;
}

// nothing when the node has no such key
function keyRemoveBuild(source: string, nodePath: (string | number)[], key: string): LineOperation[] | string {
  const document = parseDocument(source);
  const node = document.getIn(nodePath, true);
  if (!isMap(node) || !node.has(key)) return [];
  const result = yamlMapKeyRemoveBuild(source, document, [...nodePath, key]);
  return result.code === 0 ? result.data.operationList : result.message;
}

function pairFirstAfterInsertBuild(source: string, nodePath: (string | number)[], key: string, valueText: string): LineOperation {
  const node = nodeGet(source, nodePath)!;
  const pairFirst = node.items[0] as Pair<Node, Node | null> | undefined;
  const nodeAfter = pairFirst?.value && Array.isArray(pairFirst.value.range) ? pairFirst.value : pairFirst?.key ?? node;
  const indent = nodeColumnGet(source, node);
  return linesInsertBuild(lineAtAfterNodeGet(source, nodeAfter), [`${' '.repeat(indent)}${key}: ${valueText}`]);
}

// ---------- helpers ----------

function nodeGet(source: string, nodePath: (string | number)[]): YAMLMap | undefined {
  const node = parseDocument(source).getIn(nodePath, true);
  if (!isMap(node) || node.items.length === 0) return undefined;
  const pairFirst = node.items[0] as Pair<Node, Node | null>;
  return isScalar(pairFirst.key) && Array.isArray(pairFirst.key.range) ? node : undefined;
}

function textIsLine(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !/[\r\n]/.test(value);
}

function yamlPathIsValid(value: unknown): value is (string | number)[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((step) => (typeof step === 'string' && step !== '') || (Number.isInteger(step) && (step as number) >= 0));
}

function resultText(text: string): SidePanelNodeResult {
  return { code: 0, data: { text }, message: '' };
}

function resultFail(message: string): { code: -1; data: null; message: string } {
  return { code: -1, data: null, message };
}
