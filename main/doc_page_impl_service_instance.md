<!-- Design of service instances. Parent document: doc_page_impl.md. The edit layer's part (creating a dashboard block) is in doc_page_impl_edit.md. -->

# Service Instances: Design

An asset is data: a versioned object that a component reads, which the page can copy, bundle into a build, and resolve before the component renders ([Asset Store](doc_page_impl_asset.md)). A **service instance** is a running thing with its own state: a database, a crawler, a queue of jobs, anything that answers requests and keeps something between them. Its state is not the document's and cannot be bundled; the document only places **dashboards** that show and work an instance. The distinction decides everything below:

| | asset object | service instance |
| --- | --- | --- |
| what it is | data, with a history of versions | a process, with state only it can change |
| who reads it | the page resolves it before the component renders | the dashboard asks the instance, through its apis |
| who writes it | the page, through the asset api | the instance itself, when an api asks it to |
| in a build | bundled, read-only | absent: a build has no backend |
| in a document | a reference in place of the block's data | a dashboard block, whose own data (which instance, the dashboard's state) is an asset object |

A **service type** is the code every instance of a kind shares: a Python class with the apis, and a federated module with the dashboards. An **instance** is one folder with its config and its data, run by the **service backend**, a program of its own (`main/service-backend/server.py`) that the page reaches through the development server. The backend and the page work alone: the backend answers any http client without the page, and the page without the backend shows in every dashboard that the backend is down.

```text
browser                                    development server (vite)        service backend (python)
DocServiceStore                            plugin/doc-service-server.ts     server.py + service_runtime.py
  ├─ typeList, instanceList ── GET ──────► {base}/__doc-service/* ───────► /type/list, /instance/list (scan)
  ├─ moduleLoad(type) ── import() ───────►   forwarded unchanged ────────► /type/dashboard/{typeId}/remoteEntry.js
  │    federation container (shared react)   backend unreachable:            a type folder: service_type.py,
  ├─ eventHandle (route "service")           { code: -5 } (http 503)          dashboard/dist/
  │    serviceApiCallRequest ── POST ─────────────────────────────────────► /api/call ──► the instance's queue
  │    serviceJobGetRequest                                                 /job/get        one worker thread:
  │    serviceBindRequest ─┐                                                                one api at a time
  │    dashboardStateSetRequest ─► DocAssetStore.objectUpdate (in place)   an instance folder:
  └─ dashboardProblemGet: why a dashboard cannot show                        {serviceId}--{name}/service.yaml + data

document block <!--renderComp=service/note-db/default--> + ```asset```  (data: { serviceId, state })
  └─ ServiceDashboardHost (the frame: icon, title, instance select, status, refresh)
       └─ NoteDbDashboard (from the federated module) { data, config, onEvent }
```

## Backend

The backend is the Python standard library's `ThreadingHTTPServer` and PyYAML (`main/service-backend/requirements.txt`), nothing else: a type brings its own dependencies. It is started with its config file and stopped with Ctrl+C (SIGINT, SIGTERM), which lets every instance finish the api it runs and call `stop()`:

```text
python3 main/service-backend/server.py --config example_doc/service-backend.yaml [--port 45190] [--host 127.0.0.1]
```

`ServiceRuntime` (`service_runtime.py`) finds the types and the instances and runs the apis. **`scan()` is cheap and runs on every listing**: a type folder is loaded again when its `service_type.py` changed (by mtime, through `importlib`), an instance is restarted when its folder, its `service.yaml`, or its type changed (its signature), and a folder that is gone stops its instance. A folder added, removed, or edited by hand is therefore seen at the next listing, without restarting the backend.

**One request at a time per instance.** Every running instance has one worker thread and one queue. The thread creates the type's class with the instance's context, calls `start()`, then takes the calls in the order they came; a call waits behind the ones before it, whatever its kind. An implementation never sees two calls at once and may keep a connection (sqlite) as a plain attribute. A sync call is answered when its api is done, queue included, or after `apiWaitSecondMax` with code -6 (the call stays queued and still runs); an async call is answered at once with its job, which runs in the same queue. Stopping puts a sentinel in the queue: the call being run finishes, the ones still waiting are answered -4.

| instance status | meaning |
| --- | --- |
| `ready` | apis are answered |
| `starting` | `start()` is running; calls wait in the queue |
| `disabled` | `isEnabled: false` in `service.yaml`; calls are refused (-4) |
| `error` | the folder, `service.yaml`, the type, or `start()` failed; `message` says why; calls are refused (-4) |

### Backend config

```yaml
# example_doc/service-backend.yaml (paths relative to this file)
host: 127.0.0.1
port: 45190
apiWaitSecondMax: 120          # how long a sync call is waited for, queue included, before -6
typeFolderList:                # folders holding the types: {typeId}/service_type.py
  - path: ./service-type
instanceFolderList:            # folders holding the instances: {serviceId}--{name}/service.yaml
  - path: ./service
    isDefault: true            # where a new instance is created (the first folder when none says so)
```

A **type folder** is `{typeFolder}/{typeId}/` with `service_type.py`; the folder name is the type id (lowercase letters, digits, `-`, `_`), and the first folder of the list that has a type id wins. An **instance folder** is `{instanceFolder}/{serviceId}--{name}/`, named like an asset object's folder ([Names](doc_page_impl_asset.md#names)): the id is an ms48 id (base36 of the creation millisecond and 16 random bits), the name follows the rules of asset names (no `/`, no `--`, not empty), and the folder holds `service.yaml` and whatever data the instance keeps (`notes.sqlite`). A folder whose name has no `--`, or a second folder with the same id, is listed in the scan's problems (`GET /status`, `scanProblemList`) and skipped.

```yaml
# {serviceId}--{name}/service.yaml, written by the backend in this key order
serviceId: w4veemd7i36         # must be the id of the folder name
name: example notes            # must be the name of the folder name
typeId: note-db                # a type of the type folders
description: the notes of the example doc
isEnabled: true                # false: the instance is listed but not run
timeCreated: 20261024_04333559+09
config:                        # the instance's config, checked against the type's configDefineList;
  databaseFile: notes.sqlite   # a missing key gets its default, a key of the wrong type is an error,
  titleLengthMax: 120          # a key the type does not declare is kept
```

`service.yaml` is the instance's config, so an instance is reconfigured by editing it (the backend restarts the instance at the next listing); the backend writes it only when it creates the instance, atomically (a temporary file renamed over it). Renaming an instance is renaming its folder and the `name` in its file together; a mismatch puts the instance in `error` with the reason.

### Backend api

Every answer is `{ code, data?, message? }` with an http status that follows the code: 0 → 200, -1 → 400, -3 → 404, -4 → 409, -6 → 504. The development server adds -5 (503) when it cannot reach the backend ([The Vite plugin](#the-vite-plugin)).

| code | meaning |
| --- | --- |
| 0 | done |
| -1 | bad request, or the api failed (an exception: its type and message) |
| -3 | not found: the type, the instance, the api, the job |
| -4 | the instance is not ready (starting failed, disabled, stopped) |
| -5 | the backend cannot be reached (the development server's answer) |
| -6 | a sync call did not finish in `apiWaitSecondMax` |

```text
GET  /status                                  { timeStarted, configPath, typeFolderList, instanceFolderList,
                                                typeCount, instanceCount, scanProblemList }
GET  /type/list                               [{ typeId, status: ready | error, message, folder, expose,
                                                 dashboardBuild: { isBuilt, timeBuilt } }]   (scans)
GET  /type/openrpc?typeId=                    the apis of the type as an OpenRPC document
GET  /type/icon/{typeId}                      the file meta.icon names
GET  /type/dashboard/{typeId}/{path}          a file of the type's dashboardRemote.dir (no path outside it)
GET  /instance/list                           [{ serviceId, name, typeId, description, isEnabled, timeCreated,
                                                 config, status, message, folder, dirName,
                                                 queueLength, apiRunning }]                    (scans)
GET  /instance/get?serviceId=
POST /instance/create  { typeId, name, description?, config? }   the folder and service.yaml in the default
                                                instance folder; the answer is the new instance
POST /api/call         { serviceId, api, params }                sync: { code: 0, data: what the api returned }
                                                                 async: { code: 0, data: job }
GET  /job/get?serviceId=&jobId=               job: { jobId, api, status: queued | running | done, progress (0..1),
                                                progressMessage, timeQueued, timeStarted, timeDone,
                                                result: the call's own { code, data, message } once done }
```

An instance keeps its last 50 finished jobs. The backend sends no CORS headers on purpose: the page reaches it on its own origin through the development server, and a page of another origin has no business calling it.

## What a service type exposes

A type says what it exposes the way a component does through `compDefine(Xxx, { expose })` ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)): one declaration next to the code it describes, normalized and checked when the type is loaded (`expose_build` in `service_define.py`), so a wrong shape fails with the place of the mistake (`note-db: expose.dashboardList[1].export must name …`) instead of later in a dashboard. A type that fails to load is listed with `status: error` and its message, and its instances are in `error`.

```python
# {typeFolder}/note-db/service_type.py
from service_define import ServiceError, ServiceType, api, param, returns

class NoteDb(ServiceType):
    expose = {
        'meta': {'label': 'Note DB', 'description': '…', 'author': '…', 'version': '1.0.0',
                 'license': 'MIT', 'homepage': '', 'icon': 'icon.svg', 'tagList': ['sqlite']},
        'configDefineList': [
            {'key': 'databaseFile', 'type': 'string', 'default': 'notes.sqlite', 'description': '…'},
        ],
        'dashboardList': [
            {'id': 'default', 'purpose': 'default', 'label': 'Notes', 'export': 'NoteDbDashboard', 'heightMin': '14rem'},
            {'id': 'config', 'purpose': 'config', 'label': 'Settings', 'export': 'NoteDbConfigDashboard'},
            {'id': 'stat', 'purpose': 'other', 'label': 'Statistics', 'export': 'NoteDbStatDashboard'},
        ],
        'dashboardRemote': {'dir': 'dashboard/dist', 'entry': 'remoteEntry.js',
                            'container': 'serviceNoteDb', 'module': './dashboard'},
        'sqliteTableList': ['note', 'setting'],      # anything else: kept as written
    }

    def start(self): …                              # open the data (self.context.path_get(name)), create it when new
    def stop(self): …

    @api(kind='query', description='the notes, newest first',
         params=[param('limit', 'integer', 'how many at most', default=50)],
         result=returns('object', '{ noteList, total }', schema={…}))
    def noteList(self, limit=50): …

SERVICE_TYPE = NoteDb
```

- **`meta`**: `label` is required; `description`, `author`, `version` (default `0.0.0`), `license`, `homepage`, `icon` (a file of the type folder, served at `/type/icon/{typeId}`), and `tagList` are optional. Other keys are kept.
- **`configDefineList`**: the shape of an instance's `config`, `[{ key, type: string | integer | number | boolean, default, description }]`. The backend fills the defaults and checks the types of every instance's config.
- **apis**: the methods marked `@api(kind, execution, description, params, result)`. They are not listed in `expose`; the decorator is the declaration, next to the code, and `apiList` is built from it (a type that writes `apiList` in `expose` fails to load). The method name is the api name on the wire, so api methods are camelCase like every other name the page sees. `kind` is `query` (reads the state) or `command` (changes it); `execution` is `sync` (answered when done) or `async` (answered with a job; the api reports progress with `self.context.job_progress_set(fraction, message)`). `param(name, type, description, default, isRequired, schema)` and `returns(type, description, schema)` use the type names of JSON Schema (`string`, `integer`, `number`, `boolean`, `object`, `array`, `null`) plus `any`; a parameter without a default is required. The backend checks every call against them (an unknown parameter, a missing required one, a value of the wrong type: -1) before the call is queued. An api refuses with `raise ServiceError(code, message)`; any other exception is -1 with its type and message, and a result that is not JSON is a failure of the api.
- **`dashboardList`**: the dashboards, keyed by `id` (a lowercase letter, then letters, digits, `-`), each `{ id, purpose, label, description, export, heightMin }`. `purpose` is `default` (what a document shows when it places the type), `config` (the instance's settings, shown in the [Services tab](#the-services-tab)), or `other`; **a type has exactly one dashboard of purpose `default` and one of purpose `config`**, and any number of others. `export` names the dashboard's export in the module, `heightMin` (a css length) is the room the frame keeps for it while it loads.
- **`dashboardRemote`**: where the federated module of the dashboards is: `dir` (inside the type folder), `entry`, `container` (the federation name), `module` (the exposed module). Whether it is built is read on every listing (`dashboardBuild { isBuilt, timeBuilt }`, the mtime of the entry), since a type's dashboards are built while the backend runs.
- **anything else** a type wants to expose is kept as written under its own key (`sqliteTableList`): the page shows it nowhere, a tool or a dashboard may read it from the type's `expose`.

The normalized `apiList` keeps the project's names (`paramList`, `isRequired`, `kind`, `execution`), the same way component exposures do. The same information in a standard form is **OpenRPC** 1.3.2 (`GET /type/openrpc?typeId=`, `openrpc_document_build`): one method per api, `params` by name with their JSON Schema, `result`, and the two properties OpenRPC has no field for as extensions, `x-kind` and `x-execution`. A client that speaks OpenRPC reads a type's apis from there; the page reads the exposure.

## The Vite plugin

The page reaches the backend through the development server, never directly. `plugin/doc-service-server.ts` reads the `service` section of `config.yaml` and adds one middleware that forwards `{base}/__doc-service/*` to the backend unchanged (method, body, status, headers); when the backend cannot be reached it answers `{ code: -5, message }` with http 503, the one code the page reads as "backend down".

```yaml
# config.yaml
service:
  backend: http://127.0.0.1:45190                       # the backend's address
  backendConfigFile: ../example_doc/service-backend.yaml # optional: the backend's config
```

`backendConfigFile` is read for one reason: the type and instance folders it lists are not documents. The source rules skip them, and a change in them (a sqlite journal, a dashboard build) never reloads the page or regenerates the manifest, the same way the folders of the local asset store are excluded. The virtual module exports `docServiceEndpoint`, the url of the forwarded api during `vite`, and the empty string in a build or without a `service` section; the host passes it as `config.service.endpoint` of `DocPageMdx` ([Consumer setup](doc_page_impl_detail.md#consumer-setup)). Without an endpoint `DocServiceStore` has no backend (`backendStatus: 'none'`), and every dashboard says so.

## DocServiceStore

`DocServiceStore` (`store/DocServiceStore.ts`) knows what the backend last said, loads the dashboard modules, tells a dashboard what keeps it from showing, and answers the dashboards' events.

- `backendStatus`: `none` (no endpoint: a build, or no `service` section), `loading` (the first answer is awaited), `up`, `down` (the development server answered -5); `backendMessage` says why, `backendInfo` is the backend's `/status`.
- `typeList`, `instanceList`: the last listings. `refresh()` asks for the status and both lists; it runs at start, then again every 15 s while the backend is up (so a backend stopped, or an instance stopping, is seen without a call failing first) and every 5 s while it is down (so the dashboards come back by themselves when it is started). A call answered -5 marks the backend down at once; a call answered -3 or -4, or any answer while it was down, asks for the lists again.
- `moduleByTypeId`: the dashboard module of each type, `{ status: loading | done | error, module, message, entryUrl }`, loaded once per build ([Dashboard module](#dashboard-module)).
- `settings`: the Services tab: the instance chosen, the creation of an instance, the state of the config dashboards shown there (in memory: the tab is no document).
- `dashboardInsertList`: every dashboard of every type that loaded, for the insert menu ([Creating a dashboard](#creating-a-dashboard)).

A dashboard names what it shows by `{ typeId, dashboardId, serviceId }`: the type and the dashboard by its component id, the instance by its data. `dashboardProblemGet(ref)` says why it cannot show, `null` when it can, checking in the order a reader can fix it:

| kind | when |
| --- | --- |
| `backendNone` | the page has no backend (a build, no `service` section) |
| `loading` | the first answer of the backend is awaited, or the module is loading |
| `backendDown` | the backend cannot be reached |
| `typeNotFound` | no type folder has this type id |
| `typeError` | the type failed to load (its message) |
| `dashboardNotFound` | the type has no dashboard of this id (the ids it has are listed) |
| `serviceNotBound` | the dashboard is bound to no instance yet: choose one |
| `serviceNotFound` | no instance folder has this id |
| `typeMismatch` | the instance is of another type |
| `serviceNotReady` | the instance is `starting`, `disabled`, or in `error` (its message) |
| `moduleNotBuilt` | the type's dashboard module is not built (what to build is named) |
| `moduleError` | the module failed to load, has no such export, or the dashboard threw while rendering |

## Dashboards in the registry

A dashboard is a component of the [registry](doc_page_impl_mdx_comp.md), so a document places it like any other component block, and its component id names it: **`service/{typeId}/{dashboardId}`**. The id is also its tag name in a document, so no `compRegistry` entry is needed and a new type needs no change of the page:

````md
<!--renderComp=service/note-db/default-->
```asset
store: local
objectId: w4veeme6sff
```
````

The registry finds a component by its id in `compById`, and falls back to the dashboards: every lookup of a definition by id goes through one function, `compDefinitionGet(compById, compId)` (`registry/comp-definition.js`), which returns the registered definition or, for an id of the form above, the dashboard's definition (`serviceDashboardDefinitionGet`, cached per id). The definition is built from the id alone and is the same for every type: it exists while the backend is down or the type is unknown, so the block still renders its frame and says what is missing; what the type declares (its label, its dashboards, its module) comes from the backend at render time through the store. It is `compDefine(ServiceDashboardHost, …)` with:

- `componentType: 'serviceDashboard'` and `meta.isServiceDashboard` (with `serviceTypeId`, `serviceDashboardId`): what tells a dashboard from other components.
- `placementList: ['commentBlock', 'serviceSettings']`: a block of a document, or the Services tab.
- `isAssetAware`, `meta.isAssetOnly`, `meta.assetSaveMode: 'inPlace'`: its data is an asset object ([Dashboard state](#dashboard-state)), the way ExcelUniver's is ([Asset-only and not-in-doc](doc_page_impl_mdx_comp.md#asset-only-and-not-in-doc)).
- `meta.isEditSourceAccepted: false`, `meta.isEditEnterButtonOnly: true`, no edit modes: a dashboard changes its own data while it is read, so there is nothing to edit in an edit session, and a click on it in edit mode works the dashboard instead of opening the block ([Asset-only components](doc_page_impl_edit.md#asset-only-components)).
- `sourceDefaultCreate`: a new dashboard's data, bound to no instance.

### Dashboard state

The data of a dashboard block is the instance it shows and the dashboard's own state, yaml in an asset object (`service-dashboard-data.js`):

```yaml
serviceId: w4veemd7i36     # the instance; '' for a dashboard bound to none
state:                     # the dashboard's own state, any mapping: what it shows, not what the instance keeps
  query: ''
```

A dashboard keeps its local state there and nowhere else (a search, a chosen tab, a sort order), so the document opens it as it was left; the instance keeps its own state in its own folder. The object is written **in place** (`DocAssetStore.objectUpdate(store, objectId, { text }, 'inPlace', 'dashboard state')`): the state is the dashboard's present, not a history of versions. The writes of one object go one after another (each needs the hash of the head the previous one made). The state cannot be written, and the dashboard is told why (`config.state.unavailableReason`), when the block has no asset object (inline data), reads a pinned version instead of the head, the object is locked, or the store is not writable (a build). The data is never written inline in a document: a dashboard's state changes while it is read, and a document must not change while it is read.

## The dashboard frame

`ServiceDashboardHost` (`comp-doc/service/`) is the frame of every dashboard. The frame, not the dashboard, owns what every dashboard needs the same way:

```text
[icon] Note DB · Notes   [example notes ▾]  ● ready ↻
┌──────────────────────────────────────────────────┐
│ the dashboard, or why it cannot show              │   min-height: the dashboard's heightMin
└──────────────────────────────────────────────────┘
```

- **The choice of the instance, always shown**: every instance of the type, plus the bound one marked `(not found)` when it is gone, so a dashboard is never stuck on an instance it cannot leave. Choosing reports `serviceBindRequest`; the select is disabled with the reason when the state cannot be written.
- The state of the backend and of the instance (`ready`, `starting`, `backend down`, `not found`, …, with the message as its tooltip) and the refresh button beside it, which asks the backend again.
- What keeps the dashboard from showing (`dashboardProblemGet`), in place of the dashboard, with the head still usable, so the reader can fix it from there.
- The room the dashboard needs (`heightMin`), so the page does not jump while the module loads.

**A dashboard that has shown stays while the backend goes down**: its calls answer -5 and the head says `backend down`, so the reader keeps what is on screen. **A dashboard is mounted again when it is bound to another instance** (keyed by the service id), so a dashboard reads its instance once and never has to notice a change of instance. A dashboard that throws while rendering is caught by an error boundary and shown as `moduleError`: one block failing, not the page.

### Dashboard props

The dashboard receives the common props of a component, `{ data, config, onEvent }`:

```text
data                { state }                     the dashboard's own state (Dashboard state)
config.placement    'commentBlock' | 'serviceSettings'
config.service      { typeId, dashboardId, serviceId,
                      instance,                   the instance as listed: { name, status, config, queueLength, … }
                      type,                       the type as listed: { expose, dashboardBuild, … }
                      backendStatus }             'up' | 'down' (shown dashboards stay while it is down)
config.state        { isWritable,                 whether dashboardStateSetRequest can be written
                      unavailableReason }         why not ('' when it can)
onEvent(type, data) the events below; every one is answered with a promise of { code, data, message }
```

### Dashboard events

The frame wraps the dashboard's `onEvent`: every report carries `data.dashboard = { typeId, dashboardId, serviceId, state }`, what the block shows now. The events go through the [event layer](doc_page_impl_event.md) to the `service` route (`DocServiceStore.eventHandle`); a place that keeps the state elsewhere (the Services tab) answers the bind and the state first, as its local handler.

| event | data | answer |
| --- | --- | --- |
| `serviceApiCallRequest` | `{ api, params }` | a sync api: the call's own result, `{ code: 0, data }` or its failure; an async api: `{ code: 0, data: job }` |
| `serviceJobGetRequest` | `{ jobId }` | `{ code: 0, data: job }` (status, progress, the result once done) |
| `dashboardStateSetRequest` | `{ state }` | the state written into the block's asset object, the instance kept |
| `serviceBindRequest` | `{ serviceId }` | the block bound to the instance (reported by the frame), the state kept |
| `serviceRefreshRequest` | | the backend asked again |

### Calling the apis

**A dashboard calls the apis of its own instance and of no other**: a call goes to `data.dashboard.serviceId`, which the frame adds, so a dashboard cannot name another instance, and it never knows the url of the backend. The example's helpers (`note-db/dashboard/src/service-call.js`) show the whole contract in three functions:

```js
const result = await onEvent('serviceApiCallRequest', { api: 'noteList', params: { query } });
if (result.code !== 0) { /* -1 failed, -3 no such api, -4 not ready, -5 backend down, -6 timeout */ }

// an async api: the job, then the job asked for until it is done (serviceJobRun)
const started = await onEvent('serviceApiCallRequest', { api: 'reindex', params: {} });
const job = await onEvent('serviceJobGetRequest', { jobId: started.data.jobId });   // every 300 ms
// job.data.status === 'done' -> job.data.result is the call's own { code, data, message }

await onEvent('dashboardStateSetRequest', { state: { ...data.state, query } });
```

### Dashboard conventions

- **The frame owns the instance.** A dashboard never offers a choice of instance or reads one from its state; it shows the one in `config.service.serviceId`, and is mounted anew for another.
- **Every call can fail.** A dashboard shows the message of a failed call where the call was asked for, keeps what it showed, and does not retry by itself; -5 needs no message of its own, the head already says it.
- **Local state goes into `dashboardStateSetRequest`**, and only what should be there when the document is opened again; what the instance keeps is asked from the instance. A dashboard that cannot write (`config.state.isWritable` false) still works, without remembering.
- **The ui follows the page's rules**: compact, contenteditable for text that switches to edit mode, confirmations in place (no browser dialogs), no layout jump while loading (`heightMin`).
- **Styles are prefixed with the type's id** (`note-db-…`) and use class selectors only: the module's stylesheet joins the page's.
- **One react**: a dashboard uses the page's react ([Dashboard module](#dashboard-module)) and bundles everything else it uses.

## Dashboard module

The dashboards of a type are one federated module (module federation, after `react-lazy-load`), built by `@originjs/vite-plugin-federation` in the type's `dashboard/` folder and served by the backend from `dashboardRemote.dir`. The page is the host but is not built with the federation plugin; it speaks the container contract itself (`lib/doc-service-federation.js`):

```text
const container = await import(`${endpoint}/type/dashboard/${typeId}/${entry}?t=${timeBuilt}`)
await container.init(shareScope)          // react, react-dom: the page's own, { [version]: { get, loaded, from: 'host' } }
const factory = await container.get(module)
const module = factory()                  // { NoteDbDashboard, NoteDbConfigDashboard, … }: dashboardList[].export
```

The url carries the build time of the entry, so a dashboard rebuilt while the page is open is a new url and is loaded anew at the next listing; a container is loaded once per url, and a failed load is not kept, so the next attempt loads again. **The page shares `react` and `react-dom`**, and a remote declares them shared with `singleton` and a loose `requiredVersion` (`^19.0.0`), so a dashboard renders with the page's react: hooks, context, and events work across the two. The build of a remote follows from how the page loads it (`note-db/dashboard/vite.config.js`):

- `base: './'` and `build.assetsDir: ''`: every file at the top of `dist/` beside `remoteEntry.js`, because the plugin writes the chunk paths relative to the build root and the backend serves the build under a path the page decides.
- An `index.html` entry: the plugin needs one, even though nothing loads it.
- `build.target: 'esnext'` (top-level await, `import.meta`).
- **The module adds its own stylesheet**: the dashboard module imports its css as text (`?inline`) and adds a `<style>` element once. The plugin's own stylesheet loading joins the stylesheet url wrongly for a page whose host has no dot in its name (`localhost`), so a remote emits no css file of its own.

The build is not part of the repository (`dist/` is ignored); a type whose module is not built shows `moduleNotBuilt` with what to build.

## The Services tab

The settings panel has a tab **Services** (`comp-doc/settings/ServiceSettings.jsx`), with the backend's line on top (its status, the number of types and instances, the refresh button, the problems of its scan and the types that failed to load), then two sections:

- **System services**: the page's own features run as services. There are none yet; no feature of the page is a service.
- **Custom services**: the instances of the backend, one near-square card each (the type's icon, the instance's name, its status and type), and a `+ New` card that creates an instance (a type, a name, a description; `POST /instance/create`, in the default instance folder). Choosing a card shows the instance below: its id, type, status, folder, description, the signatures of its apis, and its **config dashboard** (the type's dashboard of purpose `config`), rendered through `RegisteredComp` with placement `serviceSettings`. There the dashboard is bound by the card, not by an asset object: the tab's local handler answers `serviceBindRequest` by choosing the card, and keeps `dashboardStateSetRequest` in memory (`settings.stateByServiceId`).

## Creating a dashboard

In edit mode the insert menu has a row **Services**: every dashboard of every type the backend knows (`DocServiceStore.dashboardInsertList`), named `{type label} · {dashboard label}` with the type's description, found through the search like the components. An entry is asset-only: choosing it creates the dashboard's data as an asset object, bound to no instance, and writes the reference block ([creating a block](doc_page_impl_edit.md#floating-controls), [asset-only components](doc_page_impl_edit.md#asset-only-components)); the reader then chooses the instance in the frame's head. Without a backend the row is absent: a dashboard of a type the page does not know cannot be offered, though one written by hand renders and says what is missing.

## Example and playground

The example type is `note-db` (`example_doc/service-type/note-db/`): notes in a sqlite database of each instance's folder, with the dashboards `default` (list, search, add, edit in place, delete with an in-place confirmation; the search is the dashboard's state), `config` (the instance's config, the database's numbers, a setting, and `reindex`, an async api slowed down to three seconds that shows the queue), and `stat`. Two instances are part of the example (`example_doc/service/`, whose ignore file keeps only their `service.yaml`; every database and every new instance is ignored). [Service Instances](../example_doc/service-instance.md) places four dashboards: two bound to the instances, one bound to an instance no folder holds, one of a type the backend does not have. Its asset objects are tracked, so using them changes them in place (`git restore example_doc/asset` undoes that).

[Playground](../example_doc/playground/playground.md) is a document for trying things out, services and assets alike; its folder is ignored by git with everything in it, so the committed repository shows it as missing until it is created.

## Files

```text
service-backend/server.py              the http server: routes, codes → http status, static files of a type, shutdown
service-backend/service_runtime.py     ServiceRuntime: config, scan, types (reloaded by mtime), instances (worker
                                       thread + queue, jobs), create, api_call
service-backend/service_define.py      ServiceType, ServiceContext, ServiceError, @api, param, returns,
                                       expose_build (normalize + check), call checking, OpenRPC
service-backend/service_util.py        ms48 ids, time text, names ({id}--{name}), yaml read / atomic write
frontend/plugin/doc-service-server.ts  the service section of config.yaml, the forwarding middleware (-5 when down),
                                       the backend's folders (excluded from the source and from reloads)
frontend/plugin/doc-source.ts          docServiceEndpoint export, middleware registration, folder exclusion
frontend/src/lib/doc-service-api.js    fetch client of the forwarded api; a failed fetch is -5
frontend/src/lib/doc-service-federation.js  the container contract: share scope, load per url
frontend/src/store/DocServiceStore.ts  backend status and polling, types, instances, modules, dashboardProblemGet,
                                       calls, dashboard state writes, eventHandle (the service route)
frontend/src/DocPageMdx.jsx            the store, the service route
comp-doc/registry/comp-definition.js   compDefinitionGet: registered definitions, then dashboards
comp-doc/service/service-dashboard-define.js  dashboard component ids, the definition of a dashboard
comp-doc/service/service-dashboard-data.js    the data of a dashboard block (serviceId, state)
comp-doc/service/ServiceDashboardHost.jsx     the frame: head, problems, props and events of the dashboard
comp-doc/service/ServiceParts.jsx      type icon, status, refresh, instance select, problem notice
comp-doc/service/DocService.css
comp-doc/settings/ServiceSettings.jsx  the Services tab: backend line, system and custom services, cards,
                                       creation, the instance's detail and config dashboard
comp-doc/edit/edit-template.js         the Services entries of the insert menu
example_doc/service-backend.yaml       the example's backend config
example_doc/service-type/note-db/      service_type.py, icon.svg, dashboard/ (the federated module's project)
example_doc/service/                   the example's instances
example_doc/service-instance.md        the demonstration document; playground/ the ignored playground
```
