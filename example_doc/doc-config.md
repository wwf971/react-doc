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
default  <  global (config.yaml)  <  source (source.yaml)  <  side panel (side-panel.yaml)  <  document (frontmatter)  <  client (this browser)
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

## Config layers

The two page-wide levels, global and client, are **config layers**: values the page can also write, from the settings panel (the gear in the side panel). The Config and Component tabs carry a second tab line, one tab per layer:

- **Global** is `config.yaml`. A change there is written into the file by the development server: only the one value changes, the rest of the file, its order and its comments stay, and the previous file is kept beside it as `config.yaml.bak`. On a built page the tab is shown but cannot be changed.
- **Client** is kept in this browser (`localStorage`) and survives a reload. It sits above the document levels, so a value there wins over what documents declare; **Reset** drops every value of it.

The tab of a layer shows the page values with the layers up to that one applied, and beside each key the level that decided it (`default`, `global`, `client`). Try it: `TagsDisplayAtLinkIsOn` is `false` in `config.yaml`, and a source rule turns it on for this page. Turn it on in the Client tab and nothing changes here (the source rule already did), but every other page shows tags beside its links; turn it off there and the links below lose their tags although the source rule turns them on, because the client layer sits above the document levels. Reset drops the value again.

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

and a source rule, a side-panel item or the frontmatter of a document overrides them for that document inside its `config` mapping (`config: { compConfig: { Image: { FileStoreDir: ~example/other } } }`). The settings panel shows the component keys on their own tab, **Component**, apart from the page keys, one group per component, with the same layer tabs as the Config tab: a change on Global is written under the component's tag name in `compConfig` of `config.yaml`, a change on Client stays in this browser. A key of type `sourcePath` (a folder or file of the source) is edited with completion: the dropdown lists the folders of the source that match what is typed (`FileStoreDir` names a folder, so files are left out).

`Image` and `ImageGrid` declare `FileStoreDir`, the folder a pasted image is written to, and `PasteReplaceConfirmIsOn` (see [Images](mdx-usage/comp-image.md#image-empty)).

## Variables

`config.yaml` declares variables in its `variable` mapping; `${name}` in any string value of a config declaration (page level, source rules, side-panel items, frontmatter) is replaced by the variable's value. This page's `FileStoreDir` comes from `imageFileStoreDirDefault`, so the folder is written once:

```yaml
variable:
  imageFileStoreDirDefault: ~example/asset-file/image
```

An unknown variable name is left as written and reported in the console.
