import { isMap, isScalar, isSeq, parseDocument, stringify as yamlStringify, type Node, type Pair, type YAMLMap } from 'yaml';
import { textLineListGet, type LineOperation } from './doc-edit-lines.ts';

// Changing one value of a yaml file in place, as a line operation
// (doc-edit-lines.ts). Shared by every write of the page into a yaml file
// it did not author: a side-panel label (doc-side-panel-text.ts), a config
// value of config.yaml (doc-edit-server.ts, route config/value).
//
// The file is never rebuilt from its parsed object: that would drop the
// comments, requote what the author wrote, and reorder nothing predictably.
// Instead the parsed document only tells where a value is (yaml keeps the
// character range of every node); the lines holding that value are rebuilt
// around the new text, or new lines are inserted into the mapping that
// should hold the key, and every other line of the file stays byte for
// byte as it was.

// ---------- a value, written as yaml text on one line ----------

// one yaml scalar on one line: plain when yaml writes it plain, otherwise
// quoted. yaml's own stringify decides what needs quoting ("a: b", "- x",
// "12", a leading space); folding is off so the scalar never wraps.
export function yamlScalarTextBuild(text: string): string {
  const scalarText = yamlStringify(text, { lineWidth: 0 }).replace(/\n$/, '');
  if (scalarText.includes('\n')) return JSON.stringify(text);
  return scalarText;
}

// a config value as one line of yaml: null, a boolean, a number, a string
// (quoted when needed), or a list of strings as a flow sequence [a, b].
// undefined: the value cannot be written (an object, a nested list).
export function yamlValueTextBuild(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'string') return yamlScalarTextBuild(value);
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === 'string')) return undefined;
    return `[${value.map((item) => yamlScalarTextBuild(item)).join(', ')}]`;
  }
  return undefined;
}

// ---------- positions in the source ----------

// the line holding the character at offset: one line per "\n" before it. the
// end offset of a value is at most its line's "\n", which still counts to
// that line.
export function lineIndexOfOffset(source: string, offset: number): number {
  let lineIndex = 0;
  for (let index = 0; index < offset; index++) {
    if (source[index] === '\n') lineIndex++;
  }
  return lineIndex;
}

export function lineOffsetGet(source: string, lineIndex: number): number {
  let offset = 0;
  for (let index = 0; index < lineIndex; index++) {
    offset = source.indexOf('\n', offset) + 1;
  }
  return offset;
}

// the offset right after the last character of a node's text. the range of
// a block scalar ("|", ">"), a block sequence or a block mapping ends after
// its final line break: step back onto its last line.
export function nodeEndOffsetGet(source: string, node: Node): number {
  const [offsetStart, offsetEndRange] = node.range as [number, number, number];
  let offsetEnd = offsetEndRange;
  while (offsetEnd > offsetStart && (source[offsetEnd - 1] === '\n' || source[offsetEnd - 1] === '\r')) offsetEnd--;
  return offsetEnd;
}

// the column a node starts at (its indentation when it starts its line)
export function nodeColumnGet(source: string, node: Node): number {
  const [offsetStart] = node.range as [number, number, number];
  return offsetStart - lineOffsetGet(source, lineIndexOfOffset(source, offsetStart));
}

// the 1-based line number right after the line holding the end of a node:
// where lines that follow the node are inserted
export function lineAtAfterNodeGet(source: string, node: Node): number {
  return lineIndexOfOffset(source, nodeEndOffsetGet(source, node)) + 2;
}

// ---------- operations ----------

// the lines holding a node are rebuilt: what precedes the node on its first
// line, the new text, what follows it on its last line (a trailing
// comment). a value written over several lines becomes one line.
export function nodeReplaceBuild(source: string, node: Node, text: string): LineOperation {
  const [offsetStart] = node.range as [number, number, number];
  const offsetEnd = nodeEndOffsetGet(source, node);
  const lineList = textLineListGet(source);
  const lineIndexStart = lineIndexOfOffset(source, offsetStart);
  const lineIndexEnd = lineIndexOfOffset(source, offsetEnd);
  const prefix = source.slice(lineOffsetGet(source, lineIndexStart), offsetStart);
  const suffix = source.slice(offsetEnd, lineOffsetGet(source, lineIndexEnd) + lineList[lineIndexEnd].length);
  return {
    action: 'replaceLines',
    lineStart: lineIndexStart + 1,
    lineEnd: lineIndexEnd + 1,
    text: `${prefix}${text}${suffix}`,
  };
}

// "key: value" lines inserted before line lineAt, indented by indent spaces
export function linesInsertBuild(lineAt: number, lineList: string[]): LineOperation {
  return { action: 'insertLines', lineAt, text: lineList.join('\n') };
}

// ---------- setting a value by key path ----------

export type YamlValueSetResult =
  | { code: 0; data: { operation: LineOperation }; message: '' }
  | { code: -1; data: null; message: string };

// the operation that gives keyPath the value, written as valueText:
//   the key exists with a scalar or a sequence   its lines are rebuilt
//   the key is missing                           a "key: value" line is added
//                                                at the end of its mapping
//   mappings on the way are missing              they are added too, nested
//   a mapping on the way is written empty        ("compConfig:" alone) its
//                                                lines are added below it
// refused: a file that does not parse or whose root is not a block mapping,
// a key path through a flow mapping ({ a: 1 }) or through a value that is
// not a mapping, a key that holds a mapping itself.
export function yamlValueSetOperationBuild(source: string, keyPath: string[], valueText: string): YamlValueSetResult {
  if (keyPath.length === 0) return { code: -1, data: null, message: 'the key path is empty' };
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return { code: -1, data: null, message: `the file does not parse: ${document.errors[0].message}` };
  }
  const root = document.contents;
  if (!isMap(root)) return { code: -1, data: null, message: 'the file is not a yaml mapping' };
  if (root.flow) return { code: -1, data: null, message: 'the file is written as a flow mapping; write it over several lines first' };
  const indentUnit = indentUnitGet(source, root);

  let mapping: YAMLMap = root;
  for (let index = 0; index < keyPath.length; index++) {
    const key = keyPath[index];
    const isLast = index === keyPath.length - 1;
    const pathText = keyPath.slice(0, index + 1).join('.');
    const pair = mapping.items.find((item) => isScalar(item.key) && String(item.key.value) === key) as Pair<Node, Node | null> | undefined;

    if (!pair) {
      // the rest of the path is new: nested lines at the end of this mapping
      const indent = mappingChildIndentGet(source, mapping, indentUnit);
      const lineAt = mappingEndLineAtGet(source, mapping);
      const lineList = pathLineListBuild(keyPath.slice(index), valueText, indent, indentUnit);
      return { code: 0, data: { operation: linesInsertBuild(lineAt, lineList) }, message: '' };
    }

    const valueNode = pair.value;
    if (isLast) {
      if (isMap(valueNode)) return { code: -1, data: null, message: `"${pathText}" holds a mapping, not a value` };
      if (valueNode === null || !Array.isArray(valueNode.range)) {
        return { code: -1, data: null, message: `the value of "${pathText}" has no position in the file` };
      }
      if (isScalar(valueNode) && valueNodeIsEmpty(source, valueNode)) {
        // "key:" with nothing after it: the value goes on the key's line
        return { code: 0, data: { operation: keyLineValueAppendBuild(source, pair.key, valueText) }, message: '' };
      }
      return { code: 0, data: { operation: nodeReplaceBuild(source, valueNode, valueText) }, message: '' };
    }

    if (isMap(valueNode)) {
      if (valueNode.flow) {
        return { code: -1, data: null, message: `"${pathText}" is written as a flow mapping; write it over several lines first` };
      }
      mapping = valueNode;
      continue;
    }
    if (isScalar(valueNode) && valueNodeIsEmpty(source, valueNode)) {
      // "compConfig:" written without a value: the nested lines go right below
      const indent = nodeColumnGet(source, pair.key) + indentUnit;
      const lineAt = lineAtAfterNodeGet(source, pair.key);
      const lineList = pathLineListBuild(keyPath.slice(index + 1), valueText, indent, indentUnit);
      return { code: 0, data: { operation: linesInsertBuild(lineAt, lineList) }, message: '' };
    }
    return { code: -1, data: null, message: `"${pathText}" is not a mapping` };
  }
  return { code: -1, data: null, message: 'the key path was not resolved' };
}

// the value at keyPath as plain data, undefined when the path is not there
// or the file does not parse
export function yamlValueGet(source: string, keyPath: string[]): unknown {
  const document = parseDocument(source);
  if (document.errors.length > 0) return undefined;
  if (!document.hasIn(keyPath)) return undefined;
  const node = document.getIn(keyPath, true);
  if (node === undefined) return undefined;
  if (isScalar(node) || isSeq(node) || isMap(node)) return node.toJSON();
  return node;
}

// a scalar with no text in the source: "key:" followed by nothing (an
// implicit null). an explicit "null" or "~" has text and is not empty.
function valueNodeIsEmpty(source: string, node: Node): boolean {
  if (!Array.isArray(node.range)) return true;
  const [offsetStart, offsetEnd] = node.range as [number, number, number];
  return source.slice(offsetStart, offsetEnd).trim() === '';
}

// "key:" alone on its line gets the value after the colon, keeping a comment
function keyLineValueAppendBuild(source: string, keyNode: Node, valueText: string): LineOperation {
  const lineIndex = lineIndexOfOffset(source, (keyNode.range as [number, number, number])[0]);
  const line = textLineListGet(source)[lineIndex];
  const indexColon = line.indexOf(':', nodeColumnGet(source, keyNode));
  const before = line.slice(0, indexColon + 1);
  const after = line.slice(indexColon + 1);
  const indexComment = after.indexOf('#');
  const comment = indexComment >= 0 ? ` ${after.slice(indexComment).trimEnd()}` : '';
  return { action: 'replaceLines', lineStart: lineIndex + 1, lineEnd: lineIndex + 1, text: `${before} ${valueText}${comment}` };
}

// "a:", "  b:", "    c: value" for the path [a, b, c], from indent on
function pathLineListBuild(keyList: string[], valueText: string, indent: number, indentUnit: number): string[] {
  return keyList.map((key, index) => {
    const prefix = ' '.repeat(indent + index * indentUnit);
    const keyText = yamlScalarTextBuild(key);
    return index === keyList.length - 1 ? `${prefix}${keyText}: ${valueText}` : `${prefix}${keyText}:`;
  });
}

// the column of the keys of a mapping; for a mapping without items, the
// column its parent key would give its children
function mappingChildIndentGet(source: string, mapping: YAMLMap, indentUnit: number): number {
  const pairFirst = mapping.items[0] as Pair<Node, Node | null> | undefined;
  if (pairFirst && Array.isArray(pairFirst.key.range)) return nodeColumnGet(source, pairFirst.key);
  if (Array.isArray(mapping.range)) return nodeColumnGet(source, mapping);
  return indentUnit;
}

// the line number right after the last line of a mapping (its last value, or
// the comment on that value's line)
function mappingEndLineAtGet(source: string, mapping: YAMLMap): number {
  if (mapping.items.length === 0 || !Array.isArray(mapping.range)) {
    return textLineListGet(source).length + 1;
  }
  return lineAtAfterNodeGet(source, mapping);
}

// how far the file indents a nested mapping: the first pair whose value is a
// block mapping with keys tells; 2 when none does
function indentUnitGet(source: string, root: YAMLMap): number {
  for (const pair of root.items as Pair<Node, Node | null>[]) {
    const valueNode = pair.value;
    if (!isMap(valueNode) || valueNode.flow || valueNode.items.length === 0) continue;
    const pairChild = valueNode.items[0] as Pair<Node, Node | null>;
    if (!Array.isArray(pairChild.key.range) || !Array.isArray(pair.key.range)) continue;
    const unit = nodeColumnGet(source, pairChild.key) - nodeColumnGet(source, pair.key);
    if (unit > 0) return unit;
  }
  return 2;
}
