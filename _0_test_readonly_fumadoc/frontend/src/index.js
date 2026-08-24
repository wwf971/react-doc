// package entry for embedding the doc page into another app:
//
//   import { DocPageMdx } from '@wwf971/react-doc';
//   import '@wwf971/react-doc/style.css';
//
//   <DocPageMdx data={{ configDoc, fileManifest }} config={{ routeMode: 'memory' }} />
//
// consumers building with vite can reuse the doc-source plugin to collect
// sourceData from a config.yaml at build time.
export { DocPageMdx } from './DocPageMdx.jsx';
export { LinkDocRender } from './comp-doc/LinkDocRender.jsx';
export { DocSourceStore } from './store/DocSourceStore.js';
export { DocStore } from './store/DocStore.js';
export { useDocStores } from './store/context.js';
