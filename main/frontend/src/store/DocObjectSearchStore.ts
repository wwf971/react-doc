import { makeAutoObservable, observable, runInAction } from 'mobx';
import { objectDescriptorNormalize } from '../lib/doc-object-ref.js';
import {
  objectSearchFieldsBuild,
  objectSearchMatch,
  objectSearchParse,
  objectSearchPathGet,
  objectSearchPlanBuild,
  objectSearchProviderFieldsBuild,
} from '../lib/doc-object-search.js';

// The search of the object service layer (design: doc_page_impl_obj_search.md).
//
// A search is moderate by construction: it decides per provider, from what
// it knows of the provider alone, whether objects of it can match at all
// (the plan); it asks the providers of the backend how many objects they
// would answer before asking for any (the preflight count); and it fetches
// a provider's objects only when they are few enough, or when the search
// text narrows them enough, never more than fetchMax of one provider. A
// provider with more is reported with its count, for the reader to narrow
// the search or to load its first fetchMax on purpose (providerIdExpandList).
//
//   search(spec)    the one search: { text, typeList, providerIdList,
//                   registryList, filter, fetchMax, limit, providerIdExpandList }
//                   -> { tokenList, objectList: [{ descriptor, score, matchList,
//                   path, hostLabel }], providerList (one summary per provider
//                   asked or not), isComplete }
//   sessionGet(key) the state of one search ui (a panel, the create panel of
//                   a diagram), kept here, keyed by the component: its text,
//                   its filters, its result, its highlighted row, the
//                   providers loaded on purpose. a component renders it and
//                   calls its methods; it keeps no state of its own

export const OBJECT_SEARCH_FETCH_MAX = 50;
export const OBJECT_SEARCH_LIMIT = 100;
const OBJECT_SEARCH_DELAY_MS = 220;
// a page provider answers from the page's memory: listed whole, filtered here
const PAGE_QUERY_LIMIT = 500;

export type ObjectSearchSpec = {
  text?: string;
  typeList?: string[];
  providerIdList?: string[];
  registryList?: ('page' | 'backend')[];
  filter?: Record<string, any>;
  fetchMax?: number;
  limit?: number;
  providerIdExpandList?: string[];
};

export type ObjectSearchProviderSummary = {
  providerId: string;
  label: string;
  registry: 'page' | 'backend';
  // fetched: its objects were asked for (all, or the first fetchMax: isTruncated)
  // counted: only counted; too many (or how many is not known) to fetch
  // unavailable, failed: it did not answer
  status: 'fetched' | 'counted' | 'unavailable' | 'failed';
  count: number | null;
  countKind: 'exact' | 'atLeast' | 'unknown';
  matchCount: number;
  isTruncated: boolean;
  isExpandable: boolean;
  message: string;
};

export type ObjectSearchHit = { descriptor: any; score: number; matchList: any[]; path: string; hostLabel: string; isRefHit: boolean };
export type ObjectSearchResult = { tokenList: any[]; objectList: ObjectSearchHit[]; providerList: ObjectSearchProviderSummary[]; isComplete: boolean; isEmptyQuery: boolean };

export class DocObjectSearchStore {
  objectStore: any;
  // a plain map: a session is created while a ui renders, and each session
  // is observable itself
  sessionByKey = new Map<string, ObjectSearchSession>();

  constructor(objectStore: any) {
    this.objectStore = objectStore;
    makeAutoObservable(this, { objectStore: false, sessionByKey: false });
  }

  // ---------- the search ----------

  async search(specInput: ObjectSearchSpec): Promise<ObjectSearchResult> {
    const spec = searchSpecNormalize(specInput);
    const { tokenList, refList } = objectSearchParse(spec.text);
    const typeRegistry = this.objectStore.typeRegistry;
    // nothing asked: nothing listed (an empty text with a type is a listing of that type)
    if (tokenList.length === 0 && spec.typeList.length === 0) {
      return { tokenList, objectList: [], providerList: [], isComplete: true, isEmptyQuery: true };
    }
    const typeListAsked = spec.typeList.length > 0 ? spec.typeList : ['core.object'];
    const providerList = this.providerInfoListGet(spec);
    const hitByRef = new Map<string, ObjectSearchHit>();
    const summaryList: ObjectSearchProviderSummary[] = [];

    // 1. a whole reference: the object itself, whatever the rest of the text says
    const refKnownList = refList.filter((ref: string) => this.objectStore.providerOfRefGet(ref));
    const refHitList = await Promise.all(refKnownList.map((ref: string) => this.objectStore.resolve(ref)));
    for (const descriptor of refHitList) {
      if (descriptor.status === 'found' || descriptor.status === 'registered') {
        hitByRef.set(descriptor.ref, { descriptor, score: 1000, matchList: [{ token: descriptor.ref, field: 'id' }], path: objectSearchPathGet(descriptor, descriptor.provider?.label), hostLabel: descriptor.provider?.label ?? '', isRefHit: true });
      }
    }

    // 2. the plan: which providers can have a match, and what their objects must still match
    const planList = providerList
      .filter((provider) => typeRegistry.isAssignableAny(provider.typeList, typeListAsked))
      .map((provider) => ({ provider, plan: objectSearchPlanBuild(tokenList, objectSearchProviderFieldsBuild(provider, typeRegistry)) }))
      .filter((item) => item.plan.isCandidate);

    // 3. ask each: the page's at once, those behind a peer (the backend's)
    // after a preflight count, through the peer
    const planListPage = planList.filter((item) => !item.provider.peer);
    const peerList = [...new Set(planList.map((item) => item.provider.peer).filter(Boolean))];
    const answerListPage = await Promise.all(planListPage.map((item) => this.pageProviderAsk(item, spec, typeListAsked)));
    const answerListPeer = (await Promise.all(peerList.map((peer) => this.peerProviderAsk(peer, planList.filter((item) => item.provider.peer === peer), spec, typeListAsked)))).flat();
    for (const answer of [...answerListPage, ...answerListPeer]) {
      const { provider, plan, descriptorList, summary } = answer;
      const tokenCountProvider = tokenList.length - plan.tokenListObject.length;
      let matchCount = 0;
      for (const descriptor of descriptorList) {
        if (!typeRegistry.isAssignableAny(descriptor.typeList, typeListAsked)) continue;
        const fields = objectSearchFieldsBuild(descriptor, providerHostListGet(provider), typeRegistry);
        const match = objectSearchMatch(fields, plan.tokenListObject, tokenCountProvider);
        if (!match) continue;
        matchCount += 1;
        if (hitByRef.has(descriptor.ref)) continue;
        hitByRef.set(descriptor.ref, { descriptor, ...match, path: objectSearchPathGet(descriptor, provider.label), hostLabel: provider.label, isRefHit: false });
      }
      summaryList.push({ ...summary, matchCount });
    }

    const objectList = [...hitByRef.values()]
      .sort((a, b) => b.score - a.score || a.descriptor.label.localeCompare(b.descriptor.label))
      .slice(0, spec.limit);
    this.objectStore.resolvePrime(objectList.map((hit) => hit.descriptor).filter((descriptor) => descriptor.status === 'found'));
    return {
      tokenList,
      objectList,
      providerList: summaryList,
      isComplete: summaryList.every((summary) => summary.status === 'fetched' && !summary.isTruncated),
      isEmptyQuery: false,
    };
  }

  // the providers a search may ask, as the plan needs them: the page's own,
  // and for a peer (the backend's registry), each provider behind it as the
  // peer lists it, asked through the peer (peer)
  private providerInfoListGet(spec: ReturnType<typeof searchSpecNormalize>): any[] {
    const list: any[] = [];
    for (const provider of this.objectStore.providerList) {
      const registry = provider.registry ?? 'page';
      if (!spec.registryList.includes(registry) || !provider.capabilityList.includes('query') || !provider.query) continue;
      if (!provider.isPeer) {
        list.push({ ...pick(provider, ['id', 'label', 'namespaceList', 'typeList', 'capabilityList', 'cacheSecond']), registry, provider });
        continue;
      }
      if (this.objectStore.providerStatusGet(provider).status !== 'ready') continue;
      for (const info of provider.providerInfoListGet?.() ?? []) {
        if ((info.capabilityList ?? []).includes('query')) list.push({ ...info, registry, peer: provider });
      }
    }
    return spec.providerIdList.length > 0 ? list.filter((item) => spec.providerIdList.includes(item.id)) : list;
  }

  // a provider of the page answers from the page's own memory: listed whole
  // (to its bound) and matched here, so a word matching an id is found too
  private async pageProviderAsk(item: any, spec: any, typeListAsked: string[]) {
    const { provider, plan } = item;
    const summary = summaryBuild(provider);
    const status = this.objectStore.providerStatusGet(provider.provider);
    if (status.status !== 'ready') return { ...item, descriptorList: [], summary: { ...summary, status: 'unavailable' as const, message: status.message } };
    try {
      const answer = await provider.provider.query({ typeList: typeListAsked, text: '', filter: spec.filter, limit: PAGE_QUERY_LIMIT, providerIdList: [] }, this.objectStore.typeRegistry);
      const itemList = Array.isArray(answer) ? answer : answer?.objectList ?? [];
      const descriptorList = itemList.map((value: any) => objectDescriptorNormalize(value, provider.provider, value.status ?? 'found'));
      return {
        ...item,
        descriptorList,
        summary: { ...summary, status: 'fetched' as const, count: descriptorList.length, countKind: Array.isArray(answer) || answer?.isComplete !== false ? 'exact' as const : 'atLeast' as const, message: Array.isArray(answer) ? '' : answer?.message ?? '' },
      };
    } catch (error: any) {
      return { ...item, descriptorList: [], summary: { ...summary, status: 'failed' as const, message: String(error?.message ?? error) } };
    }
  }

  // the providers behind a peer: one preflight count for all of them, then
  // a bounded fetch of each that is small enough, or narrowed enough by the
  // word it can filter by itself (textPush), or loaded on purpose
  private async peerProviderAsk(peer: any, planList: any[], spec: any, typeListAsked: string[]) {
    if (planList.length === 0) return [];
    const typeRegistry = this.objectStore.typeRegistry;
    const fetchMax = spec.fetchMax;
    const countGet = async (itemList: any[], text: string) => {
      if (itemList.length === 0) return new Map();
      try {
        const data = await peer.count({ typeList: typeListAsked, text, filter: spec.filter, providerIdList: itemList.map((item) => item.provider.id) });
        return new Map((data?.providerList ?? []).map((entry: any) => [entry.providerId, entry]));
      } catch {
        return new Map();
      }
    };
    // a count of everything of the types asked for, then, for those too
    // large, a count of what their own filter by the pushed word leaves
    const countAllById = await countGet(planList, '');
    const decisionList = planList.map((item) => {
      const countAll: any = countAllById.get(item.provider.id);
      const isExpanded = spec.providerIdExpandList.includes(item.provider.id);
      return { item, countAll, isExpanded, countText: undefined as any };
    });
    const itemListNarrow = decisionList.filter((decision) => !decision.isExpanded && decision.item.plan.textPush
      && decision.countAll?.countKind === 'exact' && decision.countAll.count > fetchMax).map((decision) => decision.item);
    // one narrowing request per pushed word: the providers sharing it are counted together
    const textPushList = [...new Set(itemListNarrow.map((item) => item.plan.textPush))];
    const countTextMapList = await Promise.all(textPushList.map((text) => countGet(itemListNarrow.filter((item) => item.plan.textPush === text), text)));
    for (const decision of decisionList) {
      decision.countText = countTextMapList.map((countMap) => countMap.get(decision.item.provider.id)).find(Boolean);
    }

    return Promise.all(decisionList.map(async ({ item, countAll, isExpanded, countText }) => {
      const summary = summaryBuild(item.provider);
      if (!countAll || ['unavailable', 'failed', 'timedOut', 'skipped'].includes(countAll.status)) {
        return { ...item, descriptorList: [], summary: { ...summary, status: 'unavailable' as const, message: countAll?.message || `${item.provider.label} did not answer` } };
      }
      const textPush = item.plan.textPush;
      let fetchText: string | undefined;
      let countKnown: number | null = countAll.countKind === 'exact' ? countAll.count : null;
      if (isExpanded) fetchText = textPush;
      else if (countKnown !== null && countKnown <= fetchMax) fetchText = '';
      else if (countText?.countKind === 'exact' && countText.count <= fetchMax) { fetchText = textPush; countKnown = countText.count; }
      // how many is not known (no count): a bounded page, when a word narrows it
      else if (countKnown === null && item.plan.tokenListObject.length > 0) fetchText = textPush;
      if (fetchText === undefined) {
        return {
          ...item,
          descriptorList: [],
          summary: { ...summary, status: 'counted' as const, count: countText?.countKind === 'exact' ? countText.count : countKnown, countKind: countKnown === null ? 'unknown' as const : 'exact' as const, isExpandable: true,
            message: countKnown === null ? 'it does not count its objects: narrow the search, or load the first ones' : 'too many to list: narrow the search, or load the first ones' },
        };
      }
      let descriptorListAll: any[];
      try {
        const data = await peer.query({ typeList: typeListAsked, text: fetchText, filter: spec.filter, limit: fetchMax + 1, providerIdList: [item.provider.id] }, typeRegistry);
        descriptorListAll = data?.objectList ?? [];
      } catch (error: any) {
        return { ...item, descriptorList: [], summary: { ...summary, status: 'failed' as const, message: String(error?.message ?? error) } };
      }
      const isTruncated = descriptorListAll.length > fetchMax;
      return {
        ...item,
        descriptorList: descriptorListAll.slice(0, fetchMax),
        summary: { ...summary, status: 'fetched' as const, count: countKnown ?? (isTruncated ? fetchMax : descriptorListAll.length), countKind: countKnown !== null ? 'exact' as const : (isTruncated ? 'atLeast' as const : 'exact' as const),
          isTruncated, isExpandable: isTruncated && !isExpanded, message: fetchText ? `filtered by “${fetchText}” at the provider` : '' },
      };
    }));
  }

  // ---------- the sessions of the search uis ----------

  sessionGet(key: string, options: { typeList?: string[]; providerIdList?: string[]; registryList?: ('page' | 'backend')[]; fetchMax?: number } = {}): ObjectSearchSession {
    let session = this.sessionByKey.get(key);
    if (!session) {
      session = new ObjectSearchSession(this, key, options);
      this.sessionByKey.set(key, session);
    }
    return session;
  }

  sessionDrop(key: string) {
    this.sessionByKey.get(key)?.dispose();
    this.sessionByKey.delete(key);
  }
}

// one search ui: what it shows and what the reader chose, all here
export class ObjectSearchSession {
  searchStore: DocObjectSearchStore;
  key: string;
  text = '';
  typeList: string[];
  providerIdList: string[];
  registryList: ('page' | 'backend')[];
  fetchMax: number;
  providerIdExpandList: string[] = [];
  status: 'idle' | 'searching' | 'done' | 'error' = 'idle';
  result: ObjectSearchResult | null = null;
  message = '';
  indexActive = 0;
  refChosen = '';
  seq = 0;
  timer: ReturnType<typeof setTimeout> | undefined;

  constructor(searchStore: DocObjectSearchStore, key: string, options: any = {}) {
    this.searchStore = searchStore;
    this.key = key;
    this.typeList = options.typeList ?? [];
    this.providerIdList = options.providerIdList ?? [];
    this.registryList = options.registryList ?? ['page', 'backend'];
    this.fetchMax = options.fetchMax ?? OBJECT_SEARCH_FETCH_MAX;
    makeAutoObservable(this, { searchStore: false, key: false, seq: false, timer: false, result: observable.ref });
  }

  get hitList(): ObjectSearchHit[] {
    return this.result?.objectList ?? [];
  }

  textSet(text: string) {
    this.text = text;
    this.providerIdExpandList = [];
    this.indexActive = 0;
    this.schedule();
  }

  typeListSet(typeList: string[]) {
    this.typeList = typeList;
    this.providerIdExpandList = [];
    this.schedule(0);
  }

  registryListSet(registryList: ('page' | 'backend')[]) {
    this.registryList = registryList;
    this.schedule(0);
  }

  // the first fetchMax objects of a provider too large to list, asked for on purpose
  providerExpand(providerId: string) {
    if (!this.providerIdExpandList.includes(providerId)) this.providerIdExpandList = [...this.providerIdExpandList, providerId];
    this.schedule(0);
  }

  indexActiveMove(step: number) {
    const count = this.hitList.length;
    if (count > 0) this.indexActive = (this.indexActive + step + count) % count;
  }

  indexActiveSet(index: number) {
    this.indexActive = index;
  }

  get hitActive(): ObjectSearchHit | undefined {
    return this.hitList[this.indexActive] ?? this.hitList[0];
  }

  refChosenSet(ref: string) {
    this.refChosen = ref;
  }

  clear() {
    this.textSet('');
  }

  refresh() {
    this.schedule(0);
  }

  private schedule(delay = OBJECT_SEARCH_DELAY_MS) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  async run() {
    const seq = ++this.seq;
    runInAction(() => {
      this.status = 'searching';
    });
    try {
      const result = await this.searchStore.search({
        text: this.text,
        typeList: this.typeList,
        providerIdList: this.providerIdList,
        registryList: this.registryList,
        fetchMax: this.fetchMax,
        providerIdExpandList: this.providerIdExpandList,
      });
      runInAction(() => {
        if (seq !== this.seq) return;
        this.result = result;
        this.status = 'done';
        this.message = '';
        if (this.indexActive >= result.objectList.length) this.indexActive = 0;
      });
    } catch (error: any) {
      runInAction(() => {
        if (seq !== this.seq) return;
        this.status = 'error';
        this.message = String(error?.message ?? error);
      });
    }
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
  }
}

function searchSpecNormalize(spec: ObjectSearchSpec) {
  return {
    text: String(spec.text ?? ''),
    typeList: Array.isArray(spec.typeList) ? spec.typeList.map(String).filter(Boolean) : [],
    providerIdList: Array.isArray(spec.providerIdList) ? spec.providerIdList.map(String) : [],
    registryList: Array.isArray(spec.registryList) && spec.registryList.length > 0 ? spec.registryList : ['page', 'backend'],
    filter: spec.filter && typeof spec.filter === 'object' ? spec.filter : {},
    fetchMax: Math.max(1, Math.min(500, Number(spec.fetchMax) || OBJECT_SEARCH_FETCH_MAX)),
    limit: Math.max(1, Math.min(500, Number(spec.limit) || OBJECT_SEARCH_LIMIT)),
    providerIdExpandList: Array.isArray(spec.providerIdExpandList) ? spec.providerIdExpandList.map(String) : [],
  };
}

function summaryBuild(provider: any): ObjectSearchProviderSummary {
  return { providerId: provider.id, label: provider.label, registry: provider.registry, status: 'fetched', count: null, countKind: 'unknown', matchCount: 0, isTruncated: false, isExpandable: false, message: '' };
}

// what a provider's objects are hosted by, for the words of a search
function providerHostListGet(provider: any): string[] {
  return [provider.label, provider.id, provider.serviceId, provider.templateName].filter(Boolean);
}

function pick(value: any, keyList: string[]) {
  return Object.fromEntries(keyList.map((key) => [key, value[key]]));
}

