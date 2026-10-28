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
//   serverStatus   the development server was reachable when last heard of:
//                  'connected' | 'lost'. a page stays open when its server
//                  stops (the IDE that ran it closed): the files can no longer
//                  be written, so the page turns view-only. it is lost when
//                  the HMR socket of vite closes (config.env.serverSubscribe),
//                  when any call of the edit api cannot reach it, or when the
//                  probe made on returning to the tab gets no answer; while
//                  lost the probe repeats, and an answer brings it back
//   isCapable(c)   the environment offers capability c now
//   reasonGet(c)   why not ('' when it does), one wording for every place
//   editSuspendReasonGet()
//                  why editing, which this environment offers, is off now
//                  (server lost, edit api refused); '' otherwise. the edit
//                  toggle shows it as the view-only mark

export type DocEnvApi = 'source' | 'edit' | 'asset' | 'service';
export type DocEnvCapability = 'sourceWrite' | 'edit' | 'asset' | 'service' | 'devWarning';

// the capabilities whose api is served by the development server itself,
// lost with it. the service backend is a process of its own and reports its
// own state (DocServiceStore)
const capabilityOfServerList = ['sourceWrite', 'edit', 'asset'];

// how often an unreachable server is asked again, and how soon after a
// probe returning to the tab asks again
const serverPollMs = 4000;
const serverFocusCheckGapMs = 2000;

export type DocEnvServerSubscribe = (listener: (data: { isConnected: boolean }) => void) => () => void;

export type DocEnvOptions = {
  // { kind } as the virtual module exports it (docEnv), and serverSubscribe:
  // the connection of the development server (the virtual module's
  // subscribeDocServer, from the HMR socket); both optional
  env?: { kind?: string; serverSubscribe?: DocEnvServerSubscribe };
  endpointByApi?: Partial<Record<DocEnvApi, string>>;
};

export class DocEnvStore {
  kind: string;
  endpointByApi: Record<DocEnvApi, string>;
  editStatus: 'unchecked' | 'checking' | 'ok' | 'error' = 'unchecked';
  editStatusMessage = '';
  serverStatus: 'connected' | 'lost' = 'connected';
  serverLostMessage = '';
  isServerChecking = false;
  // stable query object handed to registered components as config.env
  envService: Readonly<Record<string, (...args: any[]) => any>>;
  serverSubscribe?: DocEnvServerSubscribe;
  serverUnsubscribe?: () => void;
  serverPollTimer?: ReturnType<typeof setTimeout>;
  serverCheckedAt = 0;
  focusListener?: () => void;

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
    this.serverSubscribe = typeof options.env?.serverSubscribe === 'function' ? options.env.serverSubscribe : undefined;
    this.envService = Object.freeze({
      kindGet: () => this.kind,
      isCapable: (capability: DocEnvCapability) => this.isCapable(capability),
      reasonGet: (capability: DocEnvCapability) => this.reasonGet(capability),
    });
    makeAutoObservable(this, {
      envService: false,
      endpointByApi: false,
      kind: false,
      serverSubscribe: false,
      serverUnsubscribe: false,
      serverPollTimer: false,
      serverCheckedAt: false,
      focusListener: false,
    });
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
    if (this.isServerLost && capabilityOfServerList.includes(capability)) {
      return `The development server is not reachable (${this.serverLostMessage}); the page is view-only until it is back.`;
    }
    if (capability === 'edit' && this.editStatus !== 'ok') {
      if (this.editStatus === 'error') return `The edit api does not answer: ${this.editStatusMessage}`;
      return 'The edit api is being asked whether it writes.';
    }
    return '';
  }

  get isServerLost(): boolean {
    return this.serverStatus === 'lost';
  }

  // editing is offered here (the kind and its endpoint) but off now; '' when
  // it is on, still being asked, or never offered (a built page shows no
  // trace of the edit layer)
  editSuspendReasonGet(): string {
    if (this.endpointGet('edit') === '') return '';
    if (!this.isServerLost && this.editStatus !== 'error') return '';
    return this.reasonGet('edit');
  }

  // asks the edit api whether it writes (the development server answers),
  // and starts watching whether the server stays reachable
  async init(): Promise<void> {
    const endpoint = this.endpointGet('edit');
    if (endpoint === '') return;
    this.watchStart();
    if (this.editStatus !== 'unchecked') return;
    this.editStatus = 'checking';
    await this.serverCheck();
  }

  dispose() {
    this.serverUnsubscribe?.();
    this.serverUnsubscribe = undefined;
    if (this.focusListener && typeof window !== 'undefined') {
      window.removeEventListener('focus', this.focusListener);
      document.removeEventListener('visibilitychange', this.focusListener);
    }
    this.focusListener = undefined;
    this.serverPollStop();
  }

  // the server could not be reached (a call failed on the network, the HMR
  // socket closed): the page is view-only until the next probe answers
  serverLostReport(message: string) {
    if (!this.isDevServer || this.endpointGet('edit') === '') return;
    this.serverStatus = 'lost';
    this.serverLostMessage = String(message || 'no answer');
    this.serverPollSchedule();
  }

  // asks the edit api's status; an answer means the server is there (and
  // says whether it writes), no answer means it is lost
  async serverCheck(): Promise<void> {
    const endpoint = this.endpointGet('edit');
    if (endpoint === '' || this.isServerChecking) return;
    this.isServerChecking = true;
    this.serverCheckedAt = Date.now();
    const result = await docEditApiCreate(endpoint).statusGet();
    runInAction(() => {
      this.isServerChecking = false;
      if (result.isUnreachable) {
        this.serverLostReport(result.message);
        return;
      }
      this.serverStatus = 'connected';
      this.serverLostMessage = '';
      this.serverPollStop();
      const isOk = result.code === 0 && result.data?.isWritable === true;
      this.editStatus = isOk ? 'ok' : 'error';
      this.editStatusMessage = isOk ? '' : String(result.message || 'no answer');
    });
  }

  watchStart() {
    if (this.isServerLost) this.serverPollSchedule();
    if (!this.serverUnsubscribe && this.serverSubscribe) {
      this.serverUnsubscribe = this.serverSubscribe(({ isConnected }) => {
        if (isConnected) void this.serverCheck();
        else this.serverLostReport('the connection to the development server closed');
      });
    }
    // returning to the tab (the IDE may have been closed meanwhile) asks again
    if (!this.focusListener && typeof window !== 'undefined') {
      this.focusListener = () => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - this.serverCheckedAt < serverFocusCheckGapMs) return;
        void this.serverCheck();
      };
      window.addEventListener('focus', this.focusListener);
      document.addEventListener('visibilitychange', this.focusListener);
    }
  }

  serverPollSchedule() {
    if (this.serverPollTimer) return;
    this.serverPollTimer = setTimeout(() => {
      this.serverPollTimer = undefined;
      if (this.isServerLost) void this.serverCheck();
    }, serverPollMs);
  }

  serverPollStop() {
    if (this.serverPollTimer) clearTimeout(this.serverPollTimer);
    this.serverPollTimer = undefined;
  }
}
