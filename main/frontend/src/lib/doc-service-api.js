// The client of the service backend in the browser (design:
// doc_page_impl_service_instance.md#backend-api). The page reaches the
// backend through the development server, which forwards {endpoint}/* to
// it unchanged (plugin/doc-service-server.ts). Every call answers
// { code, data, message }:
//
//    0  success
//   -1  bad request, or the api failed (its message says why)
//   -3  the template, instance, api or job is not found
//   -4  the instance is not ready (disabled, its config or its script failed)
//   -5  the backend cannot be reached (answered by the plugin, or here when
//       the development server itself does not answer)
//   -6  a sync api did not finish in time; it is still queued or running
//
//   statusGet()                              { timeStarted, templateCount, instanceCount, scanProblemList, ... }
//   templateList()                           [{ templateId, name, description, versionId, versionList, config,
//                                               status, message, folder, dirName, expose, dashboardBuild }]
//   templateVersionNew(templateId, note)     the template with a new version id
//   instanceList()                           [{ serviceId, name, description, isEnabled, template, config,
//                                               status, message, folder, dirName, expose, dashboardBuild,
//                                               queueLength, apiRunning }]
//   instanceCreate({ templateId, name, description, config })   the instance created from the template
//   apiCall(serviceId, api, params)          a sync api: its result; an async api: its job
//   jobGet(serviceId, jobId)                 { jobId, api, status, progress, progressMessage, result, ... }
//   templateIconUrlGet(templateId)           the url of a template's icon
//   instanceIconUrlGet(serviceId)            the url of an instance's icon (its own copy)
//   dashboardEntryUrlGet(serviceId, entry)   the url of the remote entry of an instance's dashboards

export const SERVICE_CODE_NOT_FOUND = -3;
export const SERVICE_CODE_NOT_READY = -4;
export const SERVICE_CODE_BACKEND_DOWN = -5;

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
    templateList: () => requestSend('/template/list'),
    templateVersionNew: (templateId, note) => requestPost('/template/version/new', { templateId, note }),
    instanceList: () => requestSend('/instance/list'),
    instanceCreate: ({ templateId, name, description, config }) => requestPost('/instance/create', { templateId, name, description, config }),
    apiCall: (serviceId, api, params) => requestPost('/api/call', { serviceId, api, params: params ?? {} }),
    jobGet: (serviceId, jobId) => requestSend(`/job/get?serviceId=${query(serviceId)}&jobId=${query(jobId)}`),
    templateIconUrlGet: (templateId) => `${endpointNormalized}/template/icon/${query(templateId)}`,
    instanceIconUrlGet: (serviceId) => `${endpointNormalized}/instance/icon/${query(serviceId)}`,
    dashboardEntryUrlGet: (serviceId, entry) => `${endpointNormalized}/instance/dashboard/${query(serviceId)}/${entry}`,
  };
}
