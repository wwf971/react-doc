import { FileCode } from '../../frontend/UICommon.js';

// What a component exposes about itself through its registry definition
// (doc_page_impl_mdx_comp.md#what-a-component-exposes): the `expose` option
// of compDefine(). A few names are standard and normalized here, so that
// the page can rely on their shape; every other name is kept as written,
// for things a host or a later feature reads (compExposeGet).
//
//   meta           Object: facts about the component. isReadOnly (nothing of
//                  it can be edited from the page), isEditSourceAccepted
//                  (the built-in source edit mode is offered; default true),
//                  configDefineList (the shape of its component-level config,
//                  doc_page_impl_config.md#component-level-config), label,
//                  description, and any further key the component adds
//   icon           a component drawing the component's icon in any size
//                  (comp-icon.jsx: the drawing keeps the largest square)
//   viewModeList   [{ id, label, description, icon, isDefault }] the ways the
//                  component can display its data; the one with isDefault
//                  (else the first) is what a block shows until a reader
//                  picks another
//   editModeList   the same shape, the ways its data can be edited in place.
//                  the built-in mode 'source' (the lines of the block) is
//                  added by compEditModeListGet unless meta says otherwise,
//                  so a component never declares it
//   editTemplate   { lang, raw, props } of a new block of this component,
//                  offered by the insert menu

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
  configDefineList: [],
});

export const compExposeNameStandardList = ['meta', 'icon', 'viewModeList', 'editModeList', 'editTemplate'];

// the normalized `expose` of a definition; throws on a shape the page
// cannot work with, so a wrong declaration fails at registration
export function compExposeNormalize(expose = {}) {
  if (!expose || typeof expose !== 'object' || Array.isArray(expose)) {
    throw new Error('compDefine: expose must be an object.');
  }
  const { meta, icon, viewModeList, editModeList, editTemplate, ...exposeOther } = expose;
  return {
    ...exposeOther,
    meta: metaNormalize(meta),
    icon: iconNormalize(icon, 'expose.icon'),
    viewModeList: modeListNormalize(viewModeList, 'expose.viewModeList', []),
    editModeList: modeListNormalize(editModeList, 'expose.editModeList', [COMP_EDIT_MODE_SOURCE_ID]),
    editTemplate: editTemplateNormalize(editTemplate),
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
  return {
    ...metaDefault,
    ...meta,
    isReadOnly: meta.isReadOnly === true,
    isEditSourceAccepted: meta.isEditSourceAccepted !== false,
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

function editTemplateNormalize(editTemplate) {
  if (editTemplate === undefined) return undefined;
  if (!editTemplate || typeof editTemplate !== 'object' || Array.isArray(editTemplate)) {
    throw new Error('compDefine: expose.editTemplate must be an object { lang, raw, props }.');
  }
  return editTemplate;
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
