import { COMP_CONFIG_KEY, configDeclaredIs, configValueNormalize, variableExpand } from './doc-config-define.js';

// Resolves every config declaration of the doc page into one config model.
// Design: doc_page_impl_config.md
//
// value of key K for document D, later levels win:
//   1. default        definition valueDefault
//   2. layers below   the config layers with isAboveDocLevels false, in order
//                     (global: configDoc.globalConfig.K)
//   3. source         source rules that collected D, in rule order   (manifest entry.configSource)
//   4. side panel     side-panel nodes binding D or a folder above D, in tree order
//   5. doc            frontmatter "config" of D                     (manifest entry.configFrontmatter)
//   6. layers above   the config layers with isAboveDocLevels true, in order
//                     (client: the reader's values kept in the browser)
// page-scoped keys are read at the layer levels only (2 and 6). a feature
// with an inline form (for example a link title marker) applies it after
// level 6 by itself.
//
// a layer is { id, config, compConfig, isCompKeyedById, isAboveDocLevels }:
// config is { K: value } of the page keys, compConfig { Comp: { K: value } }
// of the component keys, Comp being a component's tag name (a yaml layer;
// compIdResolve turns it into the component id) or the component id itself
// (isCompKeyedById, a layer the page writes).
//
// component-level keys (doc_page_impl_config.md#component-level-config) are
// resolved the same way, per component: the layers read their compConfig,
// levels 3-5 read the "compConfig" mapping inside the declared config.
//
// a string value may hold ${name}: it is replaced by configDoc.variable[name]
// at every level (variableExpand).
//
// part index level: side-panel part.index.config, applied over the config of
// the index document only while the index is hosted in the local-index area.
// it is kept apart from configByDocPath, so the same document rendered as a
// page keeps levels 1-6. the layers above the document levels are applied
// over it too, for the keys it declares.
//
// configModel: {
//   configGlobal                key -> value, every layer (levels 1, 2 and 6)
//   levelGlobalByKey            key -> level
//   configByLayerId             layerId -> { valueByKey, levelByKey }, the layers up to and
//                               including this one: what the settings panel shows on its tab
//   configByDocPath             docPath -> { valueByKey, levelByKey }, levels 1-6
//   configPartIndexByPartId     partId -> { key: value }, only the keys declared
//   compConfigGlobalByCompId    compId -> { valueByKey, levelByKey }, every layer
//   compConfigByLayerId         layerId -> compId -> { valueByKey, levelByKey }, the layers up to this one
//   compConfigByDocPath         docPath -> compId -> { valueByKey, levelByKey }, levels 1-6
// }
export function configModelBuild({
  configDefineByKey,
  configDoc,
  layerList = [],
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
  const compOptions = { compConfigDefineByCompId, compIdResolve, variableByName };
  const layerListBelow = layerList.filter((layer) => !layer.isAboveDocLevels);
  const layerListAbove = layerList.filter((layer) => layer.isAboveDocLevels);

  // ----- page level: the default, then every layer in order -----
  const configGlobal = {};
  const levelGlobalByKey = {};
  for (const [key, define] of configDefineByKey) {
    configGlobal[key] = define.valueDefault;
    levelGlobalByKey[key] = 'default';
  }
  const configResolvedGlobal = { valueByKey: configGlobal, levelByKey: levelGlobalByKey };
  const compConfigGlobalByCompId = compConfigResolvedBuild(compConfigDefineByCompId);
  const configByLayerId = new Map();
  const compConfigByLayerId = new Map();
  for (const layer of layerList) {
    layerApply(configResolvedGlobal, compConfigGlobalByCompId, layer, { configDefineByKey, variableByName, ...compOptions });
    configByLayerId.set(layer.id, configResolvedCopy(configResolvedGlobal));
    compConfigByLayerId.set(layer.id, compConfigResolvedCopy(compConfigGlobalByCompId));
  }

  // ----- document level: the default and the layers below, then the document levels, then the layers above -----
  const configResolvedBase = { valueByKey: {}, levelByKey: {} };
  for (const [key, define] of configDefineByKey) {
    configResolvedBase.valueByKey[key] = define.valueDefault;
    configResolvedBase.levelByKey[key] = 'default';
  }
  const compConfigBaseByCompId = compConfigResolvedBuild(compConfigDefineByCompId);
  for (const layer of layerListBelow) {
    layerApply(configResolvedBase, compConfigBaseByCompId, layer, { configDefineByKey, variableByName, ...compOptions });
  }

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
    const configResolved = configResolvedCopy(configResolvedBase);
    const compConfigResolved = compConfigResolvedCopy(compConfigBaseByCompId);
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
    for (const layer of layerListAbove) {
      layerApply(configResolved, compConfigResolved, layer, { configDefineByKey, variableByName, ...compOptions });
    }
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
    // the layers above the document levels win over the part index
    // declaration as well, restricted to the keys the part index declared
    for (const layer of layerListAbove) {
      const configLayerDeclaredKeys = {};
      for (const key of Object.keys(configResolved.valueByKey)) {
        if (configDeclaredIs(layer.config) && layer.config[key] !== undefined) configLayerDeclaredKeys[key] = layer.config[key];
      }
      configLevelApply(configResolved, configLayerDeclaredKeys, layerOptionsBuild(layer, { configDefineByKey, variableByName }));
    }
    configPartIndexByPartId.set(declaration.partId, configResolved.valueByKey);
  }

  return {
    configGlobal,
    levelGlobalByKey,
    configByLayerId,
    configByDocPath,
    configPartIndexByPartId,
    compConfigGlobalByCompId,
    compConfigByLayerId,
    compConfigByDocPath,
  };
}

// ----- layers -----

function layerOptionsBuild(layer, { configDefineByKey, variableByName }) {
  return { configDefineByKey, variableByName, level: layer.id, originText: `the ${layer.id} config layer` };
}

// one layer applied to resolved page keys and component keys
function layerApply(configResolved, compConfigByCompId, layer, { configDefineByKey, variableByName, compConfigDefineByCompId, compIdResolve }) {
  const options = layerOptionsBuild(layer, { configDefineByKey, variableByName });
  if (layer.config !== undefined && !configDeclaredIs(layer.config)) {
    console.warn(`[doc-config] the config of ${options.originText} must be a mapping`);
  } else {
    configLevelApply(configResolved, layer.config ?? {}, options);
  }
  compConfigLevelApply(compConfigByCompId, layer.compConfig, {
    compConfigDefineByCompId,
    compIdResolve: layer.isCompKeyedById ? (compId) => compId : compIdResolve,
    variableByName,
    level: layer.id,
    originText: `${COMP_CONFIG_KEY} of ${options.originText}`,
  });
}

function configResolvedCopy(configResolved) {
  return { valueByKey: { ...configResolved.valueByKey }, levelByKey: { ...configResolved.levelByKey } };
}

function configLevelApply(configResolved, configDeclared, { configDefineByKey, variableByName, level, originText }) {
  if (!configDeclaredIs(configDeclared)) return;
  const isLayer = level !== 'source' && level !== 'sidePanel' && level !== 'doc' && level !== 'partIndex';
  for (const [key, valueDeclared] of Object.entries(configDeclared)) {
    // component-level values live under their own key (compConfigLevelApply)
    if (key === COMP_CONFIG_KEY) continue;
    const define = configDefineByKey.get(key);
    if (!define) {
      console.warn(`[doc-config] unknown config key "${key}" in ${originText}`);
      continue;
    }
    if (define.scope === 'page' && !isLayer) {
      console.warn(`[doc-config] "${key}" is a page-level key; set it in a config layer (globalConfig), not in ${originText}`);
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

// compConfigDeclared: { CompName: { Key: value } }, the component named as
// written in documents (or by its id, when compIdResolve is the identity)
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
