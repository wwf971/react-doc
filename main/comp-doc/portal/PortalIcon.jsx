import { AppWindow } from '../../frontend/UICommon.js';
import { compIconGet } from '../registry/comp-expose.js';
import { objectIconByNameGet } from '../object/object-icon.jsx';
import './Portal.css';

// The icon of a portal (doc_page_impl_portal.md#the-icon): a line drawing on a rounded tile of
// the portal's color, drawn at any size from one number. The tile and the drawing are sized by
// that number alone (the drawing 58% of the tile, the corner 26% of it), so it reads the same at
// 16px in a row of the switcher and at 96px on a card of a launch page.
//
//   the drawing   the icon the portal names (a name of the page's icon set), else the icon its
//                 component exposes (expose.icon, a drawing at any size), else a window
//   the tile      the color the portal names; else one worked out of its id, so that two
//                 portals differ at a glance and a portal keeps its color wherever it is listed
//
//   portal        a portal of the registry ({ id, icon, color, ... })
//   definition    the definition of its component, when the caller has it (PortalSwitcher asks
//                 the store): its exposed icon is the fallback
//   size          the side of the tile, in px
export function PortalIcon({ portal, definition, size = 20, className = '' }) {
  const Icon = objectIconByNameGet(portal?.icon) ?? (definition?.expose?.icon ? compIconGet(definition) : AppWindow);
  const color = portal?.color || (portal?.isBuiltIn ? '' : portalColorOfIdGet(portal?.id));
  return (
    <span
      className={`doc-portal-icon ${className}`}
      data-builtin={portal?.isBuiltIn ? '' : undefined}
      style={{ width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.26)), ...(color ? { '--doc-portal-color': color } : {}) }}
      aria-hidden="true"
    >
      <Icon size={Math.max(10, Math.round(size * 0.58))} strokeWidth={size >= 40 ? 1.6 : 2} />
    </span>
  );
}

// a color of an id, the same wherever the id is: a hue of its letters, at one depth, on which
// a white drawing reads
export function portalColorOfIdGet(id) {
  const text = String(id ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 360;
  return `hsl(${hash} 42% 42%)`;
}
