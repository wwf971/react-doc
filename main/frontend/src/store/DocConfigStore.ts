import { makeAutoObservable } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocStore } from './DocStore.js';
import { configDefineByKeyBuild } from '../lib/doc-config-define.js';
import { configModelBuild } from '../lib/doc-config-model.js';

// Config service of the doc page. Design: doc_page_impl_config.md
// Page-level values come from config.yaml globalConfig; document-level values
// are resolved per document from global, source rules, side-panel nodes and
// frontmatter. Renderers ask here instead of reading any of those places.

export type ConfigLevel = 'default' | 'global' | 'source' | 'sidePanel' | 'doc';
export type ConfigDefine = {
  key: string;
  type: string;
  valueDefault: any;
  scope: 'page' | 'doc';
  valueList?: any[];
};

export class DocConfigStore {
  sourceStore: DocSourceStore;
  docStore: DocStore;
  configDefineByKey: Map<string, ConfigDefine>;
  // stable query object handed to registered components through config
  configService: Readonly<Record<string, (...args: any[]) => any>>;

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
    });
  }

  get configModel() {
    return configModelBuild({
      configDefineByKey: this.configDefineByKey,
      configDoc: this.sourceStore.configDoc,
      fileManifest: this.sourceStore.fileManifest,
      declarationListSidePanel: this.docStore.treeModel.configDeclarationList,
    });
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

  // which level decided the value: default | global | source | sidePanel | doc
  levelDocGet(docPath: string, key: string): ConfigLevel {
    const configResolved = this.configModel.configByDocPath.get(docPath);
    return configResolved?.levelByKey[key] ?? this.configModel.levelGlobalByKey[key];
  }
}
