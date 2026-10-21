import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LayoutDashboard, LoaderCircle, RotateCw, TriangleAlert } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocService.css';

// The pieces the dashboard frame (ServiceDashboardHost) and the Services
// tab of the settings panel (ServiceSettings) both draw.

// the icon of a template or of an instance: the file the meta.icon of its
// script names, served by the backend (DocServiceStore templateIconUrlGet,
// instanceIconUrlGet); the dashboard icon while there is none to give
export function ServiceIcon({ iconUrl, size = 16 }) {
  const [urlFailed, urlFailedSet] = useState('');
  if (!iconUrl || urlFailed === iconUrl) {
    return <LayoutDashboard className="doc-service-icon" size={size} aria-hidden="true" />;
  }
  return (
    <img
      className="doc-service-icon"
      src={iconUrl}
      width={size}
      height={size}
      alt=""
      onError={() => urlFailedSet(iconUrl)}
    />
  );
}

// the state of the backend, or of one instance, as a dot and a word
// ('ready', 'starting', 'disabled', 'error', 'down', 'no backend')
export function serviceStatusTextGet(serviceStore, instance) {
  if (serviceStore.backendStatus === 'none') return 'no backend';
  if (serviceStore.backendStatus === 'down') return 'backend down';
  if (serviceStore.backendStatus === 'loading') return 'loading';
  if (!instance) return 'not found';
  return instance.status;
}

export function ServiceStatusDot({ status }) {
  return <span className="doc-service-status-dot" data-status={status} aria-hidden="true" />;
}

// the backend asked again: its templates and instances
export const ServiceRefreshButton = observer(function ServiceRefreshButton() {
  const { serviceStore } = useDocStores();
  const isRefreshing = serviceStore.isRefreshing;
  const Icon = isRefreshing ? LoaderCircle : RotateCw;
  return (
    <button
      type="button"
      className="doc-service-icon-button"
      title="ask the service backend again"
      disabled={isRefreshing || serviceStore.backendStatus === 'none'}
      onClick={() => void serviceStore.refresh()}
    >
      <Icon size={12} aria-hidden="true" className={isRefreshing ? 'doc-service-spin' : undefined} />
    </button>
  );
});

// the choice of the instance a dashboard shows: every instance created from
// its template, and the instance it is bound to when the backend does not
// know it (so the choice says what the block holds). onSelect(serviceId)
// answers { code, message }; a failure is shown beside the choice.
export const ServiceInstanceSelect = observer(function ServiceInstanceSelect({ templateName, serviceId, disabledReason = '', onSelect }) {
  const { serviceStore } = useDocStores();
  const [status, statusSet] = useState({ isSubmitting: false, message: '' });
  const instanceList = serviceStore.instanceListOfTemplateName(templateName);
  const isKnown = serviceId === '' || instanceList.some((instance) => instance.serviceId === serviceId);
  const isDisabled = Boolean(disabledReason) || status.isSubmitting;

  const change = async (serviceIdNext) => {
    if (serviceIdNext === serviceId) return;
    statusSet({ isSubmitting: true, message: '' });
    const result = await onSelect(serviceIdNext);
    statusSet({ isSubmitting: false, message: result?.code === 0 ? '' : String(result?.message ?? 'not changed') });
  };

  return (
    <span className="doc-service-instance-select">
      <select
        className="doc-service-select"
        value={serviceId}
        disabled={isDisabled}
        title={disabledReason || 'the instance this dashboard shows'}
        aria-label="service instance"
        onChange={(event) => void change(event.target.value)}
      >
        <option value="">choose an instance…</option>
        {instanceList.map((instance) => (
          <option key={instance.serviceId} value={instance.serviceId}>
            {instance.name}{instance.status === 'ready' ? '' : ` (${instance.status})`}
          </option>
        ))}
        {!isKnown ? <option value={serviceId}>{serviceId} (not found)</option> : null}
      </select>
      {status.isSubmitting ? <LoaderCircle size={12} aria-hidden="true" className="doc-service-spin" /> : null}
      {status.message ? <span className="doc-service-error" role="alert">{status.message}</span> : null}
    </span>
  );
});

// why a dashboard does not show: what is missing, and what to do
export function ServiceProblemNotice({ problem }) {
  const isLoading = problem.kind === 'loading';
  const Icon = isLoading ? LoaderCircle : TriangleAlert;
  return (
    <div className="doc-service-problem" data-kind={problem.kind} role={isLoading ? 'status' : 'alert'}>
      <Icon size={13} aria-hidden="true" className={isLoading ? 'doc-service-spin' : undefined} />
      <span>{problem.message}</span>
    </div>
  );
}
