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
// page-scoped keys are read only at level 2. a feature with an inline form
// (for example a link title marker) applies it after level 5 by itself.
//
// configModel: {
//   configGlobal          key -> value, levels 1-2
//   levelGlobalByKey      key -> level
//   configByDocPath       docPath -> { valueByKey, levelByKey }, levels 1-5
// }
export function configModelBuild({
  configDefineByKey,
  configDoc,
  fileManifest = [],
  declarationListSidePanel = [],
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
      valueByKey: { ...configGlobal },
      levelByKey: { ...levelGlobalByKey },
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
    configByDocPath.set(docPath, configResolved);
  }

  return { configGlobal, levelGlobalByKey, configByDocPath };
}

function configLevelApply(configResolved, configDeclared, { configDefineByKey, level, originText }) {
  if (!configDeclaredIs(configDeclared)) return;
  for (const [key, valueDeclared] of Object.entries(configDeclared)) {
    const define = configDefineByKey.get(key);
    if (!define) {
      console.warn(`[doc-config] unknown config key "${key}" in ${originText}`);
      continue;
    }
    if (define.scope === 'page' && level !== 'global') {
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
