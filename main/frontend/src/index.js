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
// the surface a block-like component renders in, so the block opens in the block popup
// (doc_page_impl_mdx_comp_block.md#must-the-popup)
export { BlockPopupSurface } from '../../comp-doc/popup/BlockPopupSurface.jsx';
// a time as a person reads it, always with its zone, and a time text of the project's format
// (AGENTS.md#a-time-shown-always-carries-its-zone)
export { timeTextDisplay, timeTextGet } from './lib/time-text.js';
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
export { useCompState, useCompStateStore } from '../../comp-doc/registry/use-comp-state.js';
// the events the page delivers to a component at its place (doc_page_impl_event.md#events-delivered-to-components):
// an undo and a redo of changes of its own among them (doc_page_impl_edit_history.md#a-component-with-changes-of-its-own)
export { useDocEventSubscribe } from '../../comp-doc/registry/use-doc-event.js';
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
export { EditButtonGroup, editReorderInsertionOf } from '../../comp-doc/edit/EditButtonGroup.jsx';
export { EditValueInline } from '../../comp-doc/edit/EditValueInline.jsx';
// the menus of the page in one look (a right click, a list of actions): the host's Menu as the edit
// layer draws it, its entries an icon and words (comp-doc/edit/DocMenu.jsx)
export { DocMenu, DocMenuEntry, DocMenuSeparator, DOC_MENU_CLASS, DOC_MENU_CONFIG, docMenuEntryBuild, docMenuSeparatorBuild } from '../../comp-doc/edit/DocMenu.jsx';
export { BlockRender } from '../../../built-in/comp-mdx/text/BlockRender.jsx';
export { TextBlockEdit } from '../../../built-in/comp-mdx/text/TextBlockEdit.jsx';
// the slash mode of the default editors (doc_page_impl_edit_slash.md): a
// host defines its own actions and hands them as config.slashActionById
export { slashActionDefine } from '../../comp-doc/slash/slash-define.js';
// slashParamCommandRead, slashCommandItemListGet: the commands of a place typed inside a parameter
// that is a path ("work//new": doc_page_impl_edit_slash.md#commands-inside-a-path)
export { slashCommandItemListGet, slashEffect, slashParamCommandRead } from './lib/doc-slash.js';
export { DocSlashStore } from './store/DocSlashStore.js';
// the kinds of atoms (doc_page_impl_edit_structure.md#atoms-of-a-kind): a thing a component
// writes inside a text, typed as a chip, its value edited below it (a formula of LaTeX); a host
// defines its own and hands them as config.atomKindById
export { atomKindDefine } from './lib/doc-edit-atom-kind.js';
// the slash mode in a component's own surfaces (doc_page_impl_edit_slash.md#beyond-the-document-editors)
export { useEditSlashConfig } from '../../comp-doc/slash/use-edit-slash-config.js';
export { EditSlashToggle } from '../../comp-doc/slash/EditSlashToggle.jsx';
// the cell editing kit (doc_page_impl_edit_cell.md): the small values a component lets the author
// type in place (a cell of a table, a field of a mode of a frontend object), with tokens in
// their text: a link, a view of an object, a value of the component's own data. a component
// asks for a cell (useCell), draws a text with CellValue and types one with CellEdit, or uses
// CellField for both; it defines its own token kinds with cellTokenDefine
export { useCell } from '../../comp-doc/cell/use-cell.js';
export { CellValue } from '../../comp-doc/cell/CellValue.jsx';
export { CellEdit } from '../../comp-doc/cell/CellEdit.jsx';
export { CellField } from '../../comp-doc/cell/CellField.jsx';
export { cellTokenDefine } from '../../comp-doc/cell/cell-define.js';
// the styles of the words of a cell (doc_page_impl_edit_cell.md#styles): a component defines a
// look of its own with cellStyleDefine and hands it to useCell({ styleList }); the package's
// kinds (bold, a color, a size) are there for every cell
export { cellStyleDefine } from '../../comp-doc/cell/cell-style-define.js';
export { cellStyleById } from '../../comp-doc/cell/cell-style-registry.js';
export { DocCellStore } from './store/DocCellStore.js';
export {
  cellBraceTextBuild, cellLinkMatchList, cellRangeRead, cellTextConcat, cellTextParse, cellTextPlainGet, cellTextRangeReplace, cellTextSlice,
  cellTextStyledParse, cellTokenListGet, cellTokenSoleGet, cellTokenTextBuild,
} from './lib/doc-cell.js';
// a text as kept and its styled segments, for a component working on its texts itself (cutting
// one into lines): its bare text, its segments read and written
export {
  cellStyleSegListNormalize, cellStyleSegListRead, cellStyleSegListSlice, cellStyleSegListTextGet, cellStyleSpecRead, cellStyleSpecWrite,
  cellStyleTextBareGet, cellStyleTextIsStyled, cellStyleTextWrite,
} from './lib/doc-cell-style.js';
// the token kinds of the page, for a component composing its own cell (a kind of its own made
// from one of them), and the slash actions writing a link and an object reference
export { linkCellToken } from '../../comp-doc/link/link-cell.jsx';
export { objectCellToken } from '../../comp-doc/object/object-cell.jsx';
// the frontend object service layer for a mode's component (doc_page_impl_obj_frontend.md): the
// inner references naming something inside an object
export {
  objectFrontendInnerRefBuild, objectFrontendRefBuild, objectFrontendRefSplit,
} from './lib/doc-object-frontend.js';
// the view of a thing inside a frontend object (its own type's view, the context panel), reaching the object
export { useObjectFrontendInner } from '../../comp-doc/object-frontend/use-object-frontend-inner.js';
// a block's turn to mount what is heavy, one block per frame (#reading-many-assets)
export { useObjectFrontendDrawTurn } from '../../comp-doc/object-frontend/use-object-frontend-draw-turn.js';
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
