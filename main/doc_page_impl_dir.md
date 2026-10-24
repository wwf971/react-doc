<!-- The recommended folder structure of a doc page. Parent document: doc_page_impl.md -->

# The Doc Page Folder

A doc page is self-contained: the documents it shows and the files that describe it (its entry, source rules, side panels, tags, config) can all live in one folder, and that folder is what another page includes and what a deployment names. This document describes the recommended layout of such a folder. It is a convention: the page reads any layout an entry file describes, but a folder laid out this way is found by its folder alone and reads the same everywhere.

The idea is the one of an Obsidian vault. A vault is a plain folder of notes, and everything the application keeps about the vault sits in one hidden folder, `.obsidian/`, beside the notes. A doc page folder keeps its documents as plain files and its metadata in `.doc-page/`.

## Layout

```text
my-doc/                          the doc page folder: give this to config.yaml (docEntry.dir) or to an include
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
- **The rest of the folder** is content: documents, images, the folders of the asset store and of the service backend. A metadata file names them by paths relative to itself, so the doc page folder is `..` from `.doc-page/`; the asset folders are named by source path instead (`~my-doc/asset`), relative to a root of the doc page.

### Asset folders

A doc page laid out this way needs no asset configuration: its objects live in `asset/` of its folder, named `~rootId/asset` by the root that collects the folder, and `.doc-page/asset.yaml` is created by the settings panel the first time its folders are changed. To keep objects elsewhere, or in several folders, the doc page writes that file itself ([which folders a doc page declares](doc_page_impl_asset.md#which-folders-a-doc-page-declares)). An included doc page brings its asset folders along, whichever way it is included, so its asset blocks resolve inside the page that includes it; an object created from one of its documents goes to its own default folder.

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
# config.yaml: the doc page the package shows
docEntry:
  dir: ../my-doc              # or  file: ../my-doc/.doc-page/entry.yaml  (exactly one of the two)

# a side panel node: another doc page included as a folder of the side panel
- id: sub-page
  include: ../sub-page        # relative to the file holding it, here .doc-page/side-panel.yaml
```

`configDoc.docEntry.file` is the entry file found, so everything after loading sees one entry file whichever way it was named. The grammar of the entry and of the files it reaches is the subject of [The document entry](doc_page_impl_side_panel.md#the-document-entry).

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
    rootId: my-doc
    path: ..                  # the doc page folder
    collect: recursive
  - action: removeByPath      # a sub doc page collects itself
    pattern: "~my-doc/sub-page/**"
```

This is only a convention. A small doc page may keep everything inline in its entry, as the sub document of the demonstration does, and several sections may share a file; the page reads both the same way.

## Doc pages inside doc pages

A doc page folder inside another one is a doc page of its own: it has its own `.doc-page/`, collects its own folder under its own root id, and is included by the outer page through a side-panel node naming its folder. The outer page's source excludes the inner folder (`removeByPath`), since the inner entry collects it. Included this way, the inner page brings its source rules, tag definitions and config declarations along, each below the outer page's own ([config of an included doc page](doc_page_impl_config.md#the-doc-page-layer)); deployed alone, it is named by its folder in `config.yaml`.

## The demonstration doc page

`example_doc/` follows the convention: its metadata is in `example_doc/.doc-page/` (an entry naming `source.yaml`, `tag.yaml`, `config.yaml` and `side-panel.yaml`, the side panels of two parts, `asset.yaml` naming its two asset folders `~example/asset` and `~example/asset-archive`, `service-backend.yaml`), and its sub document `example_doc/sub-doc/` is a doc page folder with its own `.doc-page/entry.yaml`, written inline. `main/config.yaml` names it as `docEntry: { dir: ../example_doc }`, and its side panel includes the sub document as `include: ../sub-doc`.

## Implementation

| Place | Role |
| --- | --- |
| `plugin/doc-entry.ts` | `DOC_PAGE_META_DIR_NAME` (`.doc-page`), `docEntryFileFind` (the entry of a folder), an `include` naming a folder, `docPageList` (every doc page loaded, for its asset folders) |
| `plugin/doc-asset-store.ts` | `ASSET_CONFIG_FILE_NAME`, `ASSET_FOLDER_DEFAULT_LIST`: the asset store config of a doc page and its defaults |
| `plugin/doc-source.ts` | `docEntry.dir` / `docEntry.file` of `config.yaml`; the source scan skips `.doc-page` (`dirNameSkipSet`) |
