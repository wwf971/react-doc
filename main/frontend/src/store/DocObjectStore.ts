import { comparer, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { typeBuiltinList, typeRegistryBuild } from '../lib/doc-object-type.js';
import {
  OBJECT_VIEW_CONTEXT_LIST,
  objectDescriptorNormalize,
  objectDescriptorPlaceholder,
  objectRefParse,
  objectRequestKeyBuild,
  objectTextIsMatch,
  relationCompare,
  relationNormalize,
} from '../lib/doc-object-ref.js';
import { compDefinitionNormalize } from '../../../comp-doc/registry/comp-registry.js';
import { compDefinitionGet } from '../../../comp-doc/registry/comp-definition.js';
import { compObjectViewGet } from '../../../comp-doc/registry/comp-expose.js';
import { DocObjectSearchStore } from './DocObjectSearchStore.js';

// The object registry of the page (design: doc_page_impl_obj.md).
//
// The Object Registry must not automatically become the source of truth for
// object contents, relationships, or lifecycle. Providers remain
// authoritative for the data they own. Registration, discovery, resolution,
// and verification are separate concerns.
//
//   typeRegistry   the types: the built-in ones (the JSON file the kernel
//                  reads too), and those the providers define (the backend
//                  peer: its built-in copy and the types of its templates)
//   providerList   who answers for objects: the page's service layers (the
//                  doc page source, the links, the asset store), each with
//                  its namespaces, types and capabilities, and the backend's
//                  registry as one peer provider of its namespaces
//
// The registry knows no service layer: what it needs of one (its objects,
// the types and the components it brings, how to open its objects) it asks
// the layer's provider, the way the api registry asks its api providers.
// The only other store it reads is the component registry (DocStore), for
// the views.
//   resolveByRef   what the registry knows of a reference: the last answer
//                  of its provider, reused for the provider's cacheSecond or
//                  until its version changes, and kept (with the status
//                  unavailable) when the provider cannot answer
//   queryByKey, relationByKey
//                  the last answers of a query and a relation query, the
//                  same way
//   registrationByRef
//                  descriptors a principal of the page registered: known,
//                  never verified by the registering
//
// What it answers may be stale or incomplete and says so (the status of a
// descriptor, the completeness of a query). How fresh and how complete it
// is depends on how its providers and consumers use it, not on guarantees
// of its own: a provider that cannot follow changes (a document edited
// outside the page) is a provider still.

export type ObjectDescriptor = {
  ref: string;
  typeList: string[];
  label: string;
  description: string;
  summary: Record<string, any>;
  iconUrl: string;
  capabilityList: string[];
  open: any;
  status: string;
  timeChecked: number | null;
  provider: { id: string; label: string; registry: string; registrant?: any } | null;
  message?: string;
};

export type ObjectCompleteness = {
  isComplete: boolean;
  providerList: { providerId: string; label: string; registry: string; status: string; count: number; message: string }[];
};

export type ObjectQueryResult = { objectList: ObjectDescriptor[]; isTruncated: boolean; completeness: ObjectCompleteness };
export type ObjectRelationResult = { relationList: any[]; completeness: ObjectCompleteness };
export type ObjectResult = { code: number; data?: any; message: string };

export type ObjectQuerySpec = {
  typeList?: string[] | string;
  text?: string;
  filter?: Record<string, any>;
  limit?: number;
  providerIdList?: string[];
};

export type ObjectRelationSpec = { fromRef?: string; toRef?: string; typeList?: string[] | string };

// a component a provider serves (a view, when it has objectView). it is
// drawn only while isAvailable; sourceLabel says whose it is (template todo-list)
export type ObjectProviderComp = {
  compId: string;
  label: string;
  sourceLabel: string;
  objectView?: { typeList: string[]; contextList: string[]; priority: number };
  isAvailable: boolean;
  unavailableReason: string;
};

// what a provider of the page offers. every method is optional but those
// its capabilities name; each receives the type registry
export type ObjectProvider = {
  id: string;
  label: string;
  registry?: 'page' | 'backend';
  // another registry: its query and relation query answer their own
  // completeness, and it lists the providers behind it (providerInfoListGet)
  isPeer?: boolean;
  namespaceList: string[];
  namespaceIs?: (namespace: string) => boolean;
  typeList: string[];
  relationTypeList?: string[];
  capabilityList: string[];
  queryFilterList?: string[];
  cacheSecond?: number;
  statusGet?: () => { status: string; message: string };
  // a value read reactively: when it changes, what the registry kept of the provider is asked again
  versionGet?: () => any;
  query?: (spec: any, registry: any) => Promise<any> | any;
  resolve?: (refList: string[], registry: any, options?: { isVerify?: boolean }) => Promise<any[]> | any[];
  read?: (ref: string, registry: any) => Promise<{ descriptor: any; content: any }>;
  update?: (ref: string, patch: any, registry: any) => Promise<{ descriptor: any; content: any }>;
  relationQuery?: (spec: any, registry: any) => Promise<any> | any;
  // a peer: how many objects each of its providers would answer, nothing
  // fetched ({ providerList: [{ providerId, count, countKind, status }] }),
  // and its providers as it lists them, for a search to plan per provider
  count?: (spec: any) => Promise<any>;
  providerInfoListGet?: () => any[];
  // a peer: accepts the descriptors the page's providers register into it
  register?: (descriptorList: any[], namespaceList: string[]) => Promise<ObjectResult>;
  // what the provider registers into a peer: the objects a service should
  // find without asking the page (the doc page source: its documents)
  descriptorListForPeerGet?: () => any[];
  // besides objects, what a provider brings to the layer: the types it
  // defines ({ typeList, problemList }), the components it serves, and
  // going to where its own layer shows one of its objects (true when it did)
  typeDefineGet?: () => { typeList: any[]; problemList: string[] } | null;
  compListGet?: () => ObjectProviderComp[];
  open?: (descriptor: ObjectDescriptor) => boolean | Promise<boolean>;
};

type ResolveEntry = { status: 'loading' | 'done'; descriptor: ObjectDescriptor; time: number; version: any; promise?: Promise<ObjectDescriptor> };
type RequestEntry<T> = { status: 'loading' | 'done'; result: T | null; time: number; version: any; promise?: Promise<T>; providerIdList: string[] };

// origin page: a component of the component registry; provider: one a
// provider serves (a service template's module), drawn while isAvailable
export type ObjectViewCandidate = {
  compId: string;
  typeList: string[];
  contextList: string[];
  priority: number;
  origin: 'page' | 'provider';
  label: string;
  sourceLabel: string;
  isAvailable: boolean;
  unavailableReason: string;
};

export type ObjectViewChoice = ObjectViewCandidate & { distance: number; isFallback: boolean };

export const objectEventTypeList = [
  'objectResolveRequest',
  'objectQueryRequest',
  'objectReadRequest',
  'objectUpdateRequest',
  'objectRelationQueryRequest',
  'objectOpenRequest',
];

// the view every object has: drawn for core.object, so it is simply the
// least specific view, chosen when nothing nearer to the object's types is
export const OBJECT_VIEW_FALLBACK_COMP_ID = 'common/ObjectViewFallback';

const CACHE_SECOND_DEFAULT = 15;
const QUERY_LIMIT_MAX = 500;
const PEER_REGISTER_DELAY_MS = 1500;

// the component registry (DocStore.compById), for the views
type Stores = { docStore?: any };

export class DocObjectStore {
  providerList: ObjectProvider[] = [];
  resolveByRef = observable.map<string, ResolveEntry>({}, { deep: false });
  queryByKey = observable.map<string, RequestEntry<ObjectQueryResult>>({}, { deep: false });
  relationByKey = observable.map<string, RequestEntry<ObjectRelationResult>>({}, { deep: false });
  registrationByRef = observable.map<string, { descriptor: ObjectDescriptor; registrant: any; time: number }>({}, { deep: false });
  // the page's documents registered into the peer registry (the backend's)
  peerRegistration = { status: 'idle' as 'idle' | 'submitting' | 'done' | 'error', count: 0, time: 0, message: '' };
  stores: Stores;
  objectService: Readonly<Record<string, (...args: any[]) => any>>;
  // the search of the layer (doc_page_impl_obj_search.md): one search, and
  // the sessions of the search uis
  searchStore: DocObjectSearchStore;
  disposeList: (() => void)[] = [];
  peerRegisterTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(stores: Stores = {}) {
    this.stores = stores;
    this.searchStore = new DocObjectSearchStore(this);
    // the stable service object components receive as config.object
    this.objectService = Object.freeze({
      resolve: (ref: string, options?: any) => this.resolve(ref, options),
      query: (spec: ObjectQuerySpec) => this.query(spec),
      read: (ref: string) => this.read(ref),
      update: (ref: string, patch: any) => this.update(ref, patch),
      relationQuery: (spec: ObjectRelationSpec) => this.relationQuery(spec),
      typeGet: (typeId: string) => this.typeRegistry.typeGet(typeId),
      typeIsAssignable: (typeId: string, typeIdTo: string) => this.typeRegistry.isAssignable(typeId, typeIdTo),
      open: (ref: string) => this.open(ref),
      // the search (doc_page_impl_obj_search.md): one search, or the
      // session of a search ui kept by the layer under the ui's own key
      search: (spec: any) => this.searchStore.search(spec),
      searchSessionGet: (key: string, options?: any) => this.searchStore.sessionGet(key, options),
      typeLabelGet: (typeId: string) => this.typeLabelGet(typeId),
      typeIconGet: (typeList: string[]) => this.typeIconGet(typeList),
    });
    makeAutoObservable(this, {
      providerList: observable.shallow,
      stores: false,
      objectService: false,
      searchStore: false,
      viewStateByKey: false,
      disposeList: false,
      peerRegisterTimer: false,
      resolveByRef: false,
      queryByKey: false,
      relationByKey: false,
      registrationByRef: false,
    });
  }

  init() {
    // what the page's providers register into the peer (the documents of
    // the page into the backend's registry, so its services find them):
    // when the peer becomes ready, and whenever what they register changes
    this.disposeList.push(reaction(
      () => {
        const peer = this.peerRegistrableGet();
        return {
          isReady: peer !== undefined && this.providerStatusGet(peer).status === 'ready',
          descriptorList: this.providerList.flatMap((provider) => provider.descriptorListForPeerGet?.() ?? []),
        };
      },
      ({ isReady }) => {
        if (!isReady) return;
        if (this.peerRegisterTimer) clearTimeout(this.peerRegisterTimer);
        this.peerRegisterTimer = setTimeout(() => void this.peerRegister(), PEER_REGISTER_DELAY_MS);
      },
      { fireImmediately: true, equals: comparer.structural },
    ));
  }

  dispose() {
    for (const disposeOne of this.disposeList) disposeOne();
    this.disposeList = [];
    if (this.peerRegisterTimer) clearTimeout(this.peerRegisterTimer);
  }

  // ---------- types ----------

  // the types the providers define come first, so the backend's definition
  // of a built-in type (the same file) is the one kept
  get typeRegistry(): any {
    const typeListProvided = this.providerList.flatMap((provider) => provider.typeDefineGet?.()?.typeList ?? []);
    return typeRegistryBuild(typeListProvided.length > 0 ? [...typeListProvided, ...typeBuiltinList] : typeBuiltinList);
  }

  get typeList(): any[] {
    return this.typeRegistry.typeList();
  }

  get typeProblemList(): string[] {
    return [...this.providerList.flatMap((provider) => provider.typeDefineGet?.()?.problemList ?? []), ...this.typeRegistry.problemList];
  }

  typeGet(typeId: string): any {
    return this.typeRegistry.typeGet(typeId);
  }

  // the label of a type, its id when nobody defines it
  typeLabelGet(typeId: string): string {
    return this.typeGet(typeId)?.label ?? typeId;
  }

  // the icon name of an object's type: its own type's, else the nearest ancestor's
  typeIconGet(typeList: string[]): string {
    const registry = this.typeRegistry;
    for (const typeId of typeList) {
      for (const id of [typeId, ...registry.ancestorListGet(typeId)]) {
        const icon = registry.typeGet(id)?.icon;
        if (icon) return icon;
      }
    }
    return 'box';
  }

  // ---------- providers ----------

  providerAdd(provider: ObjectProvider) {
    this.providerList = [...this.providerList.filter((item) => item.id !== provider.id), provider];
  }

  providerRemove(id: string) {
    this.providerList = this.providerList.filter((item) => item.id !== id);
    this.changed(id);
  }

  providerGet(id: string): ObjectProvider | undefined {
    return this.providerList.find((provider) => provider.id === id);
  }

  // the provider authoritative for a namespace
  providerOfNamespaceGet(namespace: string): ObjectProvider | undefined {
    return this.providerList.find((provider) => provider.namespaceList.includes(namespace) || provider.namespaceIs?.(namespace) === true);
  }

  providerOfRefGet(ref: string): ObjectProvider | undefined {
    const parsed = objectRefParse(ref);
    return parsed ? this.providerOfNamespaceGet(parsed.namespace) : undefined;
  }

  providerStatusGet(provider: ObjectProvider): { status: string; message: string } {
    return provider.statusGet?.() ?? { status: 'ready', message: '' };
  }

  // ---------- resolve ----------

  // what the registry knows of a reference now, for a component drawing it;
  // read in an observer, it asks the provider (later, not while rendering)
  // when it knows nothing yet, or what it knows is older than the
  // provider's cacheSecond, or the provider's version changed
  resolveStateGet(ref: string): ResolveEntry {
    const entry = this.resolveByRef.get(ref);
    const provider = this.providerOfRefGet(ref);
    const version = provider?.versionGet?.();
    const isStale = !entry
      || (entry.status === 'done' && !entry.promise && (
        Date.now() - entry.time > (provider?.cacheSecond ?? CACHE_SECOND_DEFAULT) * 1000
        || !versionIsSame(entry.version, version)
      ));
    if (isStale && !entry?.promise) queueMicrotask(() => void this.resolve(ref));
    return entry ?? { status: 'loading', descriptor: objectDescriptorPlaceholder(ref, 'loading') as ObjectDescriptor, time: 0, version };
  }

  // the descriptor of a reference, from its provider (or what is known, when
  // it cannot answer). a request already sent is shared, unless isVerify
  resolve(ref: string, options: { isVerify?: boolean } = {}): Promise<ObjectDescriptor> {
    const entryCurrent = this.resolveByRef.get(ref);
    if (entryCurrent?.promise && !options.isVerify) return entryCurrent.promise;
    const provider = this.providerOfRefGet(ref);
    const version = provider?.versionGet?.();
    const promise = this.resolveFetch(ref, provider, options.isVerify === true);
    runInAction(() => {
      this.resolveByRef.set(ref, {
        status: entryCurrent?.status ?? 'loading',
        descriptor: entryCurrent?.descriptor ?? (objectDescriptorPlaceholder(ref, 'loading') as ObjectDescriptor),
        time: entryCurrent?.time ?? 0,
        version: entryCurrent?.version,
        promise,
      });
    });
    return promise.then((descriptor) => {
      runInAction(() => {
        if (this.resolveByRef.get(ref)?.promise !== promise) return;
        this.resolveByRef.set(ref, { status: 'done', descriptor, time: Date.now(), version });
      });
      return descriptor;
    });
  }

  private async resolveFetch(ref: string, provider: ObjectProvider | undefined, isVerify: boolean): Promise<ObjectDescriptor> {
    const parsed = objectRefParse(ref);
    if (!parsed) return objectDescriptorPlaceholder(ref, 'unknown', `${ref || '(empty)'} is not an object reference: {namespace}:{local}`) as ObjectDescriptor;
    const known = this.knownGet(ref);
    if (!provider) {
      if (known) return { ...known, status: 'registered' };
      return objectDescriptorPlaceholder(ref, 'unknown', `no provider of the namespace ${parsed.namespace}`) as ObjectDescriptor;
    }
    const status = this.providerStatusGet(provider);
    if (status.status !== 'ready') {
      return { ...(known ?? (objectDescriptorPlaceholder(ref, 'unavailable') as ObjectDescriptor)), status: 'unavailable', message: status.message || `${provider.label} is ${status.status}` };
    }
    if (!provider.capabilityList.includes('resolve') || !provider.resolve) {
      return known ?? (objectDescriptorPlaceholder(ref, 'unknown', `${provider.label} does not resolve its objects one by one`) as ObjectDescriptor);
    }
    try {
      const [item] = await provider.resolve([ref], this.typeRegistry, { isVerify });
      if (!item || item.status === 'missing') {
        return { ...(known ?? (objectDescriptorPlaceholder(ref, 'missing') as ObjectDescriptor)), status: 'missing', message: item?.message || `${provider.label} has no object ${ref}` };
      }
      return objectDescriptorNormalize(item, provider, item.status ?? 'found') as ObjectDescriptor;
    } catch (error: any) {
      return { ...(known ?? (objectDescriptorPlaceholder(ref, 'unavailable') as ObjectDescriptor)), status: 'unavailable', message: String(error?.message ?? error) };
    }
  }

  // what was known of a reference before: the last answer, else a registration
  private knownGet(ref: string): ObjectDescriptor | undefined {
    const entry = this.resolveByRef.get(ref);
    if (entry?.status === 'done' && entry.descriptor.typeList.length > 0) return entry.descriptor;
    const registration = this.registrationByRef.get(ref);
    return registration?.descriptor;
  }

  // descriptors a query (or a search) answered, kept as what is known of their references
  resolvePrime(descriptorList: ObjectDescriptor[]) {
    const now = Date.now();
    runInAction(() => {
      for (const descriptor of descriptorList) {
        const entry = this.resolveByRef.get(descriptor.ref);
        if (entry?.promise) continue;
        const provider = this.providerOfRefGet(descriptor.ref);
        this.resolveByRef.set(descriptor.ref, { status: 'done', descriptor, time: now, version: provider?.versionGet?.() });
      }
    });
  }

  // ---------- query ----------

  querySpecNormalize(spec: ObjectQuerySpec = {}): Required<ObjectQuerySpec> & { typeList: string[] } {
    const typeListRaw = typeof spec.typeList === 'string' ? [spec.typeList] : spec.typeList;
    return {
      typeList: Array.isArray(typeListRaw) && typeListRaw.length > 0 ? typeListRaw.map(String) : ['core.object'],
      text: String(spec.text ?? ''),
      filter: spec.filter && typeof spec.filter === 'object' ? spec.filter : {},
      limit: Math.max(1, Math.min(QUERY_LIMIT_MAX, Number(spec.limit) || 100)),
      providerIdList: Array.isArray(spec.providerIdList) ? spec.providerIdList.map(String) : [],
    };
  }

  private providerVersionList(): any[] {
    return this.providerList.map((provider) => provider.versionGet?.());
  }

  // the last answer of a query, for a component listing it; asks again the
  // way resolveStateGet does
  queryStateGet(specInput: ObjectQuerySpec): RequestEntry<ObjectQueryResult> {
    const spec = this.querySpecNormalize(specInput);
    const key = objectRequestKeyBuild(spec);
    return this.requestStateGet(this.queryByKey, key, () => this.query(spec));
  }

  query(specInput: ObjectQuerySpec, options: { isFresh?: boolean } = {}): Promise<ObjectQueryResult> {
    const spec = this.querySpecNormalize(specInput);
    const key = objectRequestKeyBuild(spec);
    return this.requestRun(this.queryByKey, key, options.isFresh === true, () => this.queryFetch(spec));
  }

  private async queryFetch(spec: ReturnType<DocObjectStore['querySpecNormalize']>): Promise<{ result: ObjectQueryResult; providerIdList: string[] }> {
    const registry = this.typeRegistry;
    const providerList = this.providerList.filter((provider) => provider.capabilityList.includes('query') && provider.query
      && this.providerIsAsked(provider, spec.providerIdList));
    const answerList = await Promise.all(providerList.map((provider) => this.providerAsk(provider, registry, spec.typeList, provider.typeList,
      () => provider.query!(this.providerSpecGet(provider, spec), registry), 'objectList')));
    const objectByRef = new Map<string, ObjectDescriptor>();
    const completenessList: ObjectCompleteness['providerList'] = [];
    const providerIdList: string[] = [];
    answerList.forEach((answer, index) => {
      if (!answer) return;
      const provider = providerList[index];
      providerIdList.push(provider.id);
      completenessList.push(...answer.completenessList);
      for (const item of answer.itemList) {
        const descriptor = (provider.isPeer ? item : objectDescriptorNormalize(item, provider, item.status ?? 'found')) as ObjectDescriptor;
        if (!registry.isAssignableAny(descriptor.typeList, spec.typeList) || !objectTextIsMatch(descriptor, spec.text)) continue;
        if (!objectByRef.has(descriptor.ref)) objectByRef.set(descriptor.ref, descriptor);
      }
    });
    let registeredCount = 0;
    for (const { descriptor } of this.registrationByRef.values()) {
      if (objectByRef.has(descriptor.ref)) continue;
      if (!registry.isAssignableAny(descriptor.typeList, spec.typeList) || !objectTextIsMatch(descriptor, spec.text)) continue;
      objectByRef.set(descriptor.ref, { ...descriptor, status: 'registered' });
      registeredCount += 1;
    }
    if (registeredCount > 0) {
      completenessList.push({ providerId: 'registration', label: 'registered on the page', registry: 'page', status: 'registered', count: registeredCount, message: '' });
    }
    const objectList = [...objectByRef.values()];
    const objectListLimited = objectList.slice(0, spec.limit);
    this.resolvePrime(objectListLimited.filter((descriptor) => descriptor.status === 'found'));
    return {
      providerIdList,
      result: {
        objectList: objectListLimited,
        isTruncated: objectList.length > spec.limit,
        completeness: completenessBuild(completenessList),
      },
    };
  }

  // whether a query naming providers (providerIdList, empty: all) asks this
  // one: by its id, or, for a peer, by the id of a provider behind it
  private providerIsAsked(provider: ObjectProvider, providerIdList: string[]): boolean {
    if (providerIdList.length === 0 || providerIdList.includes(provider.id)) return true;
    return provider.isPeer === true && (provider.providerInfoListGet?.() ?? []).some((info: any) => providerIdList.includes(info.id));
  }

  // the spec a provider is asked with: a peer gets only the ids of its own
  // providers (none: all of them)
  private providerSpecGet(provider: ObjectProvider, spec: any): any {
    if (!provider.isPeer || spec.providerIdList.length === 0) return spec;
    const idSet = new Set((provider.providerInfoListGet?.() ?? []).map((info: any) => info.id));
    return { ...spec, providerIdList: spec.providerIdList.filter((id: string) => idSet.has(id)) };
  }

  // one provider of a federated request: undefined when it has nothing of
  // the types asked for; else what it answered and how complete it was
  private async providerAsk(provider: ObjectProvider, registry: any, typeListAsked: string[], typeListOwn: string[], call: () => any, listKey: 'objectList' | 'relationList'):
    Promise<{ itemList: any[]; completenessList: ObjectCompleteness['providerList'] } | undefined> {
    const status = this.providerStatusGet(provider);
    const registryName = provider.registry ?? 'page';
    // a page without a backend has no backend: not an incomplete answer
    if (provider.isPeer && status.status === 'none') return undefined;
    if (!provider.isPeer && !registry.isAssignableAny(typeListOwn, typeListAsked)) return undefined;
    const entryBase = { providerId: provider.id, label: provider.label, registry: registryName };
    if (status.status !== 'ready') {
      return { itemList: [], completenessList: [{ ...entryBase, status: 'unavailable', count: 0, message: status.message }] };
    }
    try {
      const answer = await call();
      if (Array.isArray(answer)) return { itemList: answer, completenessList: [{ ...entryBase, status: 'answered', count: answer.length, message: '' }] };
      const itemList = answer?.[listKey] ?? [];
      if (provider.isPeer) {
        // the backend's own completeness, one entry per provider of the backend
        const completenessList = (answer?.completeness?.providerList ?? []).map((item: any) => ({
          providerId: item.providerId, label: item.label, registry: 'backend', status: item.status, count: item.count ?? 0, message: item.message ?? '',
        }));
        return { itemList, completenessList };
      }
      return {
        itemList,
        completenessList: [{ ...entryBase, status: answer?.isComplete === false ? 'partial' : 'answered', count: itemList.length, message: answer?.message ?? '' }],
      };
    } catch (error: any) {
      return { itemList: [], completenessList: [{ ...entryBase, status: 'failed', count: 0, message: String(error?.message ?? error) }] };
    }
  }

  // ---------- relations ----------

  relationSpecNormalize(spec: ObjectRelationSpec = {}): { fromRef: string; toRef: string; typeList: string[] } {
    const typeListRaw = typeof spec.typeList === 'string' ? [spec.typeList] : spec.typeList;
    return {
      fromRef: String(spec.fromRef ?? ''),
      toRef: String(spec.toRef ?? ''),
      typeList: Array.isArray(typeListRaw) && typeListRaw.length > 0 ? typeListRaw.map(String) : ['core.relation'],
    };
  }

  relationStateGet(specInput: ObjectRelationSpec): RequestEntry<ObjectRelationResult> {
    const spec = this.relationSpecNormalize(specInput);
    return this.requestStateGet(this.relationByKey, objectRequestKeyBuild(spec), () => this.relationQuery(spec));
  }

  // the members of a collection, in their order: its core.member relations
  memberStateGet(ref: string): RequestEntry<ObjectRelationResult> {
    return this.relationStateGet({ fromRef: ref, typeList: ['core.member'] });
  }

  relationQuery(specInput: ObjectRelationSpec, options: { isFresh?: boolean } = {}): Promise<ObjectRelationResult> {
    const spec = this.relationSpecNormalize(specInput);
    return this.requestRun(this.relationByKey, objectRequestKeyBuild(spec), options.isFresh === true, () => this.relationFetch(spec));
  }

  private async relationFetch(spec: { fromRef: string; toRef: string; typeList: string[] }): Promise<{ result: ObjectRelationResult; providerIdList: string[] }> {
    const registry = this.typeRegistry;
    const providerList = this.providerList.filter((provider) => provider.capabilityList.includes('relationQuery') && provider.relationQuery);
    const answerList = await Promise.all(providerList.map((provider) => this.providerAsk(provider, registry, spec.typeList, provider.relationTypeList ?? [],
      () => provider.relationQuery!(spec, registry), 'relationList')));
    const relationList: any[] = [];
    const completenessList: ObjectCompleteness['providerList'] = [];
    const providerIdList: string[] = [];
    answerList.forEach((answer, index) => {
      if (!answer) return;
      const provider = providerList[index];
      providerIdList.push(provider.id);
      completenessList.push(...answer.completenessList);
      for (const item of answer.itemList) {
        const relation = provider.isPeer ? item : relationNormalize(item, provider);
        if (spec.fromRef && relation.fromRef !== spec.fromRef) continue;
        if (spec.toRef && relation.toRef !== spec.toRef) continue;
        if (!registry.isAssignableAny([relation.type], spec.typeList)) continue;
        relationList.push(relation);
      }
    });
    relationList.sort(relationCompare);
    return { providerIdList, result: { relationList, completeness: completenessBuild(completenessList) } };
  }

  // ---------- the caches of requests ----------

  private requestStateGet<T>(map: any, key: string, run: () => Promise<T>): RequestEntry<T> {
    const entry = map.get(key) as RequestEntry<T> | undefined;
    const version = this.providerVersionList();
    const cacheSecond = Math.min(...this.providerList.map((provider) => provider.cacheSecond ?? CACHE_SECOND_DEFAULT), 300);
    const isStale = !entry || (entry.status === 'done' && !entry.promise && (
      Date.now() - entry.time > cacheSecond * 1000 || !versionIsSame(entry.version, version)
    ));
    if (isStale && !entry?.promise) queueMicrotask(() => void run());
    return entry ?? { status: 'loading', result: null, time: 0, version, providerIdList: [] };
  }

  private requestRun<T>(map: any, key: string, isFresh: boolean, fetch: () => Promise<{ result: T; providerIdList: string[] }>): Promise<T> {
    const entryCurrent = map.get(key) as RequestEntry<T> | undefined;
    if (entryCurrent?.promise && !isFresh) return entryCurrent.promise;
    const version = this.providerVersionList();
    const promise = fetch().then(({ result, providerIdList }) => {
      runInAction(() => {
        if (map.get(key)?.promise !== promise) return;
        map.set(key, { status: 'done', result, time: Date.now(), version, providerIdList });
      });
      return result;
    });
    runInAction(() => {
      map.set(key, {
        status: entryCurrent?.status ?? 'loading',
        result: entryCurrent?.result ?? null,
        time: entryCurrent?.time ?? 0,
        version: entryCurrent?.version,
        providerIdList: entryCurrent?.providerIdList ?? [],
        promise,
      });
    });
    return promise;
  }

  // what the registry kept of a provider (of these references, or all) is
  // asked again when next drawn
  changed(providerId: string, refList?: string[]) {
    runInAction(() => {
      for (const [ref, entry] of this.resolveByRef) {
        const isOfProvider = entry.descriptor.provider?.id === providerId
          || entry.descriptor.provider?.registry === providerId
          || this.providerOfRefGet(ref)?.id === providerId;
        if (isOfProvider && (!refList || refList.includes(ref))) this.resolveByRef.set(ref, { ...entry, time: 0 });
      }
      for (const map of [this.queryByKey, this.relationByKey] as any[]) {
        for (const [key, entry] of map) {
          if (entry.providerIdList.includes(providerId)) map.set(key, { ...entry, time: 0 });
        }
      }
    });
  }

  // ---------- read, update ----------

  // the content of an object, from its provider: never from what the registry keeps
  async read(ref: string): Promise<ObjectResult> {
    const provider = this.providerOfRefGet(ref);
    const reason = this.providerReasonGet(provider, ref, 'read');
    if (reason) return { code: -2, message: reason };
    try {
      const data = await provider!.read!(ref, this.typeRegistry);
      const descriptor = objectDescriptorNormalize(data.descriptor, provider, data.descriptor?.status ?? 'found') as ObjectDescriptor;
      this.resolvePrime([descriptor]);
      return { code: 0, data: { descriptor, content: data.content }, message: '' };
    } catch (error: any) {
      return { code: typeof error?.code === 'number' ? error.code : -1, message: String(error?.message ?? error) };
    }
  }

  // a change of an object, checked and made by its provider; what the
  // registry kept of the provider is asked again
  async update(ref: string, patch: any): Promise<ObjectResult> {
    const provider = this.providerOfRefGet(ref);
    const reason = this.providerReasonGet(provider, ref, 'update');
    if (reason) return { code: -2, message: reason };
    try {
      const data = await provider!.update!(ref, patch, this.typeRegistry);
      const descriptor = objectDescriptorNormalize(data.descriptor, provider, data.descriptor?.status ?? 'found') as ObjectDescriptor;
      this.changed(provider!.id);
      this.resolvePrime([descriptor]);
      return { code: 0, data: { descriptor, content: data.content }, message: '' };
    } catch (error: any) {
      return { code: typeof error?.code === 'number' ? error.code : -1, message: String(error?.message ?? error) };
    }
  }

  private providerReasonGet(provider: ObjectProvider | undefined, ref: string, capability: 'read' | 'update'): string {
    if (!objectRefParse(ref)) return `${ref || '(empty)'} is not an object reference`;
    if (!provider) return `no provider of the namespace ${objectRefParse(ref)!.namespace}`;
    if (!provider.capabilityList.includes(capability) || !provider[capability]) return `${provider.label} does not ${capability} its objects`;
    const status = this.providerStatusGet(provider);
    if (status.status !== 'ready') return status.message || `${provider.label} is ${status.status}`;
    return '';
  }

  // why an object cannot be changed from here ('' when it can): the
  // provider must offer the change (the descriptor says so) and answer now;
  // whether the consumer allows it is the consumer's own decision
  editUnavailableReasonGet(descriptor: ObjectDescriptor): string {
    if (!descriptor.capabilityList.includes('update')) return 'its provider does not change it from the page';
    if (descriptor.status !== 'found') return `it is ${descriptor.status}${descriptor.message ? `: ${descriptor.message}` : ''}`;
    const provider = this.providerOfRefGet(descriptor.ref);
    return this.providerReasonGet(provider, descriptor.ref, 'update');
  }

  // ---------- registration ----------

  // descriptors a principal of the page hands the registry: known, not
  // verified. a namespace a provider owns is registered in by that provider only
  register(descriptorList: any[], registrant: { kind: string; id: string }): ObjectResult {
    const now = Date.now();
    const normalizedList: ObjectDescriptor[] = [];
    for (const item of descriptorList) {
      const parsed = objectRefParse(item?.ref);
      if (!parsed) return { code: -1, message: `${item?.ref} is not an object reference` };
      const provider = this.providerOfNamespaceGet(parsed.namespace);
      if (provider && provider.id !== registrant.id) return { code: -2, message: `${provider.label} owns the namespace ${parsed.namespace}` };
      normalizedList.push(objectDescriptorNormalize(item, provider ?? { id: 'registration', label: 'registered on the page', registry: 'page' }, 'registered', now) as ObjectDescriptor);
    }
    runInAction(() => {
      for (const descriptor of normalizedList) this.registrationByRef.set(descriptor.ref, { descriptor, registrant, time: now });
    });
    return { code: 0, data: { registeredCount: normalizedList.length }, message: '' };
  }

  unregister(refList: string[], registrant: { kind: string; id: string }) {
    runInAction(() => {
      for (const ref of refList) {
        if (this.registrationByRef.get(ref)?.registrant?.id === registrant.id) this.registrationByRef.delete(ref);
      }
    });
  }

  // the peer registry that accepts the page's registrations (the backend's)
  private peerRegistrableGet(): ObjectProvider | undefined {
    return this.providerList.find((provider) => provider.isPeer && provider.register);
  }

  // the page's own objects (the doc pages, the documents) registered into
  // the peer registry, replacing what the page registered before
  async peerRegister(): Promise<void> {
    const peer = this.peerRegistrableGet();
    if (!peer || this.providerStatusGet(peer).status !== 'ready') return;
    const descriptorList = this.providerList.flatMap((provider) => provider.descriptorListForPeerGet?.() ?? []);
    const namespaceList = [...new Set(descriptorList.map((descriptor) => objectRefParse(descriptor.ref)?.namespace).filter(Boolean))] as string[];
    runInAction(() => {
      this.peerRegistration = { ...this.peerRegistration, status: 'submitting' };
    });
    const result = await peer.register!(descriptorList, namespaceList);
    runInAction(() => {
      this.peerRegistration = result.code === 0
        ? { status: 'done', count: descriptorList.length, time: Date.now(), message: '' }
        : { status: 'error', count: 0, time: Date.now(), message: result.message };
    });
  }

  // ---------- views ----------

  // the components the providers serve (the modules of the service templates)
  get providerCompList(): ObjectProviderComp[] {
    return this.providerList.flatMap((provider) => provider.compListGet?.() ?? []);
  }

  // every component that draws objects: those of the component registry
  // that expose objectView, and those the providers serve
  get viewCandidateList(): ObjectViewCandidate[] {
    const list: ObjectViewCandidate[] = [];
    for (const [compId, value] of Object.entries(this.stores.docStore?.compById ?? {})) {
      const definition = compDefinitionNormalize(value);
      const objectView = definition ? compObjectViewGet(definition) : undefined;
      if (objectView) {
        list.push({ compId, ...objectView, origin: 'page', label: definition.expose?.meta?.label ?? compId, sourceLabel: 'the page', isAvailable: true, unavailableReason: '' });
      }
    }
    for (const comp of this.providerCompList) {
      if (!comp.objectView) continue;
      list.push({
        compId: comp.compId, ...comp.objectView, origin: 'provider', label: comp.label, sourceLabel: comp.sourceLabel, isAvailable: comp.isAvailable, unavailableReason: comp.unavailableReason,
      });
    }
    return list;
  }

  // whether a view can be drawn now: its provider says so (a component of a
  // service template needs a ready instance of the template whose module is built)
  viewIsAvailable(candidate: ObjectViewCandidate): boolean {
    return candidate.isAvailable !== false;
  }

  // the views that can draw an object of these types in a context, the best
  // first: the nearest type (of two at one distance, the parent the object's
  // type lists first: rankGet), then the highest priority, then the page's own
  viewListGet(typeList: string[], context: string, isAvailableOnly = true): ObjectViewChoice[] {
    const registry = this.typeRegistry;
    const typeListObject = typeList.length > 0 ? typeList : ['core.object'];
    const result: ObjectViewChoice[] = [];
    for (const candidate of this.viewCandidateList) {
      if (!candidate.contextList.includes(context)) continue;
      if (isAvailableOnly && !this.viewIsAvailable(candidate)) continue;
      let distance: number | undefined;
      for (const typeId of candidate.typeList) {
        const distanceOne = registry.rankGet(typeListObject, typeId);
        if (distanceOne !== undefined && (distance === undefined || distanceOne < distance)) distance = distanceOne;
      }
      if (distance === undefined) continue;
      result.push({ ...candidate, distance, isFallback: candidate.compId === OBJECT_VIEW_FALLBACK_COMP_ID });
    }
    return result.sort((a, b) => a.distance - b.distance
      || b.priority - a.priority
      || (a.origin === b.origin ? 0 : a.origin === 'page' ? -1 : 1)
      || a.compId.localeCompare(b.compId));
  }

  // the view an object is drawn with: the one asked for when it can draw it,
  // else the best; the fallback view when nothing else can
  viewResolve(descriptor: ObjectDescriptor, context: string, compIdPreferred = ''): ObjectViewChoice {
    const contextUsed = OBJECT_VIEW_CONTEXT_LIST.includes(context) ? context : 'card';
    const viewList = this.viewListGet(descriptor.typeList, contextUsed);
    const preferred = compIdPreferred ? viewList.find((view) => view.compId === compIdPreferred) : undefined;
    return preferred ?? viewList[0] ?? {
      compId: OBJECT_VIEW_FALLBACK_COMP_ID, typeList: ['core.object'], contextList: [...OBJECT_VIEW_CONTEXT_LIST], priority: -100, origin: 'page',
      label: 'the fallback view', sourceLabel: 'the page', isAvailable: true, unavailableReason: '', distance: 0, isFallback: true,
    };
  }

  // ---------- the state of the views ----------
  // what a view shows besides the descriptor (the content it read, the draft
  // of a change, the state of a write) is kept here, by the key of the view
  // (its component, the object, the consumer), never in the view

  viewStateByKey = new Map<string, ObjectViewState>();

  viewStateGet(key: string): ObjectViewState {
    let state = this.viewStateByKey.get(key);
    if (!state) {
      state = new ObjectViewState();
      this.viewStateByKey.set(key, state);
    }
    return state;
  }

  // the content of the object, read from its provider into the view's state
  async viewContentLoad(state: ObjectViewState, ref: string): Promise<void> {
    runInAction(() => {
      state.contentStatus = 'loading';
      state.contentMessage = '';
    });
    const result = await this.read(ref);
    runInAction(() => {
      if (result.code === 0) {
        state.content = result.data.content;
        state.contentStatus = 'done';
      } else {
        state.contentStatus = 'error';
        state.contentMessage = result.message;
      }
    });
  }

  // the draft of a view sent as an update, built from it by patchBuild; the
  // content is the provider's answer, the draft is dropped
  async viewDraftSave(state: ObjectViewState, ref: string, patchBuild: (draftByKey: Record<string, any>) => any, messageDone = 'saved'): Promise<void> {
    runInAction(() => {
      state.writeStatus = 'submitting';
      state.writeMessage = '';
    });
    const result = await this.update(ref, patchBuild(state.draftByKey));
    runInAction(() => {
      if (result.code === 0) {
        state.content = result.data.content;
        state.contentStatus = 'done';
        state.draftByKey = {};
        state.writeStatus = 'idle';
        state.writeMessage = messageDone;
      } else {
        state.writeStatus = 'error';
        state.writeMessage = result.message;
      }
    });
  }

  // ---------- what a service template requires ----------

  // whether a requirement of a template's script (expose.requireList:
  // { kind: type | objectView | comp, value, context, isRequired }) is met,
  // and by whom. resolved here, where every provider of types and views is
  // known: the built-in types and those the providers define, the views of
  // the component registry and the components the providers serve.
  //   satisfied    someone provides it now
  //   unavailable  a provider has it, but cannot serve it now (no ready instance of its template)
  //   fallback     (objectView) nothing but the fallback view draws the type
  //   missing      nobody provides it
  requireStatusGet(require: { kind: string; value: string; context?: string }): { status: string; providerList: string[] } {
    if (require.kind === 'type') {
      const type = this.typeGet(require.value);
      if (!type) return { status: 'missing', providerList: [] };
      const definedBy = type.definedBy ?? {};
      return { status: 'satisfied', providerList: [definedBy.kind === 'builtIn' ? 'built-in' : `${definedBy.kind === 'serviceTemplate' ? 'template' : definedBy.kind} ${definedBy.name ?? definedBy.id ?? ''}`.trim()] };
    }
    if (require.kind === 'objectView') {
      const viewList = this.viewListGet([require.value], require.context || 'card', false).filter((view) => !view.isFallback);
      if (viewList.length === 0) return { status: 'fallback', providerList: [] };
      const providerList = viewList.map((view) => `${view.label} (${view.sourceLabel}${view.isAvailable ? '' : `, ${view.unavailableReason}`})`);
      return { status: viewList.some((view) => this.viewIsAvailable(view)) ? 'satisfied' : 'unavailable', providerList };
    }
    const comp = this.providerCompList.find((item) => item.compId === require.value);
    if (comp) return { status: comp.isAvailable ? 'satisfied' : 'unavailable', providerList: [comp.sourceLabel] };
    // a component of a service's module is defined from its id alone
    // (service-comp-define.js): it exists only when a provider serves it
    const definition = compDefinitionGet(this.stores.docStore?.compById ?? {}, require.value);
    const isRegistered = definition !== undefined && definition.expose?.meta?.isServiceComp !== true;
    return isRegistered ? { status: 'satisfied', providerList: ['the component registry'] } : { status: 'missing', providerList: [] };
  }

  // ---------- opening an object ----------

  // goes to where the object is shown by its own layer (a document, the
  // Services tab, the asset panel): its provider opens it, else the first
  // provider that knows its kind of place (a registered object). false when
  // it has no such place
  async open(ref: string): Promise<boolean> {
    const descriptor = this.resolveByRef.get(ref)?.descriptor?.open ? this.resolveByRef.get(ref)!.descriptor : await this.resolve(ref);
    if (!descriptor.open) return false;
    const providerOwn = this.providerOfRefGet(ref);
    for (const provider of [providerOwn, ...this.providerList.filter((item) => item !== providerOwn)]) {
      if (provider?.open && (await provider.open(descriptor)) === true) return true;
    }
    return false;
  }

  // ---------- events ----------

  // the requests of components (doc_page_impl_obj.md#from-a-component)
  async eventHandle(event: { type: string; data: Record<string, any> }): Promise<ObjectResult | undefined> {
    if (!objectEventTypeList.includes(event.type)) return undefined;
    const data = event.data ?? {};
    switch (event.type) {
      case 'objectResolveRequest': {
        const refList = Array.isArray(data.refList) ? data.refList : [data.ref];
        const descriptorList = await Promise.all(refList.map((ref: string) => this.resolve(String(ref ?? ''), { isVerify: data.isVerify === true })));
        return { code: 0, data: Array.isArray(data.refList) ? descriptorList : descriptorList[0], message: '' };
      }
      case 'objectQueryRequest':
        return { code: 0, data: await this.query(data, { isFresh: data.isFresh === true }), message: '' };
      case 'objectRelationQueryRequest':
        return { code: 0, data: await this.relationQuery(data, { isFresh: data.isFresh === true }), message: '' };
      case 'objectReadRequest':
        return this.read(String(data.ref ?? ''));
      case 'objectUpdateRequest':
        return this.update(String(data.ref ?? ''), data.patch);
      case 'objectOpenRequest':
        return (await this.open(String(data.ref ?? ''))) ? { code: 0, message: '' } : { code: -1, message: 'the object has no place to open' };
      default:
        return undefined;
    }
  }
}

// the state of one view of one object: its content, its draft, its write
export class ObjectViewState {
  contentStatus: 'idle' | 'loading' | 'done' | 'error' = 'idle';
  content: any = null;
  contentMessage = '';
  draftByKey: Record<string, any> = {};
  writeStatus: 'idle' | 'submitting' | 'error' = 'idle';
  writeMessage = '';

  constructor() {
    makeAutoObservable(this, { content: observable.ref });
  }

  draftSet(key: string, value: any) {
    this.draftByKey = { ...this.draftByKey, [key]: value };
  }

  draftClear() {
    this.draftByKey = {};
    this.writeMessage = '';
  }
}

function completenessBuild(providerList: ObjectCompleteness['providerList']): ObjectCompleteness {
  return {
    isComplete: providerList.every((item) => ['answered', 'cached', 'registered'].includes(item.status)),
    providerList,
  };
}

// two versions of a provider (or of every provider): the same values, one by one
function versionIsSame(a: any, b: any): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((value, index) => versionIsSame(value, b[index]));
}
