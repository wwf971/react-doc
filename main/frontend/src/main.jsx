import { createRoot } from 'react-dom/client';
import { ConfigPanel, EditableValueComp, Menu, PathBar, SegmentedControl } from '@wwf971/react-comp-misc';
import * as docSource from 'virtual:doc-source';
import { DocPageMdx } from './DocPageMdx.jsx';
// the panel component that frames the popups of the page is host
// configuration (compConfigHost.panelComponent), not a document component:
// the demonstration keeps it beside its components, and imports it here
import { TextPanelDemo } from '../../../example_doc/comp-mdx/panel/TextPanelDemo.jsx';
import {
  indexLanguageListGet,
  indexStructuredDataGet,
} from '../../../built-in/comp-mdx/index/IndexData.js';
import './style.css';
import './main.css';

// standalone entry: doc source collected by the vite plugin from config.yaml
createRoot(document.getElementById('root')).render(
  <DocPageMdx
    data={{
      configDoc: docSource.configDoc,
      fileManifest: docSource.fileManifest,
      // the folders of the source (doc_page_impl_source.md): where files
      // can be created, what path completion offers
      dirManifest: docSource.dirManifest,
      // the bytes of the source files a build collected, by source path;
      // empty in development, where the source api answers them
      fileUrlByPath: docSource.fileUrlByPath,
      subscribe: docSource.subscribeDocSource,
      // the asset objects bundled into a build; null in development, where
      // the asset api of the development server is used instead
      assetSnapshot: docSource.assetSnapshot,
      // the components of the doc pages (doc_page_impl_mdx_comp.md#components-of-a-doc-page):
      // found in their component folders (comp-mdx/ by convention) and
      // imported by the plugin; the page mounts them into its registry. the
      // demonstration components (StockTable, DemoCounter, the side-panel
      // item hook ...) come this way, from example_doc/comp-mdx/comp.yaml
      compMountList: docSource.docCompMountList,
    }}
    config={{
      language: 'en',
      routeMode: 'query',
      // the environment the page runs in (doc_page_impl.md#the-environment):
      // the vite development server, or a static build
      env: docSource.docEnv,
      // host components would go here as registry definitions (compDefine),
      // so they receive { data, config, onEvent } like every registered
      // component; the demonstration has none, its components are the doc
      // page's own (data.compMountList above)
      compById: {},
      // the doc page source service layer (doc_page_impl_source.md): the source api of the
      // development server (file bytes, file creation); empty in a build
      source: { endpoint: docSource.docSourceEndpoint },
      // in-place editing, answered by the development server only; the
      // virtual module exports an empty endpoint in a build
      edit: { endpoint: docSource.docEditEndpoint },
      // the asset service layer (doc_page_impl_asset.md): the asset api of the
      // development server and its change feed; both empty in a build
      asset: { endpoint: docSource.docAssetEndpoint, subscribe: docSource.subscribeDocAsset },
      // the service instances (doc_page_impl_service.md): the
      // service backend, reached through the development server; empty in
      // a build, where every dashboard shows that there is no backend
      service: { endpoint: docSource.docServiceEndpoint },
      // host settings handed to every registered component's config:
      // DiagramMermaid loads mermaid on first use, ExcelUniver the Univer
      // sheet engine, and the page frames popups such as the tag overview
      // with panelComponent. file references of Image/ImageGrid/DiagramMermaid
      // are resolved by the doc page source service layer (config.assetUrlGet, default); a
      // host may hand its own assetUrlGet here.
      compConfigHost: {
        mermaidLoad: () => import('mermaid'),
        univerLoad: () => import('./univer-load.js'),
        panelComponent: TextPanelDemo,
      },
      // the language selector and the page/part index switch both render
      // through this consumer-injected segmented control; the settings panel
      // through the injected config panel (no ConfigPanel, no settings
      // button); the mode menu of a block in edit mode through the injected
      // dropdown menu (no Menu, no mode button); the path of the Services
      // tab through the injected path bar (no PathBar: plain links); the
      // cells of the diagram's visual editor through the injected editable
      // value (no EditableValueComp: the cells are read-only)
      components: { ConfigPanel, EditableValueComp, Menu, PathBar, SegmentedControl },
      // Index contributes its translations to the language selector and
      // its titles/descriptions to the search index. both maps are keyed by
      // author-facing tag name, so the compatibility tag DocIndex is listed too.
      compile: {
        languageListGetByComponent: {
          Index: indexLanguageListGet,
          DocIndex: indexLanguageListGet,
        },
        structuredDataGetByComponent: {
          Index: indexStructuredDataGet,
          DocIndex: indexStructuredDataGet,
        },
      },
    }}
  />,
);
