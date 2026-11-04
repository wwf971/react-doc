import { runInAction } from 'mobx';
import { objectDescriptorNormalize, relationNormalize } from './doc-object-ref.js';
import { typeDefineNormalize } from './doc-object-type.js';
import { serviceCompIdBuild } from '../../../comp-doc/service/service-comp-define.js';

// The object registry of the service backend as a provider of the page's
// (design: doc_page_impl_obj.md#the-page-and-the-backend). It is a peer, not
// a source: the backend federates its own providers (the kernel, the
// instances) and says how complete its answer is; the page merges that into
// its own completeness. It owns the namespaces of the backend: service,
// serviceTemplate, serviceConfig, and service.{serviceId} of every instance.
//
// It is also everything the page's registry knows of the services, so the
// registry itself knows none: the types of the templates (the backend's
// list), the components of their modules (compList, drawn while a ready
// instance of the template serves its module), the providers behind it (for
// the plan of a search) and the Services tab, where its objects open.
//
// While the backend is down, it answers nothing and is reported unavailable:
// what the page knew of its objects is still drawn, with that status.

const BACKEND_NAMESPACE_LIST = ['service', 'serviceTemplate', 'serviceConfig'];

export function objectProviderBackendCreate({ serviceStore, configStore }) {
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

  // a component of a template's module is drawn while a ready instance of
  // the template has its module built (ServiceCompHost loads it from one)
  const templateIsServing = (templateName) => serviceStore.backendStatus === 'up'
    && serviceStore.instanceListOfTemplateName(templateName).some((instance) => instance.status === 'ready' && instance.dashboardBuild?.isBuilt);

  // the components of the templates' modules: of each ready template, and
  // of instances whose template is gone (their own copy of the script)
  const compListGet = () => {
    const list = [];
    const templateNameSet = new Set();
    const exposeAdd = (templateName, expose) => {
      templateNameSet.add(templateName);
      const isAvailable = templateIsServing(templateName);
      for (const comp of expose?.compList ?? []) {
        list.push({
          compId: serviceCompIdBuild(templateName, comp.id),
          label: comp.label || comp.id,
          sourceLabel: `template ${templateName}`,
          ...(comp.objectView ? { objectView: comp.objectView } : {}),
          isAvailable,
          unavailableReason: isAvailable ? '' : 'no ready instance',
        });
      }
    };
    for (const template of serviceStore.templateList ?? []) if (template.status === 'ready') exposeAdd(template.name, template.expose);
    for (const instance of serviceStore.instanceList ?? []) {
      const templateName = instance.template?.name;
      if (templateName && !templateNameSet.has(templateName) && instance.expose) exposeAdd(templateName, instance.expose);
    }
    return list;
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
    capabilityList: ['query', 'count', 'resolve', 'read', 'update', 'relationQuery'],
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
    // { providerList: [{ providerId, count, countKind, status, message }] }
    count: async (spec) => resultRequire(await serviceStore.objectCall((backend) => backend.objectCount(spec)), 'the count of the backend'),
    // the providers of the backend as it lists them: { id, label, serviceId, templateName, typeList, capabilityList, ... }
    providerInfoListGet: () => serviceStore.objectProviderList ?? [],
    register: (descriptorList, namespaceList) => serviceStore.objectCall((backend) => backend.objectRegister({ descriptorList, namespaceList, isReplace: true })),

    // the built-in types (the kernel's copy) and those the templates define
    typeDefineGet: () => {
      const typeList = serviceStore.objectTypeList?.typeList;
      if (!Array.isArray(typeList) || typeList.length === 0) return null;
      return { typeList: typeList.map((item) => typeDefineNormalize(item, item.definedBy)), problemList: serviceStore.objectTypeList.problemList ?? [] };
    },
    compListGet,

    // an instance or a template opens the Services tab on it
    open: (descriptor) => {
      const open = descriptor.open;
      if (!configStore || (open?.kind !== 'serviceInstance' && open?.kind !== 'serviceTemplate')) return false;
      runInAction(() => {
        configStore.settingsOpenSet(true);
        configStore.settingsTabIdSet('service');
        if (open.kind === 'serviceInstance') serviceStore.settingsServiceSelect(open.serviceId);
        else serviceStore.settingsTemplateSelect(open.templateId);
      });
      return true;
    },
  };
}
