// How a dashboard talks to services: every request is an event of the
// page (onEvent), answered with { code, data, message }. A call goes to the
// instance the dashboard is bound to, or to the one a target names:
// { serviceId }, { templateId, versionId? }, or { infra: name } for the
// infra service of that name (doc_page_impl_service.md#calls-between-services).
// -7 says an infra service the call depends on is unavailable: the todos of
// todo-list live in the sqlite infra service, so every api may answer it.

export function serviceApiCall(onEvent, api, params = {}, target = undefined) {
  return onEvent('serviceApiCallRequest', { api, params, target });
}

// the instance a call of target would go to, as listed
export function serviceResolve(onEvent, target) {
  return onEvent('serviceResolveRequest', { target });
}

// the backend asked again: the instance of the dashboard as listed anew
// (its status, dependency status and health come with config.service.instance)
export function serviceRefresh(onEvent) {
  return onEvent('serviceRefreshRequest', {});
}

// the dashboard's own state, kept by the page (in the dashboard's asset
// object in a document). the whole state is replaced.
export function dashboardStateSet(onEvent, state) {
  return onEvent('dashboardStateSetRequest', { state });
}
