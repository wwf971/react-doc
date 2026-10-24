import { makeAutoObservable, runInAction } from 'mobx';
import { docEditApiCreate } from '../lib/doc-edit-api.js';
import { docEnvCapabilityDefineByName, docEnvKindDefineList, docEnvKindInfer } from '../lib/doc-env.js';

// The environment of the doc page: how it is served and what that allows.
// Design: doc_page_impl.md#the-environment
//
// The one place that answers "can this be done here". Stores, the settings
// panel and components ask isCapable(capability) and show reasonGet(capability)
// when not; the apis are reached through endpointGet(api), which is '' when
// the environment does not offer them. Registered components receive the
// same questions as config.env (envService).
//
//   kind           'viteDevServer' | 'staticBuild' (lib/doc-env.js), from the
//                  virtual module's docEnv, else inferred from the endpoints
//   editStatus     the edit api was asked whether it writes: 'unchecked' |
//                  'checking' | 'ok' | 'error'; "edit" is on only when 'ok'
//   isCapable(c)   the environment offers capability c now
//   reasonGet(c)   why not ('' when it does), one wording for every place

export type DocEnvApi = 'source' | 'edit' | 'asset' | 'service';
export type DocEnvCapability = 'sourceWrite' | 'edit' | 'asset' | 'service' | 'devWarning';

export type DocEnvOptions = {
  // { kind } as the virtual module exports it (docEnv); optional
  env?: { kind?: string };
  endpointByApi?: Partial<Record<DocEnvApi, string>>;
};

export class DocEnvStore {
  kind: string;
  endpointByApi: Record<DocEnvApi, string>;
  editStatus: 'unchecked' | 'checking' | 'ok' | 'error' = 'unchecked';
  editStatusMessage = '';
  // stable query object handed to registered components as config.env
  envService: Readonly<Record<string, (...args: any[]) => any>>;

  constructor(options: DocEnvOptions = {}) {
    const endpointByApi = options.endpointByApi ?? {};
    this.endpointByApi = {
      source: String(endpointByApi.source ?? ''),
      edit: String(endpointByApi.edit ?? ''),
      asset: String(endpointByApi.asset ?? ''),
      service: String(endpointByApi.service ?? ''),
    };
    const kindGiven = options.env?.kind;
    this.kind = typeof kindGiven === 'string' && docEnvKindDefineList.some((define) => define.kind === kindGiven)
      ? kindGiven
      : docEnvKindInfer(this.endpointByApi);
    this.envService = Object.freeze({
      kindGet: () => this.kind,
      isCapable: (capability: DocEnvCapability) => this.isCapable(capability),
      reasonGet: (capability: DocEnvCapability) => this.reasonGet(capability),
    });
    makeAutoObservable(this, { envService: false, endpointByApi: false, kind: false });
  }

  get kindDefine() {
    return docEnvKindDefineList.find((define) => define.kind === this.kind) ?? docEnvKindDefineList[docEnvKindDefineList.length - 1];
  }

  get kindLabel(): string {
    return this.kindDefine.label;
  }

  get isDevServer(): boolean {
    return this.kind === 'viteDevServer';
  }

  // the api of a capability, or '' when the environment does not offer it
  endpointGet(api: DocEnvApi): string {
    const isOffered = Object.entries(docEnvCapabilityDefineByName)
      .some(([capability, define]) => define.api === api && this.kindDefine.capabilityList.includes(capability));
    return isOffered ? this.endpointByApi[api] : '';
  }

  isCapable(capability: DocEnvCapability): boolean {
    return this.reasonGet(capability) === '';
  }

  reasonGet(capability: DocEnvCapability): string {
    const define = (docEnvCapabilityDefineByName as Record<string, { api: string; label: string }>)[capability];
    if (!define) return `unknown capability ${capability}`;
    if (!this.kindDefine.capabilityList.includes(capability)) {
      return `This page is a ${this.kindLabel}; ${define.label} is answered by the development server only.`;
    }
    if (define.api !== '' && this.endpointByApi[define.api as DocEnvApi] === '') {
      return `The page is not given the ${define.api} api; ${define.label} is not available.`;
    }
    if (capability === 'edit' && this.editStatus !== 'ok') {
      if (this.editStatus === 'error') return `The edit api does not answer: ${this.editStatusMessage}`;
      return 'The edit api is being asked whether it writes.';
    }
    return '';
  }

  // asks the edit api once whether it writes (the development server answers)
  async init(): Promise<void> {
    const endpoint = this.endpointGet('edit');
    if (endpoint === '' || this.editStatus !== 'unchecked') return;
    this.editStatus = 'checking';
    const result = await docEditApiCreate(endpoint).statusGet();
    runInAction(() => {
      const isOk = result.code === 0 && result.data?.isWritable === true;
      this.editStatus = isOk ? 'ok' : 'error';
      this.editStatusMessage = isOk ? '' : String(result.message || 'no answer');
    });
  }
}
