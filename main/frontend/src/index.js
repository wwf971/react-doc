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
// what a component exposes (doc_page_impl_mdx_comp.md#what-a-component-exposes):
// reading a definition's exposure, and drawing an icon for one
export {
  COMP_EDIT_MODE_SOURCE_ID,
  compEditModeListGet,
  compExposeGet,
  compIconGet,
  compMetaGet,
  compSourceDefaultGet,
  compViewModeListGet,
} from '../../comp-doc/registry/comp-expose.js';
export { compIconDefault, compIconDefine } from '../../comp-doc/registry/comp-icon.jsx';
export { useCompDataRef } from '../../comp-doc/registry/CompDataRef.jsx';
export { DocLanguageProvider, useDocLanguage } from '../../../built-in/comp-mdx/multi-lang/MultiLangContext.jsx';
export { DynamicCodeBlock } from '../../comp-doc/mdx-render/DynamicCodeBlock.js';
export { DocSourceStore } from './store/DocSourceStore.js';
export { DocSourceFileStore } from './store/DocSourceFileStore.js';
export { DocStore } from './store/DocStore.js';
export { DocTagStore } from './store/DocTagStore.js';
export { DocConfigStore } from './store/DocConfigStore.js';
export { DocEditStore } from './store/DocEditStore.js';
export { DocAssetStore } from './store/DocAssetStore.js';
// the component state service layer (doc_page_impl_mdx_comp_state.md): the
// state object of a block, held by a component across renders and unmounts
export { DocCompStateStore } from './store/DocCompStateStore.js';
export { useCompState } from '../../comp-doc/registry/use-comp-state.js';
export { compStateKeyBuild, compStateKeyParse } from './lib/doc-comp-state.js';
export { useDocStores } from './store/context.js';
// the asset service layer (doc_page_impl_asset.md): the reference form in documents
// and the browser backends over the asset api / a bundled snapshot
export { ASSET_REF_LANG, assetRefLangIs, assetRefParse, assetBlockTextExpand } from './lib/doc-asset-ref.js';
export { assetBackendApiCreate, assetBackendSnapshotCreate } from './lib/doc-asset-backend.js';
// building blocks for a component's own edit mode (doc_page_impl_edit.md)
export { EditActions } from '../../comp-doc/edit/EditActions.jsx';
export { EditFloatingPanel } from '../../comp-doc/edit/EditFloatingPanel.jsx';
export { EditSourceSurface } from '../../comp-doc/edit/EditSourceSurface.jsx';
export { EditValueInline } from '../../comp-doc/edit/EditValueInline.jsx';
export { BlockRender } from '../../../built-in/comp-mdx/text/BlockRender.jsx';
export { TextBlockEdit } from '../../../built-in/comp-mdx/text/TextBlockEdit.jsx';
// the slash mode of the default editors (doc_page_impl_edit_slash.md): a
// host defines its own actions and hands them as config.slashActionById
export { slashActionDefine } from '../../comp-doc/slash/slash-define.js';
export { slashEffect } from './lib/doc-slash.js';
export { DocSlashStore } from './store/DocSlashStore.js';
export { MdxRenderer } from '../../comp-doc/mdx-render/MdxRenderer.jsx';
export { SidePanelItem } from '../../comp-doc/side-panel/SidePanelItem.jsx';
export { SidePanelItemSurfaceContext } from '../../comp-doc/side-panel/SidePanelItemHost.jsx';
export { Anchor } from '../../../built-in/comp-mdx/anchor/Anchor.jsx';
export { Tag } from '../../../built-in/comp-mdx/tag/Tag.jsx';
export { TagLabel } from '../../../built-in/comp-mdx/tag/TagLabel.jsx';
export { TagList } from '../../../built-in/comp-mdx/tag/TagList.jsx';
export { TagOverview } from '../../../built-in/comp-mdx/tag/TagOverview.jsx';
export { tagAssetKeyGet } from './lib/doc-tag-declare.js';
export { configDefineListBuiltin } from './lib/doc-config-define.js';
// the doc page source service layer (doc_page_impl_source.md): the source path grammar and
// the path input with completion
export {
  SOURCE_ROOT_MARK,
  sourcePathBuild,
  sourcePathIsRooted,
  sourcePathParse,
  sourcePathNormalize,
  sourcePathDirGet,
  sourcePathNameGet,
} from './lib/doc-source-path.js';
export { SourcePathInput } from '../../comp-doc/source/SourcePathInput.jsx';
