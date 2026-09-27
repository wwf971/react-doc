import { Accordion, Accordions, Callout, File, Files, Folder, Step, Steps, Tab, Tabs } from '../../UICommon.js';
import { DocLink, DocLinkInline } from './DocLink.jsx';
import { MdxRenderer } from './MdxRenderer.jsx';
import { SidePanelItem } from './SidePanelItem.jsx';
import { Block } from '../../../comp-mdx/block-simple/Block.jsx';
import { BlockMdx } from '../../../comp-mdx/block-mdx/BlockMdx.jsx';
import { BlockSimple } from '../../../comp-mdx/block-simple/BlockSimple.jsx';
import { DiagramMermaid } from '../../../comp-mdx/diagram-mermaid/DiagramMermaid.jsx';
import { DiagramText } from '../../../comp-mdx/diagram-ascii/DiagramText.jsx';
import { FileTree } from '../../../comp-mdx/file-tree/FileTree.jsx';
import { Image } from '../../../comp-mdx/image/Image.jsx';
import { ImageGrid } from '../../../comp-mdx/image-grid/ImageGrid.jsx';
import { Index } from '../../../comp-mdx/index/Index.jsx';
import { MultiLang } from '../../../comp-mdx/multi-lang/MultiLangEntry.jsx';
import { SourceLink } from '../../../comp-mdx/source-link/SourceLink.jsx';
import { Tag } from '../../../comp-mdx/tag/Tag.jsx';
import { TagOverview } from '../../../comp-mdx/tag/TagOverview.jsx';
// demo-specific components live beside the demonstration documents
import { DemoCounter } from '../../../../example_doc/comp-mdx/DemoCounter.jsx';
import { DocConfigDemo } from '../../../../example_doc/comp-mdx/DocConfigDemo.jsx';
import { SidePanelItemDemo } from '../../../../example_doc/comp-mdx/SidePanelItemDemo.jsx';
import { StockTable } from '../../../../example_doc/comp-mdx/StockTable.jsx';
import { TagListAllDemo } from '../../../../example_doc/comp-mdx/TagListAllDemo.jsx';
import { TextPanelDemo } from '../../../../example_doc/comp-mdx/TextPanelDemo.jsx';
import { compDefine, compNativeDefine } from './comp-registry.js';

const compFileTree = compDefine(FileTree, {
  componentType: 'fileTree',
  dataRefTypeList: ['fileTree'],
  placementList: ['mdx', 'commentBlock'],
});
const compIndex = compDefine(Index, {
  componentType: 'index',
  placementList: ['mdx', 'commentBlock', 'partIndex'],
});
const compMultiLang = compDefine(MultiLang, { placementList: ['commentBlock'] });
const compImage = compDefine(Image, { placementList: ['mdx', 'commentBlock'] });
const compImageGrid = compDefine(ImageGrid, { placementList: ['mdx', 'commentBlock'] });
const compDiagramText = compDefine(DiagramText, { placementList: ['commentBlock'] });
// mermaid itself is not a package dependency: the host app supplies
// config.mermaidLoad through DocPageMdx config.compConfigHost.
const compDiagramMermaid = compDefine(DiagramMermaid, { placementList: ['mdx', 'commentBlock'] });
// block components display authored Markdown through the package renderer
const compBlockSimple = compDefine(BlockSimple, {
  dataBuild: blockConfigBuild,
  placementList: ['commentBlock'],
});
const compBlockMdx = compDefine(BlockMdx, {
  dataBuild: blockConfigBuild,
  placementList: ['commentBlock'],
});
const compBlock = compDefine(Block, {
  dataBuild: blockConfigBuild,
  placementList: ['commentBlock'],
});

// all components that docs may use. what is actually exposed to doc authors
// (and under which tag name) is decided by compRegistry in config.yaml.
export const compById = {
  // relatively common components, re-exported from the fumadocs default theme
  'common/Tabs': compNativeDefine(Tabs, { placementList: ['mdx'] }),
  'common/Tab': compNativeDefine(Tab, { placementList: ['mdx'] }),
  'common/Callout': compNativeDefine(Callout, { placementList: ['mdx'] }),
  'common/Accordions': compNativeDefine(Accordions, { placementList: ['mdx'] }),
  'common/Accordion': compNativeDefine(Accordion, { placementList: ['mdx'] }),
  'common/Steps': compNativeDefine(Steps, { placementList: ['mdx'] }),
  'common/Step': compNativeDefine(Step, { placementList: ['mdx'] }),
  'common/Files': compNativeDefine(Files, { placementList: ['mdx'] }),
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
  'common/Block': compBlock,
  'common/BlockSimple': compBlockSimple,
  'common/BlockMdx': compBlockMdx,
  // built-in names (comp-registry.js compIdBuiltinByName): the page renders
  // with these even when compRegistry does not mention them
  'common/SidePanelItem': compDefine(SidePanelItem, { placementList: ['sidePanelDisplay'] }),
  'common/Tag': compDefine(Tag, { placementList: ['tag', 'mdx'] }),
  'common/TagOverview': compDefine(TagOverview, { placementList: ['tagOverview', 'mdx', 'commentBlock'] }),
  // compatibility ids: existing consumer configs map tags to these ids
  'common/DocFileTree': compFileTree,
  'common/DocIndex': compIndex,
  'common/DocMultiLang': compMultiLang,
  'common/DocImage': compImage,
  'common/DocImageGrid': compImageGrid,
  'common/DocDiagramText': compDiagramText,
  'common/DocDiagramMermaid': compDiagramMermaid,
  'specific/DemoCounter': compDefine(DemoCounter),
  'specific/StockTable': compDefine(StockTable),
  'specific/SidePanelItemDemo': compDefine(SidePanelItemDemo, { placementList: ['sidePanelDisplay'] }),
  'specific/TagListAllDemo': compDefine(TagListAllDemo, { placementList: ['mdx', 'commentBlock'] }),
  'specific/DocConfigDemo': compDefine(DocConfigDemo, { placementList: ['mdx', 'commentBlock'] }),
  // demo-host binding: the popup panel implementation is host configuration,
  // so SourceLink is registered here with the demo panel rather than in common/.
  'specific/SourceLink': compDefine(SourceLink, {
    dataBuild: sourceLinkDataBuild,
    placementList: ['mdx', 'commentBlock'],
  }),
};

function blockConfigBuild(input) {
  return {
    ...input,
    config: {
      ...input.config,
      DocLink,
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
