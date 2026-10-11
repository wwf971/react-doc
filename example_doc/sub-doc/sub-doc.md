---
title: Self-contained Sub Document
description: A document declared by its own entry file, included by the demonstration page and deployable on its own
language: en
---

## What this is

This folder is a complete document of its own. Its entry file, `sub-doc-entry.yaml`, declares everything the folder needs: the source rules that collect its files as the root `sub-doc`, the definition of its tag <!--renderComp=Tag-->`sub`, and one side panel whose `root` labels the folder you see in the page side panel.

The demonstration page includes it with one node:

```yaml
- id: sub-doc
  include: ./sub-doc/sub-doc-entry.yaml
```

Nothing else in the page knows about this folder. The main `source.yaml` does not collect it, the main `tag.yaml` does not define `sub`, and the page side panel only names the entry.

## Deploying it alone

Because the entry carries its own `title` and `homeDoc`, `config.yaml` deploys this sub document by naming it:

```yaml
docEntry:
  file: ../example_doc/sub-doc/sub-doc-entry.yaml
```

The page then shows the side panel declared here as its only side panel, with the site title `Sub Document` and this page as its home.

## Pages

- [The entry file](entry-format.md): the sections an entry declares.
- [Including a document](including.md): how a page includes this document and what comes along.
