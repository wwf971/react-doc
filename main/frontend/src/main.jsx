import { createRoot } from 'react-dom/client';
import { ConfigPanel, Menu, SegmentedControl } from '@wwf971/react-comp-misc';
import * as docSource from 'virtual:doc-source';
import { DocPageMdx } from './DocPageMdx.jsx';
import { DemoCounter } from '../../../example_doc/comp-mdx/DemoCounter.jsx';
import { StockTable, stockTableDefineOptions } from '../../../example_doc/comp-mdx/StockTable.jsx';
import { TextPanelDemo } from '../../../example_doc/comp-mdx/TextPanelDemo.jsx';
import { compDefine } from '../../comp-doc/registry/comp-registry.js';
import {
  indexLanguageListGet,
  indexStructuredDataGet,
} from '../../comp-mdx/index/IndexData.js';
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
    }}
    config={{
      language: 'en',
      routeMode: 'query',
      // host components, as registry definitions so they receive
      // { data, config, onEvent } like every registered component
      compById: {
        'specific/DemoCounter': compDefine(DemoCounter),
        'specific/StockTable': compDefine(StockTable, stockTableDefineOptions),
      },
      // the doc page source service layer (doc_page_impl_source.md): the source api of the
      // development server (file bytes, file creation); empty in a build
      source: { endpoint: docSource.docSourceEndpoint },
      // in-place editing, answered by the development server only; the
      // virtual module exports an empty endpoint in a build
      edit: { endpoint: docSource.docEditEndpoint },
      // the asset service layer (doc_page_impl_asset.md): the asset api of the
      // development server and its change feed; both empty in a build
      asset: { endpoint: docSource.docAssetEndpoint, subscribe: docSource.subscribeDocAsset },
      // the service instances (doc_page_impl_service_instance.md): the
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
      // dropdown menu (no Menu, no mode button)
      components: { ConfigPanel, Menu, SegmentedControl },
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
