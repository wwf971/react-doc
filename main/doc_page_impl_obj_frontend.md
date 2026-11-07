<!-- Design of the frontend object service layer: objects the page keeps itself, in assets, declared with their types by the doc pages, drawn in the modes of their types by one entry component. Parent document: doc_page_impl_obj.md. The assets are the asset service layer's (doc_page_impl_asset.md); the entry component is a component of the registry (doc_page_impl_mdx_comp.md). -->

# Frontend Objects: Design

A **frontend object** is an object of the [object registry](doc_page_impl_obj.md) whose data the page keeps itself, in the [asset service layer](doc_page_impl_asset.md). The objects of a service instance live in the backend and are drawn by the components of its template; a frontend object is the same idea run in the page: a service with no process, hosting objects as free as the **types** a doc page declares for them. One object can hold a small system of its own: several kinds of data, each piece one asset, relations between them written in the data, and several ways of working with it (seeing all of one kind, registering a new piece, looking at one of them, a summary), each a **mode** of its type.

```text
.doc-page/object-frontend/{id}--{name}/    one folder per object: what is in it is the object
  object.yaml         { id, entry }             that it exists
  type.yaml                                     optional: types it brings along
  item/               its asset items           an asset folder of the store, owned by the object
    {entryId}/        the entry asset           { name, type, description, assetList [{ key, kind, itemId }], metadata }
    {itemId}/ …       its other assets          each declares the object: owner { ref: frontend:{id} }
.doc-page/type.yaml (or beside object.yaml, or in a package)   its type (doc_page_impl_type.md)
  typeList    example.reading-list              below frontend.object: modes [{ id, comp, param, category }], kinds of assets
        │
        ▼
the page   DocObjectFrontendStore          joins the declarations with the asset store: the object as the files say now,
           │                               and what does not agree; writes through the asset api of the development server
           ├─► provider "frontend"          of the object registry: frontend:{id}, its type, its assets as members, the doc pages' types
           └─► ObjectFrontend               the entry component: a block naming the object, a mode, parameters;
                 └─ the mode's component    rendered in the placement objectFrontend with config.objectFrontend
```

## The concepts

- A **frontend object** has an id (ms_48), a reference `frontend:{id}`, a type, a name, and any number of **assets**. It exists because its folder says so ([The folder of an object](#the-folder-of-an-object)); what it is, its entry says.
- Its **entry asset** is an asset item whose data (yaml) describes the object: its name, its type, its description, its assets by **key**, and **metadata**, a free mapping of the type's own.
- An **asset of an object** is an asset item its entry lists under a key unique in the object; it lies in the object's folder and **declares** the object in its own metadata (`owner`), and the entry gives it a **kind** that groups the assets of one sort (`book`, `note`), and optionally a **name** for people and **paths** indexing it, as many as the object wants (`/book/sci-fi/dune`, `/author/frank-herbert/dune`). Why they are never called objects: [A word on the names](#a-word-on-the-names-objects-hold-items).
- A **type** is a type of the type registry, `frontend.object` or one a doc page declares below it; it says how the object is drawn: its **modes**.
- A **mode** is a component of the component registry and the parameters it starts with, with an id, a label and a **category** (`view`, `edit`, anything: how the modes are grouped). A type has its own modes and those of its ancestors.
- The **entry component**, `ObjectFrontend`, is a block of a document naming an object, a mode and the parameters of that mode, and rendering the mode's component.

## Who is the truth of what

| what | its truth | read by |
| --- | --- | --- |
| that an object exists, in which doc page | the `object.yaml` of its folder (or a line of `objectList`) | the server, for every request; the page at start and on every change of the file |
| what an object is: name, type, its assets, metadata | its entry asset (the head) | the page, through the asset store |
| the data | each asset (the head), the asset store's | the mode's component, through the object's api |
| that an asset belongs to an object | the entry's `assetList`; the asset's `owner` and the folder it lies in are checked against it ([How an asset comes to belong](#how-an-asset-comes-to-belong)) | the page, which reports where they disagree |
| the types and their modes | the type files ([Declaring a type](doc_page_impl_type.md#declaring-a-type)) | the type registry, the store |
| what a block shows | its data: `{ object, mode, param }` | the entry component |

Nothing of an object is kept anywhere else: the registry answers from the store ([the registry is never the truth](doc_page_impl_obj.md)), and the store holds what the files said when it last read them. The entry's list is the structure the object works with (in order, by key); the asset's owner survives a lost or rewritten entry and is what recovers an asset whose object is gone ([How an asset comes to belong](#how-an-asset-comes-to-belong)).

## The folder of an object

An object is a folder, and the folder is self-contained: copied into another doc page, the object is there, with its data and its history, and nothing else has to name it. All the folders of a doc page are in one managed folder ([the doc page folder](doc_page_impl_dir.md#frontend-objects)), made by the first object:

```text
.doc-page/object-frontend/
└── w5j7ozoijzl--Reading list/       {id}--{name}, in ASCII (a name with no ASCII gives way to the type); follows the name
    ├── object.yaml                  id, entry; isDeleted when there is something to say
    ├── type.yaml                    optional: the types it brings along
    └── item/                        the asset items of the object
        ├── w5j7ozokr1x/             the entry asset
        └── w5j7pmxa7fw/             an asset: item.yaml, {versionId}.yaml
```

```yaml
# object.yaml
id: w5j7ozoijzl                      # the object: frontend:w5j7ozoijzl; the folder name starts with it
entry: w5j7ozokr1x                   # the item id of its entry asset
isDeleted: true                      # the object was deleted, its files stay (below)
```

- **`object.yaml` makes it an object.** A folder without one, or naming another id than its folder name, is left out and reported, never the page. A person writes it, or the page does when it creates an object; the page changes only `isDeleted`, line by line, with a `.bak` beside it.
- **`item/` is an asset folder of the store**, owned by the object ([Folders owned by an object](doc_page_impl_asset.md#folders-owned-by-an-object)): no `asset.yaml` names it. The assets of an object are created here, and one that comes from elsewhere moves here; items may be nested in folders of any depth ([Where an asset lies](#where-an-asset-lies-and-how-it-is-found)). The entry names items by id, so one lying elsewhere in the store still works, but that is a state the page reports, not a way to organize an object.
- **A new name renames the folder**; ids stay, so nothing that refers to the object or its items changes.
- **Deleting an object does not remove its folder.** Its `object.yaml` says `isDeleted: true`, so the object stops existing, and its assets are marked deleted, so references to them still resolve; with its assets kept it is an [orphan entry](#how-an-asset-comes-to-belong), which **List it** brings back. Removing the files is a step for a person.
- **A type used by this object alone belongs in `type.yaml` beside it**, so that it travels with it ([Declaring a type](doc_page_impl_type.md#declaring-a-type)). The components its modes name do not travel: they are found in the doc page or a package, as any component, which is why the type of a package's components is the package's.
- Later, this folder may hold more than items (components of its own), and the items may come from a backend instead of `item/`: [TODO](doc_page_impl_TODO.md#object-frontend).

An object may also have **no folder of its own**: a line `{ id, entry }` in `objectList` of the doc page's file, with its assets in an asset folder of the doc page, in a group folder `{id}--{name}` that follows its name ([Group folders](doc_page_impl_asset.md#group-folders)). It behaves the same, except that it cannot be moved by copying one folder; `react-doc migrate` turns one into the other ([Migrating](doc_page_impl_cli.md#migrating-a-doc-page)).

## Its type

An object has one type, named in its entry. A type below `frontend.object` says how the object is drawn and what it holds; where it is declared and in which grammar is the same for every type ([Declaring a type](doc_page_impl_type.md#declaring-a-type)): in `.doc-page/type.yaml` for what a doc page shares, in `type.yaml` beside `object.yaml` for a type that travels with one object, in `type.yaml` of a package for a type of its components.

```yaml
typeList:
  - id: example.reading-list
    label: Reading list
    icon: book
    assetKindList:                  # what it holds (#what-a-type-accepts)
      - { id: book, label: Book, langList: [yaml], pathPrefix: /book/, groupPath: book }
    modeList:                       # how it is drawn (#types-and-modes)
      - id: shelf
        label: Shelf
        comp: ReadingList           # a component of the registry: a tag name, or an id
        category: view              # default view
        param: { layout: table }    # what the component starts with
        isDefault: true
      - { id: add, label: Add a book, comp: ReadingListAdd, category: edit }
```

A type with modes or kinds of assets is below `frontend.object` unless it says which type it extends. The components a type names are the doc page's own (`comp-mdx/`) or any of the registry, mounted the usual way ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)); one no registry has is marked in the Types table of the settings tab.

## What a doc page says: `object-frontend.yaml`

A doc page needs no file for its objects: its folder says they exist. `.doc-page/object-frontend.yaml` (`objectFrontend: { file }` of the entry for another file, `objectFrontend: false` for none) is there for the two exceptions:

```yaml
# .doc-page/object-frontend.yaml
folderList: [./object-frontend]     # the folders holding the object folders, relative to this file;
                                    #   the first is where a new object goes
objectList:                         # objects without a folder of their own (above)
  - id: w5j7ozoijzl                 # the object: frontend:w5j7ozoijzl
    entry: w5j7ozokr1x              # the item id of its entry asset
```

A change of the file or of an `object.yaml` is not a reload of the page: the development server watches them and tells the page (`doc-asset-change { isObjectFrontendChanged }`), which reads them again, as the asset store reads its `asset.yaml`. Every problem (an unknown key, an object found twice) is reported with the file and leaves out that item, never the page; the Frontend objects tab lists them.

## The entry asset

```yaml
# the head of the entry asset (lang yaml)
name: Reading list
type: example.reading-list
description: the books of the demonstration, and notes on them
assetList:
  - key: book-1
    kind: book
    itemId: w5j7pmxa7fw
    name: Dune                        # optional: for people
    pathList:                         # optional: the paths indexing it, each unique in the object
      - /book/sci-fi/dune
      - /author/frank-herbert/dune
  - { key: note-1, kind: note, itemId: w5j7pmznvdq, pathList: [/note/dune/1] }
metadata: {}            # the type's own: anything it wants to keep about the object as a whole
```

The entry is data the layer keeps, like the workbook of a sheet: it is written whole (`objectFrontendEntryTextBuild`), in place, by the server's writes. Read, every key is taken as far as it can be (`objectFrontendEntryParse`): an entry naming no type is a `frontend.object`, a type that is not a frontend object type is drawn as `frontend.object` with a problem, an asset listed twice under one key is left out. A key is `[A-Za-z0-9][A-Za-z0-9_.-]*`; an asset created without one gets `{kind}-{n}`. The key is how a mode addresses an asset, so a mode never writes object ids; relations between assets (a note naming its book) are written in the data, by key, which never changes, rather than by a path, which is an index the object may rearrange. A name and paths are written only when an asset has them ([Naming and finding the assets](#naming-and-finding-the-assets)).

## Naming and finding the assets

An object holding many assets of several kinds needs them found: by the mode drawing one of them (`book: /book/sci-fi/dune`), by a reader typing where it is, by a search, by an agent. Each asset may carry two things for that, in its entry; both are the object's choice, and both may be absent (an asset is still its key):

- a **name**, for people (`Dune`, the title of a book); names need not be unique;
- **paths**, any number of them, each indexing the asset one way: a book filed by its genre and by its author, `/book/sci-fi/dune` and `/author/frank-herbert/dune`. Several paths are what lets one object be browsed by several hierarchies at once.

**A path is read as an operating system reads one.** `/` separates the folders; repeated and trailing slashes, `.` and `..` are resolved (`book//sci-fi/./x/../dune/` is `/book/sci-fi/dune`; going above the root is refused); a folder name is any text up to 80 characters without control characters. It is kept in its canonical form, always from the root of the object (`objectFrontendAssetPathNormalize`). The folders are implied by the paths (`/book`, `/book/sci-fi`) and hold nothing themselves: there is no folder to create or to remove. A path names **one** asset of its object: the writes refuse a path another asset has; one written twice by hand names the first asset and is a problem of the object. An asset whose paths and name are absent is reached by its key.

**Recommended patterns.** Which paths an asset has is up to the type (its modes write them), and a lazy type gives none. Paths are most useful when the **first folder is the kind** (`/book/…`, `/note/…`), so the kinds are the top of every listing, then folders of what the object's readers sort by (a genre, an author, a parent: `/note/{its book}/{n}`), then the asset's own segment, a name made a folder name (`objectFrontendAssetPathBuild('book', genre, title)`: lowercase, letters and digits joined by `-`). Keep a path a description of the asset, not its identity: the data names other assets by key.

**An asset reference** is what names one asset within its object, wherever one is asked for (a mode's api, a block's `param`, the components below):

```text
/book/sci-fi/dune     a path (it starts with "/")
book-1, key:book-1    its key
name:Dune             its name; several assets of the name: the first, said to be ambiguous
id:w5j7pmxa7fw        the object id of the asset
```

It resolves (`objectFrontendAssetRefResolve`, over the object's index `assetIndex`: by key, path, name, id, and the folders) to a status, and a reader of an asset handles each:

| status | means | what a mode shows |
| --- | --- | --- |
| `found` | an asset of the object, there in the store | it |
| `missing`, `deleted` | an asset the entry lists, gone from the asset store or marked deleted; the answer still carries the asset (its key, name, paths) | the asset by its name, with the state (the overview, the stats of the demonstration count them) |
| `unknown` | nothing of the object answers to it: no such path, key or name, or a path that is a folder | the reference and why |
| `loading` | the entry is not read yet | a line |

Every read of the mode api takes a reference (`assetTextGet`, `assetDataGet` answer `assetStatus` and the asset beside an error), so a block whose asset is gone says so where it is, never an empty block.

**Searching** the assets of an object reads words as the object registry's search does ([The grammar](doc_page_impl_obj_search.md#the-grammar)): words in any order, every one matching some field, a word narrowed by a key, `kind:book`, `name:dune`, `path:sci-fi` (a path word starting with `/` is a prefix: `path:/author/`), `key:`, `id:`; the score adds where each word matched (the start of the name 8, the name 5, the start of a folder of a path 4, a path 3, the key 3, the kind 2, the id 1), best first, with the path the words matched (`objectFrontendAssetSearch`). **Completing** a typed path lists the folder typed so far, as path completion of the doc page source does ([Path completion](doc_page_impl_source.md#path-completion)): its folders with how many assets they hold, then its assets, those whose folder name (or name) starts with what follows the last `/` first; a text without a leading `/` is read from a base folder; a kind list keeps the assets of those kinds and the folders holding one (`objectFrontendAssetPathComplete`). Both read the layer's memory, so they cost nothing per keystroke.

**What the layer offers to build modes with.**

```text
config.objectFrontend (a mode's api)        assetResolve(ref), assetGet(ref), assetSearch(text, { kindList, limit }),
                                            assetComplete(text, { kindList, base }), assetTextGet(ref), assetDataGet(ref),
                                            assetCreate({ ..., name, pathList }), assetMetaSet(ref, { name, pathList, kind }),
                                            assetWrite(ref, …), assetRemove(ref)
DocObjectFrontendStore                      the same by object: assetResolve(object, ref), assetSearch, assetComplete,
                                            assetSearchSessionGet(key, { object, kindList }), assetMetaSet(id, key, change)
ObjectFrontendAssetPathInput                a path typed with completion, the look of SourcePathInput: the field, the dropdown
  { object, value, kindList, base,          of the folder typed (folders with their count, assets with their name, kind and
    isMissingWarned, onCommit, onChoose }   state); a folder continues into it, an asset is chosen (onChoose); Tab takes the
                                            highlighted one; with isMissingWarned, a warning when the text names no asset
ObjectFrontendAssetSearchPanel              the search as a panel, the look of ObjectSearchPanel: the field, the kinds of the
  { object, sessionKey, kindList,           object as buttons, rows of name, kind, the path the words matched and the state;
    onChoose, onClose }                     ArrowDown / ArrowUp / Enter / Escape; its session is the store's
```

Both components take the object by its reference and read the store themselves, so a mode, another block, or a panel uses them alike; the settings tab uses the search to find an asset of the chosen object, the demonstration's mode **find** both. Through the object registry the same is offered to everyone else: `relation/query { fromRef, text }` answers the assets the search finds (the provider has the capability `relationText`), each relation carrying `{ kind, name, pathList, status }`; `relation/update { fromRef, key, data: { name?, pathList?, kind? } }` names and indexes one (paths replaced whole); `object/create` with `memberOf.data` and `relation/create` take a name and paths too.

**Versions.** An object reads the **head** of each of its assets: the entry lists assets, never a version of one, so a write of an asset is what every mode shows next. An asset pinned to a version (an object whose part must not change while its source is revised) is [TODO](doc_page_impl_TODO.md#object-frontend-version).

## A word on the names: objects hold items

The container is an **object**: a frontend object, like an MDX component instance, is what a reader and the registry deal with. What it holds is one level below, and is never called an object: an **asset item** of the [asset service layer](doc_page_impl_asset.md), a piece of versioned data with its locks and folder, called an **asset of the object** or a **data item** where the object is the subject. *Object* has enough meanings already (anything a provider of the registry names, the frontend object itself); "the objects of an object" would make every sentence ambiguous ("delete the object": the frontend object, or one of its pieces?). The files say the same: `object.yaml` describes a frontend object, `item.yaml` an asset item.

## How an asset comes to belong

The folder says where the items of an object lie, and each item says what it declares, but neither of them says what belongs to the object: **the object does, in the list of its entry asset**. `object.yaml` names the entry, and the entry's `assetList` is the metadata that makes an item an asset of the object. Three things can therefore be looked at, and only one decides:

| what | where | it is | decides |
| --- | --- | --- | --- |
| **listed** | `assetList` of the entry | the object's own statement | **yes**: what its modes see, what the registry lists as members |
| **declares** | `owner: { ref, role? }` in the `item.yaml` | what the item says of itself | no: it recovers what a lost entry forgot |
| **lies in** | `folderOwner` of the item, read from where the store found it, never written | a fact of the scan | no: it is where a person finds the files |

Listing is the source of truth because a folder only says a file arrived, not what it is to the object: its key, its kind, its paths. That also keeps the object's knowledge versioned with its entry, and leaves room for items no folder holds (fetched from a backend, [TODO](doc_page_impl_TODO.md#object-frontend-store)).

### The normal way: one door

An asset is **created in the object's folder**, and that is the convention to keep: technically an entry can list any item of the store, whichever asset folder holds it, but an object stays self-contained and portable only while its items are in its own `item/`. So the layer has one way in, and every write leaves the three in agreement:

```text
a new asset        asset/create   the type accepts it  ->  the item in the object's folder, declaring it  ->  listed
an existing item   asset/attach   the type accepts it  ->  it declares the object, moves into the folder  ->  listed
                                  (of another object: only with isOwnerReplaced, and off that object's list)
going out          asset/remove   off the list  ->  deleted softly, or released: its owner removed, moved to a folder of the store
```

Listing comes last on the way in, so a write stopped halfway leaves a stray that is reported, not an asset that is not there. The asset layer enforces the door for the folders objects own: a generic move or create touching one is refused with `-5` ([Moving an item](doc_page_impl_asset.md#moving-an-item)), and a move chosen in the asset panel is handed to this layer, so it goes through the same checks.

### What a type accepts

Types differ in what they hold, so a type may say it. `assetKindList` of its [declaration](doc_page_impl_type.md#declaring-a-type) is read for every asset that is created or comes in; the nearest declaration along its ancestors applies, and a type where none says accepts anything:

```yaml
typeList:
  - id: example.reading-list
    assetKindList:
      - id: book
        label: Book
        langList: [yaml]         # the languages an asset of the kind is in
        pathPrefix: /book/       # one of its paths, when it has any, starts so
        groupPath: book          # the folder under item/ it goes to, unless the write names one
        isIncomingRefused: false # true: only the modes make these, nothing comes in from elsewhere
```

The check (`objectFrontendAssetAcceptCheck`) is declarative, so the development server applies it to whoever writes, a mode, the settings tab or an agent, and refuses before anything is written. A kind left out of a write is the only kind when the type has one, and otherwise the type asks for it. What a kind's data must look like is not checked yet ([TODO](doc_page_impl_TODO.md#object-frontend-schema)).

### What disagrees

Files can be changed without the layer: a folder copied in, an item dragged in a file browser, an entry restored to an older version. Nothing is repaired unasked, since the page cannot know what was meant. The page works out what disagrees from the entry and the index of the store whenever either changes (`objectGet`), and reports it on the object: in the Frontend objects tab, which counts it in the object's row, in the mode **overview**, and in `object/read` as `disagreement`. An item changed on disk reaches the page by the file watcher, so a dropped one appears without a reload.

| listed | declares | lies in | case | means | offered |
| --- | --- | --- | --- | --- | --- |
| yes | it | its folder | **normal** | | |
| no | nothing, or another object | its folder | **unknown source** (`unknownList`) | put there without going through the object. Not an asset: its modes do not see it, references by id still read it | **Adopt** (the type decides, a kind chosen; it keeps its place) or **Move out** (to the default asset folder of the doc page, nothing else changes) |
| no | it | anywhere | **stray** (`strayList`) | an entry restored to an older version, a write interrupted | **Attach**: listed again |
| yes | it | elsewhere | **outside** (`outsideList`) | moved by hand, or from the time an entry listed any item | **Move in**: `asset/move` brings it home |
| yes | nothing | any | **declares no owner** (`isOwnerMatch`) | its `item.yaml` was replaced | `asset/move` declares it |
| yes | another object | any | **claimed twice** | two entries list it, or it was handed over by hand | shown; **Remove** here, or attach it to this one |
| yes | | no such item | **missing**, **deleted** | gone from the store, or marked deleted | **Remove**: off the list |
| no entry listed | role `entry` | | **orphan entry** | an entry asset whose object no doc page has (deleted keeping its assets, or its line removed by hand) | **List it in {doc page}**: `isDeleted` taken off its `object.yaml`, or the line written again |

A folder under `.doc-page/object-frontend/` without an `object.yaml`, or naming another id than its folder name, is not an object: it is a problem of the doc page's declarations, and its files are not read at all.

## Where an asset lies, and how it is found

The folder of an object holds its items at **any depth**: inside `item/` a folder that is not an item is a group, read in turn (8 levels, [Group folders](doc_page_impl_asset.md#group-folders)), and its names may say something, `history/edu`, `book`. That is one of two layers, which do not touch each other:

| | the **place on disk** | the **paths** |
| --- | --- | --- |
| what | `groupPath` of the item, a real folder under `item/` | `pathList` of the entry, virtual |
| how many | one | any number (`/book/sci-fi/dune`, `/author/frank-herbert/dune`) |
| for | a person browsing the files, an archive, a diff | the modes, a reader typing a path, a search ([Naming and finding](#naming-and-finding-the-assets)) |
| kept in | where the folder is | the object's entry |
| changed by | `asset/move`, `asset/group/move` | `asset/meta/set` |

Moving an asset on disk changes no key, name or path, and rewriting its paths moves no file, so a mode never reads a `groupPath` to learn what an asset is. A new asset goes to the folder of its kind (`groupPath` of `assetKindList`), or the folder the write names, or the top. Folders are made by their first item and removed with their last.

## Types and modes

A type's modes are its own declarations, then those of its ancestors in the order of the type registry (the nearest first, `ancestorListGet`); a mode id declared on a nearer type hides the same id farther up (`objectFrontendModeListResolve`). `frontend.object` brings one mode to every type, **`overview`** (`common/ObjectFrontendOverview`): the object as its entry describes it, its assets with their state, its metadata, and a button per mode. The default mode is the nearest one marked `isDefault`, else the first.

Nothing ties the modes of a type to one way of looking at the same data: the page renders the component a mode names and assumes nothing about it. A mode may draw all the data as a table, be a form registering a new piece, show one asset chosen by a parameter, or sum everything up; the category only groups the modes where they are listed. A type has two ways to offer its **morphes**, and may mix them:

1. **many modes**: one per morphe, each with its component and parameters (`shelf`, `add`, `book`, `stats`);
2. **few modes, many parameters**: one component, the morphe chosen by the parameters, by the block or by the component itself (`shelf` and `cards` are one component with `layout: table | cards`; the status filter is `param.status`).

## The entry component

`ObjectFrontend` (`common/ObjectFrontend`, a built-in name like `Tag`, so every doc page has it) is the one block a document writes for a frontend object:

````md
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5j7ozoijzl      # the object (its reference, or its id)
mode: cards                       # optional: a mode of its type; absent, the default
param:                            # optional: over the mode's own parameters, a key at a time
  status: want
```
````

It resolves the object (`DocObjectFrontendStore.objectGet`), the mode of its type (`modeResolve`), merges the parameters, and renders the mode's component through the registry boundary (`RegisteredComp`) in the placement **`objectFrontend`**, adding nothing around it but a block's margins: a block reads as the mode's component would. While the object is not read yet it is one line; an object no doc page lists, an entry that cannot be read, a mode the type does not have are one line with the reason.

**What the mode's component receives.**

```text
data.ref, data.mode, data.param          the object, the mode drawn, the parameters (the mode's, the block's over them)
config.objectFrontend                    the object and its api (getters: the component is an observer)
  object                                 the object as the files say now: name, typeId, description, metadata,
                                         assetList [{ key, kind, itemId, item, status, isOwnerMatch }], strayList, problemList
  mode, modeList                         the mode drawn, the modes of the type
  assetList(kind?)                       the assets, of one kind
  assetResolve(ref), assetGet(ref)       what an asset reference (/path, key, name:…, id:…) names, with its status
  assetSearch(text), assetComplete(text) the assets found by words; the candidates completing a typed path
  assetTextGet(ref), assetDataGet(ref)   { status, message, text, asset, assetStatus } / { ..., data } of an asset's head
                                         (yaml read, shared: to be read, not changed); loaded on demand
  assetCreate({ key?, kind?, name?, pathList?, groupPath?, lang?, text | data })   a new asset: { code, data: { key, itemId } }
  assetKindList                          what its type holds (#what-a-type-accepts); undefined: anything
  assetMove(ref, groupPath), assetGroupMove(from, to)   where an asset lies under item/; nothing else depends on it
  assetMetaSet(ref, { name?, pathList?, kind? })   how an asset is named and indexed
  assetWrite(ref, text | data)           the head of an asset replaced, by its save mode
  assetRemove(ref, { isAssetKept? })     an asset taken out (deleted softly, or kept and released)
  metadataSet(patch)                     the object's metadata, a key at a time (null removes one)
  drawTurnAsk(id), drawTurnIs(id)        a turn to mount what is heavy, one block per frame (#reading-many-assets);
                                         useObjectFrontendDrawTurn(service, isReady) is the hook over them
  modeSet(modeId, options), paramSet(paramChange, options), blockSet({ mode, param }, options)
                                         the block switched: another mode, other parameters (merged, null removes a key;
                                         isReplaced replaces them), or both
  isWritable, writeUnavailableReason, write    whether the page can write here, and the structural write in progress
  open()                                 the object in the Frontend objects tab
  otherGet(ref)                          the api of another frontend object: the same reads and writes, for a mode
                                         whose data lies in two objects (a CV reading a profile)
```

A component of a mode never reaches the asset store, the development server or the document: it asks its object's api, which goes through `DocObjectFrontendStore` (and for the data, `DocAssetStore`); a component that has no `config.objectFrontend` (another block, a component of a service's module) works with frontend objects through the object registry, `config.object` and the events of the route `object`, like any object ([Writing it through the registry](#in-the-object-registry)). A component meant only as a mode declares `placementList: ['objectFrontend']` and `meta.isNotInDoc`, so the insert menu does not offer it as a block.

**Switching what the block shows.** The mode and the parameters are the block's data, so a switch is a change of the block: the entry component shows it at once (in the block's state, [the component state service layer](doc_page_impl_mdx_comp_state.md), as long as the block's text is the one it was made on) and reports `dataReplaceRequest` with the new `{ object, mode, param }`, which the edit layer writes into the document, **in reading mode as in edit mode**, wherever the page can write ([Changing its own block from reading mode](doc_page_impl_mdx_comp.md#changing-its-own-block)). With `{ isSaved: false }`, or where the document cannot be written (a built page), the switch is not written and holds while the page is open; the next text of the block (a write, an edit by hand) replaces it. A mode decides which of its switches are kept: the demonstration's status filter writes `param.status` into the block, opening one book does not.

**In edit mode** the block is entered with its Edit button only (`isEditEnterButtonOnly`: a mode takes clicks itself), in its mode **entry**: the block shows the draft in place and the floating bar holds the object (a **Change…** search of the registry limited to `frontend.object`), the modes of its type as a button group, and the parameters as yaml; every change is the draft, saved when the session ends. The built-in `source` mode edits the yaml as written.

**Creating a block.** The insert menu lists the entry as **Frontend Object…**: the component declares `meta.insertObjectPick: { typeList: [frontend.object], isCreateOffered: true }`, so choosing it opens the pick step of the menu, a search of the object registry limited to frontend objects (all of them listed before anything is typed), and one **New** button per type that creates an object of it in the doc page of the document ([Creating a block naming an object](doc_page_impl_edit.md#creating-a-block-naming-an-object)). The object chosen or created is written into the new block, which opens in its edit mode. Canceling the new block removes the block, not an object created for it: that object is real, and is deleted in the settings tab.

## Parameters of a block, of any component

The parameters of a frontend object's mode are the data of its block. For any other component the same need, a block telling its component how to show its data, has two answers, for an inline block and an asset-backed one alike:

- **the props of the marker**, `<!--renderComp=StockTable,title=Q3-->`: kept when the data of the block is an asset reference ([The reference in a document](doc_page_impl_asset.md#the-reference-in-a-document)), so an asset-backed block takes props exactly as an inline one; a component changes them with **`blockPropSetRequest { props }`** (a value `null` or `''` removes one; a value with `,`, a line break or `-->` is refused, it belongs in the data), and the api `doc/blockPropSet` does the same from the palette or an agent. The data, inline or in the asset, is not touched;
- **the data of the block**, for an inline block: `dataReplaceRequest { raw }` (an asset-backed block's data is the asset's, shared by every block reading it, so a per-block parameter belongs in the props).

Both requests find their block by its index in edit mode and by the marker line of the block in reading mode, so a component switches itself from either ([Changing its own block](doc_page_impl_mdx_comp.md#changing-its-own-block)).

## In the object registry

The layer's provider (`lib/doc-object-provider-frontend.js`, id `frontend`) speaks for it in the registry's words:

| | |
| --- | --- |
| namespace | `frontend`; the local part is the object's id |
| types | `frontend.object` (built-in, a `core.collection`) and the types declared below it, which the registry reads itself; of each, its modes with the inherited ones and its kinds of assets (`typeInfoGet`, so `type/get` answers them) |
| descriptor | label: the name; type: the entry's; summary `{ assetCount, docPageAlias, typeId }`; `open: { kind: objectFrontend, id }` |
| relations | `core.member` from the object to each asset, `asset:local/{itemId}`, keyed `member/{key}`, `data: { kind, status }`, in the entry's order; to an asset, the object it belongs to |
| capabilities | query, resolve, read (the entry as content: name, type, metadata, assets with their references, modes), relationQuery, and the writes below |
| opening | the Frontend objects tab, the object chosen |

**Writing it through the registry.** Everyone who is not a mode of an object (an agent, the palette, another component) creates and changes frontend objects with the standard writes of the registry ([Writing through the registry](doc_page_impl_obj.md#writing-through-the-registry)), each answered by this provider with a structural write of the layer, and the standard apis carry them ([The apis](doc_page_impl_obj.md#the-apis)); the layer has no apis of its own:

```text
type/get { typeId: example.reading-list }                  its ancestors, creatorList [frontend], modeList (inherited ones
                                                           with the type they come from): what a block may show
object/create { typeId: example.reading-list,              a new object in that doc page (create; the doc page of
  content: { name, description?, metadata? },                place.docPath, or the first that can hold one, without it)
  place: { docPageAlias: example } }
object/create { memberOf: { ref: frontend:{id},            a new asset of the object, created in its folder and
  key?, data: { kind: book, name?, pathList? } },            listed under its key ({kind}-{n} when absent)
  content: { data: { title: Dune } } | { text, lang } }
object/read { ref: frontend:{id} }                         the entry: name, type, metadata, assetList [{ key, kind, ref }], modes,
                                                           assetKindList, disagreement { strayList, unknownList, outsideList }
object/read { ref: asset:local/{itemId} }                one asset, with the text of its head
object/update { ref: asset:local/{itemId}, patch: { data | text } }   the data of an asset (the asset store's provider)
object/update { ref: frontend:{id}, patch: { name?, description?, typeId?, metadata? } }
                                                           metadata a key at a time, null removes one; another key is
                                                           refused with where it belongs
relation/query { fromRef: frontend:{id}, text? }           its assets as core.member relations, keyed member/{key}, data
                                                           { kind, name, pathList, status }; with text, those the asset
                                                           search finds, best first (kind:, name:, path:/…)
relation/update { fromRef: frontend:{id}, key: member/{key}, data: { name?, pathList?, kind?, groupPath? } }
                                                           how an asset is named and indexed (paths replaced whole; a
                                                           path another asset has is refused), and where it lies
relation/create { fromRef: frontend:{id}, toRef: asset:local/{itemId}, key?, data: { kind, name?, pathList?, groupPath?, isOwnerReplaced? } }
                                                           an item of the store attached: the door above
relation/delete { fromRef: frontend:{id}, key: member/{key} | toRef, isTargetDeleted? }
                                                           an asset taken out: kept and released, or deleted
object/delete { ref: frontend:{id}, options: { isMemberKept? } }       the object, its assets deleted too unless kept
doc/blockDataSet { raw: "object: …\nmode: …\nparam: …" }   what a block shows (the block's data)
```

The writes check what the settings tab checks (a type no doc page declares, a doc page without frontend objects, a key taken, an asset of another object), so an agent and a person make the same changes the same way.

`common/ObjectViewFrontend` is the view of `frontend.object` (contexts `card` and `block`): a card with the name, the type, the kinds of the assets and the modes, and in the block context the object in its default mode. A type of a doc page may expose a view of its own, nearer to its objects, as any type ([Object views](doc_page_impl_obj.md#object-views)). So a frontend object is found by a search (`type:frontend.object`), listed by `ObjectList`, grouped by `ObjectGroup`, drawn by `ObjectView` and in a card diagram, and its assets are members a view of collections lists.

## The settings tab

The **Frontend objects** tab of the settings panel (`ObjectFrontendSettings.jsx`) is the layer's own place:

- **New object**: the doc page (those with an asset store and not `objectFrontend: false`), the type (`frontend.object` and the declared ones), the name; **Create**.
- **Objects**: one row per object of every doc page (name, type, doc page, assets, id, state: found, or how many things to look at). A click shows the chosen one below its table: name and description edited in place (a new name renames its folder), the reference, the type, the entry asset (its asset panel opens from it) and where it lies, the modes; a search of its assets (`ObjectFrontendAssetSearchPanel`, a hit marking its row); its **assets** (key, name and paths edited in place, the paths as `/a, /b`, kind, object, versions, state), each **Remove** asking in its row whether to delete it or keep it in the store; its folders on disk (a folder renamed in place; an asset's folder in its row); what disagrees (**Attach**, **Adopt**, **Move out**, **Move in**); the problems; the metadata; **Delete object**, asking in its row whether its assets go with it.
- **Types**: what the doc pages declare: id, label, extends, the modes (an inherited one marked ↑), the doc page.
- **Problems** of the files, by doc page, and the **orphan entries** with **List it in {doc page}**.

Every state the tab shows (the object chosen, the creation form, the question open, the write in progress and its failure) is the store's (`settings`, `write`); a built page shows the lists and changes nothing.

## The layer: the page and the development server

**On the page**, `DocObjectFrontendStore` (`store/DocObjectFrontendStore.ts`) is the layer's internal representation:

```text
config        the declarations of the doc pages, as the server read them (GET object-frontend/config); replaced
              only when they changed, so the provider's version moves only then
objectGet(id) the object as the files say now: the entry asset (loaded on demand through the asset store), the
              state of each asset it lists, the strays, the problems
declList, orphanEntryList, typeDeclaredList, typeOfferList, modeListGet(typeId), modeResolve(state, mode, param)
writeRun      the structural writes: create, register, delete, meta/set, asset/create, asset/remove, asset/attach;
              each answers the asset items it wrote (taken into DocAssetStore at once, itemListAccept) and the
              declarations as they are now
assetWrite, metadataSet       the data of an asset, the metadata of the object
assetDataGet, blockDrawAsk    the data of an asset, parsed once; a block's turn to draw (#reading-many-assets)
settings, write               the tab's state, the write in progress
```

**On the development server**, the layer is a set of routes of the asset api (`plugin/doc-asset-server.ts`, `/object-frontend/*`), implemented in `plugin/doc-object-frontend.ts`: the declarations of every loaded doc page are read for each request (the files are the truth), and each write is one request, ordered so that a failure leaves nothing half done:

```text
create        the folder of the object, the entry asset in its item/  ->  object.yaml   (last: it makes the object
              exist; when it fails the new folder goes away)
delete        object.yaml says isDeleted (or the line leaves the file)  ->  its assets are deleted softly (or kept:
              an orphan entry)
asset/create  the type accepts it  ->  the asset in the object's item folder (owner)  ->  the entry lists it   (when
              that fails, the asset is deleted again)
asset/remove  the entry stops listing it  ->  the asset deleted, or released (owner removed, moved to folder and
              groupPath, by default the default asset folder of the doc page). by itemId: an item it does not list
asset/attach  the type accepts it  ->  the owner set, the item moved into the object's item folder  ->  the entry lists it
asset/move    the owner set when it declares none  ->  the listed asset moved under item/, brought home when elsewhere
asset/group/move  a folder under item/ renamed or moved, with what it holds
meta/set      the entry rewritten  ->  the folder of the object renamed for a new name
register      an orphan entry's object listed again: isDeleted taken off, or a line written into a doc page's file
```

### Reading many assets

A mode of an object made of many assets reads all of them in every render, and a page may hold several such blocks. So reading has to cost nothing once the data is in, and the data has to come in at once:

- **The object is worked out once.** `objectGet` answers a computed value per object: the entry is parsed and the index of the assets built only when the declarations, the entry or the index of the store changed, never when the data of an asset arrives. It is the same state until then.
- **The data of an asset is parsed once per text** (`assetDataGet`), and shared by whoever reads it.
- **What a render asks for is read together**: the assets asked for in one tick go to the asset store as one list ([`refListLoad`](doc_page_impl_asset.md#loading-at-page-start)), which reads them a few at a time, one request and one change of the store per step, with a painted frame before each step. So the blocks waiting are drawn a few times, not once per asset, and a count of what is read (`Reading the data items (12 of 51)`) is really seen moving, on a built page too, whose reads are answered at once.
- **The heavy part of a block waits for its turn.** A mode whose data takes long to mount asks for a turn once its data is ready (`useObjectFrontendDrawTurn`, over `drawTurnAsk` and `drawTurnIs` of its api) and goes on showing its count until then; the blocks get their turns one per frame, so a document of several is painted and answers between them instead of freezing while they all mount. A mode that mounts quickly does not need it. The migration modes also keep the height the block will take while they wait, from `param.height`, so what is below does not jump.

A **built page** has no server: the declarations travel in the asset snapshot (`assetSnapshot.objectFrontend`), the objects and their data with the snapshot of the store, and every write is refused with the store's reason; a block's switches hold while the page is open.

## Files

```text
built-in/type.yaml                         frontend.object
frontend/plugin/doc-type-config.ts         the type files (doc_page_impl_type.md), modes and kinds of assets among their keys
frontend/src/lib/doc-object-frontend.js    the pure part: references, the entry (parse, build, a free key), the names and paths
                                           of the assets (normalize, the index, references, completion, search, the
                                           recommended path), the block of the
                                           entry component, the modes (inheritance, choice), the built-in overview mode
frontend/plugin/doc-object-frontend.ts     what a doc page says (the folders of the objects, object-frontend.yaml), the folders the store reads
                                           for them (objectFrontendFolderOwnedListGet), the structural writes
frontend/plugin/doc-asset-server.ts        the routes /object-frontend/* of the asset api
frontend/plugin/doc-asset-store.ts         folders owned by an object (AssetFolder.owner, folderOwner of an item, the guard -5, asLayer),
                                           itemMove across folders, group folders, owner
frontend/plugin/doc-entry.ts               the entry section objectFrontend
frontend/plugin/doc-source.ts              the declarations for the asset api, watched; in the snapshot of a build
frontend/plugin/doc-object-frontend.test.js   declarations, inheritance, the writes, object folders, a folder copied elsewhere, group folders
frontend/cli/doc-migrate.js                the former form rewritten (react-doc migrate)
frontend/src/lib/doc-asset-backend.js      objectFrontendConfigGet, objectFrontendWrite (api and snapshot), itemMove
frontend/src/store/DocObjectFrontendStore.ts   the layer on the page
frontend/src/lib/doc-object-frontend-store.test.js   reading many assets: one request, what is worked out once
frontend/src/lib/doc-object-provider-frontend.js   its provider of the object registry, the writes among its capabilities
frontend/src/store/DocEditStore.ts         dataReplaceRequest and blockPropSetRequest found by the block's line in reading
                                           mode; the pick step of the insert menu
comp-doc/object-frontend/                  ObjectFrontend (the entry component and the api of a mode), useObjectFrontendDrawTurn, ObjectFrontendEdit
                                           (its edit mode), ObjectFrontendOverview (the mode overview), ObjectViewFrontend
                                           (the view of frontend.object), ObjectFrontendAssetPathInput and
                                           ObjectFrontendAssetSearchPanel (finding the assets of an object),
                                           object-frontend-define.js, ObjectFrontend.css
comp-doc/edit/DocEditInsertMenu.jsx, edit-template.js   the pick step (meta.insertObjectPick)
comp-doc/settings/ObjectFrontendSettings.jsx   the Frontend objects tab
comp-doc/api/api-object.js, api-doc.js     the standard apis that reach the layer through its provider (doc_page_impl_obj.md#the-apis);
                                           doc/blockPropSet
example_doc/.doc-page/type.yaml            the demonstration's types (example.reading-list, example.reading-list-short)
example_doc/.doc-page/object-frontend/     its objects
example_doc/.doc-page/comp-mdx/object-frontend/reading-list/   their modes
example_doc/object-frontend.md             the demonstration
```

## Future updates

What the layer leaves for later (assets of an object fetched from a backend, a schema of the data of a kind, components kept in the folder of an object, being told of a change of an asset instead of re-rendering) is in [TODO](doc_page_impl_TODO.md#object-frontend).
