import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { Expand } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { blockPopupKeyBuild } from '../../frontend/src/store/DocBlockPopupStore.js';
import { DocEditBlockFloatContext } from '../edit/DocEditDocContext.js';
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
export const BlockPopupSurface = observer(function BlockPopupSurface({ config = {}, title = '', className = '', children }) {
  const { blockPopupStore, compConfigHost } = useDocStores();
  const floatElementOuter = useContext(DocEditBlockFloatContext);
  const shellRef = useRef(null);
  const inlineSlotRef = useRef(null);
  const buttonRef = useRef(null);
  const [container] = useState(() => (typeof document === 'undefined' ? null : containerCreate()));
  const [token, tokenSet] = useState(0);
  const isOffered = Boolean(compConfigHost.panelComponent && blockPopupStore)
    && config.placement === 'commentBlock'
    && Number.isFinite(config.sourceLine)
    && Boolean(config.sourcePath);
  const key = isOffered ? blockPopupKeyBuild(config.sourcePath, config.sourceLine, config.compId) : '';

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
      path: config.sourcePath,
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
      {isOffered && !isInPopup ? (
        <button
          ref={buttonRef}
          type="button"
          className="doc-block-popup-open not-prose"
          title="Open in a popup"
          aria-label={title ? `Open ${title} in a popup` : 'Open in a popup'}
          onClick={open}
        >
          <Expand size={14} aria-hidden="true" />
        </button>
      ) : null}
      {isInPopup ? <p className="doc-block-popup-away not-prose">Shown in the popup.</p> : null}
      <div ref={inlineSlotRef} className="doc-block-popup-inline" />
      {container ? createPortal(content, container) : content}
    </div>
  );
});

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
