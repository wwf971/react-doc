import { LayoutDashboard } from '../../frontend/UICommon.js';
import { compDefine } from '../registry/comp-registry.js';
import { ServiceDashboardHost } from './ServiceDashboardHost.jsx';
import { DASHBOARD_DATA_LANG, dashboardDataParse, dashboardDataTextBuild } from './service-dashboard-data.js';

// The dashboards of service instances as components of the registry (design:
// doc_page_impl_service.md#dashboards-in-the-registry). A
// dashboard's component id names it: service/{templateName}/{dashboardId},
// the template the instances it may show were created from and the
// dashboard of theirs, and the id is also its tag name in a document, so no
// compRegistry entry is needed:
//
//   <!--renderComp=service/note-db/default-->
//   ```asset
//   store: local
//   objectId: w4veeme6sff
//   ```
//
// The definition is built from the id alone, the same for every template:
// it exists while the backend is down or the template is unknown, so the
// block still renders its frame and says what is missing. What the instance
// declares (its label, its dashboards, its module) comes from the backend at
// render time, through DocServiceStore.
//
// A dashboard is asset-only and saves in place, the way ExcelUniver does: its
// data is the instance it shows and its own state ({ serviceId, state },
// service-dashboard-data.js), changed while it is read, never through an
// edit session; componentType "serviceDashboard" and meta.isServiceDashboard
// tell it from other components.

export const SERVICE_DASHBOARD_COMP_ID_PREFIX = 'service/';
export const SERVICE_DASHBOARD_COMPONENT_TYPE = 'serviceDashboard';
// where a dashboard renders: a block of a document, or the Services tab of
// the settings panel (the config dashboard of the instance chosen there)
export const SERVICE_DASHBOARD_PLACEMENT_SETTINGS = 'serviceSettings';

const REGEX_DASHBOARD_COMP_ID = /^service\/([a-z0-9][a-z0-9_-]*)\/([a-z][a-zA-Z0-9-]*)$/;

const definitionByCompId = new Map();

export function serviceDashboardCompIdBuild(templateName, dashboardId) {
  return `${SERVICE_DASHBOARD_COMP_ID_PREFIX}${templateName}/${dashboardId}`;
}

// { templateName, dashboardId } of a dashboard's component id, or undefined
export function serviceDashboardCompIdParse(compId) {
  const match = REGEX_DASHBOARD_COMP_ID.exec(String(compId ?? ''));
  if (!match) return undefined;
  return { templateName: match[1], dashboardId: match[2] };
}

// the registry definition of a dashboard's component id; undefined for any
// other id. one definition per id, so a block keeps its definition across renders
export function serviceDashboardDefinitionGet(compId) {
  const parsed = serviceDashboardCompIdParse(compId);
  if (!parsed) return undefined;
  if (!definitionByCompId.has(compId)) {
    definitionByCompId.set(compId, serviceDashboardDefine(parsed.templateName, parsed.dashboardId));
  }
  return definitionByCompId.get(compId);
}

function serviceDashboardDefine(templateName, dashboardId) {
  return compDefine(ServiceDashboardHost, {
    componentType: SERVICE_DASHBOARD_COMPONENT_TYPE,
    placementList: ['commentBlock', SERVICE_DASHBOARD_PLACEMENT_SETTINGS],
    isAssetAware: true,
    dataBuild: (input) => {
      const parsed = dashboardDataParse(input.data.raw);
      return {
        data: {
          serviceId: parsed.serviceId,
          state: parsed.state,
          dataMessage: parsed.message,
        },
        config: { serviceTemplateName: templateName, serviceDashboardId: dashboardId },
      };
    },
    expose: {
      meta: {
        label: `${templateName} · ${dashboardId}`,
        description: `the dashboard ${dashboardId} of the instances of the service template ${templateName}`,
        isServiceDashboard: true,
        serviceTemplateName: templateName,
        serviceDashboardId: dashboardId,
        isAssetOnly: true,
        assetSaveMode: 'inPlace',
        // the dashboard changes its own data while it is read; there is
        // nothing to edit in an edit session, and a click works the dashboard
        isEditSourceAccepted: false,
        isEditEnterButtonOnly: true,
      },
      icon: LayoutDashboard,
      sourceDefaultCreate: () => ({
        lang: DASHBOARD_DATA_LANG,
        raw: dashboardDataTextBuild({ serviceId: '', state: {} }),
      }),
    },
  });
}
