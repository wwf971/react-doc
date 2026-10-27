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
    isRootVisible: false      # its sole wrapper item shows its children only
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

## One occurrence per doc page

A doc page is one thing however often it is reached. The demonstration doc page includes the sub document (`sub-doc/`) under the alias `sub`; were `sub-doc` listed in `workspace.yaml` as well, it would be shown once, as a section of its own, and the include under `example` would be shielded from the side panel, with its subtree. A doc page without a mount is shown at the first include reached. Shielding changes the side panel shown only: the include is still a mention of the doc page (the Workspace tab draws every edge), and its rules, tags and config are loaded as before.

## The root row hidden

The side panel of this doc page is **one wrapper item**, *Second Doc Page*, holding its two documents: a doc page with a single root often is. Served alone, that row would be shown and opened first; mounted with `isRootVisible: false`, its children appear directly under the heading `second`, as drawn above. The wrapper is not flattened away: it keeps its item id (`second-root`), tags, config and part; only its row is not drawn. Nothing else is hidden by the option: several roots, a leaf or an empty folder keep their display. The Workspace tab of the settings panel has a "root row" checkbox per mount, which rewrites the yaml boolean in place; the side panel follows at once.

## Naming documents of another root doc page

Inside this doc page `~second-doc/second-doc.md` is enough. From the demonstration doc page it is the full form, `~second:second-doc/second-doc.md`; a link to [the document model](~example:example/doc.md) from here is written the same way. A file name works too when only one doc page has it: [[asset-store.md]].
