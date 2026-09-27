# @wwf971/react-doc

Reusable Vite + React document page for local Markdown, MDX, and source files.

## Consumer setup

Use only the package's public entries:

```js
// vite.config.js
import { docSourcePlugin } from '@wwf971/react-doc/vite';

docSourcePlugin({ configFile: './doc-mdx/config.yaml' });
```

```jsx
import { DocPageMdx } from '@wwf971/react-doc';
import '@wwf971/react-doc/style.css';
import { configDoc, fileManifest } from 'virtual:doc-source';

<DocPageMdx
  data={{ configDoc, fileManifest }}
  config={{ routeMode: 'memory', compById }}
  onEvent={onEvent}
/>;
```

The Vite plugin is build-time infrastructure. `DocPageMdx` is a runtime render component. It fills its host and scrolls internally, so the host element needs a definite height (for a full-window page: `html, body, #root { height: 100%; }`); otherwise the side panel, local index, and floating controls do not stay in view. External source files are bundled into the output and are not read from the file system after deployment.

## Configuration composition

The main YAML may keep source rules and side-panel structure in separate files:

```yaml
source:
  file: ./source.yaml
sidePanel:
  file: ./side-panel.yaml
```

A source file contains an ordered `rules` list. Its paths are relative to the source file. The side-panel tree format (documents, virtual folders, source folders, component panels, separators, `childrenFile` imports, tags) and the side-panel item renderer are described in [Side panel design](doc_page_side_panel.md). Tags and tag definitions (`tag.file` or `tag.defineById`) are described in [Tag system](doc_page_impl_tag.md). Feature switches (`globalConfig`, and per-document `config` in source rules, side-panel nodes, and frontmatter) are described in [Config system](doc_page_impl_config.md); an application adds its own keys through `DocPageMdx` `config.configDefineList`.

A valid source file that has no side-panel binding produces a visible navigation warning. `homeItem` selects the initial leaf by id; `homeDoc` remains supported and resolves through the same binding index.

The special target `@first/{tree-item-id}` resolves to the first document leaf below a folder item, skipping component-only leaves. It works through `DocStore.navigate()`, browser href generation, and ordinary Markdown links such as `[Open section](@first/guides)`.

## Application components

`config.compById` is the application-owned registry. YAML maps document tag names to stable component IDs:

```yaml
compRegistry:
  CustomerTable: project/CustomerTable
```

```js
const compById = {
  'project/CustomerTable': CustomerTable,
};
```

Package components and project components remain separate. Source files are displayed as source; they are never executed merely because they were collected.

The same merged registry is used by MDX tags, comment-marked blocks, custom sidebar labels, and component-backed panels. Components defined with `compDefine()` receive `{ data, config, onEvent }`; a plain-function display component receives `{ text, data }`, and a plain-function panel component receives `{ item, data }`.

Mapping the built-in name `SidePanelItem` in `compRegistry` replaces the label renderer of every side-panel item; mapping `Tag` replaces the default tag look; mapping `TagOverview` replaces the content of the tag overview popup.

Host settings needed by package components are passed once through `config.compConfigHost` and reach every registered component's `config`:

```jsx
<DocPageMdx
  data={{ configDoc, fileManifest }}
  config={{
    compById,
    compConfigHost: {
      assetUrlGet: (path) => attachmentUrlByPath[path] ?? path, // Image, ImageGrid, DiagramMermaid lane icons
      mermaidLoad: () => import('mermaid'),                    // DiagramMermaid
      panelComponent: PanelText,                               // popup frame: tag overview, SourceLink
    },
  }}
/>
```

## Link customization

Link handling has four replaceable layers:

1. Recognition: the default remark plugin recognizes Markdown links, file-like inline code, and wiki links. Disable it with `config.compile.isDefaultLinkRecognitionEnabled: false` and supply `config.compile.remarkPlugins` for a different syntax.
2. Resolution: set `config.link.resolve`. Return `{ targets, hash }`, or return nothing to use the default internal-path/name resolver.
3. Rendering: set `config.link.CompRender`. The package continues to own state and navigation while the application owns visual output.
4. Navigation policy: set `config.link.onEvent`, or handle root events through `DocPageMdx.onEvent`. The callback may be synchronous or asynchronous; return `{ isHandled: true }` to suppress default handling.

Set `config.link.Icon` to replace the default icon used by `LinkDocRender`.

### Link renderer interface

A link renderer follows the common `data`, `config`, `onEvent` contract:

- `data.displayContent`: React content to display.
- `data.targetRaw`, `data.fromPath`, `data.kind`, `data.hash`: recognized source data.
- `data.href`: browser href for the first candidate.
- `data.targetList`: resolved candidates with `internalPath`, `title`, and `name`.
- `data.titleText`: accessible tooltip text.
- `data.tagList`: tags of the single target, ready for `TagList`; empty when tags are not shown.
- `config.isBroken`, `config.isClickable`, `config.isMultiple`, `config.isDropdownOpen`, `config.isNavigationUnavailable`: accepted operational state.
- `config.tagsPosition`: `before`, `after`, or empty, resolved from the link title marker and the document config ([Tags beside links](doc_page_impl_tag.md#tags-beside-links)). The default renderer places the tags outside the clickable link.
- `onEvent('activateRequest', { event })`: request activation of the main link.
- `onEvent('candidateSelectRequest', { event, target })`: request navigation to one candidate.

The renderer must not mutate `data` or `config`. It emits attempts through the unified callback; the document stores or consumer decide whether to accept them. The package default is `LinkDocRender`, exported from the package root.

Custom remark recognizers should emit an MDX text element named `DocLink` with `target`, `from`, and `kind` attributes, and optionally `tagsDisplay` (`before`, `after`, `on`, `off`). This preserves the same resolution, rendering, and navigation pipeline.
