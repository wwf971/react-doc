<!-- The recommended folder structure of a doc page. Parent document: doc_page_impl.md -->

# The Doc Page Folder

A doc page is self-contained: the documents it shows and the files that describe it (its entry, source rules, side panels, tags, config) can all live in one folder, and that folder is what another doc page includes and what a workspace names ([the workspace](doc_page_impl_source.md#the-workspace)). This document describes the recommended layout of such a folder. It is a convention: the page reads any layout an entry file describes, but a folder laid out this way is found by its folder alone and reads the same everywhere.

The idea is the one of an Obsidian vault. A vault is a plain folder of notes, and everything the application keeps about the vault sits in one hidden folder, `.obsidian/`, beside the notes. A doc page folder keeps its documents as plain files and its metadata in `.doc-page/`.

## Layout

```text
my-doc/                          the doc page folder: give this to a workspace file, to config.yaml (docEntry.dir) or to an include
├── .doc-page/                   the metadata of the doc page; never part of its source
│   ├── entry.yaml               the entry: what makes up the doc page, mostly naming the files below
│   ├── source.yaml              source rules (entry: source.file)
│   ├── tag.yaml                 tag definitions (entry: tag.file)
│   ├── config.yaml              config declarations and variables (entry: config, a { file } item)
│   ├── side-panel.yaml          the page side panel (entry: sidePanelById.main.file)
│   ├── side-panel-xxx.yaml      side panels of parts, included by side-panel.yaml
│   ├── asset.yaml               its asset folders (found here without being named; optional)
│   └── service-backend.yaml     the config of the service backend, when the page uses one
├── guide.md                     documents, in any folders
├── reference/
├── image/                       files the documents use (collected as "referenced")
├── asset/                       the asset objects of the doc page: its default asset folder
└── sub-page/                    another doc page, self-contained the same way
    ├── .doc-page/entry.yaml
    └── ...
```

What belongs where:

- **`.doc-page/`** holds the files that describe the doc page: the entry and every yaml file it names, and the config files of the services the page uses. The page writes some of them itself (a side-panel label, a moved item, a config value, the folders of the asset store), always in place and with a `{file}.bak` beside the file; backups stay in `.doc-page/` too and are ignored by git.
- **The rest of the folder** is content: documents, images, the folders of the asset store and of the service backend. A metadata file names them by paths relative to itself, so the doc page folder is `..` from `.doc-page/`; the asset folders are named by source path instead (`~my-doc/asset`, a root of the doc page by its alias), so that renaming the folder changes nothing inside it ([source paths](doc_page_impl_source.md#source-paths)).

### Asset folders

A doc page laid out this way needs no asset configuration: its objects live in `asset/` of its folder, named `~root/asset` by the root that collects the folder, and `.doc-page/asset.yaml` is created by the settings panel the first time its folders are changed. To keep objects elsewhere, or in several folders, the doc page writes that file itself ([which folders a doc page declares](doc_page_impl_asset.md#which-folders-a-doc-page-declares)). An included doc page brings its asset folders along, whichever way it is included, so its asset blocks resolve inside the page that includes it; an object created from one of its documents goes to its own default folder.

A folder named `.doc-page` is never part of the source, wherever it is: the source scan skips it like `.git` and `node_modules`, so a rule collecting the doc page folder recursively (`path: ..`) needs no rule to exclude its metadata.

## Finding the entry from a folder

Where a doc page is named, it can be named by its folder instead of its entry file. The entry is then the first match of:

```text
{folder}/.doc-page/entry.yaml
{folder}/.doc-page/xxx-entry.yaml    the only one there
{folder}/entry.yaml
{folder}/xxx-entry.yaml              the only one there
-> none, or several xxx-entry.yaml in one place: an error naming the folder
```

The last two keep a flat folder, with its entry beside its documents, usable by folder as well. A folder is accepted:

```yaml
# workspace.yaml: a root-level doc page of the workspace
docPageList:
  - alias: my-doc
    dir: ../my-doc              # or  file: ../my-doc/.doc-page/entry.yaml  (exactly one of the two)

# config.yaml: one doc page alone, a virtual workspace
docEntry:
  dir: ../my-doc
  alias: my-doc

# a side panel node: another doc page included as a folder of the side panel
- id: sub-page
  include: { dir: ../sub-page, alias: sub }    # relative to the file holding it, here .doc-page/side-panel.yaml
```

Wherever a doc page is named, it gets its **alias** there, the name its files carry in the workspace (`~sub:sub-page/guide.md`); the folder name stands in when none is given, and `alias` is recommended so that the folder can be renamed freely. `configDoc.docEntry.file` is the entry file found, so everything after loading sees one entry file whichever way it was named. The grammar of the entry and of the files it reaches is the subject of [The document entry](doc_page_impl_side_panel.md#the-document-entry).

## One file per section, by convention

Each section of an entry can be written inline or kept in a file of its own that the entry names. For a doc page of any size the recommended form is the second: the entry stays a short table of contents, and each concern has one file to open.

```yaml
# .doc-page/entry.yaml
docEntry:
  title: My Doc
  homeDoc: ~my-doc/guide.md
source:
  file: ./source.yaml
tag:
  file: ./tag.yaml
config:
  - file: ./config.yaml
sidePanelById:
  main:
    file: ./side-panel.yaml
```

```yaml
# .doc-page/source.yaml: paths relative to this file
rules:
  - action: addFolder
    alias: my-doc             # the root: its files are ~my-doc/... inside this doc page
    path: ..                  # the doc page folder
    collect: recursive
  - action: removeByPath      # a sub doc page collects itself
    pattern: "~my-doc/sub-page/**"
```

This is only a convention. A small doc page may keep everything inline in its entry, as the sub document of the demonstration does, and several sections may share a file; the page reads both the same way.

## Doc pages inside doc pages

A doc page folder inside another one is a doc page of its own: it has its own `.doc-page/`, collects its own folder under its own root alias, and is included by the outer page through a side-panel node naming its folder and its alias in the workspace. The outer page's source excludes the inner folder (`removeByPath`), since the inner entry collects it. Included this way, the inner page brings its source rules, tag definitions, config declarations and asset folders along, the config below the outer page's own ([config of an included doc page](doc_page_impl_config.md#the-doc-page-layer)); deployed alone, it is named by its folder in a workspace file or in `config.yaml`. Its roots may carry the same aliases as the outer page's: the doc page alias keeps them apart ([source paths](doc_page_impl_source.md#source-paths)).

## The workspace file

A deployment of several doc pages side by side is a workspace file, by convention `workspace.yaml` at the root of the project, which `config.yaml` names (`workspace: { file: ../workspace.yaml }` from `main/`); its grammar is in [the workspace file](doc_page_impl_source.md#the-workspace-file). It holds only the list of root-level doc pages with their aliases and the page values, never the content of a doc page, so a doc page knows nothing of the workspaces it is part of.

## The demonstration doc page

`example_doc/` follows the convention: its metadata is in `example_doc/.doc-page/` (an entry naming `source.yaml`, `tag.yaml`, `config.yaml` and `side-panel.yaml`, the side panels of two parts, `asset.yaml` naming its two asset folders `~example:example/asset` and `~example:example/asset-archive`, `service-backend.yaml`), and its sub document `example_doc/sub-doc/` is a doc page folder with its own `.doc-page/entry.yaml`, written inline. `workspace.yaml` at the project root names it as the first root doc page of the demonstration, under the alias `example` (`main/config.yaml` names the workspace file), beside a second one, `example_doc/second-doc/` as `second`; its side panel includes the sub document as `include: { dir: ../sub-doc, alias: sub }`, and its source rule excludes both folders (`exclude: [sub-doc/, second-doc/]`).

## Implementation

| Place | Role |
| --- | --- |
| `plugin/doc-entry.ts` | `DOC_PAGE_META_DIR_NAME` (`.doc-page`), `docEntryFileFind` (the entry of a folder), `docPageAliasDefaultGet` (the folder name), an `include` naming a folder with its alias, `docPageList` (every doc page loaded, with its alias and roots) |
| `plugin/doc-asset-store.ts` | `ASSET_CONFIG_FILE_NAME`, `ASSET_FOLDER_DEFAULT_LIST`: the asset store config of a doc page and its defaults |
| `plugin/doc-source.ts` | `workspace` / `docEntry` of `config.yaml`; the source scan skips `.doc-page` (`dirNameSkipSet`) |
| `workspace.yaml` | the workspace file of the demonstration, at the project root |
