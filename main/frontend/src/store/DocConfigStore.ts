import { makeAutoObservable } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import { compConfigDefineByCompIdBuild, configDefineByKeyBuild, configLayerDefineList } from '../lib/doc-config-define.js';
import { configModelBuild } from '../lib/doc-config-model.js';
import { compIdResolve } from '../../../comp-doc/registry/comp-registry.js';
import { configLayerCreate, type ConfigLayer, type ConfigLayerDefine, type ConfigLayerResult } from './doc-config-layer.js';

// Config service of the doc page. Design: doc_page_impl_config.md
// Page-level values come from the config layers (doc-config-layer.ts):
// config.yaml (global), the reader's values kept in the browser (client),
// stacked in the order of configLayerDefineList. Document-level values are
// resolved per document: the layers below the document levels, source
// rules, side-panel nodes, frontmatter, then the layers above. Renderers
// ask here instead of reading any of those places.
//
// Component-level keys (doc_page_impl_config.md#component-level-config) are
// declared by the registered components themselves (compDefine
// expose.meta.configDefineList) and resolved the same way under "compConfig"; a
// component receives its values in its config (RegisteredComp).
//
// The settings panel edits one layer at a time (settingsLayerId): it reads
// the values as they are with the layers up to that one applied
// (layerValueGet) and writes into that layer (layerValueSet).

// the level that decided a value: 'default', a layer id, 'source', 'sidePanel', 'doc'
export type ConfigLevel = string;
export type ConfigDefine = {
  key: string;
  type: string;
  valueDefault: any;
  scope: 'page' | 'doc';
  valueList?: any[];
  // type 'sourcePath': what the path names, for completion (lib/doc-source-complete.js)
  pathSpec?: { kind: 'dir' | 'file' | 'any'; extList?: string[]; rootIdList?: string[]; dirPath?: string };
  description?: string;
  isUserSettable?: boolean;
};

export type SettingsTabId = 'config' | 'compConfig' | 'assetStore';
const settingsTabIdList: SettingsTabId[] = ['config', 'compConfig', 'assetStore'];

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
  // component-level keys, or the folders of the asset store
  // (doc_page_impl_asset.md); kept while the panel is closed, so it opens
  // again where it was
  settingsTabId: SettingsTabId = 'config';
  // the config layer the Config and Component tabs show and write
  settingsLayerId: string;
  // settings item id -> the value the item had before its first successful
  // edit of the page session, as the panel item shows it. kept for the items
  // whose edits are reverted from the panel (keys of type sourcePath); an
  // edit back to that value drops the entry.
  settingsValueOriginalByItemId = new Map<string, any>();

  constructor(
    sourceStore: DocSourceStore,
    docStore: DocStore,
    options?: { configDefineList?: ConfigDefine[]; layerDefineList?: ConfigLayerDefine[]; editEndpoint?: string },
  ) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.configDefineByKey = configDefineByKeyBuild(options?.configDefineList ?? []);
    const layerDefineList: ConfigLayerDefine[] = options?.layerDefineList ?? (configLayerDefineList as ConfigLayerDefine[]);
    this.layerList = layerDefineList.map((define) => configLayerCreate(define, {
      sourceStore,
      editEndpoint: String(options?.editEndpoint ?? ''),
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

  // the page value of a key with the layers up to and including this one
  // applied: what the settings panel shows on the layer's tab
  layerValueGet(layerId: string, key: string): any {
    return this.configModel.configByLayerId.get(layerId)?.valueByKey[key];
  }

  // the layer itself declares the key (the value shown is its own)
  layerIsDeclaring(layerId: string, key: string): boolean {
    return this.configModel.configByLayerId.get(layerId)?.levelByKey[key] === layerId;
  }

  layerCompValueGet(layerId: string, compId: string, key: string): any {
    return this.configModel.compConfigByLayerId.get(layerId)?.get(compId)?.valueByKey[key];
  }

  layerCompIsDeclaring(layerId: string, compId: string, key: string): boolean {
    return this.configModel.compConfigByLayerId.get(layerId)?.get(compId)?.levelByKey[key] === layerId;
  }

  // the layer holds any value of its own (Reset has something to do)
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

  layerClear(layerId: string): Promise<ConfigLayerResult> {
    const layer = this.layerGet(layerId);
    if (!layer) return Promise.resolve({ code: -1, message: `unknown config layer ${layerId}` });
    return layer.clear();
  }

  // ----- settings panel state -----

  settingsOpenSet(isOpen: boolean): void {
    this.isSettingsOpen = isOpen;
  }

  settingsTabIdSet(tabId: string): void {
    this.settingsTabId = settingsTabIdList.includes(tabId as SettingsTabId) ? (tabId as SettingsTabId) : 'config';
  }

  settingsLayerIdSet(layerId: string): void {
    if (this.layerGet(layerId)) this.settingsLayerId = layerId;
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

  // which level decided the value: default | a layer id | source | sidePanel | doc
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
