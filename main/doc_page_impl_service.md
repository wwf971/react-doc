<!-- Design of the service layer: app and infra services, their templates and instances, the service runtime kernel, the logging and storage infra services. Parent document: doc_page_impl.md. The edit layer's part (creating a dashboard block) is in doc_page_impl_edit.md; the folder conventions of a doc page are in doc_page_impl_dir.md. -->

# Services: Design

An asset is data: a versioned object that a component reads, which the page can copy, bundle into a build, and resolve before the component renders ([Asset service layer](doc_page_impl_asset.md)). A **service instance** is a running thing: a database, a crawler, a queue of jobs, a connection to an outside system, anything that answers requests and keeps something between them. What it keeps is not the document's and cannot be bundled; the document only places **dashboards** that show and work an instance. The distinction decides everything below:

| | asset object | service instance |
| --- | --- | --- |
| what it is | data, with a history of versions | a process, with state only it can change |
| who reads it | the page resolves it before the component renders | the dashboard asks the instance, through its apis |
| who writes it | the page, through the asset api | the instance itself, when an api asks it to |
| in a build | bundled, read-only | absent: a build has no backend |
| in a document | a reference in place of the block's data | a dashboard block, whose own data (which instance, the dashboard's state) is an asset object |

## The concepts

The layer is made of a few things, each with one job:

- An **app service** serves the documents: it answers the dashboards placed in them and the other services that call it. It is meant to be **stateless**: what it keeps goes into an infra service, so that the instance can be recreated and its data kept, versioned, backed up and restored by the infra. The example `todo-list` is one.
- An **infra service** serves other services: storage (`sqlite`), logging (`logging`), a connection to an outside system (`aws-connection`, `postgres-connection`, `google-drive`), an authentication provider (`cognito-auth`). It is reached **by name**, not by instance: a service that needs sqlite says so, and the kernel routes the name to the current instance providing it. An infra service may depend on other infra services in turn (a backup infra on a cloud store).
- A **service template** is the initial state of a service of either kind: a folder with a script (`service.py`, a Python class with the apis), the dashboards (a federated module; optional for an infra service), an icon, and the initial config, and no data. A template is listed, never run. It plays the part of a project scaffold, not of a class: it is what an instance is created from, not what keeps defining it.
- A **service instance** is a running service of either kind: a folder of its own holding a **copy** of everything its template held when it was created, its config, and (for a service that keeps any) its data. **An instance is always created from a template**, records which one, and never reads the template again.
- The **service registry** is everything the backend knows: the templates and the instances of both kinds, found by scanning the folders it is given ([Where templates and instances come from](#where-templates-and-instances-come-from)), kept up to date on every listing and every tick of the kernel. There is one registry, with a part for templates and a part for instances; the kind is a property of each entry, not a second registry.
- The **service runtime kernel** is the part of the backend that is no service: it maintains the registry, runs the instances and their lifecycle hooks, monitors their health and their dependencies, routes every infra name to its current instance, provisions an infra instance from a template when a name is required and nobody provides it, and writes what it does, and what the instances log, into the **logging infra service**.

```text
browser                                    development server (vite)        service backend (python)
DocServiceStore                            plugin/doc-service-server.ts     server.py + service_runtime.py (the kernel)
  ├─ registry ───────────── GET ─────────► {base}/__doc-service/* ───────► /registry: templates, instances, infra names (scan + reconcile)
  ├─ instanceCreate(template) ── POST ───►   forwarded unchanged ────────► /instance/create: the template folder copied
  ├─ docpage sync ─────────── POST ──────►   the loaded doc pages added ─► /registry/docpage/sync: their service folders mounted
  ├─ moduleLoad(instance) ── import() ───►   backend unreachable: ───────► /instance/dashboard/{serviceId}/remoteEntry.js
  │    federation container (shared react)   { code: -5 } (http 503)
  ├─ eventHandle (route "service")
  │    serviceApiCallRequest ── POST ─────────────────────────────────────► /api/call ──► the instance's queue
  │      target { serviceId } | { templateId } | { infra: name }           /job/get        one worker thread:
  │    serviceJobGetRequest, serviceResolveRequest                          /instance/resolve  one api at a time
  │    serviceBindRequest ─┐                                                     ▲
  │                        │          another instance: context.service_call; an infra: context.infra(name)
  │    dashboardStateSetRequest ─► DocAssetStore.objectUpdate (in place)
  └─ dashboardProblemGet: why a dashboard cannot show                      the kernel: scan, reconcile (provision, route,
                                                                            health), hooks, log ──► the logging infra instance

built-in/service-template-app/{group/…/}{templateId}--{name}/    a doc page: service-template-app/, service-template-infra/   (templates)
built-in/service-template-infra/{group/…/}{templateId}--{name}/              service-app/, service-infra/       (instances)
  service-template.yaml   id, name, kind, provision, versions, config
  service.py, icon.svg    ──── copied when an instance is created ────►  {templateName}-inst-{serviceId}/
  dashboard/ (src, dist)                                                   service.yaml   id, name, kind, template, dependencyList, config
                                                                           service.py, icon.svg, dashboard/   the instance's own
                                                                           service-record.yaml                 the kernel's record (hooks)
                                                                           notes.sqlite | data/{consumer}/     its data, when it keeps any

document block <!--renderComp=service/todo-list/default--> + ```asset```  (data: { serviceId, state })
  └─ ServiceDashboardHost (the frame: icon, title, instance select, status, refresh)
       └─ TodoListDashboard (from the instance's federated module) { data, config, onEvent }
```

### App services and infra services

The two kinds share one mechanism (templates, instances, folders, scripts, apis, the queue, the calls) and differ in how they are used:

| | app service | infra service |
| --- | --- | --- |
| who calls it | the dashboards of documents, other services | app and infra services (and the Services tab) |
| how it is named by a caller | an instance (`{ serviceId }`) or any instance of its template (`{ templateId }`) | its **infra name** (`{ infra: 'sqlite' }`): the kernel chooses the instance |
| its state | none of its own: kept in infra services it depends on | the persistent resource it manages (databases, logs, a signed-in session) |
| created | by a person, from the Services tab | by a person, or **provisioned** by the kernel when its name is required |
| dashboards | one `default` and one `config` at least | optional: an infra service is worked from the Services tab |
| folder of its template / instances | `service-template-app/`, `service-app/` | `service-template-infra/`, `service-infra/` |

An app instance keeps nothing in its own folder but its copy of the template: it can be deleted and created again, and its todos are still in the sqlite infra service, which versions, checks out and (later) backs them up for every consumer. The kernel starts an app instance only once the infra services it requires are available, so that `start()` can use them. An infra instance keeps the resource it is responsible for in its own folder (the databases of `sqlite`, the records of `logging`), and that folder is the thing to back up.

**The kind is declared** in `service-template.yaml` (`kind: app | infra`, app when absent) and recorded in the instance's `service.yaml`. The folder convention keeps the kinds apart for the reader of the disk, and a folder is read as holding one kind: a template or instance whose file says the other kind is a scan problem and is skipped. An infra template's script declares what it provides (`expose.infra`); an app template's script may not.

### Naming a service

Today a service is referred to by a **name string**: an infra service by its infra name (`expose.infra.name` of its script, the template name when absent), a dashboard's template by the template name in its component id (`service/{templateName}/{dashboardId}`), a template target by a template id. The names are unique in the registry (a second template of a name is skipped with a scan problem), which is enough for one backend of a few services, and nothing more: two templates providing the same infra name (a local and a remote sqlite) are told apart by their ids and chosen by the route, and nothing says whether their apis agree.

**TODO** a more rigorous reference: a **contract** an infra name stands for (its apis and their versions, the storage type it promises), declared by the templates that implement it and checked when a dependency is resolved, so that a consumer can require `sqlite@1` and the kernel can refuse a provider that does not implement it; and an **identity** of a template beyond its id and name (a content hash of its version, a signature of its author; [Future updates](#future-updates)), so that an instance can prove what it was created from and a dependency can name a trusted implementation.

## Where templates and instances come from

The registry reads folders of three origins, and every template and instance carries its origin (`origin: { kind, alias, dir }`):

| origin | folders | what |
| --- | --- | --- |
| `builtIn` | `built-in/service-template-app/`, `built-in/service-template-infra/` of the project | what the package ships: the example app template `note-db`, the built-in infra templates `logging` and `sqlite`, the connections. Templates only, never instances. Found by the backend beside itself (`built-in/` two levels above `service-backend/`), or named by the backend config (`builtIn: path`; `builtIn: false` for none) |
| `docPage` | the service folders of a doc page: by convention `service-template-app/`, `service-template-infra/`, `service-app/`, `service-infra/` of the doc page folder, or those its `.doc-page/service.yaml` names ([the doc page folder](doc_page_impl_dir.md#service-folders)) | a doc page's own templates and instances, part of the doc page like its documents and asset folders. The doc pages come from the backend config (`docPageList`) and from the page, which syncs the doc pages it loaded (included ones too) when the backend comes up |
| `folder` | `templateFolderList`, `instanceFolderList` of the backend config, each with a kind | plain folders, outside any doc page |

A doc page laid out by the convention needs no service configuration: its folders are found by their names (a folder that does not exist is simply empty, and is created when an instance is created in it). To keep them elsewhere, or under other names, the doc page writes `.doc-page/service.yaml`:

```yaml
# .doc-page/service.yaml: the service folders of this doc page (paths relative to this file)
templateFolderList:
  - { path: ../service-template-app, kind: app }
  - { path: ../service-template-infra, kind: infra }
instanceFolderList:
  - { path: ../service-app, kind: app, isDefault: true }       # where an app instance of this doc page is created
  - { path: ../service-infra, kind: infra, isDefault: true }   # where an infra instance is created or provisioned
```

The entry may name the file (`service: { file: ./service.yaml }`) or say the doc page has no service folders (`service: false`). The same file is read by the backend (Python, `service_kernel.py`) to mount the folders and by the development server (`plugin/`) to keep them out of the source and to tell the backend which doc pages are loaded ([Doc page source service layer](doc_page_impl_source.md)); both read the convention when the file is absent.

**The page syncs its doc pages.** The backend config names the doc page it is written for (`docPageList`), and runs alone with it. When the page is open, `DocServiceStore` sends `POST {endpoint}/registry/docpage/sync` each time the backend comes up; the development server fills the body with the doc pages it loaded (every root doc page and every included one, with its folder and its service file) and the backend mounts their folders for as long as it runs, after those of its config (a doc page the config names is not mounted twice). A doc page mounted from the Workspace tab for the session is synced the same way, and a doc page the page no longer loads is unmounted at the next sync: its instances stop.

### Why an instance copies its template

Instances of one template could share the template's script, pinned to a template version, with upgrades propagated to them. They do not, on purpose: **two instances never share a script, even when they come from the same template and the same template version and their scripts are the same.** Copying removes a whole class of problems for a system that holds few instances, mostly of different templates, each long-lived:

- an instance is **self-contained**: its folder is the whole service (script, dashboards, config, and for an infra service its data), so it is backed up, moved, or restored by copying one folder, and runs whether or not its template is still there;
- changing a template changes no instance, and changing an instance (its config, its script, its dashboards) changes no other instance and no template; there is no version binding to resolve at start, and no upgrade that reaches instances by surprise;
- every instance loads its own `service.py` into a module of its own and serves its own dashboard module, so no module-level state is shared between instances.

Copying the files isolates the folders, not the execution: instances still run in the one backend process, each in its own worker thread, and a script can still reach whatever the process can (environment, other paths). Trusted local scripts need no more; [Future updates](#future-updates) lists what stronger isolation would take. An instance that should follow a newer template is updated by an explicit step, never by the template changing.

## Backend

The backend is the Python standard library's `ThreadingHTTPServer` and PyYAML (`main/service-backend/requirements.txt`), nothing else: a script brings its own dependencies. It is started with its config file and stopped with Ctrl+C (SIGINT, SIGTERM), which lets every instance finish the api it runs and call its stop hook. The development server starts it this way by itself when `config.yaml` says `service.launch` ([The Vite plugin](#the-vite-plugin)), so `pnpm run dev` runs both; by hand:

```text
python3 main/service-backend/server.py --config example_doc/.doc-page/service-backend.yaml [--port 45190] [--host 127.0.0.1]
```

`ServiceRuntime` (`service_runtime.py`) is the kernel and the registry. **`scan()` is cheap and runs on every listing and on every tick of the kernel**: the `service.py` of every folder, template or instance, is a `ServiceScript` loaded again when the file changed (by mtime, through `importlib`, into a module named after its folder, so two folders never share a module); a template is read again when its `service-template.yaml` changed; an instance is restarted when its folder, its `service.yaml`, or its own `service.py` changed (its signature), and a folder that is gone stops its instance. A folder added, removed, or edited by hand is therefore seen at the next listing or tick, without restarting the backend. A template is only read: its script is loaded for what it exposes (shown in the Services tab, checked before an instance is created from it), and nothing of it runs. After the folders, the scan **reconciles** ([The service runtime kernel](#the-service-runtime-kernel)).

**One request at a time per instance.** Every running instance has one worker thread and one queue. The thread creates the class of the instance's own script with the instance's context, runs the lifecycle hooks, then takes the calls in the order they came; a call waits behind the ones before it, whatever its kind and whoever sent it (the page, another instance, the kernel). An implementation never sees two calls at once and may keep a connection (sqlite) as a plain attribute. An api declared `isQueued=False` is the one exception: it runs at once in the caller's thread and guards its own state ([What an api says about its callers](#what-an-api-says-about-its-callers)). A sync call is answered when its api is done, queue included, or after `apiWaitSecondMax` with code -6 (the call stays queued and still runs); an async call is answered at once with its job, which runs in the same queue. Stopping puts a sentinel in the queue: the call being run finishes, the ones still waiting are answered -4.

| instance status | meaning |
| --- | --- |
| `ready` | apis are answered |
| `starting` | the start hooks are running; calls wait in the queue |
| `waiting` | not started: an infra service it requires is not available; the kernel starts it when it is |
| `disabled` | `isEnabled: false` in `service.yaml`; calls are refused (-4) |
| `error` | the folder, `service.yaml`, its `service.py`, or a start hook failed or timed out; `message` says why; calls are refused (-4) |

Beside the status, every instance has a **health** the kernel computes ([Health](#health)).

### Backend config

```yaml
# example_doc/.doc-page/service-backend.yaml (paths relative to this file: ../ is the doc page folder)
host: 127.0.0.1                # where the backend listens: the one place the address is written;
port: 45190                    # the development server reads it here to forward to the backend
apiWaitSecondMax: 120          # how long a sync call is waited for, queue included, before -6
reconcileIntervalSecond: 10    # the kernel's own tick (a scan and a reconcile) without the page; 0: listings only
isLogVerbose: false            # every kernel log record on stderr (warn and error always)
# builtIn: ../../built-in         # the built-in folder; found beside the backend when absent; false: none
docPageList:                   # doc pages whose service folders are read (convention, or .doc-page/service.yaml)
  - dir: ..
    alias: example
    isDefault: true            # where an instance goes when no doc page is named, and the kernel's own infra
templateFolderList:            # further folders, outside doc pages: {templateId}--{name}/service-template.yaml
  - { path: ../more-templates, kind: app }
instanceFolderList:            # further folders: {templateName}-inst-{serviceId}/service.yaml
  - { path: ../more-instances, kind: infra, isDefault: false }
```

Beside the config file the kernel keeps its own state, `service-kernel.yaml` (the explicit infra routes), written when a route is set and ignored by git.

The folders are named the way the asset service layer names its object folders ([Names](doc_page_impl_asset.md#names)): the id is an ms48 id (base36 of the creation millisecond and 16 random bits) and a separator no id can hold tells the id from the name, so a folder is identified by its name alone and a person browsing the disk sees what it is.

| | template folder | instance folder |
| --- | --- | --- |
| name | `{templateId}--{name}` (`w4wp4t0czko--note-db`) | `{templateName}-inst-{serviceId}` (`note-db-inst-w4veemd7i36`) |
| the id | before the first `--` | after the last `-inst-` (an id holds no `-`) |
| its file | `service-template.yaml` | `service.yaml`, and `service-record.yaml` written by the kernel |
| script, icon, dashboards | `service.py`, the icon, `dashboard/` | its own copies, made when it was created |
| data | none | an infra service: the resource it manages (`data/`, `log.sqlite`); an app service: nothing (`note-db`, which keeps its own database, is the older way) |
| where in its folder | at the top, or in groups of any depth (`connection/cloud/`): any folder not named like a template; reported as `groupPath` | at the top |

Templates are grouped by function in folders of any name, a group in another ([Groups](doc_page_impl_dir.md#groups-in-a-component-or-template-folder)); the backend reads a template folder group by group (`_template_entry_list`), a misnamed template (its files in a folder not named `{templateId}--{name}`) is a scan problem, never a group. A group is no part of a template's identity: its id and name are, and moving it to another group keeps its instances.

A **template name** is lowercase letters, digits, `-` and `_`, starts with a letter or a digit, holds no `--`, and is unique among the templates of the registry (a second folder of the same id or name is skipped), because it is also the middle of a dashboard's component id ([Dashboards in the registry](#dashboards-in-the-registry)). The `{templateName}` of an instance folder is the template's name when the instance was created, for the reader of the disk; the backend reads only the id, so an instance folder stays as it is when its template is renamed or removed. An **instance name** is a free label (trimmed, not empty, at most 80 characters), unique among the instances when one is created, and kept in `service.yaml` only. A folder whose name has not its form, or a second folder with the same id, is listed in the scan's problems (`GET /status`, `scanProblemList`) and skipped; names starting with a dot are not folders of either kind (a half-created instance is `.creating-{id}`, a deleted one `.deleted-{dirName}-{time}`).

```yaml
# {templateId}--{name}/service-template.yaml, written by hand, or by the backend
# (a new version) in this key order
templateId: w55iiudkmpr        # must be the id of the folder name
name: sqlite                   # must be the name of the folder name
description: a sqlite storage infra service; every consumer instance gets a database file of its own
kind: infra                    # app (default) or infra; must be the kind of the folder it is in
provision: auto                # infra only: auto, the kernel creates an instance when the name is required
                               # and none provides it; manual (default), never by itself
timeCreated: 20261029_12000000+09
versionId: w55iiudkmq1         # the current version: what an instance created now records
versionList:                   # the versions the template had, oldest first
  - { versionId: w55iiudkmq1, time: 20261029_12000000+09, note: the built-in sqlite storage infra service }
config:                        # the initial config of an instance, checked against configDefineList
  dataDir: data
  versionKeepMax: 50
```

A template is `ready` when its file, its `service.py`, and its config check, `error` with the reason otherwise; an instance can only be created from a ready template. The **version id** names the state of the template's files: whoever changes them records a new version (`POST /template/version/new`, with a note; the `+` beside the version in the Services tab), which becomes `versionId` and is appended to `versionList`. The backend does not notice changed files by itself; [Future updates](#future-updates) has the hash that would.

```yaml
# {templateName}-inst-{serviceId}/service.yaml, written by the backend in this key order
serviceId: w55iq7goisz         # must be the id of the folder name
name: example todos            # the instance's name
description: the todos of the example doc
kind: app                      # the template's kind; must be the kind of the folder it is in
isEnabled: true                # false: the instance is listed but not run
timeCreated: 20261029_05341103+09
template:                      # the template it was created from: a record, never read by the backend
  templateId: w55iiudjq5y
  name: todo-list              # the template's name then; what a dashboard's component id matches
  versionId: w55iiudjq61       # the template's version then
provision:                     # only on an instance the kernel provisioned (Provisioning)
  { mode: auto, infra: sqlite, requiredBy: 'example todos (w55iq7goisz)', time: … }
dependencyList:                # the infra services the instance uses: its script's declaration when created,
  - { name: sqlite, isRequired: true, onUnavailable: report }   # then whatever the Services tab or the instance set
isDependencyDynamicAllowed: false   # whether the instance may add a dependency at runtime (context.infra_require)
config:                        # the instance's config, checked against its own script's configDefineList;
  titleLengthMax: 200          # a missing key gets its default, a key of the wrong type is an error,
                               # a key the script does not declare is kept
```

`template` is required: an instance without it is in `error`, since every instance is created from a template. Today the record is the template's id, name, and version id, which says where the instance came from as long as nobody reuses a version id for other files; [Future updates](#future-updates) has the hash and signature that would prove it. `service.yaml` is the instance's config, so an instance is reconfigured by editing it (the backend restarts the instance at the next scan), and renamed by editing its `name`. The backend writes it when it creates the instance and when the Services tab changes its dependencies or enables it (the file is the backend's own, comment-free, rewritten whole and atomically: a temporary file renamed over it); a `dependencyList` absent from the file means the script's declaration.

`service-record.yaml` beside it is the kernel's, never edited by hand: whether the `onCreate` hook ran (`timeCreateHook`) and the last twenty hook runs ([Lifecycle and hooks](#lifecycle-and-hooks)). It is state, ignored by git with the instance's data.

### Creating an instance

`POST /instance/create { templateId, name, description?, config?, docPageAlias? }` is the one way a person creates an instance, and it always names a template:

1. the template must be `ready`, and the name free;
2. the config is the template's `config` with the given `config` over it, checked against the template's script; the dependency list is the script's declaration;
3. the folder is chosen by the template's kind: the default instance folder of that kind of the doc page named (`docPageAlias`), else of the template's own doc page, else of the default doc page of the backend config, else the config's default folder of that kind;
4. the template folder is copied, except `service-template.yaml` and what is installed or generated rather than written (`node_modules`, `__pycache__`, temporary files), into `.creating-{serviceId}` in that folder, and `service.yaml` is written there with the template's `{ templateId, name, versionId }`;
5. the folder is renamed `{templateName}-inst-{serviceId}`, so a scan never sees half an instance, and the instance starts at once, or waits for its dependencies.

A built dashboard module (`dashboard/dist/`) is copied with the rest, so an instance of a built template shows its dashboards without a build of its own; its dependencies are not, and building the copy again needs them installed (in its folder, or anywhere above it). The kernel provisions infra instances through the same copy ([Provisioning](#provisioning)).

### Backend api

Every answer is `{ code, data?, message? }` with an http status that follows the code: 0 → 200, -1 → 400, -2 → 403, -3 → 404, -4 → 409, -6 → 504, -7 → 424. The development server adds -5 (503) when it cannot reach the backend ([The Vite plugin](#the-vite-plugin)).

| code | meaning |
| --- | --- |
| 0 | done |
| -1 | bad request, or the api failed (an exception: its type and message) |
| -2 | the caller may not call it: an api answered to services only, a service refusing its caller, an infra service not in the caller's dependency list |
| -3 | not found: the template, the instance, the api, the job |
| -4 | the instance is not ready (waiting, starting failed, disabled, stopped) |
| -5 | the backend cannot be reached (the development server's answer) |
| -6 | a sync call did not finish in `apiWaitSecondMax` |
| -7 | an infra service the call depends on is unavailable: no instance provides the name, or the current one is not ready, or the callee refuses calls while a required dependency is unavailable (`onUnavailable: reject`) |

```text
GET  /status                                  { timeStarted, configPath, templateFolderList, instanceFolderList, templateCount,
                                                instanceCount, scanProblemList, kernel: { builtInDir, kernelStateFile,
                                                docPageList: [{ alias, dir, serviceFile, source: config | page, isDefault,
                                                folderList: [{ path, role, kind, isDefault, isExisting }] }], reconcileIntervalSecond,
                                                reconcileCount, timeReconciled, problemList, log: { bufferCount, droppedCount,
                                                flushedCount, flushError }, loggingServiceId, loggingStatus } }
GET  /registry                                { templateList, instanceList, infraList, status }: everything, in one answer (scans)
GET  /infra/list                              [{ name, serviceId, status: available | unavailable | notProvided, message, isRouteExplicit,
                                                 providerList: [{ serviceId, name, status, isProvisioned }],
                                                 consumerList: [{ serviceId, name, kind: app | infra | kernel, isRequired }],
                                                 templateList: [{ templateId, name, provision, status }], storage }]   (Routing)
GET  /log/recent?limit=                       the kernel's last records, with or without a logging instance (The logging infra service)
GET  /template/list                           [{ templateId, name, kind, description, provision, infraName, timeCreated, versionId,
                                                 versionList, config, status: ready | error, message, folder, dirName, origin, expose,
                                                 dashboardBuild: { isBuilt, timeBuilt } | null }]                    (scans)
GET  /template/get?templateId=
GET  /template/openrpc?templateId=            the apis of the template's script as an OpenRPC document
GET  /template/icon/{templateId}              the file meta.icon of the template's script names
POST /template/version/new  { templateId, note }    a new versionId, appended to versionList; the template
GET  /instance/list                           [{ serviceId, name, description, kind, isEnabled, timeCreated,
                                                 template: { templateId, name, versionId }, provision, config, dependencyList,
                                                 isDependencyDynamicAllowed, dependencyStatusList, infraName, status, message,
                                                 health, healthMessage, healthReported, executionMode, isResidentRunning,
                                                 hookRecordList, timeCreateHook, folder, dirName, origin, expose, dashboardBuild,
                                                 queueLength, apiRunning }]                                           (scans)
GET  /instance/get?serviceId=
GET  /instance/resolve?serviceId= | templateId=&versionId= | infra=  [&dashboardServiceId=]
                                              the instance a call of that target goes to (Targets)
GET  /instance/openrpc?serviceId=             the apis of the instance's own script as an OpenRPC document
GET  /instance/icon/{serviceId}               the instance's own icon
GET  /instance/dashboard/{serviceId}/{path}   a file of the instance's dashboardRemote.dir (no path outside it)
POST /instance/create  { templateId, name, description?, config?, docPageAlias? }   a copy of the template (Creating an
                                                instance); the answer is the new instance
POST /instance/dependency/set { serviceId, dependencyList, isDependencyDynamicAllowed? }   service.yaml rewritten, the
                                                instance restarted with the list (Dependencies)
POST /instance/enable  { serviceId, isEnabled }     isEnabled in service.yaml; the instance started or stopped
POST /instance/delete  { serviceId }          stopped, its onDestroy hook run, its folder renamed .deleted-{dirName}-{time}
POST /infra/route      { name, serviceId | '' }     the name routed to that instance, '' back to the default (Routing)
POST /registry/docpage/sync { docPageList: [{ alias, dir, serviceFile? }] }   the doc pages the page loaded, mounted
POST /api/call         { target, api, params, dashboardServiceId? }   sync: { code: 0, data: what the api returned }
                       target: { serviceId } | { templateId, versionId? } | { infra: name };   async: { code: 0, data: job }
                       { serviceId, api, params } is the short form of target { serviceId }
GET  /job/get?serviceId=&jobId=               job: { serviceId, jobId, api, status: queued | running | done, progress (0..1),
                                                progressMessage, timeQueued, timeStarted, timeDone,
                                                result: the call's own { code, data, message } once done }
```

An instance keeps its last 50 finished jobs. The backend sends no CORS headers on purpose: the page reaches it on its own origin through the development server, and a page of another origin has no business calling it.

## What a service script exposes

The script of a service, `service.py` of a template and of every instance copied from it, says what it exposes the way a component does through `compDefine(Xxx, { expose })` ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)): one declaration next to the code it describes, normalized and checked when the script is loaded (`expose_build` in `service_define.py`), so a wrong shape fails with the place of the mistake (`instance todo-list-inst-w55iq7goisz: expose.dependencyList[0]: the infra service name …`) instead of later in a dashboard. A template whose script fails to load is listed with `status: error` and its message, and no instance is created from it; an instance whose script fails is in `error`. Since every instance has its own copy, what an instance exposes is read from its own script (`expose` of the instance), never from its template's: the two are the same until one of them is changed.

```python
# service.py of a template folder, and of each instance folder copied from it
from service_define import Service, ServiceError, api, param, returns

class TodoList(Service):
    expose = {
        'meta': {'label': 'Todo list', 'description': '…', 'author': '…', 'version': '1.0.0',
                 'license': 'MIT', 'homepage': '', 'icon': 'icon.svg', 'tagList': ['example']},
        'dependencyList': [{'name': 'sqlite', 'isRequired': True, 'onUnavailable': 'report'}],   # or just 'sqlite'
        'configDefineList': [
            {'key': 'titleLengthMax', 'type': 'integer', 'default': 200, 'description': '…'},
        ],
        'execution': {'mode': 'passive'},                 # or resident: run(stop_event) in a thread of its own
        'lifecycle': {'hookTimeoutSecond': 30},
        'dashboardList': [
            {'id': 'default', 'purpose': 'default', 'label': 'Todos', 'export': 'TodoListDashboard', 'heightMin': '12rem'},
            {'id': 'config', 'purpose': 'config', 'label': 'Storage', 'export': 'TodoListConfigDashboard'},
        ],
        'dashboardRemote': {'dir': 'dashboard/dist', 'entry': 'remoteEntry.js',
                            'container': 'serviceTodoList', 'module': './dashboard'},
    }

    def on_create(self): self.context.infra('sqlite').executeScript(script=SCHEMA)   # once in the instance's life
    def start(self): …                                                               # every start
    def stop(self): …

    @api(kind='query', description='the todos, newest first',
         params=[param('limit', 'integer', 'how many at most', default=100)],
         result=returns('object', '{ todoList, total, openCount }', schema={…}))
    def todoList(self, limit=100):
        return self.context.infra('sqlite').query(sql='SELECT * FROM todo ORDER BY todoId DESC LIMIT ?', params=[limit])

SERVICE_CLASS = TodoList
```

An infra script declares, in addition, what it provides:

```python
class Sqlite(Service):
    expose = {
        'meta': {…},
        'infra': {
            'name': 'sqlite',                                   # the infra name; the template name when absent
            'storage': {'type': 'sqlite', 'versioning': 'linear',  # Storage infra services
                        'operationList': ['versionCreate', 'versionList', 'checkout', 'versionDelete', 'export']},
        },
        'configDefineList': [{'key': 'dataDir', 'type': 'string', 'default': 'data', 'description': '…'}],
        # no dashboardList: worked from the Services tab
    }
```

The object of the class is given a `ServiceContext`: `service_id`, `name`, `kind`, `dir_path` (the instance's folder: its script, and its data when it keeps any), `template` (the record of `service.yaml`, for information), `config`, `dependency_list`, `path_get(name)` and `job_progress_set(fraction, message)`; `infra(name)` and `infra_require(name)` for the infra services ([Using an infra service](#using-an-infra-service)); `log(level, feature, message, data)` and `health_set(health, message)` for the kernel ([The logging infra service](#the-logging-infra-service), [Health](#health)); and for the calls between instances, `caller` (who calls the api being run) and `service_call`, `service_resolve`, `service_job_get` ([Calls between services](#calls-between-services)).

- **`meta`**: `label` is required; `description`, `author`, `version` (the script's own version for people, default `0.0.0`; not the template's version id), `license`, `homepage`, `icon` (a file of the folder, served at `/template/icon/{templateId}` and `/instance/icon/{serviceId}`), and `tagList` are optional. Other keys are kept.
- **`dependencyList`**: the infra services the service uses, each a name or `{ name, isRequired (true), onUnavailable (report | reject) }`, names unique ([Dependencies](#dependencies)). It is the initial list of every instance created from the template; the instance's own list is in its `service.yaml`.
- **`infra`**: an infra service only (a script of an app template or in an app folder declaring it is an error): `name`, the infra name it provides (lowercase letters, digits, `-`, `_`; the template name when empty), and an optional `storage` ([Storage infra services](#storage-infra-services)).
- **`execution`**: `{ mode: passive | resident }`, passive by default. A resident service also runs `run(stop_event)` in a thread of its own ([Lifecycle and hooks](#lifecycle-and-hooks)).
- **`lifecycle`**: `{ hookTimeoutSecond }`, 30 by default: how long a lifecycle hook may run.
- **`configDefineList`**: the shape of an instance's `config`, `[{ key, type: string | integer | number | boolean, default, description }]`. The backend fills the defaults and checks the types of every instance's config and of every template's initial config.
- **apis**: the methods marked `@api(kind, execution, description, params, result)`. They are not listed in `expose`; the decorator is the declaration, next to the code, and `apiList` is built from it (a script that writes `apiList` in `expose` fails to load). The method name is the api name on the wire, so api methods are camelCase like every other name the page sees. `kind` is `query` (reads the state) or `command` (changes it); `execution` is `sync` (answered when done) or `async` (answered with a job; the api reports progress with `self.context.job_progress_set(fraction, message)`); `callerKindList` (who may call it: `page`, `service`, `kernel`) and `isQueued` (whether it waits in the queue) are for the calls between services ([What an api says about its callers](#what-an-api-says-about-its-callers)). `param(name, type, description, default, isRequired, schema)` and `returns(type, description, schema)` use the type names of JSON Schema (`string`, `integer`, `number`, `boolean`, `object`, `array`, `null`) plus `any`; a parameter without a default is required. The backend checks every call against them (an unknown parameter, a missing required one, a value of the wrong type: -1) before the call is queued. An api refuses with `raise ServiceError(code, message)`; any other exception is -1 with its type and message, and a result that is not JSON is a failure of the api.
- **`dashboardList`**: the dashboards, keyed by `id` (a lowercase letter, then letters, digits, `-`), each `{ id, purpose, label, description, export, heightMin }`. `purpose` is `default` (what a document shows when it places the service), `config` (the instance's settings, shown in the [Services tab](#the-services-tab)), or `other`; **a script that has dashboards has exactly one of purpose `default` and one of purpose `config`**, and any number of others. A script may have none (an infra service worked from the Services tab alone); then it declares no `dashboardRemote` either, and no document can place it. `export` names the dashboard's export in the module, `heightMin` (a css length) is the room the frame keeps for it while it loads.
- **`dashboardRemote`**: where the federated module of the dashboards is: `dir` (inside the folder), `entry`, `container` (the federation name), `module` (the exposed module). Whether it is built is read on every listing (`dashboardBuild { isBuilt, timeBuilt }`, the mtime of the entry), since dashboards are built while the backend runs.
- **`hookList`** is not declared but reported: the lifecycle hooks the script implements.
- **anything else** a script wants to expose is kept as written under its own key (`sqliteTableList`): the page shows it nowhere, a tool or a dashboard may read it from the `expose` of the instance.

The normalized `apiList` keeps the project's names (`paramList`, `isRequired`, `kind`, `execution`, `callerKindList`, `isQueued`), the same way component exposures do. The same information in a standard form is **OpenRPC** 1.3.2 (`GET /instance/openrpc?serviceId=`, `GET /template/openrpc?templateId=`, `openrpc_document_build`): one method per api, `params` by name with their JSON Schema, `result`, the properties OpenRPC has no field for as extensions, `x-kind`, `x-execution`, `x-callerKindList` and `x-isQueued`, and whose script it is in `info` (`x-serviceId`, `x-templateId`, `x-templateName`, `x-templateVersionId`). A client that speaks OpenRPC reads an instance's apis from there; the page reads the exposure.

## The service runtime kernel

The kernel is what `ServiceRuntime` does beside running the instances (`service_runtime.py`, with `service_kernel.py` for the parts that stand alone: the kernel log, the service folders of a doc page, the route table). It has no folder and no script of its own; its state is the registry in memory, the explicit routes in `service-kernel.yaml`, and the records it writes into every instance folder (`service-record.yaml`). Its jobs, in the order a scan does them:

1. **The registry**: the folders of every origin are read, templates and instances are created, refreshed, restarted or stopped ([Backend](#backend)). Problems with a folder are scan problems; problems with a doc page's service file, a route, a provisioning, or a dependency cycle are kernel problems (`kernel.problemList` of `/status`).
2. **Reconcile**: which infra names are **required** (by every enabled instance's dependency list, and by the kernel itself: `logging`), which are **provided** (by the infra instances, through the names their scripts expose), which are required and not provided: those are **provisioned**. Then the **routes** are checked, and the instances **waiting** for a dependency are started when it is available, infra instances first, so that one waiting for another can follow in the same tick.
3. **The log** buffered so far is handed to the logging instance when there is a ready one.

The kernel ticks by itself every `reconcileIntervalSecond` (10 s), so the backend keeps its registry, provisions, and sees an instance stop or a folder change without the page asking; a listing by the page does the same at once. Stopping the backend stops the tick and every instance.

### Dependencies

Every instance, app or infra, has a **dependency list** of infra names. The template's script declares the initial one (`expose.dependencyList`: what the code was written to use); the instance's `service.yaml` keeps the effective one, written when the instance is created, and changed afterwards in two ways:

- by a person, from the Services tab (`POST /instance/dependency/set`): the list is replaced and the instance restarted with it;
- by the instance itself at runtime, when its `service.yaml` allows it (`isDependencyDynamicAllowed: true`): `self.context.infra_require(name)`, or simply `self.context.infra(name)` for a name not yet in the list, adds the dependency and writes it back to `service.yaml` without a restart; an instance not allowed to gets -2. This is the permission control of dynamic acquisition, coarse on purpose: the person who allows it on an instance allows any name. **TODO** a finer policy: which names an instance may add, decided by the backend config or granted per instance from the Services tab, in the same place as the authorization of calls ([Authorization](#authorization)).

Each entry is `{ name, isRequired, onUnavailable }`:

- **`isRequired`** (true by default) says what the dependency means for the instance: a required one not available makes the instance `unhealthy`, and keeps it from starting at all (`waiting`); an optional one makes it `degraded`.
- **`onUnavailable`** says what the kernel does with the instance's calls while the dependency is unavailable: `report` (the default) does nothing to them, and the call of the infra itself fails with -7 when the service makes it, so that a service handles the failure where it happens instead of checking before every call; `reject` refuses every call of the instance with -7 while a required dependency is unavailable, for a service whose every api needs it.

The kernel computes for each entry its **status** (`dependencyStatusList` of the instance): `available` (the name routes to a ready instance), `unavailable` (it routes to an instance that is not ready: starting, waiting, disabled, in error), `notProvided` (no instance provides it). An infra service's own dependencies are the same mechanism; a cycle among infra services (`a` depends on `b` depends on `a`) is reported as a kernel problem, not refused: the queue-cycle check refuses the call that would wait for itself, and the two instances report each other as unavailable until one starts.

### Using an infra service

A service uses an infra service through its context, by name, and never knows which instance answers:

```python
db = self.context.infra('sqlite')          # an InfraClient; -2 when the name is not in the dependency list (and not addable)
rows = db.query(sql='SELECT * FROM todo WHERE todoId = ?', params=[todo_id])['rowList']   # any api of the infra, by keyword
db.call('execute', {'sql': '…', 'params': […]})                                             # the same, as a mapping
db.resolve()                                # the instance the calls go to, as listed ({ serviceId, name, status, … })
db.is_available()                           # whether a ready instance provides the name

self.context.infra_require('object-store', is_required=False)   # at runtime, when isDependencyDynamicAllowed
```

A call goes through the same path as every call between instances (`api_call` with target `{ infra: name }`): the kernel resolves the name to its current instance ([Routing](#routing-an-infra-service)), checks that the name is in the caller's dependency list (-2 otherwise), checks the api's `callerKindList`, and queues the call; the infra instance reads the consumer as `self.context.caller` and keys what it keeps by it, so a consumer reaches its own resource and no other's. An infra name with no ready instance answers -7, which `service_call` raises as a `ServiceError`; an api that lets it through fails with it, and the dashboard shows the message where the call was asked for.

The page can call an infra service by name too (`POST /api/call` with target `{ infra: name }`, or a dashboard's `serviceApiCallRequest` with that target): the Services tab reads the logging service that way, and an infra api meant for the page (the consumers of a sqlite instance) says so in its `callerKindList`. An api the page should never see (credentials) lists `service` alone.

### Routing an infra service

For every infra name the kernel knows (required by someone, provided by an instance, or provided by a template), `GET /infra/list` says where it goes: the **current instance** (`serviceId`), its status (`available`, `unavailable`, `notProvided`), the providers (every instance providing the name, any status), the consumers (the instances requiring it, the kernel included), the templates providing it, and the storage the current instance exposes.

The current instance is the **explicit route** when there is one (`POST /infra/route { name, serviceId }`, kept in `service-kernel.yaml` beside the backend config; `''` removes it), else the **default route**: among the providers, a ready one first, one a person created before one the kernel provisioned, the oldest first, so the same instance answers while nothing changes. An explicit route to an instance that is gone, or does not provide the name, is a kernel problem and the default route is used. The route is read at every call, so a name moves to another instance the moment the route is set, or the moment the current one stops being ready.

Routing is what makes an infra instance replaceable without touching its consumers; it is not what makes the data follow. The sqlite instance a name is routed to keeps the databases of its consumers in its own folder, and routing the name to another instance means the consumers see that instance's databases: an empty one, for a new instance. That is a property of the resource, not of the route, and it is not hidden: the Services tab shows which instance is current, and `storageInfo` of an app service names the instance and the file its data is in. Moving a consumer's database from one instance to another is a storage operation of a later version ([Future updates](#future-updates)).

### Provisioning

An infra name that is required and that no instance provides is provisioned by the kernel at the next reconcile, when a template provides it with `provision: auto`:

1. the template: among the ready infra templates providing the name with `provision: auto`, the oldest by id (one is enough; a second template of a name is a choice a person makes by creating the instance);
2. the folder: the infra instance folder of the doc page of the first instance requiring the name, else the default infra folder (the default doc page's, or the config's); without one the name is a kernel problem and nothing is provisioned;
3. the instance is created like any other ([Creating an instance](#creating-an-instance)), named `{templateName} (auto)` (a number added when taken), with `provision: { mode: auto, infra, requiredBy, time }` in its `service.yaml`: the reader of the disk and of the Services tab knows the kernel made it and for whom.

A name required by nobody is never provisioned, and a name provided by an instance that is not ready is not provisioned again: there is a provider, it is unavailable, and that is reported, not hidden by a second, empty one (an infra instance in error because its database is damaged must be seen, not replaced). The instances waiting for the name start once the provisioned one is ready: at the tick after, at the latest. The kernel requires `logging` itself, so a backend with the built-in folder provisions a logging instance into its default infra folder the first time it runs. In the example, the kernel provisions `logging` and `sqlite` into `example_doc/service-infra/`, which git ignores but for its `.gitignore`: a fresh checkout provisions its own, and nothing of a run is committed by accident.

### Health

Beside its lifecycle status, every instance has a **health** the kernel computes on every listing (`health`, `healthMessage`): `unhealthy` when the instance is not running (`error`, `disabled`, `waiting`) or a required dependency is not available; `degraded` when it is starting, an optional dependency is not available, or the instance says so itself; `healthy` otherwise. The instance's own word comes from `self.context.health_set('degraded' | 'unhealthy' | 'healthy' | '', message)` (a connection it cannot renew, a disk nearly full) and is reported beside the kernel's (`healthReported`); the kernel never lowers a health the instance raised, and never trusts `healthy` from an instance whose dependency is missing.

Health is information, not enforcement: a degraded instance answers its calls, and the kernel steps in only where the instance asked it to (`onUnavailable: reject`). The Services tab shows the health of every instance and the dependency each one lacks; the dashboard frame shows the lifecycle status.

### Lifecycle and hooks

An instance exists (its folder) independently of whether it runs (its worker thread): the **instance lifecycle** is created → (enabled | disabled) → deleted, the **execution lifecycle** is waiting → starting → ready → stopped, and restarts happen as often as the folder changes. The script takes part through hooks, methods of `Service` it overrides, each run in the worker thread, recorded, and limited in time:

| hook | method | when |
| --- | --- | --- |
| `onCreate` | `on_create()` | once in the life of the instance, before its first `start()`: what is made once (a schema in its storage). Recorded in `service-record.yaml`; it runs again only when that record is gone |
| `onStart` | `start()` | every start: open what the apis use |
| `run` | `run(stop_event)` | a resident instance only: a thread of its own, started after `start()`; it returns when `stop_event` is set (an hourly prune, a watcher, a queue consumer) |
| `onStop` | `stop()` | every stop: close what `start()` opened; after `run()` returned (5 s at most after the event is set) |
| `onDestroy` | `on_destroy()` | once, when the instance is deleted, after `stop()`: what its data in infra services should become. By default nothing: data is kept unless the service removes it on purpose |

Every run is a **hook record** `{ hook, status: running | done | failed | timedOut, timeStarted, timeDone, second, message }`, kept in memory, in the instance's `service-record.yaml` (the last twenty) and logged; the Services tab shows them. A hook that raises has failed; `onCreate` or `onStart` failing puts the instance in `error` with the reason, and the other hooks' failures are recorded and logged. A hook running past `expose.lifecycle.hookTimeoutSecond` has **timed out**: the record says so at once, `onCreate` and `onStart` put the instance in `error` (a start that takes too long is a failed start, even if it returns later: the record notes that it finished late, the outcome stays), and the thread is not killed, since Python cannot, so a hook that never returns holds the instance's worker: the message says which hook. Hooks are meant to be idempotent: `onCreate` may run again after a crash before its record was written, and `onStart` runs at every restart.

An **execution mode** is declared, not inferred: `expose.execution.mode` is `passive` (the instance only answers apis; the default) or `resident` (it also runs `run()`). A passive service may still send events and run long apis; resident is for a service that has something to do when nobody asks (the preset `logging` prunes old records in its `run()`).

Deleting an instance (`POST /instance/delete`) stops it, runs `onDestroy`, drops any explicit route to it, and renames its folder `.deleted-{dirName}-{time}`: a name the scan skips, so the instance is gone from the registry while its folder, data included, stays for a person to remove or restore by renaming it back. Disabling (`POST /instance/enable { isEnabled: false }`) stops it and keeps it listed. Both are logged.

### The logging infra service

The kernel logs what it does, and every instance logs through it (`self.context.log(level, feature, message, data)`), into the infra service named **`logging`**: a record is `{ time, level: debug | info | warn | error, principal: { kind: kernel | service | page, id }, feature, message, data }`. The **principal** is who the record is about: the kernel, a service instance (by id), the page; the **feature** is which function of it: for the kernel `registry` (folders and doc pages mounted, templates and instances found and gone, scan problems), `lifecycle` (created, started, stopped, restarted, waiting, enabled, deleted), `hook`, `dependency` (lists changed, added at runtime), `route`, `provision`, `scan`; for a service, whatever it names (`storage`, `schema`, `import`). The two are what the records are queried by.

The kernel cannot depend on a service to start logging, so it has a **kernel log** of its own (`KernelLog`, `service_kernel.py`): every record goes to stderr (`warn` and `error` always, every level with `isLogVerbose`) and into a bounded buffer, and the last 500 stay in memory for `GET /log/recent`, so the records of a backend without a logging instance are still readable. At the end of every scan the buffer is **flushed** into the current `logging` instance when it is ready (`logWrite`, as the caller `kernel`, in batches), so nothing is lost while it starts, and the kernel never waits for it. A service writing its own records to the logging instance directly (`logWrite`) is written as itself whatever its records claim: the principal of a service's records is the caller the kernel knows.

The built-in template `logging` (`built-in/service-template-infra/w55iiudjrez--logging/`) keeps the records in a sqlite database of its own folder (`log.sqlite`), not in the sqlite infra service: logging depends on nothing and starts first. Its apis: `logWrite(recordList)` (kernel and services), `logQuery({ principalKind, principalId, feature, level, text, timeFrom, timeTo, limit, offset })` (newest first, with the total), `logFacetGet()` (the principals, features and levels the records have, with counts: what the filters of the Logs area offer), `statGet()`, `logPrune(keepDays)`, `logClear()`, `export()`. It is resident: its `run()` prunes the records older than `keepDays` (30) once an hour. It is provisioned by the kernel (`provision: auto`) since the kernel requires it; the Services tab's **Logs** area reads it with target `{ infra: 'logging' }` and falls back to `/log/recent` when there is none.

**TODO** the records' backup and the audit of what matters: an audit group (permissions changed, instances deleted, routes set) with a stricter retention than the operational records, and the backup of the log database through a storage infra, once there is one to back up to.

## Storage infra services

An infra service that keeps data for its consumers **exposes its storage** (`expose.infra.storage`): the `type` of store (`sqlite`, later `folder`, `object-store`), its `versioning` (`none`, `linear`; a tree or a graph of versions is a later model), the `operationList` it implements among `versionCreate`, `versionList`, `checkout`, `versionDelete`, `export`, `backup`, and a `description`. A consumer knows what it stands on: the Services tab shows the storage of every infra name, and an app service's own dashboard can say where its data is and what can be done with it. The operations are apis of the infra service, with the names above, each about the calling consumer's own resource; an app service performs them on its data without holding it, and exposes what it wants of them as its own apis (`todo-list` exposes `versionCreate`, `versionCheckout`, `versionDelete`, `storageInfo`).

The built-in template `sqlite` (`built-in/service-template-infra/storage/w55iiudkmpr--sqlite/`) gives **every consumer a database of its own**, in the instance's folder:

```text
sqlite-inst-{serviceId}/data/{consumerServiceId}/current.sqlite      the consumer's database
                                                 /version/{id}.sqlite  a version: a consistent copy (sqlite's backup api)
                                                 /version.yaml         the versions, oldest first: { versionId, time, note, size }
```

The consumer is the caller the kernel knows, never a parameter: a service reaches its own database and no other's; the page names the consumer it inspects (`consumerServiceId`), for the Services tab. The sql apis keep sqlite's own model (`query`, `execute`, `executeBatch` in one transaction, `executeScript` for a schema), rather than a generic object api, because a service that chose sqlite should have sqlite: its transactions, its indexes, its SQL. The storage operations: `versionCreate(note)`, `versionList()`, `checkout(versionId)` (the current database is kept as a version first, `before checkout of …`; the consumer's connection is closed and opened again around the copy, so no statement sees half a file; the consumer's `start()` runs its schema again, since a version may predate it), `versionDelete`, `export()` (the path of the file, for a copy by hand), `databaseInfo()`; `versionKeepMax` (50) prunes the oldest versions. Every api runs in the instance's queue, one at a time, so one open connection per consumer is enough, and a long checkout makes the other consumers wait: acceptable for a local backend of a few services, and the reason a second sqlite instance can be created and routed for a consumer that needs its own ([Routing](#routing-an-infra-service)).

The storage operations are deliberately a storage layer's: `checkout` is not a read, it is a state change of the resource with lifecycle consequences, and it belongs to the infra service that holds the connection, not to the app service that asked for it.

## Calls between services

Some services exist to serve others: the infra services above, and among them the **connections** (`aws-connection`, `postgres-connection`, `google-drive`), which hold the sign-in and the secrets of an outside system so that the services allowed to use them get what they need without holding a secret of their own, and the **authentication provider** (`cognito-auth`), which verifies the users of an application for the services that serve them. Instances call one another, and a dashboard may call any instance, not only its own. Every call, whoever sends it, names a **target** and is made by a **caller**:

```text
caller: who calls, set by the backend               target: what the call names            the instance that answers
  page      an http request (POST /api/call),          { serviceId }               ──►  that instance
            + dashboardServiceId: whose dashboard      { templateId }              ──►  an instance created from that template,
  service   an instance: self.context.service_call     { templateId, versionId }  ──►  (at that version), never the caller itself
  kernel    the kernel (its log records)               { infra: name }             ──►  the instance the name is routed to
```

### Targets

A target names one instance, any instance of a template, or an infra service:

| target | the instance that answers |
| --- | --- |
| `{ serviceId }` | that instance, whatever its state (one not ready answers -4) |
| `{ templateId }` | an instance that recorded that template when it was created |
| `{ templateId, versionId }` | an instance created from that template at that version |
| `{ infra: name }` | the current instance of the name ([Routing](#routing-an-infra-service)); none, or one not ready: -7 |

A template target is matched against what every instance recorded in its `service.yaml`, like a dashboard's template name ([Dashboards in the registry](#dashboards-in-the-registry)), so it keeps working when the template folder is renamed or gone. **The caller itself is never chosen** by a template target, neither the calling instance nor the instance whose dashboard asks: asking for "an instance of the template" is asking for another one. Among the candidates a `ready` one comes first, then the oldest (by id), so the same instance answers while nothing changes; when none is ready the first is still chosen, so the call fails with its reason (-4), and when there is none the call is -3. A service that must use one particular instance among several keeps its id in its config (`noteServiceId: ''`, empty meaning "by template"), and the reader chooses it there. An infra target is the way to use an infra service; a template target still reaches an infra instance (the connections were written for it, and keep working), without the dependency check and the route.

### The caller

The backend sets the caller; a request never says who it is:

- **`page`**: every http request, from the page through the development server or from any other http client. The page adds `dashboardServiceId`, the instance whose dashboard asks; it is kept, not verified (every dashboard runs in the one page).
- **`service`**: a call made by an instance with `self.context.service_call` or through `self.context.infra(name)`; its `service_id` is that instance's.
- **`kernel`**: the kernel, writing its log records into the logging instance.

The callee reads it as `self.context.caller` (`kind`, `service_id`, `dashboard_service_id`, `principal_get()`) while its api runs: a connection answers the consumers it allows by the id the backend gives, never by an id in the params, and the sqlite infra keys the databases by it. `caller` is `None` outside an api (the hooks, `run()`, a thread of the service's own).

### From a service

```python
class NoteDb(Service):
    @api(kind='command', params=[param('sourceServiceId', 'string', '…', default='')], …)
    def noteImport(self, sourceServiceId=''):
        target = {'serviceId': sourceServiceId} if sourceServiceId else {'templateId': self.context.template['templateId']}
        source = self.context.service_resolve(target)                  # the instance, as listed: { serviceId, name, … }
        note_list = self.context.service_call({'serviceId': source['serviceId']}, 'noteList', {'limit': 50})['noteList']
        …

credentials = self.context.service_call({'infra': 'aws-connection'}, 'credentialsGet')     # an infra, by name
job = self.context.service_call(target, 'reindex')                       # an async api: its job
self.context.service_job_get(job['serviceId'], job['jobId'])
```

`service_call` answers what a sync api returned, or the job of an async one, and raises `ServiceError` with the call's own code and message when it fails; an api that lets it raise fails with them. A call between instances takes the same path as a call of the page, `api_call` in `service_runtime.py`:

```text
api_call(target, api, params, caller)
  -> target_resolve(target, caller)            the instance; -1 a bad target, -3 none, -7 an infra name not available
  -> not ready: -4; no such api: -3
  -> call_authorize(caller, instance, api, target)   -2 when refused (Authorization)
  -> the callee's dependencies with onUnavailable reject: -7 while a required one is unavailable
  -> params checked against the api            -1
  -> isQueued false: run now, in the caller's thread
     else the instance is in the call's chain: -1 (its queue would wait for itself)
     else queued: a sync call waits apiWaitSecondMax at most (-6), an async call answers its job
```

**Queues and cycles.** An api that calls another instance holds its own queue until the answer comes: the queue of A waits for B's. If the call came back (A → B → A, or A calling itself), A's queue would wait for itself until the call times out. The caller carries the chain of instances the call passed through, and a queued api of an instance already in it is refused at once (-1) instead.

### What an api says about its callers

Two options of `@api`, checked when the script is loaded like the others:

- **`callerKindList`**: who may call it, `['page', 'service', 'kernel']` by default. `['service']` is an api for other instances only, never answered to the page, for what must not reach a browser: credentials, a verified user. `['page', 'kernel']` is one for the Services tab (the consumers of a sqlite instance). A caller of another kind is refused with -2.
- **`isQueued`**: `True` by default. `False` runs the api at once in the caller's thread (the http request's, or the calling instance's), beside whatever the queue runs: for an api many callers use and that must not wait behind a long one (a sign-in that waits for the user, a long statement). The method guards what it touches with locks; `context.caller` and the current job are per thread, so two calls running at once do not see each other's. An async api is always queued (it is a job of the queue), and an unqueued api is never refused as a cycle, since it waits for no queue.

The built-in infra services meant to serve others use them this way; each decides by itself which callers it serves:

| template | what it serves to other instances | how the caller is checked |
| --- | --- | --- |
| `sqlite` | the sql apis and the storage operations, queued | the caller's own database, keyed by its id; the page names a consumer |
| `logging` | `logWrite`: kernel and services; the queries: everyone | a service writes as itself |
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
// an infra service by name: the records of the logging service
const log = await onEvent('serviceApiCallRequest', { api: 'logQuery', params: { limit: 20 }, target: { infra: 'logging' } });
// a job belongs to the instance that runs it
await onEvent('serviceJobGetRequest', { jobId: job.jobId, serviceId: job.serviceId });
```

The page sends the dashboard's instance as `dashboardServiceId`, so a template target never resolves to it. An api answered to services only is refused to a dashboard (-2), whichever instance the dashboard belongs to: a dashboard that needs one asks its own instance, whose api makes the call as a service (the stat dashboard of `note-db` reads another instance itself, and asks its own instance's `noteImport` to copy from it; the storage dashboard of `todo-list` asks its own instance's `versionCreate`, which asks the sqlite infra for its own database).

### Authorization

What is checked today is what an api declares (`callerKindList`), what a service calling an infra name declared (its dependency list), and what a service checks by itself (the consumer lists of the connection templates). Every call, from the page, from instances and from the kernel alike, passes one function after its target is resolved and before it is queued, **`ServiceRuntime.call_authorize(caller, instance, api_define, target)`**, which answers -2 when it refuses; it is where a policy of the backend goes. **TODO**:

- **A policy of the backend**: which caller may call which instance and api, and which infra names an instance may add at runtime, kept in the backend config or declared by the callee's script and recorded per instance, so the consumer lists the templates keep by themselves and the `isDependencyDynamicAllowed` switch become one mechanism, shown in one place of the Services tab.
- **The end user behind a call**: a page request is the page, not a user. A credential (a session of `cognito-auth`) would be taken by the backend from the http request, never from params, and carried by the caller to every instance the call passes through, so a service can ask who the user is without being handed a session id by its caller; the principal of a log record would then be the user.
- **The dashboards' identity**: `dashboardServiceId` is a claim of the page; all dashboards share one page, so a dashboard calling as another cannot be told apart until the page signs what each dashboard sends.
- **Resolution and jobs**: a target by template would skip the instances that refuse the caller, and a job would be read by its caller only (today, by anyone who knows its id).

## The Vite plugin

The page reaches the backend through the development server, never directly. `plugin/doc-service-server.ts` reads the `service` section of `config.yaml` and adds one middleware that forwards `{base}/__doc-service/*` to the backend unchanged (method, body, status, headers); when the backend cannot be reached it answers `{ code: -5, message }` with http 503, the one code the page reads as "backend down". One route is the plugin's own: `POST {base}/__doc-service/registry/docpage/sync`, whose body it builds from the doc pages it loaded (every root and included doc page, its folder and its service file) before forwarding ([Where templates and instances come from](#where-templates-and-instances-come-from)).

```yaml
# config.yaml
service:
  backendConfigFile: ../example_doc/.doc-page/service-backend.yaml # the backend's config: its address and folders
  launch: true                    # optional: the development server starts the backend
  # python: python3               # optional: the interpreter of the launch
  # backend: http://host:port     # optional: another address over the file's (alone: a backend without a known config)
```

**The address is written once**, as `host` and `port` of the backend config ([Backend config](#backend-config)): the backend listens there and the plugin forwards there (`http://{host}:{port}`, the loopback for `0.0.0.0`; the backend's defaults `127.0.0.1:45190` when the file has none). `service.backend` overrides it for a backend that does not run with that file; a section needs one of the two. With `launch` (which needs `backendConfigFile`), the development server runs `{python} main/service-backend/server.py --config {backendConfigFile}` as it starts, unless something answers at the address already (a backend started by hand is used as it is). Its output goes to the server's terminal; Ctrl+C reaches it with the server, and the server's exit stops it otherwise; a restart of the server (a change of the vite config) keeps it. A launch that fails (no interpreter, the port taken) is a warning, and the page says "backend down".

The service folders of every loaded doc page (the convention ones, or those of its `.doc-page/service.yaml`) are not documents: the source scan skips them like `.doc-page/`, the asset folders and the component folders, and a change in them (a sqlite journal, a dashboard build) never reloads the page or regenerates the manifest ([Doc page source service layer](doc_page_impl_source.md)). `backendConfigFile` is read for the same reason, for the plain folders the backend config lists outside doc pages. The virtual module exports `docServiceEndpoint`, the url of the forwarded api during `vite`, and the empty string in a build or without a `service` section; the host passes it as `config.service.endpoint` of `DocPageMdx` ([Consumer setup](doc_page_impl_detail.md#consumer-setup)). Without an endpoint `DocServiceStore` has no backend (`backendStatus: 'none'`), and every dashboard says so.

## DocServiceStore

`DocServiceStore` (`store/DocServiceStore.ts`) knows what the backend's registry last said, creates instances from templates, works the instances from the Services tab (their dependencies, enabling, deletion, the route of an infra name, the logs), loads the dashboard modules of the instances, tells a dashboard what keeps it from showing, and answers the dashboards' events.

- `backendStatus`: `none` (no endpoint: a build, or no `service` section), `loading` (the first answer is awaited), `up`, `down` (the development server answered -5); `backendMessage` says why, `backendInfo` is the backend's `/status`, `kernel` its `status.kernel` (the doc pages mounted with their service folders, the reconcile tick and count, `problemList`, the state of the kernel log: `bufferCount`, `flushedCount`, `droppedCount`, `flushError`, `loggingServiceId`, `loggingStatus`).
- `templateList`, `instanceList`, `infraList`: the last registry, read in **one call** (`GET /registry`) by `refresh()`: the templates (listed, never run; each with `kind`, `origin`, `provision`, `infraName`), the instances (each with `kind`, `origin`, `provision`, `dependencyList`, `dependencyStatusList`, `health`, `executionMode`, `hookRecordList`, …) and the routing table of the kernel, one entry per infra name required, provided or templated (`{ name, serviceId, status: available | unavailable | notProvided, isRouteExplicit, providerList, consumerList, templateList, storage }`). `templateGet`, `templateGetByName`, `instanceGet`, `infraGet(name)`, `templateListOfKind(kind)`, `instanceListOfKind(kind)` (`app` | `infra`), `instanceListOfTemplate(templateId)` (the instances created from a template, by the id they recorded), `instanceListOfTemplateName(name)` (the instances a dashboard of that template name may show, by the name they recorded). `refresh()` runs at start, then again every 15 s while the backend is up (so a backend stopped, or an instance stopping or turning `waiting`, is seen without a call failing first) and every 5 s while it is down (so the dashboards come back by themselves when it is started). A call answered -5 marks the backend down at once; a call answered -3, -4 or -7, or any answer while it was down, asks for the registry again.
- **The doc pages synced into the kernel**: whenever the backend turns `up` (the first answer, or up again after `down`) the store posts `registry/docpage/sync` with an empty body (`docPageSync()`); the development server fills it with the doc pages the page loaded, so the kernel reads their service folders too (temporary mounts included). Any failure is kept quiet and the sync is tried again at the next turn-up. When the store is given the source store (`options.sourceStore`, the part it reads: `docPageAliasMain`, `docPageList`), a change of the workspace's doc page list syncs again at once (a mobx reaction); a sync whose answer lists other doc pages than the kernel knew makes the registry be asked again, for the templates they hold.
- The writes of the Services tab, each with its pending state (`{ status: idle | submitting | error, message }`) in `settings` and the registry asked again after success: `instanceCreate({ templateId, name, description?, config?, docPageAlias? })` (`settings.create`; the instance goes to the instance folder of its kind of the doc page named, else of the template's own doc page, else the backend's default; for a **built-in** template, shipped by the package and of no doc page, the store passes the page's main doc page `docPageAliasMain` unless told otherwise, so the instance is created in the current doc page's folder; the new instance's card is chosen), `templateVersionNew(templateId, note)` (`settings.versionNew`), `instanceDependencySet(serviceId, dependencyList, isDependencyDynamicAllowed?)` (`settings.dependencySet`; `dependencyList` items are a name or `{ name, isRequired?, onUnavailable?: report | reject }`; the backend restarts the instance), `instanceEnableSet(serviceId, isEnabled)` (`settings.enableSet`), `instanceDelete(serviceId)` (`settings.delete`; the backend stops the instance, runs its `onDestroy` hook and renames its folder `.deleted-{dirName}-{time}`, keeping its data; the chosen card is cleared when it was this one), `infraRouteSet(name, serviceId | '')` (`settings.routeSet`; `''` goes back to the default route, the oldest ready provider).
- **Logs**: `logQuery(query)` and `logFacetGet()` call the `logging` infra service with the target `{ infra: 'logging' }` (`api/call`, apis `logQuery` / `logFacetGet`); when that answers **-7** (no instance provides `logging`, or it is not ready) they fall back to the kernel's own buffer (`GET /log/recent`), filtered and faceted in the store. `query` is `{ principalKind?, principalId?, feature?, level? (the lowest), text?, timeFrom?, timeTo?, limit = 50, offset? }`. The last result is `settings.log`: `{ status: idle | loading | done | error, source: logging | kernel, recordList (newest first), total, facet: { principalList, featureList, levelList }, query, message }`; only the answer of the last query sent is kept. `serviceLogLevelList` is `debug, info, warn, error`.
- `moduleByServiceId`: the dashboard module of each instance, `{ status: loading | done | error, module, message, entryUrl }`, loaded once per build ([Dashboard module](#dashboard-module)); an infra instance without dashboards (`dashboardRemote` null) has none.
- `settings`: the Services tab: the template chosen and the instance chosen (one per area; choosing an instance clears the pending states of the instance writes), the pending states above, the last log query, the state of the config dashboards shown there (in memory: the tab is no document).
- `dashboardInsertList`: every dashboard of every template that can be used, then those of instances whose template name no template has any more, for the insert menu ([Creating a dashboard](#creating-a-dashboard)).
- `ServiceTarget`, what a call names, is `{ serviceId }`, `{ templateId, versionId? }` or **`{ infra: name }`** (the current instance providing an infra name); a dashboard may use any of them as `data.target` of `serviceApiCallRequest` / `serviceResolveRequest` unchanged ([Calls between services](#calls-between-services)).

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
| `serviceApiCallRequest` | `{ api, params, target? }` | a sync api: the call's own result, `{ code: 0, data }` or its failure; an async api: `{ code: 0, data: job }`. without `target`, the dashboard's own instance ([From a dashboard](#from-a-dashboard)) |
| `serviceJobGetRequest` | `{ jobId, serviceId? }` | `{ code: 0, data: job }` (status, progress, the result once done); `serviceId` names the instance of a job that is not the dashboard's own (`job.serviceId`) |
| `serviceResolveRequest` | `{ target }` | `{ code: 0, data: instance }`: the instance a call of the target goes to, as listed |
| `dashboardStateSetRequest` | `{ state }` | the state written into the block's asset object, the instance kept |
| `serviceBindRequest` | `{ serviceId }` | the block bound to the instance (reported by the frame), the state kept |
| `serviceRefreshRequest` | | the backend asked again |

### Calling the apis

**A dashboard calls the apis of its own instance unless it names another**: a call without a target goes to `data.dashboard.serviceId`, which the frame adds, so a dashboard never names its own instance, and it never knows the url of the backend; a call with a target goes to the instance it names ([From a dashboard](#from-a-dashboard)). The example's helpers (`note-db/dashboard/src/service-call.js`, copied by `todo-list`) show the whole contract in a few functions:

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
- **Service templates** (overview cards, a view each): two groups, **App templates** and **Infra templates**, one card per template (its icon, its name, a kind badge, an origin badge: `built-in` = shipped by the package, `page {alias}` = a doc page's service folder, `folder` = a plain folder of the backend config, the folder as tooltip; an infra template with `provision: auto` has an `auto` badge; its status and how many instances were created from it). Its detail: id and kind, **origin** (badge and folder path), current version id with the `+` that records a new one with a note (`templateVersionNew`; the error, if any, beside it), the versions it had, status and message, description, its script's meta; for an infra template **provides** (the infra name and the provision mode, explained) and **storage** (`expose.infra.storage`: type, versioning, operations, description); the declared **dependencies** (`expose.dependencyList`, with `optional` / `reject when unavailable`), **execution** mode (with the hook timeout), the **hooks** the script implements (`expose.hookList`), the initial config, the apis, and the instances created from it (with the version each recorded when it is not the current one; a click shows the instance). **New instance from {name}** opens the creation in place (a name, a description; the template is fixed); it is disabled with the reason for a template in `error`.
- **Infra routes**: the routing table of the kernel, one row per `infraList` entry: the name (with its storage type as a badge, the storage described in the tooltip), its status (`available` / `unavailable` / `not provided`, the message as tooltip), the **current instance** (a link opening its view; an `auto` badge when the kernel provisioned it; an `explicit` badge when the route was made current from the tab), the providers count (the providers listed in the tooltip), the consumers (links to their cards, `?` after an optional one; `the kernel` for the kernel's own `logging`), and the templates that provide the name (links, with `(auto)` for `provision: auto`).
- **Service instances** (overview cards, a view each): groups **App instances** and **Infra instances** (the former System / Custom groups are gone: the page's own features are no services, and an infra instance provisioned by the kernel is marked `auto` instead), one card each (the instance's own icon, its name, its kind badge, an `auto` badge for a provisioned one or its origin badge otherwise, then its lifecycle status dot, its **health ring** — `healthy` green, `degraded` amber, `unhealthy` red, `healthMessage` as tooltip — and the status word, `waiting` included in the kernel's blue); a `+ New` card in the App group opens the creation with a choice of the template, app and infra templates in two option groups (the template chosen in the other area first). Its detail: id, kind, `auto · required by …` for a provisioned instance, **created from** (the template's name, a click showing it, the recorded id and version id, and how the template stands now: the same version, a newer one, renamed, or gone), **origin** (badge and folder path), status (with the message, and `disabled` when it is), **health** (ring, word, message; what the script reports when it differs), **execution** mode (`passive` / `resident`, whether the resident thread is running, the queue length and the api running), description, its own script's meta; for an infra instance **provides** (the name, its status and providers count), **storage**, **route** (whether it is the current instance of the name — `default` or `explicit` — or which one is, with **Make current** (`infraRouteSet(name, serviceId)`, only for a ready instance) or **Default route** (`infraRouteSet(name, '')`, when the route is explicit)) and **consumers** (links to the instances depending on the name, the kernel included). Then:
  - **Dependencies**: a table of the effective `dependencyList`, each with its status from `dependencyStatusList` (`available` / `unavailable` / `not provided`, the message as tooltip), the instance the name is routed to (a link opening its view), a `required` checkbox, a `when unavailable` select (`report` / `reject`) and a remove button, edited in place as a draft: a name is added from a text box with the infra names the registry knows (`infraList[].name`) as completion, or typed; `dynamic allowed` toggles `isDependencyDynamicAllowed`; **Save** (enabled while the draft differs, with the remark that saving restarts the instance) calls `instanceDependencySet`, **Reset** drops the draft; a name not saved yet shows `not saved`. The editor is mounted again when the backend's list changes, so a saved list shows as it is now.
  - **Hooks**: the `hookRecordList` as a compact table (hook, status, when, seconds, message), latest first, the latest 10 (the count of all beside the title), with `timeCreateHook` in the title.
  - **Lifecycle**: **Disable** / **Enable** (`instanceEnableSet`), and **Delete**, which asks in place (the instance is stopped, its `onDestroy` hook runs, its folder is kept as `.deleted-{dirName}-{time}`) before `instanceDelete`.
  - the apis of its own script, and its **config dashboard** (its script's dashboard of purpose `config`), rendered through `RegisteredComp` with placement `serviceSettings`. There the dashboard is bound by the card, not by an asset object: the tab's local handler answers `serviceBindRequest` by opening that instance, and keeps `dashboardStateSetRequest` in memory (`settings.stateByServiceId`). An infra instance without dashboards says so instead.
- **Logs**: the records of the kernel log, newest first: filters for the principal (from `logFacetGet`: `kernel`, each service by its instance name with its id, `page`; with counts), the feature (from the facets), the lowest level, a text (searched in the message and the data; sent on Enter or when the box is left), a limit; a line saying where the records come from (the logging infra instance by name, or the kernel's own buffer while no logging instance answers) and how many of the total are shown; a table (time, level, principal, feature, message, data — the data folded into one line with the whole JSON as tooltip, unfolded by a click); a refresh button in the title. The table keeps its room while a query runs, so the area does not jump; the facets and the first query are asked once when the tab is first shown with the backend up.

The creation says what will happen (the template folder copied into `{templateName}-inst-{serviceId}` of the instance folder of the template's kind, of which doc page, and the dependencies the instance will wait for when a required one is not available, which the kernel provisions from an `auto` template) and, once created, opens the new instance's view. When several doc pages are mounted, an instance of a doc page's template goes to that doc page, an instance of a built-in template to the page's main doc page; no choice is asked in the form.

Every card of the tab is one `ServiceCard` with the same five slots in the same order (icon, name, group, badges, status), each a row of the card list's grid (`grid-template-rows: subgrid`): a row of slots is as tall as its tallest slot among the cards of that row, and an empty slot keeps the row, so a name on two lines, a group path or a wrapped badge line moves every card of the row alike and the slots of neighbouring cards always line up. The tab's tables, badges and small texts use the shared classes (`doc-badge-outline`, `doc-button`, the muted texts) and the tab's own `doc-service-table` grid (`comp-doc/service/DocService.css`): a text column wraps, a table whose fixed columns do not fit the panel scrolls sideways rather than widening it.

## Creating a dashboard

In edit mode the insert menu has a row **Services**: every dashboard of every template with dashboards the backend knows (`DocServiceStore.dashboardInsertList`), under `service/{templateName}/{dashboardId}`, named `{script label} · {dashboard label}` with the dashboard's description, found through the search like the components. An entry is asset-only: choosing it creates the dashboard's data as an asset object, bound to no instance, and writes the reference block ([creating a block](doc_page_impl_edit.md#floating-controls), [asset-only components](doc_page_impl_edit.md#asset-only-components)); the reader then chooses the instance in the frame's head. Without a backend the row is absent: a dashboard of a template the page does not know cannot be offered, though one written by hand renders and says what is missing.

## Example and playground

The package ships its templates in `built-in/`: the app template `note-db` (`built-in/service-template-app/notes/w4wp4t0czko--note-db/`), notes in a sqlite database of each instance's folder (the older way: a service keeping its own state), with the dashboards `default` (list, search, add, edit in place, delete with an in-place confirmation; the search is the dashboard's state), `config` (the instance's config and the template it was created from, the database's numbers, a setting, and `reindex`, an async api slowed down to three seconds that shows the queue), and `stat`, which also shows the calls between services: it resolves another instance of the template, reads its numbers, and asks its own instance's `noteImport` to copy its notes, which calls the other instance as a service; and the infra templates (`built-in/service-template-infra/`): `logging` and `sqlite`, provisioned by the kernel, and the connections `aws-connection`, `google-drive`, `cognito-auth` and `postgres-connection`, which need accounts of their own, so the example has no instance of them.

The example doc page has a template of its own, `todo-list` (`example_doc/service-template-app/productivity/task/w55iiudjq5y--todo-list/`): a stateless app service on the sqlite infra service, with the dashboards `default` (the todos) and `config` (its database in the infra: dependency status, versions, checkout). Its instances and those of `note-db` are in `example_doc/service-app/` (two of `note-db`, one of `todo-list`, each with its own copy of the script and the dashboards; the ignore file of the folder keeps their files and ignores their databases, their builds, their records and every new instance); the kernel provisions `sqlite` and `logging` into `example_doc/service-infra/`, ignored but for its `.gitignore`. [Service Instances](../example_doc/service-instance.md) places four `note-db` dashboards: two bound to the instances, one bound to an instance no folder holds, one of a template the backend does not have; [App Services, Infra Services and the Kernel](../example_doc/service-kernel.md) places the two `todo-list` dashboards and walks through the kernel. Their asset objects are tracked, so using them changes them in place (`git restore example_doc/asset` undoes that).

[Playground](../example_doc/playground/playground.md) is a document for trying things out, services and assets alike; its folder is ignored by git with everything in it, so the committed repository shows it as missing until it is created.

## Files

```text
service-backend/server.py              the http server: routes, codes → http status, static files of an instance or a template, shutdown
service-backend/service_runtime.py     ServiceRuntime: the kernel and the registry. config (built-in folder, doc pages, folders), scan,
                                       ServiceScript (a folder's service.py, reloaded by mtime), ServiceTemplate (kind, provision,
                                       infra name), ServiceInstance (worker thread + queue, jobs, unqueued calls, hooks with timeout,
                                       resident run thread, service-record.yaml), reconcile (required / provided names, provisioning,
                                       routes, waiting instances), dependency status and health, instance_create / dependency_set /
                                       enable_set / delete, infra_route_set, docpage_sync, api_call, target_resolve (infra targets),
                                       call_authorize (dependency check, the authorization TODO), the log flush, the reconcile thread
service-backend/service_kernel.py      KernelLog (buffer, stderr, recent, flush), the service folders of a doc page
                                       (.doc-page/service.yaml or the convention), InfraRouteTable (explicit and default routes)
service-backend/service_define.py      Service (the hooks), ServiceContext (caller, infra(), infra_require(), log(), health_set(),
                                       service_call), InfraClient, ServiceCaller (page, service, kernel), ServiceError, @api, param,
                                       returns, expose_build (meta, dependencyList, infra + storage, execution, lifecycle, dashboards
                                       optional), call checking, OpenRPC
service-backend/service_util.py        ms48 ids, time text, names ({templateId}--{name}, {templateName}-inst-{serviceId}),
                                       yaml read / atomic write
built-in/service-template-app/           what the package ships: w4wp4t0czko--note-db/ (service-template.yaml, service.py, icon.svg,
                                       dashboard/ the federated module's project)
built-in/service-template-infra/         w55iiudjrez--logging/, w55iiudkmpr--sqlite/ (provisioned by the kernel), the connections
                                       and the authentication provider that serve other services
frontend/plugin/doc-service-server.ts  the service section of config.yaml, the forwarding middleware (-5 when down), the docpage
                                       sync route, the backend's folders (excluded from the source and from reloads)
frontend/plugin/doc-source.ts          docServiceEndpoint export, middleware registration, folder exclusion
frontend/src/lib/doc-service-api.js    fetch client of the forwarded api; a failed fetch is -5
frontend/src/lib/doc-service-federation.js  the container contract: share scope, load per url
frontend/src/store/DocServiceStore.ts  backend status and polling, the registry (templates, instances, infra names, kernel),
                                       docpage sync, creation, template versions, dependencies, enable, delete, routes, logs,
                                       modules per instance, dashboardProblemGet, calls, dashboard state writes,
                                       eventHandle (the service route)
frontend/src/DocPageMdx.jsx            the store, the service route
comp-doc/registry/comp-definition.js   compDefinitionGet: registered definitions, then dashboards
comp-doc/service/service-dashboard-define.js  dashboard component ids, the definition of a dashboard
comp-doc/service/service-dashboard-data.js    the data of a dashboard block (serviceId, state)
comp-doc/service/ServiceDashboardHost.jsx     the frame: head, problems, props and events of the dashboard
comp-doc/service/ServiceParts.jsx      icon, status, refresh, instance select, problem notice
comp-doc/service/DocService.css
comp-doc/settings/ServiceSettings.jsx  the Services tab: backend line, templates by kind, the infra routing table, instances by kind
                                       (dependencies, hooks, lifecycle, routes, config dashboard), the logs
comp-doc/edit/edit-template.js         the Services entries of the insert menu
example_doc/.doc-page/service-backend.yaml   the example's backend config (its doc page, the built-in folder found by itself)
example_doc/service-template-app/      the example's own app template: w55iiudjq5y--todo-list/
example_doc/service-app/               the example's app instances: note-db-inst-*/, todo-list-inst-*/, each a copy of its template
example_doc/service-infra/             the infra instances the kernel provisions for the example (ignored by git)
example_doc/service-instance.md        the demonstration of templates, instances and dashboards (note-db)
example_doc/service-kernel.md          the demonstration of app and infra services, the kernel, the storage and the logs (todo-list)
```

## Future updates

What the present model leaves for later, in the order it would matter:

- **A rigorous reference to a service** ([Naming a service](#naming-a-service)): a contract behind an infra name (apis, versions, storage promises), declared by the templates implementing it and checked when a dependency is resolved; a content hash of a template's files at a version (computed when a version is recorded, so the backend also notices files changed without a new version) and a digital signature of the template's author over it, so an instance can prove what it was created from, and a template from elsewhere can be trusted or refused.
- **Backup and migration of a consumer's data**: the `backup` storage operation, implemented by a storage infra on top of another infra (a cloud object store: the sqlite infra depending on it is what the dependency mechanism is for), with the backup status reported as part of the storage (last backup, verified, pending changes), since reliability is a state to observe, not a flag; and moving a consumer's database from one sqlite instance to another when a name is rerouted.
- **A policy of permissions** ([Authorization](#authorization), [Dependencies](#dependencies)): which caller may call what, which infra names an instance may add at runtime and with which scope, in one place, with the end user behind a page request carried through the calls and into the log's principal.
- **Comparing and updating from a template.** With the hash, the Services tab can say which files of an instance differ from its template's version, and from the template's current version; `Update from template` (copying chosen files again, the data kept) and `Recreate` would be explicit steps, never a template change reaching instances by itself. Where a newer script needs another shape of data, the update carries a migration of the instance's state.
- **Templates from instances.** Saving an instance (its script and dashboards, not its data) as a new template, a fork with its own id and versions.
- **Calls from any component.** Only dashboards send `serviceApiCallRequest`; a component of the registry that is not a dashboard could call an instance by a target too, as the page.
- **Execution isolation.** Instances share one process today; a template could declare how its instances run (the shared process, a worker, a process of their own, outside the backend), for scripts that are not trusted or that need resources of their own; a hook that does not return could then be killed instead of recorded.
- **Events.** The lifecycle changes, the dependency changes and the log records share one envelope today only in the log; a subscription (a dashboard told that its instance restarted, a service told that its dependency came back) would be the next channel beside the calls.
