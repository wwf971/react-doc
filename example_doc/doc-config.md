---
title: Document Config
description: Page-level config, and document-level config resolved from global config, source rules, side-panel items, and frontmatter
language: en
config:
  TagsDisplayAtMainPanelIsOn: false
---

## Levels

A config key has one page-level value in `globalConfig` of `config.yaml`. A document-level key can also be set for single documents. For each document, the levels are applied in this order, and a later level wins:

```text
default  <  global (config.yaml)  <  source (source.yaml)  <  side panel (side-panel.yaml)  <  document (frontmatter)
```

This page sets one key at each level:

| Key | Level | Where |
| --- | --- | --- |
| `TagsDisplayAtLinkIsOn: true` | source | `setConfigByPath` rule in `source.yaml` |
| `TagsDisplayAtLinkPosition: before` | side panel | `config` on this page's item in `side-panel.yaml` |
| `TagsDisplayAtMainPanelIsOn: false` | document | `config` in this page's frontmatter |

So this page shows no tags next to the path bar, although `globalConfig` turns them on. The table below is read from the config service:

<!--renderComp=DocConfigDemo-->
```text
Resolved config of this document. The document page replaces this block with the DocConfigDemo component.
```

## Tags beside links

Links on this page show the tags of their target, before the link text:

- [Side Panel Tags](side-panel-tag.md)
- [Requirement](doc_page_req.md)

A link title marker decides for one link and wins over every level:

- `"tags:after"`: [Requirement](doc_page_req.md "tags:after")
- `"tags:off"`: [Requirement](doc_page_req.md "tags:off")

Use `"tags:on"` to show tags at the configured position on a page where they are off.
