import { makeAutoObservable } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocEnvStore } from './DocEnvStore.js';
import type { DocStore } from './DocStore.js';
import { compConfigDefineByCompIdBuild, configDefineByKeyBuild, configLayerDefineList } from '../lib/doc-config-define.js';
import { configDeclaredCheck, configModelBuild } from '../lib/doc-config-model.js';
import { compIdBuiltinByName, compIdResolve } from '../../../comp-doc/registry/comp-registry.js';
import {
  configLayerCreate,
  type ConfigLayer,
  type ConfigLayerDeclaration,
  type ConfigLayerDefine,
  type ConfigLayerResult,
} from './doc-config-layer.js';

// Config service of the doc page. Design: doc_page_impl_config.md
// Page-level values come from the config layers (doc-config-layer.ts): the
// default config of the package (config.yaml configDefault), the config
// declarations of the doc page (its entry and the files it reaches), the
// reader's values kept in the browser (client), stacked in the order of
// configLayerDefineList. Document-level values are resolved per document:
// the layers below the document levels, source rules, side-panel nodes,
// frontmatter, then the layers above. Renderers ask here instead of reading
// any of those places.
//
// Component-level keys (doc_page_impl_config.md#component-level-config) are
// declared by the registered components themselves (compDefine
// expose.meta.configDefineList) and resolved the same way under "compConfig"; a
// component receives its values in its config (RegisteredComp).
//
// The settings panel shows one layer at a time (settingsLayerId), listing
// what the layer declares (layerItemListGet), not a full set of keys, or
// its declarations one by one (settingsIsDeclarationView,
// declarationItemListGet); a change is written into that layer or that
// declaration. The result tab (SETTINGS_RESULT_ID) lists the page values in
// effect with the level that decided each.

// the level that decided a value: 'default', a layer id, 'source', 'sidePanel', 'doc'
export type ConfigLevel = string;
export type ConfigDefine = {
  key: string;
  type: string;
  valueDefault: any;
  scope: 'page' | 'doc';
  valueList?: any[];
  // type 'sourcePath': what the path names, for completion (lib/doc-source-complete.js)
  pathSpec?: { kind: 'dir' | 'file' | 'any'; extList?: string[]; rootList?: string[]; dirPath?: string };
  description?: string;
  isUserSettable?: boolean;
};

export type SettingsTabId = 'config' | 'compConfig' | 'assetStore' | 'service' | 'workspace';
const settingsTabIdList: SettingsTabId[] = ['config', 'compConfig', 'assetStore', 'service', 'workspace'];

// the tab after the layer tabs: the values in effect. no layer has this id.
export const SETTINGS_RESULT_ID = 'result';

// one declared key as the settings panel lists it
export type ConfigItem = {
  key: string;
  // undefined for an unknown key
  define: ConfigDefine | undefined;
  // as written (variables not expanded)
  valueDeclared: any;
  // validated, variables expanded
  value: any;
  isValid: boolean;
  // why the key is not used, when it is not
  message: string;
  // where the value shown is written: a declaration label, 'built-in', ...
  origin: string;
};

// the edit mode of a layer edited per declaration: every declaration side by
// side (columns, in stack order: a later column wins), one row per key any
// of them declares. a cell holds the key as one declaration writes it, or
// nothing when that declaration does not declare it.
export type ConfigGridCell = {
  declarationId: string;
  // the component as this declaration names it (component rows only)
  compKey: string;
  item: ConfigItem | undefined;
};

export type ConfigGridRow = {
  key: string;
  define: ConfigDefine | undefined;
  cellList: ConfigGridCell[];
  // the declaration whose value the layer takes: the last one declaring a
  // valid value; '' when none does
  declarationIdDeciding: string;
};

export type ConfigGridColumn = { id: string; label: string; file: string; path: (string | number)[] };

// the component keys of one component in one declaration (or layer)
export type ConfigCompGroup = {
  // the component as the declaration names it: a tag name, or an id
  compKey: string;
  compId: string;
  // the name documents write it with ('' when no name maps to it)
  compName: string;
  itemList: ConfigItem[];
};

export class DocConfigStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;
  configDefineByKey: Map<string, ConfigDefine>;
  // the config layers in stack order (doc-config-layer.ts)
  layerList: ConfigLayer[];
  // stable query object handed to registered components through config
  configService: Readonly<Record<string, (...args: any[]) => any>>;
  // the settings panel is open (a centered popup; see DocSettingsPanel)
  isSettingsOpen = false;
  // the tab of the settings panel that is shown: the config keys, the
  // component-level keys, or the folders of the asset service layer
  // (doc_page_impl_asset.md); kept while the panel is closed, so it opens
  // again where it was
  settingsTabId: SettingsTabId = 'config';
  // the config layer the Config and Component tabs show and write, or
  // SETTINGS_RESULT_ID
  settingsLayerId: string;
  // the edit mode of a layer edited per declaration (isDeclarationViewOffered):
  // its declarations side by side instead of merged
  settingsIsDeclarationView = false;
  // settings item id -> the value the item had before its first successful
  // edit of the page session, as the panel item shows it. kept for the items
  // whose edits are reverted from the panel (keys of type sourcePath); an
  // edit back to that value drops the entry.
  settingsValueOriginalByItemId = new Map<string, any>();

  constructor(
    sourceStore: DocSourceStore,
    docStore: DocStore,
    options?: { configDefineList?: ConfigDefine[]; layerDefineList?: ConfigLayerDefine[]; envStore?: DocEnvStore },
  ) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.configDefineByKey = configDefineByKeyBuild(options?.configDefineList ?? []);
    const layerDefineList: ConfigLayerDefine[] = options?.layerDefineList ?? (configLayerDefineList as ConfigLayerDefine[]);
    this.layerList = layerDefineList.map((define) => configLayerCreate(define, {
      sourceStore,
      envStore: options?.envStore ?? sourceStore.envStore,
    }));
    // the panel opens on the last layer: the one whose values win
    this.settingsLayerId = this.layerList[this.layerList.length - 1]?.id ?? '';
    this.configService = Object.freeze({
      configDefineListGet: () => [...this.configDefineByKey.values()],
      configDocGet: (docPath: string) => this.configDocGet(docPath),
      configGlobalGet: () => this.configGlobal,
      levelDocGet: (docPath: string, key: string) => this.levelDocGet(docPath, key),
      valueDocGet: (docPath: string, key: string) => this.valueDocGet(docPath, key),
      valueGlobalGet: (key: string) => this.valueGlobalGet(key),
      compConfigGet: (compId: string, docPath: string) => this.compConfigGet(compId, docPath),
      compConfigDefineListGet: (compId: string) => this.compConfigDefineListGet(compId),
    });
    makeAutoObservable(this, {
      configDefineByKey: false,
      configService: false,
      docStore: false,
      sourceStore: false,
      layerList: false,
    });
  }

  // the keys the registered components declare; follows replaceCompById
  get compConfigDefineByCompId(): Map<string, Map<string, ConfigDefine>> {
    void this.docStore.compByIdVersion;
    return compConfigDefineByCompIdBuild(this.docStore.compById);
  }

  get configModel() {
    return configModelBuild({
      configDefineByKey: this.configDefineByKey,
      configDoc: this.sourceStore.configDoc,
      layerList: this.layerList.map((layer) => ({
        id: layer.id,
        config: layer.config,
        compConfig: layer.compConfig,
        isCompKeyedById: layer.isCompKeyedById,
        isAboveDocLevels: layer.define.isAboveDocLevels,
      })),
      fileManifest: this.sourceStore.fileManifest,
      declarationListSidePanel: this.docStore.treeModel.configDeclarationList,
      declarationListPartIndex: [...this.docStore.treeModel.partById.values()]
        .filter((part: any) => part.index?.config !== undefined)
        .map((part: any) => ({ partId: part.id, config: part.index.config })),
      compConfigDefineByCompId: this.compConfigDefineByCompId,
      compIdResolve: (compName: string) => compIdResolve(this.sourceStore.configDoc, compName),
    });
  }

  // the defines the settings panel lists
  get configDefineListUserSettable(): ConfigDefine[] {
    return [...this.configDefineByKey.values()].filter((define) => define.isUserSettable !== false);
  }

  // ----- layers -----

  layerGet(layerId: string): ConfigLayer | undefined {
    return this.layerList.find((layer) => layer.id === layerId);
  }

  get variableByName(): Record<string, string> {
    const variable = this.sourceStore.configDoc?.variable;
    return variable && typeof variable === 'object' && !Array.isArray(variable) ? variable : {};
  }

  // the page keys a layer declares, as its tab lists them. a layer declaring
  // every key (the default layer) lists every user-settable key with its
  // value there; another lists only what it declares, with the declaration
  // that decides each.
  layerItemListGet(layerId: string): ConfigItem[] {
    const layer = this.layerGet(layerId);
    if (!layer) return [];
    if (layer.define.isEveryKeyDeclared) {
      const resolved = this.configModel.configByLayerId.get(layerId);
      return this.configDefineListUserSettable.map((define) => ({
        key: define.key,
        define,
        valueDeclared: layer.config[define.key],
        value: resolved?.valueByKey[define.key],
        isValid: true,
        message: '',
        origin: define.key in layer.config ? layer.declarationList[0]?.label ?? layerId : 'built-in',
      }));
    }
    const declarationByKey = new Map<string, ConfigLayerDeclaration>();
    for (const declaration of layer.declarationList) {
      for (const key of Object.keys(declaration.config)) declarationByKey.set(key, declaration);
    }
    return this.itemListBuild(layer.config, this.configDefineByKey, (key) => declarationByKey.get(key)?.label ?? '');
  }

  // the page keys one declaration of a layer declares
  declarationItemListGet(layerId: string, declarationId: string): ConfigItem[] {
    const declaration = this.layerGet(layerId)?.declarationList.find((one) => one.id === declarationId);
    if (!declaration) return [];
    return this.itemListBuild(declaration.config, this.configDefineByKey, () => declaration.label);
  }

  // the component keys a layer declares, one group per component
  layerCompGroupListGet(layerId: string): ConfigCompGroup[] {
    const layer = this.layerGet(layerId);
    if (!layer) return [];
    if (layer.define.isEveryKeyDeclared) {
      const resolvedByCompId = this.configModel.compConfigByLayerId.get(layerId);
      const groupList: ConfigCompGroup[] = [];
      for (const compId of this.compIdListWithConfig) {
        const compName = this.compNameGet(compId);
        if (compName === '') continue;
        const configDeclared = this.compConfigOfCompIdGet(layer.compConfig, layer.isCompKeyedById, compId);
        const itemList = this.compConfigDefineListGet(compId)
          .filter((define) => define.isUserSettable !== false)
          .map((define) => ({
            key: define.key,
            define,
            valueDeclared: configDeclared[define.key],
            value: resolvedByCompId?.get(compId)?.valueByKey[define.key],
            isValid: true,
            message: '',
            origin: define.key in configDeclared ? layer.declarationList[0]?.label ?? layerId : 'built-in',
          }));
        if (itemList.length > 0) groupList.push({ compKey: compName, compId, compName, itemList });
      }
      return groupList;
    }
    const labelByCompKey = new Map<string, string>();
    for (const declaration of layer.declarationList) {
      for (const [compKey, config] of Object.entries(declaration.compConfig)) {
        for (const key of Object.keys(config ?? {})) labelByCompKey.set(`${compKey}\n${key}`, declaration.label);
      }
    }
    return this.compGroupListBuild(layer.compConfig, layer.isCompKeyedById, (compKey, key) => labelByCompKey.get(`${compKey}\n${key}`) ?? '');
  }

  declarationCompGroupListGet(layerId: string, declarationId: string): ConfigCompGroup[] {
    const layer = this.layerGet(layerId);
    const declaration = layer?.declarationList.find((one) => one.id === declarationId);
    if (!layer || !declaration) return [];
    return this.compGroupListBuild(declaration.compConfig, layer.isCompKeyedById, () => declaration.label);
  }

  // the columns of the edit mode: the layer's declarations in stack order
  layerGridColumnListGet(layerId: string): ConfigGridColumn[] {
    return (this.layerGet(layerId)?.declarationList ?? [])
      .map(({ id, label, file, path }) => ({ id, label, file, path }));
  }

  // the page-key rows of the edit mode
  layerGridRowListGet(layerId: string): ConfigGridRow[] {
    const layer = this.layerGet(layerId);
    if (!layer) return [];
    const itemListByDeclarationId = new Map(layer.declarationList.map((declaration) => (
      [declaration.id, this.declarationItemListGet(layerId, declaration.id)]
    )));
    return this.gridRowListBuild(layer.declarationList.map((declaration) => ({
      declarationId: declaration.id,
      compKey: '',
      itemList: itemListByDeclarationId.get(declaration.id) ?? [],
    })), (key) => this.configDefineByKey.get(key));
  }

  // the component-key rows of the edit mode, one group per component; a
  // component named differently by two declarations is one group
  layerGridCompGroupListGet(layerId: string): { compId: string; compName: string; rowList: ConfigGridRow[] }[] {
    const layer = this.layerGet(layerId);
    if (!layer) return [];
    const columnListByCompId = new Map<string, { declarationId: string; compKey: string; itemList: ConfigItem[] }[]>();
    for (const declaration of layer.declarationList) {
      for (const group of this.declarationCompGroupListGet(layerId, declaration.id)) {
        const columnList = columnListByCompId.get(group.compId) ?? [];
        columnList.push({ declarationId: declaration.id, compKey: group.compKey, itemList: group.itemList });
        columnListByCompId.set(group.compId, columnList);
      }
    }
    return [...columnListByCompId.entries()].map(([compId, columnList]) => {
      const defineByKey = this.compConfigDefineByCompId.get(compId);
      // every declaration is a column, also one that does not name the component
      const columnListFull = layer.declarationList.map((declaration) => (
        columnList.find((column) => column.declarationId === declaration.id)
          ?? { declarationId: declaration.id, compKey: '', itemList: [] }
      ));
      return {
        compId,
        compName: this.compNameGet(compId) || columnList[0]?.compKey || compId,
        rowList: this.gridRowListBuild(columnListFull, (key) => defineByKey?.get(key)),
      };
    });
  }

  // the user-settable page keys a layer that takes new keys does not declare yet
  layerKeyAddableListGet(layerId: string): ConfigDefine[] {
    const layer = this.layerGet(layerId);
    if (!layer?.isKeyAddable) return [];
    return this.configDefineListUserSettable.filter((define) => !(define.key in layer.config) && define.type !== 'any');
  }

  // the same for component keys: [{ compId, compName, define }]
  layerCompKeyAddableListGet(layerId: string): { compId: string; compName: string; define: ConfigDefine }[] {
    const layer = this.layerGet(layerId);
    if (!layer?.isKeyAddable) return [];
    const result: { compId: string; compName: string; define: ConfigDefine }[] = [];
    for (const compId of this.compIdListWithConfig) {
      const compName = this.compNameGet(compId);
      if (compName === '') continue;
      const configDeclared = this.compConfigOfCompIdGet(layer.compConfig, layer.isCompKeyedById, compId);
      for (const define of this.compConfigDefineListGet(compId)) {
        if (define.isUserSettable === false || define.type === 'any' || define.key in configDeclared) continue;
        result.push({ compId, compName, define });
      }
    }
    return result;
  }

  // the layer holds any value of its own (Clear cache has something to do)
  layerIsDeclaringAny(layerId: string): boolean {
    const layer = this.layerGet(layerId);
    if (!layer) return false;
    return Object.keys(layer.config).length > 0 || Object.keys(layer.compConfig).length > 0;
  }

  layerValueSet(layerId: string, key: string, value: any): Promise<ConfigLayerResult> {
    const layer = this.layerGet(layerId);
    if (!layer) return Promise.resolve({ code: -1, message: `unknown config layer ${layerId}` });
    if (!this.configDefineByKey.has(key)) return Promise.resolve({ code: -1, message: `unknown config key ${key}` });
    return layer.valueSet(key, value);
  }

  layerCompValueSet(layerId: string, compId: string, key: string, value: any): Promise<ConfigLayerResult> {
    const layer = this.layerGet(layerId);
    if (!layer) return Promise.resolve({ code: -1, message: `unknown config layer ${layerId}` });
    if (!this.compConfigDefineByCompId.get(compId)?.has(key)) {
      return Promise.resolve({ code: -1, message: `unknown component config key ${compId} ${key}` });
    }
    return layer.compValueSet(compId, key, value);
  }

  layerDeclarationValueSet(layerId: string, declarationId: string, key: string, value: any): Promise<ConfigLayerResult> {
    const layer = this.layerGet(layerId);
    if (!layer) return Promise.resolve({ code: -1, message: `unknown config layer ${layerId}` });
    return layer.declarationValueSet(declarationId, key, value);
  }

  layerDeclarationCompValueSet(layerId: string, declarationId: string, compKey: string, key: string, value: any): Promise<ConfigLayerResult> {
    const layer = this.layerGet(layerId);
    if (!layer) return Promise.resolve({ code: -1, message: `unknown config layer ${layerId}` });
    return layer.declarationCompValueSet(declarationId, compKey, key, value);
  }

  // a key added to a layer that takes new keys starts with the page value in effect
  layerKeyAdd(layerId: string, key: string): Promise<ConfigLayerResult> {
    return this.layerValueSet(layerId, key, this.valueGlobalGet(key));
  }

  layerCompKeyAdd(layerId: string, compId: string, key: string): Promise<ConfigLayerResult> {
    return this.layerCompValueSet(layerId, compId, key, this.compValueGlobalGet(compId, key));
  }

  layerValueRemove(layerId: string, key: string): Promise<ConfigLayerResult> {
    const layer = this.layerGet(layerId);
    if (!layer) return Promise.resolve({ code: -1, message: `unknown config layer ${layerId}` });
    return layer.valueRemove(key);
  }

  layerCompValueRemove(layerId: string, compId: string, key: string): Promise<ConfigLayerResult> {
    const layer = this.layerGet(layerId);
    if (!layer) return Promise.resolve({ code: -1, message: `unknown config layer ${layerId}` });
    return layer.compValueRemove(compId, key);
  }

  layerClear(layerId: string): Promise<ConfigLayerResult> {
    const layer = this.layerGet(layerId);
    if (!layer) return Promise.resolve({ code: -1, message: `unknown config layer ${layerId}` });
    return layer.clear();
  }

  // the name a component is written with in documents (config compRegistry
  // maps names to ids, then the built-in names); '' for an id no name maps to
  compNameGet(compId: string): string {
    const compRegistry = this.sourceStore.configDoc?.compRegistry ?? {};
    for (const [compName, compIdMapped] of Object.entries(compRegistry)) {
      if (compIdMapped === compId) return compName;
    }
    for (const [compName, compIdMapped] of Object.entries(compIdBuiltinByName)) {
      if (compIdMapped === compId && compRegistry[compName] === undefined) return compName;
    }
    return '';
  }

  // rows of the edit mode from the items of every column, keys in the order
  // they first appear from left to right
  private gridRowListBuild(
    columnList: { declarationId: string; compKey: string; itemList: ConfigItem[] }[],
    defineGet: (key: string) => ConfigDefine | undefined,
  ): ConfigGridRow[] {
    const keyList: string[] = [];
    for (const column of columnList) {
      for (const item of column.itemList) if (!keyList.includes(item.key)) keyList.push(item.key);
    }
    return keyList.map((key) => {
      const cellList = columnList.map((column) => ({
        declarationId: column.declarationId,
        compKey: column.compKey,
        item: column.itemList.find((item) => item.key === key),
      }));
      const cellDeciding = [...cellList].reverse().find((cell) => cell.item?.isValid);
      return { key, define: defineGet(key), cellList, declarationIdDeciding: cellDeciding?.declarationId ?? '' };
    });
  }

  private itemListBuild(
    configDeclared: Record<string, any>,
    defineByKey: Map<string, ConfigDefine>,
    originGet: (key: string) => string,
  ): ConfigItem[] {
    return configDeclaredCheck(configDeclared, { defineByKey, variableByName: this.variableByName })
      .map((checked: any) => ({ ...checked, define: defineByKey.get(checked.key), origin: originGet(checked.key) }));
  }

  private compGroupListBuild(
    compConfig: Record<string, Record<string, any>>,
    isCompKeyedById: boolean,
    originGet: (compKey: string, key: string) => string,
  ): ConfigCompGroup[] {
    return Object.entries(compConfig).map(([compKey, config]) => {
      const compId = isCompKeyedById ? compKey : compIdResolve(this.sourceStore.configDoc, compKey);
      const defineByKey = this.compConfigDefineByCompId.get(compId) ?? new Map<string, ConfigDefine>();
      return {
        compKey,
        compId,
        compName: isCompKeyedById ? this.compNameGet(compId) : compKey,
        itemList: this.itemListBuild(config ?? {}, defineByKey, (key) => originGet(compKey, key)),
      };
    });
  }

  // the values a layer's compConfig declares for one component, whichever
  // way the layer names components
  private compConfigOfCompIdGet(compConfig: Record<string, Record<string, any>>, isCompKeyedById: boolean, compId: string): Record<string, any> {
    if (isCompKeyedById) return compConfig[compId] ?? {};
    const result: Record<string, any> = {};
    for (const [compName, config] of Object.entries(compConfig)) {
      if (compIdResolve(this.sourceStore.configDoc, compName) === compId) Object.assign(result, config);
    }
    return result;
  }

  // ----- settings panel state -----

  settingsOpenSet(isOpen: boolean): void {
    this.isSettingsOpen = isOpen;
  }

  settingsTabIdSet(tabId: string): void {
    this.settingsTabId = settingsTabIdList.includes(tabId as SettingsTabId) ? (tabId as SettingsTabId) : 'config';
  }

  settingsLayerIdSet(layerId: string): void {
    if (this.layerGet(layerId) || layerId === SETTINGS_RESULT_ID) this.settingsLayerId = layerId;
  }

  settingsIsDeclarationViewSet(isDeclarationView: boolean): void {
    this.settingsIsDeclarationView = isDeclarationView;
  }

  // undefined when the item has not been edited, or was edited back
  settingsValueOriginalGet(itemId: string): any {
    return this.settingsValueOriginalByItemId.get(itemId);
  }

  // an edit of a settings item was written: the value before it is the
  // original unless an earlier edit already recorded one
  settingsValueEditRecord(itemId: string, valueBefore: any, valueAfter: any): void {
    if (!this.settingsValueOriginalByItemId.has(itemId)) {
      this.settingsValueOriginalByItemId.set(itemId, valueBefore);
    }
    if (this.settingsValueOriginalByItemId.get(itemId) === valueAfter) {
      this.settingsValueOriginalByItemId.delete(itemId);
    }
  }

  // ----- queries -----

  // key -> value of the keys declared in part.index.config of one part. the
  // hosted index applies them over the config of its index document.
  configPartIndexOverrideGet(partId: string): Record<string, any> {
    return this.configModel.configPartIndexByPartId.get(partId) ?? {};
  }

  // key -> value of every key, at page level
  get configGlobal(): Record<string, any> {
    return this.configModel.configGlobal;
  }

  valueGlobalGet(key: string): any {
    return this.configModel.configGlobal[key];
  }

  // key -> value of every key, for one document. a path that is not a
  // collected document (for example an inline item route) gets page values.
  configDocGet(docPath: string): Record<string, any> {
    return this.configModel.configByDocPath.get(docPath)?.valueByKey ?? this.configModel.configGlobal;
  }

  valueDocGet(docPath: string, key: string): any {
    return this.configDocGet(docPath)[key];
  }

  // which level decided the value: a layer id (default, docPage, client) | source | sidePanel | doc
  levelDocGet(docPath: string, key: string): ConfigLevel {
    const configResolved = this.configModel.configByDocPath.get(docPath);
    return configResolved?.levelByKey[key] ?? this.configModel.levelGlobalByKey[key];
  }

  // ----- component-level keys -----

  // the keys a component declares, in declaration order; [] for a component
  // without any
  compConfigDefineListGet(compId: string): ConfigDefine[] {
    return [...(this.compConfigDefineByCompId.get(compId)?.values() ?? [])];
  }

  // the components that declare keys, with their ids
  get compIdListWithConfig(): string[] {
    return [...this.compConfigDefineByCompId.keys()];
  }

  // key -> value of the component's keys for one document ({} for a
  // component without keys); a path that is not a collected document gets
  // page values
  compConfigGet(compId: string, docPath = ''): Record<string, any> {
    const byCompId = this.configModel.compConfigByDocPath.get(docPath) ?? this.configModel.compConfigGlobalByCompId;
    return byCompId.get(compId)?.valueByKey ?? {};
  }

  compValueGlobalGet(compId: string, key: string): any {
    return this.configModel.compConfigGlobalByCompId.get(compId)?.valueByKey[key];
  }
}
