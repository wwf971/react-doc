import { rankOrderCompare } from './doc-rank.js';

// Portals: the pure part (design: doc_page_impl_portal.md). Shared by the development
// server, which reads the declarations (the type files, portal.yaml of an object), and the
// page, which builds its registry from them (DocPortalStore).
//
// A portal is one way a doc page is shown as a whole: the documents with their side panel
// (the portal every doc page has), or an app of its own drawn by a component in the whole
// window. A frontend object provides a portal by declaring it, in the type file of its type
// (every object of the type provides it) or in portal.yaml of its own folder (this object):
//
//   portalList:
//     - id: archive                 its name in its provider: letters, digits, "_" and "-"
//       label: Archive              how it is named for people
//       description: the papers of a person, filed as in an archive
//       icon: archive               a name of the page's icon set; absent: the component's own icon
//       color: "#2f6f5e"            the ground of its icon tile (a css color)
//       comp: CvPortalArchive       the component drawing it: one exposing "portal"
//       param: { density: compact } what the component starts with
//       deviceList: [browser]       what it is made for: browser, mobile, desktop (absent: any)
//       isDisabled: true            portal.yaml only: a portal of the type this object does not provide
//
// A portal is named by its provider and its name: "frontend:w5j7ozoijzl/archive", the
// portal "archive" of that object; "docPage:example/doc", the documents of the doc page
// "example". Two objects of one type providing the same portal are two portals, told apart
// by their provider.

// the placement a portal's component is rendered in (RegisteredComp)
export const PORTAL_PLACEMENT = 'portal';
// the name of the portal every doc page has: its documents
export const PORTAL_DOC_NAME = 'doc';
// the namespace of the provider of that portal: a doc page, by its alias
export const PORTAL_PROVIDER_DOC_PAGE = 'docPage';
// what a portal is made for (the stipulated words; a declaration naming another is told)
export const PORTAL_DEVICE_LIST = ['browser', 'mobile', 'desktop'];
// where the standard switcher of a portal stands: floating at its top left (drawn by the host),
// in a place of the component's own (it draws PortalSwitcher itself), or nowhere
export const PORTAL_SWITCHER_PLACE_LIST = ['floating', 'own', 'none'];
export const PORTAL_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const PORTAL_KEY_LIST = ['id', 'label', 'description', 'icon', 'color', 'comp', 'param', 'deviceList', 'isDisabled'];

function mappingIs(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ---------- ids ----------

// "frontend:w5j7ozoijzl/archive": the provider, "/", the name. a provider is a reference of
// the object registry (namespace ":" local part), which holds no "/" before its local part ends
// here: the name is what follows the last "/"
export function portalIdBuild(providerRef, name) {
  return `${providerRef}/${name}`;
}

// { providerRef, name }; both '' for a text that is no portal id
export function portalIdSplit(id) {
  const text = String(id ?? '');
  const index = text.lastIndexOf('/');
  if (index <= 0 || index === text.length - 1) return { providerRef: '', name: '' };
  const name = text.slice(index + 1);
  return PORTAL_NAME_REGEX.test(name) ? { providerRef: text.slice(0, index), name } : { providerRef: '', name: '' };
}

// the portal of the documents of a doc page
export function portalDocIdBuild(docPageAlias) {
  return portalIdBuild(`${PORTAL_PROVIDER_DOC_PAGE}:${docPageAlias}`, PORTAL_DOC_NAME);
}

// the alias of the doc page whose documents a portal id names; undefined for any other portal
export function portalDocAliasGet(id) {
  const { providerRef, name } = portalIdSplit(id);
  const prefix = `${PORTAL_PROVIDER_DOC_PAGE}:`;
  return name === PORTAL_DOC_NAME && providerRef.startsWith(prefix) ? providerRef.slice(prefix.length) : undefined;
}

// ---------- declarations ----------

// a list of portal declarations read (portalList of a type, of portal.yaml):
//   [{ id, label, description, icon, color, comp, param, deviceList, isDisabled }]
// every problem is told (problem(message)) and leaves out that portal, never the list.
//   isCompRequired   a declaration names its component (a type's); false for portal.yaml, where
//                    an entry may only adjust or switch off a portal of the object's type
export function portalDeclareListRead(value, place, problem, { isCompRequired = true } = {}) {
  if (!Array.isArray(value)) {
    problem(`${place}: a list of portals { id, label, icon, comp, param }`);
    return [];
  }
  const portalList = [];
  value.forEach((item, index) => {
    const placeOne = `${place}[${index}]`;
    if (!mappingIs(item)) {
      problem(`${placeOne}: a portal is a mapping { id, label, icon, comp, param }`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!PORTAL_KEY_LIST.includes(key)) problem(`${placeOne}: unknown key "${key}" (known: ${PORTAL_KEY_LIST.join(', ')})`);
    }
    const id = String(item.id ?? '');
    if (!PORTAL_NAME_REGEX.test(id)) {
      problem(`${placeOne}: "id" is letters, digits, "_" and "-"`);
      return;
    }
    if (id === PORTAL_DOC_NAME) {
      problem(`${placeOne}: "${PORTAL_DOC_NAME}" is the portal of the documents, which every doc page has; choose another id`);
      return;
    }
    if (portalList.some((one) => one.id === id)) {
      problem(`${placeOne}: the portal ${id} is declared twice; this one is left out`);
      return;
    }
    const comp = typeof item.comp === 'string' ? item.comp.trim() : '';
    if (isCompRequired && comp === '') {
      problem(`${placeOne}: "comp" names the component that draws the portal (a tag name or an id)`);
      return;
    }
    if (item.param !== undefined && !mappingIs(item.param)) {
      problem(`${placeOne}: "param" is a mapping`);
      return;
    }
    let deviceList;
    if (item.deviceList !== undefined) {
      if (!Array.isArray(item.deviceList) || !item.deviceList.every((one) => typeof one === 'string')) {
        problem(`${placeOne}: "deviceList" is a list of ${PORTAL_DEVICE_LIST.join(', ')}; it is left out`);
      } else {
        const unknownList = item.deviceList.filter((one) => !PORTAL_DEVICE_LIST.includes(one));
        // a word of its own is kept and told: the list is a stipulation, not a limit
        if (unknownList.length > 0) problem(`${placeOne}: "deviceList" names ${unknownList.join(', ')}, none of the stipulated ${PORTAL_DEVICE_LIST.join(', ')}; kept as written`);
        deviceList = [...new Set(item.deviceList)];
      }
    }
    portalList.push({
      id,
      ...(typeof item.label === 'string' && item.label ? { label: item.label } : {}),
      ...(typeof item.description === 'string' && item.description ? { description: item.description } : {}),
      ...(typeof item.icon === 'string' && item.icon ? { icon: item.icon } : {}),
      ...(typeof item.color === 'string' && item.color ? { color: item.color } : {}),
      ...(comp ? { comp } : {}),
      ...(item.param !== undefined ? { param: item.param } : {}),
      ...(deviceList ? { deviceList } : {}),
      ...(item.isDisabled === true ? { isDisabled: true } : {}),
    });
  });
  return portalList;
}

// the portals of a type with those of its ancestors: its own first, then each ancestor's in
// rank order; a portal id declared nearer hides the same id farther up (as modes are inherited).
//   portalListByType   { typeId: [declaration] }
//   -> [{ ...declaration, typeId }]   typeId: where it is declared
export function portalDeclareListResolve(typeId, ancestorList, portalListByType) {
  const typeIdList = [typeId, ...(ancestorList ?? []).filter((one) => one !== typeId)];
  const portalList = [];
  const idSet = new Set();
  for (const typeIdOne of typeIdList) {
    for (const portal of portalListByType[typeIdOne] ?? []) {
      if (idSet.has(portal.id)) continue;
      idSet.add(portal.id);
      portalList.push({ ...portal, typeId: typeIdOne });
    }
  }
  return portalList;
}

// the portals one object provides: those of its type, each as the object adjusts it (portal.yaml:
// a key written there wins; isDisabled leaves it out), then those only the object declares.
//   -> { portalList: [{ id, label, description, icon, color, comp, param, deviceList, typeId?, isOwn }], problemList }
// isOwn: declared by the object alone. a portal of the object naming no component is a problem
export function portalDeclareListOfObjectGet(portalListOfType, portalListOfObject) {
  const problemList = [];
  const adjustById = new Map((portalListOfObject ?? []).map((one) => [one.id, one]));
  const portalList = [];
  for (const portal of portalListOfType ?? []) {
    const adjust = adjustById.get(portal.id);
    adjustById.delete(portal.id);
    if (adjust?.isDisabled) continue;
    const { isDisabled: _isDisabled, ...adjustKept } = adjust ?? {};
    portalList.push({ ...portal, ...adjustKept, param: { ...(portal.param ?? {}), ...(adjust?.param ?? {}) }, isOwn: false });
  }
  for (const portal of adjustById.values()) {
    if (portal.isDisabled) continue;
    if (!portal.comp) {
      problemList.push(`the portal ${portal.id} names no component ("comp"), and its type declares no portal of that id; it is left out`);
      continue;
    }
    const { isDisabled: _isDisabled, ...portalKept } = portal;
    portalList.push({ ...portalKept, param: portal.param ?? {}, isOwn: true });
  }
  return { portalList, problemList };
}

// ---------- the registry ----------

// One portal of the registry:
//   { id, name, providerRef, providerKind: 'docPage' | 'objectFrontend' | 'registered', providerLabel,
//     docPageAlias, label, description, icon, color, comp, param, deviceList, isBuiltIn, rank? }
//
// the registry of the page, from everything that registers a portal:
//   docPageList     [{ alias, title }]: the doc pages that have documents, each with the portal "doc"
//   provideList     [{ providerRef, providerKind, providerLabel, docPageAlias, portalList }]: what the
//                   frontend objects provide (portalDeclareListOfObjectGet of each)
//   registeredList  portals registered by code (a host): whole portals
//   hiddenIdList    ids left out (PortalHiddenList); rankById: ranks by id (PortalRankById)
// -> portals in order: by doc page (the order of docPageAliasList), in a doc page the documents
//    first, then by rank, then as provided. a portal whose doc page is not listed comes last
export function portalListBuild({ docPageList = [], provideList = [], registeredList = [], hiddenIdList = [], rankById = {}, docPageAliasList = undefined } = {}) {
  const portalList = [];
  const idSet = new Set();
  const add = (portal) => {
    if (idSet.has(portal.id)) return;
    idSet.add(portal.id);
    portalList.push(portal);
  };
  for (const docPage of docPageList) {
    add({
      id: portalDocIdBuild(docPage.alias),
      name: PORTAL_DOC_NAME,
      providerRef: `${PORTAL_PROVIDER_DOC_PAGE}:${docPage.alias}`,
      providerKind: 'docPage',
      providerLabel: docPage.title || docPage.alias,
      docPageAlias: docPage.alias,
      label: 'Documents',
      description: 'the documents of the doc page, with its side panel',
      icon: 'book-open',
      color: '',
      comp: '',
      param: {},
      deviceList: [],
      isBuiltIn: true,
    });
  }
  for (const provide of provideList) {
    for (const portal of provide.portalList ?? []) {
      add({
        id: portalIdBuild(provide.providerRef, portal.id),
        name: portal.id,
        providerRef: provide.providerRef,
        providerKind: provide.providerKind ?? 'objectFrontend',
        providerLabel: provide.providerLabel ?? provide.providerRef,
        docPageAlias: provide.docPageAlias ?? '',
        label: portal.label || portal.id,
        description: portal.description ?? '',
        icon: portal.icon ?? '',
        color: portal.color ?? '',
        comp: portal.comp ?? '',
        param: portal.param ?? {},
        deviceList: portal.deviceList ?? [],
        isBuiltIn: false,
        ...(portal.typeId ? { typeId: portal.typeId } : {}),
      });
    }
  }
  for (const portal of registeredList) {
    if (portal?.id && portalIdSplit(portal.id).name) add({ description: '', icon: '', color: '', comp: '', param: {}, deviceList: [], docPageAlias: '', isBuiltIn: false, providerKind: 'registered', providerLabel: '', label: portal.id, ...portal, ...portalIdSplit(portal.id) });
  }
  const hiddenSet = new Set(hiddenIdList);
  const aliasOrder = docPageAliasList ?? docPageList.map((one) => one.alias);
  const groupIndexGet = (portal) => {
    const index = aliasOrder.indexOf(portal.docPageAlias);
    return index < 0 ? aliasOrder.length : index;
  };
  return portalList
    .filter((portal) => !hiddenSet.has(portal.id))
    .map((portal, index) => ({ portal: { ...portal, ...(typeof rankById[portal.id] === 'string' ? { rank: rankById[portal.id] } : {}) }, index }))
    .sort((a, b) => groupIndexGet(a.portal) - groupIndexGet(b.portal)
      || Number(b.portal.isBuiltIn) - Number(a.portal.isBuiltIn)
      || rankOrderCompare(a.portal.rank, b.portal.rank)
      || a.index - b.index)
    .map((one) => one.portal);
}

// the portals as the switcher lists them: a group per doc page, in the order of the portals,
// each portal with what tells it from another of its label in its group (labelDetail: its
// provider, said only where two share a label):
//   [{ docPageAlias, title, portalList: [{ ...portal, labelDetail }] }]
export function portalGroupListBuild(portalList, titleByAlias = {}) {
  const groupList = [];
  const groupByAlias = new Map();
  for (const portal of portalList) {
    let group = groupByAlias.get(portal.docPageAlias);
    if (!group) {
      group = { docPageAlias: portal.docPageAlias, title: titleByAlias[portal.docPageAlias] || portal.docPageAlias || 'Other', portalList: [] };
      groupByAlias.set(portal.docPageAlias, group);
      groupList.push(group);
    }
    group.portalList.push(portal);
  }
  for (const group of groupList) {
    const countByLabel = new Map();
    for (const portal of group.portalList) countByLabel.set(portal.label, (countByLabel.get(portal.label) ?? 0) + 1);
    group.portalList = group.portalList.map((portal) => ({ ...portal, labelDetail: countByLabel.get(portal.label) > 1 && !portal.isBuiltIn ? portal.providerLabel : '' }));
  }
  return groupList;
}

// the portals whose name holds every word typed (label, description, provider, doc page), in
// their order; every portal for no word
export function portalSearch(portalList, text, titleByAlias = {}) {
  const wordList = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (wordList.length === 0) return portalList;
  return portalList.filter((portal) => {
    const hay = `${portal.label} ${portal.description} ${portal.providerLabel} ${titleByAlias[portal.docPageAlias] ?? ''} ${portal.docPageAlias} ${portal.name}`.toLowerCase();
    return wordList.every((word) => hay.includes(word));
  });
}

// ---------- the location ----------

// the portal a location names, and the place inside it:
//   ?portal=frontend:w5j7ozoijzl/archive&at=/example/cv/general
// (search: the query string of the browser). portalId '' when it names none: the documents
export const PORTAL_PARAM_ID = 'portal';
export const PORTAL_PARAM_AT = 'at';

export function portalLocationRead(search) {
  const param = new URLSearchParams(String(search ?? ''));
  const portalId = param.get(PORTAL_PARAM_ID) ?? '';
  return { portalId: portalIdSplit(portalId).name ? portalId : '', at: param.get(PORTAL_PARAM_AT) ?? '' };
}

// a query string with a portal and the place inside it set, the other parameters kept; the
// documents (portalId ''): both taken out. "doc", the route of the documents, is taken out
// while a portal of its own is shown: a link to it opens that portal, not a document behind it
export function portalLocationSearchBuild(search, portalId, at = '') {
  const param = new URLSearchParams(String(search ?? ''));
  param.delete(PORTAL_PARAM_ID);
  param.delete(PORTAL_PARAM_AT);
  if (portalId) {
    param.delete('doc');
    param.set(PORTAL_PARAM_ID, portalId);
    if (at) param.set(PORTAL_PARAM_AT, at);
  }
  const text = param.toString();
  return text ? `?${text}` : '';
}

// what a device is, by the stipulated words, from what the page can tell: a narrow or touch-first
// window is a phone, a page inside a desktop shell (Electron) a desktop app, anything else a browser
export function portalDeviceGet({ width = 1024, isTouch = false, userAgent = '' } = {}) {
  if (/electron/i.test(userAgent)) return 'desktop';
  if (width < 640 || (isTouch && width < 900)) return 'mobile';
  return 'browser';
}

// whether a portal is made for a device: one naming none is made for any
export function portalDeviceIsFit(portal, device) {
  return !portal.deviceList || portal.deviceList.length === 0 || portal.deviceList.includes(device);
}
