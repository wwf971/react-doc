import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import { buildPageTreeModel } from '../lib/page-tree.js';
import { compDefinitionNormalize } from '../comp-doc/comp-registry.js';

// upper store layer: view state and navigation.
// current doc, url sync, link dropdown state, search dialog state.
// content itself is asked from the lower DocSourceStore.

export type RouteMode = 'query' | 'memory';
type NavigationHistoryMode = 'push' | 'replace' | 'skip';
type NavigationHistoryEntry = {
  hash: string;
  route: string;
  text: string;
};
type PartIndexFloatingLayout = {
  left: number;
  top: number;
  width: number;
};

export class DocStore {
  sourceStore: DocSourceStore;
  routeMode: RouteMode;
  compById: Record<string, any>;
  compByIdVersion = 0;
  languagePage = '';
  languageSelectedByContentPath: Record<string, string> = {};
  partIndexContentMode: 'page' | 'part' = 'part';
  partIndexDisplayModeByPartId: Record<string, 'docked' | 'floating'> = {};
  partIndexFloatingLayoutByPartId: Record<string, PartIndexFloatingLayout> = {};

  routeCurrentPath = '';
  itemCurrentId = '';
  docCurrentPath = '';
  docCurrentHash = '';
  // Path/hash values do not change when the user selects the current index
  // destination again. Keep a separate request signal so the view can repeat
  // the requested top reset or fragment alignment and highlight.
  navigationRequestVersion = 0;
  navigationError = '';
  navigationHistoryEntryList: NavigationHistoryEntry[] = [];
  navigationHistoryIndex = -1;
  // id of the DocLink whose candidate dropdown is open; only one at a time
  linkDropdownOpenId = '';
  searchQuery = '';
  searchResults: any[] = [];
  isSearchRunning = false;

  constructor(sourceStore: DocSourceStore, options?: {
    routeMode?: RouteMode;
    compById?: Record<string, any>;
    language?: string;
  }) {
    this.sourceStore = sourceStore;
    this.routeMode = options?.routeMode ?? 'query';
    this.compById = options?.compById ?? {};
    this.languagePage = languageNormalize(options?.language);
    makeAutoObservable(this, { compById: false });
  }

  get contentCurrentPath(): string {
    return this.itemCurrent?.type === 'inline' ? this.routeCurrentPath : this.docCurrentPath;
  }

  get languageListCurrent(): string[] {
    return this.sourceStore.compiledByPath[this.contentCurrentPath]?.languageList ?? [];
  }

  get languageSelected(): string {
    const languageList = this.languageListCurrent;
    if (languageList.length === 0) return '';
    const languageSaved = this.languageSelectedByContentPath[this.contentCurrentPath];
    if (languageList.includes(languageSaved)) return languageSaved;
    const languageDocument = languageNormalize(
      this.sourceStore.compiledByPath[this.contentCurrentPath]?.language,
    );
    if (languageList.includes(languageDocument)) return languageDocument;
    if (languageList.includes(this.languagePage)) return this.languagePage;
    return languageList[0];
  }

  get treeModel() {
    void this.compByIdVersion;
    return buildPageTreeModel(
      this.sourceStore.configDoc,
      this.sourceStore.fileManifest,
      this.compById,
    );
  }

  get treePage() {
    return this.treeModel.treePage;
  }

  get itemCurrent(): any {
    return this.treeModel.itemById.get(this.itemCurrentId);
  }

  get partCurrent(): any {
    const partId = this.itemCurrent?.partId;
    return partId ? this.treeModel.partById.get(partId) : undefined;
  }

  get isPartIndexEnabled(): boolean {
    return this.sourceStore.configDoc.partIndex?.isEnabled !== false;
  }

  get partIndexContentModeCurrent(): 'page' | 'part' {
    return this.partIndexContentMode;
  }

  get partIndexDisplayModeCurrent(): 'docked' | 'floating' {
    const partId = this.partCurrent?.id;
    return partId ? this.partIndexDisplayModeByPartId[partId] ?? 'docked' : 'docked';
  }

  get partIndexFloatingLayoutCurrent(): PartIndexFloatingLayout | undefined {
    const partId = this.partCurrent?.id;
    return partId ? this.partIndexFloatingLayoutByPartId[partId] : undefined;
  }

  get isPartIndexFloatingEnabled(): boolean {
    return this.sourceStore.configDoc.partIndex?.isFloatingEnabled !== false;
  }

  get partIndexQueryCurrent(): any {
    const indexRef = this.partCurrent?.index;
    if (!this.isPartIndexEnabled || !indexRef?.docId || !indexRef?.componentId) return undefined;
    return this.componentQuery(indexRef.docId, indexRef.componentId);
  }

  get routeHome(): string {
    const homeItem = this.sourceStore.configDoc.homeItem;
    if (homeItem && this.treeModel.itemById.has(homeItem)) {
      return this.treeModel.itemById.get(homeItem).route;
    }
    const homeDoc = this.sourceStore.configDoc.homeDoc;
    const routeHomeDoc = homeDoc ? this.routeForDoc(homeDoc) : '';
    return routeHomeDoc || this.treeModel.items[0]?.route || '';
  }

  get isNavigationBackAvailable(): boolean {
    return this.navigationHistoryIndex > 0;
  }

  get isNavigationForwardAvailable(): boolean {
    return this.navigationHistoryIndex >= 0
      && this.navigationHistoryIndex < this.navigationHistoryEntryList.length - 1;
  }

  get navigationBackEntry(): NavigationHistoryEntry | undefined {
    return this.isNavigationBackAvailable
      ? this.navigationHistoryEntryList[this.navigationHistoryIndex - 1]
      : undefined;
  }

  get navigationForwardEntry(): NavigationHistoryEntry | undefined {
    return this.isNavigationForwardAvailable
      ? this.navigationHistoryEntryList[this.navigationHistoryIndex + 1]
      : undefined;
  }

  get navigationUpEntry(): NavigationHistoryEntry | undefined {
    const item = this.treeModel.itemAboveById.get(this.itemCurrentId);
    return item ? { hash: '', route: item.route, text: item.text ?? item.route } : undefined;
  }

  get isNavigationUpAvailable(): boolean {
    return this.navigationUpEntry !== undefined;
  }

  init() {
    let pathInitial = this.routeHome;
    let hashInitial = '';
    if (this.routeMode === 'query') {
      const param = new URLSearchParams(window.location.search).get('doc');
      if (param && this.routeResolve(param)) {
        pathInitial = param;
        hashInitial = window.location.hash.slice(1);
      }
      window.addEventListener('popstate', this.onPopState);
    }
    this.navigate(pathInitial, hashInitial, { isReplaceUrl: true });
  }

  dispose() {
    if (this.routeMode === 'query') window.removeEventListener('popstate', this.onPopState);
  }

  replaceSourceData(sourceData: { configDoc: any; fileManifest: any[] }) {
    const routePrevious = this.routeCurrentPath;
    const hashPrevious = this.docCurrentHash;
    this.sourceStore.replaceSourceData(sourceData);
    const routeNext = routePrevious && this.routeResolve(routePrevious)
      ? routePrevious
      : this.routeHome;
    this.navigate(routeNext, hashPrevious, {
      historyMode: 'replace',
      isReplaceUrl: true,
    });
  }

  replaceCompById(compById: Record<string, any>) {
    for (const key of Object.keys(this.compById)) delete this.compById[key];
    Object.assign(this.compById, compById);
    this.compByIdVersion += 1;
  }

  setLanguagePage(language: unknown) {
    this.languagePage = languageNormalize(language);
  }

  setLanguageSelected(language: string): boolean {
    if (!this.languageListCurrent.includes(language) || !this.contentCurrentPath) return false;
    this.languageSelectedByContentPath[this.contentCurrentPath] = language;
    return true;
  }

  partIndexContentModeSet(mode: 'page' | 'part'): boolean {
    if (mode !== 'page' && mode !== 'part') return false;
    this.partIndexContentMode = mode;
    return true;
  }

  partIndexDisplayModeSet(mode: 'docked' | 'floating'): boolean {
    const partId = this.partCurrent?.id;
    if (!partId || (mode !== 'docked' && mode !== 'floating')) return false;
    if (mode === 'floating' && !this.isPartIndexFloatingEnabled) return false;
    this.partIndexDisplayModeByPartId[partId] = mode;
    return true;
  }

  partIndexFloatingLayoutSet(layout: PartIndexFloatingLayout): boolean {
    const partId = this.partCurrent?.id;
    if (
      !partId
      || !Number.isFinite(layout.left)
      || !Number.isFinite(layout.top)
      || !Number.isFinite(layout.width)
      || layout.width <= 0
    ) return false;
    this.partIndexFloatingLayoutByPartId[partId] = {
      left: layout.left,
      top: layout.top,
      width: layout.width,
    };
    return true;
  }

  async partIndexLoadCurrent(): Promise<void> {
    const indexRef = this.partCurrent?.index;
    if (!this.isPartIndexEnabled || !indexRef?.docId || !indexRef?.componentId) return;
    await this.componentLoad(indexRef.docId);
  }

  async componentLoad(docId: string): Promise<void> {
    const item = this.treeModel.itemById.get(docId);
    if (item?.docPath) await this.sourceStore.loadDoc(item.docPath);
  }

  componentQuery(docId: string, componentId: string): any {
    const item = this.treeModel.itemById.get(docId);
    if (!item?.docPath) {
      return { status: 'error', message: `Part index document id not found: ${docId}` };
    }
    const result = this.sourceStore.componentGet(item.docPath, componentId);
    if (result.status !== 'done') return result;
    const component = result.component;
    const compId = this.sourceStore.configDoc.compRegistry?.[component.compName]
      ?? component.compName;
    const definition = compDefinitionNormalize(this.compById[compId]);
    if (!definition) {
      return {
        status: 'error',
        message: `Referenced component is not registered: ${component.compName}`,
      };
    }
    return {
      status: 'done',
      compId,
      component,
      componentType: definition.componentType ?? '',
      definition,
      docPath: item.docPath,
    };
  }

  onPopState = (event: PopStateEvent) => {
    const param = new URLSearchParams(window.location.search).get('doc');
    const hash = window.location.hash.slice(1);
    if (!param) return;

    const indexHistory = event.state?.docNavigationHistoryIndex;
    if (
      Number.isInteger(indexHistory)
      && indexHistory >= 0
      && indexHistory < this.navigationHistoryEntryList.length
      && this.navigationHistoryEntryList[indexHistory]?.route === param
    ) {
      this.navigationHistoryIndex = indexHistory;
      this.navigationHistoryEntryList[indexHistory] = {
        ...this.navigationHistoryEntryList[indexHistory],
        hash,
      };
      this.navigate(param, hash, { historyMode: 'skip', isFromHistory: true });
      return;
    }

    if (param !== this.routeCurrentPath || hash !== this.docCurrentHash) {
      this.navigate(param, hash, { isFromHistory: true });
    }
  };

  // target can be a sidebar item route or '/rootId/xx/a.md'. A document path
  // resolves to the first matching sidebar item in tree order.
  navigate(target: string, hashExtra?: string, options?: {
    historyMode?: NavigationHistoryMode;
    isReplaceUrl?: boolean;
    isFromHistory?: boolean;
  }) {
    const indexHash = target.indexOf('#');
    const path = indexHash >= 0 ? target.slice(0, indexHash) : target;
    const hash = hashExtra || (indexHash >= 0 ? target.slice(indexHash + 1) : '');
    const item = this.routeResolve(path);
    if (!item) {
      this.navigationError = this.sourceStore.entryByInternalPath.has(path)
        ? `The document exists in the source but is not included in the side panel: ${path}`
        : `Navigation target was not found: ${path}`;
      this.linkDropdownOpenId = '';
      return false;
    }

    this.routeCurrentPath = item.route;
    this.itemCurrentId = item.id;
    this.docCurrentPath = item.docPath ?? '';
    this.docCurrentHash = hash;
    this.navigationRequestVersion += 1;
    this.navigationError = '';
    this.linkDropdownOpenId = '';

    const isHistoryChanged = this.navigationHistoryApply(
      { hash, route: item.route, text: item.text ?? item.title ?? item.route },
      options?.historyMode ?? 'push',
    );

    if (this.routeMode === 'query' && !options?.isFromHistory) {
      const url = this.toBrowserHref(item.route) + (hash ? `#${hash}` : '');
      const state = {
        ...window.history.state,
        docNavigationHistoryIndex: this.navigationHistoryIndex,
      };
      if (options?.isReplaceUrl || !isHistoryChanged) window.history.replaceState(state, '', url);
      else window.history.pushState(state, '', url);
    }
    if (item.docPath) void this.sourceStore.loadDoc(item.docPath);
    else if (item.type === 'inline') {
      void this.sourceStore.loadInline(item.route, item.inlineContent, item.inlineFormat);
    }
    return true;
  }

  navigationBack(): boolean {
    if (!this.isNavigationBackAvailable) return false;
    if (this.routeMode === 'query') {
      window.history.back();
      return true;
    }
    return this.navigationHistoryMove(this.navigationHistoryIndex - 1);
  }

  navigationForward(): boolean {
    if (!this.isNavigationForwardAvailable) return false;
    if (this.routeMode === 'query') {
      window.history.forward();
      return true;
    }
    return this.navigationHistoryMove(this.navigationHistoryIndex + 1);
  }

  navigationUp(): boolean {
    const entry = this.navigationUpEntry;
    return entry ? this.navigate(entry.route) : false;
  }

  routeForDoc(internalPath: string): string {
    const itemId = this.treeModel.itemIdsByDocPath.get(internalPath)?.[0];
    return itemId ? this.treeModel.itemById.get(itemId)?.route ?? '' : '';
  }

  resolveTreeLink(target: string): { target: any; hash: string } | undefined {
    const { path, hash } = splitTarget(target);
    if (!path.startsWith('@first/')) return undefined;
    const nodeId = decodeURIComponent(path.slice('@first/'.length));
    const item = this.treeModel.itemFirstDocByNodeId.get(nodeId);
    return item ? { target: item, hash } : undefined;
  }

  isDocNavigable(internalPath: string): boolean {
    return this.routeForDoc(internalPath) !== '';
  }

  clearNavigationError() {
    this.navigationError = '';
  }

  private routeResolve(path: string): any {
    if (path.startsWith('@first/')) {
      const nodeId = decodeURIComponent(path.slice('@first/'.length));
      return this.treeModel.itemFirstDocByNodeId.get(nodeId);
    }
    const itemDirect = this.treeModel.itemByRoute.get(path);
    if (itemDirect) return itemDirect;
    const itemId = this.treeModel.itemIdsByDocPath.get(path)?.[0];
    return itemId ? this.treeModel.itemById.get(itemId) : undefined;
  }

  toBrowserHref(internalPath: string): string {
    const indexHash = internalPath.indexOf('#');
    const path = indexHash >= 0 ? internalPath.slice(0, indexHash) : internalPath;
    const hash = indexHash >= 0 ? internalPath.slice(indexHash) : '';
    const route = this.routeResolve(path)?.route ?? path;
    if (this.routeMode !== 'query') return route + hash;
    return `${window.location.pathname}?doc=${encodeURIComponent(route)}${hash}`;
  }

  setLinkDropdownOpen(id: string) {
    this.linkDropdownOpenId = id;
  }

  setSearchQuery(query: string) {
    this.searchQuery = query;
    this.isSearchRunning = true;
    void this.sourceStore.searchDocs(query).then((results) => {
      const resultsNormalized = this.searchResultsNormalize(results);
      runInAction(() => {
        // ignore stale results from an outdated query
        if (this.searchQuery !== query) return;
        this.searchResults = resultsNormalized;
        this.isSearchRunning = false;
      });
    });
  }

  private searchResultsNormalize(results: any[]): any[] {
    const treeModel = this.treeModel;
    return results.map((result) => {
      const indexHash = typeof result.url === 'string' ? result.url.indexOf('#') : -1;
      const path = indexHash >= 0 ? result.url.slice(0, indexHash) : result.url;
      const hash = indexHash >= 0 ? result.url.slice(indexHash) : '';
      const itemDirect = typeof path === 'string' ? treeModel.itemByRoute.get(path) : undefined;
      const itemId = typeof path === 'string' ? treeModel.itemIdsByDocPath.get(path)?.[0] : undefined;
      const item = itemDirect ?? (itemId ? treeModel.itemById.get(itemId) : undefined);
      if (!item) return result;
      return {
        ...result,
        url: `${item.route}${hash}`,
        ...(result.type === 'page' ? { content: item.text ?? result.content } : {}),
      };
    });
  }

  private navigationHistoryApply(entry: NavigationHistoryEntry, mode: NavigationHistoryMode): boolean {
    if (mode === 'skip') return false;
    if (mode === 'replace') {
      if (this.navigationHistoryIndex < 0) {
        this.navigationHistoryEntryList = [entry];
        this.navigationHistoryIndex = 0;
      } else {
        this.navigationHistoryEntryList[this.navigationHistoryIndex] = entry;
      }
      return true;
    }

    const entryCurrent = this.navigationHistoryEntryList[this.navigationHistoryIndex];
    if (entryCurrent?.route === entry.route && entryCurrent.hash === entry.hash) return false;

    this.navigationHistoryEntryList.splice(this.navigationHistoryIndex + 1);
    this.navigationHistoryEntryList.push(entry);
    if (this.navigationHistoryEntryList.length > 200) {
      this.navigationHistoryEntryList.shift();
    }
    this.navigationHistoryIndex = this.navigationHistoryEntryList.length - 1;
    return true;
  }

  private navigationHistoryMove(index: number): boolean {
    const indexPrevious = this.navigationHistoryIndex;
    const entry = this.navigationHistoryEntryList[index];
    if (!entry) return false;
    this.navigationHistoryIndex = index;
    const isNavigated = this.navigate(entry.route, entry.hash, {
      historyMode: 'skip',
      isFromHistory: true,
    });
    if (!isNavigated) this.navigationHistoryIndex = indexPrevious;
    return isNavigated;
  }
}

function splitTarget(target: string): { path: string; hash: string } {
  const indexHash = target.indexOf('#');
  return indexHash < 0
    ? { path: target, hash: '' }
    : { path: target.slice(0, indexHash), hash: target.slice(indexHash + 1) };
}

function languageNormalize(language: unknown): string {
  return typeof language === 'string' ? language.trim() : '';
}
