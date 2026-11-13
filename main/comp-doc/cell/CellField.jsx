import { useContext, useId, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { StoreContext } from '../../frontend/src/store/context.js';
import { useEditOutsidePointer } from '../edit/use-edit-outside-pointer.js';
import { CellEdit } from './CellEdit.jsx';
import { CellValue } from './CellValue.jsx';
import './Cell.css';

// One cell, drawn and edited where it stands (doc_page_impl_edit_cell.md#the-field):
// CellValue while it is read, CellEdit once it is clicked, with the opening,
// the saving and the leaving done, for a component that needs nothing more
// (a cell of a table, a field of a card). A component with a behavior of its
// own around the text (a card under the cell, several fields open together)
// uses CellValue and CellEdit itself.
//
//   a click           opens it, the caret where the click was (only while isEditable)
//   Enter             saves; Shift+Enter breaks the line (isMultiline: Enter breaks
//                     the line, Ctrl/⌘ + Enter saves)
//   Escape            closes it, the text as it was
//   a click elsewhere, Tab     saves
//
// Nothing moves when it opens: the surface stands in the box of the value, in
// its type, and what exists only while it is open floats (the reason of a
// refused save). One field is open on the page at a time (DocCellStore.field).
//
//   cell              the cell of the component (useCell)
//   value             the text kept in the data
//   onCommit(text)    the changed text; answers nothing, or { code, message }
//                     (or a promise of one): code other than 0 keeps the field
//                     open and shows the message
//   isEditable        whether a click opens it: for a mode of a frontend object,
//                     service.isEditable (doc_page_impl_obj_frontend.md#reading-and-editing)
//   editUnavailableReason   why not, as its title while the document is edited
//   as                the element of the field ('span': inside a line; 'div', 'td', …)
//   placeholder       shown for an empty value while it can be edited
//   fieldKey          its key in the store; default: one of its own
export const CellField = observer(function CellField({
  cell,
  value,
  onCommit,
  isEditable = false,
  editUnavailableReason = '',
  isMultiline = false,
  as: Tag = 'span',
  className = '',
  placeholder = '',
  fieldKey,
  ariaLabel = 'The text of the cell',
  ...rest
}) {
  // outside a page (no stores) the field only reads
  const cellStore = useContext(StoreContext)?.cellStore;
  const idOwn = useId();
  const key = fieldKey ?? idOwn;
  const rootRef = useRef(null);
  const isOpen = cellStore?.fieldIsOpen(key) === true;
  const field = isOpen ? cellStore.field : undefined;
  const text = String(value ?? '');
  const commit = () => void cellStore.fieldCommit(key, (draft) => onCommit?.(draft));
  useEditOutsidePointer(rootRef, isOpen, commit);
  // inside a line the surface is an inline box, so the line does not break around it
  const isInline = Tag === 'span';

  if (!isOpen) {
    const isClickable = isEditable && Boolean(cellStore);
    return (
      <Tag
        {...rest}
        ref={rootRef}
        className={`doc-cell-field${className ? ` ${className}` : ''}`}
        data-editable={isClickable ? '' : undefined}
        data-empty={text === '' ? '' : undefined}
        title={isClickable ? undefined : editUnavailableReason || undefined}
        onClick={isClickable ? (event) => {
          event.stopPropagation();
          cellStore.fieldOpen(key, text, { clientX: event.clientX, clientY: event.clientY });
        } : undefined}
      >
        <CellValue
          cell={cell}
          text={text}
          textEmpty={isClickable && placeholder ? <span className="doc-cell-field-placeholder">{placeholder}</span> : null}
          // a token with a card is selected by a click on it, and its card writes the text
          isEditable={isClickable}
          cellKey={key}
          onTextChange={(textNext) => onCommit?.(textNext)}
        />
      </Tag>
    );
  }

  const keyDownHandle = (event) => {
    // the surface and its slash menu take their keys first
    if (event.defaultPrevented || event.nativeEvent?.isComposing) return;
    if (event.key === 'Enter' && !isMultiline && !event.shiftKey) {
      event.preventDefault();
      commit();
    } else if (event.key === 'Tab') {
      commit();
    }
  };
  return (
    <Tag
      {...rest}
      ref={rootRef}
      className={`doc-cell-field${className ? ` ${className}` : ''}`}
      data-open=""
      data-inline={isInline ? '' : undefined}
      onKeyDown={keyDownHandle}
    >
      <CellEdit
        cell={cell}
        tag="span"
        text={field.textBase}
        selectionInitial={field.point ? { type: 'point', ...field.point } : 'end'}
        isLocked={field.status === 'submitting'}
        ariaLabel={ariaLabel}
        onTextChange={(draft) => cellStore.fieldDraftSet(key, draft)}
        onSubmitRequest={commit}
        onCancelRequest={() => cellStore.fieldClose(key)}
      />
      {field.message ? <span className="doc-cell-field-message doc-edit-popup" role="alert">{field.message}</span> : null}
    </Tag>
  );
});
