import { Accordion, Accordions, Callout, File, Files, Folder, Step, Steps, Tab, Tabs } from '../../frontend/UICommon.js';
import { DocLinkInline } from '../link/DocLink.jsx';
import { MdxRenderer } from '../mdx-render/MdxRenderer.jsx';
import { SidePanelItem } from '../side-panel/SidePanelItem.jsx';
import { Anchor } from '../../comp-mdx/anchor/Anchor.jsx';
import { Block } from '../../comp-mdx/block-simple/Block.jsx';
import { BlockMdx } from '../../comp-mdx/block-mdx/BlockMdx.jsx';
import { BlockQA } from '../../comp-mdx/block-qa/BlockQA.jsx';
import { BlockSimple } from '../../comp-mdx/block-simple/BlockSimple.jsx';
import { DiagramMermaid } from '../../comp-mdx/diagram-mermaid/DiagramMermaid.jsx';
import { DiagramText } from '../../comp-mdx/diagram-ascii/DiagramText.jsx';
import { DiagramER } from '../../comp-mdx/diagram-er/DiagramER.jsx';
import { ExcelUniver } from '../../comp-mdx/excel-univer/ExcelUniver.jsx';
import { excelUniverExpose } from '../../comp-mdx/excel-univer/excel-univer-expose.js';
import { FileDownload } from '../../comp-mdx/file-download/FileDownload.jsx';
import { fileDownloadAssetDependencyListGet } from '../../comp-mdx/file-download/FileDownloadData.js';
import { FileIcon as FileDownloadIcon } from '../../comp-mdx/file-download/FileIcon.jsx';
import { FileTree } from '../../comp-mdx/file-tree/FileTree.jsx';
import { Image } from '../../comp-mdx/image/Image.jsx';
import { imageExpose } from '../../comp-mdx/image/image-expose.js';
import { imageAssetDependencyListGet } from '../../comp-mdx/image/image-paste.js';
import { ImageGrid } from '../../comp-mdx/image-grid/ImageGrid.jsx';
import { imageGridExpose } from '../../comp-mdx/image-grid/image-grid-expose.js';
import { imageGridAssetDependencyListGet } from '../../comp-mdx/image-grid/ImageGridStore.js';
import { Index } from '../../comp-mdx/index/Index.jsx';
import { ListHierarchy } from '../../comp-mdx/list-hierarchy/ListHierarchy.jsx';
import { ListSupportedToolsRow } from '../../comp-mdx/list-hierarchy/ListSupportedToolsRow.jsx';
import { ListToolsControls } from '../../comp-mdx/list-hierarchy/ListToolsControls.jsx';
import { MultiLang } from '../../comp-mdx/multi-lang/MultiLangEntry.jsx';
import { ProxyConnectionDiagram } from '../../comp-mdx/proxy-connection-diagram/ProxyConnectionDiagram.jsx';
import { SourceLink } from '../../comp-mdx/source-link/SourceLink.jsx';
import { SwitchView } from '../../comp-mdx/switch-view/SwitchView.jsx';
import { TableCapabilityCell } from '../../comp-mdx/table-hierarchy/TableCapabilityCell.jsx';
import { TableHierarchy } from '../../comp-mdx/table-hierarchy/TableHierarchy.jsx';
import { TextInfoCell } from '../../comp-mdx/table-hierarchy/TextInfoCell.jsx';
import { Tag } from '../../comp-mdx/tag/Tag.jsx';
import { TagLabel } from '../../comp-mdx/tag/TagLabel.jsx';
import { TagOverview } from '../../comp-mdx/tag/TagOverview.jsx';
import { BlockSource } from '../../comp-mdx/text/BlockSource.jsx';
import { Heading } from '../../comp-mdx/text/Heading.jsx';
import { List } from '../../comp-mdx/text/List.jsx';
import { Paragraph } from '../../comp-mdx/text/Paragraph.jsx';
// demo-specific components live beside the demonstration documents
import { DemoCounter } from '../../../example_doc/comp-mdx/DemoCounter.jsx';
import { DocConfigDemo } from '../../../example_doc/comp-mdx/DocConfigDemo.jsx';
import { SidePanelItemDemo } from '../../../example_doc/comp-mdx/SidePanelItemDemo.jsx';
import { StockTable, stockTableDefineOptions } from '../../../example_doc/comp-mdx/StockTable.jsx';
import { TagListAllDemo } from '../../../example_doc/comp-mdx/TagListAllDemo.jsx';
import { TextPanelDemo } from '../../../example_doc/comp-mdx/TextPanelDemo.jsx';
import { compDefine, compNativeDefine } from './comp-registry.js';
import {
  accordionsExpose,
  blockExpose,
  blockMdxExpose,
  blockQAExpose,
  blockSimpleExpose,
  calloutExpose,
  demoCounterExpose,
  diagramERExpose,
  diagramMermaidExpose,
  diagramTextExpose,
  docConfigDemoExpose,
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
  sourceLinkExpose,
  stepsExpose,
  switchViewExpose,
  tableCapabilityCellExpose,
  tableHierarchyExpose,
  tabsExpose,
  tagListAllDemoExpose,
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
// (doc_page_impl_asset.md#dependencies)
const compImage = compDefine(Image, {
  placementList: ['mdx', 'commentBlock'],
  isAssetAware: true,
  assetDependencyListGet: imageAssetDependencyListGet,
  expose: imageExpose,
});
const compImageGrid = compDefine(ImageGrid, {
  placementList: ['mdx', 'commentBlock'],
  isAssetAware: true,
  assetDependencyListGet: imageGridAssetDependencyListGet,
  expose: imageGridExpose,
});
const compDiagramText = compDefine(DiagramText, { placementList: ['commentBlock'], expose: diagramTextExpose });
// mermaid itself is not a package dependency: the host app supplies
// config.mermaidLoad through DocPageMdx config.compConfigHost.
const compDiagramMermaid = compDefine(DiagramMermaid, { placementList: ['mdx', 'commentBlock'], expose: diagramMermaidExpose });
// the ER diagram draws with @xyflow/react, a dependency of the package
const compDiagramER = compDefine(DiagramER, { placementList: ['mdx', 'commentBlock'], expose: diagramERExpose });
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
const compSwitchView = compDefine(SwitchView, { placementList: ['commentBlock'], expose: switchViewExpose });

// all components that docs may use. what is actually exposed to doc authors
// (and under which tag name) is decided by compRegistry in config.yaml.
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
  'common/ExcelUniver': compExcelUniver,
  'common/Block': compBlock,
  'common/BlockSimple': compBlockSimple,
  'common/BlockMdx': compBlockMdx,
  'common/BlockQA': compBlockQA,
  'common/FileDownload': compFileDownload,
  'common/FileIcon': compDefine(FileDownloadIcon, { placementList: ['fileDownloadIcon'], expose: fileIconExpose }),
  'common/TableHierarchy': compTableHierarchy,
  'common/ListHierarchy': compListHierarchy,
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
  'specific/DemoCounter': compDefine(DemoCounter, { expose: demoCounterExpose }),
  'specific/StockTable': compDefine(StockTable, stockTableDefineOptions),
  'specific/SidePanelItemDemo': compDefine(SidePanelItemDemo, {
    placementList: ['sidePanelDisplay'],
    expose: { meta: { label: 'Side panel item demo', isNotInDoc: true } },
  }),
  // a component with nothing to edit declares itself read-only: no edit
  // mode, no Edit button (doc_page_impl_mdx_comp.md#what-a-component-exposes)
  'specific/TagListAllDemo': compDefine(TagListAllDemo, {
    placementList: ['mdx', 'commentBlock'],
    expose: tagListAllDemoExpose,
  }),
  'specific/DocConfigDemo': compDefine(DocConfigDemo, { placementList: ['mdx', 'commentBlock'], expose: docConfigDemoExpose }),
  // demo-host binding: the popup panel implementation is host configuration,
  // so SourceLink is registered here with the demo panel rather than in common/.
  'specific/SourceLink': compDefine(SourceLink, {
    dataBuild: sourceLinkDataBuild,
    placementList: ['mdx', 'commentBlock'],
    expose: sourceLinkExpose,
  }),
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

function sourceLinkDataBuild(input) {
  return {
    ...input,
    config: {
      ...input.config,
      panelComponent: TextPanelDemo,
    },
  };
}
