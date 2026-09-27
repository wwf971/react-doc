// Definitions of the doc page config keys. Design: doc_page_impl_config.md
//
// A definition says that a key exists, what values it accepts, its default,
// and at which levels it can be declared:
//   scope 'page'   one value for the whole page, declared only in globalConfig
//   scope 'doc'    resolved per document: global < source < side panel < document
//
// Values are chosen in YAML; definitions live in code. An application adds its
// own keys through DocPageMdx config.configDefineList.
//
// Key naming: keys of one feature share one prefix, and a switch ends with IsOn.
//   TagsDisplayAtMainPanel...   tags next to the path bar of the main panel
//   TagsDisplayAtSidePanelItem... tags on side-panel item labels
//   TagsDisplayAtLink...        tags beside document links
//   TagsOverviewPopup...        popup listing the assets of one tag
export const configDefineListBuiltin = [
  {
    key: 'TagsDisplayAtMainPanelIsOn',
    type: 'boolean',
    valueDefault: true,
    scope: 'doc',
  },
  {
    key: 'TagsDisplayAtSidePanelItemIsOn',
    type: 'boolean',
    valueDefault: true,
    scope: 'page',
  },
  {
    // tag ids shown on side-panel items. null shows every tag.
    key: 'TagsDisplayAtSidePanelItemsList',
    type: 'stringList',
    valueDefault: null,
    scope: 'page',
  },
  {
    key: 'TagsDisplayAtLinkIsOn',
    type: 'boolean',
    valueDefault: false,
    scope: 'doc',
  },
  {
    key: 'TagsDisplayAtLinkPosition',
    type: 'enum',
    valueList: ['before', 'after'],
    valueDefault: 'after',
    scope: 'doc',
  },
  {
    key: 'TagsOverviewPopupIsOn',
    type: 'boolean',
    valueDefault: true,
    scope: 'page',
  },
];

export const configLevelList = ['default', 'global', 'source', 'sidePanel', 'doc'];

// later entries with the same key replace earlier ones
export function configDefineByKeyBuild(configDefineListExtra = []) {
  const configDefineByKey = new Map();
  for (const define of [...configDefineListBuiltin, ...configDefineListExtra]) {
    if (!define || typeof define.key !== 'string' || !define.key) continue;
    configDefineByKey.set(define.key, {
      scope: 'doc',
      type: 'any',
      valueDefault: null,
      ...define,
    });
  }
  return configDefineByKey;
}

// returns { isValid, value }. null always means "not set" for nullable keys.
export function configValueNormalize(define, value) {
  if (value === null) return { isValid: define.valueDefault === null, value: null };
  if (define.type === 'boolean') {
    return { isValid: typeof value === 'boolean', value };
  }
  if (define.type === 'string') {
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
