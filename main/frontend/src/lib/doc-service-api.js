// The client of the service backend in the browser (design:
// doc_page_impl_service.md#backend-api). The page reaches the
// backend through the development server, which forwards {endpoint}/* to
// it unchanged (plugin/doc-service-server.ts). Every call answers
// { code, data, message }:
//
//    0  success
//   -1  bad request, or the api failed (its message says why)
//   -2  the caller may not call the api (an api answered to services only)
//   -3  the template, instance, infra name, api or job is not found
//   -4  the instance is not ready (disabled, waiting, its config or its script failed)
//   -5  the backend cannot be reached (answered by the plugin, or here when
//       the development server itself does not answer)
//   -6  a sync api did not finish in time; it is still queued or running
//   -7  an infra service the call depends on is unavailable (no instance
//       provides the name, the instance providing it is not ready, or a
//       required dependency of the called instance is unavailable and its
//       onUnavailable is reject)
//
//   statusGet()                              { timeStarted, templateCount, instanceCount, scanProblemList, kernel, ... }
//   registryGet()                            { templateList, instanceList, infraList, status }: everything in one call
//   infraList()                              [{ name, serviceId, status, isRouteExplicit, providerList, consumerList, templateList, storage }]
//   logRecent(limit)                         the kernel's own log buffer: [{ time, level, principal, feature, message, data }]
//   templateList()                           [{ templateId, name, kind, provision, infraName, origin, description, versionId, versionList,
//                                               config, status, message, folder, dirName, expose, dashboardBuild }]
//   templateVersionNew(templateId, note)     the template with a new version id
//   instanceList()                           [{ serviceId, name, kind, origin, provision, description, isEnabled, template, config,
//                                               dependencyList, dependencyStatusList, isDependencyDynamicAllowed, infraName,
//                                               status, message, health, healthMessage, executionMode, isResidentRunning,
//                                               hookRecordList, timeCreateHook, folder, dirName, expose, dashboardBuild,
//                                               queueLength, apiRunning }]
//   instanceCreate({ templateId, name, description, config, docPageAlias })   the instance created from the template
//   instanceDependencySet(serviceId, dependencyList, isDependencyDynamicAllowed)   the instance, restarted
//   instanceEnableSet(serviceId, isEnabled)  the instance
//   instanceDelete(serviceId)                { serviceId, folderDeleted }
//   infraRouteSet(name, serviceId)           the infra entry; serviceId '' goes back to the default route
//   docPageSync()                            the kernel's doc page list; the body is filled by the development
//                                            server with the doc pages the page loaded
//   apiCall(target, api, params, dashboardServiceId)
//                                            a sync api: its result; an async api: its job. target is
//                                            { serviceId }, { templateId, versionId? } or { infra: name };
//                                            dashboardServiceId the instance whose dashboard asks ('' for none)
//   instanceResolve(target, dashboardServiceId)  the instance a call of target goes to, as listed
//   jobGet(serviceId, jobId)                 { serviceId, jobId, api, status, progress, progressMessage, result, ... }
//   templateIconUrlGet(templateId)           the url of a template's icon
//   instanceIconUrlGet(serviceId)            the url of an instance's icon (its own copy)
//   dashboardEntryUrlGet(serviceId, entry)   the url of the remote entry of an instance's dashboards

export const SERVICE_CODE_NOT_ALLOWED = -2;
export const SERVICE_CODE_NOT_FOUND = -3;
export const SERVICE_CODE_NOT_READY = -4;
export const SERVICE_CODE_BACKEND_DOWN = -5;
export const SERVICE_CODE_TIMEOUT = -6;
export const SERVICE_CODE_INFRA_UNAVAILABLE = -7;

export function serviceBackendApiCreate(endpoint) {
  const endpointNormalized = String(endpoint ?? '').replace(/\/+$/, '');

  const requestSend = async (route, init) => {
    try {
      const response = await fetch(`${endpointNormalized}${route}`, { cache: 'no-store', ...init });
      const payload = await response.json().catch(() => undefined);
      if (!payload || typeof payload.code !== 'number') {
        return { code: -1, data: null, message: `the service api answered ${response.status} without a result` };
      }
      return { code: payload.code, data: payload.data, message: payload.message ?? '' };
    } catch (error) {
      return { code: SERVICE_CODE_BACKEND_DOWN, data: null, message: `the development server is not reachable: ${String(error?.message ?? error)}` };
    }
  };
  const requestPost = (route, body) => requestSend(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const query = (value) => encodeURIComponent(String(value ?? ''));

  return {
    statusGet: () => requestSend('/status'),
    registryGet: () => requestSend('/registry'),
    infraList: () => requestSend('/infra/list'),
    logRecent: (limit = 200) => requestSend(`/log/recent?limit=${query(limit)}`),
    templateList: () => requestSend('/template/list'),
    templateVersionNew: (templateId, note) => requestPost('/template/version/new', { templateId, note }),
    instanceList: () => requestSend('/instance/list'),
    instanceCreate: ({ templateId, name, description, config, docPageAlias }) => requestPost('/instance/create', {
      templateId,
      name,
      description,
      config,
      ...(docPageAlias ? { docPageAlias } : {}),
    }),
    instanceDependencySet: (serviceId, dependencyList, isDependencyDynamicAllowed) => requestPost('/instance/dependency/set', {
      serviceId,
      dependencyList,
      ...(typeof isDependencyDynamicAllowed === 'boolean' ? { isDependencyDynamicAllowed } : {}),
    }),
    instanceEnableSet: (serviceId, isEnabled) => requestPost('/instance/enable', { serviceId, isEnabled }),
    instanceDelete: (serviceId) => requestPost('/instance/delete', { serviceId }),
    infraRouteSet: (name, serviceId) => requestPost('/infra/route', { name, serviceId: serviceId ?? '' }),
    docPageSync: () => requestPost('/registry/docpage/sync', {}),
    apiCall: (target, api, params, dashboardServiceId) => requestPost('/api/call', { target, api, params: params ?? {}, dashboardServiceId }),
    instanceResolve: (target, dashboardServiceId) => {
      const queryText = Object.entries({ ...target, dashboardServiceId })
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}=${query(value)}`)
        .join('&');
      return requestSend(`/instance/resolve?${queryText}`);
    },
    jobGet: (serviceId, jobId) => requestSend(`/job/get?serviceId=${query(serviceId)}&jobId=${query(jobId)}`),
    templateIconUrlGet: (templateId) => `${endpointNormalized}/template/icon/${query(templateId)}`,
    instanceIconUrlGet: (serviceId) => `${endpointNormalized}/instance/icon/${query(serviceId)}`,
    dashboardEntryUrlGet: (serviceId, entry) => `${endpointNormalized}/instance/dashboard/${query(serviceId)}/${entry}`,
  };
}
