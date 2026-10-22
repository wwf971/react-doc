<!-- Design of the config system. Parent document: doc_page_impl.md -->

# Config System: Design

The config system decides how the doc page behaves, for example whether tags appear next to the path bar. It has three parts:

- **Config layers**: page-wide values, one per key, stacked in a fixed order ([Config layers](#config-layers)). The page has two: the **global** layer, `config.yaml`, and the **client** layer, kept in the reader's browser. Both are edited from the settings panel.
- **Document config**: for some keys, a single document can have its own value. That value is resolved from several places in a fixed order: the global layer, source rules, side-panel items, the document's frontmatter, then the client layer.

The keys of the page are declared in code. A registered component may declare keys of its own, which go through the same levels under a `compConfig` mapping, kept visibly apart from the page keys ([Component-level config](#component-level-config)); and a value at any level may use a variable of `config.yaml` ([Variables](#variables)). All parts use the same lists of known keys, and renderers read them through one config service. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

```text
key definitions (code)          which keys exist, their values, default, scope
component definitions (code)    the keys a component declares for itself (compDefine expose.meta.configDefineList)
layer definitions (code)        which config layers exist, how each is stored, where it sits
        │
global layer: config.yaml globalConfig  ──►  page-level value of every page key
              config.yaml compConfig    ──►  page-level value of every component key, by component name
        │                                    (${name} in a value: config.yaml variable)
        │  document-level keys only, later wins:
        ├── source.yaml       rules that collected the document         config: { K, compConfig: { Comp: { K } } }
        ├── side-panel.yaml   items that bind the document, or a folder above it
        └── frontmatter       "config" of the document itself
        │
client layer: this browser's storage  ──►  overrides any key, page or document
        ▼
DocConfigStore  ──►  config service  ──►  renderers (side-panel items, path bar, links, ...)
                                     ──►  RegisteredComp: config.compConfig of every component
        ▲
settings panel  ──►  writes one layer at a time: tabs Config / Component, each with a tab line Global / Client
                     (global: through the edit api of the development server, which rewrites config.yaml in place)
```

This is separate from the rest of `config.yaml`, such as `source`, `sidePanel`, `tag`, and `compRegistry`. Those describe what the page contains. The config system describes how features behave.

## Core concepts

- **Key definition**: declares that a key exists: its value type, its default, its scope, a description for the settings panel, and whether the reader may change it. Definitions live in code; values live in YAML. This mirrors the component registry, where code decides what exists and config decides what is used.
- **Scope**: `page` keys have one value for the whole page and are read from the config layers only. `doc` keys can additionally be set for single documents.
- **Level**: one place where a value can be declared. The levels are default, the layers below the document levels (global), source, side panel, document, and the layers above them (client). Some features add an inline level of their own, such as a link title marker.
- **Layer**: a page-wide level that is also written from the page. A layer is defined by its id, its storage, and whether it sits below or above the document levels; the layers form a stack, and nothing in the config module knows the two current ones by name ([Config layers](#config-layers)).
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

`globalConfig` in `config.yaml` sets the page-level value of keys: it is the global layer. Like every entry of `config.yaml`, it can be overridden locally in `config.0.yaml`. A key that is not written keeps its default.

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
2. layers below   the config layers below the document levels, in stack order: global (config.yaml globalConfig.K)
3. source         source rules that collected D, in rule order
4. side panel     side-panel nodes that bind D, or a folder node above an item of D, in tree order
5. document       frontmatter config.K of D
6. layers above   the config layers above the document levels, in stack order: client (this browser)
-> a later level replaces the value of an earlier one, key by key
```

A level only replaces the keys it writes. If a document sets `TagsDisplayAtLinkPosition` in its frontmatter, the other keys keep the values from the earlier levels.

A page-level key written at levels 3 to 5 is ignored with a warning. So is an unknown key or a value of the wrong type. When this happens, the earlier value stays in effect. The layers (levels 2 and 6) take both scopes; a layer above the document levels is where a value is meant to win for the whole page, whatever the documents declare.

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
  levels 1-5 of D  <  part.index.config of P  <  layers above (for the declared keys)  <  inline level
```

The level does not change the config of D itself: the same index rendered inside D, and every other component of D, keep levels 1-5. Page-level keys, unknown keys, and invalid values are ignored with a warning, as at the other levels. `DocConfigStore.configPartIndexOverrideGet(partId)` returns the validated keys; the index host passes them as `config.configDocOverride`.

### Inline level

Some features also accept a value on one single use, which wins over every level. Document links take a title marker, for example `[Setup](setup.md "tags:before")`. The marker forms are described in [Tag system](doc_page_impl_tag.md#tags-beside-links).

## Config layers

A layer is a page-wide set of values that the page can also write. The layers are a stack, defined in one list (`configLayerDefineList` in `lib/doc-config-define.js`); the order of the list is the order of the stack, and each definition says where the layer is stored and whether it sits below or above the document levels:

```js
{ id: 'global', label: 'Global', storage: 'file',    isAboveDocLevels: false, description: '...' }
{ id: 'client', label: 'Client', storage: 'browser', isAboveDocLevels: true,  description: '...' }
```

- The **global** layer is `globalConfig` and `compConfig` of `config.yaml`. It sits below the document levels: a document may refine its values. A change from the page goes through the edit api of the development server, which rewrites the one value in place ([In-place editing: config values](doc_page_impl_edit.md#api)): the rest of the file, its order and its comments stay, and the previous file is kept beside it as `config.yaml.bak`. The new configuration comes back as data, like a change made in an editor, and until it does the layer shows the value it just wrote. A built page has no edit api, so the global layer is shown but cannot be changed.
- The **client** layer is this browser's storage (`localStorage`, one entry per layer and per page entry: `doc-config:{layerId}:{entry file}`). It sits above the document levels: a value there wins over what the documents declare, for every document and for part index overrides that declared the key. It survives a reload and is cleared at once with Reset.

Nothing but the list knows which layers exist. The config model takes the layers as a list and applies the ones below the document levels before the source rules and the ones above after the frontmatter (`configModelBuild({ layerList })`), the store builds one layer object per definition (`configLayerCreate`, `store/doc-config-layer.ts`), and the settings panel shows one tab per layer. Another layer, say a user layer kept on a server, is one more definition and one more storage class behind the same `ConfigLayer` surface: its values (`config`, `compConfig`), whether it can be written now and why not (`isWritable`, `disabledReason`), whether it can be cleared at once (`isClearable`), the state of its last write (`request`), and the writes themselves (`valueSet`, `compValueSet`, `clear`, each answering `{ code, message }`). A yaml layer keys its component values by tag name, a layer the page writes itself by component id (`isCompKeyedById`); the model treats both alike.

### Settings panel

The settings button (a gear, left of the sidebar collapse trigger in the sidebar header) opens the settings panel, a popup centered in the browser window, with a fixed height and four tabs. A tab taller than the panel scrolls inside that tab; the title and the tab bars stay put. The panel closes only with the close button at its top right. Dragging the header, aside from its buttons, moves the panel. The tab labels are grey, the active one black, like the text of the config items.

The **Config** tab lists every key definition with `isUserSettable` not `false`: its key, its description, and a control for its type (switch for `boolean`, dropdown for `enum`, number or text field otherwise, a path field with completion for `sourcePath`; `any` keys are listed hidden). Under the tab line sits a second one with one tab per config layer, Global and Client, and the layer shown is shared by the Config and Component tabs (`DocConfigStore.settingsLayerId`). The tab of a layer shows the page values as they are with the layers up to that one applied: on Global the values of `config.yaml`, on Client those with the browser's values over them. Beside every key stands the level that decided the value shown (`default`, `global`, `client`), the layer's own values marked. A change on a layer's tab is written into that layer and nowhere else. The header of the panel says which layer is shown and how it is kept; a layer that cannot be written says why instead, and its items are disabled with the same reason; a write that failed is reported there until dismissed. **Reset** appears for a layer that can be cleared at once (Client) and drops every value of it, page and component keys. The **Component** tab is the same for the keys components declare ([Component-level config](#component-level-config)), one group per component that documents can name. The **Asset service** tab is not config of the page at all but the folders of the local store of the asset service layer: a change there is written to the store's own file by the development server ([the local store](doc_page_impl_asset.md#the-local-store-folders-fully-reflected)). Below the folders it lists the orphan objects, the objects no block references, and the broken references, and opens the asset panel of an object in place ([Usage](doc_page_impl_asset.md#usage)). It lives in the settings panel because it is where a reader looks for how the page is set up. The **Services** tab is not config either: the service templates of the service backend and its instances, in two areas of cards (the instances with the system ones, none yet), a template with its versions and the creation of an instance from it, an instance with the template it was created from, its apis and its config dashboard ([The Services tab](doc_page_impl_service_instance.md#the-services-tab)). The two tabs without layers say in the panel's header where what they show lives. The tab shown is `DocConfigStore.settingsTabId`, kept while the panel is closed.

```text
settings panel, tab of layer L ──► DocConfigStore.layerValueSet(L, key, value) ──► layer L: valueSet
                                                                                       │ file:    POST config/value ──► config.yaml rewritten in place, backup kept
                                                                                       │          ──► doc-source-change ──► sourceStore.configDoc
                                                                                       │ browser: localStorage, layer.config (observable)
                                   configModelBuild({ ..., layerList })  recomputes     ▼
                                   configGlobal / configByDocPath / configPartIndexByPartId   (every layer)
                                   configByLayerId[L]                                         (the layers up to L: what L's tab shows)
```

A key can be listed but not changeable at the moment: the panel marks the item disabled and says why in its tooltip. `EditBlockEnterMode` is disabled with "editing is available on the development server only" when the page has no edit api, so a built page lists the key but cannot change it; a key whose feature is absent for a similar reason follows the same form. The panel itself is a `ConfigPanel` of `@wwf971/react-comp-misc`, which the application injects through `config.components.ConfigPanel` of `DocPageMdx` (as it injects `SegmentedControl` for the local index); without it the settings button renders nothing. `isHidden`, `isDisabled`, and `disabledReason` on a panel item are the panel's own item properties; the layer tab line is a nested level of `subtab` items, its active tab given through `operationStateByPath`.

Store api of the layers:

```text
layerList, layerGet(layerId)                       the layer objects, in stack order
layerValueGet(layerId, key)                        page value with the layers up to this one applied (the tab's value)
layerIsDeclaring(layerId, key)                     the layer holds a value of its own for the key
layerCompValueGet / layerCompIsDeclaring(layerId, compId, key)   the same for component keys
layerIsDeclaringAny(layerId)                       whether Reset has anything to do
layerValueSet(layerId, key, value) / layerCompValueSet(layerId, compId, key, value) / layerClear(layerId)
configDefineListUserSettable                       the definitions the panel lists
compIdListWithConfig, compConfigDefineListGet(compId)            the Component tab
isSettingsOpen, settingsOpenSet(isOpen)
settingsTabId, settingsTabIdSet(tabId)             'config' | 'compConfig' | 'assetStore' | 'service'
settingsLayerId, settingsLayerIdSet(layerId)       the layer the Config and Component tabs show
```

## Config service

`DocConfigStore` owns the config model as a mobx computed value. It is derived from the manifest, the side-panel tree, and the config layers, so during development it follows source changes without separate refresh logic. Renderers query it through the config service, a stable object available as `useDocStores().configStore.configService`:

```text
configGlobalGet()               { key: value } of every key, page level
valueGlobalGet(key)             one page-level value
configDocGet(docPath)           { key: value } of every key, resolved for one document
valueDocGet(docPath, key)       one resolved value
levelDocGet(docPath, key)       level that decided it: default | a layer id (global, client) | source | sidePanel | doc
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

A `sourcePath` key holds a string that names a folder or a file of the doc page source by its source path (`~rootId/…`, [source paths](doc_page_impl_source.md#source-paths)). The definition says what it names with `pathSpec` ([path completion](doc_page_impl_source.md#path-completion): `{ kind: 'dir' | 'file' | 'any', extList?, rootIdList?, dirPath? }`), and the settings panel edits it with completion from the doc page source service layer (`SourcePathInput`: an `EditValueInline`, a dropdown of `sourceStore.pathComplete(typed, pathSpec)` below it, arrow keys and Enter; a click outside commits, and the path ends at the right of the value column), instead of a plain text field. A revert button appears before the path when there is something to go back to. While the path is being edited and its text differs from the value it had when the editing started, the button resets the text to that value; nothing is written and the field stays in edit mode. Once an edit has been written, the panel remembers the value the item had before its first edit of the page session (`DocConfigStore.settingsValueOriginalByItemId`, by item, so per layer), and the button writes that value back, an ordinary write of the layer; an edit back to the remembered value, by the button or by hand, forgets it and the button disappears. The value is validated as a string; whether the path exists is the concern of whoever reads it, since a folder for files the page creates may not exist yet.

## Component-level config

A component may need settings of its own: where `Image` writes a pasted image, whether it asks before replacing one. They are config of the page in every way (declared at the same levels, overridden per document, written in every layer), yet they are not keys of the page: they belong to one component, their names make sense only beside it, and an application with thirty components would otherwise fill the key list with keys nobody can place. So a component declares its own keys, and they are kept under their own mapping everywhere a page key is written.

### What a component exposes to the config system

A registered component tells the page about itself through the `expose` option of its definition ([What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)), an object of named facts. The names the page knows are standard and checked at registration; any other name is kept as written for a host or a later feature. Each standard name is read by one part of the page:

| name | read by | what it declares |
| --- | --- | --- |
| `meta` | the config system, the edit layer | facts about the component as one object: `label` and `description`, `isReadOnly` (no edit mode at all), `isEditSourceAccepted` (whether the built-in source edit mode is offered), `isInsertCommon` (listed directly in the insert menu), and **`configDefineList`, the shape of its component-level config** |
| `icon` | the insert menu, the mode menu | a component drawing the icon at any size |
| `viewModeList` | the mode menu, `RegisteredComp` | the ways its data is displayed, handed to it as `config.viewMode` |
| `editModeList` | the mode menu, the edit layer | the ways its data is edited in place, beside the built-in `source` mode |
| `sourceDefaultCreate` | the insert menu | the factory of the source of a new block, given the document it goes to |

Only `meta.configDefineList` concerns this document: the config system reads it to know which keys a component has (`compConfigDefineByCompIdBuild`, `lib/doc-config-define.js`) and nothing else of the exposure; the modes and the icon are the subject of [MDX components](doc_page_impl_mdx_comp.md#what-a-component-exposes) and [In-place editing](doc_page_impl_edit.md#component-edit-mode). The shape of config is what a component exposes, never its values: the values come from the levels and layers below and reach the component resolved.

### Declaring component keys

A component declares its keys in `expose.meta.configDefineList`, the same form as a page key without `scope` (every component key is document-level). `Image` and `ImageGrid` share one list (`imageConfigDefineList`), so a key set for pasting applies to both:

```js
compDefine(Image, {
  expose: {
    meta: {
      label: 'Image',
      configDefineList: [
        { key: 'FileStoreDir', type: 'sourcePath', pathSpec: { kind: 'dir' }, valueDefault: null,
          description: 'The folder of the source a pasted image is written to.' },
        { key: 'PasteReplaceConfirmIsOn', type: 'boolean', valueDefault: true,
          description: 'Ask before a pasted image replaces the current one.' },
      ],
    },
  },
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

The resolution is the one of [document config](#resolution-steps), run per component: default, `config.yaml` `compConfig`, the `compConfig` mapping of the source rules, of the side-panel nodes, of the frontmatter, and the layers above (the client layer keeps its component values by component id). The page keys and the component keys never mix: a `compConfig` mapping inside a `config` is not a page key, and a component key written beside the page keys is unknown and warned about. A name that is not in `compRegistry`, or a key the component does not declare, is warned about and ignored like an unknown page key.

A component receives its resolved values as `config.compConfig` (the `config` prop of every registered component, [component registry](doc_page_impl.md#component-registry)), resolved for the document it is rendered in, so a component reads `config.compConfig.FileStoreDir` and knows nothing of the levels. The settings panel lists the component keys on a tab of their own, **Component**, grouped by component name (only components that declare keys and that a tag name maps to appear; a page without such components says so), and a change there is written into the layer shown, as for a page key; in `config.yaml` the key is written under the tag name the file already uses for the component, else the first name that maps to it. The config service answers `compConfigGet(compId, docPath)` and `compConfigDefineListGet(compId)`; the store keeps `layerCompValueGet`, `layerCompValueSet`, and `compIdListWithConfig` for the panel.

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
frontend/src/lib/doc-config-define.js      key definitions, layer definitions (configLayerDefineList), value
                                           validation (shared with the plugin), the component key index
                                           (compConfigDefineByCompIdBuild), variableExpand
frontend/plugin/doc-config-source.ts       source and frontmatter levels, called from the source scan
frontend/src/lib/doc-config-side-panel.js  side-panel level, called from page-tree.js
frontend/src/lib/doc-config-model.js       resolution into the config model, the layers as a list
frontend/src/store/doc-config-layer.ts     the layer objects: ConfigLayerFile (config.yaml through the edit api),
                                           ConfigLayerBrowser (localStorage), one ConfigLayer surface
frontend/src/store/DocConfigStore.ts       config model owner, the layer stack and its writes, settings panel
                                           state, config service
frontend/plugin/doc-edit-server.ts         POST config/value: one value of config.yaml rewritten in place, backup
frontend/plugin/doc-yaml-edit.ts           the in-place yaml edit shared with the side-panel text edit
comp-doc/registry/comp-registry.js         compDefine expose: what a component declares about itself
comp-doc/registry/comp-expose.js           the standard names of the exposure, meta.configDefineList among them
comp-mdx/image/image-paste.js              imageConfigDefineList, the keys shared by Image and ImageGrid
comp-doc/registry/RegisteredComp.jsx       config.compConfig of every rendered component
comp-doc/settings/                         DocSettingsButton (sidebar header), DocSettingsPanel (centered popup of fixed
                                           height; the close button dismisses it; tabs Config / Component / Asset service / Services,
                                           a layer tab line in the first two), AssetStoreSettings (the Asset service tab: folders, orphans),
                                           ServiceSettings (the Services tab: templates, instances),
                                           SourcePathSettingsItem in DocSettingsPanel (a sourcePath key, edited with completion)
comp-doc/source/SourcePathInput.jsx        the editable path with its completion dropdown (doc page source service layer)
```
