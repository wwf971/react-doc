<!-- Design of the frontend object service layer: objects the page keeps itself, in assets, declared with their types by the doc pages, drawn in the modes of their types by one entry component. Parent document: doc_page_impl_obj.md. The assets are the asset service layer's (doc_page_impl_asset.md); the entry component is a component of the registry (doc_page_impl_mdx_comp.md). -->

# Frontend Objects: Design

A **frontend object** is an object of the [object registry](doc_page_impl_obj.md) whose data the page keeps itself, in the [asset service layer](doc_page_impl_asset.md). The objects of a service instance live in the backend and are drawn by the components of its template; a frontend object is the same idea run in the page: a service with no process, hosting objects as free as the **types** a doc page declares for them. One object can hold a small system of its own: several kinds of data, each piece one asset, relations between them written in the data, and several ways of working with it (seeing all of one kind, registering a new piece, looking at one of them, a summary), each a **mode** of its type.

```text
.doc-page/object-frontend/{id}--{name}/    one folder per object: what is in it is the object
  object.yaml         { id, entry }             that it exists
  type.yaml                                     optional: types it brings along
  item/               its asset items           an asset folder of the store, owned by the object
    {entryId}/        the entry asset           { name, type, description, metadata }
    item-list.yaml    an item list              { assetList [{ key, kind, itemId }] }: the assets lying here and below
    {partition}/ …    its other assets          each declares the object: owner { ref: frontend:{id} }; a folder at
                                                the top may be a partition, with its own list, git keeping some out,
                                                and a storage point holding its items (partition.yaml; file-tree without)
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
- Its **entry asset** is an asset item whose data (yaml) describes the object: its name, its type, its description, and **metadata**, a free mapping of the type's own.
- Its **item lists** (`item-list.yaml`) record its assets by **key**, each list those lying in its folder and below ([The item lists](#the-item-lists)), so that a folder of the object can be kept out of git with everything it says.
- Its **partitions**, when its type declares them, are the folders at the top of its item folder that split its items by where they come from and who may see them: the example of a demonstration, the real data of one checkout, what is tried out ([Partitions](#partitions)).
- An **asset of an object** is an asset item a list of the object records under a key unique in the object; it lies in the object's folder and **declares** the object in its own metadata (`owner`), and its record gives it a **kind** that groups the assets of one sort (`book`, `note`), and optionally a **name** for people and **paths** indexing it, as many as the object wants (`/book/sci-fi/dune`, `/author/frank-herbert/dune`), each a pattern that may let some of its segments come in any order (`/book/{sci-fi/frank-herbert/}dune`: [Asset paths](doc_page_impl_obj_frontend_asset_path.md)). Why they are never called objects: [A word on the names](#a-word-on-the-names-objects-hold-items).
- A **type** is a type of the type registry, `frontend.object` or one a doc page declares below it; it says how the object is drawn: its **modes**.
- A **mode** is a component of the component registry and the parameters it starts with, with an id, a label and a **category** (`view`, `edit`, anything: how the modes are grouped). A type has its own modes and those of its ancestors.
- The **entry component**, `ObjectFrontend`, is a block of a document naming an object, a mode and the parameters of that mode, and rendering the mode's component.
- An **inner path** names one thing inside an object that the object can show: by default one of its assets, by an asset reference. With the object's reference before it, `frontend:{id}#{inner path}`, it is an **inner reference**, which names that thing from anywhere ([Things inside an object](#things-inside-an-object-inner-paths)).

## Who is the truth of what

| what | its truth | read by |
| --- | --- | --- |
| that an object exists, in which doc page | the `object.yaml` of its folder (or a line of `objectList`) | the server, for every request; the page at start and on every change of the file |
| what an object is: name, type, metadata | its entry asset (the head) | the page, through the asset store |
| which assets it has: key, kind, name, paths | its item lists ([The item lists](#the-item-lists)) | the server, which sends them with the declarations |
| the data | each asset (the head), the asset store's | the mode's component, through the object's api |
| that an asset belongs to an object | its record in an item list; the asset's `owner` and the folder it lies in are checked against it ([How an asset comes to belong](#how-an-asset-comes-to-belong)) | the page, which reports where they disagree |
| the types and their modes | the type files ([Declaring a type](doc_page_impl_type.md#declaring-a-type)) | the type registry, the store |
| what a block shows | its data: `{ object, mode, param }` | the entry component |

Nothing of an object is kept anywhere else: the registry answers from the store ([the registry is never the truth](doc_page_impl_obj.md)), and the store holds what the files said when it last read them. The lists are the structure the object works with (in order, by key); the asset's owner survives a lost or rewritten list and is what recovers an asset whose object is gone ([How an asset comes to belong](#how-an-asset-comes-to-belong)).

## The folder of an object

An object is a folder, and the folder is self-contained: copied into another doc page, the object is there, with its data and its history, and nothing else has to name it. All the folders of a doc page are in one managed folder ([the doc page folder](doc_page_impl_dir.md#frontend-objects)), made by the first object:

```text
.doc-page/object-frontend/
└── w5j7ozoijzl--Reading list/       {id}--{name}, in ASCII (a name with no ASCII gives way to the type); follows the name
    ├── object.yaml                  id, entry; isDeleted when there is something to say
    ├── type.yaml                    optional: the types it brings along
    └── item/                        the asset items of the object
        ├── w5j7ozokr1x/             the entry asset
        └── book/                    a folder of its own choosing
            ├── item-list.yaml       the records of the assets lying here and below
            └── w5j7pmxa7fw/         an asset: item.yaml, {versionId}.yaml
```

```yaml
# object.yaml
id: w5j7ozoijzl                      # the object: frontend:w5j7ozoijzl; the folder name starts with it
entry: w5j7ozokr1x                   # the item id of its entry asset
isDeleted: true                      # the object was deleted, its files stay (below)
```

- **`object.yaml` makes it an object.** A folder without one, or naming another id than its folder name, is left out and reported, never the page. A person writes it, or the page does when it creates an object; the page changes only `isDeleted`, line by line, with a `.bak` beside it.
- **`item/` is an asset folder of the store**, owned by the object ([Folders owned by an object](doc_page_impl_asset.md#folders-owned-by-an-object)): no `asset.yaml` names it. The assets of an object are created here, and one that comes from elsewhere moves here; items may be nested in folders of any depth ([Where an asset lies](#where-an-asset-lies-and-how-it-is-found)), and their records are in the item lists among them. A record names its item by id, so one lying elsewhere in the store still works, but that is a state the page reports, not a way to organize an object.
- **A new name renames the folder**; ids stay, so nothing that refers to the object or its items changes.
- **Deleting an object does not remove its folder.** Its `object.yaml` says `isDeleted: true`, so the object stops existing, and its assets are marked deleted, so references to them still resolve; with its assets kept it is an [orphan entry](#how-an-asset-comes-to-belong), which **List it** brings back. Removing the files is a step for a person.
- **A type used by this object alone belongs in `type.yaml` beside it**, so that it travels with it ([Declaring a type](doc_page_impl_type.md#declaring-a-type)). The components its modes name do not travel: they are found in the doc page or a package, as any component, which is why the type of a package's components is the package's.
- **The object holds its items whatever stores them.** A partition of `item/` may be bound to a storage point other than file-tree ([Where a partition is stored](#where-a-partition-is-stored)); what that point keeps (pack files, a cache) still lies in the folder of the partition.
- Later, this folder may hold more than items (components of its own): [TODO](doc_page_impl_TODO.md#object-frontend).

An object may also have **no folder of its own**: a line `{ id, entry }` in `objectList` of the doc page's file, with its assets in an asset folder of the doc page, in a group folder `{id}--{name}` that follows its name ([Group folders](doc_page_impl_asset.md#group-folders)). It behaves the same, except that it cannot be moved by copying one folder, and it records its assets in its entry (`assetList`), having no item folder for lists; `react-doc migrate` turns one into the other ([Migrating](doc_page_impl_cli.md#migrating-a-doc-page)).

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
      - { id: book, label: One book, comp: ReadingListBook, pathParam: book }   # shows one thing, named by an inner path
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
metadata: {}            # the type's own: anything it wants to keep about the object as a whole
```

The entry is data the layer keeps, like the workbook of a sheet: it is written whole (`objectFrontendEntryTextBuild`), in place, by the server's writes. Read, every key is taken as far as it can be (`objectFrontendEntryParse`): an entry naming no type is a `frontend.object`, a type that is not a frontend object type is drawn as `frontend.object` with a problem.

## The item lists

What assets an object has is recorded in **item lists**, files named `item-list.yaml` in its item folder or in any folder inside it (never inside an item). A list records the assets lying in its folder and below, down to the folders holding a list of their own:

```yaml
# item/book/item-list.yaml: written by the page
assetList:
  - key: book-1
    kind: book
    itemId: w5j7pmxa7fw
    name: Dune                        # optional: for people
    pathList:                         # optional: the paths indexing it, each unique in the object
      - /book/sci-fi/dune
      - /author/frank-herbert/dune
  - { key: book-2, kind: book, itemId: w5j7pmy0gul }
```

**Why lists, and why in the folders.** The records travel with the items they name. A partition of an object kept out of git (its real data, what is tried out: [Partitions](#partitions)) holds its items and the list naming them, so a clone without that folder has an object that simply lacks those assets: no record of nothing, and nothing of the private data left in a list git keeps.

**Which list a record goes to.** A write records an asset in the nearest list above it: from its own folder up to the top of the item folder, the first folder holding a list. With none, a list is made in the first folder of its path (`real/` for an asset at `real/info`), or at the top for an asset lying at the top, never above that folder; so a folder kept out of git in which nothing was written yet still gets its own list on its first asset. A moved asset takes its record along to the list nearest to its new place, a folder moved whole takes its lists, and a list left empty is removed. One caution follows from the rule: an object whose folders are kept out of git keeps no list at its top, since an asset in a folder without a list of its own would be recorded there.

**Read** (`objectFrontendListParse`, `objectFrontendAssetListMerge`): the server reads every list of an object with its declarations, so the page and a built page receive them with the object, and a list written, added or removed on disk is read again. The records of all the lists are one list for the object, the lists by their folder: a key or an item recorded twice keeps its first record, the other is a problem. A record lying in another folder than its list covers (a file moved by hand) is reported, since a folder kept out of git would then lose its record or leave one behind; moving the asset puts it right. A key is `[A-Za-z0-9][A-Za-z0-9_.-]*`; an asset created without one gets `{kind}-{n}`. The key is how a mode addresses an asset, so a mode never writes object ids; relations between assets (a note naming its book) are written in the data, by key, which never changes, rather than by a path, which is an index the object may rearrange. A name and paths are written only when an asset has them ([Naming and finding the assets](#naming-and-finding-the-assets)).

**Before item lists**, the entry held the list (`assetList`), and an object without a folder of its own still does. An entry of an object with a folder that lists assets is read as before and reported; `react-doc migrate` moves its records to item lists by the rule above ([Migrating](doc_page_impl_cli.md#migrating-a-doc-page)).

## Partitions

A **partition** is a folder at the top of the item folder of an object, holding its items and the item list recording them. Partitions split the items of one object by **where they come from and who may see them**, not by what they are (that is the kind): the data of the demonstration, the real data of one checkout, what is tried out. Since a folder holds its items and their records together, a partition can be kept out of git whole ([Local content kept out of git](doc_page_impl_dir.md#local-content-kept-out-of-git)), and a clone has an object that simply lacks it.

**Every type declares its partitions, one at least.** This is the convention of the layer, not an option for the types that happen to need private data: a type with a single partition (`example`, `main`) costs nothing, since a write naming no partition goes to the default one and a mode with one partition asks nothing; and it is what lets an object take a second one later (real data, a playground) without moving any item. A type declaring none is still read, its items lying anywhere in its item folder, and the settings tab says it declares none.

```yaml
# type.yaml: the partitions of a type, inherited like its kinds
typeList:
  - id: cv.profile
    partitionList:
      - { id: example, label: Example, description: the made-up person of the demonstration }
      - { id: real, label: My data, isGitIgnored: true }        # kept out of git: the checkout's own
      - { id: playground, label: Playground, isGitIgnored: true }
      - { id: archive, label: Archive, storagePoint: file-pack }  # bound to that storage point when it is made
```

**Conventions** for a type and the modes that write its objects:

- **Design them with the type.** Which origins its data will have (a demonstration, a person's own data, what is tried out) is decided when the type is designed, and each is a partition; one partition is a complete design. Adding a second one later moves nothing, adding the first one later moves every item.
- **Declare them in the type** (`partitionList`: `id` the folder name in ASCII, `label`, `description`, `isGitIgnored`, `isDefault`, `storagePoint`), and write the matching rule into the `.gitignore` of the repository. A write into a partition kept out of git is refused while git does not ignore it.
- **The default partition** is the one declared `isDefault`, else the first: a write naming no partition goes there (into the folder of its kind inside it), so a mode of a type with one partition never mentions partitions in its writes.
- **Every form that creates something says where it goes**: the partition, its folder, and whether git keeps it ("goes to item/playground/book, kept out of git", `objectFrontendPartitionPlaceText`). With several partitions the user chooses, the default chosen first; with one, nothing is asked and the line still says where it goes. A mode never writes into a partition without saying so.
- **What is made from an existing asset goes where that asset is**: a note on a book into the book's partition, a value added from a CV into the CV's partition, a mapping next to the tables it maps. The asset's `partition` says which.
- **Trying a page out writes into the playground**, so the example stays as committed.
- **Paths usually start with the partition** when several partitions hold the same kinds (`/example/info/name`, `/real/info/name`), since a path is unique in the object; the modes then read one partition at a time. The first folder of a path is still the object's own choice and may mean something else: the migration of `react-doc-db-migration` names a **category** there (`/example`, `/real`), and all its illustration, of both categories, lies in its partition `example`.

**For the modes**, the api of the entry component offers `partitionList` (`{ id, label, description, isGitIgnored, isDefault, isDeclared, isPresent, assetCount, storage }`: declared ones first, then folders found with a list) and `partitionDefault`, the `partition` of each asset, and `assetCreate({ partition?, groupPath? })`, which places the item in the folder of its kind inside the partition, the default one when none is named. The writes take `partition` too (`asset/create`, `asset/attach`) and refuse one the type does not declare. An asset lying outside every declared partition is a problem of the object.

### Where a partition is stored

A partition is the unit the [asset storage service layer](doc_page_impl_asset_storage.md) stores: **each partition is bound to one storage point**, and all its items are held there. Without a word it is `file-tree`, one folder of plain files per item. Bound to `file-pack`, its items are merged into pack files, whose content a search of the disk does not read; the contracts of that layer leave room for a backend.

```text
item/real/
├── partition.yaml     storagePoint: file-pack, and whose partition it is     (absent: file-tree)
├── item-list.yaml     the records of its assets: the same for every storage point
└── item-0001.pack     what the point keeps: here, the items merged
```

- **The type gives the default** (`storagePoint` of `partitionList`), applied when the partition is made; a partition that exists keeps what its `partition.yaml` says, so one object may differ from another of its type.
- **Nothing above changes with the point.** The records, keys, names, paths, item ids and versions are the same; a mode reads and writes through the same api and never names a point. It may ask where its data is: `partition.storage` (`{ pointId, typeId, place, isContentSearchable, apiSetList, isAvailable, unavailableReason, … }`), and `storagePointList`, the points the object may use.
- **A whole partition moves to another point** with `partitionStorageSet` ([Changing the storage of a partition](doc_page_impl_asset_storage.md#changing-the-storage-of-a-partition)); an asset moved into a partition of another point is written there by its type.
- **A partition whose point cannot be used** (not declared, disabled, a type without a driver) is a problem of the object: its assets are listed as `missing` from its item list, the other partitions work, and a point of the type its data was written by [claims it back](doc_page_impl_asset_storage.md#claiming-a-partition-back).
- **The entry asset** lies outside every partition and is always file-tree, as are the assets of a type declaring no partition.

### The apis of partitions

Every frontend object has the same apis for its partitions, whatever its type: a type writes no code for them, and a mode, the settings tab and an agent use the same ones.

| | the api of a mode | the route of the asset api | the settings tab |
| --- | --- | --- | --- |
| **list** | `partitionList`, `partitionDefault` | read with the object (its item lists come with the declarations) | the table **Partitions** of the object: folder, label, tracked or kept out, assets |
| **create** | `partitionCreate(partition, storagePoint?)` | `object-frontend/partition/create { id, partition, storagePoint? }` | **Create**, for one its type declares and the disk lacks |
| **rename** | `partitionRename(from, to)` | `object-frontend/partition/rename { id, partitionFrom, partitionTo }` | |
| **delete** | `partitionDelete(partition)` | `object-frontend/partition/delete { id, partition }` | **Delete**, asking in its row |
| **storage** | `partitionStorageSet(partition, storagePoint)`, `storagePointList` | `object-frontend/partition/storage/set { id, partition, storagePoint }`, `partition/compact { id, partition }` | **Storage…**, a point chosen in its row; **Compact** in the Asset service tab |

- **Create** makes the folder with an empty item list, so a record never lands above it; it is how a partition kept out of git exists in a fresh clone before anything is written into it (the first write makes it too).
- **Rename** moves the folder with what it holds; the item lists move with it, so every record follows, and the paths of the assets are the object's and do not change. The new name must be free and, for a type declaring partitions, declared.
- **Delete** takes every asset of the partition off its list and deletes it softly (its files stay, as for a deleted object), then removes the list and the folder when nothing is left in them; a locked asset stops it.
- The type is the truth of which partitions there may be: renaming a declared partition is also a change of `partitionList`, written by a person.

## Naming and finding the assets

An object holding many assets of several kinds needs them found: by the mode drawing one of them (`book: /book/sci-fi/dune`), by a reader typing where it is, by a search, by an agent. Each asset may carry two things for that, in its record; both are the object's choice, and both may be absent (an asset is still its key):

- a **name**, for people (`Dune`, the title of a book); names need not be unique;
- **paths**, any number of them, each indexing the asset one way: a book filed by its genre and by its author, `/book/sci-fi/dune` and `/author/frank-herbert/dune`. Several paths are what lets one object be browsed by several hierarchies at once.

**Paths are asset path patterns**, whose grammar and index are a document of their own, [Asset paths](doc_page_impl_obj_frontend_asset_path.md), used by other data indexed by paths too. In short: a plain path is read as an operating system reads one (`book//sci-fi/./x/../dune/` is `/book/sci-fi/dune`), kept in its canonical form from the root of the object (`objectFrontendAssetPathNormalize`); `/` ends every segment but the last, so it is written inside a bracket, after each member; an **unordered group** lets its segments come in any order, only there (`/book/{sci-fi/frank-herbert/}dune` stands for both orders, `book` first and `dune` last; `/book/{sci-fi, classic}` where the group ends the path), and a **choice** gives alternatives (`/book/[sci-fi/, classic/]dune`). The folders are implied by the paths and hold nothing themselves: there is no folder to create or to remove. Every path a pattern stands for names **one** asset of its object: the writes refuse one another asset has; one written twice by hand names the first asset and is a problem of the object. An asset whose paths and name are absent is reached by its key. Which paths to give, and when a group is right, is in [Recommended patterns](doc_page_impl_obj_frontend_asset_path.md#asset-paths-in-a-frontend-object).

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
| `missing`, `deleted` | an asset the object records, gone from the asset store or marked deleted; the answer still carries the asset (its key, name, paths) | the asset by its name, with the state (the overview, the stats of the demonstration count them) |
| `unknown` | nothing of the object answers to it: no such path, key or name, or a path that is a folder | the reference and why |
| `loading` | the entry is not read yet | a line |

A reference by path is resolved by any path an asset's patterns stand for; written as a pattern, it names the asset every one of its paths names. Every read of the mode api takes a reference (`assetTextGet`, `assetDataGet` answer `assetStatus` and the asset beside an error), so a block whose asset is gone says so where it is, never an empty block.

**Searching** the assets of an object reads words as the object registry's search does ([The grammar](doc_page_impl_obj_search.md#the-grammar)): words in any order, every one matching some field, a word narrowed by a key, `kind:book`, `name:dune`, `path:sci-fi` (a path word starting with `/` is a prefix: `path:/author/`), `key:`, `id:`; the score adds where each word matched (the start of the name 8, the name 5, the start of a folder of a path 4, a path 3, the key 3, the kind 2, the id 1), best first, with the path the words matched (`objectFrontendAssetSearch`). A path word matches every path a pattern stands for. **Completing** a typed path lists the folder typed so far, as path completion of the doc page source does ([Path completion](doc_page_impl_source.md#path-completion)): its folders with how many assets they hold, then its assets, those whose folder name (or name) starts with what follows the last `/` first; a text without a leading `/` is read from a base folder; a kind list keeps the assets of those kinds and the folders holding one (`objectFrontendAssetPathComplete`, over the index of [asset paths](doc_page_impl_obj_frontend_asset_path.md#the-index-of-entries-by-their-paths), where a group's folders exist in each order). Both read the layer's memory, so they cost nothing per keystroke.

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

**Versions.** An object reads the **head** of each of its assets: a record names an asset, never a version of one, so a write of an asset is what every mode shows next. An asset pinned to a version (an object whose part must not change while its source is revised) is [TODO](doc_page_impl_TODO.md#object-frontend-version).

## Documents of an object

An object can **register documents with the source layer** of the page ([Documents registered by an object](doc_page_impl_source.md#documents-registered-by-an-object)). A registered document is compiled and rendered by the document pipeline, is linked like any document, is edited block by block by the edit layer, and has a source path under the root of its object.

```text
asset of the object                      document of the page
  record: key, kind, name, pathList        ~{docPage}:${frontend.id:{id}}/{document path}.md
  item: Markdown (md, mdx)        ──►      text: the head of the item
  kind declared isDoc                      owner { providerId: frontend, ref: frontend:{id}, key }
```

**Two path systems.** The **asset paths** of a record index an asset inside its object, for its modes ([Naming and finding the assets](#naming-and-finding-the-assets)). The **document path** is where the asset stands in the source of the page, for links. They are separate: a kind says how the document path is made, and may make it the asset path.

```yaml
# type.yaml
assetKindList:
  - { id: book, langList: [md], isDoc: true }                           # docPath absent: {path}, the first asset path
  - { id: zettel, langList: [md, mdx], isDoc: true, docPath: "card/{key}" }   # its own: card/{key}.md
```

`docPath` is a pattern over `{path}` (the first asset path; the kind and key of an asset without one), `{key}` and `{kind}` (`objectFrontendDocRelPathBuild`); the extension is the language of the item. A path of its own that does not follow the hierarchy of the asset paths stays valid when an asset is filed elsewhere. Two assets at one document path: the first keeps it. The page (`DocObjectFrontendStore.docProvided`) and the development server (`objectFrontendDocFind`) apply the same rule.

- **Data beside the text** goes in the frontmatter of the document; a mode reads the item's text (`assetTextGet`) for it and renders the body through `sourceStore.loadDoc(path)` and the compiled `Body`, or, while its document is edited, through `DocEditBody` ([Documents that are not files](doc_page_impl_edit.md#documents-that-are-not-files)). `service.docPathGet(assetRef)` is the source path of an asset's document.
- **References**: between documents of one object, relative or by file name (`./a.md`, `a.md#place`); from anywhere, `~${frontend.id:{id}}/…`, `~${frontend.name:{name}}/…` or `~${frontend:{id or name}}/…`.

### Answering navigation

Registering documents means answering for them: a link to one has to lead somewhere, and no item of the side panel is theirs. The layer answers by where the link is ([Routing a navigation](doc_page_impl_nav.md#routing-a-navigation)):

```text
the link is inside an instance of a mode of the object   ->  that instance shows the target
    the mode provides DocNavScopeContext { handle(request) } around what it renders and
    answers { code: 0 } for request.owner.ref === service.ref
the link is anywhere else                                ->  the api object-frontend/doc/open
    the home document of the object in the popup, told where the reader was going;
    without a home document, the target itself in the popup
```

So a mode must know which of the two it is in, and it does without asking: a link inside it reaches its scope handler, and an arrival from outside reaches it as `service.navArrival`.

### The home document

An object may name one of its documents its **home document**: `metadata.docHome` of its entry, an asset reference. It is an ordinary document of the object (an asset of a kind declared `isDoc`) that shows the object to a reader coming from outside, usually by holding a block of the object in the mode that browses it. It must **accept where the reader was going**: the popup hands `arrival { target, hash, key, ref }` to what it renders, the entry component passes it to the mode as `service.navArrival { target, hash, key, version }` (only to blocks of that object), and the mode goes there.

```md
<!-- the home document of a zettelkasten: item /page/home -->
<!--renderComp=ObjectFrontend-->
```yaml
object: frontend:w5v62zxzbdl
mode: explorer
```
```

`DocObjectFrontendStore.docHomePathGet(ref)` is its source path; `docOpenPlanGet({ target, hash })` is what `object-frontend/doc/open` hands to `nav/popup`.

## Things inside an object: inner paths

An object is seldom shown only whole. A reader wants one book of a list, one card of a box, one value of a profile, and wants to name it from elsewhere: a cell of another object, a paragraph, a node of a diagram. The layer has one **convention** for that, and one small **mechanism**.

```text
an inner path          /book/sci-fi/dune              names one thing inside its object
an inner reference     frontend:w5j7ozoijzl#/book/sci-fi/dune     the same, from anywhere: an object of the registry
        │
        ├─ drawn       inline / card   the view of frontend.inner: a chip, a card (a value: its text)
        │              block           the mode of its type declaring pathParam, given the path
        └─ typed       /object … frontend:w5j7ozoijzl#/book/sci-    completed by the type of the object
```

**The convention: what draws an object accepts an inner path.**

- **An inner path is, by default, an asset reference**: a path of an asset (`/book/sci-fi/dune`), its key, `name:…`, `id:…` ([Naming and finding the assets](#naming-and-finding-the-assets)). A type that gives its assets paths has inner paths with no further work. A type whose things are **not** its data items says what an inner path is itself (below): the values of a profile of the package cv are keys inside its items, named `example/name/jp/first`.
- **A mode that shows one thing declares `pathParam`**: the parameter of the mode that takes an inner path. The mode resolves it (`service.assetResolve`), shows the thing, and shows the reference and why when nothing is there, never an empty block. The parameter keeps the name the mode gave it (`book`, `zettel`, `instance`); `pathParam` only says which one it is:

```yaml
modeList:
  - { id: book, comp: ReadingListBook, pathParam: book }      # param.book: an inner path
```

- **Everything else follows from the two.** An `ObjectFrontend` block names the mode and the path as before (`mode: book`, `param: { book: /book/sci-fi/dune }`). An `ObjectView` naming the inner reference draws it in any context, and in the block context draws exactly that block (`innerBlockGet`). Nothing is enforced: a type declaring no such mode still has its things drawn as chips and cards, and a mode may take paths without declaring it.

**The mechanism: an object completes references into itself.** When a reference is typed with [`/object`](doc_page_impl_obj.md#writing-a-reference) (in a cell, in a paragraph), the last step, what is inside the object, is asked of the layer's provider (`innerComplete`), which every frontend object offers. The layer answers for the type of the object:

| the type | resolve: what an inner path names | complete: the candidates of a typed one |
| --- | --- | --- |
| has no answer of its own (the default) | an asset reference (`objectFrontendInnerResolveDefault`) | the folders and assets of the folder typed so far; at the top the assets no path indexes, by key; and for words that are no path, the assets whose name or key holds them, so a reader who knows a name need not walk the folders (`objectFrontendInnerCompleteDefault`, over [asset path completion](doc_page_impl_obj_frontend_asset_path.md#the-index-of-entries-by-their-paths)) |
| has a component exposing `objectInner` | the component's `resolve({ service, path })` | the component's `complete({ service, text })` |

```js
compDefine(CvProfileInfo, {
  placementList: ['objectFrontend'],
  expose: {
    objectInner: {
      typeList: ['cv.profile'],                              // and every type below it: the nearest wins
      // { status: found | missing | unknown | loading, path, label, detail, kind, text?, typeId? }
      resolve: ({ service, path }) => cvProfileInnerResolve(service, path),
      // [{ kind: 'dir' | 'item', path, label, detail }]  (a dir's path ends with "/": typing goes on)
      complete: ({ service, text }) => cvProfileInnerComplete(service, text),
    },
  },
});
```

`service` is the api of a mode ([The entry component](#the-entry-component)) of the object asked about, without a block. Both functions are called inside an observer and read the object through it, so their answers follow the data; `loading` while the data of an asset is on its way. `text` of a resolve makes the thing a **value**: it is drawn in a line as that text. `typeId` gives the thing a type of its own below `frontend.inner`, for a type that wants a view of its own for its things ([Object views](doc_page_impl_obj.md#object-views)).

**In the registry.** An inner reference is an object of the type `frontend.inner` (a `core.place`): `label` its name, `summary { objectRef, objectLabel, path, kind, text? }`, missing (still of its type) when nothing is at the path. `common/ObjectViewFrontendInner` draws it: a chip in a line (the value itself when it is one), a card, and in the block context the mode declaring `pathParam`. Opening it goes to its document when the asset is one ([Documents of an object](#documents-of-an-object)), else to the object in the settings tab. On the page: `DocObjectFrontendStore.innerResolve(object, path)`, `innerComplete(object, text)`, `innerBlockGet(object, path)`, `innerOpen(object, path)`.

**When a type is added or changed, check this part.** It costs little and is what makes the things of an object reachable from every cell and paragraph:

1. Do its assets have paths? Then completion works already. Give them paths as [recommended](doc_page_impl_obj_frontend_asset_path.md#asset-paths-in-a-frontend-object), the kind first, so the top of a walk is the kinds.
2. Does a mode show one thing? Declare `pathParam` on it, and let it take any asset reference there, not only a key.
3. Are its things something else than its data items (values inside an item, rows of a table)? Expose `objectInner` on the component that knows them, with both functions.
4. Does a text of a mode hold what a reader types (a remark, a cell)? Make it a cell of the [cell edit layer](doc_page_impl_edit_cell.md), with a token kind of its own for what only this type knows.

| type | inner paths | the mode showing one |
| --- | --- | --- |
| `example.reading-list` (the demonstration) | asset paths: `/book/…`, `/author/…`, `/note/…` | `book`, `pathParam: book` |
| `zettelkasten.box` (package zettelkasten) | asset references of its cards: `/zettel/…`, a key | `card`, `pathParam: zettel` |
| `cv.jp` (package cv) | asset paths: `/example/instance/…`, `/example/template/…` | `sheet`, `pathParam: instance` |
| `cv.profile` (package cv) | its own: a partition and a query path, `example/name/jp/first` (`objectInner` of its mode Information) | none: a value is drawn as its text |

## Cells of a mode

A text of a mode that the author types in place, a cell of a table, a field of a card, is a **cell** of the [cell edit layer](doc_page_impl_edit_cell.md), not a field of the mode's own making: `useCell` for the cell, `CellField` for a value drawn and edited where it stands (or `CellValue` and `CellEdit` for a mode with a behavior of its own around the text), and `cellTokenDefine` for a token only this type knows. The cell is then typed like every other cell of the page, with `/link`, `/object` and the type's own action, and what it holds is drawn by the layer each token belongs to. The mode keeps the text in its data and writes it through its api (`assetWrite`), offered while `service.isEditable`. The demonstration's reading list (the remark of a book, the text of a note) and the Japanese-style CV of the package cv (every cell of the sheet) are built so.

## A word on the names: objects hold items

The container is an **object**: a frontend object, like an MDX component instance, is what a reader and the registry deal with. What it holds is one level below, and is never called an object: an **asset item** of the [asset service layer](doc_page_impl_asset.md), a piece of versioned data with its locks and folder, called an **asset of the object** or a **data item** where the object is the subject. *Object* has enough meanings already (anything a provider of the registry names, the frontend object itself); "the objects of an object" would make every sentence ambiguous ("delete the object": the frontend object, or one of its pieces?). The files say the same: `object.yaml` describes a frontend object, `item.yaml` an asset item.

## How an asset comes to belong

The folder says where the items of an object lie, and each item says what it declares, but neither of them says what belongs to the object: **the object does, in its item lists**. A record in one of them is the metadata that makes an item an asset of the object. Three things can therefore be looked at, and only one decides:

| what | where | it is | decides |
| --- | --- | --- | --- |
| **listed** | a record in an item list | the object's own statement | **yes**: what its modes see, what the registry lists as members |
| **declares** | `owner: { ref, role? }` in the `item.yaml` | what the item says of itself | no: it recovers what a lost entry forgot |
| **lies in** | `folderOwner` of the item, read from where the store found it, never written | a fact of the scan | no: it is where a person finds the files |

Listing is the source of truth because a folder only says a file arrived, not what it is to the object: its key, its kind, its paths. The lists lie among the items they name, so a folder copied, moved or left out takes its records along, and they leave room for items no folder holds (fetched from a backend, [TODO](doc_page_impl_TODO.md#object-frontend-store)).

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
| no | it | anywhere | **stray** (`strayList`) | a list restored to an older version, a write interrupted | **Attach**: listed again |
| yes | it | elsewhere | **outside** (`outsideList`) | moved by hand, or from the time an entry listed any item | **Move in**: `asset/move` brings it home |
| yes | nothing | any | **declares no owner** (`isOwnerMatch`) | its `item.yaml` was replaced | `asset/move` declares it |
| yes | another object | any | **claimed twice** | two entries list it, or it was handed over by hand | shown; **Remove** here, or attach it to this one |
| yes | | no such item | **missing**, **deleted** | gone from the store, or marked deleted | **Remove**: off the list |
| no entry listed | role `entry` | | **orphan entry** | an entry asset whose object no doc page has (deleted keeping its assets, or its line removed by hand) | **List it in {doc page}**: `isDeleted` taken off its `object.yaml`, or the line written again |

A folder under `.doc-page/object-frontend/` without an `object.yaml`, or naming another id than its folder name, is not an object: it is a problem of the doc page's declarations, and its files are not read at all.

## Where an asset lies, and how it is found

The folder of an object holds its items at **any depth**: inside `item/` a folder that is not an item is a group, read in turn (8 levels, [Group folders](doc_page_impl_asset.md#group-folders)), and its names may say something, `history/edu`, `book`. That is the **place on disk** (`groupPath` of the item, one per item, for a person browsing the files); the **paths** of its record are the other layer, virtual and any number, for the modes and readers, and the two do not touch ([Two layers](doc_page_impl_obj_frontend_asset_path.md#two-layers-that-do-not-touch-where-an-item-lies-and-its-paths)): moving an asset on disk changes no key, name or path, and rewriting its paths moves no file, so a mode never reads a `groupPath` to learn what an asset is. A new asset goes to the folder of its kind (`groupPath` of `assetKindList`), or the folder the write names, or the top. Folders are made by their first item and removed with their last.

## Types and modes

A type's modes are its own declarations, then those of its ancestors in the order of the type registry (the nearest first, `ancestorListGet`); a mode id declared on a nearer type hides the same id farther up (`objectFrontendModeListResolve`). `frontend.object` brings one mode to every type, **`overview`** (`common/ObjectFrontendOverview`): the object as its entry describes it, its assets with their state, its metadata, and a button per mode. The default mode is the nearest one marked `isDefault`, else the first.

Nothing ties the modes of a type to one way of looking at the same data: the page renders the component a mode names and assumes nothing about it. A mode may draw all the data as a table, be a form registering a new piece, show one asset chosen by a parameter, or sum everything up; the category only groups the modes where they are listed. A type has two ways to offer its **morphes**, and may mix them:

1. **many modes**: one per morphe, each with its component and parameters (`shelf`, `add`, `book`, `stats`); a mode showing one thing of the object says which parameter names it (`pathParam`, [Things inside an object](#things-inside-an-object-inner-paths));
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
                                         assetList [{ key, kind, itemId, listGroupPath, item, status, isOwnerMatch }], strayList, problemList
  mode, modeList                         the mode drawn, the modes of the type
  assetList(kind?)                       the assets, of one kind
  assetResolve(ref), assetGet(ref)       what an asset reference (/path, key, name:…, id:…) names, with its status
  assetSearch(text), assetComplete(text) the assets found by words; the candidates completing a typed path
  assetTextGet(ref), assetDataGet(ref)   { status, message, text, asset, assetStatus } / { ..., data } of an asset's head
                                         (yaml read, shared: to be read, not changed); loaded on demand
  assetCreate({ key?, kind?, name?, pathList?, partition?, groupPath?, lang?, text | data })   a new asset, in the
                                         partition named or the default one: { code, data: { key, itemId } }
  assetKindList                          what its type holds (#what-a-type-accepts); undefined: anything
  assetMove(ref, groupPath), assetGroupMove(from, to)   where an asset lies under item/; nothing else depends on it
  assetMetaSet(ref, { name?, pathList?, kind? })   how an asset is named and indexed
  assetWrite(ref, text | data)           the head of an asset replaced, by its save mode
  assetRemove(ref, { isAssetKept? })     an asset taken out (deleted softly, or kept and released)
  metadataSet(patch)                     the object's metadata, a key at a time (null removes one)
  blockKey, drawTurnAsk(id), drawTurnIs(id)   a turn to mount what is heavy, one block per frame (#reading-many-assets);
                                         useObjectFrontendDrawTurn(service, isReady) is the hook over them
  modeSet(modeId, options), paramSet(paramChange, options), blockSet({ mode, param }, options)
                                         the block switched: another mode, other parameters (merged, null removes a key;
                                         isReplaced replaces them), or both
  isWritable, writeUnavailableReason, write    whether the page can write here, and the structural write in progress
  isEditable, editUnavailableReason      whether the mode offers its edit controls now: writable, and the document in edit
                                         mode (#reading-and-editing); why not
  docState                               the state of the document the block is in (config.docState)
  partitionList, partitionDefault        its partitions (#partitions), each with storage: the storage point holding it
  storagePointList, partitionStorageSet(p, pointId)   the points it may use; a whole partition moved to one
                                         (#where-a-partition-is-stored)
  partitionCreate(p), partitionRename(from, to), partitionDelete(p)   the apis of partitions (#the-apis-of-partitions)
  ref                                    the reference of the object: frontend:{id}. something inside it is named
                                         from elsewhere as {ref}#{inner path} (#things-inside-an-object-inner-paths)
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
| descriptor | label: the name; type: the entry's; summary `{ assetCount, docPageAlias, typeId }`; `open: { kind: objectFrontend, id }`. Of an inner reference `frontend:{id}#{inner path}`: type `frontend.inner`, label the thing's name, summary `{ objectRef, objectLabel, path, kind, text? }` ([Things inside an object](#things-inside-an-object-inner-paths)) |
| relations | `core.member` from the object to each asset, `asset:local/{itemId}`, keyed `member/{key}`, `data: { kind, status }`, in the order of the lists; to an asset, the object it belongs to |
| capabilities | query, resolve, read (the entry as content: name, type, metadata, assets with their references, modes), relationQuery, innerComplete (the candidates completing a typed inner path, asked of the type of the object), and the writes below |
| opening | the Frontend objects tab, the object chosen |

**Writing it through the registry.** Everyone who is not a mode of an object (an agent, the palette, another component) creates and changes frontend objects with the standard writes of the registry ([Writing through the registry](doc_page_impl_obj.md#writing-through-the-registry)), each answered by this provider with a structural write of the layer, and the standard apis carry them ([The apis](doc_page_impl_obj.md#the-apis)); the layer has no apis of its own:

```text
type/get { typeId: example.reading-list }                  its ancestors, creatorList [frontend], modeList (inherited ones
                                                           with the type they come from): what a block may show
object/create { typeId: example.reading-list,              a new object in that doc page (create; the doc page of
  content: { name, description?, metadata? },                place.docPath, or the first that can hold one, without it)
  place: { docPageAlias: example } }
object/create { memberOf: { ref: frontend:{id},            a new asset of the object, created in its folder and
  key?, data: { kind: book, name?, pathList?,                listed under its key ({kind}-{n} when absent), in the
    partition?, groupPath? } },                              partition named (the default one without) and the folder
  content: { data: { title: Dune } } | { text, lang } }      inside it (that of its kind without)
object/read { ref: frontend:{id} }                         the entry and the lists: name, type, metadata, assetList [{ key, kind, ref }], modes,
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

`common/ObjectViewFrontend` is the view of `frontend.object` (contexts `card` and `block`): a card with the name, the type, the kinds of the assets and the modes, and in the block context the object in its default mode. `common/ObjectViewFrontendInner` is the view of `frontend.inner`, something inside an object, in every context. A type of a doc page may expose a view of its own, nearer to its objects, as any type ([Object views](doc_page_impl_obj.md#object-views)). So a frontend object is found by a search (`type:frontend.object`), listed by `ObjectList`, grouped by `ObjectGroup`, drawn by `ObjectView` and in a card diagram, and its assets are members a view of collections lists.

## Reading and editing

A block of a frontend object reads like content while its document is read, and offers what changes the object while the document is edited, as every component does ([The state of the document](doc_page_impl_mdx_comp.md#the-state-of-the-document)). The api of a mode carries what it needs: `docState` (the document's mode), `isWritable` (whether the page can write the object's files: not on a built page, not in an imported package, not while the server is gone) and, from both, `isEditable` with `editUnavailableReason`.

```text
document read      the mode shows the object: values as text, no Edit button of its own, no form adding
                   something, no remove buttons. switching the mode or its parameters still works (#the-entry-component)
document edited    the mode shows its edit controls; enabled when isEditable, greyed with editUnavailableReason as
                   their title when the object cannot be written
leaving edit mode  an editing state the mode holds (a sheet in its own edit mode, an open form) ends with it
```

So a mode tests `service.docState.isEditing` to show a control and `service.isEditable` to enable it, and a write it makes from elsewhere (a box dragged in a diagram) is refused with `editUnavailableReason` while the object is not editable. The demonstration's reading list, the migration modes of the package cloud-dev-vis and the package cv follow it.

## The settings tab

The **Frontend objects** tab of the settings panel (`ObjectFrontendSettings.jsx`) is the layer's own place:

- **New object**: the doc page (those with an asset store and not `objectFrontend: false`), the type (`frontend.object` and the declared ones), the name; **Create**.
- **Objects**: one row per object of every doc page (name, type, doc page, assets, id, state: found, or how many things to look at). A click shows the chosen one below its table: name and description edited in place (a new name renames its folder), the reference, the type, the entry asset (its asset panel opens from it) and where it lies, the modes; its **partitions** (the folder, the label, tracked or kept out, the storage point, how many assets, **Create** for a declared one the disk lacks, **Storage…** moving it whole to another point, **Delete** asking in its row, and a note when its type declares none); a search of its assets (`ObjectFrontendAssetSearchPanel`, a hit marking its row); its **assets** (key, name and paths edited in place, the paths as `/a, /b`, kind, object, versions, state), each **Remove** asking in its row whether to delete it or keep it in the store; its folders on disk (a folder renamed in place; an asset's folder in its row); what disagrees (**Attach**, **Adopt**, **Move out**, **Move in**); the problems; the metadata; **Delete object**, asking in its row whether its assets go with it.
- **Types**: what the doc pages declare: id, label, extends, the modes (an inherited one marked ↑), the doc page.
- **Problems** of the files, by doc page, and the **orphan entries** with **List it in {doc page}**.

Every state the tab shows (the object chosen, the creation form, the question open, the write in progress and its failure) is the store's (`settings`, `write`); a built page shows the lists and changes nothing.

## The layer: the page and the development server

**On the page**, `DocObjectFrontendStore` (`store/DocObjectFrontendStore.ts`) is the layer's internal representation:

```text
config        the declarations of the doc pages, as the server read them (GET object-frontend/config); replaced
              only when they changed, so the provider's version moves only then
objectGet(id) the object as the files say now: the entry asset (loaded on demand through the asset store), its item
              lists (with the declarations), the state of each asset recorded, the strays, the problems
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
asset/create  the type accepts it  ->  the asset in the object's item folder (owner)  ->  recorded in the nearest list
              (when that fails, the asset is deleted again)
asset/remove  off its list  ->  the asset deleted, or released (owner removed, moved to folder and
              groupPath, by default the default asset folder of the doc page). by itemId: an item it does not list
asset/attach  the type accepts it  ->  the owner set, the item moved into the object's item folder  ->  recorded in the
              nearest list
asset/move    the owner set when it declares none  ->  the listed asset moved under item/, brought home when elsewhere
              ->  its record to the list nearest to its new place
asset/group/move  a folder under item/ renamed or moved, with what it holds and its lists  ->  the records kept above
              it follow their assets
meta/set      the entry rewritten  ->  the folder of the object renamed for a new name
asset/meta/set  the record rewritten in its list: name, paths, kind
register      an orphan entry's object listed again: isDeleted taken off, or a line written into a doc page's file
```

### Reading many assets

A mode of an object made of many assets reads all of them in every render, and a page may hold several such blocks. So reading has to cost nothing once the data is in, and the data has to come in at once:

- **The object is worked out once.** `objectGet` answers a computed value per object: the entry is parsed and the index of the assets built only when the declarations, the entry or the index of the store changed, never when the data of an asset arrives. It is the same state until then.
- **The data of an asset is parsed once per text** (`assetDataGet`), and shared by whoever reads it.
- **What a render asks for is read together**: the assets asked for in one tick go to the asset store as one list ([`refListLoad`](doc_page_impl_asset.md#loading-at-page-start)), which reads them a few at a time, one request and one change of the store per step, with a painted frame before each step. So the blocks waiting are drawn a few times, not once per asset, and a count of what is read (`Reading the data items (12 of 51)`) is really seen moving, on a built page too, whose reads are answered at once.
- **The heavy part of a block waits for its turn.** A mode whose data takes long to mount asks for a turn once its data is ready (`useObjectFrontendDrawTurn`, over `drawTurnAsk` and `drawTurnIs` of its api) and goes on showing its count until then; the blocks get their turns one per frame, so a document of several is painted and answers between them instead of freezing while they all mount. The turn is the block's, not the mount's (`blockKey` of the api, from the block's state key): a block mounted again while it is on the page (the document entering or leaving edit mode renders another body) has its turn at once, and draws in its first frame; it keeps it for a frame after its last mount left. A mode that mounts quickly does not need it. The migration modes also keep the height the block will take while they wait, from `param.height`, so what is below does not jump.

A **built page** has no server: the declarations travel in the asset snapshot (`assetSnapshot.objectFrontend`), the objects and their data with the snapshot of the store, and every write is refused with the store's reason; a block's switches hold while the page is open.

## Files

```text
built-in/type.yaml                         frontend.object
frontend/plugin/doc-type-config.ts         the type files (doc_page_impl_type.md), modes and kinds of assets among their keys
frontend/src/lib/doc-object-frontend.js    the pure part: references, the entry (parse, build, a free key), the item lists (parse,
                                           build, the list a record goes to, merging them), the partitions (resolved
                                           from the type, the folder of a write, what a form says), the names and paths
                                           of the assets (normalize, the index, references, completion, search, the
                                           recommended path), the block of the
                                           entry component, the modes (inheritance, choice), the built-in overview mode
                                           inner references (split, build), what an inner path names and completes
                                           by default, the mode declaring pathParam
frontend/src/lib/doc-object-frontend-asset-path.js   the grammar of asset paths and the index over it
                                           (doc_page_impl_obj_frontend_asset_path.md)
frontend/plugin/doc-object-frontend.ts     what a doc page says (the folders of the objects, object-frontend.yaml, the item lists of each,
                                           objectListListRead), the folders the store reads for them (objectFrontendFolderOwnedListGet),
                                           the structural writes, each through the lists of the object (listingRead, listingWrite)
frontend/plugin/doc-asset-server.ts        the routes /object-frontend/* of the asset api
frontend/plugin/doc-asset-store.ts         folders owned by an object (AssetFolder.owner, folderOwner of an item, the guard -5, asLayer),
                                           itemMove across folders, group folders, owner
frontend/plugin/doc-entry.ts               the entry section objectFrontend
frontend/plugin/doc-source.ts              the declarations for the asset api, watched; in the snapshot of a build
frontend/plugin/doc-object-frontend.test.js   declarations, inheritance, the writes, object folders, a folder copied elsewhere, group folders
frontend/cli/doc-migrate.js                the former form rewritten (react-doc migrate), the list of an entry moved to item lists
frontend/src/lib/doc-asset-backend.js      objectFrontendConfigGet, objectFrontendWrite (api and snapshot), itemMove
frontend/src/store/DocObjectFrontendStore.ts   the layer on the page
frontend/src/lib/doc-object-frontend-store.test.js   reading many assets: one request, what is worked out once
frontend/src/lib/doc-object-provider-frontend.js   its provider of the object registry, the writes among its capabilities;
                                           inner references resolved, innerComplete
comp-doc/registry/comp-expose.js           expose.objectInner: a component answering for the inner paths of its types
frontend/src/store/DocEditStore.ts         dataReplaceRequest and blockPropSetRequest found by the block's line in reading
                                           mode; the pick step of the insert menu
comp-doc/object-frontend/                  ObjectFrontend (the entry component), object-frontend-service.js (the api of a mode),
                                           useObjectFrontendDrawTurn, ObjectFrontendEdit
                                           (its edit mode), ObjectFrontendOverview (the mode overview), ObjectViewFrontend
                                           (the view of frontend.object), ObjectViewFrontendInner (the view of
                                           frontend.inner), ObjectFrontendAssetPathInput and
                                           ObjectFrontendAssetSearchPanel (finding the assets of an object),
                                           object-frontend-define.js, ObjectFrontend.css
comp-doc/edit/DocEditInsertMenu.jsx, edit-template.js   the pick step (meta.insertObjectPick)
comp-doc/settings/ObjectFrontendSettings.jsx   the Frontend objects tab
comp-doc/api/api-object.js, api-doc.js     the standard apis that reach the layer through its provider (doc_page_impl_obj.md#the-apis);
                                           doc/blockPropSet
example_doc/.doc-page/type.yaml            the demonstration's types (example.reading-list, example.reading-list-short)
example_doc/.doc-page/object-frontend/     its objects
example_doc/.doc-page/comp-mdx/object-frontend/reading-list/   their modes, with their cells (doc_page_impl_edit_cell.md)
example_doc/object-frontend.md             the demonstration
```

## Future updates

What the layer leaves for later (a schema of the data of a kind, components kept in the folder of an object, being told of a change of an asset instead of re-rendering) is in [TODO](doc_page_impl_TODO.md#object-frontend).
