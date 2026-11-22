import { createHash } from 'node:crypto';

export {
  lineOperationApply, lineOperationIsValid, lineOperationListApply, operationLineListGet, textLineListGet,
} from '../src/lib/doc-line-operation.ts';
export type { LineOperation } from '../src/lib/doc-line-operation.ts';

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

// the operations themselves are applied by src/lib/doc-line-operation.ts,
// which the page uses too; this file adds what only the server has.

// identity of one file version. the browser sends the hash it edited against,
// so a change made elsewhere since then is detected instead of overwritten.
export function textHashGet(text: string): string {
  return createHash('sha1').update(text, 'utf-8').digest('hex');
}

