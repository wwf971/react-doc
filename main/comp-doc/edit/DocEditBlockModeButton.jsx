import { useContext, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { SlidersHorizontal } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { DocEditBlockContext } from './DocEditDocContext.js';
import './DocEdit.css';

// The mode switch of a component block: one button, next to the block's
// label, opening a dropdown with the block's view modes and edit modes as
// its component exposes them (doc_page_impl_mdx_comp.md#view-modes-and-edit-modes):
//
//   View mode ──────
//   Table            [current, default]
//   Summary
//   Edit mode ──────
//   Cells            [default]
//   Source           [built-in]
//
// a view mode is applied at once (DocEditStore.blockViewModeSet: the block
// re-renders with config.viewMode); an edit mode opens the block in that
// mode, reported as editBlockEnterRequest { editModeId } like the Edit
// button, so the host application sees it. edit modes are greyed out when
// editing is not available (isEditAvailable false, a write pending) or when
// the entry itself cannot be chosen (the data is in the asset service layer); a
// read-only component lists no edit mode and says so.
//
// the dropdown is the Menu of @wwf971/react-comp-misc, injected by the host
// as config.components.Menu (like ConfigPanel); without it the button is not
// rendered. the menu is portaled to the body and closes itself when a
// pointer goes down elsewhere; it is marked doc-edit-popup, so the "pointer
// outside" of the edit layer (use-edit-outside-pointer.js) does not treat a
// click on an entry as leaving the block.
//
//   blockIndex       the block
//   isEditAvailable  whether an edit mode can be entered now (default true)
//   size             'toolbar' (the block toolbar's scale) | 'panel' (the editor bar's)
export const DocEditBlockModeButton = observer(function DocEditBlockModeButton({ blockIndex, isEditAvailable = true, size = 'toolbar' }) {
  const { componentConfig, editStore, eventRouter, onEvent: onEventPage } = useDocStores();
  const editBlock = useContext(DocEditBlockContext);
  const buttonRef = useRef(null);
  // the pointer going down on the button while the menu is open closes the
  // menu (its own outside-pointer rule); the click that follows must not
  // open it again
  const isClosedByPointerDownRef = useRef(false);
  const Menu = componentConfig.Menu;
  const path = editBlock?.path;
  if (!Menu || !path || !editStore.blockModeMenuIsAvailable(path, blockIndex)) return null;

  const isOpen = editStore.blockModeMenuIs(path, blockIndex);
  const viewModeList = editStore.blockViewModeListGet(path, blockIndex);
  const editModeList = editStore.blockEditModeListGet(path, blockIndex);
  const isReadOnly = editStore.blockIsReadOnly(path, blockIndex);
  const viewModeCurrentId = editStore.blockViewModeGet(path, blockIndex) ?? viewModeList.find((mode) => mode.isDefault)?.id;
  const session = editStore.session;
  const editModeCurrentId = session && editStore.sessionIs(path, 'block', blockIndex) ? session.editModeId : undefined;
  const isEditLocked = !isEditAvailable || editStore.isSubmitting;

  const modeItemBuild = (group, mode, isCurrent, isDisabled, disabledReason) => ({
    id: `${group}:${mode.id}`,
    isDisabled,
    comp: ModeMenuItem,
    compProps: { mode, isCurrent, isDisabled, disabledReason },
  });
  const items = [
    { id: 'head:view', isContainer: true, comp: ModeMenuHead, compProps: { text: 'View mode' } },
    ...viewModeList.map((mode) => modeItemBuild('view', mode, mode.id === viewModeCurrentId, false, '')),
    ...(viewModeList.length === 0
      ? [{ id: 'view:default', isContainer: true, comp: ModeMenuNote, compProps: { text: 'one way of display' } }]
      : []),
    { id: 'head:edit', isContainer: true, comp: ModeMenuHead, compProps: { text: 'Edit mode' } },
    ...editModeList.map((mode) => modeItemBuild(
      'edit',
      mode,
      mode.id === editModeCurrentId,
      isEditLocked || mode.isDisabled,
      mode.disabledReason || (isEditLocked ? 'editing is not available now' : ''),
    )),
    ...(editModeList.length === 0
      ? [{ id: 'edit:none', isContainer: true, comp: ModeMenuNote, compProps: { text: isReadOnly ? 'the component is read-only' : 'no edit mode' } }]
      : []),
  ];

  const itemChoose = (itemId) => {
    const [group, ...idParts] = String(itemId).split(':');
    const modeId = idParts.join(':');
    editStore.blockModeMenuClose();
    if (group === 'view') {
      editStore.blockViewModeSet(path, blockIndex, modeId);
      return;
    }
    if (group === 'edit') {
      const event = eventRouter.eventBuild({
        type: 'editBlockEnterRequest',
        data: { editModeId: modeId },
        source: { placement: 'editToolbar', sourcePath: path, blockIndex },
      });
      void eventRouter.dispatch(event, { onEventHost: onEventPage });
    }
  };

  const menuEventHandle = (eventType, eventData) => {
    if (eventType === 'itemClick') itemChoose(eventData.itemId);
    if (eventType === 'closeRequest') editStore.blockModeMenuClose();
  };

  const buttonClick = () => {
    if (isClosedByPointerDownRef.current) {
      isClosedByPointerDownRef.current = false;
      return;
    }
    if (isOpen) editStore.blockModeMenuClose();
    else editStore.blockModeMenuOpen(path, blockIndex);
  };

  const iconSize = size === 'panel' ? 12 : 14;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={size === 'panel' ? 'doc-button doc-edit-mode-button' : 'doc-edit-mode-button'}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title="View mode / edit mode of this block"
        aria-label="View mode / edit mode of this block"
        onPointerDown={() => { isClosedByPointerDownRef.current = isOpen; }}
        onClick={buttonClick}
      >
        <SlidersHorizontal aria-hidden="true" size={iconSize} strokeWidth={2} />
      </button>
      {isOpen ? (
        <Menu
          data={{ items }}
          config={{
            isOpen: true,
            isBackdropScrollPassThrough: true,
            isClickPropagationStopped: true,
            className: 'doc-edit-popup doc-edit-mode-menu',
            minWidth: 170,
            anchor: {
              getRect: () => buttonRef.current?.getBoundingClientRect(),
              getTargetEl: () => buttonRef.current,
              offsetY: (buttonRef.current?.offsetHeight ?? 0) + 2,
            },
          }}
          onEvent={menuEventHandle}
        />
      ) : null}
    </>
  );
});

function ModeMenuHead({ text }) {
  return <span className="doc-edit-mode-head">{text}</span>;
}

function ModeMenuNote({ text }) {
  return <span className="doc-edit-mode-note">{text}</span>;
}

// one mode: its icon, its label, and the marks that say what it is now
function ModeMenuItem({ mode, isCurrent, isDisabled, disabledReason }) {
  const Icon = mode.icon;
  const markList = [];
  if (isCurrent) markList.push('current');
  if (mode.isDefault) markList.push('default');
  if (mode.isBuiltin) markList.push('built-in');
  return (
    <span className="doc-edit-mode-item" title={isDisabled && disabledReason ? disabledReason : mode.description || undefined}>
      <span className="doc-edit-mode-item-icon">{Icon ? <Icon size={13} aria-hidden="true" /> : null}</span>
      <span className="doc-edit-mode-item-label">{mode.label}</span>
      {markList.length > 0 ? <span className="doc-edit-mode-item-marks">[{markList.join(', ')}]</span> : null}
    </span>
  );
}
