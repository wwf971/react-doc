import { createRoot } from 'react-dom/client';
import { SegmentedControl } from '@wwf971/react-comp-misc';
import * as docSource from 'virtual:doc-source';
import { DocPageMdx } from './DocPageMdx.jsx';
import { DemoCounter } from '../../../example_doc/comp-mdx/DemoCounter.jsx';
import { StockTable } from '../../../example_doc/comp-mdx/StockTable.jsx';
import {
  docIndexLanguageListGet,
  docIndexStructuredDataGet,
} from '../../comp-mdx/index/DocIndexData.js';
import './style.css';

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
      // DocIndex contributes its translations to the language selector and
      // its titles/descriptions to the search index
      compile: {
        languageListGetByComponent: { DocIndex: docIndexLanguageListGet },
        structuredDataGetByComponent: { DocIndex: docIndexStructuredDataGet },
      },
    }}
  />,
);
