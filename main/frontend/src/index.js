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
export { AnchoredPopover } from '../../comp-doc/popup/AnchoredPopover.jsx';
// a dialog of the page for a second thing a component shows (its pages, a larger view):
// the host's panel, moved, resized, maximized and closed as every dialog of the page
// (doc_page_impl_popup.md#a-dialog-of-a-component)
export { PanelPopup } from '../../comp-doc/popup/PanelPopup.jsx';
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
  compPaginationGet,
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
// asset paths (doc_page_impl_obj_frontend_asset_path.md): the grammar of path patterns and the index
// over it, for anything indexing data items by paths; also '@wwf971/react-doc/asset-path', without the page
export * from './lib/doc-object-frontend-asset-path.js';
// pagination (doc_page_impl_pagination.md): the environment laying a component's flow out on
// pages, printing and downloading them, and the helpers a piece type's split uses
export { PageFlow } from '../../comp-doc/pagination/PageFlow.jsx';
export { pageFlowPdfDownload, pageFlowPrint, pageFlowPrintProfileGet } from '../../comp-doc/pagination/page-flow-export.js';
export {
  PAGE_SPEC_A4, PAGINATION_PRINT_PROFILE_BY_ENGINE, pageSpecNormalize, paginationBreakLastFitting, paginationPlan, paginationTextCutGet,
} from './lib/doc-pagination.js';
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
// the slash mode in a component's own surfaces (doc_page_impl_edit_slash.md#beyond-the-document-editors)
export { useEditSlashConfig } from '../../comp-doc/slash/use-edit-slash-config.js';
export { EditSlashToggle } from '../../comp-doc/slash/EditSlashToggle.jsx';
// the cell edit layer (doc_page_impl_edit_cell.md): the small values a component lets the author
// type in place (a cell of a table, a field of a mode of a frontend object), with tokens in
// their text: a link, a view of an object, a value of the component's own data. a component
// asks for a cell (useCell), draws a text with CellValue and types one with CellEdit, or uses
// CellField for both; it defines its own token kinds with cellTokenDefine
export { useCell } from '../../comp-doc/cell/use-cell.js';
export { CellValue } from '../../comp-doc/cell/CellValue.jsx';
export { CellEdit } from '../../comp-doc/cell/CellEdit.jsx';
export { CellField } from '../../comp-doc/cell/CellField.jsx';
export { cellTokenDefine } from '../../comp-doc/cell/cell-define.js';
export { DocCellStore } from './store/DocCellStore.js';
export {
  cellBraceTextBuild, cellLinkMatchList, cellRangeRead, cellTextParse, cellTextPlainGet, cellTextRangeReplace, cellTokenListGet,
  cellTokenSoleGet, cellTokenTextBuild,
} from './lib/doc-cell.js';
// the token kinds of the page, for a component composing its own cell (a kind of its own made
// from one of them), and the slash actions writing a link and an object reference
export { linkCellToken } from '../../comp-doc/link/link-cell.jsx';
export { objectCellToken } from '../../comp-doc/object/object-cell.jsx';
// the frontend object service layer for a mode's component (doc_page_impl_obj_frontend.md): the
// inner references naming something inside an object
export {
  objectFrontendInnerRefBuild, objectFrontendRefBuild, objectFrontendRefSplit,
} from './lib/doc-object-frontend.js';
// the unified api registry (doc_page_impl_api.md): a host defines apis and
// hands them as config.apiById, a component exposes them (expose.apiList);
// the command palette and the hotkeys run them
export { apiDefine } from './lib/doc-api.js';
export { DocApiStore } from './store/DocApiStore.js';
export { DocPaletteStore } from './store/DocPaletteStore.js';
export { DocHotkeyStore } from './store/DocHotkeyStore.js';
export { hotkeyParse, hotkeyFormat } from './lib/doc-hotkey.js';
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
