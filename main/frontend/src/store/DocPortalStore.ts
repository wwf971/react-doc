import { makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import {
  PORTAL_SWITCHER_PLACE_LIST, portalDeviceGet, portalDeviceIsFit, portalDocAliasGet, portalDocIdBuild, portalGroupListBuild, portalIdSplit,
  portalListBuild, portalLocationRead, portalLocationSearchBuild, portalSearch,
} from '../lib/doc-portal.js';

// The portals of the page (design: doc_page_impl_portal.md).
//
// A portal is one way a doc page is shown as a whole. Every doc page has one, its documents
// with their side panel; a frontend object provides more, each a whole-window app drawn by a
// component (declared by its type, or by portal.yaml of its own folder). This store is the
// registry of them and the one place that says which is shown:
//
//   who registers                         the registry                         who reads
//   the doc pages (their documents)  ──►  portalList, groupList           ──►  PortalSwitcher
//   frontend objects (DocObjectFrontend-   portalIdOpen ('' the documents),     PortalHost (the app)
//     Store.portalProvide)                 at: the place inside it         ──►  the address of the page
//   code: register(portal)                 isEditing: the app's own mode        the apis portal/*
//
//   portalIdOpen   the portal of its own shown, '' while the documents are. the portal current
//                  (portalIdCurrent) is then the documents of the doc page of the document shown
//   at             the place inside the portal shown, in its own words (a path): kept in the
//                  address, so a place of an app is a link like a document is
//   isEditing      whether the portal shown offers what changes its data: its own switch, as a
//                  document has its edit mode (config.portal.docState of the component)
//   switcher       the one open dropdown of the page: { key, text, indexActive }, or undefined
//   registeredList portals registered by code (a host): whole portals

type Stores = { docStore: any; sourceStore: any; configStore?: any; objectFrontendStore?: any; objectStore?: any; envStore?: any };

export type PortalSwitcherState = { key: string; text: string; indexActive: number };

export class DocPortalStore {
  stores: Stores;
  routeMode: string;
  portalIdOpen = '';
  at = '';
  isEditing = false;
  switcher: PortalSwitcherState | undefined = undefined;
  registeredList: any[] = [];
  isInitDone = false;
  // the width of the window, for what a device is (read at start and when it changes)
  widthWindow = 1280;
  disposeList: (() => void)[] = [];
  serviceById = new Map<string, any>();

  constructor(stores: Stores, { routeMode = 'query' }: { routeMode?: string } = {}) {
    this.stores = stores;
    this.routeMode = routeMode;
    makeAutoObservable(this, {
      stores: false,
      routeMode: false,
      disposeList: false,
      serviceById: false,
      locationInitial: false,
      registeredList: observable.ref,
      switcher: observable.ref,
    });
  }

  // ---------- the registry ----------

  // a config key of the page, with what it says when the config store has no such key
  private configGet(key: string, valueDefault: any) {
    const value = this.stores.configStore?.configService?.valueGlobalGet?.(key);
    return value === undefined || value === null ? valueDefault : value;
  }

  // the doc pages that have documents to open, the main one first: each has the portal "doc"
  get docPageShownList(): { alias: string; title: string }[] {
    const { docStore, sourceStore } = this.stores;
    const docPageList = (sourceStore.docPageList ?? []) as any[];
    const shownList = docPageList
      .filter((docPage) => docPage.isRoot !== false && docStore.routeOfDocPageGet(docPage.alias) !== '')
      .map((docPage) => ({ alias: docPage.alias, title: docPage.title || docPage.alias }));
    // a host that gives no workspace still has its documents
    if (shownList.length === 0 && docStore.routeHome) return [{ alias: sourceStore.docPageAliasMain ?? '', title: docStore.siteTitle }];
    return shownList;
  }

  // the title of every doc page of the workspace, by alias: the heading of its group
  get titleByAlias(): Record<string, string> {
    const titleByAlias: Record<string, string> = {};
    for (const docPage of (this.stores.sourceStore.docPageList ?? []) as any[]) titleByAlias[docPage.alias] = docPage.title || docPage.alias;
    for (const docPage of this.docPageShownList) titleByAlias[docPage.alias] = docPage.title;
    return titleByAlias;
  }

  get provide(): { provideList: any[]; problemList: any[]; isLoading: boolean } {
    return this.stores.objectFrontendStore?.portalProvide ?? { provideList: [], problemList: [], isLoading: false };
  }

  // every portal of the page, in the order the switcher lists them
  get portalList(): any[] {
    const aliasList = [...this.docPageShownList.map((one) => one.alias), ...((this.stores.sourceStore.docPageList ?? []) as any[]).map((one) => one.alias)];
    return portalListBuild({
      docPageList: this.docPageShownList,
      provideList: this.provide.provideList,
      registeredList: this.registeredList,
      hiddenIdList: this.configGet('PortalHiddenList', []),
      rankById: this.configGet('PortalRankById', {}),
      docPageAliasList: [...new Set(aliasList)],
    });
  }

  get groupList(): any[] {
    return portalGroupListBuild(this.portalList, this.titleByAlias);
  }

  portalGet(id: string): any {
    return this.portalList.find((portal) => portal.id === id);
  }

  // the registry may still grow: the declarations or the entries of the objects are on their way
  get isLoading(): boolean {
    return this.provide.isLoading;
  }

  // what does not fit, for the Portals table: of the declarations of the objects, and portals
  // whose component the page has not
  get problemList(): { ref: string; message: string }[] {
    const problemList = this.provide.problemList.map((one: any) => ({ ref: one.ref, message: one.message }));
    for (const portal of this.portalList) {
      if (portal.isBuiltIn) continue;
      const message = this.compProblemGet(portal);
      if (message) problemList.push({ ref: portal.id, message: `${portal.label}: ${message}` });
    }
    return problemList;
  }

  // the component of a portal: { compId, definition, expose } (expose: what it says of itself
  // as one), or undefined for the documents and for a component the page has not
  compGet(portal: any): { compId: string; definition: any; expose: any } | undefined {
    if (!portal?.comp) return undefined;
    const found = this.stores.docStore.compFind?.(portal.comp);
    return found?.definition ? { compId: found.compId, definition: found.definition, expose: found.definition.expose?.portal } : undefined;
  }

  // why a portal cannot be drawn ('' when it can)
  compProblemGet(portal: any): string {
    if (!portal?.comp) return 'it names no component';
    const comp = this.compGet(portal);
    if (!comp) return `no component of the page is named ${portal.comp}`;
    if (!comp.expose) return `the component ${portal.comp} does not say it can draw a portal (expose.portal)`;
    return '';
  }

  // where the standard switcher stands for a portal: floating | own | none
  switcherPlaceGet(portal: any): string {
    const place = this.compGet(portal)?.expose?.switcherPlace;
    return PORTAL_SWITCHER_PLACE_LIST.includes(place) ? place : 'floating';
  }

  // a portal registered by code: { id: '{provider}/{name}', label, comp, docPageAlias?, ... }.
  // answers what takes it out again
  register(portal: any): () => void {
    if (!portal || !portalIdSplit(portal.id).name) return () => {};
    this.registeredList = [...this.registeredList.filter((one) => one.id !== portal.id), portal];
    return () => runInAction(() => { this.registeredList = this.registeredList.filter((one) => one !== portal); });
  }

  // ---------- which one is shown ----------

  // the portal current: the one of its own shown, else the documents of the doc page of the
  // document shown
  get portalIdCurrent(): string {
    if (this.portalIdOpen) return this.portalIdOpen;
    const { docStore, sourceStore } = this.stores;
    const aliasShown = this.docPageShownList.map((one) => one.alias);
    const alias = aliasShown.includes(docStore.docPageCurrentAlias) ? docStore.docPageCurrentAlias : (aliasShown[0] ?? sourceStore.docPageAliasMain ?? '');
    return portalDocIdBuild(alias);
  }

  get portalCurrent(): any {
    return this.portalGet(this.portalIdCurrent);
  }

  // the switcher is offered while there is something to switch to, unless the config says no
  get isSwitcherOffered(): boolean {
    return this.portalList.length > 1 && this.configGet('PortalSwitcherIsOn', true) !== false;
  }

  get isSearchOffered(): boolean {
    return this.portalList.length >= Number(this.configGet('PortalSearchCountMin', 8));
  }

  // what the window is, by the stipulated words: browser | mobile | desktop
  get device(): string {
    const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
    return portalDeviceGet({ width: this.widthWindow, isTouch, userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent });
  }

  deviceIsFit(portal: any): boolean {
    return portalDeviceIsFit(portal, this.device);
  }

  // a portal opened: one of its own (at: the place inside it), or the documents of a doc page.
  // historyMode 'push' (default) | 'replace'. answers { code, message }
  open(id: string, { at = '', historyMode = 'push' }: { at?: string; historyMode?: 'push' | 'replace' } = {}): { code: number; message: string } {
    const aliasOfDoc = portalDocAliasGet(id);
    if (aliasOfDoc !== undefined) return this.docOpen(aliasOfDoc, { historyMode });
    if (!portalIdSplit(id).name) return { code: -1, message: `${id} is no portal id ({provider}/{name})` };
    // a portal the registry does not know (yet) is still opened: it says so itself, where it stands
    if (this.portalIdOpen !== id) this.isEditing = false;
    this.portalIdOpen = id;
    this.at = String(at ?? '');
    this.switcherClose();
    this.locationWrite(historyMode);
    return { code: 0, message: '' };
  }

  // the documents shown: of a doc page (its home), or a document named (target: a route, a
  // source path or a link). with neither, the document that was shown before the portal
  docOpen(docPageAlias = '', { target = '', historyMode = 'push' }: { target?: string; historyMode?: 'push' | 'replace' } = {}): { code: number; message: string } {
    const { docStore } = this.stores;
    const wasOpen = this.portalIdOpen !== '';
    const route = target || (docPageAlias && docPageAlias !== docStore.docPageCurrentAlias ? docStore.routeOfDocPageGet(docPageAlias) : '');
    this.switcherClose();
    if (route && route !== docStore.routeCurrentPath) {
      // the navigation closes the portal (navigationHandle) and writes the address itself
      const isNavigated = docStore.navigate(route, '', historyMode === 'replace' ? { historyMode: 'replace', isReplaceUrl: true } : undefined);
      if (!isNavigated) return { code: -1, message: docStore.navigationError || `${route} names no document` };
      this.portalClose();
      return { code: 0, message: '' };
    }
    if (!wasOpen) return { code: 0, message: '' };
    this.portalClose();
    this.locationWrite(historyMode);
    return { code: 0, message: '' };
  }

  private portalClose() {
    this.portalIdOpen = '';
    this.at = '';
    this.isEditing = false;
  }

  // the place inside the portal shown: written into the address, as a step of the history
  // (default) or in place of the last one
  atSet(at: string, { historyMode = 'push' }: { historyMode?: 'push' | 'replace' } = {}) {
    const atNext = String(at ?? '');
    if (!this.portalIdOpen || atNext === this.at) return;
    this.at = atNext;
    this.locationWrite(historyMode);
  }

  editSet(isEditing: boolean) {
    this.isEditing = isEditing === true && this.portalIdOpen !== '';
  }

  // ---------- the address ----------

  // the address of a portal, for a link: ?portal=…&at=…
  hrefGet(id: string, at = ''): string {
    if (this.routeMode !== 'query' || typeof window === 'undefined') return '';
    const aliasOfDoc = portalDocAliasGet(id);
    if (aliasOfDoc !== undefined) return this.stores.docStore.toBrowserHref(this.stores.docStore.routeOfDocPageGet(aliasOfDoc));
    return `${window.location.pathname}${portalLocationSearchBuild(window.location.search, id, at)}`;
  }

  private locationWrite(historyMode: 'push' | 'replace') {
    if (this.routeMode !== 'query' || typeof window === 'undefined') return;
    const { docStore } = this.stores;
    // the documents: the address of the document shown; a portal: its own
    const url = this.portalIdOpen
      ? `${window.location.pathname}${portalLocationSearchBuild(window.location.search, this.portalIdOpen, this.at)}`
      : docStore.toBrowserHref(docStore.routeCurrentPath) + (docStore.docCurrentHash ? `#${docStore.docCurrentHash}` : '');
    if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
    // the state of the entry is kept: the navigation of the documents reads its own index there
    if (historyMode === 'replace') window.history.replaceState(window.history.state, '', url);
    else window.history.pushState(window.history.state, '', url);
  }

  private locationRead = () => {
    const { portalId, at } = portalLocationRead(window.location.search);
    runInAction(() => {
      if (portalId !== this.portalIdOpen) this.isEditing = false;
      this.portalIdOpen = portalId;
      this.at = portalId ? at : '';
      this.switcher = undefined;
    });
  };

  // after the documents' own init (DocStore.init has read ?doc= and navigated): the portal the
  // address named, else the one the config says the page opens with
  init() {
    const { docStore } = this.stores;
    if (typeof window !== 'undefined') {
      this.widthWindow = window.innerWidth;
      const resizeHandle = () => runInAction(() => { this.widthWindow = window.innerWidth; });
      window.addEventListener('resize', resizeHandle);
      this.disposeList.push(() => window.removeEventListener('resize', resizeHandle));
    }
    if (this.routeMode === 'query' && typeof window !== 'undefined') {
      // what the reader came with (locationInitialRead): a portal named, else, where the address
      // named no document either, the portal the config says the page opens with
      const { portalId, at, isDocNamed } = this.locationInitial;
      const portalDefault = String(this.configGet('PortalDefault', '') ?? '');
      if (portalId) {
        this.portalIdOpen = portalId;
        this.at = at;
        this.locationWrite('replace');
      } else if (!isDocNamed && portalDocAliasGet(portalDefault) === undefined && portalIdSplit(portalDefault).name) {
        this.portalIdOpen = portalDefault;
        this.locationWrite('replace');
      }
      window.addEventListener('popstate', this.locationRead);
      this.disposeList.push(() => window.removeEventListener('popstate', this.locationRead));
    }
    // a navigation of the documents while a portal of its own is shown shows the documents: a
    // link to a document followed inside an app leads to that document
    let versionSeen = docStore.navigationRequestVersion;
    this.disposeList.push(reaction(
      () => docStore.navigationRequestVersion,
      (version) => {
        if (version === versionSeen) return;
        versionSeen = version;
        if (this.isInitDone && this.portalIdOpen && !this.isLocationReading()) this.portalClose();
      },
    ));
    this.isInitDone = true;
  }

  // whether the address still names the portal shown: a navigation of the documents coming with
  // a step of the history (popstate) is answered by locationRead, not by closing the portal
  private isLocationReading(): boolean {
    if (this.routeMode !== 'query' || typeof window === 'undefined') return false;
    return portalLocationRead(window.location.search).portalId === this.portalIdOpen;
  }

  // what the address named when the page started: read before the documents write theirs
  // (DocStore.init replaces the address by the one of the document it shows, which names no portal)
  locationInitial = { portalId: '', at: '', isDocNamed: false };
  locationInitialRead() {
    if (this.routeMode !== 'query' || typeof window === 'undefined') return;
    this.locationInitial = { ...portalLocationRead(window.location.search), isDocNamed: new URLSearchParams(window.location.search).has('doc') };
  }

  dispose() {
    for (const dispose of this.disposeList.splice(0)) dispose();
    this.isInitDone = false;
  }

  // ---------- the switcher ----------

  switcherIsOpen(key: string): boolean {
    return this.switcher !== undefined && this.switcher.key === key;
  }

  switcherOpen(key: string) {
    const indexCurrent = this.portalList.findIndex((portal) => portal.id === this.portalIdCurrent);
    this.switcher = { key, text: '', indexActive: Math.max(0, indexCurrent) };
  }

  switcherClose(key?: string) {
    if (!this.switcher || (key !== undefined && this.switcher.key !== key)) return;
    this.switcher = undefined;
  }

  switcherTextSet(text: string) {
    if (!this.switcher) return;
    this.switcher = { ...this.switcher, text, indexActive: 0 };
  }

  // what the open switcher lists: the portals its words find, by doc page
  get switcherGroupList(): any[] {
    const found = portalSearch(this.portalList, this.switcher?.text ?? '', this.titleByAlias);
    return portalGroupListBuild(found, this.titleByAlias);
  }

  get switcherPortalList(): any[] {
    return this.switcherGroupList.flatMap((group) => group.portalList);
  }

  switcherActiveMove(delta: number) {
    const count = this.switcherPortalList.length;
    if (!this.switcher || count === 0) return;
    this.switcher = { ...this.switcher, indexActive: (this.switcher.indexActive + delta + count) % count };
  }

  switcherActiveSet(index: number) {
    if (!this.switcher || index === this.switcher.indexActive) return;
    this.switcher = { ...this.switcher, indexActive: index };
  }

  switcherChoose(index?: number) {
    const portal = this.switcherPortalList[index ?? this.switcher?.indexActive ?? 0];
    if (portal) this.open(portal.id);
  }

  // ---------- what a portal's component is handed: config.portal ----------

  // one object per portal for the life of the page, its getters reading the store (the component
  // is an observer): doc_page_impl_portal.md#the-component-of-a-portal
  serviceGet(id: string): any {
    let service = this.serviceById.get(id);
    if (!service) {
      const store = this;
      const docState = Object.freeze({
        path: '',
        get mode() { return store.isEditing && store.portalIdOpen === id ? 'edit' : 'read'; },
        get isEditing() { return store.isEditing && store.portalIdOpen === id; },
        isEditAvailable: true,
        editReason: '',
        // the portal's Edit is the edit of what it shows: a mode with an edit session of its own
        // (a sheet's own Edit) enters it with the portal's, so one switch edits
        isEditDirect: true,
      });
      service = Object.freeze({
        id,
        get portal() { return store.portalGet(id); },
        // the place inside it, in its own words; atSet writes it into the address
        get at() { return store.portalIdOpen === id ? store.at : ''; },
        atSet: (at: string, options?: { historyMode?: 'push' | 'replace' }) => { if (store.portalIdOpen === id) store.atSet(at, options); },
        hrefGet: (at = '') => store.hrefGet(id, at),
        // its own reading and editing, as a document has: handed on to what it draws of an object
        docState,
        get isEditing() { return docState.isEditing; },
        editSet: (isEditing: boolean) => store.editSet(isEditing),
        // the others
        get portalList() { return store.portalList; },
        get groupList() { return store.groupList; },
        open: (idOther: string, options?: { at?: string; historyMode?: 'push' | 'replace' }) => store.open(idOther, options),
        // the documents: of the doc page of this portal, or a document named
        docOpen: (target = '') => store.docOpen(store.portalGet(id)?.docPageAlias ?? '', { target }),
        get device() { return store.device; },
        get isSwitcherOffered() { return store.isSwitcherOffered; },
      });
      this.serviceById.set(id, service);
    }
    return service;
  }
}
