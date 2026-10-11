---
title: The Entry File
description: The sections of a document entry file and the files it can be split into
language: en
---

## One grammar for every yaml file

Every document has one entry file, named `xxx-entry.yaml` by convention and marked by a `docEntry` section. The entry and every yaml file it reaches share the same sections; a file without `docEntry` is a resource file that only holds declarations for others. This document's entry is the complete, inline form:

```yaml
docEntry:
  title: Sub Document            # siteTitle when config.yaml sets none
  homeDoc: ~sub-doc/sub-doc.md   # homeDoc / homeItem when config.yaml sets none
source:                          # rules | { rules } | { file }
  - action: addFolder
    rootId: sub-doc              # files are named ~sub-doc/path-in-folder
    path: .
    collect: recursive           # recursive | direct | referenced
tag:                             # { defineById } | { file }
  defineById:
    sub: { text: Sub }
sidePanelById:                   # the side panels of the document
  main:
    root: { doc: ~sub-doc/sub-doc.md, text: Sub Document, tags: [sub] }
    tree:
      - doc: ~sub-doc/entry-format.md
      - doc: ~sub-doc/including.md
```

## Splitting the declaration

Each section can live in its own file, which the entry names. The demonstration page's `example-entry.yaml` does exactly this: `source: { file: ./source.yaml }`, `tag: { file: ./tag.yaml }`, and a side panel declared as a reference, `main: { file: ./side-panel.yaml }`, to a resource file whose `sidePanelById.main` holds the tree.

Paths are relative to the file that holds them, and the yaml files of a document are never collected as documents, whatever the source rules say.

## Several side panels

`sidePanelById` holds as many side panels as the document needs. The page shows the default one: `sidePanelDefault`, or the only one declared. `config.yaml` can pick another with `docEntry.sidePanel`. The demonstration entry declares a second side panel, `compact`, a short list for a reduced deployment that includes this sub document a second time.
