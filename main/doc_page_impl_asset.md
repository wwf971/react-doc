<!-- Design of the asset store. Parent document: doc_page_impl.md. This is the asset-store design document; other documents link here. -->

# Asset Store: Design

A component written in the degradation-compatible form, a comment marker and a code block, carries its data in the document. The asset store lets the data live outside of it: one folder of **text objects**, each with a history of versions, and in the document a short **reference** in place of the data. The page resolves the reference before the component renders, so the component receives exactly the input it would receive with the data written inline and never learns where the data came from. The store is a general local storage of versioned text with a standard api; the document page is its first client. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md); the reference form is the component form of [MDX components](doc_page_impl_mdx_comp.md), and edit mode handles the reference as described in [In-place Editing](doc_page_impl_edit.md#component-edit-mode).

```text
document                             page                                    development server
<!--renderComp=Image-->              RegisteredComp                          plugin/doc-asset-server.ts
(fence) asset                          │ lang === 'asset'                     GET  {endpoint}/status
objectId: w4laejhlzjh                  ▼                                      GET  {endpoint}/object/get
versionId: head                      CompAssetHost ── refLoad ──► DocAssetStore ──► POST {endpoint}/object/update …
(fence)                                │ { text, lang } of the version         │        │
                                       ▼                                       │        ▼
                                     AssetFrame (title line, [asset] button)   │   plugin/doc-asset-store.ts
                                       └─ RegisteredComp (raw = text,          │   {folder}/{objectId}/object.yaml
                                           lang = object.lang)                 │                       {versionId}.yaml
                                                                               │
                                     AssetPanelPopup ◄── panel state ──────────┘
                                       versions, head, text, edit actions

build: the plugin expands every reference for its own scans and bundles
       the store as a read-only snapshot (assetSnapshot); the same page code
       reads it through the snapshot backend
```

## Text objects and versions

An **object** is one text with a name, a language (`yaml`, `md`, `json`, …: the fence language the text would be written with inline), and a history. A **version** is one text of the object; the object's **head** is the version a reference without a version reads. Versions form a directed acyclic graph: every version records the versions it was made from (`versionIdPrevList`), normally one, so the history is a chain; a version made from several would be a merge, which the model allows and the page does not yet produce. The data model follows the object store of `homepage-utils/storage-obj` (object, version, head, DAG history), reduced to text and kept on the local file system; other backends (a service, a database) can implement the same api later.

Ids are ms_48 ids, as every id of the project (`ai-skills/app-dev/references/id-format.md`): 48 bits of milliseconds plus a 16-bit random offset, in base36, no prefix or suffix, `plugin/id-ms48.ts`. Object ids and version ids come from the same allocator; a version id orders versions of one object only roughly (two versions in the same millisecond are ordered by chance), so the order of versions is the order of the object's version list, which the store appends to.

Writes to a version are of two kinds, and the caller names which one it means:

- `inPlace`: the head text is replaced; the version keeps its id. The previous text is kept as a backup file beside it. For corrections the author does not want to see in the history.
- `newVersion`: a new version is created from the head and becomes the head. The history grows.

Every update carries the hash (sha1) of the text the caller started from; a different hash on disk refuses the update with code -2 and nothing is overwritten, as the [edit api](doc_page_impl_edit.md#edit-api-and-line-operations) does for files.

Deleting is of two kinds too. A version that is not the head can be deleted; the versions made from it are relinked to its predecessors, so the graph stays connected and the history of what remains stays readable. An object is deleted by a mark (`isDeleted`): its files stay, references to it keep resolving, and the mark is undone by restoring the object; the mark exists so that a reference is never broken by a click, and so that removing the files is a deliberate step taken outside the page (a cleanup of the folder). The head cannot be deleted; moving the head is a separate action (checkout).

## One folder, fully reflected

The store is one folder, and the folder is the store: every object, version, and piece of metadata is a file in it, readable without the page, and the page holds nothing the folder does not. Copying the folder copies the store; a git checkout of the folder changes the store.

```text
{asset.folder}/
└── {objectId}/
    ├── object.yaml           the object: name, lang, fileExt, versionIdHead, isDeleted,
    │                         timeCreated, timeUpdated, versionList [{ versionId,
    │                         versionIdPrevList, time, note }]
    ├── object.yaml.bak       the previous object file, written before every rewrite
    ├── {versionId}.{ext}     the text of one version, with the extension of its language
    │                         (yaml, md, json, txt, …), so editors open it as what it is
    └── {versionId}.{ext}.bak the previous text of a version written in place
```

There is one metadata file per object and no index of the folder: the list of objects is the list of folders, so nothing has to be kept in sync with it. Every rewrite of a file is protected the same way (`fileWriteSafe`): the current file is copied to `.bak`, the new text is written to `.tmp`, and the temporary file is renamed over the original, so an interrupted write leaves either the old file or the new one, and the previous content is one file away. The backups are recovery data, not history: the version files are the history, and the backups are excluded from version control (`.gitignore`). Times are written in the project's time format (`20260520_23250530+09`).

The folder is named by `asset.folder` of `config.yaml`, relative to the config file. It may lie inside a source folder (the example keeps it at `example_doc/asset`); the plugin never collects its files as documents and never invalidates the manifest for a change in it.

## The standard api

The file store (`plugin/doc-asset-store.ts`, `assetStoreCreate(folder)`) is the api; the development server exposes it over http, and the page talks to it through a backend with the same method set. Every failure is an `AssetError` with a code: -1 bad request, -2 the text changed since it was read, -3 not found.

| method                                             | effect                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `objectList()`                                     | metadata of every object, deleted ones included                      |
| `objectGet(objectId)`                              | metadata of one object                                               |
| `versionTextGet(objectId, versionId = 'head')`     | `{ versionId, text, hash }` of one version                           |
| `objectCreate({ name, lang, text, note })`         | a new object with its first version                                  |
| `objectUpdate({ objectId, hashBase, text, mode, note })` | the head text, `mode` `inPlace` or `newVersion`                 |
| `objectMetaSet(objectId, { name, lang })`          | name and language of the object (the file extension stays)           |
| `versionCheckout(objectId, versionId)`             | moves the head                                                       |
| `versionDelete(objectId, versionId)`               | removes a version that is not the head; its children are relinked    |
| `objectDelete(objectId)` / `objectRestore(objectId)` | the deletion mark                                                  |
| `referenceTextGet({ objectId, versionId })`        | `{ lang, text }` of a reference, or nothing; what the plugin expands with |
| `snapshotBuild()`                                  | every object that is not deleted, with the texts of all its versions; what a build bundles |

`plugin/doc-asset-server.ts` adds one connect middleware to the development server under `docAssetEndpoint` (`/__doc-asset` under the configured `base`); every response is `{ code, data, message }`, codes as above, and the http status follows the code. `GET /status` answers `{ isWritable: true }`; `GET /object/get?objectId=&versionId=` answers `{ object, version }` in one round trip; the writes are `POST` routes with the method's arguments as a json body and answer `{ object }` or `{ object, version }`. The store is re-created from the folder on every request (the folder is the truth, and the api never caches it), so a file changed by an editor is seen by the next request. A change in the folder is also pushed to the page as the custom HMR event `doc-asset-change { objectId }`, which the virtual module exposes as `subscribeDocAsset`.

`lib/doc-asset-backend.js` holds the two page-side backends with one interface: `assetBackendApiCreate(endpoint)` is the fetch client of the api, `assetBackendSnapshotCreate(snapshot)` answers the reads from the bundled snapshot and refuses every write with code -1. `DocAssetStore` is written against this interface and does not know which one it holds, which is where a further backend would plug in.

## The reference in a document

A component block whose fenced block is written in the language `asset` holds a reference, not data. The content is yaml and names the object and, optionally, a version; it is parsed with the yaml parser like any component yaml (`lib/doc-asset-ref.js`, `assetRefParse`):

````markdown
<!--renderComp=Image-->
```asset
objectId: w4laejhlzjh
versionId: head
```
````

`versionId` is a version id or `head` and defaults to `head`; a bare id string in place of the mapping is read as `objectId`. A reference reading `head` follows the object: moving the head changes what every such reference shows, in every document. A reference with a version id is pinned. The marker keeps its own props; only the data block is replaced by the reference, so `<!--renderComp=StockTable,title=…-->` keeps its title.

Under a plain Markdown renderer the reference degrades to a small yaml code block, as the inline form degrades to its data block ([Graceful degradation](doc_page_impl.md#graceful-degradation-stipulation)): the document stays readable and says which object it meant.

The language `asset` is reserved for references: an object whose own `lang` is `asset` is refused by the store, and the page refuses to render one, so a reference can never resolve to another reference.

## Resolution: the runtime boundary

`RegisteredComp` is the one boundary every registry component is rendered through, and the component data reference (`dataRef`) already shows the pattern for data that comes from elsewhere: the boundary detects it, a host resolves it, and the render component receives ordinary `data`. The asset reference follows it one step earlier, before normalization, because what it replaces is the authored text itself:

1. `RegisteredComp` with placement `commentBlock` and `input.lang === 'asset'` renders `CompAssetHost` (`comp-doc/asset/`) with its own props instead of normalizing the input.
2. `CompAssetHost` parses the reference, asks `DocAssetStore` to load it (`refLoad`), and reads what it resolves to (`refQuery`: loading, error, or the object, the version id, and the text).
3. Once resolved, it renders `RegisteredComp` again with the same props and `input = { ...input, raw: text, lang: object.lang }`. From there everything is as for an inline block: the definition's input converter, `data` and `config`, `dataRef`, the event layer, the component's `isEditSupported`. The component is not told about the asset, and no component is changed for the store.

The host is the only code that knows both sides; a new component works with the store on the day it is registered. A component that an asset-backed component references through `dataRef` receives the reference text, not the asset text: `dataRef` reads the authored block of the other component (`CompDataRefHost`), and the asset is resolved per rendered instance. Keeping an asset-backed block as a `dataRef` source is therefore not supported; the data belongs in the store once, and both documents reference the store.

`DocAssetStore` (`store/DocAssetStore.ts`) sits beside the reading stores, like `DocEditStore`, and never writes to them:

- `backend`, `isAvailable`, `isWritable`: the api backend when `config.asset.endpoint` is set, else the snapshot backend when `data.assetSnapshot` is set, else none; `isWritable` comes from `GET /status` and is false for a snapshot.
- `objectById`: the metadata of every object read so far, with its loading or error state; `textByKey`: the text of every version read so far, keyed `${objectId}#${versionId}`. A reference reading `head` resolves through `objectById[…].versionIdHead`, so a checkout changes what every frame shows with one object update.
- `refLoad(ref)` reads what `refQuery(ref)` is missing and nothing else; one `GET /object/get` brings the object and one version.
- Every write goes through `writeApply`: the backend answers, the returned object (and version) replace the loaded ones, the caller gets `{ code, data, message }`; a conflict (code -2) gets the standard message and reloads the object. `objectUpdate` sends the hash of the loaded head text as `hashBase`.
- `subscribe` (`subscribeDocAsset` of the virtual module) reloads an object when its files change on disk; the several file events of one write are coalesced into one reload.
- `panel`: the one open asset panel, see below.

## The frame and the panel

A component whose data comes from the store is shown inside `AssetFrame`: one title line above the component, in the document flow, with the component name, the object's name (its id when it has none), the version the document reads (`head w4la…`, or `version w4la…`, with `(head)` when a pinned version is the head), a `deleted` flag for a marked object, and at the right end the button `asset` that opens the panel. The component renders below, unchanged. The line is the one place where the document says that this block is an asset, and the one place where the panel is reached; the component has no asset button of its own, which is why a wrapper was chosen over an addition to every component. The page config key `AssetFrameIsOn` (page scope, default true) switches the line off for readers who do not need it; a reference that cannot be resolved shows its message and the reference text in the frame's place regardless, as a component error would.

The **asset panel** (`AssetPanel`, in the host's text panel component through `AssetPanelPopup`, the way the tag overview is framed) is the whole user interface of the store, provided once by the store and the same for every component:

- the object: id, name (edited in its field, `EditValueInline`), language and file extension, head, times; `Delete object` / `Restore object`;
- the versions, newest first, each with its id, time, note, its predecessors, a `head` badge, and a `read here` badge on the version the frame that opened the panel reads; the selected version shows its actions `Set as head` and `Delete version` (never the head);
- the text of the selected version; `Edit head` makes the head text editable in its place (a `<pre>` made editable, uncontrolled while typing, the draft taken on every input), with `Save in place` and `Save as new version`.

Deletions ask for confirmation in the panel itself, never through a browser dialog. With a read-only backend the panel shows and does not offer the actions; every pending state and every message is `panel` state in the store (`edit`, `confirm`, `status`, `message`), and the panel renders that state. The panel is opened from a frame (`panelOpen(objectId, versionIdRef)`) and knows nothing of the component.

## Build

A build has no development server, so the plugin does two things at build time with the store of `asset.folder`:

- its own scans of document text see the data, not the reference: `assetBlockTextExpand` replaces every `asset` block with the data block of the referenced version (`{lang}` fence, the text) before the attachment finder collects image references ([build-only attachment collection](doc_page_impl.md#build-only-component-attachment-collection)) and before source pruning follows component dependencies ([source pruning](doc_page_impl.md#source-pruning-for-deployment)). The documents themselves are not rewritten; the page resolves at run time as in development.
- the virtual module exports `assetSnapshot`, `snapshotBuild()` of the store: every object that is not deleted with the texts of all its versions. The host passes it as `data.assetSnapshot`; `DocAssetStore` reads it through the snapshot backend, so a built page shows every asset-backed component, its frame, and its panel, read-only. `docAssetEndpoint` is `''` in a build and `subscribeDocAsset` does nothing, as for the edit layer ([availability](doc_page_impl_edit.md#availability-and-mode)).

In development the attachment map of the virtual module is computed when the module loads; a data change that introduces a new image reference through the panel is resolved after the manifest is next regenerated.

## Edit mode

In edit mode an asset-backed component block is edited as source, whatever its component declares: the block is the reference, and `DocEditBlockEditor` gives it `BlockSource` with the label `Xxx (asset)`. Changing the `versionId` there pins or unpins the block; replacing the fence language and writing the data inline takes the block out of the store. The data itself belongs to the object and is changed through the panel, which saves in place or as a new version; the frame updates from the store, and no document is written for it. The component's own editor (`isEditSupported`) is not offered for such a block, because it would edit a draft the edit layer cannot write anywhere: its result is not lines of this document.

The compile-time readers of component data (`languageListGetByComponent`, `structuredDataGetByComponent` in `compileDoc`) do not run on a reference block; with the data in the store they would read the reference as data. The search index and the language selector therefore do not see asset-backed content.

## Files

```text
frontend/plugin/id-ms48.ts                 ms_48 ids: create, time of, validity
frontend/plugin/doc-asset-store.ts         the file store: objects, versions, head, backups, snapshot
frontend/plugin/doc-asset-server.ts        the dev-server middleware
frontend/plugin/doc-source.ts              asset.folder, docAssetEndpoint / assetSnapshot / subscribeDocAsset
                                           exports, reference expansion for the scans, change events
frontend/src/lib/doc-asset-ref.js          the reference: language, parse, expansion in a document text
frontend/src/lib/doc-asset-backend.js      api backend, snapshot backend (one interface)
frontend/src/store/DocAssetStore.ts        backend, objects and texts, refLoad / refQuery, writes, the panel
frontend/src/DocPageMdx.jsx                config.asset, data.assetSnapshot, AssetPanelPopup
comp-doc/registry/RegisteredComp.jsx       the asset branch of the runtime boundary
comp-doc/asset/                            CompAssetHost, AssetFrame, AssetPanel, AssetPanelPopup, DocAsset.css
comp-doc/edit/DocEditBlockEditor.jsx       asset-backed blocks are edited as source
frontend/src/lib/doc-config-define.js      AssetFrameIsOn
example_doc/asset/                         the demonstration store
example_doc/asset-store.md                 demonstration document
```
