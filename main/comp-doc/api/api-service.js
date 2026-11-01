import { Server } from '../../frontend/UICommon.js';
import { apiDefine, apiWithIdBuild } from '../../frontend/src/lib/doc-api.js';

// The service instances as a provider of the unified api registry
// (doc_page_impl_api.md#providers): every sync api of every running
// instance, under service/{templateName}/{apiName}, while the backend is
// up and the instance is ready. the api comes and goes with the instance,
// so a hotkey bound to it is hidden while the instance is away rather than
// broken (doc_page_impl_api_hotkey.md). an async api of a service runs as a
// job and is not an api of the page (an api answers within the call).
//
// the call goes through DocServiceStore.apiCall with the target
// { serviceId }: the instance of the template (the param serviceId picks
// one when several instances of a template run; else the first ready one)

export function serviceApiProviderCreate(serviceStore) {
  return {
    name: 'service',
    apiByIdGet: () => {
      const apiById = {};
      if (serviceStore.backendStatus !== 'up') return apiById;
      const instanceListReady = serviceStore.instanceList.filter((instance) => instance.status === 'ready' && instance.expose?.apiList);
      const templateNameSet = new Set(instanceListReady.map((instance) => instance.template?.name).filter(Boolean));
      for (const templateName of templateNameSet) {
        const instanceList = instanceListReady.filter((instance) => instance.template?.name === templateName);
        const instanceFirst = instanceList[0];
        for (const api of instanceFirst.expose.apiList) {
          if (api.execution !== 'sync' || !api.callerKindList?.includes('page')) continue;
          const id = `service/${templateName}/${api.name}`;
          apiById[id] = apiWithIdBuild(id, apiDefine({
            name: api.name,
            label: `${instanceFirst.expose?.meta?.label ?? templateName} · ${api.name}`,
            description: api.description || `${api.kind} api of the service template ${templateName}`,
            category: 'Service',
            icon: Server,
            paramList: [
              ...(api.paramList ?? []).map((param) => ({
                name: param.name,
                type: paramTypeGet(param.schema?.type),
                isRequired: param.isRequired === true,
                description: param.description,
                ...(param.schema?.default !== undefined ? { valueDefault: param.schema.default } : {}),
              })),
              { name: 'serviceId', type: 'string', description: `the instance of ${templateName} to call; the first ready one when absent` },
            ],
            run: async (context, params) => {
              const { serviceId, ...paramsApi } = params;
              const instance = serviceId
                ? serviceStore.instanceGet(serviceId)
                : serviceStore.instanceList.find((item) => item.status === 'ready' && item.template?.name === templateName);
              if (!instance) return { code: -1, message: serviceId ? `no instance ${serviceId}` : `no ready instance of ${templateName}` };
              return serviceStore.apiCall({ serviceId: instance.serviceId }, api.name, paramsApi, '');
            },
          }));
        }
      }
      return apiById;
    },
  };
}

function paramTypeGet(schemaType) {
  switch (schemaType) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
      return schemaType;
    case 'integer':
      return 'number';
    case 'array':
      return 'list';
    default:
      return 'any';
  }
}
