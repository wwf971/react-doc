import { isMap, isScalar, parseDocument, type Node, type Pair, type Scalar, type YAMLMap } from 'yaml';
import type { LineOperation } from './doc-edit-lines.ts';
import { lineAtAfterNodeGet, linesInsertBuild, nodeColumnGet, nodeReplaceBuild, yamlScalarTextBuild } from './doc-yaml-edit.ts';

// Changing the label of one side-panel item in its YAML file, as a line
// operation (doc-edit-lines.ts). design: doc_page_impl_side_panel.md
//
// The file is edited in place (doc-yaml-edit.ts): the parsed document only
// tells where the authored label is, the lines holding that value are
// rebuilt around the new scalar, and every other line of the file stays
// byte for byte as it was.
//
//   nodePath   yaml address of the side-panel node, as the plugin annotated
//              it: e.g. ["sidePanelById", "main", "tree", 2],
//              ["sidePanelById", "main", "tree", 0, "children", 1],
//              ["sidePanelById", "main", "root"] for a label that comes from
//              the root of an included side panel
//   language   '' for a plain string label, the language code of the shown
//              translation for a language mapping
//   text       the new label; a single line of non-empty text
//   textBase   the authored label the edit started from; when it no longer
//              matches the file, the edit is refused (code -2)
//
// the label field is found the way page-tree.js reads it: "text" when the
// node has one, otherwise "separator" of a separator node; a node without a
// "text" (a document labeled by its title) gets a "text" line inserted after
// its first key, at the node's indentation.

export type SidePanelTextRequest = {
  nodePath: (string | number)[];
  language: string;
  text: string;
  textBase?: string;
};

export type SidePanelTextResult =
  | { code: 0; data: { operation: LineOperation; fieldName: string }; message: '' }
  | { code: -1 | -2; data: null; message: string };

export function sidePanelTextOperationBuild(source: string, request: SidePanelTextRequest): SidePanelTextResult {
  if (!sidePanelTextRequestIsValid(request)) {
    return { code: -1, data: null, message: 'request needs nodePath, language and a non-empty single-line text' };
  }
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return { code: -1, data: null, message: `the side panel file does not parse: ${document.errors[0].message}` };
  }
  const node = document.getIn(request.nodePath, true);
  if (!isMap(node)) {
    return { code: -1, data: null, message: `no side panel node at ${JSON.stringify(request.nodePath)}` };
  }

  const fieldName = labelFieldNameGet(node);
  if (fieldName === '') {
    if (request.language !== '') {
      return { code: -1, data: null, message: 'the node has no language mapping to hold a translation' };
    }
    if (node.flow) {
      return { code: -1, data: null, message: 'a "text" cannot be added to a flow mapping; write the node over several lines first' };
    }
    return { code: 0, data: { operation: textLineInsertBuild(source, node, request.text), fieldName: 'text' }, message: '' };
  }

  const valueField = node.get(fieldName, true);
  let scalar: unknown;
  if (request.language === '') {
    if (isMap(valueField)) {
      return { code: -1, data: null, message: `"${fieldName}" is a language mapping; the language of the shown translation is required` };
    }
    scalar = valueField;
  } else {
    if (!isMap(valueField)) {
      return { code: -1, data: null, message: `"${fieldName}" is not a language mapping; no translation "${request.language}"` };
    }
    scalar = valueField.get(request.language, true);
  }
  if (!isScalar(scalar) || !Array.isArray(scalar.range)) {
    return { code: -1, data: null, message: `the label at "${fieldName}" is not a text value` };
  }
  if (request.textBase !== undefined && String(scalar.value ?? '').trim() !== request.textBase.trim()) {
    return { code: -2, data: null, message: 'the label changed in the file since it was displayed; the edit was not applied' };
  }
  return {
    code: 0,
    data: { operation: nodeReplaceBuild(source, scalar as Scalar, yamlScalarTextBuild(request.text)), fieldName },
    message: '',
  };
}

export function sidePanelTextRequestIsValid(request: any): request is SidePanelTextRequest {
  if (!request || typeof request !== 'object') return false;
  if (!Array.isArray(request.nodePath) || request.nodePath.length === 0) return false;
  const isPathValid = request.nodePath.every((step: unknown) => (
    (typeof step === 'string' && step !== '') || (Number.isInteger(step) && (step as number) >= 0)
  ));
  if (!isPathValid) return false;
  if (typeof request.language !== 'string') return false;
  if (typeof request.text !== 'string' || request.text.trim() === '' || /[\r\n]/.test(request.text)) return false;
  return request.textBase === undefined || typeof request.textBase === 'string';
}

// the field page-tree.js shows as the label, '' when the node has none
function labelFieldNameGet(node: YAMLMap): string {
  if (node.has('text')) return 'text';
  if (node.has('separator')) {
    const separator = node.get('separator', true);
    if (isMap(separator) || (isScalar(separator) && typeof separator.value === 'string')) return 'separator';
  }
  return '';
}

// a "text" line after the first pair of the node, indented like its keys
function textLineInsertBuild(source: string, node: YAMLMap, text: string): LineOperation {
  const pairFirst = node.items[0] as Pair<Node, Node | null> | undefined;
  const nodeAfter = pairFirst?.value && Array.isArray(pairFirst.value.range) ? pairFirst.value : pairFirst?.key ?? node;
  const indent = nodeColumnGet(source, node);
  return linesInsertBuild(lineAtAfterNodeGet(source, nodeAfter), [`${' '.repeat(indent)}text: ${yamlScalarTextBuild(text)}`]);
}
