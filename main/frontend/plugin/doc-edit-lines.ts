import { createHash } from 'node:crypto';

// Line operations of the edit api (doc-edit-server.ts). A document is edited
// as a list of lines, 1-based and inclusive, so the browser never sends the
// whole file: it names the lines of one root-level block and the text that
// replaces them. design: doc_page_impl_edit.md
//
//   replaceLines   lines lineStart..lineEnd  -> lines of text
//   insertLines    lines of text are inserted before line lineAt
//                  (lineAt = lineCount + 1 appends at the end)
//   deleteLines    lines lineStart..lineEnd are removed
//   replaceAll     the whole file -> text
//
// the text of replaceLines / insertLines is a list of lines separated by
// "\n": "a\n" is the two lines ["a", ""], so a block followed by a blank line
// is expressed exactly; "" is no line at all. the text of replaceAll is a
// file: its trailing newline ends the last line.
//
// the line ending and the trailing newline of the file are kept as they are.

export type LineOperation =
  | { action: 'replaceLines'; lineStart: number; lineEnd: number; text: string }
  | { action: 'insertLines'; lineAt: number; text: string }
  | { action: 'deleteLines'; lineStart: number; lineEnd: number }
  | { action: 'replaceAll'; text: string };

export function lineOperationApply(textCurrent: string, operation: LineOperation): string {
  const eol = textCurrent.includes('\r\n') ? '\r\n' : '\n';
  const isTrailingNewline = textCurrent === '' || textCurrent.endsWith('\n');
  const lineList = textLineListGet(textCurrent);
  const lineCount = lineList.length;

  let lineListNext: string[];
  if (operation.action === 'replaceAll') {
    lineListNext = textLineListGet(String(operation.text ?? ''));
  } else if (operation.action === 'replaceLines') {
    lineRangeCheck(operation.lineStart, operation.lineEnd, lineCount);
    lineListNext = [
      ...lineList.slice(0, operation.lineStart - 1),
      ...operationLineListGet(String(operation.text ?? '')),
      ...lineList.slice(operation.lineEnd),
    ];
  } else if (operation.action === 'insertLines') {
    if (!lineNumberIs(operation.lineAt) || operation.lineAt > lineCount + 1) {
      throw new Error(`insertLines: lineAt must be between 1 and ${lineCount + 1}, got ${operation.lineAt}`);
    }
    lineListNext = [
      ...lineList.slice(0, operation.lineAt - 1),
      ...operationLineListGet(String(operation.text ?? '')),
      ...lineList.slice(operation.lineAt - 1),
    ];
  } else if (operation.action === 'deleteLines') {
    lineRangeCheck(operation.lineStart, operation.lineEnd, lineCount);
    lineListNext = [
      ...lineList.slice(0, operation.lineStart - 1),
      ...lineList.slice(operation.lineEnd),
    ];
  } else {
    throw new Error(`unknown line operation: ${String((operation as any)?.action)}`);
  }

  if (lineListNext.length === 0) return '';
  return lineListNext.join(eol) + (isTrailingNewline ? eol : '');
}

// lines of a replaceLines / insertLines text: every "\n" separates two lines,
// so "a\n" is ["a", ""]; "" is [].
export function operationLineListGet(text: string): string[] {
  if (text === '') return [];
  return text.split(/\r?\n/);
}

// lines of a file. a trailing newline ends the last line instead of starting
// an empty one, so "a\nb\n" is ["a", "b"] and "" is [].
export function textLineListGet(text: string): string[] {
  if (text === '') return [];
  const lineList = text.split(/\r?\n/);
  if (lineList[lineList.length - 1] === '') lineList.pop();
  return lineList;
}

// identity of one file version. the browser sends the hash it edited against,
// so a change made elsewhere since then is detected instead of overwritten.
export function textHashGet(text: string): string {
  return createHash('sha1').update(text, 'utf-8').digest('hex');
}

export function lineOperationIsValid(operation: any): operation is LineOperation {
  if (!operation || typeof operation !== 'object') return false;
  if (operation.action === 'replaceAll') return typeof operation.text === 'string';
  if (operation.action === 'insertLines') {
    return lineNumberIs(operation.lineAt) && typeof operation.text === 'string';
  }
  if (operation.action === 'replaceLines') {
    return lineNumberIs(operation.lineStart) && lineNumberIs(operation.lineEnd) && typeof operation.text === 'string';
  }
  if (operation.action === 'deleteLines') {
    return lineNumberIs(operation.lineStart) && lineNumberIs(operation.lineEnd);
  }
  return false;
}

function lineRangeCheck(lineStart: number, lineEnd: number, lineCount: number) {
  if (!lineNumberIs(lineStart) || !lineNumberIs(lineEnd) || lineStart > lineEnd || lineEnd > lineCount) {
    throw new Error(`line range ${lineStart}..${lineEnd} is not inside the ${lineCount} lines of the file`);
  }
}

function lineNumberIs(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}
