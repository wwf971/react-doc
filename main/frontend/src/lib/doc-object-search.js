import { objectRefParse } from './doc-object-ref.js';

// The search of the object service layer, the pure part (design:
// doc_page_impl_obj_search.md): the grammar of a search text, what a
// provider and an object are matched by, the plan of a search per provider
// (decided before anything is fetched), and the score of a match.
//
//   search text   tokens split by spaces, in any order, every one must match
//                 ("quoted words" are one token):
//     word        any field: the name of the object, its id (its reference),
//                 its host (the service instance or layer providing it: its
//                 name, its id, its template, the doc page), its Types (id or
//                 label, with their ancestors), its description and summary
//     type:word   its Types only            type:task  type:doc.section
//     in:word     its host only             in:todos   in:w55j3   in:example
//     id:word     its reference only        id:todo/3  id:~example:example/a.md
//     ns:word     its namespace only        ns:doc     ns:service.w55j3ztn3rq
//     a reference a whole reference (doc:~example:example/a.md#setup) is also
//                 resolved at once: the object, whatever the rest says
//
// a token matched by what is known of a provider (its host, its Types) is
// met by every object of it; the others are matched by each object. so
// "todos milk" finds the objects named like milk of the host named like
// todos, without listing the objects of any other host.

export const OBJECT_SEARCH_KEY_LIST = ['type', 'in', 'id', 'ns'];

// the weight of a field a token matches, for the order of the results
const SCORE_BY_FIELD = { namePrefix: 8, name: 5, id: 3, in: 2, type: 1, other: 1 };

// { tokenList: [{ raw, key, value, valueLower }], refList }; key '' for a word
export function objectSearchParse(text) {
  const tokenList = [];
  const refList = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = pattern.exec(String(text ?? ''))) !== null) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const indexColon = raw.indexOf(':');
    const keyCandidate = indexColon > 0 ? raw.slice(0, indexColon).toLowerCase() : '';
    const isKey = match[1] === undefined && OBJECT_SEARCH_KEY_LIST.includes(keyCandidate) && indexColon < raw.length - 1;
    const value = isKey ? raw.slice(indexColon + 1) : raw;
    tokenList.push({ raw, key: isKey ? keyCandidate : '', value, valueLower: value.toLowerCase() });
    // what may be a whole reference: resolved directly when a provider owns
    // its namespace (the store checks)
    if (!isKey && objectRefParse(raw)) refList.push(raw);
    if (isKey && keyCandidate === 'id' && objectRefParse(value)) refList.push(value);
  }
  return { tokenList, refList };
}

// what a provider is known by before anything is fetched: its host (name,
// id, service id, template, namespaces) and its Types (ids and labels, with
// their ancestors)
export function objectSearchProviderFieldsBuild(provider, typeRegistry) {
  return {
    in: [provider.label, provider.id, provider.serviceId, provider.templateName, ...(provider.namespaceList ?? [])].filter(Boolean).map(textLower),
    ns: (provider.namespaceList ?? []).map(textLower),
    type: typeTextListBuild(provider.typeList ?? [], typeRegistry),
  };
}

// what an object is matched by: its name, its id, its host, its Types, the rest
export function objectSearchFieldsBuild(descriptor, hostFieldList, typeRegistry) {
  const parsed = objectRefParse(descriptor.ref);
  const summaryTextList = Object.values(descriptor.summary ?? {})
    .filter((value) => typeof value === 'string' && value.length < 200);
  return {
    name: textLower(descriptor.label),
    id: [descriptor.ref, parsed?.local ?? ''].map(textLower),
    in: [...hostFieldList, ...(descriptor.provider?.label ? [descriptor.provider.label] : []), ...summaryTextList.filter((text) => text.startsWith('~'))].map(textLower),
    ns: [textLower(parsed?.namespace ?? '')],
    type: typeTextListBuild(descriptor.typeList ?? [], typeRegistry),
    other: [descriptor.description, ...summaryTextList].map(textLower),
  };
}

// the plan of a search for one provider, before anything is fetched:
//   isCandidate     whether objects of it can match at all: every token of
//                   in: and ns: matches its host, every type: one of its Types
//   tokenListObject the tokens its objects must still match one by one (the
//                   words its host does not match, type: and id:)
//   textPush        the word a provider may filter by itself (its query's
//                   text): the longest of the words left; '' for none
export function objectSearchPlanBuild(tokenList, providerFields) {
  const tokenListObject = [];
  for (const token of tokenList) {
    if (token.key === 'in' || token.key === 'ns') {
      if (!providerFields[token.key].some((text) => text.includes(token.valueLower))) return { isCandidate: false, tokenListObject: [], textPush: '', reason: `${token.raw} matches no host of it` };
      continue;
    }
    if (token.key === 'type') {
      if (!providerFields.type.some((text) => text.includes(token.valueLower))) return { isCandidate: false, tokenListObject: [], textPush: '', reason: `${token.raw} matches none of its Types` };
      tokenListObject.push(token);
      continue;
    }
    if (token.key === 'id') {
      tokenListObject.push(token);
      continue;
    }
    // a word its host matches is met by all its objects
    if (providerFields.in.some((text) => text.includes(token.valueLower))) continue;
    tokenListObject.push(token);
  }
  const wordList = tokenListObject.filter((token) => token.key === '').map((token) => token.value);
  const textPush = wordList.sort((a, b) => b.length - a.length)[0] ?? '';
  return { isCandidate: true, tokenListObject, textPush, reason: '' };
}

// how an object matches the tokens left for it: undefined when one does
// not; else { score, matchList: [{ token, field }] }
export function objectSearchMatch(fields, tokenListObject, tokenCountProvider = 0) {
  let score = tokenCountProvider * SCORE_BY_FIELD.in;
  const matchList = [];
  for (const token of tokenListObject) {
    const field = tokenFieldMatch(fields, token);
    if (!field) return undefined;
    score += SCORE_BY_FIELD[field] ?? 1;
    matchList.push({ token: token.raw, field });
  }
  return { score, matchList };
}

function tokenFieldMatch(fields, token) {
  const value = token.valueLower;
  if (token.key === 'type') return fields.type.some((text) => text.includes(value)) ? 'type' : undefined;
  if (token.key === 'id') return fields.id.some((text) => text.includes(value)) ? 'id' : undefined;
  if (token.key === 'in') return fields.in.some((text) => text.includes(value)) ? 'in' : undefined;
  if (token.key === 'ns') return fields.ns.some((text) => text.includes(value)) ? 'in' : undefined;
  if (fields.name.startsWith(value)) return 'namePrefix';
  if (fields.name.includes(value)) return 'name';
  if (fields.id.some((text) => text.includes(value))) return 'id';
  if (fields.in.some((text) => text.includes(value))) return 'in';
  if (fields.type.some((text) => text.includes(value))) return 'type';
  if (fields.other.some((text) => text.includes(value))) return 'other';
  return undefined;
}

// where an object is, as one line: its host, then its own id in that host
export function objectSearchPathGet(descriptor, hostLabel) {
  const parsed = objectRefParse(descriptor.ref);
  if (!parsed) return descriptor.ref;
  if (parsed.namespace === 'doc' || parsed.namespace === 'docDir') return parsed.local;
  if (parsed.namespace.startsWith('service.')) return `${hostLabel || parsed.namespace} › ${parsed.local}`;
  return `${hostLabel || parsed.namespace} › ${parsed.namespace}:${parsed.local}`;
}

// the words a token was found in, for highlighting: the values of the words
export function objectSearchHighlightList(tokenList) {
  return tokenList.map((token) => token.valueLower).filter(Boolean);
}

function typeTextListBuild(typeList, typeRegistry) {
  const textSet = new Set();
  for (const typeId of typeList) {
    for (const id of [typeId, ...(typeRegistry?.ancestorListGet?.(typeId) ?? [])]) {
      textSet.add(id.toLowerCase());
      const label = typeRegistry?.typeGet?.(id)?.label;
      if (label) textSet.add(label.toLowerCase());
    }
  }
  return [...textSet];
}

function textLower(value) {
  return String(value ?? '').toLowerCase();
}
