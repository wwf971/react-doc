// Definitions of the doc page config keys. Design: doc_page_impl_config.md
//
// A definition says that a key exists, what values it accepts, its default,
// and at which levels it can be declared:
//   scope 'page'   one value for the whole page, declared only in globalConfig
//   scope 'doc'    resolved per document: global < source < side panel < document
//
// Values are chosen in YAML, or by the reader in the settings panel (the user
// level, kept for the page session only); definitions live in code. An
// application adds its own keys through DocPageMdx config.configDefineList.
//
//   description      one line shown in the settings panel
//   isUserSettable   false hides the key from the settings panel (default true)
//   type             boolean | string | number | enum (valueList) | stringList | any
//                    | sourcePath: a string naming a folder or file of the doc page
//                      source (~rootId/...); pathSpec { kind: 'dir' | 'file', extList? }
//                      says what it names, so the settings panel completes it from
//                      the source layer (doc_page_impl_source.md)
//
// Component-level keys (doc_page_impl_config.md#component-level-config): a
// registered component declares its own keys in its definition
// (compDefine configDefineList, the same fields without scope); they are
// resolved per component and document, and set in YAML under "compConfig"
// by the component's tag name:
//   compConfig:
//     Image:
//       FileStoreDir: ${imageFileStoreDirDefault}
//
// Variables: a string value may hold ${name}; the name is replaced by the
// value of config.yaml "variable" (variableExpand) at every level.
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

// user is the reader's own override, set in the settings panel for the page
// session; it comes after every declared level
export const configLevelList = ['default', 'global', 'source', 'sidePanel', 'doc', 'user'];

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
// compById holds registry definitions ({ CompRender, configDefineList, ... });
// a legacy component (a bare React component) declares none.
export function compConfigDefineByCompIdBuild(compById = {}) {
  const result = new Map();
  for (const [compId, definition] of Object.entries(compById)) {
    const defineList = definition?.configDefineList;
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
// left as written and reported. other value types pass through.
export function variableExpand(value, variableByName = {}, originText = '') {
  if (typeof value !== 'string' || !value.includes('${')) return value;
  return value.replace(/\$\{([\w.-]+)\}/g, (matchText, name) => {
    if (Object.prototype.hasOwnProperty.call(variableByName, name)) return String(variableByName[name]);
    console.warn(`[doc-config] unknown variable ${matchText}${originText ? ` in ${originText}` : ''}`);
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
