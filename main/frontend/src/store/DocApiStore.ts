import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import {
  API_CODE_FAILED,
  API_CODE_OK,
  API_CODE_PARAMS,
  API_CODE_TIMEOUT,
  API_CODE_UNAVAILABLE,
  API_CODE_UNKNOWN,
  apiAvailabilityGet,
  apiInfoBuild,
  apiParamsCheck,
  apiResultNormalize,
  apiWithIdBuild,
} from '../lib/doc-api.js';
import { compDefinitionNormalize } from '../../../comp-doc/registry/comp-registry.js';
import { compApiListGet } from '../../../comp-doc/registry/comp-expose.js';

// The unified api registry of the page (design: doc_page_impl_api.md). One
// place knows every api the page offers now and runs every call, whoever
// asks: the command palette, a hotkey, a caller outside the page through
// the development server, the host application, or another api.
//
//   apiByIdStatic   the registry built from the layers when the page starts
//                   (DocPageMdx: the package's apis, the apis the doc pages
//                   declare in yaml, the host's config.apiById)
//   providerList    the dynamic sources: each answers the apis it offers
//                   now (the components of the registry expose apis; the
//                   service instances of the backend do while they run).
//                   an api of a provider comes and goes with its source,
//                   which is why a hotkey bound to it is hidden rather than
//                   broken while the source is away (doc_page_impl_api_hotkey.md)
//   apiById         everything registered now, static then providers
//   contextBuild    what every api receives: where the reader is
//                   (workspace, doc page, document, block), the state of the
//                   page, the stores, and a way to call other apis
//   call            the one entry of every call: the api found, available,
//                   its params checked, run within its timeout, the result
//                   normalized and recorded
//   remote          the bridge to the development server: requests arrive
//                   through the HMR socket (subscribe), answers go back
//                   (send); the server pairs them by requestId
//                   (plugin/doc-api-server.ts)
//   notice          one line the page shows for a moment: the message of a
//                   failed call from a hotkey or the palette

export type ApiPrincipal = { kind: 'palette' | 'hotkey' | 'remote' | 'host' | 'api' | 'component' | 'test'; id?: string };
export type ApiResult = { code: number; data?: any; message: string };
export type ApiProvider = { name: string; apiByIdGet: () => Record<string, any> };
export type ApiCallRecord = { time: number; id: string; principal: ApiPrincipal; code: number; message: string; durationMs: number; params: any };
export type ApiNotice = { time: number; text: string; isError: boolean };
export type ApiRemoteOptions = {
  endpoint?: string;
  subscribe?: (listener: (request: any) => void) => () => void;
  send?: (event: string, data: any) => void;
};

const CALL_RECORD_MAX = 50;
const CALL_DEPTH_MAX = 8;
const NOTICE_MS = 4000;

export class DocApiStore {
  apiByIdStatic: Record<string, any> = {};
  providerList: ApiProvider[] = [];
  callRecordList: ApiCallRecord[] = [];
  notice: ApiNotice | undefined = undefined;
  // the page as the development server knows it: a random id of this load
  pageId = pageIdBuild();
  remoteEndpoint = '';
  remoteSubscribe: ApiRemoteOptions['subscribe'];
  remoteSend: ApiRemoteOptions['send'];
  remoteUnsubscribe: (() => void) | undefined;
  remoteRequestCount = 0;
  // the stores of the page, given once they all exist (storesSet)
  stores: any = {};
  // what only a React context can do (opening the search dialog): set by
  // the component that has the context, read by an api
  uiHandleByName: Record<string, (...args: any[]) => any> = {};
  noticeTimer: ReturnType<typeof setTimeout> | undefined;
  reactionDisposeList: (() => void)[] = [];

  constructor({ apiById = {}, remote = {} }: { apiById?: Record<string, any>; remote?: ApiRemoteOptions } = {}) {
    this.apiByIdStatic = apiById;
    this.remoteEndpoint = String(remote.endpoint ?? '');
    this.remoteSubscribe = typeof remote.subscribe === 'function' ? remote.subscribe : undefined;
    this.remoteSend = typeof remote.send === 'function' ? remote.send : undefined;
    makeAutoObservable(this, {
      apiByIdStatic: observable.ref,
      providerList: observable.shallow,
      callRecordList: observable.shallow,
      notice: observable.ref,
      pageId: false,
      remoteEndpoint: false,
      remoteSubscribe: false,
      remoteSend: false,
      remoteUnsubscribe: false,
      stores: false,
      uiHandleByName: false,
      noticeTimer: false,
      reactionDisposeList: false,
    });
  }

  storesSet(stores: any) {
    this.stores = stores;
  }

  init() {
    this.providerAdd({ name: 'component', apiByIdGet: () => this.compApiByIdBuild() });
    this.remoteAttach();
  }

  dispose() {
    this.remoteUnsubscribe?.();
    this.remoteUnsubscribe = undefined;
    for (const disposeOne of this.reactionDisposeList) disposeOne();
    this.reactionDisposeList = [];
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
  }

  // ---------- the registry ----------

  replaceApiById(apiById: Record<string, any>) {
    this.apiByIdStatic = apiById ?? {};
  }

  providerAdd(provider: ApiProvider) {
    this.providerList = [...this.providerList.filter((item) => item.name !== provider.name), provider];
  }

  providerRemove(name: string) {
    this.providerList = this.providerList.filter((item) => item.name !== name);
  }

  // the static layers, then what every provider offers now; an id a
  // provider repeats is kept as registered first, with a warning
  get apiById(): Record<string, any> {
    const apiById: Record<string, any> = { ...this.apiByIdStatic };
    for (const provider of this.providerList) {
      let apiByIdProvider: Record<string, any> = {};
      try {
        apiByIdProvider = provider.apiByIdGet() ?? {};
      } catch (error) {
        console.warn(`[doc-api] provider ${provider.name} failed`, error);
        continue;
      }
      for (const [id, definition] of Object.entries(apiByIdProvider)) {
        if (apiById[id]) {
          console.warn(`[doc-api] ${id}: registered already; the one of provider ${provider.name} is left out`);
          continue;
        }
        apiById[id] = definition;
      }
    }
    return apiById;
  }

  get apiList(): any[] {
    return Object.values(this.apiById).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  apiGet(id: string): any {
    return this.apiById[String(id ?? '')];
  }

  apiExists(id: string): boolean {
    return this.apiGet(id) !== undefined;
  }

  // the apis the components of the registry expose
  // (doc_page_impl_mdx_comp.md#what-a-component-exposes, expose.apiList),
  // under {compId}/{name}; run receives context.comp = { compId, definition }
  private compApiByIdBuild(): Record<string, any> {
    const apiById: Record<string, any> = {};
    const compById = this.stores.docStore?.compById ?? {};
    for (const [compId, value] of Object.entries(compById)) {
      const definition = compDefinitionNormalize(value);
      if (!definition) continue;
      for (const api of compApiListGet(definition)) {
        const id = `${compId}/${api.name}`;
        if (apiById[id]) {
          console.warn(`[doc-api] ${id}: the component exposes two apis named ${api.name}; the first is kept`);
          continue;
        }
        apiById[id] = apiWithIdBuild(id, {
          ...api,
          category: api.category || compId,
          run: (context: any, params: any) => api.run({ ...context, comp: { compId, definition } }, params),
          isAvailable: api.isAvailable ? (context: any) => api.isAvailable({ ...context, comp: { compId, definition } }) : undefined,
        });
      }
    }
    return apiById;
  }

  // ---------- the context ----------

  // what an api is given: the levels of where the reader is, the state of
  // the page, the stores, and the means to call another api or to report
  // through the event layer. built for every call, read inside a computed
  // where the palette lists the apis, so it follows the stores
  contextBuild(principal: ApiPrincipal = { kind: 'api' }, depth = 0): any {
    const { docStore, sourceStore, editStore, envStore, blockSelectStore, configStore, paletteStore, blockPopupStore, eventRouter, onEvent } = this.stores;
    const docPath: string = docStore?.docCurrentPath ?? '';
    const entry = docPath ? sourceStore?.entryByInternalPath.get(docPath) : undefined;
    const docPageAlias: string = docStore?.docPageCurrentAlias ?? '';
    const docPage = (sourceStore?.docPageList ?? []).find((item: any) => item.alias === docPageAlias);
    const session = editStore?.session;
    const blockIndexListAt: number[] = session?.type === 'block' && session.path === docPath
      ? [session.blockIndex]
      : blockSelectStore?.blockIndexListCurrentGet(docPath) ?? [];
    const blockAt = blockIndexListAt.length > 0 ? editStore?.docEditGet(docPath)?.model?.blockList[blockIndexListAt[0]] : undefined;
    const context: any = {
      principal,
      page: {
        envKind: envStore?.kind ?? '',
        isEditAvailable: editStore?.isAvailable === true,
        isEditMode: editStore?.isEditMode === true,
        isBlockSelectMode: editStore?.isBlockSelectMode === true,
        isSessionOpen: editStore?.isSessionOpen === true,
        isSettingsOpen: configStore?.isSettingsOpen === true,
        isPaletteOpen: paletteStore?.isOpen === true,
        isBlockPopupOpen: blockPopupStore?.isOpen === true,
        language: docStore?.languageDisplay ?? '',
      },
      workspace: {
        title: sourceStore?.configDoc?.siteTitle ?? '',
        aliasMain: sourceStore?.docPageAliasMain ?? '',
        docPageList: (sourceStore?.docPageList ?? []).map((item: any) => ({ alias: item.alias, title: item.title, isRoot: item.isRoot, dirPage: item.dirPage })),
      },
      docPage: docPage ? { alias: docPage.alias, title: docPage.title, dirPage: docPage.dirPage } : { alias: docPageAlias, title: '', dirPage: '' },
      doc: docPath ? {
        path: docPath,
        title: entry?.title ?? docStore?.itemCurrent?.text ?? '',
        ext: entry?.ext ?? '',
        hash: editStore?.docEditGet(docPath)?.hash ?? '',
      } : undefined,
      block: blockAt ? {
        index: blockIndexListAt[0],
        kind: blockAt.kind,
        compName: blockAt.component?.compName ?? '',
        id: blockAt.component?.props?.id ?? '',
      } : undefined,
      selection: { blockIndexList: blockIndexListAt },
      stores: this.stores,
      apiExists: (id: string) => this.apiExists(id),
      call: (id: string, params?: any) => this.call(id, params, { principal: { kind: 'api', id: principal.kind }, depth: depth + 1 }),
      // a report through the event layer, as a component's would be, with
      // the placement 'api' and the principal in its source
      // (doc_page_impl_event.md): the host application sees it first
      eventDispatch: (type: string, data: any = {}, source: any = {}) => {
        if (!eventRouter) return Promise.resolve({ code: -2, message: 'no event router' });
        const event = eventRouter.eventBuild({ type, data, source: { placement: 'api', principal, sourcePath: docPath, ...source } });
        return eventRouter.dispatch(event, { onEventHost: onEvent });
      },
      uiHandleGet: (name: string) => this.uiHandleByName[name],
    };
    return context;
  }

  // the context as a caller outside the page sees it (no stores, no functions)
  contextInfoBuild(principal: ApiPrincipal = { kind: 'remote' }) {
    const context = this.contextBuild(principal);
    return {
      principal: context.principal,
      page: context.page,
      workspace: context.workspace,
      docPage: context.docPage,
      doc: context.doc,
      block: context.block,
      selection: context.selection,
      pageId: this.pageId,
    };
  }

  uiHandleSet(name: string, handle: ((...args: any[]) => any) | undefined) {
    if (handle) this.uiHandleByName[name] = handle;
    else delete this.uiHandleByName[name];
  }

  availabilityGet(id: string, context?: any): { isAvailable: boolean; reason: string } {
    const definition = this.apiGet(id);
    if (!definition) return { isAvailable: false, reason: `${id} is not registered` };
    return apiAvailabilityGet(definition, context ?? this.contextBuild());
  }

  // every api as a remote caller sees it, with whether it can run now
  apiInfoListGet(principal: ApiPrincipal = { kind: 'remote' }): any[] {
    const context = this.contextBuild(principal);
    const labelByApi = this.stores.hotkeyStore?.labelByApi;
    return this.apiList.map((definition) => ({
      ...apiInfoBuild(definition, apiAvailabilityGet(definition, context)),
      hotkey: labelByApi?.get(definition.id) ?? '',
    }));
  }

  // ---------- calls ----------

  // the one entry of every call. answers { code, data, message }:
  //   0   done (data: what the api answered)
  //   -1  the api refused or failed (message says why)
  //   -2  no such api
  //   -3  the api cannot run now (message: the reason)
  //   -4  the params are wrong
  //   -5  the api did not answer within its timeout
  async call(id: string, paramsGiven: any = {}, { principal = { kind: 'api' } as ApiPrincipal, depth = 0 } = {}): Promise<ApiResult> {
    const timeStart = Date.now();
    const result = await this.callRun(String(id ?? ''), paramsGiven, principal, depth);
    this.callRecord({ time: timeStart, id: String(id ?? ''), principal, code: result.code, message: result.message, durationMs: Date.now() - timeStart, params: paramsGiven });
    return result;
  }

  private async callRun(id: string, paramsGiven: any, principal: ApiPrincipal, depth: number): Promise<ApiResult> {
    if (depth > CALL_DEPTH_MAX) return { code: API_CODE_FAILED, message: `${id}: apis calling apis ${CALL_DEPTH_MAX} levels deep; a cycle?` };
    const definition = this.apiGet(id);
    if (!definition) return { code: API_CODE_UNKNOWN, message: `no api is registered as ${id || '(empty)'}` };
    const context = this.contextBuild(principal, depth);
    const availability = apiAvailabilityGet(definition, context);
    if (!availability.isAvailable) return { code: API_CODE_UNAVAILABLE, message: `${id}: ${availability.reason}` };
    const checked = apiParamsCheck(definition, paramsGiven);
    if (checked.message) return { code: API_CODE_PARAMS, message: `${id}: ${checked.message}` };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<ApiResult>((resolve) => {
        timer = setTimeout(() => resolve({ code: API_CODE_TIMEOUT, message: `${id} did not answer within ${definition.timeoutMs} ms` }), definition.timeoutMs);
      });
      const run = Promise.resolve().then(() => definition.run(context, checked.params)).then((value) => apiResultNormalize(value));
      return await Promise.race([run, timeout]);
    } catch (error: any) {
      return { code: API_CODE_FAILED, message: `${id} failed: ${String(error?.message ?? error)}` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private callRecord(record: ApiCallRecord) {
    runInAction(() => {
      this.callRecordList = [record, ...this.callRecordList].slice(0, CALL_RECORD_MAX);
    });
  }

  // ---------- the notice ----------

  noticeSet(text: string, isError = false) {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.notice = { time: Date.now(), text: String(text ?? ''), isError };
    this.noticeTimer = setTimeout(() => this.noticeClear(), NOTICE_MS);
  }

  noticeClear() {
    this.notice = undefined;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
  }

  // the result of a call made from the page's own ui (a hotkey, the
  // palette): a failure is shown, a message of a success too
  resultNotice(result: ApiResult) {
    if (result.code !== API_CODE_OK) this.noticeSet(result.message || `failed (${result.code})`, true);
    else if (result.message) this.noticeSet(result.message, false);
  }

  // ---------- the remote bridge ----------

  get isRemoteAvailable(): boolean {
    return this.remoteEndpoint !== '' && this.remoteSubscribe !== undefined && this.remoteSend !== undefined;
  }

  // the development server addresses this page by its id: every request
  // it forwards is answered through the same socket. the page says hello
  // when it attaches, when the socket of the server comes back, and when
  // the document changes (so the server's page list says where each is)
  private remoteAttach() {
    if (!this.isRemoteAvailable) return;
    this.remoteUnsubscribe = this.remoteSubscribe!((request: any) => {
      if (!request || (request.pageId && request.pageId !== this.pageId)) return;
      void this.remoteRequestHandle(request);
    });
    this.remoteHello();
    const { docStore, envStore } = this.stores;
    if (docStore) {
      this.reactionDisposeList.push(reaction(() => docStore.docCurrentPath, () => this.remoteHello()));
    }
    if (envStore) {
      this.reactionDisposeList.push(reaction(() => envStore.serverStatus, (status: string) => {
        if (status === 'connected') this.remoteHello();
      }));
    }
    if (typeof window !== 'undefined') {
      const byeHandle = () => this.remoteSend?.('doc-api-bye', { pageId: this.pageId });
      window.addEventListener('pagehide', byeHandle);
      this.reactionDisposeList.push(() => window.removeEventListener('pagehide', byeHandle));
    }
  }

  remoteHello() {
    if (!this.isRemoteAvailable) return;
    const { docStore, sourceStore } = this.stores;
    this.remoteSend!('doc-api-hello', {
      pageId: this.pageId,
      title: sourceStore?.configDoc?.siteTitle ?? '',
      docPath: docStore?.docCurrentPath ?? '',
      url: typeof window !== 'undefined' ? window.location.href : '',
      time: Date.now(),
    });
  }

  private async remoteRequestHandle(request: any) {
    const principal: ApiPrincipal = { kind: 'remote', id: String(request.principalId ?? '') };
    let result: ApiResult;
    try {
      if (request.kind === 'call') result = await this.call(request.api, request.params, { principal });
      else if (request.kind === 'list') result = { code: API_CODE_OK, data: { apiList: this.apiInfoListGet(principal) }, message: '' };
      else if (request.kind === 'context') result = { code: API_CODE_OK, data: this.contextInfoBuild(principal), message: '' };
      else result = { code: API_CODE_FAILED, message: `unknown request kind ${String(request.kind)}` };
    } catch (error: any) {
      result = { code: API_CODE_FAILED, message: String(error?.message ?? error) };
    }
    runInAction(() => {
      this.remoteRequestCount += 1;
    });
    this.remoteSend!('doc-api-response', { requestId: request.requestId, pageId: this.pageId, result: resultSerializable(result) });
  }
}

// a result that survives the socket: data that cannot be serialized is
// replaced by a message saying so
function resultSerializable(result: ApiResult): ApiResult {
  try {
    JSON.stringify(result.data);
    return result;
  } catch {
    return { code: result.code, data: undefined, message: `${result.message} (the data of the result cannot be serialized)`.trim() };
  }
}

// a random id of this page load: digits and lowercase letters
function pageIdBuild(): string {
  return Math.random().toString(36).slice(2, 12).padEnd(10, '0');
}
