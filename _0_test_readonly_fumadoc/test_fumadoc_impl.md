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

**Doc collection via vite plugin.** The plugin reads the two-layer config, executes the source rules, and generates a virtual module where every doc file is a lazy `?raw` import. Vite then gives both dev-time freshness (editing a doc reloads it; adding/removing files or editing config invalidates the manifest) and production bundling (docs are code-split into per-doc lazy chunks inside one deployable artifact).

## Can we keep fumadocs default components while owning link logic? (yes)

The MDX `components` mapping is per-tag. We spread `defaultMdxComponents` from `fumadocs-ui/mdx` (headings with anchors, shiki code blocks, callout, cards, tables...) and only inject `DocLink` + registry components. Sidebar, TOC, breadcrumb, search dialog are layout-level (`DocsLayout`/`DocsPage`) and unaffected. Code block features — diff (`[!code ++]`/`[!code --]`), line/word highlight, focus, `title="..."` — are default shiki transformers in fumadocs' rehype-code and keep working.

## Store design (two layers)

Follows the data-driven pattern of `react-comp-misc` (`comp_design.md`) and the two-layer split of `example_doc/frontend-store.md`, adapted to a readonly local source (no websocket/lock layer needed here):

- `DocSourceStore` (lower, content): `fileManifest`, `configDoc`, `rawByPath`, `compiledByPath` (status/Body/toc/error), `targetsByName` (doc index for link resolution), `structuredDataByPath` (search). API: `loadDoc(path)`, `resolveLink(target, fromPath)`, `searchDocs(query)`.
- `DocStore` (upper, view): `docCurrentPath`, `isDocLoading`, `linkDropdownOpenId` (which link's candidate-dropdown is open; one at a time, closes on outside click), page tree (computed), route mode + url sync. API: `navigate(path, hash)`, `init()`.

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

Non-md files get a display strategy by suffix (`fileDisplay` in config, suffix → code block language). The store synthesizes markdown: file name as title + one code block. Unknown suffixes fall back to a plain code block.

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

Resolution happens at render, not at compile — moving a file only changes the index, compiled content stays valid.

Link behavior is separated into recognition, resolution, visual rendering, and navigation. Applications can add/replace remark recognizers, provide `config.link.resolve`, provide a `data`/`config`/`onEvent` link renderer, and intercept link events before the default store navigation. The default renderer follows the same unified event contract as other data-driven components. See `frontend/README.md` for the public interface.

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

One runtime host normalizes every registry invocation. Normal MDX attributes remain concise authoring syntax and are converted into `data`; comment-marked blocks add `raw` and `lang`; side-panel display and panel components receive their corresponding data. Runtime fields such as component id, instance id, placement, source path, and side-panel item id are supplied through `config`. The supported placements are `mdx`, `commentBlock`, `sidePanelDisplay`, and `sidePanelPanel`.

## Side panel

`sidePanel.file` points to a yaml describing the tree. Folders and separators are free-form, so the panel need not mirror the file tree. A document can be selected by exact internal path, a path suffix, or file name. Name/suffix ambiguity selects the first source-order match and prepends a warning containing every match. `sourceFolder` expands any source subtree, while `sourceRoot` remains a shorthand for a complete root. If the tree is absent, one is generated from the complete file manifest.

Each leaf has a stable item id and its own route. The navigation index stores every item bound to each source file, allowing duplicate document items while link/search navigation consistently chooses the first item in tree order. A link to a source file omitted from the side panel reports an explicit navigation error instead of silently opening an unrepresented page.

```yaml
tree:
  - text: Example Docs
    display:
      component: NavLabel
      data: { badge: primary }
    children:
      - doc: /example/doc.md          # text defaults to page title
      - doc: database.md              # file-name lookup
        text: Database (renamed)      # ordinary custom display name
      - sourceFolder: /example/guides # mirror one folder subtree
        text: Guides
  - separator: MDX Tests
  - id: status-panel
    text: Status
    panel:
      component: StatusPanel
      data: { mode: compact }
  - doc: /mdx-test/index.mdx
```

`display.component` and `panel.component` use the same `compRegistry` and runtime `compById` registry as MDX. They receive the unified `{ data, config, onEvent }` props. Display text and file metadata are in `data`; panel item/runtime metadata are in `config`.

## Search

The search dialog UI comes from fumadocs-ui (composable `SearchDialog` parts plugged into `RootProvider`). The engine is a small client-side matcher over per-doc structured data (headings + paragraphs, extracted with fumadocs' `remarkStructure`), computed lazily on first search and cached. No server, works embedded.

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
