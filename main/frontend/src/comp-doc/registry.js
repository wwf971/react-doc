import { Accordion, Accordions, Callout, File, Files, Folder, Step, Steps, Tab, Tabs } from '../../UICommon.js';
import { DocLinkInline } from './DocLink.jsx';
import { FileTree } from '../../../comp-mdx/file-tree/FileTree.jsx';
import { Index } from '../../../comp-mdx/index/Index.jsx';
import { MultiLang } from '../../../comp-mdx/multi-lang/MultiLangEntry.jsx';
import { SourceLink } from '../../../comp-mdx/source-link/SourceLink.jsx';
// demo-specific components live beside the demonstration documents
import { DemoCounter } from '../../../../example_doc/comp-mdx/DemoCounter.jsx';
import { StockTable } from '../../../../example_doc/comp-mdx/StockTable.jsx';
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
  // compatibility ids: existing consumer configs map tags to these ids
  'common/DocFileTree': compFileTree,
  'common/DocIndex': compIndex,
  'common/DocMultiLang': compMultiLang,
  'specific/DemoCounter': compDefine(DemoCounter),
  'specific/StockTable': compDefine(StockTable),
  // demo-host binding: the popup panel implementation is host configuration,
  // so SourceLink is registered here with the demo panel rather than in common/.
  'specific/SourceLink': compDefine(SourceLink, {
    dataBuild: sourceLinkDataBuild,
    placementList: ['mdx', 'commentBlock'],
  }),
};

function sourceLinkDataBuild(input) {
  return {
    ...input,
    config: {
      ...input.config,
      panelComponent: TextPanelDemo,
    },
  };
}
