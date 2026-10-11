import { isMap, isScalar, parseDocument, stringify as yamlStringify, type Pair, type Scalar, type YAMLMap } from 'yaml';
import { textLineListGet, type LineOperation } from './doc-edit-lines.ts';

// Changing the label of one side-panel item in its YAML file, as a line
// operation (doc-edit-lines.ts). design: doc_page_impl_side_panel.md
//
// The file is never rebuilt from its parsed object: that would drop the
// comments and reorder nothing predictably. Instead the parsed document only
// tells where the authored label is (yaml keeps the character range of every
// node), the lines holding that value are rebuilt around the new scalar, and
// every other line of the file stays byte for byte as it was.
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
  return { code: 0, data: { operation: scalarReplaceBuild(source, scalar, request.text), fieldName }, message: '' };
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

// the lines holding the scalar are rebuilt: what precedes the value on its
// first line, the new value, what follows it on its last line (a trailing
// comment). a value written over several lines becomes one line.
function scalarReplaceBuild(source: string, scalar: Scalar, text: string): LineOperation {
  const [offsetStart, offsetEndRange] = scalar.range as [number, number, number];
  // the range of a block scalar ("|", ">") ends after its final line break:
  // step back onto its last line
  let offsetEnd = offsetEndRange;
  while (offsetEnd > offsetStart && (source[offsetEnd - 1] === '\n' || source[offsetEnd - 1] === '\r')) offsetEnd--;
  const lineList = textLineListGet(source);
  const lineIndexStart = lineIndexOfOffset(source, offsetStart);
  const lineIndexEnd = lineIndexOfOffset(source, offsetEnd);
  const offsetLineStart = lineOffsetGet(source, lineIndexStart);
  const prefix = source.slice(offsetLineStart, offsetStart);
  const suffix = source.slice(offsetEnd, lineOffsetGet(source, lineIndexEnd) + lineList[lineIndexEnd].length);
  return {
    action: 'replaceLines',
    lineStart: lineIndexStart + 1,
    lineEnd: lineIndexEnd + 1,
    text: `${prefix}${yamlScalarTextBuild(text)}${suffix}`,
  };
}

// a "text" line after the first pair of the node, indented like its keys
function textLineInsertBuild(source: string, node: YAMLMap, text: string): LineOperation {
  const pairFirst = node.items[0] as Pair<any, any> | undefined;
  const [offsetNodeStart] = node.range as [number, number, number];
  const offsetPairEnd = pairFirst?.value?.range?.[1] ?? pairFirst?.key?.range?.[1] ?? offsetNodeStart;
  const lineIndexPairEnd = lineIndexOfOffset(source, offsetPairEnd);
  const indent = offsetNodeStart - lineOffsetGet(source, lineIndexOfOffset(source, offsetNodeStart));
  return {
    action: 'insertLines',
    lineAt: lineIndexPairEnd + 2,
    text: `${' '.repeat(indent)}text: ${yamlScalarTextBuild(text)}`,
  };
}

// one yaml scalar on one line: plain when yaml writes it plain, otherwise
// quoted. yaml's own stringify decides what needs quoting ("a: b", "- x",
// "12", a leading space); folding is off so the scalar never wraps.
export function yamlScalarTextBuild(text: string): string {
  const scalarText = yamlStringify(text, { lineWidth: 0 }).replace(/\n$/, '');
  if (scalarText.includes('\n')) return JSON.stringify(text);
  return scalarText;
}

// the line holding the character at offset: one line per "\n" before it. the
// end offset of a value is at most its line's "\n", which still counts to
// that line.
function lineIndexOfOffset(source: string, offset: number): number {
  let lineIndex = 0;
  for (let index = 0; index < offset; index++) {
    if (source[index] === '\n') lineIndex++;
  }
  return lineIndex;
}

function lineOffsetGet(source: string, lineIndex: number): number {
  let offset = 0;
  for (let index = 0; index < lineIndex; index++) {
    offset = source.indexOf('\n', offset) + 1;
  }
  return offset;
}
