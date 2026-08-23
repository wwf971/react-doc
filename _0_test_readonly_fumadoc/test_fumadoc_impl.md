<!-- Implementation design for the fumadocs-based readonly doc system test. Requirement: ./test_fumadoc_req.md -->

# Fumadocs Test Environment: Design

This project renders local md/mdx folders as a doc website. The whole doc page is one embeddable React component (`DocApp`), built with Vite, driven by mobx stores — no Next.js, no router framework. Everything is configured by `config.yaml` (+ local override `config.0.yaml`): which folders/files form the source, how the side panel looks, and which custom components docs can use.

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
<DocApp/>  (embeddable component)
     ├── FrameworkProvider adapter: usePathname/useRouter/Link backed by DocStore
     └── fumadocs-ui: RootProvider + DocsLayout (sidebar) + DocsPage (toc, breadcrumb)
           body = mdx compiled in browser (@mdx-js/mdx + fumadocs runtime preset)
```

## Key choices

**Embeddable component, own "framework" adapter.** fumadocs-ui works without any framework: `FrameworkProvider` from `fumadocs-core/framework` only needs `usePathname`, `useRouter` ({push, refresh}) and a `Link` component. These are implemented on top of `DocStore`, so navigation is plain mobx state. Standalone mode syncs the current doc to the page url as a `?doc=` query param (heading anchors keep native `#hash` behavior); embedded/memory mode skips url sync entirely. A consumer app just renders `<DocApp sourceData={...}/>`.

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

`source` in config is an ordered rule list executed against a growing file set:

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

## Graceful degradation stipulation

A second remark plugin (`remarkCommentComp`) scans HTML comment nodes of the form `<!--renderComp=StockTable,a=b-->`. When such a comment directly precedes a code block or a table, that node is replaced by the registered component, receiving the raw block text plus the comment's key=value props. A normal markdown renderer just ignores the comment and shows the plain block — that is the degradation path.

HTML comments only exist in md-format parsing; that is exactly the degradation-compatible style. In `.mdx`, authors write `<Comp a="b" />` directly (the more common style), through the same registry.

## Component registry

`compRegistry` in config maps doc-visible tag names to component ids; components live in `frontend/src/comp-doc/` and are collected in one `compById` map:

```yaml
compRegistry:
  Tabs: common/Tabs        # re-exported fumadocs-ui components
  Callout: common/Callout
  StockTable: specific/StockTable   # project-specific components
```

Config decides what doc authors can use; code decides what exists.

## Side panel

`sidePanel.file` points to a yaml describing the tree; nodes reference docs by internal path, folders/separators are free-form, so the panel need not mirror the file tree. If absent, a tree auto-generated from the file manifest (per root, following folder structure) is used.

```yaml
tree:
  - text: Example Docs
    children:
      - doc: /example/doc.md          # text defaults to page title
      - doc: /example/database.md
        text: Database (renamed)
  - separator: MDX Tests
  - doc: /mdx-test/index.mdx
```

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
└── frontend/            # Vite app + embeddable component (in pnpm workspace)
    ├── plugin/          # vite plugin: config load, rule scan, virtual module, watch
    └── src/
        ├── DocApp.jsx           # the embeddable doc page component
        ├── store/               # DocSourceStore (lower) + DocStore (upper)
        ├── lib/                 # mdx compile, remark plugins, page tree build, framework adapter
        └── comp-doc/            # DocLink + registry components (common/, specific/)
```

`pnpm run dev` works both here and in `frontend/`. `pnpm build` produces one static deployable artifact (docs bundled as lazy chunks); any static file server works, no doc folders needed at runtime.

## Fumadocs features used

- Default theme (`neutral.css` + `preset.css`, same as fumadocs.dev) with the same fonts as fumadocs.dev — Geist + JetBrains Mono, bundled locally via fontsource so embedding needs no font CDN. Other stock palettes (`ocean.css`, `dusk.css`, ...) are a one-line swap in `frontend/src/style.css`.
- DocsLayout/DocsPage: sidebar, TOC with scroll tracking, breadcrumb, dark mode toggle.
- Shiki code blocks: diff / highlight / focus notations, code block titles, language icons.
- Search dialog UI + structured data extraction.
- Default mdx components: callout, cards, auto-anchored headings.
- UI components exposed through the registry: Tabs, Accordion, Steps, Files.
