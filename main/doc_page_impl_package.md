<!-- The package system: components and service templates a workspace imports. Parent document: doc_page_impl.md -->

# Packages: Design

A **package** is a folder of components and service templates, with documents of its own, that a workspace imports, so that one set of components (the diagrams of a domain, the dashboards of a platform) serves several doc pages and several workspaces without being copied into each.

(Elsewhere in these documents "the package" alone means react-doc itself, the npm package shipping the page and `built-in/`. A package in the sense of this document is always named as one: "a package", "the package cloud-dev-vis".)

## Where a component can come from

A package sits between the built-in folder, which every page has, and a doc page's own components, which only that doc page has:

```text
where components and templates come from       who can use them
  built-in/ of the project                     every doc page of every workspace
  a package the workspace imports              every doc page of that workspace
  the folders of a doc page                    that doc page (and the pages that include it)
```

A package carries code and templates, never state: no service instances and no asset objects, which belong to a doc page. So importing a package changes what the doc pages of a workspace *can* use, never what they hold.

## Core concepts

- **The package folder**, laid out by a fixed convention: a config file `doc-package.yaml` at its root, its components in `comp-mdx/`, its templates in `service-template-app/` and `service-template-infra/`, its documents in `doc/` with `doc/README.md` as the root. The layout is in [The package folder](doc_page_impl_dir.md#the-package-folder).
- **Its name**, the `name` of `doc-package.yaml` (by habit the folder name, but the file decides). Its components have the ids `{name}/{tagName}`, its templates the origin `package` with that name.
- **Its dependencies**, the packages it needs (`packageDependList`): its components may import theirs, or name them in the data of a block.
- **The import**: a workspace names the packages it uses by folder (`packageList`), and gets those and every package they need.

## Mandatory, not configurable

A doc page has conventions with config files over them: `.doc-page/comp.yaml` may name other component folders, `asset: false` may say there are none. A package has **only the conventions**: the config file has a fixed name, every one of its keys is required (an empty list is written `[]`), unknown keys are refused, and the folders have fixed names that nothing renames. Reading a package is therefore a fixed walk over known names, and a package that breaks a rule stops the workspace with an error naming the file instead of being read by guess.

```yaml
# doc-package.yaml, at the root of the package
name: cloud-dev-vis             # lower-case letters, digits and "-"
description: Diagrams of cloud architecture.
packageDependList:              # the packages this one needs, [] for none: { dir } relative to this file
  - dir: ../card-base
```

## Importing packages

```yaml
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

A package named by the workspace and also needed by another package is loaded once. `config.yaml` beside `workspace` may not name packages: a workspace names its own.

## Components of a package

A package's components are described by `comp.yaml` manifests in its `comp-mdx/`, with the grammar of a doc page's ([Components of a doc page](doc_page_impl_mdx_comp.md#components-of-a-doc-page)), grouped in folders by function. They are mounted the same way: the plugin imports every module a manifest names and writes the tag names into `compRegistry`.

- **Ids.** The default id of an entry is `{packageName}/{tagName}` (`cloud-dev-vis/DiagramER`); `config.yaml` can map another tag name to it (`DocDiagramER: cloud-dev-vis/DiagramER`).
- **Precedence.** The doc pages are read before the packages, and the packages in loading order; of two declarations of one tag name the first wins, with a warning. A doc page's own component therefore replaces a package's of the same name.
- **Imports between modules.** A component imports the modules of the page (`main/`) and of the packages it needs by relative path, as a doc page's components do.
- **Build-time dependencies.** A manifest entry may name the extractor that tells a pruned build which files and nested components a block refers to (`dependencyCollect: { entry, export }`), since the host's `registry-source-dependency.js` knows only the components the package ships.
- **ES modules for node.** A `package.json` with `"type": "module"` at the root of the package lets node load its `.js` files (tests, extractors); it is not an npm package.

## Service templates of a package

The templates in `service-template-app/` and `service-template-infra/` join the service registry like those of the built-in folder ([Where templates and instances come from](doc_page_impl_service.md#where-templates-and-instances-come-from)): the page syncs the packages it loaded with its doc pages (`registry/docpage/sync`, `packageList: [{ name, dir }]`), and the backend reads their template folders with the origin `{ kind: 'package', alias: name, dir }`. An instance created from a package's template goes to the main doc page, as for a built-in template, since a package holds no instances.

## Documents of a package

`doc/README.md` is the root document of a package: what it holds, the series of components in it and the design they share, pointing to a document per series beside it. These documents are written for whoever develops the package, by the rules of the project's documents; they are not part of a doc page.

## In the Workspace tab

The graph of the Workspace tab ([The Workspace tab](doc_page_impl_source.md#the-workspace-tab)) draws the packages in a tone of their own, **above** the workspace card: an edge `imports` from the workspace to each package it names, an edge `needs` from a package to each package it needs, a package one row above every package needing it. The doc pages grow below the workspace card. The two can be shown or hidden separately; with one of them alone, it grows below the card. Clicking a package shows its description, folder, and what it needs and is needed by. The canvas opens in the block popup.

## Writing a package

A package of components usually groups them in **series**, one folder each under `comp-mdx/`, with a base series holding what the others build on. `package/cloud-dev-vis/` is the example: a base series with the engine of node cards and connection lines on React Flow, and a Power Platform series of cards bound to it through a node registry ([its root document](../package/cloud-dev-vis/doc/README.md)). What the package system does not do yet (a doc page naming its packages, packages from elsewhere than a folder, kinds imported between registries) is in [TODO](doc_page_impl_TODO.md#packages).

## Implementation

| Place | Role |
| --- | --- |
| `plugin/doc-package.ts` | `PACKAGE_CONFIG_FILE_NAME` (`doc-package.yaml`), the fixed folders, `docPackageSpecListRead` (a `packageList`), `docPackageListLoad` (the packages and those they need, in loading order, the checks) |
| `plugin/doc-entry.ts` | `packageList` of the workspace file (`docWorkspaceSpecRead`) |
| `plugin/doc-source.ts` | `packageList` of config beside `docEntry`; the packages loaded (`docEntry.packageList`), the data the page gets (`configDoc.packageList`), the extractors of the manifests (`compDependencyCollectLoad`), the sync of the packages to the backend |
| `plugin/doc-comp-config.ts` | `compPackageRead`: the component folder of a package, read after the doc pages' |
| `plugin/doc-service-server.ts` | `ServiceSyncPackage`, the `packageList` of the sync route |
| `service-backend/service_runtime.py` | `docpage_sync` keeps the packages; `folder_list_get` reads their template folders (origin `package`) |
| `src/lib/doc-workspace-graph.js`, `comp-doc/settings/WorkspaceSettings.jsx` | the packages in the graph of the Workspace tab |
| `package/` | the packages of the project; `package/cloud-dev-vis/` the one the demonstration imports |
