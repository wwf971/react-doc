// The module the page loads (container serviceLocalBackup, module ./dashboard).
// Every export named by expose.dashboardList[].export of service.py is
// one dashboard component; the page renders it with { data, config, onEvent }
// (doc_page_impl_service_dashboard.md#dashboard-props).
import localBackupCssText from './LocalBackup.css?inline';

// the module adds its own stylesheet: the federation plugin links an emitted
// stylesheet by an url it joins wrong for pages served from a host without a
// dot in its name (localhost). every instance serves its own copy of the
// dashboards, so the stylesheet is one per folder the module is served
// from; a rebuild replaces its text
const styleKey = new URL('.', import.meta.url).href;
let styleElement = [...document.querySelectorAll('style[data-service-dashboard-style]')]
  .find((element) => element.dataset.serviceDashboardStyle === styleKey);
if (!styleElement) {
  styleElement = document.createElement('style');
  styleElement.dataset.serviceDashboardStyle = styleKey;
  document.head.appendChild(styleElement);
}
styleElement.textContent = localBackupCssText;

export { LocalBackupDashboard } from './LocalBackupDashboard.jsx';
export { LocalBackupConfigDashboard } from './LocalBackupConfigDashboard.jsx';
