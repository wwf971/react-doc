<!-- How to build a desktop app on react-doc: its semantic model kept as frontend objects (partitions, versions, keys), its config as an object of layers, what is never an item, its parts and how they meet. Recommendations, from the first such app (db-migration-tool). Parent document: doc_page_impl.md -->

# Desktop Apps on react-doc: Design

An app built **on** react-doc is not a doc page: it has a window of its own (Electron), a backend doing the work (python, node), and pages of its own drawn with react-doc's components. It uses react-doc for two things a doc page has already solved: **keeping data** (versioned, partitioned, readable by anyone with a doc page) and **drawing** (the card diagram framework of cloud-dev-vis, packages of components). This document says how such an app is laid out, and why; db-migration-tool (its repository, `doc/dmt_core.md` and `doc/dmt_impl.md`) is the first instance and the example of every recommendation.

<!--renderComp=DiagramText-->
```text
Electron shell        windows, a splash until the first page is ready, the backend as
  │                   a child process, the data folder, the size of the window
  ▼
renderer              React pages over the apis; react-doc packages bundled from source
  │ http + token      (cards, diagrams, scenes): data built by the app, drawn by them
  ▼
backend               every capability a named api: { code, message, data }
  │                   transports: http, stdio, the command line, in process
  ▼
workspace folder      a doc page holding the objects of the app (written by the backend,
                      in react-doc's files), secrets and run data beside it
```

## The semantic model is frontend objects

**What the app is about (its resources and their relations) is kept as data items of frontend objects** ([Frontend objects](doc_page_impl_obj_frontend.md)), in a doc page the workspace holds. Not a database of its own, not loose yaml files: an item has versions, a partition, a record with a key and paths, and react-doc reads it anywhere a doc page is served.

- **One object holds a small system**: the resources of one workspace, each one item (or a few under its key), related **by key**. The type of the object is declared by a package of the app (`type.yaml`), so a doc page importing it knows it ([Types](doc_page_impl_type.md)). Several objects when the parts are of different natures (the config, below; a library of queries).
- **The key of a resource is its id**; what a resource holds lies under it (`{db}.canvas.{id}`). A path index (`/database/{id}`) mirrors the path system of the app, so a doc page can find and search the items as the app names them ([Asset paths](doc_page_impl_obj_frontend_asset_path.md)).
- **The backend writes the files itself, as the asset layer keeps them** (the storage type file-tree: `object.yaml`, the entry, `item-list.yaml` of each partition, `item.yaml`, a file per version): the app needs no react-doc process to run, and react-doc reads what it wrote. Every write is a new version; unchanged text writes nothing; a removal marks deleted. The entry's metadata, rewritten in place, holds the summaries a list needs without opening large items.
- **Nobody edits these objects in a doc page**: the type refuses items coming in (`isIncomingRefused`), and the app is where they change. A doc page shows them (the built-in overview, or modes of the app's package).
- **Read again what another process wrote**: a backend serving several clients, and a run in a process of its own, write the same object; an instance remembers the times of the item lists it read and reads again when they changed.

### Partitions split by origin

Decide the partitions with the type ([Partitions](doc_page_impl_obj_frontend.md#partitions)). An app with example data has at least two:

| partition | holds | git |
| --- | --- | --- |
| `example` | what the example builder made: a complete workspace of made-up data, named after no real system | kept |
| `real` (the default) | what a person made: real names, real readings, real results | kept out, whole |

A resource is an example **because it lies in `example`**: the flag answered (`isExample`) is read from the partition, never written. **What is made from a resource goes into its partition** (the readings of a database, the plan of a schema). A config key of the app hides the example everywhere a list or a diagram of resources is drawn, while a path to one still opens it.

### Freeze what is built on

What one resource builds on another's data is **copied with where it came from** (object, item key, version), never read from the head again: a schema freezes the readings it maps, an execution the version of the plan it runs. The versions of items make this cheap and exact; a newer version changes nothing until a person takes it, and the difference is then answered.

### What is never an item

| | why | where |
| --- | --- | --- |
| **secrets** | an item is versioned and read by whoever reads the doc page | a file of its own per resource, mode 600, kept out of git; never in an answer |
| **run data** (journals, record outcomes, logs written many times a second) | an item is a version of a text, not an append-only stream; a file watcher has no reason to see it | a run folder named by the item, beside the doc page, split by partition (`run/real/` kept out of git) |
| **remembered shape** of the window and panes | belongs to the machine and the executable, not to the workspace | the data folder (below) |

An item says what a run is (its plan version, the accounts bound); its run folder says what happened. A report summarizing a finished run may become an item.

## The config

Three kinds of configuration, kept apart because they answer to different things:

| | what | where | read |
| --- | --- | --- | --- |
| **machine settings** | what is needed before any workspace is open: certificate trust, where react-doc is | a file of the data folder, declared once (type, default) for the backend and the build | at start, by the build |
| **remembered shape** | the size of the window and panes, what is folded, widths of columns | a file of the data folder per executable, against a list of declared entries; stale entries said and removed on purpose | by the renderer before its first page |
| **semantic config** | what the app does: whether the example is shown, the defaults of what it makes | **a frontend object of config layers** in the doc page of the workspace (package `app-config`, type `app-config.config`) | by the backend, through its apis |

**The semantic config is layers, stacked.** Each layer is an item; a partition holds any number of them; partitions stack in the order of the object (`shared` kept by git, then `local` of this checkout), layers within one by their order; a later layer wins, key by key. A value is taken only for a declared key of its type: anything else is a problem of its layer, shown and not used. **The simple case is one local layer**, made by the first change; with no object the config is its defaults. The keys are declared once by the app and written into the object, so it explains itself in a doc page. The rules and their cases are the package's (`package/app-config/doc/README.md`, `app-config-case.json`): a backend in another language mirrors them and is tested against the same cases.

This is not the config of a page: react-doc's own config system ([Config system](doc_page_impl_config.md)) decides how a doc page and a workspace of doc pages behave (its layers are the package's defaults, the doc pages, the workspace, the reader's browser). An app's semantic config never goes there.

## The path system and the graph

**Every resource has a path** (`/database/{id}`, `/database/{id}/canvas/{id}`), the path of what holds it is its parent, and it may use others. One api answers all of it as a graph (`{ nodeList, edgeList }`); the path bar, the side panel and the overview of the app are drawn from that answer alone, so a new kind of resource is a few nodes and edges and appears everywhere. Pages are structure first: the top of a page shows how things relate (a diagram, a tree, links); forms are dialogs.

## The backend

- **Every capability is an api** of one registry, answering `{ code, message, data }` (`AGENTS.md`: one shape for every answer). The command line, the app and an agent call the same apis; a transport (http with a token, stdio, in process) adds no logic.
- **Something done to a resource is a message** sent to it, its result a reply under it, kept in one log: what happened can be looked at again, and an action is never an alert of a page.
- **Long work is a run of an engine**, not a long call: a process of its own (detached, no window on Windows), a journal appended and replayed for the state, a lock with a heartbeat, tasks done again after a crash and written so that doing them twice changes nothing, a pause taken at a checkpoint. Its state is a function of the journal, so any process can be killed at any instant.
- **Nothing is read from an outside system by looking**: reading is an action, and what was read says when.

## The renderer and the diagrams

- React with the app's own components (Material UI, say) for pages and forms; **react-doc's packages bundled from source** (a vite alias to the checkout) for what react-doc draws: the card diagram framework, scenes of the flexible switch, cards of a platform. A small host answers the services a component asks of a page with none.
- **The app builds the data of a diagram; the framework draws it.** A card, an arranger or a scene the app lacks is added to the framework, generic, with its test and document, never drawn in the app.
- A drawing of the app may be **one HTML file** for someone without the app: a second entry of the renderer built into one script (the viewer), and the backend composing the page from it and the data, saying in the page what it was made from.

## Documents

An app keeps **one small document of its core model** (the resources, how they relate, where they are kept), **one document per resource** (`{app}_core_{resource}.md`), and one per layer of its implementation; an `AGENTS.md` maps each kind of change to the document to read first. The model is what a person discusses; the implementation follows it.
