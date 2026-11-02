// How a dashboard talks to services: every request is an event of the
// page (onEvent), answered with { code, data, message }. A call goes to the
// instance the dashboard is bound to (this local-backup instance), or to
// the one a target names (doc_page_impl_service_kernel.md#calls-between-services).

export function serviceApiCall(onEvent, api, params = {}, target = undefined) {
  return onEvent('serviceApiCallRequest', { api, params, target });
}

// the backend asked again: the instance of the dashboard as listed anew
export function serviceRefresh(onEvent) {
  return onEvent('serviceRefreshRequest', {});
}
