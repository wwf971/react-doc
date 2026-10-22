<!-- Design of the doc page source service layer. Overview: doc_page_impl.md -->

# Doc Page Source Service Layer

The **doc page source service layer** is everything the doc page knows about the files of a document: which files and folders form the source, how each is named, which of them are pages, how their bytes are reached, and how a file is created from the page. It is the ground the other layers stand on: documents and links ([navigation](doc_page_impl_nav.md)), tags and config declared per file ([tags](doc_page_impl_tag.md), [config](doc_page_impl_config.md)), the files the [asset service layer](doc_page_impl_asset.md) depends on, and the files components refer to or create ([MDX components](doc_page_impl_mdx_comp.md)).

```text
entry yaml: source rules ──► vite plugin "doc-source" (build / dev)
                                ├── scanSource      file entries   { rootId, relPath, internalPath, collect, ... }
                                ├── scanSourceDirs  folder entries { rootId, relPath, internalPath, collect }
                                ├── dev api {base}/__doc-source: file text, file bytes, file creation
                                └── virtual:doc-source: fileManifest, dirManifest, fileUrlByPath, docSourceEndpoint
                                        ▼
page: DocSourceStore (the source as the page reads it, sourceService for components)
      DocSourceFileStore (file creation requested by components, the location prompt)
```

## Source paths

Every file and folder of the source is named by one **source path**:

```text
~rootId/relative/path/in/root        a file or folder
~rootId                              the root folder itself
```

The first segment is the root id, marked by `~`; the rest is the path from the root folder, with `/` separators and no `.`/`..` segments. The mark makes a source path recognizable wherever a path can appear: in a link target (`[x](~example/doc.md)`), in a component's data (`src: ~example/mdx-usage/image/a.svg`), in the side panel (`doc: ~example/doc.md`, `sourceFolder: ~example/mdx-usage`), in the `?doc=` url, in the edit and source apis, in asset dependencies. `~` is not used by anything else that can stand in those places: `@` starts a side-panel item target, `#` a fragment, `$` a variable, and a scheme ends with `:`. It is url-safe. The grammar is one module, `lib/doc-source-path.js`, shared by the plugin and the page:

| Function | Meaning |
| --- | --- |
| `sourcePathBuild(rootId, relPath)` | `~rootId/relPath`, or `~rootId` for an empty relPath |
| `sourcePathIsRooted(text)` | the text is a source path |
| `sourcePathParse(text)` | `{ rootId, relPath }`, or undefined |
| `sourcePathNormalize(text)` | trailing slashes and repeated slashes removed |
| `sourcePathDirGet(path)`, `sourcePathNameGet(path)` | the folder of a path, its last segment |
| `sourcePathRelativeResolve(dirPath, relPath)` | `./` and `../` resolved from a folder; `..` never leaves the root |
| `sourcePathIsInside(path, dirPath)` | the path is the folder or below it |

Other spellings of a target stay what they were, and resolve to a source path through `lib/doc-target-resolve.js`: a path relative to the document (`./a.md`, `../image/a.svg`), a path suffix (`guide/a.md`), a file name (`a.md`). A relative or suffix spelling is what an author writes inside one folder; the source path is what crosses folders and roots, and what the page writes itself (a created file, a dependency).

## Source rules and collection

The `source` of a document entry is an ordered rule list (see [The document entry](doc_page_impl_side_panel.md#the-document-entry)). The add rules define the roots and say how they collect:

```yaml
rules:
  - action: addFolder
    rootId: example
    path: .
    collect: recursive          # required: recursive | direct | referenced
  - action: addFile
    rootId: req
    path: ../main/doc_page_req.md
  - action: addFolder
    rootId: example             # the same root: a folder inside it, collected differently
    path: ./mdx-usage/image
    collect: referenced
  - action: removeByPath
    pattern: "~example/sub-doc/**"     # a glob over the source path
```

`collect` declares what the folder's files are to the page:

| Mode | Files below the folder | Are pages | In a build |
| --- | --- | --- | --- |
| `recursive` | every file, in every subfolder | yes | kept (pruned by the side panel like before) |
| `direct` | the files right in the folder | yes | kept |
| `referenced` | every file, in every subfolder | no | kept only when used |

A **page** is a document the page can show and the side panel can bind (`doc`, `sourceFolder`, `sourceRoot`); the page tree and the search skip `referenced` files. A `referenced` file is **collectable**: it is in the manifest with `collect: referenced`, so a link, a component or an asset can name it and the page resolves and serves it, but a deployment build keeps it only when something uses it: a document retained by [pruning](doc_page_impl.md#source-pruning-for-deployment) reaches it, a component names it (the attachment scan), or an [asset version depends on it](doc_page_impl_asset.md#dependencies). This is how a folder of images or of files the page itself creates is part of the source without being a set of pages.

A root id names one folder on disk: the first add rule with the id fixes it (for `addFile`, the folder of the file), and a later rule with the same id names a folder inside it and sets the collect mode of that part. The source paths of both are relative to the root folder, so the second rule above collects `~example/mdx-usage/image/a.svg`, the same name the first rule would give it; a file collected by two rules takes the later one. `removeByPath` patterns are globs over the whole source path; `removeByName` over the file name. Tag and config rules apply to the files collected so far, as before.

A file entry of the manifest is `{ rootId, relPath, name, ext, internalPath, collect, title, contentHash, tagList, configSource, configFrontmatter, load }`; `internalPath` is the source path. The **folder manifest** (`dirManifest`) lists the folders of the source, `{ rootId, relPath, internalPath, collect }`: for every `addFolder` rule its folder and, for a recursive or referenced rule, every folder below it, minus what `removeByPath` rules cover. It is what path completion offers and where files can be created.

## The source api

The development server answers `{base}/__doc-source` (exported as `docSourceEndpoint`; `''` in a build):

| Route | Answer |
| --- | --- |
| `GET /file?path=~root/a.md` | the current text of a collected file, `text/plain`, never cached (the page reads documents through it in development) |
| `GET /data?path=~root/image/a.png` | the bytes of a collected file with their mime type, binary or text |
| `POST /file/create` `{ dirPath, name, text \| dataBase64, isOverwrite? }` | writes a file into a folder of the source; `{ code: 0, data: { path, entry } }`, `-1` invalid, `-2` the file exists, `-3` the folder is not collected by any rule |

A file the page creates joins the manifest at once: the plugin remembers the path it just wrote, and when the file watcher reports the new file, the source data is sent to the page without a full reload (`doc-source-change`), so the page keeps its state and the new entry appears. Every path in the api is a source path; a folder is accepted for creation only when a folder rule of the same root collects it (inside a recursive or referenced folder, or the folder of a direct rule itself).

## Files in a build

A build has no api. The bytes of the files that are used are bundled as data urls and exported as `fileUrlByPath`, keyed by source path (and by the spelling a document used, for a file found beside the document on disk but not collected): the binary files of the manifest that survive pruning, the files the attachment finders see components name (`collectComponentAttachmentsOnBuild`, see [Build-only component attachment collection](doc_page_impl.md#build-only-component-attachment-collection)), and the source files the asset versions depend on. `DocSourceStore.fileUrlGet` answers from this map in a build, and from the `/data` route in development, so a component never sees the difference.

## The page side: DocSourceStore and the service object

`DocSourceStore` holds the source as the page reads it: `configDoc`, `fileManifest`, `dirManifest`, the raw texts and compile results, the structured data for search. It receives the source api endpoint and `fileUrlByPath` from `DocPageMdx` (`config.source.endpoint`, `data.fileUrlByPath`). Beside the reading methods it offers the **service object** of this layer, a stable object handed to every registered component as `config.source`:

| Method | Meaning |
| --- | --- |
| `isWritable()` | the source api answers: files can be created (development server) |
| `fileResolve(reference, fromPath)` | the one file entry a reference names (source path, relative, suffix, name), or undefined |
| `fileUrlGet(reference, fromPath)` | the url the bytes of the file are read from (build map, or the `/data` route); undefined when unknown |
| `dirListGet()` | the folders of the source |
| `pathComplete(text, spec)` | the candidates `{ path, kind, entry }` that complete what is typed, filtered by the [specification](#path-completion): an empty text lists everything, a rooted text matches by prefix, another text anywhere in the path |
| `pathTreeGet(spec)` | the same candidates as a tree, for browsing instead of typing ([browsing as a tree](#browsing-as-a-tree)) |
| `fileNameUniqueGet(dirPath, name)` | a file name not used in the folder yet (`a.png`, `a-2.png`, ...) |

`config.assetUrlGet`, which `Image`, `ImageGrid` and `DiagramMermaid` call with the references in their data, is `fileUrlGet` bound to the component's document by default (`RegisteredComp`); a host application may still hand its own through `compConfigHost.assetUrlGet`.

### Path completion

A **source path specification** says what a path names, so completion lists the right candidates. It is declared where a path is declared: a config key of type `sourcePath` carries `pathSpec` (see [component-level config](doc_page_impl_config.md#component-level-config)), and the location prompt completes folders. The specification is a plain object; every field but `kind` is optional, and a field left out does not filter:

```text
kind        'dir' | 'file' | 'any'   folders, files, or both (a mixed list tells the kind of each candidate)
extList     ['.png', '.jpg']         files with one of these extensions (the dot optional, case-insensitive)
rootIdList  ['example']              under these roots only
dirPath     '~example/asset'         under this folder only
isMatch     (candidate) => boolean   anything else, decided by the caller
```

The logic lives in `lib/doc-source-complete.js`, apart from the store: `sourcePathCandidateListBuild(spec, manifests)` turns the file and folder manifests into the allowed candidates `{ path, kind, entry }`, `sourcePathCompleteList(text, spec, manifests)` narrows them to what is typed. A new way of narrowing is one more field read there, and every path field of the page gets it.

The page renders completion with its own element, `SourcePathInput` (`comp-doc/source/`): an `EditValueInline` holding the path and a dropdown of the candidates from `pathComplete`, moved through with the arrow keys; it is not the browser's datalist. The dropdown is rendered into `document.body` at a fixed position under the text, not inside the field, because the field usually sits in a clipping container (every item of the settings panel hides its overflow) where a list placed inside would be cut off; it follows the text when the page scrolls. Leaving the field commits, including a click outside it; a click on a candidate takes it before the field is left. An empty field shows its placeholder. The settings panel uses it for `sourcePath` keys (the path ends at the right of the value column), the location prompt for the folder.

### Browsing as a tree

The same candidates can be chosen from a tree. `sourcePathTreeBuild(spec, manifests)` (`lib/doc-source-complete.js`, `pathTreeGet` of the service) arranges them as nodes `{ id, label, kind, isDisabled, childList }`: one node per root (`~rootId`), its folders, the files in them, folders first, each sorted by name. A folder that only leads to candidates (the specification asks for files, or for paths inside another folder) is a node too, and disabled.

`SourceTreeSelect` (`comp-doc/source/`) renders such a tree and only selects: a node is chosen by a click or the arrow keys (ArrowRight / ArrowLeft open, close, or go to the child or parent; Enter or a double click activates), a disabled node opens but is never chosen and says why in its title, and what the chosen node means is the caller's. The node shape is not bound to the source: `kind` picks the icon (a folder, a separator, anything else a file), `badge` is a small tag before the label (`badgeKind: 'component'` tints it), and `detail` is a muted note after the label, so another tree of the page can be shown the same way. The move picker of the side panel shows the items of the side panel ([moving an item](doc_page_impl_side_panel.md#moving-an-item)), the place picker of a paste or a copy the blocks of a document ([choosing where the blocks go](doc_page_impl_copy_paste.md#choosing-where-the-blocks-go)).

A tree can be **searched**: given `searchText`, `SourceTreeSelect` shows only the nodes whose label holds every word of it (case-insensitive), with the folders that lead to them, open, and highlights the matched parts of each label (`<mark class="doc-source-tree-match">`, a yellow ground). The narrowing is `sourceTreeSearch(nodeList, text)` (`lib/doc-source-complete.js`): it returns the narrowed tree, every node kept carrying `labelMatchList` (the matched ranges of its label), and the folders to open. It works on the node shape, so any tree shown by `SourceTreeSelect` can be searched. Folders opened or closed while searching are forgotten when the search changes; an empty search shows the tree as it was browsed.

### Choosing a path

Typing and browsing are one field of the page: `SourcePathPicker` (`comp-doc/source/`) is the path with completion (`SourcePathInput`) above the same candidates as a tree (`SourceTreeSelect` over `pathTreeGet`), both read from one specification, so what can be typed is what can be browsed. It only shows and reports: `value` is the caller's, `onSelect(path)` comes from a committed text or a chosen node, `onActivate(path)` from a double click or Enter in the tree ("this one, go on"), and `message` is the caller's word on why the value cannot be used. The tree is always shown, or folded behind a browse button (`isTreeCollapsible`). Above the tree a search field narrows it by name ([searching a tree](#browsing-as-a-tree); `isTreeSearchable`, on by default): Enter or ArrowDown in it chooses the first match and moves into the tree, Escape clears it (and is not passed on to the dialog around the picker).

```text
[label] [~example/edit-in-place.md      ] [⌸]   ◄ browse button: isTreeCollapsible only
[🔍 edit                                ×]       ◄ search: isTreeSearchable
▾ 📁 ~example
    🗎 [edit]-in-place.md                        ◄ the value, selected; the match highlighted
message
```

Every place that asks for a path uses it with its specification: the location prompt of a new file a folder (`{ kind: 'dir' }`, tree folded), the copy / move dialog a document (`{ kind: 'file', extList: ['md', 'mdx'] }`, [copying and moving blocks](doc_page_impl_copy_paste.md#the-dialog)).

## Creating files

A component that holds bytes to keep, such as an image pasted into `Image`, does not write them itself. It reports the request through the event layer, and the **source route** answers it from `DocSourceFileStore`:

```text
fileCreateRequest { name, blob | text, dirPath, isLocationCustom }
  -> { code: 0, data: { path, entry } } | { code: -1, message }
```

`dirPath` is the folder, a source path, usually from the component's own config (`Image` reads `compConfig.FileStoreDir`). `isLocationCustom: true`, or a `dirPath` that is not a source path, opens the **location prompt** (`SourceFilePrompt`): a floating panel at the pointer with the folder (a [`SourcePathPicker`](#choosing-a-path) of the folders of the source, its tree behind the browse button), the file name, Create and Cancel. The prompt stays open while the file is written, shows a failure in place so another folder can be tried, and answers the request with a failure when dismissed. The name is made unique in the folder (`fileNameUniqueGet`) before the file is written; the answer carries the source path of the new file, which the component then puts into its data through the edit layer (`dataReplaceRequest`, see [component awareness](doc_page_impl_mdx_comp.md#component-awareness)).

The two requests keep the component thin: it knows how to turn a clipboard into a file name and bytes, and how to write its own data with a new source; where the file goes, how it is written, and whether the data is a block of the document or a version of an asset are decided by the page.

## Code map

| Place | Role |
| --- | --- |
| `lib/doc-source-path.js` | the source path grammar |
| `lib/doc-target-resolve.js` | every spelling of a target resolved to source paths |
| `lib/doc-source-complete.js` | path completion: the specification, the candidates, the narrowing, the tree, searching a tree |
| `plugin/doc-source.ts` | rules, collection, folder manifest, source api, module generation |
| `plugin/doc-attachment.ts` | the files components name, the mime types, the data urls of a build |
| `store/DocSourceStore.ts` | the source as the page reads it, the service object (`config.source`) |
| `store/DocSourceFileStore.ts` | file creation requests, the location prompt |
| `comp-doc/source/SourcePathInput.jsx`, `SourceTreeSelect.jsx`, `SourcePathPicker.jsx`, `SourceFilePrompt.jsx` | the path input with completion, the tree view, the two as one path picker, the location prompt |
