// Definitions of the doc page config keys and of the config layers.
// Design: doc_page_impl_config.md
//
// A definition says that a key exists, what values it accepts, its default,
// and at which levels it can be declared:
//   scope 'page'   one value for the whole page, declared in the config layers only
//   scope 'doc'    resolved per document: the layers below the document levels
//                  (default, doc page) < source < side panel < document < the
//                  layers above them (client)
//
// Values are chosen in YAML, or in the settings panel (written into one of
// the config layers, configLayerDefineList); definitions live in code. The
// default of a definition is part of the default layer. An application adds
// its own keys through DocPageMdx config.configDefineList.
//
//   description      one line shown in the settings panel
//   isUserSettable   false hides the key from the settings panel (default true)
//   type             boolean | string | number | enum (valueList) | stringList | any
//                    | sourcePath: a string naming a folder or file of the doc page
//                      source (~root/... or ~page:root/...); pathSpec { kind: 'dir' | 'file', extList? }
//                      says what it names, so the settings panel completes it from
//                      the doc page source service layer (doc_page_impl_source.md)
//
// Component-level keys (doc_page_impl_config.md#component-level-config): a
// registered component declares its own keys in its definition
// (compDefine expose.meta.configDefineList, the same fields without scope); they are
// resolved per component and document, and set in YAML under "compConfig"
// by the component's tag name:
//   compConfig:
//     Image:
//       FileStoreDir: ${imageFileStoreDirDefault}
//
// Variables: a string value may hold ${name}; the name is replaced by the
// value of config.yaml "variable", or of "variable" in a config file of the
// doc page (variableExpand), at every level.
//
// Key naming: keys of one feature share one prefix, and a switch ends with IsOn.
//   TagsDisplayAtMainPanel...   tags next to the path bar of the main panel
//   TagsDisplayAtSidePanelItem... tags on side-panel item labels
//   TagsDisplayAtLink...        tags beside document links
//   TagsOverviewPopup...        popup listing the assets of one tag
//   EditBlock...                in-place editing of blocks (doc_page_impl_edit.md)
export const configDefineListBuiltin = [
  {
    key: 'TagsDisplayAtMainPanelIsOn',
    type: 'boolean',
    valueDefault: true,
    scope: 'doc',
    description: 'Show the tags of the current page next to the path bar.',
  },
  {
    key: 'TagsDisplayAtSidePanelItemIsOn',
    type: 'boolean',
    valueDefault: true,
    scope: 'page',
    description: 'Show tags on side-panel item labels.',
  },
  {
    // tag ids shown on side-panel items. null shows every tag.
    key: 'TagsDisplayAtSidePanelItemsList',
    type: 'stringList',
    valueDefault: null,
    scope: 'page',
    description: 'Tag ids shown on side-panel items, comma separated. Empty shows every tag.',
  },
  {
    key: 'TagsDisplayAtLinkIsOn',
    type: 'boolean',
    valueDefault: false,
    scope: 'doc',
    description: 'Show the tags of the target beside document links.',
  },
  {
    key: 'TagsDisplayAtLinkPosition',
    type: 'enum',
    valueList: ['before', 'after'],
    valueDefault: 'after',
    scope: 'doc',
    description: 'Where the tags of a link are placed, before or after the link text.',
  },
  {
    key: 'TagsOverviewPopupIsOn',
    type: 'boolean',
    valueDefault: true,
    scope: 'page',
    description: 'Clicking a tag opens the tag overview popup.',
  },
  {
    // the popup also opens from the tags on side-panel items. off by
    // default: a click in the side panel is a navigation gesture, and a tag
    // there is a label first
    key: 'TagsOverviewPopupAtSidePanelItemIsOn',
    type: 'boolean',
    valueDefault: false,
    scope: 'page',
    description: 'Clicking a tag on a side-panel item opens the tag overview popup too.',
  },
  {
    // how the edit mode of a block is entered while the page is in edit mode:
    //   click    a click anywhere on the block (the caret opens where the
    //            block was clicked), as well as the Edit button
    //   button   the Edit button of the block toolbar only
    key: 'EditBlockEnterMode',
    type: 'enum',
    valueList: ['click', 'button'],
    valueDefault: 'click',
    scope: 'page',
    description: 'How a block enters its edit mode: with the Edit button of its toolbar only, or also by clicking the block.',
  },
];

// The config layers (doc_page_impl_config.md#config-layers): page-wide
// stacks of config declarations, each layer with its own storage, stacked in
// this order. The settings panel shows one tab per layer, listing what the
// layer declares (not a full set of keys), and writes into the layer shown.
// A layer holds page keys and component keys alike.
//   id                 the level name of a value decided by the layer
//   label              the tab of the settings panel
//   storage            where the layer's declarations are kept, and so how
//                      it is read and written (store/doc-config-layer.ts):
//                        'package'   config.yaml of the doc page package
//                                    (configDefault); never written from the page
//                        'docEntry'  the "config" declarations of the entry of the
//                                    doc page and of the files it reaches, written
//                                    in place by the development server
//                        'browser'   the browser's localStorage, for this page
//   isAboveDocLevels   the layer is applied after the document levels (source,
//                      side panel, frontmatter), so it wins over what documents
//                      declare; false: before them, so documents refine it
//   isEveryKeyDeclared the layer declares every key: the definition defaults
//                      are part of it (the default layer)
//   description        shown in the head of the settings panel
// another layer is one more entry here, at its place in the stack, with a
// storage the store knows how to read and write.
export const configLayerDefineList = [
  {
    id: 'default',
    label: 'Default',
    storage: 'package',
    isAboveDocLevels: false,
    isEveryKeyDeclared: true,
    description: 'provided by the doc page package: config.yaml configDefault over the built-in defaults',
  },
  {
    id: 'docPage',
    label: 'Doc page',
    storage: 'docEntry',
    isAboveDocLevels: false,
    isEveryKeyDeclared: false,
    description: 'declared by the doc page: its entry and the files it reaches; documents may refine a value',
  },
  {
    id: 'client',
    label: 'Client',
    storage: 'browser',
    isAboveDocLevels: true,
    isEveryKeyDeclared: false,
    description: 'kept in this browser for this page; wins over what documents declare',
  },
];

// the levels a value can be decided by, in resolution order: the definition
// default (the default layer, when there is one), the layers below the
// document levels, the document levels, the layers above
export function configLevelListBuild(layerDefineList = configLayerDefineList) {
  const layerIdListBelow = layerDefineList.filter((define) => !define.isAboveDocLevels).map((define) => define.id);
  const layerIdListAbove = layerDefineList.filter((define) => define.isAboveDocLevels).map((define) => define.id);
  const levelListDefault = layerIdListBelow.includes(CONFIG_LEVEL_DEFAULT) ? [] : [CONFIG_LEVEL_DEFAULT];
  return [...levelListDefault, ...layerIdListBelow, 'source', 'sidePanel', 'doc', ...layerIdListAbove];
}

// the level of a definition default; the default layer has the same id, so
// a value of config.yaml configDefault and a built-in default are one level
export const CONFIG_LEVEL_DEFAULT = 'default';

// later entries with the same key replace earlier ones
export function configDefineByKeyBuild(configDefineListExtra = []) {
  const configDefineByKey = new Map();
  for (const define of [...configDefineListBuiltin, ...configDefineListExtra]) {
    if (!define || typeof define.key !== 'string' || !define.key) continue;
    configDefineByKey.set(define.key, {
      scope: 'doc',
      type: 'any',
      valueDefault: null,
      description: '',
      isUserSettable: true,
      ...define,
    });
  }
  return configDefineByKey;
}

// the keys one registered component declares: compId -> (key -> define).
// compById holds registry definitions; the shape of a component's config
// is part of what it exposes, expose.meta.configDefineList
// (doc_page_impl_mdx_comp.md#what-a-component-exposes). a legacy component
// (a bare React component) declares none.
export function compConfigDefineByCompIdBuild(compById = {}) {
  const result = new Map();
  for (const [compId, definition] of Object.entries(compById)) {
    const defineList = definition?.expose?.meta?.configDefineList;
    if (!Array.isArray(defineList) || defineList.length === 0) continue;
    const defineByKey = new Map();
    for (const define of defineList) {
      if (!define || typeof define.key !== 'string' || !define.key) continue;
      defineByKey.set(define.key, {
        type: 'any',
        valueDefault: null,
        description: '',
        isUserSettable: true,
        ...define,
        scope: 'doc',
      });
    }
    if (defineByKey.size > 0) result.set(compId, defineByKey);
  }
  return result;
}

// the key under which component-level values are declared in a config mapping
export const COMP_CONFIG_KEY = 'compConfig';

// ${name} in a string replaced by variableByName[name]; an unknown name is
// left as written and reported (unless isQuiet: the settings panel checks
// declarations on every render). other value types pass through.
export function variableExpand(value, variableByName = {}, originText = '', isQuiet = false) {
  if (typeof value !== 'string' || !value.includes('${')) return value;
  return value.replace(/\$\{([\w.-]+)\}/g, (matchText, name) => {
    if (Object.prototype.hasOwnProperty.call(variableByName, name)) return String(variableByName[name]);
    if (!isQuiet) console.warn(`[doc-config] unknown variable ${matchText}${originText ? ` in ${originText}` : ''}`);
    return matchText;
  });
}

// returns { isValid, value }. null always means "not set" for nullable keys.
export function configValueNormalize(define, value) {
  if (value === null) return { isValid: define.valueDefault === null, value: null };
  if (define.type === 'boolean') {
    return { isValid: typeof value === 'boolean', value };
  }
  if (define.type === 'string' || define.type === 'sourcePath') {
    return { isValid: typeof value === 'string', value };
  }
  if (define.type === 'number') {
    return { isValid: typeof value === 'number' && Number.isFinite(value), value };
  }
  if (define.type === 'enum') {
    return { isValid: (define.valueList ?? []).includes(value), value };
  }
  if (define.type === 'stringList') {
    const isValid = Array.isArray(value) && value.every((valueItem) => typeof valueItem === 'string');
    return { isValid, value };
  }
  return { isValid: true, value };
}

// a "config" value written in source rules, side-panel nodes, or frontmatter
export function configDeclaredIs(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
