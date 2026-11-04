---
title: Workspace Sections
description: How the side panel shows a workspace of several root-level doc pages
language: en
---

## One section per root doc page

This document belongs to a second **root-level doc page** of the demonstration workspace. `workspace.yaml`, in the metadata folder of the workspace (`.doc-workspace/` at the root of the project), lists two doc pages:

```yaml
# .doc-workspace/workspace.yaml (found from main/config.yaml: workspace.dir: ..)
docPageList:
  - alias: example            # the demonstration doc page
    dir: ../example_doc
  - alias: second             # this doc page
    dir: ../example_doc/second-doc
    # isRootUnfolded: true    # the default: its sole root item is unfolded
```

With one root doc page, the side panel is that doc page's own side panel. With several, it shows them one after the other, each under its alias as a muted heading:

```text
WORKSPACE   [unfold] [fold]   ◄ unfold / fold every doc page at once
example                       ◄ the alias of the first root doc page
  Example Docs
  Document Model
  ...
second                        ◄ the alias of this doc page
  ⌂ Second Doc Page           ◄ its sole root item, unfolded: a root row opening this document
  ─────────────────
  Editing the Workspace       ◄ the children of the root, at the top
```

A heading folds its doc page's side panel away (a click on it); the buttons above the first heading unfold or fold every section at once. The workspace only arranges the side panels: each doc page keeps its own tree, written in its own entry (this doc page's is `second-doc/.doc-page/entry.yaml`).

## One occurrence per doc page

A doc page is one thing however often it is reached. The demonstration doc page includes the sub document (`sub-doc/`) under the alias `sub`; were `sub-doc` listed in `workspace.yaml` as well, it would be shown once, as a section of its own, and the include under `example` would be shielded from the side panel, with its subtree. A doc page without a mount is shown at the first include reached. Shielding changes the side panel shown only: the include is still a mention of the doc page (the Workspace tab draws every edge), and its rules, tags and config are loaded as before.

## The sole root unfolded

The side panel of this doc page is **one root item**, *Second Doc Page*, holding the rest, as the side panel of a doc page often is. Drawn as a folder under the heading `second`, it would add a level that says nothing (the heading already names the doc page), and the reader would open it first. So a mount **unfolds** a sole root item by default: its children come directly under the heading, and since this root is bound to a document (this one), it is drawn as a **root row** above them: a house icon, the label in the foreground, a hairline under it. A click on it opens the document; it never folds. A root bound to no document has no row at all: its children are simply at the top.

The root is not flattened away: it keeps its item id (`second-root`), tags, config and part. Nothing else is unfolded: several root items, a leaf or an empty folder keep their display. `isRootUnfolded: false` on the mount draws the root as an ordinary folder; the Workspace tab of the settings panel has an "unfold" checkbox per mount, which rewrites the yaml boolean in place, and the side panel follows at once.

## Naming documents of another root doc page

Inside this doc page `~second-doc/second-doc.md` is enough. From the demonstration doc page it is the full form, `~second:second-doc/second-doc.md`; a link to [the document model](~example:example/doc.md) from here is written the same way. A file name works too when only one doc page has it: [[asset-store.md]].
