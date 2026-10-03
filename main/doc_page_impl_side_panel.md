<!-- Design of the side panel. Parent document: doc_page_impl.md. This is the side-panel design document; other documents link here. -->

# Side Panel: Design

The side panel is a free tree declared in YAML. It does not need to mirror the file tree: an item can be a document, a source folder, a virtual folder, a component panel, or a separator. The tree is also the semantic backbone of the page: it decides document order, routes, parts, part of the tags, and part of the document config. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

```text
side-panel resource file (+ resources included through childrenFile)
   │  vite plugin: inline included trees, merge included "root" mappings,
   │               append "source" sections to the source rules
   ▼
configDoc.sidePanel.tree
   │  page-tree.js buildPageTreeModel()   (DocStore.treeModel, a mobx computed)
   ├── fumadocs page tree       -> sidebar, breadcrumb, previous/next cards
   ├── navigation index         -> item routes, items bound to each document, parts
   ├── tag declarations         -> side-panel step of the tag system (DocTagStore)
   └── config declarations      -> side-panel level of the document config (DocConfigStore)
   ▼
every item label = SidePanelItemHost
   -> registry component "SidePanelItem" (or the item's display.component)
```

## A side panel is a resource

Source rules decide which files exist. A side panel is a way of picking things from that collected source and arranging them as a tree: documents, source folders, component panels, virtual folders. It is therefore treated as a resource, not as one unique page setting:

- A side-panel resource is one `{ root?, tree }` mapping. Its content does not depend on who uses it.
- The page side panel is the resource named by `sidePanel.file` in `config.yaml`. A node includes another resource through `childrenFile`; the included resource's `tree` becomes the node's children and its `root` configures the node. A part's side panel is thus already an independent resource that a larger side panel includes.
- A resource can declare the source rules of the files it organizes, in the same file ([Resource files](#resource-files)), so a part folder can carry everything about itself.

Currently a file holds at most one resource, and the page uses one tree, the page side panel with every inclusion inlined by the loader. The model is kept so that later steps need no change of authored files:

- several resources in one file, addressed by an id within that file (the section name `sidePanelById` is reserved for it);
- one resource used in more than one place, for example a part's own side panel shown as a local panel while the page side panel also includes it.

Runtime code receives only the inlined tree (`configDoc.sidePanel.tree`), so these steps stay in the loader (`loadSidePanelFile` in `plugin/doc-source.ts`).

## Resource files

A side-panel resource file is a YAML file in one of two forms:

```yaml
# sectioned form: the resource is the "sidePanel" section
source:                    # optional: source rules, a list or { rules: [...] }
  rules:
    - action: addFolder
      rootId: guide
      path: .              # relative to this file
    - action: removeByName
      pattern: "*.yaml"
sidePanel:
  root:                    # optional, see "Including other resources"
    doc: /guide/overview.md
  tree:
    - doc: /guide/setup.md
```

```yaml
# legacy form: the resource is the file itself
root:
  doc: /guide/overview.md
tree:
  - doc: /guide/setup.md
```

The legacy form remains supported and can also carry a `source` section. A file must not combine a `sidePanel` section with a top-level `tree` or `root`, and the resource must contain a `tree` list. A file referenced by config `source.file` can be the same sectioned file; the loader then reads its `source` section as the main source rules and its `sidePanel` section as the page side panel.

Source sections of resource files are executed together with the main source rules:

```text
source rules of the page =
  config.yaml "source" (a list, { file }, or absent)
  + "source" sections of the side-panel resource files, in load order:
    the page side-panel file, then each included file depth-first in tree order
each file's "source" section is read once, also when the file is config "source.file"
or is included several times
```

Rule paths are relative to the file that contains them. Every rule form is available, including tag and config steps. Because rules run in this order, a removal rule in the main source rules does not affect files that a resource file adds later; a resource file writes the removals it needs, typically excluding its own YAML files. An item excluded through `excludeSidePanelItemIds` does not remove the source rules of the resource it included.

With every rule in resource files, `config.yaml` needs only:

```yaml
sidePanel:
  file: ../docs/doc.yaml
```

## Tree format

The `tree` list of the page side-panel resource describes the side panel. If the tree is absent, one is generated from the complete file manifest.

```yaml
tree:
  - separator: Examples                # separator line
  - doc: /guide/start.md               # document item; text defaults to the page title
  - doc: reference.md                  # file-name lookup
    text: Reference (renamed)          # custom display text
  - id: section-example                # folder bound to a document
    text: Example section
    doc: /guide/overview.md
    tags: [chapter]                    # tags, see doc_page_impl_tag.md
    config:                            # document config of this and every document below,
      TagsDisplayAtLinkIsOn: true      #   see doc_page_impl_config.md
    display:                           # custom label component
      component: NavLabel
      data: { badge: primary }
    children:
      - sourceFolder: /guide/topics    # mirrors one source folder subtree
        text: Topics
  - id: status-panel                   # leaf whose main panel is a component
    text: Status
    panel:
      component: StatusPanel
      data: { mode: compact }
```

Node forms:

- `doc`: a document item. With `children` it becomes a folder bound to that document.
- `text` + `children`: a virtual folder unrelated to the disk layout.
- `sourceFolder`: the generated tree below any internal source folder. `sourceRoot` is a shorthand for a complete root. Without `text` or `display`, the generated children are placed directly in the parent.
- `panel.component` + `panel.data`: a leaf whose main panel is rendered by a registered component. It receives the unified `{ data, config, onEvent }` props, with the item and runtime metadata in `config`.
- `separator`: a visual separator.

Every node can set a stable `id`, a custom `text`, a custom `display` component, `tags`, and `config`. `text` is a string or a language mapping such as `{ jp: 技術資料, en: Technical documents }`; see [Localized labels](#localized-labels). Tags attach to what the node binds. `config` applies to the documents of the node and of every item below it; see [Config system](doc_page_impl_config.md#declaring-document-config). Every leaf gets its own route, so several leaves can bind the same document; links and search results navigate to the first one in tree order. Use `sourceFolder: /` as the final node to expose every collected file as a fallback while earlier semantic bindings remain the primary navigation targets.

## Selecting documents

A `doc` value is an exact internal path, a path suffix, or a file name. When a suffix or name matches several files, the first match in source order is used and the document page shows a warning listing every match. A `doc` that matches nothing stays in the tree as a missing-document item, which shows a clear error instead of disappearing.

## Including other resources

A folder node includes another side-panel resource through `childrenFile`. The path is relative to the file containing the node, and the file is a [resource file](#resource-files) of either form. The plugin expands inclusions recursively before page-tree conversion, so runtime code always receives the same inlined `children` shape. Included children are placed before any local `children`.

```yaml
# side-panel.yaml
tree:
  - id: codeapp-development
    text: CodeApp development
    childrenFile: ./side-panel-codeapp.yaml
```

```yaml
# side-panel-codeapp.yaml
root:                    # optional: properties of the importing node itself
  doc: /codeapp-dev/doc/codeapp-doc.md
  defaultOpen: false
tree:
  - text: Dataverse
    doc: /codeapp-dev/doc/codeapp-dataverse.md
```

The optional `root` mapping is merged onto the including node, so a part can keep its root document, part index, tags, and (through a `source` section) its source rules in its own folder while the central file only names the node. Explicit properties on the including node win. Because the merge happens in the loader, an included `part` registers against the including node's `id` exactly as inline configuration does. `root` never becomes a visible child, and `root.children` / `root.childrenFile` are configuration errors. Inclusion cycles, missing files, a non-string `childrenFile`, and resources without a `tree` list are configuration errors that name the file. Every included file is watched by the development server; when an inclusion is added while the server runs, editing the containing YAML refreshes the watch set.

## Semantic parts

A node becomes a part root when it has a `part` mapping. An explicit node `id` is required because the part identity and its index document reference must remain stable when tree order changes. Membership is inherited by every descendant, including descendants included through `childrenFile`; a nested part root replaces the inherited part for its own subtree.

```yaml
tree:
  - id: guide-part
    text: Guide
    doc: /guide/overview.md
    part:
      index:
        docId: guide-part                # side-panel item id of the index document
        componentId: guide-main-index    # component id authored in that document
        config:                          # optional, for the hosted index only
          TagsDisplayAtLinkIsOn: true
          TagsDisplayAtLinkPosition: before
    children:
      - doc: /guide/setup.md
```

`part.index` binds a hosted index without copying its data: the index stays authored in its document. `part.index.config` holds document-level config keys (see [Config system](doc_page_impl_config.md#part-index-level)) that apply to the index only while it is hosted in the local-index area, on top of the config of the index document; the same index rendered inside its document is unaffected. How the index is queried, rendered, and switched is described in [Semantic parts and hosted indexes](doc_page_impl.md#semantic-parts-and-hosted-indexes).

## Item rendering

Every item label, including folders, separators, and generated items, is rendered through one central path. The default path shows the item text followed by its tags. An application changes how all items look by registering one component, without touching tree parsing, routes, or tags.

### Choosing the renderer

```text
sidePanelItemNameCreate(node)                        lib/side-panel-item.js
  -> node.display.component                          explicit per-item component
  -> else sidePanel.itemDisplay.component            document, panel, inline items only
  -> else registry name "SidePanelItem"
       compRegistry.SidePanelItem if configured
       else built-in common/SidePanelItem            comp-doc/side-panel/SidePanelItem.jsx
  -> build item data from the declared node
  -> page-tree "name" = <SidePanelItemHost compName data assetKey itemId/>

SidePanelItemHost (render time, observer)
  -> label translation for DocStore.languageDisplay
  -> tags of the bound asset from DocTagStore
  -> page-level config from DocConfigStore
  -> surface from SidePanelItemSurfaceContext
  -> RegisteredComp, placement "sidePanelDisplay"
```

The registry name `SidePanelItem` is the hook. It is a built-in name: `RegisteredComp` and the page tree resolve it to `common/SidePanelItem` when `compRegistry` does not mention it. Mapping it in `compRegistry` replaces the renderer of every item:

```yaml
compRegistry:
  SidePanelItem: project/SidePanelItemProject
```

Tags are resolved at render time rather than when the tree is built, because a later item in the tree can still change the tags of a document bound earlier.

### Renderer interface

The renderer receives the unified `{ data, config, onEvent }` props:

```text
data.text              display text (node text, page title, or folder name), always
                       a string in the selected language
data.textLanguage      language of data.text, '' for a plain-string label
data.textMessage       '' or the diagnostic of an invalid authored text
data.kind              separator | folder | folder-file | file | panel | inline
data.fileExt, fileName, filePath, isMissing, isTextCustom, sourcePath
                       present when the item is bound to a file or folder
data.itemDeclared      the YAML node as authored, without children; its text
                       can be a language mapping and is not meant for display
data.tagListDeclared   tags written on this node, normalized to [{ id, data }]
data.tagList           resolved tags of the bound asset, ready to display, not yet
                       filtered by config: [{ id, compName, data }]
...display.data        sidePanel.itemDisplay.data, then node.display.data

config.itemId          stable item id
config.assetKey        asset the item is bound to, e.g. doc:/guide/a.md
config.surface         sidebar | breadcrumb | footer
config.configGlobal    page-level config { key: value }, see doc_page_impl_config.md
config.configService   config queries, including document-level values
config.isTagOverviewAvailable   true when a clicked tag can open the tag overview
config.tagService      tag queries, see doc_page_impl_tag.md#tag-service
config.instanceId, placement, compId, sourcePath

onEvent('tagOverviewOpenRequest', { tagId })   ask to open the tag overview popup
```

`data.tagList` is every resolved tag of the asset; `data.tagListDeclared` is only what this one node wrote. They differ when tags come from source rules or from other items bound to the same document. Which tags are actually shown is a decision of the renderer, guided by `config.configGlobal`.

A custom renderer usually wraps the default one. The demonstration page adds a file-suffix label to non-Markdown documents this way:

```jsx
function SidePanelItemProject({ data, config, onEvent }) {
  const tagList = [...data.tagList];
  if (data.fileExt === 'py') tagList.push({ id: 'file-ext', compName: 'TagLabel', data: { text: '.py' } });
  return <SidePanelItem data={{ ...data, tagList }} config={config} onEvent={onEvent} />;
}
```

Labels added this way are rendering decisions only, and the default renderer still filters them through `TagsDisplayAtSidePanelItemsList`. To give an asset a real tag that other components can query, declare it in source rules or side-panel YAML.

The default renderer always renders its host element, `span.doc-side-panel-item` with `data-surface`, also for items without tags. On the `sidebar` surface the host wraps long text, including breaks inside a word, rather than clipping it with `nowrap` or an ellipsis, so the full item name stays readable. A custom renderer should wrap `SidePanelItem` as above to keep this host and its wrapping; a renderer that returns its own markup takes over that responsibility.

### Localized labels

A label is chosen in two steps, so changing the document language updates every mounted label without rebuilding the tree:

```text
page-tree.js (tree build)
  -> validate node "text": string, or mapping of language -> text
  -> invalid: warn, naming the item; show the default text instead
  -> item and outline models keep
       textLocalized   the label as authored (string or mapping)
       text            first authored translation, a safe plain string

render time, for DocStore.languageDisplay
  -> preferred translation, else the first authored one
  -> SidePanelItemHost: data.text + data.textLanguage
  -> other surfaces through DocStore: Back/Forward/Up titles, search page rows,
     "@first/..." link targets; the tag overview selects the same way
```

The default renderer wraps the text in an element with `lang`. An invalid label, such as an array, an empty mapping, or a mapping without usable text, is shown with its fallback text, a wavy red underline, and the diagnostic as its hover title. Language selection rules are shared with indexes, see [Multilingual side-panel labels](doc_page_impl_multi-lang.md#multilingual-side-panel-labels).

A custom renderer receives display-ready `data.text`, so wrapping `SidePanelItem` needs no language logic. It should not render `data.itemDeclared.text`, which can be a mapping.

### Surfaces

Fumadocs reuses the page-tree `name` in breadcrumbs and in the previous/next cards. Those surfaces wrap their content in `SidePanelItemSurfaceContext` with `breadcrumb` or `footer`; everything else is `sidebar`. The default renderer shows tags only on `sidebar`, keeping the other surfaces plain text. A custom renderer can make its own choice from `config.surface`.

### Tag display

The default renderer decides which tags to show from the page-level config:

```text
surface is not sidebar                          -> no tags
TagsDisplayAtSidePanelItemIsOn false            -> no tags
TagsDisplayAtSidePanelItemsList set             -> only tags with these ids, in resolved order
otherwise                                       -> every tag of data.tagList
```

It passes the result to `TagList`, which renders every tag through `RegisteredComp` with the component named by its tag definition (placement `tag`). The built-in `TagLabel` component is a compact label with a 2px radius and optional `colorBorder`, `colorBackground`, and `colorText`.

When `config.isTagOverviewAvailable` is true, the tags are clickable. A click emits `tagOverviewOpenRequest`, which `SidePanelItemHost` accepts by opening the tag overview popup. The click does not activate the item itself. How tags are defined, attached, and listed in the overview is described in [Tag system](doc_page_impl_tag.md).

## Folder interaction and routes

Document items and folders bound to documents receive stable item routes, while the tree remains the source of document order. Route selection, `@first/{itemId}`, previous/next order, and Back/Forward/Up are described in [Navigation design](doc_page_impl_nav.md#side-panel-routes-and-folder-navigation).

The default folder gesture (an inactive label navigates, the active label toggles, the chevron only toggles) lives in `DocSidebarFolder`. Consumers replace it through runtime `config.sidePanel.components.Folder` without replacing route resolution or history. See [Indexed-folder interaction](doc_page_impl_nav.md#indexed-folder-interaction).

## Implementation files

```text
frontend/plugin/doc-source.ts            load side-panel resource files, expand childrenFile,
                                         append "source" sections, watch included files
frontend/src/lib/page-tree.js            tree conversion, routes, parts, tag and config declarations
frontend/src/lib/side-panel-item.js      renderer choice and item data
frontend/src/lib/text-localized.js       localized label parsing and selection, shared with indexes
comp-doc/side-panel/SidePanelItemHost.jsx  runtime context, surfaces
comp-doc/side-panel/SidePanelItem.jsx      default renderer (common/SidePanelItem)
comp-doc/side-panel/DocSidebarFolder.jsx   default folder gesture
comp-mdx/tag/TagLabel.jsx, TagList.jsx     tag display
```
