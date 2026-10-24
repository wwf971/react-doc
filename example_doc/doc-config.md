---
title: Document Config
description: Config layers (default, doc page, client), and document-level config resolved from source rules, side-panel items, and frontmatter
language: en
config:
  TagsDisplayAtMainPanelIsOn: false
---

## Levels

A config key has one page-level value, stacked from the config layers. A document-level key can also be set for single documents. For each document, the levels are applied in this order, and a later level wins:

```text
default (package config.yaml)  <  doc page (.doc-page/entry.yaml and its config files)
  <  source (source.yaml)  <  side panel (side-panel.yaml)  <  document (frontmatter)  <  client (this browser)
```

This page sets one key at each level:

| Key | Level | Where |
| --- | --- | --- |
| `TagsDisplayAtLinkIsOn: true` | source | `setConfigByPath` rule in `source.yaml` |
| `TagsDisplayAtLinkPosition: before` | side panel | `config` on this page's item in `side-panel.yaml` |
| `TagsDisplayAtMainPanelIsOn: false` | document | `config` in this page's frontmatter |

So this page shows no tags next to the path bar, although the default layer turns them on. The table below is read from the config service:

<!--renderComp=DocConfigDemo-->
```text
Resolved config of this document. The document page replaces this block with the DocConfigDemo component.
```

## Config layers

The page-wide levels are **config layers**, shown in the settings panel (the gear in the side panel). The Config and Component tabs carry a second tab line, one tab per layer, then **Result**. The tab of a layer lists only what that layer declares, beside each key where it is written; Result lists every key with the value in effect and the level that decided it.

- **Default** comes with the doc page package: `configDefault` of `main/config.yaml` over the built-in defaults of the keys. It declares every key, and its items are greyed out: it is never changed from the page.
- **Doc page** is declared by this doc page: `config` of `.doc-page/entry.yaml`, which here is a list of a config file (`.doc-page/config.yaml`) and one key written in place after it. The sub document included in the side panel brings its own `config`, stacked below this page's. The tab shows the merged values; press **Edit** to see the declarations side by side, a column each in the order they are applied, with the value the layer takes marked. On the development server any declared value is edited there in place, also one a later declaration overrides: only that value changes in its file, and the previous file is kept as a `.bak` beside it. Adding keys or declarations is done in the files.
- **Client** is kept in this browser (`localStorage`) and survives a reload. It sits above the document levels, so a value there wins over what documents declare. Choose a key from **Add a key…** to declare it here, remove it with the cross after its name, and **Clear cache** drops every value with the storage entry.

Try it: `TagsDisplayAtLinkPosition` is `before` in `.doc-page/config.yaml` and `after` in the entry's own declaration, which comes later and wins (Doc page tab, Edit: both columns hold the key, the second is marked); this page's side-panel item sets `before` again, for this page only. Add `TagsDisplayAtLinkIsOn` on the Client tab: it starts with the page value in effect, off, and the links below lose their tags although a source rule turns them on for this page, because the client layer sits above the document levels. Clear cache drops the value again.

## Tags beside links

Links on this page show the tags of their target, before the link text:

- [Side Panel Tags](side-panel-tag.md)
- [Requirement](doc_page_req.md)

A link title marker decides for one link and wins over every level:

- `"tags:after"`: [Requirement](doc_page_req.md "tags:after")
- `"tags:off"`: [Requirement](doc_page_req.md "tags:off")

Use `"tags:on"` to show tags at the configured position on a page where they are off.

## Component-level config

A registered component can declare config keys of its own; they are resolved through the same levels, per component, under a `compConfig` mapping keyed by the component's tag name, inside any config declaration. This doc page sets them in `.doc-page/config.yaml`:

```yaml
config:
  compConfig:
    Image:
      FileStoreDir: ${imageFileStoreDirDefault}
```

and a source rule, a side-panel item or the frontmatter of a document overrides them for that document inside its `config` mapping (`config: { compConfig: { Image: { FileStoreDir: ~example/other } } }`). The settings panel shows the component keys on their own tab, **Component**, apart from the page keys, one group per component, with the same layer tabs as the Config tab: a change on Doc page is written under the component's tag name into the declaration that holds the key, a change on Client stays in this browser. A key of type `sourcePath` (a folder or file of the source) is edited with completion: the dropdown lists the folders of the source that match what is typed (`FileStoreDir` names a folder, so files are left out). A revert button appears before the path: while typing, it resets the text to what it was when the editing started; after a change has been written, it writes back the value the key had before its first change.

`Image` and `ImageGrid` declare `FileStoreDir`, the folder a pasted image is written to, and `PasteReplaceConfirmIsOn` (see [Images](mdx-usage/comp-image.md#image-empty)).

## Variables

A config file of the doc page (and `main/config.yaml`) declares variables in its `variable` mapping; `${name}` in any string value of a config declaration (any layer, source rules, side-panel items, frontmatter) is replaced by the variable's value. This page's `FileStoreDir` comes from `imageFileStoreDirDefault` of `.doc-page/config.yaml`, so the folder is written once:

```yaml
variable:
  imageFileStoreDirDefault: ~example/asset-file/image
```

The settings panel shows a value as it is written, `${imageFileStoreDirDefault}`, so editing another key never replaces a variable by what it stands for.

An unknown variable name is left as written and reported in the console.
