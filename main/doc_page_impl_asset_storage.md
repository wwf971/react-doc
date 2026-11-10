<!-- Design of the asset storage service layer: where the asset store keeps the bytes of its items. Storage types (contracts), storage points, partitions bound to a point, the two local types file-tree and file-pack, the contracts of the remote types. Parent document: doc_page_impl_asset.md. Its first user is the frontend object service layer (doc_page_impl_obj_frontend.md). -->

# Asset Storage Service Layer: Design

The [asset service layer](doc_page_impl_asset.md) is a store of versioned items. The **asset storage service layer** is the layer below it: it decides **where and in which form the bytes of the items are kept**. The store keeps one api whatever the answer is, so a document, a component and a mode of a [frontend object](doc_page_impl_obj_frontend.md) read and write an item the same way whether it is a folder of yaml files, a chunk of a merged file, or (by the contracts below) a row of a backend.

```text
documents, components, modes of frontend objects
        │   store: local, itemId, versionId            the same api for every item
        ▼
asset store            items, versions, head, locks, names, dependencies        doc_page_impl_asset.md
        │   "which point holds this item?"   by the place of the item
        ▼
asset storage          storage points, each of a storage type                   this document
        ├── file-tree    one folder per item, plain files         every asset folder, and every partition
        │                                                         that says nothing
        ├── file-pack    a partition merged into pack files       a partition bound to it
        └── remote …     a backend or a cloud service             contracts: designed, no driver yet
```

## The concepts

- A **storage type** is a contract: the sets of apis a storage promises, and what is true of its data (local or remote, readable as plain files or not). Types extend one another, as the types of the [type registry](doc_page_impl_type.md) do; they are a small registry of their own and are not types of objects.
- A **storage point** is one instance of a type with its own config: `file-pack` with pack files of 1 MB, a bucket of a team. Two points are built in, and a workspace or a doc page declares more in a yaml file.
- A **partition** is what a storage point holds for a frontend object: "the partition `real` of the object `frontend:{id}`, an object of the type `cv.profile`", with its items. It is the [partition of the frontend object](doc_page_impl_obj_frontend.md#partitions); here it is the unit of storage.
- A **bind** says which point holds a partition. **One partition is bound to one point**: never some items of a partition at one point and others at another.
- A **driver** is the code of a type: how the items of one container (a store folder, a partition folder) are listed, read and written.

The **store** is not a storage point. The store (`local`) is what a reference names and what answers for an item id; the points are where the store keeps the parts of itself. So no reference, no key and no path of an asset changes when a partition moves to another point.

## Who is the truth of what

| what | its truth | read by |
| --- | --- | --- |
| which types exist, what each promises | the layer itself (`ASSET_STORAGE_TYPE_LIST`) | the store, the page |
| which points exist | the built-in ones, and `asset-storage.yaml` of the workspace and of each doc page | the development server, for every request |
| which point holds a partition | `partition.yaml` in the folder of the partition; without it, file-tree | the development server, with the declarations of the objects |
| whose partition it is | the same file (`owner`, `partition`), and for a local type the folder it lies in | whoever claims a partition back |
| the items and their versions | the data the point holds, in the form of its type | the driver of that type |
| which assets an object has in the partition | the item list of the partition (`item-list.yaml`), the object's own record | the frontend object layer |

## Storage types

A type promises **api sets**. Two are common to every type; a type adds more, and a type extending another promises what its ancestors promise.

```text
storage                 items · partitions                     the root: what every type promises
├── file-tree           (nothing more)                         local, plain files
├── file-pack           + pack files                           local, opaque
└── remote              + cache · authorization                behind a network
    └── remote-notify   + change notification
any type may add        + backups
```

| api set | what it is for | apis |
| --- | --- | --- |
| **item** | single data items with their versions. It is the api of the asset store, the same whatever point holds an item ([The store api](doc_page_impl_asset.md#the-store-api)) | `itemList`, `itemGet`, `versionDataGet`, `itemCreate`, `itemUpdate`, `itemMetaSet`, `itemMove`, `itemDelete`, `versionCheckout`, … |
| **partition** | the partitions a point holds, each named by its object, the type of that object and its own name | `partitionList`, `partitionGet`, `partitionCreate`, `partitionRename`, `partitionDelete`, `partitionStorageSet`, `partitionClaim` |
| **pack** | the merged files of a partition | `packInfoGet` (sizes, how much is dead), `packCompact` |
| **cache** | the local copies of what a remote point holds | `cacheInfoGet`, `cacheRefresh`, `cacheClear`, `cachePolicySet` |
| **auth** | who the page is to a point that asks | `authStatusGet`, `authSignIn`, `authSignOut` |
| **notify** | a point telling the page of a change made elsewhere | `notifySubscribe`, `notifyUnsubscribe`, `notifyStatusGet` |
| **backup** | copies of whole partitions, of this point or of another | `backupCreate`, `backupList`, `backupRestore`, `backupDelete` |

**Why two common sets.** The item set serves whoever holds an item id: a document, the asset panel, a mode. The partition set serves the frontend objects, which think in partitions: make one, move one whole, find one again. A point is addressed through both, and the item set never needs to know partitions exist.

**What is true of a type** is declared with it and reaches the page, so a frontend object can ask what its data stands on:

```text
place                 local (in the folders of the doc page) | remote (behind a network)
isContentSearchable   a search of the disk, the index of an editor and a text comparison of git read
                      the content of the items; false for a type that merges or hides it
isStandaloneItemHeld  it may hold items that belong to no partition. Only file-tree: the asset
                      folders of a doc page are always file-tree, and only a partition of a
                      frontend object can be bound to another type
configKeyList         the keys of a point's config the type reads, with their defaults
isImplemented         the page has a driver for it; false: a contract only
```

The types `file-tree` and `file-pack` have drivers. `remote`, `remote-notify` and the api sets `cache`, `auth`, `notify` and `backup` are **contracts**: their names, their apis and their place in the folders are fixed here so that an implementation fits what exists, and a point declared with such a type is listed as *contract only* and can hold nothing ([TODO](doc_page_impl_TODO.md#asset-storage-remote)).

## Storage points

### The built-in points

`file-tree` and `file-pack`, each the point of the type of the same id with the default config. They need no file and cannot be declared again.

### Declaring storage points

A workspace and a doc page declare more points in a file found by convention, like the other config files of the [doc page folder](doc_page_impl_dir.md#layout):

```text
.doc-workspace/asset-storage.yaml     the points every doc page of the workspace may use
.doc-page/asset-storage.yaml          the points of one doc page, seen by its own objects only
"assetStorage: { file }"              of the workspace file or of an entry: another file
"assetStorage: false"                 none
```

```yaml
storagePointList:
  - id: pack-small                    # unique in the workspace; lower case letters, digits, . _ -
    type: file-pack                   # a storage type
    label: Small packs
    description: pack files of at most 1 MB each
    isEnabled: true                   # false: declared, used by nothing
    config: { packSizeMax: 1048576 }  # the keys of its type
  - id: team-remote
    type: remote                      # a contract only: listed, bound to nothing
    config: { url: "https://storage.example.com", cacheMode: readThrough }
    auth: { kind: token }             # for a type with the api set auth
```

An id declared twice keeps its first declaration (the built-in points, the workspace, then the doc pages in loading order) and the other is a problem of its file. Every point has a **state**:

| state | means |
| --- | --- |
| `ready` | it can hold partitions |
| `disabled` | `isEnabled: false` |
| `typeNotImplemented` | its type is a contract only |
| `typeUnknown` | no such type: a problem of its file |

The files are read again for every request of the asset api, and a change of one is told to the page without a reload.

## Partitions

### Where a partition lies

A frontend object holds its own items whatever stores them: every partition is a folder at the top of the item folder of its object, and **what each storage type keeps there has names no other type uses**, so the types are scanned one by one without meeting each other.

```text
.doc-page/object-frontend/{id}--{name}/item/
├── {entryId}/                  the entry asset: outside every partition, always file-tree
├── example/                    a partition that says nothing: file-tree
│   ├── item-list.yaml            the object's records of its assets (every type)
│   └── book/{itemId}/ …          file-tree: folders, one per item
├── real/                       a partition bound to file-pack
│   ├── partition.yaml            which point holds it, whose it is (every type but a silent file-tree)
│   ├── item-list.yaml
│   └── item-0001.pack            file-pack: files named item-{n}.pack
└── shared/                     a partition bound to a remote point (contract)
    ├── partition.yaml
    ├── .cache/                   remote: what was fetched, never the truth; ignored by git
    └── .tmp/                     any type: files of a write in progress; ignored by git
```

```text
type          owns in the folder of a partition          never reads
file-tree     folders (an item, or a group)              files at the top, dot folders
file-pack     files item-{n}.pack                        folders
remote        .cache/                                    everything else
```

What is a cache or temporary lies in a dot folder, which no type reads as data and one rule of the `.gitignore` keeps out of git (`**/.doc-page/object-frontend/*/item/*/.cache/`, and `.tmp/`).

**The item list stays a plain file for every local type.** It is the object's record of what it holds (key, kind, name, paths), small, read by the development server with the declarations, and it lets a person see what a pack holds without opening it. So the names and paths of the assets of a packed partition are still found by a search; their data is not. A remote type keeps the list at the point and a copy in `.cache/`.

### The partition file

```yaml
# item/real/partition.yaml: written by the page
storagePoint: file-pack            # the point holding its items
storageType: file-pack             # the type its data was written by
owner: { ref: frontend:w5pbeilkczg, typeId: cv.profile }
partition: real
```

- **A partition without the file is held by file-tree.** Every partition made before this layer is one, and nothing has to be migrated.
- `storageType` is recorded beside the point because a point can go away or be declared again as another type; the data is still what the type that wrote it reads ([Claiming a partition back](#claiming-a-partition-back)).
- `owner` and `partition` are the identity a point knows a partition by. For a local type they repeat what the folder says; they are what a remote point is asked with.

### Which point a partition is bound to

```text
a partition is made (its first item, or partition/create)
  -> the write names a point (storagePoint)             that point
  -> else its type declares one for it                  partitionList: [{ id: real, storagePoint: file-pack }]
  -> else                                               file-tree, and no partition.yaml is written
a partition that exists                                  what its partition.yaml says; its type is not asked again
```

So the type gives a default for a new partition, and each object is free afterwards: one object of a type may keep `real` in pack files while another keeps it at a backend. A point must be `ready` and seen by the doc page of the object, or the write is refused before anything is written (`-6`, or `-3` for an id nobody declares).

### Changing the storage of a partition

`partition/storage/set { id, partition, storagePoint }` moves **a whole partition** to another point. Nothing of the object changes: the records of its item list, the keys, names and paths, the item ids, the versions and their history stay.

```text
partitionStorageSet(partition, point)
  -> the point is ready, the folder is writable, git ignores a partition kept out of git
  -> the same type, another point: only partition.yaml is rewritten (the data is already in that form)
  -> else
       -> every item of the partition is written by the type of the new point, version by version
       -> every version is read back and compared with what it was copied from
            -> a difference: stop, the partition is as it was
       -> partition.yaml is written                    <- the switch: from here the new point is read
       -> what the type before kept is removed
```

An interruption before the switch leaves the partition as it was, with a copy to remove; after it, the partition as it will be, with the data of the type before still there. Both are reported, never repaired unasked: the info of the partition lists the types whose data lies in its folder (`typeIdFoundList`), and a second change is refused while two are found.

Moving **one item** between two partitions of different points works the same way at a small scale (`asset/move`): the item is written by the type of the target, then removed where it was. A group folder cannot cross two points; its items are moved one by one.

### Claiming a partition back

A bind names a point, but a partition is **identified by its object and its name, and its data by the type that wrote it**, not by the id of a point. When the point a `partition.yaml` names is gone, disabled, or declared again as another type:

```text
the point named is ready and of the type the data was written by   -> it is used
else: a ready point of that type the doc page sees                  -> the partition is read through it
                                                                       (pointIdClaimed), and the object reports it
else                                                                -> the partition cannot be used: its items are
                                                                       not read, nothing is written into it (-6)
```

A partition read through another point is a problem of its object with one way out: set its storage to the point that reads it (`partition/storage/set`), which rewrites the file and changes no data. For a remote type the same holds with the point asked instead of the folder: a new point of the same backend answers `partitionList` with the identity `{ owner.ref, owner.typeId, partition }`, and the object claims its partition from it (`partitionClaim`).

A partition that cannot be used does not break its object: its item list is still read, so its assets are listed as `missing` with their names and paths, and the other partitions work.

## file-tree

The type of every asset folder, and of every partition that says nothing. Its layout is [the local store](doc_page_impl_asset.md#the-local-store-folders-fully-reflected): one folder per item, `item.yaml`, one file per version with the extension of its data, a `.bak` beside every file rewritten. Everything is a plain file a person, a search and git read; that is its use and its cost (one item is several files, and a thousand items are a few thousand).

## file-pack

The items of one partition **merged into a few pack files**. Its use is data that should not be a forest of small files, or whose **content should not be indexed or searched**: nothing an item holds is found in a pack file as text, so a search of the disk, the index of an editor and a text comparison do not see it. A pack file is not encrypted; it is opaque, not secret.

```text
item/real/
├── item-0001.pack        read in name order
└── item-0002.pack        started when the one before reached packSizeMax (32 MB by default); written to
```

**A pack file is a log of chunks, only ever appended to.**

```text
file     "RDPACK1\n"  chunk*
chunk    headLength (u32, big endian)  bodyLength (u32)  head  body
head     packed(json)   { type, itemId, versionId?, dirName?, encoding? }
body     item             packed(json): what item.yaml holds; dirName of the head is the place of the item
         version          the bytes of one version: packed (encoding deflate), or as they are (raw)
         metadata         packed(json): the metadata of one version
         versionRemove    none
         itemRemove       none
packed(bytes) = raw deflate, then every byte xor 0xA5
```

- **The last chunk about a thing holds.** Rewriting an item, a version or its metadata appends a chunk; the one before stays in the file, dead. So the bytes before an in-place save are kept, as the `.bak` of file-tree, until a compaction.
- **A write is one append**, and an interrupted one leaves a tail that is not a whole chunk: reading stops there, and the next write cuts it off first.
- **Compaction** (`packCompact`) writes the live chunks into new pack files, which replace the old ones. It runs by itself when more is dead than alive (and more than 1 MB), and on request from the Asset service tab.
- **The mask** is there because deflate keeps what it cannot shrink as it is (a short text in a script without repetition), which would leave text readable in the file. A point with `isCompressed: false` stores versions raw, and its content is then plain: that config gives up the property for speed.
- **The place of an item is kept with the item** (`dirName`): a pack has no folders, and the store still names an item by its groups (`real/book/{itemId}`), so a mode and the settings tab see the same thing for both types.

**Why not SQLite.** The first idea for a merged file was a SQLite database. What decided against it:

```text
                       sqlite file                              pack files
read by a static page  needs a wasm build of sqlite (~1 MB)     a few lines of js: fetch, DataView,
                       and the whole file in memory             DecompressionStream
read by node           node:sqlite (recent versions only), or   node:fs and node:zlib
                       a native dependency
a write                a transaction: pages rewritten in place  one append
transactions, queries  yes                                      no: the store never asks a query of a
                                                                partition, it lists items and reads versions
```

The question behind it, whether a statically deployed page can read the file, does not arise for either: **a built page never reads a storage point**. `react-doc build` reads every item through the store and bundles a snapshot ([Build](doc_page_impl_asset.md#build)), so the form on disk matters only to the development server. The pack format is still chosen so that a browser could read it directly, should a page ever fetch a partition on its own.

The config of a point of this type: `packSizeMax` (bytes), `isCompressed`.

## remote and remote-notify (contracts)

A point of the type `remote` keeps partitions at a backend or a cloud service. What is fixed now, so that a driver fits later:

- **The same two api sets**, answered over the network: the item set per item, the partition set per partition identity `{ owner.ref, owner.typeId, partition }`. The record list of a partition travels with it (`partitionGet` answers it), since the object must find its assets again from the point alone.
- **A cache, never the truth.** What is fetched lies in `.cache/` of the partition folder, in the layout of file-tree, with what it was fetched as (version, time). A cached version is read while the point is unreachable and is dropped and read again rather than edited. `cacheMode`: `readThrough` (cached on first read), `pinned` (kept until refreshed), `none`.
- **Authorization** is a state of the point, not of a request: `authStatusGet` answers `signedIn | signedOut | expired`, and a point that needs signing in has the state `authRequired` beside the four above. A workspace declares such a point once for all its doc pages.
- **Writes** carry `hashBase` as everywhere, so a conflict with a change made elsewhere is the store's `-2`.
- **`remote-notify`** adds the other direction: the point tells the page which items and partitions changed (`notifySubscribe`), and the page reports each as it reports a file changed on disk (`doc-asset-change { itemId }`), so nothing above the storage layer learns a new channel.
- **Backups** (`backup` api set): a point keeps copies of whole partitions, its own or those of another point, each identified like a partition plus a time. It is the partition-level counterpart of the versions of an item.

## The layer in the store

The store names every item by its store folder and its place there (`folder`, `dirName`, `groupPath`), and asks the storage layer for the **container** of a place:

```text
containerOf(folder, groupPath)
  -> the first folder of groupPath is a bound partition of this store folder
       -> its point cannot be used        -> AssetError -6
       -> a type other than file-tree     -> { driver of the type, the partition folder, the partition as prefix }
  -> else                                 -> { the file-tree driver, the store folder }
```

Every read and write of the store goes through the driver of the container (`AssetStorageDriver`): `itemPlaceList`, `itemMetaRead` / `itemMetaWrite`, `versionRead` / `versionWrite`, `versionMetadataRead` / `versionMetadataWrite`, `versionRemove`, `itemPlaceSet`, `itemRemove`, `groupMove`, `groupEmptyRemove`, `infoGet`, and optionally `compact` and `changeItemIdListGet`. Locks, names, the history, dependencies, events and the snapshot of a build are the store's and are written once, above the drivers. An item carries where it was found, `storage: { pointId, typeId }`, beside `folder` and `folderOwner`; like them it is read, never written into the item.

**Changes on disk.** A file of file-tree says which item it belongs to by its path. A pack file does not, so its driver answers which items changed since it was last asked (`changeItemIdListGet`, from the last chunk about each item), and the development server reports each as usual. A `partition.yaml` or an `asset-storage.yaml` changing makes the page read the store and the objects again.

## What a frontend object sees

A mode works through `config.objectFrontend` and never names a storage point in a read or a write. It can **ask**:

```text
service.partitionList[i].storage      { pointId, typeId, label, typeLabel, place, isContentSearchable,
                                        apiSetList, isAvailable, unavailableReason, pointIdClaimed, config }
service.storagePointList              the points the object may bind a partition to
service.partitionCreate(partition, storagePoint?)
service.partitionStorageSet(partition, storagePoint)
```

`apiSetList` is how a mode learns what more a point offers (a mode showing "last fetched" only where `cache` is promised). A form creating something says where it goes with the storage point when that is not file-tree ("goes to item/packed/book/, tracked by git, held by file-pack", `objectFrontendPartitionPlaceText`).

The routes are those of the [frontend object layer](doc_page_impl_obj_frontend.md#the-apis-of-partitions): `object-frontend/partition/create { id, partition, storagePoint? }`, `partition/storage/set { id, partition, storagePoint }`, `partition/compact { id, partition }`. `GET /status` of the asset api answers `storage { typeList, apiSetList, pointList, fileList }` and, for every folder an object owns, `partitionList`: each bound partition with what its storage holds (`itemCount`, `size`, `sizeDead`, `fileList`, `typeIdFoundList`). A built page receives the same in its snapshot and changes nothing.

## In the page

- **Asset service tab**, group **Storage points**: the points (id, type, who declares it, state, what it holds), the partitions bound to a point (object, partition, point, items, size, dead bytes, **Compact**), and the storage types with what each promises. The points are declared in the yaml files; the tab shows them and the problems of those files.
- **Frontend objects tab**, table **Partitions** of an object: the storage point of each partition, and **Storage…**, which asks for a point in the row and moves the whole partition to it.

## Files

```text
frontend/plugin/doc-asset-storage.ts             the storage types and api sets, the points and their files
                                                 (assetStorageConfigRead), the partition file and the bind of a
                                                 partition (assetStoragePartitionBindResolve), the driver interface
frontend/plugin/doc-asset-storage-file-tree.ts   the driver of file-tree
frontend/plugin/doc-asset-storage-file-pack.ts   the driver of file-pack: the pack format, the index, compaction
frontend/plugin/doc-asset-store.ts               containers (containerOf), every read and write through a driver,
                                                 partitionStorageSet, partitionCompact, partitionInfoList
frontend/plugin/doc-object-frontend.ts           the binds of an object's partitions (partitionStorageList), the point a
                                                 new partition is bound to (partitionStorageEnsure), the routes
                                                 partition/storage/set and partition/compact
frontend/plugin/doc-type-config.ts               storagePoint of a partition of a type
frontend/plugin/doc-entry.ts                     "assetStorage" of an entry and of the workspace file
frontend/plugin/doc-source.ts                    the storage config of the page, in the store config, the snapshot and the watcher
frontend/plugin/doc-asset-storage.test.js        types, points, the pack driver, a partition bound, moved and claimed back
frontend/src/store/DocAssetStore.ts              storage, storageOfBindGet, partitionInfoGet
frontend/src/store/DocObjectFrontendStore.ts     the storage of each partition, partitionStorageSet, storagePointListGet
comp-doc/settings/AssetStoreSettings.jsx         AssetStoragePointArea
comp-doc/settings/ObjectFrontendSettings.jsx     the storage column and Storage… of the Partitions table
.doc-workspace/asset-storage.yaml                the demonstration's workspace point (pack-small)
example_doc/.doc-page/asset-storage.yaml         a point of a contract type (team-remote)
example_doc/.doc-page/object-frontend/w5j7ozoijzl--Reading list/item/packed/   a partition held by file-pack
```
