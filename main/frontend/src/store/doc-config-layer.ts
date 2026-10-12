import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import { docEditApiCreate } from '../lib/doc-edit-api.js';
import { compIdBuiltinByName, compIdResolve } from '../../../comp-doc/registry/comp-registry.js';

// The config layers as the page reads and writes them. Design:
// doc_page_impl_config.md#config-layers
//
// A layer definition (lib/doc-config-define.js configLayerDefineList) says
// that a layer exists and how it is stored; a layer object here holds its
// values and knows how to change them. Every layer offers the same surface,
// so the settings panel and the config model treat them alike:
//
//   config          { Key: value } the page keys the layer declares
//   compConfig      { Comp: { Key: value } } the component keys it declares,
//                   Comp being a tag name (a yaml layer) or a component id
//                   (isCompKeyedById: a layer the page writes itself)
//   isWritable      values can be set now (the file layer: a development
//                   server answers the edit api); disabledReason says why not
//   isClearable     every value of the layer can be dropped at once (Reset)
//   request         the state of the last write: submitting, or an error
//                   with its message, shown by the settings panel
//   valueSet / compValueSet / clear   the writes; each answers { code, message }
//
// storage 'file'     ConfigLayerFile: config.yaml globalConfig / compConfig,
//                    read from configDoc, written through the edit api
//                    (POST config/value), which rewrites the file in place
//                    and keeps a backup; the new configuration comes back as
//                    data (doc-source-change), and until it does the layer
//                    shows the value it just wrote
// storage 'browser'  ConfigLayerBrowser: localStorage of this browser, one
//                    entry per layer and page

export type ConfigLayerDefine = {
  id: string;
  label: string;
  storage: 'file' | 'browser';
  isAboveDocLevels: boolean;
  description: string;
};

export type ConfigLayerResult = { code: number; message: string };
export type ConfigLayerRequest = { status: 'idle' | 'submitting' | 'error'; message: string };

export interface ConfigLayer {
  readonly define: ConfigLayerDefine;
  readonly id: string;
  readonly isCompKeyedById: boolean;
  readonly isWritable: boolean;
  readonly isClearable: boolean;
  readonly disabledReason: string;
  readonly config: Record<string, any>;
  readonly compConfig: Record<string, Record<string, any>>;
  readonly request: ConfigLayerRequest;
  valueSet(key: string, value: any): Promise<ConfigLayerResult>;
  compValueSet(compId: string, key: string, value: any): Promise<ConfigLayerResult>;
  clear(): Promise<ConfigLayerResult>;
  requestMessageClear(): void;
}

export type ConfigLayerOptions = {
  sourceStore: DocSourceStore;
  // the edit api of the development server; '' without one
  editEndpoint: string;
};

// the layer object of a definition, by its storage
export function configLayerCreate(define: ConfigLayerDefine, options: ConfigLayerOptions): ConfigLayer {
  if (define.storage === 'file') return new ConfigLayerFile(define, options);
  if (define.storage === 'browser') return new ConfigLayerBrowser(define, options);
  throw new Error(`[doc-config] unknown storage "${String((define as any).storage)}" of config layer "${define.id}"`);
}

// ---------- storage 'file': config.yaml ----------

type ConfigLayerFilePending = {
  // the configuration the values were written against; once the source
  // store holds another one, the written values are in it
  configDoc: any;
  config: Record<string, any>;
  compConfig: Record<string, Record<string, any>>;
};

export class ConfigLayerFile implements ConfigLayer {
  readonly define: ConfigLayerDefine;
  readonly isCompKeyedById = false;
  readonly isClearable = false;
  sourceStore: DocSourceStore;
  api: ReturnType<typeof docEditApiCreate> | undefined;
  request: ConfigLayerRequest = { status: 'idle', message: '' };
  pending: ConfigLayerFilePending | undefined = undefined;

  constructor(define: ConfigLayerDefine, options: ConfigLayerOptions) {
    this.define = define;
    this.sourceStore = options.sourceStore;
    this.api = options.editEndpoint ? docEditApiCreate(options.editEndpoint) : undefined;
    // pending holds a configDoc, which must stay a plain reference
    makeAutoObservable(this, { define: false, sourceStore: false, api: false, pending: observable.ref });
  }

  get id(): string {
    return this.define.id;
  }

  get isWritable(): boolean {
    return this.api !== undefined;
  }

  get disabledReason(): string {
    return this.isWritable ? '' : 'config.yaml is written by the development server only; this build cannot change it.';
  }

  // the values as config.yaml declares them (variables not expanded), with
  // what was just written while the new configuration is on its way
  get config(): Record<string, any> {
    const declared = mappingGet(this.sourceStore.configDoc?.globalConfig);
    const pending = this.pendingCurrentGet();
    return pending ? { ...declared, ...pending.config } : declared;
  }

  get compConfig(): Record<string, Record<string, any>> {
    const declared = mappingGet(this.sourceStore.configDoc?.compConfig);
    const pending = this.pendingCurrentGet();
    if (!pending) return declared;
    const result: Record<string, Record<string, any>> = { ...declared };
    for (const [compName, configPending] of Object.entries(pending.compConfig)) {
      result[compName] = { ...mappingGet(declared[compName]), ...configPending };
    }
    return result;
  }

  valueSet(key: string, value: any): Promise<ConfigLayerResult> {
    // the value is already there, or on its way: nothing to write (a field
    // may commit the same text twice, on the choice and on the blur after it)
    if (valueIsSame(this.config[key], value)) return Promise.resolve({ code: 0, message: '' });
    const valueBase = mappingGet(this.sourceStore.configDoc?.globalConfig)[key] ?? null;
    return this.write(['globalConfig', key], value, valueBase, (pending) => ({
      ...pending,
      config: { ...pending.config, [key]: value },
    }));
  }

  compValueSet(compId: string, key: string, value: any): Promise<ConfigLayerResult> {
    const compName = this.compNameGet(compId);
    if (compName === undefined) {
      return Promise.resolve({ code: -1, message: `no tag name of compRegistry maps to ${compId}; the key cannot be written` });
    }
    if (valueIsSame(this.compConfig[compName]?.[key], value)) return Promise.resolve({ code: 0, message: '' });
    const valueBase = mappingGet(mappingGet(this.sourceStore.configDoc?.compConfig)[compName])[key] ?? null;
    return this.write(['compConfig', compName, key], value, valueBase, (pending) => ({
      ...pending,
      compConfig: { ...pending.compConfig, [compName]: { ...(pending.compConfig[compName] ?? {}), [key]: value } },
    }));
  }

  clear(): Promise<ConfigLayerResult> {
    return Promise.resolve({ code: -1, message: 'config.yaml is not cleared from the page; remove the keys in the file' });
  }

  requestMessageClear(): void {
    if (this.request.status === 'error') this.request = { status: 'idle', message: '' };
  }

  // the tag name a component key is written under in config.yaml: the name
  // compConfig already uses for the component, else the first name of
  // compRegistry (or a built-in name) that maps to it
  compNameGet(compId: string): string | undefined {
    const configDoc = this.sourceStore.configDoc;
    for (const compName of Object.keys(mappingGet(configDoc?.compConfig))) {
      if (compIdResolve(configDoc, compName) === compId) return compName;
    }
    for (const [compName, compIdMapped] of Object.entries(mappingGet(configDoc?.compRegistry))) {
      if (compIdMapped === compId) return compName;
    }
    for (const [compName, compIdMapped] of Object.entries(compIdBuiltinByName)) {
      if (compIdMapped === compId && compIdResolve(configDoc, compName) === compId) return compName;
    }
    return undefined;
  }

  private pendingCurrentGet(): ConfigLayerFilePending | undefined {
    if (!this.pending) return undefined;
    // the configuration was reported again: it holds the written values now
    if (this.pending.configDoc !== this.sourceStore.configDoc) return undefined;
    return this.pending;
  }

  // one write through the edit api; on success the value is recorded as
  // pending (pendingWith builds the new pending from the current one)
  private async write(
    keyPath: string[],
    value: any,
    valueBase: any,
    pendingWith: (pending: ConfigLayerFilePending) => ConfigLayerFilePending,
  ): Promise<ConfigLayerResult> {
    if (!this.api) return { code: -1, message: this.disabledReason };
    if (this.request.status === 'submitting') return { code: -1, message: 'a value is being written; wait for it' };
    runInAction(() => {
      this.request = { status: 'submitting', message: '' };
    });
    const configDocBefore = this.sourceStore.configDoc;
    const result = await this.api.configValueApply({ keyPath, value, valueBase });
    runInAction(() => {
      if (result.code !== 0) {
        this.request = { status: 'error', message: result.message || 'The value was not written.' };
        return;
      }
      this.request = { status: 'idle', message: '' };
      const pendingCurrent = this.pendingCurrentGet() ?? { configDoc: configDocBefore, config: {}, compConfig: {} };
      this.pending = pendingWith(pendingCurrent);
    });
    return { code: result.code, message: result.message ?? '' };
  }
}

// ---------- storage 'browser': localStorage ----------

type ConfigLayerBrowserStored = {
  config: Record<string, any>;
  compConfig: Record<string, Record<string, any>>;
};

export class ConfigLayerBrowser implements ConfigLayer {
  readonly define: ConfigLayerDefine;
  readonly isCompKeyedById = true;
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

  valueSet(key: string, value: any): Promise<ConfigLayerResult> {
    this.config = { ...this.config, [key]: value };
    this.save();
    return Promise.resolve({ code: 0, message: '' });
  }

  compValueSet(compId: string, key: string, value: any): Promise<ConfigLayerResult> {
    this.compConfig = { ...this.compConfig, [compId]: { ...(this.compConfig[compId] ?? {}), [key]: value } };
    this.save();
    return Promise.resolve({ code: 0, message: '' });
  }

  clear(): Promise<ConfigLayerResult> {
    this.config = {};
    this.compConfig = {};
    this.save();
    return Promise.resolve({ code: 0, message: '' });
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
