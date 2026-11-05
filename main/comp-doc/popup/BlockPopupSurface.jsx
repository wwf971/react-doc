import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { Expand } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { blockPopupKeyBuild, blockPopupPanelKeyBuild } from '../../frontend/src/store/DocBlockPopupStore.js';
import { DocEditBlockFloatContext } from '../edit/DocEditDocContext.js';
import { AnchoredPopover } from './AnchoredPopover.jsx';
import './DocBlockPopup.css';

// The part of a component block that can be shown in the block popup
// (doc_page_impl_popup.md). A component opts in by rendering itself as the
// children of this surface, in reading view as in its editor:
//
//   <BlockPopupSurface config={config} title="Sales" className="my-shell">
//     {({ isInPopup }) => <MyView height={isInPopup ? '100%' : 300} />}
//   </BlockPopupSurface>
//
//   config      the component's config: the block is known by sourcePath,
//               sourceLine (DocComp, the edit session's editor) and compId
//   title       the title of the popup
//   className   the outer box of the block in the page; it carries the
//               block's margins (the component's own root has none, so it
//               sits flush in the popup)
//   children    a render function: isInPopup tells it to fill the popup
//   popupKey    optional: makes a surface outside the documents (a canvas of
//               the settings panel) open in the popup too, under this id;
//               it is only shown there, without View / Edit, and config
//               may then be empty
//   actionList  optional: the component's own block actions (copy the
//               source, download ...): [{ id, label, Icon, onClick }], or
//               { id, label, Icon, menuItemList: [{ id, label, Icon, onClick }] }
//               for a button opening a menu of them. they
//               are drawn in the one toolbar of the surface, beside the
//               open button, in the page and in the popup alike, so a
//               component never draws a floating button group of its own
//               next to the surface's (which is how two such groups ended
//               up with different sizes and hand-tuned offsets)
//
// the children are rendered once, into a container element of their own,
// and that element is moved between the page and the popup: the component
// keeps its state, its draft and its selection when the popup opens,
// resizes and closes. while it is in the popup the page keeps the block's
// height with a note. in the popup the floating bar of the block's editor
// (EditFloatingPanel) goes into the popup header.
//
// the popup is offered for a block of the document that the host can show
// a panel for (compConfigHost.panelComponent); elsewhere the surface renders
// its children in place.
export const BlockPopupSurface = observer(function BlockPopupSurface({ config = {}, title = '', className = '', actionList = [], popupKey = '', children }) {
  const { blockPopupStore, compConfigHost } = useDocStores();
  const floatElementOuter = useContext(DocEditBlockFloatContext);
  const shellRef = useRef(null);
  const inlineSlotRef = useRef(null);
  const buttonRef = useRef(null);
  const [container] = useState(() => (typeof document === 'undefined' ? null : containerCreate()));
  const [token, tokenSet] = useState(0);
  const isOffered = Boolean(compConfigHost.panelComponent && blockPopupStore)
    && (popupKey !== '' || (config.placement === 'commentBlock'
      && Number.isFinite(config.sourceLine)
      && Boolean(config.sourcePath)));
  const key = !isOffered ? ''
    : popupKey !== '' ? blockPopupPanelKeyBuild(popupKey)
    : blockPopupKeyBuild(config.sourcePath, config.sourceLine, config.compId);

  useLayoutEffect(() => {
    if (!key) return undefined;
    const tokenRegistered = blockPopupStore.surfaceRegister(key);
    tokenSet(tokenRegistered);
    return () => {
      blockPopupStore.surfaceUnregister(tokenRegistered);
      tokenSet(0);
    };
  }, [blockPopupStore, key]);

  const isInPopup = token !== 0 && blockPopupStore.surfaceIsInPopup(token);
  const slotElement = isInPopup ? blockPopupStore.slotElement : null;
  useLayoutEffect(() => {
    const target = isInPopup ? slotElement : inlineSlotRef.current;
    if (!container || !target || container.parentNode === target) return;
    containerMove(container, target);
  }, [container, isInPopup, slotElement]);

  // a container left behind by an unmounted surface is removed
  useLayoutEffect(() => () => container?.remove(), [container]);

  // closing the popup gives the focus back to the button that opened it,
  // without scrolling the page to it
  const isInPopupLastRef = useRef(false);
  useLayoutEffect(() => {
    if (isInPopupLastRef.current && !isInPopup) buttonRef.current?.focus({ preventScroll: true });
    isInPopupLastRef.current = isInPopup;
  }, [isInPopup]);

  const open = () => {
    blockPopupStore.open({
      ...(popupKey !== '' ? { key } : {}),
      path: config.sourcePath ?? '',
      sourceLine: config.sourceLine,
      compId: config.compId,
      title,
      assetInfo: config.assetInfo,
      heightInline: shellRef.current?.getBoundingClientRect().height ?? 0,
    });
  };

  const content = (
    <DocEditBlockFloatContext.Provider value={isInPopup ? blockPopupStore.floatElement : floatElementOuter}>
      {children({ isInPopup })}
    </DocEditBlockFloatContext.Provider>
  );
  const heightInline = isInPopup ? blockPopupStore.popup?.heightInline : undefined;
  return (
    <div
      ref={shellRef}
      className={`doc-block-popup-surface${className ? ` ${className}` : ''}`}
      data-in-popup={isInPopup ? '' : undefined}
      style={heightInline ? { height: `${heightInline}px` } : undefined}
    >
      {!isInPopup && (isOffered || actionList.length > 0) ? (
        <BlockToolbar actionList={actionList}>
          {isOffered ? (
            <button
              ref={buttonRef}
              type="button"
              title="Open in a popup"
              aria-label={title ? `Open ${title} in a popup` : 'Open in a popup'}
              onClick={open}
            >
              <Expand size={BLOCK_TOOLBAR_ICON_SIZE} aria-hidden="true" />
            </button>
          ) : null}
        </BlockToolbar>
      ) : null}
      {isInPopup && slotElement && actionList.length > 0 ? createPortal(<BlockToolbar actionList={actionList} />, slotElement) : null}
      {isInPopup ? <p className="doc-block-popup-away not-prose">Shown in the popup.</p> : null}
      <div ref={inlineSlotRef} className="doc-block-popup-inline" />
      {container ? createPortal(content, container) : content}
    </div>
  );
});

// every button of the toolbar has one icon size and the button style of
// .doc-button-group, the actions of the component and the open button alike
const BLOCK_TOOLBAR_ICON_SIZE = 14;

function BlockToolbar({ actionList, children = null }) {
  return (
    <div className="doc-block-toolbar doc-button-group not-prose">
      {actionList.map(({ id, label, Icon, onClick, menuItemList }) => (
        menuItemList ? <BlockToolbarMenu key={id} label={label} Icon={Icon} menuItemList={menuItemList} /> : (
          <button key={id} type="button" title={label} aria-label={label} onClick={onClick}>
            <Icon size={BLOCK_TOOLBAR_ICON_SIZE} aria-hidden="true" />
          </button>
        )
      ))}
      {children}
    </div>
  );
}

// a button of the toolbar opening a menu. the item runs in the click, so what it
// does still counts as done by the user (the clipboard). a pointer going down
// elsewhere closes the menu; Escape closes it and the arrows move in it
function BlockToolbarMenu({ label, Icon, menuItemList }) {
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [isOpen, isOpenSet] = useState(false);
  useEffect(() => {
    if (!isOpen) return undefined;
    menuRef.current?.querySelector('button')?.focus({ preventScroll: true });
    const pointerDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) isOpenSet(false);
    };
    const { ownerDocument } = buttonRef.current;
    ownerDocument.addEventListener('pointerdown', pointerDown, true);
    return () => ownerDocument.removeEventListener('pointerdown', pointerDown, true);
  }, [isOpen]);
  const close = () => {
    isOpenSet(false);
    buttonRef.current?.focus({ preventScroll: true });
  };
  const keyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const itemList = [...menuRef.current.querySelectorAll('button')];
    const step = event.key === 'ArrowDown' ? 1 : -1;
    itemList[(itemList.indexOf(event.target) + step + itemList.length) % itemList.length]?.focus();
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-pressed={isOpen}
        onClick={() => isOpenSet(!isOpen)}
      >
        <Icon size={BLOCK_TOOLBAR_ICON_SIZE} aria-hidden="true" />
      </button>
      {isOpen ? (
        <AnchoredPopover anchorRef={buttonRef} className="doc-block-toolbar-menu">
          <span ref={menuRef} role="menu" aria-label={label} onKeyDown={keyDown}>
            {menuItemList.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  item.onClick();
                }}
              >
                <item.Icon size={BLOCK_TOOLBAR_ICON_SIZE} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </span>
        </AnchoredPopover>
      ) : null}
    </>
  );
}

function containerCreate() {
  const element = document.createElement('div');
  element.className = 'doc-block-popup-content';
  return element;
}

// moveBefore keeps the moved element's state (focus, a running animation);
// it needs both places in the document, else the element is appended
function containerMove(container, target) {
  if (typeof target.moveBefore === 'function' && container.isConnected && target.isConnected) {
    target.moveBefore(container, null);
    return;
  }
  target.appendChild(container);
}
