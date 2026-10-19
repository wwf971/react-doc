import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, Plus } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { serviceDashboardCompIdBuild, SERVICE_DASHBOARD_PLACEMENT_SETTINGS } from '../service/service-dashboard-define.js';
import { dashboardDataTextBuild, DASHBOARD_DATA_LANG } from '../service/service-dashboard-data.js';
import {
  ServiceProblemNotice,
  ServiceRefreshButton,
  ServiceStatusDot,
  ServiceTypeIcon,
} from '../service/ServiceParts.jsx';
import '../edit/DocEdit.css';
import '../service/DocService.css';
import './DocSettings.css';

// The "Services" tab of the settings panel (design:
// doc_page_impl_service_instance.md#the-services-tab):
//
//   service backend ● up · 1 type · 2 instances ↻
//   System services    none yet
//   Custom services    [card] [card] [+ New]
//   the instance chosen: what it is, the apis of its type, its config dashboard
//
// System services are the page's own features run as services; there are
// none yet, the section only holds their place. A custom service is an
// instance of the service backend, one near-square card each. The config
// dashboard of the chosen instance is rendered through the registry like a
// dashboard block (placement serviceSettings); a tab is no document, so its
// state is kept in memory (DocServiceStore.settings) and choosing another
// instance in its frame chooses another card. Rendered by ConfigPanel as a
// custom full-width item; it reads the stores itself.
export const ServiceSettings = observer(function ServiceSettings() {
  const { serviceStore } = useDocStores();
  const [isCreateOpen, isCreateOpenSet] = useState(false);
  const instanceSelected = serviceStore.instanceGet(serviceStore.settings.serviceIdSelected);

  return (
    <div className="doc-service-settings">
      <BackendLine />
      <div className="doc-service-settings-title">System services</div>
      <div className="doc-service-settings-muted">none yet: no feature of the page runs as a service.</div>
      <div className="doc-service-settings-title">Custom services</div>
      {serviceStore.backendStatus === 'up' ? (
        <div className="doc-service-card-list">
          {serviceStore.instanceList.map((instance) => (
            <InstanceCard
              key={instance.serviceId}
              instance={instance}
              isSelected={instance.serviceId === serviceStore.settings.serviceIdSelected}
              onSelect={() => {
                isCreateOpenSet(false);
                serviceStore.settingsServiceSelect(instance.serviceId === serviceStore.settings.serviceIdSelected ? '' : instance.serviceId);
              }}
            />
          ))}
          <button
            type="button"
            className="doc-service-card doc-service-card-new"
            aria-pressed={isCreateOpen}
            title="create an instance of a service type"
            onClick={() => {
              serviceStore.settingsServiceSelect('');
              isCreateOpenSet(!isCreateOpen);
            }}
          >
            <Plus size={18} aria-hidden="true" />
            <span className="doc-service-card-name">New</span>
          </button>
        </div>
      ) : (
        <div className="doc-service-settings-muted">{serviceStore.unavailableReason || 'asking the service backend…'}</div>
      )}
      {isCreateOpen && serviceStore.backendStatus === 'up' ? <InstanceCreate onDone={() => isCreateOpenSet(false)} /> : null}
      {instanceSelected ? <InstanceDetail key={instanceSelected.serviceId} instance={instanceSelected} /> : null}
    </div>
  );
});

const backendStatusTextByStatus = {
  none: 'no backend',
  loading: 'loading',
  up: 'up',
  down: 'backend down',
};

// the backend: up or down, what it holds, the problems of its scan
const BackendLine = observer(function BackendLine() {
  const { serviceStore } = useDocStores();
  const statusText = backendStatusTextByStatus[serviceStore.backendStatus];
  const scanProblemList = serviceStore.backendInfo?.scanProblemList ?? [];
  const typeCount = serviceStore.typeList.length;
  const instanceCount = serviceStore.instanceList.length;
  return (
    <>
      <div className="doc-service-settings-line">
        <span>service backend</span>
        <ServiceStatusDot status={serviceStore.backendStatus === 'up' ? 'ready' : statusText} />
        <span>{statusText}</span>
        {serviceStore.backendStatus === 'up'
          ? <span className="doc-service-settings-muted">· {typeCount} type{typeCount === 1 ? '' : 's'} · {instanceCount} instance{instanceCount === 1 ? '' : 's'}</span>
          : null}
        <ServiceRefreshButton />
      </div>
      {serviceStore.backendStatus === 'down' ? (
        <div className="doc-service-settings-muted">
          {serviceStore.backendMessage}. Start it with python3 main/service-backend/server.py --config &lt;backend config file&gt;; the page asks again every few seconds.
        </div>
      ) : null}
      {scanProblemList.map((problem) => <div key={problem} className="doc-service-error">{problem}</div>)}
      {serviceStore.typeList.filter((type) => type.status !== 'ready').map((type) => (
        <div key={type.typeId} className="doc-service-error">the service type {type.typeId} failed to load: {type.message}</div>
      ))}
    </>
  );
});

const InstanceCard = observer(function InstanceCard({ instance, isSelected, onSelect }) {
  const { serviceStore } = useDocStores();
  const type = serviceStore.typeGet(instance.typeId);
  return (
    <button
      type="button"
      className="doc-service-card"
      aria-pressed={isSelected}
      title={instance.description || instance.name}
      onClick={onSelect}
    >
      <ServiceTypeIcon typeId={instance.typeId} size={26} />
      <span className="doc-service-card-name">{instance.name}</span>
      <span className="doc-service-card-type">
        <ServiceStatusDot status={instance.status} />
        {type?.expose?.meta?.label ?? instance.typeId}
      </span>
    </button>
  );
});

// the instance chosen: what the backend says of it, what its type exposes,
// and its config dashboard
const InstanceDetail = observer(function InstanceDetail({ instance }) {
  const { serviceStore } = useDocStores();
  const type = serviceStore.typeGet(instance.typeId);
  const meta = type?.expose?.meta;
  const dashboardIdConfig = serviceStore.dashboardIdOfPurposeGet(instance.typeId, 'config');

  // the frame of the config dashboard reports here, not to the service
  // route: the tab is no document, so the bind chooses a card and the
  // state stays in memory
  const eventLocalHandle = (eventType, eventData) => {
    if (eventType === 'serviceBindRequest') {
      serviceStore.settingsServiceSelect(String(eventData.serviceId ?? ''));
      return { code: 0 };
    }
    if (eventType === 'dashboardStateSetRequest') {
      serviceStore.settingsStateSet(instance.serviceId, eventData.state ?? {});
      return { code: 0 };
    }
    return undefined;
  };

  return (
    <div className="doc-service-detail">
      <div className="doc-service-detail-grid">
        <span className="doc-service-detail-key">instance</span>
        <span>{instance.name} <span className="doc-service-detail-code">{instance.serviceId}</span></span>
        <span className="doc-service-detail-key">type</span>
        <span>
          {meta ? `${meta.label} ${meta.version}` : instance.typeId}
          {meta?.author ? <span className="doc-service-settings-muted"> · {meta.author}</span> : null}
          {meta?.description ? <span className="doc-service-settings-muted"> · {meta.description}</span> : null}
        </span>
        <span className="doc-service-detail-key">status</span>
        <span>{instance.status}{instance.message ? `: ${instance.message}` : ''}</span>
        <span className="doc-service-detail-key">folder</span>
        <span className="doc-service-detail-code">{instance.folder}/{instance.dirName}</span>
        {instance.description ? (
          <>
            <span className="doc-service-detail-key">description</span>
            <span>{instance.description}</span>
          </>
        ) : null}
        {type?.expose?.apiList?.length ? (
          <>
            <span className="doc-service-detail-key">apis</span>
            <span className="doc-service-detail-code">
              {type.expose.apiList.map((api) => (
                <span key={api.name} title={api.description}>
                  {api.name}({api.paramList.map((param) => `${param.name}${param.isRequired ? '' : '?'}: ${param.schema.type}`).join(', ')})
                  {api.execution === 'async' ? ' async' : ''}{api.kind === 'command' ? ' ✎' : ''}{'  '}
                </span>
              ))}
            </span>
          </>
        ) : null}
      </div>
      {dashboardIdConfig ? (
        <RegisteredComp
          compId={serviceDashboardCompIdBuild(instance.typeId, dashboardIdConfig)}
          placement={SERVICE_DASHBOARD_PLACEMENT_SETTINGS}
          configRuntime={{ instanceId: `serviceSettings:${instance.serviceId}` }}
          input={{
            lang: DASHBOARD_DATA_LANG,
            raw: dashboardDataTextBuild({ serviceId: instance.serviceId, state: serviceStore.settings.stateByServiceId[instance.serviceId] ?? {} }),
          }}
          onEventRuntime={eventLocalHandle}
        />
      ) : (
        <ServiceProblemNotice problem={{ kind: 'typeNotFound', message: `The service type ${instance.typeId} is not known to the backend; it has no config dashboard to show.` }} />
      )}
    </div>
  );
});

// a new instance: its type and its name (the folder becomes
// {serviceId}--{name} in the backend's default instance folder); its config
// starts with the defaults the type declares
const InstanceCreate = observer(function InstanceCreate({ onDone }) {
  const { serviceStore } = useDocStores();
  const typeListReady = serviceStore.typeList.filter((type) => type.status === 'ready');
  const [typeId, typeIdSet] = useState(typeListReady[0]?.typeId ?? '');
  const nameRef = useRef(null);
  const descriptionRef = useRef(null);
  const isSubmitting = serviceStore.settings.create.status === 'submitting';

  const create = async () => {
    const name = String(nameRef.current?.textContent ?? '').trim();
    const description = String(descriptionRef.current?.textContent ?? '').trim();
    const result = await serviceStore.instanceCreate({ typeId, name, description });
    if (result.code === 0) onDone();
  };

  if (typeListReady.length === 0) {
    return <div className="doc-service-settings-muted">The backend has no service type that loaded; an instance needs one.</div>;
  }
  return (
    <div className="doc-service-detail">
      <div className="doc-service-settings-line">
        <span className="doc-service-detail-key">type</span>
        <span className="doc-service-instance-select">
          <select className="doc-service-select" value={typeId} disabled={isSubmitting} aria-label="service type" onChange={(event) => typeIdSet(event.target.value)}>
            {typeListReady.map((type) => (
              <option key={type.typeId} value={type.typeId}>{type.expose.meta.label} ({type.typeId})</option>
            ))}
          </select>
        </span>
      </div>
      <div className="doc-service-settings-line">
        <span className="doc-service-detail-key">name</span>
        <EditValueInline
          ref={nameRef}
          value=""
          placeholder="the instance's name"
          isLocked={isSubmitting}
          className="doc-service-create-name"
          aria-label="name of the new instance"
          onCommit={() => {}}
        />
      </div>
      <div className="doc-service-settings-line">
        <span className="doc-service-detail-key">description</span>
        <EditValueInline
          ref={descriptionRef}
          value=""
          placeholder="optional"
          isLocked={isSubmitting}
          className="doc-service-create-name"
          aria-label="description of the new instance"
          onCommit={() => {}}
        />
      </div>
      <div className="doc-service-settings-line">
        <button type="button" className="doc-service-button" disabled={isSubmitting || typeId === ''} onClick={() => void create()}>
          {isSubmitting ? <LoaderCircle size={11} aria-hidden="true" className="doc-service-spin" /> : <Plus size={11} aria-hidden="true" />}
          <span>Create</span>
        </button>
        <button type="button" className="doc-service-button" disabled={isSubmitting} onClick={onDone}>Cancel</button>
        {serviceStore.settings.create.status === 'error'
          ? <span className="doc-service-error" role="alert">{serviceStore.settings.create.message}</span>
          : null}
      </div>
    </div>
  );
});
