import { createRoot } from 'react-dom/client';
import { SegmentedControl } from '@wwf971/react-comp-misc';
import * as docSource from 'virtual:doc-source';
import { DocPageMdx } from './DocPageMdx.jsx';
import { DemoCounter } from '../../../example_doc/comp-mdx/DemoCounter.jsx';
import { StockTable } from '../../../example_doc/comp-mdx/StockTable.jsx';
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
      subscribe: docSource.subscribeDocSource,
    }}
    config={{
      language: 'en',
      routeMode: 'query',
      compById: {
        'specific/DemoCounter': DemoCounter,
        'specific/StockTable': StockTable,
      },
      // the language selector and the page/part index switch both render
      // through this consumer-injected segmented control
      components: { SegmentedControl },
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
