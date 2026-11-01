// The hotkey grammar and the resolution of the stacked keyboard maps
// (design: doc_page_impl_api_hotkey.md). Pure: no store, no DOM beyond
// reading a keyboard event.
//
//   a key        "ctrl+shift+p": modifiers and one key, joined by "+".
//                modifiers: ctrl, shift, alt, meta (cmd, command, win are
//                meta; option is alt; control is ctrl); "mod" is meta on
//                macOS and ctrl elsewhere. keys: letters, digits, f1..f24,
//                enter, escape, space, tab, backspace, delete, insert,
//                up/down/left/right, home, end, pageup, pagedown, and the
//                punctuation keys written as themselves (/ , . ; ' [ ] \ - = `)
//   a chord      "ctrl+k ctrl+s": two strokes, one after the other
//   a binding    { key, api, params?, when?, description? } of a map;
//                api null unbinds the key from the maps below
//   when         "editMode", "!editMode", "editMode && sessionOpen": names
//                the page keeps true or false (hotkeyContextKeyList)
//   a map        { id, bindingList } ; maps are stacked lowest first, and
//                within a map a later binding wins over an earlier one of
//                the same key
//
// resolution (hotkeyResolve): for one key, the bindings of every map, the
// topmost first; the first whose "when" holds and whose api is registered
// now answers. a binding whose api is missing (its provider is away: a
// service instance stopped, a component not mounted) is passed over, so it
// does not hide a binding of a lower map; "api: null" ends the search.

export const HOTKEY_MODIFIER_LIST = ['ctrl', 'shift', 'alt', 'meta'];

const modifierAliasByName = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
};

const keyAliasByName = {
  esc: 'escape',
  escape: 'escape',
  return: 'enter',
  enter: 'enter',
  space: 'space',
  spacebar: 'space',
  tab: 'tab',
  backspace: 'backspace',
  del: 'delete',
  delete: 'delete',
  insert: 'insert',
  ins: 'insert',
  up: 'up',
  arrowup: 'up',
  down: 'down',
  arrowdown: 'down',
  left: 'left',
  arrowleft: 'left',
  right: 'right',
  arrowright: 'right',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  plus: '+',
  minus: '-',
};

const keyNamedSet = new Set([
  'escape', 'enter', 'space', 'tab', 'backspace', 'delete', 'insert',
  'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
]);

const keyLabelByName = {
  escape: 'Esc',
  enter: 'Enter',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Del',
  insert: 'Ins',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
};

export function hotkeyPlatformIsMac(navigatorValue = typeof navigator === 'undefined' ? undefined : navigator) {
  const platform = String(navigatorValue?.userAgentData?.platform ?? navigatorValue?.platform ?? '');
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function keyNameNormalize(text) {
  const lower = text.toLowerCase();
  if (keyAliasByName[lower]) return keyAliasByName[lower];
  if (keyNamedSet.has(lower)) return lower;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower;
  if (/^[a-z0-9]$/.test(lower)) return lower;
  if (lower.length === 1 && /[`\-=[\]\\;',./+]/.test(lower)) return lower;
  return '';
}

// one stroke: { ctrl, shift, alt, meta, key }; message when invalid
export function hotkeyStrokeParse(text, { isMac = false } = {}) {
  const stroke = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
  let body = String(text ?? '').trim();
  // "ctrl++", "+": the key is "+"
  let isKeyPlus = false;
  if (body.endsWith('++')) {
    isKeyPlus = true;
    body = body.slice(0, -2);
  } else if (body === '+') {
    isKeyPlus = true;
    body = '';
  }
  const partList = body === '' ? [] : body.split('+');
  if (isKeyPlus) partList.push('+');
  if (partList.length === 0) return { stroke, message: `"${text}": a key is missing` };
  for (let index = 0; index < partList.length; index += 1) {
    const partRaw = partList[index].trim();
    const part = partRaw.toLowerCase();
    const isLast = index === partList.length - 1;
    if (part === '') return { stroke, message: isLast ? `"${text}": a key is missing` : `"${text}": empty part` };
    if (!isLast) {
      const modifier = part === 'mod' ? (isMac ? 'meta' : 'ctrl') : modifierAliasByName[part];
      if (!modifier) return { stroke, message: `"${text}": "${partRaw}" is not a modifier (ctrl, shift, alt, meta, mod)` };
      if (stroke[modifier]) return { stroke, message: `"${text}": ${modifier} twice` };
      stroke[modifier] = true;
      continue;
    }
    const key = keyNameNormalize(part);
    if (key === '') return { stroke, message: `"${text}": unknown key "${partRaw}"` };
    stroke.key = key;
  }
  return { stroke, message: '' };
}

// the canonical text of one stroke: the modifiers in a fixed order, then the key
export function hotkeyStrokeText(stroke) {
  const partList = HOTKEY_MODIFIER_LIST.filter((modifier) => stroke[modifier]);
  partList.push(stroke.key);
  return partList.join('+');
}

// a key text (one stroke, or a chord of strokes separated by spaces):
// { strokeList, text (canonical), message }
export function hotkeyParse(text, options = {}) {
  const strokeTextList = String(text ?? '').trim().split(/\s+/).filter((part) => part !== '');
  if (strokeTextList.length === 0) return { strokeList: [], text: '', message: 'a key is empty' };
  if (strokeTextList.length > 2) return { strokeList: [], text: '', message: `"${text}": a chord has two strokes at most` };
  const strokeList = [];
  for (const strokeText of strokeTextList) {
    const parsed = hotkeyStrokeParse(strokeText, options);
    if (parsed.message) return { strokeList: [], text: '', message: parsed.message };
    strokeList.push(parsed.stroke);
  }
  return { strokeList, text: strokeList.map(hotkeyStrokeText).join(' '), message: '' };
}

// how a key is shown: "Ctrl+Shift+P", "Ctrl+K Ctrl+S"; on macOS the symbols
// in the order of the system, "⌃⌥⇧⌘P"
export function hotkeyFormat(textOrStrokeList, { isMac = false } = {}) {
  const strokeList = Array.isArray(textOrStrokeList) ? textOrStrokeList : hotkeyParse(textOrStrokeList, { isMac }).strokeList;
  return strokeList.map((stroke) => strokeFormat(stroke, isMac)).join(' ');
}

function strokeFormat(stroke, isMac) {
  const keyLabel = keyLabelByName[stroke.key] ?? (stroke.key.length === 1 ? stroke.key.toUpperCase() : stroke.key.toUpperCase());
  if (isMac) {
    return `${stroke.ctrl ? '⌃' : ''}${stroke.alt ? '⌥' : ''}${stroke.shift ? '⇧' : ''}${stroke.meta ? '⌘' : ''}${keyLabel}`;
  }
  const partList = [];
  if (stroke.ctrl) partList.push('Ctrl');
  if (stroke.shift) partList.push('Shift');
  if (stroke.alt) partList.push('Alt');
  if (stroke.meta) partList.push('Meta');
  partList.push(keyLabel);
  return partList.join('+');
}

// the stroke a keyboard event is: undefined for a modifier pressed alone or
// a key the grammar has no name for. letters and digits are read from the
// physical key (event.code), so Shift+a and a non-latin layout give the
// same stroke; every other key from event.key
export function hotkeyStrokeFromEvent(event) {
  const key = String(event?.key ?? '');
  if (key === '' || ['Control', 'Shift', 'Alt', 'Meta', 'OS', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified'].includes(key)) return undefined;
  const code = String(event?.code ?? '');
  let keyName = '';
  if (/^Key[A-Z]$/.test(code)) keyName = code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(code)) keyName = code.slice(5);
  else if (key === ' ') keyName = 'space';
  else keyName = keyNameNormalize(key);
  if (keyName === '') return undefined;
  return {
    ctrl: event.ctrlKey === true,
    shift: event.shiftKey === true,
    alt: event.altKey === true,
    meta: event.metaKey === true,
    key: keyName,
  };
}

// a stroke with a modifier other than shift: a binding without one is a
// plain key, which belongs to the text while something editable has the
// focus
export function hotkeyStrokeHasModifier(stroke) {
  return Boolean(stroke.ctrl || stroke.alt || stroke.meta);
}

// ---------- when ----------

const whenNameRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

// "a && !b" -> { termList: [{ name, isNegated }], message }; '' means always
export function whenParse(text) {
  const textTrim = String(text ?? '').trim();
  if (textTrim === '') return { termList: [], message: '' };
  const termList = [];
  for (const partRaw of textTrim.split('&&')) {
    const part = partRaw.trim();
    const isNegated = part.startsWith('!');
    const name = isNegated ? part.slice(1).trim() : part;
    if (!whenNameRegex.test(name)) return { termList: [], message: `when "${textTrim}": "${part}" is not a context name` };
    termList.push({ name, isNegated });
  }
  return { termList, message: '' };
}

// true when every term holds; an unknown name is false
export function whenEval(when, contextKeyByName = {}) {
  return (when?.termList ?? []).every((term) => {
    const value = contextKeyByName[term.name] === true;
    return term.isNegated ? !value : value;
  });
}

// ---------- the stacked maps ----------

// mapList: lowest first, each { id, source, bindingList: [{ key, api,
// params, when, description }] }. answers the table:
//   bindingListByKey   canonical key text -> bindings, the one that wins
//                      first (top map first, later binding of a map first)
//   bindingList        every valid binding, in stack order
//   problemList        [{ mapId, place, message }] of what was left out
//   isChordPrefix(strokeText)   whether a chord starts with that stroke
export function hotkeyTableBuild(mapList, { isMac = false } = {}) {
  const bindingList = [];
  const problemList = [];
  const chordPrefixSet = new Set();
  (mapList ?? []).forEach((map, mapIndex) => {
    const mapId = String(map?.id ?? `map ${mapIndex}`);
    (map?.bindingList ?? []).forEach((bindingRaw, bindingIndex) => {
      const place = bindingRaw?.place ?? `bindingList[${bindingIndex}]`;
      if (!bindingRaw || typeof bindingRaw !== 'object') {
        problemList.push({ mapId, place, message: 'a binding is a mapping { key, api }' });
        return;
      }
      const parsed = hotkeyParse(bindingRaw.key, { isMac });
      if (parsed.message) {
        problemList.push({ mapId, place, message: parsed.message });
        return;
      }
      const api = bindingRaw.api === null ? null : String(bindingRaw.api ?? '').trim();
      if (api === '') {
        problemList.push({ mapId, place, message: `"${parsed.text}": a binding names an api, or api: null to unbind the key` });
        return;
      }
      const when = whenParse(bindingRaw.when);
      if (when.message) {
        problemList.push({ mapId, place, message: when.message });
        return;
      }
      if (bindingRaw.params !== undefined && (typeof bindingRaw.params !== 'object' || Array.isArray(bindingRaw.params) || bindingRaw.params === null)) {
        problemList.push({ mapId, place, message: `"${parsed.text}": params must be a mapping` });
        return;
      }
      if (parsed.strokeList.length === 2) chordPrefixSet.add(hotkeyStrokeText(parsed.strokeList[0]));
      bindingList.push({
        keyText: parsed.text,
        strokeList: parsed.strokeList,
        api,
        params: bindingRaw.params ?? {},
        when,
        whenText: String(bindingRaw.when ?? ''),
        description: String(bindingRaw.description ?? ''),
        mapId,
        mapIndex,
        source: map.source ?? '',
        place,
      });
    });
  });
  const bindingListByKey = new Map();
  for (const binding of [...bindingList].reverse()) {
    const list = bindingListByKey.get(binding.keyText) ?? [];
    list.push(binding);
    bindingListByKey.set(binding.keyText, list);
  }
  return {
    bindingListByKey,
    bindingList,
    problemList,
    isChordPrefix: (strokeText) => chordPrefixSet.has(strokeText),
  };
}

// the binding a key fires now: the first, top down, whose "when" holds and
// whose api is registered; a binding with api null ends the search (the
// key is unbound). answers { binding, passedList } or undefined; passedList
// are the bindings above it that were passed over, each with why
export function hotkeyResolve(table, keyText, { apiExists = () => true, contextKeyByName = {} } = {}) {
  const passedList = [];
  for (const binding of table.bindingListByKey.get(keyText) ?? []) {
    if (!whenEval(binding.when, contextKeyByName)) {
      passedList.push({ binding, reason: `when "${binding.whenText}" does not hold` });
      continue;
    }
    if (binding.api === null) return undefined;
    if (!apiExists(binding.api)) {
      passedList.push({ binding, reason: `${binding.api} is not registered` });
      continue;
    }
    return { binding, passedList };
  }
  return undefined;
}

// the effective binding of every key, for a table shown to the reader:
// [{ keyText, keyLabel, binding | undefined (unbound), passedList }]
export function hotkeyTableEffectiveGet(table, options = {}) {
  const { isMac = false } = options;
  const rowList = [];
  for (const keyText of table.bindingListByKey.keys()) {
    const resolved = hotkeyResolve(table, keyText, options);
    const passedList = resolved?.passedList ?? passedListOfUnbound(table, keyText, options);
    rowList.push({ keyText, keyLabel: hotkeyFormat(keyText, { isMac }), binding: resolved?.binding, passedList });
  }
  rowList.sort((a, b) => a.keyText.localeCompare(b.keyText));
  return rowList;
}

function passedListOfUnbound(table, keyText, { apiExists = () => true, contextKeyByName = {} }) {
  const passedList = [];
  for (const binding of table.bindingListByKey.get(keyText) ?? []) {
    if (!whenEval(binding.when, contextKeyByName)) {
      passedList.push({ binding, reason: `when "${binding.whenText}" does not hold` });
      continue;
    }
    if (binding.api === null) {
      passedList.push({ binding, reason: 'unbinds the key' });
      break;
    }
    passedList.push({ binding, reason: `${binding.api} is not registered` });
  }
  return passedList;
}

// the key shown beside an api (in the palette): the first key, in stack
// order of the keys, whose effective binding is that api
export function hotkeyLabelByApiBuild(table, options = {}) {
  const labelByApi = new Map();
  for (const row of hotkeyTableEffectiveGet(table, options)) {
    if (!row.binding || labelByApi.has(row.binding.api)) continue;
    labelByApi.set(row.binding.api, row.keyLabel);
  }
  return labelByApi;
}
