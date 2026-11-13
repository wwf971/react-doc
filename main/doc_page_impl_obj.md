<!-- Design of the object registry and the type registry: objects, references, descriptors, types, providers, relations, groups, views, the backend's registry and the page's. Parent document: doc_page_impl.md. The services' part (what a template declares, the kernel's provider) is summarized here and specified in doc_page_impl_service_backend.md and doc_page_impl_service_kernel.md; the views are components of the registry, doc_page_impl_mdx_comp.md#what-a-component-exposes. -->

# Objects and Types: Design

> **The Object Registry must not automatically become the source of truth for object contents, relationships, or lifecycle. Providers remain authoritative for the data they own. Registration, discovery, resolution, and verification are separate concerns.**

> **The registry knows no service layer.** Everything it needs of a layer (its objects and relations, the types and components it brings, how to open one of its objects) it asks the layer's **provider**, the way the unified api registry asks its api providers ([Unified api registry](doc_page_impl_api.md)). `DocObjectStore` reads no other store but the component registry (for the views): the types and components of the services come from the backend peer provider, a document is opened by the doc page source's provider, an asset by the asset store's. A layer added later (tags, a timeline) takes part by adding a provider, never by a change to the registry. ([Providers](#providers))

Everything below follows from that sentence. The service layers of the page (the doc page source, the links, the asset store) and the service instances of the backend each keep things others may want to find, draw or work with: a document and its sections, the links between documents, an asset, a todo, a database, the config of an instance. Each keeps its own representation of them, and keeps it its own way. The **object registry** is where they say what they have (as **objects** of **types**), and where anyone else (a component of a document, a card diagram, another service) finds them, without knowing who keeps them and without the registry keeping them either. A component that can draw a type draws every object of it, whoever provides it; a service that accepts a type accepts every object of it, today's and tomorrow's.

```text
                 consumers (know nothing of who keeps an object)
   ObjectView  ObjectList  ObjectGroup  ObjectSearch  a card diagram node  the Services tab  a service
        \           |           |            |              |                  |              /
         ▼          ▼           ▼            ▼              ▼                  ▼             ▼
   ┌──────────────── the object service layer ─────────────────┐      ┌── the backend's registry ──┐
   │ page: DocObjectStore (+ DocObjectSearchStore)             │ peer │ kernel: ObjectRegistry      │
   │   type registry   built-in JSON + the backend's list      │◄────►│   type registry: built-in   │
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
├── the type registry           the types and their DAG: built-in, the templates' (the backend's list)
├── the provider directory      who answers for which namespaces and types, with which capabilities (the writes
│                               among them, and the types it creates), how fresh
├── what providers answered     per reference (resolveByRef), per query and relation query, with when and from whom
├── the registrations           descriptors principals handed it, by registrant
├── the views                   which component draws which types in which context (from the component registry
│                               and the templates' modules), and the state of each view (what it read, its draft)
└── the searches                the sessions of the search uis: text, filters, result (DocObjectSearchStore)
```

It offers its services through the store's methods (resolve, query, relationQuery, innerCompleteGet, read, update, create, delete, relationCreate, relationDelete, register, search, open, typeInfoGet), through `config.object` and the events of the route `object` for components, through the standard apis `object/*`, `relation/*` and `type/*` of the unified api registry ([The apis](#the-apis)), and through the backend's `/object/*` for services. Searching it by words, with the moderation that keeps a search from fetching everything a host has, is [Objects and Types: Search](doc_page_impl_obj_search.md). Naming something inside an object, and writing a reference while typing (`/object`), is [Inside an object](#inside-an-object).

## The concepts

- An **object** is anything a provider is willing to name: a document, a heading, a todo, a backup. It has an identity (its **reference**), one or more **types**, and whatever content its provider keeps; it need not be stored anywhere, nor registered, to exist.
- A **reference** names it: `{namespace}:{local}`. The namespace names the provider authoritative for it; the local part is the provider's own and the registry never reads it.
- A **descriptor** is what the registry knows of an object: a small JSON object (its reference, types, label, a summary, its capabilities, where to open it, its status and when it was checked). It is never the object's content, which is read from its provider.
- A **type** is a JSON definition: an id, a kind (`object` or `relation`), a label, the types it extends. Types form a DAG; an object of a type is an object of every type it extends.
- A **provider** answers for the objects of its namespaces, through the capabilities it has: `query` (list objects of some types), `resolve` (describe a reference), `read` (the content), `update` (a change it checks), `relationQuery`, and the writes `create` (an object of the types it creates, or a member of one of its collections), `delete`, `relationCreate`, `relationDelete`. It needs only the ones it can offer.
- A **relation** is an entry from one object to another, of a relation type (`core.member`, `core.contains`, `doc.link`), with a key of its own. A relation is not an object unless it needs to be one.
- A **collection** is an object with members (`core.member` relations from it); a **group** is an explicit one (`core.group`), with an identity and a lifecycle of its own.
- A **view** is a component of the component registry that draws objects of some types in some **contexts** (`icon`, `inline`, `card`, `block`).
- There are **two registries**, the page's (`DocObjectStore`) and the backend's (`ObjectRegistry` in the kernel), with the same model; each is a provider of the other's world where it can be ([The page and the backend](#the-page-and-the-backend)).

## References and descriptors

A reference is `{namespace}:{local}`, the namespace `[a-zA-Z][a-zA-Z0-9.-]*` up to the first `:`, so a local part may hold colons (`doc:~example:root/a.md`). Global uniqueness comes from the namespaces, which belong to providers; nobody hands out ids centrally, and a provider never makes a reference of another's namespace (the backend refuses one: [Providers](#providers)).

| namespace | provider | object | local part |
| --- | --- | --- | --- |
| `docPage` | the doc page source (page) | `doc.page` | the doc page's alias |
| `docDir` | the doc page source | `doc.folder` | the folder's full source path, `~page:root/dir` |
| `doc` | the doc page source | `doc.document`; `doc.section`, `doc.block`, `doc.group` with a fragment | `~page:root/a.md`, `~page:root/a.md#{fragment}` |
| `asset` | the asset store (page) | `asset.item` | `{store}/{itemId}` |
| `frontend` | the frontend object service layer (page) | `frontend.object` and the types the doc pages declare below it; `frontend.inner` with an inner path | the object's id, `{id}#{inner path}` |
| `service` | the kernel (backend) | `service.instance` | the service id |
| `serviceTemplate` | the kernel | `service.template` | the template id |
| `serviceConfig` | the kernel | `service.config` | the service id of the instance |
| `service.{serviceId}` | the instance | what its script provides | the instance's own id of the object (`todo/12`) |

**Identity and stability.** A reference is as stable as its provider makes it. A document is named by its full source path, stable while the file is; a section by the fragment navigation uses, a declared id (stable) or the heading's own id (which changes when the heading is renamed); a block by the id its marker declares. An instance's objects are named by the instance, so an instance created again is another namespace (its data is another database anyway). A reference that no longer names anything is not an error: it resolves to `missing`, and whoever holds it decides what to do.

```text
descriptor
  ref               service.w55j3ztn3rq:todo/12
  typeList          [todo-list.todo]          the most specific types; the ancestors are the type registry's to know
  label             buy milk
  description       a todo of example todos
  summary           { isDone: false }          small, for display and filters; may be stale. a type says which keys it promises (summaryKeyList)
  iconUrl           ''                         an icon of its own (a backend path, reached through the page's address), else its type's
  capabilityList    [read, update]             what its provider does with it
  open              { kind: navigate, target } | { kind: serviceInstance, serviceId } | { kind: serviceTemplate, templateId } | { kind: asset, store, itemId } | null
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

Every object and relation has types, and consumers ask for those, never for a provider: a search filters by type, a list takes `typeList`, a view is chosen by the nearest type. A type (`core.task`, `doc.document`) has an id, a kind, a label and an icon, and extends other types; the **type registry** answers whether one is another (assignable, nearest first), and what no one defines is at least a `core.object`. The types are built in, defined by service templates, or declared in yaml by doc pages, frontend objects and packages. All of this has a document of its own: [Types](doc_page_impl_type.md).

## Providers

A provider says what it has and what it can do, and nothing more is asked of it: it need not enumerate its objects, follow changes, notify anyone, or answer every query.

```text
provider
  id, label, registry       page | backend
  namespaceList             the namespaces it is authoritative for (a provider of relations only has none)
  typeList                  the types of the objects it provides, the most specific
  relationTypeList          the types of the relations it provides
  capabilityList            some of query, count, resolve, read, update, relationQuery (count: how many a query
                            would answer, without listing them: the preflight of a search), and the writes
                            create, delete, relationCreate, relationUpdate, relationDelete (#writing-through-the-registry);
                            relationText: its relation query searches the text itself;
                            innerComplete: it completes a text typed for something inside one of its objects
                            (#inside-an-object)
  createTypeList            the types it creates objects of (and of every type below them)
  queryFilterList           the filters its query understands (isDone, kind, docPageAlias)
  cacheSecond               how long its answers may be reused
  status                    ready, or why not (the backend down, an instance waiting)
  version (page)            a value that changes when what it answers may have: its answers kept are asked again

  what a provider of the page may bring besides objects (each optional):
  typeDefine                the types it defines ({ typeList, problemList }): the backend's list
  compList                  the components it serves, views among them, each available or not now: the templates' modules
  open(descriptor)          goes to where its own layer shows one of its objects: navigates, opens the Services tab, the asset panel
  typeInfoGet(typeId)       what it knows of a type beyond its definition (the modes of a frontend object type)
  providerInfoList, count   a peer: the providers behind it, and how many each would answer (the plan and preflight of a search)
  descriptorListForPeer     what it registers into a peer: the doc page source, its documents
```

| provider | registry | namespaces | objects | relations | capabilities |
| --- | --- | --- | --- | --- | --- |
| `doc-source` | page | `docPage`, `docDir`, `doc` | `doc.page`, `doc.folder`, `doc.document`, `doc.section`, `doc.block`, `doc.group` | `core.contains`, `core.member` (a group's) | query (places: compiled documents only, `partial`), resolve, read, relationQuery, innerComplete (the sections of a document) |
| `doc-link` | page | none | none | `doc.link` | relationQuery (from or to a document) |
| `asset` | page | `asset` | `asset.item` | none | query, resolve, read (with the head's text), create, update, delete |
| `frontend` | page | `frontend` | `frontend.object` and the types declared below it (their modes through `typeInfoGet`); `frontend.inner`, something inside one, with `#` and an inner path | `core.member` (an object to its assets) | query, resolve, read, relationQuery, create (an object, or an asset in one), update, delete, relationCreate, relationDelete, innerComplete (what the type of the object says is inside it) |
| `backend` | page (a peer) | the backend's | what the backend's providers have | theirs | all, federated by the backend |
| `kernel` | backend | `service`, `serviceTemplate`, `serviceConfig` | `service.instance`, `service.template`, `service.config` | `service.createdFrom`, `service.dependsOn` | query, resolve, read, update (a config), relationQuery |
| `service:{id}` | backend | `service.{id}` | its script's `objectProvide.typeList` | its `relationTypeList` | the object apis its script implements |

Each provider of the page speaks for a service layer that keeps its own representation: the doc page source its manifests and compiled documents (and the headings of a compiled document, `headingListGet`), the navigation layer its link index, resolved once into links seen both ways, the asset store its index, the frontend object service layer the doc pages' declarations joined with the entries of its objects. None of them hands its representation to the registry; each answers from it when asked, and only what it is authorized to answer. What a provider needs of its layer is a method of the layer, so the provider only says it in the registry's words (references, descriptors, relations) and the layer stays the one place its rules live.

This is why the registry knows no layer (the second principle at the top): what a provider brings besides objects (`typeDefine`, `compList`, `open`, the peer's `providerInfoList` and `count`) is all the registry learns of its layer.

The minimal promises a provider keeps are those of the protocol, not of quality: its descriptors are well formed, its references are of its own namespaces, a change goes through its own checks. It may be slow, partial, stale or away; the registry says so instead of failing.

## Discovery and resolution

The operations are separate on purpose, each with its own promise:

| operation | answers | from |
| --- | --- | --- |
| `register(descriptorList)` | that these objects are known | the registrant; never verified by it |
| `query({ typeList, text, filter, limit })` | objects of these types and their subtypes, with how complete the answer is | every provider of an assignable type, and the registrations |
| `resolve(ref, { isVerify })` | the descriptor of one reference, with its status | its provider; what was known when it cannot answer |
| `resolve(ref, { isVerify: true })` | the same, asked again now | its provider, whatever is cached |
| `read(ref)` | `{ descriptor, content }` | its provider, always: never a cache |
| `update(ref, patch)` | the provider's answer to a change it checks | its provider |
| `relationQuery({ fromRef, toRef, typeList, text })` | relations, with how complete the answer is; with a text, those matching it (a provider declaring `relationText` searches them itself: the assets of a frontend object by name and path) | every provider of an assignable relation type |
| `create({ typeId, content, place, memberOf })`, `delete(ref, options)`, `relationCreate(spec)`, `relationDelete(spec)` | the provider's answer to a write it checks ([below](#writing-through-the-registry)) | the provider owning what the write changes |

**A query is federated.** The registry asks each provider whose types are assignable to those asked for (a provider of `todo-list.todo` for `core.task`, everyone for `core.object`), in parallel, keeps of each answer the objects that are of the types asked for and match the text, adds the registered descriptors nobody answered for, and returns them with a **completeness**: one entry per provider, `answered`, `cached`, `partial` (the provider said it listed only part: the sections of the compiled documents only), `registered`, `unavailable`, `timedOut`, `skipped`, `failed`, with a count and a message. `isComplete` is true only when every provider answered in full, and even then it means complete *for those providers*, never that no other object exists. A consumer shows the line or acts on it: a list says "3 objects · the service backend: unavailable"; a service that must have everything refuses an incomplete answer.

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

## Inside an object

Some objects hold things a reader wants to name one by one: a document its sections, a frontend object its data items. Such a thing is named by an **inner reference**: the reference of the object, `#`, and what names the thing inside it, which is its provider's to read.

```text
doc:~example:root/guide.md#setup              a section of a document: the fragment navigation uses
frontend:w5j7ozoijzl#/book/sci-fi/dune        something inside a frontend object: an inner path
```

- **An inner reference is a reference.** It is resolved, drawn and opened like any other (`doc.section`, `frontend.inner`); nothing of the registry reads what follows the `#`. A provider that has such things keeps `#` out of the references of the objects holding them, so the first `#` ends the object's reference (`objectRefInnerSplit`, `objectRefInnerBuild`).
- **A provider says that it lists what is inside its objects** with the capability `innerComplete`, on itself and on every object that has something inside (the descriptor's `capabilityList`). This is how an object declares, when it is registered, that a reference into it can be completed while it is typed.
- **Completion is the provider's.** `innerCompleteGet(ref, text)` of the store hands the text typed after the `#` to the provider of the reference, which answers at once from what its layer holds (the menu reading it is an observer, so the list follows the layer): `{ status: done | loading | none, itemList, message }`, each item a folder to go on in (`{ kind: 'dir', text, label, detail }`) or a thing to write (`{ kind: 'item', ref, label, detail }`). The doc page source lists the sections of a document, compiling it when it was not yet; the frontend objects ask the type of the object ([Things inside an object](doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths)).
- **A missing thing keeps its type.** A provider answering `missing` for an inner reference may still say what it is (its types), so the view of that type says where the reference stands that nothing is there, instead of the fallback view.

### Writing a reference

Resolution reads a reference; its inverse writes one while the author types. The object service layer offers this as the slash action **`/object`** ([Slash mode](doc_page_impl_edit_slash.md)), which walks the registry as it is organized, a step per choice (`lib/doc-object-complete.js`):

```text
/object ␣                         the types some provider lists objects of (those a doc page, a package or a
                                  template declares before the built-in ones); words narrow them
/object example.reading-list/     the objects of the type: one federated query, kept by the registry; words narrow it
/object frontend:w5j7ozoijzl      the object itself, to write as it is, and the top of what is inside it
/object frontend:w5j7ozoijzl#/book/sci-     inside it: innerCompleteGet, the provider's
```

An object whose provider lists nothing inside it is written at once. What is written for the reference chosen is the surface's to say (`objectSlashActionBuild({ textBuild })`):

| where | written | drawn by |
| --- | --- | --- |
| a paragraph or a list of a document | `` <!--renderComp=ObjectView-->`frontend:w5j7ozoijzl#/book/sci-fi/dune` ``: the inline form of `ObjectView` ([Inline components](doc_page_impl_mdx_li.md#inline-components)) | `ObjectView` in the placement `commentInline`, the context `inline` |
| a cell of a component | `{{@frontend:w5j7ozoijzl#/book/sci-fi/dune}}`: the token kind `object/view` ([Cell editing](doc_page_impl_edit_cell.md#token-kinds)) | `ObjectViewHost`, the context `inline` |

Both draw the object through the registry, so the cell and the paragraph know no type: the view of the object's types is chosen as everywhere ([Object views](#object-views)).

## Writing through the registry

A change of an object is its provider's: the registry finds the provider and hands it the write, and the provider's own checks decide, exactly as for an update. The registry keeps nothing of a write but forgets what it kept of that provider (and of the references touched), so the next resolve and query ask again; what was created is known at once (`resolvePrime`). Who answers each write:

| write | handed to | example |
| --- | --- | --- |
| `update(ref, patch)` | the provider of the reference's namespace | a todo `{ isDone }`, a config `{ valueByKey }`, a frontend object `{ name, metadata }`, an asset `{ text \| data }` |
| `create({ typeId, content, place?, label? })` | the first provider whose `createTypeList` holds a type `typeId` is assignable to | `example.reading-list` (below `frontend.object`) by the frontend objects; `asset.item` by the asset store |
| `create({ memberOf: { ref, key?, data? }, content })` | the provider of the collection `memberOf` names: a collection keeps its members, so it makes the member and the relation | an asset created in a frontend object, listed under its key |
| `delete(ref, options)` | the provider of the reference | a frontend object with its assets (`{ isMemberKept }` keeps them); an asset's deletion mark |
| `relationCreate({ fromRef, type, toRef, key?, data? })`, `relationUpdate({ fromRef, key \| toRef, data })`, `relationDelete({ fromRef, key \| toRef, isTargetDeleted? })` | the provider of `fromRef`: a relation belongs to whoever keeps it ([below](#relations-collections-and-groups)) | an asset of the store attached to a frontend object; its name and paths changed (the data of its entry); one taken out, kept or deleted |

What a write carries is in the words of the object's type (`content`, `patch`, `options`), the way an update's patch is: the registry checks only that a type exists and that a provider offers the write (else `-2` with the reason: "no provider creates objects of the type core.task", "the doc page source does not delete its objects"). A provider offering a write says so twice: in its `capabilityList`, and per object in the descriptor's `capabilityList` (a locked asset offers no update), which is what a consumer reads before it offers the change. Which providers write today: the frontend objects (create, update, delete, the relations of their assets, [In the object registry](doc_page_impl_obj_frontend.md#in-the-object-registry)), the asset store (create, update, delete), the kernel through the peer (update of a config), the instances whose scripts implement `itemUpdate`. The documents are changed by the edit layer, not through the registry ([TODO](doc_page_impl_TODO.md#object-update-authorization)); creating and deleting objects of a service instance is [TODO](doc_page_impl_TODO.md#object-backend-write).

## The apis

The registry is offered to the palette, the hotkeys and callers outside the page (an agent working through the development server, [Remote callers](doc_page_impl_api.md#remote-callers)) as one set of **standard apis** of its semantic model, the same for every kind of object, each answered by the store's method of its name and so by the provider that owns what it is about (`comp-doc/api/api-object.js`):

```text
types      type/list { typeList? }            the types (of these and below), each with its ancestors, who defines it,
           type/get { typeId }                who creates objects of it (creatorList), and what providers add (typeInfoGet:
                                              the modes of a frontend object type), its descendants
finding    object/search { text, typeList? … } the search by words (doc_page_impl_obj_search.md)
           object/query { typeList, text?, filter?, limit? }   a federated query, with its completeness
           object/resolve { ref, isVerify? }
content    object/read { ref }                the content, from its provider (an asset: the text of its head)
           object/open { ref }
writing    object/create { typeId?, content?, place?, memberOf?, label? }
           object/update { ref, patch }
           object/delete { ref, options? }
relations  relation/query { fromRef?, toRef?, typeList?, text? }   text: words the relations must match (key, label,
                                              data), or the provider's own search of them (capability relationText)
           relation/create { fromRef, toRef, type?, key?, data? }
           relation/update { fromRef, key | toRef, data }
           relation/delete { fromRef, key | toRef, type?, isTargetDeleted? }
```

So a layer offers its objects to agents by implementing the capabilities of its provider, never by apis of its own, and a caller learns one vocabulary for all of them: a type tells it who creates its objects and what they offer, a descriptor which writes its object accepts, the content of a collection the references of its members. The search, the first of these, works the same way: it plans by what the providers say of themselves and asks them through the registry ([Moderation](doc_page_impl_obj_search.md#moderation-plan-preflight-bounded-fetch)). A component rendered as a mode of a frontend object gets a narrower api of its own object (`config.objectFrontend`), a convenience over the same layer, not another route around it.

## Relations, collections and groups

```text
relation
  key        the entry, unique for its provider: member/{todoId}, {docPath}:{index}, contains/{ref}
  type       a relation type: core.member, core.contains, doc.link, service.dependsOn, sqlite.keptFor
  fromRef, toRef
  order      its place among the relations from fromRef (members in order)
  label, data   the entry's own: a note in a group, the line and sentence of a link, the infra name of a dependency
  provider, status
```

A relation belongs to whoever keeps it, not to the objects it joins: a todo list keeps its members, the link index the links of the documents, a group its entries. The provider of the object at either end need not know of it. A relation that needs an identity, a state or permissions of its own becomes an object instead, with relations to both ends.

The relation types keep three things apart that are all edges of a graph: **containment** (`core.contains`: a section exists only in its document, a file in its folder), **membership** (`core.member`: an entry of a collection, chosen or derived, with its own key, so one object can be a member twice, each with its data), and **reference** (`core.reference`: a place names an object that may be gone, a link). `core.contains` extends `core.member`, so a view of collections lists a document's sections as members; a link is not a member of anything.

**Collections and groups.** A collection is any object with members: a group, a todo list, a folder, a document, a section; a query's result is a virtual one (`ObjectList`), with no identity at all. An explicit group is `core.group`. The registry has no group logic: a group is a provider's object like any other, and its members are its provider's relations. The page has one kind of group of its own, `ObjectGroup`, written in a document (`doc.group`, below); a service keeping groups (a timeline, a slide deck, a group service) provides them the same way, and the same views draw them. `memberStateGet(ref)` on the page is a relation query of `core.member` from the collection, in order.

## Documents as objects

The doc page source ([Doc page source service layer](doc_page_impl_source.md)) provides the doc pages of the workspace, their folders and documents from its manifests, and the places inside a document from the document compiled ([MDX compilation](doc_page_impl.md)): its headings (`toc`) and its component blocks that declare an id. Nothing of a document is registered: a reference is resolved when asked, by compiling the document once when it is not compiled yet, and a query lists the places only of the documents this page compiled (`partial`, with the reason). Three kinds of nodes are kept apart: **structural** nodes (every paragraph of the AST) are nobody's objects; **addressable** ones (a heading, a block with an id) are objects on request; **registered** ones are only what a provider chose to register. The document is the truth of everything in it: an edit by anyone, with any editor, changes or removes what it held, and the next resolve says `missing`.

| relation | provided | from |
| --- | --- | --- |
| `core.contains` | doc page > root folders > folders and documents > top sections > sub-sections; the inverse (the container of a document, a folder, a section) | the manifests, the compiled document |
| `core.member` | a group > the references its block lists, each entry with its key and note | the block's data |
| `doc.link` | a document > the files its references resolve to; the inverse, a document's or a section's backlinks | the link index ([Backlinks](doc_page_impl_nav_backlink.md#the-link-index)) |

The links are the navigation layer's: its link index stays its internal representation, kept and changed by it alone. The layer resolves the index once into one list of links, seen both ways: the links a document writes, and the backlinks of a file ([The link index](doc_page_impl_nav_backlink.md#the-link-index)). The Backlinks panel reads the second; the provider `doc-link` says both in the registry's words, so a backlink and a `doc.link` relation are one entry, with one key, seen from two places. A reference that resolves to several files is a relation to each; one that resolves to nothing is kept, to the target as written, with `data.isResolved` false. A link to a place (`a.md#setup`) is a relation to the place, not to its document; the links written under a heading are relations from its section. Neither provider lists all its relations at once: a relation query names a document (from or to), and one naming neither is answered empty with the reason.

`ObjectGroup` is a component block whose data is a group: a label, and members, each a reference or `{ ref, key?, note? }`. Drawn, it shows its members by their views. With an id (`<!--renderComp=ObjectGroup,id=release-checklist-->`) it is an object, `doc:{document}#{id}` of the type `doc.group` (a `core.group` and a `doc.block`), and its members are `core.member` relations of the doc page source, so anything can name the group by its reference: a view of collections draws it without knowing it is written in a document.

## Object views

How an object is drawn is decided by the page, not by the object nor by its provider: a provider says what an object *is* (its types), the component registry holds what can *draw* each type, and the consumer decides *where* (the context) and *whether a change may be made there*. A component becomes a view by exposing it ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)):

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

**Choosing the view.** For an object and a context, the candidates are the views of the context whose types the object is assignable to: the components of the component registry (the package's, the doc pages' and packages' mounted ones, the host's) and the components the providers serve, which today are those of the service templates' modules ([Services](#services)), brought by the backend peer and drawn only while a ready instance of the template serves its module. The nearest type wins, by rank (of two parents at one distance, the one the object's type lists first: a `doc.document` is drawn as a document before it is drawn as a collection), then the highest priority, then a component of the page before one of a service. A consumer may ask for a view by its id (`view` of `ObjectView`), used when it can draw the object. The **fallback view** (`common/ObjectViewFallback`) is registered for `core.object` in every context with the lowest priority, so it is no special case: it is the least specific view, and every object has one. It draws what every descriptor has: the icon of the type (the nearest ancestor's when its own names none), the label, the type, the status when not found, the summary, the provider and the reference, and in the block context the content, read on request.

**A view receives** `data: { ref, descriptor }` and `config.objectView: { context, isEditAllowed, editUnavailableReason, note, isFallback }`, in the placement `objectView`, through the ordinary boundary (`RegisteredComp`), so it has `config.object` and `onEvent` like any component. It asks for a change with `objectUpdateRequest { ref, patch }`; it never knows the provider. A change is offered only when three things agree, each of its own owner: the **consumer** allows it (`isEditable` of `ObjectView`; a read-only consumer), the **provider** offers it (`update` in the descriptor's capabilities) and answers now; whether the **user** may is the provider's check when the change arrives ([Authorization](doc_page_impl_service_kernel.md#authorization) is a TODO of the backend). `isEditAllowed` is the first two; the third is the answer.

| view | types | contexts |
| --- | --- | --- |
| `common/ObjectViewFallback` | `core.object` | all (priority -100) |
| `common/ObjectViewCollection` | `core.collection` | card (members as icons), block (members as cards) |
| `common/ObjectViewConfig` | `core.config` | card, block: a form of the define list; Save is the update `{ valueByKey }` |
| `common/ObjectViewDocument` | `core.document`, `core.place` | card: opens it; counts the `doc.link` relations to a document or a section |
| `common/ObjectViewFrontend` | `frontend.object` | card: its name, the kinds of its assets, its modes; block: the object in its default mode ([Frontend objects](doc_page_impl_obj_frontend.md#in-the-object-registry)) |
| `common/ObjectViewFrontendInner` | `frontend.inner` | icon, inline: a chip, or the value as text; card; block: the object in the mode its type declares for one thing ([Things inside an object](doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths)) |
| `service/todo-list/comp/todo-card` | `core.task` | card, icon, inline: checks it off (`{ isDone }`); from the module of the template `todo-list` |

**The components a document writes** consume the registry: `ObjectView` (one object by its reference, in a context; also a node of a card diagram, and inside a line of text its inline form, a marker and the reference as inline code), `ObjectList` (the objects of some types: a federated query, with its completeness), `ObjectGroup` (a group whose truth is the document), `ObjectSearch` (a search by words, [Search](doc_page_impl_obj_search.md#the-ui)). A view keeps what it read and its draft in the layer, not in itself (`viewStateGet(key)`, `viewContentLoad`, `viewDraftSave`): the config form and the fallback view's content do. Their usage is in the demonstration, `example_doc/object-registry.md`. Every one of them draws objects through `ObjectViewHost`, which resolves the reference, chooses the view and renders it; a consumer of another package does the same.

**In a card diagram**, a node `renderer: { component: ObjectView }` with `data: { object: … }` is a card of any object: `ObjectView` declares the placement `visualizationNode` and the node contract (one `body` anchor on every side, `sizeDefault`), the way any registered renderer of the diagram does ([Internal and Registered Renderers](../package/cloud-dev-vis/doc/card-diagram-impl.md#internal-and-registered-renderers)). The diagram knows no type; the lines are its own data. Drawing a diagram from relations of the registry is [TODO](doc_page_impl_TODO.md#object-relation-diagram).

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

@object_api(description='the todos and the list, as objects')     # parameters, result, caller: the protocol's
def objectQuery(self, typeList, text='', filter=None, limit=100): …      # descriptors, with localId
def objectCount(self, typeList, text='', filter=None): …                   # how many objectQuery would answer (optional)
def objectResolve(self, localIdList): …                                     # one descriptor or None per id
def objectRead(self, localId): …                                            # { descriptor, content }
def itemUpdate(self, localId, patch): …                                   # checks the patch, then { descriptor, content }
def relationQuery(self, fromRef='', toRef='', typeList=None): …             # relations, fromLocalId / toLocalId or refs
```

- **`typeList`**: the types it defines, under its name.
- **`objectProvide`**: the objects every instance provides, in its namespace `service.{serviceId}`. Its capabilities are the object apis the script implements, each marked `@object_api(description)`: their parameters, results and caller (the kernel only: the page reaches them through the registry, never directly) are the protocol's, declared once in `service_define.py`, so a script writes only what its answer means; checked when the script loads. The kernel makes a `localId` a reference of the instance's namespace and refuses one of another, so an instance cannot speak for objects it does not own.
- **`compList`**: the components of its module beside its dashboards, today object views, named `service/{templateName}/comp/{compId}` on the page. The page loads one from the instance that provides the object drawn when it is one of the template's, else from any ready instance of the template with a built module; while none can serve it, the object is drawn by the fallback view with the reason. A component another template's objects are drawn with is **a dependency on the template that provides it**, at the level of templates, beside the infra dependencies of instances.
- **`requireList`**: what the template needs others to provide: `{ type }` (a type it extends or accepts), `{ objectView, context? }` (a view of a type beyond the fallback), `{ comp }` (a component by id), each `isRequired` or not. Where possible a template requires a type or a view, not a template: whoever provides it serves, a type compatible in name promising no more than its declaration. The requirements are resolved **on the page**, which knows every provider (the built-in and the templates' types, the views of the component registry and of the modules): the Services tab shows each as met, provided but with no ready instance, drawn by the fallback only, or missing, with who meets it.

The **kernel's provider** gives every instance, app or infra, two objects without a line of its script: the instance (`service:{id}`, `service.instance`, its status, kind, health, template) and **its config** (`serviceConfig:{id}`, `service.config`). The config reads as `{ valueByKey, defineList }` from its `service.yaml` and its script's `configDefineList`; an update `{ valueByKey }` is checked against the instance's own script (a key it does not declare, a value of the wrong type: -1), written into `service.yaml`, and the instance restarts with it (`instance_config_set`). The view of `core.config` draws it, in a document, in a card diagram, and in the Services tab above the instance's config dashboard, so an infra instance without dashboards has its config form too. The kernel also provides `service.createdFrom` (an instance to its template) and `service.dependsOn` (an instance to the instance currently providing each infra name it uses).

**A service as a consumer** uses the registry through its context: `object_query(type_list, text, filter, limit)`, `object_resolve(ref_list, is_verify)`, `object_read(ref)`, `object_update(ref, patch)`, `relation_query(from_ref, to_ref, type_list)`, `object_type_is_assignable(a, b)`; as a provider, `object_register(descriptor_list, is_replace)`, `object_changed(local_id_list?)`, `object_ref_build(local_id)`, `object_type_list_match(own, asked)` (which of its types a query for others wants). The built-in templates provide: `todo-list` its todos and its list (a collection), `note-db` its notes (`note-db.note`, a `core.document`), `sqlite` the database of each consumer (`sqlite.database`, related to the consumer by `sqlite.keptFor`), `local-backup` every backup (`local-backup.backup`, related by `local-backup.backupOf`); `logging` and the connections provide none of their own.

## The page and the backend

The two registries have one model and different reach. The page's registry has the backend's as one **peer provider** (`lib/doc-object-provider-backend.js`): the namespaces of the backend's providers are its, its query and relation query are the backend's federated ones, whose completeness the page merges entry by entry, and its icons are paths of the backend api the page reaches through its own address. It is also all the page's registry knows of the services: it brings the backend's type list, the components of the templates' modules (each available while an instance serves it), the providers behind it with a count of each (which the search plans with, [Search](doc_page_impl_obj_search.md#moderation-plan-preflight-bounded-fetch)), and opens an instance or a template in the Services tab. While the backend is down (or the page has none: a build), the peer is unavailable (or absent) and the page's own objects are answered as before.

The backend cannot ask the page: the page is not a server, and may be closed. So the page **registers** its doc pages and documents into the backend's registry (`POST /object/register`, replacing what it registered before in the namespaces `doc` and `docPage`) whenever the backend is up and the source changes, and a service finds them by a query of `doc.document`, with the status `registered`: known, not verified, possibly stale once the page is closed. The backend refuses a page registration in a namespace of its own providers. A live route from the backend to the page's providers is [TODO](doc_page_impl_TODO.md#object-backend-page).

## From a component

A component of the registry reaches the page's registry two ways: `config.object`, a stable service object (`resolve`, `query`, `read`, `update`, `create`, `delete`, `relationQuery`, `relationCreate`, `relationUpdate`, `relationDelete`, `typeGet`, `typeInfoGet`, `typeIsAssignable`, `open`), and the event layer ([Events](doc_page_impl_event.md)), the route `object`: `objectResolveRequest { ref | refList, isVerify }`, `objectQueryRequest { typeList, text, filter, limit, isFresh }`, `objectRelationQueryRequest { fromRef, toRef, typeList }`, `objectReadRequest { ref }`, `objectUpdateRequest { ref, patch }`, `objectCreateRequest { typeId, content, place, memberOf }`, `objectDeleteRequest { ref, options }`, `objectRelationCreateRequest`, `objectRelationUpdateRequest`, `objectRelationDeleteRequest` (the spec of the write), `objectOpenRequest { ref }`, each answered `{ code, data, message }`. A component of a service's module, which has its own module scope, uses the events. Opening an object goes to where its own layer shows it, and its provider does it: a document is navigated to, an instance or a template opens the Services tab on it, an asset the asset panel; an object nobody provides (a registration) is opened by the first provider that knows its kind of place.

## What is in the kernel, and what is not

| level | what | where |
| --- | --- | --- |
| mechanism | references, descriptors, the type registry (assignability, rank), provider dispatch by namespace (and by created type, by collection, by the keeper of a relation for the writes), federation with completeness, caching and invalidation, registrations | `service_object.py`, `DocObjectStore` |
| standard types | `core.*` (object, collection, group, document, place, config, task, file, service, member, contains, reference) and the domain types of the page and the kernel | `object-type-builtin.json` |
| built-in providers and views | the kernel's (instances, templates, configs), the page's layers, the fallback and the views of collections, configs and documents | the kernel, `lib/doc-object-provider-*.js`, `comp-doc/object/` |
| services and components | groups, timelines, slide decks, a graph of relations, the todos, the notes, a card of a task | templates (`objectProvide`, `compList`) and components (`expose.objectView`) |

Nothing about groups, timelines or graphs is in the kernel: a timeline is a service providing a `core.collection` subtype whose member entries carry a start and a duration, drawn by any view of collections and by its own; a group service keeps groups; a relation index is a service answering relation queries. The kernel knows how to ask them, not what they mean.

## Files

```text
built-in/type.yaml                     the built-in types (doc_page_impl_type.md)
service-backend/service_object.py      TypeRegistry (rebuild, assignability, problems), ObjectRegistry (providers, query,
                                       resolve, read, update, relation_query, register, changed, caches, the wait for one
                                       provider), KernelObjectProvider, InstanceObjectProvider
service-backend/service_define.py      expose: typeList, objectProvide (capabilities from the object apis), compList,
                                       requireList; object_api (the protocol of the object apis); descriptor and relation normalization, references; ServiceContext:
                                       object_query, object_resolve, object_read, object_update, relation_query,
                                       object_register, object_changed, object_ref_build, object_type_is_assignable
service-backend/service_runtime.py     the registry kept beside the service registry: the types rebuilt after a scan, an
                                       instance's answers forgotten when it restarts, instance_config_set, api_call's wait
service-backend/server.py              GET /type/list, /object/provider/list; POST /object/query, resolve, read, update,
                                       relation/query, register, unregister
frontend/src/lib/doc-object-ref.js     references (inner references among them), descriptors, relations, contexts, statuses, request keys
frontend/src/lib/doc-object-complete.js   completing a reference while it is typed: a type, an object, inside it (/object)
frontend/src/lib/doc-object-type.js    the built-in types, typeRegistryBuild: assignability, distance, rank
frontend/src/lib/doc-object-provider-doc.js     the doc page source: doc pages, folders, documents, places, groups; opens a document
frontend/src/lib/doc-object-provider-link.js    the links (doc.link) of the navigation layer (DocLinkStore), both ways
frontend/src/lib/doc-object-provider-asset.js   the asset store's objects; opens the asset panel
frontend/src/lib/doc-object-provider-backend.js the backend's registry as a peer: its objects, types, components (compList),
                                                providers and counts; opens the Services tab
frontend/src/lib/doc-object-provider-frontend.js the frontend objects (doc_page_impl_obj_frontend.md): their types, their
                                                assets as members; opens the Frontend objects tab
frontend/src/lib/doc-service-api.js    the object endpoints of the backend
frontend/src/store/DocObjectStore.ts   the page's registry, knowing the layers only through their providers: types,
                                       providers, resolve / query / relation states and caches, innerCompleteGet, read, update, the
                                       writes (create, delete, relationCreate / relationDelete) and typeInfoGet,
                                       registrations, the views (candidates, choice), requirement status, open, the
                                       events, the page's documents registered into the peer
frontend/src/lib/doc-object-registry.test.js   types, references, federation, tolerance, registrations, the choice of a view,
                                               what a provider brings (types, components, opening), where the writes go
comp-doc/api/api-object.js             the standard apis: type/*, object/*, relation/*
frontend/src/store/DocObjectSearchStore.ts, lib/doc-object-search.js   the search (doc_page_impl_obj_search.md)
comp-doc/object/                       ObjectViewHost (one object drawn), ObjectView, ObjectList, ObjectGroup, ObjectSearch,
                                       ObjectSearchPanel, object-slash.js (/object), object-cell.jsx (the object view as a
                                       token of a cell, doc_page_impl_edit_cell.md), the views
                                       (Fallback, Collection, Config, Document), ObjectCompleteness, object-icon.jsx,
                                       object-comp-define.js (the definitions), object-comp-data.js, DocObject.css
comp-doc/service/service-comp-define.js, ServiceCompHost.jsx   the components of a template's module (compList)
comp-doc/registry/comp-expose.js       expose.objectView, compObjectViewGet
comp-doc/registry/RegisteredComp.jsx   config.object
comp-doc/settings/ServiceSettings.jsx  a script's types, objects, components and requirements; an instance's config object
example_doc/object-registry.md         the demonstration: views, lists, a group, a collection, a card diagram, tolerance
```

## Future updates

What the present model leaves for later (persistent registrations and pins, versions of types, types of doc pages and packages, a diagram of relations, a live route from the backend to the page, batched resolves, the authorization of changes) is in [TODO](doc_page_impl_TODO.md#object-registry).
