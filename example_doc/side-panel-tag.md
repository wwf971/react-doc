---
title: Side Panel Tags
description: Tags declared in source rules and side-panel items, and how side-panel items display them
language: en
---

## Where tags come from

A tag is a short label attached to a document, a source folder, or a side-panel item. This page declares tags in three files:

- `tag.yaml` defines how each tag looks: text, border color, and background color.
- `source.yaml` attaches tags while files are collected: `tags` on an `addFile` rule, and the `addTagByPath` / `addTagByName` steps.
- `side-panel.yaml` attaches tags with `tags` on items. A tag on a document item belongs to the document, not to the item.

Later declarations of the same tag replace earlier ones; different tags are appended. The result is shown next to the path bar of each page, and in the side panel except for the `test` tag:

| Item | Declarations | Resulting tags |
| --- | --- | --- |
| Requirement | source: `reference`; side panel: `guide` | Reference, Guide |
| Links & Navigation | source: `test`; side panel: `part` | Test, Part |
| `sub/notes.md` | source: `test`; side panel: `test` with text `Test (sub)` | Test (sub) |
| `sample.py` | source: `test`, then `code` | Test, Code |
| Component Panel | side panel: `draft`, which has no definition | draft, in the default look |

## Where tags are displayed

- **Side-panel items.** Every side-panel label is rendered by the registry component named `SidePanelItem`. By default this is the package component, which shows the item text followed by the tags of the bound asset. `TagsDisplayAtSidePanelItemsList` in `config.yaml` limits which tags appear there: this page leaves out `test`, so `sub/notes.md` shows no tag in the side panel.
- **Main panel.** The tags of the current page appear next to the path bar above the title (`TagsDisplayAtMainPanelIsOn`). There the `test` tag of `sub/notes.md` is visible.
- **Links.** A link can show the tags of its target (`TagsDisplayAtLink...`). See [Document Config](doc-config.md "tags:after").

This page maps `SidePanelItem` to a small demo wrapper in `config.yaml`. The wrapper keeps the default rendering and adds a file-suffix label, such as `.py`, to non-Markdown documents. That label is a rendering decision only; it is not a tag, so it does not appear in the lists below.

## Tag overview

Clicking a tag on a side-panel item or next to the path bar opens a popup with every asset carrying that tag (`TagsOverviewPopupIsOn`). The assets are arranged like the side panel; assets that no side-panel item shows come last. The same overview can be placed in a document. This is the overview of `guide`:

<!--renderComp=TagOverview,tagId=guide-->
```text
Overview of the "guide" tag. The document page replaces this block with the TagOverview component.
```

## All tags of this page

The list below is read from the tag service: every known tag, and the assets bound to it.

<!--renderComp=TagListAllDemo-->
```text
Tag list. The document page replaces this block with the TagListAllDemo demo component.
```
