import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ListIndentDecrease, ListIndentIncrease, ListPlus } from '../../../main/frontend/UICommon.js';
import { itemBlockInfoIsText } from '../../../main/frontend/src/lib/doc-edit-list.js';
import { TextBlockEdit } from './TextBlockEdit.jsx';

// Edit mode of one item of a list block: the own text of the item, without
// its marker and its indentation, edited where the item stands. The list
// writes the text back into the item (indented to its text column), so the
// author types the text of the item and nothing of the list around it.
//
// An item is structure as well as text, and its keys are those of a list
// (doc_page_impl_edit_structure.md#the-keys-of-an-item). Each of them takes
// the text being typed along in one write, and the author goes on typing in
// the item it leaves the caret in:
//
//   Enter                 the item is split at the caret: a new item below
//                         takes the text after it (in an item without text:
//                         one level up, or out of the list)
//   Shift + Enter         a line break: the item becomes a text block, whose
//                         line breaks are kept
//   Backspace at the start   the item joins the row above
//   Delete at the end        the row below joins the item
//   Tab / Shift + Tab     the item one level deeper / up, with what is under it
//   ← at the start, → at the end   the caret goes on to the row above / below
//
// an item that is a text block of text (config.edit.session.itemFormat
// 'block', the language of its info "text": its lines are edited, the fences
// are the page's) has the same keys. Shift + Enter is a line break of the
// block; Enter splits the block at the caret, the lines after it going into
// the new item, and each part is a text block while it holds a line break and
// a plain line when it is one line.
//
// a text of lines that is no text is left whole: a block of code, and a
// source of several lines (a component with its data, two paragraphs). there
// Enter is a line break, with or without Shift, and nothing joins it.
//
// the edits are reported as events (editItemSplitRequest, editItemMergeRequest,
// editItemFormatRequest, editItemLevelRequest, editItemInsertRequest); the
// page knows which item is being edited.
export const ListItemEdit = observer(function ListItemEdit({ data = {}, config = {}, onEvent }) {
  const session = config.edit?.session;
  const isLocked = session?.status === 'submitting';
  const isBlock = session?.itemFormat === 'block';
  const text = typeof session?.textDraft === 'string' ? session.textDraft : String(data.text ?? '');
  // a text of several lines that is no text block: the source of a component, several paragraphs
  const isSourceOfLines = !isBlock && text.includes('\n');
  // a text of lines that is left whole: such a source, and a block of code
  const isLinesWhole = isSourceOfLines || (isBlock && !itemBlockInfoIsText(session?.itemBlockInfo));
  // where the caret was last, so the item is entered again there after its level changed
  const caretOffsetRef = useRef(undefined);

  const levelRequest = (direction, caretOffset) => {
    if (isLocked) return;
    void onEvent?.('editItemLevelRequest', { direction, offset: caretOffset ?? caretOffsetRef.current });
  };
  const insertRequest = () => {
    if (isLocked) return;
    void onEvent?.('editItemInsertRequest', { position: 'after' });
  };

  const keyDownHandle = (event, { caretOffset, selectionStart = 0, selectionEnd = 0, textLength = 0 } = {}) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isLocked) return false;
    const isCaret = selectionStart === selectionEnd;
    if (event.key === 'Tab') {
      event.preventDefault();
      levelRequest(event.shiftKey ? 'out' : 'in', caretOffset);
      return true;
    }
    if (event.key === 'Enter') {
      // a text of lines left whole: a line break, with or without Shift
      if (isLinesWhole && !event.shiftKey) return false;
      // Shift + Enter in a text that has lines already: one more
      if (event.shiftKey && (isBlock || isSourceOfLines)) {
        event.preventDefault();
        document.execCommand('insertText', false, '\n');
        return true;
      }
      event.preventDefault();
      void onEvent?.(event.shiftKey ? 'editItemFormatRequest' : 'editItemSplitRequest', {
        format: 'block',
        offsetStart: selectionStart,
        offsetEnd: selectionEnd,
      });
      return true;
    }
    if (event.shiftKey || !isCaret) return false;
    if (event.key === 'Backspace' && selectionStart === 0) {
      // a text of lines left whole joins nothing; without text it is simply taken out
      if (isLinesWhole && textLength > 0) return false;
      event.preventDefault();
      void onEvent?.('editItemMergeRequest', { direction: 'previous' });
      return true;
    }
    if (event.key === 'Delete' && selectionStart === textLength && !isLinesWhole) {
      event.preventDefault();
      void onEvent?.('editItemMergeRequest', { direction: 'next' });
      return true;
    }
    if (event.key === 'ArrowLeft' && selectionStart === 0) {
      event.preventDefault();
      void onEvent?.('editFocusShiftRequest', { direction: 'previous' });
      return true;
    }
    if (event.key === 'ArrowRight' && selectionStart === textLength) {
      event.preventDefault();
      void onEvent?.('editFocusShiftRequest', { direction: 'next' });
      return true;
    }
    return false;
  };

  return (
    <TextBlockEdit
      data={data}
      config={config}
      onEvent={onEvent}
      surfaceKeyDown={keyDownHandle}
      surfaceSelectionChange={({ end }) => { caretOffsetRef.current = end; }}
    >
      <span className="doc-edit-segment" role="group" aria-label="Level of the item">
        <button type="button" disabled={isLocked} title="One level up (Shift + Tab)" aria-label="One level up" onClick={() => levelRequest('out')}>
          <ListIndentDecrease aria-hidden="true" size={12} strokeWidth={2} />
        </button>
        <button type="button" disabled={isLocked} title="One level deeper (Tab)" aria-label="One level deeper" onClick={() => levelRequest('in')}>
          <ListIndentIncrease aria-hidden="true" size={12} strokeWidth={2} />
        </button>
      </span>
      <span className="doc-edit-segment" role="group" aria-label="Items">
        <button type="button" disabled={isLocked} title="New item below (Enter at the end of the text)" aria-label="New item below" onClick={insertRequest}>
          <ListPlus aria-hidden="true" size={12} strokeWidth={2} />
        </button>
      </span>
    </TextBlockEdit>
  );
});
