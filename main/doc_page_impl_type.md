<!-- Design of the type registry: what a type is, what the registry answers, where types are declared and in which grammar. Parent document: doc_page_impl_obj.md, the object registry that uses it. -->

# Types: Design

A **type** says what an object or a relation is: a `core.task` can be checked off, a `doc.document` has sections, an `example.reading-list` is drawn as a shelf. Everything of the [object registry](doc_page_impl_obj.md) leans on it: a search filters by type, a view is chosen by type, a [frontend object](doc_page_impl_obj_frontend.md) has one, which names the components that draw it. The **type registry** is the list of all types, and the one question it answers is whether a type is another: it knows nothing of who provides objects or how they are stored.

Types come from a few places, and all but one use the same yaml grammar:

```text
built-in/type.yaml               the types of the page itself        core.*, doc.*, asset.*, frontend.*, service.*
{template}/service.py            a service template, in its script   todo-list.todo      (known to the backend too)
.doc-page/type.yaml              a doc page                          example.reading-list
.doc-page/object-frontend/{id}/type.yaml  one object, travelling with it   db-migration.project
{package}/type.yaml              a package, for whoever imports it
        │
        ▼
the type registry                id -> type, ancestors, assignable, rank
        │
        ├─► object registry      search by type, views, labels, icons
        └─► frontend objects     modes (components), kinds of assets
```

## What a type is

```text
Type
  id              core.task, doc.document, todo-list.todo: dotted, the first part the namespace of whoever defines it
  kind            object | relation
  label, description, icon      the icon a name of the page's icon set (box, file-text, square-check)
  extendList      the types it extends, of its kind; none for a root
  summaryKeyList  the keys of the summary an object of it promises (isDone for core.task)
  definedBy       { kind: builtIn } | { kind: serviceTemplate, id, name } | { kind: serviceInstance, id, name }
                  | { kind: docPage, alias, file } | { kind: package, name, file }
```

A type is a promise of semantics, and the `core.*` types carry the few promises consumers rely on: a `core.task` has `summary.isDone` and accepts `{ isDone }`; a `core.config` reads as `{ valueByKey, defineList }` and accepts `{ valueByKey }`; a `core.collection` has `core.member` relations. Capability-like types and semantic ones are the same mechanism, named for what they mean. Being of a type does not promise behavior beyond that (availability, permissions, consistency are the provider's), and a type an object needs a conversion to reach (a PDF as frames) is a service turning one object into another, not a parent in the DAG.

## What the registry answers

Whether an object of a type is one of another (**assignable**: the same, or a descendant), how far, and in which order its ancestors come (**rank**: breadth first, each type's parents in the order it lists them). That is all it does: it is no programming-language type system, it checks no content against a schema, and assignability comes from declarations only, never from shapes that happen to match.

What is wrong never stops the page, and is reported (`problemList`):

- a type nobody defines is taken as a child of both roots, so every object is at least a `core.object` and is drawn by the fallback view;
- a type extending one nobody defines extends the root instead, and a cycle is broken where it closes;
- the first definition of an id is kept, in the order: the backend's list, the built-in types, then the declared ones.

## Declaring a type

A type is declared in a yaml file of the doc page, by the rule of the other metadata files: **a convention with the entry over it** ([One file per section](doc_page_impl_dir.md#one-file-per-section-by-convention)).

```yaml
# .doc-page/entry.yaml: absent, .doc-page/type.yaml is read when it exists
type: { file: ./type-library.yaml }      # another file, relative to the entry
type:                                    # or several, each on its own subject
  - file: ./type-library.yaml
  - file: ./type-project.yaml
type: { typeList: [...] }                # or written in place, for a small doc page
type: false                              # the doc page declares none
```

```yaml
# a type file: .doc-page/type.yaml, a file the entry names, a type.yaml of an object or a package
typeList:
  - id: example.reading-list        # dotted, lowercase; the prefix is your own, core, doc, asset, service, frontend are refused
    kind: object                    # object (default) or relation
    label: Reading list
    description: books and notes on them
    icon: book
    extendList: [frontend.object]   # absent: frontend.object for a type with modes or kinds, else the root of its kind
    summaryKeyList: [bookCount]     # optional: what the summary of an object of it promises
    # below frontend.object (doc_page_impl_obj_frontend.md):
    modeList:
      - { id: shelf, label: Shelf, comp: ReadingList, param: { layout: table }, category: view, isDefault: true }
      - { id: book, label: One book, comp: ReadingListBook, pathParam: book }   # shows one thing of the object, named by
                                    #   an inner path in this parameter (doc_page_impl_obj_frontend.md#things-inside-an-object-inner-paths)
    assetKindList:
      - { id: book, label: Book, langList: [yaml], pathPrefix: /book/, groupPath: book }
    partitionList:                  # optional: the folders its items are split into (doc_page_impl_obj_frontend.md#partitions)
      - { id: example, label: Example, isDefault: true }          # where a write naming none goes (else the first)
      - { id: playground, label: Playground, isGitIgnored: true }
```

**Where to put one.** Types are declared in a file of their own, not in the file of what uses them. Choose by who needs the type:

| who needs it | where | it goes with |
| --- | --- | --- |
| several objects or documents of one doc page | `.doc-page/type.yaml`, or `type-{subject}.yaml` the entry lists | the doc page |
| one object, which may be copied elsewhere | `type.yaml` beside its `object.yaml` | [the folder of the object](doc_page_impl_obj_frontend.md#the-folder-of-an-object) |
| every doc page using the components of a package | `type.yaml` at the top of the package | the package: no copy of it anywhere else |

**What a type declares of components.** A type does not import anything. A mode of a frontend object type names a component by its tag name or id (`comp`), found in the component registry the usual way ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)). That is why a type belongs with its components: a package's modes in the package's `type.yaml` are there whenever the package is, and a mode whose component no registry has is marked in the Frontend objects tab, and draws one line with the reason.

**Reading.** The files are read by the development server (`doc-type-config.ts`) and reach the page with the configuration (`configDoc.typeDeclared`), in a build too. A change of one reloads the page, as a change of the apis or the tags does. In the order read, doc pages as they load, each with its objects, then the packages:

- the same declaration twice is one type, since objects copied around carry theirs;
- a different declaration of an id is a problem of the file, and the first is kept;
- a problem (an unknown key, a reserved prefix, a mode without a component, modes on a type not below `frontend.object`) leaves out that item, never the page, and is listed in the Frontend objects tab and the console.

Declaring is not limited to frontend objects: `example.ticket` extending `core.task` is a type like any other, for whichever provider answers with it. The registry takes what is declared directly, as configuration of the page; it does not go through a layer's provider, since it belongs to no layer. A layer reads the keys of its own tree from the same declaration: `modeList`, `assetKindList` and `partitionList` are the frontend object layer's, and mean nothing elsewhere.

**Types of the templates** are declared in code, because a template is code: `expose.typeList` of its script ([Services](doc_page_impl_obj.md#services)), under its own name (`todo-list.todo`). The kernel refuses a type of another name with a problem, so two templates never collide. The kernel rebuilds its registry whenever a script changes: the built-in types, then the templates' (the oldest template id first; a second definition of an id is reported and left out), then those of instances whose template is gone. The page takes the backend's list over its own built-in copy when there is a backend.

## Built-in types

`built-in/type.yaml` is read by the kernel and by the page, so both registries agree on them:

```text
core.object                                  anything the registry can name
├── core.collection                          has members (core.member, ordered, an entry each)
│   ├── core.group                           an explicit collection
│   │   └── doc.group                        an ObjectGroup block   (also a doc.block)
│   ├── doc.page                             members: its root folders
│   ├── doc.folder                           members: its folders and documents
│   ├── doc.document                         (also a core.document) members: its top sections
│   ├── doc.section                          (also a core.place)    members: its sub-sections
│   └── frontend.object                      an object the page keeps in assets; members: its assets.
│                                            the root of the types with modes
├── core.document                            a text people read
├── core.place                               a place inside another object
│   ├── doc.block                            a component block with an id
│   └── frontend.inner                       something inside a frontend object, named by an inner path
├── core.config  ── service.config           { valueByKey, defineList }; an update { valueByKey }
├── core.task                                summary isDone; an update { isDone }
├── core.file    ── asset.item
├── core.service ── service.instance
└── service.template

core.relation
├── core.member  ── core.contains            a member that exists only inside its container
├── core.reference ── doc.link, service.dependsOn
└── service.createdFrom
```

## The page and the backend

There are two registries, with one semantics (`lib/doc-object-type.js`, `service_object.py` `TypeRegistry`): the kernel's, which knows the built-in types and the templates', and the page's, which takes the kernel's list when there is a backend and adds what is declared in yaml. A declared type is therefore known to the page only: an object of a service answering with `example.ticket` is a child of the roots on the backend, though it is drawn as an `example.ticket` on the page ([TODO](doc_page_impl_TODO.md#object-type-source)).

## The apis

Types are read through the standard apis ([The apis](doc_page_impl_obj.md#the-apis)): `type/list { typeList? }` the types, with their subtypes when filtered; `type/get { typeId }` one type, its ancestors, who creates objects of it (`creatorList`), and what the layers add (`typeInfoGet` of a provider: a frontend object type's `modeList` with the inherited ones, and `assetKindList`). From a component, `config.object.typeGet`, `typeInfoGet`, `typeIsAssignable`.

## Files

```text
built-in/type.yaml                  the built-in types, read by the kernel and the page
frontend/plugin/doc-type-config.ts  the type files: the entry section, the grammar, the problems, what the page receives
frontend/plugin/doc-entry.ts        "type" of an entry (typeSectionRead)
frontend/plugin/doc-source.ts       config.typeDeclared; the type files as configuration, the watch
frontend/src/lib/doc-object-type.js the registry of the page: typeRegistryBuild, assignability, rank
frontend/src/store/DocObjectStore.ts typeRegistry (provided, built-in, declared), typeDeclaredList, typeInfoGet
service-backend/service_object.py   TypeRegistry of the kernel
comp-doc/api/api-object.js          type/list, type/get
package/{name}/type.yaml            the types of a package
example_doc/.doc-page/type.yaml     the types of the demonstration
```

## Future updates

What the registry leaves for later (versions and contracts of types, declared types known to the backend) is in the [TODO](doc_page_impl_TODO.md#object-registry).
