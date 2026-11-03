// Object references and the shapes of the object registry (design:
// doc_page_impl_obj.md). Pure functions, shared by the page's registry
// (DocObjectStore), its providers and the components that draw objects.
//
//   reference    {namespace}:{local}. the namespace names the provider that
//                is authoritative for the object; the local part is the
//                provider's own (a source path and a fragment for doc, an
//                id for the backend). the registry never reads the local part
//   descriptor   what the registry knows of an object, a JSON object:
//                { ref, typeList, label, description, summary, iconUrl,
//                  capabilityList, open, status, timeChecked, provider,
//                  message? }. it is never the object's content: content is
//                read from the provider (read)
//   relation     { key, type, fromRef, toRef, order, label, data, provider,
//                  status }: key is the entry, unique for its provider, so
//                one object can be a member twice

const REF_REGEX = /^([a-zA-Z][a-zA-Z0-9.-]*):(.+)$/;

// the contexts an object is drawn in (doc_page_impl_obj.md#object-views):
// icon     a glyph and a label, the size of a word: lists, chips, a compact node
// inline   in a line of text
// card     a box of its own, bounded: a list of cards, a group, a node of a diagram
// block    the width of a document: the object shown whole
export const OBJECT_VIEW_CONTEXT_LIST = ['icon', 'inline', 'card', 'block'];

// found: a provider answered with it (at timeChecked). registered: someone
// registered it, nobody verified it. missing: its provider says it does not
// exist. unavailable: its provider could not be asked (what is shown is
// what was known before, if anything). unknown: no provider of its
// namespace. loading: asked, not answered yet (the page's own status)
export const OBJECT_STATUS_LIST = ['found', 'registered', 'missing', 'unavailable', 'unknown', 'loading'];

export const OBJECT_CAPABILITY_LIST = ['query', 'resolve', 'read', 'update', 'relationQuery'];

// { namespace, local } of a reference; undefined for anything else
export function objectRefParse(ref) {
  const match = REF_REGEX.exec(String(ref ?? ''));
  return match ? { namespace: match[1], local: match[2] } : undefined;
}

export function objectRefBuild(namespace, local) {
  return `${namespace}:${local}`;
}

export function objectRefIsValid(ref) {
  return objectRefParse(ref) !== undefined;
}

// a descriptor with every key, from what a provider gave; the registry adds
// status, timeChecked and provider
export function objectDescriptorNormalize(item, provider, status = 'found', timeChecked = Date.now()) {
  return {
    ref: String(item.ref),
    typeList: Array.isArray(item.typeList) && item.typeList.length > 0 ? item.typeList.map(String) : ['core.object'],
    label: String(item.label || item.ref),
    description: String(item.description ?? ''),
    summary: item.summary && typeof item.summary === 'object' ? item.summary : {},
    iconUrl: String(item.iconUrl ?? ''),
    capabilityList: Array.isArray(item.capabilityList) ? item.capabilityList.map(String) : [],
    open: item.open && typeof item.open === 'object' ? item.open : null,
    status: item.status ?? status,
    timeChecked: item.timeChecked ?? timeChecked,
    provider: item.provider ?? (provider ? { id: provider.id, label: provider.label, registry: provider.registry ?? 'page' } : null),
    ...(item.message ? { message: String(item.message) } : {}),
  };
}

// what the page draws for a reference nobody answered for yet, or at all
export function objectDescriptorPlaceholder(ref, status, message = '') {
  return {
    ref: String(ref ?? ''),
    typeList: [],
    label: String(ref ?? ''),
    description: '',
    summary: {},
    iconUrl: '',
    capabilityList: [],
    open: null,
    status,
    timeChecked: null,
    provider: null,
    ...(message ? { message } : {}),
  };
}

export function relationNormalize(item, provider, status = 'found') {
  return {
    key: String(item.key),
    type: String(item.type),
    fromRef: String(item.fromRef),
    toRef: String(item.toRef),
    order: typeof item.order === 'number' ? item.order : null,
    label: String(item.label ?? ''),
    data: item.data && typeof item.data === 'object' ? item.data : {},
    provider: item.provider ?? (provider ? { id: provider.id, label: provider.label, registry: provider.registry ?? 'page' } : null),
    status: item.status ?? status,
  };
}

// the order of relations: by where they start, then their order, then their key
export function relationCompare(a, b) {
  return a.fromRef.localeCompare(b.fromRef)
    || (a.order ?? 0) - (b.order ?? 0)
    || a.key.localeCompare(b.key);
}

// whether a descriptor's text matches a search text (label, description, reference)
export function objectTextIsMatch(descriptor, text) {
  const needle = String(text ?? '').trim().toLowerCase();
  if (!needle) return true;
  return descriptor.label.toLowerCase().includes(needle)
    || descriptor.description.toLowerCase().includes(needle)
    || descriptor.ref.toLowerCase().includes(needle);
}

// the key of a request, for the caches: the same request, the same key
export function objectRequestKeyBuild(spec) {
  return JSON.stringify(valueSorted(spec));
}

// the value with the keys of every object sorted, so two equal requests
// written in another key order have one key
function valueSorted(value) {
  if (Array.isArray(value)) return value.map(valueSorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, valueSorted(value[key])]));
}
