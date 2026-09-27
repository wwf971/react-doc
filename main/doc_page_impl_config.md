<!-- Design of the config system. Parent document: doc_page_impl.md -->

# Config System: Design

The config system decides how the doc page behaves, for example whether tags appear next to the path bar. It has two parts:

- **Global config**: one value per key for the whole page, written in `config.yaml`.
- **Document config**: for some keys, a single document can have its own value. That value is resolved from several places in a fixed order: global config, source rules, side-panel items, and the document's frontmatter.

Both parts use the same list of known keys, and renderers read both through one config service. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

```text
key definitions (code)          which keys exist, their values, default, scope
        │
config.yaml globalConfig  ──►  page-level value of every key
        │
        │  document-level keys only, later wins:
        ├── source.yaml       rules that collected the document
        ├── side-panel.yaml   items that bind the document, or a folder above it
        └── frontmatter       "config" of the document itself
        ▼
DocConfigStore  ──►  config service  ──►  renderers (side-panel items, path bar, links, ...)
```

This is separate from the rest of `config.yaml`, such as `source`, `sidePanel`, `tag`, and `compRegistry`. Those describe what the page contains. The config system describes how features behave.

## Core concepts

- **Key definition**: declares that a key exists: its value type, its default, and its scope. Definitions live in code; values live in YAML. This mirrors the component registry, where code decides what exists and config decides what is used.
- **Scope**: `page` keys have one value for the whole page and are read only from global config. `doc` keys can additionally be set for single documents.
- **Level**: one place where a value can be declared. The levels are default, global, source, side panel, and document. Some features add an inline level of their own, such as a link title marker.
- **Config service**: the query object renderers use. They never read `globalConfig`, source rules, side-panel nodes, or frontmatter themselves.

## Naming keys

Keys are PascalCase. Keys that belong to the same feature start with the same prefix, so they sort together and a reader can see which keys work together:

```text
TagsDisplayAtMainPanel...       tags next to the path bar of the main panel
TagsDisplayAtSidePanelItem...   tags on side-panel item labels
TagsDisplayAtLink...            tags beside document links
TagsOverviewPopup...            popup listing the assets of one tag
```

After the prefix comes what the key controls:

- A switch that turns a feature on or off ends with `IsOn`, for example `TagsDisplayAtLinkIsOn`. Do not use `isXxxEnabled`.
- A list ends with `List`, for example `TagsDisplayAtSidePanelItemsList`.
- Other values are named after the property, for example `TagsDisplayAtLinkPosition`.

A new feature picks one prefix and uses it for all of its keys.

## Global config

`globalConfig` in `config.yaml` sets the page-level value of keys. Like every entry of `config.yaml`, it can be overridden locally in `config.0.yaml`. A key that is not written keeps its default.

```yaml
globalConfig:
  TagsDisplayAtMainPanelIsOn: true
  TagsDisplayAtSidePanelItemIsOn: true
  TagsDisplayAtSidePanelItemsList: [chapter, guide]
  TagsDisplayAtLinkIsOn: false
  TagsDisplayAtLinkPosition: after
  TagsOverviewPopupIsOn: true
```

Built-in keys:

| Key | Scope | Default | Meaning |
| --- | --- | --- | --- |
| `TagsDisplayAtMainPanelIsOn` | doc | `true` | Show the tags of the current page next to the path bar. |
| `TagsDisplayAtSidePanelItemIsOn` | page | `true` | Show tags on side-panel item labels. |
| `TagsDisplayAtSidePanelItemsList` | page | all tags | Tag ids shown on side-panel items. Other tags are still attached and shown elsewhere. |
| `TagsDisplayAtLinkIsOn` | doc | `false` | Show the target's tags beside document links in a document. |
| `TagsDisplayAtLinkPosition` | doc | `after` | `before` or `after` the link text. |
| `TagsOverviewPopupIsOn` | page | `true` | Clicking a tag opens the tag overview popup. |

How these features behave is described in [Tag system](doc_page_impl_tag.md#where-tags-are-displayed).

## Document config

### Resolution steps

```text
value of a document-level key K for document D:
1. default        definition default
2. global         config.yaml globalConfig.K
3. source         source rules that collected D, in rule order
4. side panel     side-panel nodes that bind D, or a folder node above an item of D, in tree order
5. document       frontmatter config.K of D
-> a later level replaces the value of an earlier one, key by key
```

A level only replaces the keys it writes. If a document sets `TagsDisplayAtLinkPosition` in its frontmatter, the other keys keep the values from the earlier levels.

A page-level key written at levels 3 to 5 is ignored with a warning. So is an unknown key or a value of the wrong type. When this happens, the earlier value stays in effect.

A page without a document, such as a component panel or an inline side-panel item, uses the global value.

Example, with the declarations in order:

```text
config.yaml       globalConfig: TagsDisplayAtLinkIsOn: false
source.yaml       setConfigByPath /guide/**, TagsDisplayAtLinkIsOn: true
side-panel.yaml   folder "Guide" above /guide/a.md, TagsDisplayAtLinkPosition: before
/guide/a.md       frontmatter config: TagsDisplayAtLinkIsOn: false
-> /guide/a.md:   TagsDisplayAtLinkIsOn false (document), TagsDisplayAtLinkPosition before (side panel)
-> /guide/b.md:   TagsDisplayAtLinkIsOn true (source), TagsDisplayAtLinkPosition before (side panel)
```

### Declaring document config

Every level uses a `config` mapping with the same keys as `globalConfig`.

Source rules (`source.yaml`) work like the tag steps of source rules:

```yaml
rules:
  - action: addFolder
    rootId: guide
    path: ./guide
    config:                   # every file this rule collects
      TagsDisplayAtLinkIsOn: true
  - action: setConfigByPath   # files collected so far, glob on the internal path
    pattern: "/guide/api/**"
    config:
      TagsDisplayAtMainPanelIsOn: false
  - action: setConfigByName   # files collected so far, glob on the file name
    pattern: "*.py"
    config:
      TagsDisplayAtMainPanelIsOn: false
```

A file collected by several rules gets their config in rule order. A removed file loses its config together with itself.

Side-panel items (`side-panel.yaml`):

```yaml
tree:
  - id: guide
    text: Guide
    config:                   # every document below this folder
      TagsDisplayAtLinkPosition: before
    children:
      - doc: /guide/a.md
        config:               # this document; declared later, so it wins
          TagsDisplayAtLinkIsOn: true
      - sourceFolder: /guide/api
```

`config` on a node applies to the document the node binds and to every document bound by items below it, including items generated from `sourceFolder`. Nodes are read in tree order, so a deeper node overrides its folder. When a document is bound by several items, the later item in tree order wins. A `root` mapping imported through `childrenFile` can carry `config` like any other property of the importing node.

Document frontmatter:

```markdown
---
title: API reference
config:
  TagsDisplayAtLinkIsOn: true
  TagsDisplayAtLinkPosition: before
---
```

The vite plugin reads source and frontmatter config at build time and puts it in the manifest (`entry.configSource`, `entry.configFrontmatter`). The side-panel level is read in the browser while the side-panel tree is built. Validation happens in the browser, where the key definitions are known, including the ones added by the application.

### Inline level

Some features also accept a value on one single use, which wins over every level. Document links take a title marker, for example `[Setup](setup.md "tags:before")`. The marker forms are described in [Tag system](doc_page_impl_tag.md#tags-beside-links).

## Config service

`DocConfigStore` owns the config model as a mobx computed value. It is derived from the manifest, the side-panel tree, and `globalConfig`, so during development it follows source changes without separate refresh logic. Renderers query it through the config service, a stable object available as `useDocStores().configStore.configService`:

```text
configGlobalGet()               { key: value } of every key, page level
valueGlobalGet(key)             one page-level value
configDocGet(docPath)           { key: value } of every key, resolved for one document
valueDocGet(docPath, key)       one resolved value
levelDocGet(docPath, key)       level that decided it: default | global | source | sidePanel | doc
configDefineListGet()           every key definition
```

Calls from observer components are tracked by mobx. Side-panel item renderers receive the page-level values and the service directly in their `config` (`config.configGlobal`, `config.configService`). See [Side panel design](doc_page_side_panel.md#renderer-interface).

## Adding keys

A new feature adds its key definitions to `configDefineListBuiltin` in `lib/doc-config-define.js`, then reads the values through the config service. An application can define its own keys through `DocPageMdx` `config.configDefineList`, using the same form. A definition with an existing key replaces the built-in one.

```js
{ key: 'TagsDisplayAtLinkPosition', type: 'enum', valueList: ['before', 'after'], valueDefault: 'after', scope: 'doc' }
```

Supported types are `boolean`, `string`, `number`, `enum` (with `valueList`), `stringList`, and `any`. `null` is accepted only when it is the default, and it means "not set".

## Implementation files

All config logic uses the `doc-config` prefix:

```text
frontend/src/lib/doc-config-define.js      key definitions, value validation (shared with the plugin)
frontend/plugin/doc-config-source.ts       source and frontmatter levels, called from the source scan
frontend/src/lib/doc-config-side-panel.js  side-panel level, called from page-tree.js
frontend/src/lib/doc-config-model.js       resolution into the config model
frontend/src/store/DocConfigStore.ts       config model owner and config service
```
