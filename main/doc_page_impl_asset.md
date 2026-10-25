<!-- Design of the asset service layer. Parent document: doc_page_impl.md. This is the design document of the asset service layer; other documents link here. -->

# Asset Service Layer: Design

A component written in the degradation-compatible form, a comment marker and a code block, carries its data in the document. The **asset service layer** lets the data live outside of it: versioned **objects** in a **store**, and in the document a short **reference** in place of the data. The page resolves the reference before the component renders, so the component receives exactly the input it would receive with the data written inline and never learns where the data came from. The layer is a general storage of versioned bytes with a standard api, modeled after an object storage; the document page is its first client. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md); the reference form is the component form of [MDX components](doc_page_impl_mdx_comp.md), and edit mode handles the reference as described in [In-place Editing](doc_page_impl_edit.md#component-edit-mode).

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
                                     AssetPanelPopup ◄── panel (AssetPanelModel) ┘
                                       versions, head, data, events, save mode, upload,
                                       the blocks using the object (usage index ◄── GET {endpoint}/usage/list)
                                       └─ AssetPreview: the block rendered with the data as it is now
                                     settings panel, tab "Asset service": the folders by doc page; orphans,
                                       unreferenced objects, broken references, the panel of one

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
- `component`: `{ name }`, the component the object is data for, when it is a component's data; absent otherwise. See [Objects for components](#objects-for-components).
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

The list belongs to the **version**, not the object, because it is the data that depends, and every version has its own data; `versionList` carries it beside the size and the hash. The store keeps the list and answers questions about it, but does not derive it: the bytes mean nothing to the store, and only the page knows that the yaml is for `Image` and which key names a file. The list is therefore declared by whoever writes the data, through `dependencyList` of `objectCreate` and `objectUpdate`, and the page derives it from the component the data is for: a registered component declares `assetDependencyListGet(data)` ([component awareness](doc_page_impl_mdx_comp.md#component-awareness)), the page resolves the paths it returns against the document (a relative `./hero.png` becomes a source path), and passes the list with the write. Creating an Image object whose image is a source file thus records the dependency without anyone asking for it. A write that names no list keeps the list of the version it writes over or is made from, so a version made in the panel from the same data keeps its dependencies; `dependencyListSet`, `dependencyAdd`, `dependencyRemove` change the list of one version on its own. The other direction, the versions that depend on an object (`dependentListGet(objectId)`) or on one of its versions (`dependentListGet(objectId, versionId)`; a dependency without `versionId` means the head and counts when the head is that version), is the base of a deletion that knows what it breaks, and is read from the backend because it needs every object. A build collects every source file the live versions depend on ([Build](#build)); the panel shows the dependencies of the selected version under its data.

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

Metadata must be a yaml mapping (`versionMetadataNormalize`; anything else is -1). It reaches the page with the version (`version.metadata` of `GET /object/get`, `metadata` in the snapshot), an asset-aware component as `config.assetInfo.versionMetadata` ([component awareness](doc_page_impl_mdx_comp.md#component-awareness)), and the panel shows it under the dependencies of the selected version.

### Objects for components

An object that is a component's data says so in its metadata: `component: { name }`, the tag name of the block it was made for (`componentNormalize`: a mapping with a non-empty `name`, or absent). The page writes it when it creates an object for a block (moving inline data into the store, an asset-only block from the insert menu); `objectCreate` and `objectMetaSet` take it like the name (`component: null` removes it, a `metaSet` event), and the panel edits it in the object section. The store keeps it and never checks a reference against it: a block of any component may read any object. Its use is recovery: an object that declares a component and that no block references is an **orphan** ([Usage](#usage)), the data of a block removed without it, while an object that declares nothing may be data of another purpose. Why the page records this and not more (an owner block, a sharing policy) is in [Components and the asset service layer](doc_page_impl_mdx_comp.md#components-and-the-asset-service-layer).

## The local store: folders, fully reflected

The local store is one store with one id, but on disk it is one or more **folders**, and the folders are the store: every object, version, and piece of metadata is a file in one of them, readable without the page, and the page holds nothing the folders do not. Copying a folder copies its objects; a git checkout of a folder changes the store.

```text
.doc-page/asset.yaml          the asset store config of one doc page: folderList [~root/path], folderDefault
{folder}/
└── {objectId}--{name}/       one folder per object: its id, the separator, its name
    │                         ({objectId} alone for an object without a name)
    ├── object.yaml           the object: objectId, name, lang, contentType, fileExt, component and saveMode (when set),
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

Which folders make up the store, and which one is the **default folder**, is declared by the doc pages the page loads ([below](#which-folders-a-doc-page-declares)). Objects are created in a default folder; the other folders are read like it. An object is its folder, named `{objectId}--{name}` so that a person browsing the disk sees what each folder is (`w4okcncucnu--hero image`) while the store still works by id: the separator `--` is a string an id can never hold (ids are base36) and a name is refused when it holds it, so the id of a folder is what stands before the first `--`, and the folder needs no file read to be identified. The separator is valid in a folder name on every major operating system, and so is the name by the rules above. Finding object `w4okcncucnu` is finding the folder whose id part is that in each store folder, and listing the store is listing those folders; there is no index file to keep in sync. Renaming an object renames its folder. The first folder of the list wins when two folders hold the same id, which is a mistake the page cannot repair and reports by showing the first. Where the object was found (`folder`, `dirName`) travels with its metadata to the page and is not written into `object.yaml`.

### Which folders a doc page declares

The folders belong to doc pages, not to the package: a doc page carries its asset objects with it, like its documents, so including a doc page in another, or deploying it alone, brings its objects along. Every doc page the page loads, its own and every one it includes (by entry file or by folder, [including](doc_page_impl_side_panel.md#including-other-side-panels)), has an **asset store config**, and the store is all of them:

```text
where the config is      "asset: { file }" of the doc page's entry, relative to the entry;
                         absent: asset.yaml beside the entry (.doc-page/asset.yaml, the convention);
                         "asset: false": the doc page has no asset folders
the config file          folderList   the folders, as source paths: ~root/path, a root of this doc page;
                                      ~page:root/path, a root of another doc page of the workspace
                         folderDefault one of them: where objects of this doc page's documents are created
                                       (the first folder when absent)
no config file           the default folders, ASSET_FOLDER_DEFAULT_LIST relative to the doc page folder
                         (asset/), named by the doc page's root that holds that folder
the store                the folders of every doc page, the page's own first, then the included ones
                         in loading order; a folder named twice belongs to the first doc page
default folder           of the store: the page's own doc page's; of a new object: the default folder of
                         the doc page whose roots hold the document it is created from (docPath)
```

```yaml
# my-doc/.doc-page/asset.yaml
folderList:
  - ~my-doc/asset
  - ~my-doc/asset-archive
folderDefault: ~my-doc/asset
```

**A folder is always named by a source path**, relative to a root of the page's source rules (`~root/path`, [source paths](doc_page_impl_source.md#source-paths)), never by a path relative to the config file: a doc page may declare several roots, and a source path says which one a folder is in, means the same in every file of every doc page, and survives moving or renaming the folder. In the file the local form names a root of the doc page itself, the full form `~page:root/path` a root of another doc page; the store keeps every folder in the full form (`AssetFolder.path`), which is also what the page, the panel and object metadata use, and writes a doc page's own roots back in the local form. A path that is not a source path, names a root no source rule declares, or names a whole root is left out of the store and reported in the console and in the settings tab (`problemList` of the doc page); the rest of the config is read. The former form `[{ path, isDefault }]` is still read for its paths and default. A folder that does not exist yet is an empty folder of the store and is created when the first object is written to it, so a doc page without any asset needs nothing on disk; reading never creates anything. The asset folders and the config files are never documents, wherever they lie ([source scan](doc_page_impl_source.md#source-rules-and-collection)).

`config.yaml` does not name a store any more: its former `asset` section stops the server with the doc page form. The asset api is installed when the development server starts, for a page with at least one doc page that has not declared `asset: false`; the folders themselves are read again for every request, so a config file changed on disk, by the page or an editor, takes effect at once and is reported to the page as a store change (`doc-asset-change`, `isStoreChanged`). A config file that does not parse stops the read with a message naming it; while the server runs, the last valid store is kept.

The folders are changed from the page: the **Asset service** tab of the settings panel ([config: the settings panel](doc_page_impl_config.md#settings-panel)) is built from items of the settings panel's config panel, like the other tabs (`assetStoreItemListBuild` of `AssetStoreSettings.jsx`): one group per doc page, titled by its folder with a "this page" or "included" badge and described by the file its folders are written in, holding its folders as a string list item (an entry edited in place, removed with its Remove button, or added in the last row), its default folder as a select item, and an "On disk" item listing each folder with its object count, a folder missing on disk marked. A change goes through the panel's own write path, and the item that sent it shows the panel's request state (pending, then an error that can be dismissed). A path typed there, in either form (a local path is a root of that doc page), gets a warning while it is typed when it is not a source path of a known root, or names a folder that does not exist yet (`DocAssetStore.folderPathWarningGet`); the warning has a place of its own, so it never moves the field. On the development server a change is sent for that doc page only (`POST /folder/set { configFile, folderList, folderDefault }`): the server checks every path against the roots, writes the two values into the doc page's config file in place ([YAML utilities](doc_page_impl_yaml_utils.md): an entry that stays keeps its comments), keeps the previous file as `.bak`, creates the file when the doc page had none, and creates the folders on disk. A removed folder's files stay; its objects just leave the store. The store config has its own file rather than a line in `config.yaml` because a change of `config.yaml` reloads the whole page, and adding a folder should not.

### The store api

The file store (`plugin/doc-asset-store.ts`, `assetStoreCreate(config)`) is the api; the development server exposes it over http, and the page talks to it through a backend with the same method set. Every failure is an `AssetError` with a code: -1 bad request, -2 the data changed since it was read, -3 not found.

| method                                                     | effect                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `folderInfoList()` / `docPageInfoList()`                   | the folders with their state and doc page; the doc pages with their config |
| `folderSet({ configFile, folderList, folderDefault }, rootAbsPathById)` | the folders of one doc page written into its config file, in place |
| `objectList()`                                             | metadata of every object of every folder, deleted ones included            |
| `objectGet(objectId)` / `objectGetByName(name)` / `objectFind({ objectId, name })` | metadata of one object, by id, by name, or by whichever the key has |
| `versionDataGet(objectId, versionId = 'head')` / `versionDataGetOf(meta, versionId)` | `{ versionId, bytes, size, hash, isText, text?, metadata }` of one version |
| `objectCreate({ name, lang, contentType, fileExt, component, saveMode, data, note, folder, docPath, dependencyList, versionMetadata })` | a new object with its first version, in the folder named, else the default folder of the doc page of `docPath`, else the store's, with its component and save mode when given; `{ object, version, isCreated }`, the existing object and `isCreated: false` when the name is taken |
| `objectUpdate({ objectId, hashBase, data, mode, note, dependencyList, versionMetadata })` | the head data; `mode` `inPlace` or `newVersion`, the object's save mode when absent; `dependencyList` and `versionMetadata` absent keep those of the version written over or made from |
| `versionMetadataSet(objectId, versionId, metadata)`        | the metadata of one version replaced ([Version metadata](#version-metadata)); `{ object, version }` |
| `dependencyListGet(objectId, versionId = 'head')` / `dependencyListSet(objectId, versionId, list)` / `dependencyAdd(…, dependency)` / `dependencyRemove(…, dependency)` | the dependencies of one version ([Dependencies](#dependencies)) |
| `dependentListGet(objectId, versionId = '')`              | the versions of the store depending on the object, or on one version of it: `[{ objectId, versionId, dependency }]` |
| `dependencySourcePathList()`                               | the source files the versions of the live objects depend on, each once; what a build collects |
| `objectMetaSet(objectId, { name, lang, contentType, component, saveMode })` | the metadata a person chooses (`component: null`, `saveMode: null` remove the key; a new name renames the folder and must be free) |
| `versionCheckout(objectId, versionId)`                     | moves the head                                                             |
| `versionDelete(objectId, versionId)`                       | removes a version that is not the head; its children are relinked          |
| `objectDelete(objectId)` / `objectRestore(objectId)`       | the deletion mark                                                          |
| `objectLockSet(objectId, isLocked)` / `versionLockSet(objectId, versionId, isLocked)` | the object lock, the lock of one version ([Locks](#locks)) |
| `referenceTextGet({ objectId | name, versionId })`         | `{ lang, text }` of a reference to a text version, or nothing; what the plugin expands with |
| `snapshotBuild()`                                          | every object that is not deleted, with the data of all its versions (text, or base64); what a build bundles |

Every write appends its event to `eventList` before the object file is rewritten, so the record and the state are written together.

`plugin/doc-asset-server.ts` adds one connect middleware to the development server under `docAssetEndpoint` (`/__doc-asset` under the configured `base`); every response is `{ code, data, message }`, codes as above, and the http status follows the code. Every object route names its store (`store=local`; another id is -3), so the routes are the same once a second store exists. `GET /status` answers `{ isWritable, storeIdList, folderList }`; `GET /object/list` the index of a store; `GET /object/get?store=&objectId=|name=&versionId=` answers `{ object, version }` in one round trip, the object found by id or by name, the version with its text when it is text; `GET /object/data` serves the bytes of a version with their `contentType`, for images, downloads, and anything else the page cannot hold as text; `GET /dependency/list` and `GET /dependent/list` answer the two directions of [Dependencies](#dependencies); `GET /usage/list?docPath=…` answers the asset references of the documents named, or of every document without a `docPath` (`{ docList }`, [Usage](#usage)): a question about the documents, which the plugin scans from disk, not about the store. The writes are `POST` routes with the method's arguments as a json body (the locks: `/object/lock/set { isLocked }`, `/version/lock/set { versionId, isLocked }`; the dependencies: `/dependency/set`, `/dependency/add`, `/dependency/remove`; the metadata of a version: `/version/metadata/set { versionId, versionMetadata }`), the data as `text` or `dataBase64`, and answer `{ object }`, `{ object, version }`, or for a create `{ object, version, isCreated }`. The store is re-created from the folders on every request (the files are the truth, and the api never caches them), so a file changed by an editor is seen by the next request. A change in a folder is pushed to the page as the custom HMR event `doc-asset-change { objectId }`, a change of `asset.yaml` as `doc-asset-change { isStoreChanged: true }`; the virtual module exposes both as `subscribeDocAsset`.

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
3. Once resolved to a text version, it renders `RegisteredComp` again with the same props and `input = { ...input, raw: text, lang: object.lang }`. From there everything is as for an inline block: the definition's input converter, `data` and `config`, `dataRef`, the event layer, the modes the component exposes. A component is not told about the asset unless it asks to be ([component awareness](doc_page_impl_mdx_comp.md#component-awareness)), and no component is changed for the store. A version that is not text is an error of the reference, shown by the frame.

The host is the only code that knows both sides; a new component works with the store on the day it is registered. A component that an asset-backed component references through `dataRef` receives the reference text, not the asset text: `dataRef` reads the authored block of the other component (`CompDataRefHost`), and the asset is resolved per rendered instance. Keeping an asset-backed block as a `dataRef` source is therefore not supported; the data belongs in the store once, and both documents reference the store.

What a component may learn about its data and do with it (`isAssetAware` and `config.assetInfo`, `dataReplaceRequest`, `assetRefreshRequest`, `assetDependencyListGet`), and how the page keeps a block and its object together, is the component's side of the store and is described with the components: [Components and the asset service layer](doc_page_impl_mdx_comp.md#components-and-the-asset-service-layer).

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
  -> GET /usage/list      the usage index: the asset references of every document (#usage)
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
- `usageIndex`, `usageByDocPath`, `isUsageReading`: the usage index and its state ([Usage](#usage)).
- `panel`, `settingsPanel`: the asset panel of the popup and the one of the settings tab, each an `AssetPanelModel` ([The frame and the panel](#the-frame-and-the-panel)).

## The frame and the panel

A component whose data comes from the store renders exactly as it would with the data written inline: nothing in the document flow says that the block is an asset, so reading mode looks the same whether a component's data is inline or in the store. `AssetFrame` stands in for the component only while it has no text: a short line with the component name, the store and object id, and a spinner while the version is read, or the error of a reference that cannot be resolved (or resolves to bytes that are not text) with the reference text, as a component error would be shown.

The panel is reached from the edit layer: the toolbar that floats over a block in edit mode ([floating controls](doc_page_impl_edit.md#floating-controls)) carries an `asset` button for a block whose fence language is `asset`, next to the Edit button, and the button opens the panel of the referenced object (`panelOpen(store, objectId, versionIdRef, block)`; a reference by name is resolved through the index first, and the button waits while it is not). The toolbar reads the reference from the block model, so the component has no asset button of its own and knows nothing of the store. The `block` it passes (component name, marker props, document path, marker line) is what the panel's preview renders with, and which use of the object the panel was opened from.

The **asset panel** (`AssetPanel`, in the host's text panel component through `AssetPanelPopup`, the way the tag overview is framed) is the whole user interface of the store, provided once by the store and the same for every component. It is a large popup, since it shows a history and a text side by side with the document, and has four sections:

- the object: store and id, name (edited in its field, `EditValueInline`; a taken name is refused by the store and the message shown), the component it is for ([Objects for components](#objects-for-components), edited the same way; empty removes it), language and file extension, content type, the folder and the object's folder in it, head, creation time, the **events** (their count and the last one, `show all` unfolding the list as a small table: time, event, version), and the **save mode** as a pair of radio buttons (`update in place` / `new version`) with a note whether the mode is written in the object or the unwritten default applies, and `clear` to remove a written mode; `Delete object` / `Restore object` (the question says how many blocks still use the object);
- **used by**, the backlinks of the object ([Usage](#usage)): one row per block that references it, with its component (and a note when the object declares another one), its place as a link (`a.md#anchor-id`, or `a.md:line` without an id; a click goes there and closes the popup), what it reads (`head`, or the pinned version id), `this block` on the block the panel was opened from, and the problem of a reference that does not resolve. A read-again button stands next to the title (every document of the list) and next to each place (its document), and the result is said beside the title (`confirmed`, `1 no longer there`, `1 found in addition`); the list is what the page last read, and the buttons confirm it;
- the versions, newest first, in one table so that the values of a column line up across the rows (a grid per row would not), every row the same height whether selected or not: id, a `head` badge and a `read here` badge on the version the block that opened the panel reads, the **uses** (on the head row `following|pinned`, the blocks following the head and those pinned to the head version, e.g. `2|0`; on another row the blocks pinned to it), time, size, note, predecessors; the note and the predecessors take the room left and are cut with an ellipsis. A click selects a version; a click on the selected version unselects it. A lock column marks locked versions. The actions of the selected version, `Set as head`, `Lock version` / `Unlock version`, and `Delete version` (never the head, never a locked version), are a row below the table, so selecting never changes the height of a row;
- the data of the selected version: a text version is shown in a `<pre>`, and for the head a click on the text (or `Edit head`) turns that same element editable in its place (`contentEditable` switched on, never a replacement element), uncontrolled while typing, with the caret at the clicked position ([where the caret goes](doc_page_impl_edit.md#where-the-caret-goes)). The element keeps one box in both states, the same padding, type, minimum and maximum height, and the title row keeps its form (`data of … (head)`, with `, editing` appended), so nothing moves when editing starts: the [no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule) of the edit layer, which is why the element does not take the edit layer's `doc-edit-surface` class, whose source-kind rules would change its padding. Both saves are offered side by side, `Save in place` and `Save as new version`, and the one the object's save mode names is the primary button. A pointer going down outside the text and its buttons leaves editing (`useEditOutsidePointer`, as on the page): an unchanged draft just closes, a changed one is saved, by the object's save mode, or as a new version when the head is locked (`saveModeOnLeave`); Escape still cancels. With a locked head, `Save in place` is greyed out with the reason. When the head is not text, `Edit head` is greyed out and the reason stands beside it (the type and size, and that a file can be uploaded instead): a disabled control says why. A version that is not text shows its type, size, and hash, a preview when the type is an image, and a download link. Below the data of any version stand its dependencies ([Dependencies](#dependencies)), each as the source path or the object and version it names, or `none`, and its metadata ([Version metadata](#version-metadata)) as one line of json, or `none`. `Upload file as head` writes the bytes of a chosen file as the head data, in place or as a new version by the save mode, which is how an object becomes an image or any other file.

The header of the popup carries, left of the close button, a side-panel button (lucide `PanelRightOpen`, becoming `PanelRightClose` while open; not the maximize pair `Expand` / `Shrink`) that opens the **preview pane** (`AssetPreview`) at the right of the panel, and the popup widens for it. The pane renders what the block the panel was opened from would render with the data as it is in the panel now: while the head text is edited, the draft, on every keystroke, so it shows what a save would render as before anything is saved; otherwise the selected version. It renders through the same runtime boundary as the document (`RegisteredComp`, placement `commentBlock`, the block's component name and marker props, the data in place of the reference), so the component sees exactly what it would see in the document. A version that is not text is shown as an image when it is one and described otherwise, and a panel not opened from a block has no renderer and says so. Whether the pane is open is remembered from one panel to the next (`isPanelPreviewOpenLast`).

The object section also carries `Lock object` / `Unlock object`; while the object is locked the panel says so and greys out every change, each with its reason. Deletions ask for confirmation in the panel itself, never through a browser dialog, and the question opens in the row of the button that asked, right after it (`Delete the object …? [Delete] [Cancel]`, its failure beside it), so nothing below moves. With a read-only backend the panel shows and does not offer the actions. Every pending state and every message is the state of an **`AssetPanelModel`** (`store/AssetPanelModel.ts`: `block`, `isPreviewOpen`, `isEventListOpen`, `versionIdSelected`, `edit`, `upload`, `confirm`, `status`, `message`, `usageRefresh`; `previewData` is what the pane renders), with the actions that change the object from the panel; `AssetPanel` renders a model it is given (`panel`) and asks it for the changes. The page holds two, each independent of the other: `DocAssetStore.panel`, the popup's, and `DocAssetStore.settingsPanel`, the object chosen in the settings tab (`settingsPanelToggle`), which renders the same `AssetPanel` inline below its lists. A host chooses the sections and their order (`sectionList`, `ASSET_PANEL_SECTION_LIST`) and what follows a click on a backlink (`onNavigate`); the tables of the usage list and of an object list are components of their own (`AssetUsageTable`, `AssetObjectTable`), shared by the panel and the settings tab.

## Usage

The store knows its objects; which blocks read them is in the documents. The page keeps both sides together in a **usage index**: for every component block whose data is a reference, `{ place, compName, componentId, reference }`, where the block is ([Places in a document](doc_page_impl_nav.md#places-in-a-document): the document, the line of the marker comment counted without the frontmatter, the `Anchor` id declared before the block), the component, its `id` prop, and the parsed reference. Why the page keeps it and what it does not enforce with it is in [Components and the asset service layer](doc_page_impl_mdx_comp.md#components-and-the-asset-service-layer).

```text
read          GET /usage/list (every document, at start; after the object index, so a name resolves)
                the plugin reads the documents from disk and scans their text (assetUsageListScan):
                a fence in the language asset right after a renderComp marker, nested fences skipped
              a build bundles the same answer as assetSnapshot.usageDocList
kept          the manifest: a document whose contentHash differs from the one it was read with,
                or that left the manifest, is read again (GET /usage/list?docPath=…)
              usageNotify(changeList): what the page changed itself, applied at once
                { type: 'remove', docPath, lineStart, lineEnd }                   a block deleted
                { type: 'move', docPath, lineStart, lineEnd, docPathTo, lineStartTo }  a block moved
                { type: 'docChange', docPath }                                    anything else
                then the documents concerned are read again, which confirms it
derived       usageListGet / usageCountGet { head, byVersionId } / usageProblemGet of an object;
              usageBrokenList, orphanObjectList, unreferencedObjectList of the store
```

The edit layer notifies what it does: deleting a block (`remove`), moving a block up or down (two `move`s, applied against the index as it was before both), creating an asset-backed block or moving a block's data into the store (`docChange`). A move to another document has the same form; the page does not move blocks across documents yet. The index can still be behind, and is allowed to be: a document changed while the page was not running is right once it is read, a line counted from a document read before the last edit above it names the wrong block until the next read, and a built page knows the documents as they were built. The read-again buttons of the panel and of the settings tab read the documents again on request (`usageDocListRead`, `usageLoad`); a read keeps the index shown until the answer replaces it.

From the index, objects fall into the lists the settings tab shows; deleted objects are in none, and every list is empty until the index is read:

- **orphans** (`orphanObjectList`): objects that declare a component ([Objects for components](#objects-for-components)) and that no block references: a block removed without its data, here or outside the page;
- **not referenced** (`unreferencedObjectList`): objects no block references that declare no component, data of another purpose or from before the declaration; listed apart, since nothing about them is wrong;
- **broken references** (`usageBrokenList`): blocks whose reference does not resolve, an unknown store, object, name, or version (`usageProblemGet`), shown as the usage table with the object each names.

Deleting a block whose data is an asset object asks about the object in the same toolbar question (`Delete this block? Its data is the asset object "…", also used by 1 other block. [Delete block only] [Delete block and asset] [Keep]`; `DocEditStore.blockAssetObjectGet` says which object, whether it is locked or deleted, and how many other blocks use it). **Delete block and asset** marks the object deleted first and writes the document last, the write being what makes the deletion happen; a failed write restores the object (`blockDelete(path, blockIndex, { isAssetDeleted: true })`). It is not offered for an object that is locked, already deleted, or used by other blocks; deleting shared data stays an act of its own panel.

The **Asset service** tab of the settings panel shows the lists below the folder groups, in a group of their own ("Objects and references", a full-width item rendering `AssetOrphanArea` of `AssetStoreSettings.jsx`), each object list a table (`AssetObjectTable`: name, id, component, versions, lock, creation, last event), with a read-again button in the group title that reads every document. A click on an object opens its asset panel inline below the lists (`settingsPanel`), a click on it again or a pointer going down outside the area closes it, and a click on a place of a backlink or a broken reference goes there and closes the settings panel.

## Moving inline data into the store

The toolbar of a component block whose data is written inline in a fenced block carries a `to asset` button (where the `asset` button is for a reference block). It is the one way the page creates an object from a document, and it uses the default folder: the block's data becomes a new object of the local store with the block's language, no name (a name would make the second block of the same component resolve to the first one's object, [Names](#names); the component name goes into the note, and into `component` as the component the object is for, [Objects for components](#objects-for-components)), and the block is rewritten as the reference to it by id (`componentBlockTextBuild` with the reference as `raw` and `asset` as the fence language); the dependencies of the data, derived from the component's definition ([Dependencies](#dependencies)), are recorded with the first version, and the object gets the save mode the component declares (`meta.assetSaveMode`), if it declares one.

The button asks first, in the toolbar, like a deletion (`Move the data of this block into the asset service layer? [Move] [Keep]`, `blockAssetMoveConfirmSet`, state `blockAssetMove.status === 'confirming'`): a move creates a file set on disk and rewrites the document, and a click on the wrong block should cost nothing. **Move** reports the request, an event of the edit domain, `editBlockAssetMoveRequest`, like moving a block ([events of the edit layer](doc_page_impl_event.md)); **Keep**, a pointer going down elsewhere, or any other edit action drops the question. `DocEditStore.blockAssetMoveApply` creates the object first and rewrites the block **last**: the rewrite of the document is the step that makes the move happen, and the move has succeeded only when it is written. A failed object creation changes nothing; a failed document write leaves the block as it was, still working with its inline data, and the object in the store, with a message saying which object holds the copy. The same order holds for a block of an asset-only component created from the insert menu ([Asset-only components](doc_page_impl_edit.md#asset-only-components)), which deletes its object again (softly) when the document write fails.

## Build

A build has no development server, so the plugin does these things at build time with the store of the doc pages:

- its own scans of document text see the data, not the reference: `assetBlockTextExpand` replaces every `asset` block whose version is text with the data block of that version (`{lang}` fence, the text) before the attachment finder collects image references ([build-only attachment collection](doc_page_impl.md#build-only-component-attachment-collection)) and before source pruning follows component dependencies ([source pruning](doc_page_impl.md#source-pruning-for-deployment)). The documents themselves are not rewritten; the page resolves at run time as in development.
- the source files the versions of the live objects depend on (`dependencySourcePathList()`) are kept by source pruning and bundled into `fileUrlByPath` like a file a document names ([collection for a build](doc_page_impl_source.md#files-in-a-build)), so an Image asset whose image sits in a `referenced` folder still shows in the built page.
- the virtual module exports `assetSnapshot`, `snapshotBuild()` of the store: every object that is not deleted with the data of all its versions, text as text and other bytes as base64, and the usage index of the built documents (`usageDocList`). The host passes it as `data.assetSnapshot`; `DocAssetStore` reads it through the snapshot backend, so a built page shows every asset-backed component, read-only; the popup panel needs edit mode and is not reached in a build, while the settings tab lists the objects and references of the build without actions. `docAssetEndpoint` is `''` in a build and `subscribeDocAsset` does nothing, as for the edit layer ([availability](doc_page_impl_edit.md#availability-and-mode)).

In development the page reads file bytes through the source api, so a data change that names a new image through the panel shows at once.

## Edit mode

In edit mode an asset-backed component block is edited as source, whatever its component declares: the block is the reference, and `DocEditBlockEditor` gives it `BlockSource` with the label `Xxx (asset)`. Changing the `versionId` there pins or unpins the block; replacing the fence language and writing the data inline takes the block out of the store. The data itself belongs to the object and is changed through the panel, opened with the toolbar's `asset` button, which saves by the object's save mode; the component re-renders from the store, and no document is written for it. The component's own edit modes (`expose.editModeList`) are listed in the block's mode menu but greyed out, with this reason, and only the built-in `source` mode can be chosen, because the component's editor would edit a draft the edit layer cannot write anywhere: its result is not lines of this document. A component that is asset-aware may still change its data from reading edit mode through `dataReplaceRequest` ([component awareness](doc_page_impl_mdx_comp.md#component-awareness)), which the edit store writes to the object; that is how an image is pasted onto an asset-backed `Image` without the panel.

A component declared **asset-only** ([Asset-only and not-in-doc](doc_page_impl_mdx_comp.md#asset-only-and-not-in-doc)) is the exception: its data is never in the document, so its own edit modes are offered on a reference block reading the head of a writable object, and its editor's draft (the data and the version metadata) is saved into the object by the object's save mode when the session ends ([Asset-only components](doc_page_impl_edit.md#asset-only-components)). The document is not written by such a session. `ExcelUniver` is one.

The compile-time readers of component data (`languageListGetByComponent`, `structuredDataGetByComponent` in `compileDoc`) do not run on a reference block; with the data in the store they would read the reference as data. The search index and the language selector therefore do not see asset-backed content.

## Files

```text
frontend/plugin/id-ms48.ts                 ms_48 ids: create, time of, validity
frontend/plugin/doc-asset-store.ts         the file store: the asset section of config.yaml (checked, with the
                                           migration of asset.folder), config file and folders, objects (id, name, folder
                                           name), versions, head, bytes and text, version metadata, save
                                           modes, events, backups, snapshot
frontend/plugin/doc-asset-server.ts        the dev-server middleware (with GET /usage/list)
frontend/plugin/doc-entry.ts               the doc pages loaded (docPageList): alias, entry, folder, roots, "asset" section
frontend/plugin/doc-source.ts              the store of the doc pages, docAssetEndpoint / assetSnapshot / subscribeDocAsset
                                           exports, reference expansion for the scans, change events, the
                                           usage scan of the documents (assetUsageDocListScan)
frontend/plugin/doc-asset-config.test.js   the asset section and what the server then exports and answers;
                                           the reasons the page gives for a store it cannot write
frontend/src/lib/doc-asset-ref.js          the reference: language, parse (by id or name), build, expansion
                                           in a document text, the references of a document (assetUsageListScan)
frontend/src/lib/doc-place.js              a place in a document: build, navigation target, text
frontend/src/lib/doc-asset-backend.js      api backend, snapshot backend (one interface)
frontend/src/store/DocAssetStore.ts        backend, status and index, why the store cannot be read or written, objects and versions, names,
                                           refLoad / refQuery, writes, dependencies, folders, the usage index and
                                           its lists, assetRefreshRequest, the two panels
frontend/src/store/AssetPanelModel.ts      one asset panel: what it shows, its pending actions, its usage list
frontend/src/store/DocEditStore.ts         blockAssetMoveConfirmSet / blockAssetMoveApply (with dependencies),
                                           dataReplaceApply, blockDependencyListGet, blockCreateAsAsset and
                                           the asset drafts of asset-only components; blockDelete with the
                                           object, blockAssetObjectGet; the usage notifications
frontend/src/DocPageMdx.jsx                config.asset, data.assetSnapshot, the manifest for the usage index,
                                           the asset route of the event layer, AssetPanelPopup
comp-doc/registry/RegisteredComp.jsx       the asset branch of the runtime boundary; config.assetInfo for
                                           an isAssetAware component
comp-doc/registry/comp-registry.js         compDefine: isAssetAware, assetDependencyListGet
comp-doc/asset/                            CompAssetHost, AssetFrame, AssetPanel, AssetPreview, AssetPanelPopup,
                                           AssetUsageTable, AssetObjectTable, DocAsset.css
comp-doc/settings/AssetStoreSettings.jsx   the "Asset service" tab of the settings panel: the folders by doc page; orphans,
                                           unreferenced objects, broken references, the panel of one object
comp-doc/edit/DocEditBlockToolbar.jsx      the asset button of a reference block, the to-asset button of an inline block,
                                           the deletion with or without the object
comp-doc/edit/DocEditBlockEditor.jsx       asset-backed blocks are edited as source (except asset-only components)
comp-mdx/excel-univer/                     ExcelUniver: an asset-only component using version metadata
example_doc/.doc-page/asset.yaml           the asset store config of the demonstration doc page (its sub document
                                           has none and uses its default folder, ~sub:sub-doc/asset in the store)
example_doc/asset/, asset-archive/         the folders of the demonstration store
example_doc/asset-store.md                 demonstration document (dependencies, version metadata, blocks sharing an
                                           object, backlinks, orphans, what a component knows)
example_doc/mdx-usage/comp-excel-univer.md demonstration of an asset-only component (object w4r63zmeaor)
example_doc/asset-file/image/              the folder pasted images are created in (referenced source folder)
```
