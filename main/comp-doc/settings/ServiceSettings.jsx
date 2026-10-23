import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Copy, LoaderCircle, Plus } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { serviceDashboardCompIdBuild, SERVICE_DASHBOARD_PLACEMENT_SETTINGS } from '../service/service-dashboard-define.js';
import { dashboardDataTextBuild, DASHBOARD_DATA_LANG } from '../service/service-dashboard-data.js';
import {
  ServiceIcon,
  ServiceProblemNotice,
  ServiceRefreshButton,
  ServiceStatusDot,
} from '../service/ServiceParts.jsx';
import '../edit/DocEdit.css';
import '../service/DocService.css';
import './DocSettings.css';

// The "Services" tab of the settings panel (design:
// doc_page_impl_service.md#the-services-tab):
//
//   service backend ● up · 1 template · 2 instances ↻
//   Service templates     [card] …
//     the template chosen: its version and versions, its script, its initial
//     config, the instances created from it, New instance
//   Service instances
//     System              none yet
//     Custom              [card] [card] [+ New]
//     the instance chosen: the template it was created from, its own
//     script's apis, its config dashboard
//
// Templates and instances are two areas, each with its cards and the detail
// of the card chosen there: a template is the initial state of a service and
// is never run; an instance is always created from one (New instance of a
// template, or + New with a template to choose) and owns a copy of it.
// System services are the page's own features run as services; there are
// none yet, the section only holds their place. The config dashboard of the
// chosen instance is rendered through the registry like a dashboard block
// (placement serviceSettings); a tab is no document, so its state is kept
// in memory (DocServiceStore.settings) and choosing another instance in its
// frame chooses another card. Rendered by ConfigPanel as a custom
// full-width item; it reads the stores itself.
export const ServiceSettings = observer(function ServiceSettings() {
  const { serviceStore } = useDocStores();
  const isUp = serviceStore.backendStatus === 'up';
  return (
    <div className="doc-service-settings">
      <BackendLine />
      {isUp ? (
        <>
          <TemplateArea />
          <InstanceArea />
        </>
      ) : (
        <div className="doc-service-settings-muted">{serviceStore.unavailableReason || 'asking the service backend…'}</div>
      )}
    </div>
  );
});

const backendStatusTextByStatus = {
  none: 'no backend',
  loading: 'loading',
  up: 'up',
  down: 'backend down',
};

const countText = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// the backend: up or down, what it holds, the problems of its scan
const BackendLine = observer(function BackendLine() {
  const { serviceStore } = useDocStores();
  const statusText = backendStatusTextByStatus[serviceStore.backendStatus];
  const scanProblemList = serviceStore.backendInfo?.scanProblemList ?? [];
  return (
    <>
      <div className="doc-service-settings-line">
        <span>service backend</span>
        <ServiceStatusDot status={serviceStore.backendStatus === 'up' ? 'ready' : statusText} />
        <span>{statusText}</span>
        {serviceStore.backendStatus === 'up' ? (
          <span className="doc-service-settings-muted">
            · {countText(serviceStore.templateList.length, 'template')} · {countText(serviceStore.instanceList.length, 'instance')}
          </span>
        ) : null}
        <ServiceRefreshButton />
      </div>
      {serviceStore.backendStatus === 'down' ? (
        <div className="doc-service-settings-muted">
          {serviceStore.backendMessage}. Start it with python3 main/service-backend/server.py --config &lt;backend config file&gt;; the page asks again every few seconds.
        </div>
      ) : null}
      {scanProblemList.map((problem) => <div key={problem} className="doc-service-error">{problem}</div>)}
    </>
  );
});

// ---------- templates ----------

const TemplateArea = observer(function TemplateArea() {
  const { serviceStore } = useDocStores();
  const templateSelected = serviceStore.templateGet(serviceStore.settings.templateIdSelected);
  return (
    <div className="doc-service-area">
      <div className="doc-service-settings-title">Service templates</div>
      <div className="doc-service-settings-muted">the initial state of a service: never run; an instance is created from one and owns a copy of it.</div>
      {serviceStore.templateList.length === 0 ? (
        <div className="doc-service-settings-muted">none: the backend's template folders hold no template.</div>
      ) : (
        <div className="doc-service-card-list">
          {serviceStore.templateList.map((template) => (
            <TemplateCard
              key={template.templateId}
              template={template}
              isSelected={template.templateId === serviceStore.settings.templateIdSelected}
              onSelect={() => serviceStore.settingsTemplateSelect(template.templateId === serviceStore.settings.templateIdSelected ? '' : template.templateId)}
            />
          ))}
        </div>
      )}
      {templateSelected ? <TemplateDetail key={templateSelected.templateId} template={templateSelected} /> : null}
    </div>
  );
});

const TemplateCard = observer(function TemplateCard({ template, isSelected, onSelect }) {
  const { serviceStore } = useDocStores();
  const instanceCount = serviceStore.instanceListOfTemplate(template.templateId).length;
  return (
    <button
      type="button"
      className="doc-service-card"
      aria-pressed={isSelected}
      title={template.message || template.description || template.name}
      onClick={onSelect}
    >
      <ServiceIcon iconUrl={serviceStore.templateIconUrlGet(template.templateId)} size={26} />
      <span className="doc-service-card-name">{template.name}</span>
      <span className="doc-service-card-type">
        <ServiceStatusDot status={template.status} />
        {template.status === 'ready' ? countText(instanceCount, 'instance') : 'error'}
      </span>
    </button>
  );
});

// the template chosen: what it is, its versions, its script, the instances
// created from it, and the creation of a new one
const TemplateDetail = observer(function TemplateDetail({ template }) {
  const { serviceStore } = useDocStores();
  const [isCreateOpen, isCreateOpenSet] = useState(false);
  const meta = template.expose?.meta;
  const instanceList = serviceStore.instanceListOfTemplate(template.templateId);
  return (
    <div className="doc-service-detail">
      <div className="doc-service-detail-grid">
        <span className="doc-service-detail-key">template</span>
        <span>{template.name} <span className="doc-service-detail-code">{template.templateId}</span></span>
        <span className="doc-service-detail-key">version</span>
        <TemplateVersionRow template={template} />
        <span className="doc-service-detail-key">versions</span>
        <span className="doc-service-detail-code">
          {template.versionList.length === 0 ? 'only the current one' : template.versionList.map((version) => (
            <span key={version.versionId} className="doc-service-detail-line">
              {version.versionId} {version.time}{version.note ? ` · ${version.note}` : ''}{version.versionId === template.versionId ? ' (current)' : ''}
            </span>
          ))}
        </span>
        <span className="doc-service-detail-key">status</span>
        <span>{template.status}{template.message ? `: ${template.message}` : ''}</span>
        <span className="doc-service-detail-key">folder</span>
        <span className="doc-service-detail-code">{template.folder}/{template.dirName}</span>
        {template.description ? (
          <>
            <span className="doc-service-detail-key">description</span>
            <span>{template.description}</span>
          </>
        ) : null}
        <ScriptMetaRow meta={meta} />
        <span className="doc-service-detail-key">initial config</span>
        <span className="doc-service-detail-code">{configText(template.config)}</span>
        <ApiListRow expose={template.expose} />
        <span className="doc-service-detail-key">instances</span>
        <span>
          {instanceList.length === 0 ? <span className="doc-service-settings-muted">none yet</span> : instanceList.map((instance) => (
            <button
              key={instance.serviceId}
              type="button"
              className="doc-service-link"
              title="show the instance"
              onClick={() => serviceStore.settingsServiceSelect(instance.serviceId)}
            >
              {instance.name}
              <span className="doc-service-settings-muted">
                {instance.template.versionId === template.versionId ? '' : ` (version ${instance.template.versionId})`}
              </span>
            </button>
          ))}
        </span>
      </div>
      {isCreateOpen ? (
        <InstanceCreate templateIdInitial={template.templateId} isTemplateFixed onDone={() => isCreateOpenSet(false)} />
      ) : (
        <div className="doc-service-settings-line">
          <button
            type="button"
            className="doc-button doc-service-button"
            disabled={template.status !== 'ready'}
            title={template.status === 'ready' ? 'create an instance: a copy of this template, with its own folder' : `the template cannot be used: ${template.message}`}
            onClick={() => isCreateOpenSet(true)}
          >
            <Copy size={11} aria-hidden="true" />
            <span>New instance from {template.name}</span>
          </button>
        </div>
      )}
    </div>
  );
});

// the current version id of a template, and a new one: a note, then the
// backend records the new id. instances created before keep theirs
const TemplateVersionRow = observer(function TemplateVersionRow({ template }) {
  const { serviceStore } = useDocStores();
  const [isOpen, isOpenSet] = useState(false);
  const noteRef = useRef(null);
  const versionNew = serviceStore.settings.versionNew;
  const isSubmitting = versionNew.status === 'submitting';

  const create = async () => {
    const note = String(noteRef.current?.textContent ?? '').trim();
    const result = await serviceStore.templateVersionNew(template.templateId, note);
    if (result.code === 0) isOpenSet(false);
  };

  return (
    <span className="doc-service-settings-line">
      <span className="doc-service-detail-code">{template.versionId}</span>
      {!isOpen ? (
        <button
          type="button"
          className="doc-service-icon-button"
          title="record a new version id of the template (after its files changed); instances created before keep theirs"
          onClick={() => isOpenSet(true)}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      ) : (
        <>
          <EditValueInline
            ref={noteRef}
            value=""
            placeholder="what changed"
            isLocked={isSubmitting}
            className="doc-service-create-name"
            aria-label="note of the new version"
            onCommit={() => {}}
          />
          <button type="button" className="doc-button doc-service-button" disabled={isSubmitting} onClick={() => void create()}>
            {isSubmitting ? <LoaderCircle size={11} aria-hidden="true" className="doc-spin" /> : null}
            <span>New version</span>
          </button>
          <button type="button" className="doc-button doc-service-button" disabled={isSubmitting} onClick={() => isOpenSet(false)}>Cancel</button>
        </>
      )}
      {versionNew.status === 'error' ? <span className="doc-service-error" role="alert">{versionNew.message}</span> : null}
    </span>
  );
});

// ---------- instances ----------

const InstanceArea = observer(function InstanceArea() {
  const { serviceStore } = useDocStores();
  const [isCreateOpen, isCreateOpenSet] = useState(false);
  const instanceSelected = serviceStore.instanceGet(serviceStore.settings.serviceIdSelected);
  return (
    <div className="doc-service-area">
      <div className="doc-service-settings-title">Service instances</div>
      <div className="doc-service-settings-muted">running services, each created from a template: its own folder, its own copy of the script, its own data.</div>
      <div className="doc-service-settings-subtitle">System</div>
      <div className="doc-service-settings-muted">none yet: no feature of the page runs as a service.</div>
      <div className="doc-service-settings-subtitle">Custom</div>
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
          title="create an instance from a template"
          onClick={() => {
            serviceStore.settingsServiceSelect('');
            isCreateOpenSet(!isCreateOpen);
          }}
        >
          <Plus size={18} aria-hidden="true" />
          <span className="doc-service-card-name">New</span>
        </button>
      </div>
      {isCreateOpen ? (
        <InstanceCreate templateIdInitial={serviceStore.settings.templateIdSelected} isTemplateFixed={false} onDone={() => isCreateOpenSet(false)} />
      ) : null}
      {instanceSelected ? <InstanceDetail key={instanceSelected.serviceId} instance={instanceSelected} /> : null}
    </div>
  );
});

const InstanceCard = observer(function InstanceCard({ instance, isSelected, onSelect }) {
  const { serviceStore } = useDocStores();
  return (
    <button
      type="button"
      className="doc-service-card"
      aria-pressed={isSelected}
      title={instance.description || instance.name}
      onClick={onSelect}
    >
      <ServiceIcon iconUrl={serviceStore.instanceIconUrlGet(instance.serviceId)} size={26} />
      <span className="doc-service-card-name">{instance.name}</span>
      <span className="doc-service-card-type">
        <ServiceStatusDot status={instance.status} />
        {instance.template?.name ?? '?'}
      </span>
    </button>
  );
});

// how the template an instance recorded stands now: the same version, a
// newer one, or gone. the instance does not depend on it either way
function templateOriginText(serviceStore, instance) {
  const template = serviceStore.templateGet(instance.template?.templateId);
  if (!template) return 'the template is no longer in the template folders';
  if (template.name !== instance.template.name) return `the template is named ${template.name} now`;
  if (template.versionId !== instance.template.versionId) return `the template is at version ${template.versionId} now`;
  return 'the current version of the template';
}

// the instance chosen: what the backend says of it, the template it was
// created from, what its own script exposes, and its config dashboard
const InstanceDetail = observer(function InstanceDetail({ instance }) {
  const { serviceStore } = useDocStores();
  const dashboardIdConfig = serviceStore.dashboardIdOfPurposeGet(instance.expose, 'config');
  const templateRecord = instance.template;
  const templateCurrent = serviceStore.templateGet(templateRecord?.templateId);

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
        <span className="doc-service-detail-key">created from</span>
        <span>
          {templateCurrent ? (
            <button type="button" className="doc-service-link" title="show the template" onClick={() => serviceStore.settingsTemplateSelect(templateCurrent.templateId)}>
              {templateRecord.name}
            </button>
          ) : templateRecord?.name}
          <span className="doc-service-detail-code"> template {templateRecord?.templateId}, version {templateRecord?.versionId}</span>
          <span className="doc-service-settings-muted"> · {templateOriginText(serviceStore, instance)}</span>
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
        <ScriptMetaRow meta={instance.expose?.meta} />
        <ApiListRow expose={instance.expose} />
      </div>
      {dashboardIdConfig && templateRecord ? (
        <RegisteredComp
          compId={serviceDashboardCompIdBuild(templateRecord.name, dashboardIdConfig)}
          placement={SERVICE_DASHBOARD_PLACEMENT_SETTINGS}
          configRuntime={{ instanceId: `serviceSettings:${instance.serviceId}` }}
          input={{
            lang: DASHBOARD_DATA_LANG,
            raw: dashboardDataTextBuild({ serviceId: instance.serviceId, state: serviceStore.settings.stateByServiceId[instance.serviceId] ?? {} }),
          }}
          onEventRuntime={eventLocalHandle}
        />
      ) : (
        <ServiceProblemNotice problem={{ kind: 'serviceNotReady', message: `${instance.name || instance.serviceId} has no config dashboard to show: ${instance.message || 'its script did not load'}` }} />
      )}
    </div>
  );
});

// a new instance from a template: the template (fixed when asked from the
// template itself), a name and a description. the backend copies the
// template folder into {templateName}-inst-{serviceId} of its default
// instance folder; the config starts with the template's
const InstanceCreate = observer(function InstanceCreate({ templateIdInitial, isTemplateFixed, onDone }) {
  const { serviceStore } = useDocStores();
  const templateListReady = serviceStore.templateList.filter((template) => template.status === 'ready');
  const templateIdDefault = templateListReady.some((template) => template.templateId === templateIdInitial)
    ? templateIdInitial
    : (templateListReady[0]?.templateId ?? '');
  const [templateId, templateIdSet] = useState(templateIdDefault);
  const nameRef = useRef(null);
  const descriptionRef = useRef(null);
  const isSubmitting = serviceStore.settings.create.status === 'submitting';
  const template = serviceStore.templateGet(templateId);

  const create = async () => {
    const name = String(nameRef.current?.textContent ?? '').trim();
    const description = String(descriptionRef.current?.textContent ?? '').trim();
    const result = await serviceStore.instanceCreate({ templateId, name, description });
    if (result.code === 0) onDone();
  };

  if (templateListReady.length === 0) {
    return <div className="doc-service-settings-muted">The backend has no service template that can be used; an instance is always created from one.</div>;
  }
  return (
    <div className="doc-service-detail">
      <div className="doc-service-settings-line">
        <span className="doc-service-detail-key">template</span>
        {isTemplateFixed ? (
          <span>{template?.name}</span>
        ) : (
          <span className="doc-service-instance-select">
            <select className="doc-service-select" value={templateId} disabled={isSubmitting} aria-label="service template" onChange={(event) => templateIdSet(event.target.value)}>
              {templateListReady.map((item) => (
                <option key={item.templateId} value={item.templateId}>{item.name} ({item.expose.meta.label})</option>
              ))}
            </select>
          </span>
        )}
        <span className="doc-service-detail-code">version {template?.versionId}</span>
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
      <div className="doc-service-settings-muted">
        the template's folder is copied into {template?.name}-inst-&#123;serviceId&#125; (its script, its dashboards, its config), and the instance records the template it came from.
      </div>
      <div className="doc-service-settings-line">
        <button type="button" className="doc-button doc-service-button" disabled={isSubmitting || templateId === ''} onClick={() => void create()}>
          {isSubmitting ? <LoaderCircle size={11} aria-hidden="true" className="doc-spin" /> : <Plus size={11} aria-hidden="true" />}
          <span>Create</span>
        </button>
        <button type="button" className="doc-button doc-service-button" disabled={isSubmitting} onClick={onDone}>Cancel</button>
        {serviceStore.settings.create.status === 'error'
          ? <span className="doc-service-error" role="alert">{serviceStore.settings.create.message}</span>
          : null}
      </div>
    </div>
  );
});

// ---------- rows both details show ----------

const configText = (config) => Object.entries(config ?? {}).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ') || 'none';

function ScriptMetaRow({ meta }) {
  if (!meta) return null;
  return (
    <>
      <span className="doc-service-detail-key">script</span>
      <span>
        {meta.label} {meta.version}
        {meta.author ? <span className="doc-service-settings-muted"> · {meta.author}</span> : null}
        {meta.description ? <span className="doc-service-settings-muted"> · {meta.description}</span> : null}
      </span>
    </>
  );
}

function ApiListRow({ expose }) {
  if (!expose?.apiList?.length) return null;
  return (
    <>
      <span className="doc-service-detail-key">apis</span>
      <span className="doc-service-detail-code">
        {expose.apiList.map((api) => (
          <span key={api.name} title={api.description}>
            {api.name}({api.paramList.map((param) => `${param.name}${param.isRequired ? '' : '?'}: ${param.schema.type}`).join(', ')})
            {api.execution === 'async' ? ' async' : ''}{api.kind === 'command' ? ' ✎' : ''}{'  '}
          </span>
        ))}
      </span>
    </>
  );
}
