// package entry for embedding the doc page into another app:
//
//   import { DocPageMdx } from 'react-doc';
//   import 'react-doc/style.css';
//
//   <DocPageMdx data={{ configDoc, fileManifest }} config={{ routeMode: 'memory' }} />
//
// consumers building with vite can reuse the doc-source plugin to collect
// sourceData from a config.yaml at build time.
export { DocPageMdx } from './DocPageMdx.jsx';
export { DocLink } from './comp-doc/DocLink.jsx';
export { LinkDocRender } from './comp-doc/LinkDocRender.jsx';
export { RegisteredComp } from './comp-doc/RegisteredComp.jsx';
export { compDefine, compNativeDefine } from './comp-doc/comp-registry.js';
export { DocLanguageProvider, useDocLanguage } from '../../comp-mdx/multi-lang/MultiLangContext.jsx';
export { DynamicCodeBlock } from './comp-doc/DynamicCodeBlock.js';
export { DocSourceStore } from './store/DocSourceStore.js';
export { DocStore } from './store/DocStore.js';
export { useDocStores } from './store/context.js';
