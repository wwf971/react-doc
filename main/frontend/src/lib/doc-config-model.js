import { configDeclaredIs, configValueNormalize } from './doc-config-define.js';

// Resolves every config declaration of the doc page into one config model.
// Design: doc_page_impl_config.md
//
// value of key K for document D, later levels win:
//   1. default      definition valueDefault
//   2. global       configDoc.globalConfig.K
//   3. source       source rules that collected D, in rule order   (manifest entry.configSource)
//   4. side panel   side-panel nodes binding D or a folder above D, in tree order
//   5. doc          frontmatter "config" of D                     (manifest entry.configFrontmatter)
//   6. user         the reader's override from the settings panel (configUser)
// page-scoped keys are read at levels 2 and 6 only. a feature with an inline
// form (for example a link title marker) applies it after level 6 by itself.
//
// part index level: side-panel part.index.config, applied over the config of
// the index document only while the index is hosted in the local-index area.
// it is kept apart from configByDocPath, so the same document rendered as a
// page keeps levels 1-6. the user level is applied over it too.
//
// configModel: {
//   configGlobal                key -> value, levels 1-2 and 6
//   configGlobalDeclared        key -> value, levels 1-2 (without the user's override)
//   levelGlobalByKey            key -> level
//   configByDocPath             docPath -> { valueByKey, levelByKey }, levels 1-6
//   configPartIndexByPartId     partId -> { key: value }, only the keys declared
// }
export function configModelBuild({
  configDefineByKey,
  configDoc,
  configUser = {},
  fileManifest = [],
  declarationListSidePanel = [],
  declarationListPartIndex = [],
}) {
  const configGlobal = {};
  const levelGlobalByKey = {};
  for (const [key, define] of configDefineByKey) {
    configGlobal[key] = define.valueDefault;
    levelGlobalByKey[key] = 'default';
  }
  const globalConfig = configDoc?.globalConfig;
  if (globalConfig !== undefined && !configDeclaredIs(globalConfig)) {
    console.warn('[doc-config] globalConfig must be a mapping');
  }
  configLevelApply(
    { valueByKey: configGlobal, levelByKey: levelGlobalByKey },
    configDeclaredIs(globalConfig) ? globalConfig : {},
    { configDefineByKey, level: 'global', originText: 'globalConfig' },
  );
  // the values of levels 1-5 before the user's override, the base of every document
  const configGlobalDeclared = { ...configGlobal };
  const levelGlobalDeclaredByKey = { ...levelGlobalByKey };
  const optionsUser = { configDefineByKey, level: 'user', originText: 'the settings panel' };
  configLevelApply({ valueByKey: configGlobal, levelByKey: levelGlobalByKey }, configUser, optionsUser);

  // side-panel declarations folded per document, in tree order
  const configSidePanelByDocPath = new Map();
  for (const declaration of declarationListSidePanel) {
    for (const docPath of declaration.docPathList) {
      const configList = configSidePanelByDocPath.get(docPath) ?? [];
      configList.push(declaration);
      configSidePanelByDocPath.set(docPath, configList);
    }
  }

  const configByDocPath = new Map();
  for (const entry of fileManifest) {
    const docPath = entry.internalPath;
    const configResolved = {
      valueByKey: { ...configGlobalDeclared },
      levelByKey: { ...levelGlobalDeclaredByKey },
    };
    configLevelApply(configResolved, entry.configSource, {
      configDefineByKey, level: 'source', originText: `source rules of ${docPath}`,
    });
    for (const declaration of configSidePanelByDocPath.get(docPath) ?? []) {
      configLevelApply(configResolved, declaration.config, {
        configDefineByKey, level: 'sidePanel', originText: `side-panel item ${declaration.origin.itemId}`,
      });
    }
    configLevelApply(configResolved, entry.configFrontmatter, {
      configDefineByKey, level: 'doc', originText: `frontmatter of ${docPath}`,
    });
    configLevelApply(configResolved, configUser, optionsUser);
    configByDocPath.set(docPath, configResolved);
  }

  const configPartIndexByPartId = new Map();
  for (const declaration of declarationListPartIndex) {
    const originText = `part.index.config of side-panel item ${declaration.partId}`;
    if (!configDeclaredIs(declaration.config)) {
      console.warn(`[doc-config] ${originText} must be a mapping`);
      continue;
    }
    const configResolved = { valueByKey: {}, levelByKey: {} };
    configLevelApply(configResolved, declaration.config, {
      configDefineByKey, level: 'partIndex', originText,
    });
    // the reader's override wins over the part index declaration as well,
    // restricted to the keys the part index declared
    for (const key of Object.keys(configResolved.valueByKey)) {
      if (configUser[key] === undefined) continue;
      configLevelApply(configResolved, { [key]: configUser[key] }, optionsUser);
    }
    configPartIndexByPartId.set(declaration.partId, configResolved.valueByKey);
  }

  return { configGlobal, configGlobalDeclared, levelGlobalByKey, configByDocPath, configPartIndexByPartId };
}

function configLevelApply(configResolved, configDeclared, { configDefineByKey, level, originText }) {
  if (!configDeclaredIs(configDeclared)) return;
  for (const [key, valueDeclared] of Object.entries(configDeclared)) {
    const define = configDefineByKey.get(key);
    if (!define) {
      console.warn(`[doc-config] unknown config key "${key}" in ${originText}`);
      continue;
    }
    if (define.scope === 'page' && level !== 'global' && level !== 'user') {
      console.warn(`[doc-config] "${key}" is a page-level key; set it in globalConfig, not in ${originText}`);
      continue;
    }
    const { isValid, value } = configValueNormalize(define, valueDeclared);
    if (!isValid) {
      console.warn(`[doc-config] invalid value for "${key}" in ${originText}: ${JSON.stringify(valueDeclared)}`);
      continue;
    }
    configResolved.valueByKey[key] = value;
    configResolved.levelByKey[key] = level;
  }
}
