import { yamlParse, yamlStringify } from '../../frontend/src/lib/yaml.js';

// The data of a dashboard block (doc_page_impl_service_instance.md#dashboard-state):
// the text of its asset object, yaml.
//
//   serviceId: w4veemd7i36      the instance the dashboard shows; '' when not chosen yet
//   state:                      the dashboard's own state, whatever it keeps
//     query: ''
//
// the page writes the whole text on every change (in place: the object
// keeps one version), so a hand-written text is accepted as long as it is
// this mapping.

export const DASHBOARD_DATA_LANG = 'yaml';

// { serviceId, state, message }: message says what is wrong with the text
// ('' when nothing); a wrong text reads as no instance and an empty state
export function dashboardDataParse(raw) {
  const text = String(raw ?? '');
  if (text.trim() === '') return { serviceId: '', state: {}, message: '' };
  let value;
  try {
    value = yamlParse(text);
  } catch (error) {
    return { serviceId: '', state: {}, message: `the dashboard data is not yaml: ${String(error?.message ?? error)}` };
  }
  if (value === null || value === undefined) return { serviceId: '', state: {}, message: '' };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { serviceId: '', state: {}, message: 'the dashboard data must be a mapping { serviceId, state }' };
  }
  const serviceId = typeof value.serviceId === 'string' ? value.serviceId : '';
  const isStateMapping = value.state && typeof value.state === 'object' && !Array.isArray(value.state);
  return {
    serviceId,
    state: isStateMapping ? value.state : {},
    message: value.state !== undefined && value.state !== null && !isStateMapping ? 'state of the dashboard data must be a mapping' : '',
  };
}

export function dashboardDataTextBuild({ serviceId, state }) {
  return yamlStringify({ serviceId: serviceId ?? '', state: state ?? {} });
}
