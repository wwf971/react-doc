<!-- The command line of the package: creating and serving a doc page, a workspace or a package. Parent document: doc_page_impl_dir.md -->

# The Command Line: Design

The package has one command, `react-doc`, for what is done in a terminal rather than in the page. It **creates** a folder that already follows the folder conventions ([The doc page folder](doc_page_impl_dir.md)), the same way `npm create vite` gives a project that runs before anything is written in it, and it **serves** one: a doc page, a package or a workspace, named by its folder or its entry, with no config file to touch.

```text
react-doc init page <dir>        a doc page: .doc-page/ (entry, source rules, side panel), a home document
react-doc init workspace <dir>   a workspace: .doc-workspace/workspace.yaml and a first doc page in it
react-doc init package <dir>     a package: doc-package.yaml, doc/README.md, .doc-page/

react-doc dev [<path>]           serves it: a doc page, a package or a workspace
react-doc build [<path>] --out   the same as a static page: one html file, or a folder
react-doc where                  where this copy of react-doc finds what it needs
react-doc pack [--out <dir>]     the folder npm publishes (the installed mode)
```

## What each kind creates

```text
react-doc init page notes                    react-doc init workspace team
notes/                                       team/
├── index.md          the home document      ├── .doc-workspace/
└── .doc-page/                               │   ├── workspace.yaml   docPageList: [{ alias: guide, dir: ../guide }]
    ├── entry.yaml     title, homeDoc,       │   └── .gitignore       *.bak
    │                  names the two below   └── guide/               a doc page, as on the left
    ├── source.yaml    the folder, recursive
    ├── side-panel.yaml  one item: index.md  react-doc init package chart-kit
    └── .gitignore     what a run writes:    chart-kit/
                       *.bak, the kernel     ├── doc-package.yaml     name, description, packageDependList: []
                       state, service-       ├── doc/README.md        the root document
                       backup/, service-     ├── .doc-page/           its doc page: entry, source rules, side panel
                       infra/                └── package.json         { "type": "module" }
```

No managed folder is written (`.doc-page/asset/`, `comp-mdx/`, `service-*/` of a doc page; `comp-mdx/` and the template folders of a package): a missing one is empty, and the first item put there makes it ([Managed folders made when first used](doc_page_impl_dir.md#managed-folders-made-when-first-used)). `--folder-empty` writes them, empty, with the commented `comp.yaml` the scaffold keeps in `comp-mdx/`. Each generated file says in comments what it is and which keys can be added, so the files themselves are the guide to what comes next.

| Option | Kind | Meaning | Default |
| --- | --- | --- | --- |
| `--alias` | page | the alias of the doc page and of its root (`~notes/index.md`) | the folder name |
| `--page` | workspace | the alias and folder name of the first doc page | `guide` |
| `--name` | package | the name of the package (lowercase, digits, `-`) | the folder name |
| `--title` | all | the title (`docEntry.title`, the workspace `title`, the package `description`) | the folder name, words capitalized |
| `--force` | all | write into a folder that is not empty | refused |
| `--folder-empty` | page, workspace, package | write the managed folders too, empty | not written |

Rules:

- **Nothing is overwritten.** A folder that is not empty is refused; with `--force` only the missing files are written, and the report lists the files kept. Running `init --force` on an older doc page therefore adds what the convention has and the page lacks, and touches nothing else.
- **Values are checked as the page checks them**: an alias is one word (letters, digits, `_`, `-`, `.`), a package name is lowercase. A title that is not a plain yaml value is written quoted.
- After writing, the command prints what was written and **what to do next**: for a workspace, the line that serves it; for a doc page, how to add it to a workspace; for a package, the `packageList` entry that imports it.

## Serving: `react-doc dev`

```sh
react-doc dev ../react-doc-db-migration           # a doc page, alone, in a virtual workspace
react-doc dev package/cloud-dev-vis               # a package, as a read-only doc page
react-doc dev ../team                             # a workspace
react-doc dev ../notes/.doc-page/entry.yaml       # by its entry; a workspace by its workspace file
react-doc dev ../team --mount ../notes            # a workspace, and one more doc page for this run
```

What a path is, is read from what it holds (`docTargetRead`): `.doc-workspace/workspace.yaml` is a workspace, `doc-package.yaml` a package, `.doc-page/` a doc page; a folder holding two asks for `--kind page | package | workspace`. The current folder is the default.

A **doc page or a package** is served in a [virtual workspace](doc_page_impl_source.md#the-virtual-workspace): one holding it alone, without a workspace file, shown as such in the Workspace tab, with what needs a file refused.

| Option | Meaning | Default |
| --- | --- | --- |
| `--kind` | what the path is, when it holds several | read from the folder |
| `--alias`, `--side-panel` | a doc page: its alias, which of its side panels | the folder name (a package: its name); its default |
| `--mount <path>[,alias=…][,side-panel=…]` | one more doc page for this run, repeatable ([below](#mounting-for-one-run)) | none |
| `--package <dir\|name>` | a package a virtual workspace imports, repeatable | those its entry names |
| `--package-dir <dir>` | a folder of packages, where one named by name is looked for, repeatable | the packages of this react-doc |
| `--backend <file>` | the service backend config to start with the page | `.doc-page/service-backend.yaml` of the doc page, when it has one |
| `--no-backend` | no service backend | |
| `--config <file>` | the package config | `main/config.yaml` of this react-doc |
| `--port`, `--host`, `--open` | the server | the first free port from 45174 |
| `--root <dir>` | serve with the react-doc of this folder, a checkout, instead of this copy | this copy |

The port differs from the 45173 of `pnpm -C main dev`, and vite's cache is per target (in the temporary folder), so several servers and the project's own run side by side. The service backend is not started unless named or kept by the doc page: a doc page without services needs none, and every dashboard says "backend down" without one.

### Mounting for one run

`--mount` adds a doc page to what is served, for as long as the command runs, and writes it in no file:

```sh
react-doc dev ../team --mount ../notes                                 # a doc page, by its folder
react-doc dev ../team --mount ../notes/.doc-page/entry.yaml            # by its entry
react-doc dev ../team --mount ../notes,alias=n                         # under another alias
react-doc dev ../team --mount ../notes,alias=n,side-panel=dev          # and one of its side panels
react-doc dev ../team --mount ../notes --mount ../chart-kit            # several; a package folder is a read-only doc page
react-doc dev ../notes --mount ../chart-kit                            # beside a doc page, in its virtual workspace
```

```text
--mount <path>[,alias=<alias>][,side-panel=<id>]
```

The path comes first and is relative to the current folder, like every path of the command. The keys after it are those of a doc page served alone (`--alias`, `--side-panel`) and of `docPageList` in a workspace file, default the same: the alias is the folder name (a package: its name), the side panel the entry's default. The keys are read from the right, so a path may hold commas.

What it mounts is a [temporary doc page](doc_page_impl_source.md#temporary-doc-pages), the same as one mounted from the Workspace tab: after the doc pages written, marked "temporary" in the side panel, with an Unmount button in the tab. The two differ in one way: running the same command again mounts it again, while a mount from the tab is gone. A doc page that is mounted brings the packages its entry names, so `--package`, which belongs to a virtual workspace, is not needed for it.

A mount that cannot be served stops the command with the reason in one line, rather than being dropped from the page: nothing at the path, a folder holding no doc page, a doc page the workspace holds already, an alias taken, a side panel the entry does not declare.

### Where things are found

```text
a document, a doc page's components       the target; every path of a doc page is relative to itself
the page, built-in/, the backend          this copy of react-doc: react-doc where lists them
a package named by name ({ name })        --package-dir, config packageSearchDirList (package/ of this react-doc),
                                          then node_modules/{name} upward from the file naming it
a package named by folder ({ dir })       that folder
what a doc page's module imports          beside it, else the dependencies of this react-doc
@wwf971/react-doc in such a module        the page (compDefine, RegisteredComp ...), in both modes
```

So a doc page says what it needs by name in its entry (`packageList: [{ name: cloud-dev-vis }]`) and carries no path to where react-doc lies, and it is served the same way on any machine.

### Two modes: a checkout, an installed package

The command works from wherever its script is, and tells which (`react-doc where`, the first line of `dev`, the Workspace tab):

```text
source mode                                 installed mode
  a checkout of the project                   an npm package in node_modules/
  node main/frontend/cli/doc-cli.js dev x     npx react-doc dev x
  pnpm link --global, then react-doc dev x    npm install -g, then react-doc dev x
  a change of the source applies at once      a version, unchanged
```

Both have **one layout**: the published package keeps the layout of the project (`built-in/`, `package/`, `main/config.yaml`, `main/comp-doc/`, `main/frontend/`, `main/service-backend/`), since its modules import each other by relative path. So everything above holds in both. The one difference: vite treats anything under `node_modules/` as a dependency, adding version queries (two urls of one module, two instances of its state) and pre-bundling the page's own source. An installed copy is therefore **served from a copy out of `node_modules/`** (`docLayoutRunGet`): the source copied once per version into `~/.cache/react-doc/{version}-{hash}/` (`REACT_DOC_CACHE_DIR` names another folder), with a `node_modules/` of links to the dependencies, made anew each time. From there it is a checkout like any other.

`react-doc pack` stages what npm publishes, from a checkout: the folders of the layout without build output and backups, and a `package.json` of the whole with the paths of its `bin` and `exports` from that root. Its dependencies are the page's, including what a dev server needs (vite and its plugins, otherwise dev dependencies of the checkout), the imports no manifest declares and the peers of the dependencies, at the versions of the checkout (a hoisted workspace resolves these silently; an install would not have them). `@wwf971/react-comp-misc`, a local package not on npm, is bundled (`bundleDependencies`).

```sh
node main/frontend/cli/doc-cli.js pack --out /tmp/react-doc-pack
npm pack /tmp/react-doc-pack            # or npm publish /tmp/react-doc-pack
```

### The launch layer

`dev` starts vite on `main/frontend` with what to serve in the environment (`REACT_DOC_LAUNCH`, read by `vite.config.ts`, given to `docSourcePlugin({ launch })`). It is one more layer of the package config, over `config.yaml` and `config.0.yaml`, and written nowhere:

```text
launch { kind, target, mode, command,          what was launched; configDoc.workspace.launch, what the page shows
         docEntry | workspace,                 what to serve, in place of those of the files
         mountList?,                           the temporary doc pages it starts with: { dir | file, alias?, sidePanel? }
         packageList?, packageSearchDirList?,  packages beside a doc page, where names are looked for
         backendConfigFile?, configFile? }     the backend, in place of "service" of the files; another config
```

The package defaults of `config.yaml` (components, config defaults, keyboard map) stay in force; its workspace and its backend belong to the demonstration, and do not. The development server of the project, `pnpm -C main dev`, has no launch layer and serves what `config.yaml` (or its local layer `config.0.yaml`) names, as before.

## Building

`react-doc build <path> --out <where>` makes the static page of what `dev` would serve, with the same launch layer, so a doc page lying anywhere deploys without a config file. A built page reads everything from a snapshot and writes nothing ([the asset service layer](doc_page_impl_asset.md), [frontend objects](doc_page_impl_obj_frontend.md)), so no backend is started. What `--out` names decides the form:

```text
--out site/         a folder of static files for a web server: the libraries in chunks of their own,
                    each read only by a page that needs it. a folder holding anything else is refused
                    without --force, since a build empties it
--out page.html     one file holding everything: it opens from disk, offline (a browser refuses the
                    module scripts of a folder opened from disk), to be handed to someone by itself
```

`--out` may not lie inside what is being built: its source rules would collect the build the next time.

### One file

One file has no chunks, so whatever it holds is read when it opens. Without care that is a file of 34 MB for a doc page with half a megabyte of its own, almost all of it libraries only some documents need:

| what | size | needed by |
| --- | --- | --- |
| the spreadsheet engine (Univer) | 11 MB | `ExcelUniver` |
| every language and theme of shiki | 10 MB | the code blocks, which use a few |
| mermaid and its layout engines | 4.5 MB | `DiagramMermaid` |
| fonts in three formats | 1 MB | every browser here reads the woff2 |

The file of the same page is 6.7 MB after these steps, with `--keep-all` turning them off:

- **Reading what the build needs.** `plugin/doc-build-slim.js`, a vite plugin of this command, reads the text the build carries (the documents, the data and metadata of the assets, the source of the components of the doc pages and packages) when the configuration is resolved. The reading is on the safe side: the name of a library anywhere keeps it, even a word of a document, and a name a doc page gives one of these components in its `compRegistry` counts too. A code language is kept when a fenced block names it, by its id or an alias.
- **Leaving out a library at its lazy import.** The page reaches mermaid and Univer only through `import()` in its host config, so `resolveId` answers those imports with a module that only throws. Nothing else imports them, so the bundler drops all they pull in, their css included, and the stub runs only if something asks for the library after all.
- **Filtering the lists of shiki.** Its languages and themes are arrays of entries, each with a lazy `import()` of a grammar. `transform` removes the entries not kept from the source of those lists, so those grammars are never reached. The wasm engine, which the default javascript engine does not need, goes the same way as a library.
- **One font format.** The css has each font three times as base64 (woff2, woff, ttf); only woff2 stays, when the css is put into the html.

What is left is the page itself: 5.7 MB of code, 1 MB of css. If something was left out wrongly it says so where it is used and the rest of the page works: a language is drawn as plain text (as any language shiki does not have is, on every page), and a library fails with a message naming `--keep-all`.

The modules are merged with `output.strictExecutionOrder`: without it a module also imported lazily is wrapped in an init function that a static importer may not call, and the page crashes on load.

## Migrating a doc page

`react-doc migrate <path>` rewrites the doc pages below a folder into the form this react-doc reads, for pages written before asset items were called items and before a frontend object had a folder of its own ([what changed](update-20261107-repl.md)). The page does not read the former form: a store folder holding one reports it once in the console and names this command.

```text
{itemId}--{name}/object.yaml   ->  item.yaml, objectId -> itemId, in dependencies too
                                   the entry of a frontend object: assetList [{ objectId }] -> { itemId }, in every version
a fenced block asset           ->  objectId: -> itemId:   (the prose and the data of a document are not touched)
objectList of a doc page       ->  .doc-page/object-frontend/{id}--{name}/, object.yaml, its assets in item/
typeList of object-frontend.yaml  ->  .doc-page/type.yaml
typeList of an object.yaml        ->  type.yaml beside it
```

`--dry-run` lists what it would change. A second run changes nothing. Nothing is committed: `git add` the folder, and git sees the moves as renames. Stop a running server of the doc page first: an old copy of the code reads the old form.

## Where the command lives

The command is a `bin` of the package's own npm package (`@wwf971/react-doc`, `main/frontend/package.json`: `"bin": { "react-doc": "./cli/doc-cli.js" }`). This is the usual practice for a tool that comes with a library (`vite`, `astro`, `prisma` do the same): the command and the conventions it writes are versioned together, so a scaffold always matches the loader of the same version.

`init`, `where` and `pack` use only node's own modules, so they run from a checkout without an install; `dev` and `build` import vite when they run, and says so when the dependencies are not there. There are three ways to call it, from the most local to the most general:

```text
how                                              needs
node main/frontend/cli/doc-cli.js init ...       the checkout; nothing else
pnpm link --global   (once, in main/frontend)    the checkout; puts react-doc on the PATH of this
  then: react-doc init ...                       machine, pointing at the checkout (npm link the same)
npx @wwf971/react-doc init ...                   the package published to npm; any machine
```

`pnpm link --global` is the standard way to use a command that is being developed: the link points at the checkout, so a change of the script or of the scaffold is used at once, with nothing to rebuild or reinstall; removing the global package removes the link again. Publishing matters only for machines without the checkout.

The `npm create` form (`npm create xxx` runs the package `create-xxx`) needs a package of its own whose only job is to call `react-doc init`; it is not there yet ([TODO](doc_page_impl_TODO.md#command-line)).

## The scaffold folders

Each kind is a folder of `main/frontend/cli/scaffold/` (`doc-page/`, `workspace/`, `package/`), copied file by file. A workspace is its own folder plus the `doc-page/` folder copied into its first doc page. While copying:

- a file inside a managed folder of the kind (`FOLDER_MANAGED_LIST_BY_KIND`) is written only with `--folder-empty`;
- `{{alias}}`, `{{title}}`, `{{name}}`, `{{pageAlias}}` in a file are replaced by the values above (in a yaml file, as a yaml value);
- a file named `_gitignore` is written as `.gitignore`, since npm leaves `.gitignore` files out of a published package.

Changing what a new doc page looks like is therefore editing a file of `scaffold/`, not the script. The scaffold is tested by loading it: the test runs `init` for each kind and loads the result with the page's own loaders (the workspace through `config.yaml` `workspace: { dir }`, the package through the package reader), so a scaffold that drifts from the conventions fails the test.

## Implementation

| Place | Role |
| --- | --- |
| `frontend/cli/doc-cli.js` | the command: argument parsing (`node:util` `parseArgs`); `docInit` (checks, copy, placeholders), the report and the next steps; `docLayoutGet` (the folders of this copy, its mode), `docLayoutRunGet` (the installed mode served out of `node_modules/`), `docTargetRead` (what a path is), `docMountRead` (a `--mount` value), `docLaunchBuild` (the launch layer), `docDev`; `docWhere`; `docPack` |
| `frontend/cli/doc-migrate.js` | `react-doc migrate`: only reads and rewrites files of the folder it is given |
| `frontend/cli/scaffold/` | the scaffold folders: `doc-page/`, `workspace/`, `package/` |
| `frontend/cli/doc-cli.test.js` | each kind created in a temporary folder and loaded by the plugin; `--force`, refusals, the report; what a path is, the launch layer over `config.yaml`, `--mount` values and refusals, a package found by name, a package as a read-only doc page |
| `frontend/package.json` | `bin.react-doc` |
| `frontend/vite.config.ts` | the launch layer from the environment; `@wwf971/react-doc` resolved to the page, wherever the importing module lies |
| `plugin/doc-source.ts` | `DocLaunch`, `docLaunchFromEnvGet`, the launch layer in `loadConfigDoc` (`mountList` starts the list of temporary doc pages, once), `packageSearchDirList`; a module outside the tree falling back to the dependencies of the page (`resolveId`) |
