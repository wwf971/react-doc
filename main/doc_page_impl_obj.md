<!-- Design of the object registry and the Type registry: objects, references, descriptors, Types, providers, relations, groups, views, the backend's registry and the page's. Parent document: doc_page_impl.md. The services' part (what a template declares, the kernel's provider) is summarized here and specified in doc_page_impl_service_backend.md and doc_page_impl_service_kernel.md; the views are components of the registry, doc_page_impl_mdx_comp.md#what-a-component-exposes. -->

# Objects and Types: Design

> **The Object Registry must not automatically become the source of truth for object contents, relationships, or lifecycle. Providers remain authoritative for the data they own. Registration, discovery, resolution, and verification are separate concerns.**

Everything below follows from that sentence. The service layers of the page (the doc page source, the links, the asset store) and the service instances of the backend each keep things others may want to find, draw or work with: a document and its sections, the links between documents, an asset, a todo, a database, the config of an instance. Each keeps its own representation of them, and keeps it its own way. The **object registry** is where they say what they have (as **objects** of **Types**), and where anyone else (a component of a document, a card diagram, another service) finds them, without knowing who keeps them and without the registry keeping them either. A component that can draw a Type draws every object of it, whoever provides it; a service that accepts a Type accepts every object of it, today's and tomorrow's.

```text
                 consumers (know nothing of who keeps an object)
   ObjectView  ObjectList  ObjectGroup  ObjectSearch  a card diagram node  the Services tab  a service
        \           |           |            |              |                  |              /
         ▼          ▼           ▼            ▼              ▼                  ▼             ▼
   ┌──────────────── the object service layer ─────────────────┐      ┌── the backend's registry ──┐
   │ page: DocObjectStore (+ DocObjectSearchStore)             │ peer │ kernel: ObjectRegistry      │
   │   Type registry   built-in JSON + the backend's list      │◄────►│   Type registry: built-in   │
   │   providers       doc-source, doc-link, asset, backend    │      │     + templates' typeList   │
   │   what they said  resolve / query / relation caches       │      │   providers: kernel,        │
   │   registrations   (known, not verified)                   │      │     service:{id} instances  │
   │   views           components exposing objectView          │      │   registrations (the page's │
   │   searches        sessions of the search uis              │      │     documents, services')   │
   └───────────────────────────────────────────────────────────┘      └─────────────────────────────┘
         ▲ answer from their own representation, stay the truth                     ▲
   doc page source (manifests, compiled docs)   link index (navigation)   asset store   service instances
```

## The object service layer

The registry is a service layer of the page like the others ([AGENTS.md](../AGENTS.md)), with an internal representation of what it is about, which is **what it knows of objects**, never the objects:

```text
the object service layer (DocObjectStore, and ObjectRegistry in the kernel)
├── the Type registry           the Types and their DAG: built-in, the templates' (the backend's list)
├── the provider directory      who answers for which namespaces and Types, with which capabilities, how fresh
├── what providers answered     per reference (resolveByRef), per query and relation query, with when and from whom
├── the registrations           descriptors principals handed it, by registrant
├── the views                   which component draws which Types in which context (from the component registry
│                               and the templates' modules), and the state of each view (what it read, its draft)
└── the searches                the sessions of the search uis: text, filters, result (DocObjectSearchStore)
```

It offers its services through the store's methods (resolve, query, relationQuery, read, update, register, search, open), through `config.object` and the events of the route `object` for components, through the apis `object/*` of the unified api registry, and through the backend's `/object/*` for services. Searching it by words, with the moderation that keeps a search from fetching everything a host has, is [Objects and Types: Search](doc_page_impl_obj_search.md).

## The concepts

- An **object** is anything a provider is willing to name: a document, a heading, a todo, a backup. It has an identity (its **reference**), one or more **Types**, and whatever content its provider keeps; it need not be stored anywhere, nor registered, to exist.
- A **reference** names it: `{namespace}:{local}`. The namespace names the provider authoritative for it; the local part is the provider's own and the registry never reads it.
- A **descriptor** is what the registry knows of an object: a small JSON object (its reference, Types, label, a summary, its capabilities, where to open it, its status and when it was checked). It is never the object's content, which is read from its provider.
- A **Type** is a JSON definition: an id, a kind (`object` or `relation`), a label, the Types it extends. Types form a DAG; an object of a Type is an object of every Type it extends.
- A **provider** answers for the objects of its namespaces, through the capabilities it has: `query` (list objects of some Types), `resolve` (describe a reference), `read` (the content), `update` (a change it checks), `relationQuery`. It needs only the ones it can offer.
- A **relation** is an entry from one object to another, of a relation Type (`core.member`, `core.contains`, `doc.link`), with a key of its own. A relation is not an object unless it needs to be one.
- A **collection** is an object with members (`core.member` relations from it); a **group** is an explicit one (`core.group`), with an identity and a lifecycle of its own.
- A **view** is a component of the component registry that draws objects of some Types in some **contexts** (`icon`, `inline`, `card`, `block`).
- There are **two registries**, the page's (`DocObjectStore`) and the backend's (`ObjectRegistry` in the kernel), with the same model; each is a provider of the other's world where it can be ([The page and the backend](#the-page-and-the-backend)).

## References and descriptors

A reference is `{namespace}:{local}`, the namespace `[a-zA-Z][a-zA-Z0-9.-]*` up to the first `:`, so a local part may hold colons (`doc:~example:root/a.md`). Global uniqueness comes from the namespaces, which belong to providers; nobody hands out ids centrally, and a provider never makes a reference of another's namespace (the backend refuses one: [Providers](#providers)).

| namespace | provider | object | local part |
| --- | --- | --- | --- |
| `docPage` | the doc page source (page) | `doc.page` | the doc page's alias |
| `docDir` | the doc page source | `doc.folder` | the folder's full source path, `~page:root/dir` |
| `doc` | the doc page source | `doc.document`; `doc.section`, `doc.block`, `doc.group` with a fragment | `~page:root/a.md`, `~page:root/a.md#{fragment}` |
| `asset` | the asset store (page) | `asset.object` | `{store}/{objectId}` |
| `service` | the kernel (backend) | `service.instance` | the service id |
| `serviceTemplate` | the kernel | `service.template` | the template id |
| `serviceConfig` | the kernel | `service.config` | the service id of the instance |
| `service.{serviceId}` | the instance | what its script provides | the instance's own id of the object (`todo/12`) |

**Identity and stability.** A reference is as stable as its provider makes it. A document is named by its full source path, stable while the file is; a section by the fragment navigation uses, a declared id (stable) or the heading's own id (which changes when the heading is renamed); a block by the id its marker declares. An instance's objects are named by the instance, so an instance created again is another namespace (its data is another database anyway). A reference that no longer names anything is not an error: it resolves to `missing`, and whoever holds it decides what to do.

```text
descriptor
  ref               service.w55j3ztn3rq:todo/12
  typeList          [todo-list.todo]          the most specific Types; the ancestors are the Type registry's to know
  label             buy milk
  description       a todo of example todos
  summary           { isDone: false }          small, for display and filters; may be stale. a Type says which keys it promises (summaryKeyList)
  iconUrl           ''                         an icon of its own (a backend path, reached through the page's address), else its Type's
  capabilityList    [read, update]             what its provider does with it
  open              { kind: navigate, target } | { kind: serviceInstance, serviceId } | { kind: serviceTemplate, templateId } | { kind: asset, store, objectId } | null
  status            found | registered | missing | unavailable | unknown   (+ loading, on the page)
  timeChecked       when its provider last answered for it (null for a registration)
  provider          { id, label, registry: page | backend, registrant? }
  message           why it is not found, when it is not
```

| status | means |
| --- | --- |
| `found` | its provider answered with it, at `timeChecked` |
| `registered` | a principal registered it; nobody verified it (the registering is not a check) |
| `missing` | its provider says there is no such object; what was known of it before (its label) is kept for the reader |
| `unavailable` | its provider could not be asked (down, not ready, too slow): what is answered is what was known before, if anything |
| `unknown` | no provider of its namespace, and nobody registered it |

## Types

```text
Type
  id              core.task, doc.document, todo-list.todo: dotted, the first part the namespace of
                  whoever defines it (core, doc, asset, service, or the template's name)
  kind            object | relation
  label, description, icon      the icon a name of the page's icon set (box, file-text, square-check)
  extendList      the Types it extends, of its kind; none for a root
  summaryKeyList  the keys of the summary an object of it promises (isDone for core.task)
  definedBy       { kind: builtIn } | { kind: serviceTemplate, id, name } | { kind: serviceInstance, id, name }
```

The Type registry answers whether an object of a Type is one of another (**assignable**: the same, or a descendant), how far, and in which order its ancestors come (**rank**: breadth first, each Type's parents in the order it lists them). That is all it does: it is no programming-language type system, it checks no content against a schema, and assignability comes from declarations only, never from shapes that happen to match. A Type nobody defines is taken as a child of both roots, so every object is at least a `core.object` and is drawn by the fallback view. A Type extending one nobody defines extends the root instead, and a cycle is broken where it closes; both are reported (`problemList`).

**Built-in Types** are one JSON file, `built-in/object-type/object-type-builtin.json`, read by the kernel and imported by the page, so both registries agree on them:

```text
core.object                                  anything the registry can name
├── core.collection                          has members (core.member, ordered, an entry each)
│   ├── core.group                           an explicit collection
│   │   └── doc.group                        an ObjectGroup block   (also a doc.block)
│   ├── doc.page                             members: its root folders
│   ├── doc.folder                           members: its folders and documents
│   ├── doc.document                         (also a core.document) members: its top sections
│   └── doc.section                          (also a core.place)    members: its sub-sections
├── core.document                            a text people read
├── core.place                               a place inside another object
│   └── doc.block                            a component block with an id
├── core.config  ── service.config           { valueByKey, defineList }; an update { valueByKey }
├── core.task                                summary isDone; an update { isDone }
├── core.file    ── asset.object
├── core.service ── service.instance
└── service.template

core.relation
├── core.member  ── core.contains            a member that exists only inside its container
├── core.reference ── doc.link, service.dependsOn
└── service.createdFrom
```

A Type is a promise of semantics, and the `core.*` Types carry the few promises consumers rely on: a `core.task` has `summary.isDone` and accepts `{ isDone }`; a `core.config` reads as `{ valueByKey, defineList }` and accepts `{ valueByKey }`; a `core.collection` has `core.member` relations. Capability-like Types and semantic ones are the same mechanism, named for what they mean. Being of a Type does not promise behavior beyond that (availability, permissions, consistency are the provider's), and a Type an object needs a conversion to reach (a PDF as frames) is a service turning one object into another, not a parent in the DAG.

**Types of the templates.** A service template defines Types in `expose.typeList` of its script, under its own name (`todo-list.todo`): the kernel refuses a Type of another name with a problem, so two templates never collide. The kernel rebuilds the registry whenever a script changes: the built-in Types, then the templates' (the oldest template id first; a second definition of an id is reported and left out), then those of instances whose template is gone. The page takes the backend's list over its own built-in copy when there is a backend.

## Providers

A provider says what it has and what it can do, and nothing more is asked of it: it need not enumerate its objects, follow changes, notify anyone, or answer every query.

```text
provider
  id, label, registry       page | backend
  namespaceList             the namespaces it is authoritative for (a provider of relations only has none)
  typeList                  the Types of the objects it provides, the most specific
  relationTypeList          the Types of the relations it provides
  capabilityList            some of query, count, resolve, read, update, relationQuery (count: how many a query
                            would answer, without listing them: the preflight of a search)
  queryFilterList           the filters its query understands (isDone, kind, docPageAlias)
  cacheSecond               how long its answers may be reused
  status                    ready, or why not (the backend down, an instance waiting)
  version (page)            a value that changes when what it answers may have: its answers kept are asked again
```

| provider | registry | namespaces | objects | relations | capabilities |
| --- | --- | --- | --- | --- | --- |
| `doc-source` | page | `docPage`, `docDir`, `doc` | `doc.page`, `doc.folder`, `doc.document`, `doc.section`, `doc.block`, `doc.group` | `core.contains`, `core.member` (a group's) | query (places: compiled documents only, `partial`), resolve, read, relationQuery |
| `doc-link` | page | none | none | `doc.link` | relationQuery (from or to a document) |
| `asset` | page | `asset` | `asset.object` | none | query, resolve, read |
| `backend` | page (a peer) | the backend's | what the backend's providers have | theirs | all, federated by the backend |
| `kernel` | backend | `service`, `serviceTemplate`, `serviceConfig` | `service.instance`, `service.template`, `service.config` | `service.createdFrom`, `service.dependsOn` | query, resolve, read, update (a config), relationQuery |
| `service:{id}` | backend | `service.{id}` | its script's `objectProvide.typeList` | its `relationTypeList` | the object apis its script implements |

Each provider of the page is an adapter of a service layer that keeps its own representation: the doc page source its manifests and compiled documents, the navigation layer its link index, the asset store its index. None of them hands its representation to the registry; each answers from it when asked, and only what it is authorized to answer. The minimal promises a provider keeps are those of the protocol, not of quality: its descriptors are well formed, its references are of its own namespaces, a change goes through its own checks. It may be slow, partial, stale or away; the registry says so instead of failing.

## Discovery and resolution

The operations are separate on purpose, each with its own promise:

| operation | answers | from |
| --- | --- | --- |
| `register(descriptorList)` | that these objects are known | the registrant; never verified by it |
| `query({ typeList, text, filter, limit })` | objects of these Types and their subtypes, with how complete the answer is | every provider of an assignable Type, and the registrations |
| `resolve(ref, { isVerify })` | the descriptor of one reference, with its status | its provider; what was known when it cannot answer |
| `resolve(ref, { isVerify: true })` | the same, asked again now | its provider, whatever is cached |
| `read(ref)` | `{ descriptor, content }` | its provider, always: never a cache |
| `update(ref, patch)` | the provider's answer to a change it checks | its provider |
| `relationQuery({ fromRef, toRef, typeList })` | relations, with how complete the answer is | every provider of an assignable relation Type |

**A query is federated.** The registry asks each provider whose Types are assignable to those asked for (a provider of `todo-list.todo` for `core.task`, everyone for `core.object`), in parallel, keeps of each answer the objects that are of the Types asked for and match the text, adds the registered descriptors nobody answered for, and returns them with a **completeness**: one entry per provider, `answered`, `cached`, `partial` (the provider said it listed only part: the sections of the compiled documents only), `registered`, `unavailable`, `timedOut`, `skipped`, `failed`, with a count and a message. `isComplete` is true only when every provider answered in full, and even then it means complete *for those providers*, never that no other object exists. A consumer shows the line or acts on it: a list says "3 objects · the service backend: unavailable"; a service that must have everything refuses an incomplete answer.

**A provider the backend waits for has a limit.** The kernel calls an instance provider in the instance's queue with a short wait of its own (`objectProviderWaitSecond`, 5 s by default, beside `apiWaitSecondMax`); an instance busy with a long job is `timedOut` for that query while the others are answered. A call from a service into the registry never waits for the service's own queue: the provider that is the caller (or any instance in the call's chain) is `skipped`, as a call between services that would wait for itself is refused.

**Caches, and what invalidates them.** The registry keeps a provider's answers for its `cacheSecond` (the kernel 0, an instance its declared value, 15 s by default; the page's providers 300 s with a version, the backend peer 15 s): a resolve, a query, a relation query asked again within that time is answered from what it answered. What is kept is dropped earlier when:

- the provider says its objects changed: `self.context.object_changed(localIdList?)` of a service (todo-list calls it after every write), `changed(providerId, refList?)` on the page;
- the provider's version changes (page): the source manifest replaced, a document compiled, the link index received, the backend's providers changed;
- an update went through the registry: what it kept of that provider is asked again;
- an instance restarts or its script changes: its answers are forgotten;
- a consumer asks `isVerify` (resolve) or `isFresh` (query).

The page reuses an answer while it asks again (a stale answer is drawn until the new one arrives), and a query's answer is what the registry knows of each object it lists, so a list of fifty objects costs one request, not fifty-one.

**What the registry does not promise**, because no provider can keep it for all: that a registered object exists, that a deleted object is unregistered at once, that a query is complete, that a provider notifies changes, that every object has a permanent identity. A document edited by another program while the page is closed, an instance whose database was restored, a provider that never reports a deletion: each is a provider still, and the registry answers what it knows, with when and from whom. Correctness and performance come from how providers and consumers use the registry (a provider that registers what it can and says when it changed; a consumer that verifies before an operation that matters, and reads the content from the provider), not from guarantees it would impose.

**Registration** is for objects a principal wants found without being asked: a service registering its few important objects so a query need not call it (`self.context.object_register(descriptorList, is_replace)`, in its own namespace only), the page registering its documents into the backend's registry ([The page and the backend](#the-page-and-the-backend)), a component registering an object of a namespace no provider owns. A namespace a provider owns is registered in by that provider alone. A registration is held in memory, by registrant; a reference persistently held by someone (pinned, kept across restarts) is [TODO](doc_page_impl_TODO.md#object-registration-persistent).

## Relations, collections and groups

```text
relation
  key        the entry, unique for its provider: member/{todoId}, {docPath}:{index}, contains/{ref}
  type       a relation Type: core.member, core.contains, doc.link, service.dependsOn, sqlite.keptFor
  fromRef, toRef
  order      its place among the relations from fromRef (members in order)
  label, data   the entry's own: a note in a group, the line and sentence of a link, the infra name of a dependency
  provider, status
```

A relation belongs to whoever keeps it, not to the objects it joins: a todo list keeps its members, the link index the links of the documents, a group its entries. The provider of the object at either end need not know of it. A relation that needs an identity, a state or permissions of its own becomes an object instead, with relations to both ends.

The relation Types keep three things apart that are all edges of a graph: **containment** (`core.contains`: a section exists only in its document, a file in its folder), **membership** (`core.member`: an entry of a collection, chosen or derived, with its own key, so one object can be a member twice, each with its data), and **reference** (`core.reference`: a place names an object that may be gone, a link). `core.contains` extends `core.member`, so a view of collections lists a document's sections as members; a link is not a member of anything.

**Collections and groups.** A collection is any object with members: a group, a todo list, a folder, a document, a section; a query's result is a virtual one (`ObjectList`), with no identity at all. An explicit group is `core.group`. The registry has no group logic: a group is a provider's object like any other, and its members are its provider's relations. The page has one kind of group of its own, `ObjectGroup`, written in a document (`doc.group`, below); a service keeping groups (a timeline, a slide deck, a group service) provides them the same way, and the same views draw them. `memberStateGet(ref)` on the page is a relation query of `core.member` from the collection, in order.

## Documents as objects

The doc page source ([Doc page source service layer](doc_page_impl_source.md)) provides the doc pages of the workspace, their folders and documents from its manifests, and the places inside a document from the document compiled ([MDX compilation](doc_page_impl.md)): its headings (`toc`) and its component blocks that declare an id. Nothing of a document is registered: a reference is resolved when asked, by compiling the document once when it is not compiled yet, and a query lists the places only of the documents this page compiled (`partial`, with the reason). Three kinds of nodes are kept apart: **structural** nodes (every paragraph of the AST) are nobody's objects; **addressable** ones (a heading, a block with an id) are objects on request; **registered** ones are only what a provider chose to register. The document is the truth of everything in it: an edit by anyone, with any editor, changes or removes what it held, and the next resolve says `missing`.

| relation | provided | from |
| --- | --- | --- |
| `core.contains` | doc page > root folders > folders and documents > top sections > sub-sections; the inverse (the container of a document, a folder, a section) | the manifests, the compiled document |
| `core.member` | a group > the references its block lists, each entry with its key and note | the block's data |
| `doc.link` | a document > the files its references resolve to; the inverse, a document's or a section's backlinks | the link index ([Backlinks](doc_page_impl_nav_backlink.md#the-link-index)) |

The links are the navigation layer's: its link index stays its internal representation, kept and changed by it alone, and the provider `doc-link` answers relation queries from it with the same resolver the backlinks panel inverts it with, so a backlink and a `doc.link` relation are the same thing seen from two places. A reference that resolves to several files is a relation to each; one that resolves to nothing is kept, to the target as written, with `data.isResolved` false. Neither provider lists all its relations at once: a relation query names a document (from or to), and one naming neither is answered empty with the reason.

`ObjectGroup` is a component block whose data is a group: a label, and members, each a reference or `{ ref, key?, note? }`. Drawn, it shows its members by their views. With an id (`<!--renderComp=ObjectGroup,id=release-checklist-->`) it is an object, `doc:{document}#{id}` of the Type `doc.group` (a `core.group` and a `doc.block`), and its members are `core.member` relations of the doc page source, so anything can name the group by its reference: a view of collections draws it without knowing it is written in a document.

## Object views

How an object is drawn is decided by the page, not by the object nor by its provider: a provider says what an object *is* (its Types), the component registry holds what can *draw* each Type, and the consumer decides *where* (the context) and *whether a change may be made there*. A component becomes a view by exposing it ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)):

```js
compDefine(TaskCard, {
  placementList: ['objectView'],
  expose: { objectView: { typeList: ['core.task'], contextList: ['card', 'icon', 'inline'], priority: 0 } },
});
```

| context | what it is |
| --- | --- |
| `icon` | a glyph and a label, the size of a word: a member of a list, a chip |
| `inline` | inside a line of text |
| `card` | a bounded box: a card of a list or a group, a node of a card diagram |
| `block` | the width of a document: the object shown whole |

**Choosing the view.** For an object and a context, the candidates are the views of the context whose Types the object is assignable to: the components of the component registry (the package's, the doc pages' and packages' mounted ones, the host's) and the components of the service templates' modules ([Services](#services)), these only while a ready instance of the template serves its module. The nearest Type wins, by rank (of two parents at one distance, the one the object's Type lists first: a `doc.document` is drawn as a document before it is drawn as a collection), then the highest priority, then a component of the page before one of a service. A consumer may ask for a view by its id (`view` of `ObjectView`), used when it can draw the object. The **fallback view** (`common/ObjectViewFallback`) is registered for `core.object` in every context with the lowest priority, so it is no special case: it is the least specific view, and every object has one. It draws what every descriptor has: the icon of the Type (the nearest ancestor's when its own names none), the label, the Type, the status when not found, the summary, the provider and the reference, and in the block context the content, read on request.

**A view receives** `data: { ref, descriptor }` and `config.objectView: { context, isEditAllowed, editUnavailableReason, note, isFallback }`, in the placement `objectView`, through the ordinary boundary (`RegisteredComp`), so it has `config.object` and `onEvent` like any component. It asks for a change with `objectUpdateRequest { ref, patch }`; it never knows the provider. A change is offered only when three things agree, each of its own owner: the **consumer** allows it (`isEditable` of `ObjectView`; a read-only consumer), the **provider** offers it (`update` in the descriptor's capabilities) and answers now; whether the **user** may is the provider's check when the change arrives ([Authorization](doc_page_impl_service_kernel.md#authorization) is a TODO of the backend). `isEditAllowed` is the first two; the third is the answer.

| view | Types | contexts |
| --- | --- | --- |
| `common/ObjectViewFallback` | `core.object` | all (priority -100) |
| `common/ObjectViewCollection` | `core.collection` | card (members as icons), block (members as cards) |
| `common/ObjectViewConfig` | `core.config` | card, block: a form of the define list; Save is the update `{ valueByKey }` |
| `common/ObjectViewDocument` | `core.document`, `core.place` | card: opens it; counts the `doc.link` relations to a document or a section |
| `service/todo-list/comp/todo-card` | `core.task` | card, icon, inline: checks it off (`{ isDone }`); from the module of the template `todo-list` |

**The components a document writes** consume the registry: `ObjectView` (one object by its reference, in a context; also a node of a card diagram), `ObjectList` (the objects of some Types: a federated query, with its completeness), `ObjectGroup` (a group whose truth is the document), `ObjectSearch` (a search by words, [Search](doc_page_impl_obj_search.md#the-ui)). A view keeps what it read and its draft in the layer, not in itself (`viewStateGet(key)`, `viewContentLoad`, `viewDraftSave`): the config form and the fallback view's content do. Their usage is in the demonstration, `example_doc/object-registry.md`. Every one of them draws objects through `ObjectViewHost`, which resolves the reference, chooses the view and renders it; a consumer of another package does the same.

**In a card diagram**, a node `renderer: { component: ObjectView }` with `data: { object: … }` is a card of any object: `ObjectView` declares the placement `visualizationNode` and the node contract (one `body` anchor on every side, `sizeDefault`), the way any registered renderer of the diagram does ([Internal and Registered Renderers](../package/cloud-dev-vis/doc/card-diagram-impl.md#internal-and-registered-renderers)). The diagram knows no Type; the lines are its own data. Drawing a diagram from relations of the registry is [TODO](doc_page_impl_TODO.md#object-relation-diagram).

## Services

A service template takes part through its script's `expose`, next to the code ([What a service script exposes](doc_page_impl_service_backend.md#what-a-service-script-exposes)):

```python
expose = {
    'typeList': [{'id': 'todo-list.todo', 'label': 'Todo', 'extendList': ['core.task'], 'summaryKeyList': ['isDone']}, …],
    'objectProvide': {'typeList': ['todo-list.todo', 'todo-list.list'], 'relationTypeList': ['core.member'],
                      'queryFilterList': ['isDone'], 'cacheSecond': 10},
    'compList': [{'id': 'todo-card', 'export': 'TodoCard',
                  'objectView': {'typeList': ['core.task'], 'contextList': ['card', 'icon', 'inline']}}],
    'requireList': [{'type': 'core.task'}],
}

@api(kind='query', params=[param('typeList', 'array', '…'), …], callerKindList=['kernel'])
def objectQuery(self, typeList, text='', filter=None, limit=100): …      # descriptors, with localId
def objectCount(self, typeList, text='', filter=None): …                   # how many objectQuery would answer (optional)
def objectResolve(self, localIdList): …                                     # one descriptor or None per id
def objectRead(self, localId): …                                            # { descriptor, content }
def objectUpdate(self, localId, patch): …                                   # checks the patch, then { descriptor, content }
def relationQuery(self, fromRef='', toRef='', typeList=None): …             # relations, fromLocalId / toLocalId or refs
```

- **`typeList`**: the Types it defines, under its name.
- **`objectProvide`**: the objects every instance provides, in its namespace `service.{serviceId}`. Its capabilities are the object apis the script implements, each answered to the kernel only (`callerKindList` holds `kernel`: the page reaches them through the registry, never directly), checked when the script loads. The kernel makes a `localId` a reference of the instance's namespace and refuses one of another, so an instance cannot speak for objects it does not own.
- **`compList`**: the components of its module beside its dashboards, today object views, named `service/{templateName}/comp/{compId}` on the page. The page loads one from the instance that provides the object drawn when it is one of the template's, else from any ready instance of the template with a built module; while none can serve it, the object is drawn by the fallback view with the reason. A component another template's objects are drawn with is **a dependency on the template that provides it**, at the level of templates, beside the infra dependencies of instances.
- **`requireList`**: what the template needs others to provide: `{ type }` (a Type it extends or accepts), `{ objectView, context? }` (a view of a Type beyond the fallback), `{ comp }` (a component by id), each `isRequired` or not. Where possible a template requires a Type or a view, not a template: whoever provides it serves, a Type compatible in name promising no more than its declaration. The requirements are resolved **on the page**, which knows every provider (the built-in and the templates' Types, the views of the component registry and of the modules): the Services tab shows each as met, provided but with no ready instance, drawn by the fallback only, or missing, with who meets it.

The **kernel's provider** gives every instance, app or infra, two objects without a line of its script: the instance (`service:{id}`, `service.instance`, its status, kind, health, template) and **its config** (`serviceConfig:{id}`, `service.config`). The config reads as `{ valueByKey, defineList }` from its `service.yaml` and its script's `configDefineList`; an update `{ valueByKey }` is checked against the instance's own script (a key it does not declare, a value of the wrong type: -1), written into `service.yaml`, and the instance restarts with it (`instance_config_set`). The view of `core.config` draws it, in a document, in a card diagram, and in the Services tab above the instance's config dashboard, so an infra instance without dashboards has its config form too. The kernel also provides `service.createdFrom` (an instance to its template) and `service.dependsOn` (an instance to the instance currently providing each infra name it uses).

**A service as a consumer** uses the registry through its context: `object_query(type_list, text, filter, limit)`, `object_resolve(ref_list, is_verify)`, `object_read(ref)`, `object_update(ref, patch)`, `relation_query(from_ref, to_ref, type_list)`, `object_type_is_assignable(a, b)`; as a provider, `object_register(descriptor_list, is_replace)`, `object_changed(local_id_list?)`, `object_ref_build(local_id)`, `object_type_list_match(own, asked)` (which of its Types a query for others wants). The built-in templates provide: `todo-list` its todos and its list (a collection), `note-db` its notes (`note-db.note`, a `core.document`), `sqlite` the database of each consumer (`sqlite.database`, related to the consumer by `sqlite.keptFor`), `local-backup` every backup (`local-backup.backup`, related by `local-backup.backupOf`); `logging` and the connections provide none of their own.

## The page and the backend

The two registries have one model and different reach. The page's registry has the backend's as one **peer provider** (`lib/doc-object-provider-backend.js`): the namespaces of the backend's providers are its, its query and relation query are the backend's federated ones, whose completeness the page merges entry by entry, and its icons are paths of the backend api the page reaches through its own address. While the backend is down (or the page has none: a build), the peer is unavailable (or absent) and the page's own objects are answered as before.

The backend cannot ask the page: the page is not a server, and may be closed. So the page **registers** its doc pages and documents into the backend's registry (`POST /object/register`, replacing what it registered before in the namespaces `doc` and `docPage`) whenever the backend is up and the source changes, and a service finds them by a query of `doc.document`, with the status `registered`: known, not verified, possibly stale once the page is closed. The backend refuses a page registration in a namespace of its own providers. A live route from the backend to the page's providers is [TODO](doc_page_impl_TODO.md#object-backend-page).

## From a component

A component of the registry reaches the page's registry two ways: `config.object`, a stable service object (`resolve`, `query`, `read`, `update`, `relationQuery`, `typeGet`, `typeIsAssignable`, `open`), and the event layer ([Events](doc_page_impl_event.md)), the route `object`: `objectResolveRequest { ref | refList, isVerify }`, `objectQueryRequest { typeList, text, filter, limit, isFresh }`, `objectRelationQueryRequest { fromRef, toRef, typeList }`, `objectReadRequest { ref }`, `objectUpdateRequest { ref, patch }`, `objectOpenRequest { ref }`, each answered `{ code, data, message }`. A component of a service's module, which has its own module scope, uses the events. Opening an object goes to where its own layer shows it: a document is navigated to, an instance or a template opens the Services tab on it, an asset the asset panel.

## What is in the kernel, and what is not

| level | what | where |
| --- | --- | --- |
| mechanism | references, descriptors, the Type registry (assignability, rank), provider dispatch by namespace, federation with completeness, caching and invalidation, registrations | `service_object.py`, `DocObjectStore` |
| standard Types | `core.*` (object, collection, group, document, place, config, task, file, service, member, contains, reference) and the domain Types of the page and the kernel | `object-type-builtin.json` |
| built-in providers and views | the kernel's (instances, templates, configs), the page's layers, the fallback and the views of collections, configs and documents | the kernel, `lib/doc-object-provider-*.js`, `comp-doc/object/` |
| services and components | groups, timelines, slide decks, a graph of relations, the todos, the notes, a card of a task | templates (`objectProvide`, `compList`) and components (`expose.objectView`) |

Nothing about groups, timelines or graphs is in the kernel: a timeline is a service providing a `core.collection` subtype whose member entries carry a start and a duration, drawn by any view of collections and by its own; a group service keeps groups; a relation index is a service answering relation queries. The kernel knows how to ask them, not what they mean.

## Files

```text
built-in/object-type/object-type-builtin.json   the built-in Types, read by the kernel and the page
service-backend/service_object.py      TypeRegistry (rebuild, assignability, problems), ObjectRegistry (providers, query,
                                       resolve, read, update, relation_query, register, changed, caches, the wait for one
                                       provider), KernelObjectProvider, InstanceObjectProvider
service-backend/service_define.py      expose: typeList, objectProvide (capabilities from the object apis), compList,
                                       requireList; descriptor and relation normalization, references; ServiceContext:
                                       object_query, object_resolve, object_read, object_update, relation_query,
                                       object_register, object_changed, object_ref_build, object_type_is_assignable
service-backend/service_runtime.py     the registry kept beside the service registry: the Types rebuilt after a scan, an
                                       instance's answers forgotten when it restarts, instance_config_set, api_call's wait
service-backend/server.py              GET /type/list, /object/provider/list; POST /object/query, resolve, read, update,
                                       relation/query, register, unregister
frontend/src/lib/doc-object-ref.js     references, descriptors, relations, contexts, statuses, request keys
frontend/src/lib/doc-object-type.js    the built-in Types, typeRegistryBuild: assignability, distance, rank
frontend/src/lib/doc-object-provider-doc.js     the doc page source: doc pages, folders, documents, places, groups
frontend/src/lib/doc-object-provider-link.js    the links (doc.link) from the link index
frontend/src/lib/doc-object-provider-asset.js   the asset store's objects
frontend/src/lib/doc-object-provider-backend.js the backend's registry as a peer
frontend/src/lib/doc-service-api.js    the object endpoints of the backend
frontend/src/store/DocObjectStore.ts   the page's registry: Types, providers, resolve / query / relation states and caches,
                                       read, update, registrations, the views (candidates, choice), requirement status,
                                       open, the events, the page's documents registered into the backend
frontend/src/lib/doc-object-registry.test.js   Types, references, federation, tolerance, registrations, the choice of a view
frontend/src/store/DocObjectSearchStore.ts, lib/doc-object-search.js   the search (doc_page_impl_obj_search.md)
comp-doc/object/                       ObjectViewHost (one object drawn), ObjectView, ObjectList, ObjectGroup, ObjectSearch,
                                       ObjectSearchPanel, the views
                                       (Fallback, Collection, Config, Document), ObjectCompleteness, object-icon.jsx,
                                       object-comp-define.js (the definitions), object-comp-data.js, DocObject.css
comp-doc/service/service-comp-define.js, ServiceCompHost.jsx   the components of a template's module (compList)
comp-doc/registry/comp-expose.js       expose.objectView, compObjectViewGet
comp-doc/registry/RegisteredComp.jsx   config.object
comp-doc/settings/ServiceSettings.jsx  a script's Types, objects, components and requirements; an instance's config object
example_doc/object-registry.md         the demonstration: views, lists, a group, a collection, a card diagram, tolerance
```

## Future updates

What the present model leaves for later (persistent registrations and pins, versions of Types, Types of doc pages and packages, a diagram of relations, a live route from the backend to the page, batched resolves, the authorization of changes) is in [TODO](doc_page_impl_TODO.md#object-registry).
