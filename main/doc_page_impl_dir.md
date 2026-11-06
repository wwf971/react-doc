<!-- The recommended folder structure of a doc page. Parent document: doc_page_impl.md -->

# The Doc Page Folder

A doc page is self-contained: the documents it shows, the files that describe it (its entry, source rules, side panels, tags, config), the objects of its asset store, its own components, and its own service templates and instances can all live in one folder, and that folder is what another doc page includes and what a workspace names ([the workspace](doc_page_impl_source.md#the-workspace)). This document describes the recommended layout of such a folder, of a workspace folder, and of a package folder. It is a convention: the page reads any layout an entry file describes, but a folder laid out this way is found by its folder alone, needs no configuration for its asset, component and service folders, and reads the same everywhere. `react-doc init` creates a folder of each kind laid out this way, and `react-doc dev` serves one ([The command line](doc_page_impl_cli.md)).

The idea is the one of an Obsidian vault. A vault is a plain folder of notes, and everything the application keeps about the vault sits in one hidden folder, `.obsidian/`, beside the notes. A doc page folder keeps its documents as plain files and **everything the page manages for it in `.doc-page/`**: its metadata files, and also the folders of what it carries beyond documents, **code and running things** (components that its documents use, services that its dashboards show) and the objects of its asset store, each in a folder of a known name, mounted into the registry of its kind when the doc page is loaded. Opened in a file browser, a doc page folder therefore shows documents and the folders that hold documents, never the folders of the system.

## Layout

```text
my-doc/                          the doc page folder: give this to a workspace file, to config.yaml (docEntry.dir) or to an include
├── guide.md                     documents, in any folders: all that is seen at the top
├── reference/
├── image/                       files the documents use (collected as "referenced")
├── sub-page/                    another doc page, self-contained the same way
│   ├── .doc-page/entry.yaml
│   └── ...
└── .doc-page/                   everything the page manages for the doc page; never part of its source
    ├── entry.yaml               the entry: what makes up the doc page, mostly naming the files below
    ├── source.yaml              source rules (entry: source.file)
    ├── tag.yaml                 tag definitions (entry: tag.file)
    ├── config.yaml              config declarations and variables (entry: config, a { file } item)
    ├── side-panel.yaml          the page side panel (entry: sidePanelById.main.file)
    ├── side-panel-xxx.yaml      side panels of parts, included by side-panel.yaml
    ├── asset.yaml               its asset folders (optional: asset/ below otherwise)
    ├── comp.yaml                its component folders (optional: comp-mdx/ below otherwise)
    ├── service.yaml             its service folders (optional: the four service-* below otherwise)
    ├── api.yaml                 the apis it declares without code (optional: none otherwise)
    ├── playground.yaml          its playground documents (optional: none otherwise), with their
    ├── playground/              templates (doc_page_impl_test.md)
    ├── object-frontend.yaml     its frontend objects and their types (optional: none otherwise; made by its first object)
    │                            (and packageList of the entry: the packages it needs, by name)
    ├── service-backend.yaml     the config of the service backend, when the page is the one a backend is started for
    ├── hotkey/                  its keyboard maps, one yaml file each (optional: none otherwise)
    │   ├── main.yaml            the map it activates by convention (entry: hotkey.file names another)
    │   └── base.yaml            a map main.yaml includes, or the reader picks instead
    │                            the managed folders, each made by its first item (below):
    ├── asset/                   the asset objects of the doc page: its default asset folder
    │   └── {id}--{name}/        a group folder: the assets of one frontend object, its entry among them (ASCII only)
    ├── comp-mdx/                its components: comp.yaml manifests and the modules they name
    │   ├── comp.yaml            the components at the top of the folder
    │   └── table/stock-table/   a group in a group: any folders, each may hold a comp.yaml
    ├── service-template-app/    its app service templates, {templateId}--{name}/
    │   └── productivity/task/   a group in a group: any folder not named {templateId}--{name}
    ├── service-template-infra/  its infra service templates, {templateId}--{name}/, grouped the same way
    ├── service-app/             its app service instances, {templateName}-inst-{serviceId}/
    ├── service-infra/           its infra service instances, created there or provisioned by the kernel
    └── service-backup/          the backups of its service instances (local-backup)
```

What belongs where:

- **The folder itself** is content: documents and the files they use, which the source rules collect, and the doc pages inside it.
- **`.doc-page/`** holds two things, neither of them ever a document. The **metadata files**: the entry and every yaml file it names, and the config files of the services the page uses. The page writes some of them itself (a side-panel label, a moved item, a config value, the folders of the asset store), always in place and with a `{file}.bak` beside the file. And the **managed folders**: the asset folder, the component folder, the service folders, the backups of the service instances (`service-backup/`, the default folder of the local-backup infra service, [the local-backup infra service](doc_page_impl_service_storage.md#the-local-backup-infra-service)). They belong to the doc page as much as its documents do, but are kept by the page, not written by hand, so they sit with the metadata, out of sight.
- What a run writes into `.doc-page/` (the backups, the state of the service runtime kernel `service-kernel.yaml`, `service-backup/`, the provisioned `service-infra/`) is ignored by git; `react-doc init page` writes the `.gitignore` for it.

The source scan never enters `.doc-page/`, so a rule collecting the doc page folder recursively (`path: ..`) needs no rule to exclude anything. A managed folder may also be kept elsewhere, named by its config file in `.doc-page/`; such a folder is skipped by the scan all the same. A metadata file names the content by paths relative to itself, so the doc page folder is `..` from `.doc-page/` and a managed folder of the convention is `./comp-mdx`; the asset folders are named by source path instead (`~my-doc/.doc-page/asset`, a root of the doc page by its alias), so that renaming the folder changes nothing inside it ([source paths](doc_page_impl_source.md#source-paths)).

A doc page laid out before the managed folders moved into `.doc-page/` (`comp-mdx/`, `asset/`, `service-*/` beside the documents) is not read the old way: the folder of the former name is reported once in the console with where it goes now, and either moved there or named in the config file of its kind.

The three managed kinds follow one rule, **a convention with a config file over it**: the folder of the known name is used when nothing is said, the config file in `.doc-page/` names other or more folders, and the entry can name another config file (`asset: { file }`, `comp: { file }`, `service: { file }`) or say the doc page has none (`asset: false`, `comp: false`, `service: false`). Three more files of `.doc-page/` follow the same rule without a managed folder: the keyboard maps and the declared apis ([below](#keyboard-maps-and-declared-apis)), and the frontend objects with their types ([below](#frontend-objects)).

### Managed folders made when first used

A managed folder exists only once something is in it. Nothing makes an empty one: not loading the doc page, not naming the folder in a config file, not `react-doc init`. The first item written makes its folder, and every reader takes a folder that does not exist as an empty one. So a new doc page is its documents and a few yaml files, and a folder appears beside them the day it holds something (and git, which keeps no empty folder, sees the same thing as the disk).

```text
the folder                           made by
.doc-page/asset/ (and any asset      the first object written to it (objectCreate); naming it in
  folder asset.yaml names)             asset.yaml, from the Asset service tab, makes nothing
.doc-page/comp-mdx/                  whoever puts the first component there: by hand today
.doc-page/service-app/, service-     the backend, when it creates the first instance of the kind,
  infra/                               or provisions the first infra instance
.doc-page/service-template-app/,     whoever puts the first template there: by hand today
  service-template-infra/
.doc-page/service-backup/            the local-backup infra service, at the first backup
.doc-page/object-frontend.yaml,      the first frontend object created in the doc page (the Frontend
  asset/{id}--{name}/                  objects tab, the insert menu): its line, its group folder
```

The rule for anything that writes into a managed folder, now or later (a component or a template brought in from the page, say): **make the folder when writing the first item, never assume it exists, never make it ahead.** The rule for anything that reads one: **a missing folder is empty**, never an error. Since components and templates are put in by hand as often as by the page, the development server watches the metadata folder of every doc page, so a component folder that appears while it runs is mounted at once.

This is the default of an option, `folderManaged.isLazy` of `config.yaml` (`true` when absent). With `false` the development server makes the missing managed folders of every doc page it loads, at every configuration load, and naming an asset folder makes it, for whoever wants the layout visible before it holds anything. The command line has the same choice per run: `react-doc init --folder-empty` writes the managed folders of the scaffold ([The command line](doc_page_impl_cli.md)).

### Asset folders

A doc page laid out this way needs no asset configuration: its objects live in `.doc-page/asset/`, named `~root/.doc-page/asset` by the root that collects the folder, and `.doc-page/asset.yaml` is created by the settings panel the first time its folders are changed. To keep objects elsewhere, or in several folders, the doc page writes that file itself ([which folders a doc page declares](doc_page_impl_asset.md#which-folders-a-doc-page-declares)). An included doc page brings its asset folders along, whichever way it is included, so its asset blocks resolve inside the page that includes it; an object created from one of its documents goes to its own default folder.

### Component folders

A doc page's own components live in `.doc-page/comp-mdx/`: modules that define components with `compDefine()`, and `comp.yaml` manifests that say which tag name each one answers to and which registry id it has ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)). When the doc page is loaded, the development server reads the manifests, bundles the modules, and the page mounts every component into the component registry, so a document of the doc page writes `<StockTable />` or `<!--renderComp=StockTable-->` without the host application registering anything. To keep the components elsewhere, `.doc-page/comp.yaml` names the folders:

```yaml
# .doc-page/comp.yaml (paths relative to this file)
folderList:
  - ./comp-mdx                 # the convention folder, kept
  - ../tool/comp
```

Inside a component folder the components may be grouped by function, a group inside another ([Groups](#groups-in-a-component-or-template-folder)).

The package's own components, the ones every doc page can use (`Tabs`, `Image`, `FileTree`, …), live in `built-in/comp-mdx/` of the project ([The built-in folder](#the-built-in-folder)); they are registered by the package itself, since the page depends on them, and a doc page's components come on top. Between the two come the components of the packages a workspace imports ([Packages](doc_page_impl_package.md)).

### Service folders

A doc page's own service templates and instances live in four folders of its own in `.doc-page/`, by kind ([Where templates and instances come from](doc_page_impl_service.md#where-templates-and-instances-come-from)): `service-template-app/` and `service-template-infra/` hold templates (`{templateId}--{name}/service-template.yaml`), `service-app/` and `service-infra/` hold instances (`{templateName}-inst-{serviceId}/service.yaml`), the latter two being where an instance created from the Services tab goes, and where the service runtime kernel provisions an infra instance a service of the doc page requires. A folder that does not exist is empty, and made when something is created in it. `.doc-page/service.yaml` names other folders:

```yaml
# .doc-page/service.yaml (paths relative to this file; kind app when absent)
templateFolderList:
  - { path: ./service-template-app, kind: app }        # the convention, written out
  - { path: ./service-template-infra, kind: infra }
instanceFolderList:
  - { path: ./service-app, kind: app, isDefault: true }
  - { path: ./service-infra, kind: infra, isDefault: true }
```

The templates of a template folder may be grouped by function, a group inside another; the instance folders stay flat ([Groups](#groups-in-a-component-or-template-folder)).

The service backend reads the same file (or the same convention) when it mounts the doc page: the backend config names the doc page it is started for (`service-backend.yaml`, `docPageList`), and the page tells the backend about every other doc page it loaded, so a doc page included by another brings its services along the way it brings its asset folders. The instances of a doc page are **state**: an instance folder is a copy of a template with the instance's config, and for an infra service its data; an example doc page tracks the instances it demonstrates on purpose (an ignore file in `.doc-page/service-app/` listing them) and ignores what a run creates, in particular everything the kernel provisions into `.doc-page/service-infra/` ([Provisioning](doc_page_impl_service_kernel.md#provisioning)).

### Groups in a component or template folder

A component folder and a template folder (of a doc page, of a backend config, or of the built-in folder) may **group** what they hold in folders by function, and a group may hold groups in turn, to any depth (8 levels are read). A group is only a folder: it has no file of its own, declares nothing, and its name is free; it changes no name, id or reference of what it holds, so moving a component or a template from one group to another changes nothing for the documents and instances that use it.

- **Component folder**: every `comp.yaml` in the folder is read, at its top and in its groups at any depth, a folder before the folders inside it; a manifest beside groups does not end the search, so a group may list its own components and hold more groups. The entries of a manifest are relative to the manifest. `node_modules/`, `dist/` and dot folders are never read.
- **Template folder**: a folder named `{templateId}--{name}` is a template, and nothing inside it is read for templates; any other folder is a group and is read in turn. A template describes itself for the authors of its consumers and dashboards in **`service_{name}.md`** beside its script (`service_local_backup.md`, `service_todo_list.md`; the `-` of the name written `_`, as a component's `comp_{tag}.md`), copied into its instances like the rest. A folder that holds the files of a template (`service-template.yaml`, `service.py`) or contains `--` without being a valid template name is a misnamed template, reported by the scan and skipped, never taken for a group. Template names stay unique across the groups of all folders, since a template is referred to by its name. The registry reports the group of a template (`groupPath`, `connection/cloud`, `''` at the top), and the Services tab shows it on the template's card and sorts the cards by group.
- **Instance folders** are not grouped: an instance is created and provisioned by the backend, at the top of the instance folder of its kind.

```text
built-in/service-template-infra/
├── w55iiudjrez--logging/              a template at the top: groupPath ''
├── storage/                           groupPath storage
│   ├── w55iiudkmpr--sqlite/
│   └── w5f2xw18q2r--local-backup/     service-template.yaml, service.py, service_local_backup.md, icon.svg, dashboard/
└── connection/                        a group of groups
    ├── cloud/      w4wsn192rpt--aws-connection/, w4wswvntoli--google-drive/
    ├── database/   w4wtnuwk115--postgres-connection/
    └── auth/       w4wt98cadnh--cognito-auth/
```

### Keyboard maps and declared apis

A doc page binds keys to apis and declares apis of its own in its metadata folder, as data, so they travel with the doc page wherever it is included or deployed ([Unified api registry](doc_page_impl_api.md)):

- **`.doc-page/hotkey/`** holds its keyboard maps, one yaml file each ([Keyboard maps](doc_page_impl_api_hotkey.md)). `main.yaml` is the map the doc page activates; the other files are resources that the active map includes (`include: [./base.yaml]`), or that the reader picks instead in the settings panel. The entry names another file as the active map with `hotkey: { file: ./hotkey/vim.yaml }`, or `hotkey: false` for none. The maps of every loaded doc page are stacked over the package's default map (`main/hotkey/default.yaml`, named by `config.yaml`) and under the workspace's map (named by the workspace file), the included doc pages below the one that includes them.
- **`.doc-page/api.yaml`** holds the apis the doc page declares without code: aliases of apis of the page with fixed parameters, or sequences of calls ([Declared apis](doc_page_impl_api.md#declared-apis)), read when the file exists; `api: { file }` names another file, `api: false` none.
- **`.doc-page/playground.yaml`** lists its playground documents, documents for trying things out that git ignores, each with a template, normally in `.doc-page/playground/` ([Playground documents](doc_page_impl_test.md#playground-documents)), read when the file exists; `playground: { file }` names another file, `playground: false` none. The document itself lies among the documents, named `*.playground.md`, and is the one file of a doc page a clone is meant not to have.

Both are configuration, like the entry and the side-panel files: a change reloads the page, and they are never collected as documents.

### Folder names of assets

A folder holding the data of an asset object or of a frontend object is named in **ASCII only**. Other characters are what file systems, archives, version control and other machines disagree on (normalization on macOS, code pages on Windows), and these folders travel with a doc page. A name for readers is another matter: the name of an asset or a frontend object, a type's label and a document may be in any language; they are kept in the files, not in the folder name.

```text
name                    its folder
My shelf                {id}--My shelf
営業 report 2           {id}--report 2             the ASCII parts of the name
データベース移行         {id}                       an asset with no ASCII in its name
データベース移行         {id}--db-migration.project  a frontend object: its type, so the folder still says what it holds
```

The store builds these names itself (`objectDirNameBuild`, `groupNameBuild`), so this concerns whoever makes such a folder by hand or by a script of their own. A folder named otherwise by an older version is still read, its id being what counts; it may be renamed by hand, keeping the id at its start, as nothing refers to it by its path.

### Frontend objects

**`.doc-page/object-frontend.yaml`** holds what the doc page keeps of the [frontend object service layer](doc_page_impl_obj_frontend.md): the **types** of its frontend objects (`typeList`, each below `frontend.object`, with its modes: the components that draw it, which are the doc page's own components or any of the registry) and the **objects** themselves (`objectList [{ id, entry }]`, the id of each and of its entry asset). The objects' data is assets of the doc page's default asset folder, the assets of one object gathered in a group folder named like an asset object, `{id}--{name}`, so the folder of the doc page shows one folder per object. The file is read when it exists; `objectFrontend: { file }` of the entry names another file, `objectFrontend: false` none. Its types are configuration a person writes, its object list the page keeps (a line added or removed in place by the Frontend objects tab); a change is read again by the page without a reload, as `asset.yaml` is, and the file is never collected as a document. It is made by the first object created in the doc page. The package and the workspace keep a keyboard map each, as one file named explicitly (`hotkey: { file }` of `config.yaml` and of the workspace file; for a workspace, by habit `hotkey.yaml` beside the workspace file in `.doc-workspace/`, [The workspace folder](#the-workspace-folder)).

## The built-in folder

What the package ships beside the page is laid out like the managed folders of a doc page, in `built-in/` at the root of the project: `built-in/comp-mdx/` (the package's components), `built-in/service-template-app/` and `built-in/service-template-infra/` (the service templates every backend knows: the example app service `note-db`, the built-in infra services `logging` and `sqlite`, the connections). Both are grouped by function ([Groups](#groups-in-a-component-or-template-folder)): the components in `block/` (the block components and code blocks), `diagram/`, `media/` (with `media/image/` holding `image` and `image-grid`), `hierarchy/` (the list and table hierarchies, the file tree), the components the page itself depends on (`text`, `anchor`, `tag`, `multi-lang`, `index`, …) at the top; the templates as above, and `note-db` in `notes/`. The package registers its components by import (`comp-doc/registry/registry.js`), not by manifests, so for them a group is only where the files are. The built-in folder holds templates and components only, never instances: an instance is always created in a doc page or in a folder of a backend config. The service backend finds the built-in folder beside itself; a backend config can name another (`builtIn: path`) or none (`builtIn: false`).

## The package folder

A package is a folder of components and service templates that a workspace imports; what a package is, how it is imported and how its components and templates join the page is in [Packages](doc_page_impl_package.md). This section is its layout. Unlike a doc page folder, nothing in it is optional or renamed by a config file: the names below are the only ones read.

```text
my-package/                      the package folder: give its path to a workspace (packageList)
├── doc-package.yaml             its config, at this fixed name: name, description, packageDependList, all required
├── doc/
│   ├── README.md                its root document (required)
│   └── xxx.md                   its other documents, one per series of components
├── comp-mdx/                    its components: comp.yaml manifests, the grammar of a doc page's
│   └── {series}/comp.yaml         (Component folders above), grouped by function
├── service-template-app/        its app service templates, {templateId}--{name}/, grouped as in a doc page
├── service-template-infra/      its infra service templates
├── .doc-page/                   optional: makes it a doc page too (below)
│   ├── entry.yaml               title, homeDoc: ~{name}/doc/README.md
│   ├── source.yaml              the package folder as its root; comp-mdx/ and the templates are never collected
│   ├── side-panel.yaml          its documents, the demonstrations first
│   └── asset/                   the objects its documents show: data of the package, read-only
└── package.json                 optional: { "type": "module" }, so node reads its .js as ES modules
```

- **Required**: `doc-package.yaml` and `doc/README.md`. The content folders may be absent (nothing of that kind), never moved.
- **Never there**: instance folders (`service-app/`, `service-infra/`): a package holds no running state. In its `.doc-page/`, no `comp-mdx/` and no service folders, and an entry naming `comp`, `service` or `packageList` is refused: its components and templates are the ones at its top, what it needs is `packageDependList`.

Unlike a doc page, a package keeps its code folders at its top: code and templates are what a package is, and its documents, the ones a reader of the package looks for, are gathered in `doc/`. A package with `.doc-page/entry.yaml` is also a **read-only doc page**: it can be launched, listed in a workspace, or mounted for a while, its documents demonstrating its components ([A package as a doc page](doc_page_impl_package.md#a-package-as-a-doc-page)). `react-doc init package` writes the three files.

The packages of the project live in `package/` at its root, one folder each, which is where a package named by its name is looked for first (`packageSearchDirList` of `config.yaml`); `package/cloud-dev-vis/` is the one the demonstration imports ([its root document](../package/cloud-dev-vis/doc/README.md)).

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

# config.yaml: one doc page alone, a virtual workspace (react-doc dev ../my-doc says the same)
docEntry:
  dir: ../my-doc
  alias: my-doc

# a side panel node: another doc page included as a folder of the side panel
- id: sub-page
  include: { dir: ../sub-page, alias: sub }    # relative to the file holding it, here .doc-page/side-panel.yaml
```

Wherever a doc page is named, it gets its **alias** there, the name its files carry in the workspace (`~sub:sub-page/guide.md`); the folder name stands in when none is given (a package: its name), and `alias` is recommended so that the folder can be renamed freely. `configDoc.docEntry.file` is the entry file found, so everything after loading sees one entry file whichever way it was named. The grammar of the entry and of the files it reaches is the subject of [The document entry](doc_page_impl_side_panel.md#the-document-entry).

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

A doc page folder inside another one is a doc page of its own: it has its own `.doc-page/`, collects its own folder under its own root alias, and is included by the outer page through a side-panel node naming its folder and its alias in the workspace. The outer page's source excludes the inner folder (`removeByPath`), since the inner entry collects it. Included this way, the inner page brings its source rules, tag definitions, asset folders, components, service folders, keyboard maps and declared apis along; its config declarations come along too, but are shown on a tab of their own in the settings panel without being applied, since only the main doc page's and the workspace's config decide the page ([the doc page layers](doc_page_impl_config.md#the-doc-page-layers)); deployed alone, it is named by its folder in a workspace file or in `config.yaml`, and its config applies. Its roots may carry the same aliases as the outer page's: the doc page alias keeps them apart ([source paths](doc_page_impl_source.md#source-paths)).

## The workspace folder

A deployment of several doc pages side by side is a **workspace**, described by its workspace file ([the workspace file](doc_page_impl_source.md#the-workspace-file)): the list of root-level doc pages with their aliases, the packages it imports, the page values, and what the deployment decides for the whole page, its `config` (the workspace config layer, over the main doc page's, [The workspace layer](doc_page_impl_config.md#the-workspace-layer)) and its keyboard map (`hotkey: { file }`, over the doc pages' maps), never the content of a doc page, so a doc page knows nothing of the workspaces it is part of. The first doc page of its list is the **main doc page**: the one whose config applies, whose entry supplies the page values, and whose roots a local path typed in the page is taken from.

A workspace folder follows the rule of a doc page folder: what the page keeps for the workspace is in one hidden folder, `.doc-workspace/`, and the folder itself shows the doc pages.

```text
my-workspace/                    the workspace folder: config.yaml names it (workspace: { dir })
├── guide/                       a doc page folder (its own .doc-page/ inside)
├── notes/                       another one
└── .doc-workspace/
    ├── workspace.yaml           the workspace file: docPageList [{ alias: guide, dir: ../guide }, ...], packageList, config, hotkey
    ├── hotkey.yaml              its keyboard map, named by workspace.yaml (hotkey: { file: ./hotkey.yaml })
    └── .gitignore               *.bak: the backups the Workspace tab keeps when it rewrites the file
```

`config.yaml` names the workspace by its folder, `workspace: { dir }`, and the file is the first of `{dir}/.doc-workspace/workspace.yaml`, `{dir}/workspace.yaml`; `workspace: { file }` names a workspace file anywhere. Paths in the workspace file are relative to the file, so a doc page of the workspace folder is `../guide`, as a doc page folder is `..` from its `.doc-page/`. A doc page whose side panel is one root item is shown unfolded under its section by default ([the sole root unfolded](doc_page_impl_side_panel.md#the-sole-root-unfolded)), so a doc page keeps its root item, named like the doc page, and the workspace needs no option for it. The doc page folders may lie anywhere (a workspace names them by path); keeping them in the workspace folder is what makes the folder a thing that can be copied, versioned or deployed whole.

## The demonstration doc page

`example_doc/` follows the convention, and its top shows documents only: its metadata is in `example_doc/.doc-page/` (an entry naming `source.yaml`, `tag.yaml`, `config.yaml` and `side-panel.yaml`, the side panels of two parts, `asset.yaml` naming its two asset folders `~example:example/.doc-page/asset` and `~example:example/.doc-page/asset-archive`, `object-frontend.yaml` declaring the reading lists, whose assets are the group folders `{id}--{name}` of its asset folder, `service-backend.yaml`), and so are its managed folders: its components in `.doc-page/comp-mdx/` with their manifests, grouped (`comp.yaml` at the top, `panel/comp.yaml` for the side-panel item and the source link, `table/stock-table/comp.yaml` a group in a group), its own app template in a group in a group (`.doc-page/service-template-app/productivity/task/`), its instances in `.doc-page/service-app/`, the infra instances the kernel provisions in `.doc-page/service-infra/`. Its sub document `example_doc/sub-doc/` is a doc page folder with its own `.doc-page/entry.yaml`, written inline. The root of the project is the workspace folder of the demonstration: `main/config.yaml` names it (`workspace: { dir: .. }`), and `.doc-workspace/workspace.yaml` there names the demonstration as the first root doc page under the alias `example`, beside a second one, `example_doc/second-doc/` as `second`, the package `package/cloud-dev-vis/` as a read-only doc page with the demonstrations of its components, and the keyboard map of the workspace, `.doc-workspace/hotkey.yaml`. The demonstration names what it uses of that package in its entry (`packageList: [{ name: cloud-dev-vis }]`). The side panel of `example` includes the sub document as `include: { dir: ../sub-doc, alias: sub }`, and its source rule excludes both folders (`exclude: [sub-doc/, second-doc/]`).

## Implementation

| Place | Role |
| --- | --- |
| `plugin/doc-entry.ts` | `DOC_PAGE_META_DIR_NAME` (`.doc-page`), `docEntryFileFind` (the entry of a folder), `WORKSPACE_META_DIR_NAME` (`.doc-workspace`), `docWorkspaceFileFind` (the workspace file of a folder), the report of a managed folder left beside the documents (`docPageFolderFormerWarn`), `docPageAliasDefaultGet` (the folder name), an `include` naming a folder with its alias, `docPageList` (every doc page loaded, with its alias, roots, and its asset / comp / service / hotkey / api declarations), the `config` and `hotkey` of the workspace file |
| `plugin/doc-asset-store.ts` | `ASSET_CONFIG_FILE_NAME`, `ASSET_FOLDER_DEFAULT_LIST`: the asset store config of a doc page and its defaults |
| `plugin/doc-source.ts` | `workspace` / `docEntry` of `config.yaml`; the source scan skips `.doc-page` (`dirNameSkipSet`) and the managed folders of every doc page; the component manifests mounted into the virtual module |
| `plugin/doc-service-server.ts` | the service folders of a doc page (`.doc-page/service.yaml` or the convention) and the sync of the loaded doc pages to the backend |
| `service-backend/service_kernel.py` | the same service folders, read by the backend (`doc_page_service_folder_list_read`) |
| `.doc-workspace/workspace.yaml`, `.doc-workspace/hotkey.yaml` | the workspace file of the demonstration, in the metadata folder of the project root, with its config and its keyboard map |
| `main/hotkey/default.yaml` | the default keyboard map of the package, named by `config.yaml` (`hotkey.file`) |
| `built-in/` | what the package ships: `comp-mdx/`, `service-template-app/`, `service-template-infra/` |
| `plugin/doc-package.ts` | `PACKAGE_CONFIG_FILE_NAME`, the fixed folders of a package (the rest: [Packages](doc_page_impl_package.md#implementation)) |
| `plugin/doc-hotkey.ts` | `HOTKEY_DIR_NAME` (`hotkey`), `HOTKEY_MAP_DEFAULT_FILE_NAME` (`main.yaml`): the keyboard maps of a doc page, includes expanded; the one map file of the package and of the workspace (`hotkeyMapOfFileGet`) |
| `plugin/doc-api-config.ts` | `API_CONFIG_FILE_NAME` (`api.yaml`): the apis a doc page declares |
| `plugin/doc-object-frontend.ts`, `src/lib/doc-object-frontend.js` | `OBJECT_FRONTEND_CONFIG_FILE_NAME` (`object-frontend.yaml`): the frontend objects and types a doc page declares |
| `plugin/doc-asset-store.ts`, `plugin/doc-comp-config.ts`, `plugin/doc-service-server.ts` | the convention folders of the three managed kinds: `ASSET_FOLDER_DEFAULT_LIST`, `COMP_FOLDER_DEFAULT_LIST`, `SERVICE_FOLDER_DEFAULT_LIST`, all in `.doc-page/` |
| `plugin/doc-source.ts` | `folderManagedIsLazyGet` (config `folderManaged`), `folderManagedListGet` (the managed folders of the loaded doc pages), `folderManagedEnsure` (made with `isLazy: false`) |
| `frontend/cli/` | `react-doc`: the scaffold of each folder kind, serving a folder, the published package ([The command line](doc_page_impl_cli.md)) |
| `package/` | the packages of the project (`packageSearchDirList` of `config.yaml`), `package/cloud-dev-vis/` the one the demonstration imports, itself a doc page |
