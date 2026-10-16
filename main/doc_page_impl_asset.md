<!-- Design of the asset store. Parent document: doc_page_impl.md. This is the asset-store design document; other documents link here. -->

# Asset Store: Design

A component written in the degradation-compatible form, a comment marker and a code block, carries its data in the document. The asset store lets the data live outside of it: versioned **objects** in a **store**, and in the document a short **reference** in place of the data. The page resolves the reference before the component renders, so the component receives exactly the input it would receive with the data written inline and never learns where the data came from. The store is a general storage of versioned bytes with a standard api, modeled after an object storage; the document page is its first client. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md); the reference form is the component form of [MDX components](doc_page_impl_mdx_comp.md), and edit mode handles the reference as described in [In-place Editing](doc_page_impl_edit.md#component-edit-mode).

```text
document                             page                                    development server
<!--renderComp=Image-->              RegisteredComp                          plugin/doc-asset-server.ts
(fence) asset                          │ lang === 'asset'                     GET  {endpoint}/status        stores, folders
store: local                           ▼                                      GET  {endpoint}/object/list   the index
name: hero image                     CompAssetHost ── refLoad ──► DocAssetStore ──► GET  {endpoint}/object/get   by id or name
versionId: head                        │ { text, lang } of the version         │   POST {endpoint}/object/update …
(fence)                                ▼                                       │        │
                                     AssetFrame (loading / error / not text)   │        ▼
                                       └─ RegisteredComp (raw = text,          │   plugin/doc-asset-store.ts
                                           lang = object.lang)                 │   asset.yaml: folderList
                                                                               │   {folder}/{objectId}--{name}/object.yaml
                                     edit mode: block toolbar [asset] button   │                               {versionId}.{ext}
                                                                               │                               {versionId}.metadata.yaml
                                     AssetPanelPopup ◄── panel state ──────────┘
                                       versions, head, data, events, save mode, upload
                                       └─ AssetPreview: the block rendered with the data as it is now
                                     settings panel, tab "Asset store": the folders

build: the plugin expands every reference for its own scans and bundles
       the store as a read-only snapshot (assetSnapshot); the same page code
       reads it through the snapshot backend
```

## Stores, objects, versions

A **store** is a named place objects live in. The page has one store today, the **local store**, named `local` in every reference: the folders on the disk the development server runs on. Further stores are planned and the model leaves room for them: a **remote store** (an object storage service, a database) answering the same api over the network, and a **local cache** of a remote store, which holds copies of remote versions for reading and is treated differently from local objects (a cached version is never the truth, and is dropped and read again rather than edited). A reference names its store, so a document can mix objects of several stores once they exist, and the page never has to guess where an object is.

An **object** is a key with metadata; under it, **versions**, each a sequence of bytes. This is the model of an object storage (s3): the store does not care whether the bytes are text, and the same object can be a yaml mapping today and a png tomorrow. The metadata of an object:

- `objectId`: random, meaningless, unique; what the page writes when it refers to the object itself.
- `name`: a name a person chooses, meaningful and easy to remember (`hero image`), or empty. A name is **unique in its store** (every folder, deleted objects included), so it names one object as the id does, and a reference may use either; see [Names](#names).
- `lang`, `contentType`, `fileExt`: what the object is for the page. `lang` is the fence language the data would be written with inline (`yaml`, `md`, …; empty for data no component block reads), `contentType` the media type of the bytes (`text/yaml`, `image/png`, …), `fileExt` the extension its version files are stored with. The three are chosen when the object is created (`lang` fills in the other two for the usual text languages) and can be set later.
- `versionIdHead`: the **head**, the version a reference without a version reads.
- `saveMode`: what a save of the head does when the caller names no mode; see [Save modes](#save-modes).
- `isDeleted`, `isLocked`, `timeCreated`: the deletion mark, the object lock ([Locks](#locks)), and the one time the object was created.
- `versionList`: the history, in the order the versions were made. A version records its id, time, note, the `size` and `hash` (sha1) of its bytes, the versions it was made from (`versionIdPrevList`), its own lock (`isLocked`), and what its data depends on (`dependencyList`, [Dependencies](#dependencies)). What the writer of a version's data says about that data is not here but in a file of the version ([Version metadata](#version-metadata)).
- `eventList`: what happened to the object, in order; see [Events](#events).

The history is a directed acyclic graph kept in the object's metadata: normally every version names one predecessor, so the history is a chain; a version made from several would be a merge, which the model allows and the page does not yet produce. The data model follows the object store of `homepage-utils/storage-obj` (object, version, head, DAG history), kept on the local file system; the split into object metadata and version bytes is the split a service backend would make between a metadata table (DynamoDB) and the bytes (s3), so the same model moves there without change.

Ids are ms_48 ids, as every id of the project (`ai-skills/app-dev/references/id-format.md`): 48 bits of milliseconds plus a 16-bit random offset, in base36, no prefix or suffix, `plugin/id-ms48.ts`. Object ids and version ids come from the same allocator; a version id orders versions of one object only roughly (two versions in the same millisecond are ordered by chance), so the order of versions is the order of the object's version list, which the store appends to.

### Names

The id is for the page and the name is for people: a document written by hand says `name: hero image`, a reference the page writes (moving inline data into the store) says `objectId: w4okcncucnu`, and both resolve to the same object. For that the name must name exactly one object, so the store keeps it unique: creating an object with a name the store has **returns that object and creates nothing** (`isCreated: false` in the answer), and renaming an object to a taken name is refused. The rule is what makes "declare an asset by name" safe: a document, or a script, that creates `hero image` twice gets one object, never two with the same name. It also means that what is moved into the store from a block is created without a name (two Image blocks would otherwise become one object); the person names it in the panel.

A name is trimmed, at most 80 characters, and may not contain the characters a file name cannot hold on the major operating systems (`/ \ : * ? " < > |` and control characters), may not end with a dot, and may not contain the folder separator `--` (`nameNormalize`). Spaces and non-ascii letters are fine. The restrictions exist because the name is part of the object's folder name on disk, below.

### Events

`eventList` records what happened to the object, oldest first; `timeCreated` is the first time, and the list is where everything after it is kept. An in-place save leaves no new version behind, so without the list it would leave no trace; the list is modeled as a list for that reason, and as a list of mappings so that a key may be missing. Every event is `{ eventType, time, versionId?, userId? }`:

- `eventType`: `create`, `updateInPlace` (the head bytes rewritten), `versionCreate`, `checkout` (the head moved), `versionDelete`, `metaSet` (name, lang, type, save mode), `delete`, `restore`, `lock`, `unlock` (with `versionId` when one version's lock changed), `dependencySet` (a version's dependencies changed on their own), `versionMetadataSet` (a version's metadata changed on its own).
- `time`: the project's time format with its zone in the same string, `20261020_18495741+09` (`ai-skills/app-dev/references/time-format.md`), so the record is the same whatever zone it is read in.
- `versionId`: the version the event is about, for the events that concern one (an update, a new version, a checkout, a deletion).
- `userId`: reserved; the local store has no users, and a store that knows who writes fills it in.

The page shows the count and the last event in the panel and unfolds the list on request. Nothing reads the list to decide anything: it is a record, and the version list stays the history that the head and the references are resolved against.

### Text and bytes

The store reads and writes bytes. Whether a version is **text** is decided when it is read: bytes that decode as utf-8 without error (and without a NUL byte) are text, and the api returns the decoded text with the version; anything else is returned as size and hash only, and the bytes themselves are reached by url (`GET /object/data`) or, in a build, as base64 in the snapshot. A component block reads text, so a reference to a version that is not text shows an error in place of the component, with the type and size of the data, and the asset panel still opens on it. `contentType` is declared, not detected: it says what the bytes are meant to be, and a text version with `contentType: image/png` is a mistake the page shows rather than hides.

### Save modes

Writes to the head are of two kinds:

- `inPlace`: the head's bytes are replaced; the version keeps its id, and the previous bytes are kept as a backup file beside it. For corrections the author does not want to see in the history.
- `newVersion`: a new version is created from the head and becomes the head. The history grows.

A caller may name the mode of one write. When it does not, the object's `saveMode` decides, and an object without the key saves in place: the default is not written, so an object file says nothing until somebody chooses. The mode is chosen in the object's own asset panel and is kept in `object.yaml` like the name. It is the counterpart of `editType` of `storage-obj`.

Every update carries the hash of the head bytes the caller started from (`hashBase`); a different hash on disk refuses the update with code -2 and nothing is overwritten, as the [edit api](doc_page_impl_edit.md#edit-api-and-line-operations) does for files.

### Locks

A lock protects what an author wants kept from a click in the panel, on two levels:

- a **version lock** (`isLocked` of the version): the version is not rewritten in place and not deleted. It is the version's bytes that are protected, not the object's progress: a new version can still be made from a locked head (so a locked head turns every save into `Save as new version`), and the head can still move to or away from it.
- an **object lock** (`isLocked` of the object): nothing of the object changes, its data, versions and their locks, head, metadata (name included, so its folder is not renamed), and deletion mark, until it is unlocked; unlocking is the one write a locked object accepts. It is the lock for an object that documents rely on as it is.

The store enforces both (`AssetError` -1 with the reason), so a lock holds whatever client writes; the panel greys out what a lock forbids and says why. Setting or removing a lock is recorded as a `lock` / `unlock` event.

### Deleting

Deleting is of two kinds too. A version that is not the head can be deleted; the versions made from it are relinked to its predecessors, so the graph stays connected and the history of what remains stays readable. An object is deleted by a mark (`isDeleted`): its files stay, references to it keep resolving, and the mark is undone by restoring the object; the mark exists so that a reference is never broken by a click, and so that removing the files is a deliberate step taken outside the page (a cleanup of the folder). The head cannot be deleted; moving the head is a separate action (checkout).

### Dependencies

The data of a version may stand for more than its bytes. An Image object's version is a few lines of yaml whose `src` names an image file of the doc page source; a version may reuse the data of another object. Without a record of that, the bytes of a version are complete and what they mean is not: a build would not know to keep the image, and a deletion could not know what it breaks. Every version therefore records what its data depends on as `dependencyList`, a list of mappings each with a `type`:

```yaml
dependencyList:
  - { type: source, path: ~example/mdx-usage/image/hero.png }   # a file of the source, by source path
  - { type: asset, objectId: w4okcncucnu }                       # the head of another object of this store
  - { type: asset, objectId: w4okcncucnu, versionId: w4okcnd0a1x } # one version of it
```

The list belongs to the **version**, not the object, because it is the data that depends, and every version has its own data; `versionList` carries it beside the size and the hash. The store keeps the list and answers questions about it, but does not derive it: the bytes mean nothing to the store, and only the page knows that the yaml is for `Image` and which key names a file. The list is therefore declared by whoever writes the data, through `dependencyList` of `objectCreate` and `objectUpdate`, and the page derives it from the component the data is for: a registered component declares `assetDependencyListGet(data)` ([component awareness](#component-awareness)), the page resolves the paths it returns against the document (a relative `./hero.png` becomes a source path), and passes the list with the write. Creating an Image object whose image is a source file thus records the dependency without anyone asking for it. A write that names no list keeps the list of the version it writes over or is made from, so a version made in the panel from the same data keeps its dependencies; `dependencyListSet`, `dependencyAdd`, `dependencyRemove` change the list of one version on its own. The other direction, the versions that depend on an object (`dependentListGet(objectId)`) or on one of its versions (`dependentListGet(objectId, versionId)`; a dependency without `versionId` means the head and counts when the head is that version), is the base of a deletion that knows what it breaks, and is read from the backend because it needs every object. A build collects every source file the live versions depend on ([Build](#build)); the panel shows the dependencies of the selected version under its data.

### Version metadata

The bytes of a version are the data; some writers have more to say about it than the bytes hold: which engine (and which version of it) wrote the data, how a component should display it. A spreadsheet is the example: `ExcelUniver` records the Univer version that wrote the workbook and the range its view mode shows ([ExcelUniver](doc_page_impl_mdx_comp.md#exceluniver)). That is **version metadata**: a free yaml mapping per version, in its own file beside the version's bytes, and the store never interprets it.

**Which file records what.**

```text
object.yaml                  what the store keeps and answers questions with, readable without any
                             version file: the object (id, name, lang, content type, file extension,
                             save mode, head, deletion mark, lock, creation time), the history (every
                             version's predecessors, time, note), what identifies each version's bytes
                             (size, hash), each version's lock and dependencies, the events
{versionId}.{ext}            the bytes of one version: the data
{versionId}.metadata.yaml    what the writer of that data says about it: any mapping, for its reader
                             (always yaml, whatever {ext} is); absent when the version has none
```

The rule behind the split: what the store needs to manage objects (list them, resolve references, lock, relink the history, answer dependency questions) is in `object.yaml`, so listing a store reads one file per object; what only a reader of the data needs travels with the data, is read with it (`versionDataGet` returns `metadata`, `{}` without a file), and never makes `object.yaml` grow with content-specific keys. Dependencies stay in `object.yaml` although the writer declares them too, because the store answers questions over all versions with them ([Dependencies](#dependencies)).

**How it changes with the data.**

- `objectCreate({ …, versionMetadata })`: the first version's metadata; none when absent.
- `objectUpdate({ …, versionMetadata })`, in place: the head's metadata is replaced when the update names metadata, and kept as it is when not, since a writer that does not know the metadata must not erase it.
- `objectUpdate`, new version: the new version gets the named metadata, or a copy of the head's; every version owns its file, so changing one never changes another.
- `versionMetadataSet(objectId, versionId, metadata)`: replaces the metadata of one version on its own (an event `versionMetadataSet`); refused for a locked version or object, like a rewrite of its bytes. An empty mapping removes the file.
- `versionDelete` removes the version's metadata file with its bytes. Every rewrite goes through `fileWriteSafe`, so the previous metadata is `{versionId}.metadata.yaml.bak`.

Metadata must be a yaml mapping (`versionMetadataNormalize`; anything else is -1). It reaches the page with the version (`version.metadata` of `GET /object/get`, `metadata` in the snapshot), an asset-aware component as `config.assetInfo.versionMetadata` ([component awareness](#component-awareness)), and the panel shows it under the dependencies of the selected version.

## The local store: folders, fully reflected

The local store is one store with one id, but on disk it is one or more **folders**, and the folders are the store: every object, version, and piece of metadata is a file in one of them, readable without the page, and the page holds nothing the folders do not. Copying a folder copies its objects; a git checkout of a folder changes the store.

```text
asset.yaml                    the store config: folderList [{ path, isDefault }], paths relative to this file
{folder}/
└── {objectId}--{name}/       one folder per object: its id, the separator, its name
    │                         ({objectId} alone for an object without a name)
    ├── object.yaml           the object: objectId, name, lang, contentType, fileExt, saveMode (when set),
    │                         versionIdHead, isDeleted, isLocked, timeCreated,
    │                         versionList [{ versionId, versionIdPrevList, time, note, size, hash, isLocked,
    │                                        dependencyList [{ type, path | objectId, versionId? }] }],
    │                         eventList [{ eventType, time, versionId?, userId? }]
    ├── object.yaml.bak       the previous object file, written before every rewrite
    ├── {versionId}.{ext}     the bytes of one version, with the object's file extension
    │                         (yaml, md, png, …), so editors open it as what it is
    ├── {versionId}.{ext}.bak the previous bytes of a version written in place
    ├── {versionId}.metadata.yaml      the metadata of one version, when it has any (#version-metadata)
    └── {versionId}.metadata.yaml.bak  the previous metadata of a version
```

Which folders make up the store, and which one is the **default folder**, is the store's config file, named by `asset.file` of `config.yaml` (relative to the config file). Objects are created in the default folder; the other folders are read like it. An object is its folder, named `{objectId}--{name}` so that a person browsing the disk sees what each folder is (`w4okcncucnu--hero image`) while the store still works by id: the separator `--` is a string an id can never hold (ids are base36) and a name is refused when it holds it, so the id of a folder is what stands before the first `--`, and the folder needs no file read to be identified. The separator is valid in a folder name on every major operating system, and so is the name by the rules above. Finding object `w4okcncucnu` is finding the folder whose id part is that in each store folder, and listing the store is listing those folders; there is no index file to keep in sync. Renaming an object renames its folder. The first folder of the list wins when two folders hold the same id, which is a mistake the page cannot repair and reports by showing the first. Where the object was found (`folder`, `dirName`) travels with its metadata to the page and is not written into `object.yaml`.

```yaml
# config.yaml                      # asset.yaml (paths relative to asset.yaml)
asset:                             folderList:
  file: ./asset.yaml                 - path: ./asset
                                       isDefault: true
                                     - path: ./asset-archive
```

The plugin reads the `asset` section once, when the development server starts (`configResolved`), before it decides whether the page gets an asset api: without an `asset` section the page has no store; a section it cannot use stops the server with a message saying how to write it, rather than starting it without a store that the page would then report as not writable at the first save. A section is unusable when it is not a mapping with `file`, when it uses the former `asset.folder` (the store was once one folder named in `config.yaml`; the message shows the migration above, with the old folder as the default folder; the object folders stay as they are, no id or data changes), and when the store config file is not valid yaml or its `folderList` is not a list. A store config file that does not exist yet is an empty store, and a folder of the list that does not exist yet is created when the first object is written to it, so a new store needs no folder on disk to start. The endpoint and the middleware are chosen once (`configResolved`, `configureServer`), so a store added to `config.yaml` while the server runs takes effect after a restart of the server; a browser reload or a document's hot update does not install an api that was not installed at start.

The folders are changed from the page: the **Asset store** tab of the settings panel ([config: the settings panel](doc_page_impl_config.md#user-level)) lists them with their object counts, marks the default and a folder that does not exist on disk, and on the development server sets the default, removes a folder (its files stay; its objects just leave the store), or adds one (created on disk when missing). The new path is an `EditValueInline`, the same field as a source path; leaving it commits: Enter, the Add folder button, or a click outside adds the path, and leaving it empty shows the placeholder again. The whole list is sent (`POST /folder/set`) and the server rewrites `asset.yaml`, so the change holds across page loads. The store config has its own file rather than a line in `config.yaml` because a change of `config.yaml` reloads the whole page, and adding a folder should not.

There is one object file per object, and one metadata file per version that has metadata. Every rewrite of a file is protected the same way (`fileWriteSafe`): the current file is copied to `.bak`, the new content is written to `.tmp`, and the temporary file is renamed over the original, so an interrupted write leaves either the old file or the new one, and the previous content is one file away. The backups are recovery data, not history: the version files are the history, and the backups are excluded from version control (`.gitignore`). The demonstration store's default folder has its own `.gitignore` that lists the files of the example and ignores everything else, so trying the panel there (new versions, new objects, backups) leaves nothing to commit; changes of tracked files (an `object.yaml`, a version rewritten in place) still show, which an ignore file cannot hide, and `git restore` undoes them. Times are written in the project's time format (`20260520_23250530+09`).

A folder may lie inside a source folder (the example keeps `example_doc/asset` and `example_doc/asset-archive` beside the documents); the plugin never collects the store's files as documents (the config file and its backup included) and never invalidates the manifest for a change in them.

## The standard api

The file store (`plugin/doc-asset-store.ts`, `assetStoreCreate(config)`) is the api; the development server exposes it over http, and the page talks to it through a backend with the same method set. Every failure is an `AssetError` with a code: -1 bad request, -2 the data changed since it was read, -3 not found.

| method                                                     | effect                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `folderInfoList()` / `folderSet(folderList)`               | the folders with their state; the whole list rewritten (`asset.yaml`)      |
| `objectList()`                                             | metadata of every object of every folder, deleted ones included            |
| `objectGet(objectId)` / `objectGetByName(name)` / `objectFind({ objectId, name })` | metadata of one object, by id, by name, or by whichever the key has |
| `versionDataGet(objectId, versionId = 'head')` / `versionDataGetOf(meta, versionId)` | `{ versionId, bytes, size, hash, isText, text?, metadata }` of one version |
| `objectCreate({ name, lang, contentType, fileExt, saveMode, data, note, folder, dependencyList, versionMetadata })` | a new object with its first version, in the default folder unless one is named, with its save mode when given; `{ object, version, isCreated }`, the existing object and `isCreated: false` when the name is taken |
| `objectUpdate({ objectId, hashBase, data, mode, note, dependencyList, versionMetadata })` | the head data; `mode` `inPlace` or `newVersion`, the object's save mode when absent; `dependencyList` and `versionMetadata` absent keep those of the version written over or made from |
| `versionMetadataSet(objectId, versionId, metadata)`        | the metadata of one version replaced ([Version metadata](#version-metadata)); `{ object, version }` |
| `dependencyListGet(objectId, versionId = 'head')` / `dependencyListSet(objectId, versionId, list)` / `dependencyAdd(…, dependency)` / `dependencyRemove(…, dependency)` | the dependencies of one version ([Dependencies](#dependencies)) |
| `dependentListGet(objectId, versionId = '')`              | the versions of the store depending on the object, or on one version of it: `[{ objectId, versionId, dependency }]` |
| `dependencySourcePathList()`                               | the source files the versions of the live objects depend on, each once; what a build collects |
| `objectMetaSet(objectId, { name, lang, contentType, saveMode })` | the metadata a person chooses (`saveMode: null` removes the key; a new name renames the folder and must be free) |
| `versionCheckout(objectId, versionId)`                     | moves the head                                                             |
| `versionDelete(objectId, versionId)`                       | removes a version that is not the head; its children are relinked          |
| `objectDelete(objectId)` / `objectRestore(objectId)`       | the deletion mark                                                          |
| `objectLockSet(objectId, isLocked)` / `versionLockSet(objectId, versionId, isLocked)` | the object lock, the lock of one version ([Locks](#locks)) |
| `referenceTextGet({ objectId | name, versionId })`         | `{ lang, text }` of a reference to a text version, or nothing; what the plugin expands with |
| `snapshotBuild()`                                          | every object that is not deleted, with the data of all its versions (text, or base64); what a build bundles |

Every write appends its event to `eventList` before the object file is rewritten, so the record and the state are written together.

`plugin/doc-asset-server.ts` adds one connect middleware to the development server under `docAssetEndpoint` (`/__doc-asset` under the configured `base`); every response is `{ code, data, message }`, codes as above, and the http status follows the code. Every object route names its store (`store=local`; another id is -3), so the routes are the same once a second store exists. `GET /status` answers `{ isWritable, storeIdList, folderList }`; `GET /object/list` the index of a store; `GET /object/get?store=&objectId=|name=&versionId=` answers `{ object, version }` in one round trip, the object found by id or by name, the version with its text when it is text; `GET /object/data` serves the bytes of a version with their `contentType`, for images, downloads, and anything else the page cannot hold as text; `GET /dependency/list` and `GET /dependent/list` answer the two directions of [Dependencies](#dependencies). The writes are `POST` routes with the method's arguments as a json body (the locks: `/object/lock/set { isLocked }`, `/version/lock/set { versionId, isLocked }`; the dependencies: `/dependency/set`, `/dependency/add`, `/dependency/remove`; the metadata of a version: `/version/metadata/set { versionId, versionMetadata }`), the data as `text` or `dataBase64`, and answer `{ object }`, `{ object, version }`, or for a create `{ object, version, isCreated }`. The store is re-created from the folders on every request (the files are the truth, and the api never caches them), so a file changed by an editor is seen by the next request. A change in a folder is pushed to the page as the custom HMR event `doc-asset-change { objectId }`, a change of `asset.yaml` as `doc-asset-change { isStoreChanged: true }`; the virtual module exposes both as `subscribeDocAsset`.

`lib/doc-asset-backend.js` holds the two page-side backends with one interface: `assetBackendApiCreate(endpoint)` is the fetch client of the api, `assetBackendSnapshotCreate(snapshot)` answers the reads from the bundled snapshot (binary versions become `data:` urls) and refuses every write with code -1. `DocAssetStore` is written against this interface and does not know which one it holds, which is where the backend of a remote store would plug in.

## The reference in a document

A component block whose fenced block is written in the language `asset` holds a reference, not data. The content is yaml and names the store, the object (by name, or by id) and, optionally, a version; it is parsed with the yaml parser like any component yaml (`lib/doc-asset-ref.js`, `assetRefParse`):

````markdown
<!--renderComp=Image-->
```asset
store: local
name: hero image        # or:  objectId: w4okcncucnu
versionId: head
```
````

`store` is required, and exactly one of `name` and `objectId`; `versionId` is a version id or `head` and defaults to `head`. A reference says where its object is and which one it is, and nothing else: the page resolves it or reports it, and never creates an object for a reference that resolves to nothing, so no logic exists for "the object this reference would mean if it existed" (declaring an object by name is a create, [Names](#names), not a reference). A reference reading `head` follows the object: moving the head changes what every such reference shows, in every document. A reference with a version id is pinned. The marker keeps its own props; only the data block is replaced by the reference, so `<!--renderComp=StockTable,title=…-->` keeps its title. `assetRefTextBuild` writes a reference by name when it is given one, else by id; the page's own references (a block moved into the store) are by id.

Under a plain Markdown renderer the reference degrades to a small yaml code block, as the inline form degrades to its data block ([Graceful degradation](doc_page_impl.md#graceful-degradation-stipulation)): the document stays readable and says which object it meant.

The language `asset` is reserved for references: an object whose own `lang` is `asset` is refused by the store, and the page refuses to render one, so a reference can never resolve to another reference.

## Resolution: the runtime boundary

`RegisteredComp` is the one boundary every registry component is rendered through, and the component data reference (`dataRef`) already shows the pattern for data that comes from elsewhere: the boundary detects it, a host resolves it, and the render component receives ordinary `data`. The asset reference follows it one step earlier, before normalization, because what it replaces is the authored text itself:

1. `RegisteredComp` with placement `commentBlock` and `input.lang === 'asset'` renders `CompAssetHost` (`comp-doc/asset/`) with its own props instead of normalizing the input.
2. `CompAssetHost` parses the reference, asks `DocAssetStore` to load it (`refLoad`), and reads what it resolves to (`refQuery`: loading, error, or the object, the version id, and the version's data).
3. Once resolved to a text version, it renders `RegisteredComp` again with the same props and `input = { ...input, raw: text, lang: object.lang }`. From there everything is as for an inline block: the definition's input converter, `data` and `config`, `dataRef`, the event layer, the modes the component exposes. A component is not told about the asset unless it asks to be ([component awareness](#component-awareness)), and no component is changed for the store. A version that is not text is an error of the reference, shown by the frame.

The host is the only code that knows both sides; a new component works with the store on the day it is registered. A component that an asset-backed component references through `dataRef` receives the reference text, not the asset text: `dataRef` reads the authored block of the other component (`CompDataRefHost`), and the asset is resolved per rendered instance. Keeping an asset-backed block as a `dataRef` source is therefore not supported; the data belongs in the store once, and both documents reference the store.

### Component awareness

Not knowing where the data came from is the right default, and the wrong answer for a component that writes its data back. An Image that receives a pasted image must put the new `src` somewhere: into the lines of the document when the data is inline, into the head of the object when the data is an asset; and it should say which it is about to do. So a component may opt in. A definition registered with `isAssetAware: true` (`compDefine`) receives `config.assetInfo` on every render:

```text
assetInfo
  isFromAsset: false                         inline data (and the value in every other placement)
  isFromAsset: true,                         data of an asset version, set by CompAssetHost:
    store, objectId, name,                     the object
    versionId, versionIdHead, isHead,          the version read, and whether it is the head
    saveMode, isLocked                         what a write to it would do, and whether it is allowed
    versionMetadata                            the metadata of the version read (#version-metadata), {} without
```

The same information travels with the component's events as `source.asset`, so a store handling an event knows whether the block it concerns is a reference. A component that is not aware receives no `assetInfo` key and nothing changes for it.

What the component does with the knowledge is one request, not a write of its own: it emits `dataReplaceRequest { raw }` with the complete new data text ([events of the edit layer](doc_page_impl_event.md)), and `DocEditStore.dataReplaceApply` decides by the block the component is rendered in (`config.blockIndex`, which the edit body gives every block through `DocEditBlockContext`): a reference block updates the object's head (`objectUpdate`, by its save mode, with the dependencies derived from the new data), an inline block is rewritten with the new data as its fenced content (`componentBlockTextBuild`, one block-replace operation). The component thus edits its data the same way in both cases and never calls the store or the edit api; `assetInfo` only lets it tell the author what will happen (`Image` writes "replaces the head of asset …" into its confirmation). The dependencies of an asset version come from the same definition: `assetDependencyListGet(data)` returns the paths the data names ([Dependencies](#dependencies)), the page resolves them against the document, and every write of the data (moving a block into the store, a data replacement) carries the list.

### Loading at page start

`DocAssetStore` (`store/DocAssetStore.ts`) sits beside the reading stores, like `DocEditStore`, and never writes to them. When the page initializes it loads the store systematically rather than reference by reference:

```text
init()
  -> GET /status          isWritable, the store ids, the folders of the local store
  -> GET /object/list     the index: the metadata of every object (no data)
  -> references resolve against the index
       by name        -> the id of the object of that name in the index (objectIdGetByName)
       known object   -> GET /object/get for the one version it reads (data loaded on demand, once)
       unknown object -> one GET /object/get to confirm it is missing (it may have appeared meanwhile)
       unknown name   -> one GET /object/get?name= the same way; a miss is remembered until the index is read again
  -> subscribeDocAsset
       { objectId }             -> that object is read again (its file events coalesced into one reload)
       { isStoreChanged: true } -> status and index again: the folders changed
```

So a reference reading `head` knows its version id as soon as the index is in, a reference by name resolves without a request of its own, every frame of a document resolves with one index request plus one request per distinct version, and a reference to an object that does not exist costs one request instead of a retry loop. The state the store holds:

- `backend`, `isAvailable`, `isWritable`, `statusMessage`: the api backend when `config.asset.endpoint` is set, else the snapshot backend when `data.assetSnapshot` is set, else none (`backendKind`: `api`, `snapshot`, `none`); `isWritable` comes from `GET /status` and is false for a snapshot; `statusMessage` is the backend's message when `GET /status` failed. Why the store cannot be read or written is told apart, never reduced to "not writable": `unavailableReason` (no store: no `asset.file`, or a server started before it was added; the status request failed, with the backend's message) and `writeUnavailableReason` (those, or a built page's read-only snapshot, or a store still loading). Every refusal of a write, here and in the edit layer (an asset-only block's edit modes, creating an asset-only block, moving data into the store), and the settings tab use these texts.
- `storeIdList`, `folderList`: from `GET /status`; `index`: the state of the index load.
- `objectById`: the metadata of every object, keyed by store and object id, with its loading or error state; `versionByKey`: the data of every version read so far (`isText`, `text`, `size`, `hash`), keyed by store, object id and version id. A reference reading `head` resolves through `objectById[…].versionIdHead`, so a checkout changes what every frame shows with one object update. `nameLookupByKey`: the names looked up that the index did not have, loading or missing; it is emptied when the index is read again, and an entry is dropped when an object of that name arrives, so a reference by name recovers as soon as the object exists.
- `refObjectIdGet(ref)` is the id a reference means (its own, or its name's); `refLoad(ref)` reads what `refQuery(ref)` is missing and nothing else; `dataUrlGet(store, objectId, versionId)` is the url of a version's bytes.
- Every write goes through `writeApply`: the backend answers, the returned object (and version) replace the loaded ones, the caller gets `{ code, data, message }`; a conflict (code -2) gets the standard message and reloads the object. `objectUpdate` sends the hash of the loaded head as `hashBase` and the mode the caller chose, or none, so the object's save mode applies; `objectCreate` and `objectUpdate` take the `dependencyList` of the data and the `versionMetadata` of the version written, and `objectCreate` a `saveMode`. `dependencyListGet` reads a loaded version's list from the metadata, `dependentListGet` asks the backend, and `dependencyListSet` / `dependencyAdd` / `dependencyRemove` / `versionMetadataSet` are writes like the others. A loaded version keeps its `metadata` beside its text.
- `folderAdd`, `folderRemove`, `folderDefaultSet`: the folder list of the local store rewritten through `POST /folder/set`, then the index read again, since the set of objects changed with it; `folder` holds the pending state and message of the settings tab.
- `panel`: the one open asset panel, see below.

## The frame and the panel

A component whose data comes from the store renders exactly as it would with the data written inline: nothing in the document flow says that the block is an asset, so reading mode looks the same whether a component's data is inline or in the store. `AssetFrame` stands in for the component only while it has no text: a short line with the component name, the store and object id, and a spinner while the version is read, or the error of a reference that cannot be resolved (or resolves to bytes that are not text) with the reference text, as a component error would be shown.

The panel is reached from the edit layer: the toolbar that floats over a block in edit mode ([floating controls](doc_page_impl_edit.md#floating-controls)) carries an `asset` button for a block whose fence language is `asset`, next to the Edit button, and the button opens the panel of the referenced object (`panelOpen(store, objectId, versionIdRef, block)`; a reference by name is resolved through the index first, and the button waits while it is not). The toolbar reads the reference from the block model, so the component has no asset button of its own and knows nothing of the store. The `block` it passes (component name, marker props, document path) is what the panel's preview renders with.

The **asset panel** (`AssetPanel`, in the host's text panel component through `AssetPanelPopup`, the way the tag overview is framed) is the whole user interface of the store, provided once by the store and the same for every component. It is a large popup, since it shows a history and a text side by side with the document, and has three sections:

- the object: store and id, name (edited in its field, `EditValueInline`; a taken name is refused by the store and the message shown), language and file extension, content type, the folder and the object's folder in it, head, creation time, the **events** (their count and the last one, `show all` unfolding the list as a small table: time, event, version), and the **save mode** as a pair of radio buttons (`update in place` / `new version`) with a note whether the mode is written in the object or the unwritten default applies, and `clear` to remove a written mode; `Delete object` / `Restore object`;
- the versions, newest first, in one table so that the values of a column line up across the rows (a grid per row would not), every row the same height whether selected or not: id, a `head` badge and a `read here` badge on the version the block that opened the panel reads, time, size, note, predecessors; the note and the predecessors take the room left and are cut with an ellipsis. A click selects a version; a click on the selected version unselects it. A lock column marks locked versions. The actions of the selected version, `Set as head`, `Lock version` / `Unlock version`, and `Delete version` (never the head, never a locked version), are a row below the table, so selecting never changes the height of a row;
- the data of the selected version: a text version is shown in a `<pre>`, and for the head a click on the text (or `Edit head`) turns that same element editable in its place (`contentEditable` switched on, never a replacement element), uncontrolled while typing, with the caret at the clicked position ([where the caret goes](doc_page_impl_edit.md#where-the-caret-goes)). The element keeps one box in both states, the same padding, type, minimum and maximum height, and the title row keeps its form (`data of … (head)`, with `, editing` appended), so nothing moves when editing starts: the [no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule) of the edit layer, which is why the element does not take the edit layer's `doc-edit-surface` class, whose source-kind rules would change its padding. Both saves are offered side by side, `Save in place` and `Save as new version`, and the one the object's save mode names is the primary button. A pointer going down outside the text and its buttons leaves editing (`useEditOutsidePointer`, as on the page): an unchanged draft just closes, a changed one is saved, by the object's save mode, or as a new version when the head is locked (`panelSaveModeOnLeave`); Escape still cancels. With a locked head, `Save in place` is greyed out with the reason. When the head is not text, `Edit head` is greyed out and the reason stands beside it (the type and size, and that a file can be uploaded instead): a disabled control says why. A version that is not text shows its type, size, and hash, a preview when the type is an image, and a download link. Below the data of any version stand its dependencies ([Dependencies](#dependencies)), each as the source path or the object and version it names, or `none`, and its metadata ([Version metadata](#version-metadata)) as one line of json, or `none`. `Upload file as head` writes the bytes of a chosen file as the head data, in place or as a new version by the save mode, which is how an object becomes an image or any other file.

The header of the popup carries, left of the close button, a side-panel button (lucide `PanelRightOpen`, becoming `PanelRightClose` while open; not the maximize pair `Expand` / `Shrink`) that opens the **preview pane** (`AssetPreview`) at the right of the panel, and the popup widens for it. The pane renders what the block the panel was opened from would render with the data as it is in the panel now: while the head text is edited, the draft, on every keystroke, so it shows what a save would render as before anything is saved; otherwise the selected version. It renders through the same runtime boundary as the document (`RegisteredComp`, placement `commentBlock`, the block's component name and marker props, the data in place of the reference), so the component sees exactly what it would see in the document. A version that is not text is shown as an image when it is one and described otherwise, and a panel not opened from a block has no renderer and says so. Whether the pane is open is remembered from one panel to the next (`isPanelPreviewOpenLast`).

The object section also carries `Lock object` / `Unlock object`; while the object is locked the panel says so and greys out every change, each with its reason. Deletions ask for confirmation in the panel itself, never through a browser dialog, and the question opens in the row of the button that asked, right after it (`Delete the object …? [Delete] [Cancel]`, its failure beside it), so nothing below moves. With a read-only backend the panel shows and does not offer the actions; every pending state and every message is `panel` state in the store (`block`, `isPreviewOpen`, `isEventListOpen`, `edit`, `upload`, `confirm`, `status`, `message`; `panelPreviewData` is what the pane renders), and the panel renders that state.

## Moving inline data into the store

The toolbar of a component block whose data is written inline in a fenced block carries a `to asset` button (where the `asset` button is for a reference block). It is the one way the page creates an object from a document, and it uses the default folder: the block's data becomes a new object of the local store with the block's language, no name (a name would make the second block of the same component resolve to the first one's object, [Names](#names); the component name goes into the note), and the block is rewritten as the reference to it by id (`componentBlockTextBuild` with the reference as `raw` and `asset` as the fence language); the dependencies of the data, derived from the component's definition ([Dependencies](#dependencies)), are recorded with the first version, and the object gets the save mode the component declares (`meta.assetSaveMode`), if it declares one.

The button asks first, in the toolbar, like a deletion (`Move the data of this block into the asset store? [Move] [Keep]`, `blockAssetMoveConfirmSet`, state `blockAssetMove.status === 'confirming'`): a move creates a file set on disk and rewrites the document, and a click on the wrong block should cost nothing. **Move** reports the request, an event of the edit domain, `editBlockAssetMoveRequest`, like moving a block ([events of the edit layer](doc_page_impl_event.md)); **Keep**, a pointer going down elsewhere, or any other edit action drops the question. `DocEditStore.blockAssetMoveApply` creates the object first and rewrites the block **last**: the rewrite of the document is the step that makes the move happen, and the move has succeeded only when it is written. A failed object creation changes nothing; a failed document write leaves the block as it was, still working with its inline data, and the object in the store, with a message saying which object holds the copy. The same order holds for a block of an asset-only component created from the insert menu ([Asset-only components](doc_page_impl_edit.md#asset-only-components)), which deletes its object again (softly) when the document write fails.

## Build

A build has no development server, so the plugin does two things at build time with the store of `asset.file`:

- its own scans of document text see the data, not the reference: `assetBlockTextExpand` replaces every `asset` block whose version is text with the data block of that version (`{lang}` fence, the text) before the attachment finder collects image references ([build-only attachment collection](doc_page_impl.md#build-only-component-attachment-collection)) and before source pruning follows component dependencies ([source pruning](doc_page_impl.md#source-pruning-for-deployment)). The documents themselves are not rewritten; the page resolves at run time as in development.
- the source files the versions of the live objects depend on (`dependencySourcePathList()`) are kept by source pruning and bundled into `fileUrlByPath` like a file a document names ([collection for a build](doc_page_impl_source.md#files-in-a-build)), so an Image asset whose image sits in a `referenced` folder still shows in the built page.
- the virtual module exports `assetSnapshot`, `snapshotBuild()` of the store: every object that is not deleted with the data of all its versions, text as text and other bytes as base64. The host passes it as `data.assetSnapshot`; `DocAssetStore` reads it through the snapshot backend, so a built page shows every asset-backed component, read-only; the panel needs edit mode and is not reached in a build. `docAssetEndpoint` is `''` in a build and `subscribeDocAsset` does nothing, as for the edit layer ([availability](doc_page_impl_edit.md#availability-and-mode)).

In development the page reads file bytes through the source api, so a data change that names a new image through the panel shows at once.

## Edit mode

In edit mode an asset-backed component block is edited as source, whatever its component declares: the block is the reference, and `DocEditBlockEditor` gives it `BlockSource` with the label `Xxx (asset)`. Changing the `versionId` there pins or unpins the block; replacing the fence language and writing the data inline takes the block out of the store. The data itself belongs to the object and is changed through the panel, opened with the toolbar's `asset` button, which saves by the object's save mode; the component re-renders from the store, and no document is written for it. The component's own edit modes (`expose.editModeList`) are listed in the block's mode menu but greyed out, with this reason, and only the built-in `source` mode can be chosen, because the component's editor would edit a draft the edit layer cannot write anywhere: its result is not lines of this document. A component that is asset-aware may still change its data from reading edit mode through `dataReplaceRequest` ([component awareness](#component-awareness)), which the edit store writes to the object; that is how an image is pasted onto an asset-backed `Image` without the panel.

A component declared **asset-only** ([Asset-only and not-in-doc](doc_page_impl_mdx_comp.md#asset-only-and-not-in-doc)) is the exception: its data is never in the document, so its own edit modes are offered on a reference block reading the head of a writable object, and its editor's draft (the data and the version metadata) is saved into the object by the object's save mode when the session ends ([Asset-only components](doc_page_impl_edit.md#asset-only-components)). The document is not written by such a session. `ExcelUniver` is one.

The compile-time readers of component data (`languageListGetByComponent`, `structuredDataGetByComponent` in `compileDoc`) do not run on a reference block; with the data in the store they would read the reference as data. The search index and the language selector therefore do not see asset-backed content.

## Files

```text
frontend/plugin/id-ms48.ts                 ms_48 ids: create, time of, validity
frontend/plugin/doc-asset-store.ts         the file store: the asset section of config.yaml (checked, with the
                                           migration of asset.folder), config file and folders, objects (id, name, folder
                                           name), versions, head, bytes and text, version metadata, save
                                           modes, events, backups, snapshot
frontend/plugin/doc-asset-server.ts        the dev-server middleware
frontend/plugin/doc-source.ts              asset.file, docAssetEndpoint / assetSnapshot / subscribeDocAsset
                                           exports, reference expansion for the scans, change events
frontend/plugin/doc-asset-config.test.js   the asset section and what the server then exports and answers;
                                           the reasons the page gives for a store it cannot write
frontend/src/lib/doc-asset-ref.js          the reference: language, parse (by id or name), build, expansion
                                           in a document text
frontend/src/lib/doc-asset-backend.js      api backend, snapshot backend (one interface)
frontend/src/store/DocAssetStore.ts        backend, status and index, why the store cannot be read or written, objects and versions, names,
                                           refLoad / refQuery, writes, dependencies, folders, the panel and its preview
frontend/src/store/DocEditStore.ts         blockAssetMoveConfirmSet / blockAssetMoveApply (with dependencies),
                                           dataReplaceApply, blockDependencyListGet, blockCreateAsAsset and
                                           the asset drafts of asset-only components
frontend/src/DocPageMdx.jsx                config.asset, data.assetSnapshot, AssetPanelPopup
comp-doc/registry/RegisteredComp.jsx       the asset branch of the runtime boundary; config.assetInfo for
                                           an isAssetAware component
comp-doc/registry/comp-registry.js         compDefine: isAssetAware, assetDependencyListGet
comp-doc/asset/                            CompAssetHost, AssetFrame, AssetPanel, AssetPreview, AssetPanelPopup,
                                           DocAsset.css
comp-doc/settings/AssetStoreSettings.jsx   the "Asset store" tab of the settings panel: the folders
comp-doc/edit/DocEditBlockToolbar.jsx      the asset button of a reference block, the to-asset button of an inline block
comp-doc/edit/DocEditBlockEditor.jsx       asset-backed blocks are edited as source (except asset-only components)
comp-mdx/excel-univer/                     ExcelUniver: an asset-only component using version metadata
example_doc/asset.yaml                     the store config of the demonstration store
example_doc/asset/, asset-archive/         the folders of the demonstration store
example_doc/asset-store.md                 demonstration document (dependencies, version metadata, what a component knows)
example_doc/mdx-usage/comp-excel-univer.md demonstration of an asset-only component (object w4r63zmeaor)
example_doc/asset-file/image/              the folder pasted images are created in (referenced source folder)
```
