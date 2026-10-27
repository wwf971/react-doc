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

A document is described by one YAML file, its **entry**, named by a workspace file as a root-level doc page, by `config.yaml` as the one doc page of a virtual workspace (`docEntry.file`, or `docEntry.dir`, the doc page folder the entry is found in), or by an include ([the workspace](doc_page_impl_source.md#the-workspace)). The entry declares everything that makes the document a whole: the source rules that collect its files, the definitions of its tags, its config, and its side panels. A document is therefore self-contained: another document includes it by naming its entry (or its folder) under an alias, and a deployment shows it alone by naming the same in its workspace. The entry file carries the marker `docEntry`; by convention it is `.doc-page/entry.yaml` in the doc page folder, with the files it names beside it ([The doc page folder](doc_page_impl_dir.md)), or a file named `xxx-entry.yaml`; the loader warns about an entry named otherwise.

Source rules decide which files exist. A side panel is a way of picking things from that collected source and arranging them as a tree: documents, source folders, component panels, virtual folders. It is a resource, not a unique page setting: a document declares as many side panels as it needs, each addressed by an id, and a node of any side panel includes another one, of the same file or of another document. The included side panel's `tree` becomes the node's children and its `root` configures the node. A part's side panel, or a whole sub document, is thus an independent resource that a larger side panel includes.

### Document yaml files

The entry and every YAML file it reaches share one grammar, the document yaml file. A file without `docEntry` is a resource file: it holds declarations for others (a side panel of a part, a long tree kept out of the entry) and cannot be the entry of a page.

```yaml
docEntry:                      # marks the file as the entry of a document: true, or a mapping
  title: Guide                 #   siteTitle, when config.yaml sets none
  homeDoc: ~guide/overview.md  #   homeDoc / homeItem, when config.yaml and the workspace set none
source:                        # optional: a rule list, { rules: [...] }, or { file: ./source.yaml }
  - action: addFolder
    alias: guide               # the root, ~guide/... (doc_page_impl_source.md#source-paths)
    path: .                    # relative to the file holding the rules
    collect: recursive         # recursive | direct | referenced (doc_page_impl_source.md)
tag:                           # optional: { defineById: {...} } or { file: ./tag.yaml }
  file: ./tag.yaml
config:                        # optional: the doc page config layer, { Key: value }, { file }, or a list of both
  - file: ./config.yaml        #   (doc_page_impl_config.md#the-doc-page-layer)
asset:                         # optional, an entry only: { file: ./asset.yaml } or false; absent: asset.yaml
  file: ./asset.yaml           #   beside the entry (doc_page_impl_asset.md#which-folders-a-doc-page-declares)
sidePanelDefault: main         # optional when the file declares exactly one side panel
sidePanelById:
  main:                        # a side panel: { root?, tree }
    root:                      #   optional, see "Including other side panels"
      doc: ~guide/overview.md
    tree:
      - doc: ~guide/setup.md
      - id: reference
        include: { dir: ../reference, alias: ref } # another doc page, by its folder, aliased "ref" in the workspace
  compact:                     # a side panel declared in another file, by reference
    file: ./panels.yaml
    sidePanel: compact
```

Any other top-level key is an error naming the file, as are the former forms (a top-level `tree` or `root`, a `sidePanel` section, `childrenFile` on a node), so that a file of the old format fails with the hint it needs.

A **side-panel reference** names one side panel. A string is a file path, relative to the file holding the reference, and means the default side panel of that file; the path of a folder means the entry found in that doc page folder ([finding the entry](doc_page_impl_dir.md#finding-the-entry-from-a-folder)). A mapping `{ file? | dir?, sidePanel?, alias? }` names the file (`file`, or `dir` for a doc page folder; the file holding the reference when absent) and the side panel id (the file's default when absent); when the file is the entry of another doc page, `alias` is the name that doc page gets in the workspace (its folder name when absent, [doc pages reached by includes](doc_page_impl_source.md#doc-pages-reached-by-includes)), and `alias` on a reference to anything else is an error. The default side panel of a file is `sidePanelDefault`, or the only side panel it declares; a reference that needs the default of a file declaring several without `sidePanelDefault` is an error. References appear as the `include` property of a tree node and as an alias value of `sidePanelById`.

### Loading

Loading a file loads everything in it, once, and the entries of the root-level doc pages are loaded first, in workspace order:

```text
file loaded (doc-entry.ts fileLoad)
  -> an entry: the doc page registered under the alias of the reference that reached it
               (a root-level doc page keeps the alias of the workspace); mentioned again,
               it only records the mention
  -> "source": rules rebased from the file holding them to the config directory, each
               root under its alias (the folder name when absent; a second folder under
               one alias is an error), each rule marked with the doc page's alias,
               appended to the rules of the page
  -> "tag":    definitions merged; a tag already defined by a file loaded earlier
               keeps that definition, so the entry decides over what it includes
  -> "config": declarations recorded for the doc page config layer, a config file
               read where it is named; the declarations of an included document
               are stacked below those of the including one
  -> every side panel of sidePanelById: tree expanded, "include" references resolved
     by loading the referenced file (its source and tag come along) and taking
     the referenced side panel; a side panel is loaded once and shared; every node
     marked with the doc page it is written in (docPageAlias) and its source paths
     (doc, sourceFolder; sourceRoot becomes a sourceFolder) written in the full form
     of that doc page, the root of an included side panel likewise

source rules of the page =
  "source" of each root-level entry, in workspace order
  + "source" of each file reached, in order of appearance: sidePanelById in key
    order, tree depth-first
```

Rule paths are relative to the file that contains them. Every rule form is available, including tag and config steps. Because rules run in this order, a removal rule of the entry does not affect files that an included document adds later. The yaml files of the document (the entry, every file it reaches, its source, tag and config files), anything in a `.doc-page/` folder, and `config.yaml` itself are configuration and are never collected as documents, whatever the rules say; no rule needs to exclude them. An item excluded through `excludeSidePanelItemIds` does not remove the source rules of the file it included.

A cycle of inclusions is detected per side panel, not per file: two side panels of one file may include each other's siblings, but a side panel that reaches itself is an error naming the chain. Every file read is watched by the development server; when an inclusion is added while the server runs, editing the containing YAML refreshes the watch set.

### What the page receives

`config.yaml` names a workspace file, or one entry (or the doc page folder it is found in) with, optionally, its alias and which of its side panels the page shows ([the workspace](doc_page_impl_source.md#the-workspace)):

```yaml
docEntry:
  dir: ../docs/guide            # or  file: ../docs/guide/.doc-page/entry.yaml
  alias: guide                  # optional: its alias in the (virtual) workspace; the folder name when absent
  sidePanel: compact            # optional: a side panel of the entry other than its default
```

The loader fills `configDoc` with what runtime code reads today: `source` (every rule, each with its `alias` and `docPageAlias`), `sidePanel.tree` (the side panel shown: of one root doc page its own, of several one section per doc page, [a workspace of several doc pages](#a-workspace-of-several-doc-pages); every inclusion inlined, every node annotated with its doc page, `docPageAlias`, and with where it is written: `textSource`, `nodeSource` and, on a node with `include`, `includeSource` with the `docPageAlias` of an included doc page; see [Editing a label in place](#editing-a-label-in-place) and [Moving an item](#moving-an-item)), `tag.defineById` (the entries' definitions, then the `tag` of `config.yaml` over them), `workspace` (the doc pages and their mentions, [what the page receives](doc_page_impl_source.md#what-the-page-receives)), and `siteTitle` / `homeDoc` / `homeItem` from the workspace or the first entry when `config.yaml` sets none. `configDoc.docEntry` carries the first root doc page's entry file (`file`, also when a folder was named) and `alias`, the resolved side panel id, `sidePanelIdList`, `configDeclarationList` (the declarations of the doc page config layer, in stack order, see [Config system](doc_page_impl_config.md#the-doc-page-layer)), and `fileHashByFile`: the content hash of every document yaml file as it was loaded, by its path relative to the config directory, so a write from the page can be refused when a file changed since. Runtime code receives only this inlined shape, so a change of the file grammar stays in the loader (`plugin/doc-entry.ts`). The same side panel used in two places (a sub document included by the page side panel and by a compact one) is one loaded resource, and the doc page it belongs to is one doc page of the workspace.

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
- `sourceFolder`: the generated tree below any source folder (`~root/dir`, a root of the doc page the node is written in); files of a `referenced` folder are not pages and are left out. `sourceRoot: root` is a shorthand for a complete root. Without `text` or `display`, the generated children are placed directly in the parent.
- `panel.component` + `panel.data`: a leaf whose main panel is rendered by a registered component. It receives the unified `{ data, config, onEvent }` props, with the item and runtime metadata in `config`.
- `separator`: a visual separator.

Every node can set a stable `id`, a custom `text`, a custom `display` component, `tags`, and `config`. `text` is a string or a language mapping such as `{ jp: 技術資料, en: Technical documents }`; see [Localized labels](#localized-labels). Tags attach to what the node binds. `config` applies to the documents of the node and of every item below it; see [Config system](doc_page_impl_config.md#declaring-document-config). Every leaf gets its own route, so several leaves can bind the same document; links and search results navigate to the first one in tree order. Use `sourceRoot` nodes at the end to expose every collected file of a root as a fallback while earlier semantic bindings remain the primary navigation targets.

## Selecting documents

A `doc` value is a source path (`~root/...`, a root of the node's doc page; `~page:root/...` for any doc page of the workspace), a path suffix, or a file name; a suffix or a name is looked up in the node's doc page first ([target resolution](doc_page_impl_nav.md#link-recognition-and-target-resolution)). When a suffix or name matches several files, the first match in source order is used and the document page shows a warning listing every match. A `doc` that matches nothing stays in the tree as a missing-document item, which shows a clear error instead of disappearing.

## Including other side panels

A folder node includes another side panel through `include`, a [side-panel reference](#document-yaml-files): the default side panel of a file, a named side panel of a file, or a side panel of the same file. The plugin expands inclusions recursively before page-tree conversion, so runtime code always receives the same inlined `children` shape. Included children are placed before any local `children`.

```yaml
# guide-entry.yaml, side panel "main"
tree:
  - id: codeapp-development
    include: { file: ./codeapp/codeapp-entry.yaml, alias: codeapp }   # a self-contained sub document, aliased
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
  - { action: addFolder, alias: codeapp-dev, path: ., collect: recursive }
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
config.isMovable       edit mode, sidebar surface: the item can be moved (its row is
                       dragged through the host; the renderer offers the move picker)
config.instanceId      this rendering of the label, distinct for every rendering of the
                       same item; the source of its events
config.placement, compId, sourcePath

onEvent('tagOverviewOpenRequest', { tagId })   ask to open the tag overview popup
onEvent('sidePanelTextEditStartRequest')       start editing the label (see "Editing a label in place")
onEvent('sidePanelTextSubmitRequest', { text })  the edited label
onEvent('sidePanelTextCancelRequest')          drop the edit
onEvent('sidePanelItemMovePickerOpenRequest', {}, { point })
                                               open the move picker where the pointer is
                                               (see "Moving an item")
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

In edit mode ([MDX document in-place editing](doc_page_impl_edit.md)) the label of an item can be changed from the side panel, and the change is written into the yaml file the label comes from. It is available on the development server only, like every edit, on the `sidebar` surface, and for items that exist as a node in a side-panel file: items generated from a source folder have no label to write. The default renderer implements it; a custom renderer that wraps `SidePanelItem` gets it, one that renders its own markup does not (it may implement it from the same `config` and events).

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

**How the file is changed.** The file is never rebuilt from its parsed object: that would drop every comment and could reorder or requote what the author wrote. `doc-side-panel-text.ts` parses the file with `yaml` (which keeps the character range of every node), finds the label the way `page-tree.js` reads it (`text` when the node has one; the `separator` value of a separator node; for a language mapping the translation that was displayed, named by `language`), and builds one line operation of the [edit api](doc_page_impl_edit.md#edit-api-and-line-operations) with the yaml edit helpers of `doc-yaml-edit.ts` ([YAML utilities](doc_page_impl_yaml_utils.md)), shared with the config value write: `replaceLines` over the lines holding the value, rebuilt as the text before the value on its first line, the new scalar, and the text after it on its last line (a trailing comment stays) (`nodeReplaceBuild`); or, for a node without a `text` (a document labeled by its title), `insertLines` of one `text:` line after the node's first key at the node's indentation, so the title becomes an authored label (`linesInsertBuild`). The new scalar is plain when yaml would write it plain and quoted otherwise (`yamlScalarTextBuild`: `yaml.stringify` decides, with folding off), and a value authored over several lines becomes one line. Every other line of the file is untouched, byte for byte, and the file as it was is kept beside it as `{file}.bak` before the write. The request carries `textBase`, the authored label the edit started from; when the file no longer holds it, the edit is refused (code -2) rather than overwriting someone else's change. A node written as a flow mapping cannot receive a new key and is refused with an explanation.

**No reload.** A side-panel file is configuration, and a change of configuration normally regenerates the manifest and reloads the page. A label written by the page is different: the plugin re-reads the configuration itself, invalidates the manifest module, and sends the new `configDoc` and `fileManifest` as the `doc-source-change` data event ([Saving without a reload](doc_page_impl_edit.md#saving-without-a-reload)); `DocStore.treeModel` recomputes from the new tree and the side panel re-renders in place. The watcher then reports the same file change; the plugin remembers the content hash it wrote and skips the reload while the file still has that content, so an edit made in an editor afterwards still reloads the page as before.

**In the browser.** `DocEditStore.sidePanelText` is the one label being edited (`editing`, `submitting`, `error` with its message). Starting it is an edit action like any other: the open block session is left (saved) first. `SidePanelItemHost` hands the renderer `config.isTextEditable` (edit mode, sidebar surface, the item has a `textSource`) and the status of its own rendering (see **One editor** below); the default renderer shows a small edit button after the label while the row is hovered, and on click reports `sidePanelTextEditStartRequest`. The events are routed like component reports ([event layer](doc_page_impl_event.md)): the host application sees them first, then the edit route brings them to `DocEditStore.eventHandle`, which identifies the item by `event.source.itemId` and finds its `textSource`, its displayed translation and the authored text in `DocStore.treeModel.itemOutlineById`. An empty or unchanged text only ends the edit. After a successful write the item shows the saved text as `data.text` (`sidePanelTextPending`) until the new configuration has rebuilt the tree, so the label never flashes back to its old value. The rebuilt tree does not reach the sidebar itself: fumadocs keeps the page tree it received first as long as the root `$id` stays the same, and the root `$id` follows only the shape of the tree (see [Moving an item](#moving-an-item)), which a new label does not change. `SidePanelItemHost` therefore reads the label (`textLocalized`, `textMessage`) from the current `itemOutlineById` by its `itemId`, and the props of its element are only the fallback.

**One editor.** The same item is rendered in several places at once: the sidebar, the breadcrumb, a previous/next card, the toc popover, and, on a narrow window, the mobile side panel next to the desktop one. Each rendering is a `SidePanelItemHost` with an instance id of its own (`side-panel-display:{itemId}:{react id}`, the `source.instanceId` of its events); the item id is the same for all of them and does not tell them apart. An editor that every rendering of the item mounted would take the focus from the one clicked, and its blur would submit the unchanged label and end the edit. So the edit belongs to the rendering it was started from: `sidePanelText.ownerId` is that rendering's instance id, and `sidePanelTextStateGet(itemId, ownerId, isTextEditable)` gives the editing and submitting status to that rendering alone. A failed save is shown by every editable rendering of the item, any of which can retry it; the others display the label, a name just saved included. The rules that follow from it:

- A submit or a cancel is accepted only from the owner. The blur of another rendering, or of an editor already replaced, is refused and leaves the edit as it is.
- A rendering on a display-only surface does not start an edit even when its renderer reports the request: `SidePanelItemHost` refuses it as the local handler of the event.
- A new start (another item, or the same item from another rendering) drops the edit being typed, unsaved; a save in progress refuses it. Two starts that wait for the block session to be left: the later one opens.
- A rendering that unmounts (the mobile side panel closes, the layout changes, the tree is rebuilt) releases what it owns (`sidePanelTextOwnerRelease`): the edit it was showing is dropped unsaved, its waiting start does not open; a save in progress finishes, and a failed save stays for the other renderings.
- Leaving edit mode drops the edit being typed. Navigating does not end it by itself: the sidebar stays, and its editor with it.

**Inside a link or a folder button.** The label is inside the sidebar link of its item or the button of its folder, which the side panel does not own. The edit button and the editor stop their pointer events. The editor also keeps the keys from them: a button activates on the key-up of Space and Enter, so the editor stops the key-up and prevents its default (Space has typed its space on key-down, and the folder does not toggle); Enter saves on key-down without following the link, Escape drops the edit on key-down; both stop there. Keys during IME composition are left to the composition, and paste inserts plain text.

**No jitter.** Nothing moves when edit mode is toggled or when a label is edited. The edit button hangs off a zero-width inline anchor placed after the label and the tags, absolutely positioned, transparent until the row or the button itself is hovered: it takes no room, and the label host fills the row of the sidebar link (`flex: 1 1 auto`) so that hovering anywhere on the row shows it. It is styled like a button of the block toolbar (no frame, muted icon, accent background on hover; the icon size is set by class, because the sidebar link sizes every svg inside it) and it always takes the pointer, even while transparent, so a click on it never falls through to the link and navigates. The label is edited in its own span, made `contenteditable` (plain text), with an outline drawn outside its box: same element, same typography, same size. Enter and leaving the focus submit, Escape drops the edit; the button and the editable span stop their pointer events, so the sidebar link does not navigate and the folder does not toggle while a label is edited. While the write is pending the span is locked and dimmed; a failure shows the message as the label's hover title with a red outline, and the edit button is back so the edit can be retried.

## Moving an item

In edit mode an item of the side panel can be moved, with its whole subtree: among the children of its parent, into another folder before or after one of its children, or into a document item that has no children yet, which makes it a folder. The item is dragged by its row, or placed through the move picker opened by the move button next to the edit button or by **Move…** in the context menu of the item. Like a label edit it is available on the development server only, on the `sidebar` surface, and for items that are a node of a side-panel file.

```text
plugin (load time)         every node: nodeSource = { file, path }, the node itself (textSource
                           can point at an included root instead)
                           a node with "include": includeSource = { file, path, isDocEntry,
                             isChildrenLocal }: the tree list of the included side panel, whether
                             it is another document's entry (a sub document), whether the node
                             also has children of its own (they come after the included ones)
                           configDoc.docEntry.fileHashByFile
page-tree.js               itemOutlineById: nodeForm, nodeSource, includeSource, isPartRoot
                           itemPlaceById (lib/side-panel-move.js): parent, children, depth, scope
                           of every item; the root $id: root-{hash of the tree's shape}
lib/side-panel-move.js     sidePanelMoveResolve(place index, itemId, position, targetItemId)
                             -> the request of the edit api, or why the move is not allowed
SidePanelItemHost          wrapper element (data-side-panel-item-id) with the drag handlers;
                           config.isMovable
side-panel-drag.js         pointer -> drop { position, targetItemId } over the measured rows
SidePanelItem              hover: [✎][✥] after the label -> sidePanelItemMovePickerOpenRequest
SidePanelMovePicker        the side panel as a tree (SourceTreeSelect) + Before / After /
                           Into, first / Into, last
event layer                sidePanelItemMoveRequest { position, targetItemId } (source.itemId)
                           -> sidePanel route -> DocSidePanelStore.eventHandle
DocSidePanelStore          moveApply: leave the block session, POST {editEndpoint}/side-panel/move
                             { item, target, hashBaseByFile }, record the change in the history
                             of the edit layer
plugin/doc-side-panel-move.ts  the item's lines out of one list, into another (same or other file)
plugin                     write both files; report the new configuration once, as data
```

**A move in terms of the tree.** The page says a move as the reader sees it: `position` is `before` or `after` the target item, or `insideFirst` / `insideLast` of it. `sidePanelMoveResolve` is the one place that decides whether the move is allowed and what it writes; the drag, the picker and the event handler all ask it, so they never disagree, and the tree view of the picker only selects an item, it means nothing by itself. Translated to yaml, `before` and `after` are the list holding the target (its `nodeSource` path without the last index) at the target's index or the one after; `insideFirst` is index 0 of the included tree when the target includes a side panel, else of its `children`; `insideLast` is the end of its `children` when it has local children or includes nothing, else the end of the included tree. A `children` key that does not exist yet is added, which is how a document leaf becomes a folder. A move that lands where the item is (next to itself, or last of its parent when it is last already) writes nothing.

**What is refused**, each with a reason the reader sees (the grey indicator and the ghost label of a drag, the hover title of a disabled picker button):

- an item generated from a source folder: it has no node to move, and nothing is placed next to it (its list is the folder, not a yaml list);
- a move into the item itself or below it;
- a move into a separator, a component panel, an inline page or a source folder: only a document item and a folder hold items;
- a move out of the item's part or sub document, and a move into one from outside. The scope of an item is the nearest part root (a node with `part`) or sub document (a node including another document's entry, `includeSource.isDocEntry`) above it; the new parent must give its children the same scope. The rule is symmetric so that every move can be undone by a move.

**How the files are changed.** As for a label, the files are never rebuilt from their parsed objects. `doc-side-panel-move.ts` parses them only to find character ranges and builds line operations with the list-item helpers of `doc-yaml-edit.ts` ([YAML utilities](doc_page_impl_yaml_utils.md#an-item-of-a-block-list-moving-a-block-of-yaml)):

- *the item's lines* (`yamlSeqItemLinesGet`): from the line of its `-` to its last line; comment lines right above it at the column of the dash belong to it, comment lines after it indented deeper than the dash too; a blank line ends both, so a comment separated by a blank line stays where it is;
- *removed* (`yamlSeqItemRemoveBuild`): those lines go, and one blank line with them when the item stood between two blank lines; a list left empty becomes `key: []`;
- *inserted* (`yamlSeqItemInsertBuild`): re-indented to the column of the items of the new list (an unindented list under its key stays unindented); into an empty list (`key:` or `key: []`) at the key's column plus the file's list indentation; into a node without the key, as a new `children:` after the node's last line;
- *between two files*: an `include` inside the moved lines names its file relative to the file holding it, so the path is rewritten relative to the new file; a reference `{ sidePanel: x }` without a file meant "this file" and gets the old file named. The two files are written together, after both results parse.

A flow list or a flow mapping cannot take an item in place and is refused with an explanation. Every other line of both files is untouched, and each file is kept as `{file}.bak` before the write. The request carries the hash of every file the page built its side panel from (`fileHashByFile`); a file that changed since refuses the whole move (code -2). A configuration that would not load afterwards (an include that would now reach itself) is written back and refused.

**After the write.** The plugin reports the configuration once for both files, as data, without a reload, like a label write. The tree has another shape now, and fumadocs renders the rows by their index and keeps its first tree while the root `$id` stays the same; the root `$id` is therefore `root-{hash of the tree's shape}` (the nested item ids), so a move renders the side panel again and a rename does not. A side panel rendered again would start every folder over, because fumadocs keeps a folder's open state inside the row: `DocSidebarFolder` records it by item id in `DocSidePanelStore.folderOpenById` and starts each folder from it, and the new parent of the moved item is opened. An item without an explicit `id` has an id from its position, which a move can give to another item; `DocStore.replaceSourceData` keeps the reader on the document they were reading when the route they were on now names another one.

**The drag.** `SidePanelItemHost` wraps the label in an element that takes no box (`display: contents`) and names the item; the row is its parent, a fumadocs link, folder button or separator. A mouse or pen drag starts after 5px, never from the editable label, the edit or move button, or a tag, and its mousedown is kept from the browser so a link row is not dragged as a link. On every move the rows of the side panel it started in (desktop or mobile) are measured and the pointer becomes a drop: a row that can hold children is split 25 / 50 / 25 into before, into (as last child, a box around the row), and after (or the first child, when it is an open folder showing children); any other row 50 / 50. After a row that ends its folder, the pointer's x chooses the depth: further left means after the folder, and after the folder around it, as far as each is a last child. A zone is kept while the pointer stays within 4px of it; the middle of a closed folder opens it after 600ms (through `folderOpenById`); the side panel scrolls near its edges; Escape cancels; the click that ends the drag is swallowed. `SidePanelDragOverlay` draws the indicator in a fixed layer above the page: a line starting at the depth the item would have, with a dot there, or a box; grey when the drop is refused, with the reason under the label that follows the pointer. A drop is reported as `sidePanelItemMoveRequest`, and while it is written, and after a failure, a small notice stays where the item was dropped until the next click or Escape.

**The picker.** The move button sits in the zero-width anchor of the edit button (both buttons in one group, shown on hover, nothing moves). It reports `sidePanelItemMovePickerOpenRequest` with the pointer; `SidePanelMovePicker` floats there, styled like the location prompt of the doc page source service layer, with the side panel in the tree view of the same layer (`SourceTreeSelect`), opened down to the moved item, which is disabled with everything below it. Choosing an item shows the four actions; one that is refused is disabled and says why on hover. The picker shows the move being written and its failure. Its header, aside from the close button, drags the picker, which stays inside the window; a picker opened again starts where the pointer was. It closes with the close button at the top right, on Escape, or on a pointer down outside, and not while the move is being written.

**The context menu.** A right click on the row of an item that can be renamed or moved (edit mode, `sidebar` surface, the host application injected `config.components.Menu`) opens `SidePanelItemContextMenu` at the pointer instead of the browser's menu; the editable label being edited keeps the browser's menu. It is the injected Menu (react-comp-misc), styled like the mode menu of a block (`doc-edit-mode-menu`), with two entries, the two buttons of the label: **Rename** reports `sidePanelTextEditStartRequest` with the `instanceId` of the rendering that was right-clicked, so that rendering owns the edit as if its pencil was clicked; **Move…** reports `sidePanelItemMovePickerOpenRequest` with the point of the right click, so the picker opens there. Both go through the event router with `placement: 'sidePanelContextMenu'`. An entry that does not apply is disabled with its reason as hover title. The open state is `DocSidePanelStore.contextMenu { itemId, instanceId, point }`; opening closes the menu that is open and opens the new one on the next frame, so a right click on another row while the menu is open moves the menu there. A pointer down outside or Escape closes it.

**History.** A move is recorded by `DocEditStore.historyRecord` with the text of both files before and after (`kind: 'sidePanelItemMove'`), next to the records of document operations; see [History records](doc_page_impl_edit.md#history-records). The events of the sidePanel route pass the host application first, like every component report.

## Folder interaction and routes

Document items and folders bound to documents receive stable item routes, while the tree remains the source of document order. Route selection, `@first/{itemId}`, previous/next order, and Back/Forward/Up are described in [Navigation design](doc_page_impl_nav.md#side-panel-routes-and-folder-navigation).

The default folder gesture (an inactive label navigates, the active label toggles, the chevron only toggles) lives in `DocSidebarFolder`. Consumers replace it through runtime `config.sidePanel.components.Folder` without replacing route resolution or history. See [Indexed-folder interaction](doc_page_impl_nav.md#indexed-folder-interaction).

## A workspace of several doc pages

A workspace with one root doc page shows that doc page's side panel, as if it were served alone. With several (written in the workspace file or [mounted for now](doc_page_impl_source.md#temporary-doc-pages)), the side panel shows them one after the other, each as a **section**: the alias of the doc page as a muted heading, then its own side panel at the depth of the tree's root, so its items look as they do alone. The workspace only arranges the side panels; a doc page's tree stays in its entry.

```text
WORKSPACE                 [⇕] [⇳]      ◄ toolbar: unfold all, fold all (more actions join here)
example                          ⌄     ◄ the alias, muted; a click folds the section
  Example Docs
  Document Model
  ...
second  (temporary)              ⌄
  Workspace Sections
```

The loader makes a node per root doc page with `docPageSection` `{ alias, title, isTemporary, isFirst }`, its children the doc page's tree; the root properties of that side panel that reach the documents (`tags`, `config`) stay on it, its label and bound document do not (the alias is the heading). `page-tree.js` keeps the mark on the folder it builds, and `DocSidebarFolder` hands such a folder to `DocSidePanelSection` (`comp-doc/side-panel/`), which renders no fumadocs folder (a folder would count as a level and indent the items). A section folds like a folder, its open state kept in `DocSidePanelStore.folderOpenById` by its item id (`doc-page-{alias}`); the first section carries the toolbar above its heading, whose buttons are `sectionOpenAllSet(true | false)`, each disabled when there is nothing to change. The items of a section move, are renamed and dragged as anywhere else.

### One effective occurrence per doc page

A doc page is [one thing however often it is reached](doc_page_impl_source.md#doc-pages-reached-by-includes), and its side panel is shown **once**. A root doc page of the workspace that another doc page includes as well (the wiki of a project lists its sub projects, and the workspace mounts them as roots too) is shown at its mount only, whatever the order of the workspace or the side panel chosen; a doc page without a mount is shown at the first include reached, traversing the roots in their configured order and the children in authored order. Every later include of the doc page is *shielded*: the node holding it leaves the tree shown with its whole subtree, local children of that node included (independent local navigation belongs in a separate item). Only an include of **another** doc page's entry is a repeated mount (`includeSource.isDocEntry` with a `docPageAlias` other than the node's own): a resource include, and a reference to another side panel of the same doc page, are never shielded, and the section nodes are the mounts themselves. Served alone, the wiki still shows the sub projects it includes.

Shielding is a projection of the side panel shown (`sidePanelEffectiveGet`, `plugin/doc-sidebar-effective.ts`), applied in `docWorkspaceLoad` once the trees of the roots are assembled, for a workspace of several doc pages and for one root whose side panel includes another root; it clones what it keeps, so the cached side panel resources are untouched. What the workspace holds does not change: the shielded include is still a mention of the doc page, its rules, tags, config, aliases, services and assets are loaded as before, and the Workspace graph keeps every edge. The entry of a doc page shielded in one workspace needs no change.

### The root row hidden

A doc page whose side panel is one wrapper item (a folder, or a document with children, holding everything) would show that single row under the section heading, and the reader would open it first. The workspace mount option `isRootVisible: false` ([the workspace file](doc_page_impl_source.md#the-workspace-file); a per-mount checkbox "root row" in the Workspace tab) shows the wrapper's children directly under the heading:

```text
main-project                     ⌄     ◄ the section heading
  業務フロー                             ◄ the children of the sole wrapper item, its row not drawn
  データ仕様
  システム構成
```

The option belongs to the mount, not to the reusable entry, and is read as a yaml boolean only (`"false"`, the text, is refused). It hides one sole wrapper item with children and nothing else: several roots, a leaf, an empty folder, a separator keep their display, so no content ever disappears. It is not a flatten: the wrapper stays in the semantic tree, marked `isSidebarRootHidden` by the loader (`sidePanelRootHiddenApply`), with its item id, bound document, tags, config, part, breadcrumb and home targets, and its `textSource` / `nodeSource` for editing. `page-tree.js` keeps the mark on the folder it builds and counts it in the render key of the tree, so toggling the option re-renders the side panel at once while the item ids stay. `DocSidebarFolder` draws such a folder as its children only, without a row and without a folder level; its remembered open state is not read, so it never hides its children; the section above folds them, and a child folder keeps its own row and chevron. A consumer replacing the folder renderer (`config.sidePanel.components.Folder`) takes this case over too.

## Implementation files

```text
frontend/plugin/doc-entry.ts             load the workspace: its doc pages (aliases, mentions), the
                                         entries and every document yaml file they reach: side
                                         panels and their includes, "source" and "tag" sections,
                                         docPageAlias / textSource / nodeSource / includeSource
                                         annotation, file hashes
frontend/plugin/doc-sidebar-effective.ts the side panel shown: one effective occurrence per doc page
                                         (later includes shielded), the sole wrapper item of a mount
                                         marked isSidebarRootHidden
frontend/plugin/doc-source.ts            config.yaml workspace / docEntry -> configDoc, watch the
                                         loaded files, report a label write or a move as data
frontend/plugin/doc-side-panel-text.ts   a label change as one line operation of its yaml file
frontend/plugin/doc-side-panel-move.ts   a move as line operations of one or two yaml files
frontend/plugin/doc-yaml-edit.ts         the in-place yaml edit they are built on (node ranges ->
                                         line operations; list items: lines, remove, insert)
frontend/plugin/doc-edit-server.ts       POST {editEndpoint}/side-panel/text and /side-panel/move,
                                         the writes with their backups
frontend/src/lib/page-tree.js            tree conversion, routes, parts, tag and config declarations
frontend/src/lib/side-panel-move.js      place index, what a move is allowed to do and writes
frontend/src/lib/side-panel-item.js      renderer choice and item data
frontend/src/lib/text-localized.js       localized label parsing and selection, shared with indexes
frontend/src/store/DocEditStore.ts       sidePanelText: the label being edited, the write
frontend/src/store/DocSidePanelStore.ts  folder open state, drag, picker, context menu, the move (sidePanel route)
comp-doc/side-panel/SidePanelItemHost.jsx  runtime context, surfaces, edit state and owner of the
                                           label, the drag wrapper
comp-doc/side-panel/SidePanelItem.jsx      default renderer (common/SidePanelItem), label editing,
                                           move button
comp-doc/side-panel/side-panel-drag.js     the drag: rows measured, zones, depth, auto open / scroll
comp-doc/side-panel/SidePanelDragOverlay.jsx  drop indicator, ghost label, move notice
comp-doc/side-panel/SidePanelMovePicker.jsx   the move picker
comp-doc/side-panel/SidePanelItemContextMenu.jsx  right-click menu of an item: Rename, Move…
comp-doc/side-panel/DocSidebarFolder.jsx   default folder gesture, open state by item id, a hidden
                                           root row drawn as its children
comp-doc/side-panel/DocSidePanelSection.jsx  a root doc page of a workspace of several: heading, toolbar
comp-mdx/tag/TagLabel.jsx, TagList.jsx     tag display
```
