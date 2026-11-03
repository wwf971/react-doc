import { objectDescriptorNormalize, relationNormalize } from './doc-object-ref.js';

// The object registry of the service backend as a provider of the page's
// (design: doc_page_impl_obj.md#the-page-and-the-backend). It is a peer, not
// a source: the backend federates its own providers (the kernel, the
// instances) and says how complete its answer is; the page merges that into
// its own completeness. It owns the namespaces of the backend: service,
// serviceTemplate, serviceConfig, and service.{serviceId} of every instance.
//
// While the backend is down, it answers nothing and is reported unavailable:
// what the page knew of its objects is still drawn, with that status.

const BACKEND_NAMESPACE_LIST = ['service', 'serviceTemplate', 'serviceConfig'];

export function objectProviderBackendCreate({ serviceStore }) {
  // an icon of the backend is a path of its api: the page reaches it by the
  // backend's address, which only the service store knows
  const descriptorAdapt = (item) => ({
    ...item,
    iconUrl: typeof item.iconUrl === 'string' && item.iconUrl.startsWith('/') ? serviceStore.backendUrlGet(item.iconUrl) : (item.iconUrl ?? ''),
  });
  const resultRequire = (result, what) => {
    if (result.code !== 0) {
      const error = new Error(result.message || `${what} failed`);
      error.code = result.code;
      throw error;
    }
    return result.data;
  };

  return {
    id: 'backend',
    label: 'the service backend',
    registry: 'backend',
    isPeer: true,
    namespaceList: BACKEND_NAMESPACE_LIST,
    namespaceIs: (namespace) => BACKEND_NAMESPACE_LIST.includes(namespace) || namespace.startsWith('service.'),
    get typeList() {
      return [...new Set((serviceStore.objectProviderList ?? []).flatMap((provider) => provider.typeList ?? []))];
    },
    get relationTypeList() {
      return [...new Set((serviceStore.objectProviderList ?? []).flatMap((provider) => provider.relationTypeList ?? []))];
    },
    capabilityList: ['query', 'resolve', 'read', 'update', 'relationQuery'],
    // the providers of the backend and their states: a poll of the registry
    // that finds them as they were changes nothing
    versionGet: () => (serviceStore.objectProviderList ?? []).map((provider) => `${provider.id}:${provider.status}`).join(','),
    cacheSecond: 15,
    statusGet: () => {
      if (serviceStore.backendStatus === 'up') return { status: 'ready', message: '' };
      if (serviceStore.backendStatus === 'loading') return { status: 'loading', message: 'asking the service backend…' };
      return { status: serviceStore.backendStatus === 'none' ? 'none' : 'unavailable', message: serviceStore.unavailableReason };
    },

    // { objectList, isTruncated, completeness }: the backend's own answer
    query: async (spec) => {
      const data = resultRequire(await serviceStore.objectCall((backend) => backend.objectQuery(spec)), 'the query of the backend');
      return {
        ...data,
        objectList: (data.objectList ?? []).map((item) => objectDescriptorNormalize(descriptorAdapt(item), null, item.status)),
      };
    },
    resolve: async (refList, _registry, options = {}) => {
      const isVerify = options.isVerify === true;
      const data = resultRequire(await serviceStore.objectCall((backend) => backend.objectResolve(refList, isVerify)), 'the resolve of the backend');
      return data.map((item) => objectDescriptorNormalize(descriptorAdapt(item), null, item.status));
    },
    read: async (ref) => {
      const data = resultRequire(await serviceStore.objectCall((backend) => backend.objectRead(ref)), 'the read of the backend');
      return { descriptor: objectDescriptorNormalize(descriptorAdapt(data.descriptor), null), content: data.content };
    },
    update: async (ref, patch) => {
      const data = resultRequire(await serviceStore.objectCall((backend) => backend.objectUpdate(ref, patch)), 'the update of the backend');
      // a config changed restarts its instance: the registry of services is asked again
      void serviceStore.refresh();
      return { descriptor: objectDescriptorNormalize(descriptorAdapt(data.descriptor), null), content: data.content };
    },
    relationQuery: async (spec) => {
      const data = resultRequire(await serviceStore.objectCall((backend) => backend.relationQuery(spec)), 'the relation query of the backend');
      return { ...data, relationList: (data.relationList ?? []).map((item) => relationNormalize(item, null)) };
    },
    register: (descriptorList, namespaceList) => serviceStore.objectCall((backend) => backend.objectRegister({ descriptorList, namespaceList, isReplace: true })),
  };
}
