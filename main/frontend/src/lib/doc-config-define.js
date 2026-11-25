import { RANK_PATTERN_TEXT } from './doc-rank.js';

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
//                    | stringMap: a mapping of names to strings, merged entry by
//                      entry: a later level adds and replaces entries, and an
//                      entry written null removes the one below (configValueMerge)
//   valuePattern     a regular expression (as text) every string of a string,
//                    stringList or stringMap value must match
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
//   EditInsert...               the insert menu of the edit layer (doc_page_impl_edit.md)
//   List...                     the spacing of the lists of a document
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
    key: 'FontMonoFamily',
    type: 'string',
    valueDefault: null,
    scope: 'doc',
    description: 'The font of code and of source being edited in a document, as a css font-family, for example to name a fallback for its language. Empty keeps the font of the page.',
  },
  {
    // the space between two lines of a list, the same between two items and
    // between an item and its first sub-item (css px). applied as the css
    // variable --doc-list-item-gap (DocPageMdx.css)
    key: 'ListItemGap',
    type: 'number',
    valueDefault: 4,
    scope: 'doc',
    description: 'The space between two lines of a list, in px: the same between two items and between an item and its sub-items.',
  },
  {
    // the space between the bullet or number of a list item and its text
    // (css px), as --doc-list-marker-gap
    key: 'ListMarkerGap',
    type: 'number',
    valueDefault: 5,
    scope: 'doc',
    description: 'The space between the bullet or number of a list item and the start of its text, in px.',
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
    // the views of a fenced code block (doc_page_impl_mdx_code.md): the view
    // of a block that names none in the info of its fence, by where it stands
    key: 'CodeBlockView',
    type: 'enum',
    valueList: ['card', 'plain', 'icon'],
    valueDefault: 'card',
    scope: 'doc',
    description: 'The view of a fenced code block that names none (view=... in the info of its fence): card, a card with its own background; plain, a thin frame around lines that stand like plain text; or icon, a tile whose lines open in a dialog.',
  },
  {
    key: 'CodeBlockViewAsListItem',
    type: 'enum',
    valueList: ['card', 'plain', 'icon'],
    valueDefault: 'plain',
    scope: 'doc',
    description: 'The view of a fenced code block that is a list item (the whole text of the item, as Shift + Enter in an item writes it) and names none: by default plain, so that its lines keep the rhythm of the list.',
  },
  {
    key: 'CodeBlockViewInListItem',
    type: 'enum',
    valueList: ['card', 'plain', 'icon'],
    valueDefault: 'plain',
    scope: 'doc',
    description: 'The view of a fenced code block that stands in the text of a list item among other things (text, other blocks) and names none: by default plain, lines that belong to the text of the item, on a line of their own.',
  },
  {
    // where the tile of a code block in the icon view stands in the line of
    // text it is in (doc_page_impl_mdx_code.md#the-icon-view)
    key: 'CodeBlockIconAlign',
    type: 'enum',
    valueList: ['bottom', 'top'],
    valueDefault: 'bottom',
    scope: 'doc',
    description: 'Where the tile of a code block drawn as an icon stands in the line of text it is in: bottom, its bottom edge on the bottom edge of the line, the text beside its lower part; or top, its top edge at the top of the line.',
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
  {
    // the order of the insert menu (doc_page_impl_edit.md#the-order-of-the-insert-menu):
    // entry id -> rank (doc-rank.js). an entry with a rank is listed before
    // every entry without one, in its row and among the matches of a search;
    // the ranks of the basic blocks are the package's, in config.yaml
    // configDefault. merged entry by entry, so a doc page, a folder or a
    // document ranks its own components without restating the others
    key: 'EditInsertRankByEntry',
    type: 'stringMap',
    valuePattern: RANK_PATTERN_TEXT,
    valueDefault: {},
    scope: 'doc',
    description: 'The rank of the entries of the insert menu, by entry id (text:paragraph, component:{tag name}, service:{component id}): a ranked entry comes before every unranked one, ranks in order (0-9 and a-z, compared character by character, never ending with 0); null removes a rank declared below.',
  },
  // portals (doc_page_impl_portal.md#config): which one the page opens, the switcher, their order
  {
    key: 'PortalDefault',
    type: 'string',
    valueDefault: null,
    scope: 'page',
    description: 'The portal the page opens when its address names none: a portal id ({provider}/{name}, as the Portals tab lists them). Not set: the documents. A deployment showing one portal as its front names it here.',
  },
  {
    key: 'PortalSwitcherIsOn',
    type: 'boolean',
    valueDefault: true,
    scope: 'page',
    description: 'Show the portal switcher at the top left of the documents, and floating at the top left of a portal that draws none of its own, while the page has more than one portal.',
  },
  {
    key: 'PortalSearchCountMin',
    type: 'number',
    valueDefault: 8,
    scope: 'page',
    description: 'From how many portals on the switcher has a field finding one by its name.',
  },
  {
    key: 'PortalHiddenList',
    type: 'stringList',
    valueDefault: [],
    scope: 'page',
    description: 'Portal ids left out of the page: neither listed nor opened. docPage:{alias}/doc hides the documents of a doc page, for a deployment that is one portal only.',
  },
  {
    key: 'PortalRankById',
    type: 'stringMap',
    valuePattern: RANK_PATTERN_TEXT,
    valueDefault: {},
    scope: 'page',
    description: 'The rank of the portals of a doc page in the switcher, by portal id: a ranked portal comes before every unranked one, after the documents; null removes a rank declared below.',
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
//                        'docEntry'  the "config" declarations of the entry of a
//                                    doc page and of the files it reaches, written
//                                    in place by the development server
//                        'workspace' the "config" declarations of the workspace
//                                    (its file, or "workspace" of config.yaml),
//                                    written in place the same way
//                        'browser'   the browser's localStorage, for this page
//   isPerDocPage       one layer per doc page of the workspace, in the order of
//                      the workspace with the main doc page (its first root doc
//                      page) first, each named by the doc page's alias (the
//                      layer id {id}:{alias}); only the main doc page's layer
//                      takes part in the resolution, the others are shown
//   isAboveDocLevels   the layer is applied after the document levels (source,
//                      side panel, frontmatter), so it wins over what documents
//                      declare; false: before them, so documents refine it
//   isEveryKeyDeclared the layer declares every key: the definition defaults
//                      are part of it (the default layer)
//   description        shown in the head of the settings panel
// another layer is one more entry here, at its place in the stack, with a
// storage the store knows how to read and write. the stack: the package's
// defaults, the main doc page's declarations, the workspace's (the
// deployment decides over the doc page it deploys, as the main doc page
// decides over the doc pages it includes), the document levels, the browser.
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
    isPerDocPage: true,
    isAboveDocLevels: false,
    isEveryKeyDeclared: false,
    description: 'declared by the doc page: its entry and the files it reaches; documents may refine a value',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    storage: 'workspace',
    isAboveDocLevels: false,
    isEveryKeyDeclared: false,
    description: 'declared by the workspace ("config" of its file): the deployment\'s values over the main doc page\'s; documents may refine a value',
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

// the layer id of a per-doc-page layer for one doc page: {id}:{alias}, or
// the id alone when the page has no alias (a host without a workspace)
export function configLayerIdOfDocPage(define, docPageAlias) {
  return docPageAlias ? `${define.id}:${docPageAlias}` : define.id;
}

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
  const isStringOk = (text) => typeof text === 'string' && valuePatternMatch(define, text);
  if (define.type === 'string' || define.type === 'sourcePath') {
    return { isValid: isStringOk(value), value };
  }
  if (define.type === 'number') {
    return { isValid: typeof value === 'number' && Number.isFinite(value), value };
  }
  if (define.type === 'enum') {
    return { isValid: (define.valueList ?? []).includes(value), value };
  }
  if (define.type === 'stringList') {
    const isValid = Array.isArray(value) && value.every(isStringOk);
    return { isValid, value };
  }
  if (define.type === 'stringMap') {
    // an entry may be null: it removes the entry of a level below
    const isValid = configDeclaredIs(value) && Object.values(value).every((valueEntry) => valueEntry === null || isStringOk(valueEntry));
    return { isValid, value };
  }
  return { isValid: true, value };
}

function valuePatternMatch(define, text) {
  if (typeof define.valuePattern !== 'string' || define.valuePattern === '') return true;
  return new RegExp(define.valuePattern).test(text);
}

// a valid value declared at a level, over the value below it: replaces it,
// except a stringMap, merged entry by entry (an entry written null removes
// the one below). isNullKept keeps the null entries, for a merge of the
// declarations of one layer that is itself applied over the levels below
// (configDeclaredListMerge); the value resolved never holds one.
export function configValueMerge(define, valueBelow, value, isNullKept = false) {
  if (define?.type !== 'stringMap' || !configDeclaredIs(value)) return value;
  const result = { ...(configDeclaredIs(valueBelow) ? valueBelow : {}) };
  for (const [name, valueEntry] of Object.entries(value)) {
    if (valueEntry === null && !isNullKept) delete result[name];
    else result[name] = valueEntry;
  }
  return result;
}

// a "config" value written in source rules, side-panel nodes, or frontmatter
export function configDeclaredIs(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
