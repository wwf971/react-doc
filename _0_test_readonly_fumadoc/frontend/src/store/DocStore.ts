import { makeAutoObservable, runInAction } from 'mobx';
import type { DocSourceStore } from './DocSourceStore.js';
import { buildPageTree } from '../lib/page-tree.js';

// upper store layer: view state and navigation.
// current doc, url sync, link dropdown state, search dialog state.
// content itself is asked from the lower DocSourceStore.

export type RouteMode = 'query' | 'memory';

export class DocStore {
  sourceStore: DocSourceStore;
  routeMode: RouteMode;

  docCurrentPath = '';
  docCurrentHash = '';
  // id of the DocLink whose candidate dropdown is open; only one at a time
  linkDropdownOpenId = '';
  searchQuery = '';
  searchResults: any[] = [];
  isSearchRunning = false;

  constructor(sourceStore: DocSourceStore, options?: { routeMode?: RouteMode }) {
    this.sourceStore = sourceStore;
    this.routeMode = options?.routeMode ?? 'query';
    makeAutoObservable(this);
  }

  get treePage() {
    return buildPageTree(this.sourceStore.configDoc, this.sourceStore.fileManifest);
  }

  get docHome(): string {
    const homeDoc = this.sourceStore.configDoc.homeDoc;
    if (homeDoc && this.sourceStore.entryByInternalPath.has(homeDoc)) return homeDoc;
    return this.sourceStore.fileManifest[0]?.internalPath ?? '';
  }

  init() {
    let pathInitial = this.docHome;
    let hashInitial = '';
    if (this.routeMode === 'query') {
      const param = new URLSearchParams(window.location.search).get('doc');
      if (param && this.sourceStore.entryByInternalPath.has(param)) {
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

  onPopState = () => {
    const param = new URLSearchParams(window.location.search).get('doc');
    if (param && param !== this.docCurrentPath) {
      this.navigate(param, window.location.hash.slice(1), { isFromHistory: true });
    }
  };

  // target: '/rootId/xx/a.md' with optional '#hash'
  navigate(target: string, hashExtra?: string, options?: { isReplaceUrl?: boolean; isFromHistory?: boolean }) {
    const indexHash = target.indexOf('#');
    const path = indexHash >= 0 ? target.slice(0, indexHash) : target;
    const hash = hashExtra || (indexHash >= 0 ? target.slice(indexHash + 1) : '');

    this.docCurrentPath = path;
    this.docCurrentHash = hash;
    this.linkDropdownOpenId = '';

    if (this.routeMode === 'query' && !options?.isFromHistory) {
      const url = this.toBrowserHref(path) + (hash ? `#${hash}` : '');
      if (options?.isReplaceUrl) window.history.replaceState({}, '', url);
      else window.history.pushState({}, '', url);
    }
    void this.sourceStore.loadDoc(path);
  }

  toBrowserHref(internalPath: string): string {
    if (this.routeMode !== 'query') return internalPath;
    const indexHash = internalPath.indexOf('#');
    const path = indexHash >= 0 ? internalPath.slice(0, indexHash) : internalPath;
    const hash = indexHash >= 0 ? internalPath.slice(indexHash) : '';
    return `${window.location.pathname}?doc=${encodeURIComponent(path)}${hash}`;
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
