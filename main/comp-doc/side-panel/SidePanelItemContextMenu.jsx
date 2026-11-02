import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FileInput,
  FilePlus,
  FolderInput,
  FolderPlus,
  Move,
  Pencil,
  RotateCw,
  Trash2,
  Unplug,
} from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import '../edit/DocEdit.css';

// The menu of a side-panel item in edit mode (doc_page_impl_side_panel.md
// #moving-an-item, #changing-the-structure). Open state lives in
// DocSidePanelStore.contextMenu, set by SidePanelItemHost on a right click
// on the row or a click on the "more" button of the label; the menu is the
// Menu of @wwf971/react-comp-misc injected by the host as
// config.components.Menu, at that point, styled like the mode menu of a
// block. Its entries, in groups:
//
//   Rename, Move…, Refresh     the buttons of the label
//   New folder ▸, New document ▸   above / below / inside the item
//   Change document…, Bind document…, Bind folder…, Change folder…, Detach…
//                              the binding changes the item offers
//   Remove…                    the removal, confirmed in a dialog
//
// every entry reports the event of its action through the event router
// (placement sidePanelContextMenu), Rename with the instance id of the
// rendering that opened the menu, so that rendering owns the edit. an entry
// that does not apply to the item is disabled and says why on hover (the
// rules of lib/side-panel-node.js and lib/side-panel-move.js). a pointer
// going down elsewhere, or Escape, closes it; a right click on another row
// opens that row's menu.
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

  const items = menuItemListBuild(menu.itemId, { editStore, sidePanelStore });
  const actionById = actionByIdBuild(items);

  const itemChoose = (entryId) => {
    const action = actionById.get(entryId);
    sidePanelStore.contextMenuClose();
    if (!action) return;
    const event = eventRouter.eventBuild({
      type: action.eventType,
      data: action.data ?? {},
      source: { placement: 'sidePanelContextMenu', itemId: menu.itemId, instanceId: menu.instanceId },
      point: menu.point,
    });
    void eventRouter.dispatch(event, { onEventHost: onEventPage });
  };

  return (
    <Menu
      data={{ items }}
      config={{
        isOpen: true,
        isBackdropScrollPassThrough: true,
        isClickPropagationStopped: true,
        className: 'doc-edit-popup doc-edit-mode-menu',
        minWidth: 168,
        posOpen: { x: menu.point.clientX, y: menu.point.clientY },
      }}
      onEvent={(eventType, eventData) => {
        if (eventType === 'itemClick') itemChoose(eventData.itemId ?? eventData.item?.id);
        if (eventType === 'closeRequest') sidePanelStore.contextMenuClose();
      }}
    />
  );
});

// the entries of the menu for one item, each { id, isDisabled, comp,
// compProps, action: { eventType, data } } or a group separator
function menuItemListBuild(itemId, { editStore, sidePanelStore }) {
  const isBusy = sidePanelStore.isMoveSubmitting || sidePanelStore.isNodeChangeSubmitting;
  const isRenameAvailable = editStore.sidePanelTextIsEditable(itemId);
  const isMoveAvailable = sidePanelStore.itemIsMovable(itemId) && !sidePanelStore.isMoveSubmitting;
  const isRefreshAvailable = sidePanelStore.itemIsRefreshable(itemId) && !sidePanelStore.isRefreshSubmitting;
  const itemList = [
    entryBuild('rename', Pencil, 'Rename', isRenameAvailable ? '' : 'this label is not written in a side panel file',
      'Edit the label in place', { eventType: 'sidePanelTextEditStartRequest' }),
    entryBuild('move', Move, 'Move…', isMoveAvailable ? '' : 'this item cannot be moved',
      'Choose where to put the item in a tree', { eventType: 'sidePanelItemMovePickerOpenRequest' }),
    entryBuild('refresh', RotateCw, 'Refresh', isRefreshAvailable ? '' : 'this item is bound to no file or folder to read again',
      'Read the file or folder of this item again from disk', { eventType: 'sidePanelItemRefreshRequest' }),
    separatorBuild('separator-insert'),
  ];

  for (const kind of ['folder', 'doc']) {
    const childList = [['before', 'Above'], ['after', 'Below'], ['insideLast', 'Inside, last']].map(([position, text]) => {
      const resolved = sidePanelStore.insertResolve(itemId, position);
      const reason = isBusy ? 'another change is being written' : (resolved.code !== 0 ? resolved.message : '');
      return entryBuild(`insert-${kind}-${position}`, undefined, text, reason, '', {
        eventType: 'sidePanelItemInsertRequest',
        data: { kind, position },
      });
    });
    const isAnyAllowed = childList.some((child) => !child.isDisabled);
    itemList.push({
      ...entryBuild(
        `insert-${kind}`,
        kind === 'folder' ? FolderPlus : FilePlus,
        kind === 'folder' ? 'New folder' : 'New document',
        isAnyAllowed ? '' : childList[0].compProps.title,
        kind === 'folder' ? 'A folder for items, labeled as you type' : 'An empty .mdx document, placed in a folder of this doc page',
      ),
      children: isAnyAllowed ? childList : [],
    });
  }

  const bindActionList = sidePanelStore.bindActionListGet(itemId);
  if (bindActionList.length > 0) {
    itemList.push(separatorBuild('separator-bind'));
    for (const { action, reason } of bindActionList) {
      const spec = bindEntrySpecByAction[action];
      itemList.push(entryBuild(`bind-${action}`, spec.Icon, spec.text, isBusy ? 'another change is being written' : reason, spec.title, {
        eventType: 'sidePanelItemBindRequest',
        data: { kind: spec.kind },
      }));
    }
  }

  const removed = sidePanelStore.removeResolve(itemId);
  itemList.push(separatorBuild('separator-remove'));
  itemList.push(entryBuild('remove', Trash2, 'Remove…', isBusy ? 'another change is being written' : (removed.code !== 0 ? removed.message : ''),
    'Remove the item from the side panel (asks first)', { eventType: 'sidePanelItemRemoveRequest' }, true));
  return itemList;
}

const bindEntrySpecByAction = {
  docChange: { kind: 'doc', Icon: FileInput, text: 'Change document…', title: 'Show another document of this doc page' },
  docBind: { kind: 'doc', Icon: FileInput, text: 'Bind document…', title: 'Show a document of this doc page when the item is clicked' },
  folderBind: { kind: 'folder', Icon: FolderInput, text: 'Bind folder…', title: 'Mirror a source folder: its files become the items' },
  folderChange: { kind: 'folder', Icon: FolderInput, text: 'Change folder…', title: 'Mirror another source folder' },
  detach: { kind: 'none', Icon: Unplug, text: 'Detach…', title: 'Keep the item as a folder, bound to nothing' },
};

function entryBuild(id, Icon, text, reason, title, action, isDanger = false) {
  return {
    id,
    isDisabled: reason !== '',
    comp: ContextMenuItem,
    compProps: { Icon, text, title: reason || title, isDanger },
    action,
  };
}

function separatorBuild(id) {
  return { id, isContainer: true, comp: ContextMenuSeparator };
}

function actionByIdBuild(itemList) {
  const actionById = new Map();
  const visit = (list) => {
    for (const item of list) {
      if (item.action) actionById.set(item.id, item.action);
      if (Array.isArray(item.children)) visit(item.children);
    }
  };
  visit(itemList);
  return actionById;
}

function ContextMenuItem({ Icon, text, title, isDanger }) {
  return (
    <span className="doc-edit-mode-item" title={title} data-danger={isDanger ? '' : undefined}>
      <span className="doc-edit-mode-item-icon">{Icon ? <Icon size={13} aria-hidden="true" /> : null}</span>
      <span className="doc-edit-mode-item-label">{text}</span>
    </span>
  );
}

function ContextMenuSeparator() {
  return <span className="doc-edit-mode-separator" role="separator" />;
}
