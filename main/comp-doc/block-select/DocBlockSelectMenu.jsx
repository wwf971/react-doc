import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowDown, ArrowUp, Copy, LoaderCircle, Move, Trash2 } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { clickAfterPointerDownSuppress } from '../edit/use-edit-outside-pointer.js';
import '../edit/DocEdit.css';
import './DocBlockSelect.css';

// The right-click menu of the selected blocks
// (doc_page_impl_copy_paste.md#selecting-blocks). Open state lives in
// DocBlockSelectStore.contextMenu, set by DocBlockSelectBlock; the menu is
// the Menu of @wwf971/react-comp-misc injected as config.components.Menu,
// at the point of the click, styled like the mode menu of a block.
//   Copy Blocks To…        the dialog that copies or moves them, Copy first
//   Move Blocks To…        the same dialog, Move first
//   ─────
//   Duplicate Above        a copy of the block right above / below it; one
//   Duplicate Below        selected block only (greyed out otherwise)
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
  const { componentConfig, blockSelectStore } = useDocStores();
  const Menu = componentConfig.Menu;
  const menu = blockSelectStore?.contextMenu;
  const isOpen = Boolean(Menu && blockSelectStore?.isContextMenuOpen);

  useEffect(() => {
    if (!isOpen) return undefined;
    const keyDownHandle = (event) => {
      if (event.key !== 'Escape') return;
      if (blockSelectStore.contextMenu?.step === 'deleteConfirm') blockSelectStore.contextMenuStepSet('actions');
      else blockSelectStore.contextMenuClose();
    };
    document.addEventListener('keydown', keyDownHandle);
    return () => document.removeEventListener('keydown', keyDownHandle);
  }, [isOpen, blockSelectStore]);

  if (!isOpen) return null;

  const count = blockSelectStore.selectionIndexListGet(blockSelectStore.selection?.path ?? '').length;
  const countText = count === 1 ? 'the selected block' : `the ${count} selected blocks`;
  const isSubmitting = menu.status === 'submitting';
  const items = menu.step === 'deleteConfirm'
    ? deleteConfirmItemListBuild(count, isSubmitting)
    : actionItemListBuild(countText, blockSelectStore.duplicateDisabledReason, isSubmitting);
  if (menu.status === 'error') {
    items.push({ id: 'message', isContainer: true, comp: MenuNote, compProps: { text: menu.message, isError: true } });
  }

  const itemChoose = (entryId) => {
    if (entryId === 'copy' || entryId === 'move') blockSelectStore.transferOpen(entryId);
    else if (entryId === 'duplicateAbove') void blockSelectStore.selectionDuplicate('above');
    else if (entryId === 'duplicateBelow') void blockSelectStore.selectionDuplicate('below');
    else if (entryId === 'delete') blockSelectStore.contextMenuStepSet('deleteConfirm');
    else if (entryId === 'deleteConfirm') void blockSelectStore.selectionDelete();
    else if (entryId === 'deleteCancel') blockSelectStore.contextMenuStepSet('actions');
    else blockSelectStore.contextMenuClose();
  };

  const blockElementGet = () => document.querySelector(
    `.doc-edit-body .doc-block-select-block[data-block-index="${menu.blockIndex}"]`,
  );

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

function actionItemListBuild(countText, duplicateDisabledReason, isSubmitting) {
  const itemBuild = (id, Icon, text, title, reason = '', isDanger = false) => ({
    id,
    isDisabled: isSubmitting || reason !== '',
    comp: ContextMenuItem,
    compProps: { Icon, text, title: reason || title, isDanger, isBusy: false },
  });
  return [
    itemBuild('copy', Copy, 'Copy Blocks To…', `Copy ${countText} to a place of a document`),
    itemBuild('move', Move, 'Move Blocks To…', `Move ${countText} to a place of a document`),
    { id: 'rule-duplicate', isContainer: true, comp: MenuRule },
    itemBuild('duplicateAbove', ArrowUp, 'Duplicate Above', 'Insert a copy of the block right above it', duplicateDisabledReason),
    itemBuild('duplicateBelow', ArrowDown, 'Duplicate Below', 'Insert a copy of the block right below it', duplicateDisabledReason),
    { id: 'rule-delete', isContainer: true, comp: MenuRule },
    itemBuild('delete', Trash2, 'Delete Blocks…', `Delete ${countText} from the document`, '', true),
  ];
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
      comp: ContextMenuItem,
      compProps: { Icon: Trash2, text: 'Delete', title: 'Delete them from the document', isDanger: true, isBusy: isSubmitting },
    },
    {
      id: 'deleteCancel',
      isDisabled: isSubmitting,
      comp: ContextMenuItem,
      compProps: { Icon: undefined, text: 'Cancel', title: 'Keep the blocks' },
    },
  ];
}

function ContextMenuItem({ Icon, text, title, isDanger = false, isBusy = false }) {
  return (
    <span className="doc-edit-mode-item" title={title} data-danger={isDanger ? '' : undefined}>
      <span className="doc-edit-mode-item-icon">
        {isBusy
          ? <LoaderCircle size={13} aria-hidden="true" className="doc-edit-spin" />
          : Icon ? <Icon size={13} aria-hidden="true" /> : null}
      </span>
      <span className="doc-edit-mode-item-label">{text}</span>
    </span>
  );
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
