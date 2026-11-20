import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, CornerDownRight, GripVertical, ListIcon, ListIndentDecrease,
  ListIndentIncrease, ListOrdered, ListTree, LoaderCircle, MousePointer2, Pencil, Plus, Trash2, X,
} from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { useDocEditDoc } from '../edit/DocEditDocContext.js';
import '../edit/DocEdit.css';
import './DocEditStruct.css';

// The toolbar of one list item (design:
// doc_page_impl_edit_structure.md#the-toolbar-of-an-item): the floating
// button group of an item, as a block has one. It shows for the item under
// the pointer while nothing is selected, and stays pinned to the selected
// item, where its buttons act on what is selected (the item alone, or the
// item with what is under it).
//
//   hover    [grip] [edit] [item above] [item below] [list ▾] [delete]
//   pinned   [what is selected] [grip] [edit] [item above] [item below]
//            [level up] [level deeper] [move up] [move down] [list ▾] [delete]
//
// the list menu holds the operations of the list: the level of the item (an
// item with sub-items can go deeper alone or with them), moving it among its
// siblings, a sub-item, bullets or numbers for its list, selecting it. the
// pinned toolbar shows the level and move operations as buttons, since what
// they act on is the selection.
//
// the grip is the handle of structural edit without a key
// (use-struct-pointer.js): a click selects the item (on the pinned toolbar,
// makes the selection one step larger), a drag moves it.
//
// every edit is reported as an event of the document (editItemEnterRequest,
// editItemInsertRequest, editItemLevelRequest, editItemMoveRequest,
// editItemListTypeRequest, editItemDeleteRequest; source: this document,
// this block and this item) and travels through the event layer to the
// stores (doc_page_impl_event.md). a deletion is confirmed in the toolbar.
//
//   blockIndex, itemPath   the item
//   isPinned               the item is the selection
const ICON_SIZE = 14;

export const DocEditItemToolbar = observer(function DocEditItemToolbar({ blockIndex, itemPath, isPinned }) {
  const { componentConfig, editStore, eventRouter, onEvent: onEventPage, structStore } = useDocStores();
  const { path } = useDocEditDoc();
  const menuButtonRef = useRef(null);
  const isMenuClosedByPointerDownRef = useRef(false);
  const Menu = componentConfig.Menu;
  const itemRef = { path, blockIndex, itemPath };
  const selection = isPinned ? structStore.selectionGet(path) : undefined;
  // what the buttons of the pinned toolbar act on
  const scopeSelected = selection?.scope === 'item' ? 'item' : 'subtree';
  const childCount = structStore.itemChildCountGet(itemRef);
  const descendantCount = structStore.itemDescendantCountGet(itemRef);
  const isSubmitting = editStore.isSubmitting || structStore.isSubmitting;
  const isMenuOpen = structStore.itemMenuIs(itemRef);
  const confirm = structStore.itemConfirmIs(itemRef) ? structStore.itemConfirm : undefined;
  const write = structStore.itemWriteIs(itemRef) ? structStore.itemWrite : undefined;
  const reasonGet = (action, scope) => structStore.itemEditReasonGet(itemRef, action, scope);

  const itemEventDispatch = (type, data = {}) => {
    const event = eventRouter.eventBuild({
      type,
      data,
      source: { placement: 'editItemToolbar', sourcePath: path, blockIndex, itemPath },
    });
    return eventRouter.dispatch(event, { onEventHost: onEventPage });
  };

  const levelRequest = (direction, scope) => void itemEventDispatch('editItemLevelRequest', { direction, scope });
  const moveRequest = (direction) => void itemEventDispatch('editItemMoveRequest', { direction });

  const menuItemList = isMenuOpen
    ? menuItemListBuild({ structStore, itemRef, childCount, isPinned, isSubmitting })
    : [];
  const menuItemChoose = (entryId) => {
    structStore.itemMenuClose();
    if (entryId === 'indentItem') levelRequest('in', 'item');
    else if (entryId === 'indentSubtree') levelRequest('in', 'subtree');
    else if (entryId === 'outdent') levelRequest('out', 'subtree');
    else if (entryId === 'moveUp') moveRequest('up');
    else if (entryId === 'moveDown') moveRequest('down');
    else if (entryId === 'child') void itemEventDispatch('editItemInsertRequest', { position: 'child' });
    else if (entryId === 'unordered' || entryId === 'ordered') void itemEventDispatch('editItemListTypeRequest', { type: entryId });
    else if (entryId === 'select') void structStore.selectionSet(path, blockIndex, itemPath);
    else if (entryId === 'grow') structStore.selectionGrowStep();
  };

  const menuButtonClick = () => {
    if (isMenuClosedByPointerDownRef.current) {
      isMenuClosedByPointerDownRef.current = false;
      return;
    }
    structStore.itemMenuToggle(itemRef);
  };

  const label = selection ? structStore.selectionLabelGet(selection).text : '';
  const reasonIndent = reasonGet('indent', scopeSelected);
  const reasonOutdent = reasonGet('outdent');
  const reasonMoveUp = reasonGet('moveUp');
  const reasonMoveDown = reasonGet('moveDown');

  return (
    <div className="doc-edit-item-toolbar" role="toolbar" aria-label="List item" data-pinned={isPinned ? '' : undefined}>
      {write?.status === 'error' ? (
        <span className="doc-error doc-edit-message doc-edit-toolbar-message" role="alert">{write.message}</span>
      ) : null}
      {confirm ? (
        <ItemDeleteConfirm
          confirm={confirm}
          childCount={descendantCount}
          reasonAlone={reasonGet('delete', 'item')}
          onConfirm={(scope) => void itemEventDispatch('editItemDeleteRequest', { scope })}
          onCancel={() => structStore.itemConfirmClear()}
        />
      ) : null}
      {isPinned ? <span className="doc-edit-toolbar-label">{label}</span> : null}
      <div className="doc-edit-toolbar-actions doc-button-group" role="group" aria-label="Item actions">
        <button
          type="button"
          className="doc-edit-struct-grip"
          data-struct-grip=""
          data-block-index={blockIndex}
          data-item-path={itemPath}
          disabled={isSubmitting}
          title={isPinned
            ? 'Drag to move what is selected · click to select one step more (Shift + click)'
            : `Drag to move this item${childCount > 0 ? ' with what is under it' : ''} · click to select it (Shift + click)`}
          aria-label="Move or select this item"
        >
          <GripVertical aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
        </button>
        <button type="button" disabled={isSubmitting} title="Edit the text of this item" aria-label="Edit the text of this item"
          onClick={() => void itemEventDispatch('editItemEnterRequest')}>
          <Pencil aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
        </button>
        <button type="button" disabled={isSubmitting} title="New item above" aria-label="New item above"
          onClick={() => void itemEventDispatch('editItemInsertRequest', { position: 'before' })}>
          <Plus aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
          <ArrowUp aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
        </button>
        <button type="button" disabled={isSubmitting}
          title={childCount > 0 ? 'New item below this item and what is under it' : 'New item below'} aria-label="New item below"
          onClick={() => void itemEventDispatch('editItemInsertRequest', { position: 'after' })}>
          <Plus aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
          <ArrowDown aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
        </button>
        {isPinned ? (
          <>
            <button type="button" disabled={isSubmitting || reasonOutdent !== ''}
              title={reasonOutdent || 'One level up, with what is under it (Shift + Tab)'} aria-label="One level up"
              onClick={() => levelRequest('out', 'subtree')}>
              <ListIndentDecrease aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
            </button>
            <button type="button" disabled={isSubmitting || reasonIndent !== ''}
              title={reasonIndent || (scopeSelected === 'item' && childCount > 0
                ? 'One level deeper, the item alone: its sub-items keep their level (Tab)'
                : 'One level deeper (Tab)')}
              aria-label="One level deeper"
              onClick={() => levelRequest('in', scopeSelected)}>
              <ListIndentIncrease aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
            </button>
            <button type="button" disabled={isSubmitting || reasonMoveUp !== ''}
              title={reasonMoveUp || 'Move up among the items of its list (Alt + ↑)'} aria-label="Move up"
              onClick={() => moveRequest('up')}>
              <ChevronUp aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
            </button>
            <button type="button" disabled={isSubmitting || reasonMoveDown !== ''}
              title={reasonMoveDown || 'Move down among the items of its list (Alt + ↓)'} aria-label="Move down"
              onClick={() => moveRequest('down')}>
              <ChevronDown aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} />
            </button>
          </>
        ) : null}
        {Menu ? (
          <button
            ref={menuButtonRef}
            type="button"
            disabled={isSubmitting}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            aria-pressed={isMenuOpen}
            title="List operations: level, order, sub-item, bullets or numbers"
            aria-label="List operations"
            onPointerDown={() => { isMenuClosedByPointerDownRef.current = isMenuOpen; }}
            onClick={menuButtonClick}
          >
            {write?.status === 'submitting'
              ? <LoaderCircle aria-hidden="true" size={ICON_SIZE} strokeWidth={2.2} className="doc-spin" />
              : <ListTree aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />}
          </button>
        ) : null}
        <button type="button" data-danger="" disabled={isSubmitting} aria-pressed={Boolean(confirm)}
          title="Delete this item" aria-label="Delete this item"
          onClick={() => structStore.itemConfirmSet(itemRef, isPinned ? scopeSelected : undefined)}>
          <Trash2 aria-hidden="true" size={ICON_SIZE} strokeWidth={2} />
        </button>
      </div>
      {isMenuOpen && Menu ? (
        <Menu
          data={{ items: menuItemList }}
          config={{
            isOpen: true,
            isBackdropScrollPassThrough: true,
            isClickPropagationStopped: true,
            className: 'doc-edit-popup doc-edit-mode-menu doc-edit-item-menu',
            minWidth: 190,
            anchor: {
              getRect: () => menuButtonRef.current?.getBoundingClientRect(),
              getTargetEl: () => menuButtonRef.current,
              offsetY: (menuButtonRef.current?.offsetHeight ?? 0) + 2,
            },
          }}
          onEvent={(eventType, eventData) => {
            if (eventType === 'itemClick') menuItemChoose(eventData.itemId ?? eventData.item?.id);
            if (eventType === 'closeRequest') structStore.itemMenuClose();
          }}
        />
      ) : null}
    </div>
  );
});

// the entries of the list menu; an entry that cannot be chosen now is greyed
// out and says why on hover
function menuItemListBuild({ structStore, itemRef, childCount, isPinned, isSubmitting }) {
  const reasonGet = (action, scope) => structStore.itemEditReasonGet(itemRef, action, scope);
  const listType = structStore.itemListTypeGet(itemRef);
  const itemBuild = (id, Icon, text, title, reason = '', mark = '') => ({
    id,
    isDisabled: isSubmitting || reason !== '',
    comp: ItemMenuEntry,
    compProps: { Icon, text, title: reason || title, mark },
  });
  const headBuild = (id, text) => ({ id, isContainer: true, comp: ItemMenuHead, compProps: { text } });
  const itemList = [];
  if (!isPinned) {
    itemList.push(headBuild('head:level', 'Level'));
    if (childCount > 0) {
      itemList.push(
        itemBuild('indentItem', ListIndentIncrease, 'Deeper, item only', 'One level deeper; its sub-items keep their level and follow it', reasonGet('indent', 'item')),
        itemBuild('indentSubtree', ListIndentIncrease, 'Deeper, with sub-items', 'One level deeper, with everything under it', reasonGet('indent', 'subtree')),
      );
    } else {
      itemList.push(itemBuild('indentSubtree', ListIndentIncrease, 'Deeper', 'One level deeper: under the item before it', reasonGet('indent', 'subtree')));
    }
    itemList.push(
      itemBuild('outdent', ListIndentDecrease, 'Up', 'One level up, with what is under it; the items after it in its list come under it', reasonGet('outdent')),
      headBuild('head:order', 'Order'),
      itemBuild('moveUp', ChevronUp, 'Move up', 'Swap with the item before it in its list', reasonGet('moveUp')),
      itemBuild('moveDown', ChevronDown, 'Move down', 'Swap with the item after it in its list', reasonGet('moveDown')),
    );
  }
  itemList.push(
    headBuild('head:list', 'List'),
    itemBuild('child', CornerDownRight, 'New sub-item', 'A new item under this one'),
    itemBuild('unordered', ListIcon, 'Bullets', 'The list this item is in, as bullets', '', listType === 'unordered' ? 'current' : ''),
    itemBuild('ordered', ListOrdered, 'Numbers', 'The list this item is in, as numbers', '', listType === 'ordered' ? 'current' : ''),
    headBuild('head:select', 'Select'),
    isPinned
      ? itemBuild('grow', MousePointer2, 'Select one step more', 'The item with what is under it, then the item above, up to the whole list (Shift + click)')
      : itemBuild('select', MousePointer2, 'Select this item', 'Select the item to move it or change its level with the keyboard (Shift + click)'),
  );
  return itemList;
}

function ItemMenuHead({ text }) {
  return <span className="doc-edit-mode-head">{text}</span>;
}

function ItemMenuEntry({ Icon, text, title, mark }) {
  return (
    <span className="doc-edit-mode-item" title={title}>
      <span className="doc-edit-mode-item-icon">{Icon ? <Icon size={13} aria-hidden="true" /> : null}</span>
      <span className="doc-edit-mode-item-label">{text}</span>
      {mark ? <span className="doc-edit-mode-item-marks">[{mark}]</span> : null}
    </span>
  );
}

// the confirmation of a deletion, in the toolbar itself.
//   confirm.scope   what the toolbar deletes (the pinned one: the selection);
//                   undefined: an item with sub-items offers both ways
function ItemDeleteConfirm({ confirm, childCount, reasonAlone, onConfirm, onCancel }) {
  const isSubmitting = confirm.status === 'submitting';
  const isBothOffered = confirm.scope === undefined && childCount > 0;
  const countText = childCount === 1 ? 'the 1 item under it' : `the ${childCount} items under it`;
  let question = 'Delete this item?';
  if (childCount > 0 && confirm.scope === 'item') question = `Delete this item alone? ${childCount === 1 ? 'The item under it moves' : `The ${childCount} items under it move`} up one level.`;
  else if (childCount > 0 && confirm.scope === 'subtree') question = `Delete this item and ${countText}?`;
  const Icon = isSubmitting ? LoaderCircle : Check;
  return (
    <div className="doc-edit-confirm" role="alertdialog" aria-label={question}>
      <span>{question}</span>
      {isBothOffered ? (
        <>
          <button type="button" className="is-danger" disabled={isSubmitting} onClick={() => onConfirm('subtree')}>
            <Icon aria-hidden="true" size={11} strokeWidth={2.2} className={isSubmitting ? 'doc-spin' : undefined} />
            <span>With {countText}</span>
          </button>
          <button type="button" className="is-danger" disabled={isSubmitting || reasonAlone !== ''}
            title={reasonAlone || 'The items under it move up one level'} onClick={() => onConfirm('item')}>
            <Trash2 aria-hidden="true" size={11} strokeWidth={2.2} />
            <span>Item only</span>
          </button>
        </>
      ) : (
        <button type="button" className="is-danger" disabled={isSubmitting} onClick={() => onConfirm(confirm.scope ?? 'subtree')}>
          <Icon aria-hidden="true" size={11} strokeWidth={2.2} className={isSubmitting ? 'doc-spin' : undefined} />
          <span>Delete</span>
        </button>
      )}
      <button type="button" disabled={isSubmitting} onClick={onCancel}>
        <X aria-hidden="true" size={11} strokeWidth={2.2} />
        <span>Keep</span>
      </button>
      {confirm.status === 'error' && confirm.message ? (
        <span className="doc-error doc-edit-message" role="alert">{confirm.message}</span>
      ) : null}
    </div>
  );
}
