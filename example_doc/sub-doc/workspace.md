---
title: Workspace and Aliases
description: What a workspace is, how doc pages and roots are named in it, and how a link finds a document across doc pages
language: en
---

## The workspace

A **workspace** is what one deployment serves, or what the development server shows: a list of root-level **doc pages**, each a self-contained folder with its entry in `.doc-page/`. A doc page includes other doc pages through its side panels; they join the same workspace. The demonstration is served from `workspace.yaml` at the root of the project, which `main/config.yaml` names (`workspace.file: ../workspace.yaml`):

```yaml
# workspace.yaml
docPageList:
  - alias: example          # the demonstration doc page
    dir: ./example_doc
  - alias: second           # a second root doc page: a section of its own in the side panel
    dir: ./example_doc/second-doc
```

```text
workspace (workspace.yaml)
├── example   ./example_doc             root doc page, alias "example"
│   └── sub   ./example_doc/sub-doc     included by side-panel.yaml as "sub"
└── second    ./example_doc/second-doc  root doc page, alias "second"
```

A deployment of one doc page needs no workspace file: `config.yaml` names the doc page itself (`docEntry: { dir, alias }`), and the page serves it as a *virtual workspace* holding that doc page alone. Both read the same, so a doc page written for one deployment works in any workspace.

## Two kinds of alias

- A **root alias** names a root folder inside a doc page: the `alias` of an `addFolder` / `addFile` rule, written `~alias/path`. The demonstration doc page has the roots `example` (its folder) and `req` (one file of `main/`); this sub document has `sub-doc`.
- A **doc page alias** names a doc page in the workspace: the `alias` of a workspace item or of an include. It is unique in the workspace, and it prefixes a root alias in the **full form** of a source path, `~docPageAlias:rootAlias/path`.

Both default to a folder name and are better given by hand: a name chosen once stays the same when a folder is renamed, and two folders of one name never collide. Two doc pages under one alias, or two roots of one doc page under one alias, are errors; the same doc page mentioned twice under different aliases keeps the first (root-level first) and reports the other.

## Naming a document across doc pages

Inside a doc page, the short forms are enough, and they always mean this doc page first:

| Written here, in the sub document | Finds |
| --- | --- |
| `[[notes.md]]` | [[notes.md]] of this doc page, although the demonstration doc page has two more |
| `[[entry-format.md]]` | [[entry-format.md]], a name of this doc page |
| `[[database.md]]` | [[database.md]]: no such name here, so the one doc page that has it answers |
| `~sub-doc/including.md` | [a root of this doc page](~sub-doc/including.md) |
| `~example/doc.md` | [a root of another doc page](~example/doc.md): no root `example` here, and only one doc page has one |
| `~example:example/doc.md` | [the full form](~example:example/doc.md), exact wherever it is written |
| `~sub:sub-doc/sub-doc.md` | [this doc page's home](~sub:sub-doc/sub-doc.md), the full form of a local file |

A name that several documents of the same doc page share, like `notes.md` written in the demonstration doc page, shows a list to choose from; a name found in several other doc pages (and not in the local one) does the same. The page itself keeps every document under its full path, so the browser url and the asset folders (`~sub:sub-doc/asset` for this doc page) carry it.

## Seeing the workspace

The **Workspace** tab of the settings panel (the gear in the side panel) draws the workspace as a graph: the workspace, its doc pages, and every mention of a doc page as an edge labeled with the alias that mention gives. A doc page mentioned from several places is one node with several edges (this sub document is included by the `main` and the `compact` side panel of the demonstration entry, both as `sub`). A mention whose alias was not the one kept is drawn dashed and listed as a warning. Choosing a node shows its folder, its entry, its roots and where it is mentioned. Above the graph the tab edits the workspace file and mounts doc pages for now: see [Editing the Workspace](~second:second-doc/workspace-edit.md).
