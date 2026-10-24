import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import type { DocEnvStore } from './DocEnvStore.js';
import { docEditApiCreate } from '../lib/doc-edit-api.js';

// The config layers as the page reads and writes them. Design:
// doc_page_impl_config.md#config-layers
//
// A layer definition (lib/doc-config-define.js configLayerDefineList) says
// that a layer exists and how it is stored; a layer object here holds its
// values and knows how to change them. A layer is a stack of declarations,
// mappings of config keys written in one place each (one for the default
// and the client layer, several for the doc page layer); later declarations
// win. Every layer offers the same surface, so the settings panel and the
// config model treat them alike:
//
//   declarationList  the declarations in stack order: { id, label, file, path,
//                    config, compConfig, isWritable }
//   config           { Key: value } the page keys the layer declares, merged
//   compConfig       { Comp: { Key: value } } the component keys, merged; Comp
//                    is a tag name (a yaml layer) or a component id
//                    (isCompKeyedById: a layer the page keeps itself)
//   isWritable       values can be set now; disabledReason says why not
//   isKeyAddable     keys can be added and removed from the page (a layer the
//                    page keeps itself); otherwise only declared keys change
//   isDeclarationViewOffered   the layer is edited per declaration: the
//                    settings panel shows it merged (display only) and, in its
//                    edit mode, every declaration side by side
//   isClearable      the layer can be dropped at once (clear)
//   request          the state of the last write: submitting, or an error
//                    with its message, shown by the settings panel
//   valueSet / compValueSet            a key of the layer as a whole, for a
//                    layer of one declaration (refused by a layer edited per
//                    declaration)
//   declarationValueSet / declarationCompValueSet   a key of one declaration
//   valueRemove / compValueRemove / clear
//   each write answers { code, message }
//
// storage 'package'   ConfigLayerPackage: config.yaml configDefault (with its
//                     local layer config.0.yaml), read from configDoc; the
//                     default config of the doc page package, never written
// storage 'docEntry'  ConfigLayerDocEntry: the config declarations of the doc
//                     page (configDoc.docEntry.configDeclarationList), written
//                     where the environment offers editing (DocEnvStore "edit")
//                     through the edit api (POST config/value), which rewrites
//                     the one value in place and keeps a backup; the new
//                     configuration comes back as data (doc-source-change), and
//                     until it does the layer shows the value it just wrote
// storage 'browser'   ConfigLayerBrowser: localStorage of this browser, one
//                     entry per layer and page

export type ConfigLayerDefine = {
  id: string;
  label: string;
  storage: 'package' | 'docEntry' | 'browser';
  isAboveDocLevels: boolean;
  isEveryKeyDeclared?: boolean;
  description: string;
};

export type ConfigLayerResult = { code: number; message: string };
export type ConfigLayerRequest = { status: 'idle' | 'submitting' | 'error'; message: string };

export type ConfigLayerDeclaration = {
  id: string;
  // where it is written, as the settings panel names it
  label: string;
  // relative to the config directory; '' when not kept in a file
  file: string;
  // yaml address of the declared mapping in the file
  path: (string | number)[];
  config: Record<string, any>;
  compConfig: Record<string, Record<string, any>>;
  isWritable: boolean;
};

export interface ConfigLayer {
  readonly define: ConfigLayerDefine;
  readonly id: string;
  readonly isCompKeyedById: boolean;
  readonly isWritable: boolean;
  readonly isKeyAddable: boolean;
  readonly isDeclarationViewOffered: boolean;
  readonly isClearable: boolean;
  readonly disabledReason: string;
  readonly declarationList: ConfigLayerDeclaration[];
  readonly config: Record<string, any>;
  readonly compConfig: Record<string, Record<string, any>>;
  readonly request: ConfigLayerRequest;
  valueSet(key: string, value: any): Promise<ConfigLayerResult>;
  compValueSet(compId: string, key: string, value: any): Promise<ConfigLayerResult>;
  declarationValueSet(declarationId: string, key: string, value: any): Promise<ConfigLayerResult>;
  // compKey: the component as the declaration names it (tag name or id)
  declarationCompValueSet(declarationId: string, compKey: string, key: string, value: any): Promise<ConfigLayerResult>;
  valueRemove(key: string): Promise<ConfigLayerResult>;
  compValueRemove(compId: string, key: string): Promise<ConfigLayerResult>;
  clear(): Promise<ConfigLayerResult>;
  requestMessageClear(): void;
}

export type ConfigLayerOptions = {
  sourceStore: DocSourceStore;
  // the environment of the page: whether files can be written, and the edit api
  envStore: Pick<DocEnvStore, 'isCapable' | 'reasonGet' | 'endpointGet'>;
};

// the layer object of a definition, by its storage
export function configLayerCreate(define: ConfigLayerDefine, options: ConfigLayerOptions): ConfigLayer {
  if (define.storage === 'package') return new ConfigLayerPackage(define, options);
  if (define.storage === 'docEntry') return new ConfigLayerDocEntry(define, options);
  if (define.storage === 'browser') return new ConfigLayerBrowser(define, options);
  throw new Error(`[doc-config] unknown storage "${String((define as any).storage)}" of config layer "${define.id}"`);
}

const RESULT_REFUSED = (message: string): Promise<ConfigLayerResult> => Promise.resolve({ code: -1, message });
const RESULT_OK: ConfigLayerResult = { code: 0, message: '' };

// ---------- storage 'package': config.yaml configDefault ----------

export class ConfigLayerPackage implements ConfigLayer {
  readonly define: ConfigLayerDefine;
  readonly isCompKeyedById = false;
  readonly isWritable = false;
  readonly isKeyAddable = false;
  readonly isDeclarationViewOffered = false;
  readonly isClearable = false;
  readonly request: ConfigLayerRequest = { status: 'idle', message: '' };
  readonly disabledReason = 'The default config comes with the doc page package (config.yaml configDefault); it is not changed from the page.';
  sourceStore: DocSourceStore;

  constructor(define: ConfigLayerDefine, options: ConfigLayerOptions) {
    this.define = define;
    this.sourceStore = options.sourceStore;
    makeAutoObservable(this, { define: false, sourceStore: false, request: false });
  }

  get id(): string {
    return this.define.id;
  }

  get declarationList(): ConfigLayerDeclaration[] {
    const configDefault = mappingGet(this.sourceStore.configDoc?.configDefault);
    return [{
      id: 'configDefault',
      label: 'config.yaml configDefault',
      file: '',
      path: ['configDefault'],
      ...configSplit(configDefault),
      isWritable: false,
    }];
  }

  get config(): Record<string, any> {
    return this.declarationList[0].config;
  }

  get compConfig(): Record<string, Record<string, any>> {
    return this.declarationList[0].compConfig;
  }

  valueSet(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(this.disabledReason);
  }

  compValueSet(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(this.disabledReason);
  }

  declarationValueSet(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(this.disabledReason);
  }

  declarationCompValueSet(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(this.disabledReason);
  }

  valueRemove(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(this.disabledReason);
  }

  compValueRemove(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(this.disabledReason);
  }

  clear(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(this.disabledReason);
  }

  requestMessageClear(): void {}
}

// ---------- storage 'docEntry': the config declarations of the doc page ----------

type ConfigLayerDocEntryPending = {
  // the configuration the values were written against; once the source
  // store holds another one, the written values are in it
  configDoc: any;
  // declarationId -> what was written into it
  byDeclarationId: Record<string, { config: Record<string, any>; compConfig: Record<string, Record<string, any>> }>;
};

export class ConfigLayerDocEntry implements ConfigLayer {
  readonly define: ConfigLayerDefine;
  readonly isCompKeyedById = false;
  readonly isKeyAddable = false;
  readonly isDeclarationViewOffered = true;
  readonly isClearable = false;
  sourceStore: DocSourceStore;
  envStore: ConfigLayerOptions['envStore'];
  api: ReturnType<typeof docEditApiCreate> | undefined;
  request: ConfigLayerRequest = { status: 'idle', message: '' };
  pending: ConfigLayerDocEntryPending | undefined = undefined;

  constructor(define: ConfigLayerDefine, options: ConfigLayerOptions) {
    this.define = define;
    this.sourceStore = options.sourceStore;
    this.envStore = options.envStore;
    const endpoint = options.envStore.endpointGet('edit');
    this.api = endpoint ? docEditApiCreate(endpoint) : undefined;
    // pending holds a configDoc, which must stay a plain reference
    makeAutoObservable(this, { define: false, sourceStore: false, envStore: false, api: false, pending: observable.ref });
  }

  get id(): string {
    return this.define.id;
  }

  get isWritable(): boolean {
    return this.envStore.isCapable('edit');
  }

  get disabledReason(): string {
    return this.envStore.reasonGet('edit');
  }

  // the declarations as the files hold them (variables not expanded), with
  // what was just written while the new configuration is on its way
  get declarationList(): ConfigLayerDeclaration[] {
    const declaredList = this.sourceStore.configDoc?.docEntry?.configDeclarationList;
    if (!Array.isArray(declaredList)) return [];
    const pending = this.pendingCurrentGet();
    const dirPage = docPageDirGet(this.sourceStore.configDoc?.docEntry?.file);
    return declaredList.map((declared: any) => {
      const { config, compConfig } = configSplit(mappingGet(declared.config));
      const pendingOne = pending?.byDeclarationId[declared.id];
      const compConfigResult = { ...compConfig };
      for (const [compKey, configPending] of Object.entries(pendingOne?.compConfig ?? {})) {
        compConfigResult[compKey] = { ...mappingGet(compConfig[compKey]), ...configPending };
      }
      return {
        id: String(declared.id),
        label: `${fileLabelGet(String(declared.file), dirPage)} › ${(declared.path ?? []).join('.')}`,
        file: String(declared.file),
        path: Array.isArray(declared.path) ? declared.path : [],
        config: { ...config, ...(pendingOne?.config ?? {}) },
        compConfig: compConfigResult,
        isWritable: this.isWritable,
      };
    });
  }

  get config(): Record<string, any> {
    return Object.assign({}, ...this.declarationList.map((declaration) => declaration.config));
  }

  get compConfig(): Record<string, Record<string, any>> {
    const result: Record<string, Record<string, any>> = {};
    for (const declaration of this.declarationList) {
      for (const [compKey, config] of Object.entries(declaration.compConfig)) {
        result[compKey] = { ...(result[compKey] ?? {}), ...mappingGet(config) };
      }
    }
    return result;
  }

  // a key may be declared by several declarations: the one to write is
  // chosen in the edit mode of the settings panel, never guessed here
  valueSet(key: string): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(`${key} is written into one declaration of the doc page; choose it in the edit mode`);
  }

  compValueSet(_compId: string, key: string): Promise<ConfigLayerResult> {
    return RESULT_REFUSED(`${key} is written into one declaration of the doc page; choose it in the edit mode`);
  }

  declarationValueSet(declarationId: string, key: string, value: any): Promise<ConfigLayerResult> {
    const declaration = this.declarationList.find((one) => one.id === declarationId);
    if (!declaration) return RESULT_REFUSED(`unknown config declaration ${declarationId}`);
    if (!(key in declaration.config)) return RESULT_REFUSED(`${key} is not declared in ${declaration.label}`);
    if (valueIsSame(declaration.config[key], value)) return Promise.resolve(RESULT_OK);
    const valueBase = this.declaredValueGet(declarationId, [key]);
    return this.write(declaration, [key], value, valueBase, (pendingOne) => ({
      ...pendingOne,
      config: { ...pendingOne.config, [key]: value },
    }));
  }

  declarationCompValueSet(declarationId: string, compKey: string, key: string, value: any): Promise<ConfigLayerResult> {
    const declaration = this.declarationList.find((one) => one.id === declarationId);
    if (!declaration) return RESULT_REFUSED(`unknown config declaration ${declarationId}`);
    if (!(key in mappingGet(declaration.compConfig[compKey]))) {
      return RESULT_REFUSED(`${compKey}.${key} is not declared in ${declaration.label}`);
    }
    if (valueIsSame(declaration.compConfig[compKey][key], value)) return Promise.resolve(RESULT_OK);
    const valueBase = this.declaredValueGet(declarationId, [COMP_CONFIG_KEY, compKey, key]);
    return this.write(declaration, [COMP_CONFIG_KEY, compKey, key], value, valueBase, (pendingOne) => ({
      ...pendingOne,
      compConfig: { ...pendingOne.compConfig, [compKey]: { ...(pendingOne.compConfig[compKey] ?? {}), [key]: value } },
    }));
  }

  // TODO: adding and removing keys, and adding declarations, from the page
  valueRemove(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED('keys of the doc page are removed in its files');
  }

  compValueRemove(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED('keys of the doc page are removed in its files');
  }

  clear(): Promise<ConfigLayerResult> {
    return RESULT_REFUSED('the doc page config is not cleared from the page');
  }

  requestMessageClear(): void {
    if (this.request.status === 'error') this.request = { status: 'idle', message: '' };
  }

  // the value the file declares, as the configuration reported it: the base
  // the server checks the write against
  private declaredValueGet(declarationId: string, keyPath: string[]): any {
    const declaredList = this.sourceStore.configDoc?.docEntry?.configDeclarationList ?? [];
    let value: any = declaredList.find((declared: any) => declared.id === declarationId)?.config;
    for (const key of keyPath) value = mappingGet(value)[key];
    return value ?? null;
  }

  private pendingCurrentGet(): ConfigLayerDocEntryPending | undefined {
    if (!this.pending) return undefined;
    // the configuration was reported again: it holds the written values now
    if (this.pending.configDoc !== this.sourceStore.configDoc) return undefined;
    return this.pending;
  }

  // one write through the edit api; on success the value is recorded as
  // pending (pendingWith builds the declaration's new pending from its current one)
  private async write(
    declaration: ConfigLayerDeclaration,
    keyPathInside: string[],
    value: any,
    valueBase: any,
    pendingWith: (pendingOne: { config: Record<string, any>; compConfig: Record<string, Record<string, any>> }) => {
      config: Record<string, any>;
      compConfig: Record<string, Record<string, any>>;
    },
  ): Promise<ConfigLayerResult> {
    if (!this.api) return { code: -1, message: this.disabledReason };
    if (this.request.status === 'submitting') return { code: -1, message: 'a value is being written; wait for it' };
    runInAction(() => {
      this.request = { status: 'submitting', message: '' };
    });
    const configDocBefore = this.sourceStore.configDoc;
    const result = await this.api.configValueApply({
      file: declaration.file,
      keyPath: [...declaration.path, ...keyPathInside],
      value,
      valueBase,
    });
    runInAction(() => {
      if (result.code !== 0) {
        this.request = { status: 'error', message: result.message || 'The value was not written.' };
        return;
      }
      this.request = { status: 'idle', message: '' };
      const pendingCurrent = this.pendingCurrentGet() ?? { configDoc: configDocBefore, byDeclarationId: {} };
      const pendingOne = pendingCurrent.byDeclarationId[declaration.id] ?? { config: {}, compConfig: {} };
      this.pending = {
        ...pendingCurrent,
        byDeclarationId: { ...pendingCurrent.byDeclarationId, [declaration.id]: pendingWith(pendingOne) },
      };
    });
    return { code: result.code, message: result.message ?? '' };
  }
}

// ---------- storage 'browser': localStorage ----------

type ConfigLayerBrowserStored = {
  config: Record<string, any>;
  compConfig: Record<string, Record<string, any>>;
};

const DECLARATION_ID_BROWSER = 'browser';

export class ConfigLayerBrowser implements ConfigLayer {
  readonly define: ConfigLayerDefine;
  readonly isCompKeyedById = true;
  readonly isKeyAddable = true;
  readonly isDeclarationViewOffered = false;
  readonly isClearable = true;
  readonly isWritable = true;
  readonly disabledReason = '';
  readonly request: ConfigLayerRequest = { status: 'idle', message: '' };
  // the storage entry of this layer for this page
  storageKey: string;
  config: Record<string, any> = {};
  compConfig: Record<string, Record<string, any>> = {};

  constructor(define: ConfigLayerDefine, options: ConfigLayerOptions) {
    this.define = define;
    this.storageKey = storageKeyBuild(define.id, options.sourceStore.configDoc);
    const stored = storedRead(this.storageKey);
    this.config = stored.config;
    this.compConfig = stored.compConfig;
    makeAutoObservable(this, { define: false, storageKey: false, request: false });
  }

  get id(): string {
    return this.define.id;
  }

  get declarationList(): ConfigLayerDeclaration[] {
    return [{
      id: DECLARATION_ID_BROWSER,
      label: 'this browser',
      file: '',
      path: [],
      config: this.config,
      compConfig: this.compConfig,
      isWritable: true,
    }];
  }

  valueSet(key: string, value: any): Promise<ConfigLayerResult> {
    this.config = { ...this.config, [key]: value };
    this.save();
    return Promise.resolve(RESULT_OK);
  }

  compValueSet(compId: string, key: string, value: any): Promise<ConfigLayerResult> {
    this.compConfig = { ...this.compConfig, [compId]: { ...(this.compConfig[compId] ?? {}), [key]: value } };
    this.save();
    return Promise.resolve(RESULT_OK);
  }

  declarationValueSet(_declarationId: string, key: string, value: any): Promise<ConfigLayerResult> {
    return this.valueSet(key, value);
  }

  declarationCompValueSet(_declarationId: string, compKey: string, key: string, value: any): Promise<ConfigLayerResult> {
    return this.compValueSet(compKey, key, value);
  }

  valueRemove(key: string): Promise<ConfigLayerResult> {
    const { [key]: _removed, ...config } = this.config;
    this.config = config;
    this.save();
    return Promise.resolve(RESULT_OK);
  }

  compValueRemove(compId: string, key: string): Promise<ConfigLayerResult> {
    const { [key]: _removed, ...configComp } = this.compConfig[compId] ?? {};
    const { [compId]: _compRemoved, ...compConfig } = this.compConfig;
    this.compConfig = Object.keys(configComp).length > 0 ? { ...compConfig, [compId]: configComp } : compConfig;
    this.save();
    return Promise.resolve(RESULT_OK);
  }

  // "clear cache": every value dropped and the storage entry removed
  clear(): Promise<ConfigLayerResult> {
    this.config = {};
    this.compConfig = {};
    this.save();
    return Promise.resolve(RESULT_OK);
  }

  requestMessageClear(): void {}

  private save() {
    const storage = storageGet();
    if (!storage) return;
    const isEmpty = Object.keys(this.config).length === 0 && Object.keys(this.compConfig).length === 0;
    try {
      if (isEmpty) storage.removeItem(this.storageKey);
      else storage.setItem(this.storageKey, JSON.stringify({ config: this.config, compConfig: this.compConfig }));
    } catch (error) {
      console.warn(`[doc-config] the ${this.id} layer could not be saved: ${String((error as any)?.message ?? error)}`);
    }
  }
}

// "doc-config:{layerId}:{entry file}": one entry per layer and per document
// entry, so two pages served from one origin keep their own values
function storageKeyBuild(layerId: string, configDoc: any): string {
  const pageId = typeof configDoc?.docEntry?.file === 'string' ? configDoc.docEntry.file : 'page';
  return `doc-config:${layerId}:${pageId}`;
}

function storageGet(): Storage | undefined {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function storedRead(storageKey: string): ConfigLayerBrowserStored {
  const empty: ConfigLayerBrowserStored = { config: {}, compConfig: {} };
  const storage = storageGet();
  if (!storage) return empty;
  try {
    const text = storage.getItem(storageKey);
    if (!text) return empty;
    const parsed = JSON.parse(text);
    const compConfig: Record<string, Record<string, any>> = {};
    for (const [compId, configComp] of Object.entries(mappingGet(parsed?.compConfig))) {
      compConfig[compId] = mappingGet(configComp);
    }
    return { config: mappingGet(parsed?.config), compConfig };
  } catch {
    return empty;
  }
}

const COMP_CONFIG_KEY = 'compConfig';

// the folder of the doc page, from its entry file (relative to the config
// directory): the parent of .doc-page/ (doc_page_impl_dir.md), or the
// entry's own folder
function docPageDirGet(entryFile: unknown): string {
  if (typeof entryFile !== 'string') return '';
  const segList = entryFile.split('/').slice(0, -1);
  if (segList[segList.length - 1] === '.doc-page') segList.pop();
  return segList.length > 0 ? `${segList.join('/')}/` : '';
}

// a declaration's file as the settings panel names it: relative to the
// folder of the doc page when inside it
function fileLabelGet(file: string, dirPage: string): string {
  return dirPage !== '' && file.startsWith(dirPage) ? file.slice(dirPage.length) : file;
}

// a declared config mapping split into its page keys and its component keys
function configSplit(configDeclared: Record<string, any>): ConfigLayerBrowserStored {
  const { [COMP_CONFIG_KEY]: compConfigDeclared, ...config } = configDeclared;
  const compConfig: Record<string, Record<string, any>> = {};
  for (const [compKey, configComp] of Object.entries(mappingGet(compConfigDeclared))) {
    compConfig[compKey] = mappingGet(configComp);
  }
  return { config, compConfig };
}

// a plain mapping, or {} for anything else
function mappingGet(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

// two config values are the same: scalars by value, lists element by element
function valueIsSame(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}
