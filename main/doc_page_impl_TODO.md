<!-- The one list of what the design leaves for later. Parent document: doc_page_impl.md -->

# TODO

What the design of the page leaves for later, in one place. The design documents (`doc_page_impl_xxx.md`) describe what exists; where something is missing they say so in a short line and point here, so a missing feature is written down once, with its reasons, and not scattered as notes through the documents.

How the list is kept (also in `AGENTS.md`):

- An item says **what is missing**, **why it would matter** and **what already exists to start from**, with a link to the section of the design document it belongs to. It does not hold a plan of work.
- When a request matches an item, the agent says so and asks the user to confirm that the item is what they mean before building it.
- After the work, an item that is fully done is **removed**, and its design goes into the design document as the description of what exists; an item partly done is **rewritten** to say what is still missing.
- A new gap found while working is added here, under the functional group it belongs to, instead of a TODO paragraph in a design document.

## Packages

- <a id="package-registry-import"></a>**Importing node kinds between registries.** A diagram component of a package has one fixed node registry, written in code ([Node Registries](../package/cloud-dev-vis/doc/card-diagram.md#node-registries)); a combination of kinds of two series (Power Platform cards beside the cards of another platform in one diagram, a doc page adding a kind of its own) is a registry written in code today. A mechanism declaring a combination in data, per component type or per block, would make that a configuration. The registry mechanism (`nodeRegistryBuild`) and the kinds as values are the place to start.
- <a id="package-doc-page"></a>**A doc page naming the packages it needs.** Only a workspace (or `config.yaml` beside `docEntry`) imports packages ([The package system](doc_page_impl_package.md)); a doc page using `DiagramER` relies on the workspace it is deployed in to import cloud-dev-vis. A doc page declaring its packages (in its entry, beside its component folders) would keep it self-contained, the workspace merging what its doc pages need.
- <a id="package-source"></a>**Packages from elsewhere than a folder.** A package is named by the path of its folder; a package from a registry, a git repository or a published archive, with a version, would need a resolver beside `docPackageSpecListRead`.
- <a id="package-backend-config"></a>**Packages of a backend started alone.** The service backend learns the packages from the page's sync; its own config (`service-backend.yaml`) names doc pages but no packages, so a backend started without the page does not see their templates.
- <a id="package-dependency-collect-reload"></a>**Reloading a dependency extractor.** The extractors manifests name (`dependencyCollect`) are loaded when the configuration is resolved; a new or changed one needs a restart of the development server ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)).

## Settings panel

- <a id="settings-as-mdx"></a>**The settings panels as MDX documents.** The tabs of the settings panel are built in code from config items (`ConfigPanel`) and custom components (the Workspace graph, the Services tab). Written as MDX documents of a built-in doc page, with components for their parts, they would get everything a document has: blocks that open in the block popup, in-place editing, a layout an author changes without code. The Workspace graph already opens in the block popup through `BlockPopupSurface` with a `popupKey`, the step a block of such a document would take anyway.

## Config

- <a id="config-declaration-edit"></a>**Adding and removing config keys and declarations from the page.** The doc page layer edits a value a declaration already holds; adding a key to a declaration, removing one, and adding a declaration are written in the files ([The doc page layer](doc_page_impl_config.md#the-doc-page-layers)). The yaml utilities that insert and remove keys in place are the place to start ([YAML utilities](doc_page_impl_yaml_utils.md)).

## Editing

- <a id="edit-undo"></a>**Undo and redo.** Every write of the edit layer is already recorded with the texts before and after (`DocEditStore.historyRecord`, [History records](doc_page_impl_edit.md#history-records)); what is missing is the routes that write a record back (`historyUndoRequest` / `historyRedoRequest` through the router's `dispatch`, [Extending the layer](doc_page_impl_event.md#extending-the-layer)), refusing where the file is no longer the text after.

## Events and component state

- <a id="event-subscription"></a>**Subscriptions: events delivered to components.** The event layer carries reports *from* components and answers them; a component wanting to be told when its asset object changes asks (`assetRefreshRequest`, [Changes made by others](doc_page_impl_mdx_comp.md#changes-made-by-others)). A subscription needs the second direction: a component registers for `{ type, subject }`, a domain publishes what it observes (the asset service layer on `doc-asset-change`), the router delivers until the component unmounts ([Extending the layer](doc_page_impl_event.md#extending-the-layer)). The same channel would carry the service events below.
- <a id="state-two-tabs"></a>**Component state across browser tabs.** Two browser tabs of one page keep separate state objects; keeping those of one key in step needs a channel (`BroadcastChannel`, a websocket), the one subscriptions would use; the key format is already the address ([Extending the layer](doc_page_impl_mdx_comp_state.md#extending-the-layer)).

## Asset service layer

- <a id="asset-remote-store"></a>**Remote stores and a local cache.** The page has one store, `local`; a remote store answering the same api over the network, and a local cache of it whose versions are never the truth, are planned, and references already name their store ([Stores, objects, versions](doc_page_impl_asset.md#stores-objects-versions)).

## Api registry

In the order they would matter ([Unified api registry](doc_page_impl_api.md)):

- <a id="api-registry"></a><a id="api-hotkey-client-map"></a>**Keys edited from the page.** The keyboard maps are files of the package, the doc pages and the workspace, and the host's; the reader can only pick a map of a doc page ([Where the maps are](doc_page_impl_api_hotkey.md#where-the-maps-are)). A client map kept in the browser above the stack, edited in the API tab (a key, an api chosen from the registry), would be the counterpart of the client config layer; `DocHotkeyStore.mapListStack` takes one more map.
- <a id="api-job"></a>**An api that is a job.** An api answers within the call ([Core concepts](doc_page_impl_api.md#core-concepts)); a long operation (a build, a scan of every document) has no form yet. The jobs of the service backend (`serviceJobGetRequest`, polled) are the model: an api returning a job id, and `api/jobGet` to follow it.
- <a id="api-remote-build"></a>**Remote calls without the development server.** A built page keeps its apis for the page's own ui only: the bridge is a route of the development server ([Remote callers](doc_page_impl_api.md#remote-callers)). A page served otherwise would need the same bridge in its server, with the authorization a page on the network needs (the question of [a deployed backend](#service-deployed-backend)).

## Service layer

In the order they would matter ([Service layer](doc_page_impl_service.md)):

- <a id="service-reference"></a>**A rigorous reference to a service.** A service is referred to by a name string today ([Naming a service](doc_page_impl_service.md#naming-a-service)). Missing: a **contract** behind an infra name (its apis and their versions, the storage type it promises), declared by the templates implementing it and checked when a dependency is resolved, so a consumer can require `sqlite@1` and the kernel can refuse a provider that does not implement it; and an **identity** of a template beyond its id and name: a content hash of its files at a version (computed when a version is recorded, so the backend also notices files changed without a new version) and a signature of its author, so an instance can prove what it was created from and a template from elsewhere can be trusted or refused.
- <a id="service-backup"></a>**Backup and migration of a consumer's data.** The `backup` storage operation, implemented by a storage infra on top of another infra (a cloud object store, which the sqlite infra would depend on), with the backup status reported as part of the storage (last backup, verified, pending changes), since reliability is a state to observe, not a flag; and moving a consumer's database from one sqlite instance to another when a name is rerouted.
- <a id="service-log-audit"></a>**The audit and the backup of the logs.** An audit group (permissions changed, instances deleted, routes set) with a stricter retention than the operational records, and the backup of the log database through a storage infra once there is one to back up to ([The logging infra service](doc_page_impl_service.md#the-logging-infra-service)).
- <a id="service-permission"></a>**A policy of permissions.** Which caller may call what, which infra names an instance may add at runtime and with which scope, in one place, with the end user behind a page request carried through the calls and into the log's principal ([Authorization](doc_page_impl_service.md#authorization), [Dependencies](doc_page_impl_service.md#dependencies)).
- <a id="service-template-update"></a>**Comparing and updating from a template.** With the hash above, the Services tab could say which files of an instance differ from its template's version and from the template's current version; `Update from template` (copying chosen files again, the data kept) and `Recreate` would be explicit steps, never a template change reaching instances by itself; where a newer script needs another shape of data, the update carries a migration of the instance's state.
- <a id="service-template-from-instance"></a>**Templates from instances.** Saving an instance (its script and dashboards, not its data) as a new template, a fork with its own id and versions.
- <a id="service-deployed-backend"></a>**A deployed backend.** The backend on a server, reached by a built site or a development server alike by its address alone ([Reaching the backend](doc_page_impl_service.md#reaching-the-backend)). It needs to be reachable from the page's origin (a reverse proxy on the site's origin, or CORS for the origins its config names; it sends no CORS headers on purpose today), its doc pages listed in its own config instead of the development server's sync, and the permissions above, since a page on the network is no longer the only caller. Its address would then come from `config.yaml` for a build too, not only from a host passing it.
- <a id="service-call-any-component"></a>**Calls from any component.** Only dashboards send `serviceApiCallRequest`; a component of the registry that is not a dashboard could call an instance by a target too, as the page does.
- <a id="service-isolation"></a>**Execution isolation.** Instances share one process; a template could declare how its instances run (the shared process, a worker, a process of their own, outside the backend), for scripts that are not trusted or need resources of their own; a hook that does not return could then be killed instead of recorded.
- <a id="service-event"></a>**Service events.** The lifecycle changes, the dependency changes and the log records share one envelope only in the log; a subscription (a dashboard told that its instance restarted, a service told that its dependency came back) would be the next channel beside the calls, on the [subscriptions](#event-subscription) of the event layer.
