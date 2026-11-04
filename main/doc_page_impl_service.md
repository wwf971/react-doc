<!-- Design of the service layer: the entry document. App and infra services, their templates and instances, and where they come from; the rest is split by topic: doc_page_impl_service_backend.md (the backend, its config, its api, what a script exposes), doc_page_impl_service_kernel.md (the service runtime kernel, the calls between services), doc_page_impl_service_storage.md (the storage infra services: sqlite, local-backup), doc_page_impl_service_dashboard.md (the page: reaching the backend, DocServiceStore, dashboards, the Services tab). Parent document: doc_page_impl.md. The edit layer's part (creating a dashboard block) is in doc_page_impl_edit.md; the folder conventions of a doc page are in doc_page_impl_dir.md. -->

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
- An **infra service** serves other services: storage (`sqlite`), backup (`local-backup`), logging (`logging`), a connection to an outside system (`aws-connection`, `postgres-connection`, `google-drive`), an authentication provider (`cognito-auth`). It is reached **by name**, not by instance: a service that needs sqlite says so, and the kernel routes the name to the current instance providing it. An infra service may depend on other infra services in turn (a backup infra on a cloud store).
- A **service template** is the initial state of a service of either kind: a folder with a script (`service.py`, a Python class with the apis), the dashboards (a federated module; optional for an infra service), an icon, and the initial config, and no data. A template is listed, never run. It plays the part of a project scaffold, not of a class: it is what an instance is created from, not what keeps defining it.
- A **service instance** is a running service of either kind: a folder of its own holding a **copy** of everything its template held when it was created, its config, and (for a service that keeps any) its data. **An instance is always created from a template**, records which one, and never reads the template again.
- The **service registry** is everything the backend knows: the templates and the instances of both kinds, found by scanning the folders it is given ([Where templates and instances come from](#where-templates-and-instances-come-from)), kept up to date on every listing and every tick of the kernel. There is one registry, with a part for templates and a part for instances; the kind is a property of each entry, not a second registry.
- What an instance keeps can be offered to others as **objects** of the [object registry](doc_page_impl_obj.md): the template defines types and declares the objects its instances provide, the components of its module that draw them, and what it needs others to provide (`expose.typeList`, `objectProvide`, `compList`, `requireList`); the kernel provides every instance, every template and **the config of every instance** as objects itself. The object registry finds and resolves them, never keeps them: the instance stays their truth.
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

An app instance keeps nothing in its own folder but its copy of the template: it can be deleted and created again, and its todos are still in the sqlite infra service, which versions and checks them out for every consumer, and its backups are still in the local-backup infra service, which keeps them as files outside every instance folder. The kernel starts an app instance only once the infra services it requires are available, so that `start()` can use them. An infra instance keeps the resource it is responsible for in its own folder (the databases of `sqlite`, the records of `logging`) or in a folder it is pointed at (the backups of `local-backup`), and that folder is the thing to keep.

**The kind is declared** in `service-template.yaml` (`kind: app | infra`, app when absent) and recorded in the instance's `service.yaml`. The folder convention keeps the kinds apart for the reader of the disk, and a folder is read as holding one kind: a template or instance whose file says the other kind is a scan problem and is skipped. An infra template's script declares what it provides (`expose.infra`); an app template's script may not.

### Naming a service

Today a service is referred to by a **name string**: an infra service by its infra name (`expose.infra.name` of its script, the template name when absent), a dashboard's template by the template name in its component id (`service/{templateName}/{dashboardId}`), a template target by a template id. The names are unique in the registry (a second template of a name is skipped with a scan problem), which is enough for one backend of a few services, and nothing more: two templates providing the same infra name (a local and a remote sqlite) are told apart by their ids and chosen by the route, and nothing says whether their apis agree.

A more rigorous reference (a contract behind an infra name, an identity of a template) is in [TODO](doc_page_impl_TODO.md#service-reference).

## Where templates and instances come from

The registry reads folders of four origins, and every template and instance carries its origin (`origin: { kind, alias, dir }`):

| origin | folders | what |
| --- | --- | --- |
| `builtIn` | `built-in/service-template-app/`, `built-in/service-template-infra/` of the project | what the package ships: the example app template `note-db`, the built-in infra templates `logging` and `sqlite`, the connections. Templates only, never instances. Found by the backend beside itself (`built-in/` two levels above `service-backend/`), or named by the backend config (`builtIn: path`; `builtIn: false` for none) |
| `package` | `service-template-app/`, `service-template-infra/` of a package the workspace imports ([packages](doc_page_impl_package.md)) | the templates a package carries, at fixed names; never instances. The page syncs the packages it loaded with its doc pages; an instance created from one goes to the main doc page, as for a built-in template |
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

Copying the files isolates the folders, not the execution: instances still run in the one backend process, each in its own worker thread, and a script can still reach whatever the process can (environment, other paths). Trusted local scripts need no more; [TODO](doc_page_impl_TODO.md#service-layer) lists what stronger isolation would take. An instance that should follow a newer template is updated by an explicit step, never by the template changing.

## The documents

The design is split by topic; this document holds the concepts and the folders, and the rest is one document each:

| document | what it covers |
| --- | --- |
| [The backend](doc_page_impl_service_backend.md) | the Python backend and its scan, the backend config, the template and instance files, creating an instance, the http api, and what a service script exposes (`expose`, `@api`, OpenRPC) |
| [The service runtime kernel](doc_page_impl_service_kernel.md) | dependencies, using and routing an infra service, provisioning, health, the lifecycle hooks, the logging infra service; the calls between services (targets, the caller, authorization) |
| [Storage infra services](doc_page_impl_service_storage.md) | what a storage infra exposes, the sqlite infra service, the local-backup infra service |
| [The page: dashboards and the Services tab](doc_page_impl_service_dashboard.md) | reaching the backend, the Vite plugin, `DocServiceStore`, dashboards in the registry, the dashboard frame and module, the Services tab, the example |
| [Objects and Types](doc_page_impl_obj.md) | the object registry of the page and of the backend: the objects and types a template provides, the kernel's objects (instances, templates, configs), the components of a template's module, the calls the kernel makes to an instance's object apis |

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
service-backend/service_object.py      the object registry of the backend: the type registry, the providers (the kernel's,
                                       the instances'), query / resolve / read / update / relations, registrations, caches
                                       (doc_page_impl_obj.md)
service-backend/service_util.py        ms48 ids, time text, names ({templateId}--{name}, {templateName}-inst-{serviceId}),
                                       yaml read / atomic write
built-in/service-template-app/           what the package ships: w4wp4t0czko--note-db/ (service-template.yaml, service.py, icon.svg,
                                       dashboard/ the federated module's project)
built-in/service-template-infra/         w55iiudjrez--logging/, storage/w55iiudkmpr--sqlite/, storage/w5f2xw18q2r--local-backup/ (the three
                                       provisioned by the kernel; local-backup is the one tracked by git, with its service_local_backup.md
                                       and its dashboard/), the connections and the authentication provider that serve other services
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
comp-doc/service/service-comp-define.js, ServiceCompHost.jsx   the components of a template's module beside its
                                       dashboards (compList): service/{templateName}/comp/{compId}, loaded from an instance
comp-doc/service/DocService.css
comp-doc/settings/ServiceSettings.jsx  the Services tab: backend line, templates by kind, the infra routing table, instances by kind
                                       (dependencies, hooks, lifecycle, routes, config dashboard), the logs
comp-doc/edit/edit-template.js         the Services entries of the insert menu
example_doc/.doc-page/service-backend.yaml   the example's backend config (its doc page, the built-in folder found by itself)
example_doc/service-template-app/      the example's own app template: w55iiudjq5y--todo-list/
example_doc/service-app/               the example's app instances: note-db-inst-*/, todo-list-inst-*/, each a copy of its template
example_doc/service-infra/             the infra instances the kernel provisions for the example (ignored by git)
example_doc/.doc-page/service-backup/  the backups of the example's instances, made by its local-backup instance (ignored by git)
example_doc/service-instance.md        the demonstration of templates, instances and dashboards (note-db)
example_doc/service-kernel.md          the demonstration of app and infra services, the kernel, the storage and the logs (todo-list)
```

## Future updates

What the present model leaves for later (a rigorous reference to a service, backup, permissions, updating from a template, a deployed backend, isolation, events) is in [TODO](doc_page_impl_TODO.md#service-layer).
