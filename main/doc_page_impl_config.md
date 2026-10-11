<!-- Design of the config system. Parent document: doc_page_impl.md -->

# Config System: Design

The config system decides how the doc page behaves, for example whether tags appear next to the path bar. It has three parts:

- **Global config**: one value per key for the whole page, written in `config.yaml`.
- **Document config**: for some keys, a single document can have its own value. That value is resolved from several places in a fixed order: global config, source rules, side-panel items, and the document's frontmatter.
- **User config**: the reader changes a value for the page session from the settings panel; it wins over everything declared and is gone with the page.

The keys of the page are declared in code. A registered component may declare keys of its own, which go through the same levels under a `compConfig` mapping, kept visibly apart from the page keys ([Component-level config](#component-level-config)); and a value at any level may use a variable of `config.yaml` ([Variables](#variables)). All parts use the same lists of known keys, and renderers read them through one config service. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

```text
key definitions (code)          which keys exist, their values, default, scope
component definitions (code)    the keys a component declares for itself (compDefine configDefineList)
        │
config.yaml globalConfig  ──►  page-level value of every page key
config.yaml compConfig    ──►  page-level value of every component key, by component name
        │                      (${name} in a value: config.yaml variable)
        │  document-level keys only, later wins:
        ├── source.yaml       rules that collected the document         config: { K, compConfig: { Comp: { K } } }
        ├── side-panel.yaml   items that bind the document, or a folder above it
        └── frontmatter       "config" of the document itself
        │
settings panel (reader, not persisted)  ──►  overrides any key, page or document; tabs Config / Component
        ▼
DocConfigStore  ──►  config service  ──►  renderers (side-panel items, path bar, links, ...)
                                     ──►  RegisteredComp: config.compConfig of every component
```

This is separate from the rest of `config.yaml`, such as `source`, `sidePanel`, `tag`, and `compRegistry`. Those describe what the page contains. The config system describes how features behave.

## Core concepts

- **Key definition**: declares that a key exists: its value type, its default, its scope, a description for the settings panel, and whether the reader may change it. Definitions live in code; values live in YAML. This mirrors the component registry, where code decides what exists and config decides what is used.
- **Scope**: `page` keys have one value for the whole page and are read from global config and the user level. `doc` keys can additionally be set for single documents.
- **Level**: one place where a value can be declared. The levels are default, global, source, side panel, document, and user. Some features add an inline level of their own, such as a link title marker.
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
  TagsOverviewPopupAtSidePanelItemIsOn: false
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
| `TagsOverviewPopupAtSidePanelItemIsOn` | page | `false` | The popup also opens from a tag on a side-panel item. Off, a click there is a plain navigation gesture. |
| `EditBlockEnterMode` | page | `click` | `click`: a block enters edit mode by clicking it (the caret at the clicked text) as well as through the Edit button of its toolbar; `button`: through the Edit button only. Development server only. |

How the tag features behave is described in [Tag system](doc_page_impl_tag.md#where-tags-are-displayed), the edit key in [In-place editing](doc_page_impl_edit.md#availability-and-mode).

## Document config

### Resolution steps

```text
value of a document-level key K for document D:
1. default        definition default
2. global         config.yaml globalConfig.K
3. source         source rules that collected D, in rule order
4. side panel     side-panel nodes that bind D, or a folder node above an item of D, in tree order
5. document       frontmatter config.K of D
6. user           the reader's override from the settings panel
-> a later level replaces the value of an earlier one, key by key
```

A level only replaces the keys it writes. If a document sets `TagsDisplayAtLinkPosition` in its frontmatter, the other keys keep the values from the earlier levels.

A page-level key written at levels 3 to 5 is ignored with a warning. So is an unknown key or a value of the wrong type. When this happens, the earlier value stays in effect. Level 6 is the exception that applies to both scopes: the reader's choice is meant to win for the whole page.

A page without a document, such as a component panel or an inline side-panel item, uses the global value.

Example, with the declarations in order:

```text
config.yaml       globalConfig: TagsDisplayAtLinkIsOn: false
source.yaml       setConfigByPath ~guide/**, TagsDisplayAtLinkIsOn: true
side-panel.yaml   folder "Guide" above ~guide/a.md, TagsDisplayAtLinkPosition: before
~guide/a.md       frontmatter config: TagsDisplayAtLinkIsOn: false
-> ~guide/a.md:   TagsDisplayAtLinkIsOn false (document), TagsDisplayAtLinkPosition before (side panel)
-> ~guide/b.md:   TagsDisplayAtLinkIsOn true (source), TagsDisplayAtLinkPosition before (side panel)
```

### Declaring document config

Every level uses a `config` mapping with the same keys as `globalConfig`.

Source rules (`source.yaml`) work like the tag steps of source rules:

```yaml
rules:
  - action: addFolder
    rootId: guide
    path: ./guide
    collect: recursive
    config:                   # every file this rule collects
      TagsDisplayAtLinkIsOn: true
  - action: setConfigByPath   # files collected so far, glob on the source path
    pattern: "~guide/api/**"
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
      - doc: ~guide/a.md
        config:               # this document; declared later, so it wins
          TagsDisplayAtLinkIsOn: true
      - sourceFolder: ~guide/api
```

`config` on a node applies to the document the node binds and to every document bound by items below it, including items generated from `sourceFolder`. Nodes are read in tree order, so a deeper node overrides its folder. When a document is bound by several items, the later item in tree order wins. A `root` mapping of an included side panel (`include`) can carry `config` like any other property of the including node.

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

### Part index level

A hosted part index belongs to its index document, so its links follow that document's config, whichever document is shown beside it. `part.index.config` on the part root of the side panel can replace document-level keys for the hosted index only:

```yaml
- id: guide
  part:
    index:
      docId: guide
      componentId: guide-index
      config:
        TagsDisplayAtLinkIsOn: true
        TagsDisplayAtLinkPosition: before
```

```text
hosted index of part P, index document D:
  levels 1-5 of D  <  part.index.config of P  <  user level (for the declared keys)  <  inline level
```

The level does not change the config of D itself: the same index rendered inside D, and every other component of D, keep levels 1-5. Page-level keys, unknown keys, and invalid values are ignored with a warning, as at the other levels. `DocConfigStore.configPartIndexOverrideGet(partId)` returns the validated keys; the index host passes them as `config.configDocOverride`.

### Inline level

Some features also accept a value on one single use, which wins over every level. Document links take a title marker, for example `[Setup](setup.md "tags:before")`. The marker forms are described in [Tag system](doc_page_impl_tag.md#tags-beside-links).

## User level

The reader can change the value of a key for the page session. The settings button (a gear, left of the sidebar collapse trigger in the sidebar header) opens the settings panel, a floating panel anchored under the button with three tabs. The **Config** tab lists every key definition with `isUserSettable` not `false`: its key, its description, and a control for its type (switch for `boolean`, dropdown for `enum`, number or text field otherwise; `any` keys are listed hidden). A value the reader changes becomes the user level, level 6 of the resolution: it replaces the declared value of the key at the page level, in every document, and in part index overrides that declared the key. Reset returns every key, page and component, to its declared value. Nothing is persisted; a reload starts from the declared values again. The **Component** tab is the same for the keys components declare ([Component-level config](#component-level-config)), one group per component. The **Asset store** tab is not config of the page at all but the folders of the local asset store, and the opposite in persistence: a change there is written to the store's own file by the development server ([the local store](doc_page_impl_asset.md#the-local-store-folders-fully-reflected)). It lives in the settings panel because it is where a reader looks for how the page is set up. The tab shown is `DocConfigStore.settingsTabId`, kept while the panel is closed.

```text
settings panel ──► DocConfigStore.valueUserSet(key, value) ──► configUserByKey (observable)
                                                                      │
                                   configModelBuild({ ..., configUser })  recomputes
                                                                      ▼
                                   configGlobal / configByDocPath / configPartIndexByPartId  (with the override)
                                   configGlobalDeclared                                      (without it: the panel's "declared" value)
```

A key can be listed but not changeable at the moment: the panel marks the item disabled and says why in its tooltip. `EditBlockEnterMode` is disabled with "editing is available on the development server only" when the page has no edit api, so a built page lists the key but cannot change it; a key whose feature is absent for a similar reason follows the same form. The panel itself is a `ConfigPanel` of `@wwf971/react-comp-misc`, which the application injects through `config.components.ConfigPanel` of `DocPageMdx` (as it injects `SegmentedControl` for the local index); without it the settings button renders nothing. `isHidden`, `isDisabled`, and `disabledReason` on a panel item are the panel's own item properties.

Store api of the level:

```text
configDefineListUserSettable          the definitions the panel lists
valueDeclaredGet(key)                 page value without the reader's override
valueUserSet(key, value) / valueUserClear(key) / configUserClear()   (clears component keys too)
compIdListWithConfig, compConfigDefineListGet(compId)                the Component tab
compValueDeclaredGet(compId, key) / compValueUserSet(compId, key, value)
isUserOverrideAny                     whether Reset has anything to do
isSettingsOpen, settingsOpenSet(isOpen, anchorElement)
settingsTabId, settingsTabIdSet(tabId)  'config' | 'compConfig' | 'assetStore'
```

## Config service

`DocConfigStore` owns the config model as a mobx computed value. It is derived from the manifest, the side-panel tree, and `globalConfig`, so during development it follows source changes without separate refresh logic. Renderers query it through the config service, a stable object available as `useDocStores().configStore.configService`:

```text
configGlobalGet()               { key: value } of every key, page level
valueGlobalGet(key)             one page-level value
configDocGet(docPath)           { key: value } of every key, resolved for one document
valueDocGet(docPath, key)       one resolved value
levelDocGet(docPath, key)       level that decided it: default | global | source | sidePanel | doc | user
configDefineListGet()           every key definition
compConfigGet(compId, docPath)  { key: value } of a component's own keys, resolved for one document
compConfigDefineListGet(compId) the keys a component declares
```

Calls from observer components are tracked by mobx. Side-panel item renderers receive the page-level values and the service directly in their `config` (`config.configGlobal`, `config.configService`). See [Side panel design](doc_page_impl_side_panel.md#renderer-interface).

## Adding keys

A new feature adds its key definitions to `configDefineListBuiltin` in `lib/doc-config-define.js`, then reads the values through the config service. An application can define its own keys through `DocPageMdx` `config.configDefineList`, using the same form. A definition with an existing key replaces the built-in one.

```js
{
  key: 'TagsDisplayAtLinkPosition', type: 'enum', valueList: ['before', 'after'], valueDefault: 'after', scope: 'doc',
  description: 'Where the tags of a link target appear, before or after the link text.',
}
```

Supported types are `boolean`, `string`, `number`, `enum` (with `valueList`), `stringList`, `sourcePath`, and `any`. `null` is accepted only when it is the default, and it means "not set". `description` is the text of the key in the settings panel; `isUserSettable: false` keeps a key out of the panel (the default is listed).

A `sourcePath` key holds a string that names a folder or a file of the doc page source by its source path (`~rootId/…`, [source paths](doc_page_impl_source.md#source-paths)). The definition says what it names with `pathSpec: { kind: 'dir' | 'file', extList? }`, and the settings panel edits it with completion from the source layer (`SourcePathInput`: the editable text itself, a dropdown of `sourceStore.pathComplete(typed, pathSpec)` below it, arrow keys and Enter), instead of a plain text field. The value is validated as a string; whether the path exists is the concern of whoever reads it, since a folder for files the page creates may not exist yet.

## Component-level config

A component may need settings of its own: where `Image` writes a pasted image, whether it asks before replacing one. They are config of the page in every way (declared at the same levels, overridden per document, changed by the reader), yet they are not keys of the page: they belong to one component, their names make sense only beside it, and an application with thirty components would otherwise fill the key list with keys nobody can place. So a component declares its own keys, and they are kept under their own mapping everywhere a page key is written.

A registered component declares its keys in its definition, the same form as a page key without `scope` (every component key is document-level):

```js
compDefine(ImageRender, {
  configDefineList: [
    { key: 'FileStoreDir', type: 'sourcePath', pathSpec: { kind: 'dir' }, valueDefault: null,
      description: 'The folder of the source a pasted image is written to.' },
    { key: 'PasteReplaceConfirmIsOn', type: 'boolean', valueDefault: true,
      description: 'Ask before a pasted image replaces the current one.' },
  ],
})
```

Values are set under `compConfig`, by the component's tag name of `compRegistry` (the store turns the name into the component id the keys are declared for, so two names of one component share its keys):

```yaml
# config.yaml: the page level, a sibling of globalConfig
compConfig:
  Image:
    FileStoreDir: ${imageFileStoreDirDefault}
    PasteReplaceConfirmIsOn: true

# a source rule, a side-panel node, or frontmatter: inside the "config" mapping of the level
config:
  TagsDisplayAtLinkIsOn: true
  compConfig:
    Image:
      FileStoreDir: ~guide/images
```

The resolution is the one of [document config](#resolution-steps), run per component: default, `config.yaml` `compConfig`, the `compConfig` mapping of the source rules, of the side-panel nodes, of the frontmatter, and the reader's override. The page keys and the component keys never mix: a `compConfig` mapping inside a `config` is not a page key, and a component key written beside the page keys is unknown and warned about. A name that is not in `compRegistry`, or a key the component does not declare, is warned about and ignored like an unknown page key.

A component receives its resolved values as `config.compConfig` (the `config` prop of every registered component, [component registry](doc_page_impl.md#component-registry)), resolved for the document it is rendered in, so a component reads `config.compConfig.FileStoreDir` and knows nothing of the levels. The settings panel lists the component keys on a tab of their own, **Component**, grouped by component name (only components that declare keys appear; a page without such components says so), and a change there is the user level of that key as for a page key. The config service answers `compConfigGet(compId, docPath)` and `compConfigDefineListGet(compId)`; the store keeps `compValueDeclaredGet`, `compValueUserSet`, and `compIdListWithConfig` for the panel.

## Variables

A value that several keys share, such as the folder pasted images go to for `Image` and for `ImageGrid`, is written once as a variable of `config.yaml` and used as `${name}`:

```yaml
variable:
  imageFileStoreDirDefault: ~example/asset-file/image

compConfig:
  Image:
    FileStoreDir: ${imageFileStoreDirDefault}
  ImageGrid:
    FileStoreDir: ${imageFileStoreDirDefault}
```

`${name}` is replaced in every string value of every level, page keys and component keys alike (`variableExpand`), when the config model is built; a name that is not declared stays as written and is warned about with the place it was found. The mapping is one more entry of `config.yaml`, so `config.0.yaml` overrides a variable like any other entry, which is the intended way to point a local checkout at another folder without touching the keys that use it. Variables hold strings, are not nested, and are not read by anything but the config model; a built-in variable is simply one the demonstration config declares and documents, there is no hidden set.

## Implementation files

All config logic uses the `doc-config` prefix:

```text
frontend/src/lib/doc-config-define.js      key definitions, value validation (shared with the plugin), the
                                           component key index (compConfigDefineByCompIdBuild), variableExpand
frontend/plugin/doc-config-source.ts       source and frontmatter levels, called from the source scan
frontend/src/lib/doc-config-side-panel.js  side-panel level, called from page-tree.js
frontend/src/lib/doc-config-model.js       resolution into the config model
frontend/src/store/DocConfigStore.ts       config model owner, user level (page and component keys), settings
                                           panel state, config service
comp-doc/registry/comp-registry.js         compDefine configDefineList: the keys of a component
comp-doc/registry/RegisteredComp.jsx       config.compConfig of every rendered component
comp-doc/settings/                         DocSettingsButton (sidebar header), DocSettingsPanel (floating, anchored to the
                                           button; tabs Config / Component / Asset store), AssetStoreSettings (the asset
                                           store tab), SourcePathSettingsItem in DocSettingsPanel (a sourcePath key, edited with completion)
comp-doc/source/SourcePathInput.jsx        the editable path with its completion dropdown (source layer)
```
