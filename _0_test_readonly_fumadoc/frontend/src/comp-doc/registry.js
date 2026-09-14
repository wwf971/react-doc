import { Accordion, Accordions, Callout, File, Files, Folder, Step, Steps, Tab, Tabs } from '../../UICommon.js';
import { DocMultiLang } from './common/MultiLangEntry.jsx';
import { DemoCounter } from './specific/DemoCounter.jsx';
import { StockTable } from './specific/StockTable.jsx';
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
  'common/DocMultiLang': compDefine(DocMultiLang, { placementList: ['commentBlock'] }),
  'specific/DemoCounter': compDefine(DemoCounter),
  'specific/StockTable': compDefine(StockTable),
};
