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

## Component-level config

A registered component can declare config keys of its own; they are resolved through the same levels, per component, under a `compConfig` mapping keyed by the component's tag name. `config.yaml` sets the page values:

```yaml
compConfig:
  Image:
    FileStoreDir: ${imageFileStoreDirDefault}
    PasteReplaceConfirmIsOn: true
```

and a source rule, a side-panel item or the frontmatter of a document overrides them for that document inside its `config` mapping (`config: { compConfig: { Image: { FileStoreDir: ~example/other } } }`). The settings panel (the gear in the side panel) shows the component keys on their own tab, **Component**, apart from the page keys, one group per component; a change there is the reader's override for the page session, like on the Config tab. A key of type `sourcePath` (a folder or file of the source) is edited with completion: the dropdown lists the folders of the source that match what is typed.

`Image` and `ImageGrid` declare `FileStoreDir`, the folder a pasted image is written to, and `PasteReplaceConfirmIsOn` (see [Images](mdx-usage/comp-image.md#image-empty)).

## Variables

`config.yaml` declares variables in its `variable` mapping; `${name}` in any string value of a config declaration (page level, source rules, side-panel items, frontmatter) is replaced by the variable's value. This page's `FileStoreDir` comes from `imageFileStoreDirDefault`, so the folder is written once:

```yaml
variable:
  imageFileStoreDirDefault: ~example/asset-file/image
```

An unknown variable name is left as written and reported in the console.
