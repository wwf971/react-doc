import { useContext, useEffect, useRef } from 'react';
import { LoaderCircle } from '../../frontend/UICommon.js';
import { StoreContext } from '../../frontend/src/store/context.js';
import './DocEdit.css';

// The menus of the page (a right click, a list of actions) in one look: the Menu of react-comp-misc
// the host injects (config.components.Menu, doc_page_impl.md#the-panel-contract), drawn as the
// menus of the edit layer are (DocEdit.css .doc-edit-mode-menu: the scale of the floating
// controls, the page's colors), its entries an icon and words. The menu of a side-panel item, the
// menu of blocks, and a component's own menu (the rows of cv's Documents) are the same thing.
//
//   <DocMenu
//     itemList={[docMenuEntryBuild('open', ArrowRight, 'Open'), docMenuSeparatorBuild('rule'),
//                docMenuEntryBuild('rename', Pencil, 'Rename', { reason: isWritable ? '' : 'read only' })]}
//     point={{ x: event.clientX, y: event.clientY }}
//     onChoose={(id) => …} onClose={() => …} />
//
// A pointer going down elsewhere or Escape closes it (onClose); a choice closes it too (onChoose,
// then nothing else: the host closes it by not drawing it). It is a popup of the edit layer
// (doc-edit-popup): a pointer in it is not a click outside what is being edited. Outside a page
// (no host Menu) nothing is drawn.
export const DOC_MENU_CLASS = 'doc-edit-popup doc-edit-mode-menu';

// the config of the injected Menu for the page's look, for a menu placed otherwise than at a point
// (anchored to an element: DocBlockSelectMenu)
export const DOC_MENU_CONFIG = {
  isBackdropScrollPassThrough: true,
  isClickPropagationStopped: true,
  className: DOC_MENU_CLASS,
  minWidth: 168,
};

export function DocMenu({ itemList, point, onChoose, onClose, className = '', minWidth }) {
  const stores = useContext(StoreContext);
  const Menu = stores?.componentConfig?.Menu;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);
  if (!Menu || !point) return null;
  return (
    <Menu
      data={{ items: itemList }}
      config={{
        ...DOC_MENU_CONFIG,
        className: className ? `${DOC_MENU_CLASS} ${className}` : DOC_MENU_CLASS,
        ...(minWidth ? { minWidth } : {}),
        isOpen: true,
        posOpen: { x: point.x, y: point.y },
      }}
      onEvent={(eventType, eventData) => {
        if (eventType === 'itemClick') onChoose?.(eventData.itemId ?? eventData.item?.id);
        if (eventType === 'closeRequest') onClose?.();
      }}
    />
  );
}

// an entry: its icon (or the place of one, so that the words of every entry start at one line),
// its words; a danger in red; busy: a turning icon while what it started runs
export function DocMenuEntry({ Icon, text, title, isDanger = false, isBusy = false }) {
  return (
    <span className="doc-edit-mode-item" title={title} data-danger={isDanger ? '' : undefined}>
      <span className="doc-edit-mode-item-icon">
        {isBusy
          ? <LoaderCircle size={13} aria-hidden="true" className="doc-spin" />
          : Icon ? <Icon size={13} aria-hidden="true" /> : null}
      </span>
      <span className="doc-edit-mode-item-label">{text}</span>
    </span>
  );
}

// a line between groups of entries
export function DocMenuSeparator() {
  return <span className="doc-edit-mode-separator" role="separator" />;
}

// an entry of the Menu's items
//   reason   why it cannot be chosen now ('' when it can): it is greyed out, and says so on hover
//   title    what it does, on hover
export function docMenuEntryBuild(id, Icon, text, { reason = '', title = '', isDanger = false, isBusy = false } = {}) {
  return {
    id,
    isDisabled: reason !== '' || isBusy,
    comp: DocMenuEntry,
    compProps: { Icon, text, title: reason || title, isDanger, isBusy },
  };
}

export function docMenuSeparatorBuild(id) {
  return { id, isContainer: true, comp: DocMenuSeparator };
}
