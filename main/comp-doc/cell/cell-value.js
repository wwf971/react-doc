// A token typed as its value (doc_page_impl_edit_cell.md#a-token-typed-as-its-value): what the
// kit asks of a kind defining valueInline (cell-define.js), and what an owner saving a cell calls.
//
// While a cell is typed, such a token is not written out: its value is, as words of the typed
// text (a value segment, cell-style-surface.js), under a label naming it. The text of the cell is
// not changed by typing a value (it still says {{name/jp/last}}); the value typed is a draft of
// its own, which CellEdit reports (onValueChange) and the owner keeps with the cell when it saves:
//
//   value draft   { raw, token, textOld, text }
//                   raw       the token as written: drafts are one per token, so a token written
//                             twice in a cell is one value
//                   token     the token (lib/doc-cell.js), kind and data included
//                   textOld   the value as read when the cell was opened
//                   text      the value as typed
//
// CellField writes the drafts itself before the text (DocCellStore.fieldCommit); a component typing
// its cells with CellEdit calls cellValueListWrite when it saves.

// whether a cell has a kind typing its tokens as their values
export function cellValueInlineIs(cell) {
  return Boolean(cell?.tokenList?.some((kind) => kind?.valueInline));
}

// the value a token is typed as, or undefined (written out as any other token)
export function cellValueRead(token, cell) {
  const valueInline = token?.kind?.valueInline;
  if (!valueInline) return undefined;
  try {
    const value = valueInline.read(token, cell);
    return typeof value === 'string' ? value : undefined;
  } catch (error) {
    console.warn(`[doc-cell] ${token.kind.name}: valueInline.read failed`, error);
    return undefined;
  }
}

// what the label over a value says: the kind's, else the body of the token
export function cellValueLabelGet(token, cell) {
  const label = token?.kind?.valueInline?.labelGet?.(token, cell);
  return typeof label === 'string' && label !== '' ? label : String(token?.body ?? token?.raw ?? '');
}

// whether a draft says something else than the value it was opened on
export function cellValueIsChanged(draft) {
  return Boolean(draft) && draft.text !== draft.textOld;
}

// the drafts that were changed, written by their kinds one after another: { code: 0 } when every
// one was kept, else the answer of the first that was not (the rest are not written)
export async function cellValueListWrite(cell, valueList) {
  for (const draft of (valueList ?? []).filter(cellValueIsChanged)) {
    const valueInline = draft.token?.kind?.valueInline;
    if (!valueInline) continue;
    let result;
    try {
      result = await valueInline.write(draft.token, draft.text, cell);
    } catch (error) {
      result = { code: -1, message: String(error?.message ?? error) };
    }
    if (result && typeof result === 'object' && typeof result.code === 'number' && result.code !== 0) {
      return { code: result.code, message: String(result.message || `the value ${cellValueLabelGet(draft.token, cell)} was not kept`) };
    }
  }
  return { code: 0, message: '' };
}
