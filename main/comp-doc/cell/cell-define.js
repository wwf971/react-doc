// The definition of a token kind of the cell editing kit, and the registry of
// the page built from the definitions (doc_page_impl_edit_cell.md#token-kinds).
// It is built the way the slash action registry is (slash/slash-define.js):
//
//   slash action registry                    cell token registry
//   slashActionDefine(options)               cellTokenDefine(options)
//   slash-registry.js slashActionById        cell-registry.js cellTokenById (package)
//   config.slashActionById (host)            config.cellTokenById (host)
//   slashActionByIdBuild -> slashStore       cellTokenByIdBuild -> cellStore.cellTokenById
//
// a token kind is one sort of thing an author types into a cell that is
// more than text: a link, a view of an object, a value the cell's own
// component reads. it is offered by the service layer it belongs to (the
// link by the navigation layer, the object view by the object service layer)
// or by the component owning the cell (a query of a CV), and says three things:
//
//   cellTokenDefine({
//     name         'link': one word, unique among the kinds of a cell
//     label, description      how a list of kinds names it
//
//     how it is written: one of
//     brace        { sigil: '@' }: a brace token {{@…}}; the sigil '' takes every
//                  brace token no other kind of the cell takes (one kind per cell)
//     match(text) -> [{ start, end, data }]
//                  a pattern of its own in the text (the Markdown link)
//     read(body, param) -> data | undefined
//                  optional, for a brace kind: what the body means (param: the
//                  parameters written after "|"); undefined: not a token of this
//                  kind, the text stays as written
//
//     how it is drawn
//     Render({ token, cell, contextVersion })   a component drawing one token inline; absent: its
//                  text. it reads cell.context; contextVersion is another number after that
//                  context changed, so a Render kept by a memo is drawn again
//     textGet(token, cell) -> string
//                  its plain text: what a consumer needing text reads (a title, a
//                  comparison, pagination measuring text), and what is drawn
//                  without a Render; undefined: the token as written
//
//     how it is typed
//     slashAction  a slash action (slashActionDefine), or (cell) => one: offered
//                  in the slash mode of the cell, and, for a brace kind, entered
//                  at once when its opening text is typed ("{{", "{{@"), unless
//                  isTriggerDirect is false. a kind typed in several ways gives a
//                  list (or (cell) => a list): every action is offered, and the
//                  first is the one its opening text enters (a value of a profile:
//                  /query finds one, /new makes one)
//
//     how one token is shown and changed where it is
//     Card({ token, cell, tokenSet, close, widthSet, where, markedBy })
//                  optional: the card of one token (doc_page_impl_edit_cell.md#the-card-of-a-token):
//                  what it is and what may be done with it, the kind's alone to decide.
//                  where 'value': in a value drawn that can be edited, a click on the
//                  token selects it and the card stands to its right; where 'surface':
//                  in the text being typed, the token marked (a click on its words, the
//                  caret coming to its edge) has the card under it.
//                  tokenSet({ body?, param? }) writes the token again (param a key at a
//                  time, null removing one), tokenSet(null) takes it out of the text: the
//                  owner's text, or the draft being typed. what the token names (a value
//                  kept elsewhere) is the kind's own write. close() closes the card from
//                  inside, when the kind decides its work is done (a value saved): the
//                  token stays, a click on it opens the card again. widthSet('wide')
//                  asks for a card as wide as the place the token is typed in (a value
//                  that is a text), widthSet('normal') for the usual width.
//                  markedBy says how the token came to be marked in the typed text:
//                  'pointer' (a click on its words), 'key' (the caret coming to its
//                  edge), 'open' (the cell opened on it), 'insert' (a slash action just
//                  wrote it and asked for it: the card may take the focus, a value
//                  typed at once); undefined beside a token drawn (where 'value')
//     cardPlaceList   where the card is offered: ['value', 'surface'] (the default).
//                  ['surface'] keeps a click on the drawn token doing what it does
//   })
//
// token: { kind, name, raw, body, data, start, end } (lib/doc-cell.js);
// cell: what the component handed the kit (use-cell.js): its context
// (the component's own, read live), sourcePath, owner.

const nameRegex = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function cellTokenDefine(options = {}) {
  const name = String(options.name ?? '');
  if (!nameRegex.test(name)) throw new Error(`cellTokenDefine: name must be one word (got ${JSON.stringify(options.name)}).`);
  const hasBrace = options.brace !== undefined;
  const hasMatch = options.match !== undefined;
  if (hasBrace === hasMatch) throw new Error(`cellTokenDefine: ${name} is written either as a brace token (brace: { sigil }) or by a pattern of its own (match).`);
  if (hasBrace && (!options.brace || typeof options.brace.sigil !== 'string' || /[{}\s]/.test(options.brace.sigil))) {
    throw new Error(`cellTokenDefine: brace of ${name} must be { sigil } (a text without braces or spaces, '' for the kind taking the rest).`);
  }
  if (hasMatch && typeof options.match !== 'function') throw new Error(`cellTokenDefine: match of ${name} must be a function (text) => [{ start, end, data }].`);
  for (const key of ['read', 'textGet']) {
    if (options[key] !== undefined && typeof options[key] !== 'function') throw new Error(`cellTokenDefine: ${key} of ${name} must be a function.`);
  }
  return Object.freeze({
    name,
    label: String(options.label ?? name),
    description: String(options.description ?? ''),
    brace: hasBrace ? Object.freeze({ sigil: options.brace.sigil }) : undefined,
    match: options.match,
    read: options.read,
    Render: options.Render,
    textGet: options.textGet,
    slashAction: options.slashAction,
    isTriggerDirect: options.isTriggerDirect !== false,
    Card: options.Card,
    cardPlaceList: Object.freeze(cardPlaceListRead(name, options.cardPlaceList)),
  });
}

const CARD_PLACE_LIST = ['value', 'surface'];

function cardPlaceListRead(name, cardPlaceList) {
  if (cardPlaceList === undefined) return CARD_PLACE_LIST;
  if (!Array.isArray(cardPlaceList) || cardPlaceList.length === 0 || !cardPlaceList.every((place) => CARD_PLACE_LIST.includes(place))) {
    throw new Error(`cellTokenDefine: cardPlaceList of ${name} must list some of ${CARD_PLACE_LIST.join(', ')}.`);
  }
  return [...cardPlaceList];
}

// whether the card of a kind is offered in a place ('value' | 'surface')
export function cellTokenCardIsOffered(kind, place) {
  return Boolean(kind?.Card) && (kind.cardPlaceList ?? CARD_PLACE_LIST).includes(place);
}

// the slash actions a kind is typed with in a cell (none: []): the first is the one its
// opening text enters at once
export function cellTokenSlashActionListGet(kind, cell) {
  const given = typeof kind.slashAction === 'function' ? kind.slashAction(cell) : kind.slashAction;
  return (Array.isArray(given) ? given : [given]).filter((action) => action && typeof action.name === 'string');
}

// the slash action a kind is typed with in a cell, the first of several, or undefined
export function cellTokenSlashActionGet(kind, cell) {
  return cellTokenSlashActionListGet(kind, cell)[0];
}

// the registry of the page, by id ({layer}/{name}): the package's kinds, the
// host's over them (config.cellTokenById); a host maps an id to null to
// remove a kind of the package. what is not a definition is reported
// ([doc-cell]) and left out, never the page
export function cellTokenByIdBuild(...layerList) {
  const cellTokenById = {};
  for (const layer of layerList) {
    for (const [id, kind] of Object.entries(layer ?? {})) {
      if (kind === null) {
        delete cellTokenById[id];
        continue;
      }
      if (!kind || typeof kind.name !== 'string' || (kind.brace === undefined && typeof kind.match !== 'function')) {
        console.warn(`[doc-cell] ${id}: not a cellTokenDefine() definition; left out`);
        continue;
      }
      cellTokenById[id] = kind;
    }
  }
  return cellTokenById;
}
