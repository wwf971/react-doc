---
title: Including a Document
description: How a side-panel node includes a side panel of another file, and what comes along with it
language: en
---

## The include node

A folder node of any side panel includes a side panel declared elsewhere through `include`. The reference is a file path, meaning the default side panel of that file, or a mapping that names the file and the side panel. The path of another doc page may be its folder: the page finds the entry in it (`.doc-page/entry.yaml`). When the file is the entry of another doc page, the reference also gives that doc page its **alias** in the workspace:

```yaml
- id: sub-doc
  include: { dir: ../sub-doc, alias: sub }         # a doc page by its folder, as "sub"

- id: sub-doc
  include:
    file: ../sub-doc/.doc-page/entry.yaml          # the entry file itself
    sidePanel: main                                # one side panel of it
    alias: sub

- id: sub-doc
  include: ../sub-doc                              # no alias: the folder name, "sub-doc"

- id: other
  include:
    sidePanel: compact                             # a side panel of the same file
```

The included `tree` becomes the children of the node, before any local `children`. The included `root` is merged onto the node, and explicit properties of the node win: this document's root labels the node `Sub Document`, binds it to the overview, and tags it <!--renderComp=Tag-->`sub`, so the including node needs only an `id`.

## What comes along

Loading a yaml file loads everything in it, once:

- Its source rules are appended after the rules of the file that included it, in order of appearance. The files of this folder are collected because this entry says so, not because the page's `source.yaml` does.
- Its tag definitions are merged below the definitions of the including file, so the including document decides when both define the same tag.
- Its config declarations join the doc page config layer below those of the including document, which decides when both set a key.
- Its other side panels become available for inclusion.
- The doc page joins the workspace under the alias of the include, and its asset folders come along.

Including the same side panel from two places, as the `main` and `compact` side panels of the demonstration entry do, reads the file once: a doc page is one thing however often it is mentioned, identified by its entry file. Its alias is the one of its first mention, a root-level mention of the workspace file first; a later mention under another alias is reported as a warning (the **Workspace** tab of the settings panel lists it, with the mention drawn as a dashed edge) and ignored. Two different doc pages under one alias stop the page from loading.

## Editing labels

In edit mode, the label of the `Sub Document` folder is written into this document's entry file, at `sidePanelById.main.root`, because that is where the text is; the labels of the two pages below it are their titles until an edit adds a `text` line to their node in the same file.
