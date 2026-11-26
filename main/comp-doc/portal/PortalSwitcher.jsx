import { useEffect, useId, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Check, ChevronsUpDown, Globe, Monitor, Search, Smartphone } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { AnchoredPopover } from '../popup/AnchoredPopover.jsx';
import { PortalIcon } from './PortalIcon.jsx';
import './Portal.css';

// The portal switcher (doc_page_impl_portal.md#the-switcher): the standard control that says
// which portal the page shows and opens another one. A button with the icon and the name of the
// portal current, and under it a panel listing every portal of the page:
//
//   [▣ Archive ⌃⌄]
//   ┌──────────────────────────────────────┐
//   │ ⌕ Find a portal                      │  from PortalSearchCountMin portals on
//   │ cv                                   │  a group per doc page, its title when several
//   │   ▤ Documents                        │
//   │   ▣ Archive        the documents of …  ✓│  the portal current
//   │   ◈ Reading room   …      🖥 desktop │  what it is made for, where this window is another
//   │ ──────────────────────────────────── │  a line between the portals of two doc pages
//   │ example                              │
//   │   ▤ Documents                        │
//   └──────────────────────────────────────┘
//
// It stands at the top left of the documents (the head of the side panel) and, for a portal of
// its own, where its component puts it (expose.portal.switcherPlace 'own') or floating at the
// top left over the app (the default, drawn by PortalHost). A row is a link: a click opens the
// portal in place, a click with a modifier in a tab of its own. ↑ ↓ move, Enter opens, Esc and a
// click elsewhere close; with the field, typing finds by name (every word in any order).
//
//   variant   'button' (default): icon and name, for a bar of an app
//             'title': the title of the site and the chevron, in the place of the title of the
//             documents: it reads as that title did, with a sign that it opens
//             'floating': the same as button on a ground of its own, to stand over anything
//             'icon': the icon alone
export const PortalSwitcher = observer(function PortalSwitcher({ variant = 'button', className = '' }) {
  const { docStore, portalStore } = useDocStores();
  const key = useId();
  const rootRef = useRef(null);
  const anchorRef = useRef(null);
  const isOpen = Boolean(portalStore?.switcherIsOpen(key));

  // a pointer going down outside it closes it
  useEffect(() => {
    if (!isOpen) return undefined;
    const pointerDownHandle = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      portalStore.switcherClose(key);
    };
    document.addEventListener('pointerdown', pointerDownHandle, true);
    return () => document.removeEventListener('pointerdown', pointerDownHandle, true);
  }, [isOpen, key, portalStore]);
  // gone from the page with its panel open: the panel is closed
  useEffect(() => () => portalStore?.switcherClose(key), [key, portalStore]);

  if (!portalStore) return null;
  const portal = portalStore.portalCurrent;
  const label = variant === 'title' ? docStore.siteTitle : portal?.label ?? 'Portal';
  // the tooltip says what is shown, then what a click does: the label of the title slot is the
  // site's, so the portal is named here
  const titleText = portal ? `Shown: ${portal.label}${portal.providerLabel && !portal.isBuiltIn ? ` (${portal.providerLabel})` : ''}. Click to switch portal` : 'Click to switch portal';
  const close = () => {
    portalStore.switcherClose(key);
    anchorRef.current?.focus({ preventScroll: true });
  };
  return (
    <span ref={rootRef} className={`doc-portal-switcher ${className}`} data-variant={variant}>
      <button
        ref={anchorRef}
        type="button"
        className="doc-portal-switcher-button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={titleText}
        onClick={() => (isOpen ? portalStore.switcherClose(key) : portalStore.switcherOpen(key))}
      >
        {/* in the place of the title it is the title: the documents are what it always shows there,
            so their icon would say nothing, and the room is the title's */}
        {variant === 'title' ? null : <PortalIcon portal={portal} definition={portalStore.compGet(portal)?.definition} size={variant === 'icon' ? 24 : 20} />}
        {variant === 'icon' ? null : <span className="doc-portal-switcher-label">{label}</span>}
        <ChevronsUpDown className="doc-portal-switcher-chevron" size={13} aria-hidden="true" />
      </button>
      {isOpen ? (
        <AnchoredPopover anchorRef={anchorRef} className="doc-popover doc-portal-switcher-panel not-prose" isShownFirst>
          <PortalSwitcherPanel portalStore={portalStore} close={close} />
        </AnchoredPopover>
      ) : null}
    </span>
  );
});

const DEVICE_ICON_BY_NAME = { browser: Globe, mobile: Smartphone, desktop: Monitor };

// what the panel lists and takes: the field when there are many, the groups, the keys
const PortalSwitcherPanel = observer(function PortalSwitcherPanel({ portalStore, close }) {
  const listRef = useRef(null);
  const focusRef = useRef(null);
  const groupList = portalStore.switcherGroupList;
  const indexActive = portalStore.switcher?.indexActive ?? 0;
  const isSearchOffered = portalStore.isSearchOffered;
  const idCurrent = portalStore.portalIdCurrent;

  // the keys go to the field, or to the list where there is none
  useEffect(() => {
    focusRef.current?.focus({ preventScroll: true });
  }, []);
  // the row highlighted kept in view, by scrolling the list only
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector('[data-active]');
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [indexActive]);

  const keyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      portalStore.switcherActiveMove(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      portalStore.switcherChoose();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  let index = -1;
  return (
    <div className="doc-portal-switcher-body" onKeyDown={keyDownHandle}>
      {isSearchOffered ? (
        <label className="doc-portal-switcher-find">
          <Search size={13} aria-hidden="true" />
          <input
            ref={focusRef}
            type="text"
            value={portalStore.switcher?.text ?? ''}
            placeholder="Find a portal"
            aria-label="Find a portal by its name"
            onChange={(event) => portalStore.switcherTextSet(event.target.value)}
          />
        </label>
      ) : null}
      <div ref={isSearchOffered ? listRef : (node) => { listRef.current = node; focusRef.current = node; }} className="doc-portal-switcher-list" role="listbox" aria-label="Portals" tabIndex={isSearchOffered ? undefined : -1}>
        {groupList.length === 0 ? <div className="doc-portal-switcher-none">No portal is named so.</div> : null}
        {groupList.map((group, groupIndex) => (
          <div key={group.docPageAlias} className="doc-portal-switcher-group" role="group" aria-label={group.title}>
            {groupIndex > 0 ? <div className="doc-portal-switcher-divider" role="separator" /> : null}
            {portalStore.groupList.length > 1 ? <div className="doc-portal-switcher-group-title">{group.title}</div> : null}
            {group.portalList.map((portal) => {
              index += 1;
              const indexOfRow = index;
              const isCurrent = portal.id === idCurrent;
              const isFit = portalStore.deviceIsFit(portal);
              return (
                <a
                  key={portal.id}
                  className="doc-portal-switcher-row"
                  role="option"
                  aria-selected={isCurrent}
                  data-active={indexOfRow === indexActive ? '' : undefined}
                  href={portalStore.hrefGet(portal.id) || undefined}
                  title={[portal.description, portal.providerLabel && !portal.isBuiltIn ? `provided by ${portal.providerLabel}` : '', portal.id].filter(Boolean).join('\n')}
                  onPointerMove={() => portalStore.switcherActiveSet(indexOfRow)}
                  onClick={(event) => {
                    // a click with a modifier opens it in a tab of its own, as any link
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    portalStore.switcherChoose(indexOfRow);
                  }}
                >
                  <PortalIcon portal={portal} definition={portalStore.compGet(portal)?.definition} size={24} />
                  <span className="doc-portal-switcher-row-text">
                    <span className="doc-portal-switcher-row-label">
                      {portal.label}
                      {portal.labelDetail ? <span className="doc-portal-switcher-row-detail"> · {portal.labelDetail}</span> : null}
                    </span>
                    {portal.description ? <span className="doc-portal-switcher-row-description">{portal.description}</span> : null}
                  </span>
                  {!isFit ? (
                    <span className="doc-portal-switcher-row-device" title={`Made for ${portal.deviceList.join(', ')}; this window is ${portalStore.device}`}>
                      {portal.deviceList.map((device) => {
                        const Icon = DEVICE_ICON_BY_NAME[device];
                        return Icon ? <Icon key={device} size={12} aria-hidden="true" /> : <span key={device}>{device}</span>;
                      })}
                    </span>
                  ) : null}
                  <Check className="doc-portal-switcher-row-check" size={14} aria-hidden="true" data-shown={isCurrent ? '' : undefined} />
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});
