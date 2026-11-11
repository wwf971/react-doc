import { makeAutoObservable, observable, runInAction } from 'mobx';

// Routing a navigation (doc_page_impl_nav.md#routing-a-navigation). Following a link is a
// request; a route that takes it turns it into the call of an api with parameters, so every
// way of showing a target (the page's own navigation, the inline popup, what the owner of a
// registered document does) is an api of the unified registry, callable by anyone.
//
//   request   { target, hash, fromPath, param, owner?, route?, point? }
//               target   the full source path of what is to be shown
//               route    the side-panel route of the target when the link named one (@first/…)
//               param    the query of the link (?nav=…&…), nav naming one route
//               owner    who registered the target, when it is not a file of a folder
//   route     { id, apiGet(request) -> { api, params } | undefined }
//
// the routes, in the order they are asked (a route added by a layer comes before these):
//   owner   a target registered by a provider that named an api for it (ownerApiSet)
//   page    a target with a side-panel item: nav/goTo, the classic navigation
//   popup   another document: nav/popup, the inline popup
export type NavRequest = {
  target: string;
  hash: string;
  fromPath: string;
  param: Record<string, string>;
  owner?: { providerId: string; ref: string; key: string };
  route?: string;
  point?: { clientX: number; clientY: number };
};
export type NavRoute = { id: string; apiGet: (request: NavRequest) => { api: string; params: Record<string, any> } | undefined };
// where a reader was going when a popup opened a document standing for it (the home
// document of an object): what is rendered in the popup reads it (DocNavArrivalContext)
export type NavArrival = { target: string; hash: string; key: string; ref: string };

type Stores = { docStore: any; sourceStore: any };

export class DocNavStore {
  stores: Stores;
  apiCall: ((id: string, params: Record<string, any>) => Promise<{ code: number; message: string; data?: any }>) | undefined;
  routeList: NavRoute[] = [];
  ownerApiByProvider = new Map<string, string>();
  // the inline popup of the page: the document shown, the place in it, where the reader was going
  popup = { path: '', hash: '', arrival: undefined as NavArrival | undefined, version: 0, message: '' };
  // a popup can be shown: the host gave a panel and the popup of the page is mounted
  isPopupAvailable = false;

  constructor(stores: Stores) {
    this.stores = stores;
    this.routeList = [
      { id: 'owner', apiGet: (request) => this.ownerApiGet(request) },
      { id: 'page', apiGet: (request) => this.pageApiGet(request) },
      { id: 'popup', apiGet: (request) => this.popupApiGet(request) },
    ];
    makeAutoObservable(this, { stores: false, apiCall: false, routeList: false, ownerApiByProvider: false, popup: observable.ref });
  }

  // ---------- routes ----------

  // a route of a layer, asked before the page's own; returns its removal
  routeAdd(route: NavRoute): () => void {
    this.routeList = [route, ...this.routeList.filter((one) => one.id !== route.id)];
    return () => { this.routeList = this.routeList.filter((one) => one !== route); };
  }

  // the api that shows the documents a provider registered: called with { target, hash, fromPath }
  ownerApiSet(providerId: string, apiId: string) {
    this.ownerApiByProvider.set(providerId, apiId);
  }

  private ownerApiGet(request: NavRequest) {
    const owner = request.owner ?? this.stores.sourceStore.docOwnerGet?.(request.target);
    const api = owner ? this.ownerApiByProvider.get(owner.providerId) : undefined;
    return api ? { api, params: { target: request.target, hash: request.hash, fromPath: request.fromPath } } : undefined;
  }

  private pageApiGet(request: NavRequest) {
    const isAsked = request.param?.nav === 'page';
    if (!isAsked && !request.route && !this.stores.docStore.isDocNavigable(request.target)) return undefined;
    return { api: 'nav/goTo', params: { target: `${request.route ?? request.target}${request.hash ? `#${request.hash}` : ''}` } };
  }

  private popupApiGet(request: NavRequest) {
    if (!this.popupIsPossible(request.target)) return undefined;
    return { api: 'nav/popup', params: { target: request.target, hash: request.hash } };
  }

  // a document the popup can show: Markdown, or a file of a declared display
  popupIsPossible(path: string): boolean {
    const { sourceStore } = this.stores;
    const entry = sourceStore.entryByInternalPath.get(path);
    return Boolean(entry) && this.isPopupAvailable && (['md', 'mdx'].includes(entry.ext) || Object.hasOwn(sourceStore.configDoc?.fileDisplay ?? {}, entry.ext));
  }

  // the request offered to the routes: the first that takes it names an api, which is called;
  // its result is the answer. param.nav asks one route alone. undefined: no route took it
  async request(request: NavRequest): Promise<{ code: number; message: string; data?: any } | undefined> {
    const idAsked = request.param?.nav ?? '';
    const routeList = idAsked ? this.routeList.filter((route) => route.id === idAsked) : this.routeList;
    if (idAsked && routeList.length === 0) return { code: -1, message: `No navigation route is named "${idAsked}" (known: ${this.routeList.map((route) => route.id).join(', ')}).` };
    let resultFailed: { code: number; message: string; data?: any } | undefined;
    for (const route of routeList) {
      const call = route.apiGet(request);
      if (!call) continue;
      if (!this.apiCall) return { code: -1, message: 'The api registry is not available.' };
      const result = await this.apiCall(call.api, call.params);
      const answer = { ...result, data: { ...result.data, routeId: route.id, api: call.api } };
      if (result.code === 0) return answer;
      // a route that took the request and failed: the next one may still show the target
      resultFailed = answer;
    }
    if (resultFailed) return resultFailed;
    return idAsked ? { code: -1, message: `The route "${idAsked}" cannot show this target.` } : undefined;
  }

  // ---------- the inline popup (the api nav/popup) ----------

  popupAvailableSet(isAvailable: boolean) {
    this.isPopupAvailable = isAvailable;
  }

  async popupOpen({ target, hash = '', arrival }: { target: string; hash?: string; arrival?: NavArrival }): Promise<{ code: number; message: string; data?: any }> {
    const { sourceStore } = this.stores;
    if (!this.isPopupAvailable) return { code: -1, message: 'This page cannot show a popup.' };
    if (!sourceStore.entryByInternalPath.has(target)) return { code: -1, message: `The document is not in the source: ${target}` };
    await sourceStore.loadDoc(target);
    const compiled = sourceStore.compiledByPath[target];
    if (compiled?.status !== 'done') return { code: -1, message: compiled?.message || `Unable to open the document: ${target}` };
    runInAction(() => {
      this.popup = { path: target, hash, arrival, version: this.popup.version + 1, message: '' };
    });
    return { code: 0, message: '', data: { path: target, hash } };
  }

  popupClose() {
    this.popup = { path: '', hash: '', arrival: undefined, version: this.popup.version + 1, message: '' };
  }

  // the shape SourceLinkRenderPopup draws a popup from
  get pathPopup(): string { return this.popup.path; }
  get isPopupOpen(): boolean { return this.popup.path !== ''; }
}
