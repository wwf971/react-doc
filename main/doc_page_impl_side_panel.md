<!-- Design of the side panel. Parent document: doc_page_impl.md. This is the side-panel design document; other documents link here. -->

# Side Panel: Design

The side panel is a free tree declared in YAML. It does not need to mirror the file tree: an item can be a document, a source folder, a virtual folder, a component panel, or a separator. The tree is also the semantic backbone of the page: it decides document order, routes, parts, part of the tags, and part of the document config. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

```text
side-panel resource file (+ resources included through childrenFile)
   │  vite plugin: inline included trees, merge included "root" mappings,
   │               append "source" sections to the source rules,
   │               annotate every node with where its label is written (textSource)
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
config.isTextEditable  edit mode, sidebar surface: the label may be edited in place
config.textEditStatus  '' | editing | submitting | error, for this item
config.textEditMessage why the last save of the label failed
config.instanceId, placement, compId, sourcePath

onEvent('tagOverviewOpenRequest', { tagId })   ask to open the tag overview popup
onEvent('sidePanelTextEditStartRequest')       start editing the label (see "Editing a label in place")
onEvent('sidePanelTextSubmitRequest', { text })  the edited label
onEvent('sidePanelTextCancelRequest')          drop the edit
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

When `config.isTagOverviewAvailable` is true, the tags are clickable. A click emits `tagOverviewOpenRequest`, which `SidePanelItemHost` accepts by opening the tag overview popup. The click does not activate the item itself. The host sets the flag only when the page asks for it: `TagsOverviewPopupIsOn` and `TagsOverviewPopupAtSidePanelItemIsOn` (page scope, default off) are both on; by default a click on a side-panel item navigates, whatever part of the label it lands on. How tags are defined, attached, and listed in the overview is described in [Tag system](doc_page_impl_tag.md).

## Editing a label in place

In edit mode ([In-place Editing](doc_page_impl_edit.md)) the label of an item can be changed from the side panel, and the change is written into the yaml file the label comes from. It is available on the development server only, like every edit, on the `sidebar` surface, and for items that exist as a node in a side-panel file: items generated from a source folder have no label to write. The default renderer implements it; a custom renderer that wraps `SidePanelItem` gets it, one that renders its own markup does not (it may implement it from the same `config` and events).

```text
plugin (load time)         every node: textSource = { file, path }
                             file  the side-panel file, relative to the config directory
                             path  yaml address of the node: ["tree", 2],
                                   ["sidePanel", "tree", 0, "children", 1], ["root"]
page-tree.js               itemOutlineById[itemId]: textSource, isTextAuthored
SidePanelItemHost          config.isTextEditable, textEditStatus, textEditMessage;
                           data.text = the label just saved while the new tree is pending
SidePanelItem              hover: [✎] after the label  ->  sidePanelTextEditStartRequest
                           the text span made contenteditable, Enter / blur
                           -> sidePanelTextSubmitRequest { text }, Escape -> ...CancelRequest
event layer                edit route -> DocEditStore.eventHandle (source.itemId)
DocEditStore               sidePanelText { itemId, status, message }, sidePanelTextPending
                           POST {editEndpoint}/side-panel/text
                             { file, nodePath, language, text, textBase }
plugin/doc-side-panel-text.ts   parsed yaml -> one line operation on the file
plugin                     write; report the new configuration as "doc-source-change"
                           (data, no reload); the watcher recognizes its own write
```

**Where a label is written.** The loader annotates every node of every loaded resource with `textSource`, the file and the yaml address of the node, while it inlines the trees; the annotation travels with the node into `configDoc.sidePanel.tree` and into `data.itemDeclared`. A node whose label comes from the `root` of a file it includes through `childrenFile` points at that root, because that is where the text is. The server resolves `file` against the config directory and accepts only files the current configuration loads (the page side-panel file and every included file); the yaml address is applied to the parsed document, never to the file system.

**How the file is changed.** The file is never rebuilt from its parsed object: that would drop every comment and could reorder or requote what the author wrote. `doc-side-panel-text.ts` parses the file with `yaml` (which keeps the character range of every node), finds the label the way `page-tree.js` reads it (`text` when the node has one; the `separator` value of a separator node; for a language mapping the translation that was displayed, named by `language`), and builds one line operation of the [edit api](doc_page_impl_edit.md#edit-api-and-line-operations): `replaceLines` over the lines holding the value, rebuilt as the text before the value on its first line, the new scalar, and the text after it on its last line (a trailing comment stays); or, for a node without a `text` (a document labeled by its title), `insertLines` of one `text:` line after the node's first key at the node's indentation, so the title becomes an authored label. The new scalar is plain when yaml would write it plain and quoted otherwise (`yaml.stringify` decides, with folding off), and a value authored over several lines becomes one line. Every other line of the file is untouched, byte for byte. The request carries `textBase`, the authored label the edit started from; when the file no longer holds it, the edit is refused (code -2) rather than overwriting someone else's change. A node written as a flow mapping cannot receive a new key and is refused with an explanation.

**No reload.** A side-panel file is configuration, and a change of configuration normally regenerates the manifest and reloads the page. A label written by the page is different: the plugin re-reads the configuration itself, invalidates the manifest module, and sends the new `configDoc` and `fileManifest` as the `doc-source-change` data event ([Saving without a reload](doc_page_impl_edit.md#saving-without-a-reload)); `DocStore.treeModel` recomputes from the new tree and the side panel re-renders in place. The watcher then reports the same file change; the plugin remembers the content hash it wrote and skips the reload while the file still has that content, so an edit made in an editor afterwards still reloads the page as before.

**In the browser.** `DocEditStore.sidePanelText` is the one label being edited (`editing`, `submitting`, `error` with its message). Starting it is an edit action like any other: the open block session is left (saved) first. `SidePanelItemHost` hands the renderer `config.isTextEditable` (edit mode, sidebar surface, the item has a `textSource`) and the status; the default renderer shows a small edit button after the label while the row is hovered, and on click reports `sidePanelTextEditStartRequest`. The events are routed like component reports ([event layer](doc_page_impl_event.md)): the host application sees them first, then the edit route brings them to `DocEditStore.eventHandle`, which identifies the item by `event.source.itemId` and finds its `textSource`, its displayed translation and the authored text in `DocStore.treeModel.itemOutlineById`. An empty or unchanged text only ends the edit. After a successful write the item shows the saved text as `data.text` (`sidePanelTextPending`) until the new configuration has rebuilt the tree, so the label never flashes back to its old value. The rebuilt tree does not reach the sidebar itself: fumadocs keeps the page tree it received first as long as the root `$id` stays the same, and changing the id would remount the sidebar list and close the folders the reader opened. `SidePanelItemHost` therefore reads the label (`textLocalized`, `textMessage`) from the current `itemOutlineById` by its `itemId`, and the props of its element are only the fallback.

**No jitter.** Nothing moves when edit mode is toggled or when a label is edited. The edit button hangs off a zero-width inline anchor placed after the label and the tags, absolutely positioned, transparent until the row or the button itself is hovered: it takes no room, and the label host fills the row of the sidebar link (`flex: 1 1 auto`) so that hovering anywhere on the row shows it. It is styled like a button of the block toolbar (no frame, muted icon, accent background on hover; the icon size is set by class, because the sidebar link sizes every svg inside it) and it always takes the pointer, even while transparent, so a click on it never falls through to the link and navigates. The label is edited in its own span, made `contenteditable` (plain text), with an outline drawn outside its box: same element, same typography, same size. Enter and leaving the focus submit, Escape drops the edit; the button and the editable span stop their pointer events, so the sidebar link does not navigate and the folder does not toggle while a label is edited. While the write is pending the span is locked and dimmed; a failure shows the message as the label's hover title with a red outline, and the edit button is back so the edit can be retried.

## Folder interaction and routes

Document items and folders bound to documents receive stable item routes, while the tree remains the source of document order. Route selection, `@first/{itemId}`, previous/next order, and Back/Forward/Up are described in [Navigation design](doc_page_impl_nav.md#side-panel-routes-and-folder-navigation).

The default folder gesture (an inactive label navigates, the active label toggles, the chevron only toggles) lives in `DocSidebarFolder`. Consumers replace it through runtime `config.sidePanel.components.Folder` without replacing route resolution or history. See [Indexed-folder interaction](doc_page_impl_nav.md#indexed-folder-interaction).

## Implementation files

```text
frontend/plugin/doc-source.ts            load side-panel resource files, expand childrenFile,
                                         append "source" sections, annotate textSource, watch
                                         included files, report a label write as data
frontend/plugin/doc-side-panel-text.ts   a label change as one line operation of its yaml file
frontend/plugin/doc-edit-server.ts       POST {editEndpoint}/side-panel/text
frontend/src/lib/page-tree.js            tree conversion, routes, parts, tag and config declarations
frontend/src/lib/side-panel-item.js      renderer choice and item data
frontend/src/lib/text-localized.js       localized label parsing and selection, shared with indexes
frontend/src/store/DocEditStore.ts       sidePanelText: the label being edited, the write
comp-doc/side-panel/SidePanelItemHost.jsx  runtime context, surfaces, edit state of the label
comp-doc/side-panel/SidePanelItem.jsx      default renderer (common/SidePanelItem), label editing
comp-doc/side-panel/DocSidebarFolder.jsx   default folder gesture
comp-mdx/tag/TagLabel.jsx, TagList.jsx     tag display
```
