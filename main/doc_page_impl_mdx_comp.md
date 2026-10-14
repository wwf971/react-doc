<!-- Design of components available inside documents. Parent document: doc_page_impl.md -->

# MDX Components: Design

Components that authors can use inside md/mdx documents live under `main/comp-mdx/`, one folder per component family. They are ordinary registered components: `config.yaml` `compRegistry` maps a tag name to a component id, and the component definition in `compById` (created with `compDefine()`) provides the render component, how the registry boundary treats it, and what it exposes about itself ([What a component exposes](#what-a-component-exposes)). Registration, placements, and the common `{ data, config, onEvent }` interface are described in [Document Page: Design](doc_page_impl.md#component-registry).

```text
document  <!--renderComp=FileTree,id=x-->  or  <FileTree .../>
   -> compRegistry: tag name FileTree -> id common/FileTree
   -> compById: definition { CompRender, componentType, dataRefTypeList, placementList, dataBuild, expose }
   -> RegisteredComp: normalize input into { data, config, onEvent }
   -> render component
```

## What a component exposes

A definition says two kinds of things about a component. The first is how the registry boundary (`RegisteredComp`) treats it: where it may render (`placementList`), what it can be referenced as (`componentType`, `dataRefTypeList`), how its input is normalized (`dataBuild`), what it is told about its data (`isAssetAware`, `assetDependencyListGet`). The second is what the component tells the page about itself, for the page to offer to readers and authors: that it is read-only, in which ways it can be displayed and edited, what its icon is, how a new block of it starts, which config keys it has. These are the component's **exposure**, the `expose` option of `compDefine()`:

```text
compDefine(Xxx, {
  placementList, componentType, dataRefTypeList, dataBuild,     how the registry boundary treats it
  isAssetAware, assetDependencyListGet,
  expose: {                                                     what it tells the page about itself
    meta:          { label, description, isReadOnly, isEditSourceAccepted, isInsertCommon,
                     configDefineList, ... }
    icon:          a component drawing the icon of Xxx at any size
    viewModeList:  [{ id, label, description, icon, isDefault }]   the ways its data is displayed
    editModeList:  [{ id, label, description, icon, isDefault }]   the ways its data is edited in place
    sourceDefaultCreate: (env) => { lang, raw, props } | { text } | undefined
                                                                 the source of a new block
    anythingElse:  kept as written                                  for a host or a later feature
  },
})
```

Five names are **standard**: the page knows their shape, normalizes them at registration (`comp-expose.js`, `compExposeNormalize`; a wrong shape fails there, not later in some reader), and reads them where it needs them. Every other name is **non-standard**: kept exactly as declared, read by whoever knows it through `compExposeGet(definition, name)`, so a host application or a feature that does not exist yet can hang its own facts on a component without a change to the registry. A legacy definition (a bare React component in `compById`) exposes nothing and gets the defaults of every standard name. The standard names are read through small accessors rather than by reaching into the definition (`compMetaGet`, `compIconGet`, `compViewModeListGet`, `compEditModeListGet`, `compSourceDefaultGet`, `compExposeGet`); for a component that exposes nothing they return the defaults described below.

The exposures of the components registered by the package are kept beside the component when it has an editor of its own (`image-expose.js`, `image-grid-expose.js`, the demo `StockTable`), and in `comp-doc/registry/registry-expose.js` for the others; every component that can start a block of a document exposes a label, a description, an icon, and a `sourceDefaultCreate`.

### Metadata (`meta`)

Facts about the component that are not modes or drawings, as one object, so that a new fact is one more key of it and not one more option of `compDefine()`:

| key | default | meaning |
| --- | --- | --- |
| `label`, `description` | — | how the component is presented to a reader, where the page lists components (the insert menu and its search, the mode menu's reasons) |
| `isInsertCommon` | `false` | the insert menu lists the component directly in its row of components; every other component is found through the menu's search ([Creating a block](doc_page_impl_edit.md#floating-controls)) |
| `isReadOnly` | `false` | nothing of a block of this component can be edited from the page: it has no edit mode at all, the toolbar's Edit button is greyed out, a click does not enter it, and the mode menu, when the block has one for its view modes, says so. For a component that displays what the page knows (every tag, the resolved config) and has no data of its own |
| `isEditSourceAccepted` | `true` | the built-in `source` edit mode is offered for its blocks ([below](#view-modes-and-edit-modes)). `false` for a component whose source must not be edited by hand, when it declares edit modes of its own |
| `configDefineList` | `[]` | the shape of its component-level config: which keys exist, their types, defaults, descriptions. Only the shape; the values come from the config layers and the document levels, and reach the component as `config.compConfig` ([Component-level config](doc_page_impl_config.md#component-level-config)) |

A component may add keys of its own to `meta`; they are kept beside the standard ones.

### Icons

An icon is a React component drawn at any size: `size` for a square, or `width` and `height` separately. A rectangular size draws the icon in the largest square that fits, centered: the svg has a square `viewBox` and `preserveAspectRatio="xMidYMid meet"`, so the drawing is never stretched. `compIconDefine(drawing, { viewBox, isStroke })` in `comp-icon.jsx` builds such a component from svg elements, with the stroke attributes of the page's line icons (or filled shapes with `isStroke: false`), in the current text color; the lucide icons of `frontend/UICommon.js` already satisfy the contract and can be exposed directly. A component exposes one icon for itself (`expose.icon`) and may give one to each view mode and edit mode. The page draws them in the insert menu beside the component's name and in the mode menu beside each mode, at whatever size the place needs, which is why they are declared as drawings and not as fixed images. A component without an icon is drawn with `compIconDefault` (a block inside a block), so every entry of a list of components has one (`compIconGet`).

### View modes and edit modes

A component can display the same data in more than one way, and can let an author change the data in more than one way. Both are **modes** the component exposes, each a list with one default, and the page offers them in one place: the **mode menu** of the block, opened from the button next to the block's label in its toolbar (and in the bar of its editor), while the document is in edit mode:

```text
  [StockTable] [≡ modes] [✎] [+↑] [+↓] [˄] [˅] [🗑]
               ┌────────────────────────────┐
               │ VIEW MODE                  │
               │ ▦ Table   [current, default]│  ◄ applied at once: the block re-renders
               │ ▥ Summary                  │
               │ EDIT MODE                  │
               │ ⌶ Cells   [default]        │  ◄ opens the block in that mode
               │ ⌨ Source  [built-in]       │
               └────────────────────────────┘
```

**View modes** (`viewModeList`) are ways of display: a table and its summary, a diagram fitted to its box and at its own size. The reader's choice for a block is kept by the edit layer for the document session (`DocEditStore.blockViewModeById`, by block; dropped when the number of blocks changes, since the indices then name other blocks) and handed to the component as `config.viewMode`, the id of the mode to render; without a choice the component receives its default mode, and a component without view modes receives no `config.viewMode`. The component renders the mode it is told and keeps no mode state of its own, so the menu and the block never disagree. A display variant that the author writes into the data (the `displayMode` of an `Image`) is data, not a view mode: it has an authored default per block, which a list declared once per component cannot express.

**Edit modes** (`editModeList`) are ways of changing the data in place: the fields of an image, the cells of a table, pasting into the slots of an image grid. One mode is **built-in** and belongs to the page, not to the component: `source`, the lines of the block as written, edited by the default editor of the block's kind. Every block has it unless its component says otherwise:

```text
edit modes of a block of component X  (compEditModeListGet)
  X.meta.isReadOnly              -> none: the block cannot be edited
  else X.editModeList            -> the declared modes, in order
       + 'source' (built-in)     -> unless X.meta.isEditSourceAccepted is false
  default: the declared mode marked isDefault, else the first declared, else 'source'

a block without a component      -> 'source' only
a block whose data is an asset   -> 'source' only; the declared modes are listed greyed out,
                                    since the lines of the block are the reference and the data
                                    is edited through the asset panel (doc_page_impl_asset.md#edit-mode)
```

A session of the edit layer is therefore always *a block in one edit mode* (`session.editModeId`). The Edit button and a click open the block in its default mode; the mode menu opens it in the chosen one, reported as the same `editBlockEnterRequest` with `editModeId`; choosing another mode while the block is open saves the session and opens the block again in it. The component's editor learns its mode as `config.edit.modeId` and branches on it when it has more than one; a component with a single mode of its own can keep branching on `config.isEdit` alone. How the editor is chosen, what it receives and reports are specified in [In-place editing](doc_page_impl_edit.md#component-edit-mode).

**Every edit mode enters without moving the page.** Whichever mode a block is opened in, declared by the component or the built-in `source`, and whether it is entered from view mode or from another edit mode, the height of the block and everything below it stay where they were: the mode makes the block's own content editable in place and floats everything else, exactly as the built-in `source` mode does. This is a convention of every mode a component declares, not a property of one editor; a mode that needs more room than the view (a form, a list of fields, a preview) puts that room into its floating panel or lets it extend over the next block, never into the flow. The rules an editor keeps for this are in [Text blocks and edit mode](#text-blocks-and-edit-mode), and the rule itself is [the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule).

The menu is offered where there is something to choose: a component block with more than one view mode or more than one edit mode. Its entries are greyed out when they cannot be chosen now (a write is pending, the data is an asset), each with its reason as its tooltip; a read-only component lists no edit mode and says so. The dropdown is the `Menu` of `@wwf971/react-comp-misc`, which the host injects as `config.components.Menu` like the settings panel; without it the button is not rendered.

Among the components of this folder, `Image` exposes the edit mode `fields` ([Text blocks and edit mode](#text-blocks-and-edit-mode)) and `ImageGrid` the edit mode `images`: a grid clicked in edit mode takes pastes into its slots and adds or removes slots, and its yaml is the built-in `source` mode one entry away, instead of the yaml being what a click shows. The demo `StockTable` of `example_doc/` exposes two view modes (`table`, `summary`) and the edit mode `cells`; the demo `TagListAllDemo` is read-only.

### Default source

`sourceDefaultCreate(env)` is the factory of the source a new block of the component starts with. Creating a block of a component always goes through it: the insert menu of the edit layer calls it for the document the menu is open in (`compSourceDefaultGet`), offers the component when it returns a source, under the tag name authors use, with its label, description and icon, and the chosen block is written to the document and opened in its default edit mode ([Creating a block](doc_page_impl_edit.md#floating-controls)). A factory rather than a fixed text, because what a good start may depend on where the block goes, and a component may ignore all of it. The components of the package start in the comment-block form in every document, md and mdx alike; only the components of the fumadocs theme, which are MDX elements and have no comment-block form, return `{ text }` for an `.mdx` document and nothing for an `.md` one.

**The comment style is fixed.** A component block is written as `<!--renderComp=Xxx-->` with its fenced block, and a comment block as `<!-- … -->`, in `.md` and `.mdx` documents alike; this is the authoring form of the project ([Graceful degradation](doc_page_impl.md#graceful-degradation-stipulation)) and it compiles in both formats. Nothing the page writes, no template, factory, or editor, may switch it to `{/* … */}` or another comment syntax, or pick a different marker by document format; the code that writes markers carries the same warning (`edit-template.js`, `registry-expose.js`, `comp-expose.js`, `remark-comment-comp.js`).

What a factory is given and what it returns:

```text
env = {
  compName,     the tag name the block is written with (compRegistry; a compatibility name maps to the same component)
  docPath,      the source path of the document (Index and SourceLink start with a link to it)
  docFormat,    'md' | 'mdx': an MDX element (Callout, Tabs) can start a block in an .mdx document only
  compConfig,   the component-level config of the document (doc_page_impl_config.md#component-level-config)
}

returns
  { lang, raw, props }   the comment-block form: the marker <!--renderComp=compName,props-->,
                         then a fenced block in lang (default yaml) holding raw
  { text }               the block exactly as written: an MDX element, or a marker before a node
                         that is not a fenced block (BlockSimple marks a quote)
  undefined              the component starts no block there: an MDX-only component (Callout, Tabs)
                         in an .md document
```

The returned shape is checked when the factory is called; a factory that throws or returns a wrong shape is reported in the console and its component left out of the menu, so one faulty component does not take the menu with it. A component without a factory cannot be inserted from the menu, only written by hand: the components a document writes only inside another one (`Tab`, `Step`, `Accordion`, `File`, `Folder`), markers of the next node (`Anchor`), inline components (`Tag`, `DocLinkInline`), the parts other components render through the registry (`FileIcon`, the cells, rows and header controls of the hierarchies), and what is not document content (`SidePanelItem`, `TagLabel`, the editors of the edit layer).

## Component names

Component and file names carry no `Doc` prefix: inside a document every component is already a document component, so the prefix adds no meaning.

| Tag name | Folder | Compatibility tag name |
| --- | --- | --- |
| `FileTree` | `file-tree/` | `DocFileTree` |
| `Index` | `index/` | `DocIndex` |
| `MultiLang` | `multi-lang/` (`MultiLangEntry.jsx`) | `DocMultiLang` |
| `Image` | `image/` | `DocImage` |
| `ImageGrid` | `image-grid/` | `DocImageGrid` |
| `DiagramText` | `diagram-ascii/` | `DocDiagramText` |
| `DiagramMermaid` | `diagram-mermaid/` | `DocDiagramMermaid` |
| `DiagramER` | `diagram-er/` | `DocDiagramER` |
| `BlockSimple`, `Block` | `block-simple/` | |
| `BlockMdx` | `block-mdx/` | |
| `Tag`, `TagLabel`, `TagOverview` | `tag/` | |
| `Anchor` | `anchor/` | |
| `BlockQA` | `block-qa/` | |
| `FileDownload`, `FileIcon` | `file-download/` | |
| `TableHierarchy`, `TextInfoCell`, `TableCapabilityCell` | `table-hierarchy/` | |
| `ListHierarchy`, `ListSupportedToolsRow`, `ListToolsControls` | `list-hierarchy/` | |
| `SwitchView` | `switch-view/` | |
| `ProxyConnectionDiagram` | `proxy-connection-diagram/` (with `diagram-interactive/`) | |

`Anchor` declares fragment ids for the node after it rather than displaying content. Compilation handles it before other comment components; see [Navigation design](doc_page_impl_nav.md#fragment-targets-titles-and-declared-ids).

Some components render their parts through the registry rather than importing them, so a document can name another registered component for a part. Each part has its own placement:

| Placement | Rendered by | Built-in components |
| --- | --- | --- |
| `fileDownloadIcon` | the icon of a `FileDownload` card (`icon`, or `iconByExtension` and `iconFallback` of the component config) | `FileIcon` |
| `tableCell` | a cell (`cellComponent` of a column or a cell) or a row label (`labelComponent`) of `TableHierarchy` | `TextInfoCell`, `TableCapabilityCell` |
| `hierarchyRow` | a row of `ListHierarchy` (`rowComponent`) | `ListSupportedToolsRow` |
| `hierarchyHeader` | the header controls of both hierarchies (`headerRight`) | `ListToolsControls` |

`SwitchView` shows the same data through several block components, one per view, rendered in the placement `commentBlock`. Its build-time collector hands every view to the collector of its component, so links in views that are not shown are still discovered; `BlockQA` collects its Markdown questions and answers. `FileDownload` names its file as the dependency of an asset made from its data, like the `src` of an `Image`. `ProxyConnectionDiagram` is a fixed diagram, not driven by data: the text of its block is only what a plain Markdown viewer shows. The usage of each component is described beside it (`comp_block_qa.md`, `comp_table_hierarchy.md`, `comp_list_hierarchy.md`, `comp_switch_view.md`).

Some components read host settings from `config`, supplied by the application through `DocPageMdx` `config.compConfigHost` (see [Component registry](doc_page_impl.md#component-registry)): `Image`, `ImageGrid` and `FileDownload` resolve `src` through `assetUrlGet`, and `DiagramMermaid` loads Mermaid through `mermaidLoad` and resolves lane icons through `assetUrlGet`. The block components, `BlockQA` and `MultiLang` receive the shared `MdxRenderer` from their package registry definitions, so nested Markdown has the link, math and component behavior of the document body.

Documents and consumer code written with the old names keep working:

- Each component module exports both names, for example `export { FileTree, FileTree as DocFileTree }`. `IndexData.js` also keeps `docIndexLanguageListGet` and `docIndexStructuredDataGet`.
- The package registry keeps the old component ids (`common/DocFileTree`, `common/DocIndex`, `common/DocMultiLang`, `common/DocImage`, `common/DocImageGrid`, `common/DocDiagramText`, `common/DocDiagramMermaid`) as aliases of the new definitions, so existing consumer `compRegistry` entries still resolve.
- The demo `config.yaml` maps both tag names to the same id.
- Code that recognizes a component by tag name before the registry is involved accepts both names: the multilingual heading marker and compile callbacks (`multiLangCompNameList` in `MultiLangData.js`), and the build-time attachment finders for `Image`, `ImageGrid`, and `DiagramMermaid`. Consumer callbacks keyed by tag name, such as `compile.languageListGetByComponent`, must list every tag name in use.

`DocLink`, `DocLinkInline`, and `DocComp` keep their names. In `DocLink`, "Doc" means "link to a document", as opposed to `SourceLink`; `DocLink` and `DocComp` are also element names emitted by the remark plugins that custom recognizers rely on.

## Component data reference

A component can reuse the authored data of another component instead of repeating it. The source component is marked with a document-unique `id`; the reusing component names it with `dataRef`. A typical use is a family of diagrams that draw different overlays above the same file tree: the tree is written once, and each diagram references it as its background.

````markdown
<!-- comp-file-tree.md: the source -->
<!--renderComp=FileTree,id=example-project-tree-->
```yaml
tree: [...]
```

<!-- another document: the reference, with optional local data -->
<!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->
```yaml
maxHeight: 8rem
```
````

In `.mdx`, the same reference is a property: `<FileTree dataRef="comp-file-tree.md#example-project-tree" />`. `dataRef` is always a component property (a comment key or an MDX attribute), never a key inside the YAML block, because the host resolves it before the component parses its own data.

`dataRef` reuses data that is authored in some document. Data that belongs to no document, or that should have a history of its own, goes to the [asset store](doc_page_impl_asset.md) instead: the component block holds a reference (a fenced block in the language `asset`) in place of its data, and the host resolves it to the referenced version's text before the component sees its input. The two mechanisms are resolved by the same runtime boundary (`RegisteredComp`) and compose in one direction: an asset-backed component can carry a `dataRef`, since the reference is resolved first and the resolved text is normalized as authored data.

### Reference grammar

```text
dataRef = {document target}#{component id}

~root/a.md#tree        exact source path
./a.md#tree, ../a.md   relative to the referencing document
xx/a.md#tree           path suffix
a.md#tree              file name
@first/{itemId}#tree   first document of a side-panel item
#tree                  component in the referencing document
```

The document part uses the document-link grammar of [Navigation design](doc_page_impl_nav.md#link-recognition-and-target-resolution), resolved by the same function. The fragment, which selects a place in a link, selects a component here. A data reference reads data and does not navigate, so the referenced document must be collected in the source but does not need a side-panel item. A file-name or suffix target matching several documents uses the first match in source order and shows a warning listing all matches, like an ambiguous side-panel item.

### Resolution flow

```text
RegisteredComp: data.dataRef present?
  no  -> render the component as usual
  yes -> CompDataRefHost
           -> useCompDataRef(dataRef, sourcePath)
                -> DocStore.compDataRefLoad()   load + compile the referenced document
                -> DocStore.compDataRefQuery()  observable result
                     -> docTargetResolve()       shared with DocLink
                     -> componentQueryByPath()   shared with the part index
                     -> compInputNormalize()     the data the referenced component itself receives
           -> validate, then render the component with data.dataRefResolved
```

The referenced document is compiled through the normal `DocSourceStore.loadDoc()` cache. Compilation records every id-marked comment-block component of the document, which is the same lookup used to locate a hosted part index. The referenced data is normalized by `compInputNormalize()`, the function `RegisteredComp` uses for every invocation, so the reusing component sees exactly the `data` the referenced component itself receives (properties, `raw`, `lang`).

### Component interface

A component opts in by declaring the component types it accepts. A component that is referenced declares its own `componentType`:

```javascript
compDefine(FileTree, {
  componentType: 'fileTree',
  dataRefTypeList: ['fileTree'],
  placementList: ['mdx', 'commentBlock'],
})
```

After validation, the component receives its own data plus `data.dataRefResolved`:

```text
data.dataRefResolved = {
  target,          authored dataRef
  docPath,         source path of the referenced document
  componentId,     id of the referenced component
  compName,        authored tag name of the referenced component
  compId,          resolved registry id
  componentType,   declared type of the referenced definition
  data,            normalized data of the referenced component
}
```

How referenced and local data are combined belongs to the component. `FileTree` parses both with the same parser, uses the referenced data as the base, and lets local top-level keys override it; `tree` is replaced as a whole. A local block containing only a YAML comment is valid when `dataRef` is present. A local block containing only `annotations` keeps the referenced tree as its background and draws its own overlay above it (see [File tree annotations](#file-tree-annotations)).

A component that needs more than one reference, or a reference chosen by its own data, calls `useCompDataRef(target, { sourcePath: config.sourcePath })` from an observer component. The hook is exported from the package entry and returns the same result object as `DocStore.compDataRefQuery()` (`status`, `message`, `warning`, `componentType`, `data`, ...). The component is then responsible for its own type checks and messages.

### Errors and warnings

Problems are shown in place of the component, together with the authored `dataRef`, so the author sees the failure where it was written:

- the component definition declares no `dataRefTypeList` (legacy plain-function components cannot accept references either);
- `dataRef` is empty, not a string, or has no `#component-id`;
- the document is not found in the source;
- the document fails to compile, or the id is missing or duplicated in it;
- the referenced component is not registered;
- the referenced `componentType` is not in `dataRefTypeList`;
- a component references its own id.

While the referenced document is compiling, a neutral loading line replaces the component. An ambiguous document target shows a warning above the rendered component.

### Constraints

- Only comment-block components with an `id` can be referenced. MDX component properties are JavaScript expressions evaluated at render time, so they are not available before the referenced document is rendered.
- References are resolved one level deep. If the referenced component itself has a `dataRef`, its data is delivered unchanged, including that `dataRef`; the host does not follow chains. Likewise, a referenced component whose data is an asset reference delivers the reference text, not the asset text: an asset-backed block is not a `dataRef` source, both documents should reference the store.
- With `pruneSourceToSidePanel`, a statically authored `dataRef` keeps the referenced document in the deployed manifest without a side-panel item (see [Source pruning for deployment](doc_page_impl.md#source-pruning-for-deployment)). A `dataRef` written as an MDX expression is not discovered and is reported at build time.

## Text blocks and edit mode

The headings, paragraphs, and lists of the document body are rendered by explicit components in `comp-mdx/text/` (`headingTagCreate`, `ParagraphTag`, `listTagCreate`, mapped onto `h1`–`h6`, `p`, `ul`/`ol`/`li` by `buildMdxComps`), so these blocks have a home beside their default editors `HeadingEdit`, `ParagraphEdit`, `ListEdit`, and the fallback `BlockSourceEdit`; these editors are the built-in `source` edit mode of every block. A component with an editor of its own exposes it as an edit mode (`expose.editModeList`, [above](#view-modes-and-edit-modes)), exposes a `sourceDefaultCreate` for the insert menu ([Default source](#default-source)), and branches on `config.isEdit` (and on `config.edit.modeId` when it has several modes) to its `XxxEdit.jsx`. The edit contract, the naming rule, and the sharing of render code between `Xxx` and `XxxEdit` are specified in [In-place editing](doc_page_impl_edit.md#component-edit-mode); `Image` (mode `fields`) and `ImageGrid` (mode `images`) are the demonstrations in this folder.

An editor, built-in or custom, in whichever of its modes, must not move the page when it appears, nor when the author switches it to another mode ([every edit mode enters without moving the page](#view-modes-and-edit-modes), [the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)). The edit layer locks the wrapper of the block being edited to the height and margins the block had in view mode and lets the editor's content extend over the next block when it needs more room; for that to work, an editor keeps to these rules:

- **One in-flow root, the one the block renders as.** The editor renders the same render component (or the same element) the reading page renders, with the editable values in it, and nothing else in the flow. Everything that exists only for editing goes into `EditFloatingPanel`.
- **The wrapper owns the geometry.** The editor does not set a height, a min-height, or outer margins on its root to fit its content; the wrapper carries the margins and the height of the view mode. Inner spacing (padding, the margins between children) stays as in view mode.
- **The root paints a background.** The layer gives the root the page background so that, where it extends over the next block, it covers it; a root with a background of its own (a card, a code surface) keeps it, and a root that is transparent by design must not rely on seeing through to the page.
- **No layout from editing state.** Showing a field, a message, or an action in response to the author must not change the height of the root; it floats, or it replaces a value in place (`EditValueInline` keeps the exact box of the text it replaces).

`ImageEdit` and `ImageGridEdit` (`comp-mdx/image/`, `comp-mdx/image-grid/`) and `StockTableEdit` (`example_doc/comp-mdx/`) follow these rules and are the references for a new component editor. `ImageGridEdit` shows an editor whose in-flow root holds other components: every slot is an `Image` bound to the editor's draft (`onSourcePaste`), so a paste changes the draft and not the document, and the slot's remove button floats inside the slot.

## File tree annotations

A `FileTree` can draw annotations above its rows. The first annotation type is a right-angled arrow from one or more source nodes to one or more destination nodes, with optional text beside it:

```text
main.js     ●──╮
               │ reads at startup
config.yaml ◀──╯
```

```yaml
tree:
  - name: src/
    children:
      - name: main.js
        id: entry            # optional, a short stable name for references
  - name: config.yaml
annotationStyle:             # optional, shared style per annotation type
  arrow: { color: "#2563eb" }
annotations:
  - type: arrow              # default; the type decides the remaining keys
    from: entry              # one reference or a list
    to: [config.yaml]
    text: reads at startup
    lane: 0                  # optional; same lane = same vertical track
    style: { lineStyle: dashed }   # optional, overrides annotationStyle.arrow
```

A node reference is a node `id`; when no node has that id, it is read as a name path such as `src/main.js`, ignoring the trailing `/` of folder names. An endpoint can also be written as `{ node: entry }`, which leaves room for per-endpoint options. Every annotation has its own lane by default, in list order; annotations sharing a `lane` share one vertical track, and the author keeps them from overlapping.

Arrow style keys, all lengths in px: `color`, `textColor`, `lineWidth`, `lineStyle` (`solid` / `dashed` / `dotted`), `lineStyleCollapsed`, `cornerRadius`, `headShape` (`triangle` / `open` / `none`), `headSize`, `tailShape` (`dot` / `none`), `gap` (name to arrow end), `laneSpacing`, `textGap`, `textMaxWidth`. Defaults use the muted theme color, so arrows look like part of the tree.

**Layout.** The tree grid has three columns: name, gutter, description. The gutter is empty unless annotations exist; its width is the sum of lane widths, and a lane is as wide as its trunk spacing plus its widest text. Each endpoint gets a horizontal branch from the end of its name to the trunk of its lane; the text sits to the right of the trunk, centered on it. The gutter width depends only on text sizes, never on row positions, so the layout cannot oscillate.

**Collapsed folders.** An endpoint hidden in a collapsed folder is drawn at the outermost collapsed ancestor row, with the collapsed line style and a hollow marker, meaning "somewhere inside". Endpoints landing on the same row with the same role merge. When one row is both source and destination, the two branches move slightly apart, so an arrow whose ends all collapse into one folder becomes a small loop on that row; its text is hidden there, because it would cover the branches of other arrows on that row. The overlay reads open state from `FileTreeStore`, the same source the rows render from, so the arrows always match the displayed tree. While a folder is opening, endpoints stay inside the growing children clip instead of pointing at rows that are not visible yet.

**Responsibilities.**

```text
FileTreeStore          parses data; keeps annotations / annotationStyle as authored
FileTreeOverlayStore   annotation type registry, reference resolution, visible-row mapping,
                       measured geometry (source of truth), lanes, gutter width, shapes
FileTreeOverlayArrow.js  arrow type: grammar normalization, style defaults, geometry (pure)
FileTreeOverlay.jsx    measures the tree, renders shapes, labels, and warnings
FileTree               reserves the gutter, marks rows / names / clips with data attributes
```

`FileTreeOverlay` is a zero-size layer at the content origin of the tree, so it scrolls with the rows. Its SVG has a real size, the name column plus the gutter down to the last row, with a `viewBox` of the same size; the size comes from row geometry, never from the scroll size, so the drawing cannot enlarge the tree it measures. Measured positions are converted from on-screen px to css px by the on-screen scale of the tree, so CSS `zoom` or a scale transform on an ancestor does not shift the arrows away from the rows. A `ResizeObserver` watches the tree, every row, every children clip, and every label; any size change (container resize, font load, folder animation, data change) schedules one measurement per animation frame. The store ignores a measurement that is equal to the current one, then recomputes the shapes.

A new annotation type adds a `{ normalize, laneWidthGet, layout }` entry to `overlayTypeById` in `FileTreeOverlayStore.js` and a renderer to `shapeRenderByType` in `FileTreeOverlay.jsx`. Problems such as an unknown type, an unknown style key, or an unresolved reference are listed below the tree; every valid annotation still renders.
