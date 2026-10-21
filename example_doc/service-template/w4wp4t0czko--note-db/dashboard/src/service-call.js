// How a dashboard talks to its service: every request is an event of the
// page (onEvent), answered with { code, data, message }. The page sends a
// call to the instance the dashboard is bound to; a dashboard never names
// a service id itself (doc_page_impl_service_instance.md#calling-the-apis).

export function serviceApiCall(onEvent, api, params = {}) {
  return onEvent('serviceApiCallRequest', { api, params });
}

// an async api answers with a job at once; this asks for the job until it
// is done and answers with the api's own result. onProgress(job) sees
// every state the job is asked in.
export async function serviceJobRun(onEvent, api, params = {}, onProgress = () => {}) {
  const resultStart = await serviceApiCall(onEvent, api, params);
  if (resultStart.code !== 0) return resultStart;
  let job = resultStart.data;
  while (job.status !== 'done') {
    onProgress(job);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const resultJob = await onEvent('serviceJobGetRequest', { jobId: job.jobId });
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
