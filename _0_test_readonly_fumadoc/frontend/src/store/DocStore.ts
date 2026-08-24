import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import { buildPageTreeModel } from '../lib/page-tree.js';

// upper store layer: view state and navigation.
// current doc, url sync, link dropdown state, search dialog state.
// content itself is asked from the lower DocSourceStore.

export type RouteMode = 'query' | 'memory';

export class DocStore {
  sourceStore: DocSourceStore;
  routeMode: RouteMode;
  compById: Record<string, any>;

  routeCurrentPath = '';
  itemCurrentId = '';
  docCurrentPath = '';
  docCurrentHash = '';
  navigationError = '';
  // id of the DocLink whose candidate dropdown is open; only one at a time
  linkDropdownOpenId = '';
  searchQuery = '';
  searchResults: any[] = [];
  isSearchRunning = false;

  constructor(sourceStore: DocSourceStore, options?: { routeMode?: RouteMode; compById?: Record<string, any> }) {
    this.sourceStore = sourceStore;
    this.routeMode = options?.routeMode ?? 'query';
    this.compById = options?.compById ?? {};
    makeAutoObservable(this, { compById: false });
  }

  get treeModel() {
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

  get routeHome(): string {
    const homeItem = this.sourceStore.configDoc.homeItem;
    if (homeItem && this.treeModel.itemById.has(homeItem)) {
      return this.treeModel.itemById.get(homeItem).route;
    }
    const homeDoc = this.sourceStore.configDoc.homeDoc;
    const routeHomeDoc = homeDoc ? this.routeForDoc(homeDoc) : '';
    return routeHomeDoc || this.treeModel.items[0]?.route || '';
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
    this.navigate(routeNext, hashPrevious, { isReplaceUrl: true, isFromHistory: true });
  }

  onPopState = () => {
    const param = new URLSearchParams(window.location.search).get('doc');
    if (param && param !== this.routeCurrentPath) {
      this.navigate(param, window.location.hash.slice(1), { isFromHistory: true });
    }
  };

  // target can be a sidebar item route or '/rootId/xx/a.md'. A document path
  // resolves to the first matching sidebar item in tree order.
  navigate(target: string, hashExtra?: string, options?: { isReplaceUrl?: boolean; isFromHistory?: boolean }) {
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
    this.navigationError = '';
    this.linkDropdownOpenId = '';

    if (this.routeMode === 'query' && !options?.isFromHistory) {
      const url = this.toBrowserHref(item.route) + (hash ? `#${hash}` : '');
      if (options?.isReplaceUrl) window.history.replaceState({}, '', url);
      else window.history.pushState({}, '', url);
    }
    if (item.docPath) void this.sourceStore.loadDoc(item.docPath);
    else if (item.type === 'inline') {
      void this.sourceStore.loadInline(item.route, item.inlineContent, item.inlineFormat);
    }
    return true;
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
      runInAction(() => {
        // ignore stale results from an outdated query
        if (this.searchQuery !== query) return;
        this.searchResults = results;
        this.isSearchRunning = false;
      });
    });
  }
}

function splitTarget(target: string): { path: string; hash: string } {
  const indexHash = target.indexOf('#');
  return indexHash < 0
    ? { path: target, hash: '' }
    : { path: target.slice(0, indexHash), hash: target.slice(indexHash + 1) };
}
