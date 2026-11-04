<!-- Design of the service layer, the page side: reaching the backend, the Vite plugin, DocServiceStore, dashboards in the registry, the dashboard frame and module, the Services tab, the example. Parent document: doc_page_impl_service.md. -->

# Services: Dashboards and the Services Tab

How the page reaches the backend ([Services: The Backend](doc_page_impl_service_backend.md)) and shows its instances: through `DocServiceStore`, the dashboards a document places, and the Services tab of the settings panel.

## Reaching the backend

What the backend offers the page is of two sorts: **dashboards**, components of the registry whose module each instance serves, and **apis**, which an instance answers. The page reaches both by one path, and only one value along it depends on where things run, **the address of the backend** (`config.service.endpoint`). A dashboard, a component or a panel of the page never knows that address, nor whether the page is served by the development server or is a built site, nor whether the backend runs on this machine or elsewhere:

```text
a dashboard / a component      onEvent('serviceApiCallRequest' | 'serviceJobGetRequest' | 'serviceResolveRequest', …)
the Services tab               the store's methods
        ▼  the service route of the event layer
DocServiceStore                the registry, the dashboard modules, every call; the only owner of the client
        ▼
lib/doc-service-api.js         the only code that sends a request to the backend: {endpoint}/registry, /api/call,
                               /job/get, /instance/dashboard/{serviceId}/{entry}, the icons; every answer { code, data, message }
        ▲  endpoint
DocEnvStore.endpointGet('service')   ← config.service.endpoint of DocPageMdx, which the host passes
```

The dashboard's module comes the same way: the store asks the client for the url of an instance's remote entry and imports it ([Dashboard module](#dashboard-module)), so a dashboard placed in a document is found under the same address as the calls it makes. Nothing else of the page builds a url of the backend, and nothing reads `docServiceEndpoint` but the host that passes it.

The address is a url prefix like any other, relative or absolute, and the client sends plain http requests to it. Where the page and the backend run only changes which prefix the host passes:

| the page | the backend | the address | who answers it |
| --- | --- | --- | --- |
| the development server | on this machine, launched by it or by hand | `{base}/__doc-service` (the virtual module's `docServiceEndpoint`) | the development server forwards it ([The Vite plugin](#the-vite-plugin)) |
| a built site | none | `''` | nobody: `backendStatus: 'none'`, every dashboard says so |
| a built site, or the development server | deployed on a server (**not yet supported**) | its url, passed by the host | the backend, behind a proxy of the site's origin or answering cross-origin itself |

The environment offers `service` whatever the kind of the page ([The environment](doc_page_impl.md#the-environment)): unlike editing or the asset api, the service backend is not the server of the page but a process of its own, so a build reaches it once it is given an address; a build without one has none. Whether the backend answers is the store's `backendStatus`, the same in every case.

A deployed backend needs nothing of the page beyond its address. What it needs of itself is left for later ([TODO](doc_page_impl_TODO.md#service-deployed-backend)): being reachable from the page's origin (the backend sends no CORS headers on purpose today, so a reverse proxy on the site's origin is the simple way, and the addresses stay relative), the doc pages it serves listed in its own config (the `registry/docpage/sync` body is filled by the development server; to a backend reached directly it is empty and mounts nothing more), and authorization of the callers ([Authorization](doc_page_impl_service_kernel.md#authorization)), which a backend on localhost does without.

## The Vite plugin

The page reaches the backend through the development server, never directly. `plugin/doc-service-server.ts` reads the `service` section of `config.yaml` and adds one middleware that forwards `{base}/__doc-service/*` to the backend unchanged (method, body, status, headers); when the backend cannot be reached it answers `{ code: -5, message }` with http 503, the one code the page reads as "backend down". One route is the plugin's own: `POST {base}/__doc-service/registry/docpage/sync`, whose body it builds from the doc pages it loaded (every root and included doc page, its folder and its service file) before forwarding ([Where templates and instances come from](doc_page_impl_service.md#where-templates-and-instances-come-from)).

```yaml
# config.yaml
service:
  backendConfigFile: ../example_doc/.doc-page/service-backend.yaml # the backend's config: its address and folders
  launch: true                    # optional: the development server starts the backend
  # python: python3               # optional: the interpreter of the launch
  # backend: http://host:port     # optional: another address over the file's (alone: a backend without a known config)
```

**The address is written once**, as `host` and `port` of the backend config ([Backend config](doc_page_impl_service_backend.md#backend-config)): the backend listens there and the plugin forwards there (`http://{host}:{port}`, the loopback for `0.0.0.0`; the backend's defaults `127.0.0.1:45190` when the file has none). `service.backend` overrides it for a backend that does not run with that file; a section needs one of the two. With `launch` (which needs `backendConfigFile`), the development server runs `{python} main/service-backend/server.py --config {backendConfigFile}` as it starts, unless something answers at the address already (a backend started by hand is used as it is). Its output goes to the server's terminal; Ctrl+C reaches it with the server, and the server's exit stops it otherwise; a restart of the server (a change of the vite config) keeps it. A launch that fails (no interpreter, the port taken) is a warning, and the page says "backend down".

The service folders of every loaded doc page (the convention ones, or those of its `.doc-page/service.yaml`) are not documents: the source scan skips them like `.doc-page/`, the asset folders and the component folders, and a change in them (a sqlite journal, a dashboard build) never reloads the page or regenerates the manifest ([Doc page source service layer](doc_page_impl_source.md)). `backendConfigFile` is read for the same reason, for the plain folders the backend config lists outside doc pages. The virtual module exports `docServiceEndpoint`, the url of the forwarded api during `vite`, and the empty string in a build or without a `service` section; the host passes it as `config.service.endpoint` of `DocPageMdx` ([Consumer setup](doc_page_impl_detail.md#consumer-setup)), the one address the page reaches the backend by ([Reaching the backend](#reaching-the-backend)). Without an endpoint `DocServiceStore` has no backend (`backendStatus: 'none'`), and every dashboard says so.

## DocServiceStore

`DocServiceStore` (`store/DocServiceStore.ts`) knows what the backend's registry last said, creates instances from templates, works the instances from the Services tab (their dependencies, enabling, deletion, the route of an infra name, the logs), loads the dashboard modules of the instances, tells a dashboard what keeps it from showing, and answers the dashboards' events.

- `backendStatus`: `none` (no endpoint: no `service` section, or a build given no address), `loading` (the first answer is awaited), `up`, `down` (the development server answered -5); `backendMessage` says why, `backendInfo` is the backend's `/status`, `kernel` its `status.kernel` (the doc pages mounted with their service folders, the reconcile tick and count, `problemList`, the state of the kernel log: `bufferCount`, `flushedCount`, `droppedCount`, `flushError`, `loggingServiceId`, `loggingStatus`).
- `templateList`, `instanceList`, `infraList`: the last registry, read in **one call** (`GET /registry`) by `refresh()`: the templates (listed, never run; each with `kind`, `origin`, `provision`, `infraName`), the instances (each with `kind`, `origin`, `provision`, `dependencyList`, `dependencyStatusList`, `health`, `executionMode`, `hookRecordList`, …) and the routing table of the kernel, one entry per infra name required, provided or templated (`{ name, serviceId, status: available | unavailable | notProvided, isRouteExplicit, providerList, consumerList, templateList, storage }`). `templateGet`, `templateGetByName`, `instanceGet`, `infraGet(name)`, `templateListOfKind(kind)`, `instanceListOfKind(kind)` (`app` | `infra`), `instanceListOfTemplate(templateId)` (the instances created from a template, by the id they recorded), `instanceListOfTemplateName(name)` (the instances a dashboard of that template name may show, by the name they recorded). `refresh()` runs at start, then again every 15 s while the backend is up (so a backend stopped, or an instance stopping or turning `waiting`, is seen without a call failing first) and every 5 s while it is down (so the dashboards come back by themselves when it is started). A call answered -5 marks the backend down at once; a call answered -3, -4 or -7, or any answer while it was down, asks for the registry again.
- **The doc pages synced into the kernel**: whenever the backend turns `up` (the first answer, or up again after `down`) the store posts `registry/docpage/sync` with an empty body (`docPageSync()`); the development server fills it with the doc pages the page loaded, so the kernel reads their service folders too (temporary mounts included). Any failure is kept quiet and the sync is tried again at the next turn-up. When the store is given the source store (`options.sourceStore`, the part it reads: `docPageAliasMain`, `docPageList`), a change of the workspace's doc page list syncs again at once (a mobx reaction); a sync whose answer lists other doc pages than the kernel knew makes the registry be asked again, for the templates they hold.
- The writes of the Services tab, each with its pending state (`{ status: idle | submitting | error, message }`) in `settings` and the registry asked again after success: `instanceCreate({ templateId, name, description?, config?, docPageAlias? })` (`settings.create`; the instance goes to the instance folder of its kind of the doc page named, else of the template's own doc page, else the backend's default; for a **built-in** template, shipped by the package and of no doc page, the store passes the page's main doc page `docPageAliasMain` unless told otherwise, so the instance is created in the current doc page's folder; the new instance's card is chosen), `templateVersionNew(templateId, note)` (`settings.versionNew`), `instanceDependencySet(serviceId, dependencyList, isDependencyDynamicAllowed?)` (`settings.dependencySet`; `dependencyList` items are a name or `{ name, isRequired?, onUnavailable?: report | reject }`; the backend restarts the instance), `instanceEnableSet(serviceId, isEnabled)` (`settings.enableSet`), `instanceDelete(serviceId)` (`settings.delete`; the backend stops the instance, runs its `onDestroy` hook and renames its folder `.deleted-{dirName}-{time}`, keeping its data; the chosen card is cleared when it was this one), `infraRouteSet(name, serviceId | '')` (`settings.routeSet`; `''` goes back to the default route, the oldest ready provider).
- **Logs**: `logQuery(query)` and `logFacetGet()` call the `logging` infra service with the target `{ infra: 'logging' }` (`api/call`, apis `logQuery` / `logFacetGet`); when that answers **-7** (no instance provides `logging`, or it is not ready) they fall back to the kernel's own buffer (`GET /log/recent`), filtered and faceted in the store. `query` is `{ principalKind?, principalId?, feature?, level? (the lowest), text?, timeFrom?, timeTo?, limit = 50, offset? }`. The last result is `settings.log`: `{ status: idle | loading | done | error, source: logging | kernel, recordList (newest first), total, facet: { principalList, featureList, levelList }, query, message }`; only the answer of the last query sent is kept. `serviceLogLevelList` is `debug, info, warn, error`.
- `moduleByServiceId`: the dashboard module of each instance, `{ status: loading | done | error, module, message, entryUrl }`, loaded once per build ([Dashboard module](#dashboard-module)); an infra instance without dashboards (`dashboardRemote` null) has none.
- `settings`: the Services tab: the template chosen and the instance chosen (one per area; choosing an instance clears the pending states of the instance writes), the pending states above, the last log query, the state of the config dashboards shown there (in memory: the tab is no document).
- `objectTypeList`, `objectProviderList`: the types and the object providers of the backend's object registry, read with the registry; `objectCall`, `backendUrlGet`, `moduleExportGet` are what the backend peer provider of the page's object registry (`lib/doc-object-provider-backend.js`) reaches the backend and the modules through; the registry itself reads nothing of this store ([The page and the backend](doc_page_impl_obj.md#the-page-and-the-backend)).
- `dashboardInsertList`: every dashboard of every template that can be used, then those of instances whose template name no template has any more, for the insert menu ([Creating a dashboard](#creating-a-dashboard)).
- `ServiceTarget`, what a call names, is `{ serviceId }`, `{ templateId, versionId? }` or **`{ infra: name }`** (the current instance providing an infra name); a dashboard may use any of them as `data.target` of `serviceApiCallRequest` / `serviceResolveRequest` unchanged ([Calls between services](doc_page_impl_service_kernel.md#calls-between-services)).

A dashboard names what it shows by `{ templateName, dashboardId, serviceId }`: the template and the dashboard by its component id, the instance by its data. `dashboardProblemGet(ref)` says why it cannot show, `null` when it can, checking in the order a reader can fix it:

| kind | when |
| --- | --- |
| `backendNone` | the page has no backend (no `service` section, or a build given no address) |
| `loading` | the first answer of the backend is awaited, or the module is loading |
| `backendDown` | the backend cannot be reached |
| `templateNotFound` | bound to no instance, and no template has this name nor any instance recorded it: nothing to choose |
| `serviceNotBound` | the dashboard is bound to no instance yet: choose one |
| `serviceNotFound` | no instance folder has this id |
| `templateMismatch` | the instance was created from a template of another name |
| `serviceNotReady` | the instance is `starting`, `waiting` (a required infra service is not available yet; the kernel starts it when it is), `disabled`, or in `error` (its message: its config, its script, its `start()`, the dependency it waits for) |
| `dashboardNotFound` | the instance's script has no dashboard of this id (the ids it has are listed) |
| `moduleNotBuilt` | the instance's dashboard module is not built (what to build is named) |
| `moduleError` | the module failed to load, has no such export, or the dashboard threw while rendering |

Everything after the instance is read from the instance, not from its template: a dashboard shows what the instance's own copy declares and serves. The answer codes a dashboard's call may get are listed in `lib/doc-service-api.js` (0, -1 … -6, and **-7**: an infra service the call depends on is unavailable: nobody provides the name, its instance is not ready, or a required dependency of the called instance is unavailable and its `onUnavailable` is `reject`); the frame's status badge knows `waiting` beside `ready`, `starting`, `disabled`, `error`.

## Dashboards in the registry

A dashboard is a component of the [registry](doc_page_impl_mdx_comp.md), so a document places it like any other component block, and its component id names it: **`service/{templateName}/{dashboardId}`**, the template the instances it may show were created from, and their dashboard. The id is also its tag name in a document, so no `compRegistry` entry is needed and a new template needs no change of the page:

````md
<!--renderComp=service/todo-list/default-->
```asset
store: local
objectId: w55iq8kq3x2
```
````

The template name is matched against the `template.name` every instance recorded when it was created, not against the template folders: the dashboard itself is the instance's own, so a block keeps showing its instance when the template is renamed, gets a new version, or is removed. The template is only consulted for what an unbound dashboard shows in its head (its label and icon) and for whether there is anything to choose. The registry finds a component by its id in `compById`, and falls back to the dashboards: every lookup of a definition by id goes through one function, `compDefinitionGet(compById, compId)` (`registry/comp-definition.js`), which returns the registered definition or, for an id of the form above, the dashboard's definition (`serviceDashboardDefinitionGet`, cached per id). The definition is built from the id alone and is the same for every template: it exists while the backend is down or the template is unknown, so the block still renders its frame and says what is missing; what the instance declares (its label, its dashboards, its module) comes from the backend at render time through the store. It is `compDefine(ServiceDashboardHost, …)` with:

- `componentType: 'serviceDashboard'` and `meta.isServiceDashboard` (with `serviceTemplateName`, `serviceDashboardId`): what tells a dashboard from other components.
- `placementList: ['commentBlock', 'serviceSettings']`: a block of a document, or the Services tab.
- `isAssetAware`, `meta.isAssetOnly`, `meta.assetSaveMode: 'inPlace'`: its data is an asset object ([Dashboard state](#dashboard-state)), the way ExcelUniver's is ([Asset-only and not-in-doc](doc_page_impl_mdx_comp.md#asset-only-and-not-in-doc)).
- `meta.isEditSourceAccepted: false`, `meta.isEditEnterButtonOnly: true`, no edit modes: a dashboard changes its own data while it is read, so there is nothing to edit in an edit session, and a click on it in edit mode works the dashboard instead of opening the block ([Asset-only components](doc_page_impl_edit.md#asset-only-components)).
- `sourceDefaultCreate`: a new dashboard's data, bound to no instance.

### Dashboard state

The data of a dashboard block is the instance it shows and the dashboard's own state, yaml in an asset object (`service-dashboard-data.js`):

```yaml
serviceId: w55iq7goisz     # the instance; '' for a dashboard bound to none
state:                     # the dashboard's own state, any mapping: what it shows, not what the instance keeps
  filter: open
```

A dashboard keeps its local state there and nowhere else (a search, a chosen tab, a sort order), so the document opens it as it was left; the instance keeps its own state in its own folder or in its infra services. The object is written **in place** (`DocAssetStore.objectUpdate(store, objectId, { text }, 'inPlace', 'dashboard state')`): the state is the dashboard's present, not a history of versions. The writes of one object go one after another (each needs the hash of the head the previous one made). The state cannot be written, and the dashboard is told why (`config.state.unavailableReason`), when the block has no asset object (inline data), reads a pinned version instead of the head, the object is locked, or the store is not writable (a build). The data is never written inline in a document: a dashboard's state changes while it is read, and a document must not change while it is read.

## The dashboard frame

`ServiceDashboardHost` (`comp-doc/service/`) is the frame of every dashboard. The frame, not the dashboard, owns what every dashboard needs the same way:

```text
[icon] Todo list · Todos   [example todos ▾]  ● ready ↻
┌──────────────────────────────────────────────────┐
│ the dashboard, or why it cannot show              │   min-height: the dashboard's heightMin
└──────────────────────────────────────────────────┘
```

- **The choice of the instance, always shown**: every instance created from the template, plus the bound one marked `(not found)` when it is gone, so a dashboard is never stuck on an instance it cannot leave. Choosing reports `serviceBindRequest`; the select is disabled with the reason when the state cannot be written.
- The labels and the icon of the instance's own script, or of the template while no instance is bound.
- The state of the backend and of the instance (`ready`, `waiting`, `starting`, `backend down`, `not found`, …, with the message as its tooltip) and the refresh button beside it, which asks the backend again.
- What keeps the dashboard from showing (`dashboardProblemGet`), in place of the dashboard, with the head still usable, so the reader can fix it from there.
- The room the dashboard needs (`heightMin`), so the page does not jump while the module loads.

**A dashboard that has shown stays while the backend goes down**: its calls answer -5 and the head says `backend down`, so the reader keeps what is on screen. **A dashboard is mounted again when it is bound to another instance** (keyed by the service id), so a dashboard reads its instance once and never has to notice a change of instance. A dashboard that throws while rendering is caught by an error boundary and shown as `moduleError`: one block failing, not the page.

### Dashboard props

The dashboard receives the common props of a component, `{ data, config, onEvent }`:

```text
data                { state }                     the dashboard's own state (Dashboard state)
config.placement    'commentBlock' | 'serviceSettings'
config.service      { templateName, dashboardId, serviceId,
                      instance,                   the instance as listed: { name, status, health, dependencyStatusList,
                                                  template, config, expose, … }
                      template,                   the template of that name as listed, when there is one (information
                                                  only: the instance does not depend on it)
                      backendStatus }             'up' | 'down' (shown dashboards stay while it is down)
config.state        { isWritable,                 whether dashboardStateSetRequest can be written
                      unavailableReason }         why not ('' when it can)
onEvent(type, data) the events below; every one is answered with a promise of { code, data, message }
```

### Dashboard events

The frame wraps the dashboard's `onEvent`: every report carries `data.dashboard = { templateName, dashboardId, serviceId, state }`, what the block shows now. The events go through the [event layer](doc_page_impl_event.md) to the `service` route (`DocServiceStore.eventHandle`); a place that keeps the state elsewhere (the Services tab) answers the bind and the state first, as its local handler.

| event | data | answer |
| --- | --- | --- |
| `serviceApiCallRequest` | `{ api, params, target? }` | a sync api: the call's own result, `{ code: 0, data }` or its failure; an async api: `{ code: 0, data: job }`. without `target`, the dashboard's own instance ([From a dashboard](doc_page_impl_service_kernel.md#from-a-dashboard)) |
| `serviceJobGetRequest` | `{ jobId, serviceId? }` | `{ code: 0, data: job }` (status, progress, the result once done); `serviceId` names the instance of a job that is not the dashboard's own (`job.serviceId`) |
| `serviceResolveRequest` | `{ target }` | `{ code: 0, data: instance }`: the instance a call of the target goes to, as listed |
| `dashboardStateSetRequest` | `{ state }` | the state written into the block's asset object, the instance kept |
| `serviceBindRequest` | `{ serviceId }` | the block bound to the instance (reported by the frame), the state kept |
| `serviceRefreshRequest` | | the backend asked again |

### Calling the apis

**A dashboard calls the apis of its own instance unless it names another**: a call without a target goes to `data.dashboard.serviceId`, which the frame adds, so a dashboard never names its own instance, and it never knows the url of the backend; a call with a target goes to the instance it names ([From a dashboard](doc_page_impl_service_kernel.md#from-a-dashboard)). The example's helpers (`note-db/dashboard/src/service-call.js`, copied by `todo-list`) show the whole contract in a few functions:

```js
const result = await onEvent('serviceApiCallRequest', { api: 'todoList', params: { query } });
if (result.code !== 0) { /* -1 failed, -3 no such api, -4 not ready, -5 backend down, -6 timeout, -7 an infra unavailable */ }

// an async api: the job, then the job asked for until it is done (serviceJobRun)
const started = await onEvent('serviceApiCallRequest', { api: 'reindex', params: {} });
const job = await onEvent('serviceJobGetRequest', { jobId: started.data.jobId, serviceId: started.data.serviceId });   // every 300 ms
// job.data.status === 'done' -> job.data.result is the call's own { code, data, message }

await onEvent('dashboardStateSetRequest', { state: { ...data.state, query } });
```

### Dashboard conventions

- **The frame owns the instance.** A dashboard never offers a choice of its own instance or reads one from its state; it shows the one in `config.service.serviceId`, and is mounted anew for another. The other instances it uses are named by targets, by template or by infra name unless the reader must choose one.
- **Every call can fail.** A dashboard shows the message of a failed call where the call was asked for, keeps what it showed, and does not retry by itself; -5 needs no message of its own, the head already says it; -7 says which infra service is missing.
- **Local state goes into `dashboardStateSetRequest`**, and only what should be there when the document is opened again; what the instance keeps is asked from the instance. A dashboard that cannot write (`config.state.isWritable` false) still works, without remembering.
- **The ui follows the page's rules**: compact, contenteditable for text that switches to edit mode, confirmations in place (no browser dialogs), no layout jump while loading (`heightMin`).
- **Styles are prefixed with the template's name** (`todo-list-…`) and use class selectors only: the module's stylesheet joins the page's. Every instance adds its own stylesheet, keyed by the folder its module is served from, since copies may differ.
- **One react**: a dashboard uses the page's react ([Dashboard module](#dashboard-module)) and bundles everything else it uses.

## Dashboard module

The dashboards of a script are one federated module (module federation, after `react-lazy-load`), built by `@originjs/vite-plugin-federation` in the `dashboard/` folder. **Every instance has its own**: its `dashboard/` is a copy of the template's, served by the backend from the instance's `dashboardRemote.dir`, and loaded by the page per instance (`moduleByServiceId`), so two instances of one template run two modules, which differ once one copy is changed and rebuilt. The template's `dashboard/` is the source the copies come from; the page never loads it. The page is the host but is not built with the federation plugin; it speaks the container contract itself (`lib/doc-service-federation.js`):

```text
const container = await import(`${endpoint}/instance/dashboard/${serviceId}/${entry}?t=${timeBuilt}`)
await container.init(shareScope)          // react, react-dom: the page's own, { [version]: { get, loaded, from: 'host' } }
const factory = await container.get(module)
const module = factory()                  // { TodoListDashboard, TodoListConfigDashboard }: dashboardList[].export
```

The url carries the build time of the entry, so a dashboard rebuilt while the page is open is a new url and is loaded anew at the next listing; a container is loaded once per url, and a failed load is not kept, so the next attempt loads again. **The page shares `react` and `react-dom`**, and a remote declares them shared with `singleton` and a loose `requiredVersion` (`^19.0.0`), so a dashboard renders with the page's react: hooks, context, and events work across the two. The build of a remote follows from how the page loads it (`note-db/dashboard/vite.config.js`):

- `base: './'` and `build.assetsDir: ''`: every file at the top of `dist/` beside `remoteEntry.js`, because the plugin writes the chunk paths relative to the build root and the backend serves the build under a path the page decides.
- An `index.html` entry: the plugin needs one, even though nothing loads it.
- `build.target: 'esnext'` (top-level await, `import.meta`).
- **The module adds its own stylesheet**: the dashboard module imports its css as text (`?inline`) and adds a `<style>` element once. The plugin's own stylesheet loading joins the stylesheet url wrongly for a page whose host has no dot in its name (`localhost`), so a remote emits no css file of its own.

The build is not part of the repository (`dist/` is ignored); an instance whose module is not built shows `moduleNotBuilt` with what to build (its own `dashboard/`). Building the template's copy first means every instance created afterwards starts with a built one.

## The Services tab

The settings panel has a tab **Services** (`comp-doc/settings/ServiceSettings.jsx`). It shows **one view at a time, under a path**: the path bar on top (the `PathBar` of `@wwf971/react-comp-misc`, which the host injects as `config.components.PathBar` beside `ConfigPanel`; without it the segments are plain links), with the refresh of the registry beside it. The overview holds only cards; a card opens the view of what it shows, under the overview; the first segment of the path, `overview`, goes back. A link to a template or an instance anywhere in a view (an instance's template, a template's instances, a consumer in the routing table, an instance chosen in a config dashboard's frame) opens that one's view. The view is kept in memory (`DocServiceStore.settings.view`, with `templateIdSelected` / `serviceIdSelected`): closing and opening the panel comes back to it; a view whose template or instance is gone says so, with the way back.

| path | view |
| --- | --- |
| `overview` | cards: **System** (Server status, Infra routes, Logs), **App templates**, **Infra templates**, **App instances** (with **+ New**), **Infra instances**; a line linking to the server status when the backend has problems |
| `overview/server-status` | the backend: the registry's counts, when it started, its config file, the kernel's tick, the logging infra service and the kernel's log buffer, the doc pages mounted, the problems of the scan and of the kernel |
| `overview/infra-routes` | the routing table of the kernel |
| `overview/logs` | the records of the kernel log |
| `overview/new-instance` | a new instance: the ready templates as cards (App templates, Infra templates), the one clicked chosen (outlined), then its name, description and **Create** |
| `overview/service-template-{templateId}` | one template: its head (icon, name, kind, origin), its detail, **New instance from …** |
| `overview/service-instance-{serviceId}` | one instance: its head (icon, name, kind, status), its detail, its config dashboard |

```text
[overview / service-instance-w55j3ztn3rq                                   ] ↻
  ✓ example todos  service instance  app  ● ready
  instance example todos w55j3ztn3rq [app] · created from todo-list (template …, version …) · the current
  version of the template · origin [page example] …/service-app/todo-list-inst-w55j3ztn3rq · status ● ready ·
  health ◎ healthy · execution passive · description · script
  Dependencies   infra name  status       routed to      required  when unavailable
                 sqlite      ● available  sqlite (auto)  [x]       [report ▾] ×
                 [an infra name…] [+ Add]  [ ] dynamic allowed  [Save] [Reset]
  Hooks · onCreate ran 10-29 05:41:58     hook  status  when  seconds  message   (the latest 10)
  Lifecycle      [Disable] [Delete]  → delete example todos? … its folder is kept as .deleted-… [Delete] [Cancel]
  apis · the config dashboard

[overview                                                                    ] ↻
  System            [Server status ● up] [Infra routes 6 names] [Logs logging ●]
  App templates     [note-db notes app built-in ● 2 instances] [todo-list productivity/task app page example ● 1]
  Infra templates   [logging infra built-in auto ● 1] [cognito-auth connection/auth …] [sqlite storage …] …
  App instances     [example notes app page example ● ◎ ready] [reading list …] [+ New]
  Infra instances   [logging (auto) infra auto ● ◎ ready] [sqlite (auto) infra auto ● ◎ ready]
```

- **Without a backend** the tab holds only a notice, in the middle of the tab both ways: an error box when the backend is down (the reason the plugin gave, how to start it, **Retry**), a plain remark when the page has none (no `service` section, or a build), a running status while the first answer is awaited. The views need a backend that is up.
- **Server status** (formerly the backend line): its status, the number of templates and instances, how many doc pages the kernel mounted (their alias, source `config` / `page`, default flag and folder as the tooltip, and in a small line below: alias, a `config` / `page` badge, `default`, the folder; the tooltip of each lists its service folders and whether they exist), the kernel's reconcile tick and count (the last reconcile time as tooltip), the state of the logging infra service (`loggingStatus`, with the buffer count when records wait in the kernel's buffer; the flush counts as tooltip), the refresh button; below, the kernel's `problemList` (prefixed `kernel:`), a log flush error, and the problems of the scan, each in the error color.
- **Service templates** (overview cards, a view each): two groups, **App templates** and **Infra templates**, one card per template (its icon, its name, a kind badge, an origin badge: `built-in` = shipped by the package, `page {alias}` = a doc page's service folder, `folder` = a plain folder of the backend config, the folder as tooltip; an infra template with `provision: auto` has an `auto` badge; its status and how many instances were created from it). Its detail: id and kind, **origin** (badge and folder path), current version id with the `+` that records a new one with a note (`templateVersionNew`; the error, if any, beside it), the versions it had, status and message, description, its script's meta; for an infra template **provides** (the infra name and the provision mode, explained) and **storage** (`expose.infra.storage`: type, versioning, operations, description); the declared **dependencies** (`expose.dependencyList`, with `optional` / `reject when unavailable`), **execution** mode (with the hook timeout), the **hooks** the script implements (`expose.hookList`), its part in the [object registry](doc_page_impl_obj.md#services) (the **types** it defines with their parents, the objects it **provides** with its capabilities, filters and cache time, the **components** of its module and what they draw, and what it **requires**, each with its status, `met`, `provided, but no ready instance serves it`, `only the fallback view draws it` or `nobody provides it`, and who meets it; a script without any says its only objects are the kernel's), the initial config, the apis, and the instances created from it (with the version each recorded when it is not the current one; a click shows the instance). **New instance from {name}** opens the creation in place (a name, a description; the template is fixed); it is disabled with the reason for a template in `error`.
- **Infra routes**: the routing table of the kernel, one row per `infraList` entry: the name (with its storage type as a badge, the storage described in the tooltip), its status (`available` / `unavailable` / `not provided`, the message as tooltip), the **current instance** (a link opening its view; an `auto` badge when the kernel provisioned it; an `explicit` badge when the route was made current from the tab), the providers count (the providers listed in the tooltip), the consumers (links to their cards, `?` after an optional one; `the kernel` for the kernel's own `logging`), and the templates that provide the name (links, with `(auto)` for `provision: auto`).
- **Service instances** (overview cards, a view each): groups **App instances** and **Infra instances** (the former System / Custom groups are gone: the page's own features are no services, and an infra instance provisioned by the kernel is marked `auto` instead), one card each (the instance's own icon, its name, its kind badge, an `auto` badge for a provisioned one or its origin badge otherwise, then its lifecycle status dot, its **health ring** — `healthy` green, `degraded` amber, `unhealthy` red, `healthMessage` as tooltip — and the status word, `waiting` included in the kernel's blue); a `+ New` card in the App group opens the creation with a choice of the template, app and infra templates in two option groups (the template chosen in the other area first). Its detail: id, kind, `auto · required by …` for a provisioned instance, **created from** (the template's name, a click showing it, the recorded id and version id, and how the template stands now: the same version, a newer one, renamed, or gone), **origin** (badge and folder path), status (with the message, and `disabled` when it is), **health** (ring, word, message; what the script reports when it differs), **execution** mode (`passive` / `resident`, whether the resident thread is running, the queue length and the api running), description, its own script's meta; for an infra instance **provides** (the name, its status and providers count), **storage**, **route** (whether it is the current instance of the name — `default` or `explicit` — or which one is, with **Make current** (`infraRouteSet(name, serviceId)`, only for a ready instance) or **Default route** (`infraRouteSet(name, '')`, when the route is explicit)) and **consumers** (links to the instances depending on the name, the kernel included). Then:
  - **Dependencies**: a table of the effective `dependencyList`, each with its status from `dependencyStatusList` (`available` / `unavailable` / `not provided`, the message as tooltip), the instance the name is routed to (a link opening its view), a `required` checkbox, a `when unavailable` select (`report` / `reject`) and a remove button, edited in place as a draft: a name is added from a text box with the infra names the registry knows (`infraList[].name`) as completion, or typed; `dynamic allowed` toggles `isDependencyDynamicAllowed`; **Save** (enabled while the draft differs, with the remark that saving restarts the instance) calls `instanceDependencySet`, **Reset** drops the draft; a name not saved yet shows `not saved`. The editor is mounted again when the backend's list changes, so a saved list shows as it is now.
  - **Hooks**: the `hookRecordList` as a compact table (hook, status, when, seconds, message), latest first, the latest 10 (the count of all beside the title), with `timeCreateHook` in the title.
  - **Lifecycle**: **Disable** / **Enable** (`instanceEnableSet`), and **Delete**, which asks in place (the instance is stopped, its `onDestroy` hook runs, its folder is kept as `.deleted-{dirName}-{time}`) before `instanceDelete`.
  - its **config object** (`serviceConfig:{serviceId}`, which the kernel provides for every instance), drawn by the view of configurations: a form of its script's config keys, saved through the object registry, the instance restarting with it ([The config of an instance](doc_page_impl_obj.md#services)); an infra instance without dashboards has it too.
  - the apis of its own script, its object rows, and its **config dashboard** (its script's dashboard of purpose `config`), rendered through `RegisteredComp` with placement `serviceSettings`. There the dashboard is bound by the card, not by an asset object: the tab's local handler answers `serviceBindRequest` by opening that instance, and keeps `dashboardStateSetRequest` in memory (`settings.stateByServiceId`). An infra instance without dashboards says so instead.
- **Logs**: the records of the kernel log, newest first: filters for the principal (from `logFacetGet`: `kernel`, each service by its instance name with its id, `page`; with counts), the feature (from the facets), the lowest level, a text (searched in the message and the data; sent on Enter or when the box is left), a limit; a line saying where the records come from (the logging infra instance by name, or the kernel's own buffer while no logging instance answers) and how many of the total are shown; a table (time, level, principal, feature, message, data — the data folded into one line with the whole JSON as tooltip, unfolded by a click); a refresh button in the title. The table keeps its room while a query runs, so the area does not jump; the facets and the first query are asked once when the tab is first shown with the backend up.

The creation says what will happen (the template folder copied into `{templateName}-inst-{serviceId}` of the instance folder of the template's kind, of which doc page, and the dependencies the instance will wait for when a required one is not available, which the kernel provisions from an `auto` template) and, once created, opens the new instance's view. When several doc pages are mounted, an instance of a doc page's template goes to that doc page, an instance of a built-in template to the page's main doc page; no choice is asked in the form.

Every card of the tab is one `ServiceCard` with the same five slots in the same order (icon, name, group, badges, status), each a row of the card list's grid (`grid-template-rows: subgrid`): a row of slots is as tall as its tallest slot among the cards of that row, and an empty slot keeps the row, so a name on two lines, a group path or a wrapped badge line moves every card of the row alike and the slots of neighbouring cards always line up. The tab's tables, badges and small texts use the shared classes (`doc-badge-outline`, `doc-button`, the muted texts) and the tab's own `doc-service-table` grid (`comp-doc/service/DocService.css`): a text column wraps, a table whose fixed columns do not fit the panel scrolls sideways rather than widening it.

## Creating a dashboard

In edit mode the insert menu has a row **Services**: every dashboard of every template with dashboards the backend knows (`DocServiceStore.dashboardInsertList`), under `service/{templateName}/{dashboardId}`, named `{script label} · {dashboard label}` with the dashboard's description, found through the search like the components. An entry is asset-only: choosing it creates the dashboard's data as an asset object, bound to no instance, and writes the reference block ([creating a block](doc_page_impl_edit.md#floating-controls), [asset-only components](doc_page_impl_edit.md#asset-only-components)); the reader then chooses the instance in the frame's head. Without a backend the row is absent: a dashboard of a template the page does not know cannot be offered, though one written by hand renders and says what is missing.

## Example and playground

The package ships its templates in `built-in/`: the app template `note-db` (`built-in/service-template-app/notes/w4wp4t0czko--note-db/`), notes in a sqlite database of each instance's folder (the older way: a service keeping its own state), with the dashboards `default` (list, search, add, edit in place, delete with an in-place confirmation; the search is the dashboard's state), `config` (the instance's config and the template it was created from, the database's numbers, a setting, and `reindex`, an async api slowed down to three seconds that shows the queue), and `stat`, which also shows the calls between services: it resolves another instance of the template, reads its numbers, and asks its own instance's `noteImport` to copy its notes, which calls the other instance as a service; and the infra templates (`built-in/service-template-infra/`): `logging` and `sqlite`, provisioned by the kernel, and the connections `aws-connection`, `google-drive`, `cognito-auth` and `postgres-connection`, which need accounts of their own, so the example has no instance of them.

The example doc page has a template of its own, `todo-list` (`example_doc/.doc-page/service-template-app/productivity/task/w55iiudjq5y--todo-list/`): a stateless app service on the sqlite infra service, backed up through the local-backup infra service, with the dashboards `default` (the todos) and `config` (its database in the infra: dependency status, versions, checkout; its backups: create, bring back, remove). Its instances and those of `note-db` are in `example_doc/.doc-page/service-app/` (two of `note-db`, one of `todo-list`, each with its own copy of the script and the dashboards; the ignore file of the folder keeps their files and ignores their databases, their builds, their records and every new instance); the kernel provisions `sqlite`, `local-backup` and `logging` into `example_doc/.doc-page/service-infra/`, ignored but for its `.gitignore`, and the backups go to `example_doc/.doc-page/service-backup/`, ignored as well. [Service Instances](../example_doc/service-instance.md) places four `note-db` dashboards: two bound to the instances, one bound to an instance no folder holds, one of a template the backend does not have; [App Services, Infra Services and the Kernel](../example_doc/service-kernel.md) places the two `todo-list` dashboards and the Backups dashboard of the local-backup instance, and walks through the kernel. Their asset objects are tracked, so using them changes them in place (`git restore example_doc/.doc-page/asset` undoes that).

[Playground](../example_doc/playground/playground.md) is a document for trying things out, services and assets alike; its folder is ignored by git with everything in it, so the committed repository shows it as missing until it is created.
