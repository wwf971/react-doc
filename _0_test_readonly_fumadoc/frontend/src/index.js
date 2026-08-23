// package entry for embedding the doc page into another app:
//
//   import { DocApp } from 'test-readonly-fumadoc-frontend';
//   import 'test-readonly-fumadoc-frontend/style.css';
//
//   <DocApp sourceData={{ configDoc, fileManifest }} routeMode="memory" />
//
// consumers building with vite can reuse the doc-source plugin to collect
// sourceData from a config.yaml at build time.
export { DocApp } from './DocApp.jsx';
export { DocSourceStore } from './store/DocSourceStore.js';
export { DocStore } from './store/DocStore.js';
