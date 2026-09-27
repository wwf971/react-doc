<!-- Design of the side panel. Parent document: doc_page_impl.md -->

# Side Panel: Design

The side panel is a free tree declared in YAML. It does not need to mirror the file tree: an item can be a document, a source folder, a virtual folder, a component panel, or a separator. The tree is also the semantic backbone of the page: it decides document order, routes, parts, part of the tags, and part of the document config. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

```text
side-panel.yaml (+ files imported through childrenFile)
   │  vite plugin: inline imported subtrees, merge imported "root" mappings
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

## Tree format

`sidePanel.file` in `config.yaml` points to a YAML file containing a `tree` list. If the tree is absent, one is generated from the complete file manifest.

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

Every node can set a stable `id`, a custom `text`, a custom `display` component, `tags`, and `config`. Tags attach to what the node binds. `config` applies to the documents of the node and of every item below it; see [Config system](doc_page_impl_config.md#declaring-document-config). Every leaf gets its own route, so several leaves can bind the same document; links and search results navigate to the first one in tree order. Use `sourceFolder: /` as the final node to expose every collected file as a fallback while earlier semantic bindings remain the primary navigation targets.

## Selecting documents

A `doc` value is an exact internal path, a path suffix, or a file name. When a suffix or name matches several files, the first match in source order is used and the document page shows a warning listing every match. A `doc` that matches nothing stays in the tree as a missing-document item, which shows a clear error instead of disappearing.

## Importing subtrees

A folder node can move its children to another YAML file through `childrenFile`. The path is relative to the file containing the node, and the imported file must contain a `tree` list. The plugin expands imports recursively before page-tree conversion, so runtime code always receives the same inlined `children` shape. Imported children are placed before any local `children`.

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

The optional `root` mapping is merged onto the importing node, so a part can keep its root document, part index, and tags in its own folder while the central file only names the node. Explicit properties on the importing node win. Because the merge happens in the loader, an imported `part` registers against the importing node's `id` exactly as inline configuration does. `root` never becomes a visible child, and `root.children` / `root.childrenFile` are configuration errors. Import cycles, missing files, a non-string `childrenFile`, and files without a `tree` list are configuration errors that name the file. Every imported file is watched by the development server; when an import is added while the server runs, editing the containing YAML refreshes the watch set.

## Semantic parts

A node with a `part` mapping and an explicit `id` becomes the root of a semantic part; all descendants belong to it unless a nested part root takes over. The part can bind a hosted index authored inside one of its documents. The index behavior is described in [Semantic parts and hosted indexes](doc_page_impl.md#semantic-parts-and-hosted-indexes).

## Item rendering

Every item label, including folders, separators, and generated items, is rendered through one central path. The default path shows the item text followed by its tags. An application changes how all items look by registering one component, without touching tree parsing, routes, or tags.

### Choosing the renderer

```text
sidePanelItemNameCreate(node)                        lib/side-panel-item.js
  -> node.display.component                          explicit per-item component
  -> else sidePanel.itemDisplay.component            document, panel, inline items only
  -> else registry name "SidePanelItem"
       compRegistry.SidePanelItem if configured
       else built-in common/SidePanelItem            comp-doc/SidePanelItem.jsx
  -> build item data from the declared node
  -> page-tree "name" = <SidePanelItemHost compName data assetKey itemId/>

SidePanelItemHost (render time, observer)
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
data.text              display text (node text, page title, or folder name)
data.kind              separator | folder | folder-file | file | panel | inline
data.fileExt, fileName, filePath, isMissing, isTextCustom, sourcePath
                       present when the item is bound to a file or folder
data.itemDeclared      the YAML node as authored, without children
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
  if (data.fileExt === 'py') tagList.push({ id: 'file-ext', compName: 'Tag', data: { text: '.py' } });
  return <SidePanelItem data={{ ...data, tagList }} config={config} onEvent={onEvent} />;
}
```

Labels added this way are rendering decisions only, and the default renderer still filters them through `TagsDisplayAtSidePanelItemsList`. To give an asset a real tag that other components can query, declare it in source rules or side-panel YAML.

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

It passes the result to `TagList`, which renders every tag through `RegisteredComp` with the component named by its tag definition (placement `tag`). The built-in `Tag` component is a compact label with a 2px radius and optional `colorBorder`, `colorBackground`, and `colorText`.

When `config.isTagOverviewAvailable` is true, the tags are clickable. A click emits `tagOverviewOpenRequest`, which `SidePanelItemHost` accepts by opening the tag overview popup. The click does not activate the item itself. How tags are defined, attached, and listed in the overview is described in [Tag system](doc_page_impl_tag.md).

## Folder interaction and routes

Document items and folders bound to documents receive stable item routes, while the tree remains the source of document order. Route selection, `@first/{itemId}`, previous/next order, and Back/Forward/Up are described in [Navigation design](doc_page_impl_nav.md#side-panel-routes-and-folder-navigation).

The default folder gesture (an inactive label navigates, the active label toggles, the chevron only toggles) lives in `DocSidebarFolder`. Consumers replace it through runtime `config.sidePanel.components.Folder` without replacing route resolution or history. See [Indexed-folder interaction](doc_page_impl_nav.md#indexed-folder-interaction).

## Implementation files

```text
frontend/plugin/doc-source.ts            load side-panel YAML, expand childrenFile, watch imports
frontend/src/lib/page-tree.js            tree conversion, routes, parts, tag and config declarations
frontend/src/lib/side-panel-item.js      renderer choice and item data
frontend/src/comp-doc/SidePanelItemHost.jsx  runtime context, surfaces
frontend/src/comp-doc/SidePanelItem.jsx  default renderer (common/SidePanelItem)
frontend/src/comp-doc/DocSidebarFolder.jsx   default folder gesture
comp-mdx/tag/Tag.jsx, TagList.jsx        tag display
```
