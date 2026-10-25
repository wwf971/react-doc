---
title: Workspace Sections
description: How the side panel shows a workspace of several root-level doc pages
language: en
---

## One section per root doc page

This document belongs to a second **root-level doc page** of the demonstration workspace. `workspace.yaml`, at the root of the project, lists two doc pages:

```yaml
# workspace.yaml (named by main/config.yaml: workspace.file: ../workspace.yaml)
docPageList:
  - alias: example            # the demonstration doc page
    dir: ./example_doc
  - alias: second             # this doc page
    dir: ./example_doc/second-doc
```

With one root doc page, the side panel is that doc page's own side panel. With several, it shows them one after the other, each under its alias as a muted heading:

```text
WORKSPACE   [unfold] [fold]   ◄ unfold / fold every doc page at once
example                       ◄ the alias of the first root doc page
  Example Docs
  Document Model
  ...
second                        ◄ the alias of this doc page
  Workspace Sections
  Editing the Workspace
```

A heading folds its doc page's side panel away (a click on it); the buttons above the first heading unfold or fold every section at once. The workspace only arranges the side panels: each doc page keeps its own tree, written in its own entry (this doc page's is `second-doc/.doc-page/entry.yaml`).

## Naming documents of another root doc page

Inside this doc page `~second-doc/second-doc.md` is enough. From the demonstration doc page it is the full form, `~second:second-doc/second-doc.md`; a link to [the document model](~example:example/doc.md) from here is written the same way. A file name works too when only one doc page has it: [[asset-store.md]].
