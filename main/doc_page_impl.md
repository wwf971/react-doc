<!-- Implementation design for the reusable document page. Requirement: doc_page_req.md -->

# Document Page: Design

This project renders local md/mdx folders as a doc website. The whole doc page is one embeddable React component (`DocPageMdx`), built with Vite, driven by mobx stores — no Next.js, no router framework. Everything is configured by `config.yaml` (+ local override `config.0.yaml`): which document the page shows (its entry file), how page features behave (globally and per document), and which custom components docs can use. The document itself is described by its entry file, `xxx-entry.yaml`: which folders/files form its source, which side panels arrange them, which tags its documents carry.

```text
config.yaml (overlay config.0.yaml) ──► docEntry.file: the entry of the document
     │  read at dev/build time by a small vite plugin
     ▼
vite plugin "doc-source"
     ├── loads the entry and every yaml file it reaches: source rules, side panels, tags
     ├── executes source rules ──► file manifest (multi-root: ~rootId/relPath) + folder manifest
     │     each doc = lazy `?raw` import ──► dev: HMR reload on edit
     │                                       build: one lazy chunk per doc
     ├── serves the dev-only apis: source (file bytes, file creation), edit (files), asset (the local store of the asset service layer),
     │     service (forwarded to the service backend, a python program of its own)
     └── emits virtual module `virtual:doc-source` = { config, fileManifest, dirManifest, fileUrlByPath, assetSnapshot }
     ▼
mobx stores (source of truth for rendering)
     ├── DocSourceStore (lower): manifest, raw/compile caches, doc index, search data, the service object of the doc page source service layer
     ├── DocSourceFileStore: files created from the page (pasted images), the location prompt
     ├── DocStore (upper): side-panel tree, current doc, navigation, link dropdown, url sync
     ├── DocTagStore: tags resolved from source rules + side-panel tree, tag queries
     ├── DocConfigStore: feature config, global and resolved per document, component-level keys, user overrides
     ├── DocEditStore: in-place editing (dev server only): sessions, block model, edit api
     ├── DocAssetStore: component data kept in the asset service layer: objects, versions, dependencies, the asset panel
     ├── DocServiceStore: the service instances of the backend, their types, the dashboard modules
     └── DocBlockPopupStore: one component block shown in a popup, in View or Edit
     ▼
DocEventRouter: component reports → host → local handler → domain route (navigation, tag, edit, asset, service, source)
     ▼
<DocPageMdx/>  (embeddable component)
     ├── FrameworkProvider adapter: usePathname/useRouter/Link backed by DocStore
     └── fumadocs-ui: RootProvider + DocsLayout (sidebar + settings button) + DocsPage (toc, breadcrumb)
           body = mdx compiled in browser (@mdx-js/mdx + fumadocs runtime preset)
```

## Key choices

**Embeddable component, own "framework" adapter.** fumadocs-ui works without any framework: `FrameworkProvider` from `fumadocs-core/framework` only needs `usePathname`, `useRouter` ({push, refresh}) and a `Link` component. These are implemented on top of `DocStore`, so navigation is plain mobx state. Standalone mode syncs the current doc to the page url as a `?doc=` query param (heading anchors keep native `#hash` behavior); embedded/memory mode skips url sync entirely. A consumer app renders `<DocPageMdx data={...} config={...} onEvent={...}/>`. The page is its own scroll container, so its host must have a definite height (see [Avoid CSS Style Regression](#avoid-css-style-regression)).

**Runtime compile in browser, not build-time mdx.** `fumadocs-mdx` needs one content dir known to the bundler and cannot express the rule-based multi-root source. Instead docs are shipped as raw text (lazy chunks) and compiled in the browser on first visit: `@mdx-js/mdx` with `mdxPreset()` from `fumadocs-core/content/mdx/preset-runtime`, which applies the same default plugins the official setup uses (shiki code blocks, heading anchors + toc, gfm, structured data for search). Compile results are cached per doc in the store. Local docs are trusted content, so runtime evaluation is acceptable here.

**LaTeX.** `remark-math` parses `$...$` (inline) and `$$...$$` (display) in `.md` and `.mdx`, and `rehype-katex` renders them; the package stylesheet imports the KaTeX CSS. `rehypeKatex` runs before Fumadocs `rehypeCode`: display math is emitted as a `math` code element, which Shiki would otherwise treat as a code block in an unknown language. Nested Markdown in components uses the same two extensions (see [Component registry](#component-registry)).

**`.md` vs `.mdx`.** `.mdx` compiles with format `mdx` (JSX allowed). `.md` and everything else compiles with format `md`, so plain markdown containing `<xxx>` or `{}` text never breaks. Remark plugins can inject JSX nodes in both formats, which is how links/components get special rendering even in plain md.

**Multilingual content.** Language inheritance, document-wide selection, headings, paragraphs, lists, degradation behavior, and file naming are specified in [doc_page_impl_multi-lang.md](doc_page_impl_multi-lang.md).

**In-place editing, an additional layer.** On the development server a document can be edited from the page, one root-level block at a time; the server rewrites the file and the page reloads from it. The layer has its own store, its own compiled body (root blocks wrapped, each with a floating toolbar from a sticky anchor), and a component edit contract (`config.isEdit`, `XxxEdit.jsx` beside `Xxx.jsx`); the reading path is untouched and a built page has no edit mode. Specified in [doc_page_impl_edit.md](doc_page_impl_edit.md).

**Component data in the asset service layer.** The **asset service layer** keeps component data outside the document. A component block can hold a reference (a fenced block in the language `asset`, yaml naming a store, an object by its unique name or its id, and a version or the head) in place of its data; the data lives in a store of versioned objects, modeled after an object storage (an object is metadata with a DAG history and a record of its events, a version is bytes, text or not), with a standard api (create, update in place or as a new version, checkout, delete, history). The one store today is the local store: one or more folders on disk (an object's folder is `{id}--{name}`), served by the development server and bundled read-only into a build. Every version records what its data depends on (a file of the source, another asset), so a build keeps the files and a deletion can know what it breaks. The runtime boundary resolves the reference before the component renders, so components never know unless they opt in (`isAssetAware`: where the data is and what a write to it does, and one `dataReplaceRequest` event that updates the object or rewrites the inline block); the block toolbar of edit mode opens the asset panel, with a preview pane that renders the data as it is edited. The page knows which blocks read which object (a usage index), so the panel lists an object's blocks and the settings panel the orphans; how components use the layer is in [Components and the asset service layer](doc_page_impl_mdx_comp.md#components-and-the-asset-service-layer). Specified in [doc_page_impl_asset.md](doc_page_impl_asset.md).

**Service instances, shown through dashboards.** What a document shows is not always data: a service instance is a running thing with its own state (a sqlite database, a queue of jobs), run by the service backend, a Python program of its own that the development server forwards to (`{base}/__doc-service/*`). A **service template** (a folder `{templateId}--{name}`) is the initial state of a service and is never run: a script, a Python class that exposes its metadata, its apis (OpenRPC-compatible), its config, and its dashboards keyed by id (at least a `default` and a `config` one), a federated module with the dashboards, and an initial config. A **service instance** is always created from a template: the template folder is copied into a folder of its own, `{templateName}-inst-{serviceId}`, whose `service.yaml` records the template (id, name, version id); from then on the instance runs its own copy, never shared with another instance, keeps its own data, and answers one request at a time. A dashboard is a component of the registry (`service/{templateName}/{dashboardId}`, `componentType: 'serviceDashboard'`), loaded from the instance's own module sharing the page's react, and placed as an asset-only block whose object keeps the instance it shows and its own state; its frame always offers the choice of the instance and says what keeps it from showing (no backend, backend down, template, instance, module). The settings panel shows the templates and the instances in two areas of its Services tab, and creates instances from templates there. Specified in [doc_page_impl_service_instance.md](doc_page_impl_service_instance.md).

**A component block in a popup.** A component opts into the block popup by rendering itself inside `BlockPopupSurface`: the reader opens the block in a dialog (the host's panel component), maximizes it, and switches it between View and Edit there, in reading mode as in edit mode. The page owns the dialog and its state, outside the document body, so the dialog stays while the body under it is replaced (reading body to edit body, view renderer to editor); the component's rendered element moves between the page and the dialog, so it keeps its state. Edit and View are the edit layer's session (open, leave = save, cancel = drop), with a step the editor completes its draft with before a save. Specified in [doc_page_impl_popup.md](doc_page_impl_popup.md).

**Pasting Markdown as blocks.** In edit mode, Markdown or MDX pasted on the page is not written at once: it goes through a pipeline (normalization, then the host's transforms, then the parse of the edit layer's block model) and opens a review dialog that shows the root-level blocks it makes, each as source or rendered, beside a tree of the target document to choose the place from. Insert is one write of the edit layer.

**Copying and moving blocks.** Blocks are selected in block selection mode, a mode of its own beside view and edit mode that shows the edit body with every block selectable (click, Ctrl/⌘ + click, Shift + click). A right click opens Copy / Move, and one dialog shows the chosen blocks with checkboxes beside a path picker for the target document, then the tree of that document for the place. A copy is an insert; a move within one document is one write of several line operations, a move into another document inserts first and removes last, so a failure never loses blocks. Both are specified, with the paste, in [doc_page_impl_copy_paste.md](doc_page_impl_copy_paste.md).

**One event layer between components and stores.** A registered component reports through `onEvent` and never calls a store; `DocEventRouter` turns the report into an event with its source, lets the host application and the rendering place answer first, then routes it to the domain that owns the type (navigation, tags, editing). Every answer is `{ code, data, message }`. Specified in [doc_page_impl_event.md](doc_page_impl_event.md).

**Doc collection via vite plugin.** The plugin reads the two-layer config, loads the document entry it names and every yaml file the entry reaches (collecting their source rules, side panels, and tag definitions), executes the source rules, and generates a virtual module where every doc file is a lazy `?raw` import. Vite then gives both dev-time freshness (editing a doc reloads it; adding/removing files or editing config or any loaded yaml file invalidates the manifest) and production bundling (docs are code-split into per-doc lazy chunks inside one deployable artifact).

**An explicit doc page source service layer.** The files and folders of the document are one layer, the **doc page source service layer**, with one grammar and one api: every file is named by its source path `~rootId/relPath`, every folder rule says how it collects (`recursive`, `direct`, or `referenced`: collectable, bundled only when used), the development server serves file bytes and creates files, and the page offers the source to components as a service (resolution, urls, path completion, file creation through the event layer). Specified in [Doc page source service layer](doc_page_impl_source.md).

## Can we keep fumadocs default components while owning link logic? YES

The answer is yes. The MDX `components` mapping is per-tag. We spread `defaultMdxComponents` from `fumadocs-ui/mdx` (headings with anchors, shiki code blocks, callout, cards, tables...) and only inject `DocLink` + registry components. Sidebar, TOC, breadcrumb, search dialog are layout-level (`DocsLayout`/`DocsPage`) and unaffected. Code block features — diff (`[!code ++]`/`[!code --]`), line/word highlight, focus, `title="..."` — are default shiki transformers in fumadocs' rehype-code and keep working.

Ordinary fenced JSON is rendered by the default Fumadocs/Shiki pipeline. A comment block can opt into `DocCodeBlock` with `type=json` for an interactive JSON variant. `CodeBlockJson` still uses `DynamicCodeBlock` and its copy action, adds one button that toggles between `pretty` and `plain`, and reads the initial mode from `modeInitial` with `pretty` as the default. Pretty mode parses and indents JSON; plain mode preserves the authored source. Invalid JSON remains visible and receives an inline formatting error instead of replacing the source.

## Store design (two layers)

Follows the data-driven pattern of `react-comp-misc` (`comp_design.md`) and the two-layer split of `example_doc/frontend-store.md`, adapted to a readonly local source (no websocket/lock layer needed here):

- `DocSourceStore` (lower, content): `fileManifest`, `dirManifest`, `configDoc`, `rawByPath`, `compiledByPath` (status/Body/toc/error), `targetsByName` (doc index for link resolution), `structuredDataByPath` (search), and the service object of the doc page source service layer handed to components (`config.source`: `fileResolve`, `fileUrlGet`, `pathComplete`, `fileCreate`). API: `loadDoc(path)`, `resolveLink(target, fromPath)`, `searchDocs(query)`. See [Doc page source service layer](doc_page_impl_source.md).
- `DocSourceFileStore` (doc page source service layer, beside it): the file-creation requests of components (`fileCreateRequest`, the source route of the event layer) and the one open location prompt.
- `DocStore` (upper, view): `docCurrentPath`, `isDocLoading`, `linkDropdownOpenId` (which link's candidate-dropdown is open; one at a time, closes on outside click), page tree (computed), route mode + url sync. API: `navigate(path, hash)`, `navigationBack()`, `navigationUp()`, `navigationForward()`, `init()`.
- `DocTagStore` (derived): the tag model computed from the manifest and the page tree, plus the tag service used by renderers and the open state of the tag overview popup. See [Tag system](doc_page_impl_tag.md).
- `DocConfigStore` (derived): the config model computed from `globalConfig`, the manifest, and the page tree, the reader's session overrides from the settings panel, plus the config service. See [Config system](doc_page_impl_config.md).
- `DocEditStore` (edit layer, beside the reading stores): availability of the development-server edit api, the global edit mode, the document source as read from disk with its hash, the dedicated compile with block wrappers, the one open edit session, the open insert menu, and the pending deletion; every write goes through `operationApply`, and the events of editors arrive at `eventHandle`. It never writes to the reading stores; the file on disk is changed and reloads through the normal path. See [In-place editing](doc_page_impl_edit.md).
- `DocAssetStore` (beside the reading stores): the backend of the asset service layer (the development-server api, or the snapshot bundled into a build), the index of its objects loaded at page start and the version data read so far, what a reference by id or by name resolves to (`refQuery` / `refLoad`), every write to the store (`writeApply`), the dependencies of versions, the folders of the local store, the usage index (which blocks read which object), and the asset panels (the popup with its preview, the settings tab's). See [Asset service layer](doc_page_impl_asset.md).
- `DocServiceStore` (beside the reading stores): the service backend's status (polled), its types and instances, the dashboard module of each type, why a dashboard cannot show (`dashboardProblemGet`), the calls of the dashboards and the writes of their state (the `service` route of the event layer), and the Services tab of the settings panel. See [Service instances](doc_page_impl_service_instance.md#docservicestore).
- `DocBlockPopupStore` (beside the edit layer): the one open block popup (the block's identity, title, maximized state, a placeholder height for the page), the surfaces of the page and which one the popup shows, the View / Edit mode derived from the edit session, and the change of mode in progress. See [Block popup](doc_page_impl_popup.md).
- `DocPasteStore` (beside the edit layer): the one open review of a paste (the pasted text, the place the blocks go, which blocks are shown rendered), the pipeline result derived from it, and the insert, written through `DocEditStore.blockListInsert`. See [Copy, move and paste](doc_page_impl_copy_paste.md).
- `DocBlockSelectStore` (beside the edit layer): the blocks selected in block selection mode (`DocEditStore.isBlockSelectMode`), their right-click menu (duplicate, delete), and the one open copy / move dialog (the checked blocks, the target document and place), written through `DocEditStore.blockListCopy` / `blockListMove` / `blockListDelete`; and the blocks the author is at in any mode with blocks (the selection, the open session's block, the blocks a text selection touches), which a paste is placed after. See [Copying and moving blocks](doc_page_impl_copy_paste.md#copying-and-moving-blocks).
- `DocPanelLayoutStore`: where the dialogs framed by the host's panel component were moved and resized, and the sizes they remember ([the panel contract](#the-panel-contract)).

Render components observe stores via context and submit change attempts through store APIs; no component talks to the file system or compiler directly.

## The document entry

`config.yaml` names the document the page shows through its entry file:

```yaml
docEntry:
  file: ../example_doc/example-entry.yaml
  # sidePanel: compact     # optional: one of the entry's side panels instead of its default
```

The entry is a YAML file marked by a `docEntry` section and named `xxx-entry.yaml` by convention. It declares the document's `source` rules, its `tag` definitions, and its side panels (`sidePanelById`), each section inline or in a file of its own; a side panel includes the side panel of another entry, so a document is composed of self-contained documents, each of which can also be the entry of a deployment. The entry supplies `siteTitle`, `homeDoc`, and `homeItem` when `config.yaml` sets none. The grammar, the loading order, and the inclusion forms are specified in [The document entry](doc_page_impl_side_panel.md#the-document-entry).

## Source rules

`source` of a document yaml file is an ordered rule list executed against a growing file set. It can also be `{ rules: [...] }` or `{ file: './source.yaml' }`; the referenced file contains the ordered `rules` list and resolves paths relative to itself:

```yaml
source:
  - action: addFolder      # a folder becomes one root; collect says how (required)
    rootId: example
    path: .
    collect: recursive     # recursive | direct | referenced
  - action: addFile        # one file becomes one root
    rootId: req
    path: ../main/doc_page_req.md
  - action: addFolder      # the same root, a folder inside it collected differently
    rootId: example
    path: ./mdx-usage/image
    collect: referenced    # collectable: part of the page only when used, never a page
  - action: removeByName   # glob against file name
    pattern: "*.pyc"
  - action: removeByPath   # glob against the source path ~rootId/relative/path
    pattern: "~example/private/**"
```

The rules of the entry come first; the rules of every included document follow in order of appearance (see [Loading](doc_page_impl_side_panel.md#loading)). The yaml files of the document and `config.yaml` are never collected.

Paths are relative to the file holding the rules. Every collected file is named by its **source path** `~rootId/relPath` (the root id marked by `~`, then the path from the root folder), so same-name root folders never clash; the same name is used in links, side panels, component data, urls and apis. A folder rule must declare how it **collects**: `recursive` (every file below is a page), `direct` (the files right in the folder are pages), or `referenced` (the files are collectable, not pages: they are served when something names them and kept in a build only when used, which is how a folder of images or of files the page creates belongs to the source). A root id names one folder; a later rule with the same id refines a folder inside it. `addFile` after a remove rule re-adds a single file (the "remove folder except one file" case in the requirement). The grammar, the collect modes and the folder manifest are specified in [Doc page source service layer](doc_page_impl_source.md#source-rules-and-collection).

Rules can also attach tags and document config. `tags` / `config` on an add rule apply to every file it collects. `addTagByPath` / `addTagByName` and `setConfigByPath` / `setConfigByName` apply to the files collected so far. See [Tag system](doc_page_impl_tag.md#declaring-tags) and [Config system](doc_page_impl_config.md#declaring-document-config).

### External source files

Source paths may point outside the application project. Use `addFile` for one external document or `addFolder` for an external document tree:

```yaml
- action: addFile
  rootId: external-guide
  path: ../../shared-docs/guide.md
```

The collected file has the source path `~external-guide/guide.md`. Add that path to the side panel when the document should be directly navigable. The Vite development server must also allow the external folder; keep the allowed scope as narrow as practical.

Non-md files get a display strategy by suffix (`fileDisplay` in config, suffix → code block language). The store synthesizes markdown: file name as title + one code block. Unknown suffixes fall back to a plain code block.

### Source pruning for deployment

Local development exposes every file selected by the source rules. The Vite plugin option `pruneSourceToSidePanel: true` reduces the manifest of a deployment build to the files the side panel navigates to and every file they reach statically, so authors write a dependency once, in the document that uses it.

Pruning starts from the side panel after `excludeSidePanelItemIds` is applied: `doc` items, `sourceFolder` / `sourceRoot` items, and the content of inline items. Every retained `.md` / `.mdx` file is parsed by `plugin/doc-source-dependency.ts`, with its [asset references](doc_page_impl_asset.md#build) expanded to the referenced data first; reached documents are parsed in turn, and other files are retained without parsing. The source files the [asset versions depend on](doc_page_impl_asset.md#dependencies) are retained as well. A visited set ends cycles, and the manifest keeps source-rule order. The side panel stays responsible for navigation only: a supporting file does not need a visible item. Files of a `referenced` folder are never pages, so they enter the build only this way: reached by a document, named by a component, or depended on by an asset.

The collector parses with the runtime extensions (GFM, math, comment components; MDX syntax for `.mdx`) and classifies links with `lib/doc-link-classify.js`, the rules `remarkDocLink` uses. Targets resolve with `lib/doc-target-resolve.js`, which `DocSourceStore.resolveLink()` also uses, so a target retained at build time is the target opened at runtime:

| Authored | Kind | Resolution |
| --- | --- | --- |
| `[label](a.md)`, `` `a.md` ``, `[[a.md]]` | document | exact path, relative path, suffix, or file name |
| `[label](~root/x.ps1 "inline-link")`, also `:source` / `:render` | source | exact source path, as `SourceLink` |
| `![alt](a.png)` | asset | as a document; a miss is not reported |
| `dataRef="a.md#id"` on any component | document | as a document |
| a registered component's data | per extractor | see below |

External URLs, fragment-only links, and side-panel item targets (`@...`) are not dependencies. A target with several candidates retains all of them. A recognized local target that is not in the collected source produces a build warning naming the document, the construct, and the target; nothing is silently dropped.

Component-specific knowledge lives in build-safe extractors keyed by component id, `comp-doc/registry/registry-source-dependency.js`. The package covers `BlockMdx`, `BlockSimple`, `Block` and `MultiLang` (nested Markdown, collected recursively), `SourceLink` (target or first raw line), and `Index` (item targets and subtopic components). An extractor receives the component data as the component sees it and reports targets through its context:

```js
docSourcePlugin({
  pruneSourceToSidePanel: true,
  sourceDependencyCollectByCompId: {
    'specific/Chart': (data, context) => context.dependencyAdd(data.file, 'source'),
  },
});
```

MDX attributes written as expressions are not evaluated; when such an attribute belongs to a component with an extractor, the build reports it. The former side-panel property `sourceDependencies` is still read and merged with the discovered files, with a deprecation warning.

### Build-only component attachment collection

Some document components refer to attachment files through authored properties rather than ordinary markdown image syntax. Those files can be removed by deployment source pruning even though the document that needs them remains. Enable the optional collection layer with a boolean in `config.yaml`:

```yaml
collectComponentAttachmentsOnBuild: true
```

The layer runs only for a Vite build. It scans every md/mdx document remaining in the collected manifest (component blocks that reference the [asset service layer](doc_page_impl_asset.md#build) are expanded to their data first), asks registered attachment finders for component-specific references, resolves each reference against the complete source set (before side-panel pruning) the way the page resolves a target at runtime (source path, relative path, suffix, name), and bundles the resolved file. The binary files that survive pruning and the source files asset versions depend on are bundled the same way. Development mode does not run this scan: the page reads file bytes through the source api instead ([doc page source service layer](doc_page_impl_source.md#the-source-api)).

The default finders recognize `DiagramMermaid`'s `laneIcons` property, `Image`'s `src` value in its YAML block, and image `src` values in a `ImageGrid` YAML block. Direct MDX component properties are also recognized where applicable. For example, all four PNG files in the following value are retained even if they are not otherwise present in the pruned deployment manifest:

```text
laneIcons=Mda:doc-aux/image/icon-mda.png|Data:doc-aux/image/icon-dataverse.png|Flow:doc-aux/image/icon-powerautomate.png|Agent:doc-aux/image/icon-copilot studio.png
```

Collected files are exported by `virtual:doc-source` as `fileUrlByPath`, keyed by source path (and by the spelling the document used, for a file found beside the document but not collected). They are represented as data URLs so a deployment that packages the JavaScript artifact but does not preserve separate Vite image outputs still contains the file. The page hands the map to `DocSourceStore` (`data.fileUrlByPath`), whose `fileUrlGet` is the default `config.assetUrlGet` of every component; a consuming application that hands its own `assetUrlGet` should check this map before its fallback.

Component recognition is decoupled from the source-rule scanner. Additional component-specific finders can be passed through the Vite plugin's `attachmentFinderList` option; each finder receives the document text, document paths, and merged config, and returns attachment path strings. Missing references produce a build warning containing the source document path. The feature defaults to off when the boolean is absent or false.

## Links and navigation

`DocStore` is the navigation source of truth. Links, side-panel items, history controls, registered-component navigation requests, and hosted indexes all submit destinations through `DocStore.navigate()`. A destination combines a semantic document route with an optional heading fragment. Query mode synchronizes it with browser history; memory mode keeps it inside the embedded document page.

The fragment names a place by id or by heading title: `guide.md#Configuration` needs no preparation, and `<!--renderComp=Anchor,id=configuration-->` before a heading declares an id that survives title edits.

`DocLink` keeps recognition, target resolution, rendering, and navigation separate. `DocPageView` delegates fragment scrolling and highlighting to a dedicated destination controller. This allows applications to customize link presentation without bypassing route resolution or navigation history.

For target formats, fragment behavior, history, Back/Forward/Up, side-panel routes, and hosted-index subscriptions, refer to [Navigation design](doc_page_impl_nav.md).

## Graceful degradation stipulation

A second remark plugin (`remarkCommentComp`) scans HTML comment nodes of the form `<!--renderComp=StockTable,a=b-->`. When such a comment directly precedes a code block or a table, that node is replaced by the registered component, receiving the raw block text plus the comment's key=value props. A normal markdown renderer just ignores the comment and shows the plain block — that is the degradation path.

HTML comments only exist in md-format parsing; that is exactly the degradation-compatible style. In `.mdx`, authors write `<Comp a="b" />` directly (the more common style), through the same registry.

The same comment and block can be an element of a list item at any depth: both are indented to the item's text column, the comment may also end a line of text, and text continues below the block. A comment directly followed by inline code marks that code instead and renders an inline component. The writing rules, the parser behavior behind them, and the reasons are in [Components in lists](doc_page_impl_mdx_li.md).

## Component registry

`compRegistry` in config maps doc-visible tag names to component ids. General Fumadocs components come from the package registry; project-specific components are supplied by the consuming application through `config.compById`:

```yaml
compRegistry:
  Tabs: common/Tabs        # re-exported fumadocs-ui components
  Callout: common/Callout
  StockTable: specific/StockTable   # project-specific components
```

Config decides what doc authors can use; code decides what exists. The dashboards of service instances are the one exception to the mapping: their component id is their tag name (`service/{templateName}/{dashboardId}`), and every lookup of a definition by id (`compDefinitionGet`) falls back to them, because the templates and instances are known from the service backend at run time, not from the configuration ([Dashboards in the registry](doc_page_impl_service_instance.md#dashboards-in-the-registry)).

All registered render components use the same top-level props: `{ data, config, onEvent }`. `data` contains semantic content, `config` contains operation state and runtime context, and `onEvent(eventType, eventData)` submits interaction requests, which the [event layer](doc_page_impl_event.md) routes and answers with `{ code, data, message }`. The internal shape of `data` and `config` remains component-specific. Components with meaningful mutable operation state can use `CompStateStore` or their own MobX store; simple components can remain stateless.

Registry values are component definitions created with `compDefine()`. A definition provides `CompRender`, can also provide supported placements and an input converter, and carries what the component exposes about itself (`expose`: its metadata and config shape, its icon, its view modes and edit modes, its edit template; [What a component exposes](doc_page_impl_mdx_comp.md#what-a-component-exposes)). Fumadocs-native components use adapters created with `compNativeDefine()`, so their framework-specific props do not become the public contract for project components.

Multilingual component registration and authoring rules are specified in [doc_page_impl_multi-lang.md](doc_page_impl_multi-lang.md).

Component naming, compatibility names, and the component data reference (a component reusing the authored data of another component through `dataRef="{document target}#{component id}"`) are described in [MDX components](doc_page_impl_mdx_comp.md).

One runtime host normalizes every registry invocation. Normal MDX attributes remain concise authoring syntax and are converted into `data`; comment-marked blocks add `raw` and `lang`; a comment-marked block in the language `asset` is a reference into the [asset service layer](doc_page_impl_asset.md), which the host resolves to the referenced text before normalizing; side-panel display and panel components receive their corresponding data. Runtime fields such as component id, instance id, placement, source path, and side-panel item id are supplied through `config`. The supported placements are `mdx`, `commentBlock`, `sidePanelDisplay`, `sidePanelPanel`, `partIndex`, `indexSubtopic`, `tag`, `tagOverview`, `edit` (the default block editors of the edit layer), `serviceSettings` (a service dashboard in the Services tab of the settings panel), and the parts some components render through the registry: `fileDownloadIcon`, `tableCell`, `hierarchyRow`, and `hierarchyHeader` (see [Component names](doc_page_impl_mdx_comp.md#component-names)).

A few registry names are built in: the page renders with them even when `compRegistry` does not mention them, in comment form and in `.mdx`. `Anchor` resolves to `common/Anchor` and declares fragment ids for the node after it (see [Navigation design](doc_page_impl_nav.md#fragment-targets-titles-and-declared-ids)); `SidePanelItem` resolves to `common/SidePanelItem` and renders every side-panel label; `TagLabel` resolves to `common/TagLabel` and is the default look of tags; `Tag` resolves to `common/Tag` and renders a tag mentioned in document text; `TagOverview` resolves to `common/TagOverview` and renders the content of the tag overview popup; `Heading`, `Paragraph`, `List`, and `BlockSource` resolve to the default block editors of edit mode (see [In-place editing](doc_page_impl_edit.md#component-edit-mode)). Mapping such a name in `compRegistry` replaces the default everywhere, which is how an application provides its own side-panel item rendering. `compIdResolve()` in `comp-registry.js` is the single place that turns a name into a component id.

Some components need settings only the host application can supply, such as a Mermaid loader or the text panel component that frames popups. The host passes them once through `DocPageMdx` `config.compConfigHost`; every registered component receives them in its `config` with the lowest priority, below authored and runtime values. The page itself reads `panelComponent` from the same place for the tag overview popup, the asset panel, the [block popup](doc_page_impl_popup.md) and the [review of a paste and the copy / move dialog](doc_page_impl_copy_paste.md):

```jsx
<DocPageMdx config={{ compConfigHost: { mermaidLoad: () => import('mermaid'), panelComponent: PanelText } }} />
```

What a panel component receives and asks for is [the panel contract](#the-panel-contract).

Beside the host settings, `RegisteredComp` gives every component what the page layers know for it: `config.assetUrlGet`, the resolver from authored file references to urls, bound to the component's document by the [doc page source service layer](doc_page_impl_source.md#the-page-side-docsourcestore-and-the-service-object) (a host may override it in `compConfigHost`); `config.source`, the service object of the doc page source service layer; `config.compConfig`, the component's own [component-level config](doc_page_impl_config.md#component-level-config) resolved for the document; `config.blockIndex`, the block of the edit body the component is rendered in (undefined in reading mode); `config.sourceLine`, for a comment-marked block, the line of its marker comment (the block's identity in reading and in edit mode, [Block identity](doc_page_impl_popup.md#block-identity)); `config.viewMode`, for a component that exposes view modes, the one to render ([View modes and edit modes](doc_page_impl_mdx_comp.md#view-modes-and-edit-modes)); and, for a component declared `isAssetAware`, `config.assetInfo` ([component awareness](doc_page_impl_mdx_comp.md#component-awareness)).

Components that display authored Markdown inside themselves (`BlockSimple`, `BlockMdx`, `Block`, `MultiLang`) receive the package `MdxRenderer` through their registry definitions, so they do not depend on the compile pipeline directly. `MdxRenderer` is the shared Markdown boundary (`lib/markdown-render.js`): the component decides what is shown, and the renderer decides what the Markdown means, the same way as the main document body.

- Parsing uses GFM and math, as a compiled `.md` document.
- `remarkDocLink` is the one link transform, so local links, `inline-link` markers, file-like inline code and wiki links behave as in the body; relative targets resolve from `config.sourcePath`.
- The component mapping is `buildMdxComps()`, so `DocLink`, `SourceLink` and registered components receive the same host configuration (such as `panelComponent`) as in the body.

`MdxRenderer` accepts Markdown text (`data.source`, compiled through `compileDoc()`) or already parsed mdast nodes (`data.nodeList`, rendered synchronously, e.g. the paragraph `MultiLang` picked for a language). `config.contentMode: 'inline'` renders phrasing content without a wrapper block. `config.nodeTypeAllowedList` restricts the allowed node types and degrades others to their content; `config.isContentSanitized` removes authored JSX, HTML and expressions while keeping the generated link elements.

### The panel contract

`data.title`; `config.isPopup` (a modal dialog over the page), `config.isCloseVisible`, `config.className` / `config.bodyClassName`; `headerRightContent`, placed before the panel's own buttons; `content`; and the event `closeRequest`. A dialog sits at z-index 210; the menus a component's engine portals to the body must be above that (Univer's are at about 1080). `TextPanelDemo` of the example application implements the whole contract.

The panel's geometry is the caller's state, like everything else it shows, so it survives the panel's content being replaced; the panel only asks for a change:

| Config | Event | Meaning |
| --- | --- | --- |
| `isExpandVisible`, `isExpanded` | `expandChangeRequest { isExpanded }` | a maximize / restore button; maximized, the panel fills the window with a small inset, and neither moves nor resizes |
| `isMovable` | `rectChangeRequest { rect, kind: 'move', isEnd }` | the empty parts of the header (not its buttons or fields) drag the panel; its header stays reachable in the window |
| `isResizable` | `rectChangeRequest { rect, kind: 'resize', isEnd }` | the edges and corners resize it, within the window and above a minimum size |
| `rect { x, y, width, height }` | | where the panel is, in px of the window: absent, centered in the size its `className` gives; `width` / `height` alone, centered in that size |

`rectChangeRequest` comes on every pointer move of a drag, with `isEnd` on the last. The page keeps the rects of its dialogs in `DocPanelLayoutStore`: a dialog names its panel by an id and opts in with `usePanelLayout(id, isOpen, { isMovable, isResizable, isSizeRemembered })` (`comp-doc/popup/use-panel-layout.js`), which gives the config to spread and answers the event. The place of a panel is forgotten when it closes, so it opens centered again; with `isSizeRemembered` the size a finished resize leaves is kept for the next opening, also after a reload (`localStorage`, `doc-page-panel-size`). The review of a paste and the copy / move dialog use all three ([Copy, Move and Paste](doc_page_impl_copy_paste.md)).

### Isolate temporary rendering DOM

Components and third-party libraries sometimes create temporary DOM to measure, transform, or serialize content before displaying the final result. Temporary elements must not be mounted directly under `document.body` without containment. Large intermediate content can briefly change the body dimensions, trigger a window-level scrollbar, and shift the page horizontally even when the final component is correctly clipped inside its own viewport.

Keep temporary rendering DOM inside a host owned by the component that performs the rendering. The host should remain mounted for the complete asynchronous operation and be fixed or absolutely positioned, zero-sized, clipped, hidden, non-interactive, and layout-contained. Insert only the completed output into the visible component. Fix overflow at the level where it is created: reserving a gutter on a nested document scroller cannot prevent temporary elements attached to `document.body` from changing window overflow.

Mermaid is one example. `mermaid.render(id, source)` appends temporary rendering elements to `document.body` when its optional container is omitted. `DiagramMermaid` therefore passes a dedicated contained host as the third argument to `mermaid.render()`. Mermaid measures and serializes the SVG inside that host, then the component inserts the completed SVG into the visible diagram viewport. Diagrams default to `fit` mode so all content is visible, with a temporary toolbar toggle for original-size `intrinsic` mode. The same isolation principle applies to charting, diagram, export, rich-text, and measurement libraries that create off-screen or temporary DOM.

## Side panel

The side panel is a free tree declared in YAML, so it need not mirror the file tree. It is treated as a resource: a way of picking things from the collected source and arranging them as a tree. A document declares its side panels in its entry (`sidePanelById`), and the page shows the default one; a node includes another side panel, such as the side panel of a part or of a self-contained sub document, through `include`. The tree decides document order, item routes, semantic parts, side-panel tags, and the side-panel level of document config. Every item label is rendered through the registry component named `SidePanelItem`.

For the entry grammar, tree format, inclusion, parts, and item rendering, refer to [Side panel design](doc_page_impl_side_panel.md).

## Tags

Documents, source folders, and side-panel items can carry tags. Tags are declared while files are collected (source rules) and on side-panel items, then resolved in a fixed order: later declarations of the same tag replace earlier ones, and different tags are appended. Tag definitions in config decide how each tag looks. `DocTagStore` owns the resolved tag model and answers queries such as "tags of this document" and "assets with this tag", so renderers never read tags from YAML nodes directly.

Tags are displayed on side-panel items, next to the path bar of the main panel, and beside document links. Clicking a tag opens the tag overview, a popup listing every asset with that tag arranged like the side panel. Each of these is switched by config keys.

For the resolution steps, declaration syntax, definitions, display places, the overview, and the tag service, refer to [Tag system](doc_page_impl_tag.md).

## Config

Features of the page, such as where tags are displayed, are switched by config keys. Every key has a definition in code (value type, default, scope) and a page-level value in `globalConfig` of `config.yaml`. Keys of one feature share a prefix, and switches end with `IsOn`, for example `TagsDisplayAtLinkIsOn`.

A document-level key can also be set for single documents. Its value is resolved through a fixed order of levels, and a later level wins key by key:

```text
default  <  global (config.yaml)  <  source rules  <  side-panel items  <  document frontmatter
```

`DocConfigStore` resolves these levels and answers queries such as "value of this key for this document" through the config service, so renderers never read the levels themselves. Applications can add their own keys.

A registered component can declare keys of its own (`compDefine` `expose.meta.configDefineList`); they are resolved through the same levels under a `compConfig` mapping keyed by the component's tag name, kept apart from the page keys in `config.yaml` and in the settings panel (tab **Component**), and handed to the component as `config.compConfig`. A string value at any level may use `${name}` variables declared in `config.yaml` `variable`; a key of type `sourcePath` is edited with completion from the doc page source service layer.

For the key list, naming rules, declaration syntax of each level, component-level keys, variables, and the config service, refer to [Config system](doc_page_impl_config.md).

## Semantic parts and hosted indexes

A side-panel node with a `part` mapping and an explicit `id` is a part root; its `part.index` names the index document by side-panel item id and the index component by authored id. The declaration is described in [Side panel design](doc_page_impl_side_panel.md#semantic-parts).

The referenced document marks the queryable component with a stable authored id:

````markdown
<!--renderComp=Index,id=guide-main-index-->
```yaml
type: title-subtopics-items
layout: horizontal-wrap
title: Guide
subtopics: []
```
````

`remarkCommentComp` records queryable comment-block component entries while compiling a document. Each entry contains the authored component id/name, raw block, language, props, and source offset. `DocSourceStore.componentGet(docPath, componentId)` performs document-local identity lookup and rejects missing or duplicate ids. `DocStore.componentQuery(docId, componentId)` first resolves the side-panel document id, then resolves the registered definition and returns both the component input data and its declared `componentType`. This lookup API is generic; the part-index host additionally requires `componentType: index`.

The component registry definition is therefore also a semantic capability declaration:

```javascript
compDefine(ComponentExample, {
  componentType: 'index',
  placementList: ['mdx', 'commentBlock', 'partIndex'],
})
```

The right-side local-index slot is wrapped by `DocPageToc`. Outside a configured part, when globally disabled, or when no segmented-control implementation is injected, it delegates directly to the native Fumadocs TOC. Inside a configured part, a segmented control switches between **On this page** and **In this part**, with **In this part** as the initial mode. Both modes retain the native Fumadocs TOC shell; part mode replaces its inner heading list rather than replacing the shell, so the layout's right-column width remains stable while switching. The part-mode class does not replace the shell's top padding, so switching modes also retains the same top inset without mode-specific size tuning. `DocStore.partIndexContentMode` is one global page/part selection that survives document and part navigation, while docked/floating mode can remain keyed by part id. The host loads the referenced document on demand and renders the referenced component through `RegisteredComp`, preserving component normalization, placement checks, and the common `{ data, config, onEvent }` boundary.

For `partIndex` placement, the index receives host-only display-mode configuration. Its left-aligned title and display-mode control use a wrapping row, allowing the control to move below a long title. The segmented control emits a `displayModeChange` request, and the host submits that request to `DocStore`. The reusable `Index` has no scrolling viewport of its own; the host panel around it is the scroll owner. In both display modes the panel's maximum height is the space between its top edge and the bottom of the window (`--doc-part-index-height-available`, measured by `DocPageToc` on resize, scroll, and layout or position changes), so a short index keeps its natural height and a tall one scrolls inside the panel. A docked panel measures its top from the sticky anchor of the TOC column rather than only from its current position: at the document bottom the sticky column moves upward, and measuring from that moved position would grant more height, push the column further up, and let the index grow to its full height. Wide content scrolls horizontally in the same panel, and the page/part switch stays outside the scrolling content. In `floating` mode the same component instance is rendered through a `document.body` portal, positioned at the top right, and assigned the application overlay stack maximum so it cannot pass below the side panel while being dragged; its height bound follows the dragged position. Ordinary `mdx` and `commentBlock` placements receive no display-mode control. On the part-root document, host state gives the index title the yellow current marker.

A hosted index belongs to its own document, not to the document shown beside it, so switching documents within the part changes neither its language nor its link style:

- **Language.** `DocStore.partIndexLanguageCurrent` is kept per part: the saved selection, then the frontmatter `language` of the index document, then the page language, then the first authored language. The host wraps the index in `DocLanguageProvider` with it. When the index has authored languages (`languageList` of its compiled component entry, from `compile.languageListGetByComponent`), the host passes `languageSegList` and `languageSelected`, and the index shows a language control at the right of its title line, before the docked/floating control. The control emits `languageChange`, which the host submits to `DocStore.partIndexLanguageSet()`. The document toolbar selector and side-panel labels keep following the visible document.
- **Document config.** The host sets `config.sourcePath` to the index document, so index links resolve relative targets and read `TagsDisplayAtLink...` from that document, and nested subtopic components receive the same source path. `part.index.config` is passed as `config.configDocOverride`; `DocLink` and `SourceLink` apply it over the containing document's config, below the inline link marker.

An index item defaults to `kind: document`. With `kind: inline-link`, it renders the reusable `SourceLink` component rather than owning source-popup behavior. `SourceLink` is independent of `Index`: it accepts a collected internal source path and label through the unified `{ data, config, onEvent }` interface, loads the source through `DocSourceStore.loadRaw()`, and owns a `CodeBlockCompactStore`. `CodeBlockCompactPopup` remains the shared implementation for the panel, syntax-highlighted body, copy operation, close event, and Escape-key behavior. Source-link targets do not need side-panel entries; with `pruneSourceToSidePanel` they are retained because the containing document reaches them (see [Source pruning for deployment](#source-pruning-for-deployment)).

`SourceLink` and ordinary document links share `LinkDocRender` and `LinkWarning` for unavailable-target presentation. A target absent from the collected source uses the red broken-link state and explains the problem through its hover title. A collected source that cannot be opened uses the orange unavailable state and shows the same dismissible warning beside the activated link. Loading source links retain normal link styling rather than appearing disabled.

MDX can invoke the registered component directly. Plain Markdown uses the ordinary degradation-compatible comment-block form; the marked fenced block supplies a visible fallback and can also supply the target from its first line when an explicit `target` property is absent. Registered custom components can compose the same `SourceLink` renderer and provide the host's `panelComponent`, so source viewing does not depend on index data or placement.

Ordinary Markdown prose can also place a true inline source link through the optional link title:

```markdown
[Setup script](/guide/setup.ps1 "inline-link")
[Setup script source](/guide/setup.ps1 "inline-link:source")
[Rendered guide](/guide/details.mdx "inline-link:render")
```

`remarkDocLink` replaces such a link with an inline `SourceLink` element (an `mdxJsxTextElement`, so it stays inside its paragraph) that resolves through `compRegistry` and keeps the authored link text as its label. Activating it opens the compact popup without navigation. The marker must be an exact, case-sensitive match; any other title keeps normal `DocLink` behavior, and external URLs and same-page anchors are never affected. `inline-link` remains an alias for source mode. Render mode compiles the target through the same `DocSourceStore.loadDoc()` and `buildMdxComps()` pipeline as a normal document page and shows the compiled body, frontmatter title, and description in an independently scrolling popup with document padding; nested registered components receive the popup target as their source path through `buildMdxComps(configDoc, compById, { sourcePath })`, which overrides `docStore.docCurrentPath` in `RegisteredComp`. The target must be an absolute collected source path present in the source manifest; a side-panel entry is not required.

For the `title-subtopics-items` index type, each subtopic contains exactly one of `items` or `component`. A component subtopic requires a stable subtopic `id` and has `{ name, data, config }`; `name` is resolved through the same `compRegistry` and `compById` layers as MDX components. `IndexSubtopicContent` renders it through `RegisteredComp` with placement `indexSubtopic` and a stable instance id derived from the parent index and subtopic ids. The nested component can emit `navigateRequest` with a document or document-plus-fragment target, and the ordinary registered-component fallback submits it to `DocStore.navigate()`.

```yaml
subtopics:
  - id: visual-map
    title: Visual map
    component:
      name: ComponentExample
      data:
        areas:
          - label: Header
            target: /guide/layout.md#header
```

Hosted indexes can observe navigation through a scoped runtime channel without receiving `DocStore` itself. The channel lifecycle, current-target matching, and mini-map selection behavior are described in [Navigation design](doc_page_impl_nav.md#hosted-index-navigation-channel).

The global semantic config is:

```yaml
partIndex:
  isEnabled: true
  isFloatingEnabled: true
```

Both flags default to `true`. `isEnabled: false` leaves declarations intact but restores the ordinary page TOC everywhere. `isFloatingEnabled: false` keeps the page/part switch while omitting the docked/floating control.

## Search

The search dialog UI comes from fumadocs-ui (composable `SearchDialog` parts plugged into `RootProvider`). The engine is a small client-side matcher over per-doc structured data (headings + paragraphs, extracted with fumadocs' `remarkStructure`), computed lazily on first search and cached. Custom components can contribute semantic index entries through Fumadocs structured-data node metadata; multilingual extraction is specified in [doc_page_impl_multi-lang.md](doc_page_impl_multi-lang.md). Search results are grouped below a contextual page row whose label and route are normalized through the configured side-panel tree. Manifest title extraction ignores heading-looking lines inside fenced code blocks. No server, works embedded.

## Project Folder Structure

```text
example_doc/             # root folder of the demonstration page
├── example-entry.yaml   # the entry of the document, named by config docEntry.file: its source,
│                        #   tag and side panels, each kept in its own file below
├── source.yaml          # ordered source rules (entry: source.file)
├── side-panel.yaml      # the page side panel (entry: sidePanelById.main), as a resource file
├── tag.yaml             # tag definitions (entry: tag.file)
├── sub-doc/             # a self-contained sub document: its own entry (sub-doc-entry.yaml) with
│                        #   source, tag and side panel; included by the page, deployable alone
├── side-panel-tag.md    # tag demonstration; doc-config.md: config demonstration
├── comp-custom-list-el.md # components as list elements: rules and examples
├── edit-in-place.md     # edit-mode playground (editable on the development server)
├── asset-store.md       # components reading their data from the asset service layer
├── asset.yaml           # the local store of the asset service layer: its folders and the default one
├── asset/, asset-archive/ # folders of the store: one folder per object, {id}--{name} (object.yaml + version files)
├── service-instance.md  # service dashboards; service-backend.yaml: the config of the service backend
├── service-template/    # service templates: {templateId}--{name} (service-template.yaml, service.py, dashboard/)
├── service/             # service instances: {templateName}-inst-{serviceId}, each a copy of its template (service.yaml + its data)
├── playground/          # a document for trying things out, ignored by git with everything in it
├── asset-file/image/    # a "referenced" source folder: where pasted images are created (nothing tracked)
├── comp-mdx/            # demo-specific components (not collected as documents); StockTable + StockTableEdit
├── mdx-usage/           # mdx component demonstrations (part with hosted index; its side-panel.yaml is a resource file)
└── link-nav/            # link usage guide (sections by title / Anchor id), link and non-md display test docs
main/
├── config.yaml          # example config (tracked), actually runnable
├── config.0.yaml        # local override (untracked), entries overlay config.yaml
├── comp-mdx/            # components available in documents (FileTree, Index, MultiLang, Tag, Anchor, ...)
│   ├── text/            # headings, paragraphs, lists of the document body + their default editors, BlockRender
│   └── image/           # Image + ImageEdit: component edit mode, empty state and paste (image-paste.js)
├── comp-doc/            # components of the page itself, one folder per feature
│   ├── registry/        # compById (registry.js), compDefine, RegisteredComp, DocComp, data references, build-time dependency extractors
│   ├── link/            # DocLink, LinkDocRender, LinkWarning
│   ├── side-panel/      # SidePanelItem, SidePanelItemHost, DocSidebarFolder
│   ├── tag/             # tag bar next to the path bar, tag overview popup
│   ├── toc/             # DocPageToc: page / part local index
│   ├── page/            # toolbar, navigation buttons, search dialog, loading skeleton
│   ├── edit/            # edit layer: toggle and toolbar controls, edit body, block borders and hover button groups, insert menu, editor chooser, floating bar and in-place editing primitives
│   ├── asset/           # asset service layer: the host resolving a reference, the loading/error stand-in, the asset panel popup and its preview
│   ├── service/         # service dashboards: their registry definition, their data, the frame, shared parts
│   ├── popup/           # block popup: the dialog of the page (DocBlockPopup) and the surface a component renders in (BlockPopupSurface)
│   ├── settings/        # settings button and panel (user overrides of page and component config keys, asset service layer, services)
│   ├── source/          # doc page source service layer ui: SourcePathInput (path with completion), SourceTreeSelect, SourcePathPicker (the two as one), SourceFilePrompt (file location)
│   ├── paste/           # the review of a paste
│   ├── block-select/    # block selection mode: its switch, the selectable block, the menu, the copy / move dialog
│   ├── block-list/      # BlockListReview, BlockPlacePicker: a list of blocks, a place for blocks
│   └── mdx-render/      # MdxRenderer, DynamicCodeBlock
├── package.json         # delegates dev/build to frontend/
├── service-backend/     # the service backend, a python program of its own (server.py, service_runtime.py, service_define.py)
└── frontend/            # Vite app + embeddable component
    ├── plugin/          # vite plugin: config load, the document entry and its yaml files (doc-entry.ts), rule scan and collect modes, source-step tags/config, source pruning, virtual module, watch, dev-only source api (in doc-source.ts), edit api (doc-edit-server.ts, doc-edit-lines.ts), the asset service layer and its api (doc-asset-store.ts, doc-asset-server.ts, id-ms48.ts), the service api forwarded to the backend (doc-service-server.ts)
    ├── UICommon.js      # package-local facade for shared visual components and icons
    ├── UICommonExternal.js # external UI-library exports used by the facade
    └── src/
        ├── DocPageMdx.jsx       # the embeddable doc page component
        ├── store/               # DocSourceStore (lower) + DocSourceFileStore + DocStore (upper) + DocTagStore + DocConfigStore + DocEditStore + DocAssetStore + DocServiceStore + DocBlockPopupStore
        └── lib/                 # mdx compile, nested Markdown renderer, doc-source-path (the path grammar), link classification and target resolution, remark plugins, page tree build, doc-tag-*, doc-config-*, doc-edit-* (block model, edit api client), doc-asset-* (reference, backends), doc-service-* (backend client, federation loader), doc-event (event router), framework adapter
```

Design documents: [doc page source service layer](doc_page_impl_source.md), [side panel](doc_page_impl_side_panel.md), [tag system](doc_page_impl_tag.md), [config system](doc_page_impl_config.md), [navigation](doc_page_impl_nav.md), [MDX components](doc_page_impl_mdx_comp.md), [components in lists](doc_page_impl_mdx_li.md), [multilingual content](doc_page_impl_multi-lang.md), [in-place editing](doc_page_impl_edit.md), [copy, move and paste](doc_page_impl_copy_paste.md), [asset service layer](doc_page_impl_asset.md), [service instances](doc_page_impl_service_instance.md), [block popup](doc_page_impl_popup.md), [event layer](doc_page_impl_event.md), [package usage](doc_page_impl_detail.md).

Run `pnpm install` from the workspace root once, then `pnpm dev` from either this folder or `frontend/`. `pnpm build` produces one static deployable artifact (docs bundled as lazy chunks); any static file server works, no doc folders needed at runtime.

## Avoid CSS Style Regression

- Keep the complete CSS baseline required by Fumadocs. Tailwind Preflight is required in addition to theme and utility layers; omitting it can expose browser-default link and heading styles.
- Disable standard and contextual font ligatures in document `pre` and `code` elements. Code samples must display punctuation sequences such as `<!--` and `-->` literally rather than replacing them with font glyphs such as arrows.
- Keep block spacing asymmetric: the upper margin of rendered code figures, `BlockSimple`, and `BlockMdx` is half of the lower margin so a preceding heading remains visually attached to its content.
- Import the package stylesheet once and load project-specific overrides after it. Scope overrides under the document page root instead of changing global element styles.
- Give the document page a host with a definite height. `.doc-page-mdx` is the vertical scroll container (`height: 100%; overflow: auto`), and every sticky part of the layout — side panel, local index, floating navigation and theme controls — sticks relative to it. If the host height is `auto` (for example an unstyled `#root`), the document page grows with its content and never scrolls; the window scrolls instead, all sticky parts scroll away, and the floating controls appear only at the end of the page, or briefly while a short document or the loading skeleton is shown. The standalone demo sets this height in `frontend/src/main.css`.
- Keep the three-column layout width-stable across document switching. The scrollbar of `.doc-page-mdx` is the variable to control: a short document or the loading skeleton drops it, the content width grows, and every layout column shifts. `DocPageMdx.css` reserves the gutter with `scrollbar-gutter: stable` on `.doc-page-mdx` itself. Headingless documents are already width-stable at desktop widths because the fumadocs TOC renders a hidden `#nd-toc-placeholder` that keeps `--fd-toc-width` reserved.
- Avoid broad selectors or CSS resets in embedded components. After changing the CSS pipeline, verify headings, links, code blocks, side panels, and scrolling in both the standalone demo and the embedded page.
- A component stylesheet that writes into a Tailwind cascade layer (`@layer utilities { … }`, as `DocEdit.css` does to restate prose margins) must first state the full layer order, `@layer theme, base, components, utilities;`. Component stylesheets are imported by their components and reach the document before the Tailwind entry does; the first `@layer` statement fixes the order of the layers it names, so a lone `@layer utilities` block would put `utilities` before `base` and let Preflight win over every utility class of the page (tight sidebar items, misplaced header icons, an unstyled search box). Stating the order first makes the component stylesheet independent of its import position.

General visual components, hooks, and icons from Fumadocs, Lucide, and the local shadcn set are imported through `frontend/UICommon.js`. `frontend/UICommonExternal.js` owns external-library exports, while `UICommon.js` adds local shared components. Specialized engines such as React Flow and build-time remark or rehype plugins remain direct imports because they are feature-specific or compiler dependencies rather than general UI primitives.

## Fumadocs features used

- Default theme (`neutral.css` + `preset.css`, same as fumadocs.dev) with the same fonts as fumadocs.dev — Geist + JetBrains Mono, bundled locally via fontsource so embedding needs no font CDN. Other stock palettes (`ocean.css`, `dusk.css`, ...) are a one-line swap in `frontend/src/style.css`.
- DocsLayout/DocsPage: sidebar, TOC with scroll tracking, breadcrumb, dark mode toggle.
- Shiki code blocks: diff / highlight / focus notations, code block titles, language icons.
- Search dialog UI + structured data extraction.
- Default mdx components: callout, cards, auto-anchored headings.
- UI components exposed through the registry: Tabs, Accordion, Steps, Files.
