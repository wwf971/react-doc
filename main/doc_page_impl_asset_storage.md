<!-- Design of the asset storage service layer: where the asset store keeps the bytes of its items. Storage types (contracts made of api sets), storage points, partitions bound to a point, the two local types file-tree and file-pack, the remote types a package brings with a driver of the page, the cache of a remote point, a remote point telling the page of changes (the api set notify), moving a partition between points. Parent document: doc_page_impl_asset.md. Its first user is the frontend object service layer (doc_page_impl_obj_frontend.md); a remote point signs its requests through the auth service layer (doc_page_impl_auth.md), and names the page it serves by its client instance (doc_page_impl_client_instance.md). -->

# Asset Storage Service Layer: Design

The [asset service layer](doc_page_impl_asset.md) is a store of versioned items. The **asset storage service layer** is the layer below it: it decides **where and in which form the bytes of the items are kept**. Every storage type answers **one common set of apis**, so a document, a component and a mode of a [frontend object](doc_page_impl_obj_frontend.md) read and write an item the same way whether it is a folder of yaml files, a chunk of a merged file, or a row of a backend in the cloud. Beside the common set, **a type offers apis of its own**, for what only its kind of storage has: a type that merges files can compact them; a type behind a network keeps a cache that can be refreshed and cleared, and knows who is signed in. Whoever cares asks a point what it offers ([Storage types](#storage-types)); whoever does not never sees the difference.

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
        └── remote …     a backend the page reaches itself        a partition bound to a point of a type a
                         read through a cache of the browser      package brings (aws-utils.remote)
```

The first two keep their bytes in the folders of the doc page and are read by the development server. A remote type keeps them behind a network and is read **by the page itself**, so it works where there is no server at all: on a statically hosted page.

## The concepts

- A **storage type** is a contract: the sets of apis a storage promises, and what is true of its data (local or remote, readable as plain files or not). Types extend one another, as the types of the [type registry](doc_page_impl_type.md) do; they are a small registry of their own and are not types of objects.
- A **storage point** is one instance of a type with its own config: `file-pack` with pack files of 1 MB, a bucket of a team. Two points are built in, and a workspace or a doc page declares more in a yaml file.
- A **partition** is what a storage point holds for a frontend object: "the partition `real` of the object `frontend:{id}`, an object of the type `cv.profile`", with its items. It is the [partition of the frontend object](doc_page_impl_obj_frontend.md#partitions); here it is the unit of storage.
- A **bind** says which point holds a partition. **One partition is bound to one point**: never some items of a partition at one point and others at another.
- A **driver** is the code of a type: how the items of one container (a store folder, a partition folder, a partition at a backend) are listed, read and written. It runs where the bytes can be reached: the driver of a local type **on the development server**, the driver of a remote type **in the page** ([Points of the page](#points-of-the-page)).

The **store** is not a storage point. The store (`local`) is what a reference names and what answers for an item id; the points are where the store keeps the parts of itself. So no reference, no key and no path of an asset changes when a partition moves to another point.

## Who is the truth of what

| what | its truth | read by |
| --- | --- | --- |
| which types exist, what each promises | the layer itself (`ASSET_STORAGE_TYPE_LIST`), and the packages the page imports (`asset-storage-type.yaml`) | the store, the page |
| which points exist | the built-in ones, and `asset-storage.yaml` of the workspace and of each doc page | the development server, for every request |
| which point holds a partition | `partition.yaml` in the folder of the partition; without it, file-tree | the development server, with the declarations of the objects |
| whose partition it is | the same file (`owner`, `partition`), and for a local type the folder it lies in | whoever claims a partition back |
| the items and their versions | the data the point holds, in the form of its type | the driver of that type |
| which assets an object has in the partition | the item list of the partition (`item-list.yaml`), the object's own record; for a remote point, the records the point keeps with the items | the frontend object layer |
| what a remote point held when last asked | the cache of the browser: never the truth, checked against the point | the page |
| who the page is to a remote point | the session of the auth provider the point names ([auth layer](doc_page_impl_auth.md)) | the page driver |
| which running page made a change | the client instance id the page sent, told back as the actor of a notification ([client instance](doc_page_impl_client_instance.md)) | the page, comparing it with its own |

## Storage types

A type promises **api sets**. Two are common to every type; a type adds more, and a type extending another promises what its ancestors promise.

```text
storage                 items · partitions                     the root: what every type promises
├── file-tree           (nothing more)                         local, plain files
├── file-pack           + pack files                           local, opaque
└── remote              + cache · authorization                behind a network; no driver of its own
    │                   (+ change notification, when a point turns it on)
    └── aws-utils.remote   a storage service on AWS            brought by the package aws-utils, with its driver
any type may add        + backups
```

| api set | what it is for | apis |
| --- | --- | --- |
| **item** | single data items with their versions. It is the api of the asset store, the same whatever point holds an item ([The store api](doc_page_impl_asset.md#the-store-api)) | `itemList`, `itemGet`, `versionDataGet`, `itemCreate`, `itemUpdate`, `itemMetaSet`, `itemMove`, `itemDelete`, `versionCheckout`, … |
| **partition** | the partitions a point holds, each named by its object, the type of that object and its own name | `partitionList`, `partitionGet`, `partitionCreate`, `partitionRename`, `partitionDelete`, `partitionStorageSet`, `partitionCopy`, `partitionClaim` |
| **pack** | the merged files of a partition | `packInfoGet` (sizes, how much is dead), `packCompact` |
| **cache** | the local copies of what a remote point holds | `cacheInfoGet`, `cacheRefresh`, `cacheClear` |
| **auth** | who the page is to a point that asks | `authStatusGet`, `authSignIn`, `authSignOut` |
| **notify** | a point telling the page of a change made elsewhere (another tab, device or program), over a channel the page keeps open | `notifyOpen` (the driver), `notifyStateGet`, `partitionNotifyGet` ([Being told of changes](#being-told-of-changes)) |
| **backup** | copies of whole partitions, of this point or of another | `backupCreate`, `backupList`, `backupRestore`, `backupDelete` |

**Why two common sets.** The item set serves whoever holds an item id: a document, the asset panel, a mode. The partition set serves the frontend objects, which think in partitions: make one, move one whole, find one again. A point is addressed through both, and the item set never needs to know partitions exist.

**A set of its own is asked for, never assumed.** A point says the sets it promises (`apiSetList`), and whoever shows something of a set looks first: a mode shows "last fetched" and a Refresh button only where `cache` is promised, the Asset service tab offers **Compact** only where `pack` is.

**An optional set is turned on per point.** `notify` is not promised by being of a remote type: a point promises it only when its config says `isNotifyEnabled: true` *and* its type and backend offer it. Being told of changes costs something (a connection kept open, a backend that fans changes out), so it is a decision of each point, visible in its file, and of each deployment of a backend, which may be made without its channel. A point asking a backend that has none says so where its state is shown, and is asked as before ([Being told of changes](#being-told-of-changes)).

**What is true of a type** is declared with it and reaches the page, so a frontend object can ask what its data stands on:

```text
place                 local (in the folders of the doc page) | remote (behind a network)
driverPlace           where its driver runs: server (the development server reads the folders) |
                      page (the browser talks to its backend)
isContentSearchable   a search of the disk, the index of an editor and a text comparison of git read
                      the content of the items; false for a type that merges or hides it
isStandaloneItemHeld  it may hold items that belong to no partition. Only file-tree: the asset
                      folders of a doc page are always file-tree, and only a partition of a
                      frontend object can be bound to another type
configKeyList         the keys of a point's config the type reads, with their defaults (its ancestors' too)
apiSetOptionalList    the sets a point promises only when its config turns them on: [{ id, configKey }]
definedBy             the page itself, or a package
isImplemented         it has a driver; false: a contract only
```

The type `remote` is a **contract without a driver**: it fixes what every remote type promises (the two common sets asked over a network, a cache, a session, being told of changes where a point asks) and the config keys they share (`url`, `cacheMode`, `isRefreshedOnFocus`, `refreshIntervalSec`, `isNotifyEnabled`). A point is made of a type below it, which brings the driver of one backend. The api set `backup` is a contract too ([TODO](doc_page_impl_TODO.md#asset-storage-backup)).

### Storage types of a package

A package brings a storage type in a file at its top, as it brings types of objects in `type.yaml` ([Packages](doc_page_impl_package.md#what-a-package-brings)):

```yaml
# {package}/asset-storage-type.yaml
storageTypeList:
  - id: aws-utils.remote             # {packageName}.{name}: lower case letters, digits, "-"
    extends: remote                  # remote, or a type below it
    label: AWS storage service
    description: the partitions kept at a storage service on AWS
    configKeyList:                   # the keys of a point's config it reads, beside its ancestors'
      - { key: space, description: the area of the point at the service, valueDefault: "" }
    driver: { entry: ./comp-mdx/storage/aws-storage-driver.js, export: awsStorageDriverCreate }   # relative to this file
    panelComp: AwsStoragePointPanel  # optional: a component of the registry, for the Asset service tab
```

- **The driver is a module of the page.** The plugin imports it like a component (`docStoragePageDriverList` of the virtual module), so it is bundled into a build. What it must answer is in [The page driver](#the-page-driver).
- **A type of a package extends a type whose driver runs in the page.** A local type needs the development server's file access, which a package's module in the browser does not have.
- **The id starts with the name of the package**, so two packages never declare the same type. A file that breaks a rule is a problem of that file, listed in the Asset service tab; the page loads.
- Every doc page of a workspace importing the package may declare points of the type.

### A preference of where bytes are kept

Some storages have two places for the bytes of an item: a remote point may keep them in its **database** (quick to read with the index, dear by the byte) or in its **object storage** (cheap by the byte, one more request to read). An item may say which it prefers, `storagePreference: database | objectStorage`, absent when the storage decides, by the size. It is a field of the item, written at its creation and by `itemMetaSet`, kept in `item.yaml` like `saveMode`:

```text
the store        itemCreate / itemMetaSet { storagePreference }      checked: '', database, objectStorage
a local type     keeps the key, writes the bytes where it always does (one place)
a remote type    hands it to its backend, which places the bytes of every version written from then on
moving           a partition moved between points takes the key along, so the target places the bytes as asked
```

- **A preference, not a condition.** No write is refused for it, and nothing above the storage depends on where the bytes are. A type that has two places says, per version, where it put them (`aws-utils.remote`: `dataPlace`, [its contract](../package/aws-utils/doc/storage-contract.md#where-the-bytes-are-kept)).
- **Who chooses** is whoever writes the data: an upload dialog that knows a file is large and rarely read asks for object storage; a small record of a mode leaves it to the storage. A frontend object's mode passes it with the asset (`assetCreate({ bytes, storagePreference })`, [the api of a mode](doc_page_impl_obj_frontend.md#the-entry-component)).

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
  - id: cloud
    type: aws-utils.remote            # a type of a package: its driver runs in the page
    config: { url: "https://abc123.execute-api.us-east-1.amazonaws.com", cacheMode: readThrough }
    auth: { provider: frontend:w6abcdefghi }   # for a type with the api set auth: the auth provider whose
                                               # session signs its requests (doc_page_impl_auth.md)
```

An id declared twice keeps its first declaration (the built-in points, the workspace, then the doc pages in loading order) and the other is a problem of its file. Every point has a **state**:

| state | means |
| --- | --- |
| `ready` | it can hold partitions |
| `disabled` | `isEnabled: false` |
| `configInvalid` | a remote point that does not say where it is reached (`config.url`): a problem of its file |
| `typeNotImplemented` | its type is a contract without a driver (`remote` itself) |
| `typeUnknown` | no such type (a type of a package needs that package imported): a problem of its file |

That is the state of the **declaration**. Whether a remote point can be asked *now* (somebody is signed in, the backend answers) is a state of the page, which changes while the page is open ([Points of the page](#points-of-the-page)).

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
└── cloud/                      a partition bound to a point of a remote type
    └── partition.yaml            the bind: all the folder holds. its items and its records are at the point
```

```text
type          owns in the folder of a partition          never reads
file-tree     folders (an item, or a group)              files at the top, dot folders
file-pack     files item-{n}.pack                        folders
remote        nothing: the folder holds the bind         everything else
```

Dot folders (`.cache/`, `.tmp/`) are reserved for what a type caches or is writing: no type reads them as data, and one rule of the `.gitignore` keeps them out of git.

**The item list stays a plain file for every local type.** It is the object's record of what it holds (key, kind, name, paths), small, read by the development server with the declarations, and it lets a person see what a pack holds without opening it. So the names and paths of the assets of a packed partition are still found by a search; their data is not. **A remote type keeps the records at the point, with the items**: a page with no server must find the assets of an object from the point alone, and a second machine must see what the first one wrote.

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

So the type gives a default for a new partition, and each object is free afterwards: one object of a type may keep `real` in pack files while another keeps it at a backend. A point must be `ready` and seen by the doc page of the object, or the write is refused before anything is written (`-6`, or `-3` for an id nobody declares). A partition made at a point of the page is bound the same way (its `partition.yaml` is written by the development server), then made at the backend by the page.

### Changing the storage of a partition

`partition/storage/set { id, partition, storagePoint }` moves **a whole partition** to another point. Nothing of the object changes: the records of its item list, the keys, names and paths, the item ids, the versions and their history stay. Who does the copying depends on where the two points are:

```text
both points local (file-tree, file-pack)        the development server copies, in one request
a point of the page on one side at least        the page copies: it reads from one side and writes to the other
```

**Between two local points:**

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

<a id="moving-through-the-page"></a>**Through the page** (to a remote point, away from one, or between two):

```text
partitionStorageSet(partition, point, { isSourceKept? })                  the page (DocAssetRemoteStore)
  -> the source is read: its items, its records
  -> the target is prepared: the partition made at a remote point (its identity), nothing for a local one
  -> for every item: every version read at the source, then the item written at the target with its
     history (a remote point: itemImport; a local point: partition/item/import of the development server)
  -> going to a remote point: its index is read back and every hash compared
       -> a difference: stop, the partition is as it was
  -> partition/storage/set { isDataTransferred, recordList }             <- the switch, by the development server:
       partition.yaml is written; what its folder held is removed (to a remote point: the items and the
       item list, the records being at the point now), or its item list is written (coming home)
  -> away from a remote point: what that point held is removed, or kept there with isSourceKept
```

- **Progress is a state of the page** (`transfer`: the partition, what is being done, how many versions of how many), shown under the Partitions table.
- **Removing what the source held may take more than one request**: a point removes as much as one request allows and says the partition is still there; the page asks again until it is gone.
- **`isSourceKept` makes it a copy**: the partition becomes local and what the remote point holds stays there, read by no object. It is listed with the point, and can be claimed again or removed there. This is how a partition in the cloud is copied to files without leaving the cloud.
- **An item written again replaces the one of its id**, so a move that stopped halfway is run again.
- **Only where the folder of the object can be written**: the switch is the development server's. A built page reads and writes a remote partition, and does not change where a partition is held.

An interruption before the switch leaves the partition as it was, with a copy to remove; after it, the partition as it will be, with the data of the type before still there. Both are reported, never repaired unasked: the info of the partition lists the types whose data lies in its folder (`typeIdFoundList`), and a second change is refused while two are found.

Moving **one item** between two partitions of different local points works the same way at a small scale (`asset/move`): the item is written by the type of the target, then removed where it was. A group folder cannot cross two points; its items are moved one by one. One item alone does not move between a remote point and another point yet ([TODO](doc_page_impl_TODO.md#asset-storage-item-move)).

### Claiming a partition back

A bind names a point, but a partition is **identified by its object and its name, and its data by the type that wrote it**, not by the id of a point. When the point a `partition.yaml` names is gone, disabled, or declared again as another type:

```text
the point named is ready and of the type the data was written by   -> it is used
else: a ready point of that type the doc page sees                  -> the partition is read through it
                                                                       (pointIdClaimed), and the object reports it
else                                                                -> the partition cannot be used: its items are
                                                                       not read, nothing is written into it (-6)
```

A partition read through another point is a problem of its object with one way out: set its storage to the point that reads it (`partition/storage/set`), which rewrites the file and changes no data.

**At a remote point, claiming is how a partition is found again where its folder is missing.** The folder of a partition kept out of git is not in a fresh clone, and neither is the `partition.yaml` in it; the data is at the point all the same, under the identity `{ owner.ref, partition }`. `partition/create` with the point (in the tab: **Create or claim**) writes the bind and asks the point: a partition of that identity it holds already is the partition from then on, with its items; else one is made. One the point holds marked deleted refuses every write, so the page restores it before it is used. A partition of a remote point is never read through another point: its data lies at one backend, in the area of one point.

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

## Points of the page

A point of a remote type is driven by the page. The development server keeps one thing about a partition bound to it, the bind (`partition.yaml`), and reads or writes none of its items; a built page has the binds in its snapshot. Everything else is the page's half of the layer, `DocAssetRemoteStore`:

```text
the page
  DocAssetStore ── its backend routes by item id ──┬─► the development server, or the snapshot of a build
       ▲   one index of every item                  │     (file-tree, file-pack)
       │                                            └─► DocAssetRemoteStore
  DocObjectFrontendStore                                  ├─ a page driver per point ──► the backend of the point
       the records of a remote partition                  ├─ the state of every partition bound to a point of the page
       join the item lists of its object                  ├─ the cache (IndexedDB of the browser)
                                                          └─ the session of the point's auth provider (DocAuthStore)
```

- **One store, still.** The items of a remote partition join the index of the asset store beside the others, with where they are held (`storage: { pointId, typeId }`) and the place they would have in the folder of their object (`{partition}/{groupPath}`). A reference, the asset panel and a mode read them like any item.
- **The backend of the asset store routes.** Every call about an item goes to the page driver when a point of the page holds the item, else to the development server (`assetBackendRouteCreate`). The store does not know which half answered.
- **The structural writes of a frontend object are routed the same way**: a write about a partition a point of the page holds (an asset created, removed, renamed; the partition made, renamed, deleted, moved) is done by the page against the point, checked by the same rules the development server applies (the kinds of the type, a key and a path unique in the object).
- **A point may keep a channel to the page** (`notify`), on which it tells of what changed elsewhere ([Being told of changes](#being-told-of-changes)).

### The page driver

The module a storage type names exports a function making one driver per point:

```text
driverCreate({ point, credentialGet, clientInstanceIdGet })
                                            point: the storage point as declared
                                            credentialGet(): the token of the session of point.auth.provider
                                            clientInstanceIdGet(): the id the page names itself with, sent to a
                                            backend that takes it (doc_page_impl_client_instance.md)
every method answers { code, data, message }:
  statusGet()  accountGet()                                         the backend, and who the session is to it
  partitionList()  partitionGet({ partitionId, revisionKnown })     the index of a partition: its records, the
  partitionCreate({ ownerRef, ownerTypeId, partition })             metadata of its items; isSame when unchanged
  partitionRename  partitionDelete  partitionRestore
  itemGetList({ partitionId, requestList })                         versions: text, or bytes
  itemCreate  itemUpdate  itemMetaSet  itemMove  itemDelete  itemRestore  itemLockSet  itemRemove  itemImport
  versionCheckout  versionDelete  versionLockSet  versionMetadataSet
  dependencyListSet  dependencyAdd  dependencyRemove  groupMove  recordSet  recordRemove
optional, the api set notify:
  notifyOpen({ onNotification, onStateChange })  -> { close() }     a channel kept open, opened again by the
                                                                    driver when it closes
```

The driver is only the wire: how each call is sent to its backend. It keeps no index and no cache, and decides nothing about a session. What an item is and how it behaves is the same as in the local store; the backend applies the rules, so they hold whichever client writes. An item of a point has no name of the store (people name it in its record), and its `groupPath` is its place inside its partition.

### The state of a partition

The page knows every partition bound to a point of the page with one of these states, shown wherever the partition is:

| state | means | the object sees |
| --- | --- | --- |
| `loading` | being read for the first time | its other partitions |
| `ready` | its index is in hand; `isFromCache` while the point has not confirmed it in this page | its assets |
| `absent` | the point answers and holds no such partition yet: the first write makes it | an empty partition |
| `authRequired` | nobody is signed in to the provider of the point | nothing of it, and a **Sign in** button |
| `forbidden` | the backend refuses the account, also with a credential made anew: a refusal is asked again once that way, since a credential says the roles the account had when it was made ([accounts and roles](doc_page_impl_auth.md#accounts-and-roles)). **Refresh** asks again after a role was given | a problem of the object |
| `unreachable` | the backend did not answer and the cache holds nothing | nothing of it |
| `error` | anything else, with the message | a problem of the object |

A partition that is not `ready` does not break its object: the other partitions work, as with a local point that cannot be used. What was read for a person leaves the page with them: signing out empties the partition and drops the cache of that person.

### The cache of a remote point

A remote point costs a request, time and money for every read. The page keeps what it read, in the browser, and asks the point as little as it can:

```text
page start
  -> the cached index of each partition is shown at once                      nothing is waited for
  -> the point is asked: partitionGet with the revision the cache has
       -> isSame                 one small answer; the cache is the truth
       -> else                   the new index replaces it
a version (the data of an asset)
  -> in the cache for the revision of its item: used
  -> else read from the point, a few together, and kept
a write
  -> the answer is taken into the index and the cache; it carries the revision after it
  -> a revision that is not the one before plus one: somebody else wrote, the index is read again
the point does not answer
  -> what the cache holds is shown, marked "from the cache"; nothing is written until it answers
```

| config of a point | does |
| --- | --- |
| `cacheMode: readThrough` (default) | the cache is shown at once and checked against the point at every page start |
| `cacheMode: pinned` | the cache is trusted until somebody refreshes: no request at a page start. For data that rarely changes, or to work without a network |
| `cacheMode: none` | nothing is kept: every page start reads the point |
| `isRefreshedOnFocus: true` | the point is asked again when the page gets the focus back |
| `refreshIntervalSec: 60` | the point is asked again every so many seconds while the page is open (`0`, the default: never by itself) |

- **A refresh is always there**: the api `partitionRefresh` of a mode, **Refresh** in the row of the partition and of the point. It asks the point whether the partition changed, and reads what did.
- **The cache is the page's, not the driver's.** It is the same for every remote type: an index per partition and the data of the versions read, in IndexedDB (in memory where the browser has none), keyed by the point, its backend and the person signed in. So two people on one browser never read each other's copy.
- **A cache is never the truth.** It is dropped whole and read again (**Clear**), never edited; a failure of it is swallowed, and the point is read.
- **Not being told is the default.** A page learns of a change made elsewhere at its next refresh. Being told at once is the optional api set `notify` (below).

### Being told of changes

A point whose config says `isNotifyEnabled: true`, of a type and a backend that offer it, keeps a **channel** to the page: while it holds a partition of the page and somebody is signed in to it, its backend tells the page of every change made to those partitions, by another tab of the browser, another device, a program. The page then reads the partition again as a refresh does: one request, cheap while nothing changed. A notification is a hint, never the data, so nothing has to be kept in step between the channel and the reads, and a page that missed one is only late.

<!--renderComp=DiagramText-->
```text
 tab A                              backend of the point            tab B
   │  item/update                         │                           │
   │  X-Client-Instance-Id: 3k9x…  ──────►│ the write, then to every   │
   │                                      │ channel of the partition   │
   │ ◄──── partitionChanged ──────────────┼──── partitionChanged ─────►│
   │       revision 12, actor 3k9x…       │     revision 12            │
   ▼                                      │     actor 3k9x…            ▼
 its own (the id is its own):             │               another instance:
 its answer brought it, nothing read      │       the partition read again,
                                          │          its notes lit a moment
```

```text
a notification of a partition { event, partitionId, revision, itemIdList, actor }
  -> no partition of the page                              nothing
  -> the page holds that revision already                  nothing
  -> the actor is this client instance                     nothing now: the answer of its write brings it.
                                                           a moment later (4 s) the page checks it holds the
                                                           revision told, and reads it if not (an answer lost)
  -> else                                                  read again (a burst of notifications: one read),
                                                           and changeElsewhere of the partition says by whom
the channel opens, the first time and every time after a close
  -> every partition of the point checked by revision      what changed while it was closed was told to nobody
a partition removed, the space of the point removed        the partitions concerned read again: found gone
```

- **The page tells its own changes from the others** by the [client instance](doc_page_impl_client_instance.md): every request carries the id of the page, and the backend writes it into the actor of each notification. The backend tells every channel, the actor's own too; the page compares.
- **When the channel is kept.** The layer opens one channel per point, while a partition of the page is bound to it and its auth provider has a session; it closes it when nobody is signed in or nothing is held any more, and opens another for another person (a channel is of one account). The driver keeps it open meanwhile: it pings it, and opens it again after it closes, waiting longer after each failure.
- **Its state** is a state of the page, per point (`notifyStateGet`): `off` (not wanted now, with why), `connecting`, `open` (since when, how many told), `waiting` (opened again in a while), `unsupported` (the type or the backend has no channel: the point is asked as before), `refused`, `error`. The page keeps the last 40 notifications of each point, each with what it did (`self`, `known`, `read`, `notHeld`).
- **A cache mode `pinned`** trusts the cache until a refresh: the channel does not read the partitions when it opens, and a notification still does (it says the cache is out of date).
- **What a type brings**: a driver with `notifyOpen`, turning the frames of its backend into notifications of partitions. For `aws-utils.remote` it is the notification channel of the package (`@react-doc/package/aws-utils/doc/notify-contract.md`), one topic per space.

### Who the page is to a point

A point with the api set `auth` names an auth provider (`auth: { provider: frontend:{id} }`), and its driver sends the credential of that provider's session with every request ([auth layer](doc_page_impl_auth.md)). The point signs nobody in: where a partition says `authRequired`, a **Sign in** button opens the dialog of the provider. One provider serves any number of points.

What a point may reach at its backend is the backend's to enforce, not the page's: the contract of a type says how a point is told apart from another and held to its own data (for `aws-utils.remote`, a space per point and account: `@react-doc/package/aws-utils/doc/storage-contract.md#who-may-touch-what`).

### What a remote point answers with

The codes of the asset layer, and four more that only a point behind a network has:

| code | means |
| --- | --- |
| `-7` | nobody is signed in, or the backend does not accept the session |
| `-8` | signed in, and not allowed: the account, or the area asked for |
| `-9` | the backend was not reached (said by the driver) |
| `-10` | over a limit of the backend |

### On a built page

A built page has no development server, and a remote partition works on it all the same: its bind travels in the snapshot, its data is read from the point by the page, and it is **written** there too, since the write never needed a server. So `isWritable` of an object is no longer only "is there a development server": an object with a partition a point of the page can write is writable in that partition ([What a frontend object sees](#what-a-frontend-object-sees)). What a built page cannot do is change the folders: make an object, bind a partition, move one between points.

`react-doc build` bundles no item of a remote partition, which is what keeps a person's data out of a published page.

## The layer in the store

The store names every item by its store folder and its place there (`folder`, `dirName`, `groupPath`), and asks the storage layer for the **container** of a place:

```text
containerOf(folder, groupPath)
  -> the first folder of groupPath is a bound partition of this store folder
       -> its point cannot be used        -> AssetError -6
       -> a type other than file-tree     -> { driver of the type, the partition folder, the partition as prefix }
  -> else                                 -> { the file-tree driver, the store folder }
```

A partition bound to a point of the page has no container: its items are not the development server's to read, so a place in it is refused with `-6` and a message saying the page holds it, it is skipped by every scan, and its info counts nothing. The store only switches its bind (`partitionStorageSet` with `isDataTransferred`) and writes the items the page brings home (`partitionItemImport`).

Every read and write of the store goes through the driver of the container (`AssetStorageDriver`): `itemPlaceList`, `itemMetaRead` / `itemMetaWrite`, `versionRead` / `versionWrite`, `versionMetadataRead` / `versionMetadataWrite`, `versionRemove`, `itemPlaceSet`, `itemRemove`, `groupMove`, `groupEmptyRemove`, `infoGet`, and optionally `compact` and `changeItemIdListGet`. Locks, names, the history, dependencies, events and the snapshot of a build are the store's and are written once, above the drivers. An item carries where it was found, `storage: { pointId, typeId }`, beside `folder` and `folderOwner`; like them it is read, never written into the item.

**Changes on disk.** A file of file-tree says which item it belongs to by its path. A pack file does not, so its driver answers which items changed since it was last asked (`changeItemIdListGet`, from the last chunk about each item), and the development server reports each as usual. A `partition.yaml` or an `asset-storage.yaml` changing makes the page read the store and the objects again.

## What a frontend object sees

A mode works through `config.objectFrontend` and never names a storage point in a read or a write. It can **ask**:

```text
service.partitionList[i].storage      { pointId, typeId, label, typeLabel, place, driverPlace, isContentSearchable,
                                        apiSetList, isAvailable, unavailableReason, pointIdClaimed, config,
                                        remote?: { status, message, isFromCache, isRefreshing, timeChecked,
                                                   timeFetched, revision, itemCount,
                                                   notify?: { status, message, timeOpened },
                                                   changeElsewhere?: { time, actor, itemIdList, revision } } }
service.storagePointList              the points the object may bind a partition to
service.partitionCreate(partition, storagePoint?)
service.partitionStorageSet(partition, storagePoint, { isSourceKept? })
service.partitionCopy(partitionFrom, { id?, partition, storagePoint? })
service.partitionWriteUnavailableReasonGet(partition)     '' when it can be written now
service.partitionRefresh(partition)   service.partitionSignIn(partition)      for a partition of a point of the page
service.partitionNotifyGet(partition) what its point told of it: the state of the channel, the id of this page,
                                      the notifications about it with what the page did (undefined: told nothing)
```

`apiSetList` is how a mode learns what more a point offers (a mode showing "last fetched" only where `cache` is promised). `remote.changeElsewhere` lets a mode say that something changed in another tab or device, and light up what (the notebook of `aws-utils` lights the notes a notification names). A form creating something says where it goes with the storage point when that is not file-tree ("goes to item/packed/book/, tracked by git, held by file-pack", `objectFrontendPartitionPlaceText`).

**Whether a partition can be written is asked per partition.** `isWritable` of an object says that something of it can be written; `partitionWriteUnavailableReasonGet` says why one partition cannot: the page (no development server, a package) for a partition in its folders, the point (nobody signed in, out of reach) for a remote one. A mode whose data lies in a remote partition offers its writes by this, and so works on a built page.

The routes are those of the [frontend object layer](doc_page_impl_obj_frontend.md#the-apis-of-partitions): `object-frontend/partition/create { id, partition, storagePoint? }`, `partition/storage/set { id, partition, storagePoint, isDataTransferred?, recordList? }`, `partition/item/import { id, partition, storagePoint, item, versionList }`, `partition/compact { id, partition }`. `GET /status` of the asset api answers `storage { typeList, apiSetList, pointList, fileList }` and, for every folder an object owns, `partitionList`: each bound partition with what its storage holds (`itemCount`, `size`, `sizeDead`, `fileList`, `typeIdFoundList`). A built page receives the same in its snapshot.

## In the page

- **Asset service tab**, group **Storage points**: the points (id, type, who declares it, state, what it holds), the partitions bound to a point (object, partition, point, items, size, dead bytes, **Compact**), and the storage types with what each promises. The points are declared in the yaml files; the tab shows them and the problems of those files.
- The same group, **Points the page reaches itself**: one block per remote point with where it is reached, who is signed in to it (`AuthSessionLine`, with Sign in / Sign out), whether its backend answers (**Check**), what the browser keeps of it (**Refresh**, **Clear**), how it learns of changes (asked, or told: the state of its channel and the client instance of this tab), the partitions it holds for the objects of the page with their state, revision and when they were fetched, and the last notifications it told, each with who made the change (this tab, another instance) and what the page did.
- <a id="what-a-type-adds-to-the-tab"></a>**What a type adds to the tab.** A type may name a component (`panelComp`), drawn under the block of each of its points in the placement `assetStoragePoint` with `data: { pointId, docPageAlias }`: what only that backend has (for `aws-utils.remote`: the account, the space of the point, the partitions of the space no object reads).
- **Frontend objects tab**, table **Partitions** of an object: the storage point of each partition, with the state of a remote one and **Refresh** or **Sign in**; **Storage…**, which asks for a point in the row (and whether to keep a copy, away from a remote point) and moves the whole partition; **Copy…**, which copies its assets into another partition; **Create or claim** for a partition its type binds to a remote point.

## Files

```text
frontend/plugin/doc-asset-storage.ts             the storage types and api sets, the types of the packages
                                                 (assetStorageTypeDeclaredRead), the points and their files
                                                 (assetStorageConfigRead), the partition file and the bind of a
                                                 partition (assetStoragePartitionBindResolve), the interface of a
                                                 server driver
frontend/plugin/doc-asset-storage-file-tree.ts   the driver of file-tree
frontend/plugin/doc-asset-storage-file-pack.ts   the driver of file-pack: the pack format, the index, compaction
frontend/plugin/doc-asset-store.ts               containers (containerOf), every read and write through a driver,
                                                 partitionStorageSet, partitionItemImport, partitionCompact,
                                                 partitionInfoList; a partition of a point of the page kept as a bind
frontend/plugin/doc-object-frontend.ts           the binds of an object's partitions (partitionStorageList), the point a
                                                 new partition is bound to (partitionStorageEnsure), the routes
                                                 partition/storage/set, partition/item/import and partition/compact
frontend/plugin/doc-type-config.ts               storagePoint of a partition of a type
frontend/plugin/doc-entry.ts                     "assetStorage" of an entry and of the workspace file
frontend/plugin/doc-source.ts                    the storage config of the page, in the store config, the snapshot and the watcher;
                                                 docStoragePageDriverList of the virtual module: the modules of the page drivers
frontend/plugin/doc-asset-storage.test.js        types, points, the pack driver, a partition bound, moved and claimed back
frontend/src/store/DocAssetStore.ts              storage, storageOfBindGet, partitionInfoGet; its backend routed (backendBase, remote)
frontend/src/store/DocAssetRemoteStore.ts        the page's half: the page drivers, the state of the partitions of the points of
                                                 the page, reading and writing their items, the structural writes of an object
                                                 about them, the cache api set, moving a partition through the page, the channel
                                                 of each point that tells of changes (notifySync, notifyAccept)
frontend/src/lib/doc-client-instance.js          the id the page names itself with (doc_page_impl_client_instance.md)
frontend/src/lib/doc-asset-backend.js            assetBackendRouteCreate: the backend routing by item
frontend/src/lib/doc-asset-storage-cache.js      the cache of the remote points: IndexedDB, or memory
frontend/src/store/DocObjectFrontendStore.ts     the storage of each partition, partitionStorageSet, storagePointListGet
comp-doc/settings/AssetStoreSettings.jsx         AssetStoragePointArea, AssetStorageRemoteArea (the points the page reaches)
comp-doc/settings/ObjectFrontendSettings.jsx     the storage column of the Partitions table: Storage…, Copy…, Create or claim,
                                                 the state of a remote partition
package/aws-utils/asset-storage-type.yaml        the storage type aws-utils.remote; its driver and its panel in comp-mdx/storage/, the
                                                 channel of its notifications in comp-mdx/notify/
.doc-workspace/asset-storage.yaml                the demonstration's workspace point (pack-small)
example_doc/.doc-page/asset-storage.yaml         a point of a contract type (team-remote)
example_doc/.doc-page/object-frontend/w5j7ozoijzl--Reading list/item/packed/   a partition held by file-pack
```
