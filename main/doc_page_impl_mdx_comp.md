<!-- Design of components available inside documents. Parent document: doc_page_impl.md -->

# MDX Components: Design

Components that authors can use inside md/mdx documents live under `built-in/comp-mdx/`, one folder per component family. They are ordinary registered components: `config.yaml` `compRegistry` maps a tag name to a component id, and the component definition in `compById` (created with `compDefine()`) provides the render component, how the registry boundary treats it, and what it exposes about itself ([What a component exposes](#what-a-component-exposes)). Registration, placements, and the common `{ data, config, onEvent }` interface are described in [Document Page: Design](doc_page_impl.md#component-registry). A doc page may bring components of its own, found in its component folders and mounted by the plugin ([Components of a doc page](#components-of-a-doc-page)).

```text
document  <!--renderComp=FileTree,id=x-->  or  <FileTree .../>
   -> compRegistry: tag name FileTree -> id common/FileTree
   -> compById: definition { CompRender, componentType, dataRefTypeList, placementList, dataBuild, expose }
   -> RegisteredComp: normalize input into { data, config, onEvent }
   -> render component
```

## What a component exposes

A definition says two kinds of things about a component. The first is how the registry boundary (`RegisteredComp`) treats it: where it may render (`placementList`), what it can be referenced as (`componentType`, `dataRefTypeList`), how its input is normalized (`dataBuild`), what it is told about its data (`isAssetAware`, `assetDependencyListGet`; [Components and the asset service layer](#components-and-the-asset-service-layer)), and which of the files its data names it offers for deletion with a block of it (`deleteFileListGet(data) -> [{ path, reason? }]`, an opt-in capability the edit layer asks for without knowing the component: [Deleting blocks](doc_page_impl_block_ops.md#deleting-blocks); `Image` and `ImageGrid` offer their image files). The second is what the component tells the page about itself, for the page to offer to readers and authors: that it is read-only, in which ways it can be displayed and edited, what its icon is, how a new block of it starts, which config keys it has. These are the component's **exposure**, the `expose` option of `compDefine()`:

```text
compDefine(Xxx, {
  placementList, componentType, dataRefTypeList, dataBuild,     how the registry boundary treats it
  isAssetAware, assetDependencyListGet, deleteFileListGet,
  expose: {                                                     what it tells the page about itself
    meta:          { label, description, isReadOnly, isEditSourceAccepted, isInsertCommon,
                     isEditEnterButtonOnly, isAssetOnly, isEditAssetAccepted, isNotInDoc, isEditSlashEnabled,
                     assetSaveMode, configDefineList, ... }
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
| `isEditEnterButtonOnly` | `false` | a block of it enters edit mode only through an explicit control: the toolbar's Edit button, or an edit mode chosen in the mode menu. A click on the block does not enter it even when `EditBlockEnterMode` is `click`, and a focus shift from the neighbor block (the arrow keys) stops before it. For a component whose view takes clicks itself (selecting cells of a sheet), where entering by click would turn every interaction into an edit session |
| `isAssetOnly` | `false` | its data lives in the asset service layer only and is never written inline in a document: a block of it is always an asset reference ([Asset-only and not-in-doc](#asset-only-and-not-in-doc)) |
| `isEditAssetAccepted` | `false` | its own edit modes also edit the data of an asset reference, at the head of an object in a writable store, saving into the object ([Asset-backed component drafts](doc_page_impl_edit.md#asset-backed-component-drafts)). An opt-in, not a restriction: inline data stays displayed, edited and inserted as before. Without it (and without `isAssetOnly`) a block whose data is an asset is edited as source only. The component declares `isAssetAware` too, to receive the reference and the version's metadata. `DiagramER` and `DiagramDataverseEntity` declare it |
| `isNotInDoc` | `false` | it cannot be a block of a document at all, because it renders elsewhere (a side-panel item); the insert menu does not offer it and a block of it shows an error ([Asset-only and not-in-doc](#asset-only-and-not-in-doc)) |
| `isEditSlashEnabled` | `false` | a block of it offers the [slash mode](doc_page_impl_edit_slash.md) while it is edited as source: `/` opens the menu of slash actions (`/link …`). The default editors of paragraphs and lists (`Paragraph`, `List`) declare it; a component whose source is prose can too ([Which blocks offer it](doc_page_impl_edit_slash.md#which-blocks-offer-it)) |
| `assetSaveMode` | — | `inPlace` or `newVersion`: the save mode an asset object gets when the page creates it for a block of this component (from the insert menu, or by **to asset**). Without it the object has no save mode, which saves in place ([Save modes](doc_page_impl_asset.md#save-modes)). Only the creation reads it; the object's own mode decides every later save |
| `configDefineList` | `[]` | the shape of its component-level config: which keys exist, their types, defaults, descriptions. Only the shape; the values come from the config layers and the document levels, and reach the component as `config.compConfig` ([Component-level config](doc_page_impl_config.md#component-level-config)) |

A component may add keys of its own to `meta`; they are kept beside the standard ones.

### Asset-only and not-in-doc

Two keys of `meta` restrict where a component's blocks can be, and both are enforced at the registry boundary (`RegisteredComp`), so every way a block reaches the page (comment block, MDX element, side panel, preview) gets the same answer:

```text
RegisteredComp(placement, definition)
  meta.isNotInDoc  and placement is a document one (mdx, commentBlock)
      -> error "cannot be used in a document"         checked before placementList,
                                                       so this is the message, not "not allowed here"
  placement not in placementList  -> error, as for any component
  meta.isAssetOnly and the data is not from an asset (configRuntime.assetInfo.isFromAsset)
      -> error: the data must be in the asset service layer; "to asset" moves it there
```

**Not-in-doc** marks a component that is rendered by something other than a document: `SidePanelItem` (and its demo) draws the items of the side panel. The insert menu leaves such components out (`edit-template.js`).

**Asset-only** marks a component whose data is too large or too opaque to be part of a document's text, and has a history of its own: a workbook. Its `sourceDefaultCreate` still returns `{ lang, raw }`, but that is the data of a new *asset object*, not of a fenced block; `{ text }` is refused as a wrong shape when the factory is called (`compSourceDefaultGet`), since it could only be written inline. The edit layer builds on this ([Asset-only components](doc_page_impl_edit.md#asset-only-components)): the insert menu creates the object and then writes the reference block; the component's own edit modes edit the referenced data and save into the object; the block's lines are the reference. An asset-only block whose data is inline anyway (written by hand) renders the error, and its declared edit modes are greyed out with the reason, while the toolbar's **to asset** stays available to repair it. An asset-only component declares `isAssetAware` too, since it needs the reference (and the version's metadata) to save.

The dashboards of [service instances](doc_page_impl_service.md#dashboards-in-the-registry) are asset-only components the page defines itself, one per `service/{templateName}/{dashboardId}` id (`componentType: 'serviceDashboard'`, `meta.isServiceDashboard`), found by `compDefinitionGet` without a `compRegistry` entry. Their object holds the instance a dashboard shows and the dashboard's own state, saved in place by the dashboard while it is read; they declare no edit mode and no `source` mode, since there is nothing of them to edit in a session.

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
  … unless X.meta.isEditAssetAccepted
                                 -> the declared modes, editing the referenced data, when the block
                                    reads the head of an object in a writable store; greyed out with
                                    the reason otherwise (a pinned version, a read-only store)
a block of an asset-only X       -> the declared modes, editing the referenced data, when the block
                                    reads the head of an object in a writable store; greyed out with
                                    the reason otherwise (inline data, a pinned version, a read-only
                                    store). 'source' (the reference) only if X accepts it
```

A session of the edit layer is therefore always *a block in one edit mode* (`session.editModeId`). The Edit button and a click open the block in its default mode; the mode menu opens it in the chosen one, reported as the same `editBlockEnterRequest` with `editModeId`; choosing another mode while the block is open saves the session and opens the block again in it. The component's editor learns its mode as `config.edit.modeId` and branches on it when it has more than one; a component with a single mode of its own can keep branching on `config.isEdit` alone. How the editor is chosen, what it receives and reports are specified in [In-place editing](doc_page_impl_edit.md#component-edit-mode).

**Every edit mode enters without moving the page.** Whichever mode a block is opened in, declared by the component or the built-in `source`, and whether it is entered from view mode or from another edit mode, the height of the block and everything below it stay where they were: the mode makes the block's own content editable in place and floats everything else, exactly as the built-in `source` mode does. This is a convention of every mode a component declares, not a property of one editor; a mode that needs more room than the view (a form, a list of fields, a preview) puts that room into its floating panel or lets it extend over the next block, never into the flow. The rules an editor keeps for this are in [Text blocks and edit mode](#text-blocks-and-edit-mode), and the rule itself is [the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule).

The menu is offered where there is something to choose: a component block with more than one view mode or more than one edit mode. Its entries are greyed out when they cannot be chosen now (a write is pending, the data is an asset), each with its reason as its tooltip; a read-only component lists no edit mode and says so. The dropdown is the `Menu` of `@wwf971/react-comp-misc`, which the host injects as `config.components.Menu` like the settings panel; without it the button is not rendered.

Among the components of this folder, `Image` exposes the edit mode `fields` ([Text blocks and edit mode](#text-blocks-and-edit-mode)) and `ImageGrid` the edit mode `images`: a grid clicked in edit mode takes pastes into its slots and adds or removes slots, and its yaml is the built-in `source` mode one entry away, instead of the yaml being what a click shows. `DiagramER` and `DiagramDataverseEntity` expose `visual` beside `source` (`diagram-er-expose.js`, which also holds their starters), with `isEditAssetAccepted` and `isEditEnterButtonOnly`: the cells, settings and handles of the cards, and the nodes and connections of a diagram, are edited on the canvas, for inline yaml and for an unlocked asset head alike; a pinned reference or a read-only store greys the mode out. The interaction contract of that editor (cells, Escape in two steps, the save target) is **Card Editing** in [comp_db_vis.md](../built-in/comp-mdx/diagram/diagram-er/comp_db_vis.md#card-editing). `DiagramPowerAutomate` and `DiagramBusinessRule` are `DiagramER` registered twice more with other starters and labels ([Power Platform Resource Nodes](../built-in/comp-mdx/diagram/diagram-er/comp_db_vis.md#power-platform-resource-nodes)): a design of a flow of Power Automate steps, of a Dataverse business rule, drawn as cards of the same graph; both are listed in `registry-source-dependency.js` with the diagram's dependency collector. The demo `StockTable` of `example_doc/` exposes two view modes (`table`, `summary`) and the edit mode `cells`; the demo `TagListAllDemo` is read-only.

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

The returned shape is checked when the factory is called; a factory that throws or returns a wrong shape is reported in the console and its component left out of the menu, so one faulty component does not take the menu with it. A component without a factory cannot be inserted from the menu, only written by hand: the components a document writes only inside another one (`Tab`, `Step`, `Accordion`, `File`, `Folder`), markers of the next node (`Anchor`), inline components (`Tag`, `DocLinkInline`), the parts other components render through the registry (`FileIcon`, the cells, rows and header controls of the hierarchies), and what is not document content (`SidePanelItem`, `TagLabel`, the editors of the edit layer). A component declared `isNotInDoc` is left out of the menu even with a factory.

## Component styles

A component family keeps its stylesheet in its folder (`Image.css`, `TableHierarchy.css`), imported by the component, with class names of its own. The controls of its editor and panels — buttons, badges, hints, error messages, spinners — use the shared classes of the page (`.doc-button`, `.doc-button-icon`, `.doc-error`, `.doc-spin`, ...) and add a class of their own only for what differs, such as a size; a look the component needs that another component already has becomes a shared class instead of a copy. The shared classes, where they live, and how they win over Tailwind and lose to a component's own rules: [Shared styles](doc_page_impl.md#shared-styles).

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
| `DiagramER`, `DiagramPowerAutomate`, `DiagramBusinessRule` | `diagram-er/` | `DocDiagramER` |
| `DiagramDataverseEntity` | `diagram-db-tabe/` | |
| `ExcelUniver` | `excel-univer/` | |
| `BlockSimple`, `Block` | `block-simple/` | |
| `BlockMdx` | `block-mdx/` | |
| `Tag`, `TagLabel`, `TagOverview` | `tag/` | |
| `Anchor` | `anchor/` | |
| `BlockQA` | `block-qa/` | |
| `FileDownload`, `FileIcon` | `file-download/` | |
| `TableHierarchy`, `TextInfoCell`, `TableCapabilityCell` | `table-hierarchy/` | |
| `TestCaseTable` | `test-case-table/` | |
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

`SwitchView` shows the same data through several block components, one per view, rendered in the placement `commentBlock`. Its build-time collector hands every view to the collector of its component, so links in views that are not shown are still discovered; `BlockQA` collects its Markdown questions and answers. `TestCaseTable` is a test specification drawn by the view of `TableHierarchy` (`TableHierarchyView`, with a `cellRender` for its confirmation cells), so grouping and the registered cells are the hierarchy's; its collector names the evidence document of every recorded result (`comp_test_case_table.md`). `FileDownload` names its file as the dependency of an asset made from its data, like the `src` of an `Image`. `ProxyConnectionDiagram` is a fixed diagram, not driven by data: the text of its block is only what a plain Markdown viewer shows. The usage of each component is described beside it (`comp_block_qa.md`, `comp_table_hierarchy.md`, `comp_list_hierarchy.md`, `comp_switch_view.md`).

Some components read host settings from `config`, supplied by the application through `DocPageMdx` `config.compConfigHost` (see [Component registry](doc_page_impl.md#component-registry)): `Image`, `ImageGrid` and `FileDownload` resolve `src` through `assetUrlGet`, `DiagramMermaid` loads Mermaid through `mermaidLoad` and resolves lane icons through `assetUrlGet`, and `ExcelUniver` loads Univer through `univerLoad`. The block components, `BlockQA` and `MultiLang` receive the shared `MdxRenderer` from their package registry definitions, so nested Markdown has the link, math and component behavior of the document body.

Documents and consumer code written with the old names keep working:

- Each component module exports both names, for example `export { FileTree, FileTree as DocFileTree }`. `IndexData.js` also keeps `docIndexLanguageListGet` and `docIndexStructuredDataGet`.
- The package registry keeps the old component ids (`common/DocFileTree`, `common/DocIndex`, `common/DocMultiLang`, `common/DocImage`, `common/DocImageGrid`, `common/DocDiagramText`, `common/DocDiagramMermaid`) as aliases of the new definitions, so existing consumer `compRegistry` entries still resolve.
- The demo `config.yaml` maps both tag names to the same id.
- Code that recognizes a component by tag name before the registry is involved accepts both names: the multilingual heading marker and compile callbacks (`multiLangCompNameList` in `MultiLangData.js`), and the build-time attachment finders for `Image`, `ImageGrid`, and `DiagramMermaid`. Consumer callbacks keyed by tag name, such as `compile.languageListGetByComponent`, must list every tag name in use.

`DocLink`, `DocLinkInline`, and `DocComp` keep their names. In `DocLink`, "Doc" means "link to a document", as opposed to `SourceLink`; `DocLink` and `DocComp` are also element names emitted by the remark plugins that custom recognizers rely on.

## Components of a doc page

A doc page carries the components its documents use, so that a doc page which needs a component of its own (a demonstration, a domain-specific block) is included by another doc page or deployed alone without touching the host's registry or `config.yaml`. The plugin finds them by the [doc page folder convention](doc_page_impl_dir.md): the folder `comp-mdx/` of the doc page folder is its component folder, or the folders named by `.doc-page/comp.yaml` (`folderList: [../comp-mdx, ../widgets]`, paths relative to the file); the entry may say `comp: { file }` for another config file, or `comp: false` for none, like `asset` and `service`. The component folders are code, never documents: whatever source rule collects the folder around them, their files are not in the file manifest nor in the folder manifest, and a change in them is handled by vite's own hot module replacement, not by a reload of the page ([the folders a doc page keeps out by convention](doc_page_impl_source.md#the-folders-a-doc-page-keeps-out-by-convention)).

Inside a component folder, a manifest `comp.yaml` describes the components: one at the folder root listing several, and any number in its groups, folders by function at any depth (`comp-mdx/{group}/…/comp.yaml`, [Groups](doc_page_impl_dir.md#groups-in-a-component-or-template-folder)); every manifest found is read, a folder before the folders inside it, `node_modules/`, `dist/` and dot folders skipped. Its grammar (`plugin/doc-comp-config.ts`):

```yaml
compList:
  - tagName: StockTable                   # the tag documents write
    id: specific/StockTable               # the registry id; default {docPageAlias}/{tagName}
    entry: ./StockTable.jsx               # the module, relative to the manifest
    export: StockTable                    # its export (default: the tag name): a compDefine()
                                          #   definition, or a React component
    defineOptionsExport: stockTableDefineOptions
                                          # optional: an export of the same module holding the
                                          #   options of compDefine(Comp, options) when the export
                                          #   is a plain component (placementList, expose, dataBuild...)
```

A mapping without `compList` is one entry. `tagName` is a `compRegistry` entry: a built-in name such as `SidePanelItem` replaces the default, exactly as a `compRegistry` entry of `config.yaml` does. Every problem of a manifest (a tag name that is not an identifier, a module not found, an unknown key, a tag name or an id declared twice) is reported with the file and the place under the prefix `[doc-comp]` and skips that entry, never the page; the manifest files and `.doc-page/comp.yaml` are configuration, so a change, an addition or a removal regenerates the manifest of the page. The exposure of a component of a doc page lives beside the component (an exported `xxxDefineOptions` of its module, or a small `xxx-define.js` next to it), not in the package's `registry-expose.js`.

**Mounting.** The virtual module `virtual:doc-source` imports every module a manifest names as a static import, so a build bundles it and the development server hot-replaces it, and exports the mounts as `docCompMountList: [{ docPageAlias, tagName, id, export, defineOptionsExport, entryFile, module }]`, in loading order of the doc pages (root ones, included ones, temporary mounts). The host hands the list to `DocPageMdx` as `data.compMountList` (it is data of the doc pages, like the manifests, not host policy; `main.jsx` passes `docSource.docCompMountList`), and `compMountByIdBuild` (`comp-doc/registry/comp-mount.js`) turns it into registry definitions keyed by id: the export is a definition made with `compDefine()` and is taken as it is, or a React component, defined with the options of `defineOptionsExport` (none: a plain definition); a missing export is reported (`[doc-comp]`) and left out. The registry of the page is then the package's `compById`, the mounted definitions over it, and the host's `config.compById` over both.

**Precedence of tag names.** `compIdResolve()` stays the single place a name becomes an id, and it reads `configDoc.compRegistry`: the plugin writes the tag names of the mounts into that mapping over the entries of `config.yaml`, so a doc page's own tag name wins over `config.yaml` for that name, and the entries `config.yaml` alone declares stay. Two doc pages declaring one tag name (or one id): the first loaded wins, with a warning. The dashboards of service instances are still resolved by their id alone ([Dashboards in the registry](doc_page_impl_service.md#dashboards-in-the-registry)).

The demonstration follows the convention, its components grouped: `example_doc/comp-mdx/comp.yaml` mounts `DemoCounter`, `TagListAllDemo`, `CompStateListDemo`, `DocConfigDemo`; `panel/comp.yaml` the side-panel item hook `SidePanelItemDemo` under the built-in name `SidePanelItem`, and `SourceLink`; `table/stock-table/comp.yaml` (a group in a group) `StockTable`; all under the ids `specific/...` the documents and the build-time link collector (`registry-source-dependency.js`, keyed by id) know. `SourceLink` is a package component (`built-in/comp-mdx/source-link/`) that needs the panel component framing its popup, which is host configuration: the package does not register it; the demonstration binds it to its `TextPanelDemo` in `example_doc/comp-mdx/panel/SourceLinkDemo.js` (re-exporting the component with its `sourceLinkDefineOptions`) and mounts it from there. `TextPanelDemo` itself is host configuration (`compConfigHost.panelComponent`), imported by `main.jsx`, not a document component. `main/config.yaml` `compRegistry` names none of them.

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

`dataRef` reuses data that is authored in some document. Data that belongs to no document, or that should have a history of its own, goes to the [asset service layer](doc_page_impl_asset.md) instead: the component block holds a reference (a fenced block in the language `asset`) in place of its data, and the host resolves it to the referenced version's text before the component sees its input. The two mechanisms are resolved by the same runtime boundary (`RegisteredComp`) and compose in one direction: an asset-backed component can carry a `dataRef`, since the reference is resolved first and the resolved text is normalized as authored data.

### Reference grammar

```text
dataRef = {document target}#{component id}

~root/a.md#tree        source path (~page:root/... in another doc page)
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

## Components and the asset service layer

A component's data may live in the [asset service layer](doc_page_impl_asset.md) instead of the document: the block holds a reference in place of its data, and the runtime boundary resolves it to the text of the referenced version before the component sees its input ([Resolution](doc_page_impl_asset.md#resolution-the-runtime-boundary)). How much a component has to do with the store is its own choice, in three degrees:

```text
unaware      nothing declared (the default)    any component works with a reference block the day it is
                                               registered, and never learns where its data came from
aware        isAssetAware                      knows its data is an asset (config.assetInfo), replaces it
             (assetDependencyListGet)          by request, asks whether it changed, declares what it depends on
asset-only   meta.isAssetOnly, isAssetAware    its data is never inline: a block of it is always a reference,
                                               and its own edit modes edit the object (#asset-only-and-not-in-doc)
```

The page and the files then keep a block and its object together as far as they can: the object records the component it is for, the page knows which blocks read which object, and it expects the two to come apart while it is not looking. Not every object is a component's data: the store is a general storage of versioned bytes ([Stores, objects, versions](doc_page_impl_asset.md#stores-objects-versions)), and an object may be an image file, notes, or the data of a tool that is not a block; the declarations below concern the objects that are, and the page reads nothing wrong into one that is not.

### Component awareness

Not knowing where the data came from is the right default, and the wrong answer for a component that writes its data back. An Image that receives a pasted image must put the new `src` somewhere: into the lines of the document when the data is inline, into the head of the object when the data is an asset; and it should say which it is about to do. So a component may opt in. A definition registered with `isAssetAware: true` (`compDefine`) receives `config.assetInfo` on every render:

```text
assetInfo
  isFromAsset: false                         inline data (and the value in every other placement)
  isFromAsset: true,                         data of an asset version, set by CompAssetHost:
    store, objectId, name,                     the object
    versionIdRef,                              what the reference asks for: 'head', or a pinned version id
    versionId, versionIdHead, isHead,          the version read, and whether it is the head
    hash,                                      the hash of the bytes read
    saveMode, isLocked                         what a write to it would do, and whether it is allowed
    versionMetadata                            the metadata of the version read, {} without
                                               (doc_page_impl_asset.md#version-metadata)
```

The same information travels with the component's events as `source.asset`, so a store handling an event knows whether the block it concerns is a reference. A component that is not aware receives no `assetInfo` key and nothing changes for it.

What the component does with the knowledge is one request, not a write of its own: it emits `dataReplaceRequest { raw }` with the complete new data text ([events of the edit layer](doc_page_impl_event.md)), and `DocEditStore.dataReplaceApply` decides by the block the component is rendered in (`config.blockIndex`, which the edit body gives every block through `DocEditBlockContext`): a reference block updates the object's head (`objectUpdate`, by its save mode, with the dependencies derived from the new data), an inline block is rewritten with the new data as its fenced content (`componentBlockTextBuild`, one block-replace operation). The component thus edits its data the same way in both cases and never calls the store or the edit api; `assetInfo` only lets it tell the author what will happen (`Image` writes "replaces the head of asset …" into its confirmation). The dependencies of an asset version come from the same definition: `assetDependencyListGet(data)` returns the paths the data names ([Dependencies](doc_page_impl_asset.md#dependencies)), the page resolves them against the document, and every write of the data (moving a block into the store, a data replacement) carries the list.

A component whose data has a **managed part** goes one step further: it does not hand over the whole new text, because part of it must not be written by hand. `TestCaseTable` keeps the result history of its cells that way (`comp-mdx/test-case-table/comp_test_case_table.md`): a result is a record with an operator, a time and an evidence document, appended and never edited, so the component reports `assetTestCaseResultRequest { caseId, testerId, result, operator, evidence?, timeTimezone, hashBase }` and the asset domain records it on the object through a route of its own, where the server writes the time and the id and resolves the evidence against the document ([the store api](doc_page_impl_asset.md#the-store-api)). Such a request is asset-only by nature (the record needs an object to live on; inline data cannot record), it is based on the hash the component read (`hashBase`, so a record by somebody else meanwhile is a conflict shown rather than written over), and the generic head write refuses a text that changes the managed part, so the asset panel's editor cannot rewrite it either. The document is never written for it.

### Changes made by others

An object can change without the component doing anything: another block reading it saves, its panel moves the head, an editor rewrites a file. Every block reading the object re-renders with the change the page hears of (a write through the page replaces the loaded object; a change of the folder is pushed by the development server as `doc-asset-change`), so a component that only renders its data needs nothing. A component that holds something derived from its data (a draft, an engine instance) and wants to be sure before it acts reports `assetRefreshRequest` (no data, routed to the asset domain, `DocAssetStore.eventHandle`): the object is read again from the store, every block reading it re-renders with what was read, and the answer says what the component's reference resolves to now, `{ versionIdHead, versionId, hash, isChanged }`, `isChanged` comparing with what it read (`assetInfo.versionId`, `assetInfo.hash`). A component whose data is not an asset gets code -1.

TODO: a subscription, where a component registers for the changes of its object and is told as they happen (a websocket-like feed) instead of asking. It needs the event layer to deliver events *to* components, a routing and subscription system of page events that does not exist yet ([event layer: subscriptions](doc_page_impl_event.md#extending-the-layer)); until then the re-render and the refresh request are the two ways.

### The component an object is for

An object made from a block's data records, in its metadata, the component it is data for: `component: { name }`, the tag name of the block ([Objects for components](doc_page_impl_asset.md#objects-for-components)). The page writes it when it creates an object for a block (**to asset**, an asset-only block from the insert menu), and the panel shows and changes it. It is a record for recovering what was lost, not a rule: when the block is gone, the declaration is what tells an orphan (the data of an Image whose block was deleted) from an object of another purpose, and says what block would read it again. Nothing checks it: a block of another component may read the object (the panel notes the difference), and a component is not held to objects that name it.

The name is the one way to identify the component for now. A later form may be more rigorous: the registry id with a version of the component's data format, so that a reader can tell whether old data still fits, or an id of the component independent of the tag names a project registers it under. A further step is a **data contract** shared by several component types (an `Image` and a slot of an `ImageGrid` read the same mapping), declared by the object in place of one component.

### Several blocks, one object

Blocks may share an object: two `Image` blocks showing one picture at two sizes, a table pinned to a version beside the same table reading the head. That several component types share one object's data is the future option of a data contract (above); today sharing is between blocks of one component.

The asset service layer therefore keeps a **usage index**: for every block whose data is a reference, where it is and what it reads ([Usage](doc_page_impl_asset.md#usage)). Where a block is uses the block identity of the page, the document and the line of its marker comment, with the `Anchor` id declared before the block when there is one; that is the place format of the navigation layer ([Places in a document](doc_page_impl_nav.md#places-in-a-document)), so a place is also a link. The index is read from every document when the page starts and follows the documents as they change; it can be behind, since not every change of a document reaches the page when it happens, and a document read again is right. From the index come the backlinks of an object in its asset panel (each block, whether it follows the head or is pinned, a link to it, and a read-again button that confirms it), the use counts in its version table, and the orphans.

### What the page anticipates

The page does not own the file system: documents and asset folders are files, changed by editors, git, and scripts, also while the page is not running, and nothing makes a change of a document and a change of an object one step. So the page expects the two ways a block and its data come apart, and shows them rather than preventing them:

- **a block removed without its object**: the object still declares its component and no block references it, an **orphan**. Deleting a block whose data is an asset asks whether the object goes with it ([deleting a block](doc_page_impl_edit.md#floating-controls)); an object kept then, or left behind by a change outside the page, is listed in the settings panel's asset tab, where its panel opens.
- **an object gone or broken under a block**: the reference names an object, a name, or a version the store does not have (a folder deleted or renamed, a version deleted). The block shows the error in place of the component, as every reference that cannot be resolved does, and the same tab lists these references.

Two rules that could look natural are deliberately **not** modeled:

- no policy on sharing: the page neither forbids several blocks from reading one object nor requires an object to have one block;
- no owner: an object has no host block that owns it, decides for the other blocks, or goes away with it.

Both would be rules the page could only keep while it is the one writing. A block copied by hand, a document restored by git, an object folder copied to another project would break them without the page knowing, and every rule would then need a handling of its violation, which the page cannot do on files it does not control. The declaration and the usage index record what is, and the decisions stay with the person, with the facts in front of them: the delete question names the object and the other blocks that use it.

## Text blocks and edit mode

The headings, paragraphs, and lists of the document body are rendered by explicit components in `comp-mdx/text/` (`headingTagCreate`, `ParagraphTag`, `listTagCreate`, mapped onto `h1`–`h6`, `p`, `ul`/`ol`/`li` by `buildMdxComps`), so these blocks have a home beside their default editors `HeadingEdit`, `ParagraphEdit`, `ListEdit`, and the fallback `BlockSourceEdit`; these editors are the built-in `source` edit mode of every block. A component with an editor of its own exposes it as an edit mode (`expose.editModeList`, [above](#view-modes-and-edit-modes)), exposes a `sourceDefaultCreate` for the insert menu ([Default source](#default-source)), and branches on `config.isEdit` (and on `config.edit.modeId` when it has several modes) to its `XxxEdit.jsx`. The edit contract, the naming rule, and the sharing of render code between `Xxx` and `XxxEdit` are specified in [In-place editing](doc_page_impl_edit.md#component-edit-mode); `Image` (mode `fields`) and `ImageGrid` (mode `images`) are the demonstrations in this folder.

An editor, built-in or custom, in whichever of its modes, must not move the page when it appears, nor when the author switches it to another mode ([every edit mode enters without moving the page](#view-modes-and-edit-modes), [the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule)). The edit layer locks the wrapper of the block being edited to the height and margins the block had in view mode and lets the editor's content extend over the next block when it needs more room; for that to work, an editor keeps to these rules:

- **One in-flow root, the one the block renders as.** The editor renders the same render component (or the same element) the reading page renders, with the editable values in it, and nothing else in the flow. Everything that exists only for editing goes into `EditFloatingPanel`.
- **The wrapper owns the geometry.** The editor does not set a height, a min-height, or outer margins on its root to fit its content; the wrapper carries the margins and the height of the view mode. Inner spacing (padding, the margins between children) stays as in view mode.
- **The root paints a background.** The layer gives the root the page background so that, where it extends over the next block, it covers it; a root with a background of its own (a card, a code surface) keeps it, and a root that is transparent by design must not rely on seeing through to the page.
- **No layout from editing state.** Showing a field, a message, or an action in response to the author must not change the height of the root; it floats, or it replaces a value in place (`EditValueInline` keeps the exact box of the text it replaces).
- **The lines keep their rhythm (highly recommended).** Inside the block nothing should jump either: where the editor shows the same lines as the view (source text of a paragraph or a list, a caption, a cell), each line stays at the height it had in view mode. The view must not make a line taller than the line height (an inline element with a smaller font and the inherited line height does: inline code is marked `doc-code-inline` and set to `line-height: 1`), and gaps that the rendering puts between lines (between list items) are given to the matching source lines (`EditSourceSurface` in line mode, as `ListEdit` uses it). The details are rule 5 of [the no-jitter rule](doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule).

A component block that benefits from more room (a spreadsheet, a wide table) can also be opened in the page's block popup and edited there: the component renders both modes inside `BlockPopupSurface`, puts its margins on the surface's outer box instead of its own root, and fills the dialog when told `isInPopup` ([Block popup](doc_page_impl_popup.md#opting-in)). `ExcelUniver` and `StockTable` do.

`ImageEdit` and `ImageGridEdit` (`comp-mdx/media/image/image/`, `comp-mdx/media/image/image-grid/`) and `StockTableEdit` (`example_doc/comp-mdx/`) follow these rules and are the references for a new component editor. `ImageGridEdit` shows an editor whose in-flow root holds other components: every slot is an `Image` bound to the editor's draft (`onSourcePaste`), so a paste changes the draft and not the document, and the slot's remove button floats inside the slot.

## ExcelUniver

`ExcelUniver` (`comp-mdx/media/excel-univer/`) shows an Excel-style workbook drawn by [Univer](https://univer.ai) (`@univerjs/presets` with the sheets-core preset). It is the asset-only component of the package: its data is the workbook snapshot of Univer (`IWorkbookData`, as `workbook.save()` returns it) in JSON, kept as an asset object, and its block is always a reference. The component declares `isAssetOnly`, `isAssetAware`, `isEditSourceAccepted: false` (a workbook is not edited as JSON by hand), `isEditEnterButtonOnly` (a click on the sheet selects cells; only the Edit button opens the editor) and `assetSaveMode: 'inPlace'` (an edit rewrites the head; the store keeps the previous files as `.bak`), and one edit mode, `sheet`. It is allowed in the placement `commentBlock` only.

**Loading.** Univer is large and only some documents use it, so the package does not import it: the host passes `config.compConfigHost.univerLoad`, a function returning the module of `frontend/src/univer-load.js` (`createUniver`, the preset, the locale, `CommandType`, the engine version `univerVersion`, and its css). The demo loads it with a dynamic `import()`, so it is a chunk of its own, fetched by the first sheet on a page and shared by the rest. Without `univerLoad` the block shows a message. The Univer packages are dependencies of the host (the project whose `node_modules` the loader resolves from), not of the document package.

**An instance and its retirement.** `ExcelUniverSheet` mounts one Univer instance per workbook text and mode, into a mount element of its own that it creates inside its box; React renders nothing inside the mount element. A new text or mode retires the instance: its listeners are disposed and its mount element is removed from the page at once, so the next instance never shares a container with it, and the instance itself is disposed after the commit that retired it. Univer unmounts its own React root when disposed, and doing that inside a React commit (an effect cleanup) makes React warn about unmounting a root while rendering. Each instance is disposed through its own closure, so quick changes never dispose the instance that replaced it. A change of the height (the block popup) does not remount it.

**Data and metadata.** What the component reads and writes:

```text
asset version  {versionId}.json            the workbook (IWorkbookData)
               {versionId}.metadata.yaml   engine: univer
                                           engineVersion: 1.1.0      Univer that last wrote it
                                           view: { sheetId, range,   what view mode shows;
                                                   isReadOnlyWarningShown }
                                                                     no sheetId: the first sheet,
                                                                     no range: the whole sheet,
                                                                     isReadOnlyWarningShown: see view mode
```

The metadata reaches the component as `config.assetInfo.versionMetadata` ([Version metadata](doc_page_impl_asset.md#version-metadata)). The range is A1 notation (`A1:F6`, or one cell); it is stored as written by the edit panel and parsed when rendered, so an invalid one shows a message rather than a wrong sheet.

**View mode.** The sheet is shown without header, toolbar, formula bar, sheet tabs (footer) and context menu. The component builds a copy of the workbook for display (`excelUniverViewWorkbookBuild`): the view sheet first in the order, its scroll at the top left, and every row and column outside the range hidden; the block's height is the height of the visible rows (all used rows, within limits, for a whole sheet), so the page reserves the right room and a range shows without inner scrolling. The workbook is made read-only by Univer's permission (`setReadOnly`), and in addition every command that would change it is canceled before it runs (`BeforeCommandExecute`: a mutation that is not formula bookkeeping), so selection, copying, and scrolling work while no value or style can change. An attempt to change the sheet (a double click on a cell) does nothing: Univer's dialog saying the sheet cannot be edited is turned off (`setPermissionDialogVisible(false)`), unless the version's metadata asks for it with `view.isReadOnlyWarningShown: true`. A save from the editor keeps that key, and any other key of `view` it does not set.

**Edit mode `sheet`.** `ExcelUniverEdit` renders the full Univer UI in the block (at least `EDIT_HEIGHT_MIN` high) on the head data, and an `EditFloatingPanel` for the view range: a range field (`EditValueInline`, empty meaning the whole sheet) on the active sheet, **Use selection** (the active range of Univer) and **Whole sheet**. Every change of the workbook (a mutation, coalesced) and of the range is reported as `editDraftChange` with `{ raw, versionMetadata }`; the edit layer saves both into the object when the session ends ([Asset-only components](doc_page_impl_edit.md#asset-only-components)), writing `engineVersion` of the running Univer. Univer handles Escape and Ctrl/⌘ + Enter itself (the cell editor), so the editor keeps them from reaching the block; the panel's **Save** and **Cancel** end the session. Univer's menus and dialogs are portaled into `document.body`, outside the block; while the editor is open it marks the nodes Univer adds there as edit popups (`EDIT_POPUP_CLASS`), so a click in them is not a click outside the block. Univer keeps the text of an open cell editor out of the workbook until the cell is closed, so the editor registers a step that every save awaits (`config.edit.submitPrepareSet`, [completing the draft](doc_page_impl_edit.md#the-editor-contract)): an open cell is closed with its value (`endEditingAsync(true)`), the workbook is saved and reported, and only then is the draft written; a value Univer refuses keeps the session open with a message.

**Popup.** Both modes render inside `BlockPopupSurface` ([Block popup](doc_page_impl_popup.md)): the sheet opens in a dialog, maximizes, and switches between View and Edit there, with the view-range panel and Save / Cancel in the dialog's header. The same engine instance moves into the dialog and back, so the selection and an unsaved draft stay. The outer box of the block (`.doc-mdx-excel-univer-shell`) carries the block's margins and the sheet's own box has none, so the sheet sits flush in the dialog and the geometry lock of an edit session measures the block from the outer box; in the dialog the sheet fills it (height `100%`).

**State.** What the component keeps beyond the workbook lives in its state object of the [component state service layer](doc_page_impl_mdx_comp_state.md), keyed by the asset object, so it outlives the engine instance and is shared by every block reading the object: `engine`, the active sheet and the selected cells, reported by the engine's events in both modes and restored by the next instance (after another document, a switch between View and Edit, a new version of the data); and `draft`, the editor's draft store while a session is open on the object, which a second block reading the same object renders as it is edited, workbook and view range alike ([Drafts and sharing](doc_page_impl_mdx_comp_state.md#drafts-and-sharing)). The editor puts the draft there when it mounts and takes it out when it unmounts, which is when the session has ended; what is saved still goes into the asset object.

```text
ExcelUniver.jsx           the popup surface; routes to ExcelUniverView (view) or ExcelUniverEdit (config.isEdit)
ExcelUniverSheet.jsx      one Univer instance on a workbook text, in its own mount element; view guard or
                          change reports; the selection restored and reported; retirement outside the commit
ExcelUniverEdit.jsx       the sheet editor and the view-range panel; the draft put into the block's state
ExcelUniverEditStore.js   the draft: workbook text, view, metadata to save
ExcelUniverData.js        parsing, ranges, metadata, the view workbook and its height (pure)
excel-univer-expose.js    meta, icon, edit mode, the default workbook
```

The usage is shown in `example_doc/mdx-usage/comp-excel-univer.md`.

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
