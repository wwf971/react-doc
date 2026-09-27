<!-- Design of the tag system. Parent document: doc_page_impl.md -->

# Tag System: Design

A tag is a short label such as "Guide" or "Chapter" attached to a document, a source folder, or a side-panel item. Tags are declared in several places, so the tags of one document cannot be read from one YAML node. The tag system collects every declaration in a fixed order, resolves them into one tag model, and answers queries through one tag service. The resolved tags are displayed on side-panel items, next to the path bar, beside links, and in a tag overview popup. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

## Core concepts

- **Asset**: anything a tag can be attached to, identified by an asset key.
  - `doc:/rootId/a.md`: a collected source file.
  - `folder:/rootId/sub`: a source folder.
  - `item:{itemId}`: a side-panel item bound to neither, such as a virtual folder, a component panel, or a missing document.
- **Tag**: `{ id, data }`. The id is the identity; `data` carries per-attachment values, such as a different display text.
- **Declaration**: "these tags belong to this asset", written in source rules or side-panel YAML.
- **Tag definition**: how a tag id looks: its text and its display component with data. Definitions are optional; an undefined tag is displayed with its id as text in the default look.
- **Tag model**: the resolved result: tags of each asset, assets of each tag, and all known tags.

Definitions and declarations are separate on purpose: one place decides how "Chapter" looks, while any number of places decide what is a chapter.

## Resolution steps

```text
1. default        every asset has no tags
2. source step    source rules, in rule order                 (vite plugin, build time)
     add rule "tags"        -> every file this rule collects
     addTagByPath / Name    -> files collected so far that match
     remove rules           -> the removed file loses its tags with itself
     same file added again  -> declarations accumulate in rule order
   -> manifest entry.tagList
3. side-panel step  side-panel items, in tree order          (browser, page-tree conversion)
     document item, folder with doc -> doc asset of the bound document
     sourceFolder / sourceRoot      -> folder asset
     any other item                 -> item asset
4. tag model      fold all declarations in order with the merge rule
```

Merge rule, applied at every step: a later declaration of the same tag id replaces the earlier tag in place; a different tag id is appended. A document bound by several side-panel items therefore receives the tags of every item, and a later item can change an earlier tag's data. Tree order is the order in which items appear in the side panel, with `childrenFile` imports already inlined.

Example, with the declarations in order:

```text
source.yaml        addFile doc_page_req.md, tags [reference]
side-panel.yaml    doc_page_req.md, tags [guide]                 -> reference, guide
source.yaml        addTagByPath /example/link-nav/**, tags [test]
side-panel.yaml    sub/notes.md, tags [{ id: test, data: { text: Test (sub) } }]
                                                                  -> test (text "Test (sub)")
```

## Declaring tags

All declarations use the same value forms:

```yaml
tags: chapter
tags: [chapter, guide]
tags:
  - chapter
  - id: version
    data: { text: v2 }
```

Source rules (`source.yaml`):

```yaml
rules:
  - action: addFolder
    rootId: guide
    path: ./guide
    tags: [guide]             # every file collected by this rule
  - action: addTagByPath      # files collected so far, glob on the internal path
    pattern: "/guide/**/*.py"
    tags: [code]
  - action: addTagByName      # files collected so far, glob on the file name
    pattern: "*.sh"
    tags: [code]
```

A tag step only affects files that are already collected, the same way remove rules only remove files that are already collected.

Side-panel items (`side-panel.yaml`):

```yaml
tree:
  - id: part-design
    text: Design
    doc: /guide/design.md
    tags: [chapter]           # belongs to /guide/design.md, not to the item
    children:
      - sourceFolder: /guide/scripts
        text: Scripts
        tags: [code]          # belongs to folder /guide/scripts
```

## Tag definitions

Definitions live under `tag` in `config.yaml`, or in a separate file referenced by `tag.file`. Entries written directly in `config.yaml` win over the file.

```yaml
# config.yaml
tag:
  file: ./tag.yaml
```

```yaml
# tag.yaml
defineById:
  chapter:
    text: 章
    display:
      component: Tag          # default; any registered component works
      data: { colorBorder: '#d97706', colorBackground: '#fef3c7', colorText: '#92400e' }
```

The display component is resolved through the unified component registry. `Tag` is a built-in name for `common/Tag`; an application can map `Tag` in `compRegistry` to its own component, or name a different component per definition. When a tag is displayed, its data is the definition's `display.data`, then the attached tag's `data`, with `text` falling back to the definition text.

## Where tags are displayed

Resolved tags appear in four places. Each place has its own config keys, which share one prefix per place (see [Config system](doc_page_impl_config.md#naming-keys)):

```text
side-panel item   TagsDisplayAtSidePanelItemIsOn, TagsDisplayAtSidePanelItemsList   page level
main panel        TagsDisplayAtMainPanelIsOn                                        document level
document link     TagsDisplayAtLinkIsOn, TagsDisplayAtLinkPosition, title marker    document level
tag overview      TagsOverviewPopupIsOn                                             page level
```

Every place renders tags through `TagList`, so the tag definition decides the look everywhere.

### Side-panel items

The default side-panel item renderer shows the tags of the bound asset after the item text. `TagsDisplayAtSidePanelItemsList` limits which tag ids appear there. For example, a page can show only `chapter` in the side panel while every tag still appears next to the path bar. The renderer receives the unfiltered tags and the page-level config, so a custom renderer can choose differently. See [Side panel design](doc_page_side_panel.md#tag-display).

### Main panel

The tags of the current page appear next to the path bar (breadcrumb) above the page title. The page's asset is the one its side-panel item is bound to, so component panels show their item's tags. `TagsDisplayAtMainPanelIsOn` is resolved for the current document, so a single document, folder, or source pattern can turn it off.

### Tags beside links

A document link can show the tags of its target, before or after the link text. The tags sit outside the clickable link. Whether they are shown is decided by the document that contains the link: `TagsDisplayAtLinkIsOn` and `TagsDisplayAtLinkPosition` are resolved for that document. One link can decide for itself through an exact link-title marker, which wins over every config level:

```markdown
[Setup](setup.md "tags:before")   show, before the text
[Setup](setup.md "tags:after")    show, after the text
[Setup](setup.md "tags:on")       show, at the configured position
[Setup](setup.md "tags:off")      do not show
```

Wiki links and file-like inline code have no title, so they follow the config. A broken link or a link with several candidate targets shows no tags. A registered component can pass the same value through `DocLinkInline` `data.tagsDisplay`.

### Tag overview

The tag overview lists every asset that carries one tag. When `TagsOverviewPopupIsOn` is on, clicking a tag on a side-panel item or next to the path bar opens the overview in a popup. Clicking a tag never activates the item or link it sits in.

The overview is arranged like the side panel. Tagged items keep their folders above them, so the reader sees where each asset lives. Tagged assets that no side-panel item binds, such as documents collected by source rules but not listed in the side panel, are shown last.

```text
Tag: Guide · 4 assets
In the side panel
  Frontend                    folder kept for its position, not tagged
    Store design              tagged document, opens the page
  Requirement
Not in the side panel
  Draft notes   /guide/draft.md
```

The popup is built from two parts that can each be replaced:

- **Frame**: the host's text panel component, `DocPageMdx` `config.compConfigHost.panelComponent`, opened with `config.isPopup`. Without a panel component, tags are not clickable.
- **Content**: the registry component named `TagOverview`, placement `tagOverview`. `TagOverview` is a built-in name for `common/TagOverview`; mapping it in `compRegistry` replaces the content. The content receives `data.tagId`, `data.overview` (built by `tagService.overviewGet()`), and `data.itemCurrentId`. It requests navigation with `onEvent('navigateRequest', { target })`, and the popup closes after navigating.

The open popup is UI state in `DocTagStore` (`overviewTagId`, `overviewOpen()`, `overviewClose()`). The popup also closes on Escape, on its close button, and on a click outside it. The same component can be placed in a document: `<!--renderComp=TagOverview,tagId=guide-->`.

## Tag model and service

`DocTagStore` owns the tag model as a mobx computed value derived from the manifest, the side-panel tree, and the definitions. It follows source changes during development without separate refresh logic.

```text
DocTagStore
  tagModel (computed)
    tagListByAssetKey     assetKey -> [{ id, data, origin }]
    assetKeyListByTagId   tagId -> [assetKey]
    tagDefineById         tagId -> { id, text, compName, data, isDefined }
    tagIdList             defined tags in config order, then undefined tags in first-use order
```

`origin` records the declaring step, for example `{ step: 'source', ruleIndex }` or `{ step: 'sidePanel', itemId }`.

### Tag service

Renderers never read side-panel nodes to find tags. They use the tag service, a stable object passed to side-panel item renderers as `config.tagService` and also available as `useDocStores().tagStore.tagService`:

```text
tagListGet(assetKey)          resolved tags of one asset
tagListGetByDoc(docPath)      the same, for a document's internal path
tagDisplayListGet(assetKey)   tags ready to render: [{ id, compName, data }]
assetListGet(tagId)           [{ assetKey, assetType, assetId }] bound to one tag
overviewGet(tagId)            tag overview: side-panel arrangement, then assets outside it
tagDefineGet(tagId)           definition, or the default one for an undefined tag
tagIdListGet()                every known tag id
assetKeyGet(type, id)         builds an asset key
```

Calls from observer components are tracked by mobx, so a renderer updates when declarations change.

Every resolution step is an ordered list of declarations folded by the same merge rule. Another tag source, such as a remote tag service, is therefore added as one more step after the side-panel step, without changing how renderers query tags.

## Implementation files

All tag logic uses the `doc-tag` prefix:

```text
frontend/src/lib/doc-tag-declare.js     value forms, asset keys, merge rule (shared with the plugin)
frontend/plugin/doc-tag-source.ts       source step, called from scanSource()
frontend/src/lib/doc-tag-side-panel.js  side-panel step, called from page-tree.js
frontend/src/lib/doc-tag-model.js       resolution into the tag model, display data
frontend/src/lib/doc-tag-overview.js    tag overview built from the tree and the tag model
frontend/src/store/DocTagStore.ts       tag model owner, tag service, overview popup state
comp-mdx/tag/Tag.jsx, TagList.jsx       tag display components
comp-mdx/tag/TagOverview.jsx            default overview content (common/TagOverview)
frontend/src/comp-doc/TagOverviewPopup.jsx  overview popup frame and open state binding
frontend/src/comp-doc/DocPageTagBar.jsx     tags next to the path bar
```

The source and side-panel steps are called from the existing source scan and tree conversion, because those processes are where files are collected and where side-panel nodes are bound to assets.
