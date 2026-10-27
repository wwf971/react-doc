import { Accordion, Accordions, Callout, File, Files, Folder, Step, Steps, Tab, Tabs } from '../../frontend/UICommon.js';
import { DocLinkInline } from '../link/DocLink.jsx';
import { MdxRenderer } from '../mdx-render/MdxRenderer.jsx';
import { SidePanelItem } from '../side-panel/SidePanelItem.jsx';
import { Anchor } from '../../../built-in/comp-mdx/anchor/Anchor.jsx';
import { Block } from '../../../built-in/comp-mdx/block/block-simple/Block.jsx';
import { BlockMdx } from '../../../built-in/comp-mdx/block/block-mdx/BlockMdx.jsx';
import { BlockQA } from '../../../built-in/comp-mdx/block/block-qa/BlockQA.jsx';
import { BlockSimple } from '../../../built-in/comp-mdx/block/block-simple/BlockSimple.jsx';
import { DiagramMermaid } from '../../../built-in/comp-mdx/diagram/diagram-mermaid/DiagramMermaid.jsx';
import { DiagramText } from '../../../built-in/comp-mdx/diagram/diagram-ascii/DiagramText.jsx';
import { DiagramER } from '../../../built-in/comp-mdx/diagram/diagram-er/DiagramER.jsx';
import {
  diagramBusinessRuleExpose,
  diagramDataverseEntityExpose,
  diagramERExpose,
  diagramPowerAutomateExpose,
} from '../../../built-in/comp-mdx/diagram/diagram-er/diagram-er-expose.js';
import { DiagramDataverseEntity } from '../../../built-in/comp-mdx/diagram/diagram-db-tabe/DiagramDataverseEntity.jsx';
import { ExcelUniver } from '../../../built-in/comp-mdx/media/excel-univer/ExcelUniver.jsx';
import { excelUniverExpose } from '../../../built-in/comp-mdx/media/excel-univer/excel-univer-expose.js';
import { FileDownload } from '../../../built-in/comp-mdx/media/file-download/FileDownload.jsx';
import { fileDownloadAssetDependencyListGet } from '../../../built-in/comp-mdx/media/file-download/FileDownloadData.js';
import { FileIcon as FileDownloadIcon } from '../../../built-in/comp-mdx/media/file-download/FileIcon.jsx';
import { FileTree } from '../../../built-in/comp-mdx/hierarchy/file-tree/FileTree.jsx';
import { Image } from '../../../built-in/comp-mdx/media/image/image/Image.jsx';
import { imageExpose } from '../../../built-in/comp-mdx/media/image/image/image-expose.js';
import { imageAssetDependencyListGet, imageDeleteFileListGet } from '../../../built-in/comp-mdx/media/image/image/image-paste.js';
import { ImageGrid } from '../../../built-in/comp-mdx/media/image/image-grid/ImageGrid.jsx';
import { imageGridExpose } from '../../../built-in/comp-mdx/media/image/image-grid/image-grid-expose.js';
import { imageGridAssetDependencyListGet, imageGridDeleteFileListGet } from '../../../built-in/comp-mdx/media/image/image-grid/ImageGridStore.js';
import { Index } from '../../../built-in/comp-mdx/index/Index.jsx';
import { ListHierarchy } from '../../../built-in/comp-mdx/hierarchy/list-hierarchy/ListHierarchy.jsx';
import { ListSupportedToolsRow } from '../../../built-in/comp-mdx/hierarchy/list-hierarchy/ListSupportedToolsRow.jsx';
import { ListToolsControls } from '../../../built-in/comp-mdx/hierarchy/list-hierarchy/ListToolsControls.jsx';
import { MultiLang } from '../../../built-in/comp-mdx/multi-lang/MultiLangEntry.jsx';
import { ProxyConnectionDiagram } from '../../../built-in/comp-mdx/diagram/proxy-connection-diagram/ProxyConnectionDiagram.jsx';
import { SwitchView } from '../../../built-in/comp-mdx/switch-view/SwitchView.jsx';
import { TableCapabilityCell } from '../../../built-in/comp-mdx/hierarchy/table-hierarchy/TableCapabilityCell.jsx';
import { TableHierarchy } from '../../../built-in/comp-mdx/hierarchy/table-hierarchy/TableHierarchy.jsx';
import { TestCaseTable, testCaseTableExpose } from '../../../built-in/comp-mdx/test-case-table/TestCaseTable.jsx';
import { testCaseAssetDependencyListGet } from '../../../built-in/comp-mdx/test-case-table/TestCaseTableData.js';
import { TextInfoCell } from '../../../built-in/comp-mdx/hierarchy/table-hierarchy/TextInfoCell.jsx';
import { Tag } from '../../../built-in/comp-mdx/tag/Tag.jsx';
import { TagLabel } from '../../../built-in/comp-mdx/tag/TagLabel.jsx';
import { TagOverview } from '../../../built-in/comp-mdx/tag/TagOverview.jsx';
import { BlockSource } from '../../../built-in/comp-mdx/text/BlockSource.jsx';
import { Heading } from '../../../built-in/comp-mdx/text/Heading.jsx';
import { List } from '../../../built-in/comp-mdx/text/List.jsx';
import { Paragraph } from '../../../built-in/comp-mdx/text/Paragraph.jsx';
import { compDefine, compNativeDefine } from './comp-registry.js';
import {
  accordionsExpose,
  blockExpose,
  blockMdxExpose,
  blockQAExpose,
  blockSimpleExpose,
  calloutExpose,
  diagramMermaidExpose,
  diagramTextExpose,
  fileDownloadExpose,
  fileIconExpose,
  fileTreeExpose,
  filesExpose,
  indexExpose,
  listHierarchyExpose,
  listSupportedToolsRowExpose,
  listToolsControlsExpose,
  multiLangExpose,
  proxyConnectionDiagramExpose,
  stepsExpose,
  switchViewExpose,
  tableCapabilityCellExpose,
  tableHierarchyExpose,
  tabsExpose,
  tagOverviewExpose,
  textInfoCellExpose,
} from './registry-expose.js';

const compFileTree = compDefine(FileTree, {
  componentType: 'fileTree',
  dataRefTypeList: ['fileTree'],
  placementList: ['mdx', 'commentBlock'],
  expose: fileTreeExpose,
});
const compIndex = compDefine(Index, {
  componentType: 'index',
  placementList: ['mdx', 'commentBlock', 'partIndex'],
  expose: indexExpose,
});
// components that display authored Markdown receive the package renderer,
// which owns link meaning (lib/markdown-render.js)
const compMultiLang = compDefine(MultiLang, {
  dataBuild: markdownConfigBuild,
  placementList: ['commentBlock'],
  expose: multiLangExpose,
});
// Image and ImageGrid demonstrate component edit modes: what each exposes
// (its edit mode beside the built-in source mode, the shape of the
// component-level config of the paste flow, its icon, the starting text of
// a new block) is in image-expose.js / image-grid-expose.js
// (doc_page_impl_mdx_comp.md#what-a-component-exposes). both learn whether
// their data is an asset (isAssetAware) and name the files their data refers
// to, recorded as the dependencies of an asset made from it
// (doc_page_impl_asset.md#dependencies). both also offer those files when
// the block is deleted (deleteFileListGet, doc_page_impl_block_ops.md): the
// image family decides which files it offers (image files only); the edit
// layer never knows a component by its id
const compImage = compDefine(Image, {
  placementList: ['mdx', 'commentBlock'],
  isAssetAware: true,
  assetDependencyListGet: imageAssetDependencyListGet,
  deleteFileListGet: imageDeleteFileListGet,
  expose: imageExpose,
});
const compImageGrid = compDefine(ImageGrid, {
  placementList: ['mdx', 'commentBlock'],
  isAssetAware: true,
  assetDependencyListGet: imageGridAssetDependencyListGet,
  deleteFileListGet: imageGridDeleteFileListGet,
  expose: imageGridExpose,
});
const compDiagramText = compDefine(DiagramText, { placementList: ['commentBlock'], expose: diagramTextExpose });
// mermaid itself is not a package dependency: the host app supplies
// config.mermaidLoad through DocPageMdx config.compConfigHost.
const compDiagramMermaid = compDefine(DiagramMermaid, { placementList: ['mdx', 'commentBlock'], expose: diagramMermaidExpose });
// the ER diagram draws with @xyflow/react, a dependency of the package. it
// and the standalone Dataverse table card share a visual edit mode
// (diagram-er-expose.js) that also edits the data of an asset reference, so
// both learn whether their data is an asset (isAssetAware)
const compDiagramER = compDefine(DiagramER, { placementList: ['mdx', 'commentBlock'], isAssetAware: true, expose: diagramERExpose });
const compDiagramDataverseEntity = compDefine(DiagramDataverseEntity, { placementList: ['mdx', 'commentBlock'], isAssetAware: true, expose: diagramDataverseEntityExpose });
// the Power Platform design diagrams are the ER diagram with another
// starter (comp_db_vis.md#power-platform-resource-nodes): a flow of Power
// Automate steps, a Dataverse business rule. one graph grammar, so a
// diagram may mix their nodes with tables and choices
const compDiagramPowerAutomate = compDefine(DiagramER, { placementList: ['mdx', 'commentBlock'], isAssetAware: true, expose: diagramPowerAutomateExpose });
const compDiagramBusinessRule = compDefine(DiagramER, { placementList: ['mdx', 'commentBlock'], isAssetAware: true, expose: diagramBusinessRuleExpose });
// a spreadsheet drawn by Univer, which is not a package dependency either:
// the host supplies config.univerLoad. it is asset-only (excel-univer-expose.js),
// so it is a comment block whose fenced block is an asset reference, and it
// reads the version metadata of its data (isAssetAware)
const compExcelUniver = compDefine(ExcelUniver, { placementList: ['commentBlock'], isAssetAware: true, expose: excelUniverExpose });
const compBlockSimple = compDefine(BlockSimple, {
  dataBuild: markdownConfigBuild,
  placementList: ['commentBlock'],
  expose: blockSimpleExpose,
});
const compBlockMdx = compDefine(BlockMdx, {
  dataBuild: markdownConfigBuild,
  placementList: ['commentBlock'],
  expose: blockMdxExpose,
});
const compBlock = compDefine(Block, {
  dataBuild: markdownConfigBuild,
  placementList: ['commentBlock'],
  expose: blockExpose,
});
// answers written as Markdown are rendered by the package renderer
const compBlockQA = compDefine(BlockQA, {
  dataBuild: markdownConfigBuild,
  placementList: ['commentBlock'],
  expose: blockQAExpose,
});
// the file of a download card is named as the dependency of an asset made
// from its data, like the src of an Image. its icon is a component of
// placement fileDownloadIcon (FileIcon by default)
const compFileDownload = compDefine(FileDownload, {
  placementList: ['mdx', 'commentBlock'],
  assetDependencyListGet: fileDownloadAssetDependencyListGet,
  expose: fileDownloadExpose,
});
// the hierarchies render their parts through the registry: table cells
// (placement tableCell), list rows (hierarchyRow) and header controls
// (hierarchyHeader). SwitchView renders block components (placement
// commentBlock) from yaml data, one per view.
const compTableHierarchy = compDefine(TableHierarchy, { placementList: ['commentBlock'], expose: tableHierarchyExpose });
const compListHierarchy = compDefine(ListHierarchy, { placementList: ['commentBlock'], expose: listHierarchyExpose });
// a test specification table drawn by the hierarchy view, whose results are
// a managed history recorded on its asset object (comp_test_case_table.md):
// it reads its asset (the hash a record is based on) and names the evidence
// documents of its history as the dependencies of the object
const compTestCaseTable = compDefine(TestCaseTable, {
  placementList: ['commentBlock'],
  isAssetAware: true,
  assetDependencyListGet: testCaseAssetDependencyListGet,
  expose: testCaseTableExpose,
});
const compSwitchView = compDefine(SwitchView, { placementList: ['commentBlock'], expose: switchViewExpose });

// all components the package registers. what is actually exposed to doc
// authors (and under which tag name) is decided by compRegistry in
// config.yaml. a doc page brings components of its own in its component
// folders (comp-mdx/comp.yaml), mounted by the vite plugin
// (doc_page_impl_mdx_comp.md#components-of-a-doc-page): the demonstration
// components of example_doc/comp-mdx/ and SourceLink, bound to the
// demonstration's popup panel there, are not registered here.
export const compById = {
  // relatively common components, re-exported from the fumadocs default theme
  'common/Tabs': compNativeDefine(Tabs, { placementList: ['mdx'], expose: tabsExpose }),
  'common/Tab': compNativeDefine(Tab, { placementList: ['mdx'] }),
  'common/Callout': compNativeDefine(Callout, { placementList: ['mdx'], expose: calloutExpose }),
  'common/Accordions': compNativeDefine(Accordions, { placementList: ['mdx'], expose: accordionsExpose }),
  'common/Accordion': compNativeDefine(Accordion, { placementList: ['mdx'] }),
  'common/Steps': compNativeDefine(Steps, { placementList: ['mdx'], expose: stepsExpose }),
  'common/Step': compNativeDefine(Step, { placementList: ['mdx'] }),
  'common/Files': compNativeDefine(Files, { placementList: ['mdx'], expose: filesExpose }),
  'common/File': compNativeDefine(File, { placementList: ['mdx'] }),
  'common/Folder': compNativeDefine(Folder, { placementList: ['mdx'] }),
  'common/FileTree': compFileTree,
  'common/Index': compIndex,
  'common/DocLinkInline': compDefine(DocLinkInline, {
    placementList: ['fileTreeDescription'],
  }),
  'common/MultiLang': compMultiLang,
  'common/Image': compImage,
  'common/ImageGrid': compImageGrid,
  'common/DiagramText': compDiagramText,
  'common/DiagramMermaid': compDiagramMermaid,
  'common/DiagramER': compDiagramER,
  'common/DiagramDataverseEntity': compDiagramDataverseEntity,
  'common/DiagramPowerAutomate': compDiagramPowerAutomate,
  'common/DiagramBusinessRule': compDiagramBusinessRule,
  'common/ExcelUniver': compExcelUniver,
  'common/Block': compBlock,
  'common/BlockSimple': compBlockSimple,
  'common/BlockMdx': compBlockMdx,
  'common/BlockQA': compBlockQA,
  'common/FileDownload': compFileDownload,
  'common/FileIcon': compDefine(FileDownloadIcon, { placementList: ['fileDownloadIcon'], expose: fileIconExpose }),
  'common/TableHierarchy': compTableHierarchy,
  'common/ListHierarchy': compListHierarchy,
  'common/TestCaseTable': compTestCaseTable,
  'common/SwitchView': compSwitchView,
  'common/TextInfoCell': compDefine(TextInfoCell, { placementList: ['tableCell'], expose: textInfoCellExpose }),
  'common/TableCapabilityCell': compDefine(TableCapabilityCell, { placementList: ['tableCell'], expose: tableCapabilityCellExpose }),
  'common/ListSupportedToolsRow': compDefine(ListSupportedToolsRow, { placementList: ['hierarchyRow'], expose: listSupportedToolsRowExpose }),
  'common/ListToolsControls': compDefine(ListToolsControls, { placementList: ['hierarchyHeader'], expose: listToolsControlsExpose }),
  'common/ProxyConnectionDiagram': compDefine(ProxyConnectionDiagram, {
    placementList: ['mdx', 'commentBlock'],
    expose: proxyConnectionDiagramExpose,
  }),
  // built-in names (comp-registry.js compIdBuiltinByName): the page renders
  // with these even when compRegistry does not mention them
  'common/SidePanelItem': compDefine(SidePanelItem, {
    placementList: ['sidePanelDisplay'],
    expose: { meta: { label: 'Side panel item', isNotInDoc: true } },
  }),
  'common/Anchor': compDefine(Anchor, { placementList: ['mdx', 'commentBlock', 'commentInline'] }),
  'common/Tag': compDefine(Tag, { placementList: ['mdx', 'commentInline'] }),
  'common/TagLabel': compDefine(TagLabel, { placementList: ['tag', 'mdx'] }),
  'common/TagOverview': compDefine(TagOverview, { placementList: ['tagOverview', 'mdx', 'commentBlock'], expose: tagOverviewExpose }),
  // default editors of the edit layer, one per block kind. mapping the
  // built-in name in compRegistry replaces the editor of that kind.
  'common/Heading': compDefine(Heading, { placementList: ['edit'] }),
  'common/Paragraph': compDefine(Paragraph, { placementList: ['edit'] }),
  'common/List': compDefine(List, { placementList: ['edit'] }),
  'common/BlockSource': compDefine(BlockSource, { placementList: ['edit'] }),
  // compatibility ids: existing consumer configs map tags to these ids
  'common/DocFileTree': compFileTree,
  'common/DocIndex': compIndex,
  'common/DocMultiLang': compMultiLang,
  'common/DocImage': compImage,
  'common/DocImageGrid': compImageGrid,
  'common/DocDiagramText': compDiagramText,
  'common/DocDiagramMermaid': compDiagramMermaid,
};

function markdownConfigBuild(input) {
  return {
    ...input,
    config: {
      ...input.config,
      MdxRenderer,
    },
  };
}
