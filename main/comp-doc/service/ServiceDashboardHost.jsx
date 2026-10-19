import { Component, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import {
  ServiceInstanceSelect,
  ServiceProblemNotice,
  ServiceRefreshButton,
  ServiceStatusDot,
  ServiceTypeIcon,
  serviceStatusTextGet,
} from './ServiceParts.jsx';
import './DocService.css';

// The frame of every service dashboard (design:
// doc_page_impl_service_instance.md#the-dashboard-frame): the registry
// renders it for a component id service/{typeId}/{dashboardId}
// (service-dashboard-define.js), and it renders the dashboard of the type's
// federated module inside. The frame, not the dashboard, owns what every
// dashboard needs the same way:
//
//   [icon] Note DB · Notes   [example notes ▾] ● ready ↻
//   ┌─────────────────────────────────────────────┐
//   │ the dashboard, or why it cannot show         │
//   └─────────────────────────────────────────────┘
//
//   - the choice of the instance, always shown (several instances of a type)
//   - the state of the backend and of the instance, and asking again
//   - what keeps the dashboard from showing (DocServiceStore.dashboardProblemGet):
//     no backend, backend down, type or dashboard unknown, no instance
//     chosen, instance gone, not ready, module not built or failing
//   - the room the dashboard needs (heightMin), so the page does not jump
//     while the module loads
//
// a dashboard that has shown stays while the backend goes down: its calls
// answer -5 and the head says "backend down", so the reader keeps what is
// on screen. a dashboard is mounted again when it is bound to another
// instance (key), so a dashboard reads its instance once.
//
//   data     { serviceId, state, dataMessage }   from the block's asset text
//   config   { serviceTypeId, serviceDashboardId, assetInfo, placement, ... }
export const ServiceDashboardHost = observer(function ServiceDashboardHost({ data = {}, config = {}, onEvent }) {
  const { serviceStore } = useDocStores();
  const typeId = config.serviceTypeId;
  const dashboardId = config.serviceDashboardId;
  const serviceId = data.serviceId ?? '';
  const state = data.state ?? {};
  const type = serviceStore.typeGet(typeId);
  const dashboardDefine = serviceStore.dashboardDefineGet(typeId, dashboardId);
  const instance = serviceStore.instanceGet(serviceId);
  const problem = serviceStore.dashboardProblemGet({ typeId, dashboardId, serviceId });
  // the Services tab keeps the state itself (its local handler answers);
  // in a document the state is the block's asset object
  const isPlacementSettings = config.placement === 'serviceSettings';
  const stateUnavailableReason = isPlacementSettings ? '' : serviceStore.stateUnavailableReasonGet(config.assetInfo);

  useEffect(() => {
    void serviceStore.moduleLoad(typeId);
  }, [serviceStore, typeId, type?.status, type?.dashboardBuild?.timeBuilt]);

  const Dashboard = serviceStore.dashboardComponentGet(typeId, dashboardId);
  // whether the dashboard of this instance has shown: then a backend going
  // down leaves it on screen
  const shownServiceIdRef = useRef('');
  const isShown = Boolean(Dashboard) && instance?.typeId === typeId && (
    problem === null || (problem.kind === 'backendDown' && shownServiceIdRef.current === serviceId)
  );
  useEffect(() => {
    if (problem === null) shownServiceIdRef.current = serviceId;
  });

  // every report of the dashboard carries what the block shows now; the
  // service route sends a call to this instance only
  const dashboardEventHandle = (eventType, eventData = {}) => onEvent?.(eventType, {
    ...eventData,
    dashboard: { typeId, dashboardId, serviceId, state },
  });

  const typeLabel = type?.expose?.meta?.label ?? typeId;
  const dashboardLabel = dashboardDefine?.label ?? dashboardId;
  const statusText = serviceStatusTextGet(serviceStore, instance);

  return (
    <div className="doc-service-dashboard not-prose" data-placement={config.placement}>
      <div className="doc-service-dashboard-head">
        <ServiceTypeIcon typeId={typeId} size={14} />
        <span className="doc-service-dashboard-title" title={`${typeId} / ${dashboardId}`}>
          {typeLabel} · {dashboardLabel}
        </span>
        <ServiceInstanceSelect
          typeId={typeId}
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
          <DashboardErrorBoundary key={`${serviceId}:${serviceStore.moduleStateGet(typeId)?.entryUrl ?? ''}`}>
            <Dashboard
              key={serviceId}
              data={{ state }}
              config={{
                placement: config.placement,
                service: {
                  typeId,
                  dashboardId,
                  serviceId,
                  instance,
                  type,
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
