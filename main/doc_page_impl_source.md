<!-- Design of the doc page source service layer. Overview: doc_page_impl.md -->

# Doc Page Source Service Layer

The **doc page source service layer** is everything the page knows about the files it serves: which doc pages make up the workspace, which files and folders form the source of each, how every file is named, which of them are pages, how their bytes are reached, and how a file is created from the page. It is the ground the other layers stand on: documents and links ([navigation](doc_page_impl_nav.md)), tags and config declared per file ([tags](doc_page_impl_tag.md), [config](doc_page_impl_config.md)), the files the [asset service layer](doc_page_impl_asset.md) depends on, and the files components refer to or create ([MDX components](doc_page_impl_mdx_comp.md)).

```text
config.yaml: workspace | docEntry ──► vite plugin "doc-source" (build / dev)
                                        ├── docWorkspaceLoad  the doc pages, their entries, aliases, includes
                                        ├── scanSource        file entries   { docPageAlias, rootAlias, relPath, internalPath, collect, ... }
                                        ├── scanSourceDirs    folder entries { docPageAlias, rootAlias, relPath, internalPath, collect }
                                        ├── dev api {base}/__doc-source: file text, file bytes, file creation,
                                        │     os folder listing, temporary doc pages
                                        └── virtual:doc-source: configDoc (with workspace), fileManifest, dirManifest,
                                            fileUrlByPath, docSourceEndpoint
                                                ▼
page: DocSourceStore (the source as the page reads it, sourceService for components)
      DocSourceFileStore (file creation requested by components, the location prompt)
      DocWorkspaceStore (the workspace as the settings panel draws and edits it)
```

## The concepts

Four things hold everything the page serves, each inside the one before it:

```text
workspace                     what one deployment serves, or what the development server shows:
│                             config.yaml names it (a workspace file), or names one doc page
├── doc page  "example"       a self-contained folder with its entry in .doc-page/; named in the
│   │                         workspace by an alias that is unique there
│   ├── root  "example"       a folder (or one file) an add rule of its source rules names, under an
│   │   ├── doc.md            alias unique in the doc page; the files below it are the source
│   │   └── mdx-usage/...
│   ├── root  "req"           a second root of the same doc page, a file elsewhere on disk
│   │   └── doc_page_req.md
│   └── doc page  "sub"       another doc page, included by a side panel of this one under the
│       └── root  "sub-doc"   alias "sub"; one doc page however often it is included
└── doc page  "other"         a second root-level doc page of the workspace (optional)
```

A **doc page** is the unit of authoring and of reuse: its folder carries its documents, its metadata (`.doc-page/`: the entry, source rules, side panels, tags, config, asset folders) and its asset objects, so it is included by another doc page or deployed alone without change ([the doc page folder](doc_page_impl_dir.md)). What its entry declares:

```text
doc page folder
├── .doc-page/entry.yaml      the entry: title, home document, and the sections below (inline or in files)
│   ├── source rules          the roots and how each collects (recursive | direct | referenced), removals, tags, config
│   ├── side panels           resources by id, each a tree of documents, folders, parts, panels and includes
│   │                         of other side panels, of this file or of another doc page (which joins the workspace)
│   ├── tag definitions       how each tag looks (doc_page_impl_tag.md)
│   ├── config declarations   the doc page config layer (doc_page_impl_config.md#the-doc-page-layer)
│   ├── asset folders         .doc-page/asset.yaml, or asset/ by default (doc_page_impl_asset.md)
│   ├── service folders       .doc-page/service.yaml, or service-template-app/, service-template-infra/,
│   │                         service-app/, service-infra/ by default (doc_page_impl_service.md)
│   └── component folders     .doc-page/comp.yaml, or comp-mdx/ by default
│                             (doc_page_impl_mdx_comp.md#components-of-a-doc-page)
└── documents, images, the folders the rules name; the asset, service and component folders
```

A **root** is a mount point, not a folder name: the source path of a file starts with the root's alias, never with the name of the folder on disk. A **workspace** is the top container: it lists its root-level doc pages (with one, it is the doc page's own side panel the page shows; with several, one section per doc page), it de-duplicates a doc page reached from several places, and it is the scope in which a doc page alias is unique. A single doc page named by `config.yaml` is a **virtual workspace** holding that doc page alone, so the single-document form is the multi-document form with one entry.

## Source paths

Every file and folder of the source is named by one **source path**, in one of two forms:

```text
~rootAlias/relative/path             local form: a root of the doc page the reference is written in
~docPageAlias:rootAlias/relative/path   full form: a root of a doc page of the workspace, exact anywhere
~rootAlias, ~docPageAlias:rootAlias     the root folder itself
```

The first segment is the root, marked by `~`: the alias of the root, prefixed by the alias of its doc page and `:` in the full form; the rest is the path from the root folder, with `/` separators and no `.`/`..` segments. An alias is one word: letters, digits, `_`, `-` and `.` (`sourceAliasIsValid`). The mark makes a source path recognizable wherever a path can appear: in a link target (`[x](~example/doc.md)`), in a component's data (`src: ~example/mdx-usage/image/a.svg`), in the side panel (`doc: ~example/doc.md`, `sourceFolder: ~example/mdx-usage`), in the `?doc=` url, in the edit and source apis, in asset dependencies. `~` is not used by anything else that can stand in those places: `@` starts a side-panel item target, `#` a fragment, `$` a variable, and a scheme ends with `:` after a word that never starts with `~`. It is url-safe.

**The segment is an alias, by design.** The root's alias is what the add rule declares (`alias`), not the name of the folder it names, for two reasons that the convention makes explicit: a folder can be renamed, or a doc page moved to another folder, without touching a single reference written in its documents, and two folders of the same name (two `docs/` folders of two products, or a folder of the doc page and a folder elsewhere on disk) can both be roots, under aliases that tell them apart. The same holds one level up: the doc page alias is what the workspace item or the include declares, not the folder name, for the same two reasons. When no alias is given, the folder name stands in, so a small doc page needs no aliases at all; but two different folders under one alias are an error naming both (a later rule with the alias of an existing root may only name a folder inside it), and two doc pages under one alias are an error as well.

**The full form is the identity.** Inside the page every file has one name, its full source path (`internalPath` of the manifest), unique in the workspace: it is what the manifest, the navigation, the browser url, the edit and source apis, the asset folders and dependencies carry, so a file of an included doc page never collides with a file of the including one, whatever their roots are called. The local form is what an author writes in the files of a doc page, and it is read as that doc page's: the loader turns the paths of side-panel nodes, of `homeDoc`, of rule patterns and of asset folders into the full form with the alias of the doc page the file belongs to, and a reference in a document is resolved from the document's own path, which names its doc page. Only when the local doc page has no such root does a local path look further, to the one doc page of the workspace that has the root; several make the reference ambiguous (a link shows the candidates). The grammar is one module, `lib/doc-source-path.js`, shared by the plugin and the page:

| Function | Meaning |
| --- | --- |
| `sourcePathBuild(rootAlias, relPath, docPageAlias?)` | `~root/relPath`, `~root` for an empty relPath; `~page:root/relPath` with a doc page alias |
| `sourcePathIsRooted(text)`, `sourcePathIsFull(text)` | the text is a source path; it is in the full form |
| `sourcePathParse(text)` | `{ docPageAlias, rootAlias, relPath }` (`docPageAlias` `''` for the local form), or undefined |
| `sourcePathFullGet(path, docPageAlias)`, `sourcePathLocalGet(path)` | a local path as one of a doc page (a full path unchanged); the local form of any path |
| `sourcePathDocPageAliasGet(path)`, `sourcePathRootGet(path)` | the doc page of a full path (`''` otherwise); the root segment as a path |
| `sourcePathPatternFullGet(glob, docPageAlias)` | a glob over local paths as a glob over full paths of that doc page |
| `sourcePathNormalize(text)` | trailing slashes and repeated slashes removed |
| `sourcePathDirGet(path)`, `sourcePathNameGet(path)` | the folder of a path, its last segment |
| `sourcePathRelativeResolve(dirPath, relPath)` | `./` and `../` resolved from a folder; `..` never leaves the root |
| `sourcePathIsInside(path, dirPath)` | the path is the folder or below it (both in the same form) |
| `sourceAliasIsValid(text)` | one word: letters, digits, `_`, `-`, `.` |

Other spellings of a target stay what they were, and resolve to a full source path through `lib/doc-target-resolve.js`: a path relative to the document (`./a.md`, `../image/a.svg`), a path suffix (`guide/a.md`), a file name (`a.md`). A relative or suffix spelling is what an author writes inside one folder; the source path is what crosses folders, roots and doc pages, and what the page writes itself (a created file, a dependency). How each spelling finds its file, and why the local doc page always comes first, is specified in [link recognition and target resolution](doc_page_impl_nav.md#link-recognition-and-target-resolution).

## Source rules and collection

The `source` of a document yaml file is an ordered rule list (see [The document entry](doc_page_impl_side_panel.md#the-document-entry)). The add rules define the roots of the doc page and say how they collect:

```yaml
rules:
  - action: addFolder
    alias: example              # the root; the folder name when absent
    path: .
    collect: recursive          # required: recursive | direct | referenced
  - action: addFile
    alias: req
    path: ../main/doc_page_req.md
  - action: addFolder
    alias: example              # the same root: a folder inside it, collected differently
    path: ./mdx-usage/image
    collect: referenced
  - action: removeByPath
    pattern: "~example/sub-doc/**"     # a glob over the source path, local to this doc page
```

`collect` declares what the folder's files are to the page:

| Mode | Files below the folder | Are pages | In a build |
| --- | --- | --- | --- |
| `recursive` | every file, in every subfolder | yes | kept (pruned by the side panel like before) |
| `direct` | the files right in the folder | yes | kept |
| `referenced` | every file, in every subfolder | no | kept only when used |

A **page** is a document the page can show and the side panel can bind (`doc`, `sourceFolder`, `sourceRoot`); the page tree and the search skip `referenced` files. A `referenced` file is **collectable**: it is in the manifest with `collect: referenced`, so a link, a component or an asset can name it and the page resolves and serves it, but a deployment build keeps it only when something uses it: a document retained by [pruning](doc_page_impl.md#source-pruning-for-deployment) reaches it, a component names it (the attachment scan), or an [asset version depends on it](doc_page_impl_asset.md#dependencies). This is how a folder of images or of files the page itself creates is part of the source without being a set of pages.

A root alias names one folder on disk in its doc page: the first add rule with the alias fixes it (for `addFile`, the folder of the file), and a later rule with the same alias names a folder inside it and sets the collect mode of that part; a rule naming a folder outside it under the same alias is an error, as is an alias that is not one word. The source paths of both are relative to the root folder, so the second rule above collects `~example/mdx-usage/image/a.svg`, the same name the first rule would give it; a file collected by two rules takes the later one. The former key `rootId` is still read as `alias`, with a warning. `removeByPath` patterns are globs over the whole source path, written in the local form and applied in the full form of the doc page the rule belongs to (every rule carries `docPageAlias`, set by the loader); `removeByName` over the file name. Tag and config rules apply to the files collected so far, as before, their `ByPath` patterns likewise.

### Excluding files and folders

An `addFolder` rule can leave files and folders out with `exclude`, a list of patterns written the way a `.gitignore` is, or the same lines as one block:

```yaml
- action: addFolder
  alias: example
  path: ..
  collect: recursive
  exclude:
    - "*.pyc"            # a name: matched at any depth, files and folders
    - .DS_Store
    - sub-doc/           # a trailing "/": folders only, with everything below
    - /draft.md          # a leading "/": only right in the rule's folder
    - comp-mdx/**/*.js   # a "/" inside: a path from the rule's folder
    - "!keep.pyc"        # "!": collected again, when an earlier pattern excluded it
  # or:  exclude: |
  #        *.pyc
  #        sub-doc/
```

A pattern is matched against the path from the rule's folder (not the source path, so a rule reads the same whatever its alias): `*` is any text but `/`, `?` one character but `/`, `[a-z]` one of a set (`[!a]` not in it), `**` any folders (`**/x` at any depth, `x/**` everything inside, `a/**/b` zero or more folders between), `\` takes the next character as it is (`\#a`, `\!a`); blank lines and lines starting with `#` are skipped. The last pattern that matches decides. As in git, an excluded folder is not entered, so `!` cannot bring back a file inside it, and the folder is not in the folder manifest either. An exclusion belongs to its rule: a later rule of the same root collects its own folder with its own patterns. The patterns are checked when the entry loads (`excludePatternTextListRead`, a wrong one stops the page with its place) and matched while the folder is walked (`excludeMatcherBuild`, `plugin/doc-source-exclude.ts`).

`exclude` keeps a rule's folder clean of what never belongs to the source (build output, caches, another doc page's folder); the remove rules remain for removing, by source path or by name, what the rules so far collected, across rules and roots.

### The folders a doc page keeps out by convention

Some folders of a doc page are never documents whatever rule collects the folder around them, so no `exclude` pattern is needed for them ([the doc page folder](doc_page_impl_dir.md)): the metadata folder `.doc-page/` (the configuration files, their `.bak` backups); the asset folders (`.doc-page/asset.yaml`, or `asset/`, [asset service layer](doc_page_impl_asset.md)); the service folders (`.doc-page/service.yaml` with `templateFolderList` / `instanceFolderList`, paths relative to the file, `kind` app by default, or the four convention folders `service-template-app/`, `service-template-infra/`, `service-app/`, `service-infra/`; the entry may say `service: { file }` or `service: false`; `plugin/doc-service-server.ts`, read the same way by the backend) together with the plain folders of the backend config `config.yaml` names; and the component folders (`.doc-page/comp.yaml` `folderList`, or `comp-mdx/`; `comp: { file }` / `comp: false`; `plugin/doc-comp-config.ts`, [components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)). Every doc page the page loads brings its own, included ones and temporary mounts too. The scan, the folder manifest and the file watcher apply one set (`sourceExcludeGet` in `plugin/doc-source.ts`): a file of these folders is not collected, not listed, and a change in it never reloads the page (an asset object written, a database of a service instance, a dashboard rebuilt, a component module, which vite's own hot module replacement handles); the config files themselves and the component manifests are configuration, whose change regenerates the manifest of the page.

A file entry of the manifest is `{ docPageAlias, rootAlias, relPath, name, ext, internalPath, collect, title, contentHash, tagList, configSource, configFrontmatter, load }`; `internalPath` is the full source path. The **folder manifest** (`dirManifest`) lists the folders of the source, `{ docPageAlias, rootAlias, relPath, internalPath, collect }`: for every `addFolder` rule its folder and, for a recursive or referenced rule, every folder below it, minus what `removeByPath` rules cover. It is what path completion offers and where files can be created.

## The workspace

`config.yaml` names what the page serves in one of two ways, exactly one of them:

```yaml
# a workspace: its root-level doc pages, in a workspace file (or the same mapping in place)
workspace:
  file: ./workspace.yaml

# one doc page: a virtual workspace holding it alone (the former form, kept)
docEntry:
  dir: ../example_doc       # its folder (the entry is found in .doc-page/), or file: its entry file
  alias: example            # optional: its alias; the folder name when absent
  sidePanel: compact        # optional: one of its side panels instead of its default
```

### The workspace file

```yaml
# workspace.yaml: paths relative to this file; by convention at the root of the project
title: My Site                      # optional page values, over those of the first doc page's entry
homeDoc: ~guide:guide/overview.md   # a full source path, or a local path of the first doc page
homeItem: ...
docPageList:                        # the root-level doc pages, in side-panel order; at least one
  - alias: guide                    # unique in the workspace; the folder name when absent
    dir: ../guide                   # the doc page folder, or file: its entry file (exactly one)
    sidePanel: main                 # optional: the side panel shown for it
  - alias: api
    dir: ../api
    isRootVisible: false            # optional: the sole wrapper item of its side panel shows its
                                    # children only, without a row (a yaml boolean, never "false")
```

`isRootVisible` is an option of the mount, not of the entry: the same doc page can be shown with its root row in one workspace and without it in another. What it does, and what it never does, is in [the root row hidden](doc_page_impl_side_panel.md#the-root-row-hidden); `docEntry` of `config.yaml` takes it as well.

Loading a workspace (`docWorkspaceLoad`, `plugin/doc-entry.ts`) registers every root-level doc page under its alias first, then loads each entry with everything it reaches ([loading](doc_page_impl_side_panel.md#loading)): the source rules of every doc page, in order, each rule carrying the alias of its doc page; the tag definitions; the config declarations, stacked so that a root doc page decides over what it includes (the first root doc page last); and every side panel. The page shows, with one root doc page, that doc page's chosen side panel, exactly as before; with several, one **section** per root doc page: its alias as a muted heading, its side panel below at the depth of the tree's root, so its items look as they do when the doc page is served alone; the doc pages keep their side panels and the workspace only arranges them (a side panel of the workspace's own is a later addition). The tree node of a section carries `docPageSection` (`{ alias, title, isTemporary, isFirst }`); what the side panel does with it is in [a workspace of several doc pages](doc_page_impl_side_panel.md#a-workspace-of-several-doc-pages). `siteTitle`, `homeDoc` and `homeItem` come from `config.yaml`, else the workspace file, else the first root doc page's entry.

### Doc pages reached by includes

A doc page's side panel includes another doc page through an `include` naming its folder or entry, and the reference gives the included doc page its alias: `include: { dir: ../sub-doc, alias: sub }` ([including other side panels](doc_page_impl_side_panel.md#including-other-side-panels)). The included doc page joins the workspace: its rules, tags, config and asset folders come along, and its files are `~sub:sub-doc/...` to every other doc page. Giving the alias is recommended for every include of a doc page; without it, the folder name stands in, like for a root.

A doc page is **one thing however often it is reached**, identified by its entry file: the same folder included by two side panels, or listed in the workspace and included as well, loads once, and every reference to it is a *mention* recorded on it. Its alias is the one of its first mention, and root-level mentions come first, so the workspace file decides over any include: a mention under another alias is reported (a warning in the console and in `workspace.warningList`, drawn in the [Workspace tab](#the-workspace-tab)) and ignored, so exactly one alias is valid for a doc page. Two different doc pages under one alias, or an alias that is not one word, stop the page from loading with the two places named. A doc page naming its own entry (a side panel of its own included from a resource file) is not a mention.

Its side panel is shown once as well: at its mount when it is a root doc page, else at the first include reached; every later include is shielded from the side panel shown, with its subtree, while the mention, the rules and the graph edge stay ([one effective occurrence per doc page](doc_page_impl_side_panel.md#one-effective-occurrence-per-doc-page)).

### What the page receives

`configDoc.workspace` describes the workspace as data, with every path relative to the config directory:

```text
workspace
  isVirtual        config.yaml named one doc page
  title
  file, fileHash   the workspace file (relative to the config directory, '' when there is none) and the
                   hash of the version loaded, which an edit is built on
  itemList         its docPageList as written: [{ alias?, dir?, file?, sidePanel?, isRootVisible? }],
                   paths relative to it
  dirBaseAbs       the folder relative paths of the workspace are read from (the file's, else the config
                   directory), where os path completion starts
  docPageList      [{ alias, entryFile, dirPage, title, isRoot, isTemporary,
                      rootList [{ alias, path, kind }],
                      mentionList [{ alias, isAliasGiven, fromAlias, file, place }] }]
                   the root doc pages first, then the included ones in order of first loading
  includeList      every mention as an edge: { fromAlias ('' for the workspace), toAlias, alias,
                   isAliasGiven, file, place }
  warningList      the alias conflicts, as the console reports them
```

`configDoc.docEntry` still carries what runtime code reads of the first root doc page: its entry `file` and `alias`, the side panel shown, `sidePanelIdList`, `configDeclarationList` (each declaration with its `docPageAlias`) and `fileHashByFile`. Every side-panel node carries `docPageAlias`, the doc page it is written in, with its `doc` / `sourceFolder` paths already in the full form, and a node including a doc page has `includeSource.docPageAlias`. The plugin keeps the loaded doc pages (`docPageList`, absolute, not sent to the page, each with its entry's `asset`, `service` and `comp` sections as written) for the asset service layer, which names every folder in the full form, for the service folders and the sync route of the service backend, and for the components of the doc pages (`compConfig`, their mounts; `configDoc.compRegistry` carries their tag names).

### The Workspace tab

The settings panel has a **Workspace** tab (`comp-doc/settings/WorkspaceSettings.jsx`) that draws the workspace with React Flow: a node for the workspace (marked virtual when `config.yaml` named one doc page), a node per doc page (alias, title, folder, the number of roots and of mentions, a "root" badge), and an edge per mention, from the workspace or from the doc page whose file holds the include, labeled with the alias that mention gives. Two mentions of one doc page are two edges into one node, which is how the de-duplication is seen; a mention whose alias is not the one kept is a dashed amber edge with an "alias conflict" badge on the node, and the warnings are listed under the graph. Choosing a node shows its folder, entry, roots (`~page:root → folder`) and mentions, the ignored ones marked. The graph is laid out by depth (the workspace, the root doc pages, then the doc pages reached by includes) and the nodes can be dragged; Reset layout puts them back. The model is `lib/doc-workspace-graph.js` (`workspaceGraphBuild(workspace)`: nodes with positions, edges, warnings), the state `store/DocWorkspaceStore.ts` (the graph derived from `configDoc.workspace`, the node chosen, the positions dragged to), so the view only renders.

Above the graph the tab edits the workspace and mounts doc pages, both described below.

### Editing the workspace file

The tab lists the doc pages of the workspace file in their order (`workspace.itemList`): the alias, whether the doc page is named by its folder or its entry file, the path, the side panel. On the development server each field is edited in place, a doc page moves up or down, is removed (never the last one) or added. The list is **locked** whenever the page opens (`DocWorkspaceStore.isFileLocked`, a state of the page only, written nowhere), so a click by mistake never rewrites the workspace; a workspace without a file of its own (written in `config.yaml`, or a virtual one) is shown and not edited, with the reason.

Every change is one request of the edit api, `POST {edit}/workspace/edit` `{ request, hashBase }`, built by `workspaceEditBuild` (`plugin/doc-workspace-edit.ts`) with the [yaml utilities](doc_page_impl_yaml_utils.md): the line of a field is rewritten (a field set to nothing loses its line), switching `dir` / `file` renames the key on its own line, an item moves with its comment lines, so the rest of the file stays as the author wrote it:

| `request.action` | Fields |
| --- | --- |
| `itemFieldSet` | `index`, `field` (`alias` \| `sidePanel`), `value` (`''` removes the key) |
| `itemPathSet` | `index`, `kind` (`dir` \| `file`), `value` |
| `itemRootVisibleSet` | `index`, `isRootVisible` (a boolean: `false` writes the key, `true` removes it); the "root row" checkbox of an item |
| `itemAdd` | `item { alias?, dir \| file, sidePanel?, isRootVisible? }`, at the end |
| `itemRemove` | `index` |
| `itemMove` | `index`, `indexTo` (its place afterwards) |
| `titleSet` | `value` (`''` removes it) |

`hashBase` is `workspace.fileHash`: a file changed since is refused (-2). After the write the configuration is loaded once and the file is written back when it does not load (an alias taken, a folder without an entry), with the reason; otherwise the new workspace reaches the page as data, as every configuration write does. Paths are typed with [os path completion](#os-path-completion), starting at the folder of the workspace file.

### Temporary doc pages

A doc page can join the workspace **for now**: mounted from the tab by its folder or its entry file (and an alias, else the folder name), it is one more root doc page after those written, with its section in the side panel (marked "temporary") and its node in the graph, but it is written in no file. The development server holds the list (by config file, in `plugin/doc-source.ts`) and adds it to the workspace every time the configuration loads, so it lasts as long as the server runs. A mount that does not load (the doc page is a root already, its alias is taken) is refused and forgotten.

| Route of the source api | Answer |
| --- | --- |
| `POST /workspace/mount` `{ kind: 'dir' \| 'file', path, alias?, sidePanel? }` | `{ alias }` of the doc page mounted; `-3` no entry there, `-1` the workspace would not load |
| `POST /workspace/unmount` `{ alias }` | the temporary doc page leaves the workspace |

The path is absolute, `~/…` (the home folder), or relative to the folder of the workspace file. A mention of a temporary doc page has the place "a temporary mount" in the warnings.

### OS path completion

A path outside the source (a doc page folder anywhere on the computer the development server runs on) is typed with **os path completion**: the counterpart of [path completion](#path-completion), for the file system. The page cannot hold a picture of the whole file system, so the folder typed so far is listed by the server as the text changes:

```text
GET {source}/os/list?path=~/proj/      -> { dirPath, entryList [{ name, kind: 'dir' | 'file', isDocPage }], isTruncated }

text  ~/proj/react-d        folder ~/proj/ listed, names starting with "react-d" offered
      ~/proj/react-doc/     a folder ends with "/": choosing it continues into it
```

The listing holds the folders first, then the files, by name, at most 400 entries; a folder holding `.doc-page/entry.yaml` is marked as a doc page. `lib/doc-os-path-complete.js` keeps the logic apart from the view: `OsPathCompleter` (one per page, `DocSourceStore.osPathCompleter`, undefined in a build) fetches one listing per folder text and keeps it for 15 seconds, shared by every field, with several requests for one folder sharing one fetch; `completeGet(text, spec)` computes the candidates from **the text as it is now** and the listings at hand, so the answer to a request made for an earlier text (another folder) never shows for the current one: it only fills the cache, and the field says "listing…" until its own folder arrives. The specification is `{ kind: 'dir' | 'file' | 'any', extList? }`; folders are always offered, since they lead to files. Hidden entries show once their dot is typed.

`OsPathInput` (`comp-doc/source/`) renders it like `SourcePathInput`: an `EditValueInline` with the dropdown in `document.body` under the text, listed a moment (120 ms) after the typing pauses; choosing a folder fills the text and lists that folder, choosing a file commits it, Tab takes the highlighted (or only) candidate, Enter or leaving the field commits the text. The Workspace tab uses it for the paths of the workspace file and of a mount.

## The source api

The development server answers `{base}/__doc-source` (exported as `docSourceEndpoint`; `''` in a build):

| Route | Answer |
| --- | --- |
| `GET /file?path=~page:root/a.md` | the current text of a collected file, `text/plain`, never cached (the page reads documents through it in development) |
| `GET /data?path=~page:root/image/a.png` | the bytes of a collected file with their mime type, binary or text |
| `POST /file/create` `{ dirPath, name, text \| dataBase64, isOverwrite? }` | writes a file into a folder of the source; `{ code: 0, data: { path, entry } }`, `-1` invalid, `-2` the file exists, `-3` the folder is not collected by any rule |
| `GET /os/list?path=` | a folder of the file system, for [os path completion](#os-path-completion) |
| `POST /workspace/mount`, `/workspace/unmount` | [temporary doc pages](#temporary-doc-pages) |

A file the page creates joins the manifest at once: the plugin remembers the path it just wrote, and when the file watcher reports the new file, the source data is sent to the page without a full reload (`doc-source-change`), so the page keeps its state and the new entry appears. Every path in the api is a source path, the full form; a folder in the local form is accepted for creation when exactly one doc page has the root. A folder is accepted for creation only when a folder rule of the same root collects it (inside a recursive or referenced folder, or the folder of a direct rule itself).

The development server also tells the service backend which doc pages the page has loaded: `POST {base}/__doc-service/registry/docpage/sync` is answered by the plugin itself, under the forwarded service api ([the Vite plugin](doc_page_impl_service.md#the-vite-plugin)). The request body is ignored; the plugin builds `{ docPageList: [{ alias, dir, serviceFile }] }` from the workspace as it is loaded at request time (root doc pages, included ones and temporary mounts; a doc page with `service: false` is left out), `dir` the absolute doc page folder and `serviceFile` the absolute service config file when the entry names one or `.doc-page/service.yaml` exists, `''` otherwise, forwards it to the backend's route of the same name and answers the backend's answer (`{ code: -5 }`, http 503, when the backend is down). `DocServiceStore` calls it when the backend comes up and after the workspace changes, so the backend's registry follows the Workspace tab.

## Files in a build

A build has no api. The bytes of the files that are used are bundled as data urls and exported as `fileUrlByPath`, keyed by source path (and by the spelling a document used, for a file found beside the document on disk but not collected): the binary files of the manifest that survive pruning, the files the attachment finders see components name (`collectComponentAttachmentsOnBuild`, see [Build-only component attachment collection](doc_page_impl.md#build-only-component-attachment-collection)), and the source files the asset versions depend on. `DocSourceStore.fileUrlGet` answers from this map in a build, and from the `/data` route in development, so a component never sees the difference.

## The page side: DocSourceStore and the service object

`DocSourceStore` holds the source as the page reads it: `configDoc`, `fileManifest`, `dirManifest`, the raw texts and compile results, the structured data for search. It receives the source api endpoint and `fileUrlByPath` from `DocPageMdx` (`config.source.endpoint`, `data.fileUrlByPath`). Beside the reading methods it offers the **service object** of this layer, a stable object handed to every registered component as `config.source`:

| Method | Meaning |
| --- | --- |
| `isWritable()` | the source api answers: files can be created (development server) |
| `fileResolve(reference, fromPath)` | the one file entry a reference names (source path, relative, suffix, name), the doc page of `fromPath` first, or undefined |
| `fileUrlGet(reference, fromPath)` | the url the bytes of the file are read from (build map, or the `/data` route); undefined when unknown |
| `dirListGet()` | the folders of the source |
| `pathComplete(text, spec)` | the candidates `{ path, kind, entry }` that complete what is typed, filtered by the [specification](#path-completion): an empty text lists everything, a rooted text matches by prefix, another text anywhere in the path |
| `pathTreeGet(spec)` | the same candidates as a tree, for browsing instead of typing ([browsing as a tree](#browsing-as-a-tree)) |
| `fileNameUniqueGet(dirPath, name)` | a file name not used in the folder yet (`a.png`, `a-2.png`, ...) |

Beside the service object the store knows the workspace: `docPageList` (`configDoc.workspace.docPageList`), `docPageGet(alias)`, `docPageAliasMain` (the first root doc page, whose roots a local path written in the page itself, such as a config value in the settings panel, is taken from), `docPageAliasOfPath(path)`, and `pathFullGet(path, fromPath?, docPageAlias?)`: a local path as one of the doc page of `fromPath` or of the alias given, else of the main doc page when it has the root, else of the only doc page that has it. `sourceIndex` is the set of indexes a target is resolved with (by full path, by local path, by name), built by `sourceIndexBuild` of `lib/doc-target-resolve.js`.

`config.assetUrlGet`, which `Image`, `ImageGrid` and `DiagramMermaid` call with the references in their data, is `fileUrlGet` bound to the component's document by default (`RegisteredComp`); a host application may still hand its own through `compConfigHost.assetUrlGet`.

### Path completion

A **source path specification** says what a path names, so completion lists the right candidates. It is declared where a path is declared: a config key of type `sourcePath` carries `pathSpec` (see [component-level config](doc_page_impl_config.md#component-level-config)), and the location prompt completes folders. The specification is a plain object; every field but `kind` is optional, and a field left out does not filter:

```text
kind        'dir' | 'file' | 'any'   folders, files, or both (a mixed list tells the kind of each candidate)
extList     ['.png', '.jpg']         files with one of these extensions (the dot optional, case-insensitive)
rootList    ['example', '~sub:sub-doc']   under these roots only: a root alias (that root of any doc page) or a full root path
dirPath     '~example/asset'         under this folder only
isMatch     (candidate) => boolean   anything else, decided by the caller
```

The logic lives in `lib/doc-source-complete.js`, apart from the store: `sourcePathCandidateListBuild(spec, manifests)` turns the file and folder manifests into the allowed candidates `{ path, kind, entry }`, `sourcePathCompleteList(text, spec, manifests)` narrows them to what is typed. A new way of narrowing is one more field read there, and every path field of the page gets it.

The page renders completion with its own element, `SourcePathInput` (`comp-doc/source/`): an `EditValueInline` holding the path, shown and committed in the full form (a value written `~root/path` in a doc page's file shows as `~page:root/path` of that doc page, `docPageAlias`, and is written again only when edited), since a workspace holds several doc pages and the full form is exact wherever the value is read, and a dropdown of the candidates from `pathComplete`, moved through with the arrow keys; it is not the browser's datalist. The dropdown is rendered into `document.body` at a fixed position under the text, not inside the field, because the field usually sits in a clipping container (every item of the settings panel hides its overflow) where a list placed inside would be cut off; it follows the text when the page scrolls. Leaving the field commits, including a click outside it; a click on a candidate takes it before the field is left. An empty field shows its placeholder. With `isMissingWarned`, a warning icon before the path says when the text shown, also while it is typed, names nothing of the specification's kind in the source (`pathMissingWarningGet(text, spec, docPageAlias)` of `DocSourceStore`, read from the manifests, so it costs nothing per keystroke; a local path is one of the doc page given by `docPageAlias`, the declaration's doc page in the settings panel, else of the main doc page); the icon keeps its place when hidden, so the warning never moves the text. The settings panel uses it for `sourcePath` keys (the path ends at the right of the value column), the location prompt for the folder.

### Browsing as a tree

The same candidates can be chosen from a tree. `sourcePathTreeBuild(spec, manifests)` (`lib/doc-source-complete.js`, `pathTreeGet` of the service) arranges them as nodes `{ id, label, kind, isDisabled, childList }`: one node per root (`~page:root`), its folders, the files in them, folders first, each sorted by name. A folder that only leads to candidates (the specification asks for files, or for paths inside another folder) is a node too, and disabled.

`SourceTreeSelect` (`comp-doc/source/`) renders such a tree and only selects: a node is chosen by a click or the arrow keys (ArrowRight / ArrowLeft open, close, or go to the child or parent; Enter or a double click activates), a disabled node opens but is never chosen and says why in its title, and what the chosen node means is the caller's. The node shape is not bound to the source: `kind` picks the icon (a folder, a separator, anything else a file), `badge` is a small tag before the label (`badgeKind: 'component'` tints it), and `detail` is a muted note after the label, so another tree of the page can be shown the same way. The move picker of the side panel shows the items of the side panel ([moving an item](doc_page_impl_side_panel.md#moving-an-item)), the place picker of a paste or a copy the blocks of a document ([choosing where the blocks go](doc_page_impl_block_ops.md#choosing-where-the-blocks-go)).

A tree can be **searched**: given `searchText`, `SourceTreeSelect` shows only the nodes whose label holds every word of it (case-insensitive), with the folders that lead to them, open, and highlights the matched parts of each label (`<mark class="doc-source-tree-match">`, a yellow ground). The narrowing is `sourceTreeSearch(nodeList, text)` (`lib/doc-source-complete.js`): it returns the narrowed tree, every node kept carrying `labelMatchList` (the matched ranges of its label), and the folders to open. It works on the node shape, so any tree shown by `SourceTreeSelect` can be searched. Folders opened or closed while searching are forgotten when the search changes; an empty search shows the tree as it was browsed.

### Choosing a path

Typing and browsing are one field of the page: `SourcePathPicker` (`comp-doc/source/`) is the path with completion (`SourcePathInput`) above the same candidates as a tree (`SourceTreeSelect` over `pathTreeGet`), both read from one specification, so what can be typed is what can be browsed. It only shows and reports: `value` is the caller's, `onSelect(path)` comes from a committed text or a chosen node, `onActivate(path)` from a double click or Enter in the tree ("this one, go on"), and `message` is the caller's word on why the value cannot be used. The tree is always shown, or folded behind a browse button (`isTreeCollapsible`). Above the tree a search field narrows it by name ([searching a tree](#browsing-as-a-tree); `isTreeSearchable`, on by default): Enter or ArrowDown in it chooses the first match and moves into the tree, Escape clears it (and is not passed on to the dialog around the picker).

```text
[label] [~example:example/mdx-doc-edit-in-place.md] [⌸]   ◄ browse button: isTreeCollapsible only
[🔍 edit                                  ×]       ◄ search: isTreeSearchable
▾ 📁 ~example:example
    🗎 [edit]-in-place.md                        ◄ the value, selected; the match highlighted
message
```

Every place that asks for a path uses it with its specification: the location prompt of a new file a folder (`{ kind: 'dir' }`, tree folded), the copy / move dialog a document (`{ kind: 'file', extList: ['md', 'mdx'] }`, [copying and moving blocks](doc_page_impl_block_ops.md#the-dialog)).

## Creating files

A component that holds bytes to keep, such as an image pasted into `Image`, does not write them itself. It reports the request through the event layer, and the **source route** answers it from `DocSourceFileStore`:

```text
fileCreateRequest { name, blob | text, dirPath, isLocationCustom, anchorElement? }
  -> { code: 0, data: { path, entry } } | { code: -1, message }
```

`dirPath` is the folder, a source path, usually from the component's own config (`Image` reads `compConfig.FileStoreDir`); in the local form it is a root of the doc page of the document the request comes from (`source.sourcePath` of the event). `isLocationCustom: true`, or a `dirPath` that is not a source path, opens the **location prompt** (`SourceFilePrompt`): a floating panel with the folder (a [`SourcePathPicker`](#choosing-a-path) of the folders of the source, its tree behind the browse button), the file name, Create and Cancel. The prompt stays open while the file is written, shows a failure in place so another folder can be tried, and answers the request with a failure when dismissed. The name is made unique in the folder (`fileNameUniqueGet`) before the file is written; the answer carries the source path of the new file, which the component then puts into its data through the edit layer (`dataReplaceRequest`, see [component awareness](doc_page_impl_mdx_comp.md#component-awareness)).

**Where the prompt is.** A request may name an `anchorElement`, the element of the component the file is for (`Image` gives its figure): the prompt is then rendered into that element, absolutely positioned a little inside its top left corner and never wider than it, so it moves with the component when a container or the page scrolls, without any recomputation on scroll. Without an anchor the prompt floats at the pointer position of the request, or at the top center of the page. The element is browser state of the prompt only (`DocSourceFileStore.prompt.anchorElement`, kept by reference): the write request carries the folder, the name and the bytes, nothing else of the event. `Image` hides its own "saving" status while the prompt is inside it (`.doc-image:has(> .doc-source-prompt)`), so the pending message is not shown twice; a direct save without a prompt keeps that status.

**The prompt belongs to the editor that asked.** While an author uses the prompt, the editing session of the component (the field editor of an `Image`, the grid of an `ImageGrid`) must stay open: the created path is answered to that session's draft. The prompt therefore carries the edit layer's popup marker (`doc-edit-popup`, [use-edit-outside-pointer.js](doc_page_impl_edit.md#editing-primitives)), and so does the folder suggestion list that `SourcePathInput` portals to the body, so a pointer in either is not a click outside the session; the prompt's own pointer-outside cancellation also treats a pointer in that list as its own. A genuine click elsewhere still leaves the editor and cancels the prompt, as before; nothing is suppressed globally and nothing auto-saves.

The two requests keep the component thin: it knows how to turn a clipboard into a file name and bytes, and how to write its own data with a new source; where the file goes, how it is written, and whether the data is a block of the document or a version of an asset are decided by the page.

## Code map

| Place | Role |
| --- | --- |
| `lib/doc-source-path.js` | the source path grammar: the local and the full form, aliases |
| `lib/doc-target-resolve.js` | every spelling of a target resolved to source paths, the local doc page first |
| `lib/doc-source-complete.js` | path completion: the specification, the candidates, the narrowing, the tree, searching a tree |
| `lib/doc-workspace-graph.js` | the workspace as a graph for the Workspace tab |
| `lib/doc-os-path-complete.js` | os path completion: the listings by folder, the candidates of the current text |
| `plugin/doc-source-exclude.ts` | the `exclude` patterns of an addFolder rule |
| `plugin/doc-workspace-edit.ts` | a change of the workspace file as line operations |
| `plugin/doc-sidebar-effective.ts` | the side panel shown: one effective occurrence per doc page, the root row of a mount hidden |
| `plugin/doc-entry.ts` | the workspace and its doc pages: `docWorkspaceLoad`, `docEntryLoad` (a virtual workspace), aliases, mentions, root aliases of the rules |
| `plugin/doc-source.ts` | `config.yaml` workspace / docEntry, temporary doc pages, rules, collection, the folders kept out by convention, folder manifest, source api (os listing, mounts), module generation (the component mounts included) |
| `plugin/doc-service-server.ts` | the service folders of a doc page (`SERVICE_CONFIG_FILE_NAME`, `SERVICE_FOLDER_DEFAULT_LIST`), the forwarded service api and its sync route |
| `plugin/doc-comp-config.ts` | the component folders of a doc page (`COMP_CONFIG_FILE_NAME`, `COMP_FOLDER_DEFAULT_LIST`) and their `comp.yaml` manifests |
| `plugin/doc-attachment.ts` | the files components name, the mime types, the data urls of a build |
| `store/DocSourceStore.ts` | the source as the page reads it, the doc pages, the service object (`config.source`) |
| `store/DocSourceFileStore.ts` | file creation requests, the location prompt |
| `store/DocWorkspaceStore.ts` | the graph of the Workspace tab, the node chosen, the positions; the lock, edits of the workspace file, mounts |
| `comp-doc/source/SourcePathInput.jsx`, `SourceTreeSelect.jsx`, `SourcePathPicker.jsx`, `SourceFilePrompt.jsx` | the path input with completion, the tree view, the two as one path picker, the location prompt |
| `comp-doc/source/OsPathInput.jsx` | a path of the file system with completion |
| `comp-doc/settings/WorkspaceSettings.jsx` | the Workspace tab of the settings panel |
| `workspace.yaml` (the project root) | the workspace of the demonstration: the root doc pages `example` and `second` |
