import { makeAutoObservable, observable } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import { configDefineByKeyBuild } from '../lib/doc-config-define.js';
import { configModelBuild } from '../lib/doc-config-model.js';

// Config service of the doc page. Design: doc_page_impl_config.md
// Page-level values come from config.yaml globalConfig; document-level values
// are resolved per document from global, source rules, side-panel nodes and
// frontmatter. The reader's own overrides from the settings panel (the user
// level) come last and live only for the page session. Renderers ask here
// instead of reading any of those places.

export type ConfigLevel = 'default' | 'global' | 'source' | 'sidePanel' | 'doc' | 'user';
export type ConfigDefine = {
  key: string;
  type: string;
  valueDefault: any;
  scope: 'page' | 'doc';
  valueList?: any[];
  description?: string;
  isUserSettable?: boolean;
};

export class DocConfigStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;
  configDefineByKey: Map<string, ConfigDefine>;
  // stable query object handed to registered components through config
  configService: Readonly<Record<string, (...args: any[]) => any>>;
  // key -> value set by the reader in the settings panel (the user level)
  configUserByKey: Record<string, any> = {};
  // the settings panel is open, and the button it was opened from (the
  // panel is placed under it)
  isSettingsOpen = false;
  settingsAnchorElement: HTMLElement | null = null;

  constructor(sourceStore: DocSourceStore, docStore: DocStore, options?: { configDefineList?: ConfigDefine[] }) {
    this.sourceStore = sourceStore;
    this.docStore = docStore;
    this.configDefineByKey = configDefineByKeyBuild(options?.configDefineList ?? []);
    this.configService = Object.freeze({
      configDefineListGet: () => [...this.configDefineByKey.values()],
      configDocGet: (docPath: string) => this.configDocGet(docPath),
      configGlobalGet: () => this.configGlobal,
      levelDocGet: (docPath: string, key: string) => this.levelDocGet(docPath, key),
      valueDocGet: (docPath: string, key: string) => this.valueDocGet(docPath, key),
      valueGlobalGet: (key: string) => this.valueGlobalGet(key),
    });
    makeAutoObservable(this, {
      configDefineByKey: false,
      configService: false,
      docStore: false,
      sourceStore: false,
      settingsAnchorElement: observable.ref,
    });
  }

  get configModel() {
    return configModelBuild({
      configDefineByKey: this.configDefineByKey,
      configDoc: this.sourceStore.configDoc,
      configUser: this.configUserByKey,
      fileManifest: this.sourceStore.fileManifest,
      declarationListSidePanel: this.docStore.treeModel.configDeclarationList,
      declarationListPartIndex: [...this.docStore.treeModel.partById.values()]
        .filter((part: any) => part.index?.config !== undefined)
        .map((part: any) => ({ partId: part.id, config: part.index.config })),
    });
  }

  // the defines the settings panel lists
  get configDefineListUserSettable(): ConfigDefine[] {
    return [...this.configDefineByKey.values()].filter((define) => define.isUserSettable !== false);
  }

  // ----- user level -----

  // the value the reader would see without an override of their own: the
  // page value of the key (document levels differ per document and are
  // shown at the page value in the settings panel)
  valueDeclaredGet(key: string): any {
    return this.configModel.configGlobalDeclared[key];
  }

  valueUserSet(key: string, value: any): void {
    if (!this.configDefineByKey.has(key)) return;
    this.configUserByKey = { ...this.configUserByKey, [key]: value };
  }

  valueUserClear(key: string): void {
    const { [key]: _valueCleared, ...configUserRest } = this.configUserByKey;
    this.configUserByKey = configUserRest;
  }

  configUserClear(): void {
    this.configUserByKey = {};
  }

  settingsOpenSet(isOpen: boolean, anchorElement: HTMLElement | null = null): void {
    this.isSettingsOpen = isOpen;
    this.settingsAnchorElement = isOpen ? anchorElement : null;
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

  // which level decided the value: default | global | source | sidePanel | doc | user
  levelDocGet(docPath: string, key: string): ConfigLevel {
    const configResolved = this.configModel.configByDocPath.get(docPath);
    return configResolved?.levelByKey[key] ?? this.configModel.levelGlobalByKey[key];
  }
}
