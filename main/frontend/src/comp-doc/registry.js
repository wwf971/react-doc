import { Accordion, Accordions, Callout, File, Files, Folder, Step, Steps, Tab, Tabs } from '../../UICommon.js';
import { DocLinkInline } from './DocLink.jsx';
import { DocFileTree } from '../../../comp-mdx/file-tree/DocFileTree.jsx';
import { DocMultiLang } from '../../../comp-mdx/multi-lang/MultiLangEntry.jsx';
import { SourceLink } from '../../../comp-mdx/source-link/SourceLink.jsx';
import { DemoCounter } from './specific/DemoCounter.jsx';
import { StockTable } from './specific/StockTable.jsx';
import { TextPanelDemo } from './specific/TextPanelDemo.jsx';
import { compDefine, compNativeDefine } from './comp-registry.js';

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
  'common/DocFileTree': compDefine(DocFileTree, { placementList: ['mdx', 'commentBlock'] }),
  'common/DocLinkInline': compDefine(DocLinkInline, {
    placementList: ['fileTreeDescription'],
  }),
  'common/DocMultiLang': compDefine(DocMultiLang, { placementList: ['commentBlock'] }),
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
