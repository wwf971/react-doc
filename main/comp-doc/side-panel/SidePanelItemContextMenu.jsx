import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { Move, Pencil } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import '../edit/DocEdit.css';

// The right-click menu of a side-panel item in edit mode
// (doc_page_impl_side_panel.md#moving-an-item). Open state lives in
// DocSidePanelStore.contextMenu, set by SidePanelItemHost; the menu is the
// Menu of @wwf971/react-comp-misc injected by the host as
// config.components.Menu, at the point of the click, styled like the mode
// menu of a block. Its entries are the two buttons of the label:
//   Rename   sidePanelTextEditStartRequest, from the rendering that was
//            right-clicked (it becomes the owner of the edit)
//   Move…    sidePanelItemMovePickerOpenRequest, the picker at the click
// an entry that does not apply to the item is disabled and says why.
// a pointer going down elsewhere, or Escape, closes it; a right click on
// another row opens that row's menu.
export const SidePanelItemContextMenu = observer(function SidePanelItemContextMenu() {
  const { componentConfig, editStore, eventRouter, onEvent: onEventPage, sidePanelStore } = useDocStores();
  const Menu = componentConfig.Menu;
  const menu = sidePanelStore.contextMenu;
  const isOpen = Boolean(Menu && menu && editStore.isEditMode);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') sidePanelStore.contextMenuClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, sidePanelStore]);

  if (!isOpen) return null;

  const isRenameAvailable = editStore.sidePanelTextIsEditable(menu.itemId);
  const isMoveAvailable = sidePanelStore.itemIsMovable(menu.itemId) && !sidePanelStore.isMoveSubmitting;
  const items = [
    {
      id: 'rename',
      isDisabled: !isRenameAvailable,
      comp: ContextMenuItem,
      compProps: {
        Icon: Pencil,
        text: 'Rename',
        title: isRenameAvailable ? 'Edit the label in place' : 'this label is not written in a side panel file',
      },
    },
    {
      id: 'move',
      isDisabled: !isMoveAvailable,
      comp: ContextMenuItem,
      compProps: {
        Icon: Move,
        text: 'Move…',
        title: isMoveAvailable ? 'Choose where to put the item in a tree' : 'this item cannot be moved',
      },
    },
  ];

  const itemChoose = (entryId) => {
    sidePanelStore.contextMenuClose();
    if (entryId === 'rename') {
      const event = eventRouter.eventBuild({
        type: 'sidePanelTextEditStartRequest',
        source: { placement: 'sidePanelContextMenu', itemId: menu.itemId, instanceId: menu.instanceId },
      });
      void eventRouter.dispatch(event, { onEventHost: onEventPage });
      return;
    }
    if (entryId === 'move') {
      const event = eventRouter.eventBuild({
        type: 'sidePanelItemMovePickerOpenRequest',
        source: { placement: 'sidePanelContextMenu', itemId: menu.itemId, instanceId: menu.instanceId },
        point: menu.point,
      });
      void eventRouter.dispatch(event, { onEventHost: onEventPage });
    }
  };

  return (
    <Menu
      data={{ items }}
      config={{
        isOpen: true,
        isBackdropScrollPassThrough: true,
        isClickPropagationStopped: true,
        className: 'doc-edit-popup doc-edit-mode-menu',
        minWidth: 120,
        posOpen: { x: menu.point.clientX, y: menu.point.clientY },
      }}
      onEvent={(eventType, eventData) => {
        if (eventType === 'itemClick') itemChoose(eventData.itemId ?? eventData.item?.id);
        if (eventType === 'closeRequest') sidePanelStore.contextMenuClose();
      }}
    />
  );
});

function ContextMenuItem({ Icon, text, title }) {
  return (
    <span className="doc-edit-mode-item" title={title}>
      <span className="doc-edit-mode-item-icon"><Icon size={13} aria-hidden="true" /></span>
      <span className="doc-edit-mode-item-label">{text}</span>
    </span>
  );
}
