// The grammar of a cell text: pure functions of the cell edit layer
// (design: doc_page_impl_edit_cell.md), shared by its store (DocCellStore),
// its components and tests. No store, no React.
//
// a cell is one small value a component draws and lets the author type in
// place: a cell of a table, a field of a form, a line of a card. its text
// is kept as one string, plain text with tokens in it:
//
//   山田 {{name/jp/first}} · [Guide](~example:root/guide.md) · {{@frontend:w5j7ozoijzl#/book/sci-fi/dune}}
//   └─ text ┘└─ a brace token ─┘   └───── a pattern token ─────┘   └────────── a brace token with a sigil ──────────┘
//
// what a token means is not decided here: a token kind says how its tokens
// are written, and this module only finds them.
//
//   a token kind (cellTokenDefine, comp-doc/cell/cell-define.js) is found one of two ways:
//     brace: { sigil }     a brace token {{…}} whose body starts with the sigil ('@');
//                          the kind with the sigil '' takes every brace token no other
//                          kind takes (the cell's own: a query of a CV). after the body a
//                          brace token may carry parameters of this one token, how it is
//                          drawn here: {{/badge/aws/saa|size=l,name}}
//     match(text)          a pattern of its own in the text: [{ start, end, data }]
//                          (the Markdown link of the navigation layer)
//   read(body)             optional, for a brace kind: what the body means (its data),
//                          or undefined when the body is not a token of the kind
//
// a text is parsed against the kinds its cell accepts, so the same text
// reads differently in two cells: where no kind takes a token, it is text.

export const CELL_BRACE_OPEN = '{{';
export const CELL_BRACE_CLOSE = '}}';
// what parts the body of a brace token from its parameters
export const CELL_PARAM_MARK = '|';

// a brace token: no brace inside it (the pattern the CV package wrote first)
const BRACE_REGEX = /\{\{([^{}]*)\}\}/g;

// the parts of a cell text, in order, covering it whole:
//   { type: 'text', text, start, end }
//   { type: 'token', kind, name, raw, body, param, data, start, end }
//      kind   the token kind (the definition given in tokenList)
//      raw    the token as written; body: what is inside the braces after the sigil and
//             before the parameters, trimmed
//      param  the parameters of a brace token ({} without any): { size: 'l', name: true }
//      data   what its kind read of it ({} when the kind reads nothing)
export function cellTextParse(textInput, tokenList = []) {
  const text = String(textInput ?? '');
  const kindList = Array.isArray(tokenList) ? tokenList.filter(Boolean) : [];
  const candidateList = [...braceCandidateListGet(text, kindList), ...patternCandidateListGet(text, kindList)]
    // the earliest first; of two starting together, the longer
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const partList = [];
  let indexLast = 0;
  for (const candidate of candidateList) {
    if (candidate.start < indexLast) continue;
    if (candidate.start > indexLast) partList.push({ type: 'text', text: text.slice(indexLast, candidate.start), start: indexLast, end: candidate.start });
    partList.push({ type: 'token', ...candidate, raw: text.slice(candidate.start, candidate.end) });
    indexLast = candidate.end;
  }
  if (indexLast < text.length) partList.push({ type: 'text', text: text.slice(indexLast), start: indexLast, end: text.length });
  return partList;
}

function braceCandidateListGet(text, kindList) {
  const braceKindList = kindList.filter((kind) => kind.brace);
  if (braceKindList.length === 0) return [];
  // the kinds with a sigil first, the longest sigil first; then the kind taking the rest
  const sigilKindList = braceKindList.filter((kind) => kind.brace.sigil !== '').sort((a, b) => b.brace.sigil.length - a.brace.sigil.length);
  const kindRest = braceKindList.find((kind) => kind.brace.sigil === '');
  const candidateList = [];
  for (const match of text.matchAll(BRACE_REGEX)) {
    const { inner, param } = braceInnerSplit(match[1]);
    const kind = sigilKindList.find((one) => inner.startsWith(one.brace.sigil)) ?? kindRest;
    if (!kind) continue;
    const body = inner.slice(kind.brace.sigil.length).trim();
    const data = kind.read ? kind.read(body, param) : {};
    if (data === undefined) continue;
    candidateList.push({ kind, name: kind.name, body, param, data: data ?? {}, start: match.index, end: match.index + match[0].length });
  }
  return candidateList;
}

// what is inside the braces: the body, then after the first "|" the parameters of the
// token, "key=value" separated by commas, a key alone being true: {{body|size=l,name}}
function braceInnerSplit(innerInput) {
  const text = String(innerInput ?? '');
  const indexBar = text.indexOf(CELL_PARAM_MARK);
  if (indexBar < 0) return { inner: text.trim(), param: {} };
  const param = {};
  for (const piece of text.slice(indexBar + 1).split(',')) {
    const indexEqual = piece.indexOf('=');
    const key = (indexEqual < 0 ? piece : piece.slice(0, indexEqual)).trim();
    if (key === '') continue;
    param[key] = indexEqual < 0 ? true : piece.slice(indexEqual + 1).trim();
  }
  return { inner: text.slice(0, indexBar).trim(), param };
}

// the parameters of a brace token as written: "|size=l,name"; '' without any. a value
// that is null, undefined, false or '' leaves its key out
function braceParamTextBuild(param) {
  const pieceList = [];
  for (const [key, value] of Object.entries(param ?? {})) {
    if (value === null || value === undefined || value === false || value === '') continue;
    pieceList.push(value === true ? key : `${key}=${String(value).replace(/[,|{}]/g, '')}`);
  }
  return pieceList.length > 0 ? `${CELL_PARAM_MARK}${pieceList.join(',')}` : '';
}

function patternCandidateListGet(text, kindList) {
  const candidateList = [];
  for (const kind of kindList) {
    if (typeof kind.match !== 'function') continue;
    for (const found of kind.match(text) ?? []) {
      if (!found || !(found.end > found.start)) continue;
      candidateList.push({ kind, name: kind.name, body: text.slice(found.start, found.end), data: found.data ?? {}, start: found.start, end: found.end });
    }
  }
  return candidateList;
}

// a brace token as written: {{body}}, {{@body}} with a sigil, {{body|size=l}} with parameters
export function cellBraceTextBuild(body, sigil = '', param = undefined) {
  return `${CELL_BRACE_OPEN}${sigil}${String(body ?? '').trim()}${braceParamTextBuild(param)}${CELL_BRACE_CLOSE}`;
}

// a brace token of a parsed text written again with a change: { body?, param? }, the
// parameters merged a key at a time (null removes one). what a card editing one token
// answers with (doc_page_impl_edit_cell.md#a-token-selected-its-card)
export function cellTokenTextBuild(part, change = {}) {
  if (!part?.kind?.brace) return part?.raw ?? '';
  const param = { ...part.param };
  for (const [key, value] of Object.entries(change.param ?? {})) {
    if (value === null || value === undefined) delete param[key];
    else param[key] = value;
  }
  return cellBraceTextBuild(change.body ?? part.body, part.kind.brace.sigil, param);
}

// a text with the characters from start to end replaced
export function cellTextRangeReplace(textInput, start, end, replacement) {
  const text = String(textInput ?? '');
  return `${text.slice(0, start)}${replacement ?? ''}${text.slice(end)}`;
}

// what a range of a cell text holds: { text, isPlain }. isPlain: no token lies in the
// range, in part or whole, so the range is words of the cell and can be made a token of
// its own (a value kept elsewhere and named here) without cutting another one
export function cellRangeRead(partList, start, end, textInput) {
  const text = String(textInput ?? '').slice(start, end);
  const isPlain = end > start && !partList.some((part) => part.type === 'token' && part.start < end && part.end > start);
  return { text, isPlain };
}

// the text of a cell as plain text: its text parts, and for each token what
// textOf(part) answers (the value a query reads, the label of a link); a
// token textOf answers nothing for stays as written
export function cellTextPlainGet(partList, textOf) {
  return partList.map((part) => {
    if (part.type === 'text') return part.text;
    const text = textOf?.(part);
    return text === undefined || text === null ? part.raw : String(text);
  }).join('');
}

// whether a cell text is one token and nothing else (spaces aside): the
// token, or undefined. a cell that is one query can offer what belongs to
// that value (a CV cell: the value in the profile)
export function cellTokenSoleGet(partList) {
  const partFilled = partList.filter((part) => part.type === 'token' || part.text.trim() !== '');
  return partFilled.length === 1 && partFilled[0].type === 'token' ? partFilled[0] : undefined;
}

// the tokens of one kind (by its name), in order
export function cellTokenListGet(partList, name) {
  return partList.filter((part) => part.type === 'token' && (name === undefined || part.name === name));
}

// ---------- the Markdown link, as the navigation layer writes one ----------
//
//   [Guide](./guide.md)   [A \[bracket\]](<~page:root/a b.md#place>)
//
// the label may hold escaped brackets, the target is bare (no space, no
// parenthesis) or in angle brackets, as linkMarkdownBuild writes it
// (lib/doc-link-complete.js). an image (![alt](src)) is not a link.
const LINK_REGEX = /\[((?:\\.|[^[\]\\\n])*)\]\((<[^<>\n]*>|[^()\s<>]+)\)/g;

// [{ start, end, data: { label, target } }]
export function cellLinkMatchList(textInput) {
  const text = String(textInput ?? '');
  const matchList = [];
  for (const match of text.matchAll(LINK_REGEX)) {
    if (match.index > 0 && text[match.index - 1] === '!') continue;
    const target = match[2].startsWith('<') ? match[2].slice(1, -1) : match[2];
    if (target.trim() === '') continue;
    matchList.push({
      start: match.index,
      end: match.index + match[0].length,
      data: { label: match[1].replace(/\\(.)/g, '$1'), target: target.trim() },
    });
  }
  return matchList;
}

// ---------- which kinds a cell accepts ----------

// the token kinds of a cell: its own first (the component's, over its own
// data), then the page's, by the ids the cell names or all of them. an own
// kind hides a page kind of its name, and only one kind takes the brace
// tokens without a sigil: the first one found
//   tokenOwnList      the cell's own kinds
//   tokenById         the registry of the page: { id: kind }
//   tokenIdList       undefined: every kind of the page; a list: those, in that order; []: none
export function cellTokenListResolve({ tokenOwnList = [], tokenById = {}, tokenIdList } = {}) {
  const pageList = tokenIdList === undefined
    ? Object.values(tokenById)
    : tokenIdList.map((id) => tokenById[id]).filter(Boolean);
  const tokenList = [];
  const nameSet = new Set();
  let isBraceRestTaken = false;
  for (const kind of [...tokenOwnList, ...pageList]) {
    if (!kind || nameSet.has(kind.name)) continue;
    if (kind.brace && kind.brace.sigil === '') {
      if (isBraceRestTaken) continue;
      isBraceRestTaken = true;
    }
    nameSet.add(kind.name);
    tokenList.push(kind);
  }
  return tokenList;
}

// the direct triggers of a cell (lib/doc-slash.js): for each brace kind
// that is typed with a slash action, the text opening its tokens enters the
// param mode of that action at once: "{{" for the kind taking the rest,
// "{{@" for the kind of the sigil "@". a "}" typed ends it
export function cellTriggerListBuild(tokenList, actionOf) {
  const triggerList = [];
  for (const kind of tokenList) {
    if (!kind.brace) continue;
    const action = actionOf(kind);
    if (!action?.param) continue;
    triggerList.push({ text: `${CELL_BRACE_OPEN}${kind.brace.sigil}`, action, endList: ['}', '{'] });
  }
  return triggerList;
}
