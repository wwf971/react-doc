import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify as yamlStringify,
  type Document,
  type Node,
  type Pair,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';
import { textLineListGet, type LineOperation } from './doc-edit-lines.ts';

// Changing a yaml file in place, as line operations (doc-edit-lines.ts).
// Shared by every write of the page into a yaml file it did not author: a
// side-panel label (doc-side-panel-text.ts), a config value of config.yaml
// (doc-edit-server.ts, route config/value), an item of a side panel moved
// within its list, into another list, or into another file
// (doc-side-panel-move.ts).
//
// The file is never rebuilt from its parsed object: that would drop the
// comments, requote what the author wrote, and reorder nothing predictably.
// Instead the parsed document only tells where a value is (yaml keeps the
// character range of every node); the lines holding that value are rebuilt
// around the new text, or new lines are inserted into the mapping that
// should hold the key, and every other line of the file stays byte for
// byte as it was.
//
// two levels of operations:
//   a value     yamlValueSetOperationBuild, nodeReplaceBuild, linesInsertBuild:
//               the lines of one scalar or one key
//   an item     yamlSeqItemLinesGet, yamlSeqItemRemoveBuild, yamlSeqItemInsertBuild,
//   of a list   yamlLinesIndentShift: the lines of one item of a block sequence,
//               with the comments that belong to it, taken out of its list and
//               put into another list at another indentation; the lists may be
//               in two files. lineOperationListApply applies the operations
//               of one file together.

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
        return { code: 0, data: { operation: keyLineValueSetBuild(source, pair.key, valueText) }, message: '' };
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

// the line of "key: value" rebuilt with another value written on it (or
// none: valueText ''), keeping what precedes the colon and a trailing
// comment: "key:" alone gets its value, "key: []" loses it. for a value
// written on the key's line only (a scalar, a flow collection): a block
// value below the key is not touched.
export function keyLineValueSetBuild(source: string, keyNode: Node, valueText: string): LineOperation {
  const lineIndex = lineIndexOfOffset(source, (keyNode.range as [number, number, number])[0]);
  const line = textLineListGet(source)[lineIndex];
  const indexColon = line.indexOf(':', nodeColumnGet(source, keyNode));
  const before = line.slice(0, indexColon + 1);
  const after = line.slice(indexColon + 1);
  const indexComment = after.search(/(^|\s)#/);
  const comment = indexComment >= 0 ? ` ${after.slice(indexComment).trim()}` : '';
  const value = valueText === '' ? '' : ` ${valueText}`;
  return { action: 'replaceLines', lineStart: lineIndex + 1, lineEnd: lineIndex + 1, text: `${before}${value}${comment}` };
}

// ---------- an item of a block sequence ----------
//
// the lines of an item are the lines from its "-" to the end of its value,
// with the comments that belong to it:
//   - the comment lines right above the "-", at the column of the "-"
//     (what the author wrote about the item), and
//   - the comment lines right after its value, indented deeper than the "-"
//     (still inside the item's body).
// a blank line ends either run: a blank line separates, it belongs to no item.
//
//     # about a                 <- lines of item a
//     - doc: a.md               <-
//       text: A                 <-
//       # inside a              <-
//
//     - doc: b.md

export type YamlSeqItemLines = {
  // 1-based, inclusive
  lineStart: number;
  lineEnd: number;
  // the column of the item's "-"
  column: number;
};

export type YamlEditResult<T> =
  | { code: 0; data: T; message: '' }
  | { code: -1; data: null; message: string };

function resultFail(message: string): { code: -1; data: null; message: string } {
  return { code: -1, data: null, message };
}

export function yamlSeqItemLinesGet(source: string, seq: YAMLSeq, index: number): YamlEditResult<YamlSeqItemLines> {
  if (seq.flow) return resultFail('the list is written in flow form ([a, b]); write it over several lines first');
  const item = seq.items[index] as Node | null | undefined;
  if (!item || !Array.isArray(item.range)) return resultFail(`the list has no item ${index}`);
  const lineList = textLineListGet(source);

  // the "-" is the first character before the item's value, possibly on an
  // earlier line ("-" alone, the value on the next line)
  let offsetDash = (item.range as [number, number, number])[0] - 1;
  while (offsetDash >= 0 && /\s/.test(source[offsetDash])) offsetDash--;
  if (offsetDash < 0 || source[offsetDash] !== '-') {
    return resultFail('the item is not written as "- ..." (a comment between the "-" and its value?)');
  }
  const lineIndexDash = lineIndexOfOffset(source, offsetDash);
  const column = offsetDash - lineOffsetGet(source, lineIndexDash);
  if (lineList[lineIndexDash].slice(0, column).trim() !== '') {
    return resultFail('the item shares its line with other content ("- - x", "key: - x")');
  }

  let lineIndexStart = lineIndexDash;
  while (lineIndexStart > 0 && lineIsCommentAt(lineList[lineIndexStart - 1], (indent) => indent === column)) {
    lineIndexStart--;
  }
  let lineIndexEnd = lineIndexOfOffset(source, nodeEndOffsetGet(source, item));
  const itemNext = seq.items[index + 1] as Node | undefined;
  const lineIndexLimit = itemNext && Array.isArray(itemNext.range)
    ? lineIndexOfOffset(source, (itemNext.range as [number, number, number])[0])
    : lineList.length;
  while (lineIndexEnd + 1 < lineIndexLimit && lineIsCommentAt(lineList[lineIndexEnd + 1], (indent) => indent > column)) {
    lineIndexEnd++;
  }
  if (itemNext && lineIndexEnd >= lineIndexLimit) return resultFail('the item ends on the line of the next item');
  return { code: 0, data: { lineStart: lineIndexStart + 1, lineEnd: lineIndexEnd + 1, column }, message: '' };
}

// a comment line ("  # ...") whose indentation the test accepts
function lineIsCommentAt(line: string | undefined, isIndentAccepted: (indent: number) => boolean): boolean {
  if (line === undefined) return false;
  const indent = line.length - line.trimStart().length;
  return line.trimStart().startsWith('#') && isIndentAccepted(indent);
}

// the lines moved delta columns to the right (a negative delta: to the left,
// by at most the spaces a line starts with). blank lines stay empty.
export function yamlLinesIndentShift(lineList: string[], delta: number): string[] {
  return lineList.map((line) => {
    if (line.trim() === '') return '';
    if (delta >= 0) return `${' '.repeat(delta)}${line}`;
    const indent = line.length - line.trimStart().length;
    return line.slice(Math.min(indent, -delta));
  });
}

// how far the file indents the "-" of a list below its key: 0 for
//   tree:
//   - doc: a
// and 2 for "  - doc: a". the first block list with items tells; 2 when none does
export function yamlSeqIndentOffsetGet(source: string, document: Document): number {
  let offset: number | undefined;
  const visit = (node: unknown) => {
    if (offset !== undefined) return;
    if (isMap(node)) {
      for (const pair of node.items as Pair<Node, Node | null>[]) {
        const value = pair.value;
        if (isSeq(value) && !value.flow && value.items.length > 0 && Array.isArray(pair.key?.range)) {
          const lines = yamlSeqItemLinesGet(source, value, 0);
          if (lines.code === 0) {
            offset = lines.data.column - nodeColumnGet(source, pair.key);
            return;
          }
        }
        visit(value);
        if (offset !== undefined) return;
      }
    } else if (isSeq(node)) {
      for (const item of node.items) visit(item);
    }
  };
  visit(document.contents);
  return offset !== undefined && offset >= 0 ? offset : 2;
}

// removing item index of the list at seqPath. a list that becomes empty is
// written "key: []" on its key's line, so a folder stays a folder (and a
// side panel keeps its "tree"). when the item stands between two blank
// lines, one of them goes with it, so the gap stays one line.
//   data.itemLines   where the item was, for the caller that moves it
//   data.lineList    the item's lines, as they are in the file
export function yamlSeqItemRemoveBuild(
  source: string,
  document: Document,
  seqPath: (string | number)[],
  index: number,
): YamlEditResult<{ operationList: LineOperation[]; itemLines: YamlSeqItemLines; lineList: string[] }> {
  const seq = document.getIn(seqPath, true);
  if (!isSeq(seq)) return resultFail(`no list at ${JSON.stringify(seqPath)}`);
  const itemLinesResult = yamlSeqItemLinesGet(source, seq, index);
  if (itemLinesResult.code !== 0) return itemLinesResult;
  const itemLines = itemLinesResult.data;
  const lineListFile = textLineListGet(source);
  const lineList = lineListFile.slice(itemLines.lineStart - 1, itemLines.lineEnd);

  let lineEndRemoved = itemLines.lineEnd;
  const lineBefore = lineListFile[itemLines.lineStart - 2];
  const lineAfter = lineListFile[itemLines.lineEnd];
  if (lineBefore !== undefined && lineBefore.trim() === '' && lineAfter !== undefined && lineAfter.trim() === '') {
    lineEndRemoved++;
  }
  const operationList: LineOperation[] = [
    { action: 'deleteLines', lineStart: itemLines.lineStart, lineEnd: lineEndRemoved },
  ];
  if (seq.items.length === 1) {
    const keyNode = seqKeyNodeGet(document, seqPath);
    if (!keyNode) return resultFail('the list becomes empty and is not the value of a key');
    operationList.push(keyLineValueSetBuild(source, keyNode, '[]'));
  }
  return { code: 0, data: { operationList, itemLines, lineList }, message: '' };
}

// inserting an item, given as its lines with its "-" at column columnItem,
// into the list at seqPath before its item index (-1, or the length of the
// list: at its end). the lines are moved to the column of the list's items.
// the list need not exist: when seqPath ends with a key of a block mapping
// that has no such key, or whose value is empty ("children:") or an empty
// flow list ("children: []"), the key gets the list, indented the way the
// file indents its lists (yamlSeqIndentOffsetGet); index is then 0 or -1.
export function yamlSeqItemInsertBuild(
  source: string,
  document: Document,
  seqPath: (string | number)[],
  index: number,
  lineList: string[],
  columnItem: number,
): YamlEditResult<{ operationList: LineOperation[] }> {
  const seq = document.getIn(seqPath, true);
  if (isSeq(seq) && seq.items.length > 0) {
    if (seq.flow) return resultFail('the list is written in flow form ([a, b]); write it over several lines first');
    const indexAt = index < 0 ? seq.items.length : index;
    if (indexAt > seq.items.length) return resultFail(`the list has ${seq.items.length} items, no place ${indexAt}`);
    const itemFirst = yamlSeqItemLinesGet(source, seq, 0);
    if (itemFirst.code !== 0) return itemFirst;
    const itemAt = yamlSeqItemLinesGet(source, seq, Math.min(indexAt, seq.items.length - 1));
    if (itemAt.code !== 0) return itemAt;
    const lineAt = indexAt < seq.items.length ? itemAt.data.lineStart : itemAt.data.lineEnd + 1;
    const lineListShifted = yamlLinesIndentShift(lineList, itemFirst.data.column - columnItem);
    return { code: 0, data: { operationList: [linesInsertBuild(lineAt, lineListShifted)] }, message: '' };
  }

  if (index > 0) return resultFail(`the list is empty, no place ${index}`);
  const key = seqPath[seqPath.length - 1];
  const mapping = document.getIn(seqPath.slice(0, -1), true);
  if (typeof key !== 'string' || !isMap(mapping)) return resultFail(`no mapping to hold "${String(key)}" at ${JSON.stringify(seqPath)}`);
  if (mapping.flow) return resultFail('the item is written as a flow mapping ({ a: 1 }); write it over several lines first');
  const pair = mapping.items.find((item) => isScalar(item.key) && String(item.key.value) === key) as Pair<Node, Node | null> | undefined;
  const seqIndentOffset = yamlSeqIndentOffsetGet(source, document);

  if (pair) {
    const value = pair.value;
    const isValueEmpty = value === null || (isScalar(value) && valueNodeIsEmpty(source, value));
    const isValueListEmpty = isSeq(value) && value.items.length === 0;
    if (!isValueEmpty && !isValueListEmpty) return resultFail(`"${key}" holds a value that is not a list`);
    const lineIndexKey = lineIndexOfOffset(source, (pair.key.range as [number, number, number])[0]);
    const columnKey = nodeColumnGet(source, pair.key);
    const lineListShifted = yamlLinesIndentShift(lineList, columnKey + seqIndentOffset - columnItem);
    const operationList: LineOperation[] = [];
    if (isValueListEmpty) operationList.push(keyLineValueSetBuild(source, pair.key, ''));
    operationList.push(linesInsertBuild(lineIndexKey + 2, lineListShifted));
    return { code: 0, data: { operationList }, message: '' };
  }

  const pairFirst = mapping.items[0] as Pair<Node, Node | null> | undefined;
  if (!pairFirst || !Array.isArray(pairFirst.key?.range)) return resultFail('the mapping has no key to align the list with');
  const columnKey = nodeColumnGet(source, pairFirst.key);
  const lineListShifted = yamlLinesIndentShift(lineList, columnKey + seqIndentOffset - columnItem);
  const lineAt = lineAtAfterNodeGet(source, mapping);
  return {
    code: 0,
    data: { operationList: [linesInsertBuild(lineAt, [`${' '.repeat(columnKey)}${yamlScalarTextBuild(key)}:`, ...lineListShifted])] },
    message: '',
  };
}

// the key a list is the value of, when it is one
function seqKeyNodeGet(document: Document, seqPath: (string | number)[]): Node | undefined {
  const key = seqPath[seqPath.length - 1];
  const mapping = document.getIn(seqPath.slice(0, -1), true);
  if (typeof key !== 'string' || !isMap(mapping)) return undefined;
  const pair = mapping.items.find((item) => isScalar(item.key) && String(item.key.value) === key) as Pair<Node, Node | null> | undefined;
  return pair && Array.isArray(pair.key?.range) ? pair.key : undefined;
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
