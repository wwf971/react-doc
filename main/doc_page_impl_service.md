<!-- Design of service templates and service instances. Parent document: doc_page_impl.md. The edit layer's part (creating a dashboard block) is in doc_page_impl_edit.md. -->

# Service Templates and Instances: Design

An asset is data: a versioned object that a component reads, which the page can copy, bundle into a build, and resolve before the component renders ([Asset service layer](doc_page_impl_asset.md)). A **service instance** is a running thing with its own state: a database, a crawler, a queue of jobs, anything that answers requests and keeps something between them. Its state is not the document's and cannot be bundled; the document only places **dashboards** that show and work an instance. The distinction decides everything below:

| | asset object | service instance |
| --- | --- | --- |
| what it is | data, with a history of versions | a process, with state only it can change |
| who reads it | the page resolves it before the component renders | the dashboard asks the instance, through its apis |
| who writes it | the page, through the asset api | the instance itself, when an api asks it to |
| in a build | bundled, read-only | absent: a build has no backend |
| in a document | a reference in place of the block's data | a dashboard block, whose own data (which instance, the dashboard's state) is an asset object |

A service exists in two forms, modeled as two different things:

- A **service template** is the initial state of a service: a folder with a script (`service.py`, a Python class with the apis), the dashboards (a federated module), an icon, and the initial config, and no data. A template is listed, never run. It plays the part of a project scaffold, not of a class: it is what an instance is created from, not what keeps defining it.
- A **service instance** is a running service: a folder of its own holding a **copy** of everything its template held when it was created, its config, and its data. It is run by the **service backend**, a program of its own (`main/service-backend/server.py`) that the page reaches through the development server. **An instance is always created from a template**, records which one, and never reads the template again.

The backend and the page work alone: the backend answers any http client without the page, and the page without the backend shows in every dashboard that the backend is down. Services also use one another: a connection to an outside system or an authentication provider is an instance that other instances, and the dashboards of any instance, call by its id or by its template ([Calls between services](#calls-between-services)).

```text
browser                                    development server (vite)        service backend (python)
DocServiceStore                            plugin/doc-service-server.ts     server.py + service_runtime.py
  ├─ templateList, instanceList ── GET ──► {base}/__doc-service/* ───────► /template/list, /instance/list (scan)
  ├─ instanceCreate(template) ── POST ───►   forwarded unchanged ────────► /instance/create: the template folder copied
  ├─ moduleLoad(instance) ── import() ───►   backend unreachable: ───────► /instance/dashboard/{serviceId}/remoteEntry.js
  │    federation container (shared react)   { code: -5 } (http 503)
  ├─ eventHandle (route "service")
  │    serviceApiCallRequest ── POST ─────────────────────────────────────► /api/call ──► the instance's queue
  │      (its own instance, or a target)                                    /job/get        one worker thread:
  │    serviceJobGetRequest, serviceResolveRequest                          /instance/resolve  one api at a time
  │    serviceBindRequest ─┐                                                     ▲
  │                        │                       another instance: context.service_call (the same path)
  │    dashboardStateSetRequest ─► DocAssetStore.objectUpdate (in place)
  └─ dashboardProblemGet: why a dashboard cannot show

service-template/{templateId}--{name}/          service/{templateName}-inst-{serviceId}/
  service-template.yaml   id, version, config     service.yaml   id, name, template: { templateId, name, versionId }, config
  service.py, icon.svg    ──── copied when ────►  service.py, icon.svg   the instance's own: loaded and run by it alone
  dashboard/ (src, dist)       an instance is     dashboard/ (src, dist) the instance's own: served from its folder
                               created            notes.sqlite           its data

document block <!--renderComp=service/note-db/default--> + ```asset```  (data: { serviceId, state })
  └─ ServiceDashboardHost (the frame: icon, title, instance select, status, refresh)
       └─ NoteDbDashboard (from the instance's federated module) { data, config, onEvent }
```

### Why an instance copies its template

Instances of one template could share the template's script, pinned to a template version, with upgrades propagated to them. They do not, on purpose: **two instances never share a script, even when they come from the same template and the same template version and their scripts are the same.** Copying removes a whole class of problems for a system that holds few instances, mostly of different templates, each long-lived:

- an instance is **self-contained**: its folder is the whole service (script, dashboards, config, data), so it is backed up, moved, or restored by copying one folder, and runs whether or not its template is still there;
- changing a template changes no instance, and changing an instance (its config, its script, its dashboards) changes no other instance and no template; there is no version binding to resolve at start, and no upgrade that reaches instances by surprise;
- every instance loads its own `service.py` into a module of its own and serves its own dashboard module, so no module-level state is shared between instances.

Copying the files isolates the folders, not the execution: instances still run in the one backend process, each in its own worker thread, and a script can still reach whatever the process can (environment, other paths). Trusted local scripts need no more; [Future updates](#future-updates) lists what stronger isolation would take. An instance that should follow a newer template is updated by an explicit step, never by the template changing.

## Backend

The backend is the Python standard library's `ThreadingHTTPServer` and PyYAML (`main/service-backend/requirements.txt`), nothing else: a script brings its own dependencies. It is started with its config file and stopped with Ctrl+C (SIGINT, SIGTERM), which lets every instance finish the api it runs and call `stop()`:

```text
python3 main/service-backend/server.py --config example_doc/.doc-page/service-backend.yaml [--port 45190] [--host 127.0.0.1]
```

`ServiceRuntime` (`service_runtime.py`) finds the templates and the instances, creates instances, and runs the apis. **`scan()` is cheap and runs on every listing**: the `service.py` of every folder, template or instance, is a `ServiceScript` loaded again when the file changed (by mtime, through `importlib`, into a module named after its folder, so two folders never share a module); a template is read again when its `service-template.yaml` changed; an instance is restarted when its folder, its `service.yaml`, or its own `service.py` changed (its signature), and a folder that is gone stops its instance. A folder added, removed, or edited by hand is therefore seen at the next listing, without restarting the backend. A template is only read: its script is loaded for what it exposes (shown in the Services tab, checked before an instance is created from it), and nothing of it runs.

**One request at a time per instance.** Every running instance has one worker thread and one queue. The thread creates the class of the instance's own script with the instance's context, calls `start()`, then takes the calls in the order they came; a call waits behind the ones before it, whatever its kind and whoever sent it (the page or another instance). An implementation never sees two calls at once and may keep a connection (sqlite) as a plain attribute. An api declared `isQueued=False` is the one exception: it runs at once in the caller's thread and guards its own state ([What an api says about its callers](#what-an-api-says-about-its-callers)). A sync call is answered when its api is done, queue included, or after `apiWaitSecondMax` with code -6 (the call stays queued and still runs); an async call is answered at once with its job, which runs in the same queue. Stopping puts a sentinel in the queue: the call being run finishes, the ones still waiting are answered -4.

| instance status | meaning |
| --- | --- |
| `ready` | apis are answered |
| `starting` | `start()` is running; calls wait in the queue |
| `disabled` | `isEnabled: false` in `service.yaml`; calls are refused (-4) |
| `error` | the folder, `service.yaml`, its `service.py`, or `start()` failed; `message` says why; calls are refused (-4) |

### Backend config

```yaml
# example_doc/.doc-page/service-backend.yaml (paths relative to this file: ../ is the doc page folder)
host: 127.0.0.1
port: 45190
apiWaitSecondMax: 120          # how long a sync call is waited for, queue included, before -6
templateFolderList:            # folders holding the templates: {templateId}--{name}/service-template.yaml
  - path: ../service-template
instanceFolderList:            # folders holding the instances: {templateName}-inst-{serviceId}/service.yaml
  - path: ../service
    isDefault: true            # where a new instance is created (the first folder when none says so)
```

The two kinds of folders are kept apart, in folder lists of their own, and named the way the asset service layer names its object folders ([Names](doc_page_impl_asset.md#names)): the id is an ms48 id (base36 of the creation millisecond and 16 random bits) and a separator no id can hold tells the id from the name, so a folder is identified by its name alone and a person browsing the disk sees what it is.

| | template folder | instance folder |
| --- | --- | --- |
| name | `{templateId}--{name}` (`w4wp4t0czko--note-db`) | `{templateName}-inst-{serviceId}` (`note-db-inst-w4veemd7i36`) |
| the id | before the first `--` | after the last `-inst-` (an id holds no `-`) |
| its file | `service-template.yaml` | `service.yaml` |
| script, icon, dashboards | `service.py`, the icon, `dashboard/` | its own copies, made when it was created |
| data | none (a database is created by an instance when it first starts) | whatever the instance keeps (`notes.sqlite`) |

A **template name** is lowercase letters, digits, `-` and `_`, starts with a letter or a digit, holds no `--`, and is unique among the templates (a second folder of the same id or name is skipped), because it is also the middle of a dashboard's component id ([Dashboards in the registry](#dashboards-in-the-registry)). The `{templateName}` of an instance folder is the template's name when the instance was created, for the reader of the disk; the backend reads only the id, so an instance folder stays as it is when its template is renamed or removed. An **instance name** is a free label (trimmed, not empty, at most 80 characters), unique among the instances when one is created, and kept in `service.yaml` only. A folder whose name has not its form, or a second folder with the same id, is listed in the scan's problems (`GET /status`, `scanProblemList`) and skipped; names starting with a dot are not folders of either kind.

```yaml
# {templateId}--{name}/service-template.yaml, written by hand, or by the backend
# (a new version) in this key order
templateId: w4wp4t0czko        # must be the id of the folder name
name: note-db                  # must be the name of the folder name
description: notes kept in a sqlite database
timeCreated: 20261024_20044940+09
versionId: w4wp4t0yp9u         # the current version: what an instance created now records
versionList:                   # the versions the template had, oldest first
  - { versionId: w4wp4t0yp9u, time: 20261024_20044940+09, note: the note-db example }
config:                        # the initial config of an instance, checked against configDefineList
  databaseFile: notes.sqlite
  titleLengthMax: 120
```

A template is `ready` when its file, its `service.py`, and its config check, `error` with the reason otherwise; an instance can only be created from a ready template. The **version id** names the state of the template's files: whoever changes them records a new version (`POST /template/version/new`, with a note; the `+` beside the version in the Services tab), which becomes `versionId` and is appended to `versionList`. The backend does not notice changed files by itself; [Future updates](#future-updates) has the hash that would.

```yaml
# {templateName}-inst-{serviceId}/service.yaml, written by the backend in this key order
serviceId: w4veemd7i36         # must be the id of the folder name
name: example notes            # the instance's name
description: the notes of the example doc
isEnabled: true                # false: the instance is listed but not run
timeCreated: 20261024_04333559+09
template:                      # the template it was created from: a record, never read by the backend
  templateId: w4wp4t0czko
  name: note-db                # the template's name then; what a dashboard's component id matches
  versionId: w4wp4t0yp9u       # the template's version then
config:                        # the instance's config, checked against its own script's configDefineList;
  databaseFile: notes.sqlite   # a missing key gets its default, a key of the wrong type is an error,
  titleLengthMax: 120          # a key the script does not declare is kept
```

`template` is required: an instance without it is in `error`, since every instance is created from a template. Today the record is the template's id, name, and version id, which says where the instance came from as long as nobody reuses a version id for other files; [Future updates](#future-updates) has the hash and signature that would prove it. `service.yaml` is the instance's config, so an instance is reconfigured by editing it (the backend restarts the instance at the next listing), and renamed by editing its `name`; the backend writes it only when it creates the instance, atomically (a temporary file renamed over it).

### Creating an instance

`POST /instance/create { templateId, name, description, config? }` is the one way an instance comes to be, and it always names a template:

1. the template must be `ready`, and the name free;
2. the config is the template's `config` with the given `config` over it, checked against the template's script;
3. the template folder is copied, except `service-template.yaml` and what is installed or generated rather than written (`node_modules`, `__pycache__`, temporary files), into `.creating-{serviceId}` in the default instance folder, and `service.yaml` is written there with the template's `{ templateId, name, versionId }`;
4. the folder is renamed `{templateName}-inst-{serviceId}`, so a scan never sees half an instance, and the instance starts at once.

A built dashboard module (`dashboard/dist/`) is copied with the rest, so an instance of a built template shows its dashboards without a build of its own; its dependencies are not, and building the copy again needs them installed (in its folder, or anywhere above it).

### Backend api

Every answer is `{ code, data?, message? }` with an http status that follows the code: 0 → 200, -1 → 400, -2 → 403, -3 → 404, -4 → 409, -6 → 504. The development server adds -5 (503) when it cannot reach the backend ([The Vite plugin](#the-vite-plugin)).

| code | meaning |
| --- | --- |
| 0 | done |
| -1 | bad request, or the api failed (an exception: its type and message) |
| -2 | the caller may not call it: an api answered to services only, or a service refusing its caller |
| -3 | not found: the template, the instance, the api, the job |
| -4 | the instance is not ready (starting failed, disabled, stopped) |
| -5 | the backend cannot be reached (the development server's answer) |
| -6 | a sync call did not finish in `apiWaitSecondMax` |

```text
GET  /status                                  { timeStarted, configPath, templateFolderList, instanceFolderList,
                                                templateCount, instanceCount, scanProblemList }
GET  /template/list                           [{ templateId, name, description, timeCreated, versionId, versionList,
                                                 config, status: ready | error, message, folder, dirName, expose,
                                                 dashboardBuild: { isBuilt, timeBuilt } }]       (scans)
GET  /template/get?templateId=
GET  /template/openrpc?templateId=            the apis of the template's script as an OpenRPC document
GET  /template/icon/{templateId}              the file meta.icon of the template's script names
POST /template/version/new  { templateId, note }    a new versionId, appended to versionList; the template
GET  /instance/list                           [{ serviceId, name, description, isEnabled, timeCreated,
                                                 template: { templateId, name, versionId }, config, status,
                                                 message, folder, dirName, expose, dashboardBuild,
                                                 queueLength, apiRunning }]                       (scans)
GET  /instance/get?serviceId=
GET  /instance/resolve?serviceId= | templateId=&versionId=  [&dashboardServiceId=]
                                              the instance a call of that target goes to (Targets)
GET  /instance/openrpc?serviceId=             the apis of the instance's own script as an OpenRPC document
GET  /instance/icon/{serviceId}               the instance's own icon
GET  /instance/dashboard/{serviceId}/{path}   a file of the instance's dashboardRemote.dir (no path outside it)
POST /instance/create  { templateId, name, description?, config? }   a copy of the template (Creating an
                                                instance); the answer is the new instance
POST /api/call         { target, api, params, dashboardServiceId? }   sync: { code: 0, data: what the api returned }
                       target: { serviceId } | { templateId, versionId? };   async: { code: 0, data: job }
                       { serviceId, api, params } is the short form of target { serviceId }
GET  /job/get?serviceId=&jobId=               job: { serviceId, jobId, api, status: queued | running | done, progress (0..1),
                                                progressMessage, timeQueued, timeStarted, timeDone,
                                                result: the call's own { code, data, message } once done }
```

An instance keeps its last 50 finished jobs. The backend sends no CORS headers on purpose: the page reaches it on its own origin through the development server, and a page of another origin has no business calling it.

## What a service script exposes

The script of a service, `service.py` of a template and of every instance copied from it, says what it exposes the way a component does through `compDefine(Xxx, { expose })` ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)): one declaration next to the code it describes, normalized and checked when the script is loaded (`expose_build` in `service_define.py`), so a wrong shape fails with the place of the mistake (`instance note-db-inst-w4veemd7i36: expose.dashboardList[1].export must name …`) instead of later in a dashboard. A template whose script fails to load is listed with `status: error` and its message, and no instance is created from it; an instance whose script fails is in `error`. Since every instance has its own copy, what an instance exposes is read from its own script (`expose` of the instance), never from its template's: the two are the same until one of them is changed.

```python
# service.py of a template folder, and of each instance folder copied from it
from service_define import Service, ServiceError, api, param, returns

class NoteDb(Service):
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

SERVICE_CLASS = NoteDb
```

The object of the class is given a `ServiceContext`: `service_id`, `name`, `dir_path` (the instance's folder: its script and its data), `template` (the record of `service.yaml`, for information), `config`, `path_get(name)` and `job_progress_set(fraction, message)`; and for the calls between instances, `caller` (who calls the api being run) and `service_call`, `service_resolve`, `service_job_get` ([Calls between services](#calls-between-services)).

- **`meta`**: `label` is required; `description`, `author`, `version` (the script's own version for people, default `0.0.0`; not the template's version id), `license`, `homepage`, `icon` (a file of the folder, served at `/template/icon/{templateId}` and `/instance/icon/{serviceId}`), and `tagList` are optional. Other keys are kept.
- **`configDefineList`**: the shape of an instance's `config`, `[{ key, type: string | integer | number | boolean, default, description }]`. The backend fills the defaults and checks the types of every instance's config and of every template's initial config.
- **apis**: the methods marked `@api(kind, execution, description, params, result)`. They are not listed in `expose`; the decorator is the declaration, next to the code, and `apiList` is built from it (a script that writes `apiList` in `expose` fails to load). The method name is the api name on the wire, so api methods are camelCase like every other name the page sees. `kind` is `query` (reads the state) or `command` (changes it); `execution` is `sync` (answered when done) or `async` (answered with a job; the api reports progress with `self.context.job_progress_set(fraction, message)`); `callerKindList` (who may call it: `page`, `service`) and `isQueued` (whether it waits in the queue) are for the calls between services ([What an api says about its callers](#what-an-api-says-about-its-callers)). `param(name, type, description, default, isRequired, schema)` and `returns(type, description, schema)` use the type names of JSON Schema (`string`, `integer`, `number`, `boolean`, `object`, `array`, `null`) plus `any`; a parameter without a default is required. The backend checks every call against them (an unknown parameter, a missing required one, a value of the wrong type: -1) before the call is queued. An api refuses with `raise ServiceError(code, message)`; any other exception is -1 with its type and message, and a result that is not JSON is a failure of the api.
- **`dashboardList`**: the dashboards, keyed by `id` (a lowercase letter, then letters, digits, `-`), each `{ id, purpose, label, description, export, heightMin }`. `purpose` is `default` (what a document shows when it places the service), `config` (the instance's settings, shown in the [Services tab](#the-services-tab)), or `other`; **a script has exactly one dashboard of purpose `default` and one of purpose `config`**, and any number of others. `export` names the dashboard's export in the module, `heightMin` (a css length) is the room the frame keeps for it while it loads.
- **`dashboardRemote`**: where the federated module of the dashboards is: `dir` (inside the folder), `entry`, `container` (the federation name), `module` (the exposed module). Whether it is built is read on every listing (`dashboardBuild { isBuilt, timeBuilt }`, the mtime of the entry), since dashboards are built while the backend runs.
- **anything else** a script wants to expose is kept as written under its own key (`sqliteTableList`): the page shows it nowhere, a tool or a dashboard may read it from the `expose` of the instance.

The normalized `apiList` keeps the project's names (`paramList`, `isRequired`, `kind`, `execution`, `callerKindList`, `isQueued`), the same way component exposures do. The same information in a standard form is **OpenRPC** 1.3.2 (`GET /instance/openrpc?serviceId=`, `GET /template/openrpc?templateId=`, `openrpc_document_build`): one method per api, `params` by name with their JSON Schema, `result`, the properties OpenRPC has no field for as extensions, `x-kind`, `x-execution`, `x-callerKindList` and `x-isQueued`, and whose script it is in `info` (`x-serviceId`, `x-templateId`, `x-templateName`, `x-templateVersionId`). A client that speaks OpenRPC reads an instance's apis from there; the page reads the exposure.

## Calls between services

Some services exist to serve others. A **connection** (`aws-connection`, `postgres-connection`, `google-drive`) holds the sign-in and the secrets of an outside system, and the services allowed to use it get what they need through it without holding a secret of their own; an **authentication provider** (`cognito-auth`) verifies the users of an application for the services that serve them. Instances call one another, and a dashboard may call any instance, not only its own. Every call, whoever sends it, names a **target** and is made by a **caller**:

```text
caller: who calls, set by the backend               target: what the call names            the instance that answers
  page      an http request (POST /api/call),          { serviceId }               ──►  that instance
            + dashboardServiceId: whose dashboard      { templateId }              ──►  an instance created from that template,
  service   an instance: self.context.service_call     { templateId, versionId }  ──►  (at that version), never the caller itself
```

### Targets

A target names either one instance or any instance of a template:

| target | the instance that answers |
| --- | --- |
| `{ serviceId }` | that instance, whatever its state (one not ready answers -4) |
| `{ templateId }` | an instance that recorded that template when it was created |
| `{ templateId, versionId }` | an instance created from that template at that version |

A template target is matched against what every instance recorded in its `service.yaml`, like a dashboard's template name ([Dashboards in the registry](#dashboards-in-the-registry)), so it keeps working when the template folder is renamed or gone. **The caller itself is never chosen**, neither the calling instance nor the instance whose dashboard asks: asking for "an instance of the template" is asking for another one. Among the candidates a `ready` one comes first, then the oldest (by id), so the same instance answers while nothing changes; when none is ready the first is still chosen, so the call fails with its reason (-4), and when there is none the call is -3. A service that must use one particular instance among several keeps its id in its config (`noteServiceId: ''`, empty meaning "by template"), and the reader chooses it there.

### The caller

The backend sets the caller; a request never says who it is:

- **`page`**: every http request, from the page through the development server or from any other http client. The page adds `dashboardServiceId`, the instance whose dashboard asks; it is kept, not verified (every dashboard runs in the one page).
- **`service`**: a call made by an instance with `self.context.service_call`; its `service_id` is that instance's.

The callee reads it as `self.context.caller` (`kind`, `service_id`, `dashboard_service_id`) while its api runs: a connection answers the consumers it allows by the id the backend gives, never by an id in the params. `caller` is `None` outside an api (`start()`, a thread of the service's own).

### From a service

```python
class NoteDb(Service):
    @api(kind='command', params=[param('sourceServiceId', 'string', '…', default='')], …)
    def noteImport(self, sourceServiceId=''):
        target = {'serviceId': sourceServiceId} if sourceServiceId else {'templateId': self.context.template['templateId']}
        source = self.context.service_resolve(target)                  # the instance, as listed: { serviceId, name, … }
        note_list = self.context.service_call({'serviceId': source['serviceId']}, 'noteList', {'limit': 50})['noteList']
        …

credentials = self.context.service_call({'templateId': 'w4wsn192rpt'}, 'credentialsGet')     # aws-connection
job = self.context.service_call(target, 'reindex')                       # an async api: its job
self.context.service_job_get(job['serviceId'], job['jobId'])
```

`service_call` answers what a sync api returned, or the job of an async one, and raises `ServiceError` with the call's own code and message when it fails; an api that lets it raise fails with them. A call between instances takes the same path as a call of the page, `api_call` in `service_runtime.py`:

```text
api_call(target, api, params, caller)
  -> target_resolve(target, caller)            the instance; -1 a bad target, -3 none
  -> not ready: -4; no such api: -3
  -> call_authorize(caller, instance, api)     -2 when refused (Authorization)
  -> params checked against the api            -1
  -> isQueued false: run now, in the caller's thread
     else the instance is in the call's chain: -1 (its queue would wait for itself)
     else queued: a sync call waits apiWaitSecondMax at most (-6), an async call answers its job
```

**Queues and cycles.** An api that calls another instance holds its own queue until the answer comes: the queue of A waits for B's. If the call came back (A → B → A, or A calling itself), A's queue would wait for itself until the call times out. The caller carries the chain of instances the call passed through, and a queued api of an instance already in it is refused at once (-1) instead.

### What an api says about its callers

Two options of `@api`, checked when the script is loaded like the others:

- **`callerKindList`**: who may call it, `['page', 'service']` by default. `['service']` is an api for other instances only, never answered to the page, for what must not reach a browser: credentials, a verified user. A caller of another kind is refused with -2.
- **`isQueued`**: `True` by default. `False` runs the api at once in the caller's thread (the http request's, or the calling instance's), beside whatever the queue runs: for an api many callers use and that must not wait behind a long one (a sign-in that waits for the user, a long statement). The method guards what it touches with locks; `context.caller` and the current job are per thread, so two calls running at once do not see each other's. An async api is always queued (it is a job of the queue), and an unqueued api is never refused as a cycle, since it waits for no queue.

The example templates meant to serve others use them this way; each decides by itself which callers it serves (a consumer list kept in its own folder, managed in its config dashboard, where a refused caller is listed to be allowed with one click):

| template | what it serves to other instances | how the caller is checked |
| --- | --- | --- |
| `aws-connection` | `credentialsGet`: services only, unqueued | its consumer list |
| `postgres-connection` | `consumerCall(method, params)`: services only, unqueued (the statements run side by side on its pool) | its consumer list, with an access mode each |
| `google-drive` | its file apis (`consumerApiList` in its exposure), queued | its consumer list, read-only or read-write each; the page only manages the connection |
| `cognito-auth` | `principalResolve`, `principalRequire`: services only, unqueued | any service; the credential given is what is verified |

### From a dashboard

A dashboard calls as the page, through the same events as for its own instance ([Dashboard events](#dashboard-events)), and adds a target to name another one:

```js
// another instance of the template: which one, then its apis by id
const peer = await onEvent('serviceResolveRequest', { target: { templateId } });
const stat = await onEvent('serviceApiCallRequest', { api: 'statGet', params: {}, target: { serviceId: peer.data.serviceId } });
// a job belongs to the instance that runs it
await onEvent('serviceJobGetRequest', { jobId: job.jobId, serviceId: job.serviceId });
```

The page sends the dashboard's instance as `dashboardServiceId`, so a template target never resolves to it. An api answered to services only is refused to a dashboard (-2), whichever instance the dashboard belongs to: a dashboard that needs one asks its own instance, whose api makes the call as a service (the stat dashboard of `note-db` reads another instance itself, and asks its own instance's `noteImport` to copy from it).

### Authorization

What is checked today is what an api declares (`callerKindList`) and what a service checks by itself (the consumer lists of the connection templates). Every call, from the page and from instances alike, passes one function after its target is resolved and before it is queued, **`ServiceRuntime.call_authorize(caller, instance, api_define)`**, which answers -2 when it refuses; it is where a policy of the backend goes. **TODO**:

- **A policy of the backend**: which caller may call which instance and api, kept in the backend config or declared by the callee's script and recorded per instance, so the consumer lists the templates keep by themselves become one mechanism, shown in one place of the Services tab.
- **The end user behind a call**: a page request is the page, not a user. A credential (a session of `cognito-auth`) would be taken by the backend from the http request, never from params, and carried by the caller to every instance the call passes through, so a service can ask who the user is without being handed a session id by its caller.
- **The dashboards' identity**: `dashboardServiceId` is a claim of the page; all dashboards share one page, so a dashboard calling as another cannot be told apart until the page signs what each dashboard sends.
- **Resolution and jobs**: a target by template would skip the instances that refuse the caller, and a job would be read by its caller only (today, by anyone who knows its id).

## The Vite plugin

The page reaches the backend through the development server, never directly. `plugin/doc-service-server.ts` reads the `service` section of `config.yaml` and adds one middleware that forwards `{base}/__doc-service/*` to the backend unchanged (method, body, status, headers); when the backend cannot be reached it answers `{ code: -5, message }` with http 503, the one code the page reads as "backend down".

```yaml
# config.yaml
service:
  backend: http://127.0.0.1:45190                       # the backend's address
  backendConfigFile: ../example_doc/.doc-page/service-backend.yaml # optional: the backend's config
```

`backendConfigFile` is read for one reason: the template and instance folders it lists are not documents. The source rules skip them, and a change in them (a sqlite journal, a dashboard build) never reloads the page or regenerates the manifest, the same way the folders of the local store of the asset service layer are excluded. The virtual module exports `docServiceEndpoint`, the url of the forwarded api during `vite`, and the empty string in a build or without a `service` section; the host passes it as `config.service.endpoint` of `DocPageMdx` ([Consumer setup](doc_page_impl_detail.md#consumer-setup)). Without an endpoint `DocServiceStore` has no backend (`backendStatus: 'none'`), and every dashboard says so.

## DocServiceStore

`DocServiceStore` (`store/DocServiceStore.ts`) knows what the backend last said, creates instances from templates, loads the dashboard modules of the instances, tells a dashboard what keeps it from showing, and answers the dashboards' events.

- `backendStatus`: `none` (no endpoint: a build, or no `service` section), `loading` (the first answer is awaited), `up`, `down` (the development server answered -5); `backendMessage` says why, `backendInfo` is the backend's `/status`.
- `templateList`, `instanceList`: the last listings, two lists of two kinds of things. `instanceListOfTemplate(templateId)` are the instances created from a template (by the id they recorded), `instanceListOfTemplateName(name)` the instances a dashboard of that template name may show (by the name they recorded). `refresh()` asks for the status and both lists; it runs at start, then again every 15 s while the backend is up (so a backend stopped, or an instance stopping, is seen without a call failing first) and every 5 s while it is down (so the dashboards come back by themselves when it is started). A call answered -5 marks the backend down at once; a call answered -3 or -4, or any answer while it was down, asks for the lists again.
- `instanceCreate({ templateId, name, description })`, `templateVersionNew(templateId, note)`: the two writes of the Services tab, each with its pending state in `settings`.
- `moduleByServiceId`: the dashboard module of each instance, `{ status: loading | done | error, module, message, entryUrl }`, loaded once per build ([Dashboard module](#dashboard-module)).
- `settings`: the Services tab: the template chosen and the instance chosen (one per area), the creation of an instance and of a template version, the state of the config dashboards shown there (in memory: the tab is no document).
- `dashboardInsertList`: every dashboard of every template that can be used, then those of instances whose template name no template has any more, for the insert menu ([Creating a dashboard](#creating-a-dashboard)).

A dashboard names what it shows by `{ templateName, dashboardId, serviceId }`: the template and the dashboard by its component id, the instance by its data. `dashboardProblemGet(ref)` says why it cannot show, `null` when it can, checking in the order a reader can fix it:

| kind | when |
| --- | --- |
| `backendNone` | the page has no backend (a build, no `service` section) |
| `loading` | the first answer of the backend is awaited, or the module is loading |
| `backendDown` | the backend cannot be reached |
| `templateNotFound` | bound to no instance, and no template has this name nor any instance recorded it: nothing to choose |
| `serviceNotBound` | the dashboard is bound to no instance yet: choose one |
| `serviceNotFound` | no instance folder has this id |
| `templateMismatch` | the instance was created from a template of another name |
| `serviceNotReady` | the instance is `starting`, `disabled`, or in `error` (its message: its config, its script, its `start()`) |
| `dashboardNotFound` | the instance's script has no dashboard of this id (the ids it has are listed) |
| `moduleNotBuilt` | the instance's dashboard module is not built (what to build is named) |
| `moduleError` | the module failed to load, has no such export, or the dashboard threw while rendering |

Everything after the instance is read from the instance, not from its template: a dashboard shows what the instance's own copy declares and serves.

## Dashboards in the registry

A dashboard is a component of the [registry](doc_page_impl_mdx_comp.md), so a document places it like any other component block, and its component id names it: **`service/{templateName}/{dashboardId}`**, the template the instances it may show were created from, and their dashboard. The id is also its tag name in a document, so no `compRegistry` entry is needed and a new template needs no change of the page:

````md
<!--renderComp=service/note-db/default-->
```asset
store: local
objectId: w4veeme6sff
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

- **The choice of the instance, always shown**: every instance created from the template, plus the bound one marked `(not found)` when it is gone, so a dashboard is never stuck on an instance it cannot leave. Choosing reports `serviceBindRequest`; the select is disabled with the reason when the state cannot be written.
- The labels and the icon of the instance's own script, or of the template while no instance is bound.
- The state of the backend and of the instance (`ready`, `starting`, `backend down`, `not found`, …, with the message as its tooltip) and the refresh button beside it, which asks the backend again.
- What keeps the dashboard from showing (`dashboardProblemGet`), in place of the dashboard, with the head still usable, so the reader can fix it from there.
- The room the dashboard needs (`heightMin`), so the page does not jump while the module loads.

**A dashboard that has shown stays while the backend goes down**: its calls answer -5 and the head says `backend down`, so the reader keeps what is on screen. **A dashboard is mounted again when it is bound to another instance** (keyed by the service id), so a dashboard reads its instance once and never has to notice a change of instance. A dashboard that throws while rendering is caught by an error boundary and shown as `moduleError`: one block failing, not the page.

### Dashboard props

The dashboard receives the common props of a component, `{ data, config, onEvent }`:

```text
data                { state }                     the dashboard's own state (Dashboard state)
config.placement    'commentBlock' | 'serviceSettings'
config.service      { templateName, dashboardId, serviceId,
                      instance,                   the instance as listed: { name, status, template, config, expose, … }
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
| `serviceApiCallRequest` | `{ api, params, target? }` | a sync api: the call's own result, `{ code: 0, data }` or its failure; an async api: `{ code: 0, data: job }`. without `target`, the dashboard's own instance ([From a dashboard](#from-a-dashboard)) |
| `serviceJobGetRequest` | `{ jobId, serviceId? }` | `{ code: 0, data: job }` (status, progress, the result once done); `serviceId` names the instance of a job that is not the dashboard's own (`job.serviceId`) |
| `serviceResolveRequest` | `{ target }` | `{ code: 0, data: instance }`: the instance a call of the target goes to, as listed |
| `dashboardStateSetRequest` | `{ state }` | the state written into the block's asset object, the instance kept |
| `serviceBindRequest` | `{ serviceId }` | the block bound to the instance (reported by the frame), the state kept |
| `serviceRefreshRequest` | | the backend asked again |

### Calling the apis

**A dashboard calls the apis of its own instance unless it names another**: a call without a target goes to `data.dashboard.serviceId`, which the frame adds, so a dashboard never names its own instance, and it never knows the url of the backend; a call with a target goes to the instance it names ([From a dashboard](#from-a-dashboard)). The example's helpers (`note-db/dashboard/src/service-call.js`) show the whole contract in a few functions:

```js
const result = await onEvent('serviceApiCallRequest', { api: 'noteList', params: { query } });
if (result.code !== 0) { /* -1 failed, -3 no such api, -4 not ready, -5 backend down, -6 timeout */ }

// an async api: the job, then the job asked for until it is done (serviceJobRun)
const started = await onEvent('serviceApiCallRequest', { api: 'reindex', params: {} });
const job = await onEvent('serviceJobGetRequest', { jobId: started.data.jobId, serviceId: started.data.serviceId });   // every 300 ms
// job.data.status === 'done' -> job.data.result is the call's own { code, data, message }

await onEvent('dashboardStateSetRequest', { state: { ...data.state, query } });
```

### Dashboard conventions

- **The frame owns the instance.** A dashboard never offers a choice of its own instance or reads one from its state; it shows the one in `config.service.serviceId`, and is mounted anew for another. The other instances it uses are named by targets, by template unless the reader must choose one.
- **Every call can fail.** A dashboard shows the message of a failed call where the call was asked for, keeps what it showed, and does not retry by itself; -5 needs no message of its own, the head already says it.
- **Local state goes into `dashboardStateSetRequest`**, and only what should be there when the document is opened again; what the instance keeps is asked from the instance. A dashboard that cannot write (`config.state.isWritable` false) still works, without remembering.
- **The ui follows the page's rules**: compact, contenteditable for text that switches to edit mode, confirmations in place (no browser dialogs), no layout jump while loading (`heightMin`).
- **Styles are prefixed with the template's name** (`note-db-…`) and use class selectors only: the module's stylesheet joins the page's. Every instance adds its own stylesheet, keyed by the folder its module is served from, since copies may differ.
- **One react**: a dashboard uses the page's react ([Dashboard module](#dashboard-module)) and bundles everything else it uses.

## Dashboard module

The dashboards of a script are one federated module (module federation, after `react-lazy-load`), built by `@originjs/vite-plugin-federation` in the `dashboard/` folder. **Every instance has its own**: its `dashboard/` is a copy of the template's, served by the backend from the instance's `dashboardRemote.dir`, and loaded by the page per instance (`moduleByServiceId`), so two instances of one template run two modules, which differ once one copy is changed and rebuilt. The template's `dashboard/` is the source the copies come from; the page never loads it. The page is the host but is not built with the federation plugin; it speaks the container contract itself (`lib/doc-service-federation.js`):

```text
const container = await import(`${endpoint}/instance/dashboard/${serviceId}/${entry}?t=${timeBuilt}`)
await container.init(shareScope)          // react, react-dom: the page's own, { [version]: { get, loaded, from: 'host' } }
const factory = await container.get(module)
const module = factory()                  // { NoteDbDashboard, NoteDbConfigDashboard, … }: dashboardList[].export
```

The url carries the build time of the entry, so a dashboard rebuilt while the page is open is a new url and is loaded anew at the next listing; a container is loaded once per url, and a failed load is not kept, so the next attempt loads again. **The page shares `react` and `react-dom`**, and a remote declares them shared with `singleton` and a loose `requiredVersion` (`^19.0.0`), so a dashboard renders with the page's react: hooks, context, and events work across the two. The build of a remote follows from how the page loads it (`note-db/dashboard/vite.config.js`):

- `base: './'` and `build.assetsDir: ''`: every file at the top of `dist/` beside `remoteEntry.js`, because the plugin writes the chunk paths relative to the build root and the backend serves the build under a path the page decides.
- An `index.html` entry: the plugin needs one, even though nothing loads it.
- `build.target: 'esnext'` (top-level await, `import.meta`).
- **The module adds its own stylesheet**: the dashboard module imports its css as text (`?inline`) and adds a `<style>` element once. The plugin's own stylesheet loading joins the stylesheet url wrongly for a page whose host has no dot in its name (`localhost`), so a remote emits no css file of its own.

The build is not part of the repository (`dist/` is ignored); an instance whose module is not built shows `moduleNotBuilt` with what to build (its own `dashboard/`). Building the template's copy first means every instance created afterwards starts with a built one.

## The Services tab

The settings panel has a tab **Services** (`comp-doc/settings/ServiceSettings.jsx`), with the backend's line on top (its status, the number of templates and instances, the refresh button, the problems of its scan), then the two kinds of things in two areas, each with its near-square cards and, below them, the detail of the card chosen there (the two choices are independent):

```text
service backend ● up · 1 template · 2 instances ↻
Service templates     [note-db ● 2 instances]
  template note-db w4wp4t0czko · version w4wp4t0yp9u [+] · versions · status · folder · script ·
  initial config · apis · instances: example notes, reading list        [New instance from note-db]
Service instances
  System              none yet
  Custom              [example notes ● note-db] [reading list ● note-db] [+ New]
  instance example notes w4veemd7i36 · created from note-db (template …, version …) · the current
  version of the template · status · folder · script · apis · the config dashboard
```

- **Service templates**: one card per template (its icon, its name, its status and how many instances were created from it). Its detail: id, current version id with the `+` that records a new one with a note (`templateVersionNew`; the error, if any, beside it), the versions it had, status and message, folder, description, its script's meta, the initial config, the apis, and the instances created from it (with the version each recorded when it is not the current one; a click shows the instance). **New instance from {name}** opens the creation in place (a name, a description; the template is fixed); it is disabled with the reason for a template in `error`.
- **Service instances**: **System**, the page's own features run as services (there are none yet; no feature of the page is a service), and **Custom**, the instances of the backend, one card each (the instance's own icon, its name, its status and template name), and a `+ New` card that opens the same creation with a choice of the template (the template chosen in the other area first). Its detail: id, **created from** (the template's name, a click showing it, the recorded id and version id, and how the template stands now: the same version, a newer one, renamed, or gone), status, folder, description, its own script's meta and apis, and its **config dashboard** (its script's dashboard of purpose `config`), rendered through `RegisteredComp` with placement `serviceSettings`. There the dashboard is bound by the card, not by an asset object: the tab's local handler answers `serviceBindRequest` by choosing the card, and keeps `dashboardStateSetRequest` in memory (`settings.stateByServiceId`).

The creation says what will happen (the template folder copied into `{templateName}-inst-{serviceId}`, the template recorded) and, once created, chooses the new instance's card.

## Creating a dashboard

In edit mode the insert menu has a row **Services**: every dashboard of every template the backend knows (`DocServiceStore.dashboardInsertList`), under `service/{templateName}/{dashboardId}`, named `{script label} · {dashboard label}` with the dashboard's description, found through the search like the components. An entry is asset-only: choosing it creates the dashboard's data as an asset object, bound to no instance, and writes the reference block ([creating a block](doc_page_impl_edit.md#floating-controls), [asset-only components](doc_page_impl_edit.md#asset-only-components)); the reader then chooses the instance in the frame's head. Without a backend the row is absent: a dashboard of a template the page does not know cannot be offered, though one written by hand renders and says what is missing.

## Example and playground

The example template is `note-db` (`example_doc/service-template/w4wp4t0czko--note-db/`): notes in a sqlite database of each instance's folder, with the dashboards `default` (list, search, add, edit in place, delete with an in-place confirmation; the search is the dashboard's state), `config` (the instance's config and the template it was created from, the database's numbers, a setting, and `reindex`, an async api slowed down to three seconds that shows the queue), and `stat`, which also shows the calls between services: it resolves another instance of the template, reads its numbers, and asks its own instance's `noteImport` to copy its notes, which calls the other instance as a service. The templates `aws-connection`, `google-drive`, `cognito-auth` and `postgres-connection` are services meant to serve others ([What an api says about its callers](#what-an-api-says-about-its-callers)); they need accounts of their own, and the example has no instance of them. Two instances created from it are part of the example (`example_doc/service/note-db-inst-*`, each with its own copy of the script and the dashboards; the ignore file of the folder keeps their files and ignores their databases, their builds, and every new instance). [Service Instances](../example_doc/service-instance.md) places four dashboards: two bound to the instances, one bound to an instance no folder holds, one of a template the backend does not have. Its asset objects are tracked, so using them changes them in place (`git restore example_doc/asset` undoes that).

[Playground](../example_doc/playground/playground.md) is a document for trying things out, services and assets alike; its folder is ignored by git with everything in it, so the committed repository shows it as missing until it is created.

## Files

```text
service-backend/server.py              the http server: routes, codes → http status, static files of an instance or a template, shutdown
service-backend/service_runtime.py     ServiceRuntime: config, scan, ServiceScript (a folder's service.py, reloaded
                                       by mtime), ServiceTemplate, ServiceInstance (worker thread + queue, jobs,
                                       unqueued calls), instance_create (the copy), template_version_new, api_call,
                                       target_resolve, call_authorize (the authorization TODO)
service-backend/service_define.py      Service, ServiceContext (caller, service_call), ServiceCaller, ServiceError,
                                       @api, param, returns, expose_build (normalize + check), call checking, OpenRPC
service-backend/service_util.py        ms48 ids, time text, names ({templateId}--{name}, {templateName}-inst-{serviceId}),
                                       yaml read / atomic write
frontend/plugin/doc-service-server.ts  the service section of config.yaml, the forwarding middleware (-5 when down),
                                       the backend's folders (excluded from the source and from reloads)
frontend/plugin/doc-source.ts          docServiceEndpoint export, middleware registration, folder exclusion
frontend/src/lib/doc-service-api.js    fetch client of the forwarded api; a failed fetch is -5
frontend/src/lib/doc-service-federation.js  the container contract: share scope, load per url
frontend/src/store/DocServiceStore.ts  backend status and polling, templates, instances, creation, template versions,
                                       modules per instance, dashboardProblemGet, calls, dashboard state writes,
                                       eventHandle (the service route)
frontend/src/DocPageMdx.jsx            the store, the service route
comp-doc/registry/comp-definition.js   compDefinitionGet: registered definitions, then dashboards
comp-doc/service/service-dashboard-define.js  dashboard component ids, the definition of a dashboard
comp-doc/service/service-dashboard-data.js    the data of a dashboard block (serviceId, state)
comp-doc/service/ServiceDashboardHost.jsx     the frame: head, problems, props and events of the dashboard
comp-doc/service/ServiceParts.jsx      icon, status, refresh, instance select, problem notice
comp-doc/service/DocService.css
comp-doc/settings/ServiceSettings.jsx  the Services tab: backend line, the template area (cards, detail, versions,
                                       New instance), the instance area (system, custom, creation from a template,
                                       detail with its origin, config dashboard)
comp-doc/edit/edit-template.js         the Services entries of the insert menu
example_doc/.doc-page/service-backend.yaml   the example's backend config
example_doc/service-template/          the example's templates: w4wp4t0czko--note-db/ (service-template.yaml, service.py,
                                       icon.svg, dashboard/ the federated module's project); the connections and
                                       the authentication provider that serve other services
example_doc/service/                   the example's instances: note-db-inst-{serviceId}/, each a copy of the template
example_doc/service-instance.md        the demonstration document; playground/ the ignored playground
```

## Future updates

What the present model leaves for later, in the order it would matter:

- **A rigorous origin.** An instance records its template by id, name, and version id, which a person can change or reuse. The record is meant to grow a **content hash** of the template files at the version (computed when a version is recorded, so the backend also notices files changed without a new version) and a **digital signature** of the template's author over it, so an instance can prove what it was created from, and a template from elsewhere can be trusted or refused.
- **Comparing and updating from a template.** With the hash, the Services tab can say which files of an instance differ from its template's version, and from the template's current version; `Update from template` (copying chosen files again, the data kept) and `Recreate` would be explicit steps, never a template change reaching instances by itself. Where a newer script needs another shape of data, the update carries a migration of the instance's state.
- **Templates from instances.** Saving an instance (its script and dashboards, not its data) as a new template, a fork with its own id and versions.
- **Authorization of the calls.** A policy of the backend in `call_authorize`, the end user carried with a call, the dashboards' identity ([Authorization](#authorization)).
- **Calls from any component.** Only dashboards send `serviceApiCallRequest`; a component of the registry that is not a dashboard could call an instance by a target too, as the page.
- **Execution isolation.** Instances share one process today; a template could declare how its instances run (the shared process, a worker, a process of their own, outside the backend), for scripts that are not trusted or that need resources of their own.
- **Backup of an instance.** An instance folder is complete, so a backup is a copy of it; a snapshot that names its template's version (and hash) with its config and data is what restoring needs, on another backend as well.
