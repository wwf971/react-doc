import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Copy, LoaderCircle, Plus, RotateCw, ScrollText, Server, Trash2, TriangleAlert, Waypoints, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { serviceLogLevelList } from '../../frontend/src/store/DocServiceStore.ts';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { serviceDashboardCompIdBuild, SERVICE_DASHBOARD_PLACEMENT_SETTINGS } from '../service/service-dashboard-define.js';
import { dashboardDataTextBuild, DASHBOARD_DATA_LANG } from '../service/service-dashboard-data.js';
import {
  ServiceHealthDot,
  ServiceIcon,
  ServiceProblemNotice,
  ServiceRefreshButton,
  ServiceStatusDot,
} from '../service/ServiceParts.jsx';
import '../edit/DocEdit.css';
import '../service/DocService.css';
import './DocSettings.css';

// The "Services" tab of the settings panel (design:
// doc_page_impl_service.md#the-services-tab): one view at a time, under a
// path (the PathBar the host injects as config.components.PathBar); its
// first segment goes back to the overview:
//
//   overview/                          [path ↻]
//     System            [server status] [infra routes] [logs]
//     App templates     [card] …        Infra templates   [card] …
//     App instances     [card] … [+ New] Infra instances  [card] …
//   overview/server-status/            the backend, its kernel, the doc pages mounted, the problems
//   overview/infra-routes/             the routing table of the kernel
//   overview/logs/                     filters · the records, newest first
//   overview/new-instance/             a new instance from a template chosen there
//   overview/service-template-{id}/    kind, origin, group, infra name and storage,
//                                      dependencies, execution, hooks, versions, script,
//                                      initial config, apis, its instances, New instance
//   overview/service-instance-{id}/    the template it was created from, origin, health,
//                                      execution, Dependencies (an editor), Hooks,
//                                      Lifecycle, its apis, its config dashboard
//
// A template is the initial state of a service and is never run; an
// instance is always created from one and owns a copy of it; both come in
// two kinds (app, serving documents and dashboards; infra, serving other
// services under an infra name). A card opens its view; a link to a
// template or an instance anywhere in a view opens that one. The config
// dashboard of an instance is rendered through the registry like a
// dashboard block (placement serviceSettings); a tab is no document, so the
// view and the state of its dashboards are kept in memory
// (DocServiceStore.settings), and choosing another instance in a
// dashboard's frame opens that instance. Rendered by ConfigPanel as a
// custom full-width item; it reads the stores itself.
export const ServiceSettings = observer(function ServiceSettings() {
  const { serviceStore } = useDocStores();
  if (serviceStore.backendStatus !== 'up') {
    return (
      <div className="doc-service-settings" data-centered="">
        <BackendNotice />
      </div>
    );
  }
  return (
    <div className="doc-service-settings">
      <ServicePathRow />
      <ServiceView />
    </div>
  );
});

// the path segment of each view; a template's and an instance's carry its id
function servicePathSegmentListGet(settings) {
  const segmentList = [{ name: 'overview' }];
  const nameByView = {
    server: 'server-status',
    infra: 'infra-routes',
    log: 'logs',
    instanceNew: 'new-instance',
    template: `service-template-${settings.templateIdSelected}`,
    instance: `service-instance-${settings.serviceIdSelected}`,
  };
  if (nameByView[settings.view]) segmentList.push({ name: nameByView[settings.view] });
  return segmentList;
}

// the path of the view shown, and the refresh of the registry. a segment
// clicked shows its view: the first, the overview
const ServicePathRow = observer(function ServicePathRow() {
  const { serviceStore, componentConfig } = useDocStores();
  const PathBar = componentConfig?.PathBar;
  const segmentList = servicePathSegmentListGet(serviceStore.settings);
  const segmentClick = (index) => {
    if (index === 0) serviceStore.settingsViewSet('overview');
  };
  return (
    <div className="doc-service-path-row">
      <div className="doc-service-path">
        {PathBar ? (
          <PathBar
            pathData={{ segments: segmentList }}
            onPathSegClicked={segmentClick}
            allowEditText={false}
            appendTrailingSlash={false}
            height={26}
          />
        ) : (
          // without an injected PathBar: the same segments as plain links
          <span className="doc-service-path-plain">
            {segmentList.map((segment, index) => (
              <span key={segment.name} className="doc-service-inline">
                {index > 0 ? <span className="doc-service-settings-muted">/</span> : null}
                <button type="button" className="doc-service-link" onClick={() => segmentClick(index)}>{segment.name}</button>
              </span>
            ))}
          </span>
        )}
      </div>
      <ServiceRefreshButton />
    </div>
  );
});

// the view of the path
const ServiceView = observer(function ServiceView() {
  const { serviceStore } = useDocStores();
  const { settings } = serviceStore;
  if (settings.view === 'server') return <ServerStatusView />;
  if (settings.view === 'infra') return <InfraArea />;
  if (settings.view === 'log') return <LogArea />;
  if (settings.view === 'instanceNew') {
    return (
      <div className="doc-service-area">
        <div className="doc-service-settings-title">New instance</div>
        <InstanceCreate
          templateIdInitial={settings.templateIdSelected}
          isTemplateFixed={false}
          onDone={() => {
            // a cancel; a creation shows the new instance already
            if (serviceStore.settings.view === 'instanceNew') serviceStore.settingsViewSet('overview');
          }}
        />
      </div>
    );
  }
  if (settings.view === 'template') {
    const template = serviceStore.templateGet(settings.templateIdSelected);
    if (!template) return <ViewGone text={`The template ${settings.templateIdSelected} is no longer in the template folders.`} />;
    return (
      <div className="doc-service-area">
        <ViewHead iconUrl={serviceStore.templateIconUrlGet(template.templateId)} name={template.name} note="service template">
          <KindBadge kind={template.kind} />
          <OriginBadge origin={template.origin} />
        </ViewHead>
        <TemplateDetail key={template.templateId} template={template} />
      </div>
    );
  }
  if (settings.view === 'instance') {
    const instance = serviceStore.instanceGet(settings.serviceIdSelected);
    if (!instance) return <ViewGone text={`The instance ${settings.serviceIdSelected} is no longer in the instance folders.`} />;
    return (
      <div className="doc-service-area">
        <ViewHead iconUrl={serviceStore.instanceIconUrlGet(instance.serviceId)} name={instance.name} note="service instance">
          <KindBadge kind={instance.kind} />
          <ServiceStatusDot status={instance.status} />
          <span className="doc-service-settings-muted">{instance.status}</span>
        </ViewHead>
        <InstanceDetail key={instance.serviceId} instance={instance} />
      </div>
    );
  }
  return <OverviewView />;
});

// the head of a view of one thing: its icon (a service's own, or Icon), its
// name, what it is
function ViewHead({ iconUrl, Icon, name, note, children }) {
  return (
    <div className="doc-service-view-head">
      {Icon ? <span className="doc-service-card-icon"><Icon size={24} aria-hidden="true" /></span> : <ServiceIcon iconUrl={iconUrl} size={26} />}
      <span className="doc-service-view-name">{name}</span>
      <span className="doc-service-settings-muted">{note}</span>
      {children}
    </div>
  );
}

// a view whose object is gone (deleted, its folder moved away)
const ViewGone = observer(function ViewGone({ text }) {
  const { serviceStore } = useDocStores();
  return (
    <div className="doc-service-area">
      <div className="doc-service-settings-muted">{text}</div>
      <div>
        <button type="button" className="doc-button" onClick={() => serviceStore.settingsViewSet('overview')}>Back to the overview</button>
      </div>
    </div>
  );
});

// the tab without a backend to show: a notice in the middle of the tab,
// an error when the backend is down, a remark when the page has none, a
// running request while the first answer is awaited
const BackendNotice = observer(function BackendNotice() {
  const { serviceStore } = useDocStores();
  const status = serviceStore.backendStatus;
  if (status === 'loading') {
    return (
      <div className="doc-service-notice" role="status">
        <div className="doc-service-notice-title">
          <LoaderCircle size={15} aria-hidden="true" className="doc-spin" />
          <span>asking the service backend…</span>
        </div>
      </div>
    );
  }
  const isDown = status === 'down';
  return (
    <div className="doc-service-notice" data-error={isDown ? '' : undefined} role={isDown ? 'alert' : 'status'}>
      <div className="doc-service-notice-title">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>{isDown ? 'Service backend is down' : 'No service backend'}</span>
      </div>
      <div className="doc-service-notice-message">{isDown ? serviceStore.backendMessage : serviceStore.unavailableReason}</div>
      {isDown ? (
        <>
          <div className="doc-service-notice-hint">
            pnpm run dev starts it when config.yaml says service.launch; by hand:
            python3 main/service-backend/server.py --config &lt;backend config file&gt;. The page asks again every few seconds.
          </div>
          <div>
            <button type="button" className="doc-button" disabled={serviceStore.isRefreshing} onClick={() => void serviceStore.refresh()}>
              {serviceStore.isRefreshing ? <LoaderCircle size={12} aria-hidden="true" className="doc-spin" /> : <RotateCw size={12} aria-hidden="true" />}
              <span>Retry</span>
            </button>
          </div>
        </>
      ) : null}
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

// a time of the backend (20261029_05400577+09) or of a log record
// (2026-10-29T05:39:47.966+09:00) as a short local text
function timeShortText(text) {
  const value = String(text ?? '');
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (compact) return `${compact[2]}-${compact[3]} ${compact[4]}:${compact[5]}:${compact[6]}`;
  const iso = value.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?/);
  if (iso) return `${iso[1]}-${iso[2]} ${iso[3]}${iso[4] ? iso[4].slice(0, 4) : ''}`;
  return value;
}

// where a template or an instance comes from: the package's built-in folder,
// a doc page (by its alias), or a plain folder of the backend config
function originText(origin) {
  if (!origin) return '';
  if (origin.kind === 'builtIn') return 'built-in';
  if (origin.kind === 'docPage') return origin.alias ? `page ${origin.alias}` : 'doc page';
  return 'folder';
}

function originTitle(origin) {
  if (!origin) return '';
  if (origin.kind === 'builtIn') return `shipped by the package: ${origin.dir}`;
  if (origin.kind === 'docPage') return `the doc page ${origin.alias}: ${origin.dir}`;
  return `a folder of the backend config: ${origin.dir}`;
}

function KindBadge({ kind }) {
  return <span className="doc-badge-outline" data-primary={kind === 'infra' ? '' : undefined} title={kind === 'infra' ? 'an infra service: serves other services under its name' : 'an app service: serves documents and dashboards'}>{kind ?? 'app'}</span>;
}

function OriginBadge({ origin }) {
  if (!origin) return null;
  return <span className="doc-badge-outline" title={originTitle(origin)}>{originText(origin)}</span>;
}

// ---------- the overview ----------

// the cards of everything the tab shows: the system (the server, the
// routing table, the logs), the templates and the instances, each kind
// in a group; a card opens its view
const OverviewView = observer(function OverviewView() {
  const { serviceStore } = useDocStores();
  const problemCount = (serviceStore.backendInfo?.scanProblemList ?? []).length
    + (serviceStore.kernel?.problemList ?? []).length
    + (serviceStore.kernel?.log?.flushError ? 1 : 0);
  const groupListTemplate = [
    { kind: 'app', title: 'App templates', note: 'the initial state of an app service: serves documents and dashboards; stateless, its state in infra services. never run' },
    { kind: 'infra', title: 'Infra templates', note: 'the initial state of an infra service: serves other services under an infra name (storage, logging, connections). never run' },
  ];
  const groupListInstance = [
    { kind: 'app', title: 'App instances', note: 'running app services, each created from a template: its own folder, its own copy of the script' },
    { kind: 'infra', title: 'Infra instances', note: 'running infra services; an auto one was provisioned by the kernel' },
  ];
  return (
    <div className="doc-service-overview">
      {problemCount > 0 ? (
        <button type="button" className="doc-service-link doc-service-error" onClick={() => serviceStore.settingsViewSet('server')}>
          {countText(problemCount, 'problem')} of the backend: see the server status
        </button>
      ) : null}
      <div className="doc-service-group">
        <div className="doc-service-settings-subtitle">System</div>
        <div className="doc-service-card-list">
          <SystemCard
            Icon={Server}
            name="Server status"
            title="the service backend, its kernel, the doc pages it mounted, the problems of its scan"
            onSelect={() => serviceStore.settingsViewSet('server')}
          >
            <ServiceStatusDot status="ready" /> up
          </SystemCard>
          <SystemCard
            Icon={Waypoints}
            name="Infra routes"
            title="the routing table of the kernel: the instance each infra name goes to"
            onSelect={() => serviceStore.settingsViewSet('infra')}
          >
            {countText(serviceStore.infraList.length, 'name')}
          </SystemCard>
          <SystemCard
            Icon={ScrollText}
            name="Logs"
            title="the records of the kernel and the services, from the logging infra service"
            onSelect={() => serviceStore.settingsViewSet('log')}
          >
            logging <ServiceStatusDot status={serviceStore.kernel?.loggingStatus === 'available' ? 'ready' : 'error'} />
          </SystemCard>
        </div>
      </div>
      {groupListTemplate.map((group) => {
        const list = serviceStore.templateListOfKind(group.kind);
        return (
          <div key={`template:${group.kind}`} className="doc-service-group">
            <div className="doc-service-settings-subtitle" title={group.note}>{group.title}</div>
            {list.length === 0 ? (
              <div className="doc-service-settings-muted">none: no {group.kind} template folder holds one.</div>
            ) : (
              <div className="doc-service-card-list">
                {list.map((template) => (
                  <TemplateCard key={template.templateId} template={template} onSelect={() => serviceStore.settingsTemplateSelect(template.templateId)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {groupListInstance.map((group) => {
        const list = serviceStore.instanceListOfKind(group.kind);
        return (
          <div key={`instance:${group.kind}`} className="doc-service-group">
            <div className="doc-service-settings-subtitle" title={group.note}>{group.title}</div>
            <div className="doc-service-card-list">
              {list.map((instance) => (
                <InstanceCard key={instance.serviceId} instance={instance} onSelect={() => serviceStore.settingsServiceSelect(instance.serviceId)} />
              ))}
              {group.kind === 'app' ? (
                <ServiceCard
                  isNew
                  icon={<Plus size={20} aria-hidden="true" />}
                  name="New"
                  status="from a template"
                  title="create an instance from a template (app or infra)"
                  onSelect={() => {
                    serviceStore.settings.templateIdSelected = '';
                    serviceStore.settingsViewSet('instanceNew');
                  }}
                />
              ) : null}
            </div>
            {group.kind === 'infra' && list.length === 0 ? <div className="doc-service-settings-muted">none yet</div> : null}
          </div>
        );
      })}
    </div>
  );
});

// every card of the tab: the same five slots in the same order (icon, name,
// group, badges, status), each one row of the card list's grid (a subgrid,
// DocService.css), so the slots of the cards of one row line up whatever a
// card leaves empty and however many lines its name takes. isPressed:
// undefined for a card that opens a view, a boolean for one that is chosen
function ServiceCard({ icon, name, group, badgeList, status, statusData, title, isPressed, isNew, onSelect }) {
  return (
    <button
      type="button"
      className={isNew ? 'doc-service-card doc-service-card-new' : 'doc-service-card'}
      title={title}
      aria-pressed={isPressed}
      onClick={onSelect}
    >
      <span className="doc-service-card-icon">{icon}</span>
      <span className="doc-service-card-name">{name}</span>
      <span className="doc-service-card-group">{group}</span>
      <span className="doc-service-card-badge-list">{badgeList}</span>
      <span className="doc-service-card-type" data-status={statusData}>{status}</span>
    </button>
  );
}

// a card of the system group: an icon of its own, a name, a short state
function SystemCard({ Icon, name, title, onSelect, children }) {
  return <ServiceCard icon={<Icon size={20} aria-hidden="true" />} name={name} status={children} title={title} onSelect={onSelect} />;
}

// ---------- the server status ----------

// the backend that is up: what it holds, the kernel's state (its tick, its
// log), the doc pages it mounted, the problems of its scan and of the kernel
const ServerStatusView = observer(function ServerStatusView() {
  const { serviceStore } = useDocStores();
  const info = serviceStore.backendInfo ?? {};
  const scanProblemList = info.scanProblemList ?? [];
  const kernel = serviceStore.kernel;
  const kernelProblemList = kernel?.problemList ?? [];
  const docPageList = kernel?.docPageList ?? [];
  const log = kernel?.log;
  return (
    <div className="doc-service-area">
      <ViewHead Icon={Server} name="Server status" note="the service backend">
        <ServiceStatusDot status="ready" />
        <span className="doc-service-settings-muted">up</span>
      </ViewHead>
      <div className="doc-service-detail-grid">
        <span className="doc-service-detail-key">registry</span>
        <span>{countText(serviceStore.templateList.length, 'template')} · {countText(serviceStore.instanceList.length, 'instance')} · {countText(serviceStore.infraList.length, 'infra name')}</span>
        {info.timeStarted ? (
          <>
            <span className="doc-service-detail-key">started</span>
            <span>{timeShortText(info.timeStarted)}</span>
          </>
        ) : null}
        {info.configPath ? (
          <>
            <span className="doc-service-detail-key">config</span>
            <span className="doc-service-path-text">{info.configPath}</span>
          </>
        ) : null}
        {kernel ? (
          <>
            <span className="doc-service-detail-key">kernel</span>
            <span>scans and reconciles every {kernel.reconcileIntervalSecond} s; {countText(kernel.reconcileCount, 'tick')} so far, the last {timeShortText(kernel.timeReconciled)}</span>
            <span className="doc-service-detail-key">logging</span>
            <span className="doc-service-inline">
              <ServiceStatusDot status={kernel.loggingStatus === 'available' ? 'ready' : 'error'} />
              <span>{kernel.loggingStatus}{kernel.loggingServiceId ? ` (${serviceStore.instanceGet(kernel.loggingServiceId)?.name ?? kernel.loggingServiceId})` : ''}</span>
              <span className="doc-service-settings-muted">· {log?.bufferCount ?? 0} in the buffer, {log?.flushedCount ?? 0} flushed, {log?.droppedCount ?? 0} dropped</span>
            </span>
          </>
        ) : null}
        <span className="doc-service-detail-key">doc pages</span>
        <span className="doc-service-detail-stack">
          {docPageList.length === 0 ? <span className="doc-service-settings-muted">none mounted</span> : docPageList.map((docPage) => (
            <span key={docPage.alias} className="doc-service-inline" title={docPage.folderList?.map((folder) => `${folder.role} ${folder.kind}: ${folder.pathWritten}${folder.isExisting ? '' : ' (absent)'}${folder.isDefault ? ' (default)' : ''}`).join('\n')}>
              <span>{docPage.alias}</span>
              <span className="doc-badge-outline" title={docPage.source === 'config' ? 'named by the backend config' : 'mounted by the page while the backend runs'}>{docPage.source}</span>
              {docPage.isDefault ? <span className="doc-badge-outline" data-primary="" title="where an instance is created when no doc page is named">default</span> : null}
              <span className="doc-service-path-text doc-service-settings-muted">{docPage.dir}</span>
            </span>
          ))}
        </span>
        <span className="doc-service-detail-key">problems</span>
        <span className="doc-service-detail-stack">
          {kernelProblemList.length + scanProblemList.length === 0 && !log?.flushError ? <span className="doc-service-settings-muted">none</span> : null}
          {kernelProblemList.map((problem) => <span key={`kernel:${problem}`} className="doc-service-error">kernel: {problem}</span>)}
          {log?.flushError ? <span className="doc-service-error">log: {log.flushError}</span> : null}
          {scanProblemList.map((problem) => <span key={problem} className="doc-service-error">{problem}</span>)}
        </span>
      </div>
    </div>
  );
});

// ---------- templates ----------

// a group path that wraps after its slashes only, never inside a name
function groupPathBreakable(groupPath) {
  return groupPath.split('/').map((part, index) => (
    <span key={index}>{index > 0 ? <>/<wbr /></> : null}{part}</span>
  ));
}

const TemplateCard = observer(function TemplateCard({ template, isPressed, onSelect }) {
  const { serviceStore } = useDocStores();
  const instanceCount = serviceStore.instanceListOfTemplate(template.templateId).length;
  const isInfra = template.kind === 'infra';
  return (
    <ServiceCard
      icon={<ServiceIcon iconUrl={serviceStore.templateIconUrlGet(template.templateId)} size={22} />}
      name={template.name}
      group={template.groupPath ? <span title="the groups of the template folder it is in">{groupPathBreakable(template.groupPath)}</span> : null}
      badgeList={(
        <>
          <KindBadge kind={template.kind} />
          <OriginBadge origin={template.origin} />
          {isInfra && template.provision === 'auto' ? <span className="doc-badge-outline" data-primary="" title={`provisioned by the kernel when ${template.infraName} is required and nobody provides it`}>auto</span> : null}
        </>
      )}
      status={(
        <>
          <ServiceStatusDot status={template.status} />
          {template.status === 'ready' ? countText(instanceCount, 'instance') : 'error'}
        </>
      )}
      title={template.message || template.description || template.name}
      isPressed={isPressed}
      onSelect={onSelect}
    />
  );
});

// the template chosen: what it is, where it comes from, what its script
// declares (its infra name and storage, its dependencies, its execution,
// its hooks), its versions, the instances created from it, and the
// creation of a new one
const TemplateDetail = observer(function TemplateDetail({ template }) {
  const { serviceStore } = useDocStores();
  const [isCreateOpen, isCreateOpenSet] = useState(false);
  const meta = template.expose?.meta;
  const instanceList = serviceStore.instanceListOfTemplate(template.templateId);
  return (
    <div className="doc-service-detail">
      <div className="doc-service-detail-grid">
        <span className="doc-service-detail-key">template</span>
        <span className="doc-service-inline">
          {template.name} <span className="doc-service-detail-code">{template.templateId}</span>
          <KindBadge kind={template.kind} />
        </span>
        <span className="doc-service-detail-key">origin</span>
        <span className="doc-service-inline">
          <OriginBadge origin={template.origin} />
          <span className="doc-service-path-text">{template.folder}/{template.groupPath ? `${template.groupPath}/` : ''}{template.dirName}</span>
        </span>
        {template.groupPath ? (
          <>
            <span className="doc-service-detail-key">group</span>
            <span title="the folders the template is grouped in, inside its template folder">{template.groupPath}</span>
          </>
        ) : null}
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
        {template.description ? (
          <>
            <span className="doc-service-detail-key">description</span>
            <span>{template.description}</span>
          </>
        ) : null}
        <ScriptMetaRow meta={meta} />
        {template.kind === 'infra' ? (
          <>
            <span className="doc-service-detail-key">provides</span>
            <span className="doc-service-inline">
              <span className="doc-service-detail-code">{template.infraName || template.expose?.infra?.name || template.name}</span>
              <span className="doc-service-settings-muted">· provision {template.provision}{template.provision === 'auto' ? ' (the kernel creates an instance when the name is required and nobody provides it)' : ' (an instance is created here)'}</span>
            </span>
            <StorageRow storage={template.expose?.infra?.storage} />
          </>
        ) : null}
        <ExposeRows expose={template.expose} />
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

// ---------- infra services: the routing table of the kernel ----------

const infraStatusTextByStatus = {
  available: 'available',
  unavailable: 'unavailable',
  notProvided: 'not provided',
};

const infraDotStatusByStatus = {
  available: 'ready',
  unavailable: 'error',
  notProvided: 'disabled',
};

// one row per infra name the kernel knows (required by an instance or the
// kernel, provided by an instance, or offered by a template): its status,
// the instance its name is routed to, who provides it, who uses it, and
// the templates that can provide it
const InfraArea = observer(function InfraArea() {
  const { serviceStore } = useDocStores();
  const infraList = serviceStore.infraList;
  return (
    <div className="doc-service-area">
      <div className="doc-service-settings-title">Infra routes</div>
      <div className="doc-service-settings-muted">
        the routing table of the kernel: an infra name, used by app and infra instances as a dependency, goes to one instance providing it
        (the oldest ready one, or the one made current); a name nobody provides is provisioned from a template with provision auto when required.
      </div>
      <div className="doc-service-table-scroll">
        <div className="doc-service-table" style={{ '--doc-service-table-columns': 'max-content max-content minmax(7rem, 1.4fr) max-content minmax(5rem, 1fr) minmax(5rem, 1fr)' }} role="table">
          <div className="doc-service-table-row is-head" role="row">
            <span role="columnheader">name</span>
            <span role="columnheader">status</span>
            <span role="columnheader">current instance</span>
            <span role="columnheader">providers</span>
            <span role="columnheader">consumers</span>
            <span role="columnheader">templates</span>
          </div>
          {infraList.map((infra) => <InfraRow key={infra.name} infra={infra} />)}
        </div>
        {infraList.length === 0 ? <div className="doc-service-table-empty">none: no instance requires or provides an infra name, and no infra template is known.</div> : null}
      </div>
    </div>
  );
});

const InfraRow = observer(function InfraRow({ infra }) {
  const { serviceStore } = useDocStores();
  const instance = serviceStore.instanceGet(infra.serviceId);
  const provider = infra.providerList?.find((item) => item.serviceId === infra.serviceId);
  return (
    <div className="doc-service-table-row" role="row">
      <span role="cell" className="doc-service-table-cell-code" title={infra.storage ? `storage ${infra.storage.type}, versioning ${infra.storage.versioning}: ${infra.storage.description}` : undefined}>
        {infra.name}
        {infra.storage ? <span className="doc-badge-outline">{infra.storage.type}</span> : null}
      </span>
      <span role="cell" className="doc-service-table-cell-nowrap" title={infra.message || undefined}>
        <ServiceStatusDot status={infraDotStatusByStatus[infra.status] ?? infra.status} />
        {infraStatusTextByStatus[infra.status] ?? infra.status}
      </span>
      <span role="cell">
        {infra.serviceId ? (
          <>
            <button type="button" className="doc-service-link" title={`show the instance ${infra.serviceId}`} onClick={() => serviceStore.settingsServiceSelect(infra.serviceId)}>
              {instance?.name ?? provider?.name ?? infra.serviceId}
            </button>
            {(instance?.provision ?? provider?.isProvisioned) ? <span className="doc-badge-outline" title={instance?.provision ? `provisioned by the kernel: required by ${instance.provision.requiredBy}` : 'provisioned by the kernel'}>auto</span> : null}
            {infra.isRouteExplicit ? <span className="doc-badge-outline" data-primary="" title="made current from the Services tab; Default route goes back to the oldest ready provider">explicit</span> : null}
          </>
        ) : <span className="doc-service-settings-muted">none</span>}
      </span>
      <span role="cell" className="doc-service-table-cell-nowrap" title={infra.providerList?.map((item) => `${item.name} (${item.status}${item.isProvisioned ? ', auto' : ''})`).join('\n') || 'no instance provides this name'}>
        {infra.providerList?.length ?? 0}
      </span>
      <span role="cell">
        {infra.consumerList?.length ? infra.consumerList.map((consumer) => (
          consumer.serviceId ? (
            <button key={consumer.serviceId} type="button" className="doc-service-link" title={`${consumer.kind} instance ${consumer.serviceId}${consumer.isRequired ? ', requires it' : ', optional'}`} onClick={() => serviceStore.settingsServiceSelect(consumer.serviceId)}>
              {consumer.name}{consumer.isRequired ? '' : '?'}
            </button>
          ) : <span key="kernel" title="the kernel itself logs into it">{consumer.name}</span>
        )) : <span className="doc-service-settings-muted">none</span>}
      </span>
      <span role="cell">
        {infra.templateList?.length ? infra.templateList.map((template) => (
          <button key={template.templateId} type="button" className="doc-service-link" title={`show the template ${template.templateId} (${template.status})`} onClick={() => serviceStore.settingsTemplateSelect(template.templateId)}>
            {template.name}{template.provision === 'auto' ? ' (auto)' : ''}
          </button>
        )) : <span className="doc-service-settings-muted">none</span>}
      </span>
    </div>
  );
});

// ---------- instances ----------

const InstanceCard = observer(function InstanceCard({ instance, onSelect }) {
  const { serviceStore } = useDocStores();
  return (
    <ServiceCard
      icon={<ServiceIcon iconUrl={serviceStore.instanceIconUrlGet(instance.serviceId)} size={22} />}
      name={instance.name}
      badgeList={(
        <>
          <KindBadge kind={instance.kind} />
          {instance.provision ? <span className="doc-badge-outline" data-primary="" title={`provisioned by the kernel: ${instance.provision.infra} required by ${instance.provision.requiredBy}`}>auto</span> : <OriginBadge origin={instance.origin} />}
        </>
      )}
      status={(
        <>
          <ServiceStatusDot status={instance.status} />
          <ServiceHealthDot health={instance.health} message={instance.healthMessage} />
          {instance.status}
        </>
      )}
      statusData={instance.status}
      title={[instance.description || instance.name, instance.message].filter(Boolean).join('\n')}
      onSelect={onSelect}
    />
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
// created from, its health and execution, its dependencies (edited in
// place), its hooks, its lifecycle (disable, delete; the route of an infra
// instance), what its own script exposes, and its config dashboard
const InstanceDetail = observer(function InstanceDetail({ instance }) {
  const { serviceStore } = useDocStores();
  const dashboardIdConfig = serviceStore.dashboardIdOfPurposeGet(instance.expose, 'config');
  const templateRecord = instance.template;
  const templateCurrent = serviceStore.templateGet(templateRecord?.templateId);
  const isInfra = instance.kind === 'infra';

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
        <span className="doc-service-inline">
          {instance.name} <span className="doc-service-detail-code">{instance.serviceId}</span>
          <KindBadge kind={instance.kind} />
          {instance.provision ? <span className="doc-badge-outline" data-primary="" title={`provisioned ${timeShortText(instance.provision.time)}`}>auto · required by {instance.provision.requiredBy}</span> : null}
        </span>
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
        <span className="doc-service-detail-key">origin</span>
        <span className="doc-service-inline">
          <OriginBadge origin={instance.origin} />
          <span className="doc-service-path-text">{instance.folder}/{instance.dirName}</span>
        </span>
        <span className="doc-service-detail-key">status</span>
        <span className="doc-service-inline">
          <ServiceStatusDot status={instance.status} />
          <span>{instance.status}{instance.message ? `: ${instance.message}` : ''}</span>
          {!instance.isEnabled ? <span className="doc-badge-outline">disabled</span> : null}
        </span>
        <span className="doc-service-detail-key">health</span>
        <span className="doc-service-inline">
          <ServiceHealthDot health={instance.health} message={instance.healthMessage} />
          <span>{instance.health ?? 'unknown'}{instance.healthMessage ? `: ${instance.healthMessage}` : ''}</span>
          {instance.healthReported && instance.healthReported !== instance.health ? <span className="doc-service-settings-muted">· the script reports {instance.healthReported}</span> : null}
        </span>
        <span className="doc-service-detail-key">execution</span>
        <span>
          {instance.executionMode ?? 'passive'}
          {instance.executionMode === 'resident' ? <span className="doc-service-settings-muted"> · {instance.isResidentRunning ? 'the resident thread is running' : 'the resident thread is not running'}</span> : null}
          {instance.queueLength ? <span className="doc-service-settings-muted"> · {countText(instance.queueLength, 'call')} queued</span> : null}
          {instance.apiRunning ? <span className="doc-service-settings-muted"> · running {instance.apiRunning}</span> : null}
        </span>
        {instance.description ? (
          <>
            <span className="doc-service-detail-key">description</span>
            <span>{instance.description}</span>
          </>
        ) : null}
        <ScriptMetaRow meta={instance.expose?.meta} />
        {isInfra ? <InfraInstanceRows instance={instance} /> : null}
      </div>
      <DependencyEditor
        key={`${JSON.stringify(instance.dependencyList ?? [])}:${instance.isDependencyDynamicAllowed}`}
        instance={instance}
      />
      <HookTable instance={instance} />
      <LifecycleRow instance={instance} />
      <div className="doc-service-detail-grid">
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
      ) : isInfra && instance.expose ? (
        <div className="doc-service-settings-muted">an infra service without dashboards: worked from here, and by the services depending on it.</div>
      ) : (
        <ServiceProblemNotice problem={{ kind: 'serviceNotReady', message: `${instance.name || instance.serviceId} has no config dashboard to show: ${instance.message || 'its script did not load'}` }} />
      )}
    </div>
  );
});

// an infra instance: the name it provides and its storage, whether it is
// the current route of that name (made current, or back to the default),
// and the consumers of the name
const InfraInstanceRows = observer(function InfraInstanceRows({ instance }) {
  const { serviceStore } = useDocStores();
  const name = instance.infraName || instance.expose?.infra?.name || '';
  const infra = serviceStore.infraGet(name);
  const isCurrent = Boolean(infra) && infra.serviceId === instance.serviceId;
  const routeSet = serviceStore.settings.routeSet;
  const isSubmitting = routeSet.status === 'submitting';
  const current = infra?.serviceId ? serviceStore.instanceGet(infra.serviceId) : undefined;
  return (
    <>
      <span className="doc-service-detail-key">provides</span>
      <span className="doc-service-inline">
        <span className="doc-service-detail-code">{name || '?'}</span>
        {infra ? (
          <>
            <ServiceStatusDot status={infraDotStatusByStatus[infra.status] ?? infra.status} />
            <span>{infraStatusTextByStatus[infra.status] ?? infra.status}</span>
            <span className="doc-service-settings-muted">· {countText(infra.providerList?.length ?? 0, 'provider')}</span>
          </>
        ) : null}
      </span>
      <StorageRow storage={instance.expose?.infra?.storage} />
      <span className="doc-service-detail-key">route</span>
      <span className="doc-service-inline">
        {isCurrent ? (
          <>
            <span>the current instance of {name}</span>
            {infra.isRouteExplicit ? <span className="doc-badge-outline" data-primary="">explicit</span> : <span className="doc-badge-outline" title="the oldest ready provider">default</span>}
          </>
        ) : (
          <span>
            not the current instance of {name}
            {current ? (
              <>
                {' '}(current: <button type="button" className="doc-service-link" onClick={() => serviceStore.settingsServiceSelect(current.serviceId)}>{current.name}</button>)
              </>
            ) : infra?.serviceId ? ` (current: ${infra.serviceId})` : ' (none is)'}
          </span>
        )}
        {!isCurrent ? (
          <button
            type="button"
            className="doc-button doc-service-button"
            disabled={isSubmitting || instance.status !== 'ready'}
            title={instance.status === 'ready' ? `route ${name} to this instance (the consumers go here from now on)` : `the instance is ${instance.status}: only a ready instance can be made current`}
            onClick={() => void serviceStore.infraRouteSet(name, instance.serviceId)}
          >
            {isSubmitting ? <LoaderCircle size={11} aria-hidden="true" className="doc-spin" /> : null}
            <span>Make current</span>
          </button>
        ) : infra.isRouteExplicit ? (
          <button
            type="button"
            className="doc-button doc-service-button"
            disabled={isSubmitting}
            title={`back to the default route of ${name}: the oldest ready provider`}
            onClick={() => void serviceStore.infraRouteSet(name, '')}
          >
            {isSubmitting ? <LoaderCircle size={11} aria-hidden="true" className="doc-spin" /> : null}
            <span>Default route</span>
          </button>
        ) : null}
        {routeSet.status === 'error' ? <span className="doc-service-error" role="alert">{routeSet.message}</span> : null}
      </span>
      <span className="doc-service-detail-key">consumers</span>
      <span>
        {infra?.consumerList?.length ? infra.consumerList.map((consumer) => (
          consumer.serviceId ? (
            <button key={consumer.serviceId} type="button" className="doc-service-link" title={`${consumer.kind} instance ${consumer.serviceId}`} onClick={() => serviceStore.settingsServiceSelect(consumer.serviceId)}>
              {consumer.name}{consumer.isRequired ? '' : ' (optional)'}
            </button>
          ) : <span key="kernel" className="doc-service-link" style={{ cursor: 'default' }}>{consumer.name}</span>
        )) : <span className="doc-service-settings-muted">none: no instance depends on {name}</span>}
      </span>
    </>
  );
});

// the storage an infra service exposes (type, versioning, operations)
function StorageRow({ storage }) {
  if (!storage) return null;
  return (
    <>
      <span className="doc-service-detail-key">storage</span>
      <span>
        {storage.type} · versioning {storage.versioning}
        {storage.operationList?.length ? <span className="doc-service-detail-code"> · {storage.operationList.join(', ')}</span> : null}
        {storage.description ? <span className="doc-service-settings-muted"> · {storage.description}</span> : null}
      </span>
    </>
  );
}

// what a script declares beyond its apis: its dependencies, its execution
// mode, the hooks it implements
function ExposeRows({ expose }) {
  if (!expose) return null;
  const dependencyList = expose.dependencyList ?? [];
  return (
    <>
      <span className="doc-service-detail-key">dependencies</span>
      <span className="doc-service-detail-code">
        {dependencyList.length === 0 ? <span className="doc-service-settings-muted">none</span> : dependencyList.map((dependency) => (
          <span key={dependency.name} className="doc-service-detail-line">
            {dependency.name}{dependency.isRequired === false ? ' (optional)' : ''}{dependency.onUnavailable === 'reject' ? ' · reject when unavailable' : ''}
          </span>
        ))}
      </span>
      <span className="doc-service-detail-key">execution</span>
      <span>
        {expose.execution?.mode ?? 'passive'}
        {expose.lifecycle?.hookTimeoutSecond ? <span className="doc-service-settings-muted"> · a hook may take {expose.lifecycle.hookTimeoutSecond} s</span> : null}
      </span>
      <span className="doc-service-detail-key">hooks</span>
      <span className="doc-service-detail-code">{expose.hookList?.length ? expose.hookList.join(', ') : <span className="doc-service-settings-muted">none implemented</span>}</span>
    </>
  );
}

// ---------- the dependencies of an instance ----------

const dependencyStatusTextByStatus = infraStatusTextByStatus;

// the effective dependencies of an instance (the infra names it uses),
// each with its status and the instance its name goes to, edited in place:
// a draft of the list, with names added (an infra name the registry
// knows, or one typed), removed, required or not, reported or rejected
// when unavailable, and whether the script may add some at runtime. Save
// sends the whole list (instanceDependencySet) and the backend restarts the
// instance. the editor is mounted again (key) when the backend's list
// changes, so a saved list shows as it is now
const DependencyEditor = observer(function DependencyEditor({ instance }) {
  const { serviceStore } = useDocStores();
  const listSaved = useMemo(() => (instance.dependencyList ?? []).map((dependency) => ({
    name: dependency.name,
    isRequired: dependency.isRequired !== false,
    onUnavailable: dependency.onUnavailable === 'reject' ? 'reject' : 'report',
  })), [instance.dependencyList]);
  const [draft, draftSet] = useState(listSaved);
  const [isDynamic, isDynamicSet] = useState(Boolean(instance.isDependencyDynamicAllowed));
  const [nameNew, nameNewSet] = useState('');
  const pending = serviceStore.settings.dependencySet;
  const isSubmitting = pending.status === 'submitting';
  const isDirty = JSON.stringify(draft) !== JSON.stringify(listSaved) || isDynamic !== Boolean(instance.isDependencyDynamicAllowed);
  const statusByName = new Map((instance.dependencyStatusList ?? []).map((item) => [item.name, item]));
  const nameKnownList = serviceStore.infraList.map((infra) => infra.name).filter((name) => !draft.some((dependency) => dependency.name === name));

  const update = (index, change) => draftSet(draft.map((dependency, i) => (i === index ? { ...dependency, ...change } : dependency)));
  const remove = (index) => draftSet(draft.filter((_, i) => i !== index));
  const add = () => {
    const name = nameNew.trim();
    if (!name || draft.some((dependency) => dependency.name === name)) return;
    draftSet([...draft, { name, isRequired: true, onUnavailable: 'report' }]);
    nameNewSet('');
  };
  const save = () => void serviceStore.instanceDependencySet(instance.serviceId, draft, isDynamic);
  const reset = () => {
    draftSet(listSaved);
    isDynamicSet(Boolean(instance.isDependencyDynamicAllowed));
  };

  return (
    <div className="doc-service-group">
      <div className="doc-service-settings-subtitle" title="the infra names this instance uses; each goes to the current instance of the name">Dependencies</div>
      <div className="doc-service-table-scroll">
        <div className="doc-service-table" style={{ '--doc-service-table-columns': 'max-content max-content minmax(5rem, 1fr) max-content max-content' }} role="table">
          <div className="doc-service-table-row is-head" role="row">
            <span role="columnheader">infra name</span>
            <span role="columnheader">status</span>
            <span role="columnheader">routed to</span>
            <span role="columnheader" title="the instance waits (is not started) while a required name is unavailable">required</span>
            <span role="columnheader" title="report: the dependency shows in the health, a call of the infra fails (-7); reject: moreover every call of this instance is refused while it is unavailable">when unavailable</span>
          </div>
          {draft.map((dependency, index) => {
            const status = statusByName.get(dependency.name);
            const routed = status?.serviceId ? serviceStore.instanceGet(status.serviceId) : undefined;
            return (
              <div key={dependency.name} className="doc-service-table-row" role="row">
                <span role="cell" className="doc-service-table-cell-code">{dependency.name}</span>
                <span role="cell" className="doc-service-table-cell-nowrap" title={status?.message || undefined}>
                  {status ? (
                    <>
                      <ServiceStatusDot status={infraDotStatusByStatus[status.status] ?? status.status} />
                      {dependencyStatusTextByStatus[status.status] ?? status.status}
                    </>
                  ) : <span className="doc-service-settings-muted">not saved</span>}
                </span>
                <span role="cell">
                  {status?.serviceId ? (
                    <button type="button" className="doc-service-link" title={`show the instance ${status.serviceId}`} onClick={() => serviceStore.settingsServiceSelect(status.serviceId)}>
                      {routed?.name ?? status.serviceId}
                    </button>
                  ) : <span className="doc-service-settings-muted">{status ? 'no instance' : '—'}</span>}
                </span>
                <span role="cell">
                  <input type="checkbox" checked={dependency.isRequired} disabled={isSubmitting} aria-label={`${dependency.name} is required`} onChange={(event) => update(index, { isRequired: event.target.checked })} />
                </span>
                <span role="cell">
                  <select className="doc-service-select" value={dependency.onUnavailable} disabled={isSubmitting} aria-label={`${dependency.name} when unavailable`} onChange={(event) => update(index, { onUnavailable: event.target.value })}>
                    <option value="report">report</option>
                    <option value="reject">reject</option>
                  </select>
                  <button type="button" className="doc-service-icon-button" title={`remove ${dependency.name} from the dependencies`} disabled={isSubmitting} onClick={() => remove(index)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        {draft.length === 0 ? <div className="doc-service-table-empty">none: the instance uses no infra service.</div> : null}
      </div>
      <div className="doc-service-settings-line">
        <span className="doc-service-dependency-add">
          <input
            className="doc-service-log-text"
            list={`doc-service-infra-name-${instance.serviceId}`}
            value={nameNew}
            placeholder="an infra name…"
            disabled={isSubmitting}
            aria-label="infra name to add"
            onChange={(event) => nameNewSet(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
          />
          <datalist id={`doc-service-infra-name-${instance.serviceId}`}>
            {nameKnownList.map((name) => <option key={name} value={name} />)}
          </datalist>
          <button type="button" className="doc-button doc-service-button" disabled={isSubmitting || nameNew.trim() === '' || draft.some((dependency) => dependency.name === nameNew.trim())} title="add the name to the list (saved with Save)" onClick={add}>
            <Plus size={11} aria-hidden="true" />
            <span>Add</span>
          </button>
        </span>
        <label className="doc-service-check" title="the script may add dependencies at runtime (context.dependency_add)">
          <input type="checkbox" checked={isDynamic} disabled={isSubmitting} onChange={(event) => isDynamicSet(event.target.checked)} />
          dynamic allowed
        </label>
        <button type="button" className="doc-button doc-service-button" data-primary={isDirty ? '' : undefined} disabled={isSubmitting || !isDirty} title="save the list; the backend restarts the instance" onClick={save}>
          {isSubmitting ? <LoaderCircle size={11} aria-hidden="true" className="doc-spin" /> : null}
          <span>Save</span>
        </button>
        <button type="button" className="doc-button doc-service-button" disabled={isSubmitting || !isDirty} onClick={reset}>Reset</button>
        {isDirty ? <span className="doc-service-settings-muted">saving restarts the instance.</span> : null}
        {pending.status === 'error' ? <span className="doc-service-error" role="alert">{pending.message}</span> : null}
      </div>
    </div>
  );
});

// ---------- the hooks of an instance ----------

const hookStatusDotByStatus = {
  running: 'starting',
  done: 'ready',
  failed: 'error',
  timedOut: 'error',
};

// the lifecycle hooks the kernel ran for an instance (onCreate, onStart,
// onStop, onDestroy), latest first; the latest HOOK_RECORD_SHOWN_MAX only
const HOOK_RECORD_SHOWN_MAX = 10;

function HookTable({ instance }) {
  const recordListAll = instance.hookRecordList ?? [];
  const recordList = recordListAll.slice(-HOOK_RECORD_SHOWN_MAX).reverse();
  return (
    <div className="doc-service-group">
      <div className="doc-service-settings-subtitle" title={`the hooks the kernel ran; the instance was created ${timeShortText(instance.timeCreateHook) || 'at an unknown time'}`}>
        Hooks
        {instance.timeCreateHook ? <span className="doc-service-settings-muted"> · onCreate ran {timeShortText(instance.timeCreateHook)}</span> : null}
        {recordListAll.length > recordList.length ? <span className="doc-service-settings-muted"> · the latest {recordList.length} of {recordListAll.length}</span> : null}
      </div>
      <div className="doc-service-table-scroll">
        <div className="doc-service-table" style={{ '--doc-service-table-columns': 'max-content max-content max-content max-content minmax(6rem, 1fr)' }} role="table">
          <div className="doc-service-table-row is-head" role="row">
            <span role="columnheader">hook</span>
            <span role="columnheader">status</span>
            <span role="columnheader">when</span>
            <span role="columnheader">seconds</span>
            <span role="columnheader">message</span>
          </div>
          {recordList.map((record, index) => (
            <div key={`${record.hook}:${record.timeStarted}:${index}`} className="doc-service-table-row" role="row">
              <span role="cell" className="doc-service-table-cell-code">{record.hook}</span>
              <span role="cell" className="doc-service-table-cell-nowrap">
                <ServiceStatusDot status={hookStatusDotByStatus[record.status] ?? record.status} />
                {record.status}
              </span>
              <span role="cell" className="doc-service-table-cell-nowrap" title={record.timeStarted}>{timeShortText(record.timeStarted)}</span>
              <span role="cell" className="doc-service-table-cell-nowrap">{typeof record.second === 'number' ? record.second.toFixed(3) : ''}</span>
              <span role="cell" className={record.message ? 'doc-service-table-cell-text' : undefined}>{record.message}</span>
            </div>
          ))}
        </div>
        {recordList.length === 0 ? <div className="doc-service-table-empty">no hook ran yet.</div> : null}
      </div>
    </div>
  );
}

// ---------- the lifecycle of an instance ----------

// disable / enable, and delete with an in-place confirmation
const LifecycleRow = observer(function LifecycleRow({ instance }) {
  const { serviceStore } = useDocStores();
  const [isDeleteAsked, isDeleteAskedSet] = useState(false);
  const enableSet = serviceStore.settings.enableSet;
  const pendingDelete = serviceStore.settings.delete;
  const isSubmitting = enableSet.status === 'submitting' || pendingDelete.status === 'submitting';
  return (
    <div className="doc-service-group">
      <div className="doc-service-settings-subtitle">Lifecycle</div>
      <div className="doc-service-settings-line">
        <button
          type="button"
          className="doc-button doc-service-button"
          disabled={isSubmitting}
          title={instance.isEnabled ? 'stop the instance; its calls are refused until it is enabled again' : 'start the instance again'}
          onClick={() => void serviceStore.instanceEnableSet(instance.serviceId, !instance.isEnabled)}
        >
          {enableSet.status === 'submitting' ? <LoaderCircle size={11} aria-hidden="true" className="doc-spin" /> : null}
          <span>{instance.isEnabled ? 'Disable' : 'Enable'}</span>
        </button>
        {!isDeleteAsked ? (
          <button
            type="button"
            className="doc-button doc-service-button"
            disabled={isSubmitting}
            title="stop the instance, run its onDestroy hook, and rename its folder"
            onClick={() => isDeleteAskedSet(true)}
          >
            <Trash2 size={11} aria-hidden="true" />
            <span>Delete</span>
          </button>
        ) : (
          <span className="doc-service-confirm">
            <span className="doc-service-settings-muted">
              delete {instance.name}? it is stopped, its onDestroy hook runs, and its folder is kept as .deleted-{instance.dirName}-&#123;time&#125;.
            </span>
            <button type="button" className="doc-button doc-service-button" data-primary="" disabled={isSubmitting} onClick={() => void serviceStore.instanceDelete(instance.serviceId)}>
              {pendingDelete.status === 'submitting' ? <LoaderCircle size={11} aria-hidden="true" className="doc-spin" /> : <Trash2 size={11} aria-hidden="true" />}
              <span>Delete</span>
            </button>
            <button type="button" className="doc-button doc-service-button" disabled={isSubmitting} onClick={() => isDeleteAskedSet(false)}>Cancel</button>
          </span>
        )}
        {enableSet.status === 'error' ? <span className="doc-service-error" role="alert">{enableSet.message}</span> : null}
        {pendingDelete.status === 'error' ? <span className="doc-service-error" role="alert">{pendingDelete.message}</span> : null}
      </div>
    </div>
  );
});

// ---------- the creation of an instance ----------

// a new instance from a template: the template (fixed when asked from the
// template itself), a name and a description. the backend copies the
// template folder into {templateName}-inst-{serviceId} of the instance
// folder of the template's kind: in the template's doc page, or in the
// page's main doc page for a built-in template (shipped by the package); the
// config starts with the template's
const InstanceCreate = observer(function InstanceCreate({ templateIdInitial, isTemplateFixed, onDone }) {
  const { serviceStore, sourceStore } = useDocStores();
  const templateListReady = serviceStore.templateList.filter((template) => template.status === 'ready');
  const templateIdDefault = templateListReady.some((template) => template.templateId === templateIdInitial)
    ? templateIdInitial
    : (templateListReady[0]?.templateId ?? '');
  const [templateId, templateIdSet] = useState(templateIdDefault);
  const nameRef = useRef(null);
  const descriptionRef = useRef(null);
  const isSubmitting = serviceStore.settings.create.status === 'submitting';
  const template = serviceStore.templateGet(templateId);
  const docPageAliasMain = sourceStore?.docPageAliasMain ?? serviceStore.docPageAliasMain;
  const isBuiltIn = template?.origin?.kind === 'builtIn';
  const docPageAlias = isBuiltIn ? docPageAliasMain : (template?.origin?.kind === 'docPage' ? template.origin.alias : '');

  const create = async () => {
    const name = String(nameRef.current?.textContent ?? '').trim();
    const description = String(descriptionRef.current?.textContent ?? '').trim();
    const result = await serviceStore.instanceCreate({ templateId, name, description, docPageAlias: isBuiltIn ? docPageAliasMain : undefined });
    if (result.code === 0) onDone();
  };

  if (templateListReady.length === 0) {
    return <div className="doc-service-settings-muted">The backend has no service template that can be used; an instance is always created from one.</div>;
  }
  const groupList = [
    { kind: 'app', title: 'App templates', note: 'an app service: serves documents and dashboards' },
    { kind: 'infra', title: 'Infra templates', note: 'an infra service: serves other services under an infra name' },
  ];
  // the template to copy, chosen among the cards of the ready ones (asked
  // from a template, it is that one)
  const templatePicker = isTemplateFixed ? null : (
    <div className="doc-service-overview" data-flat="">
      {groupList.map((group) => {
        const list = serviceStore.templateListOfKind(group.kind).filter((item) => item.status === 'ready');
        if (list.length === 0) return null;
        return (
          <div key={group.kind} className="doc-service-group">
            <div className="doc-service-settings-subtitle" title={group.note}>{group.title}</div>
            <div className="doc-service-card-list">
              {list.map((item) => (
                <TemplateCard
                  key={item.templateId}
                  template={item}
                  isPressed={item.templateId === templateId}
                  onSelect={() => { if (!isSubmitting) templateIdSet(item.templateId); }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
  return (
    <>
      {templatePicker}
      <div className="doc-service-detail">
        <div className="doc-service-settings-line">
          <span className="doc-service-detail-key">template</span>
          <span>{template?.name}</span>
          <KindBadge kind={template?.kind} />
          <span className="doc-service-settings-muted">{template?.expose?.meta?.label}{template?.origin ? ` · ${originText(template.origin)}` : ''} · version {template?.versionId}</span>
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
          the template's folder is copied into {template?.name}-inst-&#123;serviceId&#125; of the {template?.kind === 'infra' ? 'infra' : 'app'} instance folder
          {docPageAlias ? ` of the doc page ${docPageAlias}` : ' the backend defaults to'} (its script, its dashboards, its config), and the instance records the template it came from.
          {template?.expose?.dependencyList?.length ? ` It depends on ${template.expose.dependencyList.map((dependency) => dependency.name).join(', ')}; it waits while a required one is not available, and the kernel provisions one with an auto template.` : ''}
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
    </>
  );
});

// ---------- logs ----------

// the records of the kernel log: filters (who wrote them, which feature,
// the lowest level, a text, how many), a table newest first, where they
// come from (the logging infra instance, or the kernel's own buffer while
// no logging instance answers)
const LogArea = observer(function LogArea() {
  const { serviceStore } = useDocStores();
  const log = serviceStore.settings.log;
  const [query, querySet] = useState(() => ({ ...log.query }));
  const [logIdOpen, logIdOpenSet] = useState('');
  const isLoading = log.status === 'loading';

  useEffect(() => {
    if (log.status === 'idle') {
      void serviceStore.logFacetGet();
      void serviceStore.logQuery(query);
    }
    // once, when the area is first shown with the backend up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    void serviceStore.logFacetGet();
    void serviceStore.logQuery(query);
  };
  const queryChange = (change) => {
    const queryNext = { ...query, ...change };
    querySet(queryNext);
    void serviceStore.logQuery(queryNext);
  };
  const principalValue = query.principalKind ? `${query.principalKind}|${query.principalId ?? ''}` : '';
  const principalList = log.facet?.principalList ?? [];
  const featureList = log.facet?.featureList ?? [];
  const principalLabel = (principal) => {
    if (principal.kind === 'service') return `${serviceStore.instanceGet(principal.id)?.name ?? principal.id} (${principal.id})`;
    return principal.kind + (principal.id ? ` ${principal.id}` : '');
  };
  const principalShort = (principal) => {
    if (principal?.kind === 'service') return serviceStore.instanceGet(principal.id)?.name ?? principal.id;
    return `${principal?.kind ?? ''}${principal?.id ? ` ${principal.id}` : ''}`;
  };

  return (
    <div className="doc-service-area">
      <div className="doc-service-settings-title">
        Logs
        <button type="button" className="doc-service-icon-button" title="ask for the records again" disabled={isLoading} onClick={refresh}>
          {isLoading ? <LoaderCircle size={12} aria-hidden="true" className="doc-spin" /> : <RotateCw size={12} aria-hidden="true" />}
        </button>
      </div>
      <div className="doc-service-log-filter">
        <label>
          principal
          <select
            className="doc-service-select"
            value={principalValue}
            aria-label="principal"
            onChange={(event) => {
              const [principalKind = '', principalId = ''] = event.target.value.split('|');
              queryChange({ principalKind, principalId });
            }}
          >
            <option value="">any</option>
            {principalList.map((principal) => (
              <option key={`${principal.kind}|${principal.id}`} value={`${principal.kind}|${principal.id}`}>{principalLabel(principal)} · {principal.count}</option>
            ))}
            {principalValue && !principalList.some((principal) => `${principal.kind}|${principal.id}` === principalValue) ? <option value={principalValue}>{principalValue.replace('|', ' ')}</option> : null}
          </select>
        </label>
        <label>
          feature
          <select className="doc-service-select" value={query.feature ?? ''} aria-label="feature" onChange={(event) => queryChange({ feature: event.target.value })}>
            <option value="">any</option>
            {featureList.map((item) => <option key={item.feature} value={item.feature}>{item.feature} · {item.count}</option>)}
            {query.feature && !featureList.some((item) => item.feature === query.feature) ? <option value={query.feature}>{query.feature}</option> : null}
          </select>
        </label>
        <label>
          level
          <select className="doc-service-select" value={query.level ?? ''} aria-label="lowest level" onChange={(event) => queryChange({ level: event.target.value })}>
            <option value="">any</option>
            {serviceLogLevelList.map((level) => <option key={level} value={level}>{level} and above</option>)}
          </select>
        </label>
        <label>
          text
          <input
            className="doc-service-log-text"
            value={query.text ?? ''}
            placeholder="in the message or data"
            aria-label="text"
            onChange={(event) => querySet({ ...query, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void serviceStore.logQuery(query);
            }}
            onBlur={() => {
              if ((query.text ?? '') !== (log.query.text ?? '')) void serviceStore.logQuery(query);
            }}
          />
        </label>
        <label>
          limit
          <input
            className="doc-service-log-text doc-service-log-limit"
            type="number"
            min={1}
            max={1000}
            value={query.limit ?? 100}
            aria-label="limit"
            onChange={(event) => querySet({ ...query, limit: Number(event.target.value) || 100 })}
            onBlur={() => {
              if ((query.limit ?? 100) !== (log.query.limit ?? 100)) void serviceStore.logQuery(query);
            }}
          />
        </label>
      </div>
      <div className="doc-service-settings-muted">
        {log.source === 'logging' ? `from the logging infra instance${serviceStore.kernel?.loggingServiceId ? ` (${serviceStore.instanceGet(serviceStore.kernel.loggingServiceId)?.name ?? serviceStore.kernel.loggingServiceId})` : ''}` : ''}
        {log.source === 'kernel' ? 'from the kernel\'s own buffer: no logging infra instance answers (the records since the backend started, filtered here)' : ''}
        {log.source === '' && log.status !== 'error' ? 'asking for the records…' : ''}
        {log.status === 'done' ? ` · ${log.recordList.length} of ${log.total} shown, newest first` : ''}
        {log.status === 'error' ? <span className="doc-service-error" role="alert">{log.message}</span> : null}
      </div>
      <div className="doc-service-table-scroll doc-service-log-body">
        <div className="doc-service-table" style={{ '--doc-service-table-columns': 'max-content max-content max-content max-content minmax(14rem, 2fr) minmax(4rem, 1fr)' }} role="table" aria-busy={isLoading}>
          <div className="doc-service-table-row is-head" role="row">
            <span role="columnheader">time</span>
            <span role="columnheader">level</span>
            <span role="columnheader">principal</span>
            <span role="columnheader">feature</span>
            <span role="columnheader">message</span>
            <span role="columnheader">data</span>
          </div>
          {log.recordList.map((record, index) => {
            const key = String(record.logId ?? `${record.time}:${index}`);
            const dataText = record.data && Object.keys(record.data).length > 0 ? JSON.stringify(record.data) : '';
            const isOpen = logIdOpen === key;
            return (
              <div key={key} className="doc-service-table-row" role="row">
                <span role="cell" className="doc-service-table-cell-nowrap doc-service-table-cell-code" title={record.time}>{timeShortText(record.time)}</span>
                <span role="cell" className="doc-service-table-cell-nowrap doc-service-log-level" data-level={record.level}>{record.level}</span>
                <span role="cell" className="doc-service-table-cell-nowrap" title={`${record.principal?.kind ?? ''} ${record.principal?.id ?? ''}`.trim()}>{principalShort(record.principal)}</span>
                <span role="cell" className="doc-service-table-cell-nowrap">{record.feature}</span>
                <span role="cell" className="doc-service-table-cell-text">{record.message}</span>
                <span role="cell">
                  {dataText ? (
                    <button
                      type="button"
                      className={isOpen ? 'doc-service-table-cell-text doc-service-link' : 'doc-service-log-data'}
                      style={isOpen ? { margin: 0, padding: 0, textAlign: 'left', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '0.66rem' } : undefined}
                      title={isOpen ? 'fold the data' : `${dataText}\n(click to unfold)`}
                      onClick={() => logIdOpenSet(isOpen ? '' : key)}
                    >
                      {isOpen ? JSON.stringify(record.data, null, 1) : dataText}
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
        {log.status === 'done' && log.recordList.length === 0 ? <div className="doc-service-table-empty">no record matches.</div> : null}
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
