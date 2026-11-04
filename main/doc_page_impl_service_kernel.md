<!-- Design of the service layer, the kernel: the service runtime kernel (dependencies, routing, provisioning, health, hooks, logging) and the calls between services. Parent document: doc_page_impl_service.md. -->

# Services: The Service Runtime Kernel

The kernel is the part of the backend ([Services: The Backend](doc_page_impl_service_backend.md)) that is no service: what it does for every instance, and how instances reach one another through it. The concepts are in [Services: Design](doc_page_impl_service.md).

## The service runtime kernel

The kernel is what `ServiceRuntime` does beside running the instances (`service_runtime.py`, with `service_kernel.py` for the parts that stand alone: the kernel log, the service folders of a doc page, the route table). It has no folder and no script of its own; its state is the registry in memory, the explicit routes in `service-kernel.yaml`, and the records it writes into every instance folder (`service-record.yaml`). Its jobs, in the order a scan does them:

1. **The registry**: the folders of every origin are read, templates and instances are created, refreshed, restarted or stopped ([Backend](doc_page_impl_service_backend.md#backend)). Problems with a folder are scan problems; problems with a doc page's service file, a route, a provisioning, or a dependency cycle are kernel problems (`kernel.problemList` of `/status`).
2. **Reconcile**: which infra names are **required** (by every enabled instance's dependency list, and by the kernel itself: `logging`), which are **provided** (by the infra instances, through the names their scripts expose), which are required and not provided: those are **provisioned**. Then the **routes** are checked, and the instances **waiting** for a dependency are started when it is available, infra instances first, so that one waiting for another can follow in the same tick.
3. **The log** buffered so far is handed to the logging instance when there is a ready one.

4. **The object registry** (`service_object.py`, [Objects and Types](doc_page_impl_obj.md)): its types are rebuilt when a script changed (the built-in types and those the templates define), and an instance that restarted has its answers forgotten. Its providers are the kernel itself (every instance, template and instance config as an object, and their relations `service.createdFrom`, `service.dependsOn`) and every instance whose script declares `expose.objectProvide`, asked through its object apis in its queue as the caller `kernel`, with the short wait `objectProviderWaitSecond`; an instance that does not answer in time is reported in the completeness of a query, the others are answered. A call into the registry from a service never waits for that service's own queue: it is skipped. Updating an instance's config object writes its `service.yaml` and restarts it, as the Services tab's writes do (`instance_config_set`).

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

Routing is what makes an infra instance replaceable without touching its consumers; it is not what makes the data follow. The sqlite instance a name is routed to keeps the databases of its consumers in its own folder, and routing the name to another instance means the consumers see that instance's databases: an empty one, for a new instance. That is a property of the resource, not of the route, and it is not hidden: the Services tab shows which instance is current, and `storageInfo` of an app service names the instance and the file its data is in. Moving a consumer's database from one instance to another is a storage operation of a later version ([TODO](doc_page_impl_TODO.md#service-deployed-backend)).

### Provisioning

An infra name that is required and that no instance provides is provisioned by the kernel at the next reconcile, when a template provides it with `provision: auto`:

1. the template: among the ready infra templates providing the name with `provision: auto`, the oldest by id (one is enough; a second template of a name is a choice a person makes by creating the instance);
2. the folder: the infra instance folder of the doc page of the first instance requiring the name, else the default infra folder (the default doc page's, or the config's); without one the name is a kernel problem and nothing is provisioned;
3. the instance is created like any other ([Creating an instance](doc_page_impl_service_backend.md#creating-an-instance)), named `{templateName} (auto)` (a number added when taken), with `provision: { mode: auto, infra, requiredBy, time }` in its `service.yaml`: the reader of the disk and of the Services tab knows the kernel made it and for whom.

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

The kernel logs what it does, and every instance logs through it (`self.context.log(level, feature, message, data)`), into the infra service named **`logging`**: a record is `{ time, level: debug | info | warn | error, principal: { kind: kernel | service | page, id }, feature, message, data }`. The **principal** is who the record is about: the kernel, a service instance (by id), the page; the **feature** is which function of it: for the kernel `registry` (folders and doc pages mounted, templates and instances found and gone, scan problems), `lifecycle` (created, started, stopped, restarted, waiting, enabled, deleted), `hook`, `dependency` (lists changed, added at runtime), `route`, `provision`, `scan`; for a service, whatever it names (`storage`, `backup`, `schema`, `import`). The two are what the records are queried by.

The kernel cannot depend on a service to start logging, so it has a **kernel log** of its own (`KernelLog`, `service_kernel.py`): every record goes to stderr (`warn` and `error` always, every level with `isLogVerbose`) and into a bounded buffer, and the last 500 stay in memory for `GET /log/recent`, so the records of a backend without a logging instance are still readable. At the end of every scan the buffer is **flushed** into the current `logging` instance when it is ready (`logWrite`, as the caller `kernel`, in batches), so nothing is lost while it starts, and the kernel never waits for it. A service writing its own records to the logging instance directly (`logWrite`) is written as itself whatever its records claim: the principal of a service's records is the caller the kernel knows.

The built-in template `logging` (`built-in/service-template-infra/w55iiudjrez--logging/`) keeps the records in a sqlite database of its own folder (`log.sqlite`), not in the sqlite infra service: logging depends on nothing and starts first. Its apis: `logWrite(recordList)` (kernel and services), `logQuery({ principalKind, principalId, feature, level, text, timeFrom, timeTo, limit, offset })` (newest first, with the total), `logFacetGet()` (the principals, features and levels the records have, with counts: what the filters of the Logs area offer), `statGet()`, `logPrune(keepDays)`, `logClear()`, `export()`. It is resident: its `run()` prunes the records older than `keepDays` (30) once an hour. It is provisioned by the kernel (`provision: auto`) since the kernel requires it; the Services tab's **Logs** area reads it with target `{ infra: 'logging' }` and falls back to `/log/recent` when there is none.

The audit of what matters and the backup of the records are in [TODO](doc_page_impl_TODO.md#service-log-audit).

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

A template target is matched against what every instance recorded in its `service.yaml`, like a dashboard's template name ([Dashboards in the registry](doc_page_impl_service_dashboard.md#dashboards-in-the-registry)), so it keeps working when the template folder is renamed or gone. **The caller itself is never chosen** by a template target, neither the calling instance nor the instance whose dashboard asks: asking for "an instance of the template" is asking for another one. Among the candidates a `ready` one comes first, then the oldest (by id), so the same instance answers while nothing changes; when none is ready the first is still chosen, so the call fails with its reason (-4), and when there is none the call is -3. A service that must use one particular instance among several keeps its id in its config (`noteServiceId: ''`, empty meaning "by template"), and the reader chooses it there. An infra target is the way to use an infra service; a template target still reaches an infra instance (the connections were written for it, and keep working), without the dependency check and the route.

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

A dashboard calls as the page, through the same events as for its own instance ([Dashboard events](doc_page_impl_service_dashboard.md#dashboard-events)), and adds a target to name another one:

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
