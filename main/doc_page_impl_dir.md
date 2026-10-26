<!-- The recommended folder structure of a doc page. Parent document: doc_page_impl.md -->

# The Doc Page Folder

A doc page is self-contained: the documents it shows, the files that describe it (its entry, source rules, side panels, tags, config), the objects of its asset store, its own components, and its own service templates and instances can all live in one folder, and that folder is what another doc page includes and what a workspace names ([the workspace](doc_page_impl_source.md#the-workspace)). This document describes the recommended layout of such a folder. It is a convention: the page reads any layout an entry file describes, but a folder laid out this way is found by its folder alone, needs no configuration for its asset, component and service folders, and reads the same everywhere.

The idea is the one of an Obsidian vault. A vault is a plain folder of notes, and everything the application keeps about the vault sits in one hidden folder, `.obsidian/`, beside the notes. A doc page folder keeps its documents as plain files and its metadata in `.doc-page/`. What the convention adds to the vault is that a doc page can carry **code and running things** too: components that its documents use, and services that its dashboards show, each in a folder of a known name, mounted into the registry of its kind when the doc page is loaded.

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
│   ├── asset.yaml               its asset folders (found here without being named; optional: the convention otherwise)
│   ├── comp.yaml                its component folders (optional: comp-mdx/ otherwise)
│   ├── service.yaml             its service folders (optional: the four service-* folders otherwise)
│   └── service-backend.yaml     the config of the service backend, when the page is the one a backend is started for
├── guide.md                     documents, in any folders
├── reference/
├── image/                       files the documents use (collected as "referenced")
├── asset/                       the asset objects of the doc page: its default asset folder
├── comp-mdx/                    its components: comp.yaml manifests and the modules they name (never documents)
│   ├── comp.yaml                the components at the top of the folder
│   └── table/stock-table/       a group in a group: any folders, each may hold a comp.yaml
├── service-template-app/        its app service templates, {templateId}--{name}/      (never documents)
│   └── productivity/task/       a group in a group: any folder not named {templateId}--{name}
├── service-template-infra/      its infra service templates, {templateId}--{name}/, grouped the same way
├── service-app/                 its app service instances, {templateName}-inst-{serviceId}/
├── service-infra/               its infra service instances, created there or provisioned by the kernel
└── sub-page/                    another doc page, self-contained the same way
    ├── .doc-page/entry.yaml
    └── ...
```

What belongs where:

- **`.doc-page/`** holds the files that describe the doc page: the entry and every yaml file it names, and the config files of the services the page uses. The page writes some of them itself (a side-panel label, a moved item, a config value, the folders of the asset store), always in place and with a `{file}.bak` beside the file; backups stay in `.doc-page/` too and are ignored by git.
- **The rest of the folder** is content, in two senses: documents and the files they use, which the source rules collect; and the **managed folders** (the asset folders, the component folders, the service folders), which belong to the doc page but are never documents. A managed folder is found by its name, or named by its config file in `.doc-page/`; either way the source scan skips it, so a rule collecting the doc page folder recursively (`path: ..`) needs no rule to exclude it. A metadata file names the content by paths relative to itself, so the doc page folder is `..` from `.doc-page/`; the asset folders are named by source path instead (`~my-doc/asset`, a root of the doc page by its alias), so that renaming the folder changes nothing inside it ([source paths](doc_page_impl_source.md#source-paths)).

The three managed kinds follow one rule, **a convention with a config file over it**: the folder of the known name is used when nothing is said, the config file in `.doc-page/` names other or more folders, and the entry can name another config file (`asset: { file }`, `comp: { file }`, `service: { file }`) or say the doc page has none (`asset: false`, `comp: false`, `service: false`).

### Asset folders

A doc page laid out this way needs no asset configuration: its objects live in `asset/` of its folder, named `~root/asset` by the root that collects the folder, and `.doc-page/asset.yaml` is created by the settings panel the first time its folders are changed. To keep objects elsewhere, or in several folders, the doc page writes that file itself ([which folders a doc page declares](doc_page_impl_asset.md#which-folders-a-doc-page-declares)). An included doc page brings its asset folders along, whichever way it is included, so its asset blocks resolve inside the page that includes it; an object created from one of its documents goes to its own default folder.

### Component folders

A doc page's own components live in `comp-mdx/` of its folder: modules that define components with `compDefine()`, and `comp.yaml` manifests that say which tag name each one answers to and which registry id it has ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)). When the doc page is loaded, the development server reads the manifests, bundles the modules, and the page mounts every component into the component registry, so a document of the doc page writes `<StockTable />` or `<!--renderComp=StockTable-->` without the host application registering anything. To keep the components elsewhere, `.doc-page/comp.yaml` names the folders:

```yaml
# .doc-page/comp.yaml (paths relative to this file)
folderList:
  - ../comp-mdx
  - ../tool/comp
```

Inside a component folder the components may be grouped by function, a group inside another ([Groups](#groups-in-a-component-or-template-folder)).

The package's own components, the ones every doc page can use (`Tabs`, `Image`, `FileTree`, …), live in `built-in/comp-mdx/` of the project ([The built-in folder](#the-built-in-folder)); they are registered by the package itself, since the page depends on them, and a doc page's components come on top.

### Service folders

A doc page's own service templates and instances live in four folders of its own, by kind ([Where templates and instances come from](doc_page_impl_service.md#where-templates-and-instances-come-from)): `service-template-app/` and `service-template-infra/` hold templates (`{templateId}--{name}/service-template.yaml`), `service-app/` and `service-infra/` hold instances (`{templateName}-inst-{serviceId}/service.yaml`), the latter two being where an instance created from the Services tab goes, and where the service runtime kernel provisions an infra instance a service of the doc page requires. A folder that does not exist is empty, and made when something is created in it. `.doc-page/service.yaml` names other folders:

```yaml
# .doc-page/service.yaml (paths relative to this file; kind app when absent)
templateFolderList:
  - { path: ../service-template-app, kind: app }
  - { path: ../service-template-infra, kind: infra }
instanceFolderList:
  - { path: ../service-app, kind: app, isDefault: true }
  - { path: ../service-infra, kind: infra, isDefault: true }
```

The templates of a template folder may be grouped by function, a group inside another; the instance folders stay flat ([Groups](#groups-in-a-component-or-template-folder)).

The service backend reads the same file (or the same convention) when it mounts the doc page: the backend config names the doc page it is started for (`service-backend.yaml`, `docPageList`), and the page tells the backend about every other doc page it loaded, so a doc page included by another brings its services along the way it brings its asset folders. The instances of a doc page are **state**: an instance folder is a copy of a template with the instance's config, and for an infra service its data; an example doc page tracks the instances it demonstrates on purpose (an ignore file in `service-app/` listing them) and ignores what a run creates, in particular everything the kernel provisions into `service-infra/` ([Provisioning](doc_page_impl_service.md#provisioning)).

### Groups in a component or template folder

A component folder and a template folder (of a doc page, of a backend config, or of the built-in folder) may **group** what they hold in folders by function, and a group may hold groups in turn, to any depth (8 levels are read). A group is only a folder: it has no file of its own, declares nothing, and its name is free; it changes no name, id or reference of what it holds, so moving a component or a template from one group to another changes nothing for the documents and instances that use it.

- **Component folder**: every `comp.yaml` in the folder is read, at its top and in its groups at any depth, a folder before the folders inside it; a manifest beside groups does not end the search, so a group may list its own components and hold more groups. The entries of a manifest are relative to the manifest. `node_modules/`, `dist/` and dot folders are never read.
- **Template folder**: a folder named `{templateId}--{name}` is a template, and nothing inside it is read for templates; any other folder is a group and is read in turn. A folder that holds the files of a template (`service-template.yaml`, `service.py`) or contains `--` without being a valid template name is a misnamed template, reported by the scan and skipped, never taken for a group. Template names stay unique across the groups of all folders, since a template is referred to by its name. The registry reports the group of a template (`groupPath`, `connection/cloud`, `''` at the top), and the Services tab shows it on the template's card and sorts the cards by group.
- **Instance folders** are not grouped: an instance is created and provisioned by the backend, at the top of the instance folder of its kind.

```text
built-in/service-template-infra/
├── w55iiudjrez--logging/              a template at the top: groupPath ''
├── storage/w55iiudkmpr--sqlite/       groupPath storage
└── connection/                        a group of groups
    ├── cloud/      w4wsn192rpt--aws-connection/, w4wswvntoli--google-drive/
    ├── database/   w4wtnuwk115--postgres-connection/
    └── auth/       w4wt98cadnh--cognito-auth/
```

## The built-in folder

What the package ships beside the page is laid out like the managed folders of a doc page, in `built-in/` at the root of the project: `built-in/comp-mdx/` (the package's components), `built-in/service-template-app/` and `built-in/service-template-infra/` (the service templates every backend knows: the example app service `note-db`, the built-in infra services `logging` and `sqlite`, the connections). Both are grouped by function ([Groups](#groups-in-a-component-or-template-folder)): the components in `block/` (the block components and code blocks), `diagram/`, `media/` (with `media/image/` holding `image` and `image-grid`), `hierarchy/` (the list and table hierarchies, the file tree), the components the page itself depends on (`text`, `anchor`, `tag`, `multi-lang`, `index`, …) at the top; the templates as above, and `note-db` in `notes/`. The package registers its components by import (`comp-doc/registry/registry.js`), not by manifests, so for them a group is only where the files are. The built-in folder holds templates and components only, never instances: an instance is always created in a doc page or in a folder of a backend config. The service backend finds the built-in folder beside itself; a backend config can name another (`builtIn: path`) or none (`builtIn: false`).

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
# asset, comp, service: absent, the convention; false, none; { file }, another config file
```

```yaml
# .doc-page/source.yaml: paths relative to this file
rules:
  - action: addFolder
    alias: my-doc             # the root: its files are ~my-doc/... inside this doc page
    path: ..                  # the doc page folder: .doc-page/ and the managed folders are skipped by themselves
    collect: recursive
  - action: removeByPath      # a sub doc page collects itself
    pattern: "~my-doc/sub-page/**"
```

This is only a convention. A small doc page may keep everything inline in its entry, as the sub document of the demonstration does, and several sections may share a file; the page reads both the same way.

## Doc pages inside doc pages

A doc page folder inside another one is a doc page of its own: it has its own `.doc-page/`, collects its own folder under its own root alias, and is included by the outer page through a side-panel node naming its folder and its alias in the workspace. The outer page's source excludes the inner folder (`removeByPath`), since the inner entry collects it. Included this way, the inner page brings its source rules, tag definitions, config declarations, asset folders, components and service folders along, the config below the outer page's own ([config of an included doc page](doc_page_impl_config.md#the-doc-page-layer)); deployed alone, it is named by its folder in a workspace file or in `config.yaml`. Its roots may carry the same aliases as the outer page's: the doc page alias keeps them apart ([source paths](doc_page_impl_source.md#source-paths)).

## The workspace file

A deployment of several doc pages side by side is a workspace file, by convention `workspace.yaml` at the root of the project, which `config.yaml` names (`workspace: { file: ../workspace.yaml }` from `main/`); its grammar is in [the workspace file](doc_page_impl_source.md#the-workspace-file). It holds only the list of root-level doc pages with their aliases and the page values, never the content of a doc page, so a doc page knows nothing of the workspaces it is part of.

## The demonstration doc page

`example_doc/` follows the convention: its metadata is in `example_doc/.doc-page/` (an entry naming `source.yaml`, `tag.yaml`, `config.yaml` and `side-panel.yaml`, the side panels of two parts, `asset.yaml` naming its two asset folders `~example:example/asset` and `~example:example/asset-archive`, `service-backend.yaml`), its components in `example_doc/comp-mdx/` with their manifests, grouped (`comp.yaml` at the top, `panel/comp.yaml` for the side-panel item and the source link, `table/stock-table/comp.yaml` a group in a group), its own app template in a group in a group (`example_doc/service-template-app/productivity/task/`), its instances in `example_doc/service-app/`, the infra instances the kernel provisions in `example_doc/service-infra/`, and its sub document `example_doc/sub-doc/` is a doc page folder with its own `.doc-page/entry.yaml`, written inline. `workspace.yaml` at the project root names it as the first root doc page of the demonstration, under the alias `example` (`main/config.yaml` names the workspace file), beside a second one, `example_doc/second-doc/` as `second`; its side panel includes the sub document as `include: { dir: ../sub-doc, alias: sub }`, and its source rule excludes both folders (`exclude: [sub-doc/, second-doc/]`).

## Implementation

| Place | Role |
| --- | --- |
| `plugin/doc-entry.ts` | `DOC_PAGE_META_DIR_NAME` (`.doc-page`), `docEntryFileFind` (the entry of a folder), `docPageAliasDefaultGet` (the folder name), an `include` naming a folder with its alias, `docPageList` (every doc page loaded, with its alias, roots, and its asset / comp / service declarations) |
| `plugin/doc-asset-store.ts` | `ASSET_CONFIG_FILE_NAME`, `ASSET_FOLDER_DEFAULT_LIST`: the asset store config of a doc page and its defaults |
| `plugin/doc-source.ts` | `workspace` / `docEntry` of `config.yaml`; the source scan skips `.doc-page` (`dirNameSkipSet`) and the managed folders of every doc page; the component manifests mounted into the virtual module |
| `plugin/doc-service-server.ts` | the service folders of a doc page (`.doc-page/service.yaml` or the convention) and the sync of the loaded doc pages to the backend |
| `service-backend/service_kernel.py` | the same service folders, read by the backend (`doc_page_service_folder_list_read`) |
| `workspace.yaml` | the workspace file of the demonstration, at the project root |
| `built-in/` | what the package ships: `comp-mdx/`, `service-template-app/`, `service-template-infra/` |
