<!-- Design of the side panel. Parent document: doc_page_impl.md. This is the side-panel design document; other documents link here. -->

# Side Panel: Design

The side panel is a free tree declared in YAML. It does not need to mirror the file tree: an item can be a document, a source folder, a virtual folder, a component panel, or a separator. The tree is also the semantic backbone of the page: it decides document order, routes, parts, part of the tags, and part of the document config. For the overall architecture, refer to [Document Page: Design](doc_page_impl.md).

```text
entry file of the document (+ the yaml files its side panels include)
   │  vite plugin (doc-entry.ts): load every file once, inline included trees,
   │               merge included "root" mappings, append "source" sections to
   │               the source rules, merge "tag" definitions, annotate every
   │               node with where its label is written (textSource)
   ▼
configDoc.sidePanel.tree   (the side panel the page shows)
   │  page-tree.js buildPageTreeModel()   (DocStore.treeModel, a mobx computed)
   ├── fumadocs page tree       -> sidebar, breadcrumb, previous/next cards
   ├── navigation index         -> item routes, items bound to each document, parts
   ├── tag declarations         -> side-panel step of the tag system (DocTagStore)
   └── config declarations      -> side-panel level of the document config (DocConfigStore)
   ▼
every item label = SidePanelItemHost
   -> registry component "SidePanelItem" (or the item's display.component)
```

## The document entry

A document is described by one YAML file, its **entry**, named by `docEntry.file` in `config.yaml`. The entry declares everything that makes the document a whole: the source rules that collect its files, the definitions of its tags, and its side panels. A document is therefore self-contained: another document includes it by naming its entry, and a deployment shows it alone by naming the same entry in its `config.yaml`. The entry file carries the marker `docEntry`, and its name ends with `-entry.yaml` by convention (`example-entry.yaml`, `sub-doc-entry.yaml`); the loader warns about an entry named otherwise.

Source rules decide which files exist. A side panel is a way of picking things from that collected source and arranging them as a tree: documents, source folders, component panels, virtual folders. It is a resource, not a unique page setting: a document declares as many side panels as it needs, each addressed by an id, and a node of any side panel includes another one, of the same file or of another document. The included side panel's `tree` becomes the node's children and its `root` configures the node. A part's side panel, or a whole sub document, is thus an independent resource that a larger side panel includes.

### Document yaml files

The entry and every YAML file it reaches share one grammar, the document yaml file. A file without `docEntry` is a resource file: it holds declarations for others (a side panel of a part, a long tree kept out of the entry) and cannot be the entry of a page.

```yaml
docEntry:                      # marks the file as the entry of a document: true, or a mapping
  title: Guide                 #   siteTitle, when config.yaml sets none
  homeDoc: ~guide/overview.md  #   homeDoc / homeItem, when config.yaml sets none
source:                        # optional: a rule list, { rules: [...] }, or { file: ./source.yaml }
  - action: addFolder
    rootId: guide
    path: .                    # relative to the file holding the rules
    collect: recursive         # recursive | direct | referenced (doc_page_impl_source.md)
tag:                           # optional: { defineById: {...} } or { file: ./tag.yaml }
  file: ./tag.yaml
sidePanelDefault: main         # optional when the file declares exactly one side panel
sidePanelById:
  main:                        # a side panel: { root?, tree }
    root:                      #   optional, see "Including other side panels"
      doc: ~guide/overview.md
    tree:
      - doc: ~guide/setup.md
      - id: reference
        include: ./reference/reference-entry.yaml   # a side panel of another document
  compact:                     # a side panel declared in another file, by reference
    file: ./panels.yaml
    sidePanel: compact
```

Any other top-level key is an error naming the file, as are the former forms (a top-level `tree` or `root`, a `sidePanel` section, `childrenFile` on a node), so that a file of the old format fails with the hint it needs.

A **side-panel reference** names one side panel. A string is a file path, relative to the file holding the reference, and means the default side panel of that file. A mapping `{ file?, sidePanel? }` names the file (the file holding the reference when absent) and the side panel id (the file's default when absent). The default side panel of a file is `sidePanelDefault`, or the only side panel it declares; a reference that needs the default of a file declaring several without `sidePanelDefault` is an error. References appear as the `include` property of a tree node, as an alias value of `sidePanelById`, and, without `file`, as `docEntry.sidePanel` in `config.yaml`.

### Loading

Loading a file loads everything in it, once, and the entry is loaded first:

```text
file loaded (doc-entry.ts fileLoad)
  -> "source": rules rebased from the file holding them to the config directory,
               appended to the rules of the page
  -> "tag":    definitions merged; a tag already defined by a file loaded earlier
               keeps that definition, so the entry decides over what it includes
  -> every side panel of sidePanelById: tree expanded, "include" references resolved
     by loading the referenced file (its source and tag come along) and taking
     the referenced side panel; a side panel is loaded once and shared

source rules of the page =
  "source" of the entry
  + "source" of each file reached, in order of appearance: sidePanelById in key
    order, tree depth-first
```

Rule paths are relative to the file that contains them. Every rule form is available, including tag and config steps. Because rules run in this order, a removal rule of the entry does not affect files that an included document adds later. The yaml files of the document (the entry, every file it reaches, its source and tag files) and `config.yaml` itself are configuration and are never collected as documents, whatever the rules say; no rule needs to exclude them. An item excluded through `excludeSidePanelItemIds` does not remove the source rules of the file it included.

A cycle of inclusions is detected per side panel, not per file: two side panels of one file may include each other's siblings, but a side panel that reaches itself is an error naming the chain. Every file read is watched by the development server; when an inclusion is added while the server runs, editing the containing YAML refreshes the watch set.

### What the page receives

`config.yaml` names the entry and, optionally, which of its side panels the page shows:

```yaml
docEntry:
  file: ../docs/guide-entry.yaml
  sidePanel: compact            # optional: a side panel of the entry other than its default
```

The loader fills `configDoc` with what runtime code reads today: `source` (every rule), `sidePanel.tree` (the selected side panel, every inclusion inlined, every node annotated with `textSource`), `tag.defineById` (the entry's definitions, then the `tag` of `config.yaml` over them), and `siteTitle` / `homeDoc` / `homeItem` from the entry when `config.yaml` sets none. `configDoc.docEntry` carries the resolved side panel id and `sidePanelIdList`. Runtime code receives only this inlined shape, so a change of the file grammar stays in the loader (`plugin/doc-entry.ts`). The same side panel used in two places (a sub document included by the page side panel and by a compact one) is one loaded resource.

## Tree format

The `tree` list of a side panel describes it. If the entry declares no side panel, one is generated from the complete file manifest.

```yaml
tree:
  - separator: Examples                # separator line
  - doc: ~guide/start.md               # document item; text defaults to the page title
  - doc: reference.md                  # file-name lookup
    text: Reference (renamed)          # custom display text
  - id: section-example                # folder bound to a document
    text: Example section
    doc: ~guide/overview.md
    tags: [chapter]                    # tags, see doc_page_impl_tag.md
    config:                            # document config of this and every document below,
      TagsDisplayAtLinkIsOn: true      #   see doc_page_impl_config.md
    display:                           # custom label component
      component: NavLabel
      data: { badge: primary }
    children:
      - sourceFolder: ~guide/topics    # mirrors one source folder subtree
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
- `sourceFolder`: the generated tree below any source folder (`~rootId/dir`); files of a `referenced` folder are not pages and are left out. `sourceRoot: rootId` is a shorthand for a complete root. Without `text` or `display`, the generated children are placed directly in the parent.
- `panel.component` + `panel.data`: a leaf whose main panel is rendered by a registered component. It receives the unified `{ data, config, onEvent }` props, with the item and runtime metadata in `config`.
- `separator`: a visual separator.

Every node can set a stable `id`, a custom `text`, a custom `display` component, `tags`, and `config`. `text` is a string or a language mapping such as `{ jp: 技術資料, en: Technical documents }`; see [Localized labels](#localized-labels). Tags attach to what the node binds. `config` applies to the documents of the node and of every item below it; see [Config system](doc_page_impl_config.md#declaring-document-config). Every leaf gets its own route, so several leaves can bind the same document; links and search results navigate to the first one in tree order. Use `sourceRoot` nodes at the end to expose every collected file of a root as a fallback while earlier semantic bindings remain the primary navigation targets.

## Selecting documents

A `doc` value is an exact source path (`~rootId/...`), a path suffix, or a file name. When a suffix or name matches several files, the first match in source order is used and the document page shows a warning listing every match. A `doc` that matches nothing stays in the tree as a missing-document item, which shows a clear error instead of disappearing.

## Including other side panels

A folder node includes another side panel through `include`, a [side-panel reference](#document-yaml-files): the default side panel of a file, a named side panel of a file, or a side panel of the same file. The plugin expands inclusions recursively before page-tree conversion, so runtime code always receives the same inlined `children` shape. Included children are placed before any local `children`.

```yaml
# guide-entry.yaml, side panel "main"
tree:
  - id: codeapp-development
    include: ./codeapp/codeapp-entry.yaml          # a self-contained sub document
  - id: appendix
    text: Appendix
    include: { file: ./panels.yaml, sidePanel: appendix }
  - id: shortcuts
    text: Shortcuts
    include: { sidePanel: shortcuts }              # declared in this file
```

```yaml
# codeapp/codeapp-entry.yaml
docEntry: true
source:
  - { action: addFolder, rootId: codeapp-dev, path: ., collect: recursive }
sidePanelById:
  main:
    root:                    # properties of the including node itself
      text: CodeApp development
      doc: ~codeapp-dev/doc/codeapp-doc.md
      defaultOpen: false
    tree:
      - text: Dataverse
        doc: ~codeapp-dev/doc/codeapp-dataverse.md
```

The optional `root` mapping is merged onto the including node, so a document keeps its label, root document, part index, tags, source rules, and tag definitions in its own folder while the including file only names the node. Explicit properties on the including node win. Because the merge happens in the loader, an included `part` registers against the including node's `id` exactly as inline configuration does. `root` never becomes a visible child, and `root.children` / `root.include` are configuration errors. Inclusion cycles, missing files, an invalid reference, a side panel id the file does not declare, and side panels without a `tree` list are configuration errors that name the file.

## Semantic parts

A node becomes a part root when it has a `part` mapping. An explicit node `id` is required because the part identity and its index document reference must remain stable when tree order changes. Membership is inherited by every descendant, including descendants included through `include`; a nested part root replaces the inherited part for its own subtree.

```yaml
tree:
  - id: guide-part
    text: Guide
    doc: ~guide/overview.md
    part:
      index:
        docId: guide-part                # side-panel item id of the index document
        componentId: guide-main-index    # component id authored in that document
        config:                          # optional, for the hosted index only
          TagsDisplayAtLinkIsOn: true
          TagsDisplayAtLinkPosition: before
    children:
      - doc: ~guide/setup.md
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
data.text              the label (node text, page title, or folder name), always a
                       plain string in the selected language; the text the label is
                       edited as
data.textDisplay       not given by the host: what a custom renderer wrapping
                       SidePanelItem shows in place of data.text (icons, file names),
                       never edited
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
config.surface         sidebar | breadcrumb | footer | tocPopover
config.configGlobal    page-level config { key: value }, see doc_page_impl_config.md
config.configService   config queries, including document-level values
config.isTagOverviewAvailable   true when a clicked tag can open the tag overview
config.tagService      tag queries, see doc_page_impl_tag.md#tag-service
config.isTextEditable  edit mode, sidebar surface: the label may be edited in place
config.textEditStatus  '' | editing | submitting | error, for this rendering of the label
config.textEditMessage why the last save of the label failed
config.instanceId      this rendering of the label, distinct for every rendering of the
                       same item; the source of its events
config.placement, compId, sourcePath

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

A renderer that decorates the name itself (an icon before it, the file name after it) passes the decoration as `data.textDisplay` and leaves `data.text` the plain name: the default renderer shows `data.textDisplay` outside editing and edits `data.text`, so a rename starts from the name, never from the decoration, and never from the text of the rendered element. The demonstration wrapper puts a file icon before the name of a non-Markdown document this way. A label whose `data.text` is not a string (an element, from a renderer written before `data.textDisplay`) is still displayed, without the edit button.

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

Fumadocs reuses the page-tree `name` in breadcrumbs, in the previous/next cards, and in the trigger of the toc popover of a narrow page (the current page's name). Those surfaces wrap their content in `SidePanelItemSurfaceContext` with `breadcrumb`, `footer` or `tocPopover` (`DocPageView`: `DocPageBreadcrumb`, `DocPageFooter`, `DocPageTocPopover`); everything else is `sidebar`. A new place that shows a page-tree name outside the side panel provides its own surface, or it counts as the side panel and offers editing. The default renderer shows tags only on `sidebar`, keeping the other surfaces plain text. A custom renderer can make its own choice from `config.surface`.

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
                             file  the document yaml file, relative to the config directory
                             path  yaml address of the node: ["sidePanelById", "main", "tree", 2],
                                   ["sidePanelById", "main", "tree", 0, "children", 1],
                                   ["sidePanelById", "main", "root"]
page-tree.js               itemOutlineById[itemId]: textSource, isTextAuthored
SidePanelItemHost          config.instanceId: this rendering of the label (owner);
                           config.isTextEditable, textEditStatus, textEditMessage;
                           data.text = the label just saved while the new tree is pending
SidePanelItem              hover: [✎] after the label  ->  sidePanelTextEditStartRequest
                           the text span made contenteditable, Enter / blur
                           -> sidePanelTextSubmitRequest { text }, Escape -> ...CancelRequest
event layer                edit route -> DocEditStore.eventHandle (source.itemId,
                           source.instanceId = the owner)
DocEditStore               sidePanelText { itemId, ownerId, status, message },
                           sidePanelTextPending
                           POST {editEndpoint}/side-panel/text
                             { file, nodePath, language, text, textBase }
plugin/doc-side-panel-text.ts   parsed yaml -> one line operation on the file
plugin                     write; report the new configuration as "doc-source-change"
                           (data, no reload); the watcher recognizes its own write
```

**Where a label is written.** The loader annotates every node of every loaded side panel with `textSource`, the file and the yaml address of the node, while it inlines the trees; the annotation travels with the node into `configDoc.sidePanel.tree` and into `data.itemDeclared`. A node whose label comes from the `root` of a side panel it includes points at that root, because that is where the text is. The server resolves `file` against the config directory and accepts only files the current configuration loads (the entry and every yaml file it reaches); the yaml address is applied to the parsed document, never to the file system.

**How the file is changed.** The file is never rebuilt from its parsed object: that would drop every comment and could reorder or requote what the author wrote. `doc-side-panel-text.ts` parses the file with `yaml` (which keeps the character range of every node), finds the label the way `page-tree.js` reads it (`text` when the node has one; the `separator` value of a separator node; for a language mapping the translation that was displayed, named by `language`), and builds one line operation of the [edit api](doc_page_impl_edit.md#edit-api-and-line-operations) with the yaml edit helpers of `doc-yaml-edit.ts`, shared with the config value write: `replaceLines` over the lines holding the value, rebuilt as the text before the value on its first line, the new scalar, and the text after it on its last line (a trailing comment stays) (`nodeReplaceBuild`); or, for a node without a `text` (a document labeled by its title), `insertLines` of one `text:` line after the node's first key at the node's indentation, so the title becomes an authored label (`linesInsertBuild`). The new scalar is plain when yaml would write it plain and quoted otherwise (`yamlScalarTextBuild`: `yaml.stringify` decides, with folding off), and a value authored over several lines becomes one line. Every other line of the file is untouched, byte for byte, and the file as it was is kept beside it as `{file}.bak` before the write. The request carries `textBase`, the authored label the edit started from; when the file no longer holds it, the edit is refused (code -2) rather than overwriting someone else's change. A node written as a flow mapping cannot receive a new key and is refused with an explanation.

**No reload.** A side-panel file is configuration, and a change of configuration normally regenerates the manifest and reloads the page. A label written by the page is different: the plugin re-reads the configuration itself, invalidates the manifest module, and sends the new `configDoc` and `fileManifest` as the `doc-source-change` data event ([Saving without a reload](doc_page_impl_edit.md#saving-without-a-reload)); `DocStore.treeModel` recomputes from the new tree and the side panel re-renders in place. The watcher then reports the same file change; the plugin remembers the content hash it wrote and skips the reload while the file still has that content, so an edit made in an editor afterwards still reloads the page as before.

**In the browser.** `DocEditStore.sidePanelText` is the one label being edited (`editing`, `submitting`, `error` with its message). Starting it is an edit action like any other: the open block session is left (saved) first. `SidePanelItemHost` hands the renderer `config.isTextEditable` (edit mode, sidebar surface, the item has a `textSource`) and the status of its own rendering (see **One editor** below); the default renderer shows a small edit button after the label while the row is hovered, and on click reports `sidePanelTextEditStartRequest`. The events are routed like component reports ([event layer](doc_page_impl_event.md)): the host application sees them first, then the edit route brings them to `DocEditStore.eventHandle`, which identifies the item by `event.source.itemId` and finds its `textSource`, its displayed translation and the authored text in `DocStore.treeModel.itemOutlineById`. An empty or unchanged text only ends the edit. After a successful write the item shows the saved text as `data.text` (`sidePanelTextPending`) until the new configuration has rebuilt the tree, so the label never flashes back to its old value. The rebuilt tree does not reach the sidebar itself: fumadocs keeps the page tree it received first as long as the root `$id` stays the same, and changing the id would remount the sidebar list and close the folders the reader opened. `SidePanelItemHost` therefore reads the label (`textLocalized`, `textMessage`) from the current `itemOutlineById` by its `itemId`, and the props of its element are only the fallback.

**One editor.** The same item is rendered in several places at once: the sidebar, the breadcrumb, a previous/next card, the toc popover, and, on a narrow window, the mobile side panel next to the desktop one. Each rendering is a `SidePanelItemHost` with an instance id of its own (`side-panel-display:{itemId}:{react id}`, the `source.instanceId` of its events); the item id is the same for all of them and does not tell them apart. An editor that every rendering of the item mounted would take the focus from the one clicked, and its blur would submit the unchanged label and end the edit. So the edit belongs to the rendering it was started from: `sidePanelText.ownerId` is that rendering's instance id, and `sidePanelTextStateGet(itemId, ownerId, isTextEditable)` gives the editing and submitting status to that rendering alone. A failed save is shown by every editable rendering of the item, any of which can retry it; the others display the label, a name just saved included. The rules that follow from it:

- A submit or a cancel is accepted only from the owner. The blur of another rendering, or of an editor already replaced, is refused and leaves the edit as it is.
- A rendering on a display-only surface does not start an edit even when its renderer reports the request: `SidePanelItemHost` refuses it as the local handler of the event.
- A new start (another item, or the same item from another rendering) drops the edit being typed, unsaved; a save in progress refuses it. Two starts that wait for the block session to be left: the later one opens.
- A rendering that unmounts (the mobile side panel closes, the layout changes, the tree is rebuilt) releases what it owns (`sidePanelTextOwnerRelease`): the edit it was showing is dropped unsaved, its waiting start does not open; a save in progress finishes, and a failed save stays for the other renderings.
- Leaving edit mode drops the edit being typed. Navigating does not end it by itself: the sidebar stays, and its editor with it.

**Inside a link or a folder button.** The label is inside the sidebar link of its item or the button of its folder, which the side panel does not own. The edit button and the editor stop their pointer events. The editor also keeps the keys from them: a button activates on the key-up of Space and Enter, so the editor stops the key-up and prevents its default (Space has typed its space on key-down, and the folder does not toggle); Enter saves on key-down without following the link, Escape drops the edit on key-down; both stop there. Keys during IME composition are left to the composition, and paste inserts plain text.

**No jitter.** Nothing moves when edit mode is toggled or when a label is edited. The edit button hangs off a zero-width inline anchor placed after the label and the tags, absolutely positioned, transparent until the row or the button itself is hovered: it takes no room, and the label host fills the row of the sidebar link (`flex: 1 1 auto`) so that hovering anywhere on the row shows it. It is styled like a button of the block toolbar (no frame, muted icon, accent background on hover; the icon size is set by class, because the sidebar link sizes every svg inside it) and it always takes the pointer, even while transparent, so a click on it never falls through to the link and navigates. The label is edited in its own span, made `contenteditable` (plain text), with an outline drawn outside its box: same element, same typography, same size. Enter and leaving the focus submit, Escape drops the edit; the button and the editable span stop their pointer events, so the sidebar link does not navigate and the folder does not toggle while a label is edited. While the write is pending the span is locked and dimmed; a failure shows the message as the label's hover title with a red outline, and the edit button is back so the edit can be retried.

## Folder interaction and routes

Document items and folders bound to documents receive stable item routes, while the tree remains the source of document order. Route selection, `@first/{itemId}`, previous/next order, and Back/Forward/Up are described in [Navigation design](doc_page_impl_nav.md#side-panel-routes-and-folder-navigation).

The default folder gesture (an inactive label navigates, the active label toggles, the chevron only toggles) lives in `DocSidebarFolder`. Consumers replace it through runtime `config.sidePanel.components.Folder` without replacing route resolution or history. See [Indexed-folder interaction](doc_page_impl_nav.md#indexed-folder-interaction).

## Implementation files

```text
frontend/plugin/doc-entry.ts             load the entry and every document yaml file it reaches:
                                         side panels and their includes, "source" and "tag"
                                         sections, textSource annotation
frontend/plugin/doc-source.ts            config.yaml docEntry -> configDoc, watch the loaded
                                         files, report a label write as data
frontend/plugin/doc-side-panel-text.ts   a label change as one line operation of its yaml file
frontend/plugin/doc-yaml-edit.ts         the in-place yaml edit it is built on (node ranges -> line operations)
frontend/plugin/doc-edit-server.ts       POST {editEndpoint}/side-panel/text, the write with its backup
frontend/src/lib/page-tree.js            tree conversion, routes, parts, tag and config declarations
frontend/src/lib/side-panel-item.js      renderer choice and item data
frontend/src/lib/text-localized.js       localized label parsing and selection, shared with indexes
frontend/src/store/DocEditStore.ts       sidePanelText: the label being edited, the write
comp-doc/side-panel/SidePanelItemHost.jsx  runtime context, surfaces, edit state and owner of the label
comp-doc/side-panel/SidePanelItem.jsx      default renderer (common/SidePanelItem), label editing
comp-doc/side-panel/DocSidebarFolder.jsx   default folder gesture
comp-mdx/tag/TagLabel.jsx, TagList.jsx     tag display
```
