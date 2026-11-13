import { objectRefInnerBuild, objectRefInnerSplit, objectRefParse } from './doc-object-ref.js';

// Completion of a reference to an object being typed: what the slash action
// /object lists, a step at a time (comp-doc/object/object-slash.js).
// Design: doc_page_impl_obj.md#writing-a-reference, doc_page_impl_edit_cell.md
//
// the author finds an object the way the registry is organized: a type,
// then an object of it, then (when its provider lists what is inside its
// objects) something inside it. each step rewrites the parameter, so the
// text typed is always what the next step reads:
//
//   ''                           the types that have a provider         stage type
//   read                         the types whose id or label hold the words
//   example.reading-list/        the objects of the type                stage object
//   example.reading-list/sci     those whose label holds the words
//   frontend:w5j7ozoijzl         the object itself, and the top of what is inside it   stage inner
//   frontend:w5j7ozoijzl#/book/  what is inside, as its provider completes it:
//                                the registry asks the provider of the reference
//                                (innerComplete), which for a frontend object asks its type
//
// registry is the object service layer (DocObjectStore), read at once from
// what it holds: providerList, typeGet, typeLabelGet, queryStateGet,
// resolveStateGet, innerCompleteGet, providerOfRefGet. the functions are
// called inside an observer, so the lists follow the registry.
//
// an item: { id, kind, label, detail, ... }
//   kind type     { typeId }          choosing goes on in the objects of the type
//   kind object   { ref, typeList, isInner }  an object: chosen, it is written, or walked into
//   kind self     { ref }             the object being walked, to write as it is
//   kind dir      { paramNext }       a folder inside the object: choosing goes on inside it
//   kind item     { ref }             something inside the object, to write
//   kind note                         a line saying why nothing is listed (not chosen)

const OBJECT_COUNT_MAX = 60;
const OBJECT_QUERY_LIMIT = 300;
const TYPE_SEPARATOR = '/';

// the capability an object has when its provider lists what is inside it
export const OBJECT_CAPABILITY_INNER_COMPLETE = 'innerComplete';

// { stage: 'type', wordList } | { stage: 'object', typeId, wordList } | { stage: 'inner', ref, inner, isInner }
export function objectCompleteParamParse(paramInput, registry) {
  const param = String(paramInput ?? '').trimStart();
  const split = objectRefInnerSplit(param);
  const parsed = objectRefParse(split.ref);
  if (parsed && registry.providerOfRefGet(split.ref)) return { stage: 'inner', ref: split.ref, inner: split.inner, isInner: split.isInner };
  const indexSeparator = param.indexOf(TYPE_SEPARATOR);
  if (indexSeparator > 0) {
    const typeId = param.slice(0, indexSeparator).trim();
    if (registry.typeGet(typeId)) return { stage: 'object', typeId, wordList: wordListGet(param.slice(indexSeparator + 1)) };
  }
  return { stage: 'type', wordList: wordListGet(param) };
}

export function objectCompleteItemListGet(paramInput, registry) {
  const parsed = objectCompleteParamParse(paramInput, registry);
  if (parsed.stage === 'type') return typeItemListGet(parsed.wordList, registry);
  if (parsed.stage === 'object') return objectItemListGet(parsed.typeId, parsed.wordList, registry);
  return innerItemListGet(parsed, registry);
}

// what choosing an item does: { paramNext } (the parameter rewritten, the
// walk goes on), { ref } (the reference to write), or undefined (a note)
export function objectCompleteChoose(item) {
  if (!item) return undefined;
  if (item.kind === 'type') return { paramNext: `${item.typeId}${TYPE_SEPARATOR}` };
  if (item.kind === 'object') return item.isInner ? { paramNext: item.ref } : { ref: item.ref };
  if (item.kind === 'dir') return { paramNext: item.paramNext };
  if (item.kind === 'self' || item.kind === 'item') return { ref: item.ref };
  return undefined;
}

// what the parameter typed so far has reached, for the head of the menu:
// the type, the object by its name, that the walk is inside it
export function objectCompleteHintGet(paramInput, registry) {
  const parsed = objectCompleteParamParse(paramInput, registry);
  if (parsed.stage === 'type') return '';
  if (parsed.stage === 'object') return `${registry.typeLabelGet(parsed.typeId)}: choose one`;
  const descriptor = registry.resolveStateGet(parsed.ref).descriptor;
  const typeLabel = descriptor.typeList[0] ? registry.typeLabelGet(descriptor.typeList[0]) : '';
  return [typeLabel, descriptor.label, parsed.isInner ? `inside${parsed.inner ? `: ${parsed.inner}` : ''}` : ''].filter(Boolean).join(' › ');
}

// ---------- the stages ----------

// the types some ready provider says it provides, each once: those somebody
// declares (a doc page, a package, a service template: the types this
// workspace is about) before the built-in ones, each group in the order of
// the providers; narrowed by the words on its id and label
function typeItemListGet(wordList, registry) {
  const itemList = [];
  const idSet = new Set();
  for (const provider of registry.providerList ?? []) {
    if (registry.providerStatusGet?.(provider)?.status === 'unavailable') continue;
    if (!provider.capabilityList?.includes('query')) continue;
    for (const typeId of provider.typeList ?? []) {
      if (idSet.has(typeId)) continue;
      idSet.add(typeId);
      const type = registry.typeGet(typeId);
      if (!type || type.kind === 'relation') continue;
      const label = type.label || typeId;
      if (!wordListIsMatch(wordList, `${typeId} ${label}`)) continue;
      itemList.push({ id: `type:${typeId}`, kind: 'type', typeId, label, detail: typeId, icon: type.icon ?? '', isBuiltIn: (type.definedBy?.kind ?? 'builtIn') === 'builtIn' });
    }
  }
  if (itemList.length === 0) return [noteItem(wordList.length > 0 ? 'No type matches' : 'No provider lists objects')];
  return [...itemList.filter((item) => !item.isBuiltIn), ...itemList.filter((item) => item.isBuiltIn)];
}

// the objects of a type, as the registry's federated query answers them
// (asked once per type and kept by the registry; the words narrow the answer here)
function objectItemListGet(typeId, wordList, registry) {
  const entry = registry.queryStateGet({ typeList: [typeId], limit: OBJECT_QUERY_LIMIT });
  const objectList = entry.result?.objectList ?? [];
  if (objectList.length === 0 && entry.status === 'loading') return [noteItem('Asking the providers…')];
  const itemList = objectList
    .filter((descriptor) => wordListIsMatch(wordList, `${descriptor.label} ${descriptor.description} ${descriptor.ref}`))
    .slice(0, OBJECT_COUNT_MAX)
    .map((descriptor) => ({
      id: descriptor.ref,
      kind: 'object',
      ref: descriptor.ref,
      typeList: descriptor.typeList,
      label: descriptor.label,
      detail: descriptor.description || descriptor.ref,
      isInner: descriptor.capabilityList?.includes(OBJECT_CAPABILITY_INNER_COMPLETE) === true,
    }));
  if (itemList.length === 0) return [noteItem(wordList.length > 0 ? `No ${registry.typeLabelGet(typeId)} matches` : `There is no ${registry.typeLabelGet(typeId)}`)];
  return itemList;
}

// an object reached: itself first (while nothing is typed inside it), then
// what its provider lists inside it for the text typed
function innerItemListGet(parsed, registry) {
  const state = registry.resolveStateGet(parsed.ref);
  const descriptor = state.descriptor;
  const itemList = [];
  if (!parsed.isInner || parsed.inner === '') {
    if (state.status === 'loading' && descriptor.typeList.length === 0) return [noteItem('Asking for the object…')];
    if (descriptor.status !== 'found' && descriptor.status !== 'registered') return [noteItem(descriptor.message || `${parsed.ref} is ${descriptor.status}`)];
    itemList.push({ id: `self:${parsed.ref}`, kind: 'self', ref: parsed.ref, typeList: descriptor.typeList, label: descriptor.label, detail: 'the object itself' });
  }
  const complete = registry.innerCompleteGet(parsed.ref, parsed.inner);
  if (complete.status === 'loading' && complete.itemList.length === 0) itemList.push(noteItem('Reading what is inside…'));
  for (const item of complete.itemList) {
    itemList.push(item.kind === 'dir'
      ? { id: `dir:${item.text}`, kind: 'dir', label: item.label, detail: item.detail ?? '', paramNext: objectRefInnerBuild(parsed.ref, item.text) }
      : { id: `item:${item.ref}`, kind: 'item', ref: item.ref, label: item.label, detail: item.detail ?? '' });
  }
  if (itemList.length === 0) return [noteItem(complete.message || 'Nothing inside matches')];
  return itemList;
}

function noteItem(label) {
  return { id: `note:${label}`, kind: 'note', label, detail: '' };
}

function wordListGet(text) {
  return String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function wordListIsMatch(wordList, text) {
  const hay = String(text ?? '').toLowerCase();
  return wordList.every((word) => hay.includes(word));
}
