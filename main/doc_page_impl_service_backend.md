<!-- Design of the service layer, the backend: the Python program, its config, the template and instance files, creating an instance, the http api, what a service script exposes. Parent document: doc_page_impl_service.md. -->

# Services: The Backend

The concepts (templates, instances, the two kinds) and the folders they are read from are in [Services: Design](doc_page_impl_service.md); this document is the backend that reads them and runs the instances.

## Backend

The backend is the Python standard library's `ThreadingHTTPServer` and PyYAML (`main/service-backend/requirements.txt`), nothing else: a script brings its own dependencies. It is started with its config file and stopped with Ctrl+C (SIGINT, SIGTERM), which lets every instance finish the api it runs and call its stop hook. The development server starts it this way by itself when `config.yaml` says `service.launch` ([The Vite plugin](doc_page_impl_service_dashboard.md#the-vite-plugin)), so `pnpm run dev` runs both; by hand:

```text
python3 main/service-backend/server.py --config example_doc/.doc-page/service-backend.yaml [--port 45190] [--host 127.0.0.1]
```

`ServiceRuntime` (`service_runtime.py`) is the kernel and the registry. **`scan()` is cheap and runs on every listing and on every tick of the kernel**: the `service.py` of every folder, template or instance, is a `ServiceScript` loaded again when the file changed (by mtime, through `importlib`, into a module named after its folder, so two folders never share a module); a template is read again when its `service-template.yaml` changed; an instance is restarted when its folder, its `service.yaml`, or its own `service.py` changed (its signature), and a folder that is gone stops its instance. A folder added, removed, or edited by hand is therefore seen at the next listing or tick, without restarting the backend. A template is only read: its script is loaded for what it exposes (shown in the Services tab, checked before an instance is created from it), and nothing of it runs. After the folders, the scan **reconciles** ([The service runtime kernel](doc_page_impl_service_kernel.md#the-service-runtime-kernel)).

**One request at a time per instance.** Every running instance has one worker thread and one queue. The thread creates the class of the instance's own script with the instance's context, runs the lifecycle hooks, then takes the calls in the order they came; a call waits behind the ones before it, whatever its kind and whoever sent it (the page, another instance, the kernel). An implementation never sees two calls at once and may keep a connection (sqlite) as a plain attribute. An api declared `isQueued=False` is the one exception: it runs at once in the caller's thread and guards its own state ([What an api says about its callers](doc_page_impl_service_kernel.md#what-an-api-says-about-its-callers)). A sync call is answered when its api is done, queue included, or after `apiWaitSecondMax` with code -6 (the call stays queued and still runs); an async call is answered at once with its job, which runs in the same queue. Stopping puts a sentinel in the queue: the call being run finishes, the ones still waiting are answered -4.

| instance status | meaning |
| --- | --- |
| `ready` | apis are answered |
| `starting` | the start hooks are running; calls wait in the queue |
| `waiting` | not started: an infra service it requires is not available; the kernel starts it when it is |
| `disabled` | `isEnabled: false` in `service.yaml`; calls are refused (-4) |
| `error` | the folder, `service.yaml`, its `service.py`, or a start hook failed or timed out; `message` says why; calls are refused (-4) |

Beside the status, every instance has a **health** the kernel computes ([Health](doc_page_impl_service_kernel.md#health)).

### Backend config

```yaml
# example_doc/.doc-page/service-backend.yaml (paths relative to this file: ../ is the doc page folder)
host: 127.0.0.1                # where the backend listens: the one place the address is written;
port: 45190                    # the development server reads it here to forward to the backend
apiWaitSecondMax: 120          # how long a sync call is waited for, queue included, before -6
reconcileIntervalSecond: 10    # the kernel's own tick (a scan and a reconcile) without the page; 0: listings only
isLogVerbose: false            # every kernel log record on stderr (warn and error always)
objectProviderWaitSecond: 5    # how long the object registry waits for one instance provider (doc_page_impl_obj.md)
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
| its document | `service_{name}.md` (the `-` of the name written `_`): what the template is for the authors of its consumers and dashboards, as `comp_{tag}.md` beside a component ([Groups](doc_page_impl_dir.md#groups-in-a-component-or-template-folder)) | copied with the rest |
| data | none | an infra service: the resource it manages (`data/`, `log.sqlite`); an app service: nothing (`note-db`, which keeps its own database, is the older way) |
| where in its folder | at the top, or in groups of any depth (`connection/cloud/`): any folder not named like a template; reported as `groupPath` | at the top |

Templates are grouped by function in folders of any name, a group in another ([Groups](doc_page_impl_dir.md#groups-in-a-component-or-template-folder)); the backend reads a template folder group by group (`_template_entry_list`), a misnamed template (its files in a folder not named `{templateId}--{name}`) is a scan problem, never a group. A group is no part of a template's identity: its id and name are, and moving it to another group keeps its instances.

A **template name** is lowercase letters, digits, `-` and `_`, starts with a letter or a digit, holds no `--`, and is unique among the templates of the registry (a second folder of the same id or name is skipped), because it is also the middle of a dashboard's component id ([Dashboards in the registry](doc_page_impl_service_dashboard.md#dashboards-in-the-registry)). The `{templateName}` of an instance folder is the template's name when the instance was created, for the reader of the disk; the backend reads only the id, so an instance folder stays as it is when its template is renamed or removed. An **instance name** is a free label (trimmed, not empty, at most 80 characters), unique among the instances when one is created, and kept in `service.yaml` only. A folder whose name has not its form, or a second folder with the same id, is listed in the scan's problems (`GET /status`, `scanProblemList`) and skipped; names starting with a dot are not folders of either kind (a half-created instance is `.creating-{id}`, a deleted one `.deleted-{dirName}-{time}`).

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

A template is `ready` when its file, its `service.py`, and its config check, `error` with the reason otherwise; an instance can only be created from a ready template. The **version id** names the state of the template's files: whoever changes them records a new version (`POST /template/version/new`, with a note; the `+` beside the version in the Services tab), which becomes `versionId` and is appended to `versionList`. The backend does not notice changed files by itself; [TODO](doc_page_impl_TODO.md#service-layer) has the hash that would.

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

`template` is required: an instance without it is in `error`, since every instance is created from a template. Today the record is the template's id, name, and version id, which says where the instance came from as long as nobody reuses a version id for other files; [TODO](doc_page_impl_TODO.md#service-layer) has the hash and signature that would prove it. `service.yaml` is the instance's config, so an instance is reconfigured by editing it (the backend restarts the instance at the next scan), and renamed by editing its `name`. The backend writes it when it creates the instance and when the Services tab changes its dependencies or enables it (the file is the backend's own, comment-free, rewritten whole and atomically: a temporary file renamed over it); a `dependencyList` absent from the file means the script's declaration.

`service-record.yaml` beside it is the kernel's, never edited by hand: whether the `onCreate` hook ran (`timeCreateHook`) and the last twenty hook runs ([Lifecycle and hooks](doc_page_impl_service_kernel.md#lifecycle-and-hooks)). It is state, ignored by git with the instance's data.

### Creating an instance

`POST /instance/create { templateId, name, description?, config?, docPageAlias? }` is the one way a person creates an instance, and it always names a template:

1. the template must be `ready`, and the name free;
2. the config is the template's `config` with the given `config` over it, checked against the template's script; the dependency list is the script's declaration;
3. the folder is chosen by the template's kind: the default instance folder of that kind of the doc page named (`docPageAlias`), else of the template's own doc page, else of the default doc page of the backend config, else the config's default folder of that kind;
4. the template folder is copied, except `service-template.yaml` and what is installed or generated rather than written (`node_modules`, `__pycache__`, temporary files), into `.creating-{serviceId}` in that folder, and `service.yaml` is written there with the template's `{ templateId, name, versionId }`;
5. the folder is renamed `{templateName}-inst-{serviceId}`, so a scan never sees half an instance, and the instance starts at once, or waits for its dependencies.

A built dashboard module (`dashboard/dist/`) is copied with the rest, so an instance of a built template shows its dashboards without a build of its own; its dependencies are not, and building the copy again needs them installed (in its folder, or anywhere above it). The kernel provisions infra instances through the same copy ([Provisioning](doc_page_impl_service_kernel.md#provisioning)).

### Backend api

Every answer is `{ code, data?, message? }` with an http status that follows the code: 0 → 200, -1 → 400, -2 → 403, -3 → 404, -4 → 409, -6 → 504, -7 → 424. The development server adds -5 (503) when it cannot reach the backend ([The Vite plugin](doc_page_impl_service_dashboard.md#the-vite-plugin)).

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
GET  /registry                                { templateList, instanceList, infraList, status, objectTypeList, objectProviderList }:
                                                everything, in one answer (scans)
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
GET  /type/list                              { typeList, problemList }: the Types of the object registry (doc_page_impl_obj.md)
GET  /object/provider/list                    the object providers: the kernel and every instance with objectProvide
POST /object/query     { typeList, text?, filter?, limit?, providerIdList?, isFresh? }   { objectList, isTruncated, completeness }
POST /object/count     { typeList, text?, filter?, providerIdList? }   { providerList: [{ providerId, count, countKind, status }] }:
                                                how many a query would answer, nothing listed (a search's preflight)
POST /object/resolve   { refList, isVerify? }  a descriptor per reference, in order, each with its status
POST /object/read      { ref }   /object/update { ref, patch }   { descriptor, content }, from the provider
POST /object/relation/query { fromRef?, toRef?, typeList?, isFresh? }   { relationList, completeness }
POST /object/register  { descriptorList, namespaceList, isReplace? }   the page's own objects (its namespaces only);
                                                /object/unregister { refList }
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

The object of the class is given a `ServiceContext`: `service_id`, `name`, `kind`, `dir_path` (the instance's folder: its script, and its data when it keeps any), `template` (the record of `service.yaml`, for information), `origin` (the folder the instance was found in: `{ kind, alias, dir }`, with `doc_page_meta_dir_get()` for the `.doc-page/` of its doc page), `config`, `dependency_list`, `path_get(name)` and `job_progress_set(fraction, message)`; `infra(name)` and `infra_require(name)` for the infra services ([Using an infra service](doc_page_impl_service_kernel.md#using-an-infra-service)); `log(level, feature, message, data)` and `health_set(health, message)` for the kernel ([The logging infra service](doc_page_impl_service_kernel.md#the-logging-infra-service), [Health](doc_page_impl_service_kernel.md#health)); and for the calls between instances, `caller` (who calls the api being run) and `service_call`, `service_resolve`, `service_job_get` ([Calls between services](doc_page_impl_service_kernel.md#calls-between-services)).

- **`meta`**: `label` is required; `description`, `author`, `version` (the script's own version for people, default `0.0.0`; not the template's version id), `license`, `homepage`, `icon` (a file of the folder, served at `/template/icon/{templateId}` and `/instance/icon/{serviceId}`), and `tagList` are optional. Other keys are kept.
- **`dependencyList`**: the infra services the service uses, each a name or `{ name, isRequired (true), onUnavailable (report | reject) }`, names unique ([Dependencies](doc_page_impl_service_kernel.md#dependencies)). It is the initial list of every instance created from the template; the instance's own list is in its `service.yaml`.
- **`infra`**: an infra service only (a script of an app template or in an app folder declaring it is an error): `name`, the infra name it provides (lowercase letters, digits, `-`, `_`; the template name when empty), and an optional `storage` ([Storage infra services](doc_page_impl_service_storage.md#storage-infra-services)).
- **`execution`**: `{ mode: passive | resident }`, passive by default. A resident service also runs `run(stop_event)` in a thread of its own ([Lifecycle and hooks](doc_page_impl_service_kernel.md#lifecycle-and-hooks)).
- **`lifecycle`**: `{ hookTimeoutSecond }`, 30 by default: how long a lifecycle hook may run.
- **`configDefineList`**: the shape of an instance's `config`, `[{ key, type: string | integer | number | boolean, default, description }]`. The backend fills the defaults and checks the types of every instance's config and of every template's initial config.
- **apis**: the methods marked `@api(kind, execution, description, params, result)`. They are not listed in `expose`; the decorator is the declaration, next to the code, and `apiList` is built from it (a script that writes `apiList` in `expose` fails to load). The method name is the api name on the wire, so api methods are camelCase like every other name the page sees. `kind` is `query` (reads the state) or `command` (changes it); `execution` is `sync` (answered when done) or `async` (answered with a job; the api reports progress with `self.context.job_progress_set(fraction, message)`); `callerKindList` (who may call it: `page`, `service`, `kernel`) and `isQueued` (whether it waits in the queue) are for the calls between services ([What an api says about its callers](doc_page_impl_service_kernel.md#what-an-api-says-about-its-callers)). `param(name, type, description, default, isRequired, schema)` and `returns(type, description, schema)` use the type names of JSON Schema (`string`, `integer`, `number`, `boolean`, `object`, `array`, `null`) plus `any`; a parameter without a default is required. The backend checks every call against them (an unknown parameter, a missing required one, a value of the wrong type: -1) before the call is queued. An api refuses with `raise ServiceError(code, message)`; any other exception is -1 with its type and message, and a result that is not JSON is a failure of the api.
- **`dashboardList`**: the dashboards, keyed by `id` (a lowercase letter, then letters, digits, `-`), each `{ id, purpose, label, description, export, heightMin }`. `purpose` is `default` (what a document shows when it places the service), `config` (the instance's settings, shown in the [Services tab](doc_page_impl_service_dashboard.md#the-services-tab)), or `other`; **a script that has dashboards has exactly one of purpose `default` and one of purpose `config`**, and any number of others. A script may have none (an infra service worked from the Services tab alone); then it declares no `dashboardRemote` either, and no document can place it. `export` names the dashboard's export in the module, `heightMin` (a css length) is the room the frame keeps for it while it loads.
- **`compList`**: the further components of the module, beside the dashboards: `[{ id, export, label, description, objectView? }]`, the ids one set with the dashboards' (both are named under `service/{templateName}/` on the page: a component `service/{templateName}/comp/{id}`). Today a component of the list is an **object view**, `objectView: { typeList, contextList, priority }`: the page draws with it the objects of those Types, loading it from an instance of the template ([Object views](doc_page_impl_obj.md#object-views)). todo-list carries `TodoCard`, the view of any `core.task`.
- **`dashboardRemote`**: where the federated module of the dashboards and of `compList` is: `dir` (inside the folder), `entry`, `container` (the federation name), `module` (the exposed module); a script with neither declares none. Whether it is built is read on every listing (`dashboardBuild { isBuilt, timeBuilt }`, the mtime of the entry), since dashboards are built while the backend runs.
- **`typeList`**, **`objectProvide`**, **`requireList`**: the script's part in the [object registry](doc_page_impl_obj.md#services). `typeList` the Types the template defines, each `{ id, kind?, label, description, extendList, icon, summaryKeyList }`, ids under the template's name (`todo-list.todo`); `objectProvide` the objects every instance provides, `{ typeList, relationTypeList?, queryFilterList?, cacheSecond? }`, its capabilities (`capabilityList`, normalized) being the object apis the script implements: `objectQuery`, `objectCount` (how many a query would answer: the preflight of a [search](doc_page_impl_obj_search.md#moderation-plan-preflight-bounded-fetch)), `objectResolve`, `objectRead`, `objectUpdate`, `relationQuery`, each answered to the kernel only (`callerKindList` must hold `kernel`; an object api without `objectProvide`, or `objectProvide` without `objectQuery` or `objectResolve`, fails to load); `requireList` what the template needs others to provide, each `{ type }`, `{ objectView, context? }` or `{ comp }` with `isRequired?` and `note?`, resolved on the page and shown in the Services tab.
- **`hookList`** is not declared but reported: the lifecycle hooks the script implements.
- **anything else** a script wants to expose is kept as written under its own key (`sqliteTableList`): the page shows it nowhere, a tool or a dashboard may read it from the `expose` of the instance.

The normalized `apiList` keeps the project's names (`paramList`, `isRequired`, `kind`, `execution`, `callerKindList`, `isQueued`), the same way component exposures do. The same information in a standard form is **OpenRPC** 1.3.2 (`GET /instance/openrpc?serviceId=`, `GET /template/openrpc?templateId=`, `openrpc_document_build`): one method per api, `params` by name with their JSON Schema, `result`, the properties OpenRPC has no field for as extensions, `x-kind`, `x-execution`, `x-callerKindList` and `x-isQueued`, and whose script it is in `info` (`x-serviceId`, `x-templateId`, `x-templateName`, `x-templateVersionId`). A client that speaks OpenRPC reads an instance's apis from there; the page reads the exposure.
