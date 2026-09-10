<!-- Implementation design for the fumadocs-based readonly doc system test. Requirement: ./test_fumadoc_req.md -->

# Fumadocs Test Environment: Design

This project renders local md/mdx folders as a doc website. The whole doc page is one embeddable React component (`DocPageMdx`), built with Vite, driven by mobx stores — no Next.js, no router framework. Everything is configured by `config.yaml` (+ local override `config.0.yaml`): which folders/files form the source, how the side panel looks, and which custom components docs can use.

```text
config.yaml (overlay config.0.yaml)
     │  read at dev/build time by a small vite plugin
     ▼
vite plugin "doc-source"
     ├── executes source rules ──► file manifest (multi-root: /{rootId}/relPath)
     │     each doc = lazy `?raw` import ──► dev: HMR reload on edit
     │                                       build: one lazy chunk per doc
     └── emits virtual module `virtual:doc-source` = { config, fileManifest }
     ▼
mobx stores (source of truth for rendering)
     ├── DocSourceStore (lower): manifest, raw/compile caches, doc index, search data
     └── DocStore (upper): current doc, navigation, link dropdown, url sync
     ▼
<DocPageMdx/>  (embeddable component)
     ├── FrameworkProvider adapter: usePathname/useRouter/Link backed by DocStore
     └── fumadocs-ui: RootProvider + DocsLayout (sidebar) + DocsPage (toc, breadcrumb)
           body = mdx compiled in browser (@mdx-js/mdx + fumadocs runtime preset)
```

## Key choices

**Embeddable component, own "framework" adapter.** fumadocs-ui works without any framework: `FrameworkProvider` from `fumadocs-core/framework` only needs `usePathname`, `useRouter` ({push, refresh}) and a `Link` component. These are implemented on top of `DocStore`, so navigation is plain mobx state. Standalone mode syncs the current doc to the page url as a `?doc=` query param (heading anchors keep native `#hash` behavior); embedded/memory mode skips url sync entirely. A consumer app renders `<DocPageMdx data={...} config={...} onEvent={...}/>`.

**Runtime compile in browser, not build-time mdx.** `fumadocs-mdx` needs one content dir known to the bundler and cannot express the rule-based multi-root source. Instead docs are shipped as raw text (lazy chunks) and compiled in the browser on first visit: `@mdx-js/mdx` with `mdxPreset()` from `fumadocs-core/content/mdx/preset-runtime`, which applies the same default plugins the official setup uses (shiki code blocks, heading anchors + toc, gfm, structured data for search). Compile results are cached per doc in the store. Local docs are trusted content, so runtime evaluation is acceptable here.

**`.md` vs `.mdx`.** `.mdx` compiles with format `mdx` (JSX allowed). `.md` and everything else compiles with format `md`, so plain markdown containing `<xxx>` or `{}` text never breaks. Remark plugins can inject JSX nodes in both formats, which is how links/components get special rendering even in plain md.

**Multilingual content.** Language inheritance, document-wide selection, headings, paragraphs, lists, degradation behavior, and file naming are specified in [test_fumadoc_impl_multi-lang.md](./test_fumadoc_impl_multi-lang.md).

**Doc collection via vite plugin.** The plugin reads the two-layer config, executes the source rules, expands side-panel subtree files, and generates a virtual module where every doc file is a lazy `?raw` import. Vite then gives both dev-time freshness (editing a doc reloads it; adding/removing files or editing config or any imported side-panel yaml invalidates the manifest) and production bundling (docs are code-split into per-doc lazy chunks inside one deployable artifact).

## Can we keep fumadocs default components while owning link logic? (yes)

The MDX `components` mapping is per-tag. We spread `defaultMdxComponents` from `fumadocs-ui/mdx` (headings with anchors, shiki code blocks, callout, cards, tables...) and only inject `DocLink` + registry components. Sidebar, TOC, breadcrumb, search dialog are layout-level (`DocsLayout`/`DocsPage`) and unaffected. Code block features — diff (`[!code ++]`/`[!code --]`), line/word highlight, focus, `title="..."` — are default shiki transformers in fumadocs' rehype-code and keep working.

## Store design (two layers)

Follows the data-driven pattern of `react-comp-misc` (`comp_design.md`) and the two-layer split of `example_doc/frontend-store.md`, adapted to a readonly local source (no websocket/lock layer needed here):

- `DocSourceStore` (lower, content): `fileManifest`, `configDoc`, `rawByPath`, `compiledByPath` (status/Body/toc/error), `targetsByName` (doc index for link resolution), `structuredDataByPath` (search). API: `loadDoc(path)`, `resolveLink(target, fromPath)`, `searchDocs(query)`.
- `DocStore` (upper, view): `docCurrentPath`, `isDocLoading`, `linkDropdownOpenId` (which link's candidate-dropdown is open; one at a time, closes on outside click), page tree (computed), route mode + url sync. API: `navigate(path, hash)`, `navigationBack()`, `navigationUp()`, `navigationForward()`, `init()`.

Render components observe stores via context and submit change attempts through store APIs; no component talks to the file system or compiler directly.

## Source rules

`source` in config is an ordered rule list executed against a growing file set. It can also be `{ file: './source.yaml' }`; the referenced file contains the ordered `rules` list and resolves paths relative to itself:

```yaml
source:
  - action: addFolder      # scan folder recursively, becomes one root
    rootId: example
    path: ../example_doc
  - action: addFile        # one file becomes one root
    rootId: req
    path: ./test_fumadoc_req.md
  - action: removeByName   # glob against file name
    pattern: "*.pyc"
  - action: removeByPath   # glob against internal path /{rootId}/relative/path
    pattern: "/example/private/**"
```

Paths are relative to the config file. Internal representation of every file is `/{rootId}/relPath`, so same-name root folders never clash. `addFile` after a remove rule re-adds a single file (the "remove folder except one file" case in the requirement).

### External source files

Source paths may point outside the application project. Use `addFile` for one external document or `addFolder` for an external document tree:

```yaml
- action: addFile
  rootId: external-guide
  path: ../../shared-docs/guide.md
```

The collected file has the internal path `/external-guide/guide.md`. Add that path to the side panel when the document should be directly navigable. The Vite development server must also allow the external folder; keep the allowed scope as narrow as practical.

Non-md files get a display strategy by suffix (`fileDisplay` in config, suffix → code block language). The store synthesizes markdown: file name as title + one code block. Unknown suffixes fall back to a plain code block.

### Build-only component attachment collection

Some document components refer to attachment files through authored properties rather than ordinary markdown image syntax. Those files can be removed by deployment source pruning even though the document that needs them remains. Enable the optional collection layer with a boolean in `config.yaml`:

```yaml
collectComponentAttachmentsOnBuild: true
```

The layer runs only for a Vite build. It scans every md/mdx document remaining in the collected manifest, asks registered attachment finders for component-specific references, resolves each reference against the complete source set (before side-panel pruning), and bundles the resolved file. Development mode does not run this scan and keeps its existing direct-file behavior.

The default finders recognize `DocDiagramMermaid`'s `laneIcons` property, `DocImage`'s `src` value in its YAML block, and image `src` values in a `DocImageGrid` YAML block. Direct MDX component properties are also recognized where applicable. For example, all four PNG files in the following value are retained even if they are not otherwise present in the pruned deployment manifest:

```text
laneIcons=Mda:doc-aux/image/icon-mda.png|Data:doc-aux/image/icon-dataverse.png|Flow:doc-aux/image/icon-powerautomate.png|Agent:doc-aux/image/icon-copilot studio.png
```

Collected attachments are exported by `virtual:doc-source` as `attachmentUrlByPath`. They are represented as data URLs so a deployment that packages the JavaScript artifact but does not preserve separate Vite image outputs still contains the attachment. The consuming application's `assetUrlGet` should check this map before its development fallback.

Component recognition is decoupled from the source-rule scanner. Additional component-specific finders can be passed through the Vite plugin's `attachmentFinderList` option; each finder receives the document text, document paths, and merged config, and returns attachment path strings. Missing references produce a build warning containing the source document path. The feature defaults to off when the boolean is absent or false.

## Link recognition / rendering / navigation

One remark plugin (`remarkDocLink`) recognizes three patterns and rewrites each into a `DocLink` JSX node:

- normal links `[text](target.md)` — external `http(s)://`, `mailto:` and pure `#hash` urls are skipped;
- inline code whose value looks like a doc file name/path, e.g. `` `a.md` ``;
- obsidian style `[[a.md]]` inside plain text.

`DocLink` resolves the target at render time against the doc index (file name → candidate list):

```text
target form                resolution
/rootId/xx/a.md            exact internal path
./sub/a.md, ../a.md        relative to current doc (plugin attaches source path)
a.md  (bare name)          doc index lookup by file name
                             ├─ 1 match  → navigate
                             ├─ N matches → dropdown listing candidates (click outside closes)
                             └─ 0 match  → rendered as broken link, not clickable
```

Every document target form can append a fragment, for example `/rootId/xx/a.md#configuration`. `DocSourceStore.resolveLink()` separates the document path from the fragment and resolves only the path. `DocLink` then submits the resolved side-panel route and fragment to `DocStore.navigate()`. The store records `{ route, hash }` together in navigation history and synchronizes the hash in query mode. Each successful call also increments `navigationRequestVersion`. This signal is separate from path and hash because selecting an already-current index destination leaves both values unchanged; `DocPageView` observes the signal so every request reruns destination behavior. A repeated document-only request therefore resets vertical scrolling to the top, while a repeated document-plus-fragment request realigns and highlights its place again without adding a duplicate history entry.

Every navigation request first resets the rendered article, each ancestor in its document content scroll chain, and the browser scrolling element to the top in a layout effect, so embedded hosts cannot preserve an earlier offset in an outer container. Browser scroll anchoring is disabled on the document viewport. For a fragment target, `DocPageView` retries briefly until the matching element is mounted, explicitly calculates its position within the document viewport, and applies `doc-navigation-target`; `DocPageMdx.css` gives that destination a full-content-width yellow line until the next document/place navigation rather than highlighting only the heading text. Alignment is applied immediately and once more after the browser layout phase. Pending images above the destination trigger another alignment when they finish loading, preventing screenshot layout shifts from moving the requested heading away from the viewport. As a compatibility fallback, if the matched id belongs to an empty anchor element, the first following content element is highlighted instead. The same target string is accepted by the default `navigateRequest` handling for registered components, so indexes and application-specific visual navigation components do not bypass centralized history.

Plain `.md` documents can author a stable heading destination by placing `<span id="configuration"></span>` immediately before the heading. Raw HTML is intentionally omitted by the `format: 'md'` runtime compiler, so leaving that marker untreated would make fragment lookup fail and leave navigation at the document top. `remarkStableHeadingAnchor` recognizes only this narrow standalone marker form, transfers its id to the following heading's `hProperties.id`, and removes the marker paragraph. This keeps the stable authored fragment on the visible heading without enabling general MDX syntax in Markdown; the heading itself is therefore both the scroll destination and the highlighted element.

Resolution happens at render, not at compile — moving a file only changes the index, compiled content stays valid.

Link behavior is separated into recognition, resolution, visual rendering, and navigation. Applications can add/replace remark recognizers, provide `config.link.resolve`, provide a `data`/`config`/`onEvent` link renderer, and intercept link events before the default store navigation. The default renderer follows the same unified event contract as other data-driven components. See `frontend/README.md` for the public interface.

When a resolved source document is not represented in the side panel, `DocLink` does not submit an already-known invalid route to `DocStore.navigate()`. Activating the link opens a dismissible warning tooltip positioned from that link's controller. Unexpected failures returned by `navigate()` are transferred from the store to the same local tooltip and the page-level error is cleared. The tooltip closes when the user dismisses it, clicks outside the link controller, changes the link target, or completes a valid navigation. Keeping this feedback local preserves the reader's scroll position and identifies the exact invalid link without showing a detached warning at the top of the document.

Fumadocs wraps heading text in hash anchors. Dragging to select a heading can still emit a click on pointer release and unexpectedly scroll that heading to the top. `DocPageMdx` tracks pointer movement and the browser selection, then cancels only the heading-anchor click produced by a selection drag; ordinary anchor clicks and the separate copy-link button remain available.

## Graceful degradation stipulation

A second remark plugin (`remarkCommentComp`) scans HTML comment nodes of the form `<!--renderComp=StockTable,a=b-->`. When such a comment directly precedes a code block or a table, that node is replaced by the registered component, receiving the raw block text plus the comment's key=value props. A normal markdown renderer just ignores the comment and shows the plain block — that is the degradation path.

HTML comments only exist in md-format parsing; that is exactly the degradation-compatible style. In `.mdx`, authors write `<Comp a="b" />` directly (the more common style), through the same registry.

## Component registry

`compRegistry` in config maps doc-visible tag names to component ids. General Fumadocs components come from the package registry; project-specific components are supplied by the consuming application through `config.compById`:

```yaml
compRegistry:
  Tabs: common/Tabs        # re-exported fumadocs-ui components
  Callout: common/Callout
  StockTable: specific/StockTable   # project-specific components
```

Config decides what doc authors can use; code decides what exists.

All registered render components use the same top-level props: `{ data, config, onEvent }`. `data` contains semantic content, `config` contains operation state and runtime context, and `onEvent(eventType, eventData)` submits interaction requests. The internal shape of `data` and `config` remains component-specific. Components with meaningful mutable operation state can use `CompStateStore` or their own MobX store; simple components can remain stateless.

Registry values are component definitions created with `compDefine()`. A definition provides `CompRender`, and can also provide supported placements and an input converter. Fumadocs-native components use adapters created with `compNativeDefine()`, so their framework-specific props do not become the public contract for project components.

Multilingual component registration and authoring rules are specified in [test_fumadoc_impl_multi-lang.md](./test_fumadoc_impl_multi-lang.md).

One runtime host normalizes every registry invocation. Normal MDX attributes remain concise authoring syntax and are converted into `data`; comment-marked blocks add `raw` and `lang`; side-panel display and panel components receive their corresponding data. Runtime fields such as component id, instance id, placement, source path, and side-panel item id are supplied through `config`. The supported placements are `mdx`, `commentBlock`, `sidePanelDisplay`, `sidePanelPanel`, `partIndex`, and `indexSubtopic`.

### Isolate temporary rendering DOM

Components and third-party libraries sometimes create temporary DOM to measure, transform, or serialize content before displaying the final result. Temporary elements must not be mounted directly under `document.body` without containment. Large intermediate content can briefly change the body dimensions, trigger a window-level scrollbar, and shift the page horizontally even when the final component is correctly clipped inside its own viewport.

Keep temporary rendering DOM inside a host owned by the component that performs the rendering. The host should remain mounted for the complete asynchronous operation and be fixed or absolutely positioned, zero-sized, clipped, hidden, non-interactive, and layout-contained. Insert only the completed output into the visible component. Fix overflow at the level where it is created: reserving a gutter on a nested document scroller cannot prevent temporary elements attached to `document.body` from changing window overflow.

Mermaid is one example. `mermaid.render(id, source)` appends temporary rendering elements to `document.body` when its optional container is omitted. `DocDiagramMermaid` therefore passes a dedicated contained host as the third argument to `mermaid.render()`. Mermaid measures and serializes the SVG inside that host, then the component inserts the completed SVG into the visible diagram viewport. Diagrams default to `fit` mode so all content is visible, with a temporary toolbar toggle for original-size `intrinsic` mode. The same isolation principle applies to charting, diagram, export, rich-text, and measurement libraries that create off-screen or temporary DOM.

## Side panel

`sidePanel.file` points to a yaml describing the tree. Folders and separators are free-form, so the panel need not mirror the file tree. A document can be selected by exact internal path, a path suffix, or file name. Name/suffix ambiguity selects the first source-order match and prepends a warning containing every match. `sourceFolder` expands any source subtree, while `sourceRoot` remains a shorthand for a complete root. If the tree is absent, one is generated from the complete file manifest.

A folder node can move its children to another yaml through `childrenFile`. The referenced path is relative to the yaml file containing that node, and the referenced file must contain a `tree` list. The Vite plugin recursively expands imported trees before page-tree conversion, so runtime code receives the same inlined `children` shape as an ordinary tree. Imported children are placed before any local `children`, allowing a node to add a few local entries after a shared subtree.

```yaml
# side-panel.yaml
tree:
  - id: codeapp-development
    text: CodeApp development
    doc: /codeapp-dev/doc/codeapp-doc.md
    childrenFile: ./side-panel-codeapp.yaml
```

```yaml
# side-panel-codeapp.yaml
tree:
  - text: Dataverse
    doc: /codeapp-dev/doc/codeapp-dataverse.md
  - text: Local development
    doc: /codeapp-dev/doc/codeapp-test-local.md
```

Imported files can use `childrenFile` again. Import cycles, missing files, a non-string `childrenFile`, and files without a `tree` list are configuration errors with the relevant file path. All recursively imported files are added to the development-server watch set. When an import is added while the server is running, editing the containing yaml refreshes the watch set and reloads the generated manifest.

### Semantic parts and hosted indexes

A side-panel node becomes a part root when it has a `part` mapping. An explicit node `id` is required because the part identity and its index document reference must remain stable when tree order changes. Membership is inherited by every descendant, including descendants expanded from `childrenFile`; a nested part root replaces the inherited part for its own subtree.

```yaml
tree:
  - id: guide-part
    text: Guide
    doc: /guide/overview.md
    part:
      index:
        docId: guide-part
        componentId: guide-main-index
    children:
      - doc: /guide/setup.md
```

The referenced document marks the queryable component with a stable authored id:

````markdown
<!--renderComp=DocIndex,id=guide-main-index-->
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

The right-side local-index slot is wrapped by `DocPageToc`. Outside a configured part, when globally disabled, or when no segmented-control implementation is injected, it delegates directly to the native Fumadocs TOC. Inside a configured part, a segmented control switches between **On this page** and **In this part**, with **In this part** as the initial mode. Both modes retain the native Fumadocs TOC shell; part mode replaces its inner heading list rather than replacing the shell, so the layout's right-column width remains stable while switching. `DocStore.partIndexContentMode` is one global page/part selection that survives document and part navigation, while docked/floating mode can remain keyed by part id. The host loads the referenced document on demand and renders the referenced component through `RegisteredComp`, preserving component normalization, placement checks, and the common `{ data, config, onEvent }` boundary.

For `partIndex` placement, the index receives host-only display-mode configuration. Its left-aligned title and display-mode control use a wrapping row, allowing the control to move below a long title. The segmented control emits a `displayModeChange` request, and the host submits that request to `DocStore`. The hosted TOC shell uses content height and visible overflow instead of an internal vertical viewport, so the document page remains the vertical scrolling surface. In `floating` mode the same component instance is rendered through a `document.body` portal, positioned at the top right, and assigned the application overlay stack maximum so it cannot pass below the side panel while being dragged. It has no internal vertical scrollbar. Ordinary `mdx` and `commentBlock` placements receive no display-mode control. `DocLink` exposes whether its resolved source path and fragment exactly match the current document and place; index-item styling therefore highlights only the item for that exact destination and clears the prior item on subsequent navigation. On the part-root document, host state instead gives the index title the yellow current marker.

An index item defaults to `kind: document`. With `kind: inline-link`, it renders the reusable `SourceLink` component rather than owning source-popup behavior. `SourceLink` is independent of `DocIndex`: it accepts a collected internal source path and label through the unified `{ data, config, onEvent }` interface, loads the source through `DocSourceStore.loadRaw()`, and owns a `CodeBlockCompactStore`. `CodeBlockCompactPopup` remains the shared implementation for the panel, syntax-highlighted body, copy operation, close event, and Escape-key behavior. Source-link targets do not need side-panel entries.

MDX can invoke the registered component directly. Plain Markdown uses the ordinary degradation-compatible comment-block form; the marked fenced block supplies a visible fallback and can also supply the target from its first line when an explicit `target` property is absent. Registered custom components can compose the same `SourceLink` renderer and provide the host's `panelComponent`, so source viewing does not depend on index data or placement.

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

#### Hosted-index navigation subscription

Navigation observation is a scoped runtime service rather than a global callback list. The hosted-index boundary creates one stable `navigation` channel for the index of `DocStore.partCurrent` and supplies it through runtime `config` to the `partIndex` component. `DocIndex` forwards the same channel to registered `indexSubtopic` components. It is not added to authored data and does not expose `DocStore` itself.

The channel has this conceptual interface:

```text
navigation.getSnapshot()
  -> { requestVersion, route, itemId, docPath, hash }

navigation.subscribe(listener)
  -> unsubscribe

navigation.isTargetCurrent(target, { fragmentMode: "exact" | "ignore" })
  -> boolean
```

`getSnapshot()` returns an immutable snapshot. `requestVersion` comes from `DocStore.navigationRequestVersion`, so selecting an already-current destination still produces a distinct snapshot. `isTargetCurrent()` delegates to the document store's route resolution and lets a visual index compare by complete document-and-fragment destination or by document only. Consumers therefore do not strip fragments or resolve side-panel aliases themselves. `subscribe()` follows ordinary external-store semantics: it returns an idempotent cleanup function, and a component can consume it through a small `useSyncExternalStore` adapter. Components that never subscribe perform no navigation-specific computation.

`DocStore.navigate()` publishes only after a target has resolved and `routeCurrentPath`, `itemCurrentId`, `docCurrentPath`, `docCurrentHash`, and `navigationRequestVersion` have been updated. Back, Forward, Up, browser-history restoration, links, and component `navigateRequest` events all pass through that boundary and therefore produce the same notification. An invalid target leaves the current-location snapshot unchanged and is reported through the existing navigation-error path.

The current part's hosted-index runtime remains mounted when `partIndexContentMode` changes from `part` to `page`; only its presentation is hidden. This preserves opt-in subscriptions and current-section state while **On this page** is selected. The runtime is keyed by the stable part id plus the referenced document/component ids. A change to any of those keys unmounts the old runtime, runs subscription cleanup, and creates the new current part's runtime. No runtime is created for indexes belonging to other parts, and ordinary `mdx` or `commentBlock` index placements receive no hosted navigation channel. Docked and floating presentations share the same runtime and channel.

A mini-map subtopic subscribes once and stores only its derived selected-section id. On each notification it compares the current destination with the section's primary target and any subordinate targets, using document-level matching when a target fragment merely identifies the entry point. Selection precedence belongs to that mini-map: a directly matching child section is preferred over its parent, a subordinate-link match selects its containing section, and otherwise the first match in authored order wins. The generic index host knows nothing about mini-map sections; it only owns channel scope, navigation snapshots, target matching, and cleanup.

The global semantic config is:

```yaml
partIndex:
  isEnabled: true
  isFloatingEnabled: true
```

Both flags default to `true`. `isEnabled: false` leaves declarations intact but restores the ordinary page TOC everywhere. `isFloatingEnabled: false` keeps the page/part switch while omitting the docked/floating control.

Each document item has a stable item id and its own route. This includes a non-leaf item that has both `doc` and `children`: it is emitted as a Fumadocs folder with its document as the native folder `index`. The navigation index stores every item bound to each source file, allowing duplicate document items while link/search navigation consistently chooses the first item in tree order. A link to a source file omitted from the side panel reports an explicit navigation error instead of silently opening an unrepresented page.

An indexed folder is ordered before its descendants. Fumadocs uses the same order for the bottom previous/next cards, so the folder document's next page is its first child and the first child's previous page is the folder document. Breadcrumbs show the indexed folder as the current page when its document is open, and as a link when a descendant is open. `@first/{itemId}` resolves to the folder's own document when it has one; for a virtual folder it continues to resolve to the first descendant document.

The shared `DocNavigationButtons` renders three navigation actions in both the document toolbar and the floating controls, ordered Back, Forward, and Up:

1. **Back**

  `DocStore.navigationBack()` moves to the previous history entry. Memory mode moves through the internal history list, while query mode delegates to browser history.

2. **Forward**

  `DocStore.navigationForward()` moves to the next history entry through the same mode-specific history mechanism. A normal navigation after moving back truncates the forward branch.

3. **Up**

  The page-tree model builds an `itemAboveById` index. A folder's own document is its first document. Otherwise only the first-child chain is followed recursively; if that chain has no document, the folder's first document is null and later siblings are not considered. For each document item, the index walks containing folders from nearest to root and chooses the first non-null first document whose source path differs from the current document. `DocStore.navigationUp()` submits that item's route through the ordinary `navigate()` boundary, so the move participates in the same history and URL synchronization as a link or sidebar navigation. Up is disabled when the index has no target.

```yaml
tree:
  - id: section-example
    text: Example section
    doc: /guide/overview.md           # folder index: this item also opens a document
    display:
      component: NavLabel
      data: { badge: primary }
    children:
      - doc: /guide/start.md           # text defaults to page title
      - doc: reference.md              # file-name lookup
        text: Reference (renamed)      # ordinary custom display name
      - sourceFolder: /guide/topics    # mirror one folder subtree
        text: Topics
  - separator: Examples
  - id: status-panel
    text: Status
    panel:
      component: StatusPanel
      data: { mode: compact }
  - doc: /mdx-test/index.mdx
```

`display.component` and `panel.component` use the same `compRegistry` and runtime `compById` registry as MDX. They receive the unified `{ data, config, onEvent }` props. Display text and file metadata are in `data`; panel item/runtime metadata are in `config`.

The indexed-folder interaction uses a small sidebar folder override around Fumadocs primitives. Selecting an inactive label navigates through the framework adapter to `DocStore.navigate()` without changing the folder's collapse/expand state. Selecting the now-active label toggles that state, so a double click naturally navigates and then toggles. Selecting the chevron toggles without navigating. UI event handling therefore stays in the sidebar and route/history changes stay in the store. Consumers can replace this gesture policy through runtime `config.sidePanel.components.Folder` (forwarded to `DocsLayout.sidebar`) without replacing source resolution or navigation history logic.

## Search

The search dialog UI comes from fumadocs-ui (composable `SearchDialog` parts plugged into `RootProvider`). The engine is a small client-side matcher over per-doc structured data (headings + paragraphs, extracted with fumadocs' `remarkStructure`), computed lazily on first search and cached. Custom components can contribute semantic index entries through Fumadocs structured-data node metadata; multilingual extraction is specified in [test_fumadoc_impl_multi-lang.md](./test_fumadoc_impl_multi-lang.md). Search results are grouped below a contextual page row whose label and route are normalized through the configured side-panel tree. Manifest title extraction ignores heading-looking lines inside fenced code blocks. No server, works embedded.

## Layout on disk

```text
_0_test_readonly_fumadoc/
├── config.yaml          # example config (tracked), actually runnable
├── config.0.yaml        # local override (untracked), entries overlay config.yaml
├── side-panel.yaml      # side panel tree, referenced from config
├── testdata_mdx/        # mdx test data: components, code diff, link cases
├── package.json         # delegates dev/build to frontend/
└── frontend/            # Vite app + embeddable component
    ├── plugin/          # vite plugin: config load, rule scan, virtual module, watch
    └── src/
        ├── DocPageMdx.jsx       # the embeddable doc page component
        ├── store/               # DocSourceStore (lower) + DocStore (upper)
        ├── lib/                 # mdx compile, remark plugins, page tree build, framework adapter
        └── comp-doc/            # DocLink + registry components (common/, specific/)
```

Run `npm install` in `frontend/` once, then `npm run dev` from either this folder or `frontend/`. `npm run build` produces one static deployable artifact (docs bundled as lazy chunks); any static file server works, no doc folders needed at runtime.

## Avoid CSS Style Regression

- Keep the complete CSS baseline required by Fumadocs. Tailwind Preflight is required in addition to theme and utility layers; omitting it can expose browser-default link and heading styles.
- Import the package stylesheet once and load project-specific overrides after it. Scope overrides under the document page root instead of changing global element styles.
- Avoid broad selectors or CSS resets in embedded components. After changing the CSS pipeline, verify headings, links, code blocks, side panels, and scrolling in both the standalone demo and the embedded page.

## Fumadocs features used

- Default theme (`neutral.css` + `preset.css`, same as fumadocs.dev) with the same fonts as fumadocs.dev — Geist + JetBrains Mono, bundled locally via fontsource so embedding needs no font CDN. Other stock palettes (`ocean.css`, `dusk.css`, ...) are a one-line swap in `frontend/src/style.css`.
- DocsLayout/DocsPage: sidebar, TOC with scroll tracking, breadcrumb, dark mode toggle.
- Shiki code blocks: diff / highlight / focus notations, code block titles, language icons.
- Search dialog UI + structured data extraction.
- Default mdx components: callout, cards, auto-anchored headings.
- UI components exposed through the registry: Tabs, Accordion, Steps, Files.
