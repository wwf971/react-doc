import { COMP_CONFIG_KEY, configDeclaredIs, configValueNormalize, variableExpand } from './doc-config-define.js';

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
// component-level keys (doc_page_impl_config.md#component-level-config) are
// resolved the same way, per component: level 2 is configDoc.compConfig,
// levels 3-5 read the "compConfig" mapping inside the declared config, level
// 6 is configUserComp. a declaration names the component by its tag name
// (compIdResolve turns it into the component id the keys are declared for).
//
// a string value may hold ${name}: it is replaced by configDoc.variable[name]
// at every level (variableExpand).
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
//   compConfigGlobalByCompId    compId -> { valueByKey, levelByKey }, levels 1-2 and 6
//   compConfigGlobalDeclaredByCompId  compId -> key -> value, levels 1-2
//   compConfigByDocPath         docPath -> compId -> { valueByKey, levelByKey }, levels 1-6
// }
export function configModelBuild({
  configDefineByKey,
  configDoc,
  configUser = {},
  configUserComp = {},
  fileManifest = [],
  declarationListSidePanel = [],
  declarationListPartIndex = [],
  compConfigDefineByCompId = new Map(),
  compIdResolve = (compName) => compName,
}) {
  const variableByName = configDeclaredIs(configDoc?.variable) ? configDoc.variable : {};
  if (configDoc?.variable !== undefined && !configDeclaredIs(configDoc.variable)) {
    console.warn('[doc-config] variable must be a mapping');
  }
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
    { configDefineByKey, variableByName, level: 'global', originText: 'globalConfig' },
  );
  // the values of levels 1-5 before the user's override, the base of every document
  const configGlobalDeclared = { ...configGlobal };
  const levelGlobalDeclaredByKey = { ...levelGlobalByKey };
  const optionsUser = { configDefineByKey, variableByName, level: 'user', originText: 'the settings panel' };
  configLevelApply({ valueByKey: configGlobal, levelByKey: levelGlobalByKey }, configUser, optionsUser);

  // ----- component-level keys, page level -----
  const compOptions = { compConfigDefineByCompId, compIdResolve, variableByName };
  const compConfigGlobalByCompId = compConfigResolvedBuild(compConfigDefineByCompId);
  const compConfigGlobal = configDoc?.[COMP_CONFIG_KEY];
  if (compConfigGlobal !== undefined && !configDeclaredIs(compConfigGlobal)) {
    console.warn(`[doc-config] ${COMP_CONFIG_KEY} must be a mapping of component names`);
  }
  compConfigLevelApply(compConfigGlobalByCompId, compConfigGlobal, { ...compOptions, level: 'global', originText: COMP_CONFIG_KEY });
  const compConfigGlobalDeclaredByCompId = compConfigResolvedCopy(compConfigGlobalByCompId);
  compConfigUserApply(compConfigGlobalByCompId, configUserComp, compOptions);

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
  const compConfigByDocPath = new Map();
  for (const entry of fileManifest) {
    const docPath = entry.internalPath;
    const configResolved = {
      valueByKey: { ...configGlobalDeclared },
      levelByKey: { ...levelGlobalDeclaredByKey },
    };
    const compConfigResolved = compConfigResolvedCopy(compConfigGlobalDeclaredByCompId);
    const levelList = [
      { configDeclared: entry.configSource, level: 'source', originText: `source rules of ${docPath}` },
      ...(configSidePanelByDocPath.get(docPath) ?? []).map((declaration) => ({
        configDeclared: declaration.config, level: 'sidePanel', originText: `side-panel item ${declaration.origin.itemId}`,
      })),
      { configDeclared: entry.configFrontmatter, level: 'doc', originText: `frontmatter of ${docPath}` },
    ];
    for (const { configDeclared, level, originText } of levelList) {
      configLevelApply(configResolved, configDeclared, { configDefineByKey, variableByName, level, originText });
      compConfigLevelApply(compConfigResolved, configDeclared?.[COMP_CONFIG_KEY], { ...compOptions, level, originText: `${COMP_CONFIG_KEY} of ${originText}` });
    }
    configLevelApply(configResolved, configUser, optionsUser);
    compConfigUserApply(compConfigResolved, configUserComp, compOptions);
    configByDocPath.set(docPath, configResolved);
    compConfigByDocPath.set(docPath, compConfigResolved);
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
      configDefineByKey, variableByName, level: 'partIndex', originText,
    });
    // the reader's override wins over the part index declaration as well,
    // restricted to the keys the part index declared
    for (const key of Object.keys(configResolved.valueByKey)) {
      if (configUser[key] === undefined) continue;
      configLevelApply(configResolved, { [key]: configUser[key] }, optionsUser);
    }
    configPartIndexByPartId.set(declaration.partId, configResolved.valueByKey);
  }

  return {
    configGlobal,
    configGlobalDeclared,
    levelGlobalByKey,
    configByDocPath,
    configPartIndexByPartId,
    compConfigGlobalByCompId,
    compConfigGlobalDeclaredByCompId: compConfigValueByCompIdGet(compConfigGlobalDeclaredByCompId),
    compConfigByDocPath,
  };
}

function configLevelApply(configResolved, configDeclared, { configDefineByKey, variableByName, level, originText }) {
  if (!configDeclaredIs(configDeclared)) return;
  for (const [key, valueDeclared] of Object.entries(configDeclared)) {
    // component-level values live under their own key (compConfigLevelApply)
    if (key === COMP_CONFIG_KEY) continue;
    const define = configDefineByKey.get(key);
    if (!define) {
      console.warn(`[doc-config] unknown config key "${key}" in ${originText}`);
      continue;
    }
    if (define.scope === 'page' && level !== 'global' && level !== 'user') {
      console.warn(`[doc-config] "${key}" is a page-level key; set it in globalConfig, not in ${originText}`);
      continue;
    }
    const { isValid, value } = configValueNormalize(define, variableExpand(valueDeclared, variableByName, originText));
    if (!isValid) {
      console.warn(`[doc-config] invalid value for "${key}" in ${originText}: ${JSON.stringify(valueDeclared)}`);
      continue;
    }
    configResolved.valueByKey[key] = value;
    configResolved.levelByKey[key] = level;
  }
}

// ----- component-level keys -----

// compId -> { valueByKey, levelByKey } at the default level
function compConfigResolvedBuild(compConfigDefineByCompId) {
  const result = new Map();
  for (const [compId, defineByKey] of compConfigDefineByCompId) {
    const valueByKey = {};
    const levelByKey = {};
    for (const [key, define] of defineByKey) {
      valueByKey[key] = define.valueDefault;
      levelByKey[key] = 'default';
    }
    result.set(compId, { valueByKey, levelByKey });
  }
  return result;
}

function compConfigResolvedCopy(compConfigByCompId) {
  const result = new Map();
  for (const [compId, resolved] of compConfigByCompId) {
    result.set(compId, { valueByKey: { ...resolved.valueByKey }, levelByKey: { ...resolved.levelByKey } });
  }
  return result;
}

function compConfigValueByCompIdGet(compConfigByCompId) {
  const result = new Map();
  for (const [compId, resolved] of compConfigByCompId) result.set(compId, { ...resolved.valueByKey });
  return result;
}

// compConfigDeclared: { CompName: { Key: value } }, the component named as
// written in documents
function compConfigLevelApply(compConfigByCompId, compConfigDeclared, { compConfigDefineByCompId, compIdResolve, variableByName, level, originText }) {
  if (compConfigDeclared === undefined) return;
  if (!configDeclaredIs(compConfigDeclared)) {
    console.warn(`[doc-config] ${originText} must be a mapping of component names`);
    return;
  }
  for (const [compName, configDeclared] of Object.entries(compConfigDeclared)) {
    const compId = compIdResolve(compName);
    const defineByKey = compConfigDefineByCompId.get(compId);
    if (!defineByKey) {
      console.warn(`[doc-config] component "${compName}" (${compId}) declares no config keys; ${originText}`);
      continue;
    }
    compConfigOneApply(compConfigByCompId.get(compId), configDeclared, defineByKey, { variableByName, level, originText: `${originText}, ${compName}` });
  }
}

// the reader's overrides: { compId: { Key: value } }
function compConfigUserApply(compConfigByCompId, configUserComp, { compConfigDefineByCompId, variableByName }) {
  for (const [compId, configDeclared] of Object.entries(configUserComp ?? {})) {
    const defineByKey = compConfigDefineByCompId.get(compId);
    if (!defineByKey) continue;
    compConfigOneApply(compConfigByCompId.get(compId), configDeclared, defineByKey, { variableByName, level: 'user', originText: `the settings panel, ${compId}` });
  }
}

function compConfigOneApply(configResolved, configDeclared, defineByKey, { variableByName, level, originText }) {
  if (!configResolved || !configDeclaredIs(configDeclared)) return;
  for (const [key, valueDeclared] of Object.entries(configDeclared)) {
    const define = defineByKey.get(key);
    if (!define) {
      console.warn(`[doc-config] unknown component config key "${key}" in ${originText}`);
      continue;
    }
    const { isValid, value } = configValueNormalize(define, variableExpand(valueDeclared, variableByName, originText));
    if (!isValid) {
      console.warn(`[doc-config] invalid value for "${key}" in ${originText}: ${JSON.stringify(valueDeclared)}`);
      continue;
    }
    configResolved.valueByKey[key] = value;
    configResolved.levelByKey[key] = level;
  }
}
