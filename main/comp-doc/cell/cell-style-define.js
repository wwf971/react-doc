// The definition of a style kind of the cell editing kit, and the registry of the page built
// from the definitions (doc_page_impl_edit_cell.md#style-kinds). It stands beside the token
// kinds (cell-define.js) and is built the same way:
//
//   cell token registry                      cell style registry
//   cellTokenDefine(options)                 cellStyleDefine(options)
//   cell-registry.js cellTokenById           cell-style-registry.js cellStyleById (package)
//   config.cellTokenById (host)              config.cellStyleById (host)
//   cellTokenByIdBuild -> cellStore          cellStyleByIdBuild -> cellStore.cellStyleById
//
// a style kind is one thing that can be said of how words are drawn: bold, a color, a size, or
// a look a component names (a note, a keyword). it is one key of the spec of a styled segment
// ([[words|b,color=#c0392b]], lib/doc-cell-style.js), and says what the key draws and how the
// author chooses it:
//
//   cellStyleDefine({
//     name         'b': the key it is written with, one word, unique among the kinds of a cell
//     label, description      how the bar names it
//     type         'flag': a key alone, on or off (b) | 'value': a key with a value (color=#c0392b)
//
//     how it is drawn
//     css          a flag: the css its words are drawn with ({ fontWeight: 700 });
//                  a value: (value) => that css, or undefined for a value that is none of its
//                  (the words are then drawn without it, and the value stays as written)
//
//     how it is chosen
//     Icon         its button in the bar of a selection (a flag without one is listed under
//                  "Styles"; a value without one shows its label)
//     shortcut     a flag: the key toggling it with Ctrl/⌘ ('b'; 'shift+x' with Shift)
//     optionList   a value: what the bar offers: [{ value, label, swatch? }]
//                  swatch: a color drawn as a tile instead of the label
//     valueCheck(value) -> '' | why not
//                  a value: with it the bar lets one be typed, and says why one is refused
//     valuePlaceholder        what the typed value's field shows while empty
//   })
//
// a key no kind of the cell knows is kept as written and draws nothing: a text styled by a
// component is not damaged on a page without it.

const nameRegex = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function cellStyleDefine(options = {}) {
  const name = String(options.name ?? '');
  if (!nameRegex.test(name)) throw new Error(`cellStyleDefine: name must be one word (got ${JSON.stringify(options.name)}).`);
  const type = options.type ?? 'flag';
  if (type !== 'flag' && type !== 'value') throw new Error(`cellStyleDefine: type of ${name} must be 'flag' or 'value'.`);
  if (type === 'flag' && (!options.css || typeof options.css !== 'object')) throw new Error(`cellStyleDefine: css of ${name} must be an object of css properties.`);
  if (type === 'value' && typeof options.css !== 'function') throw new Error(`cellStyleDefine: css of ${name} must be a function (value) => css properties.`);
  if (options.valueCheck !== undefined && typeof options.valueCheck !== 'function') throw new Error(`cellStyleDefine: valueCheck of ${name} must be a function.`);
  return Object.freeze({
    name,
    label: String(options.label ?? name),
    description: String(options.description ?? ''),
    type,
    css: type === 'flag' ? Object.freeze({ ...options.css }) : options.css,
    Icon: options.Icon,
    shortcut: type === 'flag' && options.shortcut ? String(options.shortcut).toLowerCase() : '',
    optionList: Object.freeze((options.optionList ?? []).map((option) => Object.freeze({ value: String(option.value), label: String(option.label ?? option.value), swatch: option.swatch ? String(option.swatch) : '' }))),
    valueCheck: options.valueCheck,
    valuePlaceholder: String(options.valuePlaceholder ?? ''),
  });
}

// the registry of the page, by id ({layer}/{name}): the package's kinds, the host's over them
// (config.cellStyleById); a host maps an id to null to remove a kind of the package. what is not
// a definition is reported ([doc-cell]) and left out, never the page
export function cellStyleByIdBuild(...layerList) {
  const cellStyleById = {};
  for (const layer of layerList) {
    for (const [id, kind] of Object.entries(layer ?? {})) {
      if (kind === null) {
        delete cellStyleById[id];
        continue;
      }
      if (!kind || typeof kind.name !== 'string' || (kind.type !== 'flag' && kind.type !== 'value')) {
        console.warn(`[doc-cell] ${id}: not a cellStyleDefine() definition; left out`);
        continue;
      }
      cellStyleById[id] = kind;
    }
  }
  return cellStyleById;
}

// the style kinds of a cell: its own first (the component's: a look it names), then the
// page's, by the ids the cell names or all of them. an own kind hides a page kind of its name
//   styleOwnList      the cell's own kinds
//   styleById         the registry of the page: { id: kind }
//   styleIdList       undefined: every kind of the page; a list: those, in that order; []: none
export function cellStyleListResolve({ styleOwnList = [], styleById = {}, styleIdList } = {}) {
  const pageList = styleIdList === undefined ? Object.values(styleById) : styleIdList.map((id) => styleById[id]).filter(Boolean);
  const styleList = [];
  // an own kind takes the place of a page kind of its name, where the page kind stood; the
  // other own kinds follow the page's, as what a component adds follows what every cell has
  const ownByName = new Map(styleOwnList.filter(Boolean).map((kind) => [kind.name, kind]));
  const takenSet = new Set();
  for (const kind of pageList) {
    if (!kind || takenSet.has(kind.name)) continue;
    takenSet.add(kind.name);
    styleList.push(ownByName.get(kind.name) ?? kind);
  }
  for (const kind of ownByName.values()) {
    if (takenSet.has(kind.name)) continue;
    takenSet.add(kind.name);
    styleList.push(kind);
  }
  return styleList;
}

// the css a style draws its words with, by the kinds of a cell: an object of css properties as
// React takes one ({ fontWeight: 700, color: '#c0392b' }). a key no kind knows draws nothing.
// lines drawn through and under the words add up (u and s together)
export function cellStyleCssGet(style, styleList = []) {
  const css = {};
  for (const key of Object.keys(style ?? {}).sort()) {
    const kind = styleList.find((one) => one.name === key);
    if (!kind) continue;
    const value = style[key];
    const one = kind.type === 'flag' ? (value === true ? kind.css : undefined) : (value === true ? undefined : kind.css(String(value)));
    if (!one) continue;
    for (const [property, cssValue] of Object.entries(one)) {
      if (property === 'textDecorationLine' && css.textDecorationLine && !css.textDecorationLine.split(' ').includes(cssValue)) css.textDecorationLine = `${css.textDecorationLine} ${cssValue}`;
      else css[property] = cssValue;
    }
  }
  return css;
}

// the flag toggled by a key pressed with Ctrl/⌘ (event.key, event.shiftKey), or undefined
export function cellStyleShortcutKindGet(styleList, event) {
  const key = String(event.key ?? '').toLowerCase();
  if (key.length !== 1) return undefined;
  const shortcut = event.shiftKey ? `shift+${key}` : key;
  return styleList.find((kind) => kind.type === 'flag' && kind.shortcut === shortcut);
}
