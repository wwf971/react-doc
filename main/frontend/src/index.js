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
export { DocLink, DocLinkInline } from '../../comp-doc/link/DocLink.jsx';
export { LinkDocRender } from '../../comp-doc/link/LinkDocRender.jsx';
export { RegisteredComp } from '../../comp-doc/registry/RegisteredComp.jsx';
export { compDefine, compNativeDefine } from '../../comp-doc/registry/comp-registry.js';
export { useCompDataRef } from '../../comp-doc/registry/CompDataRef.jsx';
export { DocLanguageProvider, useDocLanguage } from '../../comp-mdx/multi-lang/MultiLangContext.jsx';
export { DynamicCodeBlock } from '../../comp-doc/mdx-render/DynamicCodeBlock.js';
export { DocSourceStore } from './store/DocSourceStore.js';
export { DocStore } from './store/DocStore.js';
export { DocTagStore } from './store/DocTagStore.js';
export { DocConfigStore } from './store/DocConfigStore.js';
export { DocEditStore } from './store/DocEditStore.js';
export { useDocStores } from './store/context.js';
// building blocks for a component's own edit mode (doc_page_impl_edit.md)
export { EditActions } from '../../comp-doc/edit/EditActions.jsx';
export { EditFloatingPanel } from '../../comp-doc/edit/EditFloatingPanel.jsx';
export { EditSourceSurface } from '../../comp-doc/edit/EditSourceSurface.jsx';
export { EditValueInline } from '../../comp-doc/edit/EditValueInline.jsx';
export { BlockRender } from '../../comp-mdx/text/BlockRender.jsx';
export { TextBlockEdit } from '../../comp-mdx/text/TextBlockEdit.jsx';
export { MdxRenderer } from '../../comp-doc/mdx-render/MdxRenderer.jsx';
export { SidePanelItem } from '../../comp-doc/side-panel/SidePanelItem.jsx';
export { SidePanelItemSurfaceContext } from '../../comp-doc/side-panel/SidePanelItemHost.jsx';
export { Anchor } from '../../comp-mdx/anchor/Anchor.jsx';
export { Tag } from '../../comp-mdx/tag/Tag.jsx';
export { TagLabel } from '../../comp-mdx/tag/TagLabel.jsx';
export { TagList } from '../../comp-mdx/tag/TagList.jsx';
export { TagOverview } from '../../comp-mdx/tag/TagOverview.jsx';
export { tagAssetKeyGet } from './lib/doc-tag-declare.js';
export { configDefineListBuiltin } from './lib/doc-config-define.js';
