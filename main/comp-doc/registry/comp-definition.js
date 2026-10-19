import { serviceDashboardDefinitionGet } from '../service/service-dashboard-define.js';

// The registry definition a component id names: the one compById holds,
// else the one the id names by itself. The dashboards of service types are
// not in compById: their id service/{typeId}/{dashboardId} builds their
// definition (doc_page_impl_service_instance.md#dashboards-in-the-registry),
// so a type the backend adds later needs no registration. The value is
// what compById would hold; compDefinitionNormalize reads it.
//
// a module of its own, so comp-registry.js does not import the service
// dashboards (which import comp-registry.js for compDefine)
export function compDefinitionGet(compById, compId) {
  const value = compById?.[compId];
  if (value !== undefined) return value;
  return serviceDashboardDefinitionGet(compId);
}
