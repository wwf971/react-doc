import { Component, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import {
  ServiceInstanceSelect,
  ServiceProblemNotice,
  ServiceRefreshButton,
  ServiceStatusDot,
  ServiceIcon,
  serviceStatusTextGet,
} from './ServiceParts.jsx';
import './DocService.css';

// The frame of every service dashboard (design:
// doc_page_impl_service.md#the-dashboard-frame): the registry
// renders it for a component id service/{templateName}/{dashboardId}
// (service-dashboard-define.js), and it renders the dashboard from the
// federated module of the instance it is bound to (every instance serves its
// own copy) inside. The frame, not the dashboard, owns what every dashboard
// needs the same way:
//
//   [icon] Note DB · Notes   [example notes ▾] ● ready ↻
//   ┌─────────────────────────────────────────────┐
//   │ the dashboard, or why it cannot show         │
//   └─────────────────────────────────────────────┘
//
//   - the choice of the instance, always shown (several instances of a template)
//   - the state of the backend and of the instance, and asking again
//   - what keeps the dashboard from showing (DocServiceStore.dashboardProblemGet):
//     no backend, backend down, template unknown, no instance chosen,
//     instance gone, of another template, not ready, dashboard unknown,
//     module not built or failing
//   - the room the dashboard needs (heightMin), so the page does not jump
//     while the module loads
//
// a dashboard that has shown stays while the backend goes down: its calls
// answer -5 and the head says "backend down", so the reader keeps what is
// on screen. a dashboard is mounted again when it is bound to another
// instance (key), so a dashboard reads its instance once.
//
//   data     { serviceId, state, dataMessage }   from the block's asset text
//   config   { serviceTemplateName, serviceDashboardId, assetInfo, placement, ... }
export const ServiceDashboardHost = observer(function ServiceDashboardHost({ data = {}, config = {}, onEvent }) {
  const { serviceStore } = useDocStores();
  const templateName = config.serviceTemplateName;
  const dashboardId = config.serviceDashboardId;
  const serviceId = data.serviceId ?? '';
  const state = data.state ?? {};
  const template = serviceStore.templateGetByName(templateName);
  const instance = serviceStore.instanceGet(serviceId);
  const dashboardDefine = serviceStore.dashboardDefineGet(serviceId, dashboardId);
  const problem = serviceStore.dashboardProblemGet({ templateName, dashboardId, serviceId });
  // the Services tab keeps the state itself (its local handler answers);
  // in a document the state is the block's asset object
  const isPlacementSettings = config.placement === 'serviceSettings';
  const stateUnavailableReason = isPlacementSettings ? '' : serviceStore.stateUnavailableReasonGet(config.assetInfo);

  useEffect(() => {
    void serviceStore.moduleLoad(serviceId);
  }, [serviceStore, serviceId, instance?.status, instance?.dashboardBuild?.timeBuilt]);

  const Dashboard = serviceStore.dashboardComponentGet(serviceId, dashboardId);
  // whether the dashboard of this instance has shown: then a backend going
  // down leaves it on screen
  const shownServiceIdRef = useRef('');
  const isShown = Boolean(Dashboard) && instance?.template?.name === templateName && (
    problem === null || (problem.kind === 'backendDown' && shownServiceIdRef.current === serviceId)
  );
  useEffect(() => {
    if (problem === null) shownServiceIdRef.current = serviceId;
  });

  // every report of the dashboard carries what the block shows now; the
  // service route sends a call to this instance only
  const dashboardEventHandle = (eventType, eventData = {}) => onEvent?.(eventType, {
    ...eventData,
    dashboard: { templateName, dashboardId, serviceId, state },
  });

  // the labels of the instance's own script, else of the template's, else the ids
  const exposeShown = instance?.expose ?? template?.expose;
  const label = exposeShown?.meta?.label ?? templateName;
  const dashboardLabel = (dashboardDefine ?? exposeShown?.dashboardList?.find((dashboard) => dashboard.id === dashboardId))?.label ?? dashboardId;
  const statusText = serviceStatusTextGet(serviceStore, instance);

  return (
    <div className="doc-service-dashboard not-prose" data-placement={config.placement}>
      <div className="doc-service-dashboard-head">
        <ServiceIcon iconUrl={serviceStore.dashboardIconUrlGet(templateName, serviceId)} size={14} />
        <span className="doc-service-dashboard-title" title={`template ${templateName} / dashboard ${dashboardId}`}>
          {label} · {dashboardLabel}
        </span>
        <ServiceInstanceSelect
          templateName={templateName}
          serviceId={serviceId}
          disabledReason={stateUnavailableReason}
          onSelect={(serviceIdNext) => dashboardEventHandle('serviceBindRequest', { serviceId: serviceIdNext })}
        />
        <span className="doc-service-status" title={instance?.message || serviceStore.backendMessage || undefined}>
          <ServiceStatusDot status={statusText} />
          <span>{statusText}</span>
          <ServiceRefreshButton />
        </span>
      </div>
      {data.dataMessage ? <div className="doc-service-error">{data.dataMessage}</div> : null}
      <div className="doc-service-dashboard-body" style={dashboardDefine?.heightMin ? { minHeight: dashboardDefine.heightMin } : undefined}>
        {isShown ? (
          <DashboardErrorBoundary key={`${serviceId}:${serviceStore.moduleStateGet(serviceId)?.entryUrl ?? ''}`}>
            <Dashboard
              key={serviceId}
              data={{ state }}
              config={{
                placement: config.placement,
                service: {
                  templateName,
                  dashboardId,
                  serviceId,
                  instance,
                  template,
                  backendStatus: serviceStore.backendStatus,
                },
                state: { isWritable: stateUnavailableReason === '', unavailableReason: stateUnavailableReason },
              }}
              onEvent={dashboardEventHandle}
            />
          </DashboardErrorBoundary>
        ) : <ServiceProblemNotice problem={problem ?? { kind: 'loading', message: 'loading the dashboard…' }} />}
      </div>
    </div>
  );
});

// a dashboard that throws while rendering is one block failing, not the page
class DashboardErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <ServiceProblemNotice problem={{ kind: 'moduleError', message: `the dashboard failed: ${String(this.state.error?.message ?? this.state.error)}` }} />;
    }
    return this.props.children;
  }
}
