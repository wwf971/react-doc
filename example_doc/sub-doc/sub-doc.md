---
title: Self-contained Sub Document
description: A document declared by its own entry file, included by the demonstration page and deployable on its own
language: en
---

## What this is

This folder is a complete doc page of its own, laid out by the recommended folder convention of a doc page: its documents in the folder, its metadata in `sub-doc/.doc-page/`. Its entry file, `.doc-page/entry.yaml`, declares everything the folder needs: the source rules that collect its files as the root `sub-doc`, the definition of its tag <!--renderComp=Tag-->`sub`, its config, and one side panel whose `root` labels the folder you see in the page side panel.

The demonstration page includes it with one node, naming the folder; the page finds the entry in it:

```yaml
- id: sub-doc
  include: ../sub-doc      # written in example_doc/.doc-page/side-panel.yaml
```

Nothing else in the page knows about this folder. The main `source.yaml` does not collect it, the main `tag.yaml` does not define `sub`, and the page side panel only names the folder. Its config declarations come along too, below the page's own: the page decides when both set a key.

## Deploying it alone

Because the entry carries its own `title` and `homeDoc`, `config.yaml` deploys this sub document by naming its folder:

```yaml
docEntry:
  dir: ../example_doc/sub-doc
```

The page then shows the side panel declared here as its only side panel, with the site title `Sub Document` and this page as its home.

## Pages

- [The entry file](entry-format.md): the sections an entry declares.
- [Including a document](including.md): how a page includes this document and what comes along.
