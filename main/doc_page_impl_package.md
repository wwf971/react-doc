<!-- The package system: components and service templates a workspace imports. Parent document: doc_page_impl.md -->

# Packages: Design

A **package** is a folder of components and service templates, with documents of its own, that a workspace or a doc page imports, so that one set of components (the diagrams of a domain, the dashboards of a platform) serves several doc pages and several workspaces without being copied into each. It can also be read and launched as a doc page: read-only where others use it, editable when it is served alone.

(Elsewhere in these documents "the package" alone means react-doc itself, the npm package shipping the page and `built-in/`. A package in the sense of this document is always named as one: "a package", "the package cloud-dev-vis".)

## Where a component can come from

A package sits between the built-in folder, which every page has, and a doc page's own components, which only that doc page has:

```text
where components and templates come from       who can use them
  built-in/ of the project                     every doc page of every workspace
  a package the workspace imports              every doc page of that workspace
  the folders of a doc page                    that doc page (and the pages that include it)
```

A package carries code and templates, never running state: no service instances. So importing a package changes what the doc pages of a workspace *can* use, never what they hold.

## Core concepts

- **The package folder**, laid out by a fixed convention: a config file `doc-package.yaml` at its root, its components in `comp-mdx/`, its templates in `service-template-app/` and `service-template-infra/`, its documents in `doc/` with `doc/README.md` as the root. The layout is in [The package folder](doc_page_impl_dir.md#the-package-folder).
- **Its name**, the `name` of `doc-package.yaml` (by habit the folder name, but the file decides). Its components have the ids `{name}/{tagName}`, its templates the origin `package` with that name.
- **Its dependencies**, the packages it needs (`packageDependList`): its components may import theirs, or name them in the data of a block.
- **The import**: a workspace or a doc page names the packages it uses by folder or by name (`packageList`), and the workspace gets those and every package they need.

## Mandatory, not configurable

A doc page has conventions with config files over them: `.doc-page/comp.yaml` may name other component folders, `asset: false` may say there are none. A package has **only the conventions**: the config file has a fixed name, every one of its keys is required (an empty list is written `[]`), unknown keys are refused, and the folders have fixed names that nothing renames. Reading a package is therefore a fixed walk over known names, and a package that breaks a rule stops the workspace with an error naming the file instead of being read by guess.

```yaml
# doc-package.yaml, at the root of the package
name: cloud-dev-vis             # lower-case letters, digits and "-"
description: Diagrams of cloud architecture.
packageDependList:              # the packages this one needs, [] for none: { dir } relative to this file, or { name }
  - dir: ../card-base
```

## Importing packages

```yaml
# .doc-page/entry.yaml: what the doc page needs, so that it stays self-contained
packageList:
  - name: cloud-dev-vis            # found by its name (below)

# workspace.yaml: paths relative to this file
docPageList:
  - { alias: example, dir: ./example_doc }
packageList:
  - dir: ./package/cloud-dev-vis

# config.yaml naming one doc page alone (docEntry): the packages beside it
docEntry: { dir: ../my-doc }
packageList:
  - dir: ../package/cloud-dev-vis
```

A doc page's own list merges into the workspace's, as does every package listed as a doc page ([below](#a-package-as-a-doc-page)), since the components of a page are one registry. A package **named by its name** is looked for, first match:

```text
{folder}/{name}                 of the folders of --package-dir (react-doc dev), then of
                                config.yaml packageSearchDirList (by default package/ of the project)
{folder}/node_modules/{name}    upward from the file naming it, so a package can be an npm dependency
```

and counts only when its `doc-package.yaml` says that name. A name found nowhere stops the page with where it looked. This is what lets a doc page lying anywhere name a package without a path to where react-doc is ([where things are found](doc_page_impl_cli.md#where-things-are-found)).

```text
load the workspace
  -> read packageList ({ dir } each)
  -> for each package, depth first:
       read doc-package.yaml (required keys, known keys, a valid name) and check doc/README.md
       load the packages it needs first
       a package already loaded (same folder) is skipped
       a cycle, or two folders with one name -> error
  -> packages in loading order: a package after every package it needs
```

A package named several times is loaded once. `config.yaml` beside `workspace` may not name packages: a workspace names its own.

## Components of a package

A package's components are described by `comp.yaml` manifests in its `comp-mdx/`, with the grammar of a doc page's ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)), grouped in folders by function. They are mounted the same way: the plugin imports every module a manifest names and writes the tag names into `compRegistry`.

- **Ids.** The default id of an entry is `{packageName}/{tagName}` (`cloud-dev-vis/DiagramER`); `config.yaml` can map another tag name to it (`DocDiagramER: cloud-dev-vis/DiagramER`).
- **Precedence.** The doc pages are read before the packages, and the packages in loading order; of two declarations of one tag name the first wins, with a warning. A doc page's own component therefore replaces a package's of the same name.
- **Imports between modules.** A component imports the modules of the page (`main/`) and of the packages it needs by relative path, as a doc page's components do.
- **Build-time dependencies.** A manifest entry may name the extractor that tells a pruned build which files and nested components a block refers to (`dependencyCollect: { entry, export }`), since the host's `registry-source-dependency.js` knows only the components the package ships.
- **ES modules for node.** A `package.json` with `"type": "module"` at the root of the package lets node load its `.js` files (tests, extractors); it is not an npm package.

## Types of a package

`type.yaml` at the top of a package declares the types of its components, in the grammar of every type file ([Declaring a type](doc_page_impl_type.md#declaring-a-type)). Every doc page of a workspace importing the package has them, so an object of such a type needs no declaration of its own, and a copy of the object works wherever the package is imported. The modes of a type name the package's components, which arrive with it.

## Service templates of a package

The templates in `service-template-app/` and `service-template-infra/` join the service registry like those of the built-in folder ([Where templates and instances come from](doc_page_impl_service.md#where-templates-and-instances-come-from)): the page syncs the packages it loaded with its doc pages (`registry/docpage/sync`, `packageList: [{ name, dir }]`), and the backend reads their template folders with the origin `{ kind: 'package', alias: name, dir }`. An instance created from a package's template goes to the main doc page, as for a built-in template, since a package holds no instances.

## Documents of a package

`doc/README.md` is the root document of a package: what it holds, the series of components in it and the design they share, pointing to a document per series beside it. The design documents are written for whoever develops the package, by the rules of the project's documents; the usage documents, for whoever writes its components, with live examples. Both are the content of its doc page.

## A package as a doc page

A package with a `.doc-page/entry.yaml` ([its layout](doc_page_impl_dir.md#the-package-folder)) can also be **treated as a doc page**, so a package demonstrates itself: its documents show its components working, not a doc page of someone else's. It is treated so wherever a doc page is named, by its folder:

```yaml
# persistently, in a workspace: a section of the side panel beside the others
docPageList:
  - { alias: example, dir: ./example_doc }
  - { dir: ./package/cloud-dev-vis }       # the alias defaults to the name of the package
```

```sh
react-doc dev package/cloud-dev-vis        # alone, in a virtual workspace
```

or for a while, mounted from the Workspace tab or with `--mount` like any doc page ([temporary doc pages](doc_page_impl_source.md#temporary-doc-pages)). Being there imports the package too; nothing has to name it twice.

**What makes it one is the folder.** A doc page's entry found in a folder holding `doc-package.yaml` is a package: `docPageRegister` marks it (`packageName`, `isReadOnly`), and the page receives both (`workspace.docPageList`, the `docPageSection` of its side panel section). There is no key to set, in the workspace or in the package, so a package cannot be a writable doc page by being named another way; whether it is written follows from how it is served (below).

**Served alone, it is the work at hand, and is written like any doc page.** A package that is the doc page of a virtual workspace, which is what `react-doc dev <package>` serves (or `docEntry` of a config naming it), is the one being developed: its documents, side panels, assets and frontend objects are edited from the page, in its own folder, and `isReadOnly` is false. It keeps its badge `package`, and the components and service templates it has as a package are unchanged. `docWorkspaceLoad` decides it, once, for the root doc page of a virtual workspace that is not a temporary mount.

```text
react-doc dev package/cloud-dev-vis               the package alone: editable
react-doc dev package/cloud-dev-vis --mount ../notes   the same; the mounted doc page as usual
react-doc dev ../team                             a package in the workspace's docPageList: read-only
react-doc dev ../notes --mount package/cloud-dev-vis  a package mounted: read-only
a package named in packageList                    imported only, no doc page: nothing to write
```

So a package needs no doc page of another kind to demonstrate editing: its own demonstration is edited while it is developed, and the same documents are read-only for whoever imports it.

**Everywhere else it is read-only, at the level of the system.** A package is code and data others rely on, not something edited from a page that happens to show it. Every write into its folder is refused by what does the write, with code `-4`, whichever caller asks:

```text
the asset store           every write of AssetStore checks the folder (objectWriteGuard, folderWritableCheck);
                          folderSet its config file; the object remains readable
frontend objects          docPageWritableGet, on top of the store's refusal of their assets
documents, side panels,   the edit api asks readOnlyReasonGet(absPath), one function of the plugin, for
  config values             every file a write would touch
files of the source       POST file/create, the same function
```

The one exception there is the document of a [playground](doc_page_impl_test.md#writing-into-a-package), a file ignored by git that belongs to the checkout.

The page asks too, to say so before it is refused: `DocSourceStore.docPageReadOnlyReasonGet(alias)` and `pathReadOnlyReasonGet(path)`; `DocEditStore.docIsEditable` answers no for its documents, a config layer of it is not writable, and a read-only asset folder has a badge. It is **annotated as a package** where it shows: the `package` badge of its side panel section (its tooltip says whether it is read-only, from `docPageSection.isReadOnly`), its node in the Workspace tab (`package`, and `read-only` in its detail when it is), and the package node above the workspace remains what it is, the import.

It has no components of a doc page and no services of a doc page (`comp: false`, `service: false`, an entry naming either is refused): what it has of those it has as a package. It may have assets (`.doc-page/asset/`) and frontend objects: data its documents show, read, and written only while the package is served alone.

## In the Workspace tab

The graph of the Workspace tab ([The Workspace tab](doc_page_impl_source.md#the-workspace-tab)) draws the packages in a tone of their own, **above** the workspace card: an edge `imports` from the workspace to each package it names, an edge `needs` from a package to each package it needs, a package one row above every package needing it. The doc pages grow below the workspace card. The two can be shown or hidden separately; with one of them alone, it grows below the card. Clicking a package shows its description, folder, and what it needs and is needed by. The canvas opens in the block popup.

## Writing a package

A package of components usually groups them in **series**, one folder each under `comp-mdx/`, with a base series holding what the others build on. `package/cloud-dev-vis/` is the example: a base series with the engine of node cards and connection lines on React Flow, and a Power Platform series of cards bound to it through a node registry ([its root document](../package/cloud-dev-vis/doc/README.md)). What the package system does not do yet (packages from a registry with a version, kinds imported between registries) is in [TODO](doc_page_impl_TODO.md#packages).

## Implementation

| Place | Role |
| --- | --- |
| `plugin/doc-package.ts` | `PACKAGE_CONFIG_FILE_NAME` (`doc-package.yaml`), the fixed folders, `docPackageSpecListRead` (a `packageList`), `docPackageDirFind` (a package by name), `docPackageNameOfFolderGet`, `docPackageListLoad` (the packages and those they need, in loading order, the checks) |
| `plugin/doc-entry.ts` | `packageList` of the workspace file (`docWorkspaceSpecRead`) and of an entry; a package among the doc pages: `packageName`, `isReadOnly` (`docPageRegister`) |
| `plugin/doc-source.ts` | `packageList` of config beside `docEntry`, `packageSearchDirList`; the packages loaded (`docEntry.packageList`), the data the page gets (`configDoc.packageList`), the extractors of the manifests (`compDependencyCollectLoad`), the sync of the packages to the backend; `readOnlyReasonGet` |
| `plugin/doc-asset-store.ts`, `plugin/doc-edit-server.ts`, `plugin/doc-object-frontend.ts` | the refusals of a read-only doc page (`-4`) |
| `store/DocSourceStore.ts`, `store/DocEditStore.ts`, `store/doc-config-layer.ts`, `comp-doc/settings/WorkspaceSettings.jsx`, `comp-doc/side-panel/DocSidePanelSection.jsx` | what the page says of it |
| `plugin/doc-comp-config.ts` | `compPackageRead`: the component folder of a package, read after the doc pages' |
| `plugin/doc-service-server.ts` | `ServiceSyncPackage`, the `packageList` of the sync route |
| `service-backend/service_runtime.py` | `docpage_sync` keeps the packages; `folder_list_get` reads their template folders (origin `package`) |
| `src/lib/doc-workspace-graph.js`, `comp-doc/settings/WorkspaceSettings.jsx` | the packages in the graph of the Workspace tab |
| `package/` | the packages of the project; `package/cloud-dev-vis/` the one the demonstration imports, itself a doc page |
