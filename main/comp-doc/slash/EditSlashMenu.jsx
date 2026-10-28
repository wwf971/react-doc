import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { FileText, FolderIcon } from '../../frontend/UICommon.js';
import { SLASH_MODE_ACTION, SLASH_MODE_PARAM } from '../../frontend/src/lib/doc-slash.js';
import { EDIT_POPUP_CLASS } from '../edit/use-edit-outside-pointer.js';
import './EditSlash.css';

// The menu of the slash mode, under the "/" the author typed
// (doc_page_impl_edit_slash.md#the-menu). It renders the state of the store
// and nothing else: the action mode lists the actions, the param mode the
// items its action answers, drawn by the action's ItemRender when it has
// one. A click chooses (on pointer down, so the surface keeps the focus and
// the caret); the pointer over an item highlights it.
//
//   ┌──────────────────────────────────────────────┐
//   │ ⧉ Link   a document name or title, or a path  │ ◄ param mode: the action and its hint
//   │ ▤ Getting started   ~example/guide/start.md   │ ◄ the highlighted item
//   │ ▤ Image             ~example/mdx-usage/image… │
//   │ ↑↓ Enter Tab · Esc · two spaces end           │ ◄ the keys
//   └──────────────────────────────────────────────┘
//
// it floats (a portal into document.body, fixed under the caret line) and
// is a popup of the edit layer, so a pointer on it is not a click outside
// the block being edited. above the line when there is no room below.
export const EditSlashMenu = observer(function EditSlashMenu({ slashStore, surfaceId, onChoose }) {
  const listRef = useRef(null);
  const [heightMenu, heightMenuSet] = useState(0);
  const slash = slashStore.slash;
  const isOpen = slashStore.slashIsOpenFor(surfaceId);
  const parsed = slashStore.parsed;
  const itemList = isOpen ? slashStore.itemList : [];
  const itemIndexActive = slash?.itemIndexActive ?? 0;

  useEffect(() => {
    if (!isOpen) return;
    // the highlighted item kept in view by scrolling the menu only:
    // scrollIntoView would also scroll the page under the fixed menu
    const list = listRef.current;
    const item = list?.querySelector('[data-active]');
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [isOpen, itemIndexActive, itemList.length]);

  useLayoutEffect(() => {
    if (!isOpen || !listRef.current) return;
    const height = listRef.current.getBoundingClientRect().height;
    if (Math.abs(height - heightMenu) > 1) heightMenuSet(height);
  });

  if (!isOpen || !slash?.rectAnchor) return null;
  // the action mode shows nothing when no action matches: the author is
  // probably writing text that starts with "/"
  if (parsed.mode === SLASH_MODE_ACTION && itemList.length === 0) return null;

  const action = parsed.mode === SLASH_MODE_PARAM ? parsed.action : undefined;
  const ItemRender = action?.param?.ItemRender;
  const style = menuPositionGet(slash.rectAnchor, heightMenu);

  return createPortal(
    <div
      ref={listRef}
      className={`doc-popover doc-edit-slash-menu not-prose ${EDIT_POPUP_CLASS}`}
      role="listbox"
      aria-label={action ? `${action.label}: choose` : 'Slash actions'}
      style={style}
      onPointerDown={(event) => event.preventDefault()}
    >
      {action ? (
        <div className="doc-edit-slash-head">
          {action.icon ? <action.icon size={13} className="doc-edit-slash-icon" /> : null}
          <span className="doc-edit-slash-head-label">{action.label}</span>
          {parsed.param === '' ? <span className="doc-edit-slash-muted">{action.param.placeholder}</span> : null}
        </div>
      ) : null}
      {itemList.length === 0 ? (
        <div className="doc-edit-slash-none">{action?.param?.emptyText}</div>
      ) : itemList.map((item, index) => (
        <div
          key={item.id ?? index}
          className="doc-edit-slash-item"
          role="option"
          aria-selected={index === itemIndexActive}
          data-active={index === itemIndexActive ? '' : undefined}
          onPointerMove={() => slashStore.itemActiveSet(index)}
          onPointerDown={(event) => {
            event.preventDefault();
            onChoose(index);
          }}
        >
          {action
            ? (ItemRender
                ? <ItemRender item={item} isActive={index === itemIndexActive} param={parsed.param} />
                : <SlashItemDefault item={item} />)
            : <SlashActionItem action={item.action} />}
        </div>
      ))}
      <div className="doc-edit-slash-foot">
        <kbd>↑</kbd><kbd>↓</kbd> <kbd>Enter</kbd> choose · <kbd>Esc</kbd> or two spaces: plain text
      </div>
    </div>,
    document.body,
  );
});

function SlashActionItem({ action }) {
  const Icon = action.icon;
  return (
    <>
      {Icon ? <Icon size={13} className="doc-edit-slash-icon" /> : <span className="doc-edit-slash-icon" />}
      <span className="doc-edit-slash-name">/{action.name}</span>
      <span className="doc-edit-slash-label">{action.label}</span>
      {action.description ? <span className="doc-edit-slash-muted doc-edit-slash-fill">{action.description}</span> : null}
    </>
  );
}

// an item of a param mode: an icon by its kind, the label, the detail muted
function SlashItemDefault({ item }) {
  const Icon = item.kind === 'dir' ? FolderIcon : item.kind === 'file' ? FileText : undefined;
  return (
    <>
      {Icon ? <Icon size={13} className="doc-edit-slash-icon" /> : null}
      <span className="doc-edit-slash-label-main">{item.label}</span>
      {item.detail ? <span className="doc-edit-slash-muted doc-edit-slash-fill">{item.detail}</span> : null}
    </>
  );
}

// under the caret line, kept inside the window; above it when the window
// has no room below
function menuPositionGet(rect, heightMenu) {
  const margin = 4;
  const widthMax = Math.min(560, window.innerWidth - margin * 2);
  const left = Math.max(margin, Math.min(rect.left - 6, window.innerWidth - widthMax - margin));
  const isAbove = heightMenu > 0 && rect.bottom + 4 + heightMenu > window.innerHeight - margin && rect.top - 4 - heightMenu > margin;
  return isAbove
    ? { left, top: rect.top - 4 - heightMenu, maxWidth: widthMax }
    : { left, top: rect.bottom + 4, maxWidth: widthMax };
}
