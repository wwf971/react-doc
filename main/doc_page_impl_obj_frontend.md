<!-- Design of the frontend object service layer: objects the page keeps itself, in assets, declared with their types by the doc pages, drawn in the modes of their types by one entry component. Parent document: doc_page_impl_obj.md. The assets are the asset service layer's (doc_page_impl_asset.md); the entry component is a component of the registry (doc_page_impl_mdx_comp.md). -->

# Frontend Objects: Design

A **frontend object** is an object of the [object registry](doc_page_impl_obj.md) whose data the page keeps itself, in the [asset service layer](doc_page_impl_asset.md). The objects of a service instance live in the backend and are drawn by the components of its template; a frontend object is the same idea run in the page: a service with no process, hosting objects as free as the **types** a doc page declares for them. One object can hold a small system of its own: several kinds of data, each piece one asset, relations between them written in the data, and several ways of working with it (seeing all of one kind, registering a new piece, looking at one of them, a summary), each a **mode** of its type.

```text
.doc-page/object-frontend.yaml            the doc page says what exists
  typeList    example.reading-list         its types, extending frontend.object, each with its modes
                modeList [{ id, comp, param, category }]
  objectList  [{ id, entry }]              its objects: an id, and the asset that describes it
        │
        ▼
.doc-page/asset/{id}--{name}/              the asset folder of the doc page: one group folder per object
  {entryId}/          the entry asset      { name, type, description, assetList [{ key, kind, objectId }], metadata }
  {objectId}/ …       its other assets     each declares the object: owner { ref: frontend:{id} }
        │
        ▼
the page   DocObjectFrontendStore          joins the declarations with the asset store: the object as the files say now,
           │                               and what does not agree; writes through the asset api of the development server
           ├─► provider "frontend"          of the object registry: frontend:{id}, its type, its assets as members, the doc pages' types
           └─► ObjectFrontend               the entry component: a block naming the object, a mode, parameters;
                 └─ the mode's component    rendered in the placement objectFrontend with config.objectFrontend
```

## The concepts

- A **frontend object** has an id (ms_48), a reference `frontend:{id}`, a type, a name, and any number of **assets**. It exists because a doc page lists it; what it is, its entry says.
- Its **entry asset** is an asset object of the store whose data (yaml) describes the object: its name, its type, its description, its assets by **key**, and **metadata**, a free mapping of the type's own.
- An **asset of an object** is any asset object of the store; it **declares** the object in its own metadata (`owner`), and the entry lists it under a key unique in the object, with a **kind** that groups the assets of one sort (`book`, `note`), and optionally a **name** for people and **paths** indexing it, as many as the object wants (`/book/sci-fi/dune`, `/author/frank-herbert/dune`). Why they are called assets and not objects: [A word on the names](#a-word-on-the-names-assets-not-objects).
- A **type** is a type of the type registry, `frontend.object` or one a doc page declares below it; it says how the object is drawn: its **modes**.
- A **mode** is a component of the component registry and the parameters it starts with, with an id, a label and a **category** (`view`, `edit`, anything: how the modes are grouped). A type has its own modes and those of its ancestors.
- The **entry component**, `ObjectFrontend`, is a block of a document naming an object, a mode and the parameters of that mode, and rendering the mode's component.

## Who is the truth of what

| what | its truth | read by |
| --- | --- | --- |
| that an object exists, in which doc page | `objectList` of the doc page's `object-frontend.yaml` | the server, for every request; the page at start and on every change of the file |
| what an object is: name, type, its assets, metadata | its entry asset (the head) | the page, through the asset store |
| the data | each asset (the head), the asset store's | the mode's component, through the object's api |
| that an asset belongs to an object | the asset's `owner` and the entry's `assetList`, both | the page, which reports where they disagree |
| the types and their modes | `typeList` of the doc pages' files | the type registry (through the provider), the store |
| what a block shows | its data: `{ object, mode, param }` | the entry component |

Nothing of an object is kept anywhere else: the registry answers from the store ([the registry is never the truth](doc_page_impl_obj.md)), and the store holds what the files said when it last read them. The two declarations of belonging are kept on purpose: the entry's list is the structure the object works with (in order, by key); the asset's owner survives a lost or rewritten entry and is what recovers an asset whose object is gone ([Assets and their owner](#assets-and-their-owner)).

## The declarations: `object-frontend.yaml`

Each doc page names its frontend objects and declares their types in one file of its metadata folder, by the convention of the other metadata files ([the doc page folder](doc_page_impl_dir.md#frontend-objects)): `.doc-page/object-frontend.yaml` beside the entry, `objectFrontend: { file }` of the entry for another file, `objectFrontend: false` for none. The file is made by the first object created in the doc page (with an empty `typeList`), never ahead.

```yaml
# .doc-page/object-frontend.yaml
typeList:
  - id: example.reading-list        # dotted, lowercase; the prefix is the doc page's choice, not a prefix of the page
    label: Reading list             #   (core, doc, asset, service, frontend, ... are refused)
    description: books and notes on them
    icon: book                      # a name of the page's icon set
    extendList: [frontend.object]   # default; or another type a doc page declares
    modeList:
      - id: shelf
        label: Shelf
        comp: ReadingList           # a component of the registry: a tag name, or an id
        category: view              # default view
        param: { layout: table }    # what the component starts with
        isDefault: true
      - { id: cards, label: Cards, comp: ReadingList, param: { layout: cards } }
      - { id: add, label: Add a book, comp: ReadingListAdd, category: edit }
objectList:
  - id: w5j7ozoijzl                 # the object: frontend:w5j7ozoijzl
    entry: w5j7ozokr1x              # the object id of its entry asset
```

The file is configuration a person writes (the types) and a list the page keeps (the objects): the page adds and removes the lines of `objectList` in place, with the [YAML utilities](doc_page_impl_yaml_utils.md) and a `.bak` beside the file, and never rewrites anything else of it. A change of the file is not a reload of the page: the development server watches it and tells the page (`doc-asset-change { isObjectFrontendChanged }`), which reads it again, as the asset store reads its `asset.yaml`. Every problem (an unknown key, a type id of a reserved prefix, a type declared twice, a parent that is no frontend object type, a mode without a component, an object listed twice) is reported with the file and leaves out that item, never the page; the Frontend objects tab lists them.

The types of every loaded doc page form one list, in loading order (a type declared twice is kept from the first doc page), and the layer's provider brings them to the type registry ([In the object registry](#in-the-object-registry)), with `definedBy: { kind: docPage, alias }`. A type's parents must be frontend object types, so every type the file declares is below `frontend.object`; a parent that is not is left out and reported. The components a type names are the doc page's own (`comp-mdx/`) or any of the registry, mounted the usual way ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)): declaring a type with modes means its components are there when the workspace is loaded.

## The entry asset

```yaml
# the head of the entry asset (lang yaml)
name: Reading list
type: example.reading-list
description: the books of the demonstration, and notes on them
assetList:
  - key: book-1
    kind: book
    objectId: w5j7pmxa7fw
    name: Dune                        # optional: for people
    pathList:                         # optional: the paths indexing it, each unique in the object
      - /book/sci-fi/dune
      - /author/frank-herbert/dune
  - { key: note-1, kind: note, objectId: w5j7pmznvdq, pathList: [/note/dune/1] }
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

## A word on the names: assets, not objects

The pieces of data of a frontend object could be called its objects, or its data objects; they are called **assets** on purpose. *Object* is taken twice already, by the object registry (anything a provider names: a document, a todo, a frontend object) and by the frontend object itself; a third meaning, "the objects of an object", would make every sentence about the layer ambiguous ("delete the object": the frontend object, or one of its pieces?). The pieces are also, in fact, asset objects of the asset service layer, with their versions, locks and folders, so calling them assets names what they are and where they live, and keeps the vocabulary apart: a **frontend object** has **assets**; the registry lists **objects**. (The asset store's own pages call one asset an "asset object", which is the same thing seen from the store.)

## Assets and their owner

An asset object may say it is a part of a larger object: `owner: { ref, role? }` in its `object.yaml`, a reference of the object registry and the part it plays (`role: entry` for the entry of a frontend object, nothing for its other assets). The asset store keeps the key like `component` ([Objects for components](doc_page_impl_asset.md#objects-for-components)) and checks nothing against it; `objectCreate` and `objectMetaSet` take it.

The assets of one object are **gathered in a group folder** of the asset folder of its doc page, named like an asset object, `{id}--{name}` (its name changes the folder's), the entry among them. Like every folder of the store its name is ASCII only ([Folder names of assets](doc_page_impl_dir.md#folder-names-of-assets)): the name of an object may be in any language, and one with no ASCII in it gives the folder its type instead (`{id}--db-migration.project`). The asset store reads objects inside group folders at any depth ([Group folders](doc_page_impl_asset.md#group-folders)), so a group changes nothing of what an asset is or how it is referred to; it is where a person browsing the disk finds everything of one object.

What the page reports where the declarations disagree (on the object, in the overview mode and the settings tab):

| case | means | offered |
| --- | --- | --- |
| an asset listed and **missing** or **deleted** | the store has no such object, or it is marked deleted | removing it from the list |
| an asset listed that **declares no owner** (or another) | the entry lists it, the asset does not say so | (shown; attaching sets it) |
| a **stray** | an asset declares the object, the entry does not list it (an entry restored to an older version, a write interrupted) | **Attach**: listed again |
| an **orphan entry** | an entry asset whose object no doc page lists (its line removed by hand, or the object deleted keeping its assets) | **List it in {doc page}**: the line written again |

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
                                         assetList [{ key, kind, objectId, object, status, isOwnerMatch }], strayList, problemList
  mode, modeList                         the mode drawn, the modes of the type
  assetList(kind?)                       the assets, of one kind
  assetResolve(ref), assetGet(ref)       what an asset reference (/path, key, name:…, id:…) names, with its status
  assetSearch(text), assetComplete(text) the assets found by words; the candidates completing a typed path
  assetTextGet(ref), assetDataGet(ref)   { status, message, text, asset, assetStatus } / { ..., data } of an asset's head
                                         (yaml read, shared: to be read, not changed); loaded on demand
  assetCreate({ key?, kind?, name?, pathList?, lang?, text | data })   a new asset: { code, data: { key, objectId } }
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
| types | `frontend.object` (built-in, a `core.collection`) and the types the doc pages declare (`typeDefineGet`); of each, its modes with the inherited ones (`typeInfoGet`, so `type/get` answers them) |
| descriptor | label: the name; type: the entry's; summary `{ assetCount, docPageAlias, typeId }`; `open: { kind: objectFrontend, id }` |
| relations | `core.member` from the object to each asset, `asset:local/{objectId}`, keyed `member/{key}`, `data: { kind, status }`, in the entry's order; to an asset, the object it belongs to |
| capabilities | query, resolve, read (the entry as content: name, type, metadata, assets with their references, modes), relationQuery, and the writes below |
| opening | the Frontend objects tab, the object chosen |

**Writing it through the registry.** Everyone who is not a mode of an object (an agent, the palette, another component) creates and changes frontend objects with the standard writes of the registry ([Writing through the registry](doc_page_impl_obj.md#writing-through-the-registry)), each answered by this provider with a structural write of the layer, and the standard apis carry them ([The apis](doc_page_impl_obj.md#the-apis)); the layer has no apis of its own:

```text
type/get { typeId: example.reading-list }                  its ancestors, creatorList [frontend], modeList (inherited ones
                                                           with the type they come from): what a block may show
object/create { typeId: example.reading-list,              a new object in that doc page (create; the doc page of
  content: { name, description?, metadata? },                place.docPath, or the first that can hold one, without it)
  place: { docPageAlias: example } }
object/create { memberOf: { ref: frontend:{id},            a new asset of the object, created in its group folder and
  key?, data: { kind: book, name?, pathList? } },            listed under its key ({kind}-{n} when absent)
  content: { data: { title: Dune } } | { text, lang } }
object/read { ref: frontend:{id} }                         the entry: name, type, metadata, assetList [{ key, kind, ref }], modes
object/read { ref: asset:local/{objectId} }                one asset, with the text of its head
object/update { ref: asset:local/{objectId}, patch: { data | text } }   the data of an asset (the asset store's provider)
object/update { ref: frontend:{id}, patch: { name?, description?, typeId?, metadata? } }
                                                           metadata a key at a time, null removes one; another key is
                                                           refused with where it belongs
relation/query { fromRef: frontend:{id}, text? }           its assets as core.member relations, keyed member/{key}, data
                                                           { kind, name, pathList, status }; with text, those the asset
                                                           search finds, best first (kind:, name:, path:/…)
relation/update { fromRef: frontend:{id}, key: member/{key}, data: { name?, pathList?, kind? } }
                                                           how an asset is named and indexed (paths replaced whole; a
                                                           path another asset has is refused)
relation/create { fromRef: frontend:{id}, toRef: asset:local/{objectId}, key?, data: { kind, name?, pathList? } }
                                                           an asset of the store attached (its owner set, moved into the group)
relation/delete { fromRef: frontend:{id}, key: member/{key} | toRef, isTargetDeleted? }
                                                           an asset taken out: kept and released, or deleted
object/delete { ref: frontend:{id}, options: { isMemberKept? } }       the object, its assets deleted too unless kept
doc/blockDataSet { raw: "object: …\nmode: …\nparam: …" }   what a block shows (the block's data)
```

The writes check what the settings tab checks (a type no doc page declares, a doc page without frontend objects, a key taken, an asset of another object), so an agent and a person make the same changes the same way.

`common/ObjectViewFrontend` is the view of `frontend.object` (contexts `card` and `block`): a card with the name, the type, the kinds of the assets and the modes, and in the block context the object in its default mode. A type of a doc page may expose a view of its own, nearer to its objects, as any type ([Object views](doc_page_impl_obj.md#object-views)). So a frontend object is found by a search (`type:frontend.object`), listed by `ObjectList`, grouped by `ObjectGroup`, drawn by `ObjectView` and in a card diagram, and its assets are members a view of collections lists.

## The settings tab

The **Frontend objects** tab of the settings panel (`ObjectFrontendSettings.jsx`) is the layer's own place:

- **New object**: the doc page (those with an asset folder and not `objectFrontend: false`), the type (`frontend.object` and the declared ones), the name; **Create**.
- **Objects**: one row per object of every doc page (name, type, doc page, assets, id, state: found, or how many things to look at). A click shows the chosen one below its table: name and description edited in place (a new name renames the group folder), the reference, the type, the entry asset (its asset panel opens from it) and where it lies, the modes; a search of its assets (`ObjectFrontendAssetSearchPanel`, a hit marking its row); its **assets** (key, name and paths edited in place, the paths as `/a, /b`, kind, object, versions, state), each **Remove** asking in its row whether to delete it or keep it in the store; the strays (**Attach**); the problems; the metadata; **Delete object**, asking in its row whether its assets go with it.
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
orphanEntryList, typeDeclaredList, typeOfferList, modeListGet(typeId), modeResolve(state, mode, param)
writeRun      the structural writes: create, register, delete, meta/set, asset/create, asset/remove, asset/attach;
              each answers the asset objects it wrote (taken into DocAssetStore at once, objectListAccept) and the
              declarations as they are now
assetWrite, metadataSet       the data of an asset, the metadata of the object
assetDataGet, blockDrawAsk    the data of an asset, parsed once; a block's turn to draw (#reading-many-assets)
settings, write               the tab's state, the write in progress
```

**On the development server**, the layer is a set of routes of the asset api (`plugin/doc-asset-server.ts`, `/object-frontend/*`), implemented in `plugin/doc-object-frontend.ts`: the declarations of every loaded doc page are read for each request (the files are the truth), and each write is one request, ordered so that a failure leaves nothing half done:

```text
create        the entry asset in the group folder {id}--{name} (owner role entry)  ->  the line in objectList   (last:
              it makes the object exist; when it fails the entry is deleted again, softly)
delete        the line leaves the file  ->  its assets are deleted softly (or kept: an orphan entry)
asset/create  the asset in the object's group folder (owner)  ->  the entry lists it   (when that fails, the asset is
              deleted again)
asset/remove  the entry stops listing it  ->  the asset deleted, or released (owner removed, moved to the top)
asset/attach  the owner set, the folder moved into the group  ->  the entry lists it
meta/set      the entry rewritten  ->  the group folder renamed for a new name
register      an orphan entry's line written into a doc page's file
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
built-in/object-type/object-type-builtin.json   frontend.object
frontend/src/lib/doc-object-frontend.js    the pure part: references, the entry (parse, build, a free key), the names and paths
                                           of the assets (normalize, the index, references, completion, search, the
                                           recommended path), the block of the
                                           entry component, the modes (inheritance, choice), the built-in overview mode
frontend/plugin/doc-object-frontend.ts     the declarations of the doc pages (object-frontend.yaml), the structural writes
frontend/plugin/doc-asset-server.ts        the routes /object-frontend/* of the asset api
frontend/plugin/doc-asset-store.ts         group folders (groupPath, objectMove, groupMove), owner
frontend/plugin/doc-entry.ts               the entry section objectFrontend
frontend/plugin/doc-source.ts              the declarations for the asset api, watched; in the snapshot of a build
frontend/plugin/doc-object-frontend.test.js   declarations, inheritance, the writes, group folders
frontend/src/lib/doc-asset-backend.js      objectFrontendConfigGet, objectFrontendWrite (api and snapshot), objectMove
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
example_doc/.doc-page/object-frontend.yaml the demonstration's types (example.reading-list, example.reading-list-short)
example_doc/.doc-page/comp-mdx/object-frontend/reading-list/   their modes
example_doc/object-frontend.md             the demonstration
```

## Future updates

What the layer leaves for later (assets of an object in another doc page's folder or another store, moving an object between doc pages, a schema of the kinds of assets a type holds, being told of a change of an asset instead of re-rendering) is in [TODO](doc_page_impl_TODO.md#object-frontend).
