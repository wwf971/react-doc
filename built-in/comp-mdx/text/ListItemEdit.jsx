import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowDown, ArrowUp, ListIndentDecrease, ListIndentIncrease, Pilcrow, Plus } from '../../../main/frontend/UICommon.js';
import { itemBlockInfoIsText } from '../../../main/frontend/src/lib/doc-edit-list.js';
import { itemAtomOf } from '../../../main/frontend/src/lib/doc-edit-item-atom.js';
import { codeTextJoin, textJoinSpaceIs } from '../../../main/frontend/src/lib/doc-edit-code.js';
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
// the code blocks of the item drawn as icons (config.edit.session.itemAtom)
// are chips of its text, one character each: the text around them is typed
// as a line, Enter splits the item between them, Backspace at its start joins
// it to the row above, whatever blocks it holds; ← and → move over a chip,
// Backspace next to one selects it first
// (doc_page_impl_edit_structure.md#code-blocks-in-the-text-of-an-item).
//
// the lines of a code block among the text of the item (a part,
// config.edit.session.itemPart) are edited where they are drawn: Shift +
// Enter is a line break, Enter takes the lines after the caret out of the
// block as text of the item after it (so does Enter in a block of code that
// is the whole item); ← at their start, → at their end, ↑ on their
// first line and ↓ on their last lead back into the text of the item, beside
// the chip of the block; Backspace in empty lines takes the block out.
// Shift + Enter in the text of an item with chips makes the segment of text at
// the caret a text block of its own, whose lines are then edited so.
//
// the bar: the level of the item, a new item above or below it, and To text
// for an item edited as the lines of a code block, or a chip selected in the
// text: the lines joined into one line of text (codeTextJoin).
//
// the edits are reported as events (editItemSplitRequest, editItemMergeRequest,
// editItemFormatRequest, editItemLevelRequest, editItemInsertRequest,
// editItemPartLeaveRequest, editItemTextJoinRequest); the page knows which
// item is being edited.
export const ListItemEdit = observer(function ListItemEdit({ data = {}, config = {}, onEvent }) {
  const session = config.edit?.session;
  const isLocked = session?.status === 'submitting';
  const isBlock = session?.itemFormat === 'block';
  // the lines of one code block among the text of the item (a part)
  const isPart = Boolean(session?.itemPart);
  const atomModel = session?.itemAtom;
  const text = typeof session?.textDraft === 'string' ? session.textDraft : String(data.text ?? '');
  // a text of several lines that is no text block: the source of a component, several paragraphs
  const isSourceOfLines = !isBlock && text.includes('\n');
  // a text of lines that is left whole: such a source, a block of code, the lines of a part
  const isLinesWhole = isSourceOfLines || isPart || (isBlock && !itemBlockInfoIsText(session?.itemBlockInfo));
  // where the caret was last, so the item is entered again there after its level changed
  const caretOffsetRef = useRef(undefined);
  // the chip selected alone in the text (a code block among it): To text turns it into text
  const [chipSelected, chipSelectedSet] = useState(undefined);

  const levelRequest = (direction, caretOffset) => {
    if (isLocked) return;
    void onEvent?.('editItemLevelRequest', { direction, offset: caretOffset ?? caretOffsetRef.current });
  };
  const insertRequest = (position) => {
    if (isLocked) return;
    void onEvent?.('editItemInsertRequest', { position });
  };
  // a part is left by its edges: the author goes on in the text of the item,
  // beside its chip. left by ↑ / ↓ (point: where the caret was, rectSurface:
  // the box of the lines), on the line above or below the block at the same x
  const partLeaveRequest = (direction, isRemoved = false, point, rectSurface) => {
    if (isLocked) return;
    const lineHalf = point && rectSurface ? 14 : 0;
    const pointNext = point && rectSurface
      ? { clientX: point.clientX, clientY: direction === 'before' ? rectSurface.top - lineHalf : rectSurface.bottom + lineHalf }
      : undefined;
    void onEvent?.('editItemPartLeaveRequest', { direction, isRemoved, isVertical: Boolean(pointNext), point: pointNext, pointCaret: point });
  };

  // To text (doc_page_impl_mdx_code.md#the-lines-as-text): the lines of the
  // block the item is edited as joined into one line of text; in the text of an
  // item with chips, the chip selected replaced by its lines so joined, in the
  // text being typed (the item is written when it is saved)
  const chipAtom = chipSelected ? itemAtomOf(atomModel, chipSelected) : undefined;
  const textJoinReason = (() => {
    if (isBlock) return codeTextJoin(text) === '' ? 'the block has no text' : '';
    if (!chipAtom) return 'select a code block of the text first (a click on its chip)';
    if (chipAtom.isReference) return 'the lines are an item of the asset store';
    if (chipAtom.isEmbed) return 'an MDX block is a document of its own: double-click it to open it';
    return codeTextJoin(chipAtom.raw) === '' ? 'the block has no text' : '';
  })();
  const textJoinRequest = () => {
    if (isLocked || textJoinReason) return;
    if (isBlock) {
      void onEvent?.('editItemTextJoinRequest');
      return;
    }
    const index = text.indexOf(chipSelected);
    if (index < 0) return;
    const before = text.slice(0, index);
    const after = text.slice(index + chipSelected.length);
    const joined = codeTextJoin(chipAtom.raw);
    const textNew = `${before}${textJoinSpaceIs(before, joined) ? ' ' : ''}${joined}${textJoinSpaceIs(joined, after) ? ' ' : ''}${after}`;
    chipSelectedSet(undefined);
    void onEvent?.('editTextSetRequest', { text: textNew });
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
      // in the lines of a code block (a part, or a block of code that is the
      // whole item): Enter takes the lines after the caret out of the block,
      // as text of the item after it; Shift + Enter is a line break of the block
      const isCodeLines = isPart || (isBlock && !itemBlockInfoIsText(session?.itemBlockInfo));
      if (isCodeLines && !event.shiftKey) {
        event.preventDefault();
        void onEvent?.('editItemBlockSplitRequest', { offsetStart: selectionStart, offsetEnd: selectionEnd });
        return true;
      }
      // a text of lines left whole: a line break, with or without Shift
      if (isLinesWhole && !event.shiftKey) return false;
      // Shift + Enter in a text that has lines already: one more. in the text
      // of an item with chips, the segment at the caret becomes a text block
      if (event.shiftKey && (isBlock || (isSourceOfLines && !atomModel))) {
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
    if (isPart) {
      // the edges of a part lead back into the text of the item; Backspace or
      // Delete in its empty lines takes the block out
      if ((event.key === 'Backspace' || event.key === 'Delete') && textLength === 0) {
        event.preventDefault();
        partLeaveRequest('before', true);
        return true;
      }
      if (event.key === 'ArrowLeft' && selectionStart === 0) {
        event.preventDefault();
        partLeaveRequest('before');
        return true;
      }
      if (event.key === 'ArrowRight' && selectionStart === textLength) {
        event.preventDefault();
        partLeaveRequest('after');
        return true;
      }
      return false;
    }
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

  const selectionChange = ({ start, end, text: textSelected }) => {
    caretOffsetRef.current = end;
    const chip = end - start === textSelected.length && itemAtomOf(atomModel, textSelected) ? textSelected : undefined;
    if (chip !== chipSelected) chipSelectedSet(chip);
  };

  return (
    <TextBlockEdit
      data={data}
      config={config}
      onEvent={onEvent}
      atomModel={atomModel}
      surfaceKeyDown={keyDownHandle}
      surfaceSelectionChange={selectionChange}
      // a block a slash action puts at the caret (an MDX block): written into
      // the item there, a chip of its text
      blockInsert={(source, offset, textNow) => void onEvent?.('editItemBlockInsertRequest', { source, offset, text: textNow })}
      // ↑ on the first line of a part, ↓ on its last: back into the text of the item
      focusShift={isPart ? (direction, point, rectSurface) => partLeaveRequest(direction === 'previous' ? 'before' : 'after', false, point, rectSurface) : undefined}
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
        <button type="button" disabled={isLocked} title="New item above" aria-label="New item above" onClick={() => insertRequest('before')}>
          <Plus aria-hidden="true" size={12} strokeWidth={2.2} />
          <ArrowUp aria-hidden="true" size={12} strokeWidth={2.2} />
        </button>
        <button type="button" disabled={isLocked} title="New item below (Enter at the end of the text)" aria-label="New item below" onClick={() => insertRequest('after')}>
          <Plus aria-hidden="true" size={12} strokeWidth={2.2} />
          <ArrowDown aria-hidden="true" size={12} strokeWidth={2.2} />
        </button>
      </span>
      {isBlock || atomModel ? (
        <span className="doc-edit-segment" role="group" aria-label="Code block">
          <button type="button" disabled={isLocked || textJoinReason !== ''}
            title={textJoinReason || 'To text: the lines of the code block joined into one line of text, the line breaks removed'}
            aria-label="To text"
            // the chip stays selected in the text while the button is pressed
            onPointerDown={(event) => event.preventDefault()}
            onClick={textJoinRequest}>
            <Pilcrow aria-hidden="true" size={12} strokeWidth={2} />
            <span>To text</span>
          </button>
        </span>
      ) : null}
    </TextBlockEdit>
  );
});
