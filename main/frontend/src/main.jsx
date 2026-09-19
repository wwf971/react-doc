import { createRoot } from 'react-dom/client';
import * as docSource from 'virtual:doc-source';
import { DocPageMdx } from './DocPageMdx.jsx';
import { DemoCounter } from './comp-doc/specific/DemoCounter.jsx';
import { StockTable } from './comp-doc/specific/StockTable.jsx';
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
    }}
  />,
);
