// How a dashboard talks to services: every request is an event of the
// page (onEvent), answered with { code, data, message }. A call goes to the
// instance the dashboard is bound to, or to the one a target names:
// { serviceId }, or { templateId, versionId? } for another instance created
// from that template (doc_page_impl_service.md#calls-between-services).

export function serviceApiCall(onEvent, api, params = {}, target = undefined) {
  return onEvent('serviceApiCallRequest', { api, params, target });
}

// the instance a call of target would go to, as listed: { serviceId, name, status, template, … }
export function serviceResolve(onEvent, target) {
  return onEvent('serviceResolveRequest', { target });
}

// an async api answers with a job at once; this asks for the job until it
// is done and answers with the api's own result. onProgress(job) sees
// every state the job is asked in.
export async function serviceJobRun(onEvent, api, params = {}, onProgress = () => {}, target = undefined) {
  const resultStart = await serviceApiCall(onEvent, api, params, target);
  if (resultStart.code !== 0) return resultStart;
  let job = resultStart.data;
  while (job.status !== 'done') {
    onProgress(job);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // the job names its instance, which may not be the dashboard's own
    const resultJob = await onEvent('serviceJobGetRequest', { jobId: job.jobId, serviceId: job.serviceId });
    if (resultJob.code !== 0) return resultJob;
    job = resultJob.data;
  }
  onProgress(job);
  return job.result;
}

// the dashboard's own state, kept by the page (in the dashboard's asset
// object in a document). the whole state is replaced.
export function dashboardStateSet(onEvent, state) {
  return onEvent('dashboardStateSetRequest', { state });
}
