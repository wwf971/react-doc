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

In-place editing on the development server is enabled by passing the edit api url the virtual module exports: `config={{ ..., edit: { endpoint: docEditEndpoint } }}` with `import { docEditEndpoint } from 'virtual:doc-source'`. It is an empty string in a build, so the deployed page has no edit mode ([In-place editing](doc_page_impl_edit.md)).

The asset service layer ([Asset service layer](doc_page_impl_asset.md)) needs `asset.file` in `config.yaml`, naming the store's config file with its `folderList` ([the local store](doc_page_impl_asset.md#the-local-store-folders-fully-reflected)), and two more values of the virtual module: `data={{ ..., assetSnapshot }}` (the objects bundled into a build, `null` in development) and `config={{ ..., asset: { endpoint: docAssetEndpoint, subscribe: subscribeDocAsset } }}` (the asset api of the development server and its change feed, both inert in a build). The asset panel is framed by `config.compConfigHost.panelComponent`, like the tag overview; without it the frame shows the asset and has no button.

Service instances ([Service instances](doc_page_impl_service.md)) need `service.backend` in `config.yaml`, the address of the service backend (and optionally `service.backendConfigFile`, the backend's config, whose folders are then not documents), and the endpoint the virtual module exports: `config={{ ..., service: { endpoint: docServiceEndpoint } }}`. It is an empty string in a build, so a deployed page has no backend and its dashboards say so. The backend is a separate program (`python3 main/service-backend/server.py --config …`), started and stopped on its own.

A host that embeds the page checks these when it takes a new version, because none of them fails at build time:

- **Components it maps.** A component is used in documents by the name `compRegistry` maps to its id (`ExcelUniver: common/ExcelUniver`); importing the component does not register it.
- **Host settings of components.** `compConfigHost.univerLoad` for `ExcelUniver` (the Univer packages, preset, locale and css are dependencies of the host and are loaded lazily by it; `frontend/src/univer-load.js` is the reference loader), `mermaidLoad` for `DiagramMermaid`, `panelComponent` for the popups ([the panel contract](doc_page_impl.md#the-panel-contract); its maximize fields for the [block popup](doc_page_impl_popup.md)).
- **The asset section.** `asset.file` and the store's config file, as above; a former `asset.folder` stops the development server with the migration ([configuration](doc_page_impl_asset.md#the-local-store-folders-fully-reflected)).
- **A restart after enabling the asset service layer.** The asset api is installed when the development server starts; a server started before `asset.file` was added keeps a page without a store until it is restarted.

The Vite plugin is build-time infrastructure. `DocPageMdx` is a runtime render component. It fills its host and scrolls internally, so the host element needs a definite height (for a full-window page: `html, body, #root { height: 100%; }`); otherwise the side panel, local index, and floating controls do not stay in view. External source files are bundled into the output and are not read from the file system after deployment.

## Configuration composition

`config.yaml` holds the settings of the page and names the document it shows through the document's entry file:

```yaml
# config.yaml
docEntry:
  file: ./doc/guide-entry.yaml
```

```yaml
# doc/guide-entry.yaml
docEntry:
  title: Guide
  homeDoc: /guide/overview.md
source:
  file: ./source.yaml           # or the rule list inline
tag:
  file: ./tag.yaml              # or defineById inline
sidePanelById:
  main:
    file: ./side-panel.yaml     # or { root?, tree } inline
```

The entry (named `xxx-entry.yaml` by convention) declares the source rules, the tag definitions, and the side panels of the document; each section can stay inline or move to a file of its own, and a side-panel node includes the side panel of another entry through `include`, so a document is composed of self-contained documents that are each deployable alone by naming their entry in `config.yaml`. The grammar is specified in [The document entry](doc_page_impl_side_panel.md#the-document-entry); the side-panel tree format (documents, virtual folders, source folders, component panels, separators, inclusions, tags) and the side-panel item renderer in the rest of [Side panel design](doc_page_impl_side_panel.md). Tags and tag definitions are described in [Tag system](doc_page_impl_tag.md). Feature switches (`globalConfig`, and per-document `config` in source rules, side-panel nodes, and frontmatter) are described in [Config system](doc_page_impl_config.md); an application adds its own keys through `DocPageMdx` `config.configDefineList`.

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

Mapping the built-in name `SidePanelItem` in `compRegistry` replaces the label renderer of every side-panel item; mapping `TagLabel` replaces the default tag look; mapping `Tag` replaces how a tag mentioned in document text is rendered; mapping `TagOverview` replaces the content of the tag overview popup.

Host settings needed by package components are passed once through `config.compConfigHost` and reach every registered component's `config`:

```jsx
<DocPageMdx
  data={{ configDoc, fileManifest, dirManifest, fileUrlByPath }}
  config={{
    compById,
    source: { endpoint: docSourceEndpoint },                   // file bytes, file creation (dev server)
    compConfigHost: {
      // assetUrlGet is answered by the doc page source service layer by default (doc_page_impl_source.md)
      mermaidLoad: () => import('mermaid'),                    // DiagramMermaid
      univerLoad: () => import('./univer-load.js'),            // ExcelUniver: Univer engine, preset, css
      panelComponent: PanelText,                               // popup frame: tag overview, SourceLink
    },
  }}
/>
```

## Link customization

Link handling has four replaceable layers:

1. Recognition: the default remark plugin recognizes Markdown links, file-like inline code, and wiki links, in the document body and in Markdown rendered by components (`MdxRenderer`). Disable it with `config.compile.isDefaultLinkRecognitionEnabled: false` and supply `config.compile.remarkPlugins` for a different syntax.
2. Resolution: set `config.link.resolve`. Return `{ targets, hash }`, or return nothing to use the default internal-path/name resolver. Source pruning at build time knows only the default resolver; targets a custom resolver maps elsewhere must be reachable through the default rules or another retained document.
3. Rendering: set `config.link.CompRender`. The package continues to own state and navigation while the application owns visual output.
4. Navigation policy: set `config.link.onEvent`, or handle root events through `DocPageMdx.onEvent`. The callback may be synchronous or asynchronous; return `{ code: 0 }` to suppress default handling (`{ isHandled: true }` of earlier hosts is still accepted). Component events arrive as `component:<type>` with the component's source fields merged into the data; see [event layer](doc_page_impl_event.md).

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
