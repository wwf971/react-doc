// Asset paths: the grammar of the paths that index the asset items of a frontend object, and
// the general utility over it for anything that indexes data items by paths (design:
// main/doc_page_impl_obj_frontend_asset_path.md). Pure: no store, no files, no React, so the
// development server, the page and a package (import '@wwf971/react-doc/asset-path') use it alike.
//
// A path pattern stands for a finite set of concrete paths (lists of segments). "/" is not a
// separator: it ends a segment that is not the last one, so a term ending with "/" says that the
// path goes on after it, and a term without it ends the path:
//
//   book/sci-fi/dune            a sequence: book/ and sci-fi/ go on, dune ends the path
//   name/{jp/last/}kanji        an unordered group whose members go on: jp/last/kanji, last/jp/kanji
//   name/{jp, last}             an unordered group ending the path: name/jp/last, name/last/jp
//   a/b/{c/d/}{e, f}            two groups, each on its own: a/b/c/d/e/f, a/b/d/c/f/e, ...
//   book/[sci-fi/, classic/]dune   a choice whose alternatives go on
//   book/[sci-fi, classic]      a choice ending the path; [b/, ]c: b/ is optional
//
// Locality: only the members of one group commute; everything else keeps its place. The first
// path a pattern stands for (members and alternatives in written order) is its canonical path.
//
// Where the items are stored is not the business of this file: a caller hands over
// { entry, pathList } pairs (an asset item and its record's paths, a value and the path its data
// gives it) and gets an index answering lookups, the entries below a folder, and completion.
//
// node kinds of a parsed pattern (whether a term goes on is a matter of writing: it follows from
// its place, and is not kept):
//   { kind: 'segment', name }
//   { kind: 'sequence', elementList }       elements: segments, groups, choices
//   { kind: 'group', memberList }           an unordered group; a member is one element
//   { kind: 'choice', alternativeList }     each alternative a sequence (possibly empty)

export const ASSET_PATH_SEGMENT_LENGTH_MAX = 80;
export const ASSET_PATH_GROUP_MEMBER_MAX = 6;
export const ASSET_PATH_EXPANSION_MAX = 1024;

const CHAR_SPECIAL = '/{}[],\\';
// eslint-disable-next-line no-control-regex
const CHAR_CONTROL_REGEX = /[\u0000-\u001f]/;

class AssetPathError extends Error {
  constructor(message, position) {
    super(message);
    this.position = position;
  }
}

function sequenceOf(elementList) {
  return { kind: 'sequence', elementList };
}

// ---------- parsing ----------

// { node, isAbsolute, message, position }: the pattern of a text, or why it is none (message,
// with the character position). An empty text is the empty sequence. Read as an os reads a path
// where that is unambiguous: "./" and an empty segment ("//") are nothing, "../" takes back the
// segment before it in its own sequence, and a "/" after the last segment of the whole text is
// left out (book/dune/ is book/dune). A group or a choice ending the text ends the path, so its
// members do not end with "/".
//   isFragment   the text is a piece of a path that more may follow (a key of the data, with keys
//                below it): it may end going on, {jp/last/} as well as {jp, last}
export function assetPathParse(textInput, { isFragment = false } = {}) {
  const text = String(textInput ?? '');
  let index = 0;
  const spaceSkip = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };
  const fail = (message, at = index) => {
    throw new AssetPathError(message, at);
  };
  const textOf = (term) => text.slice(term.start, term.end).trim();

  // a segment: up to the next special character ("\" makes the character after it ordinary), and
  // the "/" ending it when there is one: { node, isOpen, start, end, name }
  const segmentRead = () => {
    const start = index;
    let name = '';
    while (index < text.length) {
      const char = text[index];
      if (char === '\\') {
        if (index + 1 >= text.length) fail('a "\\" escapes the character after it, and none follows');
        name += text[index + 1];
        index += 2;
        continue;
      }
      if (CHAR_SPECIAL.includes(char)) break;
      name += char;
      index += 1;
    }
    name = name.trim();
    const isOpen = text[index] === '/';
    if (isOpen) index += 1;
    if (CHAR_CONTROL_REGEX.test(name)) fail('a segment cannot hold control characters', start);
    if (name.length > ASSET_PATH_SEGMENT_LENGTH_MAX) fail(`a segment is at most ${ASSET_PATH_SEGMENT_LENGTH_MAX} characters`, start);
    return { node: { kind: 'segment', name }, isOpen, start, end: index, name };
  };

  // one term: a segment, a group or a choice, with whether it ends with "/"
  const termRead = () => {
    const start = index;
    let term;
    if (text[index] === '{') term = groupRead();
    else if (text[index] === '[') term = choiceRead();
    else return segmentRead();
    if (text[index] === '/') {
      fail(term.node.kind === 'group'
        ? 'a "/" after a group: the "/" goes after each member, inside it ({c/d/}x, not {c/d}/x)'
        : 'a "/" after a choice: the "/" goes after each alternative, inside it ([b/, c/]x, not [b, c]/x)');
    }
    return { ...term, start, end: index };
  };

  // terms one after the other, up to one of the closing characters (not consumed). every term but
  // the last goes on: { elementList, isOpen } (isOpen undefined when empty)
  const sequenceRead = (closeList, place) => {
    const elementList = [];
    let termLast;
    for (;;) {
      spaceSkip();
      if (index >= text.length || closeList.includes(text[index])) break;
      const char = text[index];
      if (char === '}' || char === ']' || char === ',') fail(`"${char}" closes nothing here`);
      if (termLast && !termLast.isOpen) {
        fail(`${JSON.stringify(textOf(termLast))} does not end with "/", so it ends the path: nothing can follow it (write a "/" after it)`);
      }
      const term = termRead();
      const name = term.node.kind === 'segment' ? term.name : undefined;
      if (name === '' || name === '.' || name === '..') {
        // "//" and "./" are nothing; "../" takes back the segment before it; without its "/",
        // either ends the path at the term left before it
        if (name === '..') {
          const before = elementList[elementList.length - 1];
          if (!before) fail(place === 'top' ? 'it goes above the root' : '".." has no segment before it to take back', term.start);
          if (before.kind !== 'segment') fail('".." takes back a segment, not a group or a choice', term.start);
          elementList.pop();
        }
        const nodeLast = elementList[elementList.length - 1];
        if (name === '..' || !term.isOpen) termLast = nodeLast ? { node: nodeLast, isOpen: term.isOpen, start: term.start, end: term.end } : undefined;
        continue;
      }
      elementList.push(term.node);
      termLast = term;
    }
    return { elementList, isOpen: elementList.length > 0 ? termLast?.isOpen ?? false : undefined, termLast };
  };

  // {c/d/} or {c/, d/}: members going on; {e, f}: members ending the path. a member is one term
  const groupRead = () => {
    const start = index;
    index += 1;
    const memberList = [];
    let isCommaBefore = false;
    for (;;) {
      spaceSkip();
      if (index >= text.length) fail('an unordered group "{" is not closed', start);
      const char = text[index];
      if (char === '}') break;
      if (char === ',') {
        if (memberList.length === 0 || isCommaBefore) fail('an empty member of an unordered group');
        index += 1;
        isCommaBefore = true;
        continue;
      }
      if (char === ']') fail('"]" inside an unordered group: a group is closed by "}"');
      if (char === '/') fail('a "/" between the members of a group: it ends a member ({c/d/}), or "," separates them ({e, f})');
      const memberBefore = memberList[memberList.length - 1];
      if (memberBefore && !memberBefore.isOpen && !isCommaBefore) {
        fail(`the members of a group that end the path are separated by "," ({e, f}): ${JSON.stringify(textOf(memberBefore))} is followed by more`);
      }
      const term = termRead();
      if (term.node.kind === 'segment' && ['', '.', '..'].includes(term.name)) fail(`${JSON.stringify(term.name || '/')} is not a member of a group`, term.start);
      memberList.push(term);
      isCommaBefore = false;
    }
    index += 1;
    if (isCommaBefore) fail('an empty member of an unordered group', index - 1);
    if (memberList.length === 0) fail('an unordered group {…} holds at least one member', start);
    if (memberList.length > ASSET_PATH_GROUP_MEMBER_MAX) fail(`an unordered group holds at most ${ASSET_PATH_GROUP_MEMBER_MAX} members`, start);
    const isOpen = memberList[0].isOpen;
    if (memberList.some((one) => one.isOpen !== isOpen)) {
      fail('the members of a group all end with "/" (the path goes on after the group: {c/d/}x) or none does (the group ends the path: {e, f})', start);
    }
    return { node: { kind: 'group', memberList: memberList.map((one) => one.node) }, isOpen };
  };

  // [b/, c/d/]x: alternatives going on; [b, c/d]: alternatives ending the path. [b/, ]x: optional
  const choiceRead = () => {
    const start = index;
    index += 1;
    const alternativeList = [];
    for (;;) {
      alternativeList.push(sequenceRead([',', ']', '}'], 'choice'));
      if (text[index] === ',') {
        index += 1;
        continue;
      }
      if (text[index] === ']') {
        index += 1;
        break;
      }
      fail(index >= text.length ? 'a choice "[" is not closed' : `"${text[index]}" inside a choice: a choice is closed by "]"`, index >= text.length ? start : index);
    }
    const filledList = alternativeList.filter((one) => one.isOpen !== undefined);
    if (filledList.length === 0) fail('a choice […] holds at least one alternative that is not empty', start);
    const { isOpen } = filledList[0];
    if (filledList.some((one) => one.isOpen !== isOpen)) {
      fail('the alternatives of a choice all end with "/" (the path goes on after the choice: [b/, c/]x) or none does (the choice ends the path: [b, c])', start);
    }
    if (!isOpen && filledList.length < alternativeList.length) {
      fail('an empty alternative leaves nothing where the path ends: an optional segment goes on ([b/, ]x), or write the paths whole ([a/b, a])', start);
    }
    return { node: { kind: 'choice', alternativeList: alternativeList.map((one) => sequenceOf(one.elementList)) }, isOpen: Boolean(isOpen) };
  };

  spaceSkip();
  const isAbsolute = text[index] === '/';
  if (isAbsolute) index += 1;
  try {
    const { elementList, isOpen, termLast } = sequenceRead([], 'top');
    // the end of the text ends the path: a "/" after its last segment is left out, as an os does;
    // a group or choice there must say that it ends the path
    if (isOpen && !isFragment && termLast && termLast.node && termLast.node.kind !== 'segment') {
      fail(termLast.node.kind === 'group'
        ? `the path ends with a group whose members end with "/": the last segment of a path does not ({e, f}, not {e/f/})`
        : `the path ends with a choice whose alternatives end with "/": the last segment of a path does not ([b, c], not [b/, c/])`, termLast.start);
    }
    return { node: assetPathSimplify(sequenceOf(elementList)), isAbsolute, message: '', position: -1 };
  } catch (error) {
    if (!(error instanceof AssetPathError)) throw error;
    return { node: undefined, isAbsolute, message: `${error.message} (at character ${error.position + 1})`, position: error.position };
  }
}

// the same set of paths, written with fewer brackets: a choice of one alternative inside a
// sequence is that sequence, a group of one member is the member, nested sequences are one
function assetPathSimplify(node) {
  if (node.kind === 'segment') return node;
  if (node.kind === 'choice') {
    const alternativeList = node.alternativeList.map(assetPathSimplify);
    const seen = new Set();
    const unique = alternativeList.filter((one) => {
      const key = assetPathText(one);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return unique.length === 1 ? unique[0] : { kind: 'choice', alternativeList: unique };
  }
  if (node.kind === 'group') {
    const memberList = node.memberList.map(assetPathSimplify).map((one) => (one.kind === 'sequence' && one.elementList.length === 1 ? one.elementList[0] : one));
    return memberList.length === 1 ? memberList[0] : { kind: 'group', memberList };
  }
  const elementList = [];
  for (const one of node.elementList.map(assetPathSimplify)) {
    if (one.kind === 'sequence') elementList.push(...one.elementList);
    else elementList.push(one);
  }
  return sequenceOf(elementList);
}

// ---------- writing ----------

export function assetPathSegmentEscape(name) {
  return String(name).split('').map((char) => (CHAR_SPECIAL.includes(char) ? `\\${char}` : char)).join('');
}

// the canonical text of a pattern: a "/" after every segment that something follows (inside a
// group going on, after each member: {c/d/}; a group ending the path: {e, f}), ", " between
// alternatives, a "/" first when absolute. a member of a group that is several segments is
// bracketed as a choice of one ([a/b/] going on, [a/b] at the end)
export function assetPathText(node, { isAbsolute = false } = {}) {
  const text = nodeText(node, false, false);
  return isAbsolute ? `/${text}` : text;
}

// isOpen: something follows the node, so its last segments end with "/"
function nodeText(node, isOpen, isMember) {
  if (!node) return '';
  const slash = isOpen ? '/' : '';
  if (node.kind === 'segment') return `${assetPathSegmentEscape(node.name)}${slash}`;
  if (node.kind === 'group') {
    const memberText = node.memberList.map((one) => nodeText(one, isOpen, true));
    return `{${memberText.join(isOpen ? '' : ', ')}}`;
  }
  if (node.kind === 'choice') return `[${node.alternativeList.map((one) => nodeText(one, isOpen, false)).join(', ')}]`;
  const { elementList } = node;
  const text = elementList.map((one, at) => nodeText(one, at < elementList.length - 1 || isOpen, false)).join('');
  return isMember && elementList.length !== 1 ? `[${text}]` : text;
}

// a list of segments as a path text: ['book', 'sci-fi'] -> /book/sci-fi
export function assetPathJoin(segmentList, { isAbsolute = false } = {}) {
  const text = segmentList.map(assetPathSegmentEscape).join('/');
  return isAbsolute ? `/${text}` : text;
}

// the segments of a concrete path text (no group, no choice): /book/sci-fi -> ['book', 'sci-fi'];
// undefined when the text is a pattern standing for several paths, or no path
export function assetPathSplit(text) {
  const { node, message } = assetPathParse(text);
  if (message || !assetPathIsConcrete(node)) return undefined;
  return node.elementList.map((one) => one.name);
}

// whether a pattern is one concrete path: segments only
export function assetPathIsConcrete(node) {
  return Boolean(node) && node.kind === 'sequence' && node.elementList.every((one) => one.kind === 'segment');
}

// { path, node, message }: the canonical text of a pattern ('' for an empty text), or why it is none
//   isAbsolute   the text is written from the root ("/" first); default: as the text is
//   isEmptyRefused  an empty pattern is a message ("the root names nothing")
export function assetPathNormalize(textInput, { isAbsolute, isEmptyRefused = false } = {}) {
  const text = String(textInput ?? '').trim();
  if (text === '') return { path: '', node: undefined, message: isEmptyRefused ? 'the root names nothing' : '' };
  const parsed = assetPathParse(text);
  if (parsed.message) return { path: '', node: undefined, message: parsed.message };
  if (parsed.node.elementList.length === 0) return { path: '', node: undefined, message: isEmptyRefused ? 'the root names nothing' : '' };
  const expanded = assetPathExpand(parsed.node);
  if (expanded.message) return { path: '', node: undefined, message: expanded.message };
  return { path: assetPathText(parsed.node, { isAbsolute: isAbsolute ?? parsed.isAbsolute }), node: parsed.node, message: '' };
}

// a list of patterns as one text and back: "a, [b, c]/d" -> ['a', '[b, c]/d'] (split at the commas
// outside brackets; an escaped comma stays)
export function assetPathListSplit(textInput) {
  const text = String(textInput ?? '');
  const partList = [];
  let depth = 0;
  let current = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) {
      current += char + text[index + 1];
      index += 1;
      continue;
    }
    if (char === '{' || char === '[') depth += 1;
    if ((char === '}' || char === ']') && depth > 0) depth -= 1;
    if (char === ',' && depth === 0) {
      partList.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  partList.push(current);
  return partList.map((one) => one.trim()).filter(Boolean);
}

// ---------- composing ----------

// the patterns one after the other: (name, {jp/last}) -> name/{jp/last}
export function assetPathConcat(...nodeList) {
  return assetPathSimplify(sequenceOf(nodeList.filter(Boolean)));
}

// any of the patterns: [p1, p2]
export function assetPathChoice(nodeList) {
  const list = nodeList.filter(Boolean);
  if (list.length === 0) return undefined;
  return assetPathSimplify({ kind: 'choice', alternativeList: list.map((one) => (one.kind === 'sequence' ? one : sequenceOf([one]))) });
}

// the pattern without its first segments, when they are plain segments equal to segmentList:
// (/example/info/{a/b}, [example, info]) -> {a/b}. a choice at the top is stripped alternative by
// alternative, keeping those that start so. undefined when nothing starts so
export function assetPathPrefixStrip(node, segmentList, { segmentNormalize = segmentSame } = {}) {
  if (!node) return undefined;
  if (segmentList.length === 0) return node;
  const sequence = node.kind === 'sequence' ? node : sequenceOf([node]);
  if (sequence.elementList.length === 1 && sequence.elementList[0].kind === 'choice') {
    const stripped = sequence.elementList[0].alternativeList.map((one) => assetPathPrefixStrip(one, segmentList, { segmentNormalize })).filter(Boolean);
    return stripped.length === 0 ? undefined : assetPathChoice(stripped);
  }
  const head = sequence.elementList.slice(0, segmentList.length);
  if (head.length < segmentList.length) return undefined;
  const isMatch = head.every((one, index) => one.kind === 'segment' && segmentNormalize(one.name) === segmentNormalize(segmentList[index]));
  return isMatch ? sequenceOf(sequence.elementList.slice(segmentList.length)) : undefined;
}

function segmentSame(name) {
  return name;
}

// ---------- the paths a pattern stands for ----------

// { pathList: [[segment]], message }: every concrete path of a pattern, each once, the canonical
// one first; message when there are more than limit
export function assetPathExpand(node, { limit = ASSET_PATH_EXPANSION_MAX } = {}) {
  if (!node) return { pathList: [], message: 'no pattern' };
  try {
    return { pathList: expandNode(node, limit), message: '' };
  } catch (error) {
    if (!(error instanceof AssetPathError)) throw error;
    return { pathList: [], message: error.message };
  }
}

function listUnique(pathList, limit) {
  const seen = new Set();
  const result = [];
  for (const path of pathList) {
    const key = path.join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
    if (result.length > limit) throw new AssetPathError(`it stands for more than ${limit} paths`, -1);
  }
  return result;
}

function productOf(listA, listB, limit) {
  if (listA.length * listB.length > limit * 4) throw new AssetPathError(`it stands for more than ${limit} paths`, -1);
  const result = [];
  for (const a of listA) for (const b of listB) result.push([...a, ...b]);
  return listUnique(result, limit);
}

function expandNode(node, limit) {
  if (node.kind === 'segment') return [[node.name]];
  if (node.kind === 'choice') return listUnique(node.alternativeList.flatMap((one) => expandNode(one, limit)), limit);
  if (node.kind === 'group') {
    const memberExpanded = node.memberList.map((one) => expandNode(one, limit));
    const permute = (indexList) => {
      if (indexList.length === 0) return [[]];
      const result = [];
      for (const index of indexList) {
        const rest = permute(indexList.filter((one) => one !== index));
        result.push(...productOf(memberExpanded[index], rest, limit));
        if (result.length > limit * 4) throw new AssetPathError(`it stands for more than ${limit} paths`, -1);
      }
      return listUnique(result, limit);
    };
    return permute(memberExpanded.map((one, index) => index));
  }
  let result = [[]];
  for (const one of node.elementList) result = productOf(result, expandNode(one, limit), limit);
  return result;
}

// ---------- matching, without expanding ----------

// whether a concrete path (segments) is one the pattern stands for; isPrefix: whether it is the
// start of one (a folder on the way to it, or one of its paths). segmentNormalize: how two
// segments are compared (a caller's spellings, case); both sides go through it
export function assetPathMatch(node, segmentListInput, { isPrefix = false, segmentNormalize = segmentSame } = {}) {
  if (!node) return false;
  const segmentList = segmentListInput.map(segmentNormalize);
  const length = segmentList.length;
  const nameCache = new Map();
  const nameOf = (one) => {
    if (!nameCache.has(one)) nameCache.set(one, segmentNormalize(one.name));
    return nameCache.get(one);
  };
  // the positions where the node can end, starting at position. with isPrefix, a position at the
  // end of the path matches whatever is left of the pattern: every element stands for some path
  const endSet = (one, position) => {
    if (isPrefix && position === length) return new Set([length]);
    if (one.kind === 'segment') return position < length && segmentList[position] === nameOf(one) ? new Set([position + 1]) : new Set();
    if (one.kind === 'choice') {
      const result = new Set();
      for (const alternative of one.alternativeList) for (const end of endSet(alternative, position)) result.add(end);
      return result;
    }
    if (one.kind === 'group') {
      const full = (1 << one.memberList.length) - 1;
      const memo = new Map();
      const rest = (mask, at) => {
        const key = `${mask}:${at}`;
        if (memo.has(key)) return memo.get(key);
        const result = new Set();
        if (mask === full || (isPrefix && at === length)) result.add(at);
        else {
          one.memberList.forEach((member, index) => {
            if (mask & (1 << index)) return;
            for (const end of endSet(member, at)) for (const last of rest(mask | (1 << index), end)) result.add(last);
          });
        }
        memo.set(key, result);
        return result;
      };
      return rest(0, position);
    }
    let current = new Set([position]);
    for (const element of one.elementList) {
      const next = new Set();
      for (const at of current) for (const end of endSet(element, at)) next.add(end);
      current = next;
      if (current.size === 0) break;
    }
    return current;
  };
  return endSet(node, 0).has(length);
}

// ---------- the index of entries by their paths ----------

// an index of entries (whatever a caller indexes: asset items, values) by the paths of their
// patterns, a tree of the segments:
//   sourceList         [{ entry, pathList: [text | node] }], in the order that counts (the first
//                      claim of a path wins, entries below a folder come in this order)
//   segmentNormalize   how segments are compared (default: as written)
//   labelOf(entry)     how a problem names an entry
//   isAbsolute         the paths are written from the root: texts of answers start with "/"
// -> { root, entryByPath: Map(text -> entry), pathListByEntry: Map(entry -> [[segment]]),
//      problemList, isAbsolute, segmentNormalize }
// a tree node: { segmentList, path, childByKey: Map, entryList (paths ending here, the claim
// first), entryBelowList (here and below, each once, in order) }
export function assetPathIndexBuild(sourceList, { segmentNormalize = segmentSame, labelOf = String, isAbsolute = false } = {}) {
  const root = treeNodeCreate([], isAbsolute);
  const entryByPath = new Map();
  const pathListByEntry = new Map();
  const problemList = [];
  const claimByKey = new Map();
  for (const source of sourceList ?? []) {
    const { entry } = source;
    const pathOwnList = pathListByEntry.get(entry) ?? [];
    pathListByEntry.set(entry, pathOwnList);
    for (const pathOne of source.pathList ?? []) {
      const { pathList, message } = typeof pathOne === 'string' ? assetPathCompile(pathOne) : assetPathExpand(pathOne);
      if (message) {
        problemList.push(`${labelOf(entry)}: the path ${typeof pathOne === 'string' ? pathOne : assetPathText(pathOne, { isAbsolute })}: ${message}`);
        continue;
      }
      for (const segmentList of pathList) {
        const key = segmentList.map(segmentNormalize).join('\u0000');
        const claim = claimByKey.get(key);
        const text = assetPathJoin(segmentList, { isAbsolute });
        if (claim && claim !== entry) {
          problemList.push(`the path ${text} is claimed by ${labelOf(claim)} and ${labelOf(entry)}: it names ${labelOf(claim)}`);
          continue;
        }
        if (claim === entry) continue;
        claimByKey.set(key, entry);
        entryByPath.set(text, entry);
        pathOwnList.push(segmentList);
        treeInsert(root, segmentList, entry, segmentNormalize, isAbsolute);
      }
    }
  }
  return { root, entryByPath, pathListByEntry, problemList, isAbsolute, segmentNormalize, claimByKey };
}

function treeNodeCreate(segmentList, isAbsolute) {
  return { segmentList, path: assetPathJoin(segmentList, { isAbsolute }), childByKey: new Map(), entryList: [], entryBelowList: [], entryBelowSet: new Set() };
}

function treeInsert(root, segmentList, entry, segmentNormalize, isAbsolute) {
  let node = root;
  const visit = (one) => {
    if (one.entryBelowSet.has(entry)) return;
    one.entryBelowSet.add(entry);
    one.entryBelowList.push(entry);
  };
  visit(node);
  segmentList.forEach((segment, index) => {
    const key = segmentNormalize(segment);
    if (!node.childByKey.has(key)) node.childByKey.set(key, treeNodeCreate(segmentList.slice(0, index + 1), isAbsolute));
    node = node.childByKey.get(key);
    visit(node);
  });
  node.entryList.push(entry);
}

function segmentListOf(pathInput) {
  if (Array.isArray(pathInput)) return pathInput;
  return assetPathSplit(pathInput) ?? [];
}

// the tree node of a concrete path, or undefined: a folder on the way to some path, or a path
export function assetPathIndexNodeGet(index, pathInput) {
  let node = index.root;
  for (const segment of segmentListOf(pathInput)) {
    node = node.childByKey.get(index.segmentNormalize(segment));
    if (!node) return undefined;
  }
  return node;
}

// the entry a concrete path names, or undefined
export function assetPathIndexGet(index, pathInput) {
  return assetPathIndexNodeGet(index, pathInput)?.entryList[0];
}

// the entries whose paths run through a concrete path (it, and below), each once, in order
export function assetPathIndexBelowList(index, pathInput) {
  return assetPathIndexNodeGet(index, pathInput)?.entryBelowList ?? [];
}

// the first path of an entry that starts with the segments given (to say how an entry is reached
// from what was typed), else its canonical path
export function assetPathIndexPathOfEntryGet(index, entry, prefixList = []) {
  const pathList = index.pathListByEntry.get(entry) ?? [];
  const prefixKey = prefixList.map(index.segmentNormalize);
  return pathList.find((one) => prefixKey.every((key, at) => index.segmentNormalize(one[at] ?? '') === key)) ?? pathList[0];
}

// the candidates completing a typed path: the folder typed so far (up to the last "/") is
// listed, its folders first, then the entries whose path ends there; those whose segment starts
// with what follows the last "/" first, then those whose label (labelOf) starts with it, then
// those holding it. a text that is not absolute in an absolute index is read from base.
//   isEntryWanted(entry)   only these entries, and the folders holding one
// -> [{ kind: 'folder' | 'entry', path, segmentList, segment, entry?, entryCount }]
export function assetPathIndexComplete(index, textInput, { base = '', isEntryWanted, labelOf } = {}) {
  const text = String(textInput ?? '');
  const indexSlash = text.lastIndexOf('/');
  const dirText = indexSlash >= 0 ? text.slice(0, indexSlash + 1) : '';
  const prefix = (indexSlash >= 0 ? text.slice(indexSlash + 1) : text).trim().toLowerCase();
  // what is typed may be a spelling of its own (a caller's normalize) or the start of a segment
  const prefixKeyList = [...new Set([prefix, String(index.segmentNormalize(prefix)).toLowerCase()])];
  const isTextAbsolute = text.startsWith('/');
  const dirJoined = index.isAbsolute && !isTextAbsolute ? `${String(base).replace(/\/$/, '')}/${dirText}` : dirText;
  const dirParsed = assetPathParse(dirJoined);
  if (dirParsed.message || !assetPathIsConcrete(dirParsed.node)) return [];
  const folder = assetPathIndexNodeGet(index, dirParsed.node.elementList.map((one) => one.name));
  if (!folder) return [];
  const isWanted = (entry) => !isEntryWanted || isEntryWanted(entry);
  const candidateList = [];
  for (const child of folder.childByKey.values()) {
    const segment = child.segmentList[child.segmentList.length - 1];
    // a folder: the entries strictly below it
    const belowSet = new Set();
    for (const grandchild of child.childByKey.values()) for (const entry of grandchild.entryBelowList) if (isWanted(entry)) belowSet.add(entry);
    if (belowSet.size > 0) candidateList.push({ kind: 'folder', path: child.path, segmentList: child.segmentList, segment, entryCount: belowSet.size });
    const entry = child.entryList[0];
    if (entry !== undefined && isWanted(entry)) candidateList.push({ kind: 'entry', path: child.path, segmentList: child.segmentList, segment, entry, entryCount: 1 });
  }
  const rankGet = (candidate) => {
    const segmentList = [String(candidate.segment).toLowerCase(), String(index.segmentNormalize(candidate.segment)).toLowerCase()];
    const label = String((candidate.entry !== undefined && labelOf ? labelOf(candidate.entry) : '') ?? '').toLowerCase();
    const isAny = (test) => prefixKeyList.some((key) => segmentList.some((segment) => test(segment, key)));
    if (prefix === '' || isAny((segment, key) => segment.startsWith(key))) return 0;
    if (prefixKeyList.some((key) => label.startsWith(key))) return 1;
    if (isAny((segment, key) => segment.includes(key)) || label.includes(prefix)) return 2;
    return -1;
  };
  return candidateList
    .map((candidate) => ({ candidate, rank: rankGet(candidate) }))
    .filter((one) => one.rank >= 0)
    .sort((a, b) => a.rank - b.rank || (a.candidate.kind === b.candidate.kind ? 0 : a.candidate.kind === 'folder' ? -1 : 1) || a.candidate.segment.localeCompare(b.candidate.segment))
    .map((one) => one.candidate);
}

// ---------- compiled once ----------

const compileCache = new Map();
const COMPILE_CACHE_MAX = 4000;

// { node, path, pathList: [[segment]], textList: [text], message } of a pattern text, kept for
// the next call with the same text (an index is rebuilt often, its patterns rarely change)
export function assetPathCompile(textInput, { isAbsolute } = {}) {
  const text = String(textInput ?? '');
  const key = `${isAbsolute ?? ''}\u0000${text}`;
  if (compileCache.has(key)) return compileCache.get(key);
  const normalized = assetPathNormalize(text, { isAbsolute });
  let result;
  if (normalized.message || !normalized.node) result = { node: undefined, path: '', pathList: [], textList: [], message: normalized.message };
  else {
    const { pathList } = assetPathExpand(normalized.node);
    const absolute = isAbsolute ?? normalized.path.startsWith('/');
    result = { node: normalized.node, path: normalized.path, pathList, textList: pathList.map((one) => assetPathJoin(one, { isAbsolute: absolute })), message: '' };
  }
  if (compileCache.size >= COMPILE_CACHE_MAX) compileCache.clear();
  compileCache.set(key, result);
  return result;
}
