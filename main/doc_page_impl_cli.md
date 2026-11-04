<!-- The command line of the package: scaffolding a doc page, a workspace or a package. Parent document: doc_page_impl_dir.md -->

# The Command Line: Design

The package has one command, `react-doc`, for what is done in a terminal rather than in the page. It currently does one thing: **scaffolding**. `react-doc init` creates a folder that already follows the folder conventions ([The doc page folder](doc_page_impl_dir.md)): a doc page, a workspace, or a package. The folder is almost empty but loads as it is, the same way `npm create vite` gives a project that runs before anything is written in it.

```text
react-doc init page <dir>        a doc page: .doc-page/ (entry, source rules, side panel), a home document
react-doc init workspace <dir>   a workspace: .doc-workspace/workspace.yaml and a first doc page in it
react-doc init package <dir>     a package: doc-package.yaml, doc/README.md, comp-mdx/
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
                       backup/, service-     └── package.json         { "type": "module" }
                       infra/
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

## Serving what was created

The development server serves the workspace that `main/config.yaml` names. To serve a scaffolded workspace without touching that tracked file, name its folder in the local layer of the package config, `main/config.0.yaml` (ignored by git, merged over `config.yaml`):

```yaml
# main/config.0.yaml
workspace:
  dir: /path/to/team          # its file is found in .doc-workspace/
```

and start the server (`pnpm -C main dev`). A scaffolded doc page joins a workspace by a line in its `docPageList`, or is mounted for a while from the Workspace tab of the settings panel ([temporary doc pages](doc_page_impl_source.md#temporary-doc-pages)).

## Where the command lives, and why it needs no publishing

The command is a `bin` of the package's own npm package (`@wwf971/react-doc`, `main/frontend/package.json`: `"bin": { "react-doc": "./cli/doc-cli.js" }`). This is the usual practice for a tool that comes with a library (`vite`, `astro`, `prisma` do the same): the command and the conventions it writes are versioned together, so a scaffold always matches the loader of the same version.

Publishing is **not** needed to use it. The script uses only node's own modules, so it runs from a checkout without an install. There are three ways to call it, from the most local to the most general:

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
| `frontend/cli/doc-cli.js` | the command: argument parsing (`node:util` `parseArgs`), `docInit` (checks, copy, placeholders), the report and the next steps |
| `frontend/cli/scaffold/` | the scaffold folders: `doc-page/`, `workspace/`, `package/` |
| `frontend/cli/doc-cli.test.js` | each kind created in a temporary folder and loaded by the plugin; `--force`, refusals, the report |
| `frontend/package.json` | `bin.react-doc` |
