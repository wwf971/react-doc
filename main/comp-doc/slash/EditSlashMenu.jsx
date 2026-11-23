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
// an action whose parameter is optional (the view of a block) runs as it is
// on Enter; its row shows the choices of the parameter for a pointer, the
// default first and marked, and the foot says what Enter and Tab do:
//
//   │ ▤ /mdx  MDX block  a document of its…  [Icon] Card │
//   │ ↑↓ · Enter Icon (default) · Tab choose the view   │
//
// it floats (a portal into document.body, fixed under the caret line) and
// is a popup of the edit layer, so a pointer on it is not a click outside
// the block being edited. above the line when there is no room below. It is
// shown in the top layer (popover="manual"): a surface it is opened from may
// stand there itself (the panel of a double-click on a diagram, which leaves
// the canvas around it: doc_page_impl_popup.md), and a portal with a z-index
// stays under the top layer.
// the menu once drawn: shown in the top layer, above what it was opened from
const popoverShow = (element) => {
  if (element && element.showPopover && !element.matches(':popover-open')) element.showPopover();
};

export const EditSlashMenu = observer(function EditSlashMenu({ slashStore, surfaceId, onChoose, onChoiceChoose }) {
  const listRef = useRef(null);
  const listShow = (element) => { listRef.current = element; popoverShow(element); };
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
  // the action highlighted in the action mode, when its parameter is optional
  const actionActive = !action ? itemList[itemIndexActive]?.action : undefined;
  const actionActiveOptional = actionActive?.param?.isOptional ? actionActive : undefined;
  const ItemRender = action?.param?.ItemRender;
  // what the parameter typed so far means (the action says); the placeholder while it says nothing
  const hint = action ? slashStore.paramHint : '';
  const style = menuPositionGet(slash.rectAnchor, heightMenu);

  return createPortal(
    <div
      ref={listShow}
      popover="manual"
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
          {action.param.label ? (
            <span className="doc-edit-slash-muted">
              · {action.param.label}{action.param.isOptional ? ' (optional)' : ''}
            </span>
          ) : null}
          {hint ? <span className="doc-edit-slash-hint" title={hint}>{hint}</span> : null}
          {!hint && parsed.param === '' ? <span className="doc-edit-slash-muted">{action.param.placeholder}</span> : null}
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
            : (
                <SlashActionItem
                  action={item.action}
                  choiceList={slashStore.rowChoiceListGet(item.action)}
                  onChoiceChoose={(choiceIndex) => onChoiceChoose?.(index, choiceIndex)}
                />
              )}
        </div>
      ))}
      <div className="doc-edit-slash-foot">
        {actionActiveOptional ? (
          <>
            <kbd>↑</kbd><kbd>↓</kbd> · <kbd>Enter</kbd> {slashStore.choiceDefaultLabelGet(actionActiveOptional) || 'as it is'}
            {slashStore.choiceDefaultLabelGet(actionActiveOptional) ? ' (default)' : ''} · <kbd>Tab</kbd> choose the {actionActiveOptional.param.label || 'option'}
          </>
        ) : action?.param?.isOptional ? (
          <>
            <kbd>↑</kbd><kbd>↓</kbd> <kbd>Enter</kbd> choose · <kbd>Backspace</kbd> back · <kbd>Esc</kbd> plain text
          </>
        ) : (
          <>
            <kbd>↑</kbd><kbd>↓</kbd> <kbd>Enter</kbd> choose · <kbd>Esc</kbd> or two spaces: plain text
          </>
        )}
      </div>
    </div>,
    document.body,
  );
});

// an action of the action mode: its icon, name, label and description; the
// choices of an optional parameter listed on its row (param.isListedOnRow)
// after them, each chosen by a click of its own, the default first
function SlashActionItem({ action, choiceList = [], onChoiceChoose }) {
  const Icon = action.icon;
  return (
    <>
      {Icon ? <Icon size={13} className="doc-edit-slash-icon" /> : <span className="doc-edit-slash-icon" />}
      <span className="doc-edit-slash-name">/{action.name}</span>
      <span className="doc-edit-slash-label">{action.label}</span>
      {action.description ? <span className="doc-edit-slash-muted doc-edit-slash-fill">{action.description}</span> : <span className="doc-edit-slash-fill" />}
      {choiceList.length > 0 ? (
        <span className="doc-edit-slash-choice-list" aria-label={`${action.label}: ${action.param.label || 'options'}`}>
          {choiceList.map((choice, choiceIndex) => (
            <span
              key={choice.id ?? choiceIndex}
              className="doc-edit-slash-choice"
              data-default={choice.isDefault ? '' : undefined}
              title={`${choice.label}${choice.isDefault ? ' (default)' : ''}${choice.detail ? `: ${choice.detail}` : ''}`}
              onPointerDown={(event) => {
                // the choice, not the row: the row would run the action as it is
                event.preventDefault();
                event.stopPropagation();
                onChoiceChoose?.(choiceIndex);
              }}
            >
              {choice.label}
            </span>
          ))}
        </span>
      ) : null}
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
      {item.isDefault ? <span className="doc-edit-slash-default">default</span> : null}
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
