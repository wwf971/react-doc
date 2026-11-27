import { FileCode } from '../../frontend/UICommon.js';
import { apiDefine, apiDefinitionIs } from '../../frontend/src/lib/doc-api.js';
import { compIconDefault } from './comp-icon.jsx';
import { OBJECT_VIEW_CONTEXT_DEFAULT_LIST, OBJECT_VIEW_CONTEXT_LIST } from '../../frontend/src/lib/doc-object-ref.js';
import { PORTAL_DEVICE_LIST, PORTAL_SWITCHER_PLACE_LIST } from '../../frontend/src/lib/doc-portal.js';

// What a component exposes about itself through its registry definition
// (doc_page_impl_mdx_comp.md#what-a-component-exposes): the `expose` option
// of compDefine(). A few names are standard and normalized here, so that
// the page can rely on their shape; every other name is kept as written,
// for things a host or a later feature reads (compExposeGet).
//
//   meta           Object: facts about the component. isReadOnly (nothing of
//                  it can be edited from the page), isEditSourceAccepted
//                  (the built-in source edit mode is offered; default true),
//                  isInsertCommon (listed directly in the insert menu, not
//                  only found through its search; default false),
//                  isEditEnterButtonOnly (a block of it enters edit mode only
//                  through an explicit control, the toolbar's Edit button or
//                  the mode menu, never by a click on the block or a focus
//                  shift, whatever EditBlockEnterMode is; default false),
//                  isAssetOnly (its data lives in the asset service layer only and is
//                  never written inline in a document; default false),
//                  isEditAssetAccepted (its own edit modes also edit the data
//                  of a block that is an asset reference, as an asset draft,
//                  where otherwise only the source mode is offered for it;
//                  inline data is edited as usual; default false),
//                  isNotInDoc (it cannot be placed in a document: it renders
//                  elsewhere, e.g. in the side panel; default false),
//                  isEditSlashEnabled (its blocks offer the slash mode in
//                  the default edit mode, the source surface: "/" opens the
//                  menu of slash actions, doc_page_impl_edit_slash.md;
//                  default false. the default editors of paragraphs and
//                  lists declare it),
//                  assetSaveMode (inPlace | newVersion: the save mode written
//                  into an asset item the page creates for a block of the
//                  component; absent: the store's default applies),
//                  insertObjectPick ({ typeList, isCreateOffered }: the insert
//                  menu asks for an object of these types first, a search of the
//                  object registry, and the factory gets it as env.objectRef;
//                  doc_page_impl_edit.md#creating-a-block-naming-an-object),
//                  configDefineList (the shape of its component-level config,
//                  doc_page_impl_config.md#component-level-config), label,
//                  description, and any further key the component adds
//   icon           a component drawing the component's icon in any size
//                  (comp-icon.jsx: the drawing keeps the largest square);
//                  without one, the page draws compIconDefault
//   viewModeList   [{ id, label, description, icon, isDefault }] the ways the
//                  component can display its data; the one with isDefault
//                  (else the first) is what a block shows until a reader
//                  picks another
//   editModeList   the same shape, the ways its data can be edited in place; a
//                  mode may add isInPlace: an owner may keep it open in place
//                  (config.edit.isInPlace: a card of a card diagram holding it).
//                  the built-in mode 'source' (the lines of the block) is
//                  added by compEditModeListGet unless meta says otherwise,
//                  so a component never declares it
//   sourceDefaultCreate(env)
//                  the factory of the source of a new block of this
//                  component, called by the insert menu when it is about to
//                  offer the component (compSourceDefaultGet). env tells
//                  where the block goes; a factory may ignore it:
//                    { compName  the tag name the block is written with,
//                      docPath   source path of the document,
//                      docFormat 'md' | 'mdx',
//                      compConfig the component-level config of the document }
//                  it returns one of
//                    { lang, raw, props }  the comment-block form:
//                        <!--renderComp=compName,props--> and a fenced block
//                        in lang (default yaml) holding raw, in .md and .mdx
//                        documents alike. DO NOT replace this marker by
//                        `{/* ... */}` or any other comment syntax, for any
//                        document format: it is the authoring form of the
//                        project and it works (see edit-template.js)
//                    { text }  the block exactly as written (an MDX element)
//                    undefined the component starts no block there (an
//                        mdx-only component in an md document)
//                  a component without it cannot be inserted from the menu
//   apiList        [apiDefine({ name, label, description, paramList, run,
//                  isAvailable, palette })]: the apis the component offers
//                  the unified api registry (doc_page_impl_api.md#the-apis-of-a-component),
//                  registered as {compId}/{name} while the component is in
//                  the registry; run(context, params) receives
//                  context.comp = { compId, definition }. plain option
//                  objects are accepted and defined here
//   objectView     { typeList, contextList, priority }: the component draws
//                  objects of these types (and their subtypes) in these
//                  contexts (icon, inline, card, block, panel; all but panel when absent), for the object
//                  registry (doc_page_impl_obj.md#object-views). it renders in
//                  the placement objectView with data { ref, descriptor }
//                  and config.objectView { context, isEditAllowed,
//                  editUnavailableReason }; priority orders two views of
//                  the same type (default 0)
//   objectInner    { typeList, resolve?({ service, path }), complete?({ service, text }) }:
//                  the component answers for the inner paths of the frontend
//                  objects of these types (and their subtypes), for a type
//                  whose inner paths are not the paths of its assets
//                  (doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths):
//                  resolve says what an inner path names ({ status, path,
//                  label, detail, kind, text?, typeId? }), complete lists the
//                  candidates completing a typed one ([{ kind: 'dir' | 'item',
//                  path, label, detail }]). service is the api of a mode
//                  (config.objectFrontend) of the object asked about
//   blockLabelGet(component, context)
//                  what a block of the component is called where the page names a block
//                  (its toolbar and its editor bar in edit mode, the lists of blocks
//                  moved or pasted): a text, or { text, title } (title: said on hover).
//                  component is the block as written ({ compName, lang, raw, props }),
//                  context { stores } (the page's stores: the label is read by an
//                  observer, so it follows what it reads). absent, or answering
//                  nothing, the tag name. ObjectFrontend names the type of its object
//   portal         true, or { deviceList?, switcherPlace? }: the component can draw a portal, a
//                  whole-window app of a frontend object (doc_page_impl_portal.md#the-component-of-a-portal).
//                  it renders in the placement portal with data { ref, portalId, param } and
//                  config.portal (the portal, its place, the others, its reading or editing state)
//                  and config.objectFrontend (the api of the object providing it). deviceList:
//                  what it is made for (browser, mobile, desktop); switcherPlace: where the standard
//                  switcher stands: 'floating' (default, drawn by the host), 'own', 'none'
//   pagination     { pieceListGet(data, context) -> [{ type, data }],
//                  pieceTypeById: { [type]: { Render, split?, isFilledOnSplit? } },
//                  pageClassName?, pageSpec? }: the component's data can be laid
//                  out on pages (doc_page_impl_pagination.md#the-contract): the
//                  flow its data makes, the pieces of it, drawn by Render({ data,
//                  layout }) and cut by split(data, { space, measured, isPageTop })
//                  -> { head, tail, breakKey } | null. a pagination environment
//                  (PageFlow) measures and places them

export const COMP_EDIT_MODE_SOURCE_ID = 'source';

// the built-in edit mode every editable block has: its source lines
export const compEditModeSource = Object.freeze({
  id: COMP_EDIT_MODE_SOURCE_ID,
  label: 'Source',
  description: 'the lines of the block as written',
  icon: FileCode,
  isBuiltin: true,
  isDefault: false,
});

const metaDefault = Object.freeze({
  label: undefined,
  description: '',
  isReadOnly: false,
  isEditSourceAccepted: true,
  isInsertCommon: false,
  isEditEnterButtonOnly: false,
  isAssetOnly: false,
  isEditAssetAccepted: false,
  isNotInDoc: false,
  isEditSlashEnabled: false,
  assetSaveMode: undefined,
  configDefineList: [],
  slashName: undefined,
  slashAliasList: [],
  isNotInNode: false,
});

// a name typed after "/" (doc_page_impl_edit_slash.md): one word of letters, digits, "_" and "-"
const SLASH_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;

const ASSET_SAVE_MODE_LIST = ['inPlace', 'newVersion'];

// the placements of a block written in a document by its author; a
// component declared isNotInDoc is refused there, a component declared
// isAssetOnly renders there only with data from the asset service layer
export const COMP_PLACEMENT_DOC_LIST = ['mdx', 'commentBlock'];

export const compExposeNameStandardList = ['meta', 'icon', 'viewModeList', 'editModeList', 'sourceDefaultCreate', 'apiList', 'objectView', 'objectInner', 'pagination', 'portal', 'blockLabelGet', 'hold'];

const REGEX_TYPE_ID = /^[a-z][a-z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*)+$/;

// the normalized `expose` of a definition; throws on a shape the page
// cannot work with, so a wrong declaration fails at registration
export function compExposeNormalize(expose = {}) {
  if (!expose || typeof expose !== 'object' || Array.isArray(expose)) {
    throw new Error('compDefine: expose must be an object.');
  }
  // the former static template; refused so that it is not kept silently as
  // a non-standard name while the component disappears from the insert menu
  if (expose.editTemplate !== undefined) {
    throw new Error('compDefine: expose.editTemplate is expose.sourceDefaultCreate(env) now (comp-expose.js).');
  }
  const { meta, icon, viewModeList, editModeList, sourceDefaultCreate, apiList, objectView, objectInner, pagination, portal, blockLabelGet, hold, ...exposeOther } = expose;
  if (blockLabelGet !== undefined && typeof blockLabelGet !== 'function') throw new Error('compDefine: expose.blockLabelGet(component, context) must be a function.');
  return {
    ...exposeOther,
    meta: metaNormalize(meta),
    icon: iconNormalize(icon, 'expose.icon'),
    viewModeList: modeListNormalize(viewModeList, 'expose.viewModeList', []),
    editModeList: modeListNormalize(editModeList, 'expose.editModeList', [COMP_EDIT_MODE_SOURCE_ID]),
    sourceDefaultCreate: sourceDefaultCreateNormalize(sourceDefaultCreate),
    apiList: apiListNormalize(apiList),
    objectView: objectViewNormalize(objectView),
    objectInner: objectInnerNormalize(objectInner),
    pagination: paginationNormalize(pagination),
    portal: portalNormalize(portal),
    blockLabelGet,
    hold: holdNormalize(hold),
  };
}

// expose.hold: the component holds blocks of other components in its data (a timetable holding
// meetings: doc_page_impl_mdx_comp.md#a-component-holding-others). A block is what a block of a
// document holds, { comp, lang, raw, props? }; data is the holder's, as dataFields reads it,
// { raw, lang, ...props }. Every function is pure:
//   heldListGet(data)               [{ key, block }]: what it holds, the key stable while its data is
//   takeCheck(data, block, context) why it cannot take the block, '' when it can
//   take(data, block, context)      { raw, props? }: its data with the block in it
//   letGo(data, key)                { raw, props?, block }: its data without the held block of that
//                                   key, and the block; optional (a holder that keeps what it takes)
// context: { compDefinitionGet(compName) -> the definition of a component by its name (to read what
// the block exposes, its time), point?: { x, y } where it was dropped, 0 to 1 across the holder }
function holdNormalize(hold) {
  if (hold === undefined) return undefined;
  if (!hold || typeof hold !== 'object' || Array.isArray(hold)) throw new Error('compDefine: expose.hold must be { heldListGet, takeCheck, take, letGo? }.');
  for (const name of ['heldListGet', 'takeCheck', 'take']) {
    if (typeof hold[name] !== 'function') throw new Error(`compDefine: expose.hold.${name} must be a function.`);
  }
  if (hold.letGo !== undefined && typeof hold.letGo !== 'function') throw new Error('compDefine: expose.hold.letGo must be a function.');
  return { heldListGet: hold.heldListGet, takeCheck: hold.takeCheck, take: hold.take, ...(hold.letGo ? { letGo: hold.letGo } : {}) };
}

// what a component calls a block of its own (expose.blockLabelGet): { text, title }, or null
// when it says nothing (no function, an empty answer, or a function that failed)
export function compBlockLabelGet(definition, component, context) {
  const labelGet = definition?.expose?.blockLabelGet;
  if (typeof labelGet !== 'function') return null;
  try {
    const result = labelGet(component, context);
    if (!result) return null;
    const label = typeof result === 'string' ? { text: result, title: '' } : { text: String(result.text ?? ''), title: String(result.title ?? '') };
    return label.text ? label : null;
  } catch {
    return null;
  }
}

// what makes a component one that can draw a portal (doc_page_impl_portal.md#the-component-of-a-portal):
// checked here; undefined for a component that draws none. true is every default
//   deviceList      what it is made for, of browser | mobile | desktop (the stipulated words; none: any)
//   switcherPlace   where the standard switcher stands while it is shown: 'floating' (default: the
//                   host draws it at the top left, over the portal), 'own' (the component draws
//                   PortalSwitcher in a place of its own), 'none'
function portalNormalize(portal) {
  if (portal === undefined || portal === false) return undefined;
  if (portal === true) return { deviceList: [], switcherPlace: 'floating' };
  if (!portal || typeof portal !== 'object' || Array.isArray(portal)) {
    throw new Error('compDefine: expose.portal must be true, or { deviceList?, switcherPlace? }.');
  }
  const { deviceList = [], switcherPlace = 'floating', ...portalOther } = portal;
  if (!Array.isArray(deviceList) || !deviceList.every((device) => typeof device === 'string')) {
    throw new Error(`compDefine: expose.portal.deviceList must list devices (${PORTAL_DEVICE_LIST.join(', ')}).`);
  }
  if (!PORTAL_SWITCHER_PLACE_LIST.includes(switcherPlace)) {
    throw new Error(`compDefine: expose.portal.switcherPlace must be one of ${PORTAL_SWITCHER_PLACE_LIST.join(', ')}.`);
  }
  return { ...portalOther, deviceList: [...deviceList], switcherPlace };
}

// what a component says of itself as the component of a portal, undefined for one that draws none
export function compPortalGet(definition) {
  return definition?.expose?.portal;
}

// what the component tells a pagination environment (doc_page_impl_pagination.md#the-contract):
// checked here, so that a component missing a part fails when it is defined, not while a
// page is laid out; undefined for a component that is not paginated
function paginationNormalize(pagination) {
  if (pagination === undefined) return undefined;
  const isFunction = (value) => typeof value === 'function';
  if (!pagination || typeof pagination !== 'object' || Array.isArray(pagination)) {
    throw new Error('compDefine: expose.pagination must be { pieceListGet, pieceTypeById, pageClassName?, pageSpec? }.');
  }
  const { pieceListGet, pieceTypeById, pageClassName = '', pageSpec } = pagination;
  if (!isFunction(pieceListGet)) throw new Error('compDefine: expose.pagination.pieceListGet(data, context) must be a function.');
  if (!pieceTypeById || typeof pieceTypeById !== 'object' || Object.keys(pieceTypeById).length === 0) {
    throw new Error('compDefine: expose.pagination.pieceTypeById must name the types of its pieces.');
  }
  for (const [type, pieceType] of Object.entries(pieceTypeById)) {
    if (!pieceType?.Render) throw new Error(`compDefine: expose.pagination.pieceTypeById.${type} needs a Render.`);
    if (pieceType.split !== undefined && !isFunction(pieceType.split)) throw new Error(`compDefine: expose.pagination.pieceTypeById.${type}.split must be a function.`);
  }
  if (typeof pageClassName !== 'string') throw new Error('compDefine: expose.pagination.pageClassName must be a class name.');
  return { ...pagination, pieceListGet, pieceTypeById, pageClassName, pageSpec };
}

// the pagination of a component, undefined when it has none
export function compPaginationGet(definition) {
  return definition?.expose?.pagination;
}

// what the component draws as an object view: the types, the contexts, the
// priority; undefined for a component that draws no object
function objectViewNormalize(objectView) {
  if (objectView === undefined) return undefined;
  if (!objectView || typeof objectView !== 'object' || Array.isArray(objectView)) {
    throw new Error('compDefine: expose.objectView must be { typeList, contextList, priority? }.');
  }
  const { typeList, contextList = OBJECT_VIEW_CONTEXT_DEFAULT_LIST, priority = 0 } = objectView;
  if (!Array.isArray(typeList) || typeList.length === 0 || !typeList.every((typeId) => REGEX_TYPE_ID.test(String(typeId)))) {
    throw new Error('compDefine: expose.objectView.typeList must list type ids (core.object, doc.document).');
  }
  if (!Array.isArray(contextList) || contextList.length === 0 || !contextList.every((context) => OBJECT_VIEW_CONTEXT_LIST.includes(context))) {
    throw new Error(`compDefine: expose.objectView.contextList must list some of ${OBJECT_VIEW_CONTEXT_LIST.join(', ')}.`);
  }
  if (typeof priority !== 'number') throw new Error('compDefine: expose.objectView.priority must be a number.');
  return { typeList: [...typeList], contextList: [...contextList], priority };
}

// what the component answers of the inner paths of frontend objects: the
// types, and the two questions (either may be left to the layer, which then
// reads the paths of the assets); undefined for a component answering none
function objectInnerNormalize(objectInner) {
  if (objectInner === undefined) return undefined;
  if (!objectInner || typeof objectInner !== 'object' || Array.isArray(objectInner)) {
    throw new Error('compDefine: expose.objectInner must be { typeList, resolve?, complete? }.');
  }
  const { typeList, resolve, complete } = objectInner;
  if (!Array.isArray(typeList) || typeList.length === 0 || !typeList.every((typeId) => REGEX_TYPE_ID.test(String(typeId)))) {
    throw new Error('compDefine: expose.objectInner.typeList must list type ids of frontend objects (cv.profile).');
  }
  if (resolve !== undefined && typeof resolve !== 'function') throw new Error('compDefine: expose.objectInner.resolve({ service, path }) must be a function.');
  if (complete !== undefined && typeof complete !== 'function') throw new Error('compDefine: expose.objectInner.complete({ service, text }) must be a function.');
  if (!resolve && !complete) throw new Error('compDefine: expose.objectInner needs resolve or complete.');
  return { typeList: [...typeList], resolve, complete };
}

// the apis a component exposes: definitions made with apiDefine, or the
// options of one; every one needs a name, unique in the list
function apiListNormalize(apiList) {
  if (apiList === undefined) return [];
  if (!Array.isArray(apiList)) throw new Error('compDefine: expose.apiList must be an array.');
  const nameSet = new Set();
  return apiList.map((item, index) => {
    const api = apiDefinitionIs(item) ? item : apiDefine(item);
    if (api.name === '') throw new Error(`compDefine: expose.apiList[${index}] needs a name.`);
    if (nameSet.has(api.name)) throw new Error(`compDefine: expose.apiList declares '${api.name}' twice.`);
    nameSet.add(api.name);
    return api;
  });
}

function metaNormalize(meta) {
  if (meta === undefined) return { ...metaDefault };
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('compDefine: expose.meta must be an object.');
  }
  if (meta.configDefineList !== undefined && !Array.isArray(meta.configDefineList)) {
    throw new Error('compDefine: expose.meta.configDefineList must be an array.');
  }
  if (meta.assetSaveMode !== undefined && !ASSET_SAVE_MODE_LIST.includes(meta.assetSaveMode)) {
    throw new Error(`compDefine: expose.meta.assetSaveMode must be one of ${ASSET_SAVE_MODE_LIST.join(', ')}.`);
  }
  const group = meta.configPackage;
  if (group !== undefined && (!group || typeof group !== 'object' || !/^[a-z][a-z0-9-]*$/.test(String(group.name ?? '')) || !Array.isArray(group.configDefineList))) {
    throw new Error('compDefine: expose.meta.configPackage must be { name, label?, description?, configDefineList }, name the name of the package (doc_page_impl_config.md#package-level-config).');
  }
  if (meta.slashAliasList !== undefined && !Array.isArray(meta.slashAliasList)) {
    throw new Error('compDefine: expose.meta.slashAliasList must be an array.');
  }
  for (const name of [meta.slashName, ...(meta.slashAliasList ?? [])]) {
    if (name !== undefined && !SLASH_NAME_REGEX.test(String(name))) {
      throw new Error(`compDefine: expose.meta.slashName and slashAliasList are words typed after "/": letters, digits, "_" and "-" (got ${JSON.stringify(name)}).`);
    }
  }
  const pick = meta.insertObjectPick;
  if (pick !== undefined && (!pick || typeof pick !== 'object' || !Array.isArray(pick.typeList) || pick.typeList.length === 0)) {
    throw new Error('compDefine: expose.meta.insertObjectPick must be { typeList: [type id, ...], isCreateOffered? }.');
  }
  return {
    ...metaDefault,
    ...meta,
    isReadOnly: meta.isReadOnly === true,
    isEditSourceAccepted: meta.isEditSourceAccepted !== false,
    isInsertCommon: meta.isInsertCommon === true,
    isEditEnterButtonOnly: meta.isEditEnterButtonOnly === true,
    isAssetOnly: meta.isAssetOnly === true,
    isEditAssetAccepted: meta.isEditAssetAccepted === true,
    isNotInDoc: meta.isNotInDoc === true,
    isEditSlashEnabled: meta.isEditSlashEnabled === true,
    assetSaveMode: meta.assetSaveMode,
    configDefineList: meta.configDefineList ?? [],
    insertObjectPick: pick ? { typeList: pick.typeList.map(String), isCreateOffered: pick.isCreateOffered === true } : undefined,
    slashName: meta.slashName === undefined ? undefined : String(meta.slashName),
    slashAliasList: (meta.slashAliasList ?? []).map(String),
    isNotInNode: meta.isNotInNode === true,
  };
}

function iconNormalize(icon, place) {
  if (icon === undefined) return undefined;
  if (typeof icon !== 'function' && !(icon && typeof icon === 'object' && icon.$$typeof)) {
    throw new Error(`compDefine: ${place} must be a component.`);
  }
  return icon;
}

// a mode list: ids are strings, unique, not reserved; exactly one default
// (the declared one, else the first)
function modeListNormalize(modeList, place, idReservedList) {
  if (modeList === undefined) return [];
  if (!Array.isArray(modeList)) throw new Error(`compDefine: ${place} must be an array.`);
  const idSet = new Set();
  const modeListNormalized = modeList.map((mode, index) => {
    if (!mode || typeof mode !== 'object' || typeof mode.id !== 'string' || mode.id === '') {
      throw new Error(`compDefine: ${place}[${index}] needs a string id.`);
    }
    if (idReservedList.includes(mode.id)) {
      throw new Error(`compDefine: ${place} must not declare the built-in mode '${mode.id}'.`);
    }
    if (idSet.has(mode.id)) throw new Error(`compDefine: ${place} declares '${mode.id}' twice.`);
    idSet.add(mode.id);
    return {
      id: mode.id,
      label: typeof mode.label === 'string' && mode.label !== '' ? mode.label : mode.id,
      description: typeof mode.description === 'string' ? mode.description : '',
      icon: iconNormalize(mode.icon, `${place}[${index}].icon`),
      isBuiltin: false,
      isDefault: mode.isDefault === true,
      // an edit mode an owner may keep open in place while its document is edited (config.edit.isInPlace:
      // doc_page_impl_edit.md#component-edit-mode); kept for edit modes, meaningless for view modes
      ...(mode.isInPlace === true ? { isInPlace: true } : {}),
    };
  });
  const indexDefault = modeListNormalized.findIndex((mode) => mode.isDefault);
  if (modeListNormalized.filter((mode) => mode.isDefault).length > 1) {
    throw new Error(`compDefine: ${place} marks more than one mode as default.`);
  }
  return modeListNormalized.map((mode, index) => ({
    ...mode,
    isDefault: indexDefault === -1 ? index === 0 : mode.isDefault,
  }));
}

function sourceDefaultCreateNormalize(sourceDefaultCreate) {
  if (sourceDefaultCreate === undefined) return undefined;
  if (typeof sourceDefaultCreate !== 'function') {
    throw new Error('compDefine: expose.sourceDefaultCreate must be a function (env) => { lang, raw, props } | { text } | undefined.');
  }
  return sourceDefaultCreate;
}

// what a factory returned, in one of its two forms; undefined for nothing.
// a wrong shape is the component's error and is thrown with its name
function sourceDefaultResultNormalize(result, compName) {
  if (result === undefined || result === null) return undefined;
  const place = `sourceDefaultCreate of ${compName}`;
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`${place} must return an object or undefined.`);
  }
  if (result.text !== undefined) {
    if (typeof result.text !== 'string') throw new Error(`${place}: text must be a string.`);
    return { text: result.text };
  }
  if (result.lang !== undefined && typeof result.lang !== 'string') throw new Error(`${place}: lang must be a string.`);
  if (result.raw !== undefined && typeof result.raw !== 'string') throw new Error(`${place}: raw must be a string.`);
  if (result.props !== undefined && (!result.props || typeof result.props !== 'object' || Array.isArray(result.props))) {
    throw new Error(`${place}: props must be an object.`);
  }
  return { lang: result.lang ?? 'yaml', raw: result.raw ?? '', props: result.props ?? {} };
}

// ---------- reading what a definition exposes ----------

// one exposed thing by name: a standard one in its normalized shape, or a
// non-standard one as declared; undefined when the component does not
// expose it (a legacy definition exposes nothing)
export function compExposeGet(definition, name) {
  return definition?.expose?.[name];
}

export function compMetaGet(definition) {
  return definition?.expose?.meta ?? metaDefault;
}

// ---------- a component holding others (expose.hold, holdNormalize above) ----------

// whether a holder takes a block, asked while something is dragged over it: '' it does, else why
// not; undefined when it holds nothing at all (no hold). A holder that fails is a refusal saying so
export function compHoldTakeReasonGet(definition, data, block, context) {
  const hold = definition?.expose?.hold;
  if (!hold) return undefined;
  if (!block?.comp) return 'only a block of a component can be held';
  try {
    return String(hold.takeCheck(data, block, context) ?? '');
  } catch (error) {
    return `it could not tell: ${error?.message ?? error}`;
  }
}

// the holder's data with the block in it, { raw, props? }; throws what the holder refuses
export function compHoldTake(definition, data, block, context) {
  const hold = definition?.expose?.hold;
  if (!hold) throw new Error('This component holds no other.');
  const reason = compHoldTakeReasonGet(definition, data, block, context);
  if (reason) throw new Error(reason);
  const result = hold.take(data, block, context);
  if (!result || typeof result.raw !== 'string') throw new Error('expose.hold.take answers { raw, props? }.');
  return result;
}

// the holder's data without the held block of a key, and the block: { raw, props?, block }; null
// when it lets nothing go (no letGo, no such key)
export function compHoldLetGo(definition, data, key) {
  const letGo = definition?.expose?.hold?.letGo;
  if (!letGo) return null;
  const result = letGo(data, key);
  return result && typeof result.raw === 'string' && result.block?.comp ? result : null;
}

// the apis a component exposes (none for a legacy definition)
export function compApiListGet(definition) {
  return definition?.expose?.apiList ?? [];
}

// the icon the page draws for a component: its own, else the default one
export function compIconGet(definition) {
  return definition?.expose?.icon ?? compIconDefault;
}

// the source of a new block of the component in the environment env (see
// sourceDefaultCreate above): { lang, raw, props } or { text }, or
// undefined when the component exposes no factory or starts no block there
// a component declared isAssetOnly must answer the comment-block form: its
// lang and raw become the first version of a new asset item, the block
// written in the document is a reference to it
export function compSourceDefaultGet(definition, env) {
  const sourceDefaultCreate = definition?.expose?.sourceDefaultCreate;
  if (!sourceDefaultCreate) return undefined;
  const source = sourceDefaultResultNormalize(sourceDefaultCreate(env), env.compName);
  if (source?.text !== undefined && compMetaGet(definition).isAssetOnly) {
    throw new Error(`sourceDefaultCreate of ${env.compName}: an isAssetOnly component returns { lang, raw, props }, not { text }.`);
  }
  return source;
}

// what a component draws as an object view (expose.objectView), undefined
// for one that draws no object (doc_page_impl_obj.md#object-views)
export function compObjectViewGet(definition) {
  return definition?.expose?.objectView;
}

// what a component answers of the inner paths of frontend objects
// (expose.objectInner), undefined for one that answers none
export function compObjectInnerGet(definition) {
  return definition?.expose?.objectInner;
}

export function compViewModeListGet(definition) {
  return definition?.expose?.viewModeList ?? [];
}

// the view mode a block shows before a reader picks one; undefined for a
// component without view modes. a mode may be the default of some places
// (isDefaultInPlaceList: ['listItem', 'inListItem'], the place of a block of a
// list item, config.place): there it comes before the mode marked isDefault
export function compViewModeDefaultIdGet(definition, place) {
  const modeList = compViewModeListGet(definition);
  const modeOfPlace = place ? modeList.find((mode) => (mode.isDefaultInPlaceList ?? []).includes(place)) : undefined;
  return (modeOfPlace ?? modeList.find((mode) => mode.isDefault))?.id;
}

// the edit modes a block of this component can be opened in: the declared
// ones, then the built-in source mode unless the component rejects it. a
// read-only component has none. the default is the declared default, else
// the first declared, else the source mode.
export function compEditModeListGet(definition) {
  const meta = compMetaGet(definition);
  if (meta.isReadOnly) return [];
  const modeListDeclared = definition?.expose?.editModeList ?? [];
  const modeList = [...modeListDeclared];
  if (meta.isEditSourceAccepted) {
    modeList.push({ ...compEditModeSource, isDefault: modeListDeclared.length === 0 });
  }
  return modeList;
}

export function compEditModeDefaultIdGet(definition) {
  return compEditModeListGet(definition).find((mode) => mode.isDefault)?.id;
}
