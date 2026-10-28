import { FileCode } from '../../frontend/UICommon.js';
import { compIconDefault } from './comp-icon.jsx';

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
//                  into an asset object the page creates for a block of the
//                  component; absent: the store's default applies),
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
//   editModeList   the same shape, the ways its data can be edited in place.
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
});

const ASSET_SAVE_MODE_LIST = ['inPlace', 'newVersion'];

// the placements of a block written in a document by its author; a
// component declared isNotInDoc is refused there, a component declared
// isAssetOnly renders there only with data from the asset service layer
export const COMP_PLACEMENT_DOC_LIST = ['mdx', 'commentBlock'];

export const compExposeNameStandardList = ['meta', 'icon', 'viewModeList', 'editModeList', 'sourceDefaultCreate'];

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
  const { meta, icon, viewModeList, editModeList, sourceDefaultCreate, ...exposeOther } = expose;
  return {
    ...exposeOther,
    meta: metaNormalize(meta),
    icon: iconNormalize(icon, 'expose.icon'),
    viewModeList: modeListNormalize(viewModeList, 'expose.viewModeList', []),
    editModeList: modeListNormalize(editModeList, 'expose.editModeList', [COMP_EDIT_MODE_SOURCE_ID]),
    sourceDefaultCreate: sourceDefaultCreateNormalize(sourceDefaultCreate),
  };
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

// the icon the page draws for a component: its own, else the default one
export function compIconGet(definition) {
  return definition?.expose?.icon ?? compIconDefault;
}

// the source of a new block of the component in the environment env (see
// sourceDefaultCreate above): { lang, raw, props } or { text }, or
// undefined when the component exposes no factory or starts no block there
// a component declared isAssetOnly must answer the comment-block form: its
// lang and raw become the first version of a new asset object, the block
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

export function compViewModeListGet(definition) {
  return definition?.expose?.viewModeList ?? [];
}

// the view mode a block shows before a reader picks one; undefined for a
// component without view modes
export function compViewModeDefaultIdGet(definition) {
  return compViewModeListGet(definition).find((mode) => mode.isDefault)?.id;
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
