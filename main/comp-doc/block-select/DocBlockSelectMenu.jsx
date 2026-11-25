import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Move, Trash2 } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { clickAfterPointerDownSuppress } from '../edit/use-edit-outside-pointer.js';
import { ATOM_MENU_EVENT } from '../edit/surface-atom.js';
import { DocMenuEntry } from '../edit/DocMenu.jsx';
import '../edit/DocEdit.css';
import './DocBlockSelect.css';

// The right-click menu of the selected blocks
// (doc_page_impl_edit_structure.md#block-selection-mode), in block selection
// mode and in edit mode (a right click on a block that is not being edited:
// that block alone). Open state lives in DocBlockSelectStore.contextMenu,
// set by DocBlockSelectBlock and DocEditBlock; the menu is
// the Menu of @wwf971/react-comp-misc injected as config.components.Menu,
// at the point of the click, styled like the mode menu of a block.
//   Delete Formula…        when the click was on a thing drawn as one unit in
//   ─────                  the text of the block (contextMenuPart: a formula,
//                          a code block or an MDX block of an item,
//                          doc_page_impl_edit_structure.md#deleting-a-thing);
//                          asked first, as Delete Blocks…. a thing of a text
//                          being typed (a chip: ATOM_MENU_EVENT of the surface)
//                          has this entry alone, without the …: it goes at once
//   Copy Blocks To…        the dialog that copies or moves them, Copy first
//   Move Blocks To…        the same dialog, Move first
//   ─────
//   Duplicate Above        a copy of the block right above / below it
//   Duplicate Below
//   Move Up                the block swapped with its neighbor, as the
//   Move Down              move buttons of the block's toolbar in edit mode
//                          (duplicate and move: one selected block only,
//                          greyed out with the reason otherwise)
//   ─────
//   Delete Blocks…         asks in the menu itself: Delete · Cancel
//
// the menu is anchored to the point of the block that was right-clicked
// (config.anchor), not to the window: when the page scrolls, it moves with
// the block. opening again while it is open is a close and an opening on
// the next frame (the store), and the menu is keyed by its openId, so the
// Menu never carries the state of the previous opening into the new one. a
// pointer going down elsewhere closes it; the click of that gesture only
// closes, so it does not change the selection. while a write started from
// the menu runs, its entries are locked; a failure is shown in the menu.
export const DocBlockSelectMenu = observer(function DocBlockSelectMenu() {
  const { componentConfig, blockSelectStore, editStore } = useDocStores();
  const Menu = componentConfig.Menu;
  const menu = blockSelectStore?.contextMenu;
  const isOpen = Boolean(Menu && blockSelectStore?.isContextMenuOpen);

  // a chip right-clicked in a text being typed (the surface asks for the menu:
  // ATOM_MENU_EVENT): the menu of that thing, at the block of the session
  useEffect(() => {
    if (!blockSelectStore || !Menu) return undefined;
    const atomMenuHandle = (event) => {
      const session = editStore?.session;
      const detail = event.detail ?? {};
      if (!session || !blockSelectStore.isContextMenuAvailable) return;
      const blockElement = blockElementOf(session.path, session.blockIndex);
      if (!blockElement) return;
      // taken: the surface keeps the browser's menu away
      event.preventDefault();
      const rect = blockElement.getBoundingClientRect();
      blockSelectStore.contextMenuOpen(session.path, session.blockIndex, { x: detail.clientX - rect.left, y: detail.clientY - rect.top }, {
        label: String(detail.label ?? 'thing'),
        isTyped: true,
        remove: () => {
          detail.remove?.();
          return { code: 0, message: '' };
        },
      });
    };
    document.addEventListener(ATOM_MENU_EVENT, atomMenuHandle);
    return () => document.removeEventListener(ATOM_MENU_EVENT, atomMenuHandle);
  }, [blockSelectStore, editStore, Menu]);

  // Escape closes the menu only (the confirmation goes back to the entries):
  // taken before a surface being typed under the menu would cancel its session
  useEffect(() => {
    if (!isOpen) return undefined;
    const keyDownHandle = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const step = blockSelectStore.contextMenu?.step;
      if (step === 'deleteConfirm' || step === 'partDeleteConfirm') blockSelectStore.contextMenuStepSet('actions');
      else blockSelectStore.contextMenuClose();
    };
    document.addEventListener('keydown', keyDownHandle, true);
    return () => document.removeEventListener('keydown', keyDownHandle, true);
  }, [isOpen, blockSelectStore]);

  if (!isOpen) return null;

  const count = blockSelectStore.selectionIndexListGet(blockSelectStore.selection?.path ?? '').length;
  const countText = count === 1 ? 'the selected block' : `the ${count} selected blocks`;
  const isSubmitting = menu.status === 'submitting';
  const part = blockSelectStore.contextMenuPart;
  let items;
  if (menu.step === 'deleteConfirm') items = deleteConfirmItemListBuild(count, isSubmitting);
  else if (menu.step === 'partDeleteConfirm' && part) items = partDeleteConfirmItemListBuild(part, isSubmitting);
  else if (part?.isTyped) items = [partItemBuild(part, isSubmitting)];
  else if (part) items = [partItemBuild(part, isSubmitting), { id: 'rule-part', isContainer: true, comp: MenuRule }, ...actionItemListBuild(countText, blockSelectStore, isSubmitting)];
  else items = actionItemListBuild(countText, blockSelectStore, isSubmitting);
  if (menu.status === 'error') {
    items.push({ id: 'message', isContainer: true, comp: MenuNote, compProps: { text: menu.message, isError: true } });
  }

  const itemChoose = (entryId) => {
    if (entryId === 'copy' || entryId === 'move') blockSelectStore.transferOpen(entryId);
    else if (entryId === 'duplicateAbove') void blockSelectStore.selectionDuplicate('above');
    else if (entryId === 'duplicateBelow') void blockSelectStore.selectionDuplicate('below');
    else if (entryId === 'moveUp') void blockSelectStore.selectionMove('up');
    else if (entryId === 'moveDown') void blockSelectStore.selectionMove('down');
    else if (entryId === 'delete') blockSelectStore.contextMenuStepSet('deleteConfirm');
    else if (entryId === 'deleteConfirm') void blockSelectStore.selectionDelete();
    else if (entryId === 'deleteCancel' || entryId === 'partDeleteCancel') blockSelectStore.contextMenuStepSet('actions');
    else if (entryId === 'partDelete') void blockSelectStore.contextMenuPartDelete();
    else if (entryId === 'partDeleteConfirm') void blockSelectStore.contextMenuPartDelete({ isConfirmed: true });
    else blockSelectStore.contextMenuClose();
  };

  // the block right-clicked: its wrapper in block selection mode, or in edit mode
  const blockElementGet = () => blockElementOf(menu.path, menu.blockIndex);

  return (
    <Menu
      key={menu.openId}
      data={{ items }}
      config={{
        isOpen: true,
        isBackdropScrollPassThrough: true,
        isClickPropagationStopped: true,
        className: 'doc-edit-popup doc-edit-mode-menu doc-block-select-menu',
        minWidth: 160,
        anchor: {
          getRect: () => blockElementGet()?.getBoundingClientRect(),
          getTargetEl: blockElementGet,
          offsetX: menu.offset.x,
          offsetY: menu.offset.y,
        },
      }}
      onEvent={(eventType, eventData) => {
        if (eventType === 'itemClick') itemChoose(eventData.itemId ?? eventData.item?.id);
        if (eventType === 'closeRequest') {
          clickAfterPointerDownSuppress({ isControlClickKept: true });
          blockSelectStore.contextMenuClose();
        }
      }}
    />
  );
});

function actionItemListBuild(countText, blockSelectStore, isSubmitting) {
  const duplicateDisabledReason = blockSelectStore.blockSingleActionDisabledReason;
  const itemBuild = (id, Icon, text, title, reason = '', isDanger = false) => ({
    id,
    isDisabled: isSubmitting || reason !== '',
    comp: DocMenuEntry,
    compProps: { Icon, text, title: reason || title, isDanger, isBusy: false },
  });
  return [
    itemBuild('copy', Copy, 'Copy Blocks To…', `Copy ${countText} to a place of a document`),
    itemBuild('move', Move, 'Move Blocks To…', `Move ${countText} to a place of a document`),
    { id: 'rule-duplicate', isContainer: true, comp: MenuRule },
    itemBuild('duplicateAbove', ArrowUp, 'Duplicate Above', 'Insert a copy of the block right above it', duplicateDisabledReason),
    itemBuild('duplicateBelow', ArrowDown, 'Duplicate Below', 'Insert a copy of the block right below it', duplicateDisabledReason),
    itemBuild('moveUp', ChevronUp, 'Move Up', 'Swap the block with the one above it', blockSelectStore.blockMoveDisabledReasonGet('up')),
    itemBuild('moveDown', ChevronDown, 'Move Down', 'Swap the block with the one below it', blockSelectStore.blockMoveDisabledReasonGet('down')),
    { id: 'rule-delete', isContainer: true, comp: MenuRule },
    itemBuild('delete', Trash2, 'Delete Blocks…', `Delete ${countText} from the document`, '', true),
  ];
}

// 'code block' -> 'Code Block', as the entries are written
function labelTitleGet(label) {
  return String(label).split(' ').map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)).join(' ');
}

function partItemBuild(part, isSubmitting) {
  const name = labelTitleGet(part.label);
  return {
    id: 'partDelete',
    isDisabled: isSubmitting,
    comp: DocMenuEntry,
    compProps: {
      Icon: Trash2,
      text: part.isTyped ? `Delete ${name}` : `Delete ${name}…`,
      title: part.isTyped ? `Take the ${part.label} out of the text (Undo brings it back)` : `Delete the ${part.label} from the document`,
      isDanger: true,
    },
  };
}

function partDeleteConfirmItemListBuild(part, isSubmitting) {
  return [
    { id: 'partDeleteHead', isContainer: true, comp: MenuNote, compProps: { text: `Delete the ${part.label}?` } },
    {
      id: 'partDeleteConfirm',
      isDisabled: isSubmitting,
      comp: DocMenuEntry,
      compProps: { Icon: Trash2, text: 'Delete', title: `Delete the ${part.label} from the document`, isDanger: true, isBusy: isSubmitting },
    },
    {
      id: 'partDeleteCancel',
      isDisabled: isSubmitting,
      comp: DocMenuEntry,
      compProps: { Icon: undefined, text: 'Cancel', title: `Keep the ${part.label}` },
    },
  ];
}

// the wrapper of a block of the body of a document (the page's, or one in a popup)
function blockElementOf(path, blockIndex) {
  return document.querySelector(`.doc-edit-body[data-edit-path="${CSS.escape(path)}"] .doc-edit-block[data-block-index="${blockIndex}"]`);
}

function deleteConfirmItemListBuild(count, isSubmitting) {
  return [
    {
      id: 'deleteHead',
      isContainer: true,
      comp: MenuNote,
      compProps: { text: count === 1 ? 'Delete the selected block?' : `Delete the ${count} selected blocks?` },
    },
    {
      id: 'deleteConfirm',
      isDisabled: isSubmitting,
      comp: DocMenuEntry,
      compProps: { Icon: Trash2, text: 'Delete', title: 'Delete them from the document', isDanger: true, isBusy: isSubmitting },
    },
    {
      id: 'deleteCancel',
      isDisabled: isSubmitting,
      comp: DocMenuEntry,
      compProps: { Icon: undefined, text: 'Cancel', title: 'Keep the blocks' },
    },
  ];
}

function MenuNote({ text, isError = false }) {
  return (
    <span className="doc-block-select-menu-note" data-error={isError ? '' : undefined} role={isError ? 'alert' : undefined}>
      {text}
    </span>
  );
}

function MenuRule() {
  return <span className="doc-block-select-menu-rule" aria-hidden="true" />;
}
