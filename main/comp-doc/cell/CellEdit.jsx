import { useRef } from 'react';
import { cellRangeRead } from '../../frontend/src/lib/doc-cell.js';
import { EditSourceSurface } from '../edit/EditSourceSurface.jsx';
import './Cell.css';

// A cell text typed (doc_page_impl_edit_cell.md#drawing-and-typing): the text
// as it is kept, tokens written out, in the editing surface of the edit layer
// (EditSourceSurface kind "plain": the type and box of where it stands, never
// an <input>), with the slash mode of the cell: the actions of its token
// kinds, "/" anywhere but in a path, and "{{" opening a token at once.
//
// The component owns the draft and decides what the keys it receives mean
// (Enter saves in a one-line cell): the keys of the slash menu come first, and
// a key it took is defaultPrevented when it reaches the component. CellField
// is this with the opening, the saving and the leaving done.
//
//   cell                the cell of the component (useCell)
//   text, textVersion   the draft; rewritten when textVersion changes
//   onSelectionChange({ start, end, text, isPlain })
//                       optional: what is selected in the text, as offsets into it;
//                       isPlain: words only, no token in it in part or whole, so
//                       the component may make it a token of its own (a value kept
//                       in its data and named here: cellTextRangeReplace). the last
//                       selection inside the surface stays known after the focus left
//   the other props are EditSourceSurface's
export function CellEdit({
  cell,
  text,
  textVersion = 0,
  tag = 'div',
  className = '',
  selectionInitial = 'end',
  isLocked = false,
  isFocusedInitial = true,
  isTabInserted = false,
  ariaLabel = 'The text of the cell',
  onTextChange,
  onSelectionChange,
  onSubmitRequest,
  onCancelRequest,
}) {
  // the text as typed, for reading a selection against the tokens it holds now; a text set
  // by code (textVersion) is the typed text from then on
  const textTypedRef = useRef(text);
  const textVersionRef = useRef(textVersion);
  if (textVersionRef.current !== textVersion) {
    textVersionRef.current = textVersion;
    textTypedRef.current = text;
  }
  const selectionHandle = onSelectionChange ? (range) => {
    const textNow = textTypedRef.current ?? '';
    const partList = cell?.parse ? cell.parse(textNow) : [];
    onSelectionChange({ ...range, ...cellRangeRead(partList, range.start, range.end, textNow) });
  } : undefined;
  return (
    <EditSourceSurface
      tag={tag}
      kind="plain"
      className={`doc-cell-edit${className ? ` ${className}` : ''}`}
      text={text}
      textVersion={textVersion}
      selectionInitial={selectionInitial}
      slash={cell?.slash}
      isLocked={isLocked}
      isFocusedInitial={isFocusedInitial}
      isTabInserted={isTabInserted}
      ariaLabel={ariaLabel}
      onTextChange={(textNext) => {
        textTypedRef.current = textNext;
        onTextChange?.(textNext);
      }}
      onSelectionChange={selectionHandle}
      onSubmitRequest={onSubmitRequest}
      onCancelRequest={onCancelRequest}
    />
  );
}
